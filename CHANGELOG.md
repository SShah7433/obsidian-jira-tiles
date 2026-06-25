# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — Unreleased

### Added

- **Embedding mode** setting (Display → Embedding mode): choose between
  code blocks (` ```jira `), auto-linking standalone Jira issue URLs, or
  both. Auto-link only rewrites URLs pointing at the configured Jira site
  and only when the link is the whole line, so URLs inside a sentence stay
  normal links. The mode is read per-render so toggling it takes effect on
  the next note render without a reload.
- Auto-link works in **both Reading view and Live Preview**. Reading view
  uses a markdown post-processor; Live Preview uses a CodeMirror 6 editor
  extension (post-processors don't run on the Live Preview surface). In
  Live Preview the raw URL is shown again when the cursor is on the line so
  it stays editable.

### Fixed

- Secret storage IDs now use valid identifiers (`jira-tiles-api-token`).
  The previous IDs contained a colon, which Obsidian's SecretStorage API
  rejects — `setSecret` would have thrown, breaking token storage.
- `minAppVersion` corrected to `1.11.4` (the release that introduced the
  SecretStorage / SecretComponent APIs the plugin relies on).
- "Clear cache" in settings now actually clears the cache (was a no-op).
- Image URLs from the Jira API (avatars, issue-type/priority icons) are
  validated against an http(s) allowlist before being used as `<img src>`.

### Changed

- Replaced inline `.style` assignments with CSS classes (sprint state,
  initials-avatar colours, issue-type chip colours) per Obsidian guidelines.
- Settings headings now use `Setting().setHeading()` instead of raw `<h2>`;
  the first (Connection) section no longer has a top-level heading.
- Editor-dependent commands ("Insert issue tile", "Refresh tiles in current
  note") use `editorCheckCallback`; the insert flow uses a Modal instead of
  `window.prompt` (which is unreliable on mobile). Command names no longer
  repeat the plugin name.
- Removed debug `console.log`/`console.warn` calls; only genuine errors are
  logged now.
- SVG icons are built via the DOM API rather than `innerHTML`.

### Removed

- **Credential-migration code removed.** Since the plugin has not shipped,
  there are no existing installs with plain-text tokens to migrate, so the
  one-shot `migration.ts` (and its tests) were deleted along with the
  `secretsMigrationComplete` flag. Fresh installs simply start with the
  SecretStorage-based shape.
- **OAuth 2.0 (3LO) support has been removed.** Atlassian's token exchange
  requires a `client_secret`, which a distributable plugin cannot ship
  safely — bundling it would expose the secret to every downloader.
  Additionally, the Atlassian token endpoint repeatedly returned
  `access_denied: Unauthorized` to the Obsidian-bundled HTTP client across
  multiple body encodings (JSON, form-urlencoded) and authentication shapes
  (PKCE-only, PKCE + secret). Since API tokens cover the same use cases
  (including SSO-linked Atlassian accounts that can mint tokens at
  id.atlassian.com), the OAuth path has been retired. `OAUTH_SETUP.md`
  was deleted; OAuth source files (`oauth.ts`, `tokenStore.ts`) and
  their tests were removed.

### Changed

- **Secrets now live in Obsidian's SecretStorage** instead of plain text
  in `data.json`. API tokens are persisted via `app.secretStorage`
  (Obsidian 1.11.4+). The plugin's `data.json` carries only site URL,
  email, feature toggles, and the *name* of the secret — no credential
  values. A one-time migration on upgrade moves any pre-0.2.0 plain-text
  tokens into SecretStorage and shows a Notice when it runs. Plugins on
  older Obsidian versions degrade to in-memory storage with a clear
  settings-tab warning.
- API token settings field uses Obsidian's `SecretComponent` picker when
  available (lets users share secret entries across plugins). Falls back
  to a password-typed text input on older runtimes that still routes via
  the plugin's SecretsService.
- AuthManager `getContext()` is now async — it pulls the resolved token
  from SecretStorage at request time. JiraClient awaits it.

### Added

- Initial plugin scaffold with `manifest.json`, build pipeline, and
  Obsidian-compatible TypeScript setup.
- API token (Basic auth) authentication.
- Markdown code block processor for ` ```jira PROJ-123 ``` ` blocks.
- Jira REST client with timeout, friendly error messages.
- In-memory TTL cache with concurrent-request coalescing and stale-on-
  failure fallback (offline indicator).
- Tile UI matching the design reference: icon + bold summary + subtitle
  ("Epic AI-3855 in Jira Cloud") header, three-column standard-fields
  grid (Issue Type / Status / Priority), Due Date adjacent to Fix
  Versions, full-width Assignee chip, custom fields with labeled cells,
  footer with refresh icon button + green "Open in Jira" CTA.
- `parent` issue field included in default fetch so the tile can show the
  parent epic / parent task in the subtitle.
- `fixVersions` field with state-aware chips (released ✓ / archived /
  unreleased) and a corresponding "Show fix versions" display toggle.
- Smart formatters for user, option, sprint, version, date, number,
  boolean values; fallback to truncated JSON for unknown shapes.
- Custom field configuration in settings, including a "Discover from Jira"
  picker that searches/filters live field metadata.
- Command palette commands: insert tile, refresh current note, refresh
  all, clear cache.
- Mobile-first responsive styling, 44×44 touch targets on the CTA, theme-
  aware via Obsidian CSS custom properties; grid collapses to a single
  column at ≤480px.
- Dev preview harness (`npm run dev:preview`) with fixtures, theme +
  viewport switching, file-watch reload.
- Module READMEs in every `src/*` subdirectory.
