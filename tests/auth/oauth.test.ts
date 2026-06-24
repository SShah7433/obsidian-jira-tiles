/**
 * Tests for src/auth/oauth.ts (PKCE primitives, URL builders, token endpoint).
 */

import {
  base64UrlEncode,
  buildAuthorizationUrl,
  computeCodeChallenge,
  exchangeCodeForTokens,
  generateCodeVerifier,
  generateState,
  OAuthError,
  refreshAccessToken,
} from "../../src/auth/oauth";
import {
  OAUTH_AUTHORIZE_URL,
  OAUTH_CLIENT_ID,
  OAUTH_REDIRECT_URI,
  OAUTH_SCOPES,
} from "../../src/constants";

describe("base64UrlEncode", () => {
  it("encodes per RFC 4648 (no padding, url-safe alphabet)", () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xff]);
    const encoded = base64UrlEncode(bytes);
    expect(encoded).not.toMatch(/=/);
    expect(encoded).not.toMatch(/\+/);
    expect(encoded).not.toMatch(/\//);
  });

  it("round-trips known sample", () => {
    // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    // base64url of that hash is well known.
    expect(base64UrlEncode(Uint8Array.from([0x2c, 0xf2, 0x4d]))).toBe("LPJN");
  });
});

describe("PKCE primitives", () => {
  it("generates a verifier with sufficient entropy and length", () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(v1).not.toBe(v2);
    // 32 bytes -> ceil(32 * 4 / 3) = ~43 chars after base64url with no padding.
    expect(v1.length).toBeGreaterThanOrEqual(43);
    expect(v1).toMatch(/^[A-Za-z0-9_\-]+$/);
  });

  it("computes a 43-char S256 challenge", async () => {
    const challenge = await computeCodeChallenge("hello");
    expect(challenge.length).toBe(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_\-]+$/);
  });

  it("S256(verifier) is deterministic", async () => {
    const c1 = await computeCodeChallenge("the-quick-brown-fox");
    const c2 = await computeCodeChallenge("the-quick-brown-fox");
    expect(c1).toBe(c2);
  });

  it("generateState produces unique random values", () => {
    expect(generateState()).not.toBe(generateState());
  });
});

describe("buildAuthorizationUrl", () => {
  it("produces a URL with all required params", () => {
    const url = buildAuthorizationUrl({
      state: "STATE",
      codeChallenge: "CHALLENGE",
    });
    expect(url.startsWith(OAUTH_AUTHORIZE_URL)).toBe(true);
    const u = new URL(url);
    expect(u.searchParams.get("client_id")).toBe(OAUTH_CLIENT_ID);
    expect(u.searchParams.get("redirect_uri")).toBe(OAUTH_REDIRECT_URI);
    expect(u.searchParams.get("scope")).toBe(OAUTH_SCOPES.join(" "));
    expect(u.searchParams.get("state")).toBe("STATE");
    expect(u.searchParams.get("code_challenge")).toBe("CHALLENGE");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("audience")).toBe("api.atlassian.com");
  });
});

describe("exchangeCodeForTokens", () => {
  it("posts the grant params and returns parsed tokens on 200", async () => {
    let received: { url?: string; body?: Record<string, string> } = {};
    const result = await exchangeCodeForTokens(
      async (url, body) => {
        received = { url, body };
        return {
          status: 200,
          json: {
            access_token: "AT",
            refresh_token: "RT",
            expires_in: 3600,
            token_type: "Bearer",
          },
          text: "",
        };
      },
      { code: "CODE", codeVerifier: "VER" },
    );
    expect(result.access_token).toBe("AT");
    expect(received.url).toBe("https://auth.atlassian.com/oauth/token");
    expect(received.body?.grant_type).toBe("authorization_code");
    expect(received.body?.code).toBe("CODE");
    expect(received.body?.code_verifier).toBe("VER");
    expect(received.body?.client_id).toBe(OAUTH_CLIENT_ID);
    expect(received.body?.redirect_uri).toBe(OAUTH_REDIRECT_URI);
  });

  it("throws OAuthError on non-2xx", async () => {
    await expect(
      exchangeCodeForTokens(
        async () => ({ status: 400, json: {}, text: "invalid_grant" }),
        { code: "CODE", codeVerifier: "VER" },
      ),
    ).rejects.toBeInstanceOf(OAuthError);
  });
});

describe("refreshAccessToken", () => {
  it("posts refresh_token grant", async () => {
    let body: Record<string, string> = {};
    await refreshAccessToken(
      async (_url, b) => {
        body = b;
        return {
          status: 200,
          json: {
            access_token: "AT2",
            refresh_token: "RT2",
            expires_in: 3600,
            token_type: "Bearer",
          },
          text: "",
        };
      },
      "OLD_RT",
    );
    expect(body.grant_type).toBe("refresh_token");
    expect(body.refresh_token).toBe("OLD_RT");
    expect(body.client_id).toBe(OAUTH_CLIENT_ID);
  });

  it("throws on failure", async () => {
    await expect(
      refreshAccessToken(
        async () => ({ status: 401, json: {}, text: "invalid_token" }),
        "RT",
      ),
    ).rejects.toBeInstanceOf(OAuthError);
  });
});
