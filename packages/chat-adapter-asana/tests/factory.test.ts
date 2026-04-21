import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createAsanaAdapter } from "../src/factory";
import { InMemoryWebhookSecretStore } from "../src/webhook-secret-store";

const ASANA_ENV_KEYS = [
  "ASANA_PAT",
  "ASANA_ACCESS_TOKEN",
  "ASANA_WORKSPACE_GID",
  "ASANA_WEBHOOK_SECRET",
] as const;

describe("createAsanaAdapter", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of ASANA_ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ASANA_ENV_KEYS) {
      delete process.env[key];
    }
    for (const key of ASANA_ENV_KEYS) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      }
    }
  });

  test("creates an adapter from explicit config", () => {
    const adapter = createAsanaAdapter({
      accessToken: "token",
      workspaceGid: "ws_1",
    });

    expect(adapter.name).toBe("asana");
    expect(adapter.workspaceGid).toBe("ws_1");
    expect(adapter.userName).toBe("asana-bot");
  });

  test("prefers ASANA_PAT over ASANA_ACCESS_TOKEN as the access-token fallback", () => {
    process.env.ASANA_PAT = "pat-token";
    process.env.ASANA_ACCESS_TOKEN = "oauth-token";
    process.env.ASANA_WORKSPACE_GID = "ws_env";

    const adapter = createAsanaAdapter();

    expect(adapter.name).toBe("asana");
    expect(adapter.workspaceGid).toBe("ws_env");
  });

  test("falls back to ASANA_ACCESS_TOKEN when ASANA_PAT is not set", () => {
    process.env.ASANA_ACCESS_TOKEN = "oauth-token";
    process.env.ASANA_WORKSPACE_GID = "ws_oauth";

    const adapter = createAsanaAdapter();

    expect(adapter.workspaceGid).toBe("ws_oauth");
  });

  test("seeds the webhook secret store from ASANA_WEBHOOK_SECRET", async () => {
    process.env.ASANA_PAT = "pat-token";
    process.env.ASANA_WORKSPACE_GID = "ws_env";
    process.env.ASANA_WEBHOOK_SECRET = "whs_env";

    const adapter = createAsanaAdapter();

    expect(await adapter.webhookSecretStore.get()).toBe("whs_env");
  });

  test("respects an explicit botUser and userName override", () => {
    const adapter = createAsanaAdapter({
      accessToken: "token",
      workspaceGid: "ws_1",
      botUser: { gid: "bot_42", name: "friendly-bot", email: "b@example.com" },
      userName: "override-bot",
    });

    expect(adapter.userName).toBe("override-bot");
    expect(adapter.botUserId).toBe("bot_42");
  });

  test("uses the caller-provided webhookSecretStore instead of the in-memory default", async () => {
    const store = new InMemoryWebhookSecretStore("custom");
    const adapter = createAsanaAdapter({
      accessToken: "token",
      workspaceGid: "ws_1",
      webhookSecretStore: store,
    });

    expect(adapter.webhookSecretStore).toBe(store);
    expect(await adapter.webhookSecretStore.get()).toBe("custom");
  });

  test("throws when no access token is available", () => {
    expect(() => createAsanaAdapter({ workspaceGid: "ws_1" })).toThrow(
      /access token/i,
    );
  });

  test("throws when no workspace GID is available", () => {
    expect(() => createAsanaAdapter({ accessToken: "token" })).toThrow(
      /workspace/i,
    );
  });

  test("throws with an empty config object if nothing is configured via env", () => {
    expect(() => createAsanaAdapter()).toThrow(/access token/i);
  });
});
