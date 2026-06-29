# Codex Setup

Install:

```bash
npm install -g huncho-memory
```

Register the MCP server:

```bash
codex mcp add huncho-memory -- huncho-memory
```

Optional local store override:

```bash
codex mcp add huncho-memory --env HUNCHO_STORE_DIR=~/.huncho/memory -- huncho-memory
```

Use the MCP tools from Codex:

- `remember`
- `search_memory`
- `get_context`
- `create_conclusion`
- `ask_memory`
