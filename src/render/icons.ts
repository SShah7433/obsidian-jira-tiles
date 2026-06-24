/**
 * Inline SVG icons used by the tile renderer.
 *
 * We embed icons as DOM nodes (built with `createElementNS`) because:
 *   - Obsidian's `setIcon()` injects Lucide icons; we use it for built-in
 *     UI affordances (refresh / external-link), but Jira issue-type and
 *     priority icons come from Atlassian as URL refs.
 *   - When Atlassian's URL is missing or unreachable (mobile, offline,
 *     fixtures), we render visually-equivalent inline SVG fallbacks so the
 *     tile remains useful.
 */

import { setIcon } from "obsidian";

/* -------------------------------------------------------------------------- */
/* Generic UI icons (refresh / external-link) — Lucide via setIcon()          */
/* -------------------------------------------------------------------------- */

/** Append a refresh (rotate-cw) icon into `el`. */
export function appendRefreshIcon(el: HTMLElement): void {
  setIcon(el, "rotate-cw");
}

/** Append an external-link icon into `el`. */
export function appendExternalLinkIcon(el: HTMLElement): void {
  setIcon(el, "external-link");
}

/* -------------------------------------------------------------------------- */
/* Jira issue type icons                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Render an issue-type icon. Jira returns a URL on `issuetype.iconUrl`.
 *
 * Resolution order:
 *   1. `iconUrl` if Atlassian provided one (works in desktop / online).
 *   2. Built-in inline SVG matching Atlassian's standard icons if the
 *      issue-type name matches one we know (Story, Task, Bug, Epic,
 *      Sub-task, Improvement, New Feature).
 *   3. Letter chip fallback (first letter of the type name in a colored
 *      square) — works in tests, dev preview, and mobile when offline.
 */
export function renderIssueTypeIcon(
  el: HTMLElement,
  iconUrl?: string,
  name?: string,
): void {
  el.empty();
  if (iconUrl) {
    const img = document.createElement("img");
    img.src = iconUrl;
    img.alt = name ?? "issue type";
    img.className = "jira-icon-img";
    el.appendChild(img);
    return;
  }

  const svg = ISSUE_TYPE_SVGS[normalizeKey(name)];
  if (svg) {
    const node = svgFromMarkup(svg);
    node.setAttribute("aria-label", name ?? "issue type");
    el.appendChild(node);
    return;
  }

  // Letter chip fallback.
  const letter = (name?.[0] ?? "?").toUpperCase();
  const chip = document.createElement("span");
  chip.textContent = letter;
  chip.className = "jira-icon-chip";
  chip.style.background = colorForName(name ?? "?");
  el.appendChild(chip);
}

/* -------------------------------------------------------------------------- */
/* Jira priority icons                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Render a priority icon. Same resolution order as `renderIssueTypeIcon`:
 * iconUrl -> built-in SVG (matched on priority name) -> arrow fallback.
 *
 * Atlassian's standard priorities are Highest, High, Medium, Low, Lowest;
 * many sites rename or extend these (e.g. "3-Medium (potential to escalate)").
 * The matcher is forgiving — it normalizes by stripping leading numbers and
 * trailing parenthetical qualifiers before comparing.
 */
export function renderPriorityIcon(
  el: HTMLElement,
  iconUrl?: string,
  name?: string,
): void {
  el.empty();
  if (iconUrl) {
    const img = document.createElement("img");
    img.src = iconUrl;
    img.alt = name ?? "priority";
    img.className = "jira-icon-img";
    el.appendChild(img);
    return;
  }

  const matched = matchPriorityName(name);
  const svg = matched ? PRIORITY_SVGS[matched] : undefined;
  if (svg) {
    const node = svgFromMarkup(svg);
    node.setAttribute("aria-label", name ?? "priority");
    el.appendChild(node);
    return;
  }

  // Generic neutral arrow.
  const fallback = svgFromMarkup(PRIORITY_SVGS.medium);
  fallback.setAttribute("aria-label", name ?? "priority");
  el.appendChild(fallback);
}

/* -------------------------------------------------------------------------- */
/* SVG markup                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Issue-type SVGs styled after Atlassian's icon set:
 *   - Story  : green checkmark in a square
 *   - Task   : blue checkmark in a square
 *   - Bug    : red circle
 *   - Epic   : purple lightning-bolt in a square
 *   - Sub-task: blue chevron-up in a square
 *   - Improvement: blue arrow-up in a square
 *   - New Feature: blue plus in a square
 *
 * 16x16 with rounded corners — matches Atlassian's visual weight.
 */
const ISSUE_TYPE_SVGS: Record<string, string> = {
  story: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="jira-icon-svg"><rect x="0" y="0" width="16" height="16" rx="3" fill="#63ba3c"/><path d="M3.5 6h6v1h-6V6zm0 3h6v1h-6V9z" fill="#fff"/></svg>`,
  task: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="jira-icon-svg"><rect x="0" y="0" width="16" height="16" rx="3" fill="#4bade8"/><path d="M11.5 4.5l-5 5L4 7.2l-1 1 3.5 3.3 6-6-1-1z" fill="#fff"/></svg>`,
  bug: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="jira-icon-svg"><circle cx="8" cy="8" r="7" fill="#e5493a"/><circle cx="8" cy="8" r="2.4" fill="#fff"/></svg>`,
  epic: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="jira-icon-svg"><rect x="0" y="0" width="16" height="16" rx="3" fill="#904ee2"/><path d="M9.2 2.5L4 9h3l-.5 4.5L12 7H9l.2-4.5z" fill="#fff"/></svg>`,
  subtask: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="jira-icon-svg"><rect x="0" y="0" width="16" height="16" rx="3" fill="#4bade8"/><path d="M3 9.5h6.5V13l4-4.5-4-4.5V8H3z" fill="#fff"/></svg>`,
  improvement: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="jira-icon-svg"><rect x="0" y="0" width="16" height="16" rx="3" fill="#4bade8"/><path d="M8 3l4 5h-2.5v5h-3V8H4z" fill="#fff"/></svg>`,
  "new-feature": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="jira-icon-svg"><rect x="0" y="0" width="16" height="16" rx="3" fill="#4bade8"/><path d="M7 3.5h2v3.5h3.5v2H9v3.5H7V9H3.5V7H7z" fill="#fff"/></svg>`,
};

/**
 * Priority SVGs styled after Atlassian's icon set — three-bar signal-style
 * arrows (up = elevate, down = lower) in semantic colors.
 */
const PRIORITY_SVGS: Record<string, string> = {
  highest: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="jira-icon-svg jira-priority-svg"><path d="M8 2l5 6h-3v6H6V8H3z" fill="#cd1316"/></svg>`,
  high: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="jira-icon-svg jira-priority-svg"><path d="M8 3.5l4.5 5H10v5H6v-5H3.5z" fill="#e8503a"/></svg>`,
  medium: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="jira-icon-svg jira-priority-svg"><path d="M3 6.5h10v1.2H3zm0 2.8h10v1.2H3z" fill="#e9a23b"/></svg>`,
  low: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="jira-icon-svg jira-priority-svg"><path d="M8 12.5l-4.5-5H6v-5h4v5h2.5z" fill="#2a82c8"/></svg>`,
  lowest: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="jira-icon-svg jira-priority-svg"><path d="M8 14l-5-6h3V2h4v6h3z" fill="#3a82c8"/></svg>`,
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Lower-case + dash-joined tokens, with common synonyms collapsed. */
function normalizeKey(name: string | undefined): string {
  if (!name) return "";
  const k = name.toLowerCase().trim();
  if (k === "sub-task" || k === "subtask" || k === "sub task") return "subtask";
  if (k === "new feature" || k === "new-feature") return "new-feature";
  return k;
}

/**
 * Match a noisy priority name (e.g. "3-Medium (potential to escalate)") to
 * one of the canonical buckets used in `PRIORITY_SVGS`.
 *
 * Strategy:
 *   1. Strip a leading "<digit>-" or "<digit>." (Jira sites often prefix).
 *   2. Drop any parenthetical qualifier.
 *   3. Lowercase + trim.
 *   4. Look for "highest" / "lowest" first (so "high" doesn't shadow them).
 */
export function matchPriorityName(
  name: string | undefined,
): keyof typeof PRIORITY_SVGS | undefined {
  if (!name) return undefined;
  let k = name.trim().toLowerCase();
  k = k.replace(/^\d+\s*[-.)]\s*/, ""); // "3-Medium" -> "Medium"
  k = k.replace(/\s*\(.*$/, ""); // "Medium (potential ...)" -> "Medium"
  k = k.trim();
  if (k.includes("highest")) return "highest";
  if (k.includes("lowest")) return "lowest";
  if (k.includes("critical") || k.includes("blocker")) return "highest";
  if (k.includes("trivial") || k.includes("minor")) return "lowest";
  if (k.includes("high")) return "high";
  if (k.includes("low")) return "low";
  if (k.includes("medium") || k.includes("normal") || k.includes("major")) {
    return "medium";
  }
  return undefined;
}

/** Build an actual <svg> element from a static markup string. */
function svgFromMarkup(markup: string): SVGElement {
  const tmpl = document.createElement("template");
  tmpl.innerHTML = markup.trim();
  const node = tmpl.content.firstElementChild as SVGElement | null;
  if (!node) {
    // Should not happen — markup is internal/static. Fall back to an empty
    // <svg> so callers see *something*.
    return document.createElementNS("http://www.w3.org/2000/svg", "svg");
  }
  return node;
}

/** Stable color choice based on a simple string hash. */
function colorForName(s: string): string {
  const palette = [
    "#0747a6", "#5243aa", "#bf2600", "#ff8b00",
    "#006644", "#00a3bf", "#403294", "#974f0c",
  ];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
