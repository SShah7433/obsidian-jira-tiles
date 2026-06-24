/**
 * Persisted plugin settings shape.
 *
 * The full PluginSettings object is what `plugin.loadData()` returns and what
 * `plugin.saveData()` writes to <vault>/.obsidian/plugins/<id>/data.json. Tokens
 * live here in plain text — see SECURITY.md / SettingsTab warning banner.
 */

/** Authentication strategy currently active. */
export type AuthMethod = "oauth" | "apiToken" | "none";

/** Persisted OAuth state after a successful 3LO + PKCE flow. */
export interface OAuthState {
  /** Bearer access token. Short-lived (~1h on Atlassian Cloud). */
  accessToken: string;
  /** Refresh token used to mint new access tokens (long-lived but rotatable). */
  refreshToken: string;
  /** Unix epoch (ms) at which `accessToken` expires. */
  expiresAt: number;
  /** Atlassian Cloud site identifier resolved during setup. */
  cloudId: string;
  /** Human-friendly site URL (e.g. `https://acme.atlassian.net`). */
  siteUrl: string;
  /** Display name of the site, surfaced in the settings UI. */
  siteName: string;
}

/** Persisted API token state (Basic auth fallback). */
export interface ApiTokenState {
  /** Site URL with no trailing slash (e.g. `https://acme.atlassian.net`). */
  siteUrl: string;
  /** Atlassian account email associated with the token. */
  email: string;
  /** Atlassian account API token (https://id.atlassian.com/manage-profile/security/api-tokens). */
  token: string;
}

/**
 * One configured custom field that should be displayed on tiles.
 *
 * `id` is the raw Jira field id (e.g. `customfield_10020`). `label` is the
 * user-friendly name shown in the tile. `enabled` lets users keep multiple
 * configs around and toggle them without deleting.
 */
export interface CustomFieldConfig {
  id: string;
  label: string;
  enabled: boolean;
}

/** Top-level settings object persisted by Obsidian. */
export interface PluginSettings {
  /** Which auth method is currently active. */
  authMethod: AuthMethod;
  /** OAuth state, present only when authMethod === "oauth". */
  oauth?: OAuthState;
  /** API token state, present only when authMethod === "apiToken". */
  apiToken?: ApiTokenState;

  /* Standard field display toggles ----------------------------------------- */
  showStatus: boolean;
  showPriority: boolean;
  showAssignee: boolean;
  showDueDate: boolean;
  /** Show the issue-type icon in the tile header (next to the summary). */
  showIssueType: boolean;
  /** Show a labeled "Issue Type" field in the body grid (icon + name). */
  showIssueTypeField: boolean;

  /** Cache TTL in minutes; controls when tiles auto-refresh. */
  cacheTtlMinutes: number;

  /** User-configured custom fields shown on tiles, in display order. */
  customFields: CustomFieldConfig[];

  /**
   * Whether to acknowledge the data.json plain-text storage warning. Once true,
   * the warning banner collapses to a less prominent reminder.
   */
  storageWarningAcknowledged: boolean;
}
