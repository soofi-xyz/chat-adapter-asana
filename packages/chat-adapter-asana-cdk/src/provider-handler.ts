/**
 * Lambda handler invoked by the CDK custom resource to (de)register an Asana
 * webhook during stack create/update/delete. It uses Node's built-in fetch
 * and reads the bot personal access token from AWS Secrets Manager.
 */
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const ASANA_API_BASE = "https://app.asana.com/api/1.0";

interface ResourceProperties {
  ServiceToken: string;
  targetUrl: string;
  workspaceGid: string;
  resourceGid?: string;
  filters?: Array<Record<string, unknown>>;
}

interface CloudFormationEvent {
  RequestType: "Create" | "Update" | "Delete";
  ServiceToken: string;
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  ResourceType: string;
  ResourceProperties: ResourceProperties;
  OldResourceProperties?: ResourceProperties;
  PhysicalResourceId?: string;
}

const secretsClient = new SecretsManagerClient({});

const readAsanaPat = async (): Promise<string> => {
  const secretArn = process.env.ASANA_PAT_SECRET_ARN;
  if (!secretArn) {
    throw new Error("ASANA_PAT_SECRET_ARN env var is not set.");
  }
  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  const raw = response.SecretString;
  if (!raw) {
    throw new Error("Asana PAT secret is empty.");
  }
  try {
    const parsed = JSON.parse(raw) as { accessToken?: string };
    if (parsed.accessToken) {
      return parsed.accessToken;
    }
  } catch {
    /* not JSON, treat as raw token */
  }
  return raw;
};

const asanaRequest = async (
  accessToken: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> => {
  const response = await fetch(`${ASANA_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify({ data: body }) : undefined,
  });
  const text = await response.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    throw new Error(
      `Asana ${method} ${path} failed: ${response.status} ${JSON.stringify(data)}`,
    );
  }
  return { status: response.status, data };
};

const resolveResourceGid = async (
  accessToken: string,
  workspaceGid: string,
  override?: string,
): Promise<string> => {
  if (override) {
    return override;
  }
  const { data } = await asanaRequest(
    accessToken,
    "GET",
    `/users/me/user_task_list?workspace=${encodeURIComponent(workspaceGid)}&opt_fields=gid`,
  );
  const envelope = data as { data?: { gid?: string } };
  if (!envelope.data?.gid) {
    throw new Error("Unable to resolve bot user_task_list gid from Asana.");
  }
  return envelope.data.gid;
};

const createWebhook = async (
  accessToken: string,
  resourceGid: string,
  targetUrl: string,
  filters?: Array<Record<string, unknown>>,
): Promise<string> => {
  const { data } = await asanaRequest(accessToken, "POST", "/webhooks", {
    resource: resourceGid,
    target: targetUrl,
    ...(filters ? { filters } : {}),
  });
  const envelope = data as { data?: { gid?: string } };
  if (!envelope.data?.gid) {
    throw new Error(
      `Asana webhook registration returned unexpected body: ${JSON.stringify(data)}`,
    );
  }
  return envelope.data.gid;
};

const deleteWebhook = async (
  accessToken: string,
  webhookGid: string,
): Promise<void> => {
  const response = await fetch(
    `${ASANA_API_BASE}/webhooks/${encodeURIComponent(webhookGid)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
  );
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(
      `Asana DELETE /webhooks/${webhookGid} failed: ${response.status} ${text}`,
    );
  }
};

export const handler = async (
  event: CloudFormationEvent,
): Promise<{ PhysicalResourceId: string; Data?: Record<string, string> }> => {
  console.log("Asana webhook custom resource event", {
    requestType: event.RequestType,
    physicalResourceId: event.PhysicalResourceId,
  });

  const accessToken = await readAsanaPat();
  const props = event.ResourceProperties;

  if (event.RequestType === "Delete") {
    const existing = event.PhysicalResourceId;
    if (existing && existing.startsWith("asana-webhook-")) {
      const webhookGid = existing.replace(/^asana-webhook-/, "");
      if (webhookGid && webhookGid !== "pending") {
        await deleteWebhook(accessToken, webhookGid);
      }
    }
    return {
      PhysicalResourceId: existing ?? "asana-webhook-deleted",
    };
  }

  if (event.RequestType === "Update" && event.OldResourceProperties) {
    const oldProps = event.OldResourceProperties;
    const changed =
      oldProps.targetUrl !== props.targetUrl ||
      oldProps.workspaceGid !== props.workspaceGid ||
      oldProps.resourceGid !== props.resourceGid;
    if (!changed) {
      return {
        PhysicalResourceId: event.PhysicalResourceId ?? "asana-webhook-noop",
      };
    }
    if (event.PhysicalResourceId && event.PhysicalResourceId.startsWith("asana-webhook-")) {
      const oldGid = event.PhysicalResourceId.replace(/^asana-webhook-/, "");
      if (oldGid && oldGid !== "pending") {
        await deleteWebhook(accessToken, oldGid).catch((err) => {
          console.warn("Failed to delete old webhook on update", err);
        });
      }
    }
  }

  const resourceGid = await resolveResourceGid(
    accessToken,
    props.workspaceGid,
    props.resourceGid,
  );

  const webhookGid = await createWebhook(
    accessToken,
    resourceGid,
    props.targetUrl,
    props.filters,
  );

  return {
    PhysicalResourceId: `asana-webhook-${webhookGid}`,
    Data: {
      WebhookGid: webhookGid,
      ResourceGid: resourceGid,
    },
  };
};
