/**
 * Tests for src/render/codeBlockProcessor.ts
 */

import {
  buildCodeBlockProcessor,
  buildIssueUrl,
  fieldsForRequest,
} from "../../src/render/codeBlockProcessor";
import { IssueCache } from "../../src/cache/issueCache";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";
import { DEFAULT_ISSUE_FIELDS } from "../../src/constants";
import type { JiraIssue } from "../../src/jira/types";
import type { JiraClient } from "../../src/jira/client";

function makeFakeClient(issue: JiraIssue): JiraClient {
  return {
    getIssue: async () => issue,
    getFields: async () => [],
    getAccessibleResources: async () => [],
  } as unknown as JiraClient;
}

describe("buildIssueUrl", () => {
  it("uses the API token site when authMethod=apiToken", () => {
    const s = {
      ...DEFAULT_SETTINGS,
      authMethod: "apiToken" as const,
      apiToken: { siteUrl: "https://acme.atlassian.net", email: "a@b.com", token: "x" },
    };
    expect(buildIssueUrl("PROJ-1", s)).toBe(
      "https://acme.atlassian.net/browse/PROJ-1",
    );
  });

  it("uses the OAuth site when authMethod=oauth", () => {
    const s = {
      ...DEFAULT_SETTINGS,
      authMethod: "oauth" as const,
      oauth: {
        accessToken: "T",
        refreshToken: "R",
        expiresAt: Date.now() + 3600_000,
        cloudId: "cid",
        siteUrl: "https://acme.atlassian.net",
        siteName: "Acme",
      },
    };
    expect(buildIssueUrl("PROJ-1", s)).toBe(
      "https://acme.atlassian.net/browse/PROJ-1",
    );
  });

  it("returns a placeholder URL when no auth is configured", () => {
    expect(buildIssueUrl("PROJ-1", DEFAULT_SETTINGS)).toMatch(/your-site/);
  });

  it("URL-encodes the issue key", () => {
    const s = {
      ...DEFAULT_SETTINGS,
      authMethod: "apiToken" as const,
      apiToken: { siteUrl: "https://x.atlassian.net", email: "a@b.com", token: "x" },
    };
    expect(buildIssueUrl("WEIRD/KEY", s)).toBe(
      "https://x.atlassian.net/browse/WEIRD%2FKEY",
    );
  });
});

describe("fieldsForRequest", () => {
  it("returns the default field set when no custom fields configured", () => {
    const got = fieldsForRequest(DEFAULT_SETTINGS);
    for (const f of DEFAULT_ISSUE_FIELDS) {
      expect(got).toContain(f);
    }
  });

  it("includes enabled custom fields", () => {
    const got = fieldsForRequest({
      ...DEFAULT_SETTINGS,
      customFields: [
        { id: "customfield_10020", label: "Sprint", enabled: true },
        { id: "customfield_10016", label: "SP", enabled: false },
        { id: "", label: "blank id", enabled: true },
      ],
    });
    expect(got).toContain("customfield_10020");
    expect(got).not.toContain("customfield_10016");
  });
});

describe("buildCodeBlockProcessor", () => {
  it("renders an invalid-block tile for malformed input", () => {
    const cache = new IssueCache(() => 60_000);
    const proc = buildCodeBlockProcessor({
      client: makeFakeClient({ key: "PROJ-1", fields: { summary: "x" } }),
      cache,
      getSettings: () => DEFAULT_SETTINGS,
    });
    const el = document.createElement("div");
    proc("garbage", el, {} as never);
    expect(el.querySelector(".jira-tile--error")).not.toBeNull();
    expect(el.textContent).toContain("Invalid Jira block");
  });

  it("invokes the client and renders a tile for a valid key", async () => {
    const cache = new IssueCache(() => 60_000);
    let getCount = 0;
    const proc = buildCodeBlockProcessor({
      client: {
        getIssue: async () => {
          getCount++;
          return { key: "PROJ-1", fields: { summary: "Tested" } } as JiraIssue;
        },
        getFields: async () => [],
        getAccessibleResources: async () => [],
      } as unknown as JiraClient,
      cache,
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        authMethod: "apiToken" as const,
        apiToken: {
          siteUrl: "https://example.atlassian.net",
          email: "a@b.com",
          token: "x",
        },
      }),
    });
    const el = document.createElement("div");
    proc("PROJ-1", el, {} as never);
    // renderInto runs async; flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(getCount).toBe(1);
    expect(el.textContent).toContain("Tested");
  });

  it("uses cache on the second call within TTL", async () => {
    const cache = new IssueCache(() => 60_000);
    let getCount = 0;
    const proc = buildCodeBlockProcessor({
      client: {
        getIssue: async () => {
          getCount++;
          return { key: "PROJ-1", fields: { summary: "Cached" } } as JiraIssue;
        },
        getFields: async () => [],
        getAccessibleResources: async () => [],
      } as unknown as JiraClient,
      cache,
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        authMethod: "apiToken" as const,
        apiToken: {
          siteUrl: "https://example.atlassian.net",
          email: "a@b.com",
          token: "x",
        },
      }),
    });
    proc("PROJ-1", document.createElement("div"), {} as never);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    proc("PROJ-1", document.createElement("div"), {} as never);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(getCount).toBe(1);
  });
});
