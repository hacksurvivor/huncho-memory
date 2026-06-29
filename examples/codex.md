# Codex Setup

Install:

```bash
npm install -g github:hacksurvivor/pathmark
```

Register the MCP server:

```bash
codex mcp add pathmark -- pathmark
```

Optional local store override:

```bash
codex mcp add pathmark --env PATHMARK_STORE_DIR=~/.pathmark/memory -- pathmark
```

Use the MCP tools from Codex:

- `remember`
- `search_memory`
- `get_context`
- `create_conclusion`
- `ask_memory`
