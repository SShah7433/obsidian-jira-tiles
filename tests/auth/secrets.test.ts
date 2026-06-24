/**
 * Tests for src/auth/secrets.ts
 */

import { SecretsService, INTERNAL_SECRETS } from "../../src/auth/secrets";
import type { App } from "obsidian";

/** Build an App stub with an in-memory SecretStorage that satisfies the API. */
function appWithSecretStorage(): {
  app: App;
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  const secretStorage = {
    getSecret: (name: string) => store.get(name) ?? null,
    setSecret: (name: string, value: string) => {
      store.set(name, value);
    },
    deleteSecret: (name: string) => {
      store.delete(name);
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
    await svc.set("foo", "hello");
    expect(store.get("foo")).toBe("hello");
    expect(await svc.get("foo")).toBe("hello");
  });

  it("returns null for unknown names", async () => {
    const { app } = appWithSecretStorage();
    const svc = new SecretsService(app);
    expect(await svc.get("missing")).toBeNull();
  });

  it("returns null for empty / whitespace / null name", async () => {
    const { app } = appWithSecretStorage();
    const svc = new SecretsService(app);
    expect(await svc.get("")).toBeNull();
    expect(await svc.get("   ")).toBeNull();
    expect(await svc.get(null)).toBeNull();
    expect(await svc.get(undefined)).toBeNull();
  });

  it("removes a value", async () => {
    const { app, store } = appWithSecretStorage();
    const svc = new SecretsService(app);
    await svc.set("foo", "hello");
    await svc.remove("foo");
    expect(store.has("foo")).toBe(false);
  });

  it("rejects empty names on set()", async () => {
    const { app } = appWithSecretStorage();
    const svc = new SecretsService(app);
    await expect(svc.set("", "x")).rejects.toThrow();
  });
});

describe("SecretsService — memory fallback", () => {
  it("round-trips values without SecretStorage", async () => {
    const svc = new SecretsService(appWithoutSecretStorage());
    await svc.set("foo", "bar");
    expect(await svc.get("foo")).toBe("bar");
    await svc.remove("foo");
    expect(await svc.get("foo")).toBeNull();
  });
});

describe("INTERNAL_SECRETS", () => {
  it("uses stable, namespaced names", () => {
    expect(INTERNAL_SECRETS.defaultApiToken).toBe("jira-tiles:api-token");
    expect(INTERNAL_SECRETS.oauthAccessToken).toBe(
      "jira-tiles:oauth-access-token",
    );
    expect(INTERNAL_SECRETS.oauthRefreshToken).toBe(
      "jira-tiles:oauth-refresh-token",
    );
  });
});

describe("SecretsService — error handling", () => {
  it("returns null when getSecret throws", async () => {
    const app = {
      secretStorage: {
        getSecret: () => {
          throw new Error("boom");
        },
      },
    } as unknown as App;
    const svc = new SecretsService(app);
    expect(await svc.get("foo")).toBeNull();
  });

  it("does not throw when deleteSecret throws", async () => {
    const app = {
      secretStorage: {
        getSecret: () => null,
        setSecret: () => {},
        deleteSecret: () => {
          throw new Error("boom");
        },
      },
    } as unknown as App;
    const svc = new SecretsService(app);
    await expect(svc.remove("foo")).resolves.toBeUndefined();
  });
});
