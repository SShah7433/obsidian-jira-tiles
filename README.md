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
  (1.11.4+); `data.json` only carries the *name* of the secret.
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
- **Dev mode.** A browser-based preview harness for iterating on the tile
  UI without rebuilding the plugin lives on the [`dev` branch](https://github.com/SShah7433/obsidian-jira-tiles/tree/dev).

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
> It was removed for two reasons. First, a distributable Obsidian plugin
> cannot safely complete Atlassian's token exchange: it requires a
> `client_secret`, and bundling a secret in a publicly-downloadable plugin
> would expose it to everyone. Second, the Atlassian token endpoint
> repeatedly returned `access_denied` to the Obsidian-bundled HTTP client
> across multiple body encodings and authentication shapes. API tokens
> cover the same use cases (including SSO accounts) without shipping a
> shared secret.

## Security

Tokens are stored in Obsidian's
[SecretStorage](https://docs.obsidian.md/plugins/guides/secret-storage)
(Obsidian 1.11.4+). The plugin's `data.json` carries only your site URL,
email, feature toggles, and the *name* of the secret — no credential
values.

Recommendations:

- Rotate API tokens regularly.
- Update Obsidian to 1.11.4 or newer if you see the "secret storage
  unavailable" warning in settings — without that API the plugin can only
  hold tokens in memory.

See [SECURITY.md](./SECURITY.md) for the full threat model.

## Usage

### Embedding mode

In *Settings → Jira Tiles → Display → Embedding mode*, choose how issues
become tiles:

- **Code block** (default) — only fenced ` ```jira ` blocks render as tiles.
  Explicit and predictable.
- **Auto-link Jira URLs** — paste a Jira issue URL on its own line and it is
  replaced with a tile. Only URLs pointing at your configured Jira site are
  touched, and only when the link is the whole line (URLs embedded in a
  sentence stay normal links).
- **Both** — code blocks *and* standalone Jira URLs render as tiles.

### Basic embed (code block)

````markdown
```jira
PROJ-123
```
````

### Multiple issues in one block

List several keys, one per line — each renders as its own tile, and each
line can carry its own `!compact` / `!full` flag:

````markdown
```jira
ABC-123
ABC-321 !compact
ABC-987 !full
```
````

Lines starting with `#` are treated as comments and ignored.

### Auto-link

With auto-link (or both) enabled, a line containing just a Jira issue URL
becomes a tile:

```markdown
https://your-site.atlassian.net/browse/PROJ-123
```

This works in both Reading view and Live Preview. In Live Preview the raw
URL reappears when your cursor is on that line, so you can still edit it.

### Compact tiles

Tiles can render as a single compact row instead of the full card.

Set the default in *Settings → Jira Tiles → Display → Compact tiles by
default*. Code blocks inherit this default and can override it per tile with
a flag on the key line:

````markdown
```jira
PROJ-123 !compact
```
````

````markdown
```jira
PROJ-123 !full
```
````

`!compact` forces a compact tile and `!full` forces a full tile, regardless
of the global default. Auto-linked Jira URLs have no per-link syntax, so they
always follow the global default.

### Key:value form (forward-compatible)

````markdown
```jira
key: PROJ-123
compact: true
```
````

`compact:` accepts `true`/`false` (also `yes`/`no`, `1`/`0`). Omit it to
inherit the global default.

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
npm test                 # run the Jest test suite
npm run test:watch       # tests in watch mode
npm run test:coverage    # tests with coverage report
npm run typecheck        # tsc --noEmit
```

### Dev preview mode

A browser-based preview harness for iterating on tile UI without a real Jira
account or reloading Obsidian lives on the
[`dev` branch](https://github.com/SShah7433/obsidian-jira-tiles/tree/dev)
(`npm run dev:preview` there). It is kept off `main` because it is a
standalone browser tool that is never shipped with the plugin.

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
tests/              Jest test suite
```

Each `src/*` subdirectory has its own README with module-level details.

### Test suite

Coverage spans:

- API token Basic auth header construction + URL normalization
- AuthManager: configured/not-configured, secret resolution, error paths
- SecretsService: SecretStorage path + memory fallback + error handling
- URL parsing + auto-link post-processor (host/standalone gating, mode gating)
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
