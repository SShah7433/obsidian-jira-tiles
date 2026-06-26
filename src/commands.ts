/**
 * Command palette commands.
 *
 * Registered from `main.ts` during onload. `buildCommands` returns plain
 * descriptors so the wiring can be unit-tested without a full plugin
 * instance. Commands that need an editor use `editorCheckCallback` per the
 * Obsidian guidelines.
 */

import { type App, type Editor, type MarkdownFileInfo, type MarkdownView, Notice } from "obsidian";
import type { IssueCache } from "./cache/issueCache";
import { ISSUE_KEY_PATTERN } from "./render/parseBlock";
import { IssueKeyModal } from "./settings/IssueKeyModal";

/** Minimal slice of the plugin object the commands need. */
export interface CommandsContext {
  app: App;
  cache: IssueCache;
}

/**
 * Command descriptor. Either a plain `callback` (runs unconditionally) or an
 * `editorCheckCallback` (runs only with an active Markdown editor), matching
 * Obsidian's `Plugin.addCommand` shape.
 */
export interface CommandDescriptor {
  id: string;
  name: string;
  callback?: () => void | Promise<void>;
  editorCheckCallback?: (
    checking: boolean,
    editor: Editor,
    ctx: MarkdownView | MarkdownFileInfo,
  ) => boolean | void;
}

/** Build the canonical command list. */
export function buildCommands(cmdCtx: CommandsContext): CommandDescriptor[] {
  return [
    {
      id: "insert-issue-tile",
      name: "Insert issue tile",
      editorCheckCallback: (checking, editor) => {
        if (checking) return true;
        promptForKey(cmdCtx.app, (key) => {
          editor.replaceSelection(`\n\`\`\`jira\n${key}\n\`\`\`\n`);
        });
        return true;
      },
    },
    {
      id: "refresh-tiles-current-note",
      name: "Refresh tiles in current note",
      editorCheckCallback: (checking, editor, viewCtx) => {
        if (checking) return true;
        refreshCurrentNote(cmdCtx, editor, viewCtx);
        return true;
      },
    },
    {
      id: "refresh-all-tiles",
      name: "Refresh all tiles",
      callback: () => refreshAllCommand(cmdCtx),
    },
    {
      id: "clear-cache",
      name: "Clear cache",
      callback: () => clearCacheCommand(cmdCtx),
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Command implementations                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Prompt for an issue key using a small modal (works on desktop and mobile,
 * unlike `window.prompt`). Calls `onSubmit` with a validated, uppercased key.
 */
export function promptForKey(
  app: App,
  onSubmit: (key: string) => void,
): void {
  new IssueKeyModal(app, onSubmit).open();
}

/**
 * Refresh tiles in the active note by invalidating their cache entries and
 * asking Obsidian to rebuild the leaf so the code-block processor re-runs.
 */
export function refreshCurrentNote(
  cmdCtx: CommandsContext,
  editor: Editor,
  viewCtx: MarkdownView | MarkdownFileInfo,
): void {
  const text = editor.getValue();
  const keys = extractIssueKeysFromMarkdown(text);
  for (const key of keys) cmdCtx.cache.invalidate(key);
  // `rebuildView` re-runs Markdown post-processors. It's available on
  // WorkspaceLeaf at runtime; guard defensively in case it's absent.
  const leaf = (viewCtx as unknown as { leaf?: { rebuildView?: () => void } })
    .leaf;
  leaf?.rebuildView?.();
  new Notice(
    keys.length === 0
      ? "No Jira blocks found in this note."
      : `Refreshed ${keys.length} tile${keys.length === 1 ? "" : "s"}.`,
  );
}

/** Invalidate the entire cache. */
export function refreshAllCommand(ctx: CommandsContext): void {
  ctx.cache.invalidate();
  new Notice("Jira tile cache cleared. Tiles will refresh on next render.");
}

/** Invalidate the entire cache (palette alias). */
export function clearCacheCommand(ctx: CommandsContext): void {
  ctx.cache.invalidate();
  new Notice("Jira cache cleared.");
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Walk a Markdown source string and pull out issue keys from any `\`\`\`jira`
 * fenced blocks. Used by the "refresh tiles in current note" command.
 *
 * Handles both block forms:
 *   - terse: one `KEY [flags]` per line (a block may list several issues);
 *   - KV: a single `key: VALUE` line.
 * Flags (e.g. `!compact`) and comment/blank lines are ignored, and invalid
 * lines are skipped so a typo never aborts the refresh.
 *
 * Exported for testing.
 */
export function extractIssueKeysFromMarkdown(source: string): string[] {
  const keys = new Set<string>();
  const blockRe = /```jira\b\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(source)) !== null) {
    const body = m[1];
    const lines = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    // KV form: a single `key:` value describes one issue.
    const kv = lines.find((l) => /^key\s*:/i.test(l));
    if (kv) {
      const candidate = kv.replace(/^key\s*:\s*/i, "").trim().toUpperCase();
      if (ISSUE_KEY_PATTERN.test(candidate)) keys.add(candidate);
      continue;
    }

    // Terse form: each line is `KEY [flags...]`; take the first token.
    for (const line of lines) {
      const candidate = (line.split(/\s+/)[0] ?? "").toUpperCase();
      if (ISSUE_KEY_PATTERN.test(candidate)) keys.add(candidate);
    }
  }
  return Array.from(keys);
}
