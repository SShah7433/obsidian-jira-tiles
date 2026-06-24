/**
 * Tests for src/cache/issueCache.ts
 */

import { IssueCache } from "../../src/cache/issueCache";
import type { JiraIssue } from "../../src/jira/types";

function fakeIssue(key: string, summary = `summary for ${key}`): JiraIssue {
  return { key, fields: { summary } };
}

describe("IssueCache.getOrFetch", () => {
  it("calls the fetcher on first access", async () => {
    const cache = new IssueCache(() => 60_000);
    let count = 0;
    const result = await cache.getOrFetch("PROJ-1", async () => {
      count++;
      return fakeIssue("PROJ-1");
    });
    expect(count).toBe(1);
    expect(result.fromCache).toBe(false);
    expect(result.data.key).toBe("PROJ-1");
  });

  it("returns cached data within TTL without refetching", async () => {
    const cache = new IssueCache(() => 60_000);
    let count = 0;
    const fetcher = async () => {
      count++;
      return fakeIssue("PROJ-1");
    };
    await cache.getOrFetch("PROJ-1", fetcher);
    const second = await cache.getOrFetch("PROJ-1", fetcher);
    expect(count).toBe(1);
    expect(second.fromCache).toBe(true);
  });

  it("force=true bypasses cache", async () => {
    const cache = new IssueCache(() => 60_000);
    let count = 0;
    const fetcher = async () => {
      count++;
      return fakeIssue("PROJ-1");
    };
    await cache.getOrFetch("PROJ-1", fetcher);
    await cache.getOrFetch("PROJ-1", fetcher, true);
    expect(count).toBe(2);
  });

  it("re-fetches once TTL expires", async () => {
    let ttl = 0; // immediately expired
    const cache = new IssueCache(() => ttl);
    let count = 0;
    const fetcher = async () => {
      count++;
      return fakeIssue("PROJ-1");
    };
    await cache.getOrFetch("PROJ-1", fetcher);
    await cache.getOrFetch("PROJ-1", fetcher);
    expect(count).toBe(2);
    // With a long TTL the next call should hit the cache.
    ttl = 60_000;
    await cache.getOrFetch("PROJ-1", fetcher);
    expect(count).toBe(2);
  });

  it("coalesces concurrent fetches for the same key", async () => {
    const cache = new IssueCache(() => 60_000);
    let count = 0;
    let resolveInner!: (issue: JiraIssue) => void;
    const fetcher = () =>
      new Promise<JiraIssue>((resolve) => {
        count++;
        resolveInner = resolve;
      });
    const p1 = cache.getOrFetch("PROJ-1", fetcher);
    const p2 = cache.getOrFetch("PROJ-1", fetcher);
    expect(count).toBe(1);
    resolveInner!(fakeIssue("PROJ-1"));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.data.key).toBe("PROJ-1");
    expect(r2.data.key).toBe("PROJ-1");
  });

  it("returns stale data with staleError on fetch failure", async () => {
    const cache = new IssueCache(() => 0); // expire immediately
    let attempt = 0;
    const fetcher = async () => {
      attempt++;
      if (attempt === 1) return fakeIssue("PROJ-1");
      throw new Error("network down");
    };
    const first = await cache.getOrFetch("PROJ-1", fetcher);
    expect(first.fromCache).toBe(false);
    const second = await cache.getOrFetch("PROJ-1", fetcher);
    expect(second.fromCache).toBe(true);
    expect(second.staleError?.message).toBe("network down");
    expect(second.data.key).toBe("PROJ-1");
  });

  it("propagates the error if there's nothing cached yet", async () => {
    const cache = new IssueCache(() => 60_000);
    await expect(
      cache.getOrFetch("PROJ-X", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

describe("IssueCache.invalidate", () => {
  it("clears specific keys", async () => {
    const cache = new IssueCache(() => 60_000);
    await cache.getOrFetch("PROJ-1", async () => fakeIssue("PROJ-1"));
    await cache.getOrFetch("PROJ-2", async () => fakeIssue("PROJ-2"));
    cache.invalidate("PROJ-1");
    expect(cache.peek("PROJ-1")).toBeUndefined();
    expect(cache.peek("PROJ-2")?.data.key).toBe("PROJ-2");
  });

  it("clears all entries when called without a key", async () => {
    const cache = new IssueCache(() => 60_000);
    await cache.getOrFetch("PROJ-1", async () => fakeIssue("PROJ-1"));
    await cache.getOrFetch("PROJ-2", async () => fakeIssue("PROJ-2"));
    cache.invalidate();
    expect(cache.size()).toBe(0);
  });
});
