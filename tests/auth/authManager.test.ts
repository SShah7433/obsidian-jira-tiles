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

function makeSettings(over: Partial<PluginSettings> = {}): PluginSettings {
  return { ...DEFAULT_SETTINGS, ...over };
}

describe("AuthManager.isConfigured", () => {
  it("returns false when no auth method is set", () => {
    const s = makeSettings();
    const mgr = new AuthManager(() => s, async () => {});
    expect(mgr.isConfigured()).toBe(false);
  });

  it("returns true for a complete API token", () => {
    const s = makeSettings({
      authMethod: "apiToken",
      apiToken: {
        siteUrl: "https://acme.atlassian.net",
        email: "a@b.com",
        token: "x",
      },
    });
    const mgr = new AuthManager(() => s, async () => {});
    expect(mgr.isConfigured()).toBe(true);
  });

  it("returns false for a partial API token", () => {
    const s = makeSettings({
      authMethod: "apiToken",
      apiToken: { siteUrl: "https://acme.atlassian.net", email: "a@b.com", token: "" },
    });
    const mgr = new AuthManager(() => s, async () => {});
    expect(mgr.isConfigured()).toBe(false);
  });

  it("returns true for OAuth with token + cloudId", () => {
    const s = makeSettings({
      authMethod: "oauth",
      oauth: {
        accessToken: "a",
        refreshToken: "r",
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
  it("throws when not configured", () => {
    const s = makeSettings();
    const mgr = new AuthManager(() => s, async () => {});
    expect(() => mgr.getContext()).toThrow(AuthNotConfiguredError);
  });

  it("returns a Basic Authorization header for API token", () => {
    const s = makeSettings({
      authMethod: "apiToken",
      apiToken: {
        siteUrl: "https://acme.atlassian.net",
        email: "alice@example.com",
        token: "supersecret",
      },
    });
    const mgr = new AuthManager(() => s, async () => {});
    const ctx = mgr.getContext();
    expect(ctx.authorizationHeader).toBe(
      "Basic " + btoa("alice@example.com:supersecret"),
    );
    expect(ctx.baseUrl).toBe("https://acme.atlassian.net");
    expect(ctx.refreshable).toBe(false);
  });

  it("returns a Bearer header and api.atlassian.com proxy URL for OAuth", () => {
    const s = makeSettings({
      authMethod: "oauth",
      oauth: {
        accessToken: "TOKEN",
        refreshToken: "RT",
        expiresAt: Date.now() + 3_600_000,
        cloudId: "cloud-123",
        siteUrl: "https://acme.atlassian.net",
        siteName: "Acme",
      },
    });
    const mgr = new AuthManager(
      () => s,
      async () => {},
      async () => {}, // refreshFn provided => refreshable=true
    );
    const ctx = mgr.getContext();
    expect(ctx.authorizationHeader).toBe("Bearer TOKEN");
    expect(ctx.baseUrl).toBe("https://api.atlassian.com/ex/jira/cloud-123");
    expect(ctx.refreshable).toBe(true);
  });
});

describe("AuthManager.ensureFresh", () => {
  it("is a no-op for API token auth", async () => {
    const s = makeSettings({
      authMethod: "apiToken",
      apiToken: { siteUrl: "https://x.atlassian.net", email: "a@b.com", token: "t" },
    });
    const mgr = new AuthManager(() => s, async () => {});
    await expect(mgr.ensureFresh()).resolves.toBeUndefined();
  });

  it("is a no-op when OAuth token is far from expiry", async () => {
    let refreshed = false;
    const s = makeSettings({
      authMethod: "oauth",
      oauth: {
        accessToken: "a",
        refreshToken: "r",
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
        accessToken: "a",
        refreshToken: "r",
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
        accessToken: "a",
        refreshToken: "r",
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
        accessToken: "a",
        refreshToken: "r",
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
      apiToken: { siteUrl: "https://x.atlassian.net", email: "a@b.com", token: "t" },
    });
    const mgr = new AuthManager(() => s, async () => {});
    await expect(mgr.forceRefresh()).resolves.toBeUndefined();
  });
});
