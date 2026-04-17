/**
 * Minimal storage interface the adapter uses to persist the HMAC secret that
 * Asana issues during the webhook handshake. Implementations are free to back
 * this with in-memory state, AWS Secrets Manager, SSM, Redis, etc.
 */
export interface WebhookSecretStore {
  /** Return the latest stored secret, or null if no secret has been stored. */
  get(): Promise<string | null>;
  /** Store a new secret. Must be idempotent. */
  set(secret: string): Promise<void>;
}

/** In-memory secret store, suitable for tests and single-process deployments. */
export class InMemoryWebhookSecretStore implements WebhookSecretStore {
  private secret: string | null;

  constructor(initial?: string | null) {
    this.secret = initial ?? null;
  }

  async get(): Promise<string | null> {
    return this.secret;
  }

  async set(secret: string): Promise<void> {
    this.secret = secret;
  }
}
