# asana-chat-sdk-adapter

[Asana](https://asana.com/) adapter for the [Chat SDK](https://chat-sdk.dev/) and a companion AWS CDK construct that provisions the webhook endpoint required to receive events. Maintained by [soofi.xyz](https://soofi.xyz).

The repository is a pnpm workspace that publishes two packages to npm and ships an end-to-end example that deploys a real webhook receiver on AWS Lambda.


| Package                                                                  | What it does                                                                                                                                                                                          | npm                                 |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `[@soofi-xyz/chat-adapter-asana](./packages/chat-adapter-asana)`         | Chat SDK `Adapter` for Asana. Tasks become threads, comments become messages, task completion is delivered as a native `chat.onReaction` event, and emoji reactions + file attachments are supported. | `@soofi-xyz/chat-adapter-asana`     |
| `[@soofi-xyz/chat-adapter-asana-cdk](./packages/chat-adapter-asana-cdk)` | AWS CDK construct that wires an HTTP API, a Secrets Manager secret, and a custom resource that registers the Asana webhook on the bot's "My tasks" user task list.                                    | `@soofi-xyz/chat-adapter-asana-cdk` |
| `[examples/lambda-http](./examples/lambda-http)`                         | AWS Lambda + HTTP API reference stack plus an end-to-end test that drives a real Asana workspace. Not published to npm.                                                                               | —                                   |


## Behaviour contract

Asana events map onto the standard Chat SDK handlers so the same listener model used on Slack / GChat / Teams works unchanged:

- **Thread start — `chat.onNewMention`**: fires when a task is assigned to the bot. The first message carries the task description (`raw.kind === "task_description"`).
- **Thread continuation — `chat.onSubscribedMessage`**: fires for every subsequent comment on a task the bot has subscribed to (`raw.kind === "comment"`).
- **Task completion — `chat.onReaction([emoji.check], …)`**: marking the Asana task complete is dispatched as a `:white_check_mark:` reaction on the task-description message. Reopening the task fires the same reaction with `added: false`.

Additional capabilities:

- **Automatic @-mentions**: bot responses automatically tag the person who sent the last message on the thread. The adapter injects a self-closing anchor (`<a data-asana-gid="GID"/>`) at the start of the rendered Asana HTML; Asana auto-expands it into an `@Name` link and fires the native mention notification.
- **Emoji reactions**: `addReaction` / `removeReaction` use Asana's native `reaction_summary` feature via `PUT /stories/{gid}` with a `reactions: [{ emoji, reacted }]` body. Chat SDK `EmojiValue` objects (e.g. `emoji.eyes`, `emoji.thumbs_up`) and shortcode strings are normalized to unicode via `EmojiResolver`. Reactions are scoped to the authenticated bot user.
- **File attachments**: uploaded through `thread.post({ files: [...] })` and translated into Asana attachment uploads on the owning task.
- Webhook handshake (`X-Hook-Secret`) and signature verification (`X-Hook-Signature`, HMAC-SHA256) are handled by `AsanaAdapter.handleWebhook`.

## Quick start

### 1. Install the packages

```bash
pnpm add @soofi-xyz/chat-adapter-asana chat @chat-adapter/state-memory
pnpm add -D @soofi-xyz/chat-adapter-asana-cdk aws-cdk-lib constructs
```

### 2. Build the Chat instance

```ts
import { Chat, emoji } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createAsanaAdapter } from "@soofi-xyz/chat-adapter-asana";

const asana = createAsanaAdapter({
  accessToken: process.env.ASANA_PAT!,
  workspaceGid: process.env.ASANA_WORKSPACE_GID!,
});

const chat = new Chat({
  adapters: { asana },
  state: createMemoryState(),
  userName: "your-bot",
});

chat.onNewMention(async (thread, _message) => {
  await thread.subscribe();
  await thread.post({ markdown: "Hi there!" });
});

chat.onSubscribedMessage(async (thread, message) => {
  await thread.post({ markdown: `Got it: "${message.text ?? ""}"` });
});

chat.onReaction([emoji.check], async (event) => {
  if (!event.added) return;
  await event.thread.post({
    markdown: `Acknowledged: task completed by ${event.user.fullName}.`,
  });
});
```

### 3. Provision the webhook with AWS CDK

```ts
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { AsanaChatWebhook } from "@soofi-xyz/chat-adapter-asana-cdk";

const handler = new NodejsFunction(this, "WebhookHandler", {
  entry: "src/handler.ts",
});

new AsanaChatWebhook(this, "AsanaWebhook", {
  handler,
  accessToken: process.env.ASANA_PAT!,
  workspaceGid: process.env.ASANA_WORKSPACE_GID!,
});
```

The construct:

1. Creates an HTTP API route at `/webhooks/asana` forwarding to `handler`.
2. Creates a Secrets Manager secret that stores the handshake signing key. The adapter reads/writes it via `SecretsManagerWebhookSecretStore`.
3. Invokes a Lambda-backed custom resource that resolves the bot's *My Tasks* user-task-list GID from Asana and registers the webhook against it. On stack deletion the webhook is deregistered.

Pass an existing secret via `accessTokenSecret` instead of `accessToken` if you prefer to keep the PAT out of CloudFormation.

## Development

```bash
pnpm install
pnpm -r --filter "./packages/*" run typecheck
pnpm -r --filter "./packages/*" run test
pnpm -r --filter "./packages/*" run build
```

### End-to-end test

Set up credentials and environment:

```bash
export AWS_PROFILE=elephant-cursor
export ASANA_PAT=...         # bot personal access token
export ASANA_PAT_SENDER=...  # sender PAT (must not equal ASANA_PAT)
export ASANA_WORKSPACE_GID=...
```

Deploy the example and then drive the flow end-to-end against a live Asana workspace:

```bash
pnpm --filter @soofi-xyz-examples/chat-adapter-asana-lambda-http run deploy
pnpm --filter @soofi-xyz-examples/chat-adapter-asana-lambda-http run test:e2e
```

The E2E test creates a task as `ASANA_PAT_SENDER`, assigns it to the bot, then verifies:

1. Bot posts a reply that mentions the sender.
2. Sender posts a follow-up asking for a file.
3. Bot reacts with the `eyes` emoji on the follow-up.
4. Bot uploads a `.txt` attachment on the task.

## Release process

Publishing is driven by [Changesets](https://github.com/changesets/changesets):

```bash
pnpm changeset        # describe the change
pnpm changeset version
pnpm release          # runs `pnpm -r build && changeset publish`
```

GitHub Actions (`.github/workflows/release.yml`) opens a version PR on every push to `main` and publishes both packages to npm when the PR is merged. CI (`.github/workflows/ci.yml`) runs typecheck, unit tests, the package build, and a CDK synth smoke test on every push and pull request.

## License

MIT © soofi.xyz