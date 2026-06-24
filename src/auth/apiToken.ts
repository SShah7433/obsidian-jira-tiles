/**
 * API-token (Basic auth) helpers.
 *
 * Atlassian Cloud's "API token" mechanism uses HTTP Basic auth where the
 * username is the user's account email and the password is the token they
 * generated at https://id.atlassian.com/manage-profile/security/api-tokens.
 *
 * The token value lives in Obsidian's SecretStorage (resolved at request
 * time by the AuthManager). The Basic-auth header builder takes the email
 * and the resolved token value — it does NOT touch settings, so it stays
 * trivially testable.
 */

import type { ApiTokenState } from "../settings/types";

/**
 * Build the Basic Authorization header value for an API-token credential.
 *
 * @example
 *   buildBasicAuthHeader({ email: "a@b.com", token: "xyz", siteUrl: "..." })
 *   // → "Basic YUBiLmNvbTp4eXo="
 */
export function buildBasicAuthHeader(creds: {
  email: string;
  token: string;
}): string {
  const raw = `${creds.email}:${creds.token}`;
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
 * Checks shape only — does NOT verify the named secret resolves; do that in
 * the SettingsTab's activate handler via the SecretsService.
 */
export function isApiTokenStateComplete(
  state: Partial<ApiTokenState> | undefined,
): state is ApiTokenState {
  if (!state) return false;
  return Boolean(
    state.siteUrl &&
      state.email &&
      state.tokenSecretName &&
      /^https:\/\/.+/i.test(state.siteUrl) &&
      /@/.test(state.email),
  );
}
