# `src/settings`

Persisted plugin settings, defaults, and the Obsidian Settings Tab UI.

## Modules

| File           | Purpose                                                       |
|----------------|---------------------------------------------------------------|
| `types.ts`     | TypeScript shape for the persisted `PluginSettings` object    |
| `defaults.ts`  | Hard-coded defaults + `mergeWithDefaults()` upgrade helper    |
| `SettingsTab.ts` | Renders the settings UI (auth, display toggles, custom fields) |

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

1. **Security warning banner** (acknowledgeable, dismisses to a quieter form)
2. **Connection** — API token form; OAuth Connect button arrives in Phase 3
3. **Display** — toggles for which standard fields render; cache TTL slider
4. **Custom fields** — list of field IDs + labels; reorderable
5. **Advanced** — Clear cache, Open data.json location

## Sensitive data

`PluginSettings.apiToken` and `PluginSettings.oauth` carry credentials in
plain text. They are NEVER logged, and the SettingsTab masks the API token
input. See [SECURITY.md](#security) in the repo root for guidance.
