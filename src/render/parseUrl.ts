/**
 * Parser for Jira browse URLs, used by the auto-link render mode.
 *
 * A Jira Cloud issue URL looks like:
 *   https://acme.atlassian.net/browse/PROJ-123
 *   https://acme.atlassian.net/browse/PROJ-123?focusedCommentId=...
 *   https://acme.atlassian.net/jira/software/projects/PROJ/boards/1?selectedIssue=PROJ-123
 *
 * We only auto-convert links that point at the *configured* Jira site, so an
 * unrelated `/browse/...` URL on some other host is never touched.
 */

import { ISSUE_KEY_PATTERN } from "./parseBlock";

/** Extract the issue key from a Jira URL, or null if it isn't one we handle. */
export function issueKeyFromUrl(
  url: string,
  siteUrl: string | undefined,
): string | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // Restrict to the configured site host. When no site is configured we
  // can't know which hosts are "ours", so we decline (auto-link is only
  // meaningful once a site is set).
  if (!siteUrl) return null;
  let siteHost: string;
  try {
    siteHost = new URL(siteUrl).host.toLowerCase();
  } catch {
    return null;
  }
  if (parsed.host.toLowerCase() !== siteHost) return null;

  // 1. /browse/PROJ-123  (the canonical issue URL)
  const browseMatch = parsed.pathname.match(/\/browse\/([A-Za-z][A-Za-z0-9_]+-\d+)\/?$/);
  if (browseMatch) {
    const key = browseMatch[1].toUpperCase();
    return ISSUE_KEY_PATTERN.test(key) ? key : null;
  }

  // 2. ?selectedIssue=PROJ-123  (board/backlog deep links)
  const selected = parsed.searchParams.get("selectedIssue");
  if (selected) {
    const key = selected.toUpperCase();
    return ISSUE_KEY_PATTERN.test(key) ? key : null;
  }

  return null;
}

/**
 * Quick predicate: does this href look like it *could* be a Jira issue URL
 * for the configured site? Used to cheaply skip non-matching anchors before
 * the fuller parse.
 */
export function looksLikeJiraIssueUrl(
  url: string,
  siteUrl: string | undefined,
): boolean {
  return issueKeyFromUrl(url, siteUrl) !== null;
}
