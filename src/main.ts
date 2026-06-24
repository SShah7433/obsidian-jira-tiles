/**
 * JiraTilesPlugin — Obsidian plugin entry point.
 *
 * Lifecycle:
 *   onload   - load settings, instantiate AuthManager, register settings tab.
 *              Phase 2 will also register the ```jira code block processor.
 *              Phase 3 will register the obsidian:// protocol handler.
 *              Phase 5 will register command-palette commands.
 *   onunload - clean up registered handlers (Obsidian auto-deregisters most,
 *              but we explicitly clear caches to free memory).
 *
 * The plugin owns the canonical PluginSettings object and exposes it to
 * subsystems via plain references — they read it directly and call
 * `plugin.saveSettings()` to persist.
 */

import { Plugin } from "obsidian";
import { JiraTilesSettingTab } from "./settings/SettingsTab";
import { mergeWithDefaults, DEFAULT_SETTINGS } from "./settings/defaults";
import type { PluginSettings } from "./settings/types";
import { AuthManager } from "./auth/authManager";

export default class JiraTilesPlugin extends Plugin {
  /** Loaded settings (always populated after onload). */
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  /** Resolves auth context for outgoing Jira REST calls. */
  authManager!: AuthManager;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.authManager = new AuthManager(
      () => this.settings,
      () => this.saveSettings(),
      // refreshFn wired up in Phase 3 (OAuth).
      null,
    );

    this.addSettingTab(new JiraTilesSettingTab(this.app, this));

    // Phase 2 will register the Markdown code block processor here.
    // Phase 3 will register the obsidian:// protocol handler here.
    // Phase 5 will register commands here.
  }

  async onunload(): Promise<void> {
    // Obsidian auto-removes the settings tab and other registered handlers.
    // Caches added in Phase 2 will be explicitly cleared here.
  }

  /**
   * Load settings from disk, merging with defaults so newly added fields are
   * populated for users upgrading from an older version.
   */
  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Partial<PluginSettings> | null;
    this.settings = mergeWithDefaults(raw);
  }

  /** Persist current settings to data.json. */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Called by the SettingsTab when the active auth method changes (e.g. user
   * clicks "Use API token" or "Disconnect"). Phase 2 will invalidate the issue
   * cache here; for now it's a no-op hook so the SettingsTab can call it
   * without conditional logic.
   */
  onAuthChanged(): void {
    // Hook for downstream phases.
  }
}
