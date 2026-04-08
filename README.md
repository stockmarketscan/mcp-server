# StockMarketScan MCP Server

**Stock screeners, chart patterns, options flow, and signals — 18 tools for US equities research, inside your LLM client.**

- **Server URL:** `https://mcp.stockmarketscan.com/mcp`
- **Transport:** HTTP/SSE (Server-Sent Events)
- **Auth:** BYOK — pass your personal `sms_*` API key as the `X-API-Key` header
- **Plan:** Requires a **Basic** or **Pro** plan at [stockmarketscan.com](https://stockmarketscan.com). Options flow tools require the Options Flow add-on.
- **Get your API key:** [stockmarketscan.com/settings](https://stockmarketscan.com/settings)
- **Full install guide & examples:** [stockmarketscan.com/mcp](https://stockmarketscan.com/mcp)

## What you get — 18 tools

| Category | Tools |
|---|---|
| **Screeners (3)** | `list_screeners`, `get_screener_data`, `search_stocks_in_screeners` |
| **Chart Patterns (2)** | `get_chart_patterns`, `search_patterns` |
| **Options Flow (4)** | `get_options_flow_overview`, `get_options_flow_timeline`, `get_options_flow_signals`, `get_unusual_options_activity` |
| **Stock Info (2)** | `get_stock_info`, `get_candles` |
| **Composite (2)** | `get_stock_report`, `search_setups` |
| **Market Context (3)** | `get_market_momentum`, `get_trends`, `get_trend_connections` |
| **Education (1)** | `explain_concept` |

Plus `ping` for liveness checks.

## Install — Claude Desktop

Edit `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "stockmarketscan": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.stockmarketscan.com/mcp"],
      "headers": {
        "X-API-Key": "sms_your_key_here"
      }
    }
  }
}
```

Restart Claude Desktop. You should see **stockmarketscan** in the tool picker.

## Install — Cursor

Settings → Features → Model Context Protocol → Add New MCP Server:

```json
{
  "name": "stockmarketscan",
  "url": "https://mcp.stockmarketscan.com/mcp",
  "headers": {
    "X-API-Key": "sms_your_key_here"
  }
}
```

## Install — Continue (VS Code / JetBrains)

Edit `~/.continue/config.json`:

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "sse",
          "url": "https://mcp.stockmarketscan.com/mcp",
          "headers": {
            "X-API-Key": "sms_your_key_here"
          }
        }
      }
    ]
  }
}
```

## Example prompts

Drop these straight into Claude Desktop or Cursor once the server is connected:

- *"Which stocks appear in both hot-prospects and golden-cross today?"*
- *"Show me AMD's options flow history for the last 30 days."*
- *"Find hot-prospects that are forming a cup and handle pattern."*
- *"Build a full stock report for NVDA — screeners, patterns, options flow, market context."*
- *"What are today's strongest bullish options flow signals?"*
- *"Which contracts traded today at vol/OI > 3 with over $1M premium?"*

## How auth works (BYOK)

The MCP server does not hold its own API key. Each client passes your personal `sms_*` key, the server validates it once per session, and then proxies tool calls to `api/v1/*` on your behalf. You stay in control of rate limits and quota, and you can rotate the key any time in [Settings](https://stockmarketscan.com/settings).

## Rate limits

| Plan | Per Minute | Per Day | Options Flow |
|---|---|---|---|
| Free | — | — | — |
| **Basic** | 15 | 500 | — |
| **Pro** | 30 | 2,000 | ✓ |

## Support

- **Install guide:** [stockmarketscan.com/mcp](https://stockmarketscan.com/mcp)
- **Contact:** contact@stockmarketscan.com

## Running from source

```bash
git clone https://github.com/stockmarketscan/mcp-server.git
cd mcp-server
npm install
STOCKMARKETSCAN_API_KEY=sms_your_key_here npm run dev   # stdio (for Claude Desktop local)
npm run dev:http                                        # HTTP/SSE on :3333
```

### Docker

```bash
docker build -t stockmarketscan-mcp .
docker run -p 3333:3333 -e MCP_TRANSPORT=http stockmarketscan-mcp
```

The container listens on `$PORT` (Railway) or `$MCP_PORT` (local). Point your
MCP client at `http://localhost:3333/mcp` and pass your `X-API-Key` header.
