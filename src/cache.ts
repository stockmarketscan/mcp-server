interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Simple in-memory TTL cache used by MCP tool handlers to absorb LLM
 * hammer-traffic and reduce load on the underlying API.
 *
 * Per-process only — no Redis. If we run multiple MCP instances they won't
 * share cache, which is fine because the backend is the real source of truth.
 */
export class TtlCache {
  private store = new Map<string, Entry<unknown>>();
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  get<T>(key: string): T | undefined {
    if (!this.enabled) return undefined;
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (!this.enabled) return;
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async wrap<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await fn();
    this.set(key, value, ttlMs);
    return value;
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}
