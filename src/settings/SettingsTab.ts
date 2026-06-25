/**
 * Plugin settings tab.
 *
 * Sections rendered:
 *   - Storage notice (informational; warning when SecretStorage is missing).
 *   - Connection: API token form (site URL, email, token-secret picker).
 *   - Display: standard field toggles + cache TTL slider.
 *   - Custom fields: configurable list + "Discover from Jira" modal picker.
 *   - Advanced: clear cache.
 */

import { App, PluginSettingTab, Setting, Notice, SecretComponent } from "obsidian";
import {
  DEFAULT_CACHE_TTL_MINUTES,
  MAX_CACHE_TTL_MINUTES,
} from "../constants";
import { normalizeSiteUrl } from "../auth/apiToken";
import { INTERNAL_SECRETS } from "../auth/secrets";
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
  /** Drop all cached issue data. */
  clearCache(): void;
  /** Jira client — used by the field discovery picker. Optional for harnesses. */
  client?: import("../jira/client").JiraClient;
  /** Secret store handle — used to write the API token after the user enters it. */
  secrets?: import("../auth/secrets").SecretsService;
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
    const usingFallback =
      this.plugin.secrets && !this.plugin.secrets.isAvailable;

    if (usingFallback) {
      // The runtime doesn't have SecretStorage, so we *did* fall back to an
      // in-memory store. That's a real warning the user must see.
      const banner = parent.createDiv({ cls: "jira-tiles-warning" });
      banner.createEl("strong", { text: "Secret storage unavailable" });
      banner.createEl("p", {
        text:
          "This Obsidian version does not expose the SecretStorage API. The " +
          "plugin is keeping your API token in memory only — you will need " +
          "to re-enter it after every reload. Update Obsidian to 1.11.4 or " +
          "newer to enable persistent secret storage.",
      });
      return;
    }

    // SecretStorage is in play. data.json now carries only site URL, email,
    // feature toggles, and *secret names* — no credential values. Surface
    // a one-time informational note (not a blocking warning).
    const ack = this.plugin.settings.storageWarningAcknowledged;
    if (ack) return;

    const banner = parent.createDiv({ cls: "jira-tiles-warning" });
    banner.createEl("strong", { text: "Where credentials are stored" });
    banner.createEl("p", {
      text:
        "Tokens are stored in Obsidian's SecretStorage, which is local to " +
        "this install and not synced. The plugin's data.json contains only " +
        "your site URL, email, the *names* of the secrets, and feature " +
        "toggles — no credential values.",
    });
    const ackBtn = banner.createEl("button", { text: "Got it" });
    ackBtn.addEventListener("click", async () => {
      this.plugin.settings.storageWarningAcknowledged = true;
      await this.plugin.saveSettings();
      this.display();
    });
  }

  private renderConnectionSection(parent: HTMLElement): void {
    // No heading for the first section per Obsidian guidelines — general
    // settings sit at the top of the tab.
    parent.createEl("p", {
      cls: "setting-item-description",
      text:
        "Authenticate with an Atlassian API token. Generate one at " +
        "id.atlassian.com under Security → API tokens — your regular " +
        "Atlassian login (including SSO-linked accounts) can mint tokens.",
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
        tokenSecretName: "",
      };
      this.plugin.settings.apiToken = { ...current, ...patch };
      await this.plugin.saveSettings();
    };

    // For initial population only — never spread from this in handlers.
    const initial = this.plugin.settings.apiToken ?? {
      siteUrl: "",
      email: "",
      tokenSecretName: "",
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

    /*
     * API token field.
     *
     * The actual token never lives in plugin settings — only the *name* of
     * the SecretStorage entry that holds it. The Obsidian-supplied
     * SecretComponent renders a picker that lets the user create a new
     * secret or reuse one already saved by another plugin. On older
     * Obsidian versions where SecretComponent is unavailable we fall back
     * to a password-typed text input that writes the value via the
     * plugin's own SecretsService (which itself falls back to memory-only
     * storage on truly ancient builds).
     */
    this.renderApiTokenSecretField(parent, initial, updateApiToken);


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
            const partial: Partial<import("./types").ApiTokenState> = t ?? {};
            const missing: string[] = [];
            if (!partial.siteUrl) missing.push("Jira site URL");
            else if (!/^https:\/\/.+/i.test(partial.siteUrl)) {
              missing.push("Site URL must start with https://");
            }
            if (!partial.email) missing.push("Email");
            else if (!/@/.test(partial.email)) missing.push("Email is not valid");
            if (!partial.tokenSecretName) {
              missing.push("API token");
            } else if (this.plugin.secrets) {
              // Verify the named secret actually resolves — otherwise the
              // user picked a name that doesn't exist (or has been deleted)
              // in SecretStorage.
              const value = await this.plugin.secrets.get(partial.tokenSecretName);
              if (!value) missing.push(`API token (secret "${partial.tokenSecretName}" not found)`);
            }
            if (missing.length > 0) {
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

  /**
   * Render the API token field. Prefers Obsidian's `SecretComponent` when
   * available — that lets users select an existing secret from SecretStorage
   * or create a new one, and the persisted value is just the *name* of the
   * secret. On older Obsidian versions without SecretStorage, we fall back to
   * a password-typed text input that writes via the plugin's own
   * SecretsService (in-memory storage that does not persist across reloads).
   */
  private renderApiTokenSecretField(
    parent: HTMLElement,
    initial: import("./types").ApiTokenState,
    updateApiToken: (
      patch: Partial<import("./types").ApiTokenState>,
    ) => Promise<void>,
  ): void {
    // SecretComponent + SecretStorage arrived together (1.11.4). Use the
    // picker only when the secret store is actually available.
    if (typeof SecretComponent === "function" && this.plugin.secrets?.isAvailable) {
      new Setting(parent)
        .setName("API token")
        .setDesc(
          "Pick an existing secret from Obsidian's secret storage or save a " +
            "new one. The token value is never written to data.json.",
        )
        .addComponent((el: HTMLElement) =>
          new SecretComponent(this.plugin.app, el)
            .setValue(initial.tokenSecretName)
            .onChange(async (name: string) => {
              await updateApiToken({ tokenSecretName: name });
            }),
        );
      return;
    }

    // Fallback: password-typed text input. We write the value into the
    // plugin's SecretsService under the default name. This keeps the value
    // out of data.json even on older runtimes (in-memory only).
    new Setting(parent)
      .setName("API token")
      .setDesc(
        "Your Obsidian version doesn't provide secret storage, so the token " +
          "is held in memory only and must be re-entered after each reload. " +
          "Update Obsidian to keep it stored securely.",
      )
      .addText((text) => {
        // Mask token input — the underlying input is reachable via inputEl.
        text.inputEl.type = "password";
        text
          .setPlaceholder("Paste your API token")
          .setValue("")
          .onChange(async (value) => {
            const trimmed = value.trim();
            const name = INTERNAL_SECRETS.defaultApiToken;
            if (this.plugin.secrets) {
              if (trimmed) {
                await this.plugin.secrets.set(name, trimmed);
                await updateApiToken({ tokenSecretName: name });
              } else {
                await this.plugin.secrets.remove(name);
                await updateApiToken({ tokenSecretName: "" });
              }
            }
          });
      });
  }

  private renderDisplaySection(parent: HTMLElement): void {
    new Setting(parent).setName("Display").setHeading();

    new Setting(parent)
      .setName("Embedding mode")
      .setDesc(
        "How Jira issues become tiles. Code block: only ```jira blocks. " +
          "Auto-link: paste a Jira issue URL on its own line and it becomes a " +
          "tile. Both: code blocks and Jira URLs.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("code-block", "Code block (```jira)")
          .addOption("auto-link", "Auto-link Jira URLs")
          .addOption("both", "Both")
          .setValue(this.plugin.settings.renderMode)
          .onChange(async (value) => {
            this.plugin.settings.renderMode =
              value as import("./types").RenderMode;
            await this.plugin.saveSettings();
          }),
      );

    const toggles: Array<[
      keyof Pick<
        import("./types").PluginSettings,
        | "showStatus"
        | "showPriority"
        | "showAssignee"
        | "showDueDate"
        | "showIssueType"
        | "showIssueTypeField"
        | "showFixVersions"
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
      ["showFixVersions", "Show fix versions", "Display the fix versions (release-state chips)."],
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
    new Setting(parent).setName("Custom fields").setHeading();
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
    new Setting(parent).setName("Advanced").setHeading();
    new Setting(parent)
      .setName("Clear cache")
      .setDesc("Discard cached Jira responses; next render re-fetches.")
      .addButton((btn) =>
        btn.setButtonText("Clear").onClick(() => {
          this.plugin.clearCache();
          new Notice("Jira cache cleared.");
        }),
      );
  }
}
