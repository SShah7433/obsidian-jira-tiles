/**
 * Tests for src/render/icons.ts — issue type + priority icon rendering.
 */

import {
  matchPriorityName,
  renderIssueTypeIcon,
  renderPriorityIcon,
} from "../../src/render/icons";

describe("renderIssueTypeIcon", () => {
  it("uses iconUrl when provided", () => {
    const el = document.createElement("div");
    renderIssueTypeIcon(el, "https://example.com/story.png", "Story");
    const img = el.querySelector("img.jira-icon-img") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toBe("https://example.com/story.png");
    expect(img.alt).toBe("Story");
  });

  it("falls back to inline SVG when iconUrl is missing and name matches", () => {
    const el = document.createElement("div");
    renderIssueTypeIcon(el, undefined, "Story");
    const svg = el.querySelector("svg.jira-icon-svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-label")).toBe("Story");
  });

  it("matches built-in icons for Task, Bug, Epic, Sub-task, Improvement, New Feature", () => {
    const names = ["Task", "Bug", "Epic", "Sub-task", "Subtask", "Improvement", "New Feature"];
    for (const n of names) {
      const el = document.createElement("div");
      renderIssueTypeIcon(el, undefined, n);
      expect(el.querySelector("svg.jira-icon-svg")).not.toBeNull();
    }
  });

  it("uses a letter chip when neither iconUrl nor a known name match", () => {
    const el = document.createElement("div");
    renderIssueTypeIcon(el, undefined, "Spike");
    const chip = el.querySelector("span.jira-icon-chip");
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe("S");
  });

  it("uses '?' chip when name is missing entirely", () => {
    const el = document.createElement("div");
    renderIssueTypeIcon(el, undefined, undefined);
    const chip = el.querySelector("span.jira-icon-chip");
    expect(chip?.textContent).toBe("?");
  });
});

describe("renderPriorityIcon", () => {
  it("uses iconUrl when provided", () => {
    const el = document.createElement("div");
    renderPriorityIcon(el, "https://example.com/high.png", "High");
    const img = el.querySelector("img.jira-icon-img") as HTMLImageElement;
    expect(img.src).toBe("https://example.com/high.png");
  });

  it("falls back to High SVG for 'High'", () => {
    const el = document.createElement("div");
    renderPriorityIcon(el, undefined, "High");
    expect(el.querySelector("svg.jira-priority-svg")).not.toBeNull();
  });

  it("falls back to a generic medium icon when name is unknown", () => {
    const el = document.createElement("div");
    renderPriorityIcon(el, undefined, "Wat");
    expect(el.querySelector("svg.jira-priority-svg")).not.toBeNull();
  });
});

describe("matchPriorityName", () => {
  it("matches canonical names", () => {
    expect(matchPriorityName("Highest")).toBe("highest");
    expect(matchPriorityName("High")).toBe("high");
    expect(matchPriorityName("Medium")).toBe("medium");
    expect(matchPriorityName("Low")).toBe("low");
    expect(matchPriorityName("Lowest")).toBe("lowest");
  });

  it("strips numeric prefixes ('3-Medium', '2.High')", () => {
    expect(matchPriorityName("3-Medium")).toBe("medium");
    expect(matchPriorityName("1-Highest")).toBe("highest");
    expect(matchPriorityName("2.High")).toBe("high");
  });

  it("strips parenthetical qualifiers", () => {
    expect(matchPriorityName("3-Medium (potential to escalate)")).toBe("medium");
    expect(matchPriorityName("High (urgent)")).toBe("high");
  });

  it("handles synonyms", () => {
    expect(matchPriorityName("Critical")).toBe("highest");
    expect(matchPriorityName("Blocker")).toBe("highest");
    expect(matchPriorityName("Major")).toBe("medium");
    expect(matchPriorityName("Normal")).toBe("medium");
    expect(matchPriorityName("Minor")).toBe("lowest");
    expect(matchPriorityName("Trivial")).toBe("lowest");
  });

  it("recognizes 'highest' before 'high' (substring guard)", () => {
    expect(matchPriorityName("Highest priority")).toBe("highest");
  });

  it("returns undefined for unrecognized names", () => {
    expect(matchPriorityName("Wat")).toBeUndefined();
    expect(matchPriorityName(undefined)).toBeUndefined();
    expect(matchPriorityName("")).toBeUndefined();
  });
});
