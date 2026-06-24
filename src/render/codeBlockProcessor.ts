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
import { InvalidJiraBlockError, parseBlock } from "./parseBlock";
import {
  displayOptionsFromSettings,
  renderInto,
  renderInvalidBlock,
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
 * Build a code-block processor function that can be registered with
 * `plugin.registerMarkdownCodeBlockProcessor("jira", ...)`.
 */
export function buildCodeBlockProcessor(
  deps: CodeBlockProcessorDeps,
): (source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext) => void {
  return (source, el) => {
    let request;
    try {
      request = parseBlock(source);
    } catch (err) {
      if (err instanceof InvalidJiraBlockError) {
        renderInvalidBlock(el, err);
        return;
      }
      throw err;
    }

    const settings = deps.getSettings();

    void renderInto(el, request, {
      buildIssueUrl: (key: string) => buildIssueUrl(key, settings),
      fetch: (key, force) =>
        deps.cache.getOrFetch(
          key,
          () => deps.client.getIssue(key, fieldsForRequest(settings)),
          force,
        ),
      display: displayOptionsFromSettings(settings),
      open: deps.openUrl,
    });
  };
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
    (settings.authMethod === "oauth" && settings.oauth?.siteUrl) ||
    (settings.authMethod === "apiToken" && settings.apiToken?.siteUrl) ||
    "";
  if (!site) {
    // Last-resort fallback so the link is still openable.
    return `https://your-site.atlassian.net/browse/${encodeURIComponent(key)}`;
  }
  return `${site.replace(/\/+$/, "")}/browse/${encodeURIComponent(key)}`;
}
