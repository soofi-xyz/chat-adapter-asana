import type { AsanaClientConfig } from "../types";

const DEFAULT_BASE_URL = "https://app.asana.com/api/1.0";

type Primitive = string | number | boolean;
type QueryValue = Primitive | undefined;

export type QueryValues = Record<string, QueryValue>;

interface AsanaEnvelope<T> {
  data: T;
  next_page?: AsanaNextPage | null;
}

export interface AsanaErrorItem {
  message: string;
  phrase?: string;
}

export interface AsanaNextPage {
  offset: string;
  path: string;
  uri: string;
}

export interface AsanaPage<T> {
  data: T[];
  nextPage: AsanaNextPage | null;
}

interface AsanaErrorResponse {
  errors?: AsanaErrorItem[];
}

export class AsanaApiError extends Error {
  readonly status: number;
  readonly errors: readonly AsanaErrorItem[];
  readonly retryAfterSeconds: number | null;
  readonly phrase?: string;
  readonly body: unknown;

  constructor(options: {
    status: number;
    errors: AsanaErrorItem[];
    retryAfterSeconds: number | null;
    body: unknown;
  }) {
    const [firstError] = options.errors;
    super(firstError?.message ?? `Asana API request failed with status ${options.status}`);
    this.name = "AsanaApiError";
    this.status = options.status;
    this.errors = options.errors;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.phrase = firstError?.phrase;
    this.body = options.body;
  }
}

export class AsanaTransport {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRateLimitRetries: number;

  constructor(config: AsanaClientConfig) {
    if (!config.accessToken) {
      throw new Error("createAsanaClient requires an access token.");
    }

    const fetchImpl = config.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new Error("No fetch implementation is available. Pass one in AsanaClientConfig.fetch.");
    }

    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.maxRateLimitRetries = config.maxRateLimitRetries ?? 2;
  }

  async get<T>(
    path: string,
    query: QueryValues = {},
    signal?: AbortSignal,
  ): Promise<AsanaEnvelope<T>> {
    let attempt = 0;

    while (true) {
      const response = await this.fetchImpl(this.buildUrl(path, query), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
        },
        signal,
      });

      if (response.status === 429 && attempt < this.maxRateLimitRetries) {
        const retryAfterSeconds = readRetryAfterSeconds(response);
        if (retryAfterSeconds !== null) {
          attempt += 1;
          await sleep(retryAfterSeconds * 1000);
          continue;
        }
      }

      return parseAsanaResponse<T>(response);
    }
  }

  private buildUrl(path: string, query: QueryValues): URL {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) {
        continue;
      }

      url.searchParams.set(key, String(value));
    }

    return url;
  }
}

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const readRetryAfterSeconds = (response: Response): number | null => {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) {
    return null;
  }

  const parsed = Number(retryAfter);
  return Number.isFinite(parsed) ? parsed : null;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseAsanaResponse = async <T>(response: Response): Promise<AsanaEnvelope<T>> => {
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    const errorBody = isPlainObject(body) ? (body as AsanaErrorResponse) : undefined;
    throw new AsanaApiError({
      status: response.status,
      errors: errorBody?.errors ?? [],
      retryAfterSeconds: readRetryAfterSeconds(response),
      body,
    });
  }

  if (!isPlainObject(body) || !("data" in body)) {
    throw new Error("Asana API response did not include a top-level data property.");
  }

  return body as unknown as AsanaEnvelope<T>;
};
