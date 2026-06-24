/**
 * Tests for src/render/formatters/version.ts and the version-array
 * detection added to the dispatcher in src/render/formatters/index.ts.
 */

import {
  formatVersionArray,
  looksLikeVersionArray,
} from "../../../src/render/formatters/version";
import { formatCustomField } from "../../../src/render/formatters";

function txt(frag: DocumentFragment): string {
  const div = document.createElement("div");
  div.appendChild(frag);
  return div.textContent ?? "";
}

describe("formatVersionArray", () => {
  it("renders a chip per version", () => {
    const div = document.createElement("div");
    div.appendChild(
      formatVersionArray([
        { id: "1", name: "v1.0", released: true },
        { id: "2", name: "v2.0", released: false },
      ]),
    );
    const chips = div.querySelectorAll(".jira-tile-version-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toBe("v1.0");
    expect(chips[1].textContent).toBe("v2.0");
  });

  it("applies the released modifier and check prefix is rendered via CSS", () => {
    const div = document.createElement("div");
    div.appendChild(
      formatVersionArray([{ id: "1", name: "v1.0", released: true }]),
    );
    const chip = div.querySelector(".jira-tile-version-chip");
    expect(chip?.classList.contains("jira-tile-version-chip--released")).toBe(
      true,
    );
  });

  it("applies the archived modifier", () => {
    const div = document.createElement("div");
    div.appendChild(
      formatVersionArray([{ id: "1", name: "v0.9", archived: true }]),
    );
    const chip = div.querySelector(".jira-tile-version-chip");
    expect(chip?.classList.contains("jira-tile-version-chip--archived")).toBe(
      true,
    );
  });

  it("sets a tooltip with releaseDate when present", () => {
    const div = document.createElement("div");
    div.appendChild(
      formatVersionArray([
        { id: "1", name: "v1.0", released: true, releaseDate: "2026-09-15" },
        { id: "2", name: "v2.0", released: false, releaseDate: "2026-10-01" },
      ]),
    );
    const chips = div.querySelectorAll<HTMLElement>(".jira-tile-version-chip");
    expect(chips[0].title).toBe("Released 2026-09-15");
    expect(chips[1].title).toBe("Planned 2026-10-01");
  });

  it("falls back to (unnamed) when name is missing", () => {
    const div = document.createElement("div");
    div.appendChild(formatVersionArray([{ id: "1" }]));
    expect(div.textContent).toContain("(unnamed)");
  });
});

describe("looksLikeVersionArray", () => {
  it("matches arrays with version flags", () => {
    expect(
      looksLikeVersionArray([
        { id: "1", name: "v1.0", released: true },
        { id: "2", name: "v2.0", released: false },
      ]),
    ).toBe(true);
  });

  it("matches versions with only releaseDate / archived", () => {
    expect(
      looksLikeVersionArray([
        { id: "1", name: "v0.9", releaseDate: "2025-01-01" },
      ]),
    ).toBe(true);
    expect(
      looksLikeVersionArray([{ id: "1", name: "v0.8", archived: true }]),
    ).toBe(true);
  });

  it("matches bare {id,name} version objects (no flags)", () => {
    // Atlassian sometimes returns versions without released/archived/releaseDate
    // when the field is freshly added or unconfigured. We still want to chip
    // them, not fall back to JSON.
    expect(looksLikeVersionArray([{ id: "1", name: "v1.0" }])).toBe(true);
  });

  it("rejects sprint arrays", () => {
    expect(
      looksLikeVersionArray([
        { id: 1, name: "Sprint 41", state: "active" },
      ]),
    ).toBe(false);
  });

  it("rejects option arrays", () => {
    expect(looksLikeVersionArray([{ value: "iOS" }])).toBe(false);
  });

  it("rejects user arrays", () => {
    expect(
      looksLikeVersionArray([
        { displayName: "Alice", accountId: "u1" },
      ]),
    ).toBe(false);
  });

  it("rejects empty arrays", () => {
    expect(looksLikeVersionArray([])).toBe(false);
  });
});

describe("dispatcher routes versions to formatVersionArray", () => {
  it("renders chips for fixVersions-shaped data", () => {
    const div = document.createElement("div");
    div.appendChild(
      formatCustomField([
        { id: "1", name: "v1.0", released: true },
        { id: "2", name: "v2.0", released: false },
      ]),
    );
    const chips = div.querySelectorAll(".jira-tile-version-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0].classList.contains("jira-tile-version-chip--released")).toBe(
      true,
    );
  });

  it("does not steal sprint arrays (which still need state)", () => {
    const div = document.createElement("div");
    div.appendChild(
      formatCustomField([
        { id: 1, name: "Sprint 41", state: "active" },
      ]),
    );
    // Sprint formatter doesn't add the version-chip class.
    expect(div.querySelector(".jira-tile-version-chip")).toBeNull();
    expect(div.textContent).toContain("Sprint 41");
  });
});
