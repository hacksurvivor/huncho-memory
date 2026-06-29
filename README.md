# Pathmark Memory

One local memory layer across every AI coding agent you use.

Pathmark Memory gives Codex, Claude Code, opencode, Gemini CLI, OpenClaw, Hermes Agent, Grok-compatible clients, Cursor, Claude Desktop, and other MCP-capable tools the same durable local context. Switch harnesses without starting from zero: decisions, preferences, project notes, and saved conclusions live in one inspectable store you own.

## Why this exists

Most agent memory systems are tied to one product, one hosted backend, or one subscription. Pathmark is intentionally small:

- Local JSONL store by default.
- Standard MCP tools instead of a proprietary client.
- Cross-harness memory: every MCP-capable coding agent can read/write the same context.
- Works when the model lives in the MCP client.
- Optional subscription CLI bridge for server-side synthesis.
- Optional OpenAI-compatible API bridge for Kimi, GLM, OpenRouter, local gateways, and other compatible providers.
- Easy to inspect, back up, delete, or migrate.

Pathmark is provider-neutral. Codex is one optional synthesis preset, but the core server works with any MCP client that can use local tools.

## Cross-Harness Memory

Most coding agents learn context inside their own silo. Codex remembers one set of things, Claude Code another, opencode another, and switching tools means paying the context tax again.

Pathmark makes memory a local substrate instead:

```text
Codex ─┐
Claude Code ─┤
opencode ────┤
Gemini CLI ──┼── Pathmark MCP ── ~/.pathmark/memory/memory.jsonl
OpenClaw ────┤
Hermes ──────┤
Cursor ──────┘
```

Install Pathmark in each harness and point all of them at the same `PATHMARK_STORE_DIR`. Any tool can save context with `remember` or `create_conclusion`; any other tool can later recover it with `search_memory`, `get_context`, or `ask_memory`.

That makes Pathmark a memory bus for your AI coding workflow, not another agent runtime.

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
| `get_config` | Show local store configuration. |

## Quick Start

```bash
npm install -g github:hacksurvivor/pathmark
```

Then add the MCP server to your client.

The npm package name `pathmark` is currently available, but this first release is GitHub-only until npm publishing is explicitly done.

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

Pathmark is not trying to be a full agent platform. It is the memory layer: a small MCP server that gives agents a persistent working memory the user owns.

The public hook is simple:

> Switch agents. Keep the context.

Second hook:

> Bring your own subscription. Keep your memory local.

## License

MIT
