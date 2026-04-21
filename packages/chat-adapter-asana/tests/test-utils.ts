import { createHmac } from "node:crypto";
import { Chat } from "chat";
import type {
  ActionEvent,
  Lock,
  Message,
  QueueEntry,
  ReactionEvent,
  StateAdapter,
  Thread,
} from "chat";
import { AsanaAdapter } from "../src/adapter";
import { InMemoryWebhookSecretStore } from "../src/webhook-secret-store";

/**
 * Minimal in-memory {@link StateAdapter} used to drive a real `Chat` instance
 * inside the test suite. Covers subscribe/unsubscribe state, lock lifecycle,
 * key/value + list + queue storage — enough for the Chat SDK's webhook flow.
 *
 * Not intended for production; use `@chat-adapter/state-*` packages instead.
 */
export class InMemoryStateAdapter implements StateAdapter {
  private readonly store = new Map<string, { value: unknown; expiresAt: number | null }>();
  private readonly lists = new Map<string, unknown[]>();
  private readonly queues = new Map<string, QueueEntry[]>();
  private readonly subscriptions = new Set<string>();
  private readonly locks = new Map<string, { token: string; expiresAt: number }>();

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlMs != null ? Date.now() + ttlMs : null,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async setIfNotExists(key: string, value: unknown, ttlMs?: number): Promise<boolean> {
    const existing = await this.get(key);
    if (existing !== null) return false;
    await this.set(key, value, ttlMs);
    return true;
  }

  async appendToList(
    key: string,
    value: unknown,
    options?: { maxLength?: number; ttlMs?: number },
  ): Promise<void> {
    const list = this.lists.get(key) ?? [];
    list.push(value);
    if (options?.maxLength != null && list.length > options.maxLength) {
      list.splice(0, list.length - options.maxLength);
    }
    this.lists.set(key, list);
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    return ((this.lists.get(key) as T[] | undefined) ?? []).slice();
  }

  async enqueue(threadId: string, entry: QueueEntry, maxSize: number): Promise<number> {
    const q = this.queues.get(threadId) ?? [];
    q.push(entry);
    while (q.length > maxSize) q.shift();
    this.queues.set(threadId, q);
    return q.length;
  }

  async dequeue(threadId: string): Promise<QueueEntry | null> {
    const q = this.queues.get(threadId);
    if (!q || q.length === 0) return null;
    return q.shift() ?? null;
  }

  async queueDepth(threadId: string): Promise<number> {
    return this.queues.get(threadId)?.length ?? 0;
  }

  async subscribe(threadId: string): Promise<void> {
    this.subscriptions.add(threadId);
  }

  async unsubscribe(threadId: string): Promise<void> {
    this.subscriptions.delete(threadId);
  }

  async isSubscribed(threadId: string): Promise<boolean> {
    return this.subscriptions.has(threadId);
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
    const now = Date.now();
    const existing = this.locks.get(threadId);
    if (existing && existing.expiresAt > now) return null;
    const token = `${threadId}:${now}:${Math.random().toString(36).slice(2)}`;
    const expiresAt = now + ttlMs;
    this.locks.set(threadId, { token, expiresAt });
    return { threadId, token, expiresAt };
  }

  async releaseLock(lock: Lock): Promise<void> {
    const existing = this.locks.get(lock.threadId);
    if (existing && existing.token === lock.token) {
      this.locks.delete(lock.threadId);
    }
  }

  async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
    const existing = this.locks.get(lock.threadId);
    if (!existing || existing.token !== lock.token) return false;
    existing.expiresAt = Date.now() + ttlMs;
    return true;
  }

  async forceReleaseLock(threadId: string): Promise<void> {
    this.locks.delete(threadId);
  }
}

export const createMemoryState = (): StateAdapter => new InMemoryStateAdapter();

/** The HMAC secret the webhook-secret-store is primed with in tests. */
export const TEST_WEBHOOK_SECRET = "secret";

/** The bot identity used across the test suite. */
export const TEST_BOT_USER = {
  gid: "bot_1",
  name: "asana-bot",
  email: "bot@example.com",
};

interface WaitUntilTracker {
  waitUntil: (task: Promise<unknown>) => void;
  waitForAll: () => Promise<void>;
}

/**
 * Tracks promises passed to `waitUntil` so tests can flush the full webhook
 * → handler pipeline before asserting. Mirrors the pattern documented in
 * `docs/testing-adapters.md`.
 */
export const createWaitUntilTracker = (): WaitUntilTracker => {
  const tasks: Promise<unknown>[] = [];
  return {
    waitUntil: (task) => {
      tasks.push(Promise.resolve(task).catch(() => {}));
    },
    waitForAll: async () => {
      while (tasks.length > 0) {
        const snapshot = tasks.splice(0, tasks.length);
        await Promise.all(snapshot);
      }
    },
  };
};

/**
 * Compute the Asana webhook signature for a given body.
 * Asana signs webhook deliveries with `X-Hook-Signature: HMAC-SHA256(secret, body)`.
 */
export const signAsanaBody = (
  body: string,
  secret: string = TEST_WEBHOOK_SECRET,
): string => createHmac("sha256", secret).update(body).digest("hex");

/** Build a JSON `Response` with the Asana API content type. */
export const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

/** Build a correctly-signed Asana webhook `Request` for arbitrary payloads. */
export const createSignedAsanaRequest = (
  payload: unknown,
  secret: string = TEST_WEBHOOK_SECRET,
): Request => {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return new Request("https://example.com/webhook/asana", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hook-signature": signAsanaBody(body, secret),
    },
    body,
  });
};

export interface AsanaTestHandlers {
  onMention?: (thread: Thread, message: Message) => void | Promise<void>;
  onSubscribed?: (thread: Thread, message: Message) => void | Promise<void>;
  onReaction?: (event: ReactionEvent) => void | Promise<void>;
  onAction?: (event: ActionEvent) => void | Promise<void>;
}

export interface CapturedEvents {
  mentionMessage: Message | null;
  mentionThread: Thread | null;
  followUpMessage: Message | null;
  followUpThread: Thread | null;
  reactions: ReactionEvent[];
  actions: ActionEvent[];
}

export interface AsanaTestContextOptions {
  handlers?: AsanaTestHandlers;
  /** Upstream `fetch` mock used to simulate the Asana API. */
  fetch?: typeof fetch;
  /** Initial webhook secret (defaults to {@link TEST_WEBHOOK_SECRET}). */
  webhookSecret?: string;
}

/**
 * Wire a real `AsanaAdapter` into a real `Chat` with the handlers the tests
 * care about, capturing the last event of each kind so assertions stay terse.
 *
 * Returns a `sendWebhook` helper that signs the payload, invokes the adapter,
 * and flushes any `waitUntil` background work before resolving.
 */
export const createAsanaTestContext = ({
  handlers = {},
  fetch,
  webhookSecret = TEST_WEBHOOK_SECRET,
}: AsanaTestContextOptions = {}) => {
  const adapter = new AsanaAdapter({
    accessToken: "token",
    workspaceGid: "ws_1",
    botUser: TEST_BOT_USER,
    fetch,
    webhookSecretStore: new InMemoryWebhookSecretStore(webhookSecret),
  });

  const state = createMemoryState();
  const chat = new Chat({
    userName: TEST_BOT_USER.name,
    adapters: { asana: adapter },
    state,
    logger: "silent",
  });

  const captured: CapturedEvents = {
    mentionMessage: null,
    mentionThread: null,
    followUpMessage: null,
    followUpThread: null,
    reactions: [],
    actions: [],
  };

  const mentionHandler = handlers.onMention;
  chat.onNewMention(async (thread, message) => {
    captured.mentionMessage = message;
    captured.mentionThread = thread;
    if (mentionHandler) await mentionHandler(thread, message);
  });

  const subscribedHandler = handlers.onSubscribed;
  chat.onSubscribedMessage(async (thread, message) => {
    captured.followUpMessage = message;
    captured.followUpThread = thread;
    if (subscribedHandler) await subscribedHandler(thread, message);
  });

  const reactionHandler = handlers.onReaction;
  chat.onReaction(async (event) => {
    captured.reactions.push(event);
    if (reactionHandler) await reactionHandler(event);
  });

  const actionHandler = handlers.onAction;
  chat.onAction(async (event) => {
    captured.actions.push(event);
    if (actionHandler) await actionHandler(event);
  });

  const sendWebhook = async (payload: unknown): Promise<Response> => {
    const tracker = createWaitUntilTracker();
    const request = createSignedAsanaRequest(payload, webhookSecret);
    const response = await chat.webhooks.asana(request, {
      waitUntil: tracker.waitUntil,
    });
    await tracker.waitForAll();
    return response;
  };

  const sendHandshake = async (secret: string): Promise<Response> =>
    chat.webhooks.asana(
      new Request("https://example.com/webhook/asana", {
        method: "POST",
        headers: { "x-hook-secret": secret },
      }),
    );

  return {
    adapter,
    captured,
    chat,
    sendHandshake,
    sendWebhook,
    state,
  };
};
