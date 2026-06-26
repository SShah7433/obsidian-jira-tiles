/**
 * Tests for src/render/codeBlockProcessor.ts
 */

import {
  buildCodeBlockProcessor,
  buildIssueUrl,
  fieldsForRequest,
  resolveCompact,
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
  } as unknown as JiraClient;
}

describe("buildIssueUrl", () => {
  it("uses the API token site when authMethod=apiToken", () => {
    const s = {
      ...DEFAULT_SETTINGS,
      authMethod: "apiToken" as const,
      apiToken: {
        siteUrl: "https://acme.atlassian.net",
        email: "a@b.com",
        tokenSecretName: "jira-tiles:api-token",
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
      apiToken: {
        siteUrl: "https://x.atlassian.net",
        email: "a@b.com",
        tokenSecretName: "jira-tiles:api-token",
      },
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

describe("resolveCompact", () => {
  it("uses the per-tile preference when set", () => {
    expect(resolveCompact(true, { ...DEFAULT_SETTINGS, defaultCompact: false })).toBe(true);
    expect(resolveCompact(false, { ...DEFAULT_SETTINGS, defaultCompact: true })).toBe(false);
  });

  it("falls back to defaultCompact when no per-tile preference", () => {
    expect(resolveCompact(undefined, { ...DEFAULT_SETTINGS, defaultCompact: true })).toBe(true);
    expect(resolveCompact(undefined, { ...DEFAULT_SETTINGS, defaultCompact: false })).toBe(false);
  });
});

describe("buildCodeBlockProcessor — compact resolution", () => {
  function makeProc(defaultCompact: boolean) {
    const cache = new IssueCache(() => 60_000);
    return buildCodeBlockProcessor({
      client: {
        getIssue: async () =>
          ({ key: "PROJ-1", fields: { summary: "Tested" } }) as JiraIssue,
        getFields: async () => [],
      } as unknown as JiraClient,
      cache,
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        defaultCompact,
        authMethod: "apiToken" as const,
        apiToken: {
          siteUrl: "https://example.atlassian.net",
          email: "a@b.com",
          tokenSecretName: "jira-tiles:api-token",
        },
      }),
    });
  }

  async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it("renders compact when defaultCompact is on and no flag given", async () => {
    const el = document.createElement("div");
    makeProc(true)("PROJ-1", el, {} as never);
    await flush();
    expect(el.querySelector(".jira-tile--compact")).not.toBeNull();
  });

  it("renders full when defaultCompact is off and no flag given", async () => {
    const el = document.createElement("div");
    makeProc(false)("PROJ-1", el, {} as never);
    await flush();
    expect(el.querySelector(".jira-tile--compact")).toBeNull();
    expect(el.textContent).toContain("Tested");
  });

  it("`!compact` forces compact even when default is off", async () => {
    const el = document.createElement("div");
    makeProc(false)("PROJ-1 !compact", el, {} as never);
    await flush();
    expect(el.querySelector(".jira-tile--compact")).not.toBeNull();
  });

  it("`!full` forces full even when default is on", async () => {
    const el = document.createElement("div");
    makeProc(true)("PROJ-1 !full", el, {} as never);
    await flush();
    expect(el.querySelector(".jira-tile--compact")).toBeNull();
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
      } as unknown as JiraClient,
      cache,
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        authMethod: "apiToken" as const,
        apiToken: {
          siteUrl: "https://example.atlassian.net",
          email: "a@b.com",
          tokenSecretName: "jira-tiles:api-token",
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

  it("renders one tile per line for a multi-key block", async () => {
    const cache = new IssueCache(() => 60_000);
    const seen: string[] = [];
    const proc = buildCodeBlockProcessor({
      client: {
        getIssue: async (key: string) => {
          seen.push(key);
          return { key, fields: { summary: `S ${key}` } } as JiraIssue;
        },
        getFields: async () => [],
      } as unknown as JiraClient,
      cache,
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        defaultCompact: false,
        authMethod: "apiToken" as const,
        apiToken: {
          siteUrl: "https://example.atlassian.net",
          email: "a@b.com",
          tokenSecretName: "jira-tiles:api-token",
        },
      }),
    });
    const el = document.createElement("div");
    proc("ABC-1\nABC-2 !compact\nABC-3 !full", el, {} as never);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    const items = el.querySelectorAll(".jira-tile-multi-item");
    expect(items.length).toBe(3);
    expect(seen).toEqual(["ABC-1", "ABC-2", "ABC-3"]);
    // ABC-2 forced compact, ABC-3 forced full, ABC-1 inherits default (full).
    expect(items[0].querySelector(".jira-tile--compact")).toBeNull();
    expect(items[1].querySelector(".jira-tile--compact")).not.toBeNull();
    expect(items[2].querySelector(".jira-tile--compact")).toBeNull();
    expect(el.textContent).toContain("S ABC-1");
    expect(el.textContent).toContain("S ABC-3");
  });

  it("does not wrap a single-key block in a multi-item host", async () => {
    const cache = new IssueCache(() => 60_000);
    const proc = buildCodeBlockProcessor({
      client: {
        getIssue: async () =>
          ({ key: "ABC-1", fields: { summary: "Solo" } }) as JiraIssue,
        getFields: async () => [],
      } as unknown as JiraClient,
      cache,
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        authMethod: "apiToken" as const,
        apiToken: {
          siteUrl: "https://example.atlassian.net",
          email: "a@b.com",
          tokenSecretName: "jira-tiles:api-token",
        },
      }),
    });
    const el = document.createElement("div");
    proc("ABC-1", el, {} as never);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(el.querySelectorAll(".jira-tile-multi-item").length).toBe(0);
    // Single-key: the block element itself becomes the tile container.
    expect(el.classList.contains("jira-tile-container")).toBe(true);
    expect(el.querySelector(".jira-tile")).not.toBeNull();
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
      } as unknown as JiraClient,
      cache,
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        authMethod: "apiToken" as const,
        apiToken: {
          siteUrl: "https://example.atlassian.net",
          email: "a@b.com",
          tokenSecretName: "jira-tiles:api-token",
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
