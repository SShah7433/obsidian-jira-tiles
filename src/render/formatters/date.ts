/**
 * Date formatter — accepts ISO 8601 strings (date-only or full datetime) and
 * renders them in the user's locale, with the original timestamp tucked into
 * a `title` attribute for hover.
 */

import { createEl, createFragment } from "../dom";

export function formatDate(iso: string): DocumentFragment {
  const frag = createFragment();
  const span = createEl("span");
  span.title = iso;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    span.textContent = iso;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    // Date-only — avoid timezone shifts by rendering UTC components.
    span.textContent = parsed.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  } else {
    span.textContent = parsed.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  frag.append(span);
  return frag;
}
