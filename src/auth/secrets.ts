/**
 * SecretsService — wraps Obsidian's SecretStorage API with a graceful fallback.
 *
 * Obsidian's `app.secretStorage` (added in 1.11.4) is a synchronous key/value
 * store for sensitive data, kept local to the install and excluded from sync.
 * See https://docs.obsidian.md/Plugins/Guides/Store+secrets.
 *
 * Why a wrapper:
 *   - Older Obsidian builds don't expose `app.secretStorage`, so we degrade to
 *     in-memory storage with a warning rather than crash. The fallback's
 *     secrets vanish on reload — that's intentional: we don't want to silently
 *     re-introduce plaintext storage if SecretStorage is unavailable.
 *   - Centralizes the secret-ID naming convention and validation. The real API
 *     requires "lowercase alphanumeric with optional dashes" IDs and throws on
 *     anything else, so we normalize/validate before calling it.
 *   - Presents a small async surface (get/set/remove) so callers don't depend
 *     on whether the underlying store is sync or async.
 *
 * Note on deletion: the real SecretStorage API exposes only setSecret/getSecret/
 * listSecrets — there is no delete. `remove()` therefore overwrites the entry
 * with an empty string on the real backend (and deletes from the in-memory
 * fallback). Callers should treat "empty" and "absent" identically.
 */

import type { App } from "obsidian";

/**
 * Subset of Obsidian's SecretStorage API the plugin uses. The real methods are
 * synchronous; we keep the typing permissive (sync or Promise) so the wrapper
 * is robust to minor API evolution.
 */
export interface SecretStorageApi {
  getSecret(id: string): string | null | undefined | Promise<string | null | undefined>;
  setSecret(id: string, value: string): void | Promise<void>;
}

/**
 * Stable internal secret IDs. MUST be lowercase alphanumeric with optional
 * dashes (no colons, dots, or other punctuation) — the SecretStorage API
 * throws on invalid IDs.
 */
export const INTERNAL_SECRETS = {
  /** Default ID for a freshly-saved API token. */
  defaultApiToken: "jira-tiles-api-token",
} as const;

/** Validate a secret ID against the SecretStorage rules (lowercase a-z0-9 + dashes). */
export function isValidSecretId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(id);
}

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
    }
  }

  /** True iff the running Obsidian supports SecretStorage. */
  get isAvailable(): boolean {
    return this.backend === "secret-storage";
  }

  /**
   * Read a secret by ID. Returns `null` if no secret with that ID exists.
   * Empty/whitespace ID -> null (treated as "not configured").
   */
  async get(id: string | undefined | null): Promise<string | null> {
    if (!id || !id.trim()) return null;
    if (this.storage) {
      try {
        const v = await this.storage.getSecret(id);
        return v ?? null;
      } catch {
        // The store throws on invalid IDs; treat as "not found".
        return null;
      }
    }
    return this.memory.get(id) ?? null;
  }

  /**
   * Write a secret value under the given ID. If the runtime has no
   * SecretStorage and we're in memory-fallback mode, the value is held until
   * reload only.
   *
   * @throws Error if the ID is not a valid SecretStorage ID.
   */
  async set(id: string, value: string): Promise<void> {
    if (!id || !id.trim()) {
      throw new Error("SecretsService.set: secret id must be non-empty.");
    }
    if (!isValidSecretId(id)) {
      throw new Error(
        `SecretsService.set: invalid secret id "${id}" (must be lowercase ` +
          `alphanumeric with optional dashes).`,
      );
    }
    if (this.storage) {
      await this.storage.setSecret(id, value);
      return;
    }
    this.memory.set(id, value);
  }

  /**
   * Remove a secret by ID. The real SecretStorage has no delete operation, so
   * on that backend we overwrite with an empty string. In the in-memory
   * fallback we delete the entry. Idempotent — missing IDs are a no-op.
   */
  async remove(id: string | undefined | null): Promise<void> {
    if (!id || !isValidSecretId(id)) return;
    if (this.storage) {
      try {
        await this.storage.setSecret(id, "");
      } catch {
        // Non-fatal — leaving a stale entry is acceptable.
      }
      return;
    }
    this.memory.delete(id);
  }
}
