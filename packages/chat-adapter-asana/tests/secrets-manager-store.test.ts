import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  type SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { describe, expect, test } from "vitest";
import { SecretsManagerWebhookSecretStore } from "../src/secrets-manager-store";

/** A Secrets Manager stand-in holding one SecretString. */
const fakeSecretsManager = (initial: string) => {
  const state = { value: initial, puts: 0, afterPut: undefined as (() => void) | undefined };
  const client = {
    send: async (command: unknown) => {
      if (command instanceof GetSecretValueCommand) {
        return { SecretString: state.value };
      }
      if (command instanceof PutSecretValueCommand) {
        state.value = command.input.SecretString ?? "";
        state.puts += 1;
        state.afterPut?.();
        return {};
      }
      throw new Error("unexpected command");
    },
  } as unknown as SecretsManagerClient;
  return { client, state };
};

const storeFor = (client: SecretsManagerClient, plainText = false) =>
  new SecretsManagerWebhookSecretStore({
    secretArn: "arn:secret",
    client,
    plainText,
    writeSettleMs: 0,
  });

describe("SecretsManagerWebhookSecretStore", () => {
  test("keeps per-workspace secrets next to the unkeyed secret the construct seeds", async () => {
    const { client, state } = fakeSecretsManager(JSON.stringify({ secret: "" }));
    const store = storeFor(client);

    expect(await store.get()).toBeNull();
    await store.set("s_a", "ws_a");
    await store.set("s_b", "ws_b");
    await store.set("legacy");

    expect(JSON.parse(state.value)).toEqual({
      secret: "legacy",
      workspaces: { ws_a: "s_a", ws_b: "s_b" },
    });
    expect(await store.get("ws_a")).toBe("s_a");
    expect(await store.get("ws_c")).toBeNull();
    expect(await store.keys()).toEqual(["ws_a", "ws_b"]);

    await store.delete("ws_a");
    expect(await store.keys()).toEqual(["ws_b"]);
    expect(await store.get()).toBe("legacy");
  });

  test("re-applies a change that a concurrent writer overwrote", async () => {
    const { client, state } = fakeSecretsManager(
      JSON.stringify({ workspaces: { ws_a: "s_a" } }),
    );
    const store = storeFor(client);
    // Another writer read the value before our put, then writes its own
    // change on top of that stale read, dropping ws_b.
    state.afterPut = () => {
      state.afterPut = undefined;
      state.value = JSON.stringify({ workspaces: { ws_a: "s_a", ws_c: "s_c" } });
    };

    await store.set("s_b", "ws_b");

    expect(JSON.parse(state.value).workspaces).toEqual({
      ws_a: "s_a",
      ws_b: "s_b",
      ws_c: "s_c",
    });
    expect(state.puts).toBe(2);
  });

  test("gives up after repeated overwrites instead of reporting success", async () => {
    const { client, state } = fakeSecretsManager(JSON.stringify({}));
    const store = storeFor(client);
    state.afterPut = () => {
      state.value = JSON.stringify({});
    };

    await expect(store.delete("missing")).resolves.toBeUndefined();
    await expect(store.set("s_a", "ws_a")).rejects.toThrow(/Serialize writers/);
  });

  test("plain-text secrets hold only the unkeyed secret", async () => {
    const { client, state } = fakeSecretsManager("raw-secret");
    const store = storeFor(client, true);

    expect(await store.get()).toBe("raw-secret");
    expect(await store.get("ws_a")).toBeNull();
    await store.set("next");
    expect(state.value).toBe("next");
    await expect(store.set("s", "ws_a")).rejects.toThrow(/plainText/);
    expect(await store.keys()).toEqual([]);
  });
});
