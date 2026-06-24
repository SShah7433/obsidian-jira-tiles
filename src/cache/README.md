# `src/cache`

In-memory TTL cache for fetched Jira issues.

## Modules

| File             | Purpose                                                          |
|------------------|------------------------------------------------------------------|
| `issueCache.ts`  | `IssueCache` class — TTL Map + concurrent-request coalescing     |

## Behavior

- **Get-or-fetch**: tiles call `cache.getOrFetch(key, fetcher, force=false)`.
  Inside the TTL window, the cached value is returned immediately. Outside it,
  the `fetcher` runs.
- **Coalesce**: if multiple tiles for the same key request a fetch in the same
  tick, only one fetcher runs; both calls receive the same Promise.
- **Stale fallback**: if a fetch fails but a previous successful entry exists,
  the cache returns the stale data with a `staleError` annotation so the UI
  can render an offline indicator.
- **TTL is dynamic**: the cache reads `ttlMs()` on every request, so adjusting
  the slider in settings takes effect immediately.

## Non-goals

- Persistence across plugin reload — too risky (token rotation, stale data).
- Negative caching of 404s — they're cheap to retry, and re-creating an issue
  with the same key would otherwise show as missing for a long time.
- LRU eviction — entries are tiny; size is bounded by the number of tiles in
  open notes.
