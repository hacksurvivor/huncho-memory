# Pathmark Memory

One memory for every coding agent on your machine.

Use Codex for a fix, Claude Code for review, opencode for cleanup, and Gemini CLI for a second pass. Pathmark gives each harness the same local context. Decisions, preferences, project notes, and conclusions land in one JSONL store. The next agent can pick them up without a recap.

## Why Pathmark

AI coding agents trap useful context inside their own sessions. You switch tools and spend the first prompt rebuilding history.

Pathmark moves that context into a local MCP server:

- Local JSONL store by default.
- Standard MCP tools instead of a proprietary client.
- Cross-harness memory: every MCP-capable coding agent can read/write the same context.
- Works when the model lives in the MCP client.
- Optional subscription CLI bridge for server-side synthesis.
- Optional OpenAI-compatible API bridge for Kimi, GLM, OpenRouter, local gateways, and other compatible providers.
- Easy to inspect, back up, delete, or migrate.

Pathmark stays provider-neutral. Codex gets one optional synthesis preset. The core server works with any MCP client that can use local tools.

## Cross-Harness Memory

Codex remembers one set of things. Claude Code learns another. opencode starts cold. Pathmark gives them one shared trail.

Point each harness at the same store:

```text
Codex       \
Claude Code \
opencode     >  Pathmark MCP  >  ~/.pathmark/memory/memory.jsonl
Gemini CLI  /
Cursor     /
```

Install Pathmark in each harness and point all of them at the same `PATHMARK_STORE_DIR`. Any tool can save context with `remember` or `create_conclusion`; any other tool can later recover it with `search_memory`, `get_context`, or `ask_memory`.

Pathmark sits below the agents as a memory bus for your coding workflow.

## Tools

Pathmark exposes these MCP tools:

| Tool | Purpose |
| --- | --- |
| `remember` | Save a raw memory item. |
| `create_conclusion` | Save a higher-signal durable conclusion or preference. |
| `search_memory` | Search memories and conclusions. |
| `get_context` | Return compact context for a task or question. |
| `list_conclusions` | List saved conclusions. |
| `delete_memory` | Soft-delete a memory or conclusion by id. |
| `ask_memory` | Return relevant context, or synthesize with `PATHMARK_CHAT_COMMAND` if configured. |
| `chat` | Chat-compatible alias for `ask_memory`; returns the retrieved context so the client can show what was used. |
| `get_config` | Show local store configuration. |

## Quick Start

```bash
npm install -g --install-links=true github:hacksurvivor/pathmark
```

Then add the MCP server to your client.

Install from GitHub today. The `pathmark` npm name remains available for a later npm release.

See [docs/compatibility.md](docs/compatibility.md) for Codex, Claude Code, opencode, Gemini CLI, OpenClaw, Hermes Agent, Grok CLI, Kimi, GLM, and generic MCP setups.

### Codex

```bash
codex mcp add pathmark -- pathmark
```

### Claude Desktop

Add this to your Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "pathmark": {
      "command": "pathmark",
      "env": {
        "PATHMARK_STORE_DIR": "~/.pathmark/memory"
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
    "pathmark": {
      "command": "pathmark"
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
PATHMARK_STORE_DIR=.pathmark npm run dev
```

## Migrate From Honcho

Pathmark can import local `codex-honcho` JSONL memory without deleting or moving the Honcho store.

```bash
npm run import:honcho
```

Defaults:

```text
Honcho source:   ~/.honcho/codex/local
Pathmark target: ~/.pathmark/memory/memory.jsonl
```

The importer creates a `memory.jsonl.backup-*` file before writing, uses deterministic ids so reruns skip duplicates, and redacts obvious `KEY=...`, `TOKEN=...`, `PASSWORD=...`, and `Bearer ...` values.

Use a dry run first when migrating another machine:

```bash
npm run import:honcho -- --dry-run
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PATHMARK_STORE_DIR` | `~/.pathmark/memory` | Directory for `memory.jsonl`. |
| `PATHMARK_MAX_SEARCH_RESULTS` | `12` | Default search limit. |
| `PATHMARK_SYNTHESIS_PROVIDER` | `client` | `client`, `command`, `codex`, or `openai-compatible`. |
| `PATHMARK_CHAT_COMMAND` | unset | Command provider: receives a synthesized prompt on stdin and writes an answer on stdout. |
| `PATHMARK_CODEX_COMMAND` | `codex` | Codex provider command. |
| `PATHMARK_CODEX_MODEL` | unset | Optional Codex model override. |
| `PATHMARK_OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible API base URL. |
| `PATHMARK_OPENAI_API_KEY` | unset | OpenAI-compatible API key. |
| `PATHMARK_OPENAI_MODEL` | unset | Model id for OpenAI-compatible synthesis. |
| `PATHMARK_CHAT_TIMEOUT_MS` | `120000` | Synthesis command timeout. |

## Synthesis Modes

Pathmark separates memory from reasoning.

### `client`

Default. The MCP server returns relevant memory context, and your MCP client model synthesizes the answer. This works across Codex, Claude Desktop, Cursor, and any other MCP client without giving Pathmark a model credential.

```bash
PATHMARK_SYNTHESIS_PROVIDER=client pathmark
```

### `command`

Use any local subscription or model CLI that accepts a prompt on stdin and writes an answer to stdout:

```bash
PATHMARK_SYNTHESIS_PROVIDER=command \
PATHMARK_CHAT_COMMAND="your-ai-cli --model your-model" \
pathmark
```

This is the general path for users with another paid subscription CLI or a local model runner.

### `codex`

Use the proven Codex CLI bridge. It runs a controlled, non-interactive `codex exec` turn with hooks and memories disabled to avoid recursion:

```bash
PATHMARK_SYNTHESIS_PROVIDER=codex \
PATHMARK_CODEX_MODEL=gpt-5.5 \
pathmark
```

This is useful for Codex users who have ChatGPT/Codex subscription auth locally but do not want to add an OpenAI API key.

### `openai-compatible`

Use any provider that exposes `/chat/completions`, including many Kimi, GLM/Z.ai, OpenRouter, LiteLLM, Ollama-compatible gateways, and self-hosted routers:

```bash
PATHMARK_SYNTHESIS_PROVIDER=openai-compatible \
PATHMARK_OPENAI_BASE_URL=https://api.provider.example/v1 \
PATHMARK_OPENAI_API_KEY=... \
PATHMARK_OPENAI_MODEL=... \
pathmark
```

This mode only affects `ask_memory`. Regular MCP tools still store and retrieve local memory without a model provider.

## Data Format

Pathmark stores newline-delimited JSON at:

```text
~/.pathmark/memory/memory.jsonl
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

- Harness installers for Codex, Claude Code, opencode, Gemini CLI, and other MCP clients.
- Optional auto-capture hooks/importers per harness, so useful context can be saved with less prompting.
- Provider presets for common local AI CLIs where stable commands exist.
- Import/export commands for other memory systems.
- Better ranking with optional local embeddings.
- Namespaces for projects, teams, and clients.
- Encrypted store option.
- Hosted sync as an opt-in layer, not a requirement.
- Example recipes for Codex, Claude Desktop, Cursor, ChatGPT, and local LLM tools.

## Positioning

Pathmark gives your agents a shared working memory that stays on your machine.

> Switch agents. Keep the context.

> Bring your own subscription. Keep your memory local.

## License

MIT
