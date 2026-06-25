# Jira Tiles for Obsidian

Embed live Jira issue tiles in your Obsidian notes via fenced code blocks.

````markdown
```jira
PROJ-123
```
````

The plugin replaces that block with a rich tile showing:

- Issue type icon (top-left), bold summary, and a subtitle line
  (`Epic AI-3855 in Jira Cloud` for child issues, `Story PROJ-1 in Jira
  Cloud` for top-level)
- Two-column field grid: **Issue Type**, **Status** (color-coded badge),
  **Priority** (with Jira priority icon)
- **Due Date** + **Fix Versions** sharing a row, full-width **Assignee**
  chip below
- Custom fields in their own labeled grid
- Footer with last-fetched timestamp, refresh button, and a green
  **Open in Jira** call-to-action button

**Target:** Atlassian Cloud only. Mobile-friendly (iOS + Android).

## Features

- **API token authentication.** Standard Atlassian API tokens; works with
  SSO-linked accounts since `id.atlassian.com` lets you mint tokens
  regardless of how you sign in.
- **SecretStorage.** Token values live in Obsidian's
  [SecretStorage](https://docs.obsidian.md/plugins/guides/secret-storage)
  (1.5+); `data.json` only carries the *name* of the secret.
- **Smart formatters.** Custom fields auto-render as user, sprint, option,
  version, date, number, boolean — falling back to a JSON snippet — without
  per-field configuration for common types.
- **Custom field discovery.** Click *Discover from Jira* in settings to
  pick fields from your live Jira instance instead of typing field IDs.
- **Caching with offline grace.** TTL cache (configurable 1–60 min)
  coalesces concurrent fetches and falls back to stale data with an
  offline indicator when the network is unreachable.
- **Mobile-first.** Tiles reflow at 320px, all interactive elements are
  44px touch targets.
- **Dev mode.** `npm run dev:preview` boots a browser harness for iterating
  on the tile UI without rebuilding the plugin.

## Installation

### Manual install (until published)

1. Clone this repo.
2. `npm install`
3. `npm run build` → produces `main.js`.
4. Copy `manifest.json`, `main.js`, and `styles.css` into
   `<your-vault>/.obsidian/plugins/obsidian-jira-tiles/`.
5. Enable *Jira Tiles* under *Settings → Community plugins*.

### Community Plugins registry (planned)

Once submitted, install via *Settings → Community plugins → Browse → search
"Jira Tiles"*.

## Authentication

In *Settings → Jira Tiles*, configure your Atlassian API token:

1. Go to <https://id.atlassian.com/manage-profile/security/api-tokens>.
2. Create a new API token. Copy the value. (SSO-linked Atlassian accounts
   can also generate tokens here.)
3. In plugin settings → *Connection*:
   - **Site URL**: `https://your-site.atlassian.net`
   - **Email**: the email associated with your Atlassian account
   - **API token**: the SecretComponent picker lets you select an existing
     secret from Obsidian's SecretStorage or save a new one. The token
     value is written into SecretStorage; the plugin's `data.json` only
     records the *name* of the secret.
4. Click **Use API token**.

> **Note on OAuth:** earlier builds attempted an OAuth 2.0 (3LO) flow.
> That was removed because the Atlassian token endpoint repeatedly
> returned `access_denied` to the Obsidian-bundled HTTP client across
> multiple body encodings and authentication shapes. API tokens cover the
> same use cases (including SSO accounts) without the operational
> complexity.

## Security

Tokens are stored in Obsidian's
[SecretStorage](https://docs.obsidian.md/plugins/guides/secret-storage)
(Obsidian 1.5+). The plugin's `data.json` carries only your site URL,
email, feature toggles, and the *name* of the secret — no credential
values.

If you're upgrading from a pre-0.2.0 build, the plugin migrates plain-text
tokens out of `data.json` on first load. Consider rotating your Atlassian
API token afterwards to invalidate the previously-stored value.

Recommendations:

- Rotate API tokens regularly.
- Update Obsidian to 1.5 or newer if you see the "secret storage
  unavailable" warning in settings — without that API the plugin can only
  hold tokens in memory.

See [SECURITY.md](./SECURITY.md) for the full threat model.

## Usage

### Basic embed

````markdown
```jira
PROJ-123
```
````

### Key:value form (forward-compatible)

````markdown
```jira
key: PROJ-123
compact: true
```
````

(Compact rendering is reserved for a future release.)

### Commands

Open the command palette (Cmd/Ctrl-P):

| Command                                | Behavior                                                           |
|----------------------------------------|--------------------------------------------------------------------|
| Jira Tiles: Insert Jira issue tile     | Prompts for a key, inserts a `jira` block at the cursor            |
| Jira Tiles: Refresh tiles in current note | Invalidates cache for keys in the current note + rebuilds the view |
| Jira Tiles: Refresh all Jira tiles     | Clears the in-memory cache; tiles refresh on next render           |
| Jira Tiles: Clear Jira cache           | Same as above, alternative palette label                           |

### Custom fields

Add fields in *Settings → Custom fields*:

- **Add custom field** — manually enter a field ID + label.
- **Discover from Jira** — opens a searchable picker showing all fields
  available in your Jira instance, with custom-only and substring filters.

Fields render via smart formatters that detect:

- **User** — `{ accountId, displayName, avatarUrls }` → avatar + name
- **Option** — `{ value }` → text
- **Sprint array** — bold for active, italic for future, muted for closed
- **Version array** — released ✓ / archived strikethrough / unreleased
- **ISO date / datetime** — locale-formatted with original ISO in `title`
- **Number** — locale-grouped
- **Boolean** — Yes / No
- **Anything else** — `<code>JSON.stringify(value)</code>` truncated at 240 chars

## Development

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
without needing a real Jira account or reloading Obsidian. See
[dev/README.md](./dev/README.md) for fixture format and toolbar controls.

### Repository layout

```
src/                Plugin source (shipped to Obsidian)
  main.ts           Plugin entry / lifecycle
  constants.ts      Shared constants (REST endpoints, default fields, cache)
  commands.ts       Command palette commands
  auth/             API token + AuthManager + SecretsService (README inside)
  jira/             REST client + types + field discovery    (README inside)
  cache/            In-memory TTL cache                      (README inside)
  render/           Code block processor + tile DOM + smart formatters (README inside)
  settings/         Settings tab + field picker modal        (README inside)
dev/                Dev preview harness (NOT shipped)        (README inside)
  index.html        Browser harness page
  harness.ts        Harness entry
  obsidian-shim.ts  Stub Obsidian API
  fixtures/         Sample Jira responses
tests/              Jest test suite
```

Each `src/*` subdirectory has its own README with module-level details.

### Test suite

Coverage spans:

- API token Basic auth header construction + URL normalization
- AuthManager: configured/not-configured, secret resolution, error paths
- SecretsService: SecretStorage path + memory fallback + error handling
- Migration: legacy plain-text token migration, OAuth-state cleanup
- Jira REST client (paths, encoding, status mapping, response parsing)
- Issue cache (TTL, force, concurrent coalescing, stale-on-failure)
- Code block parser (single-line + kv form, comment lines, key validation)
- Smart formatters (user, option, sprint, version, date, number, boolean, fallback)
- Tile renderer (loading / loaded / error / stale states, display option
  gating, refresh button placement, custom fields, fix-versions placement)
- Icons (issue-type and priority SVG fallbacks, name normalization)
- Code block processor (invalid block, fetch + render, cache reuse)
- Field discovery picker (filter, exclude, sort, defaultLabel)
- Commands (extract keys, builder, refresh-all, clear-cache)
- Settings defaults + upgrade-safe merge + field-merging regression

Run `npm test` — completes in ~1s.

## Contributing

PRs welcome. Run `npm run typecheck && npm test` before submitting.

## License

MIT — see [LICENSE](./LICENSE).
