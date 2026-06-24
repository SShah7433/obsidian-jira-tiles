/**
 * JiraTilesPlugin — Obsidian plugin entry point.
 *
 * Lifecycle:
 *   onload   - load settings, instantiate AuthManager + Jira client + cache,
 *              register settings tab and the ```jira code block processor.
 *              Phase 3 will register the obsidian:// protocol handler.
 *              Phase 5 will register command-palette commands.
 *   onunload - Obsidian deregisters our handlers; we explicitly clear caches.
 */

import { Plugin } from "obsidian";
import { JiraTilesSettingTab } from "./settings/SettingsTab";
import { mergeWithDefaults, DEFAULT_SETTINGS } from "./settings/defaults";
import type { PluginSettings } from "./settings/types";
import { AuthManager } from "./auth/authManager";
import { JiraClient } from "./jira/client";
import { IssueCache } from "./cache/issueCache";
import { buildCodeBlockProcessor } from "./render/codeBlockProcessor";

export default class JiraTilesPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  authManager!: AuthManager;
  client!: JiraClient;
  cache!: IssueCache;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.authManager = new AuthManager(
      () => this.settings,
      () => this.saveSettings(),
      // refreshFn wired up in Phase 3 (OAuth).
      null,
    );

    this.client = new JiraClient({ authManager: this.authManager });
    this.cache = new IssueCache(() => this.settings.cacheTtlMinutes * 60_000);

    this.addSettingTab(new JiraTilesSettingTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor(
      "jira",
      buildCodeBlockProcessor({
        client: this.client,
        cache: this.cache,
        getSettings: () => this.settings,
        openUrl: (url) => window.open(url, "_blank", "noopener"),
      }),
    );

    // Phase 3 will register the obsidian:// protocol handler here.
    // Phase 5 will register commands here.
  }

  async onunload(): Promise<void> {
    this.cache?.invalidate();
  }

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Partial<PluginSettings> | null;
    this.settings = mergeWithDefaults(raw);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Called by the SettingsTab when the active auth method changes. Drops the
   * cache so we don't render data fetched under the previous identity.
   */
  onAuthChanged(): void {
    this.cache?.invalidate();
  }
}
