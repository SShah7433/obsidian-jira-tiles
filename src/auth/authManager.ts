/**
 * AuthManager — single source of truth for "how do I authenticate the next
 * Jira REST request?".
 *
 * The Jira client never reaches into settings directly; instead it asks the
 * AuthManager for an `AuthContext` that carries:
 *   - the Authorization header value (Bearer or Basic)
 *   - the base URL to prefix on requests
 *
 * For OAuth, this is also where transparent token refresh happens.
 *
 * Phase 1 implements only the API-token branch. The OAuth branch is a stub
 * that throws `OAuthNotConfiguredError` until Phase 3 lands.
 */

import { OAUTH_REFRESH_LEEWAY_SECONDS } from "../constants";
import type { PluginSettings } from "../settings/types";
import { buildBasicAuthHeader } from "./apiToken";

/** Per-request auth context returned to the Jira client. */
export interface AuthContext {
  /** Value to put in the `Authorization` header. */
  authorizationHeader: string;
  /** Base URL the client should prefix on REST paths. */
  baseUrl: string;
  /**
   * Indicates whether the calling code can attempt a one-shot token refresh +
   * retry on a 401 response. False for API token (no recovery possible).
   */
  refreshable: boolean;
}

/** Public Error subclass so callers can switch on `instanceof`. */
export class AuthNotConfiguredError extends Error {
  constructor() {
    super("Jira authentication is not configured. Open plugin settings.");
    this.name = "AuthNotConfiguredError";
  }
}

/** Thrown when OAuth is selected but PKCE flow has not yet succeeded. */
export class OAuthNotConfiguredError extends AuthNotConfiguredError {
  constructor() {
    super();
    this.name = "OAuthNotConfiguredError";
    this.message = "OAuth not yet supported in this build (Phase 3).";
  }
}

/**
 * Function the AuthManager calls when an OAuth access token is near expiry.
 * Lives in src/auth/tokenStore.ts in Phase 3; for now it's typed-only.
 */
export type RefreshFn = (settings: PluginSettings) => Promise<void>;

/**
 * Strategy resolver. Pure, side-effect-free, easy to unit test.
 *
 * Important: this returns the *current* AuthContext snapshot. If OAuth tokens
 * need refreshing, callers must invoke `ensureFresh()` first.
 */
export class AuthManager {
  constructor(
    private readonly getSettings: () => PluginSettings,
    private readonly persistSettings: () => Promise<void>,
    private readonly refreshFn: RefreshFn | null = null,
  ) {}

  /**
   * Determine whether any auth method is fully configured.
   */
  isConfigured(): boolean {
    const s = this.getSettings();
    if (s.authMethod === "apiToken") {
      return !!(s.apiToken?.siteUrl && s.apiToken?.email && s.apiToken?.token);
    }
    if (s.authMethod === "oauth") {
      return !!(s.oauth?.accessToken && s.oauth?.cloudId);
    }
    return false;
  }

  /**
   * If the current auth method needs a token refresh (OAuth, near expiry),
   * perform it. Idempotent — safe to call before every request.
   */
  async ensureFresh(): Promise<void> {
    const s = this.getSettings();
    if (s.authMethod !== "oauth" || !s.oauth) return;
    const remainingSec = (s.oauth.expiresAt - Date.now()) / 1000;
    if (remainingSec > OAUTH_REFRESH_LEEWAY_SECONDS) return;
    if (!this.refreshFn) {
      throw new OAuthNotConfiguredError();
    }
    await this.refreshFn(s);
    await this.persistSettings();
  }

  /**
   * Force a refresh regardless of expiry. Called by the Jira client after a
   * 401 to recover from a token Atlassian considers invalid (e.g. revoked,
   * scope changed, issued before a config change).
   */
  async forceRefresh(): Promise<void> {
    const s = this.getSettings();
    if (s.authMethod !== "oauth" || !s.oauth) return;
    if (!this.refreshFn) {
      throw new OAuthNotConfiguredError();
    }
    await this.refreshFn(s);
    await this.persistSettings();
  }

  /**
   * Resolve a snapshot AuthContext for the next request.
   * Throws if no auth is configured.
   */
  getContext(): AuthContext {
    const s = this.getSettings();

    if (s.authMethod === "apiToken" && s.apiToken) {
      return {
        authorizationHeader: buildBasicAuthHeader(s.apiToken),
        baseUrl: s.apiToken.siteUrl,
        refreshable: false,
      };
    }

    if (s.authMethod === "oauth" && s.oauth) {
      return {
        authorizationHeader: `Bearer ${s.oauth.accessToken}`,
        // OAuth uses the api.atlassian.com proxy with the cloudId in the path.
        baseUrl: `https://api.atlassian.com/ex/jira/${s.oauth.cloudId}`,
        refreshable: !!this.refreshFn,
      };
    }

    throw new AuthNotConfiguredError();
  }
}
