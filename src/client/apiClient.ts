import { McpError, subscriptionRequiredError } from "../errors";

export interface ApiClientOptions {
  apiKey: string | null;
  baseUrl: string;
  timeoutMs?: number;
}

/**
 * Thin fetch-based wrapper around /api/v1/*.
 *
 * Each MCP request creates its own ApiClient with the consumer's API key
 * if they provided one. When the consumer did NOT provide a key, the
 * wrapper still issues requests without the X-API-Key header; public
 * endpoints succeed, gated endpoints return 401 which we convert into a
 * user-friendly NEEDS_SUBSCRIPTION error pointing at the signup page.
 */
export class ApiClient {
  private apiKey: string | null;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(opts: ApiClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  get hasApiKey(): boolean {
    return this.apiKey !== null;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined | null>
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    return this.request<T>("GET", url.toString());
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = this.baseUrl + path;
    return this.request<T>("POST", url, body);
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (this.apiKey) headers["X-API-Key"] = this.apiKey;
      if (body != null) headers["Content-Type"] = "application/json";

      const res = await fetch(url, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        await this.throwFromResponse(res);
      }

      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof McpError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new McpError(
          `Request to ${method} ${url} timed out after ${this.timeoutMs}ms`,
          "UPSTREAM_ERROR"
        );
      }
      throw new McpError(
        err instanceof Error ? err.message : String(err),
        "UPSTREAM_ERROR"
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async throwFromResponse(res: Response): Promise<never> {
    let body: { error?: string; code?: string; requestId?: string } = {};
    try {
      body = (await res.json()) as { error?: string; code?: string; requestId?: string };
    } catch {
      // non-JSON error body
    }
    const message = body.error || `HTTP ${res.status} from upstream`;

    if (res.status === 401) {
      // Anonymous consumer tried a gated endpoint — point them at the
      // subscription flow instead of a generic 401.
      if (!this.apiKey) {
        throw subscriptionRequiredError("");
      }
      throw new McpError(
        message,
        body.code === "INVALID_API_KEY" ? "INVALID_API_KEY" : "MISSING_API_KEY",
      );
    }
    if (res.status === 403) {
      // 403 with an API key = the key is valid but the plan doesn't cover
      // this endpoint. Without an API key, treat as subscription-required.
      if (!this.apiKey) {
        throw subscriptionRequiredError("");
      }
      throw new McpError(message, "TIER_UPGRADE_REQUIRED");
    }
    if (res.status === 404) throw new McpError(message, "NOT_FOUND");
    if (res.status === 429) throw new McpError(message, "RATE_LIMIT_EXCEEDED");
    if (res.status >= 500) throw new McpError(message, "UPSTREAM_ERROR");
    throw new McpError(message, "UPSTREAM_ERROR");
  }
}
