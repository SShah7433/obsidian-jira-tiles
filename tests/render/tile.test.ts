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
  it("renders summary with key, status, priority (with icon), assignee, and issue-type field", async () => {
    const container = document.createElement("div");
    await renderInto(container, { key: "PROJ-1" }, makeCtx());

    // Summary line leads with the issue key, then the summary text.
    const summary = container.querySelector(".jira-tile-summary");
    expect(summary?.querySelector(".jira-tile-key")?.textContent).toBe("PROJ-1");
    expect(
      summary?.querySelector(".jira-tile-summary-text")?.textContent,
    ).toBe("Hello world");

    // No parent on the default fixture, so no subtitle is rendered.
    expect(container.querySelector(".jira-tile-subtitle")).toBeNull();

    const labels = Array.from(
      container.querySelectorAll(".jira-tile-field-label"),
    ).map((el) => el.textContent);
    expect(labels).toEqual(
      expect.arrayContaining(["Issue Type", "Status", "Priority", "Assignee", "Due"]),
    );

    // Status badge.
    const badge = container.querySelector(".jira-tile-status-badge");
    expect(badge?.textContent).toBe("In Progress");
    expect(badge?.classList.contains("jira-tile-status-badge--yellow")).toBe(true);

    // Priority cell has both an inline icon and the name.
    const priorityCell = container.querySelector(".jira-tile-cell--priority");
    expect(priorityCell?.querySelector(".jira-tile-icon-inline")).not.toBeNull();
    expect(priorityCell?.querySelector(".jira-tile-priority-name")?.textContent).toBe("High");

    // Issue-type cell has icon and name.
    const itCell = container.querySelector(".jira-tile-cell--issuetype");
    expect(itCell?.querySelector(".jira-tile-icon-inline")).not.toBeNull();
    expect(itCell?.querySelector(".jira-tile-issuetype-name")?.textContent).toBe("Task");

    // Assignee chip rendered with the name.
    const chip = container.querySelector(".jira-tile-assignee-chip");
    expect(chip?.textContent).toContain("Alice");
  });

  it("shows the issue's own key in the summary and the parent in the subtitle", async () => {
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
    // Issue's own key lives in the summary line.
    const summary = container.querySelector(".jira-tile-summary");
    expect(summary?.querySelector(".jira-tile-key")?.textContent).toBe(
      "MCP-2607",
    );
    // Subtitle conveys the parent relationship only.
    const subtitle = container.querySelector(".jira-tile-subtitle");
    expect(subtitle?.textContent).toBe("Epic AI-3855 in Jira Cloud");
  });

  it("omits the subtitle when there is no parent, but still shows the key", async () => {
    const container = document.createElement("div");
    await renderInto(container, { key: "PROJ-1" }, makeCtx());
    expect(container.querySelector(".jira-tile-subtitle")).toBeNull();
    expect(
      container.querySelector(".jira-tile-summary .jira-tile-key")?.textContent,
    ).toBe("PROJ-1");
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
          showIssueTypeField: false,
          showFixVersions: false,
          customFields: [],
        },
      }),
    );
    expect(container.textContent).toContain("Hello world");
    expect(container.querySelector(".jira-tile-status-badge")).toBeNull();
    expect(container.querySelector(".jira-tile-cell--priority")).toBeNull();
    expect(container.querySelector(".jira-tile-cell--issuetype")).toBeNull();
    expect(container.querySelector(".jira-tile-assignee-chip")).toBeNull();
  });

  it("places custom fields in their own grid with data-count attribute", async () => {
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
              customfield_10100: { value: "Platform" },
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
            { id: "customfield_10100", label: "Team", enabled: true },
            { id: "customfield_99999", label: "Missing", enabled: true },
          ],
        },
      }),
    );
    const customGrid = container.querySelector(".jira-tile-grid--custom") as
      | HTMLElement
      | null;
    expect(customGrid).not.toBeNull();
    // Three present fields (Missing skipped because no value).
    expect(customGrid?.dataset.count).toBe("3");
    const customLabels = Array.from(
      customGrid?.querySelectorAll(".jira-tile-field-label") ?? [],
    ).map((el) => el.textContent);
    expect(customLabels).toEqual(["Sprint", "Story Points", "Team"]);
    expect(customLabels).not.toContain("Missing");
  });

  it("does not create the custom grid when no custom field has a value", async () => {
    const container = document.createElement("div");
    await renderInto(
      container,
      { key: "PROJ-1" },
      makeCtx({
        display: {
          ...displayOptionsFromSettings(DEFAULT_SETTINGS),
          customFields: [
            { id: "customfield_99999", label: "Missing", enabled: true },
          ],
        },
      }),
    );
    expect(container.querySelector(".jira-tile-grid--custom")).toBeNull();
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

  it("renders a Fix Versions cell with one chip per version", async () => {
    const container = document.createElement("div");
    await renderInto(
      container,
      { key: "PROJ-1" },
      makeCtx({
        fetch: async () => ({
          data: fakeIssue({
            fields: {
              summary: "x",
              fixVersions: [
                { id: "1", name: "v1.0", released: true },
                { id: "2", name: "v2.0", released: false },
              ],
            },
          }),
          fetchedAt: Date.now(),
          fromCache: false,
        }),
      }),
    );
    const cell = container.querySelector(".jira-tile-cell--fixversions");
    expect(cell).not.toBeNull();
    expect(cell?.querySelector(".jira-tile-field-label")?.textContent).toBe(
      "Fix Versions",
    );
    const chips = cell?.querySelectorAll(".jira-tile-version-chip") ?? [];
    expect(chips.length).toBe(2);
  });

  it("omits the Fix Versions cell entirely when the array is empty/missing", async () => {
    const container = document.createElement("div");
    await renderInto(
      container,
      { key: "PROJ-1" },
      makeCtx({
        fetch: async () => ({
          data: fakeIssue({ fields: { summary: "x", fixVersions: [] } }),
          fetchedAt: Date.now(),
          fromCache: false,
        }),
      }),
    );
    expect(container.querySelector(".jira-tile-cell--fixversions")).toBeNull();
  });

  it("places Fix Versions immediately after Due Date in the standard grid", async () => {
    // Visual contract: Fix Versions sits next to Due Date so the two read
    // together. Locking via DOM order — adjacent cells under the same grid.
    const container = document.createElement("div");
    await renderInto(
      container,
      { key: "PROJ-1" },
      makeCtx({
        fetch: async () => ({
          data: fakeIssue({
            fields: {
              summary: "x",
              duedate: "2026-09-15",
              fixVersions: [{ id: "1", name: "v1.0", released: true }],
            },
          }),
          fetchedAt: Date.now(),
          fromCache: false,
        }),
      }),
    );
    const grid = container.querySelector(".jira-tile-grid--standard")!;
    const cells = Array.from(grid.children);
    const dueIndex = cells.findIndex((c) =>
      c.classList.contains("jira-tile-cell--duedate"),
    );
    const fixVersionsIndex = cells.findIndex((c) =>
      c.classList.contains("jira-tile-cell--fixversions"),
    );
    expect(dueIndex).toBeGreaterThan(-1);
    expect(fixVersionsIndex).toBe(dueIndex + 1);
    // And both must come *before* Assignee.
    const assigneeIndex = cells.findIndex((c) =>
      c.classList.contains("jira-tile-cell--assignee"),
    );
    if (assigneeIndex !== -1) {
      expect(fixVersionsIndex).toBeLessThan(assigneeIndex);
    }
  });
});

describe("renderInto — error path", () => {
  it("renders an error tile with refresh + Open in Jira buttons", async () => {
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
    expect(container.querySelector(".jira-tile-refresh-btn")).not.toBeNull();
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

describe("Refresh button", () => {
  it("re-invokes fetch with force=true when clicked", async () => {
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
    const btn = container.querySelector(
      ".jira-tile-refresh-btn",
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    btn.click();
    // Allow async refresh to settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(2);
    expect(lastForce).toBe(true);
  });

  it("renders to the left of the Open in Jira button", async () => {
    const container = document.createElement("div");
    await renderInto(container, { key: "PROJ-1" }, makeCtx());
    const actions = container.querySelector(".jira-tile-actions");
    const children = Array.from(actions?.children ?? []);
    expect(children.length).toBe(2);
    expect(children[0].classList.contains("jira-tile-refresh-btn")).toBe(true);
    expect(children[1].classList.contains("jira-tile-open-btn")).toBe(true);
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
    expect(
      container.querySelector(".jira-tile-summary-text")?.textContent,
    ).toBe("Hello world");
    expect(
      container.querySelector(".jira-tile-summary .jira-tile-key")?.textContent,
    ).toBe("PROJ-1");
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

describe("compact mode", () => {
  it("renders a single-row tile when request.compact === true", async () => {
    const container = document.createElement("div");
    await renderInto(container, { key: "PROJ-1", compact: true }, makeCtx());
    expect(container.querySelector(".jira-tile--compact")).not.toBeNull();
    expect(container.querySelector(".jira-tile-compact-row")).not.toBeNull();
    // No body / footer / subtitle in compact mode.
    expect(container.querySelector(".jira-tile-body")).toBeNull();
    expect(container.querySelector(".jira-tile-footer")).toBeNull();
    expect(container.querySelector(".jira-tile-subtitle")).toBeNull();
    // No labeled grids.
    expect(container.querySelector(".jira-tile-grid--standard")).toBeNull();
    expect(container.querySelector(".jira-tile-grid--custom")).toBeNull();
  });

  it("shows summary, status badge, priority icon, and assignee chip inline", async () => {
    const container = document.createElement("div");
    await renderInto(container, { key: "PROJ-1", compact: true }, makeCtx());
    expect(container.textContent).toContain("Hello world"); // summary
    expect(container.querySelector(".jira-tile-status-badge")?.textContent).toBe(
      "In Progress",
    );
    expect(
      container.querySelector(".jira-tile-compact-priority"),
    ).not.toBeNull();
    expect(
      container.querySelector(".jira-tile-compact-assignee"),
    ).not.toBeNull();
  });

  it("renders refresh + icon-only open buttons in compact mode", async () => {
    const container = document.createElement("div");
    await renderInto(container, { key: "PROJ-1", compact: true }, makeCtx());
    const actions = container.querySelector(".jira-tile-actions");
    expect(actions).not.toBeNull();
    expect(actions?.querySelector(".jira-tile-refresh-btn")).not.toBeNull();
    const open = actions?.querySelector(
      ".jira-tile-open-btn--icon",
    ) as HTMLAnchorElement | null;
    expect(open).not.toBeNull();
    expect(open?.getAttribute("href")).toBe(
      "https://example.atlassian.net/browse/PROJ-1",
    );
    // No "Open in Jira" text — icon only.
    expect(open?.textContent?.trim()).toBe("");
  });

  it("hides the priority + assignee when their toggles are off", async () => {
    const container = document.createElement("div");
    await renderInto(
      container,
      { key: "PROJ-1", compact: true },
      makeCtx({
        display: {
          showStatus: true,
          showPriority: false,
          showAssignee: false,
          showDueDate: false,
          showIssueType: true,
          showIssueTypeField: false,
          showFixVersions: false,
          customFields: [],
        },
      }),
    );
    expect(container.querySelector(".jira-tile-compact-priority")).toBeNull();
    expect(container.querySelector(".jira-tile-compact-assignee")).toBeNull();
    // Status still present.
    expect(container.querySelector(".jira-tile-status-badge")).not.toBeNull();
  });

  it("annotates the tile root with jira-tile--stale when fetcher returns staleError", async () => {
    const container = document.createElement("div");
    await renderInto(
      container,
      { key: "PROJ-1", compact: true },
      makeCtx({
        fetch: async () => ({
          data: fakeIssue(),
          fetchedAt: Date.now() - 60_000,
          fromCache: true,
          staleError: new Error("Network unreachable"),
        }),
      }),
    );
    expect(container.querySelector(".jira-tile--compact")).not.toBeNull();
    expect(container.querySelector(".jira-tile--stale")).not.toBeNull();
  });

  it("renders a compact error tile with retry + open icon when fetch rejects", async () => {
    const container = document.createElement("div");
    await renderInto(
      container,
      { key: "PROJ-404", compact: true },
      makeCtx({
        fetch: async () => {
          throw new Error("Issue not found");
        },
      }),
    );
    const tile = container.querySelector(".jira-tile--compact");
    expect(tile).not.toBeNull();
    expect(tile?.classList.contains("jira-tile--error")).toBe(true);
    expect(container.textContent).toContain("Issue not found");
    expect(container.querySelector(".jira-tile-refresh-btn")).not.toBeNull();
    expect(container.querySelector(".jira-tile-open-btn--icon")).not.toBeNull();
    // No multi-line error layout in compact mode.
    expect(container.querySelector(".jira-tile-body")).toBeNull();
  });

  it("renders a compact loading skeleton when request.compact === true and fetch is in flight", async () => {
    const container = document.createElement("div");
    const neverResolves = new Promise<never>(() => undefined);
    void renderInto(
      container,
      { key: "PROJ-1", compact: true },
      makeCtx({ fetch: () => neverResolves }),
    );
    // mountSkeleton runs synchronously before the first await.
    expect(container.querySelector(".jira-tile--compact")).not.toBeNull();
    expect(container.querySelector(".jira-tile--loading")).not.toBeNull();
    expect(container.querySelector(".jira-tile-compact-row")).not.toBeNull();
    expect(container.querySelector(".jira-tile-body")).toBeNull();
  });
});
