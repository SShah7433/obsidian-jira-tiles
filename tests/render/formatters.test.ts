/**
 * Tests for src/render/formatters/index.ts (the smart-formatter dispatcher)
 * and the individual formatters.
 */

import { formatCustomField } from "../../src/render/formatters";

function txt(frag: DocumentFragment): string {
  const div = document.createElement("div");
  div.appendChild(frag);
  return div.textContent ?? "";
}

describe("formatCustomField — primitives", () => {
  it("renders null/undefined as em-dash", () => {
    expect(txt(formatCustomField(null))).toBe("—");
    expect(txt(formatCustomField(undefined))).toBe("—");
  });

  it("renders strings as text", () => {
    expect(txt(formatCustomField("hello"))).toBe("hello");
  });

  it("renders ISO date strings via the date formatter", () => {
    const out = txt(formatCustomField("2026-07-15"));
    // Locale-dependent, but should at least include the year and a recognizable month.
    expect(out).toMatch(/2026/);
  });

  it("renders booleans as Yes/No", () => {
    expect(txt(formatCustomField(true))).toBe("Yes");
    expect(txt(formatCustomField(false))).toBe("No");
  });

  it("renders numbers with locale grouping", () => {
    expect(txt(formatCustomField(1234))).toBe((1234).toLocaleString());
  });
});

describe("formatCustomField — option/select", () => {
  it("renders a single option", () => {
    expect(txt(formatCustomField({ value: "Platform" }))).toBe("Platform");
  });

  it("renders an array of options as comma-joined", () => {
    const out = txt(
      formatCustomField([{ value: "iOS" }, { value: "Android" }]),
    );
    expect(out).toBe("iOS, Android");
  });
});

describe("formatCustomField — user", () => {
  it("renders display name with avatar img when avatarUrls present", () => {
    const div = document.createElement("div");
    div.appendChild(
      formatCustomField({
        displayName: "Alice",
        avatarUrls: { "24x24": "https://example.com/a.png" },
      }),
    );
    const img = div.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.alt).toBe("");
    expect(div.textContent).toContain("Alice");
  });

  it("renders an initials chip when avatarUrls is missing", () => {
    const div = document.createElement("div");
    div.appendChild(formatCustomField({ displayName: "Bob Builder" }));
    const chip = div.querySelector("span.jira-tile-assignee-avatar") as HTMLSpanElement | null;
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe("BB");
  });

  it("renders an array of users", () => {
    expect(
      txt(
        formatCustomField([
          { displayName: "Alice" },
          { displayName: "Bob" },
        ]),
      ),
    ).toContain("Alice");
  });
});

describe("formatCustomField — sprint array", () => {
  it("joins sprint names and applies state classes", () => {
    const div = document.createElement("div");
    div.appendChild(
      formatCustomField([
        { id: 1, name: "S41", state: "closed" },
        { id: 2, name: "S42", state: "active" },
      ]),
    );
    expect(div.textContent).toContain("S41");
    expect(div.textContent).toContain("S42");
    const spans = Array.from(div.querySelectorAll("span"));
    const active = spans.find((s) => s.textContent === "S42");
    expect(active?.classList.contains("jira-sprint--active")).toBe(true);
    const closed = spans.find((s) => s.textContent === "S41");
    expect(closed?.classList.contains("jira-sprint--closed")).toBe(true);
  });
});

describe("formatCustomField — fallback", () => {
  it("JSON-stringifies unknown shapes into a <code> block", () => {
    const div = document.createElement("div");
    div.appendChild(formatCustomField({ unknown: { weird: "shape", n: 42 } }));
    const code = div.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain("weird");
  });

  it("truncates extremely long fallback values", () => {
    const big = "x".repeat(1000);
    const div = document.createElement("div");
    div.appendChild(formatCustomField({ payload: big }));
    expect(div.textContent?.length).toBeLessThan(big.length);
    expect(div.textContent).toMatch(/…$/);
  });
});

describe("formatCustomField — empty array", () => {
  it("renders an em-dash", () => {
    expect(txt(formatCustomField([]))).toBe("—");
  });
});
