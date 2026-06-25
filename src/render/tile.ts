/**
 * Tile renderer — produces the DOM tree that replaces a ```jira code block.
 *
 * Layout (matches the design reference):
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  [icon]  Big bold summary                                  │
 *   │          Epic AI-3855 in Jira Cloud                        │
 *   │                                                            │
 *   │  Issue Type        Status            Priority              │
 *   │  [icon] Story      [In Progress]     [↑] High              │
 *   │                                                            │
 *   │  Assignee                                                  │
 *   │  [👤 Rahul Ramakrishna]                                    │
 *   │                                                            │
 *   │  Sprint           Story Points       Team                  │
 *   │  Sprint 42        5                  Platform              │
 *   ├────────────────────────────────────────────────────────────┤
 *   │  As of today at 11:37 AM        [↻] [ Open in Jira ]       │
 *   └────────────────────────────────────────────────────────────┘
 *
 * The renderer is intentionally framework-free; it manipulates DOM nodes
 * directly so it can run inside Obsidian's reading view, live preview, and
 * the standalone dev harness without React/Svelte runtime dependencies.
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
  appendRefreshIcon,
  renderIssueTypeIcon,
  renderPriorityIcon,
} from "./icons";
import { formatCustomField } from "./formatters";
import type { CustomFieldConfig, PluginSettings } from "../settings/types";

/** Display preferences passed at render time. */
export interface DisplayOptions {
  showStatus: boolean;
  showPriority: boolean;
  showAssignee: boolean;
  showDueDate: boolean;
  /** Show the issue-type icon in the header next to the summary. */
  showIssueType: boolean;
  /** Show "Issue Type" as a labeled body grid cell. */
  showIssueTypeField: boolean;
  /** Show "Fix Versions" as a labeled body grid cell. */
  showFixVersions: boolean;
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
    showIssueTypeField: s.showIssueTypeField,
    showFixVersions: s.showFixVersions,
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
  const body = tile.createDiv({ cls: "jira-tile-body" });
  body.createEl("strong", { text: "Invalid Jira block" });
  body.createEl("p", { cls: "jira-tile-error-message", text: err.message });
  return tile;
}

/* -------------------------------------------------------------------------- */
/* Internal: state-specific renderers                                         */
/* -------------------------------------------------------------------------- */

function mountSkeleton(container: HTMLElement, key: string): HTMLElement {
  const tile = container.createDiv({ cls: "jira-tile jira-tile--loading" });

  const body = tile.createDiv({ cls: "jira-tile-body" });
  const header = body.createDiv({ cls: "jira-tile-header" });
  header.createDiv({ cls: "jira-tile-issuetype" });
  const title = header.createDiv({ cls: "jira-tile-title" });
  title.createDiv({ cls: "jira-tile-summary", text: "Loading…" });
  title.createDiv({ cls: "jira-tile-subtitle", text: key });

  // Empty placeholder grid so the skeleton has its full height.
  body.createDiv({ cls: "jira-tile-grid" });

  const footer = tile.createDiv({ cls: "jira-tile-footer" });
  footer.createDiv({ cls: "jira-tile-timestamp", text: " " });
  footer.createDiv({ cls: "jira-tile-actions" });
  return tile;
}

function renderLoadedTile(
  container: HTMLElement,
  _request: IssueRequest,
  result: FetchResult,
  ctx: RenderContext,
  onRefresh: (force: boolean) => Promise<void>,
): HTMLElement {
  const issue = result.data;
  const tile = container.createDiv({ cls: "jira-tile" });
  if (result.staleError) tile.addClass("jira-tile--stale");

  const body = tile.createDiv({ cls: "jira-tile-body" });

  /* Header: type icon + summary + subtitle ------------------------------- */

  const header = body.createDiv({ cls: "jira-tile-header" });

  if (ctx.display.showIssueType) {
    const iconWrap = header.createDiv({ cls: "jira-tile-issuetype" });
    renderIssueTypeIcon(
      iconWrap,
      issue.fields.issuetype?.iconUrl,
      issue.fields.issuetype?.name,
    );
  }

  const titleWrap = header.createDiv({ cls: "jira-tile-title" });
  titleWrap.createDiv({
    cls: "jira-tile-summary",
    text: issue.fields.summary ?? "(no summary)",
  });
  const subtitle = titleWrap.createDiv({ cls: "jira-tile-subtitle" });
  buildSubtitle(subtitle, issue);

  /* Standard fields grid (Issue Type / Status / Priority / Assignee /Due) */

  const standardGrid = body.createDiv({
    cls: "jira-tile-grid jira-tile-grid--standard",
  });
  renderStandardFields(standardGrid, issue, ctx.display);

  /* Custom fields grid: separate so it can use a denser layout ----------- */

  if (ctx.display.customFields.length > 0) {
    const renderable = ctx.display.customFields.filter(
      (f) => issue.fields[f.id] !== undefined,
    );
    if (renderable.length > 0) {
      const customGrid = body.createDiv({
        cls: "jira-tile-grid jira-tile-grid--custom",
      });
      // Tag the grid with the count so CSS can switch column densities.
      customGrid.dataset.count = String(renderable.length);
      for (const field of renderable) {
        const cell = customGrid.createDiv({
          cls: "jira-tile-cell jira-tile-cell--custom",
        });
        cell.createDiv({
          cls: "jira-tile-field-label",
          text: field.label || field.id,
        });
        const valueEl = cell.createDiv({ cls: "jira-tile-customfield-value" });
        valueEl.appendChild(formatCustomField(issue.fields[field.id]));
      }
    }
  }

  /* Footer: timestamp left, refresh + Open in Jira right ---------------- */

  const footer = tile.createDiv({ cls: "jira-tile-footer" });

  const tsWrap = footer.createDiv({ cls: "jira-tile-timestamp" });
  tsWrap.setText(formatLastUpdated(result.fetchedAt, ctx.now));
  if (result.staleError) {
    tsWrap.addClass("jira-tile-timestamp--stale");
    tsWrap.title = `Showing cached data — ${result.staleError.message}`;
  }

  const actions = footer.createDiv({ cls: "jira-tile-actions" });

  const refreshBtn = actions.createEl("button", {
    cls: "jira-tile-refresh-btn",
    attr: {
      type: "button",
      "aria-label": "Refresh",
      title: "Refresh",
    },
  });
  appendRefreshIcon(refreshBtn);
  refreshBtn.addEventListener("click", () => {
    refreshBtn.classList.add("is-spinning");
    onRefresh(true)
      .catch((e) => new Notice(`Refresh failed: ${(e as Error).message}`))
      .finally(() => refreshBtn.classList.remove("is-spinning"));
  });

  const issueUrl = ctx.buildIssueUrl(issue.key);
  const openBtn = actions.createEl("a", {
    cls: "jira-tile-open-btn",
    text: "Open in Jira",
    href: issueUrl,
  });
  openBtn.setAttribute("target", "_blank");
  openBtn.setAttribute("rel", "noopener noreferrer");
  attachOpener(openBtn, issueUrl, ctx);

  return tile;
}

/**
 * Render the standard field grid (issue type, status, priority, due date,
 * assignee). Extracted for readability — the function is purely DOM-building.
 */
function renderStandardFields(
  grid: HTMLElement,
  issue: JiraIssue,
  display: DisplayOptions,
): void {
  if (display.showIssueTypeField && issue.fields.issuetype?.name) {
    const cell = grid.createDiv({
      cls: "jira-tile-cell jira-tile-cell--issuetype",
    });
    cell.createDiv({ cls: "jira-tile-field-label", text: "Issue Type" });
    const value = cell.createDiv({ cls: "jira-tile-issuetype-value" });
    const icon = value.createSpan({ cls: "jira-tile-icon-inline" });
    renderIssueTypeIcon(
      icon,
      issue.fields.issuetype.iconUrl,
      issue.fields.issuetype.name,
    );
    value.createSpan({
      cls: "jira-tile-issuetype-name",
      text: issue.fields.issuetype.name,
    });
  }

  if (display.showStatus && issue.fields.status?.name) {
    const cell = grid.createDiv({
      cls: "jira-tile-cell jira-tile-cell--status",
    });
    cell.createDiv({ cls: "jira-tile-field-label", text: "Status" });
    const color =
      issue.fields.status.statusCategory?.colorName ?? "medium-gray";
    const badge = cell.createDiv({
      cls: `jira-tile-status-badge jira-tile-status-badge--${color}`,
    });
    badge.createSpan({ text: issue.fields.status.name });
  }

  if (display.showPriority && issue.fields.priority?.name) {
    const cell = grid.createDiv({
      cls: "jira-tile-cell jira-tile-cell--priority",
    });
    cell.createDiv({ cls: "jira-tile-field-label", text: "Priority" });
    const value = cell.createDiv({ cls: "jira-tile-priority-value" });
    const icon = value.createSpan({ cls: "jira-tile-icon-inline" });
    renderPriorityIcon(
      icon,
      issue.fields.priority.iconUrl,
      issue.fields.priority.name,
    );
    value.createSpan({
      cls: "jira-tile-priority-name",
      text: issue.fields.priority.name,
    });
  }

  if (display.showDueDate && issue.fields.duedate) {
    const cell = grid.createDiv({
      cls: "jira-tile-cell jira-tile-cell--duedate",
    });
    cell.createDiv({ cls: "jira-tile-field-label", text: "Due" });
    const value = cell.createDiv({ cls: "jira-tile-duedate-value" });
    value.appendChild(formatCustomField(issue.fields.duedate));
  }

  // Fix versions: render each version as a release-state-aware chip.
  // Placed adjacent to Due Date because the two read together (when does this
  // ship vs which release does it ship in). We skip the cell entirely when
  // there are no versions (instead of showing an em-dash) since "no fix
  // version" is the common case for new issues and a label-only cell adds
  // noise.
  if (
    display.showFixVersions &&
    Array.isArray(issue.fields.fixVersions) &&
    issue.fields.fixVersions.length > 0
  ) {
    const cell = grid.createDiv({
      cls: "jira-tile-cell jira-tile-cell--fixversions",
    });
    cell.createDiv({ cls: "jira-tile-field-label", text: "Fix Versions" });
    const value = cell.createDiv({ cls: "jira-tile-fixversions-value" });
    value.appendChild(formatCustomField(issue.fields.fixVersions));
  }

  if (display.showAssignee) {
    const cell = grid.createDiv({
      cls: "jira-tile-cell jira-tile-cell--assignee",
    });
    cell.createDiv({ cls: "jira-tile-field-label", text: "Assignee" });
    if (issue.fields.assignee) {
      const chip = cell.createDiv({ cls: "jira-tile-assignee-chip" });
      chip.appendChild(formatCustomField(issue.fields.assignee));
    } else {
      cell.createDiv({
        cls: "jira-tile-assignee-chip jira-tile-assignee-chip--unassigned",
        text: "Unassigned",
      });
    }
  }
}

function renderErrorTile(
  container: HTMLElement,
  key: string,
  err: unknown,
  ctx: RenderContext,
  onRefresh: (force: boolean) => Promise<void>,
): HTMLElement {
  const tile = container.createDiv({ cls: "jira-tile jira-tile--error" });

  const body = tile.createDiv({ cls: "jira-tile-body" });
  const header = body.createDiv({ cls: "jira-tile-header" });
  header.createDiv({ cls: "jira-tile-issuetype" });
  const title = header.createDiv({ cls: "jira-tile-title" });
  title.createDiv({ cls: "jira-tile-summary", text: "Failed to load" });
  title.createDiv({ cls: "jira-tile-subtitle", text: key });

  body.createEl("p", {
    cls: "jira-tile-error-message",
    text: err instanceof Error ? err.message : String(err),
  });

  const footer = tile.createDiv({ cls: "jira-tile-footer" });
  // Timestamp slot empty in error state — keep grid stable.
  footer.createDiv({ cls: "jira-tile-timestamp", text: " " });

  const actions = footer.createDiv({ cls: "jira-tile-actions" });
  const retry = actions.createEl("button", {
    cls: "jira-tile-refresh-btn",
    attr: { type: "button", "aria-label": "Retry", title: "Retry" },
  });
  appendRefreshIcon(retry);
  retry.addEventListener("click", () => {
    retry.classList.add("is-spinning");
    onRefresh(true)
      .catch((e) => new Notice(`Retry failed: ${(e as Error).message}`))
      .finally(() => retry.classList.remove("is-spinning"));
  });

  const url = ctx.buildIssueUrl(key);
  const openBtn = actions.createEl("a", {
    cls: "jira-tile-open-btn",
    text: "Open in Jira",
    href: url,
  });
  openBtn.setAttribute("target", "_blank");
  openBtn.setAttribute("rel", "noopener noreferrer");
  attachOpener(openBtn, url, ctx);

  return tile;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Build the issue subtitle line.
 *
 *   <Issue type label> <key> in <site name>
 *
 * For sub-issues with a parent (epic, parent task), prefer the parent
 * relationship as the leading context, e.g.:
 *
 *   "Epic AI-3855 in Jira Cloud"
 */
function buildSubtitle(parent: HTMLElement, issue: JiraIssue): void {
  const parts: string[] = [];
  const parentRef = issue.fields.parent;
  if (parentRef?.key) {
    const parentType = parentRef.fields?.issuetype?.name ?? "Parent";
    parts.push(`${parentType} ${parentRef.key}`);
  } else {
    const type = issue.fields.issuetype?.name ?? "Issue";
    parts.push(`${type} ${issue.key}`);
  }
  parts.push("in Jira Cloud");
  parent.setText(parts.join(" "));
}

function attachOpener(el: HTMLElement, url: string, ctx: RenderContext): void {
  if (!ctx.open) return;
  el.addEventListener("click", (ev) => {
    ev.preventDefault();
    ctx.open?.(url);
  });
}

/**
 * Format the timestamp the way the design shows it:
 *   - same calendar day  -> "As of today at HH:MM AM/PM"
 *   - yesterday          -> "As of yesterday at HH:MM AM/PM"
 *   - older              -> "As of <date> at HH:MM AM/PM"
 */
function formatLastUpdated(fetchedAt: number, now?: () => number): string {
  const t = now ? now() : Date.now();
  const fetched = new Date(fetchedAt);
  const today = new Date(t);

  const time = fetched.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const sameDay =
    fetched.getFullYear() === today.getFullYear() &&
    fetched.getMonth() === today.getMonth() &&
    fetched.getDate() === today.getDate();
  if (sameDay) return `As of today at ${time}`;

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    fetched.getFullYear() === yesterday.getFullYear() &&
    fetched.getMonth() === yesterday.getMonth() &&
    fetched.getDate() === yesterday.getDate();
  if (isYesterday) return `As of yesterday at ${time}`;

  const date = fetched.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `As of ${date} at ${time}`;
}
