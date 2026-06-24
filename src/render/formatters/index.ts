/**
 * Smart custom-field formatters.
 *
 * The dispatcher inspects an arbitrary value pulled from `issue.fields[id]`
 * and routes to the most specific formatter that can render it nicely.
 * Anything unrecognized falls back to a `<code>JSON.stringify</code>` block.
 *
 * Each formatter returns a DocumentFragment so the caller can append it
 * directly into a tile cell. We use textContent + DOM construction (no
 * innerHTML) to avoid XSS regardless of what Jira returns.
 */

import type {
  JiraOption,
  JiraSprint,
  JiraUser,
  JiraVersion,
} from "../../jira/types";
import { formatUser } from "./user";
import { formatSprintArray } from "./sprint";
import { formatOption } from "./option";
import { formatDate } from "./date";
import { formatNumber } from "./number";
import { formatFallback } from "./fallback";
import { formatVersionArray, looksLikeVersionArray } from "./version";

/**
 * Detect the shape of `value` and render with the best-matching formatter.
 *
 * Priority order:
 *   1. null / undefined         -> em-dash
 *   2. JiraSprint[]             -> formatted sprint list (state-aware)
 *   3. JiraVersion[]            -> released/unreleased pill chips
 *   4. JiraOption[] / JiraUser[]-> comma-joined text or avatar list
 *   5. JiraUser (single object) -> avatar + name
 *   6. JiraOption (object with .value) -> text
 *   7. ISO date / datetime string      -> localized
 *   8. number / boolean                -> formatted
 *   9. Plain string                    -> string
 *  10. Anything else                   -> JSON fallback
 *
 * Sprint-array detection runs before version-array so that fields containing
 * both `state` (sprint) and `released` (version) — should that ever exist —
 * still go to the more specific sprint formatter.
 */
export function formatCustomField(value: unknown): DocumentFragment {
  const frag = document.createDocumentFragment();
  if (value === null || value === undefined) {
    frag.append(document.createTextNode("—"));
    return frag;
  }

  if (Array.isArray(value)) {
    if (looksLikeSprintArray(value)) {
      return formatSprintArray(value as JiraSprint[]);
    }
    if (looksLikeVersionArray(value)) {
      return formatVersionArray(value as JiraVersion[]);
    }
    if (value.length === 0) {
      frag.append(document.createTextNode("—"));
      return frag;
    }
    if (looksLikeOptionArray(value)) {
      const items = (value as JiraOption[])
        .map((o) => o.value ?? "")
        .filter(Boolean);
      frag.append(document.createTextNode(items.join(", ")));
      return frag;
    }
    if (looksLikeUserArray(value)) {
      (value as JiraUser[]).forEach((u, i) => {
        if (i > 0) frag.append(document.createTextNode(", "));
        frag.append(formatUser(u));
      });
      return frag;
    }
    // Heterogeneous array — fall back.
    return formatFallback(value);
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (looksLikeUser(obj)) {
      return formatUser(obj as JiraUser);
    }
    if (typeof obj.value === "string") {
      return formatOption(obj as JiraOption);
    }
    return formatFallback(obj);
  }

  if (typeof value === "string") {
    if (looksLikeIsoDate(value)) {
      return formatDate(value);
    }
    frag.append(document.createTextNode(value));
    return frag;
  }

  if (typeof value === "number") {
    return formatNumber(value);
  }

  if (typeof value === "boolean") {
    frag.append(document.createTextNode(value ? "Yes" : "No"));
    return frag;
  }

  return formatFallback(value);
}

/* -------------------------------------------------------------------------- */
/* Shape detection                                                            */
/* -------------------------------------------------------------------------- */

export function looksLikeUser(o: Record<string, unknown>): boolean {
  return (
    typeof o.displayName === "string" ||
    typeof o.accountId === "string" ||
    typeof o.emailAddress === "string"
  );
}

export function looksLikeUserArray(arr: unknown[]): boolean {
  return arr.length > 0 && arr.every((x) => x && typeof x === "object" && looksLikeUser(x as Record<string, unknown>));
}

export function looksLikeOptionArray(arr: unknown[]): boolean {
  return (
    arr.length > 0 &&
    arr.every((x) => x && typeof x === "object" && typeof (x as JiraOption).value === "string")
  );
}

/**
 * Sprint detection requires the `state` field — without it we can't tell the
 * difference between a sprint and a version (both have id+name+self).
 * Versions never have `state`, so this disambiguates.
 */
export function looksLikeSprintArray(arr: unknown[]): boolean {
  return (
    arr.length > 0 &&
    arr.every(
      (x) =>
        x &&
        typeof x === "object" &&
        typeof (x as JiraSprint).name === "string" &&
        typeof (x as JiraSprint).state === "string",
    )
  );
}

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function looksLikeIsoDate(s: string): boolean {
  return ISO_DATE_RE.test(s);
}
