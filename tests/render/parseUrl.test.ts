/**
 * Tests for src/render/parseUrl.ts
 */

import { issueKeyFromUrl, looksLikeJiraIssueUrl } from "../../src/render/parseUrl";

const SITE = "https://acme.atlassian.net";

describe("issueKeyFromUrl", () => {
  it("extracts the key from a canonical /browse/ URL", () => {
    expect(issueKeyFromUrl(`${SITE}/browse/PROJ-123`, SITE)).toBe("PROJ-123");
  });

  it("ignores a trailing slash", () => {
    expect(issueKeyFromUrl(`${SITE}/browse/PROJ-1/`, SITE)).toBe("PROJ-1");
  });

  it("ignores query strings and fragments", () => {
    expect(
      issueKeyFromUrl(`${SITE}/browse/PROJ-9?focusedCommentId=42#c`, SITE),
    ).toBe("PROJ-9");
  });

  it("uppercases the key", () => {
    expect(issueKeyFromUrl(`${SITE}/browse/proj-7`, SITE)).toBe("PROJ-7");
  });

  it("extracts ?selectedIssue= deep links", () => {
    expect(
      issueKeyFromUrl(
        `${SITE}/jira/software/projects/PROJ/boards/1?selectedIssue=PROJ-55`,
        SITE,
      ),
    ).toBe("PROJ-55");
  });

  it("rejects URLs on a different host", () => {
    expect(issueKeyFromUrl("https://evil.example.com/browse/PROJ-1", SITE)).toBeNull();
  });

  it("rejects a different Atlassian site", () => {
    expect(
      issueKeyFromUrl("https://other.atlassian.net/browse/PROJ-1", SITE),
    ).toBeNull();
  });

  it("returns null when no site is configured", () => {
    expect(issueKeyFromUrl(`${SITE}/browse/PROJ-1`, undefined)).toBeNull();
  });

  it("returns null for non-issue paths", () => {
    expect(issueKeyFromUrl(`${SITE}/wiki/spaces/HOME`, SITE)).toBeNull();
    expect(issueKeyFromUrl(`${SITE}/browse/`, SITE)).toBeNull();
  });

  it("rejects malformed keys", () => {
    expect(issueKeyFromUrl(`${SITE}/browse/PROJ`, SITE)).toBeNull();
    expect(issueKeyFromUrl(`${SITE}/browse/123-456`, SITE)).toBeNull();
  });

  it("returns null for non-URL strings", () => {
    expect(issueKeyFromUrl("not a url", SITE)).toBeNull();
    expect(issueKeyFromUrl("", SITE)).toBeNull();
  });

  it("matches host case-insensitively", () => {
    expect(
      issueKeyFromUrl("https://ACME.atlassian.net/browse/PROJ-1", SITE),
    ).toBe("PROJ-1");
  });
});

describe("looksLikeJiraIssueUrl", () => {
  it("is true for a matching issue URL", () => {
    expect(looksLikeJiraIssueUrl(`${SITE}/browse/PROJ-1`, SITE)).toBe(true);
  });
  it("is false for a non-issue URL", () => {
    expect(looksLikeJiraIssueUrl(`${SITE}/dashboard`, SITE)).toBe(false);
  });
});
