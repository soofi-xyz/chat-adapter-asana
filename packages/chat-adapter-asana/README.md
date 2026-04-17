# @soofi/chat-adapter-asana

[Asana](https://asana.com/) adapter for the [Chat SDK](https://chat-sdk.dev/).

- Asana tasks act as threads. When a task is assigned to the bot the adapter emits a message with `raw.kind === "task_description"` seeded with the task description.
- Subsequent comments on that task are delivered as messages. Mentions of the bot are flagged as `isMention`.
- Bot replies automatically `@`-tag the person who sent the last message on the thread. The adapter tracks the most recent non-bot sender per thread and injects a self-closing anchor (`<a data-asana-gid="GID"/>`) at the start of the rendered Asana HTML — the form documented in [Asana's rich-text spec](https://developers.asana.com/docs/rich-text#links) that auto-expands into an `@name` link, adds the user as a follower, and fires the `@mention` notification. No extra code is required; just call `thread.post({ markdown: ... })` and the tag shows up for free. If the rendered HTML already contains an anchor for the same user GID the adapter skips the injection to avoid double-tagging.
- Task completion is surfaced as a distinct message with `raw.kind === "task_completed"`; use the `isAsanaTaskCompletionMessage` helper to detect it.
- Posting a message creates an Asana story. `files` uploads are stored as task attachments. `addReaction`/`removeReaction` use Asana's native emoji reactions via `PUT /stories/{gid}` with a `reactions: [{ emoji, reacted }]` body — the same endpoint Asana documented when it replaced the legacy `likes` feature with `reaction_summary`. Reactions are scoped to the authenticated bot, and `EmojiValue` objects from `chat` (e.g. `emoji.eyes`, `emoji.thumbs_up`) as well as shortcode strings (`"eyes"`, `":thumbs_up:"`) are normalized to unicode via Chat SDK's `EmojiResolver` before being sent.
- Webhook handshake (`X-Hook-Secret`) and HMAC-SHA256 signature verification are handled for you.

## Installation

```bash
pnpm add @soofi/chat-adapter-asana chat @chat-adapter/state-memory
```

## Usage

```ts
import { Chat } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createAsanaAdapter } from "@soofi/chat-adapter-asana";

const asana = createAsanaAdapter({
  accessToken: process.env.ASANA_PAT!,
  workspaceGid: process.env.ASANA_WORKSPACE_GID!,
});

const chat = new Chat({
  adapters: { asana },
  state: createMemoryState(),
  userName: "my-bot",
});

chat.onNewMention(async (thread, _message) => {
  await thread.subscribe();
  await thread.post({ markdown: "Hi! How can I help?" });
});
```

Wire the webhook up to your HTTP framework of choice via `chat.webhooks.asana(request)`.

For production deployments pair this adapter with [`@soofi/chat-adapter-asana-cdk`](https://www.npmjs.com/package/@soofi/chat-adapter-asana-cdk) to provision the HTTP endpoint and the Asana webhook registration in AWS.

### Storing the webhook signing secret

The adapter needs durable storage for the secret Asana issues during the handshake. Out of the box you can use:

- `InMemoryWebhookSecretStore` — tests or single-process demos.
- `SecretsManagerWebhookSecretStore` — reads/writes an AWS Secrets Manager secret.

Both implement the `WebhookSecretStore` interface so you can bring your own (Redis, DynamoDB, SSM…).

```ts
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { SecretsManagerWebhookSecretStore } from "@soofi/chat-adapter-asana";

const client = new SecretsManagerClient({});
const webhookSecretStore = new SecretsManagerWebhookSecretStore({
  secretArn: process.env.ASANA_WEBHOOK_SECRET_ARN!,
  client,
  commands: {
    getSecretValue: (input) => new GetSecretValueCommand(input),
    putSecretValue: (input) => new PutSecretValueCommand(input),
  },
});
```

## License

MIT © [soofi.xyz](https://soofi.xyz)
