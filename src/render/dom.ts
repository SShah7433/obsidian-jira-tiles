/**
 * Cross-window-safe DOM helpers.
 *
 * Obsidian can render in pop-out windows whose `document` differs from the
 * main window's. The Obsidian review tooling asks plugins to use
 * `activeDocument` (a global Obsidian provides that points at the currently
 * focused window's document) instead of the bare `document` global.
 *
 * `activeDocument` is not defined in plain browsers / jsdom (tests, dev
 * harness), so `doc()` falls back to `document` there.
 */

/** The document of the currently active (possibly pop-out) window. */
export function doc(): Document {
  const ad = (globalThis as { activeDocument?: Document }).activeDocument;
  return ad ?? document;
}

/** Convenience: create a detached element in the active document. */
export function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
): HTMLElementTagNameMap[K] {
  return doc().createElement(tag);
}

/** Convenience: a fresh DocumentFragment in the active document. */
export function createFragment(): DocumentFragment {
  return doc().createDocumentFragment();
}
