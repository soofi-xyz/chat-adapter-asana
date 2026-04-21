import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  proxyEventToWebRequest,
  webResponseToProxyResult,
} from "@aws-lambda-powertools/event-handler/http";
import { Chat, emoji } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import {
  createAsanaAdapter,
  SecretsManagerWebhookSecretStore,
} from "@soofi/chat-adapter-asana";

const secretsManager = new SecretsManagerClient({});

const resolveAsanaPat = async (): Promise<string> => {
  const inline = process.env.ASANA_PAT ?? process.env.ASANA_ACCESS_TOKEN;
  if (inline) return inline;
  const arn = process.env.ASANA_PAT_SECRET_ARN;
  if (!arn) {
    throw new Error(
      "Asana access token missing. Set ASANA_PAT or ASANA_PAT_SECRET_ARN."
    );
  }
  const response = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: arn })
  );
  if (!response.SecretString) {
    throw new Error("ASANA_PAT_SECRET_ARN secret is empty.");
  }
  try {
    const parsed = JSON.parse(response.SecretString) as {
      accessToken?: string;
    };
    if (parsed.accessToken) return parsed.accessToken;
  } catch {
    /* plain text */
  }
  return response.SecretString;
};

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
};

const asana = createAsanaAdapter({
  accessToken: await resolveAsanaPat(),
  workspaceGid: requireEnv("ASANA_WORKSPACE_GID"),
  webhookSecretStore: new SecretsManagerWebhookSecretStore({
    secretArn: requireEnv("ASANA_WEBHOOK_SECRET_ARN"),
    client: secretsManager,
  }),
});

const chat = new Chat({
  adapters: { asana },
  state: createMemoryState(),
  userName: process.env.ASANA_BOT_USER_NAME ?? "asana-bot",
  logger: "info",
});

chat.onNewMention(async (thread, _message) => {
  await thread.subscribe().catch(() => undefined);
  await thread.post({
    markdown:
      "Hello! Thanks for assigning this task. " +
      "Reply here and mention me to continue the conversation.",
  });
});

chat.onSubscribedMessage(async (thread, message) => {
  await asana.addReaction(thread.id, message.id, emoji.eyes);
  await thread.post({
    markdown: `Got your message: "${message.text ?? ""}"`,
    files: [
      {
        filename: "hello.txt",
        mimeType: "text/plain",
        data: Buffer.from(
          `Hello from @soofi/chat-adapter-asana!\nTime: ${new Date().toISOString()}\n`,
          "utf8"
        ),
      },
    ],
  });
});

chat.onReaction([emoji.check], async (event) => {
  if (!event.added) return;
  const who = event.user.userName;
  await event.thread.post({
    markdown: `Acknowledged: task completed by ${who}.`,
  });
});

export const handler = async (
  event: APIGatewayProxyEventV2,
  _context: Context
): Promise<APIGatewayProxyStructuredResultV2> => {
  const request = proxyEventToWebRequest(event);
  const pending: Array<Promise<unknown>> = [];
  const response = await chat.webhooks.asana(request, {
    waitUntil: (task) => {
      pending.push(
        task.catch((err) => {
          console.error("[handler] pending task failed", err);
        })
      );
    },
  });
  const result = await webResponseToProxyResult(response, "ApiGatewayV2");
  if (pending.length > 0) {
    await Promise.all(pending);
  }
  return result;
};
