# `src/auth`

Authentication for the Jira REST API.

## Modules

| File              | Purpose                                                                       |
|-------------------|-------------------------------------------------------------------------------|
| `apiToken.ts`     | API-token (Basic auth) helpers: header building, URL normalization            |
| `authManager.ts`  | Resolves the per-request `AuthContext` (header + base URL)                    |
| `secrets.ts`      | SecretsService wrapper around Obsidian's SecretStorage (with memory fallback) |

## Design

Callers (the Jira client, settings tab) never reach into raw credentials.
They go through `AuthManager`:

```ts
const ctx = await mgr.getContext();
// ctx.authorizationHeader -> "Basic ..."
// ctx.baseUrl              -> Atlassian site URL
```

`getContext()` is async because it resolves the *value* of the active token
from SecretStorage at request time. PluginSettings only carries the *name*
of the SecretStorage entry; the value never lives in `data.json`.

## Authentication

Standard Atlassian API tokens (https://id.atlassian.com/manage-profile/security/api-tokens).
The user's email + token are sent as HTTP Basic. No refresh — if the token is
revoked, the user must regenerate it.

The token value lives in SecretStorage; `apiToken.tokenSecretName` in
`PluginSettings` records which named secret to read. The settings UI uses
Obsidian's `SecretComponent` picker so users can share a single named secret
across multiple plugins.

SSO-locked Atlassian accounts can still use this method — your normal SSO
login at id.atlassian.com lets you generate API tokens.

## Why no OAuth?

Earlier versions experimented with OAuth 2.0 (3LO). The blocking problem is
that Atlassian's authorization-code token exchange requires a
`client_secret`. A distributable Obsidian plugin has nowhere safe to keep
one — bundling it in the published plugin would expose the secret to every
downloader, and PKCE alone did not satisfy the endpoint. On top of that, the
Atlassian token endpoint repeatedly returned `access_denied: Unauthorized`
to the Obsidian-bundled HTTP client across multiple body encodings (JSON,
form-urlencoded) and authentication shapes (PKCE-only, PKCE + secret).

Since API tokens cover the same use cases (including SSO-linked accounts,
which can mint tokens at id.atlassian.com) without shipping a shared secret,
OAuth was removed entirely.

## Security notes

Tokens are stored in Obsidian's SecretStorage, which is local to the
install and not synced. `data.json` carries only metadata: site URL,
email, feature toggles, and the *name* (not value) of the secret.

When the runtime is too old to expose `app.secretStorage`, `SecretsService`
degrades to in-memory storage with a loud warning in the settings tab.
That keeps the on-disk security guarantee intact (no plaintext) at the
cost of having to re-enter credentials after every reload.

See `SECURITY.md` for the full threat model.
