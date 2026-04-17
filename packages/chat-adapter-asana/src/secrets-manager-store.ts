import type { WebhookSecretStore } from "./webhook-secret-store";

/**
 * Minimal subset of the AWS SDK v3 Secrets Manager client surface we need.
 * Consumers pass their own client instance, which keeps the adapter bundle
 * free of AWS SDK imports and avoids bundler-size overhead.
 */
export interface SecretsManagerLike {
  send(command: unknown): Promise<unknown>;
}

/**
 * Command factory callbacks. Consumers supply the SDK command constructors
 * so this module does not have to depend on the AWS SDK at runtime.
 */
export interface SecretsManagerCommandFactories {
  getSecretValue: (input: { SecretId: string }) => unknown;
  putSecretValue: (input: {
    SecretId: string;
    SecretString: string;
  }) => unknown;
}

export interface SecretsManagerWebhookSecretStoreOptions {
  readonly secretArn: string;
  readonly client: SecretsManagerLike;
  readonly commands: SecretsManagerCommandFactories;
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
 * signing secret from an AWS Secrets Manager secret. Falls back to treating
 * the secret value as a JSON object `{ "secret": "..." }` unless
 * `plainText: true` is passed.
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
      const command = this.options.commands.getSecretValue({
        SecretId: this.options.secretArn,
      });
      const response = (await this.options.client.send(command)) as {
        SecretString?: string;
      };
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
    const command = this.options.commands.putSecretValue({
      SecretId: this.options.secretArn,
      SecretString: secretString,
    });
    await this.options.client.send(command);
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
