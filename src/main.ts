/**
 * JiraTilesPlugin — Obsidian plugin entry point.
 *
 * Lifecycle:
 *   onload   - load settings, instantiate Jira client + cache + AuthManager,
 *              register settings tab, register the ```jira code block
 *              processor, and register command-palette commands.
 *   onunload - Obsidian deregisters our handlers; we clear caches.
 */

import { Plugin } from "obsidian";
import { JiraTilesSettingTab } from "./settings/SettingsTab";
import { mergeWithDefaults, DEFAULT_SETTINGS } from "./settings/defaults";
import type { PluginSettings } from "./settings/types";
import { AuthManager } from "./auth/authManager";
import { SecretsService } from "./auth/secrets";
import { JiraClient } from "./jira/client";
import { IssueCache } from "./cache/issueCache";
import {
  buildCodeBlockProcessor,
  type CodeBlockProcessorDeps,
} from "./render/codeBlockProcessor";
import { buildLinkPostProcessor } from "./render/linkPostProcessor";
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
    this.authManager = new AuthManager(() => this.settings, this.secrets);

    this.client = new JiraClient({ authManager: this.authManager });
    this.cache = new IssueCache(() => this.settings.cacheTtlMinutes * 60_000);

    this.addSettingTab(new JiraTilesSettingTab(this.app, this));

    // Shared dependency bundle for both rendering entry points.
    const renderDeps: CodeBlockProcessorDeps = {
      client: this.client,
      cache: this.cache,
      getSettings: () => this.settings,
      openUrl: (url) => openExternalUrl(url),
    };

    // Code-block syntax (```jira). Always registered; it's a no-op when the
    // user writes no jira blocks, and gating it on renderMode would require a
    // reload to toggle. The block only renders when present in the note.
    this.registerMarkdownCodeBlockProcessor(
      "jira",
      buildCodeBlockProcessor(renderDeps),
    );

    // Inline Jira-URL auto-replacement. The processor itself checks the
    // render mode on each call, so toggling the setting takes effect on the
    // next note render without a reload.
    this.registerMarkdownPostProcessor(buildLinkPostProcessor(renderDeps));

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

  /** Drop all cached issue data (used by the "Clear cache" setting). */
  clearCache(): void {
    this.cache?.invalidate();
  }
}
