# @soofi-xyz/chat-adapter-asana

## 0.2.1

### Patch Changes

- Add opt-in `detectMentionsInComments` so comment stories can set `message.isMention`.

  Previously `isMention` was set only on the task-description message, so comments were never
  mentions and `chat.onNewMention` could fire only for a task entering the watched resource.
  When enabled, `storyToMessage` matches the bot's user gid against the `data-asana-gid`
  attribute in `html_text`. Defaults to `false`, so existing behaviour is unchanged.

## 0.2.0

### Patch Changes

- 2421825: Initial public release of the Asana adapter for Chat SDK and its companion AWS CDK construct.

  - `@soofi-xyz/chat-adapter-asana` — Chat SDK adapter that maps Asana tasks to threads, stories to messages, and surfaces task completion as a distinct message type. Supports file attachments, @-mentions of commenters in bot replies, emoji reactions (via a scoped comment), and webhook handshake + HMAC-SHA256 signature verification.
  - `@soofi-xyz/chat-adapter-asana-cdk` — AWS CDK construct that provisions an HTTP API, stores the handshake secret in AWS Secrets Manager, and registers the Asana webhook against the bot's _My Tasks_ user task list.
