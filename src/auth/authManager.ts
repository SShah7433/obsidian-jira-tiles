/**
 * AuthManager — single source of truth for "how do I authenticate the next
 * Jira REST request?".
 *
 * The Jira client never reaches into settings directly; instead it asks the
 * AuthManager for an `AuthContext` that carries:
 *   - the Authorization header value (Basic for API token)
 *   - the base URL to prefix on requests
 *
 * The token *value* is stored in Obsidian's SecretStorage — this manager
 * pulls it out by *name* (which is what lives in PluginSettings) at request
 * time. That makes `getContext` async; the JiraClient already invokes it
 * from an async context so the cost is just the awaits.
 *
 * The plugin used to support OAuth 2.0 (3LO) as well; that was removed when
 * the Atlassian token endpoint repeatedly returned `access_denied:Unauthorized`
 * to the Obsidian-bundled HTTP client. API token auth covers the same use
 * cases (including SSO-linked Atlassian accounts that can mint tokens).
 */

import type { PluginSettings } from "../settings/types";
import { buildBasicAuthHeader } from "./apiToken";
import type { SecretsService } from "./secrets";

/** Per-request auth context returned to the Jira client. */
export interface AuthContext {
  /** Value to put in the `Authorization` header. */
  authorizationHeader: string;
  /** Base URL the client should prefix on REST paths. */
  baseUrl: string;
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

export class AuthManager {
  constructor(
    private readonly getSettings: () => PluginSettings,
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
    return false;
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
      };
    }

    throw new AuthNotConfiguredError();
  }

  private async readSecret(name: string | undefined): Promise<string | null> {
    if (!this.secrets) return null;
    return this.secrets.get(name);
  }
}
