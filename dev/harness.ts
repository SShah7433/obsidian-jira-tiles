/**
 * Dev harness entry point.
 *
 * Mounts a minimal page that:
 *   - Lists fixtures from dev/fixtures/_index.json (built by esbuild config).
 *   - Renders the selected fixture using the production tile renderer.
 *   - Lets you toggle theme (light/dark), viewport width, and compact mode.
 *
 * Fixtures map to render states:
 *   - { kind: "issue", issue, fetchedAt }            -> normal load
 *   - { kind: "issue-stale", issue, error, fetchedAt } -> offline+cached
 *   - { kind: "loading" }                            -> permanent loading skeleton
 *   - { kind: "error", message }                    -> error state
 *
 * Any fixture may set `compact: true` to default to the compact render path
 * when selected. The toolbar's "Compact" checkbox overrides per-render so
 * the same fixture can be flipped between modes without editing JSON.
 */

import "./obsidian-shim"; // installs HTMLElement polyfills + Notice/setIcon
import {
  displayOptionsFromSettings,
  renderInto,
  renderInvalidBlock,
  renderResolvedTile,
  type DisplayOptions,
} from "../src/render/tile";
import { parseBlock, InvalidJiraBlockError } from "../src/render/parseBlock";
import type { JiraIssue } from "../src/jira/types";
import { DEFAULT_SETTINGS } from "../src/settings/defaults";
import type { PluginSettings } from "../src/settings/types";

interface IssueFixture {
  kind: "issue";
  issue: JiraIssue;
  fetchedAt?: number;
  customFields?: Array<{ id: string; label: string; enabled?: boolean }>;
  fromCache?: boolean;
  /** When true, the fixture defaults to compact mode on selection. */
  compact?: boolean;
}
interface IssueStaleFixture {
  kind: "issue-stale";
  issue: JiraIssue;
  error: string;
  fetchedAt?: number;
  customFields?: Array<{ id: string; label: string; enabled?: boolean }>;
  compact?: boolean;
}
interface LoadingFixture {
  kind: "loading";
  key: string;
  compact?: boolean;
}
interface ErrorFixture {
  kind: "error";
  key: string;
  message: string;
  compact?: boolean;
}
type Fixture = IssueFixture | IssueStaleFixture | LoadingFixture | ErrorFixture;

const ROOT = document.getElementById("preview-root")!;
const FIXTURE_SELECT = document.getElementById("fixture-select") as HTMLSelectElement;
const VIEWPORT_SELECT = document.getElementById("viewport-select") as HTMLSelectElement;
const THEME_SELECT = document.getElementById("theme-select") as HTMLSelectElement;
const COMPACT_TOGGLE = document.getElementById("compact-toggle") as HTMLInputElement | null;
const STAGE = document.getElementById("preview-stage")!;

async function loadFixtureIndex(): Promise<string[]> {
  const res = await fetch("./fixtures/_index.json");
  return res.json();
}

async function loadFixture(name: string): Promise<Fixture> {
  const res = await fetch(`./fixtures/${name}.json`);
  return res.json();
}

function buildIssueUrl(key: string): string {
  return `https://example.atlassian.net/browse/${encodeURIComponent(key)}`;
}

function settingsForFixture(fx: Fixture): PluginSettings {
  const s: PluginSettings = {
    ...DEFAULT_SETTINGS,
    showStatus: true,
    showPriority: true,
    showAssignee: true,
    showDueDate: true,
    showIssueType: true,
    customFields:
      "customFields" in fx && fx.customFields
        ? fx.customFields.map((cf) => ({
            id: cf.id,
            label: cf.label,
            enabled: cf.enabled !== false,
          }))
        : [],
  };
  return s;
}

/** Resolved per-render flag: fixture default + toolbar override. */
function effectiveCompact(fx: Fixture): boolean {
  if (COMPACT_TOGGLE?.checked) return true;
  return !!fx.compact;
}

async function renderFixture(fx: Fixture): Promise<void> {
  ROOT.innerHTML = "";
  const settings = settingsForFixture(fx);
  const display: DisplayOptions = displayOptionsFromSettings(settings);
  const compact = effectiveCompact(fx);

  if (fx.kind === "loading") {
    const container = ROOT.appendChild(document.createElement("div"));
    // Use renderInto with a fetcher that never resolves to keep skeleton up.
    const neverResolves = new Promise<never>(() => undefined);
    void renderInto(
      container,
      { key: fx.key, compact },
      {
        buildIssueUrl,
        fetch: () => neverResolves,
        display,
      },
    );
    return;
  }

  if (fx.kind === "error") {
    const container = ROOT.appendChild(document.createElement("div"));
    void renderInto(
      container,
      { key: fx.key, compact },
      {
        buildIssueUrl,
        fetch: () => Promise.reject(new Error(fx.message)),
        display,
      },
    );
    return;
  }

  if (fx.kind === "issue") {
    const container = ROOT.appendChild(document.createElement("div"));
    renderResolvedTile(
      container,
      { key: fx.issue.key, compact },
      {
        data: fx.issue,
        fetchedAt: fx.fetchedAt ?? Date.now() - 30_000,
        fromCache: !!fx.fromCache,
      },
      { buildIssueUrl, fetch: () => Promise.reject(new Error("noop")), display },
    );
    return;
  }

  if (fx.kind === "issue-stale") {
    const container = ROOT.appendChild(document.createElement("div"));
    renderResolvedTile(
      container,
      { key: fx.issue.key, compact },
      {
        data: fx.issue,
        fetchedAt: fx.fetchedAt ?? Date.now() - 12 * 60 * 60_000,
        fromCache: true,
        staleError: new Error(fx.error),
      },
      { buildIssueUrl, fetch: () => Promise.reject(new Error("noop")), display },
    );
    return;
  }
}

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const fixtures = await loadFixtureIndex();
  for (const name of fixtures) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    FIXTURE_SELECT.appendChild(opt);
  }

  const initial = (location.hash.replace("#", "") || fixtures[0]) ?? fixtures[0];
  if (initial && fixtures.includes(initial)) {
    FIXTURE_SELECT.value = initial;
  }

  async function loadAndRender(): Promise<void> {
    const name = FIXTURE_SELECT.value;
    location.hash = name;
    try {
      const fx = await loadFixture(name);
      await renderFixture(fx);
    } catch (err) {
      ROOT.innerHTML = "";
      renderInvalidBlock(
        ROOT,
        new InvalidJiraBlockError(
          `Failed to load fixture "${name}": ${(err as Error).message}`,
        ),
      );
    }
  }

  FIXTURE_SELECT.addEventListener("change", loadAndRender);
  VIEWPORT_SELECT.addEventListener("change", () => {
    STAGE.dataset.width = VIEWPORT_SELECT.value;
  });
  COMPACT_TOGGLE?.addEventListener("change", loadAndRender);
  const applyTheme = (): void => {
    const theme = THEME_SELECT.value;
    document.documentElement.dataset.theme = theme;
    // Production styles.css uses `.theme-dark` as the dark-mode hook.
    document.body.classList.toggle("theme-dark", theme === "dark");
  };
  THEME_SELECT.addEventListener("change", applyTheme);
  applyTheme();

  await loadAndRender();

  // Auto-reload on esbuild's file change events (built-in EventSource).
  if ("EventSource" in window) {
    try {
      const es = new EventSource("/esbuild");
      es.addEventListener("change", () => location.reload());
    } catch {
      /* ignore — the dev server might not be running. */
    }
  }
}

main().catch((err) => {
  ROOT.innerHTML = `<pre style="color:red">${(err as Error).stack}</pre>`;
});
