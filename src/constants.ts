/**
 * Centralized plugin constants.
 *
 * Anything that's shared across modules (URLs, default values, placeholder
 * identifiers) lives here. Keep this module dependency-free so it can be
 * imported anywhere without creating cycles.
 */

/** Plugin identifier — must match manifest.json `id`. */
export const PLUGIN_ID = "obsidian-jira-tiles";

/** Human-readable plugin name — used in notices and command labels. */
export const PLUGIN_NAME = "Jira Tiles";

/* -------------------------------------------------------------------------- */
/* Jira REST                                                                  */
/* -------------------------------------------------------------------------- */

/** Jira Cloud REST API version path segment we always use. */
export const JIRA_REST_API_VERSION = "3";

/** Default network request timeout (ms). */
export const REQUEST_TIMEOUT_MS = 10_000;

/** Default issue fields fetched when none are configured. */
export const DEFAULT_ISSUE_FIELDS = [
  "summary",
  "status",
  "priority",
  "duedate",
  "assignee",
  "issuetype",
  "parent",
  "fixVersions",
] as const;

/* -------------------------------------------------------------------------- */
/* Cache                                                                      */
/* -------------------------------------------------------------------------- */

/** Default cache TTL in minutes if the user has not customized it. */
export const DEFAULT_CACHE_TTL_MINUTES = 5;

/** Hard upper bound on cache TTL exposed in the settings UI. */
export const MAX_CACHE_TTL_MINUTES = 60;
