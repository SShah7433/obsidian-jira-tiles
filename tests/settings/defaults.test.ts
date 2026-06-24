/**
 * Tests for src/settings/defaults.ts
 */

import { DEFAULT_SETTINGS, mergeWithDefaults } from "../../src/settings/defaults";

describe("mergeWithDefaults", () => {
  it("returns defaults for null input", () => {
    expect(mergeWithDefaults(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults for undefined input", () => {
    expect(mergeWithDefaults(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("preserves user values", () => {
    const merged = mergeWithDefaults({
      cacheTtlMinutes: 30,
      showStatus: false,
    });
    expect(merged.cacheTtlMinutes).toBe(30);
    expect(merged.showStatus).toBe(false);
    // Untouched defaults still present.
    expect(merged.showPriority).toBe(DEFAULT_SETTINGS.showPriority);
  });

  it("clones customFields rather than sharing references", () => {
    const input = {
      customFields: [{ id: "customfield_1", label: "A", enabled: true }],
    };
    const merged = mergeWithDefaults(input);
    merged.customFields[0].label = "B";
    expect(input.customFields[0].label).toBe("A");
  });

  it("supplies defaults for newly added fields when loaded data is partial", () => {
    const merged = mergeWithDefaults({ authMethod: "apiToken" });
    expect(merged.authMethod).toBe("apiToken");
    expect(merged.cacheTtlMinutes).toBe(DEFAULT_SETTINGS.cacheTtlMinutes);
    expect(merged.customFields).toEqual([]);
  });
});
