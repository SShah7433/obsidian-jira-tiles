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
import { FieldPickerModal } from "./FieldPickerModal";

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
  /**
   * Optional OAuth orchestration handle — present in the real plugin, omitted
   * in tests / lightweight harnesses.
   */
  oauthFlow?: { beginConnect(): Promise<unknown>; cancelAll(reason?: string): void };
  /** Jira client — used by the field discovery picker. Optional for harnesses. */
  client?: import("../jira/client").JiraClient;
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

    /* OAuth section ------------------------------------------------------- */

    parent.createEl("h3", { text: "OAuth (recommended)" });
    parent.createEl("p", {
      cls: "setting-item-description",
      text:
        "OAuth supports SSO and avoids static credentials. The plugin will " +
        "open your browser to authorize, and Atlassian will redirect back " +
        "to Obsidian via a custom URI handler.",
    });

    if (this.plugin.settings.authMethod === "oauth" && this.plugin.settings.oauth) {
      const o = this.plugin.settings.oauth;
      new Setting(parent)
        .setName("Connected")
        .setDesc(`${o.siteName} (${o.siteUrl})`)
        .addButton((btn) =>
          btn
            .setButtonText("Disconnect")
            .setWarning()
            .onClick(async () => {
              this.plugin.settings.authMethod = "none";
              this.plugin.settings.oauth = undefined;
              await this.plugin.saveSettings();
              this.plugin.onAuthChanged();
              new Notice("Disconnected from Jira.");
              this.display();
            }),
        );
    } else {
      new Setting(parent)
        .setName("Connect with Atlassian")
        .setDesc(
          "Opens https://auth.atlassian.com in your browser, then returns to Obsidian.",
        )
        .addButton((btn) =>
          btn
            .setButtonText("Connect")
            .setCta()
            .onClick(async () => {
              if (!this.plugin.oauthFlow) {
                new Notice("OAuth not available in this build.");
                return;
              }
              try {
                new Notice("Opening browser to sign in…");
                await this.plugin.oauthFlow.beginConnect();
                new Notice("Connected to Jira.");
                this.plugin.onAuthChanged();
                this.display();
              } catch (err) {
                // Longer Notice timeout (10s) so the user has time to read
                // the actual error before it disappears. Also log the full
                // error to the console for DevTools debugging.
                console.error("[jira-tiles] Connect failed:", err);
                const msg = (err as Error).message ?? String(err);
                new Notice(`Sign-in failed: ${msg}`, 10_000);
              }
            }),
        );
    }

    /* API token section --------------------------------------------------- */

    parent.createEl("h3", { text: "API token (fallback)" });
    parent.createEl("p", {
      cls: "setting-item-description",
      text:
        "Use an Atlassian API token. Generate at " +
        "https://id.atlassian.com/manage-profile/security/api-tokens. " +
        "Suitable when OAuth/SSO is not available.",
    });

    /**
     * Read-modify-write helper for the API token credential bag.
     *
     * IMPORTANT: each onChange handler must read the *current* persisted
     * state at fire time, not a snapshot captured at render time. Capturing
     * at render meant that typing into one field would clobber values
     * already entered into other fields (the captured snapshot was missing
     * those values). Use this helper everywhere instead of spreading from
     * a stale local variable.
     */
    const updateApiToken = async (
      patch: Partial<import("./types").ApiTokenState>,
    ): Promise<void> => {
      const current = this.plugin.settings.apiToken ?? {
        siteUrl: "",
        email: "",
        token: "",
      };
      this.plugin.settings.apiToken = { ...current, ...patch };
      await this.plugin.saveSettings();
    };

    // For initial population only — never spread from this in handlers.
    const initial = this.plugin.settings.apiToken ?? {
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
          .setValue(initial.siteUrl)
          .onChange(async (value) => {
            // Defer normalization until the field looks complete; otherwise
            // mid-typing values like "h" become "https://h" which then race
            // ahead of the user's intent. We trim whitespace but only force
            // the https:// prefix if the user has typed something
            // recognizably URL-shaped (contains a dot or already begins
            // with http/https).
            const trimmed = value.trim();
            const looksUrlish =
              /^https?:\/\//i.test(trimmed) || trimmed.includes(".");
            const stored = looksUrlish
              ? normalizeSiteUrl(trimmed)
              : trimmed;
            await updateApiToken({ siteUrl: stored });
          }),
      );

    new Setting(parent)
      .setName("Email")
      .setDesc("The Atlassian account email associated with the API token.")
      .addText((text) =>
        text
          .setPlaceholder("you@example.com")
          .setValue(initial.email)
          .onChange(async (value) => {
            await updateApiToken({ email: value.trim() });
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
          .setValue(initial.token)
          .onChange(async (value) => {
            // Don't trim the token — Atlassian tokens are opaque blobs and
            // some users have whitespace-bearing tokens (rare, but possible).
            // We still strip leading/trailing whitespace because copy-paste
            // commonly drags newline characters along.
            await updateApiToken({ token: value.trim() });
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
              // Spell out exactly what's missing so the user can see at a
              // glance which field needs attention. Logged to the console
              // for DevTools-assisted debugging.
              const partial: Partial<import("./types").ApiTokenState> = t ?? {};
              const missing: string[] = [];
              if (!partial.siteUrl) missing.push("Jira site URL");
              else if (!/^https:\/\/.+/i.test(partial.siteUrl)) {
                missing.push("Site URL must start with https://");
              }
              if (!partial.email) missing.push("Email");
              else if (!/@/.test(partial.email)) missing.push("Email is not valid");
              if (!partial.token) missing.push("API token");
              console.log("[jira-tiles] activate failed; current apiToken:", {
                siteUrl: partial.siteUrl,
                email: partial.email,
                tokenSet: !!partial.token,
              });
              new Notice(
                `Cannot activate — fix: ${missing.join(", ")}.`,
                10_000,
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
        | "showIssueTypeField"
      >,
      string,
      string,
    ]> = [
      ["showIssueType", "Show issue-type icon in header", "Display the Jira issue type icon to the left of the summary."],
      ["showIssueTypeField", "Show issue type as a field", "Add a labeled 'Issue Type' cell in the body grid (icon + name)."],
      ["showStatus", "Show status", "Display the issue's workflow status."],
      ["showPriority", "Show priority", "Display the issue's priority level (with icon)."],
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
          .onClick(async () => {
            this.plugin.settings.customFields.push({
              id: "",
              label: "",
              enabled: true,
            });
            await this.plugin.saveSettings();
            this.display();
          }),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Discover from Jira")
          .setCta()
          .onClick(() => {
            if (!this.plugin.client) {
              new Notice("Jira client not available.");
              return;
            }
            new FieldPickerModal(this.plugin.app, {
              client: this.plugin.client,
              existing: this.plugin.settings.customFields,
              onConfirm: async (selections) => {
                this.plugin.settings.customFields.push(...selections);
                await this.plugin.saveSettings();
                this.display();
                new Notice(
                  selections.length === 1
                    ? "Added 1 field."
                    : `Added ${selections.length} fields.`,
                );
              },
            }).open();
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
