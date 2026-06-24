/**
 * Tests for src/render/parseBlock.ts
 */

import {
  InvalidJiraBlockError,
  ISSUE_KEY_PATTERN,
  parseBlock,
} from "../../src/render/parseBlock";

describe("parseBlock — single-line form", () => {
  it("parses a bare issue key", () => {
    expect(parseBlock("PROJ-123")).toEqual({ key: "PROJ-123" });
  });

  it("trims whitespace and uppercases", () => {
    expect(parseBlock("  proj-123  ")).toEqual({ key: "PROJ-123" });
  });

  it("ignores comment lines starting with #", () => {
    expect(parseBlock("# comment\nPROJ-12")).toEqual({ key: "PROJ-12" });
  });

  it("accepts keys with underscores in the project prefix", () => {
    expect(parseBlock("PROJ_X-9")).toEqual({ key: "PROJ_X-9" });
  });

  it("throws for empty content", () => {
    expect(() => parseBlock("")).toThrow(InvalidJiraBlockError);
    expect(() => parseBlock("   \n   ")).toThrow(InvalidJiraBlockError);
    expect(() => parseBlock("# just a comment")).toThrow(InvalidJiraBlockError);
  });

  it("throws for malformed keys", () => {
    expect(() => parseBlock("not-an-issue")).toThrow(InvalidJiraBlockError);
    expect(() => parseBlock("123-abc")).toThrow(InvalidJiraBlockError);
    expect(() => parseBlock("PROJ123")).toThrow(InvalidJiraBlockError);
  });
});

describe("parseBlock — kv form", () => {
  it("parses key:value", () => {
    expect(parseBlock("key: PROJ-1")).toEqual({ key: "PROJ-1", compact: false });
  });

  it("supports compact:true", () => {
    expect(parseBlock("key: PROJ-1\ncompact: true")).toEqual({
      key: "PROJ-1",
      compact: true,
    });
  });

  it("supports compact:false implicit", () => {
    expect(parseBlock("key: PROJ-1\ncompact: false")).toEqual({
      key: "PROJ-1",
      compact: false,
    });
  });

  it("throws when key is missing", () => {
    expect(() => parseBlock("compact: true")).toThrow(InvalidJiraBlockError);
  });

  it("throws when key is not a valid Jira key", () => {
    expect(() => parseBlock("key: not-valid")).toThrow(InvalidJiraBlockError);
  });
});

describe("ISSUE_KEY_PATTERN", () => {
  it("matches valid keys", () => {
    expect(ISSUE_KEY_PATTERN.test("PROJ-1")).toBe(true);
    expect(ISSUE_KEY_PATTERN.test("ABC-12345")).toBe(true);
    expect(ISSUE_KEY_PATTERN.test("AB-1")).toBe(true);
  });

  it("rejects invalid keys", () => {
    expect(ISSUE_KEY_PATTERN.test("A-1")).toBe(false); // single-letter prefix
    expect(ISSUE_KEY_PATTERN.test("proj-1")).toBe(false); // lowercase
    expect(ISSUE_KEY_PATTERN.test("PROJ-")).toBe(false);
    expect(ISSUE_KEY_PATTERN.test("PROJ-1a")).toBe(false);
  });
});
