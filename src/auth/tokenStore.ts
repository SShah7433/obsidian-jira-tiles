/**
 * OAuth orchestration — bridges the pure helpers in `oauth.ts` with Obsidian.
 *
 * Lifecycle:
 *
 *   beginConnect()
 *     1. Generate verifier + state.
 *     2. Stash them in an in-memory pending map keyed by state.
 *     3. Open the authorization URL in the user's browser.
 *     4. Resolve a Promise that the protocol handler completes when the
 *        callback URL arrives.
 *
 *   handleCallback(params)
 *     1. Look up the pending entry by state (rejects on mismatch — CSRF guard).
 *     2. Exchange code -> tokens.
 *     3. Resolve `accessible-resources` to discover cloudId + siteUrl.
 *     4. Persist the result in plugin settings.
 *     5. Resolve the in-flight Promise from beginConnect().
 *
 *   refresh()
 *     1. POST refresh_token -> new tokens (Atlassian rotates the refresh
 *        token, so we must store the new one).
 *     2. Persist the new state.
 */

import {
  OAUTH_REFRESH_LEEWAY_SECONDS,
} from "../constants";
import type { JiraClient } from "../jira/client";
import type { OAuthState, PluginSettings } from "../settings/types";
import {
  buildAuthorizationUrl,
  computeCodeChallenge,
  exchangeCodeForTokens,
  generateCodeVerifier,
  generateState,
  type HttpPost,
  OAuthError,
  refreshAccessToken,
} from "./oauth";
import { INTERNAL_SECRETS, type SecretsService } from "./secrets";

/** Pending authorization that hasn't yet seen its callback. */
interface PendingAuth {
  codeVerifier: string;
  resolve: (state: OAuthState) => void;
  reject: (err: Error) => void;
  /** Timestamp at which we'll auto-reject this attempt. */
  expiresAt: number;
}

/** Dependencies the flow needs from the plugin. */
export interface OAuthFlowDeps {
  /** Open a URL in the user's external browser. */
  openExternal: (url: string) => void;
  /** HTTP POST against the Atlassian token endpoint (CORS-free via requestUrl). */
  http: HttpPost;
  /** Read the current settings object. */
  getSettings: () => PluginSettings;
  /** Persist the settings object after we've mutated `oauth`. */
  saveSettings: () => Promise<void>;
  /** Jira client used to discover the cloudId from the token. */
  client: JiraClient;
  /** Secret store for access/refresh token values. */
  secrets: SecretsService;
}

const PENDING_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

export class OAuthFlow {
  /** state -> PendingAuth, with a periodic sweep to clean up expired entries. */
  private readonly pending = new Map<string, PendingAuth>();
  private sweepHandle: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: OAuthFlowDeps) {}

  /**
   * Kick off a new OAuth attempt. Returns a Promise that resolves once the
   * protocol handler has received the callback and tokens have been stored.
   */
  async beginConnect(): Promise<OAuthState> {
    const state = generateState();
    const verifier = generateCodeVerifier();
    const challenge = await computeCodeChallenge(verifier);

    const url = buildAuthorizationUrl({ state, codeChallenge: challenge });

    const promise = new Promise<OAuthState>((resolve, reject) => {
      this.pending.set(state, {
        codeVerifier: verifier,
        resolve,
        reject,
        expiresAt: Date.now() + PENDING_TIMEOUT_MS,
      });
    });

    this.startSweepLoop();
    this.deps.openExternal(url);
    return promise;
  }

  /**
   * Process a parameter object from the obsidian:// protocol handler.
   *
   * Expected params:
   *   { action: "jira-tiles-auth-callback", code: "...", state: "..." }
   *
   * On error, the Atlassian callback may carry `error` / `error_description`
   * instead of `code`.
   */
  async handleCallback(params: Record<string, string>): Promise<void> {
    const state = params.state;
    const code = params.code;
    const errCode = params.error;

    const pending = state ? this.pending.get(state) : undefined;
    if (!pending) {
      // Either CSRF, the user already completed the flow, or a stale link.
      // Surface this — the user clicked Connect and is now wondering why
      // nothing happened.
      const reason = !state
        ? "Atlassian callback did not include a `state` parameter."
        : `Received callback for unknown state — the Connect attempt may have ` +
          `timed out (5 min) or already been completed in another window.`;
      throw new OAuthError(0, reason);
    }
    this.pending.delete(state);

    try {
      if (errCode) {
        throw new OAuthError(
          0,
          `Atlassian returned ${errCode}${
            params.error_description ? `: ${params.error_description}` : ""
          }`,
        );
      }
      if (!code) {
        throw new OAuthError(0, "Missing `code` in OAuth callback.");
      }

      const tokens = await exchangeCodeForTokens(this.deps.http, {
        code,
        codeVerifier: pending.codeVerifier,
      });

      if (!tokens || !tokens.access_token) {
        throw new OAuthError(
          0,
          "Token endpoint returned no access_token — check your OAuth app configuration in Atlassian Developer Console.",
        );
      }

      // Discover which Jira site the user has selected.
      let sites;
      try {
        sites = await this.deps.client.getAccessibleResources(
          tokens.access_token,
        );
      } catch (err) {
        throw new OAuthError(
          0,
          `Could not list accessible Jira sites: ${
            (err as Error).message ?? String(err)
          }`,
        );
      }
      if (!sites || sites.length === 0) {
        throw new OAuthError(
          0,
          "No accessible Jira sites for this account. Confirm your Atlassian account can access at least one Jira Cloud site, and that the OAuth app's `read:jira-work` scope is approved.",
        );
      }
      // MVP: pin to the first site. Future: prompt when multiple.
      const site = sites[0];

      // Stash the tokens in SecretStorage and keep only their *names* in
      // PluginSettings.
      const accessName = INTERNAL_SECRETS.oauthAccessToken;
      const refreshName = tokens.refresh_token
        ? INTERNAL_SECRETS.oauthRefreshToken
        : "";
      try {
        await this.deps.secrets.set(accessName, tokens.access_token);
        if (tokens.refresh_token) {
          await this.deps.secrets.set(refreshName, tokens.refresh_token);
        }
      } catch (err) {
        throw new OAuthError(
          0,
          `Could not save OAuth tokens to secret storage: ${
            (err as Error).message ?? String(err)
          }`,
        );
      }

      const next: OAuthState = {
        accessTokenSecretName: accessName,
        refreshTokenSecretName: refreshName,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        cloudId: site.id,
        siteUrl: site.url,
        siteName: site.name,
      };

      const settings = this.deps.getSettings();
      settings.authMethod = "oauth";
      settings.oauth = next;
      await this.deps.saveSettings();

      pending.resolve(next);
    } catch (err) {
      pending.reject(err instanceof Error ? err : new Error(String(err)));
      // Re-throw so the protocol handler in main.ts sees the error and surfaces
      // it via Notice; otherwise the only visible message is the generic
      // "Sign-in failed" from the SettingsTab catch block.
      throw err;
    }
  }

  /**
   * Refresh the access token using the stored refresh_token. Wired into
   * AuthManager via `plugin.authManager = new AuthManager(..., flow.refresh)`.
   *
   * Reads the refresh token from SecretStorage (it's no longer in
   * PluginSettings), exchanges it, and writes both rotated tokens back.
   */
  async refresh(_settings: PluginSettings): Promise<void> {
    const settings = this.deps.getSettings();
    if (!settings.oauth) throw new OAuthError(0, "No OAuth state to refresh.");
    const refreshTokenValue = await this.deps.secrets.get(
      settings.oauth.refreshTokenSecretName,
    );
    if (!refreshTokenValue) {
      throw new OAuthError(
        0,
        "Refresh token is missing from secret storage. Reconnect Jira in settings.",
      );
    }
    const tokens = await refreshAccessToken(this.deps.http, refreshTokenValue);

    // Atlassian rotates refresh tokens — overwrite the stored value with the
    // new one so we don't reuse the now-invalidated one on the next refresh.
    await this.deps.secrets.set(
      settings.oauth.accessTokenSecretName,
      tokens.access_token,
    );
    if (tokens.refresh_token) {
      await this.deps.secrets.set(
        settings.oauth.refreshTokenSecretName ||
          INTERNAL_SECRETS.oauthRefreshToken,
        tokens.refresh_token,
      );
    }
    settings.oauth = {
      ...settings.oauth,
      refreshTokenSecretName:
        settings.oauth.refreshTokenSecretName ||
        INTERNAL_SECRETS.oauthRefreshToken,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    await this.deps.saveSettings();
  }

  /** Number of in-flight authorization attempts (for tests / debugging). */
  pendingCount(): number {
    return this.pending.size;
  }

  /** Cancel any in-flight authorization (e.g. user disconnects). */
  cancelAll(reason = "Cancelled."): void {
    for (const [state, p] of this.pending) {
      p.reject(new OAuthError(0, reason));
      this.pending.delete(state);
    }
    if (this.sweepHandle) {
      clearInterval(this.sweepHandle);
      this.sweepHandle = null;
    }
  }

  /** Predicate used by `ensureFresh` paths in tests. */
  static isAccessTokenNearExpiry(state: OAuthState, now = Date.now()): boolean {
    return (state.expiresAt - now) / 1000 <= OAUTH_REFRESH_LEEWAY_SECONDS;
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                              */
  /* ---------------------------------------------------------------------- */

  private startSweepLoop(): void {
    if (this.sweepHandle) return;
    this.sweepHandle = setInterval(() => {
      const now = Date.now();
      for (const [state, p] of this.pending) {
        if (now >= p.expiresAt) {
          p.reject(new OAuthError(0, "OAuth flow timed out (5 min)."));
          this.pending.delete(state);
        }
      }
      if (this.pending.size === 0 && this.sweepHandle) {
        clearInterval(this.sweepHandle);
        this.sweepHandle = null;
      }
    }, 30_000);
  }
}
