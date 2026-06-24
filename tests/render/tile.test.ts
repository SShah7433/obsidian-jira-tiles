/**
 * Tests for src/render/tile.ts — the tile renderer.
 *
 * These exercise the full happy path, error path, stale path, and
 * display-options gating using a stub fetcher that never hits the network.
 */

import {
  displayOptionsFromSettings,
  renderInto,
  renderInvalidBlock,
  renderResolvedTile,
  type RenderContext,
} from "../../src/render/tile";
import { InvalidJiraBlockError } from "../../src/render/parseBlock";
import type { FetchResult } from "../../src/cache/issueCache";
import type { JiraIssue } from "../../src/jira/types";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";

function fakeIssue(over: Partial<JiraIssue> = {}): JiraIssue {
  return {
    id: "1",
    key: "PROJ-1",
    fields: {
      summary: "Hello world",
      issuetype: { name: "Task" },
      status: {
        name: "In Progress",
        statusCategory: { colorName: "yellow", name: "In Progress" },
      },
      priority: { name: "High" },
      duedate: "2026-08-01",
      assignee: { displayName: "Alice", accountId: "u1" },
      ...over.fields,
    },
    ...over,
  };
}

function makeCtx(over: Partial<RenderContext> = {}): RenderContext {
  return {
    buildIssueUrl: (k) => `https://example.atlassian.net/browse/${k}`,
    fetch: async () => ({
      data: fakeIssue(),
      fetchedAt: Date.now(),
      fromCache: false,
    } as FetchResult),
    display: displayOptionsFromSettings(DEFAULT_SETTINGS),
    ...over,
  };
}

describe("renderInto — happy path", () => {
  it("renders the loaded tile with summary, status, priority, due date, assignee", async () => {
    const container = document.createElement("div");
    await renderInto(container, { key: "PROJ-1" }, makeCtx());
    expect(container.textContent).toContain("Hello world");
    expect(container.textContent).toContain("In Progress");
    expect(container.textContent).toContain("High");
    expect(container.textContent).toContain("Alice");
    expect(container.querySelector(".jira-tile-key")?.getAttribute("href")).toBe(
      "https://example.atlassian.net/browse/PROJ-1",
    );
  });

  it("respects display option toggles", async () => {
    const container = document.createElement("div");
    await renderInto(
      container,
      { key: "PROJ-1" },
      makeCtx({
        display: {
          showStatus: false,
          showPriority: false,
          showAssignee: false,
          showDueDate: false,
          showIssueType: false,
          customFields: [],
        },
      }),
    );
    expect(container.textContent).toContain("Hello world");
    expect(container.textContent).not.toContain("In Progress");
    expect(container.textContent).not.toContain("High");
    expect(container.textContent).not.toContain("Alice");
  });

  it("renders custom fields when configured and value present", async () => {
    const container = document.createElement("div");
    await renderInto(
      container,
      { key: "PROJ-1" },
      makeCtx({
        fetch: async () => ({
          data: fakeIssue({
            fields: {
              summary: "x",
              customfield_10020: [
                { id: 1, name: "Sprint 1", state: "active" },
              ],
              customfield_10016: 5,
            },
          }),
          fetchedAt: Date.now(),
          fromCache: false,
        }),
        display: {
          ...displayOptionsFromSettings(DEFAULT_SETTINGS),
          customFields: [
            { id: "customfield_10020", label: "Sprint", enabled: true },
            { id: "customfield_10016", label: "Story Points", enabled: true },
            { id: "customfield_99999", label: "Missing", enabled: true },
          ],
        },
      }),
    );
    expect(container.textContent).toContain("Sprint");
    expect(container.textContent).toContain("Sprint 1");
    expect(container.textContent).toContain("Story Points");
    expect(container.textContent).toContain("5");
    // Field with no value should be skipped, not show "Missing —".
    expect(container.textContent).not.toContain("Missing");
  });
});

describe("renderInto — error path", () => {
  it("renders an error tile when fetch rejects", async () => {
    const container = document.createElement("div");
    await renderInto(
      container,
      { key: "PROJ-404" },
      makeCtx({
        fetch: async () => {
          throw new Error("Issue not found.");
        },
      }),
    );
    expect(container.textContent).toContain("Failed to load");
    expect(container.textContent).toContain("Issue not found.");
    expect(container.querySelector(".jira-tile--error")).not.toBeNull();
    // Open-in-Jira link still rendered.
    const link = container.querySelector("a[href*='/browse/']");
    expect(link).not.toBeNull();
  });
});

describe("renderInto — stale path", () => {
  it("shows the offline badge when fetcher returns staleError", async () => {
    const container = document.createElement("div");
    await renderInto(
      container,
      { key: "PROJ-1" },
      makeCtx({
        fetch: async () => ({
          data: fakeIssue(),
          fetchedAt: Date.now() - 60_000,
          fromCache: true,
          staleError: new Error("Network unreachable"),
        }),
      }),
    );
    expect(container.querySelector(".jira-tile-offline-badge")).not.toBeNull();
    expect(container.querySelector(".jira-tile--stale")).not.toBeNull();
  });
});

describe("refresh button", () => {
  it("re-invokes fetch with force=true", async () => {
    const container = document.createElement("div");
    let calls = 0;
    let lastForce = false;
    await renderInto(
      container,
      { key: "PROJ-1" },
      makeCtx({
        fetch: async (_k, force) => {
          calls++;
          lastForce = force;
          return {
            data: fakeIssue(),
            fetchedAt: Date.now(),
            fromCache: false,
          };
        },
      }),
    );
    expect(calls).toBe(1);
    const refreshBtn = container.querySelector(
      "button[aria-label='Refresh']",
    ) as HTMLButtonElement | null;
    expect(refreshBtn).not.toBeNull();
    refreshBtn?.click();
    // Allow the async refresh to settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(2);
    expect(lastForce).toBe(true);
  });
});

describe("renderResolvedTile (no fetch)", () => {
  it("renders directly from a FetchResult", () => {
    const container = document.createElement("div");
    renderResolvedTile(
      container,
      { key: "PROJ-1" },
      {
        data: fakeIssue(),
        fetchedAt: Date.now(),
        fromCache: false,
      },
      makeCtx(),
    );
    expect(container.textContent).toContain("Hello world");
  });
});

describe("renderInvalidBlock", () => {
  it("shows a tile with the parse error message", () => {
    const container = document.createElement("div");
    renderInvalidBlock(container, new InvalidJiraBlockError("Empty block"));
    expect(container.querySelector(".jira-tile--error")).not.toBeNull();
    expect(container.textContent).toContain("Empty block");
  });
});

describe("opener delegate", () => {
  it("invokes ctx.open() when key is clicked", async () => {
    const container = document.createElement("div");
    const opened: string[] = [];
    await renderInto(
      container,
      { key: "PROJ-1" },
      makeCtx({ open: (url) => opened.push(url) }),
    );
    const link = container.querySelector(".jira-tile-key") as HTMLAnchorElement;
    link.click();
    expect(opened).toEqual(["https://example.atlassian.net/browse/PROJ-1"]);
  });
});
