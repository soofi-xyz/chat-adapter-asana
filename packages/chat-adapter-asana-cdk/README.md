# @soofi/chat-adapter-asana-cdk

AWS CDK construct that provisions:

1. An HTTP API route that forwards Asana webhook deliveries to a Lambda you provide.
2. A Secrets Manager secret that stores the signing key Asana issues during the handshake. The companion adapter ([`@soofi/chat-adapter-asana`](https://www.npmjs.com/package/@soofi/chat-adapter-asana)) reads and writes this secret via the `ASANA_WEBHOOK_SECRET_ARN` env var.
3. A custom resource that resolves the bot's "My tasks" user-task-list GID and registers the Asana webhook against it. On stack deletion the webhook is deregistered.

## Installation

```bash
pnpm add -D @soofi/chat-adapter-asana-cdk aws-cdk-lib constructs
```

## Usage

```ts
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { AsanaChatWebhook } from "@soofi/chat-adapter-asana-cdk";

const handler = new NodejsFunction(this, "WebhookHandler", {
  entry: "src/handler.ts",
});

new AsanaChatWebhook(this, "AsanaWebhook", {
  handler,
  accessToken: process.env.ASANA_PAT!,
  workspaceGid: process.env.ASANA_WORKSPACE_GID!,
});
```

## Props

| Prop | Type | Description |
| --- | --- | --- |
| `handler` | `aws-cdk-lib/aws-lambda.Function` | Lambda that processes Asana webhook deliveries. Receives `ASANA_WEBHOOK_SECRET_ARN` and is granted read/write to that secret automatically. |
| `accessToken` | `string` | Asana bot PAT. One of `accessToken` / `accessTokenSecret` is required. |
| `accessTokenSecret` | `secretsmanager.ISecret` | Existing Secrets Manager secret storing the bot PAT. Either the raw string or `{ "accessToken": "<PAT>" }`. |
| `workspaceGid` | `string` | Asana workspace GID. |
| `resourceGid` | `string?` | Override the webhook resource GID. By default the construct calls `/users/me/user_task_list?workspace=…` using the bot PAT at deploy time. |
| `webhookPath` | `string?` | HTTP API path. Defaults to `/webhooks/asana`. |

## License

MIT © [soofi.xyz](https://soofi.xyz)
