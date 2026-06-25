/**
 * Markdown post-processor for the auto-link render mode.
 *
 * Registered with `plugin.registerMarkdownPostProcessor(...)`. Obsidian calls
 * it with the rendered element for each block. We walk the anchors, and for
 * any whose href is a Jira issue URL on the configured site, we replace the
 * link with a rendered tile.
 *
 * To keep reading view responsive we only touch anchors that are "standalone"
 * — i.e. the link is essentially the whole content of its paragraph — so we
 * don't rip a Jira URL out of the middle of a sentence and turn it into a
 * block-level card. A URL sitting inline in prose is left as a normal link.
 */

import type { MarkdownPostProcessorContext } from "obsidian";
import type { CodeBlockProcessorDeps } from "./codeBlockProcessor";
import { makeRenderContext } from "./codeBlockProcessor";
import { issueKeyFromUrl } from "./parseUrl";
import { renderInto } from "./tile";
import { createEl } from "./dom";

/**
 * Build the post-processor function. It is a no-op unless the active render
 * mode includes auto-link (checked via `getSettings` each call so toggling
 * the setting takes effect without reload).
 */
export function buildLinkPostProcessor(
  deps: CodeBlockProcessorDeps,
): (el: HTMLElement, ctx: MarkdownPostProcessorContext) => void {
  return (el) => {
    const settings = deps.getSettings();
    if (settings.renderMode === "code-block") return; // auto-link disabled

    const site = settings.apiToken?.siteUrl;
    if (!site) return; // can't match URLs without a configured site

    const anchors = Array.from(el.querySelectorAll("a"));
    for (const anchor of anchors) {
      const href = anchor.getAttribute("href");
      if (!href) continue;
      const key = issueKeyFromUrl(href, site);
      if (!key) continue;
      if (!isStandaloneLink(anchor)) continue;

      // Mount the tile in place of the anchor. We replace the anchor's
      // nearest block-ish ancestor content with a fresh container so the
      // tile owns its own line.
      const container = createEl("div");
      anchor.replaceWith(container);

      void renderInto(
        container,
        { key },
        makeRenderContext(deps, settings),
      );
    }
  };
}

/**
 * True if the anchor is effectively the sole content of its containing
 * paragraph (ignoring surrounding whitespace). This avoids converting a Jira
 * URL embedded mid-sentence.
 */
function isStandaloneLink(anchor: HTMLAnchorElement): boolean {
  const parent = anchor.parentElement;
  if (!parent) return false;
  // Only consider paragraph-level containers — Obsidian wraps a lone link
  // paragraph in a <p>.
  const tag = parent.tagName.toLowerCase();
  if (tag !== "p" && tag !== "div" && tag !== "li") return false;
  const text = (parent.textContent ?? "").trim();
  const linkText = (anchor.textContent ?? "").trim();
  return text === linkText;
}
