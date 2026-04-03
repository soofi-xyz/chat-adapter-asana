export interface AsanaThreadId {
  taskGid: string;
  projectGid: string;
}

export interface AsanaClientConfig {
  accessToken: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  maxRateLimitRetries?: number;
}
