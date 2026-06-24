/**
 * Tests for src/commands.ts
 */

import {
  buildCommands,
  clearCacheCommand,
  extractIssueKeysFromMarkdown,
  refreshAllCommand,
} from "../src/commands";
import { IssueCache } from "../src/cache/issueCache";
import type { App } from "obsidian";

describe("extractIssueKeysFromMarkdown", () => {
  it("returns an empty list when there are no jira blocks", () => {
    expect(extractIssueKeysFromMarkdown("Hello world")).toEqual([]);
  });

  it("extracts a single key from a single block", () => {
    const md = "before\n```jira\nPROJ-123\n```\nafter";
    expect(extractIssueKeysFromMarkdown(md)).toEqual(["PROJ-123"]);
  });

  it("extracts multiple keys from multiple blocks, deduplicated", () => {
    const md = [
      "```jira",
      "PROJ-1",
      "```",
      "",
      "```jira",
      "PROJ-2",
      "```",
      "",
      "```jira",
      "PROJ-1",
      "```",
    ].join("\n");
    expect(extractIssueKeysFromMarkdown(md).sort()).toEqual(["PROJ-1", "PROJ-2"]);
  });

  it("understands the kv form", () => {
    const md = "```jira\nkey: PROJ-9\ncompact: true\n```";
    expect(extractIssueKeysFromMarkdown(md)).toEqual(["PROJ-9"]);
  });

  it("ignores blocks with malformed keys", () => {
    const md = "```jira\nnot-a-key\n```";
    expect(extractIssueKeysFromMarkdown(md)).toEqual([]);
  });

  it("uppercases keys", () => {
    const md = "```jira\nproj-1\n```";
    expect(extractIssueKeysFromMarkdown(md)).toEqual(["PROJ-1"]);
  });
});

describe("buildCommands", () => {
  function fakeApp(): App {
    return {
      workspace: {
        getActiveFile: () => null,
        getActiveViewOfType: () => null,
        on: () => ({}),
        off: () => undefined,
      },
    } as unknown as App;
  }

  it("returns the canonical four commands", () => {
    const cache = new IssueCache(() => 60_000);
    const cmds = buildCommands({ app: fakeApp(), cache });
    expect(cmds.map((c) => c.id)).toEqual([
      "insert-issue-tile",
      "refresh-tiles-current-note",
      "refresh-all-tiles",
      "clear-cache",
    ]);
    for (const c of cmds) {
      expect(typeof c.callback).toBe("function");
      expect(c.name.length).toBeGreaterThan(0);
    }
  });
});

describe("refreshAllCommand", () => {
  it("invalidates the entire cache", async () => {
    const cache = new IssueCache(() => 60_000);
    await cache.getOrFetch("PROJ-1", async () => ({ key: "PROJ-1", fields: {} }));
    expect(cache.size()).toBe(1);
    refreshAllCommand({ app: {} as App, cache });
    expect(cache.size()).toBe(0);
  });
});

describe("clearCacheCommand", () => {
  it("invalidates the entire cache", async () => {
    const cache = new IssueCache(() => 60_000);
    await cache.getOrFetch("PROJ-1", async () => ({ key: "PROJ-1", fields: {} }));
    clearCacheCommand({ app: {} as App, cache });
    expect(cache.size()).toBe(0);
  });
});
