# @soofi-xyz/chat-adapter-asana

## 0.3.0

### Minor Changes

- ca05d60: Serve every workspace the bot belongs to, and register webhooks at runtime.

  - `@soofi-xyz/chat-adapter-asana`: add `reconcileAsanaWebhooks`, which gives each of the bot's workspaces exactly one webhook on its My Tasks list and removes webhooks for workspaces the bot has left. It is safe to run on a schedule, and it skips when no token is set. Each webhook targets `asanaWebhookTarget(url, workspaceGid)` (`?workspace=<gid>`). The adapter verifies a delivery against that workspace's secret, accepts a keyed handshake only while reconcile registers that workspace, and answers 410 for a workspace with no secret. `WebhookSecretStore.get`/`set` take an optional key. The new `KeyedWebhookSecretStore` adds `delete` and `keys`, and both built-in stores implement it. `workspaceGid` is now optional; without it, `message.raw.workspaceGid` carries the workspace. Unkeyed target URLs and a configured `workspaceGid` behave as before.
  - `@soofi-xyz/chat-adapter-asana-cdk`: add `webhookUrl`, to use an existing endpoint instead of creating an HTTP API, and `registerWebhook: false`, to skip the deploy-time custom resource. `workspaceGid` and the access token are required only while registering at deploy time. `httpApi` and `webhookGid` keep their types and throw only when those options turned them off.

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
