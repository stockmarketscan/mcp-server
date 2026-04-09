import express from "express";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ApiClient } from "../client/apiClient";
import { TtlCache } from "../cache";
import { registerAllTools } from "../tools";
import { API_BASE_URL, assertValidApiKey } from "../auth";
import { McpError } from "../errors";

/**
 * HTTP/SSE transport for multi-user hosted deployment.
 *
 * Each MCP session is established on GET /mcp with the consumer's
 * X-API-Key header. The key is validated once at connection time and then
 * scoped to this session's Server instance. All tool calls on that session
 * use that key.
 *
 * Sessions are tracked in a Map keyed by the SSE transport session ID;
 * incoming POST /mcp/message requests look up the right transport to
 * forward the body to.
 */

const TRANSPORT_SESSIONS = new Map<string, SSEServerTransport>();

export async function runHttp(port: number): Promise<void> {
  const app = express();
  // Root health check (for Railway)
  app.get("/", (_req, res) => {
    res.json({ service: "stockmarketscan-mcp", status: "ok" });
  });
  app.get("/health", (_req, res) => {
    res.json({ service: "stockmarketscan-mcp", status: "ok", version: "1.0.0" });
  });

  // ── MCP SSE connection ───────────────────────────────────────────
  app.get("/mcp", async (req: Request, res: Response) => {
    // Extract and validate the API key per-connection.
    const rawKey = req.header("X-API-Key") || req.header("x-api-key");
    let apiKey: string;
    try {
      apiKey = assertValidApiKey(rawKey);
    } catch (err) {
      if (err instanceof McpError) {
        res.status(err.code === "MISSING_API_KEY" ? 401 : 400).json(err.toJSON());
        return;
      }
      res.status(500).json({ error: "Auth failure", code: "INTERNAL_ERROR" });
      return;
    }

    const sessionId = randomUUID();
    const transport = new SSEServerTransport(`/mcp/message?sid=${sessionId}`, res);
    TRANSPORT_SESSIONS.set(sessionId, transport);

    const server = new Server(
      { name: "stockmarketscan", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    const ctx = {
      apiClient: new ApiClient({ apiKey, baseUrl: API_BASE_URL }),
      cache: new TtlCache(process.env.MCP_CACHE_ENABLED !== "false"),
    };

    registerAllTools(server, ctx);

    res.on("close", () => {
      TRANSPORT_SESSIONS.delete(sessionId);
      server.close().catch(() => {});
    });

    await server.connect(transport);
  });

  // ── MCP message POST (client → server) ──────────────────────────
  // Note: we run express.json() here so Express validates the payload and
  // enforces a size limit, but then we pass the already-parsed body as the
  // third argument to handlePostMessage. If we skipped that, the MCP SDK
  // would try to re-read the stream and fail with "stream is not readable".
  app.post("/mcp/message", express.json({ limit: "1mb" }), async (req: Request, res: Response) => {
    const sid = (req.query.sid as string) || "";
    const transport = TRANSPORT_SESSIONS.get(sid);
    if (!transport) {
      res.status(404).json({ error: "Unknown session", code: "NOT_FOUND" });
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });

  await new Promise<void>((resolve) => {
    app.listen(port, () => {
      console.log(`[mcp] HTTP transport listening on :${port}`);
      resolve();
    });
  });
}
