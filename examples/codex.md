# Codex Setup

Install:

```bash
npm install -g --install-links=true github:hacksurvivor/pathmark
```

Register the MCP server:

```bash
codex mcp add pathmark -- pathmark
```

Enable Codex auto-capture hooks:

```bash
pathmark codex install --replace-honcho
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
- `get_context`
- `create_conclusion`
- `ask_memory`
