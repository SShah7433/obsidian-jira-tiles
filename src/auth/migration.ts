/**
 * One-shot migration that moves pre-SecretStorage credentials out of
 * `data.json` and into Obsidian's SecretStorage.
 *
 * Triggered from main.ts during onload. Idempotent: the
 * `secretsMigrationComplete` flag in PluginSettings prevents re-running.
 *
 * What we migrate:
 *   - `apiToken.token`  -> SecretStorage[`jira-tiles:api-token`]
 *                        and `apiToken.tokenSecretName` set to that name.
 *   - `oauth.accessToken` and `oauth.refreshToken` -> SecretStorage with
 *     internal names; corresponding `*SecretName` fields set in `oauth`.
 *
 * If SecretStorage is unavailable (older Obsidian) we still run the migration
 * but the secrets land in the in-memory fallback — they'll be wiped on
 * reload, prompting the user to re-enter. We deliberately do NOT leave the
 * plain-text values in `data.json` after a migration attempt; doing so would
 * defeat the purpose. The user gets a clear Notice if they need to re-enter.
 */

import type { Notice } from "obsidian";
import {
  INTERNAL_SECRETS,
  type SecretsService,
} from "./secrets";
import type { PluginSettings } from "../settings/types";

/** Result returned to callers so they can choose how to surface to the user. */
export interface MigrationResult {
  /** True iff at least one credential was migrated this run. */
  migrated: boolean;
  /** True iff secrets were written to memory-fallback (will not survive reload). */
  ephemeral: boolean;
  /** Human-readable summary suitable for a Notice. */
  message: string | null;
}

/**
 * Perform the migration. Mutates `settings` in place; the caller is expected
 * to call `plugin.saveData(settings)` once afterwards (we don't save here so
 * the caller can batch other onload mutations).
 */
export async function migrateSecretsIfNeeded(
  settings: PluginSettings,
  secrets: SecretsService,
  // Notice is provided as a constructor so this module stays testable
  // without importing obsidian directly.
  NoticeCtor?: typeof Notice,
): Promise<MigrationResult> {
  if (settings.secretsMigrationComplete) {
    return { migrated: false, ephemeral: false, message: null };
  }

  let migratedSomething = false;

  /* API token --------------------------------------------------------- */

  // Legacy shape had `token: string`; new shape has `tokenSecretName: string`.
  // We probe with a permissive cast since TypeScript already knows the new
  // shape and won't see the legacy field. `unknown` keeps us honest about
  // the runtime check.
  const legacyApi = settings.apiToken as unknown as
    | { siteUrl?: string; email?: string; token?: string; tokenSecretName?: string }
    | undefined;
  if (legacyApi?.token && !legacyApi.tokenSecretName) {
    const name = INTERNAL_SECRETS.defaultApiToken;
    try {
      await secrets.set(name, legacyApi.token);
      settings.apiToken = {
        siteUrl: legacyApi.siteUrl ?? "",
        email: legacyApi.email ?? "",
        tokenSecretName: name,
      };
      migratedSomething = true;
      console.log("[jira-tiles] migrated API token into SecretStorage");
    } catch (err) {
      console.error("[jira-tiles] failed to migrate API token:", err);
    }
  }

  /* OAuth tokens ------------------------------------------------------ */

  const legacyOauth = settings.oauth as unknown as
    | {
        accessToken?: string;
        refreshToken?: string;
        accessTokenSecretName?: string;
        refreshTokenSecretName?: string;
        expiresAt?: number;
        cloudId?: string;
        siteUrl?: string;
        siteName?: string;
      }
    | undefined;
  if (
    legacyOauth?.accessToken &&
    !legacyOauth.accessTokenSecretName
  ) {
    try {
      await secrets.set(
        INTERNAL_SECRETS.oauthAccessToken,
        legacyOauth.accessToken,
      );
      if (legacyOauth.refreshToken) {
        await secrets.set(
          INTERNAL_SECRETS.oauthRefreshToken,
          legacyOauth.refreshToken,
        );
      }
      settings.oauth = {
        accessTokenSecretName: INTERNAL_SECRETS.oauthAccessToken,
        refreshTokenSecretName: legacyOauth.refreshToken
          ? INTERNAL_SECRETS.oauthRefreshToken
          : "",
        expiresAt: legacyOauth.expiresAt ?? 0,
        cloudId: legacyOauth.cloudId ?? "",
        siteUrl: legacyOauth.siteUrl ?? "",
        siteName: legacyOauth.siteName ?? "",
      };
      migratedSomething = true;
      console.log("[jira-tiles] migrated OAuth tokens into SecretStorage");
    } catch (err) {
      console.error("[jira-tiles] failed to migrate OAuth tokens:", err);
    }
  }

  settings.secretsMigrationComplete = true;

  if (!migratedSomething) {
    return { migrated: false, ephemeral: false, message: null };
  }

  const ephemeral = !secrets.isAvailable;
  const message = ephemeral
    ? "Jira credentials were moved out of data.json, but Obsidian's " +
      "SecretStorage is unavailable on this version — you'll need to " +
      "re-enter credentials in settings each time you reload."
    : "Jira credentials were moved into Obsidian's secure SecretStorage.";

  if (NoticeCtor) {
    new NoticeCtor(message, 12_000);
  }

  return { migrated: true, ephemeral, message };
}