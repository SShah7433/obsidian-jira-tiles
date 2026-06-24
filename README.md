# Jira Tiles for Obsidian

Embed live Jira issue tiles in your Obsidian notes via fenced code blocks.

````markdown
```jira
PROJ-123
```
````

The plugin replaces that block with a rich tile showing:

- Issue type icon, key, and summary (clickable to open in Jira)
- Workflow status (color-coded badge)
- Priority, assignee, due date
- Configurable Jira custom fields (Sprint, Story Points, etc.)
- Refresh and "Open in Jira" actions
- Last-updated timestamp + offline indicator when running on stale cache

**Target:** Atlassian Cloud only. Mobile-friendly (iOS + Android).

## Status

This plugin is being built in phases. Current state: **Phase 1 — scaffolding +
API token authentication**. See [PHASES.md](#implementation-phases) below for
progress.

## Installation

Until the plugin is published to the Community Plugins registry:

1. Clone this repo.
2. `npm install`
3. `npm run build`
4. Copy `manifest.json`, `main.js`, and `styles.css` into
   `<your-vault>/.obsidian/plugins/obsidian-jira-tiles/`.
5. Enable "Jira Tiles" under *Settings → Community plugins*.

## Authentication

Two methods, configured in *Settings → Jira Tiles*:

### API token (Phase 1 — available now)

1. Go to <https://id.atlassian.com/manage-profile/security/api-tokens>.
2. Create a new API token. Copy the value.
3. In the plugin settings, enter:
   - **Site URL**: `https://your-site.atlassian.net`
   - **Email**: the email associated with your Atlassian account
   - **API token**: the token you just copied
4. Click **Use API token**.

### OAuth 2.0 (Phase 3 — coming soon)

Recommended for users behind corporate SSO. Uses the OAuth 2.0 (3LO) flow with
PKCE — no client secret required, no shared credentials.

## Security

**Tokens are stored as plain text** in `<vault>/.obsidian/plugins/obsidian-jira-tiles/data.json`.
Anyone with filesystem access to your vault can read them.

Recommendations:

- Rotate API tokens regularly.
- Avoid syncing `data.json` to untrusted cloud locations.
- Prefer OAuth (PKCE) once Phase 3 ships.

## Usage

Once authenticated, embed any issue:

````markdown
```jira
PROJ-123
```
````

The tile auto-renders in reading view and live preview. Click the refresh icon
to bypass the cache. Click the key, type icon, or summary to open the issue in
Jira (system browser).

## Development

### Build commands

```bash
npm install              # install dependencies
npm run build            # one-shot production build → main.js
npm run dev              # watch mode for plugin development
npm run dev:preview      # spin up the dev preview harness (browser)
npm test                 # run the Jest test suite
npm run test:watch       # tests in watch mode
npm run test:coverage    # tests with coverage report
npm run typecheck        # tsc --noEmit
```

### Dev preview mode

`npm run dev:preview` boots a local browser harness for iterating on tile UI
without needing a real Jira account or reloading Obsidian. The harness:

- Renders tiles using fixture JSON in `dev/fixtures/*.json`.
- Mocks the Obsidian API surface used by the renderer (`dev/obsidian-shim.ts`).
- Live-reloads on file changes (source, fixtures, styles).
- Includes theme and viewport-width toggles for testing light/dark + mobile.

Pick a different fixture from the dropdown to preview different states
(loading, error, custom fields, long summary, offline-stale, etc.).

### Repository layout

```
src/                Plugin source (shipped to Obsidian)
  main.ts           Plugin entry / lifecycle
  constants.ts      Shared constants
  auth/             Auth strategies (API token, OAuth, manager)
  jira/             Jira REST client + types
  cache/            In-memory TTL cache
  render/           Code block processor + tile DOM + formatters
  settings/         Settings tab and persisted shape
dev/                Dev preview harness (NOT shipped)
  index.html        Browser harness page
  harness.ts        Harness entry
  obsidian-shim.ts  Stub Obsidian API
  fixtures/         Sample Jira responses
tests/              Jest test suite
```

## Implementation phases

- [x] **Phase 1** — Scaffolding, manifest, build config, API token auth, settings tab
- [ ] **Phase 1.5** — Dev preview mode (browser harness)
- [ ] **Phase 2** — Code block processor, Jira REST client, tile rendering, cache
- [ ] **Phase 3** — OAuth 2.0 + PKCE flow (browser → `obsidian://` callback)
- [ ] **Phase 4** — Custom fields with smart formatters and field discovery
- [ ] **Phase 5** — Polish: loading/error/offline states, mobile QA, commands
- [ ] **Phase 6** — Distribution: README screenshots, Community Plugins PR

## License

MIT — see [LICENSE](./LICENSE).
