/**
 * Tests for src/render/linkPostProcessor.ts
 */

import { buildLinkPostProcessor } from "../../src/render/linkPostProcessor";
import { IssueCache } from "../../src/cache/issueCache";
import { DEFAULT_SETTINGS } from "../../src/settings/defaults";
import type { PluginSettings } from "../../src/settings/types";
import type { JiraClient } from "../../src/jira/client";
import type { MarkdownPostProcessorContext } from "obsidian";

const SITE = "https://acme.atlassian.net";

function apiTokenSettings(over: Partial<PluginSettings> = {}): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    authMethod: "apiToken",
    apiToken: { siteUrl: SITE, email: "a@b.com", tokenSecretName: "s" },
    renderMode: "auto-link",
    ...over,
  };
}

function fakeClient(): { client: JiraClient; calls: string[] } {
  const calls: string[] = [];
  const client = {
    getIssue: async (key: string) => {
      calls.push(key);
      return { key, fields: { summary: `Summary ${key}` } };
    },
    getFields: async () => [],
  } as unknown as JiraClient;
  return { client, calls };
}

/** Build a paragraph containing a single anchor and return the wrapper. */
function paragraphWithLink(href: string, text = href): HTMLElement {
  const wrapper = document.createElement("div");
  const p = document.createElement("p");
  const a = document.createElement("a");
  a.setAttribute("href", href);
  a.textContent = text;
  p.appendChild(a);
  wrapper.appendChild(p);
  return wrapper;
}

const noopCtx = {} as MarkdownPostProcessorContext;

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("buildLinkPostProcessor — render mode gating", () => {
  it("does nothing in code-block mode", async () => {
    const { client, calls } = fakeClient();
    const cache = new IssueCache(() => 60_000);
    const proc = buildLinkPostProcessor({
      client,
      cache,
      getSettings: () => apiTokenSettings({ renderMode: "code-block" }),
    });
    const el = paragraphWithLink(`${SITE}/browse/PROJ-1`);
    proc(el, noopCtx);
    await flush();
    expect(calls).toEqual([]);
    expect(el.querySelector("a")).not.toBeNull(); // link untouched
  });

  it("renders a tile in auto-link mode for a standalone Jira URL", async () => {
    const { client, calls } = fakeClient();
    const cache = new IssueCache(() => 60_000);
    const proc = buildLinkPostProcessor({
      client,
      cache,
      getSettings: () => apiTokenSettings(),
    });
    const el = paragraphWithLink(`${SITE}/browse/PROJ-1`);
    proc(el, noopCtx);
    await flush();
    expect(calls).toEqual(["PROJ-1"]);
    expect(el.querySelector(".jira-tile-container")).not.toBeNull();
    expect(el.textContent).toContain("Summary PROJ-1");
  });

  it("works in both mode too", async () => {
    const { client, calls } = fakeClient();
    const cache = new IssueCache(() => 60_000);
    const proc = buildLinkPostProcessor({
      client,
      cache,
      getSettings: () => apiTokenSettings({ renderMode: "both" }),
    });
    const el = paragraphWithLink(`${SITE}/browse/PROJ-2`);
    proc(el, noopCtx);
    await flush();
    expect(calls).toEqual(["PROJ-2"]);
  });
});

describe("buildLinkPostProcessor — selectivity", () => {
  it("ignores links on a different host", async () => {
    const { client, calls } = fakeClient();
    const cache = new IssueCache(() => 60_000);
    const proc = buildLinkPostProcessor({
      client,
      cache,
      getSettings: () => apiTokenSettings(),
    });
    const el = paragraphWithLink("https://evil.example.com/browse/PROJ-1");
    proc(el, noopCtx);
    await flush();
    expect(calls).toEqual([]);
    expect(el.querySelector("a")).not.toBeNull();
  });

  it("ignores a Jira URL embedded mid-sentence (not standalone)", async () => {
    const { client, calls } = fakeClient();
    const cache = new IssueCache(() => 60_000);
    const proc = buildLinkPostProcessor({
      client,
      cache,
      getSettings: () => apiTokenSettings(),
    });
    // Paragraph has surrounding prose, so the link is not standalone.
    const wrapper = document.createElement("div");
    const p = document.createElement("p");
    p.appendChild(document.createTextNode("See "));
    const a = document.createElement("a");
    a.setAttribute("href", `${SITE}/browse/PROJ-1`);
    a.textContent = "the ticket";
    p.appendChild(a);
    p.appendChild(document.createTextNode(" for details."));
    wrapper.appendChild(p);

    proc(wrapper, noopCtx);
    await flush();
    expect(calls).toEqual([]);
    expect(wrapper.querySelector("a")).not.toBeNull();
  });

  it("does nothing when no site is configured", async () => {
    const { client, calls } = fakeClient();
    const cache = new IssueCache(() => 60_000);
    const proc = buildLinkPostProcessor({
      client,
      cache,
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        renderMode: "auto-link",
        authMethod: "none",
      }),
    });
    const el = paragraphWithLink(`${SITE}/browse/PROJ-1`);
    proc(el, noopCtx);
    await flush();
    expect(calls).toEqual([]);
  });
});
