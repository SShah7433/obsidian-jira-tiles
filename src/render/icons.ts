/**
 * Inline SVG icons used by the tile renderer.
 *
 * We embed icons as DOM strings (kept short, no external deps) because:
 *   - Obsidian's `setIcon()` injects Lucide icons; we use it for built-in
 *     actions (refresh / external-link), but Jira issue type icons come from
 *     Atlassian as URL refs and we don't want to fetch them on mobile.
 *   - DocumentFragments make appending atomic.
 */

import { setIcon } from "obsidian";

/**
 * Append a refresh (rotate-cw) icon into `el`. Uses Obsidian's built-in
 * Lucide icon set.
 */
export function appendRefreshIcon(el: HTMLElement): void {
  setIcon(el, "rotate-cw");
}

/** Append an external-link icon into `el`. */
export function appendExternalLinkIcon(el: HTMLElement): void {
  setIcon(el, "external-link");
}

/**
 * Render an issue-type icon. Jira returns a URL on `issuetype.iconUrl`.
 * We use the URL when present (works in desktop), and fall back to a colored
 * letter chip when not (works in tests, dev preview, and mobile when offline).
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
    img.width = 20;
    img.height = 20;
    el.appendChild(img);
    return;
  }
  // Fallback: first letter of issue type name.
  const letter = (name?.[0] ?? "?").toUpperCase();
  const chip = document.createElement("span");
  chip.textContent = letter;
  chip.style.display = "inline-flex";
  chip.style.alignItems = "center";
  chip.style.justifyContent = "center";
  chip.style.width = "20px";
  chip.style.height = "20px";
  chip.style.borderRadius = "4px";
  chip.style.background = "var(--background-modifier-border)";
  chip.style.color = "var(--text-normal)";
  chip.style.fontSize = "0.7rem";
  chip.style.fontWeight = "600";
  el.appendChild(chip);
}
