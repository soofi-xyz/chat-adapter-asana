/**
 * End-to-end test harness: creates an Asana task as the sender bot, assigns it
 * to the target bot, verifies the bot posts a tagging reply, replies from the
 * sender, and verifies the bot reacts with an "eye" emoji and sends back a
 * text attachment.
 *
 * Requires two PATs:
 *   - ASANA_PAT (bot)
 *   - ASANA_PAT_SENDER (test user that talks to the bot)
 */
import { setTimeout as delay } from "node:timers/promises";
import { createAsanaClient } from "@soofi/chat-adapter-asana";

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
};

const BOT_PAT = requireEnv("ASANA_PAT");
const SENDER_PAT = requireEnv("ASANA_PAT_SENDER");
const WORKSPACE_GID = requireEnv("ASANA_WORKSPACE_GID");

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 3 * 60_000;

interface Story {
  gid: string;
  created_at?: string | null;
  type: string;
  resource_subtype?: string | null;
  text?: string | null;
  html_text?: string | null;
  is_edited?: boolean | null;
  created_by?: { gid: string; name?: string | null; email?: string | null } | null;
  resource_type?: string;
}

const botClient = createAsanaClient({ accessToken: BOT_PAT });
const senderClient = createAsanaClient({ accessToken: SENDER_PAT });

const log = (message: string, extra?: unknown): void => {
  const ts = new Date().toISOString();
  if (extra !== undefined) {
    console.log(`[${ts}] ${message}`, extra);
  } else {
    console.log(`[${ts}] ${message}`);
  }
};

const pollForStory = async (
  taskGid: string,
  predicate: (story: Story) => boolean,
  description: string,
): Promise<Story> => {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const page = (await senderClient.stories.listForTask(taskGid, {
      select: {
        type: true,
        text: true,
        html_text: true,
        created_at: true,
        is_edited: true,
        resource_subtype: true,
        created_by: { name: true, email: true },
      },
    })) as { data: Story[] };
    const match = page.data.find(predicate);
    if (match) return match;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for: ${description}`);
};

const main = async (): Promise<void> => {
  log("Resolving users...");
  const bot = (await botClient.users.getMe()) as { gid: string; name?: string };
  const sender = (await senderClient.users.getMe()) as { gid: string; name?: string };
  log(`Bot=${bot.name} (${bot.gid}), Sender=${sender.name} (${sender.gid})`);

  const taskName = `[e2e] asana-chat-adapter ${new Date().toISOString()}`;
  log(`Creating task "${taskName}" as sender and assigning to bot...`);
  const task = (await senderClient.tasks.create({
    workspace: WORKSPACE_GID,
    assignee: bot.gid,
    name: taskName,
    notes:
      "Hello bot, this is an end-to-end test from @soofi/chat-adapter-asana. " +
      "Please reply when you see this.",
  })) as { gid: string; permalink_url?: string | null };
  const taskUrl =
    task.permalink_url ?? `https://app.asana.com/0/0/${task.gid}/f`;
  log(`Task created: ${task.gid}`);
  log(`Inspect in Asana: ${taskUrl}`);

  log("Waiting for bot to post the initial reply...");
  const firstBotReply = await pollForStory(
    task.gid,
    (story) =>
      story.type === "comment" &&
      story.created_by?.gid === bot.gid &&
      typeof story.html_text === "string" &&
      story.html_text.includes("Thanks for assigning"),
    "bot acknowledging the task description",
  );
  log(
    `Bot replied: gid=${firstBotReply.gid} html_text="${firstBotReply.html_text ?? ""}"`,
  );
  const mentionRegex = new RegExp(
    `data-asana-type="user"[^>]*data-asana-gid="${sender.gid}"|data-asana-gid="${sender.gid}"[^>]*data-asana-type="user"`,
  );
  if (
    !firstBotReply.html_text ||
    !mentionRegex.test(firstBotReply.html_text)
  ) {
    throw new Error(
      `Bot reply does not contain an expanded @mention anchor for sender ${sender.gid}: ${firstBotReply.html_text}`,
    );
  }
  log("Verified bot reply contains native @mention of sender.");

  log("Sender posts a follow-up asking for an attachment...");
  const senderFollowUp = (await senderClient.stories.createOnTask(task.gid, {
    html_text:
      `<body>Thanks! Could you please attach a sample text file? ` +
      `(eye reaction expected) <a data-asana-gid="${bot.gid}"/></body>`,
  })) as { gid: string };
  log(`Sender follow-up story gid=${senderFollowUp.gid}`);

  log(
    "Waiting for bot to add a native 👀 reaction on the sender follow-up story...",
  );
  const reactionSummary = await pollForReaction(
    senderFollowUp.gid,
    (summary) =>
      summary.some(
        (entry) =>
          entry.emoji_base === "👀" || entry.variant === "👀",
      ),
    "bot adding a native 👀 reaction on the follow-up",
  );
  log(`Reaction summary on follow-up story`, reactionSummary);

  log("Polling for bot attachment reply...");
  const attachments = await pollForAttachments(task.gid);
  log(`Attachments present: ${attachments.length}`, attachments);

  log("Sender marks the task complete to trigger the onReaction flow...");
  await senderClient.tasks.update(task.gid, { completed: true });

  log(
    "Waiting for bot to post the task-completion acknowledgment (onReaction → :white_check_mark:)...",
  );
  const completionAck = await pollForStory(
    task.gid,
    (story) =>
      story.type === "comment" &&
      story.created_by?.gid === bot.gid &&
      typeof story.html_text === "string" &&
      story.html_text.includes("Acknowledged: task completed"),
    "bot acknowledging the task-completion reaction",
  );
  log(`Bot posted completion acknowledgment: gid=${completionAck.gid}`);

  log("E2E test passed");
};

interface ReactionSummaryItem {
  emoji_base: string;
  variant: string;
  count: number;
  reacted: boolean;
}

const pollForReaction = async (
  storyGid: string,
  predicate: (summary: ReactionSummaryItem[]) => boolean,
  description: string,
): Promise<ReactionSummaryItem[]> => {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const story = (await senderClient.stories.get(storyGid, {
      select: {
        reaction_summary: {
          emoji_base: true,
          variant: true,
          count: true,
          reacted: true,
        },
      },
    })) as { reaction_summary?: ReactionSummaryItem[] | null };
    const summary = story.reaction_summary ?? [];
    if (predicate(summary)) return summary;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for: ${description}`);
};

const pollForAttachments = async (
  taskGid: string,
): Promise<Array<{ gid: string; name?: string | null }>> => {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const page = (await senderClient.attachments.listForTask(taskGid, {
      select: {
        name: true,
      },
    })) as { data: Array<{ gid: string; name?: string | null }> };
    if (page.data.length > 0) return page.data;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for bot to upload an attachment.");
};

main().catch((err) => {
  console.error("E2E test failed:", err);
  process.exit(1);
});
