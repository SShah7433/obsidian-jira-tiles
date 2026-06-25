/**
 * JiraTilesPlugin — Obsidian plugin entry point.
 *
 * Lifecycle:
 *   onload   - load settings, instantiate Jira client + cache + AuthManager,
 *              register settings tab, register the ```jira code block
 *              processor, and register command-palette commands.
 *   onunload - Obsidian deregisters our handlers; we clear caches.
 */

import { Notice, Plugin } from "obsidian";
import { JiraTilesSettingTab } from "./settings/SettingsTab";
import { mergeWithDefaults, DEFAULT_SETTINGS } from "./settings/defaults";
import type { PluginSettings } from "./settings/types";
import { AuthManager } from "./auth/authManager";
import { SecretsService } from "./auth/secrets";
import { migrateSecretsIfNeeded } from "./auth/migration";
import { JiraClient } from "./jira/client";
import { IssueCache } from "./cache/issueCache";
import { buildCodeBlockProcessor } from "./render/codeBlockProcessor";
import { buildCommands } from "./commands";

/**
 * Open an external URL using the most reliable mechanism available.
 *
 * Inside Obsidian Desktop (Electron), `window.open` may open an *internal*
 * browser window. We bypass that by calling Electron's `shell.openExternal`
 * when it's reachable, falling back to `window.open` on mobile / unknown
 * environments.
 */
function openExternalUrl(url: string): void {
  // Try Electron first — only available on desktop.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = (window as { require?: (m: string) => unknown }).require?.(
      "electron",
    ) as { shell?: { openExternal?: (u: string) => Promise<void> } } | undefined;
    if (electron?.shell?.openExternal) {
      void electron.shell.openExternal(url);
      return;
    }
  } catch {
    // Not Electron — fall through.
  }
  // Mobile / fallback.
  window.open(url, "_blank", "noopener");
}

export default class JiraTilesPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  authManager!: AuthManager;
  client!: JiraClient;
  cache!: IssueCache;
  secrets!: SecretsService;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.secrets = new SecretsService(this.app);

    // One-time migration: move any pre-SecretStorage plain-text tokens out
    // of data.json and into SecretStorage, and drop any legacy OAuth state.
    // Idempotent — guarded by settings.secretsMigrationComplete. We run
    // before constructing the auth machinery so it sees the post-migration
    // shape.
    const migration = await migrateSecretsIfNeeded(
      this.settings,
      this.secrets,
      Notice,
    );
    if (migration.migrated) {
      await this.saveSettings();
    }

    this.authManager = new AuthManager(() => this.settings, this.secrets);

    this.client = new JiraClient({ authManager: this.authManager });
    this.cache = new IssueCache(() => this.settings.cacheTtlMinutes * 60_000);

    this.addSettingTab(new JiraTilesSettingTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor(
      "jira",
      buildCodeBlockProcessor({
        client: this.client,
        cache: this.cache,
        getSettings: () => this.settings,
        openUrl: (url) => openExternalUrl(url),
      }),
    );

    // Command palette entries.
    for (const cmd of buildCommands({ app: this.app, cache: this.cache })) {
      this.addCommand(cmd);
    }
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
