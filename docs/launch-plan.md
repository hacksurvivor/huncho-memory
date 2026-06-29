# Launch Plan

## Position

Huncho Memory is a local-first MCP memory server for people who use multiple AI coding/chat tools and do not want memory locked inside one subscription or one hosted backend.

Core message:

> Bring your own subscription. Keep your memory local.

## MVP Scope

- MCP stdio server.
- Local JSONL memory store.
- Memory save/search/context tools.
- Durable conclusions.
- Default client-side synthesis.
- Optional command synthesis for any local AI CLI.
- Codex preset based on the proven no-API-key bridge.

## Not MVP

- Hosted sync.
- Team accounts.
- Claims of perfect total recall.
- Proprietary Honcho Cloud dependency.
- Silent use of paid model turns on every prompt.

## GitHub Checklist

- Clear README with one-command install.
- Examples for Codex, Claude Desktop, and Cursor.
- Smoke test that launches the MCP server and calls tools over JSON-RPC.
- MIT license.
- CI running `npm run build` and `npm run smoke`.
- Issue templates for provider adapter requests.

## Audience

- Codex users who want memory across fresh threads without API keys.
- Claude Desktop users who want local memory without a SaaS account.
- Cursor users who want inspectable persistent project memory.
- Local-model users who want the MCP client to reason over a plain local store.

## Launch Posts

Short:

> I built Huncho Memory: a local-first MCP memory server for AI tools. It stores memory in JSONL, works across Codex/Claude/Cursor-style MCP clients, and can synthesize through your existing local AI CLI instead of requiring a new API key. Bring your own subscription, keep your memory local.

Technical:

> The interesting design choice: memory and reasoning are separate. Huncho stores and retrieves local memory over MCP. By default the MCP client model answers from that context. If you want server-side synthesis, you can point it at any CLI command. Codex is a preset, not a dependency.
