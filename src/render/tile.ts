/**
 * Tile renderer — produces the DOM tree that replaces a ```jira code block.
 *
 * The renderer is intentionally framework-free; it manipulates DOM nodes
 * directly so it can run inside Obsidian's reading view, live preview, and the
 * standalone dev harness without React/Svelte runtime dependencies.
 *
 * Render flow:
 *   renderInto(container, request, ctx)
 *     1. Mount a loading skeleton.
 *     2. ctx.fetch(key, force) -> FetchResult
 *     3. Replace skeleton with the populated tile (or error tile on failure).
 *     4. Wire up the refresh button to repeat (2)-(3) with force=true.
 *
 * `ctx` is dependency-injected so the same renderer code is exercised by:
 *   - The plugin (passes a real fetcher backed by JiraClient + IssueCache)
 *   - The dev harness (passes a fixture-driven fetcher)
 *   - The unit tests (passes a stub fetcher with a deterministic clock)
 */

import { Notice } from "obsidian";
import type { JiraIssue } from "../jira/types";
import type { FetchResult } from "../cache/issueCache";
import { InvalidJiraBlockError, type IssueRequest } from "./parseBlock";
import {
  appendExternalLinkIcon,
  appendRefreshIcon,
  renderIssueTypeIcon,
} from "./icons";
import { formatCustomField } from "./formatters";
import type { CustomFieldConfig, PluginSettings } from "../settings/types";

/** Display preferences passed at render time. */
export interface DisplayOptions {
  showStatus: boolean;
  showPriority: boolean;
  showAssignee: boolean;
  showDueDate: boolean;
  showIssueType: boolean;
  customFields: CustomFieldConfig[];
}

/** Renderer dependencies. */
export interface RenderContext {
  /** Build a Jira browse URL for the given key. */
  buildIssueUrl: (key: string) => string;
  /**
   * Fetch (or refresh) an issue. Receives `force=true` when the user clicks
   * the refresh button on the tile.
   */
  fetch: (key: string, force: boolean) => Promise<FetchResult>;
  /** Display preferences (taken from PluginSettings at render time). */
  display: DisplayOptions;
  /** Optional clock injection for deterministic tests. */
  now?: () => number;
  /**
   * Whether to open links via window.open (default) or a custom opener (used
   * by the plugin to call Obsidian's window manager).
   */
  open?: (url: string) => void;
}

/**
 * Build a DisplayOptions snapshot from the plugin settings.
 *
 * Kept separate so the dev harness can supply its own `DisplayOptions` without
 * importing the full settings shape.
 */
export function displayOptionsFromSettings(s: PluginSettings): DisplayOptions {
  return {
    showStatus: s.showStatus,
    showPriority: s.showPriority,
    showAssignee: s.showAssignee,
    showDueDate: s.showDueDate,
    showIssueType: s.showIssueType,
    customFields: s.customFields.filter((f) => f.enabled && f.id),
  };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/** Mount a tile inside `container`. Mutates `container` (clears it first). */
export async function renderInto(
  container: HTMLElement,
  request: IssueRequest,
  ctx: RenderContext,
): Promise<void> {
  container.empty();
  container.addClass("jira-tile-container");

  let tile = mountSkeleton(container, request.key);

  const refresh = async (force: boolean): Promise<void> => {
    // Replace tile with a skeleton on manual refresh so users see motion.
    if (force) {
      container.empty();
      tile = mountSkeleton(container, request.key);
    }
    try {
      const result = await ctx.fetch(request.key, force);
      container.empty();
      tile = renderLoadedTile(container, request, result, ctx, refresh);
    } catch (err) {
      container.empty();
      tile = renderErrorTile(container, request.key, err, ctx, refresh);
    }
  };

  await refresh(false);
  // Keep a ref to suppress the "tile is unused" complaint from minifiers.
  void tile;
}

/**
 * Render-only path used by tests / dev harness when the data is already
 * resolved (no fetcher needed). Returns the tile element.
 */
export function renderResolvedTile(
  container: HTMLElement,
  request: IssueRequest,
  result: FetchResult,
  ctx: RenderContext,
): HTMLElement {
  container.empty();
  container.addClass("jira-tile-container");
  return renderLoadedTile(container, request, result, ctx, async () => {
    /* refresh disabled in resolved-only mode */
  });
}

/** Render an error state directly (used by parse failures and dev harness). */
export function renderInvalidBlock(
  container: HTMLElement,
  err: InvalidJiraBlockError,
): HTMLElement {
  container.empty();
  container.addClass("jira-tile-container");
  const tile = container.createDiv({ cls: "jira-tile jira-tile--error" });
  tile.createEl("strong", { text: "Invalid Jira block" });
  tile.createEl("p", { cls: "jira-tile-error-message", text: err.message });
  return tile;
}

/* -------------------------------------------------------------------------- */
/* Internal: state-specific renderers                                         */
/* -------------------------------------------------------------------------- */

function mountSkeleton(container: HTMLElement, key: string): HTMLElement {
  const tile = container.createDiv({ cls: "jira-tile jira-tile--loading" });
  const header = tile.createDiv({ cls: "jira-tile-header" });
  header.createDiv({ cls: "jira-tile-issuetype" });
  header.createSpan({ cls: "jira-tile-key", text: key });
  header.createSpan({ cls: "jira-tile-summary", text: "Loading…" });
  tile.createDiv({ cls: "jira-tile-meta", text: " " });
  return tile;
}

function renderLoadedTile(
  container: HTMLElement,
  request: IssueRequest,
  result: FetchResult,
  ctx: RenderContext,
  onRefresh: (force: boolean) => Promise<void>,
): HTMLElement {
  const issue = result.data;
  const tile = container.createDiv({ cls: "jira-tile" });
  if (result.staleError) tile.addClass("jira-tile--stale");

  /* Header --------------------------------------------------------------- */

  const header = tile.createDiv({ cls: "jira-tile-header" });

  if (ctx.display.showIssueType) {
    const iconWrap = header.createDiv({ cls: "jira-tile-issuetype" });
    renderIssueTypeIcon(
      iconWrap,
      issue.fields.issuetype?.iconUrl,
      issue.fields.issuetype?.name,
    );
  }

  const issueUrl = ctx.buildIssueUrl(issue.key);
  const keyEl = header.createEl("a", {
    cls: "jira-tile-key",
    text: issue.key,
    href: issueUrl,
  });
  keyEl.setAttribute("target", "_blank");
  keyEl.setAttribute("rel", "noopener noreferrer");
  attachOpener(keyEl, issueUrl, ctx);

  header.createSpan({
    cls: "jira-tile-summary",
    text: issue.fields.summary ?? "(no summary)",
  });

  const actions = header.createDiv({ cls: "jira-tile-actions" });

  const refreshBtn = actions.createEl("button", {
    attr: { "aria-label": "Refresh", title: "Refresh", type: "button" },
  });
  appendRefreshIcon(refreshBtn);
  refreshBtn.addEventListener("click", () => {
    onRefresh(true).catch((e) => new Notice(`Refresh failed: ${(e as Error).message}`));
  });

  const openBtn = actions.createEl("a", {
    attr: {
      "aria-label": "Open in Jira",
      title: "Open in Jira",
      target: "_blank",
      rel: "noopener noreferrer",
    },
    href: issueUrl,
  });
  appendExternalLinkIcon(openBtn);
  attachOpener(openBtn, issueUrl, ctx);

  /* Meta row ------------------------------------------------------------- */

  const meta = tile.createDiv({ cls: "jira-tile-meta" });

  if (ctx.display.showStatus && issue.fields.status?.name) {
    const color = issue.fields.status.statusCategory?.colorName ?? "medium-gray";
    const status = meta.createSpan({
      cls: `jira-tile-status jira-tile-status--${color}`,
      text: issue.fields.status.name,
    });
    if (issue.fields.status.statusCategory?.name) {
      status.title = issue.fields.status.statusCategory.name;
    }
  }

  if (ctx.display.showPriority && issue.fields.priority?.name) {
    const p = meta.createSpan({ cls: "jira-tile-priority" });
    p.createSpan({ text: "↑ " });
    p.createSpan({ text: issue.fields.priority.name });
  }

  if (ctx.display.showDueDate && issue.fields.duedate) {
    const d = meta.createSpan({ cls: "jira-tile-duedate" });
    d.createSpan({ text: "📅 " });
    d.appendChild(formatCustomField(issue.fields.duedate));
  }

  if (ctx.display.showAssignee && issue.fields.assignee) {
    const a = meta.createSpan({ cls: "jira-tile-assignee" });
    a.appendChild(formatCustomField(issue.fields.assignee));
  } else if (ctx.display.showAssignee && issue.fields.assignee === null) {
    meta.createSpan({ cls: "jira-tile-assignee", text: "Unassigned" });
  }

  /* Custom fields -------------------------------------------------------- */

  const enabledCustom = ctx.display.customFields;
  if (enabledCustom.length > 0) {
    const cf = tile.createDiv({ cls: "jira-tile-customfields" });
    for (const field of enabledCustom) {
      const value = issue.fields[field.id];
      if (value === undefined) continue;
      cf.createSpan({ cls: "jira-tile-customfield-label", text: field.label || field.id });
      const valueEl = cf.createSpan({ cls: "jira-tile-customfield-value" });
      valueEl.appendChild(formatCustomField(value));
    }
  }

  /* Footer --------------------------------------------------------------- */

  const footer = tile.createDiv({ cls: "jira-tile-footer" });
  footer.createSpan({ text: formatLastUpdated(result.fetchedAt, ctx.now) });
  if (result.staleError) {
    const offline = footer.createSpan({
      cls: "jira-tile-offline-badge",
      title: result.staleError.message,
    });
    offline.createSpan({ text: "⚠ stale" });
  } else if (result.fromCache) {
    footer.createSpan({ text: "cached" });
  }

  return tile;
}

function renderErrorTile(
  container: HTMLElement,
  key: string,
  err: unknown,
  ctx: RenderContext,
  onRefresh: (force: boolean) => Promise<void>,
): HTMLElement {
  const tile = container.createDiv({ cls: "jira-tile jira-tile--error" });
  const header = tile.createDiv({ cls: "jira-tile-header" });
  header.createSpan({ cls: "jira-tile-key", text: key });
  header.createSpan({ cls: "jira-tile-summary", text: "Failed to load" });

  const actions = header.createDiv({ cls: "jira-tile-actions" });
  const retry = actions.createEl("button", {
    attr: { "aria-label": "Retry", title: "Retry", type: "button" },
  });
  appendRefreshIcon(retry);
  retry.addEventListener("click", () => {
    onRefresh(true).catch((e) => new Notice(`Retry failed: ${(e as Error).message}`));
  });

  tile.createEl("p", {
    cls: "jira-tile-error-message",
    text: err instanceof Error ? err.message : String(err),
  });

  // Open-in-Jira link still works even if we can't fetch.
  const linkRow = tile.createDiv({ cls: "jira-tile-meta" });
  const url = ctx.buildIssueUrl(key);
  const a = linkRow.createEl("a", {
    text: "Open in Jira",
    href: url,
  });
  a.setAttribute("target", "_blank");
  a.setAttribute("rel", "noopener noreferrer");
  attachOpener(a, url, ctx);
  return tile;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function attachOpener(el: HTMLElement, url: string, ctx: RenderContext): void {
  if (!ctx.open) return; // default <a target="_blank"> behavior
  el.addEventListener("click", (ev) => {
    ev.preventDefault();
    ctx.open?.(url);
  });
}

function formatLastUpdated(fetchedAt: number, now?: () => number): string {
  const t = now ? now() : Date.now();
  const deltaSec = Math.max(0, Math.round((t - fetchedAt) / 1000));
  if (deltaSec < 60) return "Updated just now";
  if (deltaSec < 3600) return `Updated ${Math.round(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `Updated ${Math.round(deltaSec / 3600)}h ago`;
  return `Updated ${new Date(fetchedAt).toLocaleString()}`;
}
