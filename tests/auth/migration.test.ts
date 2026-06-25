/**
 * Tests for src/auth/migration.ts — the legacy-to-SecretStorage migration
 * + OAuth state cleanup.
 */

import { migrateSecretsIfNeeded } from "../../src/auth/migration";
import { INTERNAL_SECRETS, type SecretsService } from "../../src/auth/secrets";
import type { PluginSettings } from "../../src/settings/types";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";

function fakeSecrets(opts?: { available?: boolean }): {
  service: SecretsService;
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  const available = opts?.available ?? true;
  const service: SecretsService = {
    backend: available ? "secret-storage" : "memory-fallback",
    isAvailable: available,
    get: async (n: string | undefined | null) =>
      n ? store.get(n) ?? null : null,
    set: async (n: string, v: string) => {
      store.set(n, v);
    },
    remove: async (n: string | undefined | null) => {
      if (n) store.delete(n);
    },
  } as unknown as SecretsService;
  return { service, store };
}

describe("migrateSecretsIfNeeded", () => {
  it("does nothing when there are no legacy credentials and no migration record", async () => {
    const settings: PluginSettings = { ...DEFAULT_SETTINGS };
    const { service } = fakeSecrets();
    const result = await migrateSecretsIfNeeded(settings, service);
    expect(result.migrated).toBe(false);
    expect(result.oauthDropped).toBe(false);
    expect(settings.secretsMigrationComplete).toBe(true);
    expect(settings.apiToken).toBeUndefined();
  });

  it("is idempotent — running twice does not duplicate work", async () => {
    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      secretsMigrationComplete: true,
    };
    const { service, store } = fakeSecrets();
    const r1 = await migrateSecretsIfNeeded(settings, service);
    const r2 = await migrateSecretsIfNeeded(settings, service);
    expect(r1.migrated).toBe(false);
    expect(r2.migrated).toBe(false);
    expect(store.size).toBe(0);
  });

  it("migrates a legacy plain-text API token into SecretStorage", async () => {
    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      authMethod: "apiToken",
      // Legacy shape — token is in plain text here.
      apiToken: {
        siteUrl: "https://acme.atlassian.net",
        email: "alice@example.com",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        token: "ATATT-secret",
      } as unknown as PluginSettings["apiToken"],
    };
    const { service, store } = fakeSecrets();

    const result = await migrateSecretsIfNeeded(settings, service);

    expect(result.migrated).toBe(true);
    expect(result.ephemeral).toBe(false);
    expect(result.oauthDropped).toBe(false);
    // Plain-text value moved into SecretStorage.
    expect(store.get(INTERNAL_SECRETS.defaultApiToken)).toBe("ATATT-secret");
    // Settings now references the *name*, not the value.
    expect(settings.apiToken).toEqual({
      siteUrl: "https://acme.atlassian.net",
      email: "alice@example.com",
      tokenSecretName: INTERNAL_SECRETS.defaultApiToken,
    });
    expect(settings.secretsMigrationComplete).toBe(true);
  });

  it("drops vestigial OAuth state and removes any cached OAuth secrets", async () => {
    // Older builds wrote `oauth: {...}` and `authMethod: "oauth"` into
    // settings, plus access/refresh tokens into SecretStorage. The
    // migration now removes all of that.
    const legacy = {
      ...DEFAULT_SETTINGS,
      authMethod: "oauth",
      oauth: {
        accessTokenSecretName: INTERNAL_SECRETS.oauthAccessToken,
        refreshTokenSecretName: INTERNAL_SECRETS.oauthRefreshToken,
        expiresAt: 1234,
        cloudId: "c",
        siteUrl: "https://x.atlassian.net",
        siteName: "X",
      },
    } as unknown as PluginSettings;
    const { service, store } = fakeSecrets();
    // Seed the SecretStorage with the previously-stored OAuth secrets.
    await service.set(INTERNAL_SECRETS.oauthAccessToken, "AT-old");
    await service.set(INTERNAL_SECRETS.oauthRefreshToken, "RT-old");

    const result = await migrateSecretsIfNeeded(legacy, service);

    expect(result.migrated).toBe(true);
    expect(result.oauthDropped).toBe(true);
    expect(result.message).toMatch(/OAuth support was removed/);
    expect((legacy as unknown as { oauth?: unknown }).oauth).toBeUndefined();
    expect(legacy.authMethod).toBe("none");
    // SecretStorage cleanup.
    expect(store.has(INTERNAL_SECRETS.oauthAccessToken)).toBe(false);
    expect(store.has(INTERNAL_SECRETS.oauthRefreshToken)).toBe(false);
  });

  it("flags ephemeral=true when SecretStorage is unavailable", async () => {
    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      apiToken: {
        siteUrl: "https://x.atlassian.net",
        email: "a@b.com",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        token: "T",
      } as unknown as PluginSettings["apiToken"],
    };
    const { service } = fakeSecrets({ available: false });

    const result = await migrateSecretsIfNeeded(settings, service);
    expect(result.migrated).toBe(true);
    expect(result.ephemeral).toBe(true);
    expect(result.message).toMatch(/SecretStorage is unavailable/);
  });

  it("leaves already-migrated settings untouched", async () => {
    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      apiToken: {
        siteUrl: "https://x.atlassian.net",
        email: "a@b.com",
        tokenSecretName: "user-named-secret",
      },
    };
    const { service, store } = fakeSecrets();
    const result = await migrateSecretsIfNeeded(settings, service);
    expect(result.migrated).toBe(false);
    expect(store.size).toBe(0);
    expect(settings.apiToken?.tokenSecretName).toBe("user-named-secret");
    expect(settings.secretsMigrationComplete).toBe(true);
  });
});
