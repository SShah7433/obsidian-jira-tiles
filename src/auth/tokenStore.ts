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
      // Nothing to do; surface a console message but do not throw — the
      // protocol handler is fire-and-forget.
      return;
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

      // Discover which Jira site the user has selected.
      const sites = await this.deps.client.getAccessibleResources(
        tokens.access_token,
      );
      if (sites.length === 0) {
        throw new OAuthError(
          0,
          "No accessible Jira sites for this account.",
        );
      }
      // MVP: pin to the first site. Future: prompt when multiple.
      const site = sites[0];

      const next: OAuthState = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
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
    }
  }

  /**
   * Refresh the access token using the stored refresh_token. Wired into
   * AuthManager via `plugin.authManager = new AuthManager(..., flow.refresh)`.
   */
  async refresh(_settings: PluginSettings): Promise<void> {
    const settings = this.deps.getSettings();
    if (!settings.oauth) throw new OAuthError(0, "No OAuth state to refresh.");
    const tokens = await refreshAccessToken(
      this.deps.http,
      settings.oauth.refreshToken,
    );
    settings.oauth = {
      ...settings.oauth,
      accessToken: tokens.access_token,
      // Atlassian rotates refresh tokens — always store the new one.
      refreshToken: tokens.refresh_token,
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
