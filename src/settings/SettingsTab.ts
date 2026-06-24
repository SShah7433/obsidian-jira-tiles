/**
 * Plugin settings tab.
 *
 * Phase 1 ships:
 *   - A security warning banner about plain-text token storage in data.json.
 *   - An API token form (site URL, email, token) with input validation.
 *   - Basic display toggles (status, priority, assignee, due date, issue type).
 *   - Cache TTL slider.
 *   - Custom fields list (UI present, formatters wired up in Phase 4).
 *
 * Later phases extend this with:
 *   - OAuth "Connect" / "Disconnect" buttons (Phase 3).
 *   - "Discover fields from Jira" picker (Phase 4).
 */

import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import {
  DEFAULT_CACHE_TTL_MINUTES,
  MAX_CACHE_TTL_MINUTES,
} from "../constants";
import { isApiTokenStateComplete, normalizeSiteUrl } from "../auth/apiToken";
import type { CustomFieldConfig } from "./types";

/**
 * Forward-declared type so this file does not import from main.ts (which would
 * create a cycle through the plugin → settings tab edge).
 */
export interface JiraTilesPluginLike {
  app: App;
  settings: import("./types").PluginSettings;
  saveSettings(): Promise<void>;
  /** Called by the tab when the active auth method changes so caches/state can reset. */
  onAuthChanged(): void;
}

export class JiraTilesSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: JiraTilesPluginLike,
  ) {
    super(app, plugin as never);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("jira-tiles-settings");

    this.renderSecurityWarning(containerEl);
    this.renderConnectionSection(containerEl);
    this.renderDisplaySection(containerEl);
    this.renderCustomFieldsSection(containerEl);
    this.renderAdvancedSection(containerEl);
  }

  /* ---------------------------------------------------------------------- */
  /* Sections                                                               */
  /* ---------------------------------------------------------------------- */

  private renderSecurityWarning(parent: HTMLElement): void {
    const ack = this.plugin.settings.storageWarningAcknowledged;
    const banner = parent.createDiv({
      cls: ack
        ? "jira-tiles-warning jira-tiles-warning--ack"
        : "jira-tiles-warning",
    });
    banner.createEl("strong", { text: "Security notice" });
    banner.createEl("p", {
      text:
        "Authentication credentials (API token or OAuth tokens) are stored " +
        "as plain text inside this vault's plugin data file " +
        "(.obsidian/plugins/obsidian-jira-tiles/data.json). Anyone with " +
        "filesystem access to your vault can read them. Prefer OAuth (PKCE), " +
        "rotate tokens regularly, and avoid syncing data.json to untrusted " +
        "locations.",
    });
    if (!ack) {
      const ackBtn = banner.createEl("button", { text: "I understand" });
      ackBtn.addEventListener("click", async () => {
        this.plugin.settings.storageWarningAcknowledged = true;
        await this.plugin.saveSettings();
        this.display();
      });
    }
  }

  private renderConnectionSection(parent: HTMLElement): void {
    parent.createEl("h2", { text: "Connection" });
    parent.createEl("p", {
      text: "OAuth (recommended for SSO) will arrive in a future build. For now, use an Atlassian API token.",
      cls: "setting-item-description",
    });

    const apiToken = this.plugin.settings.apiToken ?? {
      siteUrl: "",
      email: "",
      token: "",
    };

    new Setting(parent)
      .setName("Jira site URL")
      .setDesc("Example: https://acme.atlassian.net")
      .addText((text) =>
        text
          .setPlaceholder("https://your-site.atlassian.net")
          .setValue(apiToken.siteUrl)
          .onChange(async (value) => {
            this.plugin.settings.apiToken = {
              ...apiToken,
              siteUrl: normalizeSiteUrl(value),
            };
            await this.plugin.saveSettings();
          }),
      );

    new Setting(parent)
      .setName("Email")
      .setDesc("The Atlassian account email associated with the API token.")
      .addText((text) =>
        text
          .setPlaceholder("you@example.com")
          .setValue(apiToken.email)
          .onChange(async (value) => {
            this.plugin.settings.apiToken = {
              ...this.plugin.settings.apiToken!,
              email: value.trim(),
            };
            await this.plugin.saveSettings();
          }),
      );

    new Setting(parent)
      .setName("API token")
      .setDesc(
        "Generate at https://id.atlassian.com/manage-profile/security/api-tokens",
      )
      .addText((text) => {
        // Mask token input. We can't mark it password-type via the public API,
        // so set the underlying input element directly.
        text.inputEl.type = "password";
        text
          .setPlaceholder("ATATT...")
          .setValue(apiToken.token)
          .onChange(async (value) => {
            this.plugin.settings.apiToken = {
              ...this.plugin.settings.apiToken!,
              token: value,
            };
            await this.plugin.saveSettings();
          });
      });

    new Setting(parent)
      .setName("Activate API token authentication")
      .setDesc(
        "Switch the plugin to use the credentials above. The values are validated locally only.",
      )
      .addButton((btn) =>
        btn
          .setButtonText("Use API token")
          .setCta()
          .onClick(async () => {
            const t = this.plugin.settings.apiToken;
            if (!isApiTokenStateComplete(t)) {
              new Notice(
                "Please fill in site URL (https://...), email, and token first.",
              );
              return;
            }
            this.plugin.settings.authMethod = "apiToken";
            await this.plugin.saveSettings();
            this.plugin.onAuthChanged();
            new Notice("API token authentication activated.");
            this.display();
          }),
      );

    if (this.plugin.settings.authMethod === "apiToken") {
      new Setting(parent)
        .setName("Status")
        .setDesc(
          `Currently using API token for ${
            this.plugin.settings.apiToken?.siteUrl ?? "(unknown site)"
          }.`,
        )
        .addButton((btn) =>
          btn
            .setButtonText("Disconnect")
            .setWarning()
            .onClick(async () => {
              this.plugin.settings.authMethod = "none";
              await this.plugin.saveSettings();
              this.plugin.onAuthChanged();
              new Notice("Disconnected.");
              this.display();
            }),
        );
    }
  }

  private renderDisplaySection(parent: HTMLElement): void {
    parent.createEl("h2", { text: "Display" });

    const toggles: Array<[
      keyof Pick<
        import("./types").PluginSettings,
        | "showStatus"
        | "showPriority"
        | "showAssignee"
        | "showDueDate"
        | "showIssueType"
      >,
      string,
      string,
    ]> = [
      ["showIssueType", "Show issue type", "Display issue type icon and label."],
      ["showStatus", "Show status", "Display the issue's workflow status."],
      ["showPriority", "Show priority", "Display the issue's priority level."],
      ["showAssignee", "Show assignee", "Display the assignee with avatar."],
      ["showDueDate", "Show due date", "Display the due date when set."],
    ];

    for (const [key, name, desc] of toggles) {
      new Setting(parent)
        .setName(name)
        .setDesc(desc)
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings[key])
            .onChange(async (value) => {
              this.plugin.settings[key] = value;
              await this.plugin.saveSettings();
            }),
        );
    }

    new Setting(parent)
      .setName("Cache TTL (minutes)")
      .setDesc(
        "How long fetched issues are reused before re-querying Jira. Manual refresh always bypasses this.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(1, MAX_CACHE_TTL_MINUTES, 1)
          .setValue(this.plugin.settings.cacheTtlMinutes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.cacheTtlMinutes = value;
            await this.plugin.saveSettings();
          }),
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("rotate-ccw")
          .setTooltip("Reset to default")
          .onClick(async () => {
            this.plugin.settings.cacheTtlMinutes = DEFAULT_CACHE_TTL_MINUTES;
            await this.plugin.saveSettings();
            this.display();
          }),
      );
  }

  private renderCustomFieldsSection(parent: HTMLElement): void {
    parent.createEl("h2", { text: "Custom fields" });
    parent.createEl("p", {
      cls: "setting-item-description",
      text:
        "Add Jira custom fields to display on every tile. Use the field id " +
        "(e.g. customfield_10020). Smart formatters detect users, sprints, " +
        "options, and dates automatically; complex values fall back to JSON.",
    });

    const fields = this.plugin.settings.customFields;
    const listEl = parent.createDiv({ cls: "jira-tiles-customfields" });

    fields.forEach((field, idx) => this.renderCustomFieldRow(listEl, field, idx));

    new Setting(parent)
      .addButton((btn) =>
        btn
          .setButtonText("Add custom field")
          .setCta()
          .onClick(async () => {
            this.plugin.settings.customFields.push({
              id: "",
              label: "",
              enabled: true,
            });
            await this.plugin.saveSettings();
            this.display();
          }),
      );
  }

  private renderCustomFieldRow(
    parent: HTMLElement,
    field: CustomFieldConfig,
    idx: number,
  ): void {
    new Setting(parent)
      .setClass("jira-tiles-customfield-row")
      .addText((text) =>
        text
          .setPlaceholder("customfield_10020")
          .setValue(field.id)
          .onChange(async (value) => {
            this.plugin.settings.customFields[idx].id = value.trim();
            await this.plugin.saveSettings();
          }),
      )
      .addText((text) =>
        text
          .setPlaceholder("Display label")
          .setValue(field.label)
          .onChange(async (value) => {
            this.plugin.settings.customFields[idx].label = value;
            await this.plugin.saveSettings();
          }),
      )
      .addToggle((toggle) =>
        toggle
          .setTooltip("Enabled")
          .setValue(field.enabled)
          .onChange(async (value) => {
            this.plugin.settings.customFields[idx].enabled = value;
            await this.plugin.saveSettings();
          }),
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("trash")
          .setTooltip("Remove")
          .onClick(async () => {
            this.plugin.settings.customFields.splice(idx, 1);
            await this.plugin.saveSettings();
            this.display();
          }),
      );
  }

  private renderAdvancedSection(parent: HTMLElement): void {
    parent.createEl("h2", { text: "Advanced" });
    new Setting(parent)
      .setName("Clear cache")
      .setDesc("Discard cached Jira responses; next render re-fetches.")
      .addButton((btn) =>
        btn.setButtonText("Clear").onClick(() => {
          // Phase 2 hooks the cache here.
          new Notice("Cache cleared.");
        }),
      );
  }
}
