# Security

This plugin handles credentials that grant access to your Jira data. Please
read this document before configuring the plugin.

## Where credentials are stored

The plugin uses Obsidian's
[SecretStorage](https://docs.obsidian.md/plugins/guides/secret-storage) API
(introduced in Obsidian 1.5+). Tokens (Atlassian API tokens, OAuth access /
refresh tokens) never touch the plugin's `data.json` — only the *names* of
secrets are persisted there. The actual values live in Obsidian's per-install
secret store, which is local to your machine and is **not synced**.

`data.json` (`<your-vault>/.obsidian/plugins/obsidian-jira-tiles/data.json`)
contains:

- Site URL, email
- Display preferences and feature toggles
- The names that point at SecretStorage entries (e.g. `jira-tiles:api-token`)
- Cached `cloudId`, site name (no credentials)

So if someone reads your `data.json`, they see metadata about which secrets
the plugin uses, but not the secret values.

### Older Obsidian versions

If your Obsidian build does not expose the SecretStorage API, the plugin
falls back to an **in-memory secret store**. Secrets entered while running
on a fallback build will not survive an Obsidian reload — you'll need to
re-enter them. The plugin shows a clear warning in settings when this is in
effect. Update Obsidian to 1.5 or newer for persistent secure storage.

### Migration from earlier plugin versions

Plugin versions prior to 0.2.0 stored tokens as plain text in `data.json`. On
first load after upgrading, the plugin runs a one-shot migration that copies
those tokens into SecretStorage and clears the plain-text fields. The old
copy in `data.json` is overwritten on the next save. If you want to be
extra safe after upgrading, also rotate your Atlassian API token to
invalidate the previously-leaked value.

## What's at risk

| Method     | Lost if exfiltrated                                                |
|------------|--------------------------------------------------------------------|
| OAuth      | Access + refresh tokens. Read-only Jira scopes (no write).         |
| API token  | Full programmatic access to your Jira account.                     |

## Mitigations the plugin uses

- **Secrets stored in Obsidian's SecretStorage**, not in vault `data.json`.
- **OAuth uses PKCE** (no `client_secret` shipped, so a leaked plugin
  package can't be used to mint new tokens for arbitrary users).
- **OAuth scopes are minimal** — `read:jira-work`, `read:jira-user`,
  `offline_access`. The plugin cannot edit issues, post comments, or
  transition workflows even if compromised.
- **Tokens are masked in the settings UI** (the SecretComponent picker
  and the password-typed fallback input both hide the value).
- **Tokens are never logged** to console. The diagnostic log shows lengths
  and key names, never the credential body.
- **One-time informational banner** in settings explains where credentials
  go on this plugin version.

## Mitigations you should adopt

- **Rotate API tokens regularly** at
  <https://id.atlassian.com/manage-profile/security/api-tokens>.
- **Prefer OAuth (PKCE) over API tokens.** Refresh tokens can be revoked
  from Atlassian's site without rotating other credentials, and the scopes
  are read-only.
- **Lock your filesystem.** Full-disk encryption (FileVault, BitLocker,
  LUKS) significantly raises the bar for an attacker recovering tokens
  from SecretStorage.

## What the plugin does NOT do

- Write to your Jira issues. The OAuth scopes are read-only; the plugin's
  Jira client only issues GET requests.
- Send any data anywhere except `*.atlassian.net` and `auth.atlassian.com`.
  All HTTP traffic is visible in your Obsidian DevTools network tab.
- Track usage, telemetry, or analytics.
- Sync your `data.json` or your SecretStorage entries — Obsidian Sync /
  iCloud / Dropbox may sync `data.json` (which now carries no credentials),
  but SecretStorage is intentionally excluded from sync.

## Reporting a vulnerability

Please open a GitHub issue (use the "Security advisory" template if
available), or email the maintainer directly. Do not include credentials
or sensitive issue data in the report.
