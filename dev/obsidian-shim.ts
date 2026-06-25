/**
 * Browser-side shim for the "obsidian" module.
 *
 * The dev harness imports the same renderer source the plugin ships, but the
 * renderer pulls in `import { Notice, setIcon } from "obsidian"`. There is no
 * obsidian module in a vanilla browser, so esbuild aliases that import to
 * this file (see esbuild.config.mjs `obsidian-shim` plugin).
 *
 * We provide just enough surface area for the renderer:
 *   - `setIcon` -> inline SVG fallback
 *   - `Notice`  -> simple toast in the harness DOM
 *   - `requestUrl` -> ignored (the harness uses fixtures, not the network)
 */

/*
 * eslint-disable
 * --
 * Browser-only dev shim, excluded from the published plugin (see .npmignore).
 * It deliberately uses plain-browser DOM (`document`, `innerHTML`, bare
 * `setTimeout`, `instanceof`) because it stands in for the "obsidian" module
 * inside esbuild's dev server, where Obsidian's activeDocument/requestUrl and
 * pop-out windows do not exist. The only `innerHTML` write injects a fixed,
 * trusted set of inline SVG icons defined in this file (no untrusted input).
 * Linting the whole file off avoids scattering directives through code that
 * is correct for its browser-only context.
 */

/* -------------------------------------------------------------------------- */
/* setIcon                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Tiny set of inline SVG icons used by the renderer. Real Obsidian uses
 * Lucide; we provide visually-equivalent stand-ins so the dev harness looks
 * close to the real plugin.
 */
const ICON_SVGS: Record<string, string> = {
  "rotate-cw":
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>',
  "external-link":
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>',
  trash:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"></path></svg>',
  "rotate-ccw":
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>',
};

export function setIcon(el: HTMLElement, name: string): void {
  const svg = ICON_SVGS[name];
  if (svg) {
    // The harness is the only consumer; trusted markup, no XSS surface.
    el.innerHTML = svg;
  } else {
    el.textContent = `[${name}]`;
  }
}

/* -------------------------------------------------------------------------- */
/* Notice                                                                     */
/* -------------------------------------------------------------------------- */

/** Minimal toast shown in the bottom-right of the harness page. */
export class Notice {
  constructor(message: string, _timeout = 4000) {
    const host = document.getElementById("dev-notices") ?? document.body;
    const el = document.createElement("div");
    el.className = "dev-notice";
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => el.remove(), _timeout);
  }
}

/* -------------------------------------------------------------------------- */
/* requestUrl                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Stub — the harness never calls this in normal flow because it injects a
 * fixture-driven fetcher into the renderer. Calling it should surface as an
 * obvious failure so we notice if a code path slips through.
 */
export function requestUrl(): Promise<never> {
  throw new Error(
    "requestUrl called inside the dev harness. The harness uses fixtures, " +
      "not the network — adjust the renderer's fetch context.",
  );
}

/* -------------------------------------------------------------------------- */
/* Polyfills for Obsidian's HTMLElement extensions                            */
/* -------------------------------------------------------------------------- */

interface DomElInit {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  href?: string;
  type?: string;
  title?: string;
}

function applyInit(el: HTMLElement, init?: DomElInit): void {
  if (!init) return;
  if (init.cls) {
    if (Array.isArray(init.cls)) el.classList.add(...init.cls);
    else el.classList.add(...init.cls.split(/\s+/).filter(Boolean));
  }
  if (init.text != null) el.textContent = init.text;
  if (init.attr) {
    for (const [k, v] of Object.entries(init.attr)) {
      if (v == null || v === false) continue;
      el.setAttribute(k, String(v));
    }
  }
  if (init.href != null && el instanceof HTMLAnchorElement) el.href = init.href;
  if (init.type != null && el instanceof HTMLInputElement) el.type = init.type;
  if (init.title != null) el.title = init.title;
}

declare global {
  interface HTMLElement {
    createDiv(o?: DomElInit): HTMLDivElement;
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      o?: DomElInit,
    ): HTMLElementTagNameMap[K];
    createSpan(o?: DomElInit): HTMLSpanElement;
    empty(): void;
    addClass(cls: string): void;
    removeClass(cls: string): void;
    toggleClass(cls: string, value?: boolean): void;
    setText(t: string): void;
  }
}

if (!HTMLElement.prototype.createDiv) {
  HTMLElement.prototype.createDiv = function (init?: DomElInit) {
    const div = document.createElement("div");
    applyInit(div, init);
    this.appendChild(div);
    return div;
  };
}
if (!HTMLElement.prototype.createEl) {
  HTMLElement.prototype.createEl = function <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    init?: DomElInit,
  ) {
    const el = document.createElement(tag);
    applyInit(el, init);
    this.appendChild(el);
    return el;
  };
}
if (!HTMLElement.prototype.createSpan) {
  HTMLElement.prototype.createSpan = function (init?: DomElInit) {
    const span = document.createElement("span");
    applyInit(span, init);
    this.appendChild(span);
    return span;
  };
}
if (!HTMLElement.prototype.empty) {
  HTMLElement.prototype.empty = function () {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
}
if (!HTMLElement.prototype.addClass) {
  HTMLElement.prototype.addClass = function (cls: string) {
    this.classList.add(...cls.split(/\s+/).filter(Boolean));
  };
}
if (!HTMLElement.prototype.removeClass) {
  HTMLElement.prototype.removeClass = function (cls: string) {
    this.classList.remove(...cls.split(/\s+/).filter(Boolean));
  };
}
if (!HTMLElement.prototype.toggleClass) {
  HTMLElement.prototype.toggleClass = function (cls: string, value?: boolean) {
    if (value === undefined) this.classList.toggle(cls);
    else this.classList.toggle(cls, value);
  };
}
if (!HTMLElement.prototype.setText) {
  HTMLElement.prototype.setText = function (t: string) {
    this.textContent = t;
  };
}

/* -------------------------------------------------------------------------- */
/* Misc placeholder exports — only present so unused-named-imports compile.   */
/* -------------------------------------------------------------------------- */

export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class Modal {}
export class MarkdownView {}
export class App {}
export const Platform = { isMobile: false, isDesktop: true };
export type MarkdownPostProcessorContext = unknown;
