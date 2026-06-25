/**
 * Regression tests for the SettingsTab's API-token credential merging.
 *
 * The previous implementation captured `apiToken` once at render time and
 * spread from that snapshot in each onChange handler. That meant typing
 * into one field could clobber values typed into another — the user would
 * fill all three fields, then click "Use API token", and get told the
 * fields were missing. This test exercises the read-modify-write pattern
 * the SettingsTab now uses (read current, merge patch, write back).
 *
 * Credentials are stored via SecretStorage, so `tokenSecretName` (a *name*,
 * not the value) is what lives in settings. The merging contract is the
 * same regardless.
 */

import { isApiTokenStateComplete } from "../../src/auth/apiToken";
import type { ApiTokenState, PluginSettings } from "../../src/settings/types";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";

/**
 * Reproduces the SettingsTab's `updateApiToken` helper. If this drifts away
 * from SettingsTab's implementation, the test loses its regression value —
 * keep them in sync.
 */
function updateApiToken(
  settings: PluginSettings,
  patch: Partial<ApiTokenState>,
): void {
  const current: ApiTokenState = settings.apiToken ?? {
    siteUrl: "",
    email: "",
    tokenSecretName: "",
  };
  settings.apiToken = { ...current, ...patch };
}

describe("API token field merging (SettingsTab onChange behavior)", () => {
  it("preserves siteUrl when the user types email afterwards", () => {
    const s: PluginSettings = { ...DEFAULT_SETTINGS };
    updateApiToken(s, { siteUrl: "https://acme.atlassian.net" });
    updateApiToken(s, { email: "alice@example.com" });
    expect(s.apiToken).toEqual({
      siteUrl: "https://acme.atlassian.net",
      email: "alice@example.com",
      tokenSecretName: "",
    });
  });

  it("preserves all fields when the user types in any order (email -> token -> siteUrl)", () => {
    const s: PluginSettings = { ...DEFAULT_SETTINGS };
    updateApiToken(s, { email: "alice@example.com" });
    updateApiToken(s, { tokenSecretName: "jira-tiles:api-token" });
    updateApiToken(s, { siteUrl: "https://acme.atlassian.net" });
    expect(s.apiToken).toEqual({
      siteUrl: "https://acme.atlassian.net",
      email: "alice@example.com",
      tokenSecretName: "jira-tiles:api-token",
    });
    expect(isApiTokenStateComplete(s.apiToken)).toBe(true);
  });

  it("preserves prior values when the user edits a single field again", () => {
    const s: PluginSettings = { ...DEFAULT_SETTINGS };
    updateApiToken(s, {
      siteUrl: "https://acme.atlassian.net",
      email: "alice@example.com",
      tokenSecretName: "jira-tiles:api-token",
    });
    updateApiToken(s, { tokenSecretName: "user-named-secret" });
    expect(s.apiToken).toEqual({
      siteUrl: "https://acme.atlassian.net",
      email: "alice@example.com",
      tokenSecretName: "user-named-secret",
    });
  });

  it("does not lose intermediate keystrokes during fast typing", () => {
    const s: PluginSettings = { ...DEFAULT_SETTINGS };
    // Simulate a user holding down keys: each keystroke fires onChange.
    const sequence = ["a", "al", "ali", "alic", "alice", "alice@", "alice@example.com"];
    for (const v of sequence) updateApiToken(s, { email: v });
    expect(s.apiToken?.email).toBe("alice@example.com");

    const urlKeys = ["a", "ac", "acm", "acme", "acme.atlassian.net"];
    for (const v of urlKeys) updateApiToken(s, { siteUrl: v });
    // Email should still be there even after a stream of siteUrl updates.
    expect(s.apiToken?.email).toBe("alice@example.com");
    expect(s.apiToken?.siteUrl).toBe("acme.atlassian.net");
  });
});
