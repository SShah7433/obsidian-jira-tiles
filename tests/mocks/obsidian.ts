/**
 * Lightweight Obsidian module mock for Jest.
 *
 * Tests run under jsdom; the real "obsidian" module is not available. We
 * intercept imports of "obsidian" at the moduleNameMapper level (jest.config)
 * and re-export only the surface area our code touches.
 *
 * Add to this file as new code paths require Obsidian APIs.
 */

/** No-op base class — production code's `extends Plugin` becomes harmless. */
export class Plugin {
  app: App;
  manifest: unknown;
  registeredEvents: Array<() => void> = [];

  constructor(app: App, manifest: unknown) {
    this.app = app;
    this.manifest = manifest;
  }

  // Core lifecycle hooks (intentionally empty).
  onload(): Promise<void> | void {}
  onunload(): Promise<void> | void {}

  // Persistence — backed by an in-memory map per instance.
  private _data: unknown = null;
  async loadData(): Promise<unknown> {
    return this._data;
  }
  async saveData(data: unknown): Promise<void> {
    this._data = data;
  }

  // Registration helpers — record-only for assertions.
  registerEvent(_evt: unknown): void {}
  registerObsidianProtocolHandler(_action: string, _handler: (params: Record<string, string>) => void): void {}
  registerMarkdownCodeBlockProcessor(
    _lang: string,
    _processor: (source: string, el: HTMLElement, ctx: unknown) => void,
  ): void {}
  addCommand(_cmd: unknown): void {}
  addSettingTab(_tab: unknown): void {}
}

/** Minimal App stub — extend as needed. */
export class App {
  workspace = {
    getActiveFile: () => null,
    getActiveViewOfType: () => null,
    on: () => ({}),
    off: () => undefined,
  };
  vault = {
    getName: () => "test-vault",
  };
}

/** MarkdownView — used by command lookups. */
export class MarkdownView {
  editor = {
    getValue: () => "",
    replaceSelection: (_text: string) => {},
  };
  leaf = { rebuildView: () => {} };
}

/** PluginSettingTab — exposed only to satisfy `extends`. */
export class PluginSettingTab {
  containerEl: HTMLElement;
  app: App;
  plugin: unknown;
  constructor(app: App, plugin: unknown) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createElement("div");
  }
  display(): void {}
  hide(): void {}
}

/** Modal — bare-bones mock so `extends Modal` compiles. */
export class Modal {
  app: App;
  contentEl: HTMLElement;
  titleEl: HTMLElement;
  constructor(app: App) {
    this.app = app;
    this.contentEl = document.createElement("div");
    this.titleEl = document.createElement("h2");
  }
  open(): void {
    if (typeof this.onOpen === "function") void this.onOpen();
  }
  close(): void {
    if (typeof this.onClose === "function") this.onClose();
  }
  onOpen?(): void | Promise<void>;
  onClose?(): void;
}

/** Setting builder — chainable methods that return `this`. */
export class Setting {
  containerEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl;
  }
  setName(_v: string): this { return this; }
  setDesc(_v: string): this { return this; }
  setClass(_v: string): this { return this; }
  setHeading(): this { return this; }
  addText(cb: (t: TextLike) => void): this { cb(new TextLike()); return this; }
  addToggle(cb: (t: ToggleLike) => void): this { cb(new ToggleLike()); return this; }
  addSlider(cb: (t: SliderLike) => void): this { cb(new SliderLike()); return this; }
  addButton(cb: (t: ButtonLike) => void): this { cb(new ButtonLike()); return this; }
  addExtraButton(cb: (t: ButtonLike) => void): this { cb(new ButtonLike()); return this; }
  addDropdown(cb: (t: DropdownLike) => void): this { cb(new DropdownLike()); return this; }
}

/** Notice — replaced by a recorder so tests can assert on toasts. */
export class Notice {
  static lastMessage: string | null = null;
  constructor(public message: string, public timeout?: number) {
    Notice.lastMessage = message;
  }
}

/* Component-likes used by Setting fluent builders ------------------------ */

class TextLike {
  inputEl: HTMLInputElement = document.createElement("input");
  setPlaceholder(_v: string): this { return this; }
  setValue(_v: string): this { return this; }
  onChange(_cb: (v: string) => void): this { return this; }
}
class ToggleLike {
  setTooltip(_v: string): this { return this; }
  setValue(_v: boolean): this { return this; }
  onChange(_cb: (v: boolean) => void): this { return this; }
}
class SliderLike {
  setLimits(_min: number, _max: number, _step: number): this { return this; }
  setValue(_v: number): this { return this; }
  setDynamicTooltip(): this { return this; }
  onChange(_cb: (v: number) => void): this { return this; }
}
class ButtonLike {
  setButtonText(_v: string): this { return this; }
  setIcon(_v: string): this { return this; }
  setTooltip(_v: string): this { return this; }
  setCta(): this { return this; }
  setWarning(): this { return this; }
  onClick(_cb: () => void): this { return this; }
}
class DropdownLike {
  addOption(_v: string, _l: string): this { return this; }
  setValue(_v: string): this { return this; }
  onChange(_cb: (v: string) => void): this { return this; }
}

/* Network shim — overridable per-test ------------------------------------- */

export type RequestUrlParam = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  throw?: boolean;
};

export type RequestUrlResponse = {
  status: number;
  headers: Record<string, string>;
  text: string;
  json: unknown;
  arrayBuffer: ArrayBuffer;
};

let mockRequestUrl: (p: RequestUrlParam) => Promise<RequestUrlResponse> = async () => ({
  status: 200,
  headers: {},
  text: "",
  json: {},
  arrayBuffer: new ArrayBuffer(0),
});

export const requestUrl = (p: RequestUrlParam): Promise<RequestUrlResponse> =>
  mockRequestUrl(p);

/** Test helper to inject a mock implementation. */
export const __setRequestUrlMock = (
  fn: (p: RequestUrlParam) => Promise<RequestUrlResponse>,
): void => {
  mockRequestUrl = fn;
};

/** Reset the requestUrl mock to a 200/empty default between tests. */
export const __resetRequestUrlMock = (): void => {
  mockRequestUrl = async () => ({
    status: 200,
    headers: {},
    text: "",
    json: {},
    arrayBuffer: new ArrayBuffer(0),
  });
};

/* Misc helpers ----------------------------------------------------------- */

export const setIcon = (_el: HTMLElement, _icon: string): void => {
  // No-op in tests.
};

export const Platform = {
  isMobile: false,
  isDesktop: true,
};
