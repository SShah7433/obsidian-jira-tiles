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
import { JiraClient } from "./jira/client";
import { IssueCache } from "./cache/issueCache";
import { buildCodeBlockProcessor } from "./render/codeBlockProcessor";
import { buildCommands } from "./commands";

export default class JiraTilesPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  authManager!: AuthManager;
  oauthFlow!: OAuthFlow;
  client!: JiraClient;
  cache!: IssueCache;

  async onload(): Promise<void> {
    await this.loadSettings();

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
    );

    this.client = new JiraClient({ authManager: this.authManager });
    this.cache = new IssueCache(() => this.settings.cacheTtlMinutes * 60_000);

    this.oauthFlow = new OAuthFlow({
      openExternal: (url) => window.open(url, "_blank", "noopener"),
      http: async (url, body) => {
        const res = await requestUrl({
          url,
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams(body).toString(),
          throw: false,
        });
        return { status: res.status, json: res.json, text: res.text };
      },
      getSettings: () => this.settings,
      saveSettings: () => this.saveSettings(),
      client: this.client,
    });

    this.addSettingTab(new JiraTilesSettingTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor(
      "jira",
      buildCodeBlockProcessor({
        client: this.client,
        cache: this.cache,
        getSettings: () => this.settings,
        openUrl: (url) => window.open(url, "_blank", "noopener"),
      }),
    );

    // OAuth callback: Atlassian -> obsidian://jira-tiles-auth-callback?...
    this.registerObsidianProtocolHandler(
      "jira-tiles-auth-callback",
      (params) => {
        // Fire-and-forget — handleCallback resolves/rejects the in-flight
        // promise from beginConnect(), so the SettingsTab can react to it.
        this.oauthFlow.handleCallback(params).catch((err) => {
          new Notice(`Jira sign-in failed: ${(err as Error).message}`);
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
