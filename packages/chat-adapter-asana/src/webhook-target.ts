/**
 * Query parameter that names the workspace a webhook delivery belongs to.
 * Asana gives every webhook its own signing secret and a delivery does not
 * say which webhook sent it, so each webhook's target URL carries its
 * workspace GID here and the adapter checks the signature against that
 * workspace's secret.
 */
export const ASANA_WEBHOOK_WORKSPACE_PARAM = "workspace";

/**
 * Target URL for the webhook of one workspace: `baseUrl` with
 * `?workspace=<workspaceGid>` set. {@link reconcileAsanaWebhooks} registers
 * webhooks with this URL, so the request URL the adapter receives must keep
 * its query string.
 */
export const asanaWebhookTarget = (
  baseUrl: string,
  workspaceGid: string,
): string => {
  const url = new URL(baseUrl);
  url.searchParams.set(ASANA_WEBHOOK_WORKSPACE_PARAM, workspaceGid);
  return url.toString();
};

/** The workspace GID in a delivery's URL, or undefined for an unkeyed URL. */
export const workspaceFromWebhookUrl = (url: string): string | undefined =>
  new URL(url).searchParams.get(ASANA_WEBHOOK_WORKSPACE_PARAM) || undefined;
