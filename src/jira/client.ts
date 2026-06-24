/**
 * Jira REST client.
 *
 * Thin wrapper around Obsidian's `requestUrl` (which works in the sandboxed
 * desktop + mobile environments without CORS issues). The client knows about:
 *
 *   - Auth context resolution (delegated to AuthManager)
 *   - One-shot retry on 401 when the auth context is `refreshable` (OAuth)
 *   - Structured `JiraApiError` for all non-2xx responses
 *   - URL construction for Cloud REST v3
 *
 * The client does NOT cache; that is the cache layer's job. The client also
 * does not de-duplicate concurrent requests; the cache's `getOrFetch` does.
 */

import { requestUrl, type RequestUrlParam } from "obsidian";
import type { AuthContext, AuthManager } from "../auth/authManager";
import {
  DEFAULT_ISSUE_FIELDS,
  JIRA_REST_API_VERSION,
  REQUEST_TIMEOUT_MS,
} from "../constants";
import {
  type AccessibleResource,
  type JiraFieldMeta,
  type JiraIssue,
  JiraApiError,
} from "./types";

/** Constructor dependencies. */
export interface JiraClientDeps {
  authManager: AuthManager;
  /**
   * Optional override for `requestUrl` — used in dev mode and tests so the
   * harness can inject fixtures without monkey-patching the obsidian module.
   */
  request?: (p: RequestUrlParam) => Promise<{
    status: number;
    headers: Record<string, string>;
    text: string;
    json: unknown;
  }>;
}

export class JiraClient {
  private readonly request: NonNullable<JiraClientDeps["request"]>;

  constructor(private readonly deps: JiraClientDeps) {
    this.request =
      deps.request ??
      ((p) => requestUrl({ ...p, throw: false }) as ReturnType<NonNullable<JiraClientDeps["request"]>>);
  }

  /**
   * Fetch a single issue by key.
   *
   * @param key    Issue key (e.g. "PROJ-123") — case-insensitive on the wire,
   *               but Jira returns it uppercased.
   * @param fields Optional list of field IDs to request. Defaults to
   *               DEFAULT_ISSUE_FIELDS plus any custom fields passed in.
   * @throws JiraApiError on non-2xx (404 = issue not found, 401 = auth failure).
   */
  async getIssue(
    key: string,
    fields: readonly string[] = DEFAULT_ISSUE_FIELDS,
  ): Promise<JiraIssue> {
    const fieldsParam = fields.length ? `?fields=${fields.join(",")}` : "";
    const path = `/rest/api/${JIRA_REST_API_VERSION}/issue/${encodeURIComponent(
      key,
    )}${fieldsParam}`;
    console.log("[jira-tiles] getIssue", key, "path:", path);
    return this.send<JiraIssue>("GET", path);
  }

  /** Fetch metadata for all fields (used by the custom-field discovery picker). */
  async getFields(): Promise<JiraFieldMeta[]> {
    return this.send<JiraFieldMeta[]>(
      "GET",
      `/rest/api/${JIRA_REST_API_VERSION}/field`,
    );
  }

  /**
   * List Jira sites the OAuth access token can reach. Used during OAuth setup
   * to resolve `cloudId`. Always uses the auth.atlassian.com host directly,
   * not the per-site base URL.
   */
  async getAccessibleResources(
    accessToken: string,
  ): Promise<AccessibleResource[]> {
    const url = "https://api.atlassian.com/oauth/token/accessible-resources";
    console.log("[jira-tiles] GET", url);
    const res = await this.request({
      url,
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      throw: false,
    });
    console.log(
      "[jira-tiles] accessible-resources status:",
      res.status,
      "body length:",
      (res.text ?? "").length,
    );
    if (res.status >= 200 && res.status < 300) {
      // requestUrl's `.json` may have failed if Content-Type is missing;
      // fall back to parsing the text.
      let payload: unknown = res.json;
      if (!payload && res.text) {
        try {
          payload = JSON.parse(res.text);
        } catch {
          // ignore — surface as empty
        }
      }
      return (payload ?? []) as AccessibleResource[];
    }
    console.error(
      "[jira-tiles] accessible-resources error",
      res.status,
      res.text,
    );
    throw new JiraApiError(res.status, "Failed to list Jira sites", res.text);
  }

  /* ---------------------------------------------------------------------- */
  /* Internal                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Send a request through the active auth context, retrying once on 401 if
   * the context is refreshable (OAuth).
   */
  private async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    await this.deps.authManager.ensureFresh();
    let ctx = await this.deps.authManager.getContext();

    let res = await this.exec(method, ctx, path, body);

    if (res.status === 401 && ctx.refreshable) {
      // Force a refresh and retry once.
      await this.deps.authManager.forceRefresh();
      ctx = await this.deps.authManager.getContext();
      res = await this.exec(method, ctx, path, body);
    }

    if (res.status >= 200 && res.status < 300) {
      // requestUrl's `.json` may have failed if Content-Type is missing or
      // the body is empty. Fall back to JSON.parse(text) for robustness.
      let payload: unknown = res.json;
      if (payload === null || payload === undefined) {
        if (res.text) {
          try {
            payload = JSON.parse(res.text);
          } catch {
            // ignore
          }
        }
      }
      return payload as T;
    }

    // Diagnostic: log enough to tell apart "wrong site URL" from "user
    // doesn't have access" from "issue genuinely missing". We deliberately
    // include the *full URL* and *response body excerpt* so the user can
    // paste it into a real browser request to compare.
    console.error(
      "[jira-tiles] Jira request failed",
      JSON.stringify(
        {
          method,
          baseUrl: ctx.baseUrl,
          path,
          fullUrl: ctx.baseUrl + path,
          status: res.status,
          authMode: ctx.refreshable ? "oauth" : "apiToken",
          bodySnippet: (res.text ?? "").slice(0, 400),
        },
        null,
        2,
      ),
    );

    throw new JiraApiError(
      res.status,
      this.describeError(res.status, ctx.baseUrl, path),
      res.text,
    );
  }

  private async exec(
    method: string,
    ctx: AuthContext,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; headers: Record<string, string>; text: string; json: unknown }> {
    const url = ctx.baseUrl + path;
    const headers: Record<string, string> = {
      Authorization: ctx.authorizationHeader,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    // requestUrl doesn't expose AbortController; we wrap in a Promise.race
    // for a soft timeout. The underlying request will continue but the caller
    // will see a timeout error.
    return await Promise.race([
      this.request({
        url,
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        throw: false,
      }),
      this.timeoutPromise(),
    ]);
  }

  private timeoutPromise(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(
        () =>
          reject(
            new JiraApiError(
              0,
              `Request timed out after ${REQUEST_TIMEOUT_MS}ms`,
            ),
          ),
        REQUEST_TIMEOUT_MS,
      );
    });
  }

  private describeError(status: number, baseUrl?: string, path?: string): string {
    switch (status) {
      case 401:
        return "Authentication failed. Check your credentials in Jira Tiles settings.";
      case 403:
        return "You do not have permission to view this issue.";
      case 404:
        // Atlassian deliberately conflates 'issue does not exist' with 'you
        // don't have permission to view it' to prevent leaking issue keys.
        // Hint at the most common causes so the user knows where to look.
        return (
          "Issue not found (HTTP 404). This usually means one of:\n" +
          "  - The site URL is wrong (check Settings → Jira Tiles)\n" +
          "  - The API token's account can't see this issue\n" +
          "    (different from the user logged into Jira in your browser)\n" +
          "  - The issue genuinely doesn't exist on this site." +
          (baseUrl && path ? `\nRequested: ${baseUrl}${path}` : "")
        );
      case 429:
        return "Jira rate limit exceeded. Please wait and try again.";
      case 0:
      case 502:
      case 503:
      case 504:
        return "Jira is unreachable. Check your network connection.";
      default:
        return `Jira returned HTTP ${status}.`;
    }
  }
}
