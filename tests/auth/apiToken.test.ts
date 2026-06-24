/**
 * Tests for src/auth/apiToken.ts
 */

import {
  buildBasicAuthHeader,
  isApiTokenStateComplete,
  normalizeSiteUrl,
} from "../../src/auth/apiToken";

describe("buildBasicAuthHeader", () => {
  it("base64-encodes email:token in a Basic header", () => {
    const header = buildBasicAuthHeader({
      email: "alice@example.com",
      token: "supersecret",
    });
    expect(header).toBe("Basic " + btoa("alice@example.com:supersecret"));
  });

  it("handles unicode in email/token", () => {
    const header = buildBasicAuthHeader({
      email: "üser@example.com",
      token: "tøken",
    });
    expect(header.startsWith("Basic ")).toBe(true);
  });
});

describe("normalizeSiteUrl", () => {
  it("adds https:// when missing", () => {
    expect(normalizeSiteUrl("acme.atlassian.net")).toBe(
      "https://acme.atlassian.net",
    );
  });

  it("upgrades http:// to https://", () => {
    expect(normalizeSiteUrl("http://acme.atlassian.net")).toBe(
      "https://acme.atlassian.net",
    );
  });

  it("strips trailing slashes", () => {
    expect(normalizeSiteUrl("https://acme.atlassian.net///")).toBe(
      "https://acme.atlassian.net",
    );
  });

  it("preserves https:// inputs", () => {
    expect(normalizeSiteUrl("https://acme.atlassian.net")).toBe(
      "https://acme.atlassian.net",
    );
  });

  it("returns empty string for empty input", () => {
    expect(normalizeSiteUrl("")).toBe("");
    expect(normalizeSiteUrl("   ")).toBe("");
  });

  it("trims whitespace", () => {
    expect(normalizeSiteUrl("   acme.atlassian.net  ")).toBe(
      "https://acme.atlassian.net",
    );
  });
});

describe("isApiTokenStateComplete", () => {
  const ok = {
    siteUrl: "https://acme.atlassian.net",
    email: "alice@example.com",
    tokenSecretName: "jira-tiles:api-token",
  };

  it("returns true for fully populated state", () => {
    expect(isApiTokenStateComplete(ok)).toBe(true);
  });

  it("returns false for missing fields", () => {
    expect(isApiTokenStateComplete(undefined)).toBe(false);
    expect(isApiTokenStateComplete({})).toBe(false);
    expect(isApiTokenStateComplete({ ...ok, siteUrl: "" })).toBe(false);
    expect(isApiTokenStateComplete({ ...ok, email: "" })).toBe(false);
    expect(isApiTokenStateComplete({ ...ok, tokenSecretName: "" })).toBe(false);
  });

  it("rejects non-https site URLs", () => {
    expect(isApiTokenStateComplete({ ...ok, siteUrl: "ftp://x" })).toBe(false);
  });

  it("rejects invalid email-shaped strings", () => {
    expect(isApiTokenStateComplete({ ...ok, email: "not-an-email" })).toBe(
      false,
    );
  });
});
