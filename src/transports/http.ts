import express from "express";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ApiClient } from "../client/apiClient";
import { TtlCache } from "../cache";
import { registerAllTools } from "../tools";
import { API_BASE_URL, normalizeApiKey } from "../auth";
import { McpError } from "../errors";

function getServerInfo() {
  return {
    name: "stockmarketscan",
    version: "1.0.2",
    title: "StockMarketScan",
    description:
      "18 tools for US stock screeners, chart patterns, options flow signals and equities research.",
    websiteUrl: "https://stockmarketscan.com/mcp",
    icons: [
      {
        src: "https://stockmarketscan.com/icon.svg",
        mimeType: "image/svg+xml",
        sizes: ["any"],
      },
      {
        src: "https://stockmarketscan.com/favicon.ico",
        mimeType: "image/x-icon",
        sizes: ["16x16", "32x32", "48x48", "64x64"],
      },
    ],
  };
}

function extractApiKey(req: Request): string | null {
  const headerKey = req.header("X-API-Key") || req.header("x-api-key");
  const authHeader = req.header("Authorization") || req.header("authorization");
  let bearerKey: string | undefined;
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    bearerKey = authHeader.replace(/^Bearer\s+/i, "").trim();
  }
  return normalizeApiKey(headerKey || bearerKey);
}

function buildServer(apiKey: string | null): Server {
  const server = new Server(getServerInfo(), { capabilities: { tools: {} } });
  const ctx = {
    apiClient: new ApiClient({ apiKey, baseUrl: API_BASE_URL }),
    cache: new TtlCache(process.env.MCP_CACHE_ENABLED !== "false"),
  };
  registerAllTools(server, ctx);
  return server;
}

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

const MAIN_APP_URL = process.env.STOCKMARKETSCAN_APP_URL || "https://stockmarketscan.com";
const MCP_SERVER_URL = process.env.MCP_PUBLIC_URL || "https://mcp.stockmarketscan.com";

export async function runHttp(port: number): Promise<void> {
  const app = express();

  // ── CORS ─────────────────────────────────────────────────────────
  // Browser-based MCP clients (claude.ai Custom Connectors, web-based
  // MCP inspectors) call /mcp directly from the page. Without CORS the
  // browser blocks the SSE stream and the POST messages with a preflight
  // failure. We allow any origin because our auth is header/bearer based
  // and we don't rely on cookies, so there's no CSRF surface to protect.
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-API-Key, Accept, Cache-Control, Last-Event-ID, MCP-Session-Id, MCP-Protocol-Version",
    );
    res.setHeader(
      "Access-Control-Expose-Headers",
      "MCP-Session-Id, MCP-Protocol-Version",
    );
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Root health check (for Railway)
  app.get("/", (_req, res) => {
    res.json({ service: "stockmarketscan-mcp", status: "ok" });
  });
  app.get("/health", (_req, res) => {
    res.json({ service: "stockmarketscan-mcp", status: "ok", version: "1.0.0" });
  });

  // ── Brand assets ──────────────────────────────────────────────────
  // MCP clients like Claude Code and Claude.ai show a favicon next to
  // the connector name. They look it up by hitting /favicon.ico on the
  // MCP server's own host, which by default 404s. Redirect both common
  // paths to the main site's versioned assets.
  app.get("/favicon.ico", (_req, res) => {
    res.redirect(301, `${MAIN_APP_URL}/favicon.ico`);
  });
  app.get("/icon.svg", (_req, res) => {
    res.redirect(301, `${MAIN_APP_URL}/icon.svg`);
  });
  app.get("/apple-touch-icon.png", (_req, res) => {
    res.redirect(301, `${MAIN_APP_URL}/icon.svg`);
  });

  // ── OAuth 2.1 Discovery (RFC 8414 + MCP 2025-06-18 spec) ──────────
  // Claude.ai and other MCP clients hit these well-known endpoints before
  // they attempt to connect, so they can discover that the server supports
  // OAuth and figure out where to send the user for consent.
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json({
      resource: MCP_SERVER_URL,
      authorization_servers: [MAIN_APP_URL],
      bearer_methods_supported: ["header"],
      resource_documentation: `${MAIN_APP_URL}/mcp`,
    });
  });

  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json({
      issuer: MAIN_APP_URL,
      authorization_endpoint: `${MAIN_APP_URL}/api/oauth/authorize`,
      token_endpoint: `${MAIN_APP_URL}/api/oauth/token`,
      registration_endpoint: `${MAIN_APP_URL}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["read"],
    });
  });

  // ── MCP SSE (legacy transport, 2024-11-05) ───────────────────────
  // Still supported for Claude Desktop, Cursor and Continue which all
  // speak the SSE transport out of the box. New clients should prefer
  // the Streamable HTTP transport below.
  app.get("/mcp", async (req: Request, res: Response) => {
    let apiKey: string | null;
    try {
      apiKey = extractApiKey(req);
    } catch (err) {
      if (err instanceof McpError) {
        res.status(400).json(err.toJSON());
        return;
      }
      res.status(500).json({ error: "Auth failure", code: "INTERNAL_ERROR" });
      return;
    }

    const sessionId = randomUUID();
    const transport = new SSEServerTransport(`/mcp/message?sid=${sessionId}`, res);
    TRANSPORT_SESSIONS.set(sessionId, transport);

    const server = buildServer(apiKey);

    res.on("close", () => {
      TRANSPORT_SESSIONS.delete(sessionId);
      server.close().catch(() => {});
    });

    await server.connect(transport);
  });

  // ── MCP SSE message POST (client → server) ──────────────────────
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

  // ── MCP Streamable HTTP (2025-06-18 transport) ────────────────────
  // Single POST endpoint; each request is self-contained and stateless.
  // This is the transport Claude.ai Connectors and the modern MCP
  // inspector prefer. Stateless mode means we spin up a fresh Server
  // per request — cheap because each session is already isolated and
  // carries its own ApiClient with the consumer's key.
  app.post("/mcp", express.json({ limit: "1mb" }), async (req: Request, res: Response) => {
    let apiKey: string | null;
    try {
      apiKey = extractApiKey(req);
    } catch (err) {
      if (err instanceof McpError) {
        res.status(400).json(err.toJSON());
        return;
      }
      res.status(500).json({ error: "Auth failure", code: "INTERNAL_ERROR" });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    const server = buildServer(apiKey);

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[mcp] streamable-http error:", err);
      if (!res.headersSent) {
        res.status(500).json({
          error: "Internal server error",
          code: "INTERNAL_ERROR",
        });
      }
    }
  });

  await new Promise<void>((resolve) => {
    app.listen(port, () => {
      console.log(`[mcp] HTTP transport listening on :${port}`);
      resolve();
    });
  });
}
