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
  it("renders summary, subtitle, status, priority, assignee", async () => {
    const container = document.createElement("div");
    await renderInto(container, { key: "PROJ-1" }, makeCtx());

    // Summary in the bold title row.
    const summary = container.querySelector(".jira-tile-summary");
    expect(summary?.textContent).toBe("Hello world");

    // Subtitle "Task PROJ-1 in Jira Cloud" (issue type + key + site name).
    const subtitle = container.querySelector(".jira-tile-subtitle");
    expect(subtitle?.textContent).toContain("Task PROJ-1");
    expect(subtitle?.textContent).toContain("Jira Cloud");

    // Field-label pairs.
    const labels = Array.from(container.querySelectorAll(".jira-tile-field-label"))
      .map((el) => el.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Status", "Priority", "Assignee", "Due"]));

    // Status badge.
    const badge = container.querySelector(".jira-tile-status-badge");
    expect(badge?.textContent).toBe("In Progress");
    expect(badge?.classList.contains("jira-tile-status-badge--yellow")).toBe(true);

    // Priority value text.
    expect(container.querySelector(".jira-tile-priority-value")?.textContent).toBe("High");

    // Assignee chip rendered with the name.
    const chip = container.querySelector(".jira-tile-assignee-chip");
    expect(chip?.textContent).toContain("Alice");
  });

  it("uses parent issue type+key for subtitle when parent is present", async () => {
    const container = document.createElement("div");
    await renderInto(
      container,
      { key: "MCP-2607" },
      makeCtx({
        fetch: async () => ({
          data: {
            id: "1",
            key: "MCP-2607",
            fields: {
              summary: "MCP (2607) - Move to Leader",
              issuetype: { name: "Story" },
              parent: {
                key: "AI-3855",
                fields: { issuetype: { name: "Epic" } },
              },
              status: {
                name: "In Progress",
                statusCategory: { colorName: "blue-gray", name: "In Progress" },
              },
              priority: { name: "3-Medium" },
              assignee: { displayName: "Rahul Ramakrishna" },
            },
          },
          fetchedAt: Date.now(),
          fromCache: false,
        }),
      }),
    );
    const subtitle = container.querySelector(".jira-tile-subtitle");
    expect(subtitle?.textContent).toBe("Epic AI-3855 in Jira Cloud");
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
    expect(container.querySelector(".jira-tile-status-badge")).toBeNull();
    expect(container.querySelector(".jira-tile-priority-value")).toBeNull();
    expect(container.querySelector(".jira-tile-assignee-chip")).toBeNull();
    expect(container.querySelector(".jira-tile-issuetype img")).toBeNull();
  });

  it("renders custom fields as labeled cells when configured and value present", async () => {
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
    const labels = Array.from(container.querySelectorAll(".jira-tile-field-label"))
      .map((el) => el.textContent);
    expect(labels).toContain("Sprint");
    expect(labels).toContain("Story Points");
    // Field with no value should be skipped, not show "Missing —".
    expect(labels).not.toContain("Missing");
    expect(container.textContent).toContain("Sprint 1");
    expect(container.textContent).toContain("5");
  });

  it("renders an unassigned chip when assignee is null", async () => {
    const container = document.createElement("div");
    await renderInto(
      container,
      { key: "PROJ-1" },
      makeCtx({
        fetch: async () => ({
          data: fakeIssue({ fields: { summary: "x", assignee: null } }),
          fetchedAt: Date.now(),
          fromCache: false,
        }),
      }),
    );
    const chip = container.querySelector(".jira-tile-assignee-chip--unassigned");
    expect(chip?.textContent).toBe("Unassigned");
  });
});

describe("renderInto — error path", () => {
  it("renders an error tile with retry + Open in Jira", async () => {
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
    expect(container.querySelector(".jira-tile-retry-btn")).not.toBeNull();
    const link = container.querySelector(".jira-tile-open-btn") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toContain("/browse/PROJ-404");
  });
});

describe("renderInto — stale path", () => {
  it("annotates the timestamp with stale modifier when fetcher returns staleError", async () => {
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
    expect(container.querySelector(".jira-tile--stale")).not.toBeNull();
    expect(container.querySelector(".jira-tile-timestamp--stale")).not.toBeNull();
  });
});

describe("refresh on timestamp click", () => {
  it("re-invokes fetch with force=true when the timestamp is clicked", async () => {
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
    const ts = container.querySelector(".jira-tile-timestamp") as HTMLElement;
    expect(ts).not.toBeNull();
    ts.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(2);
    expect(lastForce).toBe(true);
  });
});

describe("Open in Jira button", () => {
  it("links to the canonical browse URL", async () => {
    const container = document.createElement("div");
    await renderInto(container, { key: "PROJ-1" }, makeCtx());
    const link = container.querySelector(".jira-tile-open-btn") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "https://example.atlassian.net/browse/PROJ-1",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.textContent).toBe("Open in Jira");
  });

  it("invokes ctx.open() when provided instead of native navigation", async () => {
    const container = document.createElement("div");
    const opened: string[] = [];
    await renderInto(
      container,
      { key: "PROJ-1" },
      makeCtx({ open: (url) => opened.push(url) }),
    );
    const link = container.querySelector(".jira-tile-open-btn") as HTMLAnchorElement;
    link.click();
    expect(opened).toEqual(["https://example.atlassian.net/browse/PROJ-1"]);
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
    expect(container.querySelector(".jira-tile-summary")?.textContent).toBe(
      "Hello world",
    );
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

describe("timestamp formatting", () => {
  it("shows 'As of today at <time>' when the fetch is on the same calendar day", async () => {
    const container = document.createElement("div");
    const t = new Date("2026-06-24T11:37:00").getTime();
    await renderInto(
      container,
      { key: "PROJ-1" },
      makeCtx({
        fetch: async () => ({
          data: fakeIssue(),
          fetchedAt: t,
          fromCache: false,
        }),
        now: () => new Date("2026-06-24T15:00:00").getTime(),
      }),
    );
    const ts = container.querySelector(".jira-tile-timestamp")?.textContent ?? "";
    expect(ts).toMatch(/^As of today at /);
  });

  it("uses 'yesterday' for the previous calendar day", async () => {
    const container = document.createElement("div");
    const t = new Date("2026-06-23T11:37:00").getTime();
    await renderInto(
      container,
      { key: "PROJ-1" },
      makeCtx({
        fetch: async () => ({
          data: fakeIssue(),
          fetchedAt: t,
          fromCache: false,
        }),
        now: () => new Date("2026-06-24T09:00:00").getTime(),
      }),
    );
    const ts = container.querySelector(".jira-tile-timestamp")?.textContent ?? "";
    expect(ts).toMatch(/^As of yesterday at /);
  });

  it("uses an absolute date for older fetches", async () => {
    const container = document.createElement("div");
    const t = new Date("2026-06-01T11:37:00").getTime();
    await renderInto(
      container,
      { key: "PROJ-1" },
      makeCtx({
        fetch: async () => ({
          data: fakeIssue(),
          fetchedAt: t,
          fromCache: false,
        }),
        now: () => new Date("2026-06-24T09:00:00").getTime(),
      }),
    );
    const ts = container.querySelector(".jira-tile-timestamp")?.textContent ?? "";
    expect(ts).toMatch(/^As of [A-Z][a-z]+ \d+ at /);
  });
});
