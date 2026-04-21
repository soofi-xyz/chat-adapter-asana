import { describe, expect, test, vi } from "vitest";
import type { Adapter, ChatInstance, Message, ReactionEvent } from "chat";
import type { AsanaRawMessage } from "../src/types";
import { AsanaAdapter } from "../src/adapter";
import { InMemoryWebhookSecretStore } from "../src/webhook-secret-store";
import { TEST_BOT_USER, TEST_WEBHOOK_SECRET, signAsanaBody } from "./test-utils";

/**
 * Minimal ChatInstance stub used by webhook signature tests so that the
 * adapter dispatches events without needing a full `Chat` instance.
 * Integration tests in `integration.test.ts` exercise a real `Chat`.
 */
const stubChat = (): {
  chat: ChatInstance;
  processed: Array<{ threadId: string; message: unknown }>;
  reactions: Array<Omit<ReactionEvent, "adapter" | "thread">>;
} => {
  const processed: Array<{ threadId: string; message: unknown }> = [];
  const reactions: Array<Omit<ReactionEvent, "adapter" | "thread">> = [];
  const chat = {
    getLogger: () => console,
    getState: () => undefined as unknown as ReturnType<ChatInstance["getState"]>,
    getUserName: () => TEST_BOT_USER.name,
    handleIncomingMessage: async () => {},
    processAction: () => {},
    processAppHomeOpened: () => {},
    processAssistantContextChanged: () => {},
    processAssistantThreadStarted: () => {},
    processMemberJoinedChannel: () => {},
    processMessage: (
      _adapter: Adapter,
      threadId: string,
      msg:
        | Message<AsanaRawMessage>
        | (() => Promise<Message<AsanaRawMessage>>),
    ) => {
      const run = async () => {
        const message = typeof msg === "function" ? await msg() : msg;
        processed.push({ threadId, message });
      };
      void run();
    },
    processModalClose: () => {},
    processModalSubmit: async () => undefined,
    processReaction: (event: Omit<ReactionEvent, "adapter" | "thread">) => {
      reactions.push(event);
    },
    processSlashCommand: () => {},
  } as unknown as ChatInstance;
  return { chat, processed, reactions };
};

const buildAdapter = (fetchImpl?: typeof fetch): AsanaAdapter =>
  new AsanaAdapter({
    accessToken: "token",
    workspaceGid: "ws_1",
    botUser: TEST_BOT_USER,
    fetch:
      fetchImpl ??
      ((() =>
        Promise.reject(new Error("fetch should not be called"))) as never),
    webhookSecretStore: new InMemoryWebhookSecretStore(TEST_WEBHOOK_SECRET),
  });

describe("AsanaAdapter.handleWebhook — handshake", () => {
  test("echoes X-Hook-Secret and persists it to the secret store", async () => {
    const adapter = new AsanaAdapter({
      accessToken: "token",
      workspaceGid: "ws_1",
      botUser: TEST_BOT_USER,
      fetch: (() =>
        Promise.reject(new Error("fetch should not be called"))) as never,
    });

    const response = await adapter.handleWebhook(
      new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "X-Hook-Secret": "s3cret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Hook-Secret")).toBe("s3cret");
    expect(await adapter.webhookSecretStore.get()).toBe("s3cret");
  });
});

describe("AsanaAdapter.handleWebhook — signature verification", () => {
  test("returns 401 when the signature header is missing", async () => {
    const adapter = buildAdapter();

    const response = await adapter.handleWebhook(
      new Request("https://example.com/webhook", {
        method: "POST",
        body: JSON.stringify({ events: [] }),
      }),
    );

    expect(response.status).toBe(401);
  });

  test("throws when the signature is present but invalid", async () => {
    const adapter = buildAdapter();

    await expect(
      adapter.handleWebhook(
        new Request("https://example.com/webhook", {
          method: "POST",
          headers: { "X-Hook-Signature": "deadbeef" },
          body: JSON.stringify({ events: [] }),
        }),
      ),
    ).rejects.toThrow();
  });

  test("returns 200 for a correctly signed payload with zero events", async () => {
    const adapter = buildAdapter();
    const body = JSON.stringify({ events: [] });

    const response = await adapter.handleWebhook(
      new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "X-Hook-Signature": signAsanaBody(body) },
        body,
      }),
    );

    expect(response.status).toBe(200);
  });

  test("returns 400 for malformed JSON even if the signature matches", async () => {
    const adapter = buildAdapter();
    const body = "{not json";

    const response = await adapter.handleWebhook(
      new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "X-Hook-Signature": signAsanaBody(body) },
        body,
      }),
    );

    expect(response.status).toBe(400);
  });
});

describe("AsanaAdapter.handleWebhook — event filtering", () => {
  test("drops events whose actor is the bot itself", async () => {
    const { chat, processed, reactions } = stubChat();
    const fetchMock = vi.fn<typeof fetch>();
    const adapter = buildAdapter(fetchMock as unknown as typeof fetch);
    await adapter.initialize(chat);

    const body = JSON.stringify({
      events: [
        {
          action: "added",
          resource: { gid: "task_self", resource_type: "task" },
          parent: { gid: "utl_1", resource_type: "user_task_list" },
          user: { gid: TEST_BOT_USER.gid, resource_type: "user" },
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });

    const response = await adapter.handleWebhook(
      new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "X-Hook-Signature": signAsanaBody(body) },
        body,
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(processed).toHaveLength(0);
    expect(reactions).toHaveLength(0);
  });
});
