# `dev/` — Development preview harness

A standalone browser-based preview for the tile renderer, useful for iterating
on visual design without rebuilding the plugin and reloading Obsidian.

## Run

```bash
npm run dev:preview
```

esbuild picks a free port, builds the harness, copies fixtures + styles into
`dev/dist/`, and opens the browser. Edit any source file under `src/render/`,
any fixture under `dev/fixtures/`, or `styles.css` — the harness auto-reloads
via esbuild's built-in EventSource feed.

## What the harness mocks

The renderer in `src/render/` imports a few things from `obsidian`. Inside the
dev bundle, esbuild rewrites that import to `dev/obsidian-shim.ts`, which
provides:

- `setIcon(el, name)` — inline SVG fallbacks for the icons the renderer uses
- `Notice(message)` — toast in the bottom-right
- `requestUrl()` — throws (the harness uses fixtures, not the network)
- `HTMLElement.prototype.createDiv` / `createEl` / `createSpan` / `empty` —
  Obsidian's DOM extensions, polyfilled to standard methods

## Fixtures

Each file in `dev/fixtures/` describes a render state. All fixtures share the
same structure:

```jsonc
{
  "kind": "issue",            // see "Kinds" below
  "fetchedAt": 1756000000000, // optional — defaults to (now - 30s)
  "fromCache": false,         // optional — adds the "cached" footer label
  "customFields": [...],      // optional — list of CustomFieldConfig entries
  "issue": { ... }            // a JiraIssue (see src/jira/types.ts)
}
```

### Kinds

| `kind`         | Renders                                                                |
|----------------|------------------------------------------------------------------------|
| `issue`        | Standard tile populated from `issue` fields                            |
| `issue-stale`  | Tile populated from cache with "stale + offline" footer indicator      |
| `loading`      | Permanent loading skeleton                                             |
| `error`        | Failure state with retry + open-in-Jira link                           |

Stale fixtures need an `error` string. Error fixtures need a `key` and `message`.

### Adding a new fixture

1. Drop a new `.json` file into `dev/fixtures/`.
2. Restart the harness (it rebuilds the fixture index on startup; the dropdown
   updates automatically).

## Toolbar controls

- **Fixture** — pick a fixture; URL hash updates so you can deep-link.
- **Viewport** — full-width / 768px (tablet) / 360px (phone) for responsive QA.
- **Theme** — toggles light/dark; sets both `data-theme` on `<html>` and
  `theme-dark` on `<body>` (the production styles.css uses the latter).

## What's NOT testable here

- OAuth flow (needs a real `obsidian://` redirect)
- Real Jira API behavior (rate limits, exact error shapes)
- Plugin lifecycle (settings persistence, multi-tile cache coalescing)

For those, use a real Obsidian dev vault with `npm run dev` (watch mode plugin
build) and sideload the plugin.

## Building / not shipping

The harness is excluded from the published plugin via `.npmignore`. Only
`main.js`, `manifest.json`, `styles.css`, and `versions.json` ship to users.
