/**
 * Markdown code block processor for ```jira blocks.
 *
 * Registered with `plugin.registerMarkdownCodeBlockProcessor("jira", ...)`.
 * Obsidian invokes the callback once per block while rendering Markdown.
 *
 * Lifecycle in this module:
 *   1. Parse the block body into an IssueRequest (or render an "invalid block"
 *      tile if parsing fails).
 *   2. Hand off to `renderInto`, supplying a RenderContext that knows how to
 *      build issue URLs and fetch from the cache + Jira client.
 */

import { type MarkdownPostProcessorContext } from "obsidian";
import type { IssueCache } from "../cache/issueCache";
import type { JiraClient } from "../jira/client";
import { DEFAULT_ISSUE_FIELDS } from "../constants";
import { InvalidJiraBlockError, parseBlockMulti } from "./parseBlock";
import {
  displayOptionsFromSettings,
  renderInto,
  renderInvalidBlock,
  type RenderContext,
} from "./tile";
import type { PluginSettings } from "../settings/types";

/** Dependencies the processor needs from the host plugin. */
export interface CodeBlockProcessorDeps {
  client: JiraClient;
  cache: IssueCache;
  /** Callback returning the latest settings (for live config changes). */
  getSettings: () => PluginSettings;
  /** Called to open a URL — defaults to window.open. */
  openUrl?: (url: string) => void;
}

/**
 * Build a `RenderContext` (the fetch/display/open wiring a tile needs) from
 * the host-plugin dependencies + current settings. Shared by the code-block
 * processor and the inline-link processor so both render identically.
 */
export function makeRenderContext(
  deps: CodeBlockProcessorDeps,
  settings: PluginSettings,
): RenderContext {
  return {
    buildIssueUrl: (key: string) => buildIssueUrl(key, settings),
    fetch: (key, force) =>
      deps.cache.getOrFetch(
        key,
        () => deps.client.getIssue(key, fieldsForRequest(settings)),
        force,
      ),
    display: displayOptionsFromSettings(settings),
    open: deps.openUrl,
  };
}

/**
 * Build a code-block processor function that can be registered with
 * `plugin.registerMarkdownCodeBlockProcessor("jira", ...)`.
 */
export function buildCodeBlockProcessor(
  deps: CodeBlockProcessorDeps,
): (source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext) => void {
  return (source, el) => {
    let requests;
    try {
      requests = parseBlockMulti(source);
    } catch (err) {
      if (err instanceof InvalidJiraBlockError) {
        renderInvalidBlock(el, err);
        return;
      }
      throw err;
    }

    const settings = deps.getSettings();
    const ctx = makeRenderContext(deps, settings);

    el.empty();
    // One block may embed several issues (one per line). Render each into its
    // own child container so a single block can stack multiple tiles.
    const multiple = requests.length > 1;
    for (const request of requests) {
      const host = multiple
        ? el.createDiv({ cls: "jira-tile-multi-item" })
        : el;
      // Resolve the tri-state per-tile compact flag against the global default:
      // `!compact`/`!full` (or `compact:`) win; otherwise inherit defaultCompact.
      const resolved = {
        ...request,
        compact: resolveCompact(request.compact, settings),
      };
      void renderInto(host, resolved, ctx);
    }
  };
}

/**
 * Resolve a tri-state per-tile compact preference against the global default.
 * `undefined` (no per-tile preference) inherits `settings.defaultCompact`.
 */
export function resolveCompact(
  perTile: boolean | undefined,
  settings: PluginSettings,
): boolean {
  return perTile ?? settings.defaultCompact;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Compute the `fields` query param used when fetching issues. */
export function fieldsForRequest(settings: PluginSettings): readonly string[] {
  const ids = new Set<string>(DEFAULT_ISSUE_FIELDS);
  for (const cf of settings.customFields) {
    if (cf.enabled && cf.id) ids.add(cf.id);
  }
  return Array.from(ids);
}

/** Build an https://<site>/browse/KEY URL based on the active auth method. */
export function buildIssueUrl(key: string, settings: PluginSettings): string {
  const site =
    (settings.authMethod === "apiToken" && settings.apiToken?.siteUrl) || "";
  if (!site) {
    // Last-resort fallback so the link is still openable.
    return `https://your-site.atlassian.net/browse/${encodeURIComponent(key)}`;
  }
  return `${site.replace(/\/+$/, "")}/browse/${encodeURIComponent(key)}`;
}
