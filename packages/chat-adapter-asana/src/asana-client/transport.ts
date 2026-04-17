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
    super(
      firstError?.message ?? `Asana API request failed with status ${options.status}`,
    );
    this.name = "AsanaApiError";
    this.status = options.status;
    this.errors = options.errors;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.phrase = firstError?.phrase;
    this.body = options.body;
  }
}

export type AsanaRequestBody =
  | Record<string, unknown>
  | { __multipart: FormData }
  | undefined;

export interface AsanaRequestOptions {
  query?: QueryValues;
  signal?: AbortSignal;
  body?: AsanaRequestBody;
  headers?: Record<string, string>;
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
      throw new Error(
        "No fetch implementation is available. Pass one in AsanaClientConfig.fetch.",
      );
    }

    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.maxRateLimitRetries = config.maxRateLimitRetries ?? 2;
  }

  get<T>(
    path: string,
    query: QueryValues = {},
    signal?: AbortSignal,
  ): Promise<AsanaEnvelope<T>> {
    return this.request<T>("GET", path, { query, signal });
  }

  post<T>(path: string, options: AsanaRequestOptions = {}): Promise<AsanaEnvelope<T>> {
    return this.request<T>("POST", path, options);
  }

  put<T>(path: string, options: AsanaRequestOptions = {}): Promise<AsanaEnvelope<T>> {
    return this.request<T>("PUT", path, options);
  }

  delete<T = Record<string, never>>(
    path: string,
    options: AsanaRequestOptions = {},
  ): Promise<AsanaEnvelope<T>> {
    return this.request<T>("DELETE", path, options);
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    options: AsanaRequestOptions,
  ): Promise<AsanaEnvelope<T>> {
    let attempt = 0;

    while (true) {
      const { headers, body } = buildRequestBody(options.body);

      const response = await this.fetchImpl(
        this.buildUrl(path, options.query ?? {}),
        {
          method,
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            Accept: "application/json",
            ...headers,
            ...(options.headers ?? {}),
          },
          body,
          signal: options.signal,
        },
      );

      if (response.status === 429 && attempt < this.maxRateLimitRetries) {
        const retryAfterSeconds = readRetryAfterSeconds(response);
        if (retryAfterSeconds !== null) {
          attempt += 1;
          await sleep(retryAfterSeconds * 1000);
          continue;
        }
      }

      return parseAsanaResponse<T>(response, method);
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

const buildRequestBody = (
  body: AsanaRequestBody,
): { headers: Record<string, string>; body: BodyInit | undefined } => {
  if (body === undefined) {
    return { headers: {}, body: undefined };
  }

  if (isMultipart(body)) {
    return { headers: {}, body: body.__multipart };
  }

  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: body }),
  };
};

const isMultipart = (
  body: AsanaRequestBody,
): body is { __multipart: FormData } =>
  typeof body === "object" &&
  body !== null &&
  "__multipart" in body &&
  (body as { __multipart: unknown }).__multipart instanceof FormData;

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

const parseAsanaResponse = async <T>(
  response: Response,
  method: string,
): Promise<AsanaEnvelope<T>> => {
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

  if (method === "DELETE" && body === undefined) {
    return { data: {} as T };
  }

  if (!isPlainObject(body) || !("data" in body)) {
    throw new Error("Asana API response did not include a top-level data property.");
  }

  return body as unknown as AsanaEnvelope<T>;
};
