/**
 * OAuth 2.0 (3LO) Authorization Code flow with PKCE — pure logic.
 *
 * "Pure" means this module never touches global state directly. It exposes
 * helpers for generating PKCE artifacts, building the authorization URL, and
 * exchanging an authorization code for tokens. The orchestration layer
 * (`OAuthFlow` in this same file) wires those into the Obsidian-specific
 * pieces (protocol handler, browser open, settings persistence) injected at
 * construction time.
 *
 * This separation lets us:
 *   - Unit-test PKCE generation, URL building, and token-exchange wiring
 *     under Node/jsdom without mocking the entire Obsidian module surface.
 *   - Reuse the helpers for the future "discover OAuth scope" workflow if
 *     Atlassian adds scopes we need.
 */

import {
  OAUTH_AUTHORIZE_URL,
  OAUTH_CLIENT_ID,
  OAUTH_REDIRECT_URI,
  OAUTH_SCOPES,
  OAUTH_TOKEN_URL,
} from "../constants";

/* -------------------------------------------------------------------------- */
/* PKCE primitives                                                            */
/* -------------------------------------------------------------------------- */

/** Length of the PKCE code_verifier in bytes (RFC 7636: 43-128 base64url chars). */
const VERIFIER_BYTES = 32;

/**
 * Generate a cryptographically random PKCE code_verifier.
 *
 * Uses Web Crypto in browser/Obsidian, falls back to Node's crypto if
 * available (handy for Node tests).
 */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(VERIFIER_BYTES);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Node fallback for tests.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require("crypto") as typeof import("crypto");
    nodeCrypto.randomFillSync(bytes);
  }
  return base64UrlEncode(bytes);
}

/**
 * Compute the PKCE code_challenge from a verifier using S256.
 *
 *   challenge = base64url( SHA-256(verifier) )
 */
export async function computeCodeChallenge(verifier: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(verifier);
  if (typeof crypto !== "undefined" && crypto.subtle?.digest) {
    const buf = await crypto.subtle.digest("SHA-256", data);
    return base64UrlEncode(new Uint8Array(buf));
  }
  // Node fallback.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require("crypto") as typeof import("crypto");
  const hash = nodeCrypto.createHash("sha256").update(verifier).digest();
  return base64UrlEncode(new Uint8Array(hash));
}

/** Generate a random opaque state string for CSRF protection. */
export function generateState(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require("crypto") as typeof import("crypto");
    nodeCrypto.randomFillSync(bytes);
  }
  return base64UrlEncode(bytes);
}

/** RFC 4648 base64url (no padding). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  const b64 =
    typeof btoa !== "undefined" ? btoa(str) : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/* -------------------------------------------------------------------------- */
/* URL builders                                                               */
/* -------------------------------------------------------------------------- */

export interface AuthorizationParams {
  state: string;
  codeChallenge: string;
}

/**
 * Build the full Atlassian authorization URL the user's browser should open.
 *
 * @param params - random state + PKCE code_challenge created for this attempt.
 * @returns URL string suitable for `window.open` / `Platform.openExternal`.
 */
export function buildAuthorizationUrl(params: AuthorizationParams): string {
  assertClientIdConfigured();
  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set("audience", "api.atlassian.com");
  url.searchParams.set("client_id", OAUTH_CLIENT_ID);
  url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
  url.searchParams.set("state", params.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/**
 * Throw a friendly error if the bundled OAUTH_CLIENT_ID has not been replaced
 * with the user's own Atlassian Developer Console value. This is the most
 * common cause of "Sign in failed" — the placeholder client_id is never going
 * to authenticate against Atlassian.
 */
function assertClientIdConfigured(): void {
  if (
    !OAUTH_CLIENT_ID ||
    OAUTH_CLIENT_ID === "REPLACE_WITH_YOUR_ATLASSIAN_OAUTH_CLIENT_ID"
  ) {
    throw new OAuthError(
      0,
      "OAuth client_id is not configured. Edit src/constants.ts " +
        "(OAUTH_CLIENT_ID) and rebuild the plugin. See OAUTH_SETUP.md.",
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Token endpoint                                                             */
/* -------------------------------------------------------------------------- */

/** Shape returned by Atlassian's token endpoint. */
export interface TokenEndpointResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: "Bearer";
  scope?: string;
}

/** Pluggable HTTP function so callers can inject `requestUrl` or fetch. */
export type HttpPost = (
  url: string,
  body: Record<string, string>,
) => Promise<{ status: number; json: unknown; text: string }>;

/**
 * Exchange an authorization code for an access + refresh token pair.
 */
export async function exchangeCodeForTokens(
  http: HttpPost,
  params: { code: string; codeVerifier: string },
): Promise<TokenEndpointResponse> {
  const res = await http(OAUTH_TOKEN_URL, {
    grant_type: "authorization_code",
    client_id: OAUTH_CLIENT_ID,
    code: params.code,
    redirect_uri: OAUTH_REDIRECT_URI,
    code_verifier: params.codeVerifier,
  });
  if (res.status >= 200 && res.status < 300) {
    return parseTokenResponse(res);
  }
  throw new OAuthError(
    res.status,
    describeTokenError(res, "Token exchange failed"),
  );
}

/** Refresh an access token using the refresh_token grant. */
export async function refreshAccessToken(
  http: HttpPost,
  refreshToken: string,
): Promise<TokenEndpointResponse> {
  const res = await http(OAUTH_TOKEN_URL, {
    grant_type: "refresh_token",
    client_id: OAUTH_CLIENT_ID,
    refresh_token: refreshToken,
  });
  if (res.status >= 200 && res.status < 300) {
    return parseTokenResponse(res);
  }
  throw new OAuthError(
    res.status,
    describeTokenError(res, "Token refresh failed"),
  );
}

/**
 * Parse a successful token endpoint response, falling back to text->JSON
 * when the http layer didn't pre-parse `json` (the requestUrl wrapper in
 * main.ts swallows JSON parse errors so the body is reachable from `text`).
 */
function parseTokenResponse(res: {
  json: unknown;
  text: string;
}): TokenEndpointResponse {
  let payload = res.json as TokenEndpointResponse | null | undefined;
  if (!payload && res.text) {
    try {
      payload = JSON.parse(res.text) as TokenEndpointResponse;
    } catch {
      throw new OAuthError(
        0,
        `Token endpoint returned non-JSON response: ${truncate(res.text, 200)}`,
      );
    }
  }
  if (!payload || !payload.access_token) {
    throw new OAuthError(
      0,
      "Token endpoint response missing access_token.",
    );
  }
  return payload;
}

/**
 * Build a useful error message from a non-2xx token endpoint response.
 * Atlassian usually returns `{"error":"invalid_grant","error_description":"..."}`
 * which is much more actionable than just the HTTP status.
 */
function describeTokenError(
  res: { status: number; json: unknown; text: string },
  prefix: string,
): string {
  let parsed: { error?: string; error_description?: string } | undefined;
  if (res.json && typeof res.json === "object") {
    parsed = res.json as { error?: string; error_description?: string };
  } else if (res.text) {
    try {
      parsed = JSON.parse(res.text) as typeof parsed;
    } catch {
      // Not JSON — fall through.
    }
  }
  if (parsed?.error) {
    const desc = parsed.error_description ? `: ${parsed.error_description}` : "";
    return `${prefix} (HTTP ${res.status}): ${parsed.error}${desc}`;
  }
  return `${prefix}: ${truncate(res.text, 200) || `HTTP ${res.status}`}`;
}

function truncate(s: string, max: number): string {
  if (!s) return s;
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export class OAuthError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "OAuthError";
  }
}
