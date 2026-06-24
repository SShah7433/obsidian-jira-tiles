/**
 * User formatter — renders avatar (or initials) + display name.
 */

import type { JiraUser } from "../../jira/types";

/** Color palette for initial-avatar fallback (deterministic by name hash). */
const INITIAL_BG_COLORS = [
  "#0747a6", "#5243aa", "#bf2600", "#ff8b00",
  "#006644", "#00a3bf", "#403294", "#974f0c",
];

export function formatUser(user: JiraUser): DocumentFragment {
  const frag = document.createDocumentFragment();
  const avatarUrl =
    user.avatarUrls?.["24x24"] ?? user.avatarUrls?.["32x32"] ?? user.avatarUrls?.["16x16"];
  const name = user.displayName ?? user.emailAddress ?? user.accountId ?? "Unknown";

  if (avatarUrl) {
    const img = document.createElement("img");
    img.className = "jira-tile-assignee-avatar";
    img.src = avatarUrl;
    img.alt = "";
    img.loading = "lazy";
    img.width = 20;
    img.height = 20;
    frag.appendChild(img);
  } else {
    // Initials fallback — first letter of first two words.
    const parts = name.split(/\s+/).slice(0, 2);
    const initials = parts.map((p) => p[0] ?? "").join("").toUpperCase() || "?";
    const span = document.createElement("span");
    span.className = "jira-tile-assignee-avatar";
    span.textContent = initials;
    span.style.background = pickColor(name);
    span.style.color = "white";
    span.style.display = "inline-flex";
    span.style.alignItems = "center";
    span.style.justifyContent = "center";
    span.style.fontSize = "0.65rem";
    span.style.fontWeight = "600";
    frag.appendChild(span);
  }

  const text = document.createElement("span");
  text.textContent = name;
  frag.appendChild(text);
  return frag;
}

/** Stable color choice based on a simple string hash. */
function pickColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return INITIAL_BG_COLORS[h % INITIAL_BG_COLORS.length];
}
