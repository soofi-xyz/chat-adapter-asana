import { createHmac, timingSafeEqual } from "node:crypto";
import {
  AuthenticationError,
  ValidationError,
  extractCard,
  extractFiles,
} from "@chat-adapter/shared";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  RawMessage,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import { ConsoleLogger, EmojiResolver, Message } from "chat";
import { createAsanaClient, type AsanaClient } from "./asana-client/client";
import type {
  AsanaAttachment,
  AsanaUser,
} from "./asana-client/schema";

type TaskForAdapter = {
  gid: string;
  name: string;
  notes: string;
  completed: boolean;
  completed_at: string | null;
  created_at: string | null;
  permalink_url: string | null;
  assignee: { gid: string; name: string; email: string } | null;
  created_by?: { gid: string; name: string; email: string } | null;
  workspace: { gid: string; name: string };
};

type StoryForAdapter = {
  gid: string;
  type: string;
  text: string;
  html_text: string;
  created_at: string;
  is_edited: boolean;
  created_by: { gid: string; name: string; email: string } | null;
};
import { AsanaFormatConverter } from "./format-converter";
import type { AsanaAdapterConfig, AsanaRawMessage, AsanaThreadId } from "./types";
import {
  InMemoryWebhookSecretStore,
  type WebhookSecretStore,
} from "./webhook-secret-store";

const ADAPTER_NAME = "asana";

interface AsanaWebhookEvent {
  user?: { gid: string; resource_type?: string };
  created_at?: string;
  action: "changed" | "added" | "removed" | "deleted" | "undeleted";
  resource: { gid: string; resource_type?: string; resource_subtype?: string };
  parent?: { gid: string; resource_type?: string } | null;
  change?: { field: string; action?: string };
}

interface AsanaWebhookPayload {
  events?: AsanaWebhookEvent[];
}

export interface AsanaAdapterInternalConfig extends AsanaAdapterConfig {
  webhookSecretStore?: WebhookSecretStore;
}

/**
 * Chat SDK adapter for Asana. Tasks act as threads; story (comment) events act
 * as messages. Task completion is surfaced as a distinct message with
 * `raw.kind === "task_completed"`.
 */
export class AsanaAdapter
  implements Adapter<AsanaThreadId, AsanaRawMessage>
{
  readonly name = ADAPTER_NAME;
  readonly userName: string;
  botUserId: string | undefined;

  readonly client: AsanaClient;
  readonly workspaceGid: string;
  readonly webhookSecretStore: WebhookSecretStore;

  private chat: ChatInstance | null = null;
  private logger: Logger;
  private readonly converter = new AsanaFormatConverter();
  private readonly emojiResolver = new EmojiResolver();
  /**
   * Last observed non-bot sender per thread, used to automatically tag the
   * right person when the bot posts a reply. Keyed by encoded threadId,
   * value is the Asana user GID. Populated in the webhook factories right
   * after we parse an incoming task/story, and read in {@link postMessage}.
   */
  private readonly recentCommenter = new Map<string, string>();
  private botUser:
    | { gid: string; name: string; email?: string }
    | null;

  constructor(config: AsanaAdapterInternalConfig) {
    if (!config.accessToken) {
      throw new ValidationError(
        ADAPTER_NAME,
        "AsanaAdapter requires an accessToken (ASANA_PAT).",
      );
    }
    if (!config.workspaceGid) {
      throw new ValidationError(
        ADAPTER_NAME,
        "AsanaAdapter requires a workspaceGid (ASANA_WORKSPACE_GID).",
      );
    }

    this.client = createAsanaClient({
      accessToken: config.accessToken,
      baseUrl: config.baseUrl,
      fetch: config.fetch,
    });
    this.workspaceGid = config.workspaceGid;
    this.logger = config.logger ?? new ConsoleLogger();
    this.botUser = config.botUser ?? null;
    if (this.botUser) {
      this.botUserId = this.botUser.gid;
    }
    this.userName = config.userName ?? this.botUser?.name ?? "asana-bot";

    this.webhookSecretStore =
      config.webhookSecretStore ??
      new InMemoryWebhookSecretStore(config.webhookSecret);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(ADAPTER_NAME);

    if (!this.botUser) {
      const me = await this.client.users.getMe({
        select: { name: true, email: true },
      });
      this.botUser = { gid: me.gid, name: me.name, email: me.email };
      this.botUserId = me.gid;
    }
  }

  encodeThreadId(data: AsanaThreadId): string {
    const segment = Buffer.from(data.taskGid).toString("base64url");
    return `${ADAPTER_NAME}:${segment}`;
  }

  decodeThreadId(threadId: string): AsanaThreadId {
    const [prefix, segment] = threadId.split(":");
    if (prefix !== ADAPTER_NAME || !segment) {
      throw new ValidationError(
        ADAPTER_NAME,
        `Invalid Asana thread ID: ${threadId}`,
      );
    }
    const taskGid = Buffer.from(segment, "base64url").toString();
    return { taskGid };
  }

  channelIdFromThreadId(_threadId: string): string {
    return `${ADAPTER_NAME}:${this.workspaceGid}`;
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions,
  ): Promise<Response> {
    const handshakeSecret = request.headers.get("x-hook-secret");
    if (handshakeSecret) {
      this.logger.info("Received Asana webhook handshake", {
        fingerprint: handshakeSecret.slice(0, 8),
      });
      await this.webhookSecretStore.set(handshakeSecret);
      return new Response("", {
        status: 200,
        headers: { "X-Hook-Secret": handshakeSecret },
      });
    }

    const body = await request.text();
    const signature = request.headers.get("x-hook-signature");
    const storedSecret = await this.webhookSecretStore.get();

    if (storedSecret) {
      if (!signature) {
        this.logger.warn("Webhook missing signature; rejecting");
        return new Response("Missing signature", { status: 401 });
      }
      if (!verifySignature(storedSecret, body, signature)) {
        this.logger.warn("Webhook signature mismatch; rejecting");
        throw new AuthenticationError(
          ADAPTER_NAME,
          "Invalid Asana webhook signature.",
        );
      }
    } else {
      this.logger.warn(
        "No webhook secret stored; cannot verify signature. Skipping verification (handshake likely in progress).",
      );
    }

    let payload: AsanaWebhookPayload;
    try {
      payload = body ? JSON.parse(body) : {};
    } catch (error) {
      this.logger.error("Malformed Asana webhook body", error);
      return new Response("Malformed JSON", { status: 400 });
    }

    const events = payload.events ?? [];
    this.logger.debug(`Received ${events.length} Asana webhook event(s)`);

    for (const event of events) {
      this.dispatchEvent(event, options);
    }

    return new Response("OK", { status: 200 });
  }

  private dispatchEvent(event: AsanaWebhookEvent, options?: WebhookOptions): void {
    if (!this.chat) {
      this.logger.warn("Event received before adapter initialization; dropping");
      return;
    }

    const resourceType = event.resource.resource_type;
    const action = event.action;

    if (event.user && event.user.gid === this.botUserId) {
      return;
    }

    if (resourceType === "task" && action === "added") {
      this.handleTaskAdded(event, options);
      return;
    }

    if (
      resourceType === "task" &&
      action === "changed" &&
      event.change?.field === "assignee"
    ) {
      this.handleTaskAdded(event, options);
      return;
    }

    if (
      resourceType === "task" &&
      action === "changed" &&
      event.change?.field === "completed"
    ) {
      this.handleTaskCompleted(event, options);
      return;
    }

    if (
      resourceType === "story" &&
      action === "added" &&
      event.parent?.resource_type === "task"
    ) {
      this.handleStoryAdded(event, options);
      return;
    }

    this.logger.debug("Ignoring Asana event", {
      action,
      resourceType,
      field: event.change?.field,
      parentType: event.parent?.resource_type,
    });
  }

  private handleTaskAdded(
    event: AsanaWebhookEvent,
    options?: WebhookOptions,
  ): void {
    const taskGid = event.resource.gid;
    const threadId = this.encodeThreadId({ taskGid });
    const chat = this.chat;
    if (!chat) {
      return;
    }

    this.logger.debug("Asana task added; dispatching", { taskGid, threadId });

    const factory = async (): Promise<Message<AsanaRawMessage>> => {
      const task = await this.client.tasks.get(taskGid);
      const assigneeGid = task.assignee?.gid;
      if (this.botUserId && assigneeGid !== this.botUserId) {
        throw new AsanaIgnoreEventError(
          "Task assignee is not the bot; skipping.",
        );
      }
      this.rememberRecentCommenter(
        threadId,
        task.created_by?.gid ?? task.assignee?.gid,
      );
      return this.taskToDescriptionMessage(task);
    };

    chat.processMessage(this, threadId, wrapFactory(factory, this.logger), options);
  }

  private handleTaskCompleted(
    event: AsanaWebhookEvent,
    options?: WebhookOptions,
  ): void {
    const taskGid = event.resource.gid;
    const threadId = this.encodeThreadId({ taskGid });
    const chat = this.chat;
    if (!chat) {
      return;
    }

    const factory = async (): Promise<Message<AsanaRawMessage>> => {
      const task = await this.client.tasks.get(taskGid);
      if (!task.completed) {
        throw new AsanaIgnoreEventError(
          "Task completion event received but task is not completed.",
        );
      }
      this.rememberRecentCommenter(threadId, event.user?.gid);
      return this.taskToCompletionMessage(task, event);
    };

    chat.processMessage(this, threadId, wrapFactory(factory, this.logger), options);
  }

  private handleStoryAdded(
    event: AsanaWebhookEvent,
    options?: WebhookOptions,
  ): void {
    const storyGid = event.resource.gid;
    const taskGid = event.parent?.gid;
    if (!taskGid) {
      return;
    }
    const threadId = this.encodeThreadId({ taskGid });
    const chat = this.chat;
    if (!chat) {
      return;
    }

    this.logger.debug("Asana story added; dispatching", { storyGid, taskGid, threadId });

    const factory = async (): Promise<Message<AsanaRawMessage>> => {
      const story = await this.client.stories.get(storyGid);
      if (story.type !== "comment") {
        throw new AsanaIgnoreEventError(
          `Story is not a comment (${story.type}); skipping.`,
        );
      }
      if (story.created_by?.gid === this.botUserId) {
        throw new AsanaIgnoreEventError(
          "Story authored by the bot itself; skipping.",
        );
      }
      this.rememberRecentCommenter(threadId, story.created_by?.gid);
      const message = this.storyToMessage(story, taskGid);
      if (this.containsBotMention(story)) {
        message.isMention = true;
      }
      return message;
    };

    chat.processMessage(this, threadId, wrapFactory(factory, this.logger), options);
  }

  parseMessage(raw: AsanaRawMessage): Message<AsanaRawMessage> {
    if (raw.kind === "task_description") {
      const task = raw.payload as TaskForAdapter;
      return this.taskToDescriptionMessage(task);
    }
    if (raw.kind === "task_completed") {
      const task = raw.payload as TaskForAdapter;
      return this.taskToCompletionMessage(task);
    }
    const story = raw.payload as StoryForAdapter;
    return this.storyToMessage(story, raw.taskGid);
  }

  private taskToDescriptionMessage(task: TaskForAdapter): Message<AsanaRawMessage> {
    const threadId = this.encodeThreadId({ taskGid: task.gid });
    const text = task.notes ?? "";
    const creator = task.created_by ?? task.assignee;
    const author = this.authorFromUser(creator, task.gid);

    const message = new Message<AsanaRawMessage>({
      id: task.gid,
      threadId,
      text,
      formatted: this.converter.toAst(text),
      raw: {
        kind: "task_description",
        taskGid: task.gid,
        payload: task,
      },
      author,
      metadata: {
        dateSent: task.created_at ? new Date(task.created_at) : new Date(),
        edited: false,
      },
      attachments: [],
    });
    message.isMention = true;
    return message;
  }

  private taskToCompletionMessage(
    task: TaskForAdapter,
    event?: AsanaWebhookEvent,
  ): Message<AsanaRawMessage> {
    const threadId = this.encodeThreadId({ taskGid: task.gid });
    const completionText = `Task "${task.name}" was marked complete.`;

    const author = this.authorFromEventUser(event) ??
      this.authorFromUser(task.assignee, task.gid);

    const message = new Message<AsanaRawMessage>({
      id: `${task.gid}:completed`,
      threadId,
      text: completionText,
      formatted: this.converter.toAst(completionText),
      raw: {
        kind: "task_completed",
        taskGid: task.gid,
        payload: task,
      },
      author,
      metadata: {
        dateSent: task.completed_at ? new Date(task.completed_at) : new Date(),
        edited: false,
      },
      attachments: [],
    });
    return message;
  }

  private storyToMessage(
    story: StoryForAdapter,
    taskGid: string,
  ): Message<AsanaRawMessage> {
    const threadId = this.encodeThreadId({ taskGid });
    const text = story.text ?? "";
    const author = this.authorFromUser(story.created_by, taskGid);

    return new Message<AsanaRawMessage>({
      id: story.gid,
      threadId,
      text,
      formatted: this.converter.toAst(text),
      raw: {
        kind: "comment",
        taskGid,
        storyGid: story.gid,
        payload: story,
      },
      author,
      metadata: {
        dateSent: story.created_at ? new Date(story.created_at) : new Date(),
        edited: Boolean(story.is_edited),
      },
      attachments: [],
    });
  }

  private authorFromUser(
    user: Pick<AsanaUser, "gid" | "name" | "email"> | null | undefined,
    _taskGid: string,
  ) {
    if (!user) {
      return {
        userId: "asana:unknown",
        userName: "unknown",
        fullName: "Unknown Asana user",
        isBot: "unknown" as const,
        isMe: false,
      };
    }
    return {
      userId: user.gid,
      userName: user.name ?? user.email ?? user.gid,
      fullName: user.name ?? "",
      isBot: user.gid === this.botUserId,
      isMe: user.gid === this.botUserId,
    };
  }

  private authorFromEventUser(event: AsanaWebhookEvent | undefined) {
    if (!event?.user) {
      return null;
    }
    return {
      userId: event.user.gid,
      userName: event.user.gid,
      fullName: "",
      isBot: event.user.gid === this.botUserId,
      isMe: event.user.gid === this.botUserId,
    };
  }

  private containsBotMention(story: StoryForAdapter): boolean {
    if (!this.botUserId) {
      return false;
    }
    if (story.html_text?.includes(`data-asana-gid="${this.botUserId}"`)) {
      return true;
    }
    return false;
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<AsanaRawMessage>> {
    const { taskGid } = this.decodeThreadId(threadId);
    const files = extractFiles(message);
    const card = extractCard(message);

    const rendered = await this.renderAsanaHtml(message, card);
    const htmlText = this.injectRecentMention(threadId, rendered);

    const story = await this.client.stories.createOnTask(
      taskGid,
      htmlText ? { html_text: htmlText } : { text: "" },
    );

    for (const file of files) {
      const buffer = await coerceToBuffer(file.data);
      await this.client.attachments.createOnTask(taskGid, {
        data: buffer,
        filename: file.filename,
        mimeType: file.mimeType,
      });
    }

    return {
      id: story.gid,
      threadId,
      raw: {
        kind: "comment",
        taskGid,
        storyGid: story.gid,
        payload: story,
      },
    };
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<AsanaRawMessage>> {
    const { taskGid } = this.decodeThreadId(threadId);
    const htmlText = await this.renderAsanaHtml(message);
    const story = await this.client.stories.update(messageId, {
      html_text: htmlText ?? "",
    });
    return {
      id: story.gid,
      threadId,
      raw: {
        kind: "comment",
        taskGid,
        storyGid: story.gid,
        payload: story,
      },
    };
  }

  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    await this.client.stories.delete(messageId);
  }

  /**
   * Adds a native Asana emoji reaction to the target story.
   *
   * Uses the `PUT /stories/{story_gid}` endpoint with a `reactions` array
   * of `{ emoji, reacted: true }` objects. The emoji must be a unicode
   * character; we use Chat SDK's {@link EmojiResolver} to normalize
   * `EmojiValue` objects and shortcode strings (e.g. `"thumbs_up"`,
   * `":eyes:"`) to unicode.
   *
   * Emoji reactions on the Asana API are scoped to the authenticated user
   * (the bot). Sending `reacted: true` twice is idempotent.
   */
  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ): Promise<void> {
    this.decodeThreadId(threadId);
    const emojiChar = this.resolveEmojiChar(emoji);
    await this.client.stories.react(messageId, {
      emoji: emojiChar,
      reacted: true,
    });
  }

  /**
   * Removes the bot's native Asana emoji reaction from the target story.
   *
   * Uses `PUT /stories/{story_gid}` with `reactions: [{ emoji, reacted:
   * false }]`. No-op on the server if the bot never reacted with that
   * emoji.
   */
  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ): Promise<void> {
    this.decodeThreadId(threadId);
    const emojiChar = this.resolveEmojiChar(emoji);
    await this.client.stories.react(messageId, {
      emoji: emojiChar,
      reacted: false,
    });
  }

  /**
   * Normalize an {@link EmojiValue} or shortcode string to a unicode
   * character, which is what the Asana reactions API expects. We delegate
   * to Chat SDK's {@link EmojiResolver} via `toGChat`, which returns the
   * unicode form for both well-known and custom emoji; if the input is
   * already a unicode grapheme it is returned as-is.
   */
  private resolveEmojiChar(emoji: EmojiValue | string): string {
    if (typeof emoji === "string") {
      const trimmed = emoji.trim();
      if (!trimmed) {
        throw new ValidationError(ADAPTER_NAME, "Reaction emoji cannot be empty");
      }
      const stripped = trimmed.replace(/^:|:$/g, "");
      return this.emojiResolver.toGChat(stripped);
    }
    return this.emojiResolver.toGChat(emoji);
  }

  renderFormatted(content: FormattedContent): string {
    return this.converter.fromAst(content);
  }

  async fetchMessages(
    threadId: string,
    options?: FetchOptions,
  ): Promise<FetchResult<AsanaRawMessage>> {
    const { taskGid } = this.decodeThreadId(threadId);
    const limit = options?.limit ?? 50;
    const stories = await this.client.stories.listForTask(taskGid, {
      limit,
      offset: options?.cursor,
    });
    const messages = stories.data
      .filter((story) => story.type === "comment")
      .map((story) => this.storyToMessage(story, taskGid));
    return {
      messages,
      nextCursor: stories.nextPage?.offset,
    };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { taskGid } = this.decodeThreadId(threadId);
    const task = await this.client.tasks.get(taskGid);
    return {
      id: threadId,
      channelId: this.channelIdFromThreadId(threadId),
      metadata: {
        taskGid: task.gid,
        name: task.name,
        completed: task.completed,
        permalinkUrl: task.permalink_url,
        workspaceGid: task.workspace.gid,
      },
    };
  }

  async startTyping(_threadId: string): Promise<void> {
    // Asana has no typing indicator; intentionally a no-op.
  }

  async fetchAttachmentsForTask(taskGid: string): Promise<AsanaAttachment[]> {
    const page = await this.client.attachments.listForTask(taskGid);
    return page.data as AsanaAttachment[];
  }

  /**
   * Record the Asana user GID of the latest non-bot sender on a thread.
   * Used by {@link postMessage} to automatically prepend a native Asana
   * `@mention` anchor so bot replies tag the person the bot is replying
   * to, firing the usual Asana notification.
   */
  private rememberRecentCommenter(
    threadId: string,
    userGid: string | undefined,
  ): void {
    if (!userGid) return;
    if (this.botUserId && userGid === this.botUserId) return;
    this.recentCommenter.set(threadId, userGid);
  }

  /**
   * Inject a self-closing Asana mention anchor (`<a data-asana-gid="..."/>`)
   * at the start of the `<body>` of a rendered Asana HTML payload when we
   * know who the bot is replying to and the payload does not already
   * mention them. The self-closing anchor is the documented form that
   * triggers an `@mention` notification and auto-expands to the user's
   * display name on render. See
   * https://developers.asana.com/docs/rich-text#links.
   */
  private injectRecentMention(
    threadId: string,
    htmlText: string | null,
  ): string | null {
    if (!htmlText) return htmlText;
    const userGid = this.recentCommenter.get(threadId);
    if (!userGid) return htmlText;
    if (htmlText.includes(`data-asana-gid="${userGid}"`)) {
      return htmlText;
    }
    const anchor = `<a data-asana-gid="${userGid}"/> `;
    const openingBody = htmlText.indexOf("<body>");
    if (openingBody === -1) {
      return `<body>${anchor}${htmlText}</body>`;
    }
    const insertAt = openingBody + "<body>".length;
    return `${htmlText.slice(0, insertAt)}${anchor}${htmlText.slice(insertAt)}`;
  }

  private async renderAsanaHtml(
    message: AdapterPostableMessage,
    cardOverride?: ReturnType<typeof extractCard>,
  ): Promise<string | null> {
    const card = cardOverride ?? extractCard(message);

    if (typeof message === "string") {
      return this.converter.wrapAsanaHtml(escapeHtmlText(message));
    }

    if (card) {
      return this.renderCardAsHtml(card);
    }

    if (typeof message === "object" && "ast" in message) {
      return this.converter.astToAsanaHtml(message.ast);
    }
    if (typeof message === "object" && "markdown" in message) {
      return this.converter.astToAsanaHtml(
        this.converter.toAst(message.markdown),
      );
    }
    if (typeof message === "object" && "raw" in message) {
      return this.converter.wrapAsanaHtml(String(message.raw ?? ""));
    }

    return null;
  }

  private renderCardAsHtml(card: unknown): string {
    const text =
      typeof card === "object" && card && "toString" in card
        ? String(card)
        : JSON.stringify(card);
    return this.converter.wrapAsanaHtml(escapeHtmlText(text));
  }
}

class AsanaIgnoreEventError extends Error {
  readonly ignoredEvent = true;
  constructor(message: string) {
    super(message);
    this.name = "AsanaIgnoreEventError";
  }
}

const wrapFactory = (
  factory: () => Promise<Message<AsanaRawMessage>>,
  logger: Logger,
): (() => Promise<Message<AsanaRawMessage>>) => {
  return async () => {
    try {
      return await factory();
    } catch (error) {
      if (error instanceof AsanaIgnoreEventError) {
        logger.debug(error.message);
        throw error;
      }
      throw error;
    }
  };
};

const escapeHtmlText = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");

const coerceToBuffer = async (
  data: Buffer | ArrayBuffer | Blob | Uint8Array,
): Promise<Buffer> => {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (data instanceof Uint8Array) {
    return Buffer.from(data);
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
  throw new ValidationError(
    ADAPTER_NAME,
    "Unsupported attachment data type; expected Buffer, ArrayBuffer, Uint8Array, or Blob.",
  );
};

const verifySignature = (secret: string, body: string, signature: string): boolean => {
  const expected = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  if (expected.length !== signature.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
};
