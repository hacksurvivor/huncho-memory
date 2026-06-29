# Huncho Memory

Local-first memory for MCP clients, built from the useful part of Honcho without requiring Honcho Cloud.

Huncho Memory gives agent tools a shared, durable memory without requiring a hosted account, a vector database, or an API key. It runs as a standard Model Context Protocol server, so the same local memory can be used from Codex, Claude Desktop, Cursor, ChatGPT-compatible MCP clients, and other tools that can launch stdio MCP servers.

## Why this exists

Most agent memory systems are tied to one product, one hosted backend, or one subscription. Huncho is intentionally small:

- Local JSONL store by default.
- Standard MCP tools instead of a proprietary client.
- Works when the model lives in the MCP client.
- Optional subscription CLI bridge for server-side synthesis.
- Easy to inspect, back up, delete, or migrate.

The first private version was a Codex-Honcho setup: local capture, MCP recall, and a no-API-key `codex exec` bridge that used the user's existing Codex/ChatGPT subscription. This repo generalizes that idea. Codex is one provider preset, but the core is provider-neutral.

## Tools

Huncho exposes these MCP tools:

| Tool | Purpose |
| --- | --- |
| `remember` | Save a raw memory item. |
| `create_conclusion` | Save a higher-signal durable conclusion or preference. |
| `search_memory` | Search memories and conclusions. |
| `get_context` | Return compact context for a task or question. |
| `list_conclusions` | List saved conclusions. |
| `delete_memory` | Soft-delete a memory or conclusion by id. |
| `ask_memory` | Return relevant context, or synthesize with `HUNCHO_CHAT_COMMAND` if configured. |
| `get_config` | Show local store configuration. |

## Quick Start

```bash
npm install -g github:hacksurvivor/huncho-memory
```

Then add the MCP server to your client.

The npm package name `huncho-memory` is currently available, but this first release is GitHub-only until npm publishing is explicitly done.

### Codex

```bash
codex mcp add huncho-memory -- huncho-memory
```

### Claude Desktop

Add this to your Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "huncho-memory": {
      "command": "huncho-memory",
      "env": {
        "HUNCHO_STORE_DIR": "~/.huncho/memory"
      }
    }
  }
}
```

### Cursor

Add the same command to Cursor's MCP server settings:

```json
{
  "mcpServers": {
    "huncho-memory": {
      "command": "huncho-memory"
    }
  }
}
```

## Local Development

```bash
npm install
npm run build
npm run smoke
```

Run directly:

```bash
HUNCHO_STORE_DIR=.huncho npm run dev
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `HUNCHO_STORE_DIR` | `~/.huncho/memory` | Directory for `memory.jsonl`. |
| `HUNCHO_MAX_SEARCH_RESULTS` | `12` | Default search limit. |
| `HUNCHO_SYNTHESIS_PROVIDER` | `client` | `client`, `command`, or `codex`. |
| `HUNCHO_CHAT_COMMAND` | unset | Command provider: receives a synthesized prompt on stdin and writes an answer on stdout. |
| `HUNCHO_CODEX_COMMAND` | `codex` | Codex provider command. |
| `HUNCHO_CODEX_MODEL` | unset | Optional Codex model override. |
| `HUNCHO_CHAT_TIMEOUT_MS` | `120000` | Synthesis command timeout. |

## Synthesis Modes

Huncho separates memory from reasoning.

### `client`

Default. The MCP server returns relevant memory context, and your MCP client model synthesizes the answer. This works across Codex, Claude Desktop, Cursor, and any other MCP client without giving Huncho a model credential.

```bash
HUNCHO_SYNTHESIS_PROVIDER=client huncho-memory
```

### `command`

Use any local subscription or model CLI that accepts a prompt on stdin and writes an answer to stdout:

```bash
HUNCHO_SYNTHESIS_PROVIDER=command \
HUNCHO_CHAT_COMMAND="your-ai-cli --model your-model" \
huncho-memory
```

This is the general path for users with another paid subscription CLI or a local model runner.

### `codex`

Use the proven Codex CLI bridge. It runs a controlled, non-interactive `codex exec` turn with hooks and memories disabled to avoid recursion:

```bash
HUNCHO_SYNTHESIS_PROVIDER=codex \
HUNCHO_CODEX_MODEL=gpt-5.5 \
huncho-memory
```

This is useful for Codex users who have ChatGPT/Codex subscription auth locally but do not want to add an OpenAI API key.

## Data Format

Huncho stores newline-delimited JSON at:

```text
~/.huncho/memory/memory.jsonl
```

Each record is inspectable:

```json
{
  "id": "uuid",
  "kind": "memory",
  "text": "The user prefers local-first tools.",
  "tags": ["preference"],
  "source": "mcp",
  "createdAt": "2026-06-29T00:00:00.000Z",
  "updatedAt": "2026-06-29T00:00:00.000Z"
}
```

Deletes are soft deletes: the record gets a `deletedAt` timestamp.

## Roadmap

- Codex installer for hooks, capture, and nudge behavior.
- Provider presets for common local AI CLIs where stable commands exist.
- Import/export commands for other memory systems.
- Better ranking with optional local embeddings.
- Namespaces for projects, teams, and clients.
- Encrypted store option.
- Hosted sync as an opt-in layer, not a requirement.
- Example recipes for Codex, Claude Desktop, Cursor, ChatGPT, and local LLM tools.

## Positioning

Huncho is not trying to be a full agent platform. It is the memory layer: a small MCP server that gives agents a persistent working memory the user owns.

The public hook is simple:

> Bring your own subscription. Keep your memory local.

## License

MIT
