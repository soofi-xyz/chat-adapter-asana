/**
 * Storage interface the adapter uses to persist the HMAC secret that Asana
 * issues during each webhook handshake. Implementations are free to back
 * this with in-memory state, AWS Secrets Manager, SSM, Redis, etc.
 *
 * Every Asana webhook has its own secret. `key` names the webhook a secret
 * belongs to: the workspace GID carried in the webhook's target URL (see
 * {@link asanaWebhookTarget}). A `key` of `undefined` is the single webhook
 * of a target URL without a workspace parameter, which is how the adapter
 * has always worked; stores that ignore `key` keep working for that case.
 */
export interface WebhookSecretStore {
  /** Return the secret stored for `key`, or null if none is stored. */
  get(key?: string): Promise<string | null>;
  /** Store the secret for `key`. Must be idempotent. */
  set(secret: string, key?: string): Promise<void>;
}

/**
 * A {@link WebhookSecretStore} that can also list and delete keyed secrets.
 * {@link reconcileAsanaWebhooks} needs one to find the workspaces it
 * registered before, so it can clean up after the bot leaves one.
 */
export interface KeyedWebhookSecretStore extends WebhookSecretStore {
  /** Remove the secret stored for `key`. A missing key is not an error. */
  delete(key: string): Promise<void>;
  /** List every key that has a stored value. Excludes the unkeyed secret. */
  keys(): Promise<string[]>;
}

/**
 * Value the reconcile operation stores for a key right before it registers
 * that key's webhook. The adapter accepts an Asana handshake for a keyed
 * target URL only while this marker is stored, so nobody else can plant a
 * secret by posting a handshake to the endpoint. It never matches a real
 * Asana secret, which is hex.
 *
 * @internal
 */
export const PENDING_HANDSHAKE = "pending-handshake";

/** In-memory secret store, suitable for tests and single-process deployments. */
export class InMemoryWebhookSecretStore implements KeyedWebhookSecretStore {
  private secret: string | null;
  private readonly keyed = new Map<string, string>();

  constructor(initial?: string | null) {
    this.secret = initial ?? null;
  }

  async get(key?: string): Promise<string | null> {
    if (key === undefined) return this.secret;
    return this.keyed.get(key) ?? null;
  }

  async set(secret: string, key?: string): Promise<void> {
    if (key === undefined) {
      this.secret = secret;
      return;
    }
    this.keyed.set(key, secret);
  }

  async delete(key: string): Promise<void> {
    this.keyed.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.keyed.keys()];
  }
}
