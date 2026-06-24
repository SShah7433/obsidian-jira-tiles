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
- Tile renderer covering loading, loaded, error, and stale states.
- Smart formatters for user, option, sprint, date, number, boolean values;
  fallback to truncated JSON for unknown shapes.
- Custom field configuration in settings, including a "Discover from Jira"
  picker that searches/filters live field metadata.
- Command palette commands: insert tile, refresh current note, refresh all,
  clear cache.
- Mobile-first responsive styling, 44×44 touch targets, theme-aware via
  Obsidian CSS custom properties.
- Dev preview harness (`npm run dev:preview`) with 8 fixtures, theme +
  viewport switching, file-watch reload.
- Comprehensive test suite (132+ tests) with coverage thresholds.
- Module READMEs in every `src/*` subdirectory.
