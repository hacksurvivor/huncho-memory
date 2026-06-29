# Compatibility

Pathmark is a stdio MCP server. It works with any host that can launch a local command and speak Model Context Protocol over stdin/stdout.

## The Core Contract

Install:

```bash
npm install -g github:hacksurvivor/pathmark
```

MCP server command:

```bash
pathmark
```

Recommended env:

```bash
PATHMARK_STORE_DIR=~/.pathmark/memory
PATHMARK_SYNTHESIS_PROVIDER=client
```

With `client`, the MCP host's own model reads the returned memory context and writes the answer. This is the best default for Codex, Claude Code, opencode, Gemini CLI, Hermes Agent, OpenClaw, Grok-compatible clients, Cursor, and Claude Desktop.

## Client Matrix

| Client or model surface | Pathmark integration | Notes |
| --- | --- | --- |
| Codex | stdio MCP server | Use `codex mcp add pathmark -- pathmark`. Optional `codex` synthesis preset. |
| Claude Code | stdio MCP server | Add as a local stdio MCP server. Keep synthesis as `client`. |
| Claude Desktop | stdio MCP server | Use `mcpServers.pathmark.command = "pathmark"`. |
| Cursor | stdio MCP server | Add `pathmark` to Cursor MCP settings. |
| opencode | stdio MCP server | Add Pathmark as a local MCP server command. |
| Gemini CLI | stdio MCP server | Add Pathmark to Gemini CLI MCP server settings. |
| Hermes Agent | stdio MCP server if MCP is enabled | Add Pathmark to the agent's MCP server list; keep memory local in `~/.pathmark`. |
| OpenClaw | stdio MCP server if MCP tools are enabled | Register Pathmark as a local MCP tool server. |
| Grok CLI / Grok Build | stdio MCP server when supported by the harness | If the Grok surface has MCP config, add Pathmark as a stdio server. Otherwise use `command` mode. |
| Kimi models | MCP through a host, or `openai-compatible` / `command` synthesis | Raw models do not host MCP by themselves; the agent harness does. |
| GLM / Z.ai models | MCP through a host, or `openai-compatible` / `command` synthesis | Use an MCP-capable client, API gateway, or local CLI. |
| Local models | MCP through a host, or `command` / `openai-compatible` synthesis | Works with Ollama/LiteLLM/local routers when exposed through CLI or compatible API. |

## Generic MCP Config

Most clients use a shape like this:

```json
{
  "mcpServers": {
    "pathmark": {
      "command": "pathmark",
      "env": {
        "PATHMARK_STORE_DIR": "~/.pathmark/memory",
        "PATHMARK_SYNTHESIS_PROVIDER": "client"
      }
    }
  }
}
```

If a client uses `command` plus `args`, use:

```json
{
  "command": "pathmark",
  "args": [],
  "env": {
    "PATHMARK_STORE_DIR": "~/.pathmark/memory",
    "PATHMARK_SYNTHESIS_PROVIDER": "client"
  }
}
```

## Codex

```bash
codex mcp add pathmark -- pathmark
```

Optional Codex-backed synthesis, useful when the MCP client cannot synthesize but Codex CLI is authenticated locally:

```bash
PATHMARK_SYNTHESIS_PROVIDER=codex
PATHMARK_CODEX_COMMAND=codex
PATHMARK_CODEX_MODEL=gpt-5.5
```

## Claude Code

Use Claude Code's local MCP server flow and point it at:

```bash
pathmark
```

Recommended config:

```json
{
  "mcpServers": {
    "pathmark": {
      "command": "pathmark",
      "env": {
        "PATHMARK_SYNTHESIS_PROVIDER": "client"
      }
    }
  }
}
```

## opencode

Register Pathmark as a local MCP server command:

```json
{
  "mcp": {
    "pathmark": {
      "type": "local",
      "command": ["pathmark"],
      "enabled": true,
      "environment": {
        "PATHMARK_SYNTHESIS_PROVIDER": "client"
      }
    }
  }
}
```

## Gemini CLI

Add Pathmark to Gemini CLI's MCP server settings using the same local stdio shape:

```json
{
  "mcpServers": {
    "pathmark": {
      "command": "pathmark",
      "args": [],
      "env": {
        "PATHMARK_SYNTHESIS_PROVIDER": "client"
      }
    }
  }
}
```

## Hermes Agent / OpenClaw / Grok-Compatible Harnesses

If the harness supports MCP, add Pathmark as a local stdio MCP server:

```json
{
  "name": "pathmark",
  "command": "pathmark",
  "args": [],
  "env": {
    "PATHMARK_STORE_DIR": "~/.pathmark/memory"
  }
}
```

If the harness does not support MCP but has a local CLI, use command synthesis from another MCP client:

```bash
PATHMARK_SYNTHESIS_PROVIDER=command
PATHMARK_CHAT_COMMAND="your-agent-cli chat --model your-model"
```

`PATHMARK_CHAT_COMMAND` receives the memory prompt on stdin and should write the answer to stdout.

## Kimi / GLM / Other OpenAI-Compatible Models

Use an MCP-capable client when possible. If you want Pathmark's `ask_memory` tool to synthesize directly through a compatible model endpoint:

```bash
PATHMARK_SYNTHESIS_PROVIDER=openai-compatible
PATHMARK_OPENAI_BASE_URL=https://api.provider.example/v1
PATHMARK_OPENAI_API_KEY=...
PATHMARK_OPENAI_MODEL=...
```

This is provider-neutral. It calls `POST /chat/completions` and parses `choices[0].message.content`.

## What Pathmark Does Not Assume

- It does not assume Codex.
- It does not assume Claude.
- It does not require a cloud memory account.
- It does not require an API key for normal memory save/search/context tools.
- It does not make raw models "MCP-capable"; the host or harness must provide MCP.
