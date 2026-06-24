/**
 * Tests for src/jira/client.ts
 */

import { JiraClient } from "../../src/jira/client";
import { AuthManager } from "../../src/auth/authManager";
import { JiraApiError } from "../../src/jira/types";
import type { PluginSettings } from "../../src/settings/types";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";

function makeAuthMgr(over: Partial<PluginSettings> = {}): AuthManager {
  let s: PluginSettings = {
    ...DEFAULT_SETTINGS,
    authMethod: "apiToken",
    apiToken: {
      siteUrl: "https://acme.atlassian.net",
      email: "a@b.com",
      token: "T",
    },
    ...over,
  };
  return new AuthManager(
    () => s,
    async () => {},
    null,
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
    let s: PluginSettings = {
      ...DEFAULT_SETTINGS,
      authMethod: "oauth",
      oauth: {
        accessToken: "TOK",
        refreshToken: "RT",
        expiresAt: Date.now() + 60 * 60_000,
        cloudId: "cid",
        siteUrl: "https://acme.atlassian.net",
        siteName: "Acme",
      },
    };
    const mgr = new AuthManager(
      () => s,
      async () => {},
      async () => {
        // pretend we got a fresh token
        s = {
          ...s,
          oauth: { ...s.oauth!, accessToken: "TOK2", expiresAt: Date.now() + 3600_000 },
        };
      },
    );
    let attempts = 0;
    const client = new JiraClient({
      authManager: mgr,
      request: async (p) => {
        attempts++;
        if (attempts === 1) {
          return { status: 401, headers: {}, text: "", json: {} };
        }
        // verify the second attempt uses the refreshed token
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
        accessToken: "TOK",
        refreshToken: "RT",
        expiresAt: Date.now() + 3600_000,
        cloudId: "abc-123",
        siteUrl: "https://acme.atlassian.net",
        siteName: "Acme",
      },
    };
    const mgr = new AuthManager(() => s, async () => {}, async () => {});
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
