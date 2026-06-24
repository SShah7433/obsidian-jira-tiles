/**
 * SecretsService — wraps Obsidian's SecretStorage API with a graceful fallback.
 *
 * Why a wrapper:
 *   - The SecretStorage API was added in Obsidian 1.5+. Older versions don't
 *     expose `app.secretStorage`, so we degrade to in-memory storage with a
 *     loud warning rather than crash. The fallback's secrets vanish on
 *     reload — that's intentional: we don't want to silently re-introduce
 *     plaintext storage if SecretStorage is unavailable.
 *   - Centralizes naming conventions for plugin-internal secrets (OAuth
 *     access/refresh tokens). User-facing secrets (the API token) use a
 *     name the user picks via the SecretComponent.
 *   - Hides the slightly clunky "name vs value" distinction from callers
 *     that just want "give me the token for this state object".
 *
 * Threat model recap:
 *   - data.json now contains only site URL, email, feature toggles, and
 *     secret *names* — no credentials. Anyone with vault filesystem access
 *     can see what secrets the plugin uses but not the values.
 *   - Obsidian's SecretStorage is local to the install and not synced.
 *     See https://docs.obsidian.md/plugins/guides/secret-storage.
 */

import type { App } from "obsidian";

/**
 * Subset of Obsidian's SecretStorage API the plugin needs. Typed locally
 * because older @types/obsidian may not declare it. `app.secretStorage`
 * is checked at runtime in the constructor.
 */
export interface SecretStorageApi {
  getSecret(name: string): string | null | undefined | Promise<string | null | undefined>;
  setSecret?(name: string, value: string): void | Promise<void>;
  deleteSecret?(name: string): void | Promise<void>;
}

/** Stable internal secret names — used for plugin-managed (OAuth) secrets. */
export const INTERNAL_SECRETS = {
  /** Default name for a freshly-saved API token before the user renames it. */
  defaultApiToken: "jira-tiles:api-token",
  /** OAuth access token (rotated frequently). */
  oauthAccessToken: "jira-tiles:oauth-access-token",
  /** OAuth refresh token (rotated by Atlassian on every refresh). */
  oauthRefreshToken: "jira-tiles:oauth-refresh-token",
} as const;

/**
 * Decision on how the SecretsService should behave for the current Obsidian
 * runtime — used by callers to surface the right warnings in the UI.
 */
export type SecretsBackendKind = "secret-storage" | "memory-fallback";

export class SecretsService {
  private readonly storage: SecretStorageApi | null;
  /** In-memory fallback; cleared on reload. Only used if Obsidian is too old. */
  private readonly memory = new Map<string, string>();
  readonly backend: SecretsBackendKind;

  constructor(app: App) {
    // Detect at construction so callers can render the right hint without
    // checking on every operation.
    const candidate = (app as unknown as { secretStorage?: SecretStorageApi })
      .secretStorage;
    if (candidate && typeof candidate.getSecret === "function") {
      this.storage = candidate;
      this.backend = "secret-storage";
    } else {
      this.storage = null;
      this.backend = "memory-fallback";
      // Visible in DevTools the very first load. Surfaced again in the
      // SettingsTab so users see it without opening the console.
      console.warn(
        "[jira-tiles] Obsidian SecretStorage API unavailable — falling " +
          "back to in-memory secret store. Tokens will need to be re-entered " +
          "after each reload. Update Obsidian to 1.5 or newer for proper " +
          "secret storage.",
      );
    }
  }

  /** True iff the running Obsidian supports SecretStorage. */
  get isAvailable(): boolean {
    return this.backend === "secret-storage";
  }

  /**
   * Read a secret by name. Returns `null` if no secret with that name exists.
   * Empty/whitespace name -> null (treated as "not configured").
   */
  async get(name: string | undefined | null): Promise<string | null> {
    if (!name || !name.trim()) return null;
    if (this.storage) {
      try {
        const v = await this.storage.getSecret(name);
        return v ?? null;
      } catch (err) {
        console.error(
          "[jira-tiles] SecretStorage.getSecret threw for name:",
          name,
          err,
        );
        return null;
      }
    }
    return this.memory.get(name) ?? null;
  }

  /**
   * Write a secret value under the given name. If the runtime has no
   * SecretStorage and we're in memory-fallback mode, the value is held until
   * reload only — the user is responsible for re-entering after reload.
   */
  async set(name: string, value: string): Promise<void> {
    if (!name || !name.trim()) {
      throw new Error("SecretsService.set: secret name must be non-empty.");
    }
    if (this.storage?.setSecret) {
      await this.storage.setSecret(name, value);
      return;
    }
    if (this.storage && !this.storage.setSecret) {
      // Read-only SecretStorage (extremely unlikely but possible if the API
      // surface is in flux). Surface clearly rather than swallow.
      throw new Error(
        "Obsidian SecretStorage exposed getSecret but not setSecret; " +
          "cannot persist the secret. Update Obsidian.",
      );
    }
    this.memory.set(name, value);
  }

  /** Remove a secret by name. Idempotent — missing names are a no-op. */
  async remove(name: string | undefined | null): Promise<void> {
    if (!name) return;
    if (this.storage?.deleteSecret) {
      try {
        await this.storage.deleteSecret(name);
      } catch (err) {
        console.error(
          "[jira-tiles] SecretStorage.deleteSecret threw for name:",
          name,
          err,
        );
      }
      return;
    }
    this.memory.delete(name);
  }
}
