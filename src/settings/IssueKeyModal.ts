/**
 * IssueKeyModal — a single-field modal that collects and validates a Jira
 * issue key, used by the "Insert issue tile" command.
 *
 * Kept in its own file (and excluded from coverage like the other DOM-heavy
 * UI shells) because it's exercised through manual / dev-harness QA rather
 * than unit tests.
 */

import { App, Modal, Notice, Setting } from "obsidian";
import { ISSUE_KEY_PATTERN } from "../render/parseBlock";

export class IssueKeyModal extends Modal {
  private value = "";

  constructor(
    app: App,
    private readonly onSubmit: (key: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Insert Jira issue tile");
    const { contentEl } = this;

    new Setting(contentEl).setName("Issue key").addText((text) => {
      text.setPlaceholder("PROJ-123");
      text.inputEl.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") this.submit(text.getValue());
      });
      // Defer focus so the input is mounted.
      window.setTimeout(() => text.inputEl.focus(), 0);
      text.onChange((v) => (this.value = v));
    });

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Insert")
        .setCta()
        .onClick(() => this.submit(this.value)),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private submit(raw: string): void {
    const key = raw.trim().toUpperCase();
    if (!ISSUE_KEY_PATTERN.test(key)) {
      new Notice("Invalid issue key. Expected format: PROJ-123.");
      return;
    }
    this.close();
    this.onSubmit(key);
  }
}
