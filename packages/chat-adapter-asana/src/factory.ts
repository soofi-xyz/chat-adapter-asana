import { ValidationError } from "@chat-adapter/shared";
import type { Logger } from "chat";
import {
  AsanaAdapter,
  type AsanaAdapterInternalConfig,
} from "./adapter";
import type { AsanaAdapterConfig } from "./types";
import type { WebhookSecretStore } from "./webhook-secret-store";

type FactoryConfig = Partial<AsanaAdapterConfig> & {
  logger?: Logger;
  webhookSecretStore?: WebhookSecretStore;
};

/**
 * Create an AsanaAdapter with optional environment-variable fallbacks:
 *  - `ASANA_PAT` / `ASANA_ACCESS_TOKEN`
 *  - `ASANA_WORKSPACE_GID`
 *  - `ASANA_WEBHOOK_SECRET`
 */
export const createAsanaAdapter = (config: FactoryConfig = {}): AsanaAdapter => {
  const accessToken =
    config.accessToken ??
    process.env.ASANA_PAT ??
    process.env.ASANA_ACCESS_TOKEN;
  const workspaceGid = config.workspaceGid ?? process.env.ASANA_WORKSPACE_GID;
  const webhookSecret = config.webhookSecret ?? process.env.ASANA_WEBHOOK_SECRET;

  if (!accessToken) {
    throw new ValidationError(
      "asana",
      "Asana access token is required. Pass it in config or set ASANA_PAT.",
    );
  }
  if (!workspaceGid) {
    throw new ValidationError(
      "asana",
      "Asana workspace GID is required. Pass it in config or set ASANA_WORKSPACE_GID.",
    );
  }

  const internal: AsanaAdapterInternalConfig = {
    accessToken,
    workspaceGid,
    webhookSecret,
    baseUrl: config.baseUrl,
    fetch: config.fetch,
    botUser: config.botUser,
    userName: config.userName,
    logger: config.logger,
    webhookSecretStore: config.webhookSecretStore,
  };

  return new AsanaAdapter(internal);
};
