import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { Chat, emoji, type Thread, Message } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import {
  createAsanaAdapter,
  SecretsManagerWebhookSecretStore,
  isAsanaCommentMessage,
  isAsanaTaskCompletionMessage,
  isAsanaTaskDescriptionMessage,
} from "@soofi/chat-adapter-asana";

const secretsManager = new SecretsManagerClient({});

const resolveAsanaPat = async (): Promise<string> => {
  const inline = process.env.ASANA_PAT ?? process.env.ASANA_ACCESS_TOKEN;
  if (inline) return inline;
  const arn = process.env.ASANA_PAT_SECRET_ARN;
  if (!arn) {
    throw new Error(
      "Asana access token missing. Set ASANA_PAT or ASANA_PAT_SECRET_ARN.",
    );
  }
  const response = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: arn }),
  );
  if (!response.SecretString) {
    throw new Error("ASANA_PAT_SECRET_ARN secret is empty.");
  }
  try {
    const parsed = JSON.parse(response.SecretString) as { accessToken?: string };
    if (parsed.accessToken) return parsed.accessToken;
  } catch {
    /* plain text */
  }
  return response.SecretString;
};

type AsanaChat = Chat<{ asana: ReturnType<typeof createAsanaAdapter> }>;

let bootstrap: Promise<AsanaChat> | null = null;

const getChat = (): Promise<AsanaChat> => {
  if (bootstrap) return bootstrap;
  bootstrap = (async () => {
    const accessToken = await resolveAsanaPat();
    const workspaceGid = requireEnv("ASANA_WORKSPACE_GID");
    const webhookSecretArn = requireEnv("ASANA_WEBHOOK_SECRET_ARN");

    const asana = createAsanaAdapter({
      accessToken,
      workspaceGid,
      webhookSecretStore: new SecretsManagerWebhookSecretStore({
        secretArn: webhookSecretArn,
        client: secretsManager,
        commands: {
          getSecretValue: (input) => new GetSecretValueCommand(input),
          putSecretValue: (input) => new PutSecretValueCommand(input),
        },
      }),
    });

    const chat = new Chat({
      adapters: { asana },
      state: createMemoryState(),
      userName: process.env.ASANA_BOT_USER_NAME ?? "asana-bot",
      logger: "info",
    });

    chat.onNewMention(async (thread, message) => {
      await handleIncoming(asana, thread, message);
    });
    chat.onSubscribedMessage(async (thread, message) => {
      await handleIncoming(asana, thread, message);
    });

    return chat;
  })();
  return bootstrap;
};

const handleIncoming = async (
  asana: ReturnType<typeof createAsanaAdapter>,
  thread: Thread,
  message: Message,
): Promise<void> => {
  await thread.subscribe().catch(() => undefined);

  if (isAsanaTaskCompletionMessage(message)) {
    await thread.post(
      `Acknowledged: task completed by ${formatAuthor(message)}.`,
    );
    return;
  }

  if (isAsanaTaskDescriptionMessage(message)) {
    await thread.post({
      markdown:
        `Hello ${formatMention(message)}! Thanks for assigning this task. ` +
        "Reply here and mention me to continue the conversation.",
    });
    return;
  }

  if (isAsanaCommentMessage(message)) {
    const lower = (message.text ?? "").toLowerCase();
    if (lower.includes("eye") || lower.includes("attach") || lower.includes("file")) {
      await asana.addReaction(thread.id, message.id, emoji.eyes);
      await thread.post({
        markdown: `Here is the attachment you asked for, ${formatMention(message)}.`,
        files: [
          {
            filename: "hello.txt",
            mimeType: "text/plain",
            data: Buffer.from(
              `Hello from @soofi/chat-adapter-asana!\nTime: ${new Date().toISOString()}\n`,
              "utf8",
            ),
          },
        ],
      });
      return;
    }

    await thread.post(
      `Got your message, ${formatMention(message)}: "${message.text ?? ""}"`,
    );
  }
};

const formatAuthor = (message: Message): string =>
  message.author?.fullName ?? message.author?.userName ?? "someone";

const formatMention = (message: Message): string => {
  const author = message.author;
  if (!author) return "there";
  const gid = author.userId;
  if (gid) {
    return `<a data-asana-gid="${gid}" href="https://app.asana.com/0/0/${gid}">@${author.fullName ?? author.userName ?? gid}</a>`;
  }
  return `@${author.fullName ?? author.userName ?? "there"}`;
};

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
};

export const handler = async (
  event: APIGatewayProxyEventV2,
  _context: Context,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const chat = await getChat();
  const request = toRequest(event);
  const pending: Array<Promise<unknown>> = [];
  const response = await chat.webhooks.asana(request, {
    waitUntil: (task) => {
      pending.push(
        task.catch((err) => {
          console.error("[handler] pending task failed", err);
        }),
      );
    },
  });
  const result = await toApiGatewayResult(response);
  if (pending.length > 0) {
    await Promise.all(pending);
  }
  return result;
};

const toRequest = (event: APIGatewayProxyEventV2): Request => {
  const method = event.requestContext.http.method;
  const host =
    event.headers["host"] ??
    event.headers["Host"] ??
    event.requestContext.domainName;
  const rawPath = event.rawPath || "/";
  const query = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const url = `https://${host}${rawPath}${query}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (typeof value === "string") headers.set(key, value);
  }

  let body: BodyInit | undefined;
  if (event.body && method !== "GET" && method !== "HEAD") {
    body = event.isBase64Encoded
      ? new Uint8Array(Buffer.from(event.body, "base64"))
      : event.body;
  }

  return new Request(url, {
    method,
    headers,
    body,
  });
};

const toApiGatewayResult = async (
  response: Response,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const bodyText = await response.text();
  return {
    statusCode: response.status,
    headers,
    body: bodyText,
  };
};
