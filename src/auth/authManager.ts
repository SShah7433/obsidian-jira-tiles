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
 * Token *values* are stored in Obsidian's SecretStorage — this manager pulls
 * them out by *name* (which is what lives in PluginSettings) at request time.
 * That makes `getContext` async; the JiraClient already invokes it from an
 * async context so the cost is just the awaits.
 */

import { OAUTH_REFRESH_LEEWAY_SECONDS } from "../constants";
import type { PluginSettings } from "../settings/types";
import { buildBasicAuthHeader } from "./apiToken";
import type { SecretsService } from "./secrets";

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
  constructor(message?: string) {
    super(
      message ??
        "Jira authentication is not configured. Open plugin settings.",
    );
    this.name = "AuthNotConfiguredError";
  }
}

/** Thrown when OAuth is selected but PKCE flow has not yet succeeded. */
export class OAuthNotConfiguredError extends AuthNotConfiguredError {
  constructor() {
    super("OAuth not yet supported in this build (Phase 3).");
    this.name = "OAuthNotConfiguredError";
  }
}

/**
 * Function the AuthManager calls when an OAuth access token is near expiry.
 * Lives in src/auth/tokenStore.ts; for older code paths (tests) it's
 * typed-only.
 */
export type RefreshFn = (settings: PluginSettings) => Promise<void>;

export class AuthManager {
  constructor(
    private readonly getSettings: () => PluginSettings,
    private readonly persistSettings: () => Promise<void>,
    private readonly refreshFn: RefreshFn | null = null,
    private readonly secrets?: SecretsService,
  ) {}

  /**
   * Determine whether any auth method is fully configured. Note this checks
   * names + structural fields only — it does NOT verify a secret exists in
   * SecretStorage. Use `getContext()` to surface that as an error.
   */
  isConfigured(): boolean {
    const s = this.getSettings();
    if (s.authMethod === "apiToken") {
      return !!(
        s.apiToken?.siteUrl &&
        s.apiToken?.email &&
        s.apiToken?.tokenSecretName
      );
    }
    if (s.authMethod === "oauth") {
      return !!(
        s.oauth?.accessTokenSecretName && s.oauth?.cloudId
      );
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
   * 401 to recover from a token Atlassian considers invalid.
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
   * Resolve a snapshot AuthContext for the next request. Asynchronous because
   * we now read the actual token value from SecretStorage at this point.
   *
   * Throws AuthNotConfiguredError when no auth method is configured *or* the
   * referenced secret cannot be found (e.g. the user picked a name that was
   * later removed from SecretStorage).
   */
  async getContext(): Promise<AuthContext> {
    const s = this.getSettings();

    if (s.authMethod === "apiToken" && s.apiToken) {
      const token = await this.readSecret(s.apiToken.tokenSecretName);
      if (!token) {
        throw new AuthNotConfiguredError(
          `API token secret "${s.apiToken.tokenSecretName}" was not found in ` +
            `Obsidian's secret storage. Re-select or re-enter it in settings.`,
        );
      }
      return {
        authorizationHeader: buildBasicAuthHeader({
          email: s.apiToken.email,
          token,
        }),
        baseUrl: s.apiToken.siteUrl,
        refreshable: false,
      };
    }

    if (s.authMethod === "oauth" && s.oauth) {
      const accessToken = await this.readSecret(s.oauth.accessTokenSecretName);
      if (!accessToken) {
        throw new AuthNotConfiguredError(
          "OAuth access token is missing from secret storage. Reconnect Jira in settings.",
        );
      }
      return {
        authorizationHeader: `Bearer ${accessToken}`,
        baseUrl: `https://api.atlassian.com/ex/jira/${s.oauth.cloudId}`,
        refreshable: !!this.refreshFn,
      };
    }

    throw new AuthNotConfiguredError();
  }

  private async readSecret(name: string | undefined): Promise<string | null> {
    if (!this.secrets) return null;
    return this.secrets.get(name);
  }
}