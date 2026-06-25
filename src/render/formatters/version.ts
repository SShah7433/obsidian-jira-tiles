/**
 * Fix-versions array formatter.
 *
 * Jira's `fixVersions` field is `JiraVersion[]`. We render each version as a
 * small chip with a state hint:
 *   - released:   ✓ filled green pill (shipped)
 *   - unreleased: hollow chip (planned)
 *   - archived:   muted, struck-through
 *
 * Multiple versions are space-separated; each gets its own chip.
 */

import type { JiraVersion } from "../../jira/types";
import { createEl, createFragment } from "../dom";

export function formatVersionArray(versions: JiraVersion[]): DocumentFragment {
  const frag = createFragment();
  versions.forEach((v) => {
    const chip = createEl("span");
    chip.className = "jira-tile-version-chip";
    if (v.released) chip.classList.add("jira-tile-version-chip--released");
    if (v.archived) chip.classList.add("jira-tile-version-chip--archived");
    if (v.releaseDate) {
      // Hover-tooltip carries the ISO date for power users.
      chip.title = v.released
        ? `Released ${v.releaseDate}`
        : `Planned ${v.releaseDate}`;
    }
    chip.textContent = v.name ?? "(unnamed)";
    frag.appendChild(chip);
  });
  return frag;
}

/**
 * Predicate: array of objects that look like JiraVersion entries.
 * Used by the smart-formatter dispatcher to route version arrays to this
 * formatter rather than the generic option/sprint matchers.
 */
export function looksLikeVersionArray(arr: unknown[]): boolean {
  if (arr.length === 0) return false;
  return arr.every((x) => {
    if (!x || typeof x !== "object") return false;
    const v = x as Partial<JiraVersion>;
    // A JiraVersion has `name` plus at least one of the version-specific
    // flags (released / archived / releaseDate). We deliberately exclude
    // sprints, which have `state` / `startDate` / `endDate`, and option
    // arrays, which have a top-level `value` string.
    if (typeof v.name !== "string") return false;
    if ("state" in v && (x as { state?: unknown }).state !== undefined) {
      // Sprint shape — skip.
      return false;
    }
    if ("value" in v && typeof (v as { value?: unknown }).value === "string") {
      // Option shape — skip.
      return false;
    }
    return (
      "released" in v ||
      "archived" in v ||
      "releaseDate" in v ||
      // Bare {id,name,self} version objects (no flags) are still common.
      ("id" in v && "name" in v && !("displayName" in v) && !("accountId" in v))
    );
  });
}
