/**
 * Tests for src/auth/authManager.ts
 */

import {
  AuthManager,
  AuthNotConfiguredError,
  OAuthNotConfiguredError,
} from "../../src/auth/authManager";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";
import type { PluginSettings } from "../../src/settings/types";
import type { SecretsService } from "../../src/auth/secrets";

function makeSettings(over: Partial<PluginSettings> = {}): PluginSettings {
  return { ...DEFAULT_SETTINGS, ...over };
}

/**
 * Minimal SecretsService stand-in backed by a Map. The AuthManager only
 * calls `.get(name)`; the rest of the interface is unused in these tests.
 */
function makeSecrets(map: Record<string, string> = {}): SecretsService {
  const memory = new Map(Object.entries(map));
  return {
    backend: "secret-storage",
    isAvailable: true,
    get: async (name: string | undefined | null) =>
      name ? memory.get(name) ?? null : null,
    set: async (name: string, value: string) => {
      memory.set(name, value);
    },
    remove: async (name: string | undefined | null) => {
      if (name) memory.delete(name);
    },
  } as unknown as SecretsService;
}

describe("AuthManager.isConfigured", () => {
  it("returns false when no auth method is set", () => {
    const s = makeSettings();
    const mgr = new AuthManager(() => s, async () => {});
    expect(mgr.isConfigured()).toBe(false);
  });

  it("returns true for a complete API token (shape only — does not verify secret value)", () => {
    const s = makeSettings({
      authMethod: "apiToken",
      apiToken: {
        siteUrl: "https://acme.atlassian.net",
        email: "a@b.com",
        tokenSecretName: "jira-tiles:api-token",
      },
    });
    const mgr = new AuthManager(() => s, async () => {});
    expect(mgr.isConfigured()).toBe(true);
  });

  it("returns false for a partial API token (no secret name)", () => {
    const s = makeSettings({
      authMethod: "apiToken",
      apiToken: {
        siteUrl: "https://acme.atlassian.net",
        email: "a@b.com",
        tokenSecretName: "",
      },
    });
    const mgr = new AuthManager(() => s, async () => {});
    expect(mgr.isConfigured()).toBe(false);
  });

  it("returns true for OAuth with secret name + cloudId", () => {
    const s = makeSettings({
      authMethod: "oauth",
      oauth: {
        accessTokenSecretName: "jira-tiles:oauth-access-token",
        refreshTokenSecretName: "jira-tiles:oauth-refresh-token",
        expiresAt: Date.now() + 60_000,
        cloudId: "cid",
        siteUrl: "https://acme.atlassian.net",
        siteName: "Acme",
      },
    });
    const mgr = new AuthManager(() => s, async () => {});
    expect(mgr.isConfigured()).toBe(true);
  });
});

describe("AuthManager.getContext", () => {
  it("throws when not configured", async () => {
    const s = makeSettings();
    const mgr = new AuthManager(() => s, async () => {});
    await expect(mgr.getContext()).rejects.toThrow(AuthNotConfiguredError);
  });

  it("returns a Basic Authorization header for API token", async () => {
    const s = makeSettings({
      authMethod: "apiToken",
      apiToken: {
        siteUrl: "https://acme.atlassian.net",
        email: "alice@example.com",
        tokenSecretName: "jira-tiles:api-token",
      },
    });
    const secrets = makeSecrets({
      "jira-tiles:api-token": "supersecret",
    });
    const mgr = new AuthManager(() => s, async () => {}, null, secrets);
    const ctx = await mgr.getContext();
    expect(ctx.authorizationHeader).toBe(
      "Basic " + btoa("alice@example.com:supersecret"),
    );
    expect(ctx.baseUrl).toBe("https://acme.atlassian.net");
    expect(ctx.refreshable).toBe(false);
  });

  it("throws when the API token secret cannot be resolved", async () => {
    const s = makeSettings({
      authMethod: "apiToken",
      apiToken: {
        siteUrl: "https://acme.atlassian.net",
        email: "alice@example.com",
        tokenSecretName: "jira-tiles:api-token",
      },
    });
    const secrets = makeSecrets({}); // empty -> get() returns null
    const mgr = new AuthManager(() => s, async () => {}, null, secrets);
    await expect(mgr.getContext()).rejects.toThrow(/not found/);
  });

  it("returns a Bearer header and api.atlassian.com proxy URL for OAuth", async () => {
    const s = makeSettings({
      authMethod: "oauth",
      oauth: {
        accessTokenSecretName: "jira-tiles:oauth-access-token",
        refreshTokenSecretName: "jira-tiles:oauth-refresh-token",
        expiresAt: Date.now() + 3_600_000,
        cloudId: "cloud-123",
        siteUrl: "https://acme.atlassian.net",
        siteName: "Acme",
      },
    });
    const secrets = makeSecrets({
      "jira-tiles:oauth-access-token": "TOKEN",
    });
    const mgr = new AuthManager(
      () => s,
      async () => {},
      async () => {},
      secrets,
    );
    const ctx = await mgr.getContext();
    expect(ctx.authorizationHeader).toBe("Bearer TOKEN");
    expect(ctx.baseUrl).toBe("https://api.atlassian.com/ex/jira/cloud-123");
    expect(ctx.refreshable).toBe(true);
  });
});

describe("AuthManager.ensureFresh", () => {
  it("is a no-op for API token auth", async () => {
    const s = makeSettings({
      authMethod: "apiToken",
      apiToken: {
        siteUrl: "https://x.atlassian.net",
        email: "a@b.com",
        tokenSecretName: "jira-tiles:api-token",
      },
    });
    const mgr = new AuthManager(() => s, async () => {});
    await expect(mgr.ensureFresh()).resolves.toBeUndefined();
  });

  it("is a no-op when OAuth token is far from expiry", async () => {
    let refreshed = false;
    const s = makeSettings({
      authMethod: "oauth",
      oauth: {
        accessTokenSecretName: "jira-tiles:oauth-access-token",
        refreshTokenSecretName: "jira-tiles:oauth-refresh-token",
        expiresAt: Date.now() + 60 * 60 * 1000,
        cloudId: "cid",
        siteUrl: "https://x.atlassian.net",
        siteName: "X",
      },
    });
    const mgr = new AuthManager(
      () => s,
      async () => {},
      async () => { refreshed = true; },
    );
    await mgr.ensureFresh();
    expect(refreshed).toBe(false);
  });

  it("refreshes when OAuth token is near expiry", async () => {
    let refreshed = false;
    const s = makeSettings({
      authMethod: "oauth",
      oauth: {
        accessTokenSecretName: "jira-tiles:oauth-access-token",
        refreshTokenSecretName: "jira-tiles:oauth-refresh-token",
        expiresAt: Date.now() + 5_000, // within leeway
        cloudId: "cid",
        siteUrl: "https://x.atlassian.net",
        siteName: "X",
      },
    });
    const mgr = new AuthManager(
      () => s,
      async () => {},
      async () => { refreshed = true; },
    );
    await mgr.ensureFresh();
    expect(refreshed).toBe(true);
  });

  it("throws OAuthNotConfiguredError when refresh is required but no refreshFn provided", async () => {
    const s = makeSettings({
      authMethod: "oauth",
      oauth: {
        accessTokenSecretName: "jira-tiles:oauth-access-token",
        refreshTokenSecretName: "jira-tiles:oauth-refresh-token",
        expiresAt: Date.now() + 5_000,
        cloudId: "cid",
        siteUrl: "https://x.atlassian.net",
        siteName: "X",
      },
    });
    const mgr = new AuthManager(() => s, async () => {});
    await expect(mgr.ensureFresh()).rejects.toThrow(OAuthNotConfiguredError);
  });
});

describe("AuthManager.forceRefresh", () => {
  it("always invokes refreshFn for OAuth, regardless of expiry", async () => {
    let refreshed = 0;
    const s = makeSettings({
      authMethod: "oauth",
      oauth: {
        accessTokenSecretName: "jira-tiles:oauth-access-token",
        refreshTokenSecretName: "jira-tiles:oauth-refresh-token",
        expiresAt: Date.now() + 60 * 60 * 1000,
        cloudId: "cid",
        siteUrl: "https://x.atlassian.net",
        siteName: "X",
      },
    });
    const mgr = new AuthManager(
      () => s,
      async () => {},
      async () => { refreshed++; },
    );
    await mgr.forceRefresh();
    expect(refreshed).toBe(1);
  });

  it("is a no-op for API token auth", async () => {
    const s = makeSettings({
      authMethod: "apiToken",
      apiToken: {
        siteUrl: "https://x.atlassian.net",
        email: "a@b.com",
        tokenSecretName: "jira-tiles:api-token",
      },
    });
    const mgr = new AuthManager(() => s, async () => {});
    await expect(mgr.forceRefresh()).resolves.toBeUndefined();
  });
});
