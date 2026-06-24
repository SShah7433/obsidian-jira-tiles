/**
 * Jest setup — runs before every test file.
 *
 * We extend HTMLElement with the createDiv/createEl helpers Obsidian normally
 * provides, since renderer code calls them directly. Implementations are
 * minimal but compatible with the production usage patterns.
 *
 * We also polyfill TextEncoder/TextDecoder which jsdom does not expose by
 * default but `crypto.subtle.digest` (used by the PKCE code_challenge helper)
 * needs.
 */

import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "util";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  (globalThis as { TextEncoder: unknown }).TextEncoder = NodeTextEncoder;
}
if (typeof (globalThis as { TextDecoder?: unknown }).TextDecoder === "undefined") {
  (globalThis as { TextDecoder: unknown }).TextDecoder = NodeTextDecoder;
}

// Provide a Web Crypto subtle implementation if jsdom did not. Node 16+ exposes
// the `crypto` module's `webcrypto` global; map it onto globalThis.crypto.
if (typeof (globalThis as { crypto?: { subtle?: unknown } }).crypto === "undefined" || !globalThis.crypto.subtle) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require("crypto") as typeof import("crypto");
  if (nodeCrypto.webcrypto) {
    Object.defineProperty(globalThis, "crypto", {
      value: nodeCrypto.webcrypto,
      configurable: true,
    });
  }
}

// Silence the diagnostic '[jira-tiles] …' console output in tests so the
// passing-suite output stays clean. Errors from the test code itself still
// surface via Jest's failure reporting; we only filter our own breadcrumbs.
const originalLog = console.log;
const originalError = console.error;
console.log = ((...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("[jira-tiles]")) return;
  originalLog(...(args as []));
}) as typeof console.log;
console.error = ((...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("[jira-tiles]")) return;
  originalError(...(args as []));
}) as typeof console.error;

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

export {};
