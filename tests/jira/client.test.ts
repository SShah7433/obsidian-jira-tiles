/**
 * Tests for src/jira/client.ts
 */

import { JiraClient } from "../../src/jira/client";
import { AuthManager } from "../../src/auth/authManager";
import { JiraApiError } from "../../src/jira/types";
import type { PluginSettings } from "../../src/settings/types";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";
import type { SecretsService } from "../../src/auth/secrets";

/**
 * Build a SecretsService stand-in that resolves a fixed map. The AuthManager
 * only calls .get(), so the rest of the surface is unused.
 */
function fakeSecrets(values: Record<string, string>): SecretsService {
  const memory = new Map(Object.entries(values));
  return {
    backend: "secret-storage",
    isAvailable: true,
    get: async (name: string | undefined | null) =>
      name ? memory.get(name) ?? null : null,
    set: async (n: string, v: string) => {
      memory.set(n, v);
    },
    remove: async (n: string | undefined | null) => {
      if (n) memory.delete(n);
    },
  } as unknown as SecretsService;
}

function makeAuthMgr(over: Partial<PluginSettings> = {}): AuthManager {
  let s: PluginSettings = {
    ...DEFAULT_SETTINGS,
    authMethod: "apiToken",
    apiToken: {
      siteUrl: "https://acme.atlassian.net",
      email: "a@b.com",
      tokenSecretName: "jira-tiles:api-token",
    },
    ...over,
  };
  const secrets = fakeSecrets({ "jira-tiles:api-token": "T" });
  return new AuthManager(
    () => s,
    async () => {},
    null,
    secrets,
  );
}

describe("JiraClient.getIssue", () => {
  it("issues GET to the correct path with default fields", async () => {
    const calls: { url: string; method?: string; headers?: Record<string, string> }[] = [];
    const client = new JiraClient({
      authManager: makeAuthMgr(),
      request: async (p) => {
        calls.push({ url: p.url, method: p.method, headers: p.headers });
        return {
          status: 200,
          headers: {},
          text: "{}",
          json: { id: "1", key: "PROJ-1", fields: { summary: "x" } },
        };
      },
    });
    const issue = await client.getIssue("PROJ-1");
    expect(issue.key).toBe("PROJ-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("/rest/api/3/issue/PROJ-1");
    expect(calls[0].url).toContain("fields=summary,status,priority");
    expect(calls[0].headers?.Authorization).toMatch(/^Basic /);
  });

  it("URL-encodes issue keys", async () => {
    const calls: string[] = [];
    const client = new JiraClient({
      authManager: makeAuthMgr(),
      request: async (p) => {
        calls.push(p.url);
        return { status: 200, headers: {}, text: "{}", json: { key: "X-1", fields: {} } };
      },
    });
    await client.getIssue("PROJ/1");
    expect(calls[0]).toContain("PROJ%2F1");
  });

  it("maps 404 to JiraApiError with friendly message", async () => {
    const client = new JiraClient({
      authManager: makeAuthMgr(),
      request: async () => ({ status: 404, headers: {}, text: "not found", json: {} }),
    });
    await expect(client.getIssue("PROJ-9999")).rejects.toBeInstanceOf(JiraApiError);
    await expect(client.getIssue("PROJ-9999")).rejects.toMatchObject({
      status: 404,
      message: expect.stringMatching(/not found/i),
    });
  });

  it("maps 401 with non-refreshable auth straight to JiraApiError", async () => {
    let attempts = 0;
    const client = new JiraClient({
      authManager: makeAuthMgr(),
      request: async () => {
        attempts++;
        return { status: 401, headers: {}, text: "", json: {} };
      },
    });
    await expect(client.getIssue("PROJ-1")).rejects.toMatchObject({ status: 401 });
    expect(attempts).toBe(1); // no retry for non-refreshable auth
  });

  it("retries once on 401 when auth is refreshable (OAuth)", async () => {
    const s: PluginSettings = {
      ...DEFAULT_SETTINGS,
      authMethod: "oauth",
      oauth: {
        accessTokenSecretName: "jira-tiles:oauth-access-token",
        refreshTokenSecretName: "jira-tiles:oauth-refresh-token",
        expiresAt: Date.now() + 60 * 60_000,
        cloudId: "cid",
        siteUrl: "https://acme.atlassian.net",
        siteName: "Acme",
      },
    };
    const secrets = fakeSecrets({
      "jira-tiles:oauth-access-token": "TOK",
    });
    const mgr = new AuthManager(
      () => s,
      async () => {},
      async () => {
        // Pretend we got a fresh token: swap the secret value.
        await secrets.set("jira-tiles:oauth-access-token", "TOK2");
        s.oauth!.expiresAt = Date.now() + 3600_000;
      },
      secrets,
    );
    let attempts = 0;
    const client = new JiraClient({
      authManager: mgr,
      request: async (p) => {
        attempts++;
        if (attempts === 1) {
          return { status: 401, headers: {}, text: "", json: {} };
        }
        // Verify the second attempt uses the refreshed token.
        expect(p.headers?.Authorization).toBe("Bearer TOK2");
        return { status: 200, headers: {}, text: "{}", json: { key: "PROJ-1", fields: {} } };
      },
    });
    const issue = await client.getIssue("PROJ-1");
    expect(issue.key).toBe("PROJ-1");
    expect(attempts).toBe(2);
  });

  it("uses api.atlassian.com proxy for OAuth", async () => {
    const s: PluginSettings = {
      ...DEFAULT_SETTINGS,
      authMethod: "oauth",
      oauth: {
        accessTokenSecretName: "jira-tiles:oauth-access-token",
        refreshTokenSecretName: "jira-tiles:oauth-refresh-token",
        expiresAt: Date.now() + 3600_000,
        cloudId: "abc-123",
        siteUrl: "https://acme.atlassian.net",
        siteName: "Acme",
      },
    };
    const secrets = fakeSecrets({
      "jira-tiles:oauth-access-token": "TOK",
    });
    const mgr = new AuthManager(
      () => s,
      async () => {},
      async () => {},
      secrets,
    );
    let captured = "";
    const client = new JiraClient({
      authManager: mgr,
      request: async (p) => {
        captured = p.url;
        return { status: 200, headers: {}, text: "{}", json: { key: "PROJ-1", fields: {} } };
      },
    });
    await client.getIssue("PROJ-1");
    expect(captured).toContain("https://api.atlassian.com/ex/jira/abc-123/rest/api/3/issue/PROJ-1");
  });
});

describe("JiraClient.getAccessibleResources", () => {
  it("calls accessible-resources with bearer token", async () => {
    let captured: { url?: string; headers?: Record<string, string> } = {};
    const client = new JiraClient({
      authManager: makeAuthMgr(),
      request: async (p) => {
        captured = { url: p.url, headers: p.headers };
        return {
          status: 200,
          headers: {},
          text: "[]",
          json: [{ id: "cid", url: "https://acme.atlassian.net", name: "Acme", scopes: [] }],
        };
      },
    });
    const res = await client.getAccessibleResources("ACCESS_TOKEN");
    expect(res).toHaveLength(1);
    expect(captured.url).toBe("https://api.atlassian.com/oauth/token/accessible-resources");
    expect(captured.headers?.Authorization).toBe("Bearer ACCESS_TOKEN");
  });
});
