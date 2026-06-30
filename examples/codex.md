# Codex Setup

Install:

```bash
npm install -g pathmark
```

Register the MCP server:

```bash
codex mcp add pathmark -- pathmark
```

Enable Codex auto-capture hooks:

```bash
pathmark codex install --replace-legacy-hooks
```

Check status:

```bash
pathmark codex status
```

Optional local store override:

```bash
codex mcp add pathmark --env PATHMARK_STORE_DIR=~/.pathmark/memory -- pathmark
```

Use the MCP tools from Codex:

- `remember`
- `search_memory`
- `recall_memory`
- `get_context`
- `create_conclusion`
- `ask_memory`

Use `recall_memory` when you want the visible entry showing exactly which memories were used.
