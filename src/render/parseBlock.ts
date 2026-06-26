/**
 * Parser for the contents of a ```jira fenced code block.
 *
 * Grammar: one or more non-empty lines, each a single issue key optionally
 * followed by flags. Each line becomes its own tile, so a block can embed
 * several issues at once:
 *
 *   ```jira
 *   PROJ-123
 *   ```
 *
 *   ```jira
 *   ABC-123
 *   ABC-321 !compact       ← force a compact (single-line) tile
 *   ABC-987 !full          ← force a full tile (overrides the global default)
 *   ```
 *
 * Forward-compatibility: we also accept a YAML-ish key:value form so options
 * can layer in without breaking existing notes. The KV form describes a
 * single issue:
 *
 *   ```jira
 *   key: PROJ-123
 *   compact: true
 *   ```
 *
 * Both styles produce `IssueRequest`s. The `compact` field is tri-state:
 *   - true       → explicitly compact
 *   - false      → explicitly full
 *   - undefined  → no preference; the caller applies the global default
 *                  (`PluginSettings.defaultCompact`).
 */

/** Validated, normalized contents of a ```jira block. */
export interface IssueRequest {
  /** Uppercased issue key, e.g. "PROJ-123". */
  key: string;
  /**
   * Whether to render a compact (single-line) tile.
   *   - `true`  → forced compact (`!compact` / `compact: true`)
   *   - `false` → forced full (`!full` / `compact: false`)
   *   - `undefined` → inherit the global `defaultCompact` setting.
   */
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
 * Parse a code block body into a single IssueRequest.
 *
 * Retained for callers that only need one issue. For the multi-key form use
 * {@link parseBlockMulti}; this returns the first issue in that list.
 *
 * @throws InvalidJiraBlockError when the content is empty or unparseable.
 */
export function parseBlock(source: string): IssueRequest {
  return parseBlockMulti(source)[0];
}

/**
 * Parse a code block body into one or more IssueRequests.
 *
 * - Terse form: each non-comment, non-empty line is `KEY [flags...]` and
 *   becomes its own request (in document order). This is how a single block
 *   embeds multiple issues.
 * - KV form (`key:`/`compact:`): describes exactly one issue and returns a
 *   single-element array.
 *
 * @throws InvalidJiraBlockError when the content is empty or any line is
 *         unparseable.
 */
export function parseBlockMulti(source: string): IssueRequest[] {
  const lines = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length === 0) {
    throw new InvalidJiraBlockError(
      "Empty block. Provide an issue key like `PROJ-123`.",
    );
  }

  // YAML-ish key:value form? At least one line is shaped like `key: VALUE`.
  // The KV form always describes a single issue.
  const isKvForm = lines.some((l) => /^[a-zA-Z_]+\s*:/.test(l));
  if (isKvForm) {
    return [parseKv(lines)];
  }

  // Otherwise every line is its own "KEY [flags...]" request.
  return lines.map((line) => parseKeyLine(line));
}

/**
 * Parse the terse first line: an issue key optionally followed by
 * whitespace-separated flags. Currently recognised flags:
 *   - `!compact` → compact tile
 *   - `!full`    → full tile
 * Unknown `!flags` are rejected so typos surface instead of silently no-op-ing.
 */
function parseKeyLine(line: string): IssueRequest {
  const tokens = line.split(/\s+/).filter((t) => t.length > 0);
  const keyToken = tokens[0];
  const flags = tokens.slice(1);

  let compact: boolean | undefined;
  for (const flag of flags) {
    const normalized = flag.toLowerCase();
    if (normalized === "!compact") {
      compact = true;
    } else if (normalized === "!full") {
      compact = false;
    } else {
      throw new InvalidJiraBlockError(
        `Unknown flag \`${flag}\`. Supported flags: \`!compact\`, \`!full\`.`,
      );
    }
  }

  return { key: normalizeKey(keyToken), compact };
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
  return { key: normalizeKey(key), compact: parseCompactValue(map.get("compact")) };
}

/**
 * Interpret a `compact:` KV value. Returns `undefined` (inherit the global
 * default) when the key is absent; otherwise maps truthy/falsy spellings.
 */
function parseCompactValue(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  // Unrecognised value: treat as "no preference" rather than throwing, so a
  // stray value doesn't break an otherwise-valid block.
  return undefined;
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
