import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  type SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  PENDING_HANDSHAKE,
  type KeyedWebhookSecretStore,
} from "./webhook-secret-store";

export interface SecretsManagerWebhookSecretStoreOptions {
  readonly secretArn: string;
  /** Pre-configured Secrets Manager client from `@aws-sdk/client-secrets-manager`. */
  readonly client: SecretsManagerClient;
  /**
   * Key inside the JSON-encoded SecretString that holds the unkeyed webhook
   * secret.
   *
   * @default "secret"
   */
  readonly jsonKey?: string;
  /**
   * When true the SecretString is treated as a raw string rather than JSON.
   * A plain-text secret holds only the unkeyed secret.
   *
   * @default false
   */
  readonly plainText?: boolean;
  /**
   * How long a write waits before reading the secret back to check that a
   * concurrent writer did not overwrite it. See the class documentation.
   *
   * @default 250
   */
  readonly writeSettleMs?: number;
}

/** Writes give up after this many attempts to make their change stick. */
const MAX_WRITE_ATTEMPTS = 5;

/** JSON property that maps workspace GIDs to their webhook secrets. */
const KEYED_PROPERTY = "workspaces";

type SecretJson = Record<string, unknown> & {
  workspaces?: Record<string, string>;
};

/**
 * WebhookSecretStore implementation that reads and writes Asana webhook
 * signing secrets from one AWS Secrets Manager secret.
 *
 * By default the SecretString is JSON:
 * `{ "secret": "<unkeyed>", "workspaces": { "<workspaceGid>": "<secret>" } }`.
 * The unkeyed secret is read from `jsonKey`; pass `plainText: true` to treat
 * the whole SecretString as the unkeyed secret (keyed secrets then are not
 * supported). One secret holds several hundred workspaces within Secrets
 * Manager's 64 KB limit.
 *
 * Reads are cached for a minute. A lookup that finds no usable secret reads
 * Secrets Manager again, so a secret another Lambda instance just stored is
 * seen at once.
 *
 * Concurrent writers: every workspace lives in one secret and Secrets
 * Manager has no conditional write, so `set` and `delete` are
 * read-modify-write. To narrow the window in which two writers lose each
 * other's update, each write waits `writeSettleMs`, reads the secret back,
 * and applies its change again if it is missing, up to 5 times. That does
 * not make writes atomic: a writer that read before this store's last
 * check can still overwrite it. **Serialize the writers.** Run
 * {@link reconcileAsanaWebhooks} with a concurrency of 1; the adapter's
 * handshake writes then happen only inside reconcile's `POST /webhooks`
 * call, so they are ordered with reconcile's own writes.
 *
 * Requires `@aws-sdk/client-secrets-manager` to be installed in the consumer
 * application (declared as an optional peer dependency of this package).
 *
 * @public
 */
export class SecretsManagerWebhookSecretStore implements KeyedWebhookSecretStore {
  private cached: { raw: string | undefined; at: number } | null = null;

  private readonly ttlMs: number = 60_000;

  constructor(private readonly options: SecretsManagerWebhookSecretStoreOptions) {}

  async get(key?: string): Promise<string | null> {
    const fromCache = this.cachedRaw();
    if (fromCache !== null) {
      const secret = this.extract(fromCache.raw, key);
      if (secret !== null && secret !== PENDING_HANDSHAKE) {
        return secret;
      }
    }
    return this.extract(await this.read(), key);
  }

  async set(secret: string, key?: string): Promise<void> {
    if (this.options.plainText) {
      this.assertUnkeyed(key);
      await this.update(
        (raw) => raw === secret,
        () => secret,
      );
      return;
    }
    await this.update(
      (raw) => this.extract(raw, key) === secret,
      (raw) => {
        const json = this.parse(raw);
        if (key === undefined) {
          json[this.jsonKey] = secret;
        } else {
          json[KEYED_PROPERTY] = { ...json[KEYED_PROPERTY], [key]: secret };
        }
        return JSON.stringify(json);
      },
    );
  }

  async delete(key: string): Promise<void> {
    if (this.options.plainText) return;
    await this.update(
      (raw) => !(key in (this.parse(raw)[KEYED_PROPERTY] ?? {})),
      (raw) => {
        const json = this.parse(raw);
        const { [key]: _removed, ...rest } = json[KEYED_PROPERTY] ?? {};
        json[KEYED_PROPERTY] = rest;
        return JSON.stringify(json);
      },
    );
  }

  /**
   * Read-modify-write that re-applies its change until it reads it back,
   * so a concurrent writer that overwrote it does not silently drop it.
   */
  private async update(
    isApplied: (raw: string | undefined) => boolean,
    apply: (raw: string | undefined) => string,
  ): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const raw = await this.read();
      if (isApplied(raw)) return;
      if (attempt === MAX_WRITE_ATTEMPTS) {
        throw new Error(
          `SecretsManagerWebhookSecretStore: a concurrent writer overwrote this change ${MAX_WRITE_ATTEMPTS} times. Serialize writers to the webhook secret.`,
        );
      }
      await this.write(apply(raw));
      await sleep(this.options.writeSettleMs ?? 250);
    }
  }

  async keys(): Promise<string[]> {
    if (this.options.plainText) return [];
    return Object.keys(this.parse(await this.read())[KEYED_PROPERTY] ?? {});
  }

  private get jsonKey(): string {
    return this.options.jsonKey ?? "secret";
  }

  private cachedRaw(): { raw: string | undefined } | null {
    if (this.cached && Date.now() - this.cached.at < this.ttlMs) {
      return this.cached;
    }
    return null;
  }

  private async read(): Promise<string | undefined> {
    try {
      const response = await this.options.client.send(
        new GetSecretValueCommand({ SecretId: this.options.secretArn }),
      );
      this.cached = { raw: response.SecretString, at: Date.now() };
      return response.SecretString;
    } catch (error) {
      if (isResourceNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async write(secretString: string): Promise<void> {
    await this.options.client.send(
      new PutSecretValueCommand({
        SecretId: this.options.secretArn,
        SecretString: secretString,
      }),
    );
    this.cached = { raw: secretString, at: Date.now() };
  }

  private extract(raw: string | undefined, key: string | undefined): string | null {
    if (!raw) {
      return null;
    }
    if (this.options.plainText) {
      return key === undefined ? raw : null;
    }
    const json = this.parse(raw);
    const value =
      key === undefined ? json[this.jsonKey] : json[KEYED_PROPERTY]?.[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  /** Parse the SecretString; a non-JSON value is the unkeyed secret. */
  private parse(raw: string | undefined): SecretJson {
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as SecretJson;
      }
    } catch {
      /* not JSON */
    }
    return { [this.jsonKey]: raw };
  }

  private assertUnkeyed(key: string | undefined): void {
    if (key !== undefined) {
      throw new Error(
        "SecretsManagerWebhookSecretStore with plainText: true stores only the unkeyed secret.",
      );
    }
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isResourceNotFound = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const err = error as { name?: string; Code?: string };
  return err.name === "ResourceNotFoundException" || err.Code === "ResourceNotFoundException";
};
