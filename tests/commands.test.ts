/**
 * Tests for src/commands.ts
 */

import {
  buildCommands,
  clearCacheCommand,
  extractIssueKeysFromMarkdown,
  refreshAllCommand,
  refreshCurrentNote,
} from "../src/commands";
import { IssueCache } from "../src/cache/issueCache";
import type { App, Editor, MarkdownView } from "obsidian";

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

  it("extracts every key from a multi-key block, ignoring flags", () => {
    const md = ["```jira", "ABC-1", "ABC-2 !compact", "ABC-3 !full", "```"].join(
      "\n",
    );
    expect(extractIssueKeysFromMarkdown(md).sort()).toEqual([
      "ABC-1",
      "ABC-2",
      "ABC-3",
    ]);
  });

  it("skips invalid lines in a multi-key block but keeps valid ones", () => {
    const md = ["```jira", "ABC-1", "garbage", "ABC-2"].join("\n") + "\n```";
    expect(extractIssueKeysFromMarkdown(md).sort()).toEqual(["ABC-1", "ABC-2"]);
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
      // Each command exposes exactly one of callback / editorCheckCallback.
      const hasCallback = typeof c.callback === "function";
      const hasEditorCb = typeof c.editorCheckCallback === "function";
      expect(hasCallback || hasEditorCb).toBe(true);
      expect(c.name.length).toBeGreaterThan(0);
      // Command names must not repeat the plugin name (Obsidian prefixes it).
      expect(c.name.toLowerCase()).not.toContain("jira tiles");
    }
  });

  it("uses editorCheckCallback for the editor-dependent commands", () => {
    const cache = new IssueCache(() => 60_000);
    const cmds = buildCommands({ app: fakeApp(), cache });
    const insert = cmds.find((c) => c.id === "insert-issue-tile");
    const refreshNote = cmds.find((c) => c.id === "refresh-tiles-current-note");
    expect(typeof insert?.editorCheckCallback).toBe("function");
    expect(typeof refreshNote?.editorCheckCallback).toBe("function");
    // In `checking` mode they report availability without side effects.
    expect(insert?.editorCheckCallback?.(true, {} as never, {} as never)).toBe(true);
    expect(refreshNote?.editorCheckCallback?.(true, {} as never, {} as never)).toBe(true);
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

describe("refreshCurrentNote", () => {
  function fakeEditor(value: string): Editor {
    return { getValue: () => value } as unknown as Editor;
  }

  it("invalidates cached entries for keys found in the note and rebuilds the view", async () => {
    const cache = new IssueCache(() => 60_000);
    await cache.getOrFetch("PROJ-1", async () => ({ key: "PROJ-1", fields: {} }));
    await cache.getOrFetch("PROJ-2", async () => ({ key: "PROJ-2", fields: {} }));
    expect(cache.size()).toBe(2);

    let rebuilt = false;
    const view = {
      leaf: { rebuildView: () => (rebuilt = true) },
    } as unknown as MarkdownView;

    refreshCurrentNote(
      { app: {} as App, cache },
      fakeEditor("```jira\nPROJ-1\n```\n```jira\nPROJ-2\n```"),
      view,
    );

    expect(cache.size()).toBe(0);
    expect(rebuilt).toBe(true);
  });

  it("does nothing harmful when the note has no jira blocks", () => {
    const cache = new IssueCache(() => 60_000);
    const view = { leaf: {} } as unknown as MarkdownView;
    expect(() =>
      refreshCurrentNote({ app: {} as App, cache }, fakeEditor("no blocks"), view),
    ).not.toThrow();
  });
});

describe("insert command editorCheckCallback", () => {
  function fakeApp(): App {
    return {
      workspace: {
        getActiveViewOfType: () => null,
        on: () => ({}),
        off: () => undefined,
      },
    } as unknown as App;
  }

  it("reports availability in checking mode without inserting", () => {
    const cache = new IssueCache(() => 60_000);
    const insert = buildCommands({ app: fakeApp(), cache }).find(
      (c) => c.id === "insert-issue-tile",
    );
    let replaced = false;
    const editor = {
      replaceSelection: () => (replaced = true),
    } as unknown as Editor;
    const result = insert?.editorCheckCallback?.(true, editor, {} as never);
    expect(result).toBe(true);
    expect(replaced).toBe(false);
  });
});
