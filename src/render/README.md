# `src/render`

Tile renderer + supporting modules.

## Modules

| File                         | Purpose                                                                          |
|------------------------------|----------------------------------------------------------------------------------|
| `parseBlock.ts`              | Parses ` ```jira ` block contents into an `IssueRequest`                         |
| `tile.ts`                    | Builds the tile DOM tree (loading / loaded / error / stale)                      |
| `codeBlockProcessor.ts`      | Glue between Obsidian's MD post-processor and the tile renderer                  |
| `icons.ts`                   | Wraps `setIcon` (Obsidian Lucide) + falls back to inline SVG / letter chips      |
| `formatters/index.ts`        | Smart-formatter dispatcher (detects user / option / sprint / date / number / fallback) |
| `formatters/user.ts`         | Avatar (or initials chip) + display name                                         |
| `formatters/option.ts`       | Single-/multi-select option values                                               |
| `formatters/sprint.ts`       | Sprint array with active/future/closed visual cues                               |
| `formatters/date.ts`         | ISO date / datetime, locale-aware                                                |
| `formatters/number.ts`       | Locale-grouped number                                                            |
| `formatters/fallback.ts`     | `<code>JSON.stringify(value)</code>` with truncation                              |

## Render pipeline

```
   ```jira             plugin.registerMarkdownCodeBlockProcessor("jira", ...)
   PROJ-123                              │
   ```                                   ▼
                              codeBlockProcessor.ts
                                         │
                              parseBlock(source)  ─► IssueRequest
                                         │
                              tile.renderInto(container, request, ctx)
                                         │
                              ctx.fetch(key, force=false)   ──► IssueCache
                                         │                       └─► JiraClient ─► Jira REST
                                         ▼
                              renderLoadedTile  /  renderErrorTile
                                  uses formatters/*  for custom fields
```

## Render states

- **Loading** — shimmer skeleton for the icon + summary + subtitle while
  the first fetch is in flight.
- **Loaded** — header (issue type icon, bold summary, subtitle line like
  "Epic AI-3855 in Jira Cloud"), Status/Priority grid (two columns at
  desktop widths, single column on phones), full-width Assignee chip,
  optional custom-field cells, footer with click-to-refresh timestamp and
  green **Open in Jira** CTA.
- **Stale** — same layout as Loaded but the timestamp gets a `⚠` prefix
  and warning color when the cache returned data because a fresh fetch
  failed.
- **Error** — short message + retry button + plain "Open in Jira" link so
  the user is never stuck.
- **Invalid block** — rendered when `parseBlock` throws.

The subtitle prefers the parent issue when present (e.g. an Epic link),
falling back to the issue's own type+key for top-level issues.

## Testing

The renderer is decoupled from Obsidian and the network via a `RenderContext`
parameter. Unit tests inject:

- `buildIssueUrl` — pure URL builder
- `fetch` — stub returning a `FetchResult` directly
- `display` — DisplayOptions snapshot
- `now` — deterministic clock for relative-time assertions

The dev preview harness uses the same seam to render tiles from JSON fixtures.

## Mobile considerations

- Header uses `flex-wrap` so action buttons drop below summary at narrow widths.
- Refresh / open buttons are 44×44 touch targets.
- Avatar images are `loading="lazy"`.
- Custom field grid collapses to single column under 480px.
- All hover affordances also work on focus (keyboard + touch).
