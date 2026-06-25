/**
 * Live Preview (CodeMirror 6) editor extension for the auto-link render mode.
 *
 * Markdown post-processors only run in Reading view; in Live Preview the
 * editor surface is CodeMirror, so inline links are never seen by the
 * post-processor. This extension fills that gap: it scans the document's
 * lines for ones that are *just* a Jira issue URL and replaces them with a
 * rendered tile widget.
 *
 * Editing-friendly behaviour: a line is only replaced when the cursor /
 * selection is NOT on that line. As soon as you click into the line the raw
 * URL is shown again so you can edit it — the standard Live Preview pattern.
 *
 * Implementation note: block-level replace decorations (the tile occupies its
 * own line) MUST be supplied through a StateField, not a ViewPlugin —
 * CodeMirror throws "Block decorations may not be specified via plugins" if
 * you return them from a plugin's `decorations` accessor.
 */

import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import type { RenderContext } from "./tile";
import { renderInto } from "./tile";
import { issueKeyFromStandaloneLine } from "./parseUrl";
import { createEl } from "./dom";
import type { PluginSettings } from "../settings/types";

/** Dependencies the extension needs from the host plugin. */
export interface LinkEditorExtensionDeps {
  /** Latest settings (read live so toggling the mode takes effect). */
  getSettings: () => PluginSettings;
  /** Build a RenderContext for a given settings snapshot. */
  makeRenderContext: (settings: PluginSettings) => RenderContext;
}

/**
 * The block widget that renders a Jira tile in place of a URL line. Each
 * widget owns its own DOM and triggers an async fetch+render via the shared
 * tile renderer.
 */
class JiraTileWidget extends WidgetType {
  constructor(
    private readonly key: string,
    private readonly deps: LinkEditorExtensionDeps,
  ) {
    super();
  }

  /** Widgets for the same issue key are interchangeable — avoids re-render. */
  eq(other: JiraTileWidget): boolean {
    return other.key === this.key;
  }

  toDOM(): HTMLElement {
    const container = createEl("div");
    container.addClass("jira-tile-lp-widget");
    const settings = this.deps.getSettings();
    void renderInto(
      container,
      { key: this.key },
      this.deps.makeRenderContext(settings),
    );
    return container;
  }

  /** Let CodeMirror treat clicks inside the tile normally (buttons/links). */
  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Build the decoration set for the current editor state: a block `replace`
 * decoration per standalone Jira-URL line that the cursor isn't on.
 */
function buildDecorations(
  state: EditorState,
  deps: LinkEditorExtensionDeps,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  const settings = deps.getSettings();
  if (settings.renderMode === "code-block") return builder.finish();
  const site = settings.apiToken?.siteUrl;
  if (!site) return builder.finish();

  const selection = state.selection;
  const doc = state.doc;

  // Iterate every line. Documents large enough for this to matter are rare in
  // notes, and lineAt-based scanning keeps it simple + correct across folds.
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const key = issueKeyFromStandaloneLine(line.text, site);
    if (!key) continue;

    // Reveal the raw URL while the cursor/selection touches this line so it
    // remains editable.
    const cursorOnLine = selection.ranges.some(
      (r) => r.from <= line.to && r.to >= line.from,
    );
    if (cursorOnLine) continue;

    builder.add(
      line.from,
      line.to,
      Decoration.replace({
        widget: new JiraTileWidget(key, deps),
        block: true,
      }),
    );
  }

  return builder.finish();
}

/**
 * Build the CodeMirror extension as a StateField that provides block
 * decorations. Recomputed on every transaction (cheap; only rebuilds the
 * RangeSet, the widgets themselves are reused via `eq`).
 */
export function buildLinkEditorExtension(
  deps: LinkEditorExtensionDeps,
): Extension {
  const field = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state, deps);
    },
    update(_value, tr) {
      // Rebuild from the new state on every transaction. Selection-only
      // transactions matter too (we reveal the raw URL on the active line).
      return buildDecorations(tr.state, deps);
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return field;
}
