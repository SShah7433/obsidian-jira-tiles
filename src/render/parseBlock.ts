/**
 * Parser for the contents of a ```jira fenced code block.
 *
 * MVP grammar: a single non-empty line containing the issue key.
 *
 *   ```jira
 *   PROJ-123
 *   ```
 *
 * Forward-compatibility: we also accept a YAML-ish key:value form so future
 * options (compact, fields, refresh) can layer in without breaking existing
 * notes:
 *
 *   ```jira
 *   key: PROJ-123
 *   compact: true
 *   ```
 *
 * Both styles return an `IssueRequest`.
 */

/** Validated, lowercase-normalized contents of a ```jira block. */
export interface IssueRequest {
  /** Uppercased issue key, e.g. "PROJ-123". */
  key: string;
  /** Whether to render a compact (single-line) tile. Future use. */
  compact?: boolean;
}

/** Pattern matching valid Jira issue keys: project (2+ uppercase) + dash + integer. */
export const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]+-\d+$/;

export class InvalidJiraBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidJiraBlockError";
  }
}

/**
 * Parse a code block body into an IssueRequest.
 *
 * @throws InvalidJiraBlockError when the content is empty or unparseable.
 */
export function parseBlock(source: string): IssueRequest {
  const lines = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length === 0) {
    throw new InvalidJiraBlockError(
      "Empty block. Provide an issue key like `PROJ-123`.",
    );
  }

  // YAML-ish key:value form? At least one line contains a colon and the first
  // line is shaped like `key: VALUE`.
  const isKvForm = lines.some((l) => /^[a-zA-Z_]+\s*:/.test(l));
  if (isKvForm) {
    return parseKv(lines);
  }

  // Otherwise treat the first non-empty line as the key.
  return { key: normalizeKey(lines[0]) };
}

function parseKv(lines: string[]): IssueRequest {
  const map = new Map<string, string>();
  for (const line of lines) {
    const match = line.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
    if (!match) continue;
    map.set(match[1].toLowerCase(), match[2].trim());
  }
  const key = map.get("key");
  if (!key) {
    throw new InvalidJiraBlockError(
      "Missing `key` in jira block. Use `key: PROJ-123`.",
    );
  }
  const compactRaw = map.get("compact");
  const compact = compactRaw === "true" || compactRaw === "1";
  return { key: normalizeKey(key), compact };
}

function normalizeKey(raw: string): string {
  const k = raw.trim().toUpperCase();
  if (!ISSUE_KEY_PATTERN.test(k)) {
    throw new InvalidJiraBlockError(
      `\`${raw}\` is not a valid Jira issue key (expected e.g. PROJ-123).`,
    );
  }
  return k;
}
