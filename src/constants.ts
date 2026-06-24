/**
 * Centralized plugin constants.
 *
 * Anything that's shared across modules (URLs, OAuth scopes, default values,
 * placeholder identifiers) lives here. Keep this module dependency-free so it
 * can be imported anywhere without creating cycles.
 */

/** Plugin identifier — must match manifest.json `id`. */
export const PLUGIN_ID = "obsidian-jira-tiles";

/** Human-readable plugin name — used in notices and command labels. */
export const PLUGIN_NAME = "Jira Tiles";

/* -------------------------------------------------------------------------- */
/* Atlassian / OAuth                                                          */
/* -------------------------------------------------------------------------- */

/**
 * OAuth 2.0 (3LO) client_id for the bundled Atlassian app.
 *
 * IMPORTANT: This is intentionally left as a placeholder. The plugin author
 * (you) registers an OAuth app in https://developer.atlassian.com/console/myapps/
 * with the callback `obsidian://jira-tiles-auth-callback` and pastes the issued
 * client_id here before publishing. PKCE is used so no client_secret is needed.
 */
export const OAUTH_CLIENT_ID = "REPLACE_WITH_YOUR_ATLASSIAN_OAUTH_CLIENT_ID";

/** Atlassian authorization endpoint (browser-facing). */
export const OAUTH_AUTHORIZE_URL = "https://auth.atlassian.com/authorize";

/** Atlassian token endpoint (server-to-server, called via requestUrl). */
export const OAUTH_TOKEN_URL = "https://auth.atlassian.com/oauth/token";

/** Endpoint that lists Jira sites accessible to a given access_token. */
export const OAUTH_ACCESSIBLE_RESOURCES_URL =
  "https://api.atlassian.com/oauth/token/accessible-resources";

/** Scopes requested during the OAuth consent flow. */
export const OAUTH_SCOPES = [
  "read:jira-work",
  "read:jira-user",
  "offline_access", // required to receive a refresh_token
] as const;

/**
 * Custom URI scheme handler that Obsidian routes to our plugin via
 * `app.registerObsidianProtocolHandler`. Must be allow-listed exactly in the
 * Atlassian OAuth app's callback URL list.
 */
export const OAUTH_REDIRECT_URI = "obsidian://jira-tiles-auth-callback";

/** Refresh proactively if the access token expires within this many seconds. */
export const OAUTH_REFRESH_LEEWAY_SECONDS = 60;

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
] as const;

/* -------------------------------------------------------------------------- */
/* Cache                                                                      */
/* -------------------------------------------------------------------------- */

/** Default cache TTL in minutes if the user has not customized it. */
export const DEFAULT_CACHE_TTL_MINUTES = 5;

/** Hard upper bound on cache TTL exposed in the settings UI. */
export const MAX_CACHE_TTL_MINUTES = 60;
