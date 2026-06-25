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
  const s: PluginSettings = {
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
  return new AuthManager(() => s, secrets);
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

  it("maps 401 directly to JiraApiError with no retry (API token has no recovery)", async () => {
    let attempts = 0;
    const client = new JiraClient({
      authManager: makeAuthMgr(),
      request: async () => {
        attempts++;
        return { status: 401, headers: {}, text: "", json: {} };
      },
    });
    await expect(client.getIssue("PROJ-1")).rejects.toMatchObject({ status: 401 });
    expect(attempts).toBe(1);
  });

  it("targets the configured site URL", async () => {
    let captured = "";
    const client = new JiraClient({
      authManager: makeAuthMgr(),
      request: async (p) => {
        captured = p.url;
        return { status: 200, headers: {}, text: "{}", json: { key: "PROJ-1", fields: {} } };
      },
    });
    await client.getIssue("PROJ-1");
    expect(captured.startsWith("https://acme.atlassian.net/rest/api/3/issue/PROJ-1")).toBe(true);
  });
});
