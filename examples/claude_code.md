# Claude Code Setup

Install:

```bash
npm install -g --install-links=true github:hacksurvivor/pathmark
```

Register the MCP server:

```bash
claude mcp add pathmark -- pathmark
```

Generate this snippet from the installed CLI:

```bash
pathmark setup claude-code
```

Use the same `PATHMARK_STORE_DIR` as your other harnesses when you want shared memory.
