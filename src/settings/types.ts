/**
 * Persisted plugin settings shape.
 *
 * The full PluginSettings object is what `plugin.loadData()` returns and what
 * `plugin.saveData()` writes to <vault>/.obsidian/plugins/<id>/data.json.
 *
 * Secrets (API tokens, OAuth access/refresh tokens) are NOT stored here — they
 * are kept in Obsidian's `app.secretStorage` (added in Obsidian 1.5+). What
 * lives here is the *name* (key) under which the secret is stored. The
 * SecretsService in src/auth/secrets.ts resolves a name to its value at
 * request time. This keeps the on-disk data.json free of credentials.
 */

/** Authentication strategy currently active. */
export type AuthMethod = "oauth" | "apiToken" | "none";

/** Persisted OAuth state after a successful 3LO + PKCE flow. */
export interface OAuthState {
  /**
   * Name under which the access token is stored in SecretStorage.
   * The value itself is NOT in data.json.
   */
  accessTokenSecretName: string;
  /**
   * Name under which the refresh token is stored in SecretStorage.
   * The value itself is NOT in data.json.
   */
  refreshTokenSecretName: string;
  /** Unix epoch (ms) at which the access token expires. */
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
  /**
   * Name under which the API token is stored in SecretStorage.
   * Users pick this via the SecretComponent in settings — multiple plugins
   * can share the same secret name to reuse the same token.
   */
  tokenSecretName: string;
}

/** One configured custom field that should be displayed on tiles. */
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
  /** Show the "Fix Versions" labeled field with release-state chips. */
  showFixVersions: boolean;

  /** Cache TTL in minutes; controls when tiles auto-refresh. */
  cacheTtlMinutes: number;

  /** User-configured custom fields shown on tiles, in display order. */
  customFields: CustomFieldConfig[];

  /**
   * Whether the user has acknowledged the data.json storage notice.
   * Now far less alarming — secrets live in SecretStorage; data.json carries
   * site URLs, email, and feature toggles only.
   */
  storageWarningAcknowledged: boolean;

  /**
   * Indicates that we successfully migrated any pre-SecretStorage tokens
   * (which lived as plain text in this object) into SecretStorage. Set on
   * the migration's first successful run. Subsequent loads see this flag
   * and skip the migration path.
   */
  secretsMigrationComplete?: boolean;
}
