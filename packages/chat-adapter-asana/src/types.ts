import type { Logger } from "chat";

/** Decoded thread ID components for the Asana adapter. */
export interface AsanaThreadId {
  /** The Asana task GID that anchors the thread. */
  taskGid: string;
}

/** Configuration for the raw Asana REST client. */
export interface AsanaClientConfig {
  accessToken: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  maxRateLimitRetries?: number;
}

/** Configuration for the Chat SDK Asana adapter. */
export interface AsanaAdapterConfig {
  /** Personal access token for the bot. */
  accessToken: string;
  /** Asana workspace GID. */
  workspaceGid: string;
  /** Webhook signing secret (returned from Asana during handshake). */
  webhookSecret?: string;
  /** Override base URL for tests or Asana enterprise domains. */
  baseUrl?: string;
  /** Custom fetch implementation (tests / edge runtimes). */
  fetch?: typeof fetch;
  /** Cached bot user info, if known up front. Avoids a /users/me request. */
  botUser?: {
    gid: string;
    name: string;
    email?: string;
  };
  /** Override bot display name used in @-mentions. Defaults to `botUser.name` or "asana-bot". */
  userName?: string;
  /** Logger injected by the Chat instance. */
  logger?: Logger;
}

/**
 * Discriminator placed on `Message.raw` so downstream handlers can distinguish
 * between normal comments, task-start payloads, and task-completion payloads.
 */
export type AsanaMessageKind =
  | "comment"
  | "task_description"
  | "task_completed";

/** The shape stored in `Message.raw` by the adapter. */
export interface AsanaRawMessage {
  kind: AsanaMessageKind;
  taskGid: string;
  /** Story GID for comments / completion; equals task GID for the description. */
  storyGid?: string;
  /** Original Asana payload (task, story, or event) when available. */
  payload?: unknown;
}
