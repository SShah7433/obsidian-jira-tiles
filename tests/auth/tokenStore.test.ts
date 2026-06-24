/**
 * Tests for src/auth/tokenStore.ts — the OAuthFlow orchestrator.
 */

import { OAuthFlow } from "../../src/auth/tokenStore";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";
import type { PluginSettings } from "../../src/settings/types";
import type { JiraClient } from "../../src/jira/client";
import type { AccessibleResource } from "../../src/jira/types";

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

  const flow = new OAuthFlow({
    openExternal: (url) => opened.push(url),
    http: http,
    getSettings: () => settings,
    saveSettings: async () => {
      saved.count++;
    },
    client,
  });

  return { settings, saved, opened, http, client, flow };
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
  it("ignores unknown state silently", async () => {
    const h = makeHarness();
    await h.flow.handleCallback({ state: "nope", code: "x" });
    expect(h.saved.count).toBe(0);
  });

  it("on success: exchanges code, discovers cloudId, persists, resolves", async () => {
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

    expect(result.accessToken).toBe("AT");
    expect(result.refreshToken).toBe("RT");
    expect(result.cloudId).toBe("cloud-1");
    expect(result.siteUrl).toBe("https://acme.atlassian.net");
    expect(h.saved.count).toBeGreaterThanOrEqual(1);
    expect(h.settings.authMethod).toBe("oauth");
    expect(h.settings.oauth?.cloudId).toBe("cloud-1");
  });

  it("on Atlassian error: rejects beginConnect promise", async () => {
    const h = makeHarness();
    const beginP = h.flow.beginConnect();
    await waitFor(() => h.opened.length > 0);
    const state = new URL(h.opened[0]).searchParams.get("state")!;
    await h.flow.handleCallback({
      state,
      error: "access_denied",
      error_description: "user cancelled",
    });
    await expect(beginP).rejects.toThrow(/access_denied/);
  });

  it("on missing code: rejects beginConnect promise", async () => {
    const h = makeHarness();
    const beginP = h.flow.beginConnect();
    await waitFor(() => h.opened.length > 0);
    const state = new URL(h.opened[0]).searchParams.get("state")!;
    await h.flow.handleCallback({ state });
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
    await h.flow.handleCallback({ state, code: "CODE" });
    await expect(beginP).rejects.toThrow(/No accessible Jira sites/);
  });
});

describe("OAuthFlow.refresh", () => {
  it("posts refresh grant and rotates the refresh_token in settings", async () => {
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
    h.settings.authMethod = "oauth";
    h.settings.oauth = {
      accessToken: "AT1",
      refreshToken: "RT1",
      expiresAt: Date.now() - 1000,
      cloudId: "c",
      siteUrl: "https://x.atlassian.net",
      siteName: "X",
    };
    await h.flow.refresh(h.settings);
    expect(h.settings.oauth.accessToken).toBe("AT2");
    expect(h.settings.oauth.refreshToken).toBe("RT2");
    expect(h.settings.oauth.expiresAt).toBeGreaterThan(Date.now());
  });

  it("throws when there's no oauth state to refresh", async () => {
    const h = makeHarness();
    await expect(h.flow.refresh(h.settings)).rejects.toThrow();
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
          accessToken: "a",
          refreshToken: "r",
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
          accessToken: "a",
          refreshToken: "r",
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
