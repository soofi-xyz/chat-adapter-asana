# examples/lambda-http

End-to-end reference app that deploys the Asana webhook handler to AWS Lambda behind an HTTP API and drives the entire flow against a real Asana workspace.

**Not published to npm.** It demonstrates consumer wiring and is excluded from `changesets publish`.

## Prerequisites

- An Asana account and workspace.
- Two Asana personal access tokens (a bot and a test-user/sender).
- AWS credentials; the examples use the `elephant-cursor` profile by default but you can change that.

## Environment

```bash
export AWS_PROFILE=elephant-cursor
export ASANA_PAT=...            # bot PAT
export ASANA_PAT_SENDER=...     # sender PAT (different from ASANA_PAT)
export ASANA_WORKSPACE_GID=...
```

## Deploy

```bash
pnpm install
pnpm --filter @soofi-xyz-examples/chat-adapter-asana-lambda-http run deploy
```

This synthesises and deploys the `AsanaChatAdapterExample` stack, which uses `@soofi-xyz/chat-adapter-asana-cdk` to create the webhook + register it in Asana. The stack outputs:

- `WebhookUrl` — the Lambda HTTP endpoint Asana posts to.
- `WebhookGid` — Asana's GID for the webhook registration.
- `WebhookSecretArn` — Secrets Manager secret storing the HMAC signing key.

## Run the end-to-end test

```bash
pnpm --filter @soofi-xyz-examples/chat-adapter-asana-lambda-http run test:e2e
```

The test:

1. Creates a task as `ASANA_PAT_SENDER` and assigns it to the bot.
2. Waits for the bot Lambda to reply with a `@sender` tag.
3. Posts a follow-up comment as the sender asking for an attachment.
4. Verifies the bot adds an `eyes` reaction story and uploads a `.txt` attachment.

## Destroy

```bash
pnpm --filter @soofi-xyz-examples/chat-adapter-asana-lambda-http run destroy
```

This removes the webhook (via the custom resource `Delete`) and the AWS infrastructure.
