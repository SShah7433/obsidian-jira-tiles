/**
 * User formatter — renders avatar (or initials) + display name.
 */

import type { JiraUser } from "../../jira/types";
import { colorIndexForName, safeImageUrl } from "../icons";
import { createEl, createFragment } from "../dom";

export function formatUser(user: JiraUser): DocumentFragment {
  const frag = createFragment();
  const avatarUrl = safeImageUrl(
    user.avatarUrls?.["24x24"] ??
      user.avatarUrls?.["32x32"] ??
      user.avatarUrls?.["16x16"],
  );
  const name = user.displayName ?? user.emailAddress ?? user.accountId ?? "Unknown";

  if (avatarUrl) {
    const img = createEl("img");
    img.className = "jira-tile-assignee-avatar";
    img.src = avatarUrl;
    img.alt = "";
    img.loading = "lazy";
    img.width = 20;
    img.height = 20;
    frag.appendChild(img);
  } else {
    // Initials fallback — first letter of first two words. Colour comes from
    // a CSS class keyed off data-color-index (no hardcoded inline styles).
    const parts = name.split(/\s+/).slice(0, 2);
    const initials = parts.map((p) => p[0] ?? "").join("").toUpperCase() || "?";
    const span = createEl("span");
    span.className = "jira-tile-assignee-avatar jira-tile-avatar-initials";
    span.textContent = initials;
    span.dataset.colorIndex = String(colorIndexForName(name));
    frag.appendChild(span);
  }

  const text = createEl("span");
  text.textContent = name;
  frag.appendChild(text);
  return frag;
}
