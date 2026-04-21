import { describe, expect, test } from "vitest";
import { AsanaAdapter } from "../src/adapter";
import type { AsanaRawMessage } from "../src/types";
import { TEST_BOT_USER } from "./test-utils";

const adapter = new AsanaAdapter({
  accessToken: "token",
  workspaceGid: "ws_1",
  botUser: TEST_BOT_USER,
  fetch: () => Promise.reject(new Error("fetch should not be called")) as never,
});

const taskRaw = (overrides: Partial<Record<string, unknown>> = {}): AsanaRawMessage => ({
  kind: "task_description",
  taskGid: "task_100",
  payload: {
    gid: "task_100",
    name: "Please help",
    notes: "Hello world",
    completed: false,
    completed_at: null,
    created_at: "2024-01-01T00:00:00Z",
    permalink_url: "https://app.asana.com/0/0/task_100",
    assignee: { ...TEST_BOT_USER },
    created_by: {
      gid: "user_alice",
      name: "Alice",
      email: "alice@example.com",
    },
    workspace: { gid: "ws_1", name: "Workspace" },
    ...overrides,
  },
});

const storyRaw = (overrides: Partial<Record<string, unknown>> = {}): AsanaRawMessage => ({
  kind: "comment",
  taskGid: "task_100",
  storyGid: "story_1",
  payload: {
    gid: "story_1",
    resource_type: "story",
    resource_subtype: "comment_added",
    type: "comment",
    text: "A reply",
    html_text: "<body>A reply</body>",
    created_at: "2024-01-02T00:00:00Z",
    is_edited: false,
    created_by: {
      gid: "user_bob",
      resource_type: "user",
      name: "Bob",
      email: "bob@example.com",
    },
    ...overrides,
  },
});

describe("AsanaAdapter.parseMessage", () => {
  test("treats task descriptions as mentions with the creator as author", () => {
    const message = adapter.parseMessage(taskRaw());

    expect(message.text).toBe("Hello world");
    expect(message.id).toBe("task_100");
    expect(message.isMention).toBe(true);
    expect(message.author.userId).toBe("user_alice");
    expect(message.author.fullName).toBe("Alice");
    expect(message.author.isBot).toBe(false);
    expect(message.author.isMe).toBe(false);
    expect(message.raw.kind).toBe("task_description");
    expect(message.formatted).toBeDefined();
    expect(message.metadata.edited).toBe(false);
    expect(message.metadata.dateSent).toEqual(new Date("2024-01-01T00:00:00Z"));
  });

  test("falls back to the assignee when the task has no created_by", () => {
    const raw = taskRaw({ created_by: null });
    const message = adapter.parseMessage(raw);

    expect(message.author.userId).toBe(TEST_BOT_USER.gid);
    expect(message.author.isBot).toBe(true);
    expect(message.author.isMe).toBe(true);
  });

  test("parses comments as non-mention subscribed messages", () => {
    const message = adapter.parseMessage(storyRaw());

    expect(message.text).toBe("A reply");
    expect(message.id).toBe("story_1");
    expect(message.isMention).toBeFalsy();
    expect(message.author.userId).toBe("user_bob");
    expect(message.raw.kind).toBe("comment");
    expect(message.metadata.edited).toBe(false);
  });

  test("propagates the `is_edited` flag to message metadata", () => {
    const message = adapter.parseMessage(storyRaw({ is_edited: true }));
    expect(message.metadata.edited).toBe(true);
  });

  test("flags bot-authored comments as isBot/isMe", () => {
    const message = adapter.parseMessage(
      storyRaw({
        created_by: {
          gid: TEST_BOT_USER.gid,
          name: TEST_BOT_USER.name,
          email: TEST_BOT_USER.email,
        },
      }),
    );

    expect(message.author.isBot).toBe(true);
    expect(message.author.isMe).toBe(true);
  });

  test("yields a sentinel author when created_by is null", () => {
    const message = adapter.parseMessage(storyRaw({ created_by: null }));

    expect(message.author.userId).toBe("asana:unknown");
    expect(message.author.isBot).toBe("unknown");
  });
});
