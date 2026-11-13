import { ConsoleLogger, type Logger } from "chat";
import { createAsanaClient, type AsanaClient } from "./asana-client/client";
import { AsanaApiError } from "./asana-client/transport";
import {
  PENDING_HANDSHAKE,
  type KeyedWebhookSecretStore,
} from "./webhook-secret-store";
import { asanaWebhookTarget } from "./webhook-target";

/** An Asana webhook filter, passed through to `POST /webhooks`. */
export interface AsanaWebhookFilter {
  resource_type?: string;
  resource_subtype?: string;
  action?: string;
  fields?: string[];
}

export interface ReconcileAsanaWebhooksOptions {
  /**
   * The bot's Asana access token. When it is empty, reconcile does nothing
   * and returns `{ skipped: "missing-access-token" }`, so a scheduled caller
   * can run before the token is configured.
   */
  readonly accessToken: string | null | undefined;
  /**
   * URL the adapter's webhook handler is served at, without the workspace
   * parameter. Each workspace's webhook targets
   * `asanaWebhookTarget(targetUrl, workspaceGid)`.
   */
  readonly targetUrl: string;
  /**
   * The store the adapter's `handleWebhook` uses. Reconcile marks a
   * workspace as pending before it registers that workspace's webhook (the
   * adapter only accepts a handshake for a pending workspace), and lists
   * its keys to find workspaces the bot has left.
   */
  readonly secretStore: KeyedWebhookSecretStore;
  /** Filters for newly created webhooks. Existing webhooks are not compared. */
  readonly filters?: AsanaWebhookFilter[];
  /** Override the Asana API base URL (tests, enterprise domains). */
  readonly baseUrl?: string;
  /** Custom fetch implementation. */
  readonly fetch?: typeof fetch;
  readonly logger?: Logger;
}

/** A webhook reconcile created, deleted, or left in place. */
export interface AsanaWebhookChange {
  workspaceGid: string;
  webhookGid: string;
}

export interface ReconcileAsanaWebhooksResult {
  /** Set when reconcile did nothing. */
  skipped?: "missing-access-token";
  /** The bot's current workspaces, from `GET /users/me`. */
  workspaces: string[];
  created: AsanaWebhookChange[];
  deleted: AsanaWebhookChange[];
  /** Webhooks that were already correct. */
  unchanged: AsanaWebhookChange[];
  /**
   * Workspaces that failed. Reconcile continues with the other workspaces
   * and retries these on its next run.
   */
  errors: Array<{ workspaceGid: string; error: unknown }>;
}

/**
 * Make the bot's webhooks match its workspaces: every workspace the bot
 * belongs to gets exactly one webhook on the bot's My Tasks user task list,
 * targeting `asanaWebhookTarget(targetUrl, workspaceGid)`, and workspaces
 * the bot has left lose theirs.
 *
 * Safe to run repeatedly, such as on a schedule and at install: a workspace
 * whose webhook exists and whose secret is stored is left alone. A workspace
 * with a missing, duplicated, misplaced, or secretless webhook has those
 * webhooks deleted and one new webhook created. Creating a webhook makes
 * Asana call the target URL for the handshake before `POST /webhooks`
 * returns, so the adapter must be serving `targetUrl` with the same secret
 * store while this runs.
 *
 * Throws when the bot's workspaces cannot be read (for example, an invalid
 * token); errors in one workspace are returned in `errors`.
 */
export const reconcileAsanaWebhooks = async (
  options: ReconcileAsanaWebhooksOptions,
): Promise<ReconcileAsanaWebhooksResult> => {
  const result: ReconcileAsanaWebhooksResult = {
    workspaces: [],
    created: [],
    deleted: [],
    unchanged: [],
    errors: [],
  };
  if (!options.accessToken) {
    return { ...result, skipped: "missing-access-token" };
  }

  const logger = options.logger ?? new ConsoleLogger();
  const store = options.secretStore;
  const client = createAsanaClient({
    accessToken: options.accessToken,
    baseUrl: options.baseUrl,
    fetch: options.fetch,
  });

  const me = await client.users.getMe({ select: { workspaces: { name: true } } });
  result.workspaces = me.workspaces.map((workspace) => workspace.gid);

  for (const workspaceGid of result.workspaces) {
    const target = asanaWebhookTarget(options.targetUrl, workspaceGid);
    try {
      const userTaskList = await client.userTaskLists.getForUser("me", {
        workspaceGid,
        select: { name: true },
      });
      const webhooks = await listWebhooksWithTarget(client, workspaceGid, target);
      const secret = await store.get(workspaceGid);
      const [only] = webhooks;
      if (
        webhooks.length === 1 &&
        only.resource?.gid === userTaskList.gid &&
        secret !== null &&
        secret !== PENDING_HANDSHAKE
      ) {
        result.unchanged.push({ workspaceGid, webhookGid: only.gid });
        continue;
      }

      for (const webhook of webhooks) {
        await client.webhooks.delete(webhook.gid);
        result.deleted.push({ workspaceGid, webhookGid: webhook.gid });
      }

      await store.set(PENDING_HANDSHAKE, workspaceGid);
      const created = await client.webhooks.create({
        resource: userTaskList.gid,
        target,
        ...(options.filters ? { filters: options.filters } : {}),
      });
      result.created.push({ workspaceGid, webhookGid: created.gid });
      logger.info("Registered Asana webhook", {
        workspaceGid,
        webhookGid: created.gid,
      });

      const stored = await store.get(workspaceGid);
      if (stored === null || stored === PENDING_HANDSHAKE) {
        throw new Error(
          `Webhook ${created.gid} was created but its handshake secret is not in the secret store. ` +
            "Is the adapter at the target URL using the same store?",
        );
      }
    } catch (error) {
      logger.error("Failed to reconcile Asana webhook", { workspaceGid, error });
      result.errors.push({ workspaceGid, error });
    }
  }

  const current = new Set(result.workspaces);
  for (const workspaceGid of await store.keys()) {
    if (current.has(workspaceGid)) continue;
    const target = asanaWebhookTarget(options.targetUrl, workspaceGid);
    try {
      const webhooks = await listWebhooksWithTarget(client, workspaceGid, target).catch(
        (error: unknown) => {
          // The bot can no longer see this workspace. Its webhook stops
          // delivering; if Asana still calls it, the adapter answers 410
          // (no stored secret) and Asana deletes it.
          if (error instanceof AsanaApiError && [402, 403, 404].includes(error.status)) {
            return [];
          }
          throw error;
        },
      );
      for (const webhook of webhooks) {
        await client.webhooks.delete(webhook.gid);
        result.deleted.push({ workspaceGid, webhookGid: webhook.gid });
      }
      await store.delete(workspaceGid);
      logger.info("Removed Asana webhook for a workspace the bot left", {
        workspaceGid,
      });
    } catch (error) {
      logger.error("Failed to remove Asana webhook", { workspaceGid, error });
      result.errors.push({ workspaceGid, error });
    }
  }

  return result;
};

const listWebhooksWithTarget = async (
  client: AsanaClient,
  workspaceGid: string,
  target: string,
) => {
  const select = { target: true, resource: true } as const;
  const matches: Array<{ gid: string; target: string; resource: { gid: string } }> = [];
  let offset: string | undefined;
  do {
    const page = await client.webhooks.list({
      workspaceGid,
      limit: 100,
      offset,
      select,
    });
    matches.push(...page.data.filter((webhook) => webhook.target === target));
    offset = page.nextPage?.offset;
  } while (offset);
  return matches;
};
