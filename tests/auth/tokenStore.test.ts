/**
 * Tests for src/auth/tokenStore.ts — the OAuthFlow orchestrator.
 *
 * After the SecretStorage migration, tokens are written via SecretsService
 * and only their *names* end up on PluginSettings.oauth. Each test injects
 * a fake SecretsService backed by a Map.
 */

import { OAuthFlow } from "../../src/auth/tokenStore";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";
import type { PluginSettings } from "../../src/settings/types";
import type { JiraClient } from "../../src/jira/client";
import type { AccessibleResource } from "../../src/jira/types";
import { INTERNAL_SECRETS, type SecretsService } from "../../src/auth/secrets";

/** Wait until `predicate()` is true, polling on each microtask tick. */
async function waitFor(predicate: () => boolean, attempts = 50): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error("waitFor timed out");
}

interface HarnessState {
  settings: PluginSettings;
  saved: { count: number };
  opened: string[];
  http: jest.Mock;
  client: JiraClient;
  flow: OAuthFlow;
  secretsMap: Map<string, string>;
}

function makeHarness(opts?: {
  sites?: AccessibleResource[];
  http?: jest.Mock;
}): HarnessState {
  const settings: PluginSettings = { ...DEFAULT_SETTINGS };
  const saved = { count: 0 };
  const opened: string[] = [];
  const sites: AccessibleResource[] = opts?.sites ?? [
    {
      id: "cloud-1",
      url: "https://acme.atlassian.net",
      name: "Acme",
      scopes: ["read:jira-work"],
    },
  ];
  const http = opts?.http ?? jest.fn();

  const client = {
    getIssue: jest.fn(),
    getFields: jest.fn(),
    getAccessibleResources: jest.fn(async () => sites),
  } as unknown as JiraClient;

  const secretsMap = new Map<string, string>();
  const secrets: SecretsService = {
    backend: "secret-storage",
    isAvailable: true,
    get: async (n: string | undefined | null) =>
      n ? secretsMap.get(n) ?? null : null,
    set: async (n: string, v: string) => {
      secretsMap.set(n, v);
    },
    remove: async (n: string | undefined | null) => {
      if (n) secretsMap.delete(n);
    },
  } as unknown as SecretsService;

  const flow = new OAuthFlow({
    openExternal: (url) => opened.push(url),
    http,
    getSettings: () => settings,
    saveSettings: async () => {
      saved.count++;
    },
    client,
    secrets,
  });

  return { settings, saved, opened, http, client, flow, secretsMap };
}

describe("OAuthFlow.beginConnect", () => {
  it("opens the authorization URL and returns a pending promise", async () => {
    const h = makeHarness();
    const beginP = h.flow.beginConnect();
    // Attach a rejection handler so jest's unhandled-rejection guard doesn't trip.
    beginP.catch(() => undefined);
    await waitFor(() => h.opened.length > 0);
    expect(h.opened).toHaveLength(1);
    expect(h.opened[0]).toContain("https://auth.atlassian.com/authorize");
    expect(h.flow.pendingCount()).toBe(1);
    h.flow.cancelAll();
    await expect(beginP).rejects.toThrow();
  });
});

describe("OAuthFlow.handleCallback", () => {
  it("throws a descriptive error for an unknown state", async () => {
    const h = makeHarness();
    await expect(
      h.flow.handleCallback({ state: "nope", code: "x" }),
    ).rejects.toThrow(/unknown state/);
    expect(h.saved.count).toBe(0);
  });

  it("throws when state is missing entirely", async () => {
    const h = makeHarness();
    await expect(h.flow.handleCallback({ code: "x" })).rejects.toThrow(
      /did not include a `state`/,
    );
  });

  it("on success: exchanges code, stores tokens in SecretStorage, persists, resolves", async () => {
    const http = jest.fn(async () => ({
      status: 200,
      json: {
        access_token: "AT",
        refresh_token: "RT",
        expires_in: 3600,
        token_type: "Bearer",
      },
      text: "",
    }));
    const h = makeHarness({ http });

    const beginP = h.flow.beginConnect();
    // wait for openExternal
    await waitFor(() => h.opened.length > 0);
    const url = new URL(h.opened[0]);
    const state = url.searchParams.get("state")!;
    expect(state).toBeTruthy();

    await h.flow.handleCallback({ state, code: "CODE" });
    const result = await beginP;

    // Settings carries names, not values.
    expect(result.accessTokenSecretName).toBe(INTERNAL_SECRETS.oauthAccessToken);
    expect(result.refreshTokenSecretName).toBe(INTERNAL_SECRETS.oauthRefreshToken);
    expect(result.cloudId).toBe("cloud-1");
    expect(result.siteUrl).toBe("https://acme.atlassian.net");

    // Actual values landed in SecretStorage.
    expect(h.secretsMap.get(INTERNAL_SECRETS.oauthAccessToken)).toBe("AT");
    expect(h.secretsMap.get(INTERNAL_SECRETS.oauthRefreshToken)).toBe("RT");

    expect(h.saved.count).toBeGreaterThanOrEqual(1);
    expect(h.settings.authMethod).toBe("oauth");
    expect(h.settings.oauth?.cloudId).toBe("cloud-1");
  });

  it("on Atlassian error: rejects beginConnect promise", async () => {
    const h = makeHarness();
    const beginP = h.flow.beginConnect();
    await waitFor(() => h.opened.length > 0);
    const state = new URL(h.opened[0]).searchParams.get("state")!;
    // handleCallback now re-throws after rejecting the in-flight promise so
    // the protocol handler can show a Notice. Swallow the throw here; the
    // beginConnect promise should still see the rejection.
    await h.flow.handleCallback({
      state,
      error: "access_denied",
      error_description: "user cancelled",
    }).catch(() => undefined);
    await expect(beginP).rejects.toThrow(/access_denied/);
  });

  it("on missing code: rejects beginConnect promise", async () => {
    const h = makeHarness();
    const beginP = h.flow.beginConnect();
    await waitFor(() => h.opened.length > 0);
    const state = new URL(h.opened[0]).searchParams.get("state")!;
    await h.flow.handleCallback({ state }).catch(() => undefined);
    await expect(beginP).rejects.toThrow(/code/i);
  });

  it("on no accessible Jira sites: rejects", async () => {
    const http = jest.fn(async () => ({
      status: 200,
      json: {
        access_token: "AT",
        refresh_token: "RT",
        expires_in: 3600,
        token_type: "Bearer",
      },
      text: "",
    }));
    const h = makeHarness({ http, sites: [] });
    const beginP = h.flow.beginConnect();
    await waitFor(() => h.opened.length > 0);
    const state = new URL(h.opened[0]).searchParams.get("state")!;
    await h.flow.handleCallback({ state, code: "CODE" }).catch(() => undefined);
    await expect(beginP).rejects.toThrow(/No accessible Jira sites/);
  });
});

describe("OAuthFlow.refresh", () => {
  it("posts refresh grant, rotates the refresh_token in SecretStorage", async () => {
    const http = jest.fn(async () => ({
      status: 200,
      json: {
        access_token: "AT2",
        refresh_token: "RT2",
        expires_in: 7200,
        token_type: "Bearer",
      },
      text: "",
    }));
    const h = makeHarness({ http });
    // Seed an existing OAuth state and prior tokens in SecretStorage.
    h.settings.authMethod = "oauth";
    h.settings.oauth = {
      accessTokenSecretName: INTERNAL_SECRETS.oauthAccessToken,
      refreshTokenSecretName: INTERNAL_SECRETS.oauthRefreshToken,
      expiresAt: Date.now() - 1000,
      cloudId: "c",
      siteUrl: "https://x.atlassian.net",
      siteName: "X",
    };
    h.secretsMap.set(INTERNAL_SECRETS.oauthAccessToken, "AT1");
    h.secretsMap.set(INTERNAL_SECRETS.oauthRefreshToken, "RT1");

    await h.flow.refresh(h.settings);

    // SecretStorage rotated.
    expect(h.secretsMap.get(INTERNAL_SECRETS.oauthAccessToken)).toBe("AT2");
    expect(h.secretsMap.get(INTERNAL_SECRETS.oauthRefreshToken)).toBe("RT2");
    expect(h.settings.oauth.expiresAt).toBeGreaterThan(Date.now());
  });

  it("throws when there's no oauth state to refresh", async () => {
    const h = makeHarness();
    await expect(h.flow.refresh(h.settings)).rejects.toThrow();
  });

  it("throws when the refresh token is missing from secret storage", async () => {
    const h = makeHarness();
    h.settings.authMethod = "oauth";
    h.settings.oauth = {
      accessTokenSecretName: INTERNAL_SECRETS.oauthAccessToken,
      refreshTokenSecretName: INTERNAL_SECRETS.oauthRefreshToken,
      expiresAt: Date.now() - 1000,
      cloudId: "c",
      siteUrl: "https://x.atlassian.net",
      siteName: "X",
    };
    // Note: no entry written to h.secretsMap, so .get() returns null.
    await expect(h.flow.refresh(h.settings)).rejects.toThrow(/missing/i);
  });
});

describe("OAuthFlow.cancelAll", () => {
  it("rejects in-flight beginConnect promises", async () => {
    const h = makeHarness();
    const beginP = h.flow.beginConnect();
    await waitFor(() => h.opened.length > 0);
    h.flow.cancelAll("teardown");
    await expect(beginP).rejects.toThrow(/teardown/);
    expect(h.flow.pendingCount()).toBe(0);
  });
});

describe("OAuthFlow.isAccessTokenNearExpiry", () => {
  it("returns true within the leeway window", () => {
    const now = 1_000_000_000_000;
    expect(
      OAuthFlow.isAccessTokenNearExpiry(
        {
          accessTokenSecretName: "a",
          refreshTokenSecretName: "r",
          expiresAt: now + 30_000, // 30s remaining
          cloudId: "c",
          siteUrl: "s",
          siteName: "n",
        },
        now,
      ),
    ).toBe(true);
  });

  it("returns false when far from expiry", () => {
    const now = 1_000_000_000_000;
    expect(
      OAuthFlow.isAccessTokenNearExpiry(
        {
          accessTokenSecretName: "a",
          refreshTokenSecretName: "r",
          expiresAt: now + 60 * 60_000,
          cloudId: "c",
          siteUrl: "s",
          siteName: "n",
        },
        now,
      ),
    ).toBe(false);
  });
});
