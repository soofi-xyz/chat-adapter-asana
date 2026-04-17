import { createHmac } from "node:crypto";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { AsanaAdapter } from "../src/adapter";
import {
  InMemoryWebhookSecretStore,
} from "../src/webhook-secret-store";
import {
  isAsanaTaskCompletionMessage,
  isAsanaTaskDescriptionMessage,
} from "../src/task-completion";
import type { ChatInstance } from "chat";

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

const botUser = { gid: "bot_1", name: "asana-bot", email: "bot@example.com" };

const buildAdapter = (fetchImpl: typeof fetch) =>
  new AsanaAdapter({
    accessToken: "token",
    workspaceGid: "ws_1",
    botUser,
    fetch: fetchImpl,
    webhookSecretStore: new InMemoryWebhookSecretStore("secret"),
  });

const fakeChat = (): {
  chat: ChatInstance;
  processed: Array<{ threadId: string; message: unknown }>;
} => {
  const processed: Array<{ threadId: string; message: unknown }> = [];
  const chat = {
    getLogger: () => console,
    getState: () => undefined as unknown as ReturnType<ChatInstance["getState"]>,
    getUserName: () => "asana-bot",
    handleIncomingMessage: async () => {},
    processAction: () => {},
    processAppHomeOpened: () => {},
    processAssistantContextChanged: () => {},
    processAssistantThreadStarted: () => {},
    processMemberJoinedChannel: () => {},
    processMessage: (_adapter, threadId, msg) => {
      const run = async () => {
        const message = typeof msg === "function" ? await msg() : msg;
        processed.push({ threadId, message });
      };
      void run();
    },
    processModalClose: () => {},
    processModalSubmit: async () => undefined,
    processReaction: () => {},
    processSlashCommand: () => {},
  } as unknown as ChatInstance;
  return { chat, processed };
};

describe("AsanaAdapter.encodeThreadId", () => {
  test("round-trips task GIDs", () => {
    const adapter = buildAdapter(() => Promise.reject("unused") as never);
    const threadId = adapter.encodeThreadId({ taskGid: "task_42" });
    expect(threadId).toMatch(/^asana:/);
    expect(adapter.decodeThreadId(threadId)).toEqual({ taskGid: "task_42" });
  });

  test("rejects invalid thread IDs", () => {
    const adapter = buildAdapter(() => Promise.reject("unused") as never);
    expect(() => adapter.decodeThreadId("slack:foo")).toThrow();
  });
});

describe("AsanaAdapter.handleWebhook", () => {
  test("echoes X-Hook-Secret during handshake and persists it", async () => {
    const adapter = new AsanaAdapter({
      accessToken: "token",
      workspaceGid: "ws_1",
      botUser,
      fetch: () => Promise.reject("unused") as never,
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

  test("rejects requests with an invalid signature", async () => {
    const adapter = buildAdapter(() => Promise.reject("unused") as never);
    const body = JSON.stringify({ events: [] });
    await expect(
      adapter.handleWebhook(
        new Request("https://example.com/webhook", {
          method: "POST",
          headers: { "X-Hook-Signature": "deadbeef" },
          body,
        }),
      ),
    ).rejects.toThrow();
  });

  test("dispatches task_added events with the description as the first message", async () => {
    const { chat, processed } = fakeChat();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          gid: "task_100",
          name: "Hello",
          notes: "Please help me",
          html_notes: "<body>Please help me</body>",
          completed: false,
          completed_at: null,
          created_at: "2024-01-01T00:00:00Z",
          permalink_url: "https://app.asana.com/0/0/task_100",
          assignee: { gid: botUser.gid, name: "asana-bot", email: "bot@example.com" },
          workspace: { gid: "ws_1", name: "WS" },
          memberships: [],
        },
      }),
    );
    const adapter = buildAdapter(fetchMock);
    await adapter.initialize(chat);

    const eventBody = JSON.stringify({
      events: [
        {
          action: "added",
          resource: { gid: "task_100", resource_type: "task" },
          parent: { gid: "utl_1", resource_type: "user_task_list" },
          user: { gid: "sender_1", resource_type: "user" },
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    const signature = createHmac("sha256", "secret")
      .update(eventBody)
      .digest("hex");

    const response = await adapter.handleWebhook(
      new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "X-Hook-Signature": signature },
        body: eventBody,
      }),
    );

    expect(response.status).toBe(200);

    await new Promise((r) => setTimeout(r, 20));

    expect(processed).toHaveLength(1);
    const message = processed[0]!.message as { text: string; isMention?: boolean; raw: { kind: string } };
    expect(message.text).toBe("Please help me");
    expect(message.isMention).toBe(true);
    expect(isAsanaTaskDescriptionMessage(message as never)).toBe(true);
  });

  test("emits task_completed messages when the completed field changes", async () => {
    const { chat, processed } = fakeChat();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          gid: "task_100",
          name: "Hello",
          notes: "done",
          html_notes: "<body>done</body>",
          completed: true,
          completed_at: "2024-01-02T00:00:00Z",
          created_at: "2024-01-01T00:00:00Z",
          permalink_url: "https://app.asana.com/0/0/task_100",
          assignee: { gid: botUser.gid, name: "asana-bot", email: "bot@example.com" },
          workspace: { gid: "ws_1", name: "WS" },
          memberships: [],
        },
      }),
    );
    const adapter = buildAdapter(fetchMock);
    await adapter.initialize(chat);

    const eventBody = JSON.stringify({
      events: [
        {
          action: "changed",
          resource: { gid: "task_100", resource_type: "task" },
          change: { field: "completed", action: "changed" },
          user: { gid: "sender_1", resource_type: "user" },
          created_at: "2024-01-02T00:00:00Z",
        },
      ],
    });
    const signature = createHmac("sha256", "secret")
      .update(eventBody)
      .digest("hex");

    await adapter.handleWebhook(
      new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "X-Hook-Signature": signature },
        body: eventBody,
      }),
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(processed).toHaveLength(1);
    expect(isAsanaTaskCompletionMessage(processed[0]!.message as never)).toBe(true);
  });
});

describe("AsanaAdapter.postMessage", () => {
  let capturedCalls: Array<{ url: string; init: RequestInit | undefined }>;
  beforeEach(() => {
    capturedCalls = [];
  });

  test("posts a comment as html_text to the correct task", async () => {
    const fetchMock = vi.fn(
      async (url: URL | RequestInfo | string, init?: RequestInit) => {
        capturedCalls.push({ url: String(url), init });
        return jsonResponse({
          data: {
            gid: "story_1",
            resource_type: "story",
            resource_subtype: "comment_added",
            type: "comment",
            text: "hi",
            html_text: "<body>hi</body>",
            created_at: "2024-01-01T00:00:00Z",
            created_by: {
              gid: "bot_1",
              resource_type: "user",
              name: "asana-bot",
              email: "bot@example.com",
            },
            is_edited: false,
            is_pinned: false,
            hearted: false,
          },
        });
      },
    );

    const adapter = buildAdapter(fetchMock as unknown as typeof fetch);
    const threadId = adapter.encodeThreadId({ taskGid: "task_7" });
    const result = await adapter.postMessage(threadId, "hello world");

    expect(result.id).toBe("story_1");
    const call = capturedCalls[0]!;
    expect(call.url).toContain("/tasks/task_7/stories");
    const body = JSON.parse(call.init!.body as string);
    expect(body.data.html_text).toContain("<body>hello world</body>");
  });

  test("addReaction sends a native reactions PUT with unicode emoji", async () => {
    const fetchMock = vi.fn(
      async (url: URL | RequestInfo | string, init?: RequestInit) => {
        capturedCalls.push({ url: String(url), init });
        return jsonResponse({
          data: {
            gid: "story_abc",
            resource_type: "story",
            resource_subtype: "comment_added",
            type: "comment",
            text: "",
            html_text: "<body></body>",
            created_at: "2024-01-01T00:00:00Z",
            created_by: null,
            is_edited: false,
            is_pinned: false,
            hearted: false,
            reaction_summary: [
              { emoji_base: "👀", variant: "👀", count: 1, reacted: true },
            ],
          },
        });
      },
    );

    const adapter = buildAdapter(fetchMock as unknown as typeof fetch);
    const threadId = adapter.encodeThreadId({ taskGid: "task_9" });

    await adapter.addReaction(threadId, "story_abc", {
      name: "eyes",
      toString: () => "{{emoji:eyes}}",
      toJSON: () => "{{emoji:eyes}}",
    });
    const call = capturedCalls[0]!;
    expect(call.init?.method).toBe("PUT");
    expect(call.url).toContain("/stories/story_abc");
    const body = JSON.parse(call.init!.body as string);
    expect(body.data.reactions).toEqual([{ emoji: "👀", reacted: true }]);
  });

  test("removeReaction sends reacted=false on the same endpoint", async () => {
    const fetchMock = vi.fn(
      async (url: URL | RequestInfo | string, init?: RequestInit) => {
        capturedCalls.push({ url: String(url), init });
        return jsonResponse({
          data: {
            gid: "story_abc",
            resource_type: "story",
            resource_subtype: "comment_added",
            type: "comment",
            text: "",
            html_text: "<body></body>",
            created_at: "2024-01-01T00:00:00Z",
            created_by: null,
            is_edited: false,
            is_pinned: false,
            hearted: false,
            reaction_summary: [],
          },
        });
      },
    );

    const adapter = buildAdapter(fetchMock as unknown as typeof fetch);
    const threadId = adapter.encodeThreadId({ taskGid: "task_9" });

    await adapter.removeReaction(threadId, "story_abc", "thumbs_up");
    const call = capturedCalls[0]!;
    expect(call.init?.method).toBe("PUT");
    expect(call.url).toContain("/stories/story_abc");
    const body = JSON.parse(call.init!.body as string);
    expect(body.data.reactions).toEqual([{ emoji: "👍", reacted: false }]);
  });
});
