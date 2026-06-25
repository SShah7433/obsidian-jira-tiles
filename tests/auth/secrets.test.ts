/**
 * Tests for src/auth/secrets.ts
 */

import {
  SecretsService,
  INTERNAL_SECRETS,
  isValidSecretId,
} from "../../src/auth/secrets";
import type { App } from "obsidian";

/**
 * Build an App stub with an in-memory SecretStorage matching the real API
 * surface: synchronous getSecret/setSecret, no delete.
 */
function appWithSecretStorage(): {
  app: App;
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  const secretStorage = {
    getSecret: (id: string) => store.get(id) ?? null,
    setSecret: (id: string, value: string) => {
      store.set(id, value);
    },
  };
  return {
    app: { secretStorage } as unknown as App,
    store,
  };
}

/** App stub with no secretStorage — exercises the memory-fallback branch. */
function appWithoutSecretStorage(): App {
  return {} as unknown as App;
}

describe("isValidSecretId", () => {
  it("accepts lowercase alphanumeric with dashes", () => {
    expect(isValidSecretId("jira-tiles-api-token")).toBe(true);
    expect(isValidSecretId("abc123")).toBe(true);
  });
  it("rejects colons, uppercase, spaces, and leading dash", () => {
    expect(isValidSecretId("jira-tiles:api-token")).toBe(false);
    expect(isValidSecretId("Jira-Tiles")).toBe(false);
    expect(isValidSecretId("has space")).toBe(false);
    expect(isValidSecretId("-leading")).toBe(false);
    expect(isValidSecretId("")).toBe(false);
  });
});

describe("SecretsService — backend detection", () => {
  it("uses 'secret-storage' when app.secretStorage exposes getSecret", () => {
    const { app } = appWithSecretStorage();
    const svc = new SecretsService(app);
    expect(svc.backend).toBe("secret-storage");
    expect(svc.isAvailable).toBe(true);
  });

  it("falls back to 'memory-fallback' when SecretStorage is missing", () => {
    const svc = new SecretsService(appWithoutSecretStorage());
    expect(svc.backend).toBe("memory-fallback");
    expect(svc.isAvailable).toBe(false);
  });
});

describe("SecretsService — get/set/remove via SecretStorage", () => {
  it("round-trips a value", async () => {
    const { app, store } = appWithSecretStorage();
    const svc = new SecretsService(app);
    await svc.set("jira-tiles-api-token", "hello");
    expect(store.get("jira-tiles-api-token")).toBe("hello");
    expect(await svc.get("jira-tiles-api-token")).toBe("hello");
  });

  it("returns null for unknown ids", async () => {
    const { app } = appWithSecretStorage();
    const svc = new SecretsService(app);
    expect(await svc.get("missing")).toBeNull();
  });

  it("returns null for empty / whitespace / null id", async () => {
    const { app } = appWithSecretStorage();
    const svc = new SecretsService(app);
    expect(await svc.get("")).toBeNull();
    expect(await svc.get("   ")).toBeNull();
    expect(await svc.get(null)).toBeNull();
    expect(await svc.get(undefined)).toBeNull();
  });

  it("removes a value by overwriting with empty string (real API has no delete)", async () => {
    const { app, store } = appWithSecretStorage();
    const svc = new SecretsService(app);
    await svc.set("jira-tiles-api-token", "hello");
    await svc.remove("jira-tiles-api-token");
    expect(store.get("jira-tiles-api-token")).toBe("");
  });

  it("rejects empty ids on set()", async () => {
    const { app } = appWithSecretStorage();
    const svc = new SecretsService(app);
    await expect(svc.set("", "x")).rejects.toThrow();
  });

  it("rejects invalid ids on set()", async () => {
    const { app } = appWithSecretStorage();
    const svc = new SecretsService(app);
    await expect(svc.set("jira:tiles", "x")).rejects.toThrow(/invalid secret id/);
  });
});

describe("SecretsService — memory fallback", () => {
  it("round-trips values without SecretStorage", async () => {
    const svc = new SecretsService(appWithoutSecretStorage());
    await svc.set("jira-tiles-api-token", "bar");
    expect(await svc.get("jira-tiles-api-token")).toBe("bar");
    await svc.remove("jira-tiles-api-token");
    expect(await svc.get("jira-tiles-api-token")).toBeNull();
  });
});

describe("INTERNAL_SECRETS", () => {
  it("uses a valid lowercase-dashed id", () => {
    expect(INTERNAL_SECRETS.defaultApiToken).toBe("jira-tiles-api-token");
    expect(isValidSecretId(INTERNAL_SECRETS.defaultApiToken)).toBe(true);
  });
});

describe("SecretsService — error handling", () => {
  it("returns null when getSecret throws", async () => {
    const app = {
      secretStorage: {
        getSecret: () => {
          throw new Error("boom");
        },
        setSecret: () => {},
      },
    } as unknown as App;
    const svc = new SecretsService(app);
    expect(await svc.get("jira-tiles-api-token")).toBeNull();
  });

  it("does not throw when setSecret throws during remove", async () => {
    const app = {
      secretStorage: {
        getSecret: () => null,
        setSecret: () => {
          throw new Error("boom");
        },
      },
    } as unknown as App;
    const svc = new SecretsService(app);
    await expect(svc.remove("jira-tiles-api-token")).resolves.toBeUndefined();
  });
});
