import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  type SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { WebhookSecretStore } from "./webhook-secret-store";

export interface SecretsManagerWebhookSecretStoreOptions {
  readonly secretArn: string;
  /** Pre-configured Secrets Manager client from `@aws-sdk/client-secrets-manager`. */
  readonly client: SecretsManagerClient;
  /**
   * Key inside the JSON-encoded SecretString that holds the webhook secret.
   *
   * @default "secret"
   */
  readonly jsonKey?: string;
  /**
   * When true the SecretString is treated as a raw string rather than JSON.
   *
   * @default false
   */
  readonly plainText?: boolean;
}

/**
 * WebhookSecretStore implementation that reads and writes the Asana webhook
 * signing secret from an AWS Secrets Manager secret.
 *
 * By default the SecretString is expected to be JSON of the form
 * `{ "secret": "..." }`. Pass `plainText: true` to treat the SecretString as
 * a raw string, or override `jsonKey` to read from a different JSON property.
 *
 * Requires `@aws-sdk/client-secrets-manager` to be installed in the consumer
 * application (declared as an optional peer dependency of this package).
 *
 * @public
 */
export class SecretsManagerWebhookSecretStore implements WebhookSecretStore {
  private cached: string | null = null;
  private cachedAt = 0;

  private readonly ttlMs: number = 60_000;

  constructor(private readonly options: SecretsManagerWebhookSecretStoreOptions) {}

  async get(): Promise<string | null> {
    if (this.cached !== null && Date.now() - this.cachedAt < this.ttlMs) {
      return this.cached;
    }
    try {
      const response = await this.options.client.send(
        new GetSecretValueCommand({ SecretId: this.options.secretArn }),
      );
      const secret = this.extractSecret(response.SecretString);
      this.cached = secret;
      this.cachedAt = Date.now();
      return secret;
    } catch (error) {
      if (isResourceNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async set(secret: string): Promise<void> {
    const secretString = this.options.plainText
      ? secret
      : JSON.stringify({ [this.options.jsonKey ?? "secret"]: secret });
    await this.options.client.send(
      new PutSecretValueCommand({
        SecretId: this.options.secretArn,
        SecretString: secretString,
      }),
    );
    this.cached = secret;
    this.cachedAt = Date.now();
  }

  private extractSecret(raw: string | undefined): string | null {
    if (!raw) {
      return null;
    }
    if (this.options.plainText) {
      return raw.length > 0 ? raw : null;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const key = this.options.jsonKey ?? "secret";
      const value = parsed[key];
      return typeof value === "string" && value.length > 0 ? value : null;
    } catch {
      return raw.length > 0 ? raw : null;
    }
  }
}

const isResourceNotFound = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const err = error as { name?: string; Code?: string };
  return err.name === "ResourceNotFoundException" || err.Code === "ResourceNotFoundException";
};
