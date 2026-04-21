import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Adapter, ChatInstance, Message } from "chat";
import { AsanaAdapter } from "../src/adapter";
import type { AsanaRawMessage } from "../src/types";
import { InMemoryWebhookSecretStore } from "../src/webhook-secret-store";
import {
  TEST_BOT_USER,
  TEST_WEBHOOK_SECRET,
  jsonResponse,
  signAsanaBody,
} from "./test-utils";

type CapturedCall = { url: string; init: RequestInit | undefined };

const buildAdapter = (fetchImpl: typeof fetch): AsanaAdapter =>
  new AsanaAdapter({
    accessToken: "token",
    workspaceGid: "ws_1",
    botUser: TEST_BOT_USER,
    fetch: fetchImpl,
    webhookSecretStore: new InMemoryWebhookSecretStore(TEST_WEBHOOK_SECRET),
  });

const emptyStoryResponse = (gid: string) =>
  jsonResponse({
    data: {
      gid,
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

describe("AsanaAdapter.postMessage", () => {
  let capturedCalls: CapturedCall[];

  beforeEach(() => {
    capturedCalls = [];
  });

  const fetchCapturing = (responseFactory: (url: string) => Response) =>
    vi.fn(async (url: URL | RequestInfo | string, init?: RequestInit) => {
      capturedCalls.push({ url: String(url), init });
      return responseFactory(String(url));
    });

  test("posts a comment as html_text to the correct task stories endpoint", async () => {
    const fetchMock = fetchCapturing(() =>
      jsonResponse({
        data: {
          gid: "story_1",
          resource_type: "story",
          resource_subtype: "comment_added",
          type: "comment",
          text: "hi",
          html_text: "<body>hi</body>",
          created_at: "2024-01-01T00:00:00Z",
          created_by: {
            gid: TEST_BOT_USER.gid,
            resource_type: "user",
            name: TEST_BOT_USER.name,
            email: TEST_BOT_USER.email,
          },
          is_edited: false,
          is_pinned: false,
          hearted: false,
        },
      }),
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

  test("does not inject a mention when the thread has no remembered sender", async () => {
    const fetchMock = fetchCapturing(() => emptyStoryResponse("story_unprompted"));

    const adapter = buildAdapter(fetchMock as unknown as typeof fetch);
    const threadId = adapter.encodeThreadId({ taskGid: "task_solo" });
    await adapter.postMessage(threadId, "just a ping");

    const body = JSON.parse(capturedCalls[0]!.init!.body as string);
    expect(body.data.html_text).not.toContain("data-asana-gid");
  });

  test("auto-tags the task creator on replies after a task_added event", async () => {
    const storyResponse = emptyStoryResponse("story_auto");
    const taskResponse = jsonResponse({
      data: {
        gid: "task_auto",
        name: "Hello",
        notes: "Please help",
        html_notes: "<body>Please help</body>",
        completed: false,
        completed_at: null,
        created_at: "2024-01-01T00:00:00Z",
        permalink_url: "https://app.asana.com/0/0/task_auto",
        assignee: { ...TEST_BOT_USER },
        created_by: {
          gid: "sender_42",
          name: "Alice",
          email: "alice@example.com",
        },
        workspace: { gid: "ws_1", name: "WS" },
        memberships: [],
      },
    });
    const fetchMock = fetchCapturing((url) => {
      if (url.includes("/stories")) return storyResponse.clone();
      return taskResponse.clone();
    });

    const adapter = buildAdapter(fetchMock as unknown as typeof fetch);
    const { chat, processed } = fakeSink();
    await adapter.initialize(chat);

    const eventBody = JSON.stringify({
      events: [
        {
          action: "added",
          resource: { gid: "task_auto", resource_type: "task" },
          parent: { gid: "utl_1", resource_type: "user_task_list" },
          user: { gid: "sender_42", resource_type: "user" },
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    await adapter.handleWebhook(
      new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "X-Hook-Signature": signAsanaBody(eventBody) },
        body: eventBody,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(processed).toHaveLength(1);

    const threadId = adapter.encodeThreadId({ taskGid: "task_auto" });
    await adapter.postMessage(threadId, "Here is a reply");

    const storiesCall = capturedCalls.find((c) =>
      c.url.includes("/tasks/task_auto/stories"),
    );
    expect(storiesCall).toBeDefined();
    const body = JSON.parse(storiesCall!.init!.body as string);
    expect(body.data.html_text).toContain('<a data-asana-gid="sender_42"/>');
    expect(body.data.html_text).toContain("Here is a reply");
  });

  test("does not duplicate the mention if the payload already tags the recent sender", async () => {
    const fetchMock = fetchCapturing(() => emptyStoryResponse("story_existing"));
    const adapter = buildAdapter(fetchMock as unknown as typeof fetch);
    const { chat } = fakeSink();
    await adapter.initialize(chat);

    const eventBody = JSON.stringify({
      events: [
        {
          action: "added",
          resource: { gid: "story_existing", resource_type: "story" },
          parent: { gid: "task_existing", resource_type: "task" },
          user: { gid: "sender_77", resource_type: "user" },
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    await adapter.handleWebhook(
      new Request("https://example.com/webhook", {
        method: "POST",
        headers: { "X-Hook-Signature": signAsanaBody(eventBody) },
        body: eventBody,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));

    const threadId = adapter.encodeThreadId({ taskGid: "task_existing" });
    await adapter.postMessage(threadId, {
      raw: '<body><a data-asana-gid="sender_77"/> already mentioned</body>',
    });

    const storiesCall = capturedCalls.find((c) =>
      c.url.includes("/tasks/task_existing/stories"),
    );
    expect(storiesCall).toBeDefined();
    const body = JSON.parse(storiesCall!.init!.body as string);
    const occurrences = body.data.html_text.match(
      /data-asana-gid="sender_77"/g,
    );
    expect(occurrences).toHaveLength(1);
  });
});

describe("AsanaAdapter reactions", () => {
  test("addReaction sends a PUT /stories/{gid} with reacted=true", async () => {
    const capturedCalls: CapturedCall[] = [];
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
              { emoji_base: "\u{1F440}", variant: "\u{1F440}", count: 1, reacted: true },
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
    expect(body.data.reactions).toEqual([{ emoji: "\u{1F440}", reacted: true }]);
  });

  test("removeReaction reuses the same endpoint with reacted=false", async () => {
    const capturedCalls: CapturedCall[] = [];
    const fetchMock = vi.fn(
      async (url: URL | RequestInfo | string, init?: RequestInit) => {
        capturedCalls.push({ url: String(url), init });
        return emptyStoryResponse("story_abc");
      },
    );

    const adapter = buildAdapter(fetchMock as unknown as typeof fetch);
    const threadId = adapter.encodeThreadId({ taskGid: "task_9" });

    await adapter.removeReaction(threadId, "story_abc", "thumbs_up");
    const call = capturedCalls[0]!;
    expect(call.init?.method).toBe("PUT");
    expect(call.url).toContain("/stories/story_abc");
    const body = JSON.parse(call.init!.body as string);
    expect(body.data.reactions).toEqual([{ emoji: "\u{1F44D}", reacted: false }]);
  });
});

/**
 * Thin `ChatInstance` sink used to drive the adapter for tests that need to
 * populate internal state (e.g. `recentCommenter`) but do not care about the
 * real Chat message-routing semantics.
 */
const fakeSink = (): {
  chat: ChatInstance;
  processed: Array<{ threadId: string; message: unknown }>;
} => {
  const processed: Array<{ threadId: string; message: unknown }> = [];
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
    processReaction: () => {},
    processSlashCommand: () => {},
  } as unknown as ChatInstance;
  return { chat, processed };
};
