/**
 * Modal that lists Jira custom fields and lets the user pick one (or many)
 * to add to the plugin's `customFields` configuration.
 *
 * The modal lazily fetches fields the first time it opens; subsequent opens
 * reuse the cached list. Errors (no auth, network failure) are rendered
 * inside the modal rather than thrown so the user gets a chance to recover.
 */

import { App, Modal, Setting, Notice } from "obsidian";
import { loadFields, filterFields, defaultLabel } from "../jira/fieldDiscovery";
import type { JiraClient } from "../jira/client";
import type { JiraFieldMeta } from "../jira/types";
import type { CustomFieldConfig } from "./types";

/** Args passed in by the SettingsTab. */
export interface FieldPickerArgs {
  client: JiraClient;
  /** Already-configured field IDs — pre-checked so they show as "Added". */
  existing: readonly CustomFieldConfig[];
  /** Called when the user confirms; receives the newly selected fields. */
  onConfirm: (selections: CustomFieldConfig[]) => void | Promise<void>;
}

export class FieldPickerModal extends Modal {
  private fields: JiraFieldMeta[] = [];
  private filtered: JiraFieldMeta[] = [];
  private selected = new Set<string>();
  private search = "";
  private customOnly = true;
  private loading = false;
  private loadError: string | null = null;

  constructor(
    app: App,
    private readonly args: FieldPickerArgs,
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    this.titleEl.setText("Add custom fields from Jira");
    this.render();
    await this.fetchFields();
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                              */
  /* ---------------------------------------------------------------------- */

  private async fetchFields(): Promise<void> {
    if (this.loading || this.fields.length > 0) return;
    this.loading = true;
    try {
      this.fields = await loadFields(this.args.client);
      this.loadError = null;
    } catch (err) {
      this.loadError = (err as Error).message;
    } finally {
      this.loading = false;
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    if (this.loading) {
      contentEl.createEl("p", { text: "Loading fields…" });
      return;
    }

    if (this.loadError) {
      contentEl.createEl("p", {
        cls: "jira-tile-error-message",
        text: `Failed to load fields: ${this.loadError}`,
      });
      const retryRow = contentEl.createDiv();
      const retryBtn = retryRow.createEl("button", { text: "Retry" });
      retryBtn.addEventListener("click", () => {
        void (async () => {
          this.fields = [];
          this.loadError = null;
          this.render();
          await this.fetchFields();
          this.render();
        })();
      });
      return;
    }

    /* Filter row -------------------------------------------------------- */

    new Setting(contentEl)
      .setName("Search")
      .addText((text) =>
        text
          .setPlaceholder("Sprint, Story Points, customfield_…")
          .setValue(this.search)
          .onChange((v) => {
            this.search = v;
            this.applyFilter();
            this.renderResults(resultsEl);
          }),
      )
      .addToggle((t) =>
        t
          .setTooltip("Custom fields only")
          .setValue(this.customOnly)
          .onChange((v) => {
            this.customOnly = v;
            this.applyFilter();
            this.renderResults(resultsEl);
          }),
      );

    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: this.customOnly
        ? "Showing custom fields only. Toggle off to include built-in fields."
        : "Showing all fields.",
    });

    /* Results list ------------------------------------------------------ */

    const resultsEl = contentEl.createDiv({ cls: "jira-tiles-field-results" });
    this.applyFilter();
    this.renderResults(resultsEl);

    /* Footer ------------------------------------------------------------ */

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Cancel")
          .onClick(() => this.close()),
      )
      .addButton((btn) =>
        btn
          .setCta()
          .setButtonText("Add selected")
          .onClick(async () => {
            const additions = this.fields
              .filter((f) => this.selected.has(f.id))
              .map<CustomFieldConfig>((f) => ({
                id: f.id,
                label: defaultLabel(f),
                enabled: true,
              }));
            if (additions.length === 0) {
              new Notice("Select at least one field, or click Cancel.");
              return;
            }
            await this.args.onConfirm(additions);
            this.close();
          }),
      );
  }

  private applyFilter(): void {
    const existingIds = this.args.existing.map((f) => f.id);
    this.filtered = filterFields(this.fields, {
      search: this.search,
      customOnly: this.customOnly,
      excludeIds: existingIds,
    });
  }

  private renderResults(parent: HTMLElement): void {
    parent.empty();
    if (this.filtered.length === 0) {
      parent.createEl("p", {
        cls: "setting-item-description",
        text: "No matching fields. Adjust the search or toggle.",
      });
      return;
    }

    for (const field of this.filtered.slice(0, 200)) {
      const row = parent.createDiv({ cls: "jira-tiles-field-row" });
      const checkbox = row.createEl("input", {
        type: "checkbox",
      });
      checkbox.checked = this.selected.has(field.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selected.add(field.id);
        else this.selected.delete(field.id);
      });
      const label = row.createEl("label");
      label.appendChild(checkbox);
      label.createSpan({ cls: "jira-tiles-field-name", text: field.name });
      label.createSpan({ cls: "jira-tiles-field-id", text: field.id });
      if (field.schema?.type) {
        label.createSpan({ cls: "jira-tiles-field-type", text: field.schema.type });
      }
    }

    if (this.filtered.length > 200) {
      parent.createEl("p", {
        cls: "setting-item-description",
        text: `Showing first 200 of ${this.filtered.length} matches — refine the search.`,
      });
    }
  }
}
