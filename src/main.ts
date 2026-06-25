/**
 * JiraTilesPlugin — Obsidian plugin entry point.
 *
 * Lifecycle:
 *   onload   - load settings, instantiate Jira client + cache + AuthManager
 *              + OAuthFlow, register settings tab, register the ```jira code
 *              block processor, register the obsidian:// protocol handler
 *              used by OAuth, and register command-palette commands (Phase 5).
 *   onunload - Obsidian deregisters our handlers; we clear caches + pending
 *              OAuth attempts.
 */

import { Notice, Plugin, requestUrl } from "obsidian";
import { JiraTilesSettingTab } from "./settings/SettingsTab";
import { mergeWithDefaults, DEFAULT_SETTINGS } from "./settings/defaults";
import type { PluginSettings } from "./settings/types";
import { AuthManager } from "./auth/authManager";
import { OAuthFlow } from "./auth/tokenStore";
import { SecretsService } from "./auth/secrets";
import { migrateSecretsIfNeeded } from "./auth/migration";
import { JiraClient } from "./jira/client";
import { IssueCache } from "./cache/issueCache";
import { buildCodeBlockProcessor } from "./render/codeBlockProcessor";
import { buildCommands } from "./commands";

/**
 * Open an external URL using the most reliable mechanism available.
 *
 * Inside Obsidian Desktop (Electron), `window.open` may open an *internal*
 * browser window which does NOT trigger the OS protocol handler when the
 * remote site redirects to `obsidian://...`. We bypass that by calling
 * Electron's `shell.openExternal` when it's reachable, falling back to
 * `window.open` on mobile / unknown environments.
 */
function openExternalUrl(url: string): void {
  // Try Electron first — only available on desktop.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = (window as { require?: (m: string) => unknown }).require?.(
      "electron",
    ) as { shell?: { openExternal?: (u: string) => Promise<void> } } | undefined;
    if (electron?.shell?.openExternal) {
      void electron.shell.openExternal(url);
      return;
    }
  } catch {
    // Not Electron — fall through.
  }
  // Mobile / fallback.
  window.open(url, "_blank", "noopener");
}

export default class JiraTilesPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  authManager!: AuthManager;
  oauthFlow!: OAuthFlow;
  client!: JiraClient;
  cache!: IssueCache;
  secrets!: SecretsService;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.secrets = new SecretsService(this.app);

    // One-time migration: move any pre-SecretStorage plain-text tokens out
    // of data.json and into SecretStorage. Idempotent — guarded by
    // settings.secretsMigrationComplete. We run before constructing the
    // auth-related machinery so it sees the post-migration shape.
    const migration = await migrateSecretsIfNeeded(
      this.settings,
      this.secrets,
      Notice,
    );
    if (migration.migrated) {
      await this.saveSettings();
    }

    // The AuthManager and OAuthFlow have a circular dependency (AuthManager
    // needs OAuthFlow.refresh; OAuthFlow needs JiraClient which needs
    // AuthManager). We resolve it by pre-creating a "trampoline" refresh
    // function that delegates to oauthFlow once it's set.
    const refreshTrampoline = (s: PluginSettings) =>
      this.oauthFlow!.refresh(s);

    this.authManager = new AuthManager(
      () => this.settings,
      () => this.saveSettings(),
      refreshTrampoline,
      this.secrets,
    );

    this.client = new JiraClient({ authManager: this.authManager });
    this.cache = new IssueCache(() => this.settings.cacheTtlMinutes * 60_000);

    this.oauthFlow = new OAuthFlow({
      openExternal: (url) => {
        // Console-log so users debugging from DevTools can paste the URL
        // manually if Obsidian's launcher misbehaves.
        console.log("[jira-tiles] opening OAuth authorize URL:", url);
        openExternalUrl(url);
      },
      http: async (url, body) => {
        // Atlassian's docs (https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/)
        // specify Content-Type: application/json with a JSON body, e.g.
        //   { "grant_type": "authorization_code", "client_id": "...",
        //     "client_secret": "...", "code": "...", "redirect_uri": "..." }
        // Our implementation is a *public client* using PKCE (RFC 7636), so
        // we send `code_verifier` instead of `client_secret`. Atlassian's
        // auth.atlassian.com endpoint marks the client as
        // `client_auth_type: NONE` when authorize was called with
        // `code_challenge`, and accepts `code_verifier` at the token
        // endpoint. Both JSON and application/x-www-form-urlencoded bodies
        // are accepted in practice; we try JSON first (matches the docs)
        // and fall back to form-encoded on a 401, since some endpoints /
        // proxies have been observed to reject one or the other. Form
        // fallback is only attempted when JSON returns a generic
        // 401 access_denied so we don't mask other errors.
        const redactedKeys = new Set([
          "code",
          "code_verifier",
          "refresh_token",
          "client_secret",
        ]);
        const redactedBody = Object.fromEntries(
          Object.entries(body).map(([k, v]) =>
            redactedKeys.has(k) ? [k, `<${(v as string).length} chars>`] : [k, v],
          ),
        );

        type WireResponse = { status: number; json: unknown; text: string };

        const send = async (
          contentType: "application/json" | "application/x-www-form-urlencoded",
          serialized: string,
        ): Promise<WireResponse> => {
          const res = await requestUrl({
            url,
            method: "POST",
            headers: {
              "Content-Type": contentType,
              Accept: "application/json",
            },
            body: serialized,
            throw: false,
          });
          // requestUrl's `json` getter throws when body is not valid JSON;
          // be defensive so we can surface the raw text in error messages.
          let json: unknown = undefined;
          try {
            json = res.json;
          } catch {
            json = undefined;
          }
          return { status: res.status, json, text: res.text ?? "" };
        };

        console.log(
          "[jira-tiles] OAuth POST",
          url,
          "body:",
          redactedBody,
          "(json)",
        );
        try {
          let res = await send("application/json", JSON.stringify(body));
          console.log(
            "[jira-tiles] OAuth response status (json):",
            res.status,
            "body length:",
            res.text.length,
          );
          if (res.status === 401) {
            // Belt-and-suspenders: try form-encoded once. Some Atlassian
            // edge proxies have rejected JSON bodies for PKCE clients with
            // `access_denied: Unauthorized`. Form-encoded matches OAuth 2.0
            // RFC 6749 §4.1.3 and works as a fallback. We log clearly so
            // the user knows in DevTools which content type their site
            // accepts.
            console.warn(
              "[jira-tiles] JSON token request returned 401; retrying with form-encoded body",
            );
            const formRes = await send(
              "application/x-www-form-urlencoded",
              new URLSearchParams(body).toString(),
            );
            console.log(
              "[jira-tiles] OAuth response status (form-encoded retry):",
              formRes.status,
              "body length:",
              formRes.text.length,
            );
            if (formRes.status >= 200 && formRes.status < 300) {
              return formRes;
            }
            // Surface whichever response is more informative — prefer the
            // one that came back with an error_description body.
            const formHasBody = formRes.text && formRes.text.length > 0;
            res = formHasBody ? formRes : res;
          }
          if (res.status < 200 || res.status >= 300) {
            console.error(
              "[jira-tiles] OAuth HTTP error",
              res.status,
              res.text,
            );
          }
          return res;
        } catch (err) {
          console.error("[jira-tiles] OAuth HTTP request threw:", err);
          throw err;
        }
      },
      getSettings: () => this.settings,
      saveSettings: () => this.saveSettings(),
      client: this.client,
      secrets: this.secrets,
    });

    this.addSettingTab(new JiraTilesSettingTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor(
      "jira",
      buildCodeBlockProcessor({
        client: this.client,
        cache: this.cache,
        getSettings: () => this.settings,
        openUrl: (url) => openExternalUrl(url),
      }),
    );

    // OAuth callback: Atlassian -> obsidian://jira-tiles-auth-callback?...
    this.registerObsidianProtocolHandler(
      "jira-tiles-auth-callback",
      (params) => {
        console.log(
          "[jira-tiles] OAuth callback received with params:",
          // Don't log the actual code — just the keys that arrived.
          Object.keys(params),
        );
        // Fire-and-forget — handleCallback resolves/rejects the in-flight
        // promise from beginConnect(), so the SettingsTab can react to it.
        this.oauthFlow.handleCallback(params).catch((err) => {
          console.error("[jira-tiles] handleCallback error:", err);
          new Notice(
            `Jira sign-in failed: ${(err as Error).message ?? String(err)}`,
            10_000,
          );
        });
      },
    );

    // Command palette entries.
    for (const cmd of buildCommands({ app: this.app, cache: this.cache })) {
      this.addCommand(cmd);
    }
  }

  async onunload(): Promise<void> {
    this.cache?.invalidate();
    this.oauthFlow?.cancelAll("Plugin unloaded.");
  }

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Partial<PluginSettings> | null;
    this.settings = mergeWithDefaults(raw);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Called by the SettingsTab when the active auth method changes. Drops the
   * cache so we don't render data fetched under the previous identity.
   */
  onAuthChanged(): void {
    this.cache?.invalidate();
  }
}
