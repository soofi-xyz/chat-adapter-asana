---
"@soofi-xyz/chat-adapter-asana": minor
"@soofi-xyz/chat-adapter-asana-cdk": minor
---

Serve every workspace the bot belongs to, and register webhooks at runtime.

- `@soofi-xyz/chat-adapter-asana`: add `reconcileAsanaWebhooks`, which gives each of the bot's workspaces exactly one webhook on its My Tasks list and removes webhooks for workspaces the bot has left. It is safe to run on a schedule, and it skips when no token is set. Each webhook targets `asanaWebhookTarget(url, workspaceGid)` (`?workspace=<gid>`). The adapter verifies a delivery against that workspace's secret, accepts a keyed handshake only while reconcile registers that workspace, and answers 410 for a workspace with no secret. `WebhookSecretStore.get`/`set` take an optional key. The new `KeyedWebhookSecretStore` adds `delete` and `keys`, and both built-in stores implement it. `workspaceGid` is now optional; without it, `message.raw.workspaceGid` carries the workspace. Unkeyed target URLs and a configured `workspaceGid` behave as before.
- `@soofi-xyz/chat-adapter-asana-cdk`: add `webhookUrl`, to use an existing endpoint instead of creating an HTTP API, and `registerWebhook: false`, to skip the deploy-time custom resource. `workspaceGid` and the access token are required only while registering at deploy time. `httpApi` and `webhookGid` keep their types and throw only when those options turned them off.
