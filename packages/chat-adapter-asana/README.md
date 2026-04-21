# @soofi-xyz/chat-adapter-asana

[npm version](https://www.npmjs.com/package/@soofi-xyz/chat-adapter-asana)
[npm downloads](https://www.npmjs.com/package/@soofi-xyz/chat-adapter-asana)

[Asana](https://asana.com/) adapter for [Chat SDK](https://chat-sdk.dev/docs).

## Installation

```bash
pnpm add chat @soofi-xyz/chat-adapter-asana @chat-adapter/state-memory
```

## Usage

```ts
import { Chat, emoji } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createAsanaAdapter } from "@soofi-xyz/chat-adapter-asana";

const chat = new Chat({
  userName: "my-bot",
  state: createMemoryState(),
  adapters: {
    asana: createAsanaAdapter({
      accessToken: process.env.ASANA_PAT!,
      workspaceGid: process.env.ASANA_WORKSPACE_GID!,
    }),
  },
});

chat.onNewMention(async (thread, _message) => {
  await thread.subscribe();
  await thread.post({ markdown: "Hi! How can I help?" });
});

chat.onSubscribedMessage(async (thread, message) => {
  await thread.post({ markdown: `Got it: "${message.text ?? ""}"` });
});

chat.onReaction([emoji.check], async (event) => {
  if (!event.added) return;
  await event.thread.post({
    markdown: `Acknowledged: task completed by ${event.user.fullName ?? event.user.userName}.`,
  });
});
```

Wire the webhook up to your HTTP framework of choice via `chat.webhooks.asana(request)`. For a production-ready AWS deployment that provisions the HTTP endpoint, secret, and the Asana webhook registration for you, pair this adapter with `[@soofi-xyz/chat-adapter-asana-cdk](https://www.npmjs.com/package/@soofi-xyz/chat-adapter-asana-cdk)`.

## Environment variables

The factory reads these if the matching config fields are not passed explicitly.


| Variable               | Required | Description                                                                                                                                                                                                                   |
| ---------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ASANA_PAT`            | Yes      | Personal access token for the bot account. `ASANA_ACCESS_TOKEN` is accepted as an alias.                                                                                                                                      |
| `ASANA_WORKSPACE_GID`  | Yes      | GID of the Asana workspace the bot lives in.                                                                                                                                                                                  |
| `ASANA_WEBHOOK_SECRET` | No       | Pre-shared webhook signing secret. Only useful when you are *not* using a `WebhookSecretStore`; prefer `SecretsManagerWebhookSecretStore` in production so the secret issued during the handshake is persisted automatically. |


## Configuration

### `createAsanaAdapter(config)`


| Option               | Type                                            | Default                                                     | Description                                                                                           |
| -------------------- | ----------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `accessToken`        | `string`                                        | `process.env.ASANA_PAT` ?? `process.env.ASANA_ACCESS_TOKEN` | Bot personal access token. Required.                                                                  |
| `workspaceGid`       | `string`                                        | `process.env.ASANA_WORKSPACE_GID`                           | Asana workspace GID. Required.                                                                        |
| `webhookSecretStore` | `WebhookSecretStore`                            | `InMemoryWebhookSecretStore`                                | Durable store for the handshake signing secret. Use `SecretsManagerWebhookSecretStore` in production. |
| `webhookSecret`      | `string`                                        | `process.env.ASANA_WEBHOOK_SECRET`                          | Pre-seeded signing secret. Ignored when a `webhookSecretStore` is configured.                         |
| `botUser`            | `{ gid: string; name: string; email?: string }` | fetched from `/users/me` on first use                       | Cached bot identity. Provide it up front to avoid an extra Asana API call at cold start.              |
| `userName`           | `string`                                        | `botUser.name` ?? `"asana-bot"`                             | Display name used for the bot in `@`-mention anchors.                                                 |
| `baseUrl`            | `string`                                        | `"https://app.asana.com/api/1.0"`                           | Override the Asana API base URL (Asana Enterprise domains, tests).                                    |
| `fetch`              | `typeof fetch`                                  | global `fetch`                                              | Custom fetch implementation for tests or edge runtimes.                                               |
| `logger`             | `Logger`                                        | Chat SDK's default logger                                   | Custom `Logger` instance.                                                                             |


### `SecretsManagerWebhookSecretStore(options)`


| Option      | Type                   | Default    | Description                                                                          |
| ----------- | ---------------------- | ---------- | ------------------------------------------------------------------------------------ |
| `secretArn` | `string`               | —          | ARN of the AWS Secrets Manager secret that stores the webhook signing key. Required. |
| `client`    | `SecretsManagerClient` | —          | Pre-configured client from `@aws-sdk/client-secrets-manager`. Required.              |
| `jsonKey`   | `string`               | `"secret"` | Key inside the JSON-encoded `SecretString` that holds the signing key.               |
| `plainText` | `boolean`              | `false`    | Treat the `SecretString` as a raw string instead of JSON.                            |


`@aws-sdk/client-secrets-manager` is an optional peer dependency; install it in your app if you use this store.

## Platform setup

1. **Create the bot account.** Either invite a dedicated service user to your Asana workspace, or decide which existing user will act as the bot. All events this adapter handles (task assignments, comments, reactions, completions) are scoped to the account whose PAT you use.
2. **Generate a Personal Access Token.** Sign in as the bot account, open the [Asana developer console](https://app.asana.com/0/my-apps), click **Create new token**, and copy the value into `ASANA_PAT`. The token is shown only once.
3. **Find the workspace GID.** Open any task in the target workspace — the GID appears as the first numeric segment in the URL (`https://app.asana.com/0/<workspaceGid>/<taskGid>`). You can also list workspaces via `curl -H "Authorization: Bearer $ASANA_PAT" https://app.asana.com/api/1.0/workspaces`. Set it as `ASANA_WORKSPACE_GID`.
4. **Expose an HTTPS endpoint** for webhook delivery (e.g. API Gateway, a Vercel function, Cloudflare Worker, or run the included `[@soofi-xyz/chat-adapter-asana-cdk](https://www.npmjs.com/package/@soofi-xyz/chat-adapter-asana-cdk)` construct which provisions everything and registers the webhook for you).
5. **Register the webhook** against the bot's *My Tasks* user task list so task assignments arrive as events:
  ```bash
   # 1. Resolve the bot's user-task-list GID
   UTL_GID=$(curl -s -H "Authorization: Bearer $ASANA_PAT" \
     "https://app.asana.com/api/1.0/users/me/user_task_list?workspace=$ASANA_WORKSPACE_GID" \
     | jq -r .data.gid)

   # 2. POST /webhooks pointing at your public endpoint
   curl -X POST -H "Authorization: Bearer $ASANA_PAT" \
     -H "Content-Type: application/json" \
     -d "{\"data\":{\"resource\":\"$UTL_GID\",\"target\":\"https://your-domain.com/api/webhooks/asana\"}}" \
     https://app.asana.com/api/1.0/webhooks
  ```
   Asana sends a handshake `POST` with an `X-Hook-Secret` header; the adapter's `AsanaAdapter.handleWebhook` echoes it back and persists it via the configured `WebhookSecretStore`. Subsequent deliveries are verified with HMAC-SHA256 against `X-Hook-Signature`.

## Features

- **Task → thread mapping.** Each Asana task acts as a Chat SDK thread; comments become messages.
- **Standard Chat SDK events.** `chat.onNewMention` fires on task assignment, `chat.onSubscribedMessage` on follow-up comments, `chat.onReaction([emoji.check], …)` on task completion (and reopening).
- **Automatic @-mentions.** Bot replies tag the most recent non-bot commenter by injecting Asana's rich-text anchor (`<a data-asana-gid="..."/>`); no extra code required.
- **Markdown ↔ Asana rich text.** `thread.post({ markdown })` is converted to Asana's `html_text` format.
- **File attachments.** `thread.post({ files: [...] })` uploads each file as an Asana task attachment.
- **Native emoji reactions.** `addReaction` / `removeReaction` use Asana's `reaction_summary` feature (`PUT /stories/{gid}`). Chat SDK `EmojiValue` objects and shortcode strings are normalized to unicode via `EmojiResolver`.
- **Webhook handshake + signature verification.** `X-Hook-Secret` handshake and `X-Hook-Signature` HMAC-SHA256 verification are handled inside `AsanaAdapter.handleWebhook`.
- **Pluggable secret storage.** Ships `InMemoryWebhookSecretStore` (tests/demos) and `SecretsManagerWebhookSecretStore` (AWS). Implement `WebhookSecretStore` for Redis, DynamoDB, SSM, etc.
- **Rate-limit handling.** The REST client honours Asana's `Retry-After` header and retries throttled requests.
- **TypeScript first.** Exports `AsanaAdapterConfig`, `AsanaThreadId`, `AsanaRawMessage`, and `AsanaMessageKind` for use in your own type annotations.

## Sample payloads

See `[sample-messages.md](./sample-messages.md)` for representative Asana webhook payloads used during development and for edge-case debugging.

## License

MIT