/**
 * Command palette commands.
 *
 * Registered from `main.ts` during onload. Pure functions returning command
 * descriptors so they can be unit-tested without the full plugin instance.
 */

import { type App, MarkdownView, Notice } from "obsidian";
import type { IssueCache } from "./cache/issueCache";
import { ISSUE_KEY_PATTERN } from "./render/parseBlock";

/** Minimal slice of the plugin object the commands need. */
export interface CommandsContext {
  app: App;
  cache: IssueCache;
}

/** Single command descriptor matching Obsidian's `Plugin.addCommand` shape. */
export interface CommandDescriptor {
  id: string;
  name: string;
  callback: () => void | Promise<void>;
}

/** Build the canonical command list. */
export function buildCommands(ctx: CommandsContext): CommandDescriptor[] {
  return [
    {
      id: "insert-issue-tile",
      name: "Insert Jira issue tile",
      callback: () => insertTileCommand(ctx),
    },
    {
      id: "refresh-tiles-current-note",
      name: "Refresh Jira tiles in current note",
      callback: () => refreshCurrentNoteCommand(ctx),
    },
    {
      id: "refresh-all-tiles",
      name: "Refresh all Jira tiles (clear cache)",
      callback: () => refreshAllCommand(ctx),
    },
    {
      id: "clear-cache",
      name: "Clear Jira cache",
      callback: () => clearCacheCommand(ctx),
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Command implementations                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Insert a `\`\`\`jira PROJ-123 \`\`\`` block at the cursor position. Prompts
 * for the key via window.prompt — Obsidian doesn't expose a built-in inline
 * input, and a full Modal would be overkill for this single-field flow.
 */
export async function insertTileCommand(ctx: CommandsContext): Promise<void> {
  const view = ctx.app.workspace.getActiveViewOfType(MarkdownView);
  if (!view) {
    new Notice("Open a Markdown note first.");
    return;
  }
  const raw = window.prompt("Jira issue key (e.g. PROJ-123)?", "");
  if (raw === null) return; // cancelled
  const key = raw.trim().toUpperCase();
  if (!ISSUE_KEY_PATTERN.test(key)) {
    new Notice("Invalid issue key. Expected format: PROJ-123.");
    return;
  }
  const editor = view.editor;
  const block = `\n\`\`\`jira\n${key}\n\`\`\`\n`;
  editor.replaceSelection(block);
}

/**
 * Refresh tiles in the active note by invalidating their cache entries and
 * triggering a re-render. Obsidian's MarkdownPostProcessor does not directly
 * expose "re-run for current view", so we toggle the active leaf via
 * `workspace.activeLeaf.rebuildView()` if available, otherwise we ask the user
 * to click refresh on the affected tile.
 */
export async function refreshCurrentNoteCommand(
  ctx: CommandsContext,
): Promise<void> {
  const view = ctx.app.workspace.getActiveViewOfType(MarkdownView);
  if (!view) {
    new Notice("Open a Markdown note first.");
    return;
  }
  const text = view.editor.getValue();
  const keys = extractIssueKeysFromMarkdown(text);
  for (const key of keys) ctx.cache.invalidate(key);
  // Force a re-render by toggling the source/preview state.
  // (Obsidian re-runs the post processors when the leaf is rebuilt.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leaf = (view as any).leaf;
  if (leaf?.rebuildView) leaf.rebuildView();
  new Notice(
    keys.length === 0
      ? "No Jira blocks found in this note."
      : `Invalidated ${keys.length} tile${keys.length === 1 ? "" : "s"}.`,
  );
}

/** Invalidate the entire cache. */
export function refreshAllCommand(ctx: CommandsContext): void {
  ctx.cache.invalidate();
  new Notice("Jira tile cache cleared. Tiles will refresh on next render.");
}

/** Alias: same behavior as refreshAll for now. */
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
 * Exported for testing.
 */
export function extractIssueKeysFromMarkdown(source: string): string[] {
  const keys = new Set<string>();
  const blockRe = /```jira\b\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(source)) !== null) {
    const body = m[1];
    // First non-empty, non-comment line, or the value of `key:`.
    const lines = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    let candidate = lines[0] ?? "";
    const kv = lines.find((l) => /^key\s*:/i.test(l));
    if (kv) candidate = kv.replace(/^key\s*:\s*/i, "").trim();
    candidate = candidate.toUpperCase();
    if (ISSUE_KEY_PATTERN.test(candidate)) keys.add(candidate);
  }
  return Array.from(keys);
}
