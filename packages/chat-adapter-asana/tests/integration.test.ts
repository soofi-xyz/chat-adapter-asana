import { describe, expect, test, vi } from "vitest";
import {
  TEST_BOT_USER,
  createAsanaTestContext,
  jsonResponse,
} from "./test-utils";

/**
 * Responds to any Asana REST request with a reasonable default so tests can
 * focus on the event-routing assertions instead of rebuilding every response.
 * Callers can still override a specific URL via `overrides` when needed.
 */
const asanaFetchMock = (
  overrides: Record<string, () => Response> = {},
): typeof fetch =>
  vi.fn(async (url: URL | RequestInfo | string) => {
    const urlStr = String(url);
    for (const [match, builder] of Object.entries(overrides)) {
      if (urlStr.includes(match)) return builder();
    }
    if (urlStr.includes("/stories/")) {
      return jsonResponse({
        data: {
          gid: "story_posted",
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
    }
    if (urlStr.includes("/stories")) {
      return jsonResponse({
        data: {
          gid: "story_posted",
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
    }
    if (urlStr.includes("/users/")) {
      return jsonResponse({
        data: { gid: "user_default", name: "Default", email: "d@example.com" },
      });
    }
    return jsonResponse({
      data: {
        gid: "task_default",
        name: "Task",
        notes: "body text",
        html_notes: "<body>body text</body>",
        completed: false,
        completed_at: null,
        created_at: "2024-01-01T00:00:00Z",
        permalink_url: "https://app.asana.com/0/0/task_default",
        assignee: { ...TEST_BOT_USER },
        workspace: { gid: "ws_1", name: "Workspace" },
        memberships: [],
      },
    });
  }) as unknown as typeof fetch;

const taskAddedEvent = (taskGid: string, senderGid = "sender_1") => ({
  events: [
    {
      action: "added",
      resource: { gid: taskGid, resource_type: "task" },
      parent: { gid: "utl_1", resource_type: "user_task_list" },
      user: { gid: senderGid, resource_type: "user" },
      created_at: "2024-01-01T00:00:00Z",
    },
  ],
});

const commentAddedEvent = (taskGid: string, storyGid: string, senderGid: string) => ({
  events: [
    {
      action: "added",
      resource: { gid: storyGid, resource_type: "story" },
      parent: { gid: taskGid, resource_type: "task" },
      user: { gid: senderGid, resource_type: "user" },
      created_at: "2024-01-01T00:01:00Z",
    },
  ],
});

const taskCompletedEvent = (taskGid: string, senderGid: string) => ({
  events: [
    {
      action: "changed",
      resource: { gid: taskGid, resource_type: "task" },
      change: { field: "completed", action: "changed" },
      user: { gid: senderGid, resource_type: "user" },
      created_at: "2024-01-02T00:00:00Z",
    },
  ],
});

describe("Asana adapter integration", () => {
  test("fires onNewMention when a task is assigned to the bot", async () => {
    const fetch = asanaFetchMock({
      "/tasks/task_mention": () =>
        jsonResponse({
          data: {
            gid: "task_mention",
            name: "Please help",
            notes: "Need a hand with this",
            html_notes: "<body>Need a hand with this</body>",
            completed: false,
            completed_at: null,
            created_at: "2024-01-01T00:00:00Z",
            permalink_url: "https://app.asana.com/0/0/task_mention",
            assignee: { ...TEST_BOT_USER },
            created_by: {
              gid: "sender_1",
              name: "Alice",
              email: "alice@example.com",
            },
            workspace: { gid: "ws_1", name: "Workspace" },
            memberships: [],
          },
        }),
    });
    const ctx = createAsanaTestContext({ fetch });

    const response = await ctx.sendWebhook(taskAddedEvent("task_mention"));

    expect(response.status).toBe(200);
    expect(ctx.captured.mentionMessage).not.toBeNull();
    expect(ctx.captured.mentionMessage?.text).toBe("Need a hand with this");
    expect(ctx.captured.mentionMessage?.isMention).toBe(true);
    expect(ctx.captured.mentionThread?.id).toBe(
      ctx.adapter.encodeThreadId({ taskGid: "task_mention" }),
    );
  });

  test("delivers follow-up comments to onSubscribedMessage after thread.subscribe()", async () => {
    const fetch = asanaFetchMock({
      "/tasks/task_sub": () =>
        jsonResponse({
          data: {
            gid: "task_sub",
            name: "Task needing follow-up",
            notes: "Initial message",
            html_notes: "<body>Initial message</body>",
            completed: false,
            completed_at: null,
            created_at: "2024-01-01T00:00:00Z",
            permalink_url: "https://app.asana.com/0/0/task_sub",
            assignee: { ...TEST_BOT_USER },
            created_by: {
              gid: "sender_1",
              name: "Alice",
              email: "alice@example.com",
            },
            workspace: { gid: "ws_1", name: "Workspace" },
            memberships: [],
          },
        }),
      "/stories/story_follow": () =>
        jsonResponse({
          data: {
            gid: "story_follow",
            resource_type: "story",
            resource_subtype: "comment_added",
            type: "comment",
            text: "Thanks for the help!",
            html_text: "<body>Thanks for the help!</body>",
            created_at: "2024-01-01T00:01:00Z",
            is_edited: false,
            created_by: {
              gid: "sender_1",
              resource_type: "user",
              name: "Alice",
              email: "alice@example.com",
            },
            reaction_summary: [],
          },
        }),
    });

    const ctx = createAsanaTestContext({
      fetch,
      handlers: {
        onMention: async (thread) => {
          await thread.subscribe();
        },
      },
    });

    await ctx.sendWebhook(taskAddedEvent("task_sub"));
    expect(ctx.captured.mentionMessage?.text).toBe("Initial message");

    const threadId = ctx.adapter.encodeThreadId({ taskGid: "task_sub" });
    expect(await ctx.state.isSubscribed(threadId)).toBe(true);

    await ctx.sendWebhook(
      commentAddedEvent("task_sub", "story_follow", "sender_1"),
    );

    expect(ctx.captured.followUpMessage).not.toBeNull();
    expect(ctx.captured.followUpMessage?.text).toBe("Thanks for the help!");
    expect(ctx.captured.followUpMessage?.isMention).toBeFalsy();
    expect(ctx.captured.followUpThread?.id).toBe(threadId);
  });

  test("translates task completion into an onReaction event", async () => {
    const fetch = asanaFetchMock({
      "/tasks/task_done": () =>
        jsonResponse({
          data: {
            gid: "task_done",
            name: "Completed",
            notes: "done",
            html_notes: "<body>done</body>",
            completed: true,
            completed_at: "2024-01-02T00:00:00Z",
            created_at: "2024-01-01T00:00:00Z",
            permalink_url: "https://app.asana.com/0/0/task_done",
            assignee: { ...TEST_BOT_USER },
            workspace: { gid: "ws_1", name: "Workspace" },
            memberships: [],
          },
        }),
      "/users/sender_complete": () =>
        jsonResponse({
          data: {
            gid: "sender_complete",
            name: "Finisher",
            email: "f@example.com",
          },
        }),
    });

    const ctx = createAsanaTestContext({ fetch });

    await ctx.sendWebhook(taskCompletedEvent("task_done", "sender_complete"));

    expect(ctx.captured.reactions).toHaveLength(1);
    const reaction = ctx.captured.reactions[0]!;
    expect(reaction.added).toBe(true);
    expect(reaction.rawEmoji).toBe("\u2705");
    expect(reaction.messageId).toBe("task_done");
    expect(reaction.user.userId).toBe("sender_complete");
    expect(reaction.threadId).toBe(
      ctx.adapter.encodeThreadId({ taskGid: "task_done" }),
    );
  });

  test("reopening a task fires the same reaction with added=false", async () => {
    const fetch = asanaFetchMock({
      "/tasks/task_reopen": () =>
        jsonResponse({
          data: {
            gid: "task_reopen",
            name: "Reopened",
            notes: "",
            html_notes: "<body></body>",
            completed: false,
            completed_at: null,
            created_at: "2024-01-01T00:00:00Z",
            permalink_url: "https://app.asana.com/0/0/task_reopen",
            assignee: { ...TEST_BOT_USER },
            workspace: { gid: "ws_1", name: "Workspace" },
            memberships: [],
          },
        }),
      "/users/sender_reopen": () =>
        jsonResponse({
          data: {
            gid: "sender_reopen",
            name: "Reopener",
            email: "r@example.com",
          },
        }),
    });

    const ctx = createAsanaTestContext({ fetch });

    await ctx.sendWebhook(taskCompletedEvent("task_reopen", "sender_reopen"));

    expect(ctx.captured.reactions).toHaveLength(1);
    expect(ctx.captured.reactions[0]?.added).toBe(false);
  });

  test("ignores events whose actor is the bot itself (self-message filter)", async () => {
    const fetch = asanaFetchMock();
    const ctx = createAsanaTestContext({ fetch });

    await ctx.sendWebhook(taskAddedEvent("task_bot", TEST_BOT_USER.gid));

    expect(ctx.captured.mentionMessage).toBeNull();
    expect(ctx.captured.followUpMessage).toBeNull();
    expect(ctx.captured.reactions).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("responds to the Asana handshake by echoing X-Hook-Secret", async () => {
    const ctx = createAsanaTestContext();

    const response = await ctx.sendHandshake("handshake-secret");

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Hook-Secret")).toBe("handshake-secret");
    expect(await ctx.adapter.webhookSecretStore.get()).toBe("handshake-secret");
  });
});
