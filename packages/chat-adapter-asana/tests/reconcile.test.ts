import { randomBytes } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { AsanaAdapter } from "../src/adapter";
import { reconcileAsanaWebhooks } from "../src/reconcile";
import { InMemoryWebhookSecretStore } from "../src/webhook-secret-store";
import { asanaWebhookTarget } from "../src/webhook-target";
import { TEST_BOT_USER, jsonResponse, signAsanaBody } from "./test-utils";

const TARGET = "https://api.example.com/enact/channels/asana";
const silent = { debug() {}, info() {}, warn() {}, error() {}, child() { return silent; } };

interface FakeWebhook {
  gid: string;
  workspace: string;
  resource: string;
  target: string;
  secret: string | null;
}

/**
 * A fake Asana API. `POST /webhooks` performs the handshake against
 * `handshakeTo` the way Asana does: it posts `X-Hook-Secret` to the target
 * and creates the webhook only if the target echoes it back.
 */
const fakeAsana = (options: {
  workspaces: string[];
  webhooks?: FakeWebhook[];
  /** Workspaces the bot lost access to: their API calls answer 403. */
  revoked?: string[];
}) => {
  const state = {
    workspaces: [...options.workspaces],
    webhooks: [...(options.webhooks ?? [])],
    revoked: new Set(options.revoked ?? []),
    handshakeTo: null as AsanaAdapter | null,
    writes: [] as string[],
  };
  let nextGid = 100;
  const forbidden = () =>
    jsonResponse({ errors: [{ message: "Forbidden" }] }, { status: 403 });

  const fetchImpl = vi.fn(async (input: URL | RequestInfo | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/1\.0/, "");
    const method = init?.method ?? "GET";

    if (method === "GET" && path === "/users/me") {
      return jsonResponse({
        data: {
          gid: TEST_BOT_USER.gid,
          workspaces: state.workspaces.map((gid) => ({ gid, name: gid })),
        },
      });
    }
    if (method === "GET" && path === "/users/me/user_task_list") {
      const workspace = url.searchParams.get("workspace") ?? "";
      if (!state.workspaces.includes(workspace)) return forbidden();
      return jsonResponse({ data: { gid: `utl_${workspace}`, name: "My Tasks" } });
    }
    if (method === "GET" && path === "/webhooks") {
      const workspace = url.searchParams.get("workspace") ?? "";
      if (state.revoked.has(workspace)) return forbidden();
      return jsonResponse({
        data: state.webhooks
          .filter((webhook) => webhook.workspace === workspace)
          .map(({ gid, target, resource }) => ({
            gid,
            target,
            resource: { gid: resource, resource_type: "user_task_list" },
          })),
        next_page: null,
      });
    }
    if (method === "POST" && path === "/webhooks") {
      const { data } = JSON.parse(String(init?.body)) as {
        data: { resource: string; target: string };
      };
      state.writes.push(`create ${data.target}`);
      const secret = randomBytes(16).toString("hex");
      const handshake = await state.handshakeTo!.handleWebhook(
        new Request(data.target, { method: "POST", headers: { "X-Hook-Secret": secret } }),
      );
      if (handshake.status !== 200 || handshake.headers.get("X-Hook-Secret") !== secret) {
        return jsonResponse(
          { errors: [{ message: "The remote server did not respond with the handshake secret" }] },
          { status: 400 },
        );
      }
      const webhook: FakeWebhook = {
        gid: `wh_${nextGid++}`,
        workspace: data.resource.replace(/^utl_/, ""),
        resource: data.resource,
        target: data.target,
        secret,
      };
      state.webhooks.push(webhook);
      return jsonResponse(
        { data: { gid: webhook.gid, active: true, target: webhook.target } },
        { status: 201 },
      );
    }
    if (method === "DELETE" && path.startsWith("/webhooks/")) {
      const gid = path.slice("/webhooks/".length);
      state.writes.push(`delete ${gid}`);
      state.webhooks = state.webhooks.filter((webhook) => webhook.gid !== gid);
      return jsonResponse({ data: {} });
    }
    throw new Error(`Unexpected Asana call: ${method} ${url}`);
  });

  return { fetch: fetchImpl as unknown as typeof fetch, state };
};

const setup = (asana: ReturnType<typeof fakeAsana>, store = new InMemoryWebhookSecretStore()) => {
  const adapter = new AsanaAdapter({
    accessToken: "token",
    botUser: TEST_BOT_USER,
    fetch: asana.fetch,
    webhookSecretStore: store,
    logger: silent,
  });
  asana.state.handshakeTo = adapter;
  const reconcile = () =>
    reconcileAsanaWebhooks({
      accessToken: "token",
      targetUrl: TARGET,
      secretStore: store,
      fetch: asana.fetch,
      logger: silent,
    });
  return { adapter, store, reconcile };
};

const heartbeat = (adapter: AsanaAdapter, workspace: string, secret: string) => {
  const body = JSON.stringify({ events: [] });
  return adapter.handleWebhook(
    new Request(asanaWebhookTarget(TARGET, workspace), {
      method: "POST",
      headers: { "X-Hook-Signature": signAsanaBody(body, secret) },
      body,
    }),
  );
};

describe("reconcileAsanaWebhooks", () => {
  test("adds, repairs, and removes webhooks so each workspace has exactly one", async () => {
    const asana = fakeAsana({
      workspaces: ["ws_a", "ws_b"],
      revoked: ["ws_gone"],
      webhooks: [
        // ws_b has two webhooks to our target and no stored secret.
        { gid: "wh_b1", workspace: "ws_b", resource: "utl_ws_b", target: asanaWebhookTarget(TARGET, "ws_b"), secret: "x" },
        { gid: "wh_b2", workspace: "ws_b", resource: "utl_ws_b", target: asanaWebhookTarget(TARGET, "ws_b"), secret: "y" },
        // Another integration's webhook in ws_b must be left alone.
        { gid: "wh_other", workspace: "ws_b", resource: "utl_ws_b", target: "https://other.example.com/hook", secret: "z" },
        // The bot left ws_old, but its webhooks there are still listable.
        { gid: "wh_old", workspace: "ws_old", resource: "utl_ws_old", target: asanaWebhookTarget(TARGET, "ws_old"), secret: "o" },
      ],
    });
    const { adapter, store, reconcile } = setup(asana);
    await store.set("s_old", "ws_old");
    await store.set("s_gone", "ws_gone");

    const result = await reconcile();

    expect(result.errors).toEqual([]);
    expect(result.workspaces).toEqual(["ws_a", "ws_b"]);
    expect(result.created.map((c) => c.workspaceGid).sort()).toEqual(["ws_a", "ws_b"]);
    expect(result.deleted.map((d) => d.webhookGid).sort()).toEqual(["wh_b1", "wh_b2", "wh_old"]);
    expect(asana.state.webhooks.map((w) => w.gid).sort()).toEqual(
      ["wh_other", ...result.created.map((c) => c.webhookGid)].sort(),
    );
    expect((await store.keys()).sort()).toEqual(["ws_a", "ws_b"]);

    // The store holds each new webhook's own handshake secret, and the
    // adapter verifies deliveries against it.
    for (const workspace of ["ws_a", "ws_b"]) {
      const webhook = asana.state.webhooks.find(
        (w) => w.target === asanaWebhookTarget(TARGET, workspace),
      )!;
      expect(await store.get(workspace)).toBe(webhook.secret);
      expect((await heartbeat(adapter, workspace, webhook.secret!)).status).toBe(200);
    }
    // A workspace the bot left now answers 410, so Asana drops any webhook
    // reconcile could not delete itself.
    expect((await heartbeat(adapter, "ws_gone", "s_gone")).status).toBe(410);
  });

  test("is a no-op when the webhooks already match", async () => {
    const asana = fakeAsana({ workspaces: ["ws_a", "ws_b"] });
    const { reconcile } = setup(asana);
    const first = await reconcile();
    asana.state.writes = [];

    const second = await reconcile();

    expect(second.created).toEqual([]);
    expect(second.deleted).toEqual([]);
    expect(second.unchanged).toEqual(first.created);
    expect(asana.state.writes).toEqual([]);
  });

  test("removes the webhook when the bot leaves a workspace", async () => {
    const asana = fakeAsana({ workspaces: ["ws_a", "ws_b"] });
    const { adapter, store, reconcile } = setup(asana);
    await reconcile();
    const left = asana.state.webhooks.find((w) => w.workspace === "ws_a")!;
    asana.state.workspaces = ["ws_b"];

    const result = await reconcile();

    expect(result.deleted).toEqual([{ workspaceGid: "ws_a", webhookGid: left.gid }]);
    expect(asana.state.webhooks.map((w) => w.workspace)).toEqual(["ws_b"]);
    expect(await store.keys()).toEqual(["ws_b"]);
    expect((await heartbeat(adapter, "ws_a", left.secret!)).status).toBe(410);
  });

  test("reports a workspace whose handshake did not reach the store and keeps going", async () => {
    const asana = fakeAsana({ workspaces: ["ws_a"] });
    // The adapter at the target URL uses a different store than reconcile,
    // so it rejects the handshake.
    setup(asana);
    const otherStore = new InMemoryWebhookSecretStore();

    const result = await reconcileAsanaWebhooks({
      accessToken: "token",
      targetUrl: TARGET,
      secretStore: otherStore,
      fetch: asana.fetch,
      logger: silent,
    });

    expect(result.created).toEqual([]);
    expect(result.errors.map((e) => e.workspaceGid)).toEqual(["ws_a"]);
    expect(asana.state.webhooks).toEqual([]);
  });

  test("does nothing without an access token", async () => {
    const fetchMock = vi.fn();
    const result = await reconcileAsanaWebhooks({
      accessToken: undefined,
      targetUrl: TARGET,
      secretStore: new InMemoryWebhookSecretStore(),
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(result.skipped).toBe("missing-access-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
