/**
 * Persisted plugin settings shape.
 *
 * The full PluginSettings object is what `plugin.loadData()` returns and what
 * `plugin.saveData()` writes to <vault>/.obsidian/plugins/<id>/data.json.
 *
 * Secrets (the Atlassian API token) are NOT stored here — they live in
 * Obsidian's `app.secretStorage`. What lives here is the *name* (key) under
 * which the secret is stored. The SecretsService in src/auth/secrets.ts
 * resolves a name to its value at request time. This keeps the on-disk
 * data.json free of credentials.
 */

/**
 * Authentication strategy currently active.
 *
 * The plugin used to also support OAuth 2.0 (3LO). That was removed because
 * the Atlassian token endpoint was inconsistently reachable from the
 * Obsidian-bundled HTTP client and the public-client / PKCE story for
 * distributed plugins added more configuration surface than it was worth.
 * If you need SSO, generate an Atlassian API token from your SSO-linked
 * Atlassian account and use the API-token method.
 */
export type AuthMethod = "apiToken" | "none";

/** Persisted API token state (Basic auth). */
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

/**
 * How Jira issues are turned into tiles in a note.
 *
 *   - "code-block": only fenced ` ```jira ` blocks become tiles (explicit,
 *     predictable; the original behaviour).
 *   - "auto-link":  only inline Jira browse URLs (e.g.
 *     `https://acme.atlassian.net/browse/PROJ-1`) are auto-replaced with a
 *     tile. Code blocks are left untouched.
 *   - "both":       code blocks AND inline Jira URLs become tiles.
 */
export type RenderMode = "code-block" | "auto-link" | "both";

/** Top-level settings object persisted by Obsidian. */
export interface PluginSettings {
  /** Which auth method is currently active. */
  authMethod: AuthMethod;
  /** API token state, present only when authMethod === "apiToken". */
  apiToken?: ApiTokenState;

  /**
   * Which embedding syntax(es) are active. See {@link RenderMode}.
   * Auto-link mode only rewrites URLs that point at the configured Jira
   * site, so unrelated links are never touched.
   */
  renderMode: RenderMode;

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
   * Far less alarming than it once was — secrets live in SecretStorage;
   * data.json carries site URLs, email, and feature toggles only.
   */
  storageWarningAcknowledged: boolean;
}
