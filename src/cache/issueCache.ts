/**
 * In-memory TTL cache for Jira issues.
 *
 * Goals:
 *   - Avoid hammering Jira when multiple tiles reference the same key.
 *   - De-duplicate concurrent requests for the same key (single in-flight).
 *   - Expose a `staleData` so the renderer can show stale + offline indicator
 *     when a refresh fails.
 *
 * Non-goals:
 *   - Persistence across plugin reload — too risky (stale tokens, stale data).
 *   - LRU eviction — TTL is enough; entries are tiny.
 */

import type { JiraIssue } from "../jira/types";

/** A successfully fetched issue plus the timestamp of the fetch. */
export interface CacheEntry {
  data: JiraIssue;
  fetchedAt: number;
}

/** Result returned by `getOrFetch` so callers know whether they got fresh data. */
export interface FetchResult {
  data: JiraIssue;
  /** When this data was fetched from Jira. */
  fetchedAt: number;
  /** True if the data was satisfied from cache without a network call. */
  fromCache: boolean;
  /**
   * If fetching failed but we returned stale data anyway, this carries the
   * error so the renderer can show an "offline" indicator.
   */
  staleError?: Error;
}

export class IssueCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<JiraIssue>>();

  constructor(private readonly ttlMs: () => number) {}

  /** Read a cache entry without triggering a fetch. Useful for synchronous render. */
  peek(key: string): CacheEntry | undefined {
    return this.entries.get(key);
  }

  /**
   * Get the issue, fetching only if missing or expired.
   *
   * @param key     Issue key.
   * @param fetcher Callback that performs the actual REST call.
   * @param force   When true, ignore cache and fetch fresh (manual refresh).
   * @returns       FetchResult with the issue and provenance metadata.
   */
  async getOrFetch(
    key: string,
    fetcher: () => Promise<JiraIssue>,
    force = false,
  ): Promise<FetchResult> {
    const existing = this.entries.get(key);
    const now = Date.now();
    if (!force && existing && now - existing.fetchedAt < this.ttlMs()) {
      return {
        data: existing.data,
        fetchedAt: existing.fetchedAt,
        fromCache: true,
      };
    }

    // Coalesce concurrent fetches for the same key.
    let promise = this.inFlight.get(key);
    if (!promise) {
      promise = fetcher();
      this.inFlight.set(key, promise);
      // Attach completion handlers without creating new chained promises that
      // could surface "unhandled rejection" warnings — promise.then(_, _) lets
      // us observe both outcomes without forwarding them.
      promise.then(
        () => this.inFlight.delete(key),
        () => this.inFlight.delete(key),
      );
    }

    try {
      const data = await promise;
      const fetchedAt = Date.now();
      this.entries.set(key, { data, fetchedAt });
      return { data, fetchedAt, fromCache: false };
    } catch (err) {
      // If we have stale data, return it with an error annotation so the
      // renderer can show "offline" mode rather than a hard error.
      if (existing) {
        return {
          data: existing.data,
          fetchedAt: existing.fetchedAt,
          fromCache: true,
          staleError: err instanceof Error ? err : new Error(String(err)),
        };
      }
      throw err;
    }
  }

  /** Invalidate a single entry (or all entries when key is omitted). */
  invalidate(key?: string): void {
    if (key === undefined) {
      this.entries.clear();
      return;
    }
    this.entries.delete(key);
  }

  /** Number of cached entries (debug / testing). */
  size(): number {
    return this.entries.size;
  }
}
