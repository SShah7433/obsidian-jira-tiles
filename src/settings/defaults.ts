/**
 * Default values for fresh plugin installs (or first load after an upgrade).
 *
 * `mergeWithDefaults` performs a shallow merge so users keep prior settings when
 * we add new fields — important since data.json is rewritten on save and any
 * field omitted here would be lost.
 */

import { DEFAULT_CACHE_TTL_MINUTES } from "../constants";
import type { PluginSettings } from "./types";

export const DEFAULT_SETTINGS: PluginSettings = {
  authMethod: "none",
  showStatus: true,
  showPriority: true,
  showAssignee: true,
  showDueDate: true,
  showIssueType: true,
  showIssueTypeField: true,
  showFixVersions: true,
  cacheTtlMinutes: DEFAULT_CACHE_TTL_MINUTES,
  customFields: [],
  storageWarningAcknowledged: false,
};

/**
 * Merge loaded settings with defaults, preserving user values where they exist.
 *
 * @param loaded Raw object pulled from `plugin.loadData()` (may be null/undefined
 *               on first run, or have a stale shape if the plugin was upgraded).
 * @returns A complete PluginSettings object suitable for use throughout the app.
 */
export function mergeWithDefaults(
  loaded: Partial<PluginSettings> | null | undefined,
): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(loaded ?? {}),
    // Arrays must be cloned, not shared by reference.
    customFields: (loaded?.customFields ?? DEFAULT_SETTINGS.customFields).map(
      (cf) => ({ ...cf }),
    ),
  };
}
