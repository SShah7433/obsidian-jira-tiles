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
import { normalizeSiteUrl } from "../auth/apiToken";
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
          "to re-enter it after every reload. Update Obsidian to 1.5 or newer " +
          "to enable persistent secret storage.",
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
              console.log("[jira-tiles] activate failed; current apiToken:", {
                siteUrl: partial.siteUrl,
                email: partial.email,
                tokenSecretName: partial.tokenSecretName,
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

  /**
   * Render the API token field. Prefers Obsidian's `SecretComponent` when
   * available (1.5+) — that lets users select an existing secret from
   * SecretStorage or create a new one, and the persisted value is just the
   * *name* of the secret. On older Obsidian versions, we fall back to a
   * password-typed text input that writes via the plugin's own
   * SecretsService (which itself falls back to in-memory storage when
   * SecretStorage is unavailable).
   */
  private renderApiTokenSecretField(
    parent: HTMLElement,
    initial: import("./types").ApiTokenState,
    updateApiToken: (
      patch: Partial<import("./types").ApiTokenState>,
    ) => Promise<void>,
  ): void {
    // Detect SecretComponent at runtime — it's not present in older
    // @types/obsidian, and it may be missing on older runtimes.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const obsidianModule = require("obsidian") as {
      SecretComponent?: new (
        app: App,
        el: HTMLElement,
      ) => {
        setValue(name: string): unknown;
        onChange(cb: (name: string) => void): unknown;
      };
    };
    const SecretComponent = obsidianModule.SecretComponent;

    if (SecretComponent && this.plugin.app) {
      const setting = new Setting(parent)
        .setName("API token")
        .setDesc(
          "Pick an existing secret from Obsidian's SecretStorage or save a " +
            "new one. The token value is never written to data.json.",
        );
      // The Setting builder lacks `addComponent` on older type defs; use the
      // public `controlEl` to mount the SecretComponent ourselves.
      const controlEl = (setting as unknown as { controlEl?: HTMLElement }).controlEl;
      if (controlEl) {
        const sc = new SecretComponent(this.plugin.app, controlEl);
        sc.setValue(initial.tokenSecretName);
        sc.onChange(async (name: string) => {
          await updateApiToken({ tokenSecretName: name });
        });
        return;
      }
    }

    // Fallback: password-typed text input. We write the value into the
    // plugin's SecretsService under the default name. This keeps the value
    // out of data.json even on older runtimes.
    new Setting(parent)
      .setName("API token")
      .setDesc(
        "Generate at https://id.atlassian.com/manage-profile/security/api-tokens. " +
          "(Your Obsidian version doesn't expose SecretStorage, so the value " +
          "is held in this plugin's secret store.)",
      )
      .addText((text) => {
        // Mask token input — the underlying input is reachable via inputEl.
        text.inputEl.type = "password";
        text
          .setPlaceholder("ATATT...")
          .setValue("")
          .onChange(async (value) => {
            const trimmed = value.trim();
            // Late import to avoid a static dependency on the constants file
            // from this rendering helper.
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { INTERNAL_SECRETS } =
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              require("../auth/secrets") as typeof import("../auth/secrets");
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
