# `src/settings`

Persisted plugin settings, defaults, and the Obsidian Settings Tab UI.

## Modules

| File           | Purpose                                                       |
|----------------|---------------------------------------------------------------|
| `types.ts`     | TypeScript shape for the persisted `PluginSettings` object    |
| `defaults.ts`  | Hard-coded defaults + `mergeWithDefaults()` upgrade helper    |
| `SettingsTab.ts` | Renders the settings UI (auth, display toggles, custom fields) |
| `FieldPickerModal.ts` | "Discover from Jira" custom-field picker modal            |

## Persistence

Obsidian persists `PluginSettings` to:

```
<vault>/.obsidian/plugins/obsidian-jira-tiles/data.json
```

Loaded via `plugin.loadData()` and saved via `plugin.saveData(this.settings)`.

When the plugin is upgraded, new fields added to `PluginSettings` would be
missing from existing `data.json`. `mergeWithDefaults()` shallow-merges loaded
data on top of `DEFAULT_SETTINGS` so old installs continue to work without
losing user customizations.

## Settings sections

1. **Storage notice** (informational; warns when SecretStorage is missing)
2. **Connection** — API token form (site URL, email, token via SecretComponent)
3. **Display** — toggles for which standard fields render; cache TTL slider
4. **Custom fields** — list of field IDs + labels + Discover-from-Jira modal
5. **Advanced** — Clear cache

## Sensitive data

`PluginSettings.apiToken.tokenSecretName` is the *name* of the SecretStorage
entry that holds the API token; the token *value* is never written to
`data.json`. The SettingsTab masks the value in any fallback text input.
See `SECURITY.md` in the repo root for the full threat model.
