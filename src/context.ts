import { ApiClient } from "./client/apiClient";
import { TtlCache } from "./cache";

/**
 * Per-session context passed to every tool handler.
 * Holds the authenticated API client and a process-level cache.
 */
export interface McpContext {
  apiClient: ApiClient;
  cache: TtlCache;
}
