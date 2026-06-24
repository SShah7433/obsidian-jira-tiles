/**
 * Field discovery — helpers for the "Discover fields from Jira" picker in the
 * settings tab.
 *
 * Workflow:
 *   1. UI calls `loadFields(client)` -> returns `JiraFieldMeta[]`.
 *   2. UI lets user filter by name (prefix or substring, case-insensitive).
 *   3. UI sorts by name; custom fields surfaced first when `customOnly` set.
 *   4. On user selection, UI calls back into `addCustomField` to push into
 *      settings.customFields.
 */

import type { JiraFieldMeta } from "./types";
import type { JiraClient } from "./client";

/** Wrapper around `JiraClient.getFields` so callers can be tested in isolation. */
export async function loadFields(client: JiraClient): Promise<JiraFieldMeta[]> {
  return client.getFields();
}

/**
 * Filter + sort helpers for the picker.
 *
 * @param fields    Field metadata from `loadFields`.
 * @param options   Filter behavior (search text, customOnly toggle, exclusions).
 * @returns         Filtered, sorted list (custom fields first when applicable).
 */
export function filterFields(
  fields: JiraFieldMeta[],
  options: {
    /** Substring filter, case-insensitive (matches name and id). */
    search?: string;
    /** When true, only show custom fields (`customfield_*`). */
    customOnly?: boolean;
    /** Field IDs already configured — excluded from results. */
    excludeIds?: readonly string[];
  } = {},
): JiraFieldMeta[] {
  const search = options.search?.toLowerCase().trim() ?? "";
  const exclude = new Set(options.excludeIds ?? []);

  return fields
    .filter((f) => {
      if (exclude.has(f.id)) return false;
      if (options.customOnly && !f.custom) return false;
      if (!search) return true;
      return (
        f.name.toLowerCase().includes(search) ||
        f.id.toLowerCase().includes(search)
      );
    })
    .sort((a, b) => {
      // Custom fields first when enabled, then alphabetical by name.
      if (options.customOnly) return a.name.localeCompare(b.name);
      if (a.custom !== b.custom) return a.custom ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Suggest a default display label for a field.
 *
 * Atlassian's `name` is usually fine. For ambiguous cases ("Sprint" vs
 * "Sprints", duplicate names), append the field id in parentheses.
 */
export function defaultLabel(field: JiraFieldMeta): string {
  return field.name || field.id;
}
