import type { Message } from "chat";
import type { AsanaRawMessage } from "./types";

/**
 * Type guard that returns true when a Chat SDK message represents an Asana
 * task-completion event (distinct from regular comments and the initial task
 * description). Bots can use this to branch handling inside
 * `chat.onSubscribedMessage`.
 */
export const isAsanaTaskCompletionMessage = (
  message: Message<unknown>,
): message is Message<AsanaRawMessage> => {
  const raw = message.raw as AsanaRawMessage | undefined;
  return Boolean(raw && typeof raw === "object" && raw.kind === "task_completed");
};

/**
 * Type guard for the initial thread-start message carrying the task
 * description.
 */
export const isAsanaTaskDescriptionMessage = (
  message: Message<unknown>,
): message is Message<AsanaRawMessage> => {
  const raw = message.raw as AsanaRawMessage | undefined;
  return Boolean(
    raw && typeof raw === "object" && raw.kind === "task_description",
  );
};

/** Type guard for the regular comment message. */
export const isAsanaCommentMessage = (
  message: Message<unknown>,
): message is Message<AsanaRawMessage> => {
  const raw = message.raw as AsanaRawMessage | undefined;
  return Boolean(raw && typeof raw === "object" && raw.kind === "comment");
};
