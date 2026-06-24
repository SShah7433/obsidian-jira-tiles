# Security

This plugin handles credentials that grant access to your Jira data. Please
read this document before configuring the plugin.

## Where credentials are stored

Both authentication methods (OAuth and API token) persist credentials to:

```
<your-vault>/.obsidian/plugins/obsidian-jira-tiles/data.json
```

Stored as **plain text JSON**. Anyone with read access to this file can
authenticate as you against Jira.

## What's at risk

| Method     | Lost if exfiltrated                                                |
|------------|--------------------------------------------------------------------|
| OAuth      | Access + refresh tokens. Read-only Jira scopes (no write).         |
| API token  | Full programmatic access to your Jira account.                     |

## Mitigations the plugin uses

- **OAuth uses PKCE** (no `client_secret` shipped, so a leaked plugin
  package can't be used to mint new tokens for arbitrary users).
- **OAuth scopes are minimal** — `read:jira-work`, `read:jira-user`,
  `offline_access`. The plugin cannot edit issues, post comments, or
  transition workflows even if compromised.
- **Tokens are masked in the settings UI** (password input type) so
  shoulder-surfing or screen-recording doesn't accidentally leak them.
- **Tokens are never logged** to console.
- **One-time security banner** in settings to acknowledge plain-text storage.

## Mitigations you should adopt

- **Don't sync `data.json` to untrusted cloud storage.** Most Obsidian Sync
  / iCloud / Dropbox configurations include `.obsidian/plugins/*` by
  default; consider excluding `data.json` if your cloud provider sees it
  as a security boundary.
- **Rotate API tokens regularly** at
  <https://id.atlassian.com/manage-profile/security/api-tokens>.
- **Prefer OAuth (PKCE) over API tokens.** Refresh tokens can be revoked
  from Atlassian's site without rotating other credentials, and the scopes
  are read-only.
- **Lock your filesystem.** Full-disk encryption (FileVault, BitLocker,
  LUKS) significantly raises the bar for an attacker recovering tokens.

## What the plugin does NOT do

- Write to your Jira issues. The OAuth scopes are read-only; the plugin's
  Jira client only issues GET requests.
- Send any data anywhere except `*.atlassian.net` and `auth.atlassian.com`.
  All HTTP traffic is logged in your Obsidian DevTools network tab.
- Track usage, telemetry, or analytics.

## Reporting a vulnerability

Please open a GitHub issue (use the "Security advisory" template if
available), or email the maintainer directly. Do not include credentials
or sensitive issue data in the report.
