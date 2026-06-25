/**
 * One-shot migration that moves pre-SecretStorage credentials out of
 * `data.json` and into Obsidian's SecretStorage.
 *
 * Triggered from main.ts during onload. Idempotent: the
 * `secretsMigrationComplete` flag in PluginSettings prevents re-running.
 *
 * What we migrate:
 *   - Legacy `apiToken.token` (plain string) ->
 *     SecretStorage[`jira-tiles:api-token`] and
 *     `apiToken.tokenSecretName` set to that name.
 *   - Legacy `oauth` block (any plugin version that supported OAuth) ->
 *     dropped entirely, since OAuth is no longer supported. The user is
 *     informed via Notice and asked to set up an API token instead.
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
  /** True iff a legacy OAuth block was dropped (user should re-auth via API token). */
  oauthDropped: boolean;
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
    return {
      migrated: false,
      ephemeral: false,
      oauthDropped: false,
      message: null,
    };
  }

  let migratedSomething = false;
  let oauthDropped = false;

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

  /* OAuth state ------------------------------------------------------- */

  // OAuth is no longer supported. If we find any vestige of an OAuth state,
  // drop it cleanly so the saved settings stop carrying stale fields.
  const settingsWithLegacyOauth = settings as unknown as {
    oauth?: unknown;
    authMethod?: string;
  };
  if (settingsWithLegacyOauth.oauth) {
    delete settingsWithLegacyOauth.oauth;
    if (settingsWithLegacyOauth.authMethod === "oauth") {
      settingsWithLegacyOauth.authMethod = "none";
    }
    oauthDropped = true;
    migratedSomething = true;
    // Best-effort cleanup of any access/refresh secrets that earlier
    // versions of the plugin wrote into SecretStorage. Removing here keeps
    // SecretStorage tidy; failure is non-fatal.
    try {
      await secrets.remove(INTERNAL_SECRETS.oauthAccessToken);
      await secrets.remove(INTERNAL_SECRETS.oauthRefreshToken);
    } catch (err) {
      console.warn(
        "[jira-tiles] failed to remove legacy OAuth secrets (non-fatal):",
        err,
      );
    }
  }

  settings.secretsMigrationComplete = true;

  if (!migratedSomething) {
    return {
      migrated: false,
      ephemeral: false,
      oauthDropped: false,
      message: null,
    };
  }

  const ephemeral = !secrets.isAvailable;
  let message: string;
  if (oauthDropped) {
    message =
      "OAuth support was removed. Set up an Atlassian API token in plugin " +
      "settings to keep using Jira Tiles.";
  } else if (ephemeral) {
    message =
      "Jira credentials were moved out of data.json, but Obsidian's " +
      "SecretStorage is unavailable on this version — you'll need to " +
      "re-enter credentials in settings each time you reload.";
  } else {
    message = "Jira credentials were moved into Obsidian's secure SecretStorage.";
  }

  if (NoticeCtor) {
    new NoticeCtor(message, 12_000);
  }

  return { migrated: true, ephemeral, oauthDropped, message };
}
