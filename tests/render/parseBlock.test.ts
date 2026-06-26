/**
 * Tests for src/render/parseBlock.ts
 */

import {
  InvalidJiraBlockError,
  ISSUE_KEY_PATTERN,
  parseBlock,
  parseBlockMulti,
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

  it("leaves compact undefined (inherit default) for a bare key", () => {
    expect(parseBlock("PROJ-123").compact).toBeUndefined();
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

describe("parseBlock — inline flags", () => {
  it("parses `!compact` after the key", () => {
    expect(parseBlock("PROJ-1 !compact")).toEqual({
      key: "PROJ-1",
      compact: true,
    });
  });

  it("parses `!full` after the key", () => {
    expect(parseBlock("PROJ-1 !full")).toEqual({
      key: "PROJ-1",
      compact: false,
    });
  });

  it("is case-insensitive for flags and key", () => {
    expect(parseBlock("proj-1 !COMPACT")).toEqual({
      key: "PROJ-1",
      compact: true,
    });
  });

  it("tolerates extra whitespace between key and flag", () => {
    expect(parseBlock("PROJ-1    !full")).toEqual({
      key: "PROJ-1",
      compact: false,
    });
  });

  it("throws on an unknown flag so typos surface", () => {
    expect(() => parseBlock("PROJ-1 !smol")).toThrow(InvalidJiraBlockError);
    expect(() => parseBlock("PROJ-1 compactx")).toThrow(InvalidJiraBlockError);
  });

  it("the last flag wins when both are given", () => {
    expect(parseBlock("PROJ-1 !compact !full").compact).toBe(false);
    expect(parseBlock("PROJ-1 !full !compact").compact).toBe(true);
  });
});

describe("parseBlock — kv form", () => {
  it("parses key:value with no compact preference", () => {
    expect(parseBlock("key: PROJ-1")).toEqual({
      key: "PROJ-1",
      compact: undefined,
    });
  });

  it("supports compact:true", () => {
    expect(parseBlock("key: PROJ-1\ncompact: true")).toEqual({
      key: "PROJ-1",
      compact: true,
    });
  });

  it("supports compact:false", () => {
    expect(parseBlock("key: PROJ-1\ncompact: false")).toEqual({
      key: "PROJ-1",
      compact: false,
    });
  });

  it("accepts yes/no and 1/0 spellings", () => {
    expect(parseBlock("key: PROJ-1\ncompact: yes").compact).toBe(true);
    expect(parseBlock("key: PROJ-1\ncompact: 1").compact).toBe(true);
    expect(parseBlock("key: PROJ-1\ncompact: no").compact).toBe(false);
    expect(parseBlock("key: PROJ-1\ncompact: 0").compact).toBe(false);
  });

  it("treats an unrecognised compact value as no preference", () => {
    expect(parseBlock("key: PROJ-1\ncompact: maybe").compact).toBeUndefined();
  });

  it("throws when key is missing", () => {
    expect(() => parseBlock("compact: true")).toThrow(InvalidJiraBlockError);
  });

  it("throws when key is not a valid Jira key", () => {
    expect(() => parseBlock("key: not-valid")).toThrow(InvalidJiraBlockError);
  });
});

describe("parseBlockMulti — multiple keys", () => {
  it("returns one request per non-comment line, in order", () => {
    expect(parseBlockMulti("ABC-1\nABC-2\nABC-3")).toEqual([
      { key: "ABC-1", compact: undefined },
      { key: "ABC-2", compact: undefined },
      { key: "ABC-3", compact: undefined },
    ]);
  });

  it("applies per-line flags independently", () => {
    expect(parseBlockMulti("ABC-1\nABC-2 !compact\nABC-3 !full")).toEqual([
      { key: "ABC-1", compact: undefined },
      { key: "ABC-2", compact: true },
      { key: "ABC-3", compact: false },
    ]);
  });

  it("skips comment and blank lines", () => {
    expect(parseBlockMulti("# heading\nABC-1\n\n# note\nABC-2")).toEqual([
      { key: "ABC-1", compact: undefined },
      { key: "ABC-2", compact: undefined },
    ]);
  });

  it("throws if any line has an invalid key", () => {
    expect(() => parseBlockMulti("ABC-1\nnot-a-key")).toThrow(
      InvalidJiraBlockError,
    );
  });

  it("throws if any line has an unknown flag", () => {
    expect(() => parseBlockMulti("ABC-1\nABC-2 !smol")).toThrow(
      InvalidJiraBlockError,
    );
  });

  it("throws for an empty block", () => {
    expect(() => parseBlockMulti("")).toThrow(InvalidJiraBlockError);
  });

  it("treats the KV form as a single request", () => {
    expect(parseBlockMulti("key: PROJ-1\ncompact: true")).toEqual([
      { key: "PROJ-1", compact: true },
    ]);
  });

  it("parseBlock returns the first request of a multi-key block", () => {
    expect(parseBlock("ABC-1\nABC-2 !compact")).toEqual({
      key: "ABC-1",
      compact: undefined,
    });
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
