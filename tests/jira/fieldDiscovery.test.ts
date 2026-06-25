/**
 * Tests for src/jira/fieldDiscovery.ts
 */

import {
  defaultLabel,
  filterFields,
  loadFields,
} from "../../src/jira/fieldDiscovery";
import type { JiraClient } from "../../src/jira/client";
import type { JiraFieldMeta } from "../../src/jira/types";

const sample: JiraFieldMeta[] = [
  { id: "summary", name: "Summary", custom: false },
  { id: "status", name: "Status", custom: false },
  { id: "duedate", name: "Due date", custom: false },
  { id: "customfield_10020", name: "Sprint", custom: true, schema: { type: "array" } },
  { id: "customfield_10016", name: "Story Points", custom: true, schema: { type: "number" } },
  { id: "customfield_10100", name: "QA Owner", custom: true, schema: { type: "user" } },
];

describe("loadFields", () => {
  it("delegates to client.getFields", async () => {
    const client = {
      getFields: async () => sample,
      getIssue: jest.fn(),
    } as unknown as JiraClient;
    expect(await loadFields(client)).toEqual(sample);
  });
});

describe("filterFields", () => {
  it("returns the full list with no options", () => {
    expect(filterFields(sample)).toHaveLength(sample.length);
  });

  it("filters by name (case-insensitive substring)", () => {
    const r = filterFields(sample, { search: "sprint" });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("customfield_10020");
  });

  it("filters by id", () => {
    const r = filterFields(sample, { search: "10016" });
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("Story Points");
  });

  it("respects customOnly", () => {
    const r = filterFields(sample, { customOnly: true });
    expect(r.every((f) => f.custom)).toBe(true);
    expect(r).toHaveLength(3);
  });

  it("excludes already-configured fields", () => {
    const r = filterFields(sample, {
      excludeIds: ["customfield_10020", "summary"],
    });
    const ids = r.map((f) => f.id);
    expect(ids).not.toContain("customfield_10020");
    expect(ids).not.toContain("summary");
  });

  it("sorts custom fields first when not customOnly", () => {
    const r = filterFields(sample);
    expect(r[0].custom).toBe(true);
  });

  it("sorts alphabetically within customOnly", () => {
    const r = filterFields(sample, { customOnly: true });
    expect(r.map((f) => f.name)).toEqual(["QA Owner", "Sprint", "Story Points"]);
  });
});

describe("defaultLabel", () => {
  it("returns the field name when present", () => {
    expect(defaultLabel({ id: "x", name: "Story Points", custom: true })).toBe(
      "Story Points",
    );
  });

  it("falls back to id when name is empty", () => {
    expect(defaultLabel({ id: "customfield_99", name: "", custom: true })).toBe(
      "customfield_99",
    );
  });
});
