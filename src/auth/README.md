# `src/auth`

Authentication strategies for the Jira REST API.

## Modules

| File              | Purpose                                                           |
|-------------------|-------------------------------------------------------------------|
| `apiToken.ts`     | API-token (Basic auth) helpers: header building, URL normalization|
| `oauth.ts`        | Pure OAuth 2.0 + PKCE primitives (verifier, challenge, URL, token endpoint) |
| `tokenStore.ts`   | OAuthFlow orchestrator: begin/handleCallback/refresh/cancel       |
| `authManager.ts`  | Unified resolver returning an `AuthContext` for each REST call    |

## Design

Callers (the Jira client, settings tab) never reach into raw credentials.
They go through `AuthManager`:

```ts
const ctx = mgr.getContext();
// ctx.authorizationHeader -> "Bearer ..." or "Basic ..."
// ctx.baseUrl              -> Atlassian site URL or api.atlassian.com proxy
// ctx.refreshable          -> can a 401 be auto-recovered?
```

For OAuth, call `await mgr.ensureFresh()` before `getContext()` to perform
proactive token refresh when the access token is within the leeway window
(default 60s).

## Authentication methods

### API token (Phase 1)

Standard Atlassian API tokens (https://id.atlassian.com/manage-profile/security/api-tokens).
The user's email + token are sent as HTTP Basic. No refresh — if the token is
revoked, the user must regenerate it.

Pros: simple, well-understood.
Cons: doesn't work for SSO-only accounts. Tokens stored in plain text on disk.

### OAuth 2.0 + PKCE (Phase 3)

The 3-legged OAuth flow:

1. User clicks "Connect" → plugin generates a fresh PKCE `code_verifier`,
   derives the `code_challenge`, generates a CSRF `state`, and opens
   `https://auth.atlassian.com/authorize?...&redirect_uri=obsidian://jira-tiles-auth-callback`
2. User authenticates in their browser (works with SSO).
3. Atlassian redirects to `obsidian://jira-tiles-auth-callback?code=...&state=...`.
4. Obsidian routes the URI to our protocol handler; `OAuthFlow.handleCallback`
   verifies state, exchanges code → tokens with PKCE `code_verifier`.
5. We query `/oauth/token/accessible-resources` to discover the user's
   `cloudId` and pin to the first site.
6. State is persisted via `plugin.saveData(this.settings)`.

Tokens auto-refresh on every request when within leeway (default 60s) and
once on 401 via `AuthManager.forceRefresh()`. Atlassian rotates refresh
tokens on every refresh, so the new value is always stored.

Pending authorizations time out after 5 minutes; the flow self-heals when
the user closes the browser or never completes consent.

## Security notes

Tokens (both kinds) are persisted to `data.json` as plain text. The
`SettingsTab` shows a one-time security warning that must be acknowledged.
Future enhancement: optional OS keychain integration (would require a native
module and break Obsidian Mobile compatibility).
