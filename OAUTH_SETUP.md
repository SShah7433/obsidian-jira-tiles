# Atlassian OAuth 2.0 Setup

This document walks through registering a custom Atlassian OAuth 2.0 (3LO)
app for use with this plugin. You only need to do this once — the resulting
`client_id` is baked into a fork of the plugin's source.

This plugin uses **PKCE** (Proof Key for Code Exchange), which means the
OAuth flow does **not** require a `client_secret`. The `client_id` is
considered public and is safe to ship in a distributed plugin.

## When you need this

- You forked this plugin and want to ship your own build.
- You are running a private/self-hosted variant.
- You're contributing changes that affect OAuth behavior and want to test
  end-to-end against a real Atlassian Cloud account.

End users of the published plugin do **not** need to register an OAuth app —
they use the bundled `client_id`.

## Step-by-step

### 1. Create the OAuth 2.0 (3LO) app

1. Sign in to <https://developer.atlassian.com/console/myapps/>.
2. Click **Create** → **OAuth 2.0 integration**.
3. Give it a name (e.g. `Obsidian Jira Tiles — dev`) and accept the terms.

### 2. Configure permissions

1. Open the new app → **Permissions** in the left sidebar.
2. Add **Jira API**.
3. Click **Configure** next to it and grant the following scopes:
   - `read:jira-work` — to read issue data
   - `read:jira-user` — to read assignee profiles
4. Save.

### 3. Add the callback URL

1. Open **Authorization** in the left sidebar.
2. Under **OAuth 2.0 (3LO)**, click **Add**.
3. Set the **Callback URL** to exactly:

   ```
   obsidian://jira-tiles-auth-callback
   ```

   (Custom URI schemes are supported by Atlassian for installed apps.)

4. Save.

### 4. Note the credentials

1. Open **Settings** in the left sidebar.
2. Copy the **Client ID** value.
3. Ignore **Client Secret** — PKCE flows don't need it, and it is not used
   by this plugin.

### 5. Plumb the client ID into the plugin

Edit `src/constants.ts`:

```ts
export const OAUTH_CLIENT_ID = "PASTE_YOUR_CLIENT_ID_HERE";
```

Rebuild:

```bash
npm run build
```

Copy `main.js`, `manifest.json`, `styles.css` into your vault's
`.obsidian/plugins/obsidian-jira-tiles/` and reload the plugin.

### 6. Test the flow

1. Open *Settings → Jira Tiles*.
2. Click **Connect** in the OAuth section.
3. Your browser opens Atlassian's consent screen.
4. Approve.
5. Atlassian redirects to `obsidian://jira-tiles-auth-callback?code=...`.
6. Obsidian routes the URI to the plugin; the callback handler exchanges
   the code for tokens and discovers your `cloudId`.
7. The settings page should show **Connected** with your site name.

## Troubleshooting

### "Sign in failed" with no other detail

The plugin tries to surface the underlying error in a Notice, but if you only
see the generic "Sign in failed" or the Notice disappears too quickly, open
Obsidian's DevTools (Cmd/Ctrl-Shift-I on desktop) and look for log entries
prefixed with `[jira-tiles]`. Common causes:

| What the console shows | Cause + fix |
|---|---|
| `OAuth client_id is not configured` | You're running the unmodified plugin source. Edit `src/constants.ts` (`OAUTH_CLIENT_ID`) and rebuild. |
| `Token exchange failed (HTTP 400): invalid_grant` | The PKCE `code_verifier` did not match the `code_challenge` Atlassian remembered, OR the redirect URI in the OAuth app does not match `obsidian://jira-tiles-auth-callback` exactly. Re-check your Atlassian Developer Console settings. |
| `Token exchange failed (HTTP 401): invalid_client` | The `client_id` baked into `src/constants.ts` does not match a real Atlassian OAuth app, or the app was deleted. |
| `Atlassian returned access_denied: …` | You clicked Cancel/Reject in the consent screen, or the OAuth app's Permissions don't include the requested scopes (`read:jira-work`, `read:jira-user`, `offline_access`). |
| `Could not list accessible Jira sites` | The token exchange succeeded but `/oauth/token/accessible-resources` failed. Usually a network or scope issue. |
| `Received callback for unknown state` | The Connect attempt timed out (5 min) or another browser window already completed it. Click Connect again. |
| `Atlassian callback did not include a state parameter` | The OAuth app's redirect URI is misconfigured (Atlassian normally always includes state). Re-check the callback URL in the Developer Console. |

If a browser window opened *inside* Obsidian (a popup-style window) rather than
your system browser, the redirect to `obsidian://...` can't reach the OS
protocol handler. The plugin tries Electron's `shell.openExternal` first, but
some Obsidian installs (older versions, sandboxed builds) don't expose it.
Workaround: copy the URL the Connect button opens (it's logged to the console
as `[jira-tiles] opening OAuth authorize URL`) and paste it into your normal
browser instead.

### "The redirect URI didn't match" error

Make sure `manifest.json`'s callback URL is exactly:

```
obsidian://jira-tiles-auth-callback
```

…with no trailing slash, no extra path, lowercase. The constant
`OAUTH_REDIRECT_URI` in `src/constants.ts` must match what the Atlassian
OAuth app expects.

### Browser doesn't return to Obsidian

Some browsers (Firefox in particular) prompt before launching custom
schemes. Check that you've allowed `obsidian://` to be opened. On Linux,
ensure `xdg-mime` knows about Obsidian:

```bash
xdg-mime query default x-scheme-handler/obsidian
# Should print "obsidian.desktop" (or similar).
```

### "No accessible Jira sites for this account"

This means your token is valid but the user has no Jira Cloud sites in
their Atlassian account. Sign in to <https://id.atlassian.com> and confirm
you can access at least one site.

### "Atlassian returned access_denied"

The user clicked Cancel/Reject in the consent screen, or your OAuth app
doesn't have the requested scopes configured. Re-check step 2.

If you instead see `access_denied: Unauthorized` returned from
`/oauth/token` (in DevTools, after the consent screen succeeded), the
likely causes are:

- The OAuth app's **Callback URL** in the Developer Console doesn't match
  `obsidian://jira-tiles-auth-callback` exactly. Atlassian compares
  redirect URIs literally — no trailing slash, lowercase, exact scheme.
- The PKCE `code_verifier` doesn't match the `code_challenge` from the
  authorize request. This shouldn't happen with the bundled flow, but if
  you opened the authorize URL more than once and authorized in a stale
  tab, the active session's verifier is wrong. Click **Disconnect** and
  **Connect** again.
- The token endpoint rejected the body's content type. The plugin tries
  `application/json` (matching Atlassian's docs example) and falls back
  to `application/x-www-form-urlencoded` on a 401. Look for
  `[jira-tiles] OAuth response status (form-encoded retry)` in DevTools
  to see which one your environment accepts. If both fail, file a bug
  with the full DevTools log.

### Refresh tokens not rotating correctly

Atlassian rotates refresh tokens on every refresh. The plugin always
stores the new value via `OAuthFlow.refresh()`. If you see "Authentication
failed" repeatedly after a successful initial connection, your refresh
token may have been used twice (e.g. a stale instance running). Click
**Disconnect** and **Connect** again.

## Spec audit

This plugin's OAuth implementation has been audited against
[Atlassian's official 3LO docs](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/):

| Step | Spec | Plugin | OK |
|------|------|--------|----|
| Authorize URL | `https://auth.atlassian.com/authorize` with `audience, client_id, scope, redirect_uri, state, response_type=code, prompt=consent` | ✅ all params + PKCE `code_challenge` (S256) | ✅ |
| State parameter | non-guessable, bound to user session | ✅ 16 random bytes (Web Crypto), validated on callback | ✅ |
| Token endpoint | `POST https://auth.atlassian.com/oauth/token` | ✅ | ✅ |
| Body content type | `application/json` per docs | ✅ JSON first, form-encoded fallback on 401 (defensive) | ✅ |
| Body fields (auth code) | `grant_type, client_id, client_secret, code, redirect_uri` | ⚠ public-client variant: `client_id, code, redirect_uri, code_verifier` (PKCE — no secret shipped, RFC 7636) | ⚠ |
| Site discovery | `GET https://api.atlassian.com/oauth/token/accessible-resources` with `Bearer` | ✅ | ✅ |
| Request URL pattern | `https://api.atlassian.com/ex/jira/{cloudid}/{api}` | ✅ | ✅ |
| Refresh grant | `grant_type=refresh_token, client_id, client_secret, refresh_token` | ⚠ public-client variant: omits `client_secret` | ⚠ |
| Token rotation | "Replace existing refresh token with the new one" | ✅ done in `OAuthFlow.refresh()` after every successful exchange | ✅ |

The two ⚠ items reflect that this plugin is a **public/native client**
(distributed inside Obsidian; no per-user `client_secret`). RFC 7636 (PKCE)
substitutes `code_verifier` for `client_secret`. Atlassian's auth.atlassian.com
endpoint supports PKCE — the JWT in a successful authorize callback contains
`"client_auth_type":"NONE"` confirming this — but their docs page does not
explicitly cover the public-client flow.

## References

- [Atlassian: OAuth 2.0 (3LO) apps](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/)
- [RFC 7636: Proof Key for Code Exchange](https://datatracker.ietf.org/doc/html/rfc7636)
- [RFC 8252: OAuth 2.0 for Native Apps](https://datatracker.ietf.org/doc/html/rfc8252)
- [RFC 6749: OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749)
