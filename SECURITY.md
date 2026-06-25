# Security

This plugin handles credentials that grant access to your Jira data. Please
read this document before configuring the plugin.

## Where credentials are stored

The plugin uses Obsidian's
[SecretStorage](https://docs.obsidian.md/plugins/guides/secret-storage) API
(introduced in Obsidian 1.11.4+). The Atlassian API token never touches the
plugin's `data.json` — only the *name* of the SecretStorage entry is
persisted there. The actual value lives in Obsidian's per-install secret
store, which is local to your machine and is **not synced**.

`data.json` (`<your-vault>/.obsidian/plugins/obsidian-jira-tiles/data.json`)
contains:

- Site URL, email
- Display preferences and feature toggles
- The name that points at the SecretStorage entry (e.g. `jira-tiles-api-token`)

So if someone reads your `data.json`, they see metadata about which secret
the plugin uses, but not the secret value.

### Older Obsidian versions

If your Obsidian build does not expose the SecretStorage API, the plugin
falls back to an **in-memory secret store**. Secrets entered while running
on a fallback build will not survive an Obsidian reload — you'll need to
re-enter them. The plugin shows a clear warning in settings when this is in
effect. Update Obsidian to 1.11.4 or newer for persistent secure storage.

## What's at risk

If the API token is exfiltrated, an attacker can authenticate to Jira as
the token-issuing account. Use a token tied to a least-privilege account
when possible. Atlassian API tokens cover the full account; they are not
scoped down to read-only.

## Mitigations the plugin uses

- **Secrets stored in Obsidian's SecretStorage**, not in vault `data.json`.
- **Tokens are masked in the settings UI** (the SecretComponent picker
  and the password-typed fallback input both hide the value).
- **Tokens are never logged** to console. The diagnostic log shows lengths
  and key names, never the credential body.
- **Read-only API access**: the plugin's Jira client only issues GET
  requests. Even if the token grants write access, the plugin never uses it.
- **One-time informational banner** in settings explains where credentials
  go on this plugin version.

## Mitigations you should adopt

- **Rotate API tokens regularly** at
  <https://id.atlassian.com/manage-profile/security/api-tokens>.
- **Lock your filesystem.** Full-disk encryption (FileVault, BitLocker,
  LUKS) significantly raises the bar for an attacker recovering tokens
  from SecretStorage.

## What the plugin does NOT do

- Write to your Jira issues. The plugin's Jira client only issues GET
  requests.
- Send any data anywhere except `*.atlassian.net`. All HTTP traffic is
  visible in your Obsidian DevTools network tab.
- Track usage, telemetry, or analytics.
- Sync your `data.json` or your SecretStorage entries — Obsidian Sync /
  iCloud / Dropbox may sync `data.json` (which now carries no credentials),
  but SecretStorage is intentionally excluded from sync.

## Reporting a vulnerability

Please open a GitHub issue (use the "Security advisory" template if
available), or email the maintainer directly. Do not include credentials
or sensitive issue data in the report.
