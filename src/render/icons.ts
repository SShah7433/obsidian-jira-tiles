/**
 * Inline SVG icons used by the tile renderer.
 *
 * We build icons as DOM nodes via `createElementNS` (never `innerHTML`)
 * because:
 *   - Obsidian's `setIcon()` injects Lucide icons; we use it for built-in
 *     UI affordances (refresh / external-link), but Jira issue-type and
 *     priority icons come from Atlassian as URL refs.
 *   - When Atlassian's URL is missing or unreachable (mobile, offline,
 *     fixtures), we render visually-equivalent inline SVG fallbacks so the
 *     tile remains useful.
 *
 * Avatar/icon image URLs that come from the Jira API are validated against an
 * http(s) allowlist before being used as an `<img src>` (see `safeImageUrl`).
 */

import { setIcon } from "obsidian";
import { createEl, doc } from "./dom";

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
/* URL safety                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Return `url` only if it is a safe http(s) (or protocol-relative) image URL,
 * otherwise `undefined`. Guards against `javascript:`, `data:`, `file:` and
 * other schemes sneaking into an `<img src>` from a tampered Jira response.
 */
export function safeImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return trimmed; // protocol-relative
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* SVG element builder                                                        */
/* -------------------------------------------------------------------------- */

const SVG_NS = "http://www.w3.org/2000/svg";

/** A single SVG child shape, described declaratively so we can build it safely. */
interface SvgShape {
  tag: "rect" | "circle" | "path";
  attrs: Record<string, string | number>;
}

interface SvgIcon {
  /** Extra class(es) to add beyond `jira-icon-svg`. */
  extraClass?: string;
  shapes: SvgShape[];
}

/** Build an <svg> element from a declarative descriptor (no innerHTML). */
function buildSvg(icon: SvgIcon, ariaLabel?: string): SVGElement {
  const d = doc();
  const svg = d.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", `jira-icon-svg${icon.extraClass ? " " + icon.extraClass : ""}`);
  if (ariaLabel) svg.setAttribute("aria-label", ariaLabel);
  for (const shape of icon.shapes) {
    const node = d.createElementNS(SVG_NS, shape.tag);
    for (const [k, v] of Object.entries(shape.attrs)) {
      node.setAttribute(k, String(v));
    }
    svg.appendChild(node);
  }
  return svg;
}

/* -------------------------------------------------------------------------- */
/* Jira issue type icons                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Issue-type SVGs styled after Atlassian's icon set:
 *   - Story  : green bars in a square
 *   - Task   : blue checkmark in a square
 *   - Bug    : red circle
 *   - Epic   : purple lightning-bolt in a square
 *   - Sub-task: blue arrow in a square
 *   - Improvement: blue arrow-up in a square
 *   - New Feature: blue plus in a square
 */
const ISSUE_TYPE_ICONS: Record<string, SvgIcon> = {
  story: {
    shapes: [
      { tag: "rect", attrs: { x: 0, y: 0, width: 16, height: 16, rx: 3, fill: "#63ba3c" } },
      { tag: "rect", attrs: { x: 4, y: 5.5, width: 8, height: 1.5, rx: 0.5, fill: "#fff" } },
      { tag: "rect", attrs: { x: 4, y: 9, width: 8, height: 1.5, rx: 0.5, fill: "#fff" } },
    ],
  },
  task: {
    shapes: [
      { tag: "rect", attrs: { x: 0, y: 0, width: 16, height: 16, rx: 3, fill: "#4bade8" } },
      { tag: "path", attrs: { d: "M11.5 4.5l-5 5L4 7.2l-1 1 3.5 3.3 6-6-1-1z", fill: "#fff" } },
    ],
  },
  bug: {
    shapes: [
      { tag: "circle", attrs: { cx: 8, cy: 8, r: 7, fill: "#e5493a" } },
      { tag: "circle", attrs: { cx: 8, cy: 8, r: 2.4, fill: "#fff" } },
    ],
  },
  epic: {
    shapes: [
      { tag: "rect", attrs: { x: 0, y: 0, width: 16, height: 16, rx: 3, fill: "#904ee2" } },
      { tag: "path", attrs: { d: "M9.2 2.5L4 9h3l-.5 4.5L12 7H9l.2-4.5z", fill: "#fff" } },
    ],
  },
  subtask: {
    shapes: [
      { tag: "rect", attrs: { x: 0, y: 0, width: 16, height: 16, rx: 3, fill: "#4bade8" } },
      { tag: "path", attrs: { d: "M3 9.5h6.5V13l4-4.5-4-4.5V8H3z", fill: "#fff" } },
    ],
  },
  improvement: {
    shapes: [
      { tag: "rect", attrs: { x: 0, y: 0, width: 16, height: 16, rx: 3, fill: "#4bade8" } },
      { tag: "path", attrs: { d: "M8 3l4 5h-2.5v5h-3V8H4z", fill: "#fff" } },
    ],
  },
  "new-feature": {
    shapes: [
      { tag: "rect", attrs: { x: 0, y: 0, width: 16, height: 16, rx: 3, fill: "#4bade8" } },
      { tag: "path", attrs: { d: "M7 3.5h2v3.5h3.5v2H9v3.5H7V9H3.5V7H7z", fill: "#fff" } },
    ],
  },
};

/**
 * Render an issue-type icon. Jira returns a URL on `issuetype.iconUrl`.
 *
 * Resolution order:
 *   1. `iconUrl` if Atlassian provided a safe http(s) one.
 *   2. Built-in inline SVG matching Atlassian's standard icons if the
 *      issue-type name matches one we know.
 *   3. Letter chip fallback (first letter of the type name in a colored
 *      square) — works in tests, dev preview, and mobile when offline.
 */
export function renderIssueTypeIcon(
  el: HTMLElement,
  iconUrl?: string,
  name?: string,
): void {
  el.empty();
  const safe = safeImageUrl(iconUrl);
  if (safe) {
    const img = createEl("img");
    img.src = safe;
    img.alt = name ?? "issue type";
    img.className = "jira-icon-img";
    el.appendChild(img);
    return;
  }

  const icon = ISSUE_TYPE_ICONS[normalizeKey(name)];
  if (icon) {
    el.appendChild(buildSvg(icon, name ?? "issue type"));
    return;
  }

  // Letter chip fallback.
  const letter = (name?.[0] ?? "?").toUpperCase();
  const chip = el.createSpan({ cls: "jira-icon-chip" });
  chip.textContent = letter;
  chip.dataset.colorIndex = String(colorIndexForName(name ?? "?"));
}

/* -------------------------------------------------------------------------- */
/* Jira priority icons                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Priority SVGs styled after Atlassian's icon set — arrows (up = elevate,
 * down = lower) and bars (medium) in semantic colors.
 */
const PRIORITY_ICONS: Record<string, SvgIcon> = {
  highest: {
    extraClass: "jira-priority-svg",
    shapes: [{ tag: "path", attrs: { d: "M8 2l5 6h-3v6H6V8H3z", fill: "#cd1316" } }],
  },
  high: {
    extraClass: "jira-priority-svg",
    shapes: [{ tag: "path", attrs: { d: "M8 3.5l4.5 5H10v5H6v-5H3.5z", fill: "#e8503a" } }],
  },
  medium: {
    extraClass: "jira-priority-svg",
    shapes: [
      { tag: "path", attrs: { d: "M3 6.5h10v1.2H3zm0 2.8h10v1.2H3z", fill: "#e9a23b" } },
    ],
  },
  low: {
    extraClass: "jira-priority-svg",
    shapes: [{ tag: "path", attrs: { d: "M8 12.5l-4.5-5H6v-5h4v5h2.5z", fill: "#2a82c8" } }],
  },
  lowest: {
    extraClass: "jira-priority-svg",
    shapes: [{ tag: "path", attrs: { d: "M8 14l-5-6h3V2h4v6h3z", fill: "#3a82c8" } }],
  },
};

/**
 * Render a priority icon. Same resolution order as `renderIssueTypeIcon`:
 * iconUrl -> built-in SVG (matched on priority name) -> generic arrow.
 */
export function renderPriorityIcon(
  el: HTMLElement,
  iconUrl?: string,
  name?: string,
): void {
  el.empty();
  const safe = safeImageUrl(iconUrl);
  if (safe) {
    const img = createEl("img");
    img.src = safe;
    img.alt = name ?? "priority";
    img.className = "jira-icon-img";
    el.appendChild(img);
    return;
  }

  const matched = matchPriorityName(name);
  const icon = matched ? PRIORITY_ICONS[matched] : PRIORITY_ICONS.medium;
  el.appendChild(buildSvg(icon, name ?? "priority"));
}

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
 * one of the canonical buckets used in `PRIORITY_ICONS`.
 *
 * Strategy:
 *   1. Strip a leading "<digit>-" or "<digit>." (Jira sites often prefix).
 *   2. Drop any parenthetical qualifier.
 *   3. Lowercase + trim.
 *   4. Look for "highest" / "lowest" first (so "high" doesn't shadow them).
 */
export function matchPriorityName(
  name: string | undefined,
): keyof typeof PRIORITY_ICONS | undefined {
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

/** Stable palette index (0-7) based on a simple string hash. */
export function colorIndexForName(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 8;
}
