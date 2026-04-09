import express from "express";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ApiClient } from "../client/apiClient";
import { TtlCache } from "../cache";
import { registerAllTools } from "../tools";
import { API_BASE_URL, normalizeApiKey } from "../auth";
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

const MAIN_APP_URL = process.env.STOCKMARKETSCAN_APP_URL || "https://stockmarketscan.com";
const MCP_SERVER_URL = process.env.MCP_PUBLIC_URL || "https://mcp.stockmarketscan.com";

export async function runHttp(port: number): Promise<void> {
  const app = express();
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

  // ── MCP SSE connection ───────────────────────────────────────────
  app.get("/mcp", async (req: Request, res: Response) => {
    // API key is optional — anonymous consumers can connect and use the
    // free-tier tools (list_screeners, get_stock_info, explain_concept,
    // ping). Gated tools return a NEEDS_SUBSCRIPTION error that tells the
    // user to sign up at stockmarketscan.com.
    //
    // Two credential channels are supported:
    //   1. X-API-Key: sms_xxx       (Claude Desktop, Cursor, Continue)
    //   2. Authorization: Bearer sms_xxx  (claude.ai Web via OAuth 2.1)
    // Both carry the same sms_* value — the OAuth token endpoint just
    // hands back the user's existing/newly-created API key.
    const headerKey = req.header("X-API-Key") || req.header("x-api-key");
    const authHeader = req.header("Authorization") || req.header("authorization");
    let bearerKey: string | undefined;
    if (authHeader && /^Bearer\s+/i.test(authHeader)) {
      bearerKey = authHeader.replace(/^Bearer\s+/i, "").trim();
    }
    const rawKey = headerKey || bearerKey;

    let apiKey: string | null;
    try {
      apiKey = normalizeApiKey(rawKey);
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

    const server = new Server(
      {
        name: "stockmarketscan",
        version: "1.0.1",
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
      },
      { capabilities: { tools: {} } },
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
