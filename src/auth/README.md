# `src/auth`

Authentication strategies for the Jira REST API.

## Modules

| File              | Purpose                                                                       |
|-------------------|-------------------------------------------------------------------------------|
| `apiToken.ts`     | API-token (Basic auth) helpers: header building, URL normalization            |
| `oauth.ts`        | Pure OAuth 2.0 + PKCE primitives (verifier, challenge, URL, token endpoint)   |
| `tokenStore.ts`   | OAuthFlow orchestrator: begin/handleCallback/refresh/cancel                   |
| `authManager.ts`  | Unified resolver returning an `AuthContext` for each REST call                |
| `secrets.ts`      | SecretsService wrapper around Obsidian's SecretStorage (with memory fallback) |
| `migration.ts`    | One-shot migration that moves pre-SecretStorage tokens out of `data.json`     |

## Design

Callers (the Jira client, settings tab) never reach into raw credentials.
They go through `AuthManager`:

```ts
const ctx = await mgr.getContext();
// ctx.authorizationHeader -> "Bearer ..." or "Basic ..."
// ctx.baseUrl              -> Atlassian site URL or api.atlassian.com proxy
// ctx.refreshable          -> can a 401 be auto-recovered?
```

`getContext()` is async because it resolves the *value* of the active token
from SecretStorage at request time. PluginSettings only carries the *name*
of the SecretStorage entry; the value never lives in `data.json`.

For OAuth, call `await mgr.ensureFresh()` before `getContext()` to perform
proactive token refresh when the access token is within the leeway window
(default 60s).

## Authentication methods

### API token

Standard Atlassian API tokens (https://id.atlassian.com/manage-profile/security/api-tokens).
The user's email + token are sent as HTTP Basic. No refresh — if the token is
revoked, the user must regenerate it.

The token value lives in SecretStorage; `apiToken.tokenSecretName` in
`PluginSettings` records which named secret to read. The settings UI uses
Obsidian's `SecretComponent` picker so users can share a single named secret
across multiple plugins.

Pros: simple, well-understood.
Cons: doesn't work for SSO-only accounts.

### OAuth 2.0 + PKCE

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
6. The access + refresh tokens are written to SecretStorage; only their
   names are persisted in `data.json` via `plugin.saveData(this.settings)`.

Tokens auto-refresh on every request when within leeway (default 60s) and
once on 401 via `AuthManager.forceRefresh()`. Atlassian rotates refresh
tokens on every refresh, so the new value is always stored back into
SecretStorage.

Pending authorizations time out after 5 minutes; the flow self-heals when
the user closes the browser or never completes consent.

## Security notes

Tokens are stored in Obsidian's SecretStorage, which is local to the
install and not synced. `data.json` carries only metadata: site URL,
email, feature toggles, and the *names* (not values) of the secrets.

`migration.ts` runs once on plugin load — if it sees a legacy `data.json`
with plain-text tokens (from pre-0.2.0 plugin versions) it copies them
into SecretStorage and clears the plain-text fields. Idempotent via
`PluginSettings.secretsMigrationComplete`.

When the runtime is too old to expose `app.secretStorage`, `SecretsService`
degrades to in-memory storage with a loud warning in the settings tab.
That keeps the on-disk security guarantee intact (no plaintext) at the
cost of having to re-enter credentials after every reload.

See `SECURITY.md` for the full threat model.
