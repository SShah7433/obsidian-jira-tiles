/**
 * API-token (Basic auth) helpers.
 *
 * Atlassian Cloud's "API token" mechanism uses HTTP Basic auth where the
 * username is the user's account email and the password is the token they
 * generated at https://id.atlassian.com/manage-profile/security/api-tokens.
 *
 * This module is intentionally tiny — token validation and persistence happen
 * in the SettingsTab; the AuthManager just needs the request header and the
 * resolved base URL.
 */

import type { ApiTokenState } from "../settings/types";

/**
 * Build the Basic Authorization header value for an API-token credential.
 *
 * @example
 *   buildBasicAuthHeader({ email: "a@b.com", token: "xyz", siteUrl: "..." })
 *   // → "Basic YUBiLmNvbTp4eXo="
 */
export function buildBasicAuthHeader(state: ApiTokenState): string {
  const raw = `${state.email}:${state.token}`;
  // btoa is available in browser (Obsidian) and jsdom (tests). Buffer fallback
  // exists for plain-Node contexts (esbuild config, scripts).
  const encoded =
    typeof btoa !== "undefined"
      ? btoa(raw)
      : Buffer.from(raw, "utf-8").toString("base64");
  return `Basic ${encoded}`;
}

/**
 * Normalize a user-entered site URL to "https://host" with no trailing slash.
 *
 * Accepts:
 *   - "acme.atlassian.net"            -> "https://acme.atlassian.net"
 *   - "https://acme.atlassian.net/"   -> "https://acme.atlassian.net"
 *   - "http://acme.atlassian.net"     -> "https://acme.atlassian.net" (force TLS)
 */
export function normalizeSiteUrl(input: string): string {
  let s = input.trim();
  if (!s) return s;
  // Force https — Atlassian Cloud requires it; user error otherwise.
  s = s.replace(/^http:\/\//i, "https://");
  if (!/^https?:\/\//i.test(s)) {
    s = "https://" + s;
  }
  // Remove trailing slashes.
  s = s.replace(/\/+$/, "");
  return s;
}

/**
 * Lightweight predicate to pre-validate an ApiTokenState before saving.
 * Does not call the network — that's `validateApiToken` in the AuthManager.
 */
export function isApiTokenStateComplete(
  state: Partial<ApiTokenState> | undefined,
): state is ApiTokenState {
  if (!state) return false;
  return Boolean(
    state.siteUrl &&
      state.email &&
      state.token &&
      /^https:\/\/.+/i.test(state.siteUrl) &&
      /@/.test(state.email),
  );
}
