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
- Two-column field grid: **Status** (color-coded badge) and **Priority**
- Full-width **Assignee** chip (avatar + name) and any **Custom fields**
- Footer with last-fetched timestamp ("As of today at 11:37 AM" — click to
  refresh) and a green **Open in Jira** call-to-action button

**Target:** Atlassian Cloud only. Mobile-friendly (iOS + Android).

## Features

- **Two auth methods.** OAuth 2.0 with PKCE (recommended; SSO-compatible) or
  Atlassian API token (Basic auth fallback).
- **Smart formatters.** Custom fields auto-render as user, sprint, option,
  date, number, or fall back to a JSON snippet — no per-field configuration
  needed for common types.
- **Custom field discovery.** Click *Discover from Jira* in settings to
  pick fields from your live Jira instance instead of typing field IDs.
- **Caching with offline grace.** TTL cache (configurable 1–60 min) coalesces
  concurrent fetches and falls back to stale data with an offline indicator
  when the network is unreachable.
- **Mobile-first.** Tiles reflow at 320px, all interactive elements are 44px
  touch targets, OAuth callback works via Obsidian's `obsidian://` handler on
  iOS and Android.
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

In *Settings → Jira Tiles*, choose **OAuth** (recommended) or **API token**.

### OAuth 2.0 + PKCE (recommended)

Works with corporate SSO since the entire authentication flow happens in
your browser. The plugin never sees your password.

1. Click **Connect** in plugin settings.
2. Your default browser opens Atlassian's consent screen.
3. After granting access, Atlassian redirects back to Obsidian via
   `obsidian://jira-tiles-auth-callback?...` — Obsidian routes it to the
   plugin, which exchanges the code for tokens.
4. The plugin discovers your Jira site (`cloudId`) and stores it.

Tokens auto-refresh on every request when within 60s of expiry, and once
on a 401 response.

> **Note:** The bundled OAuth `client_id` is configured in
> `src/constants.ts`. If you fork this plugin or self-host, register your own
> Atlassian OAuth app (see [OAUTH_SETUP.md](./OAUTH_SETUP.md)) and replace
> the `OAUTH_CLIENT_ID` constant.

### API token (fallback)

For environments where OAuth isn't available, or for quick local testing.

1. Go to <https://id.atlassian.com/manage-profile/security/api-tokens>.
2. Create a new API token. Copy the value.
3. In plugin settings → *API token (fallback)*:
   - **Site URL**: `https://your-site.atlassian.net`
   - **Email**: the email associated with your Atlassian account
   - **API token**: the token you just copied
4. Click **Use API token**.

## Security

**Tokens are stored as plain text** in
`<vault>/.obsidian/plugins/obsidian-jira-tiles/data.json`.
Anyone with filesystem access to your vault can read them. The plugin shows
a one-time security banner when first opened to acknowledge this.

Recommendations:

- Prefer OAuth (PKCE) — refresh tokens are still plain text, but they're
  more easily revoked from Atlassian's UI.
- Rotate API tokens regularly.
- Avoid syncing `data.json` to untrusted cloud locations. Most Obsidian Sync
  / iCloud / Dropbox configurations include the plugin folder by default.

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
npm test                 # run the Jest test suite (132+ tests)
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
  constants.ts      Shared constants (OAuth client_id, scopes, endpoints)
  commands.ts       Command palette commands
  auth/             API token, OAuth + PKCE, AuthManager   (README inside)
  jira/             REST client + types + field discovery  (README inside)
  cache/            In-memory TTL cache                    (README inside)
  render/           Code block processor + tile DOM + smart formatters (README inside)
  settings/         Settings tab + field picker modal      (README inside)
dev/                Dev preview harness (NOT shipped)      (README inside)
  index.html        Browser harness page
  harness.ts        Harness entry
  obsidian-shim.ts  Stub Obsidian API
  fixtures/         Sample Jira responses
tests/              Jest test suite — 132+ tests
```

Each `src/*` subdirectory has its own README with module-level details.

### Test suite

132+ tests covering:

- API token Basic auth header construction + URL normalization
- AuthManager strategy resolution + force-refresh path
- OAuth PKCE primitives, authorization URL builder, token endpoint
- OAuthFlow orchestration (begin / handleCallback / refresh / cancel /
  CSRF state mismatch / Atlassian errors / no accessible sites)
- Jira REST client (paths, encoding, status mapping, 401-retry-with-refresh)
- Issue cache (TTL, force, concurrent coalescing, stale-on-failure)
- Code block parser (single-line + kv form, comment lines, key validation)
- Smart formatters (user, option, sprint, date, number, boolean, fallback)
- Tile renderer (loading / loaded / error / stale, display option gating,
  refresh button, opener delegation, custom fields)
- Code block processor (invalid block, fetch + render, cache reuse)
- Field discovery picker (filter, exclude, sort, defaultLabel)
- Commands (extract keys, builder, refresh-all, clear-cache)
- Settings defaults + upgrade-safe merge

Run `npm test` — completes in ~1s.

## Implementation phases (all complete)

- [x] **Phase 1** — Scaffolding, manifest, build config, API token auth, settings tab
- [x] **Phase 1.5** — Dev preview mode (browser harness)
- [x] **Phase 2** — Code block processor, Jira REST client, tile rendering, cache
- [x] **Phase 3** — OAuth 2.0 + PKCE flow (browser → `obsidian://` callback)
- [x] **Phase 4** — Custom fields with smart formatters and field discovery
- [x] **Phase 5** — Commands, mobile-first styling, error/stale states
- [x] **Phase 6** — README + OAuth setup guide, ready for Community Plugins submission

## Contributing

PRs welcome. Run `npm run typecheck && npm test` before submitting.

## License

MIT — see [LICENSE](./LICENSE).
