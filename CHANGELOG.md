# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — Unreleased

### Added

- Initial plugin scaffold with `manifest.json`, build pipeline, and
  Obsidian-compatible TypeScript setup.
- API token (Basic auth) authentication.
- OAuth 2.0 + PKCE authentication with `obsidian://` callback handler and
  automatic token refresh (proactive on near-expiry, reactive on 401).
- Markdown code block processor for ` ```jira PROJ-123 ``` ` blocks.
- Jira REST client with timeout, friendly error messages, and 401 retry.
- In-memory TTL cache with concurrent-request coalescing and stale-on-
  failure fallback (offline indicator).
- **Tile UI matching the design reference**: icon + bold summary + subtitle
  ("Epic AI-3855 in Jira Cloud") header, two-column Status/Priority grid,
  full-width Assignee chip, custom fields with labeled cells, footer with
  click-to-refresh "As of today at HH:MM" timestamp and green "Open in Jira"
  CTA. Pastel cyan status pills and assignee chips on light theme; inverted
  on dark.
- `parent` issue field included in default fetch so the tile can show the
  parent epic / parent task in the subtitle.
- Smart formatters for user, option, sprint, date, number, boolean values;
  fallback to truncated JSON for unknown shapes.
- Custom field configuration in settings, including a "Discover from Jira"
  picker that searches/filters live field metadata.
- Command palette commands: insert tile, refresh current note, refresh all,
  clear cache.
- Mobile-first responsive styling, 44×44 touch targets on the CTA, theme-
  aware via Obsidian CSS custom properties; grid collapses to a single
  column at ≤480px.
- Dev preview harness (`npm run dev:preview`) with 9 fixtures (including a
  `design-reference.json` matching the spec'd UI), theme + viewport
  switching, file-watch reload.
- Comprehensive test suite (138 tests) with coverage thresholds.
- Module READMEs in every `src/*` subdirectory.
