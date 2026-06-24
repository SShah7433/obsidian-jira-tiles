/**
 * Type definitions covering the subset of Jira REST v3 responses we care about.
 *
 * These mirror the shape returned by `GET /rest/api/3/issue/{issueIdOrKey}`.
 * Every field is optional because Jira omits empty values and because the
 * exact set returned depends on the `?fields=` query parameter.
 *
 * We do NOT generate these from a swagger spec — Atlassian's spec is enormous
 * and most of it isn't relevant. Hand-curated keeps the type surface narrow
 * and easy to reason about.
 */

/** Avatar URL set returned for users, status icons, etc. */
export interface AvatarUrls {
  "16x16"?: string;
  "24x24"?: string;
  "32x32"?: string;
  "48x48"?: string;
}

/** Atlassian user object. */
export interface JiraUser {
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
  avatarUrls?: AvatarUrls;
  active?: boolean;
}

/** Workflow status with category color hint. */
export interface JiraStatus {
  id?: string;
  name?: string;
  statusCategory?: {
    id?: number;
    key?: string;
    /**
     * Atlassian's official category color names. The renderer maps these to
     * CSS classes (jira-tile-status--{colorName}).
     */
    colorName?:
      | "blue-gray"
      | "yellow"
      | "green"
      | "brown"
      | "warm-red"
      | "medium-gray";
    name?: string;
  };
}

/** Priority. */
export interface JiraPriority {
  id?: string;
  name?: string;
  iconUrl?: string;
}

/** Issue type. */
export interface JiraIssueType {
  id?: string;
  name?: string;
  iconUrl?: string;
  subtask?: boolean;
}

/** Sprint (custom-field shape — Jira returns this as an array). */
export interface JiraSprint {
  id?: number;
  name?: string;
  state?: "active" | "closed" | "future";
  startDate?: string;
  endDate?: string;
  goal?: string;
}

/** Single-/multi-select option. */
export interface JiraOption {
  id?: string;
  value?: string;
  self?: string;
}

/**
 * Project version (used for `fixVersions` and `versions`/affectsVersion).
 *
 * `released: true` means the version has been shipped; `archived: true` means
 * it's been archived (still readable, but generally hidden in UIs). The
 * renderer uses these flags to render different visual treatments.
 */
export interface JiraVersion {
  id?: string;
  name?: string;
  description?: string;
  /** ISO date string (yyyy-mm-dd) when the version was/will be released. */
  releaseDate?: string;
  released?: boolean;
  archived?: boolean;
  self?: string;
}

/**
 * The JSON returned for a single issue. `fields` is intentionally `unknown`-typed
 * for custom fields because their shape varies wildly; smart formatters narrow
 * the type at render time.
 */
export interface JiraIssue {
  id?: string;
  key: string;
  self?: string;
  fields: JiraIssueFields;
}

export interface JiraIssueFields {
  summary?: string;
  status?: JiraStatus;
  priority?: JiraPriority;
  issuetype?: JiraIssueType;
  duedate?: string | null;
  assignee?: JiraUser | null;
  reporter?: JiraUser | null;
  /** Project versions in which this issue is/will be fixed. Always an array. */
  fixVersions?: JiraVersion[];
  /** Project versions affected by this issue. Always an array. */
  versions?: JiraVersion[];
  /** Parent issue (for sub-tasks, epic links, etc.) — used in tile subtitle. */
  parent?: {
    id?: string;
    key?: string;
    fields?: {
      summary?: string;
      issuetype?: JiraIssueType;
      status?: JiraStatus;
    };
  };
  /** Anything not enumerated above — typically `customfield_*`. */
  [k: string]: unknown;
}

/** Field metadata returned by `GET /rest/api/3/field`. */
export interface JiraFieldMeta {
  id: string;
  name: string;
  custom: boolean;
  schema?: { type?: string; custom?: string; items?: string };
}

/** Result of `GET /oauth/token/accessible-resources`. */
export interface AccessibleResource {
  id: string;       // cloudId
  url: string;      // site URL
  name: string;     // human-friendly site name
  scopes: string[];
  avatarUrl?: string;
}

/** Structured error thrown by the Jira client. */
export class JiraApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "JiraApiError";
  }
}
