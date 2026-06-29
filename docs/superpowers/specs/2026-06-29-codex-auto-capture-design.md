# Pathmark Codex Auto-Capture Design

## Summary

Pathmark should capture Codex session context automatically through a dedicated Codex adapter. The adapter will use Codex hooks to record raw session activity, backfill transcript messages, inject compact memory context at session start, and keep the Pathmark MCP server registered. This replaces the old Honcho runtime behavior while preserving the migrated Honcho store as a rollback source.

The core Pathmark MCP server stays provider-neutral. Codex becomes the first capture adapter, and future adapters for Claude Code, opencode, Gemini CLI, and other harnesses can follow the same adapter boundary.

## Goals

- Capture new Codex sessions automatically into `~/.pathmark/memory/memory.jsonl`.
- Keep hybrid memory: raw audit trail plus higher-signal searchable records.
- Preserve the no-API-key design. Pathmark memory and capture must work locally without `OPENAI_API_KEY`.
- Register and manage Codex hooks safely.
- Detect and remove old Honcho hook commands when requested, without deleting `/Users/mac/.honcho/codex/local`.
- Make `pathmark chat` / MCP `chat` useful by giving it fresh captured context and clear retrieved records.
- Keep the design adapter-based so other coding harnesses can add capture later.

## Non-Goals

- Do not delete the old Honcho local store.
- Do not require hosted sync, a hosted Pathmark service, or an OpenAI API key.
- Do not add semantic embeddings in this first capture release.
- Do not auto-generate long-term conclusions from every session yet. The first release captures raw and structured records; summarization can be added after capture is reliable.
- Do not capture full shell output, secrets, private keys, wallet data, or live trading instructions as trusted facts.

## Current State

Pathmark currently provides:

- A local JSONL store.
- MCP tools: `remember`, `create_conclusion`, `search_memory`, `get_context`, `list_conclusions`, `delete_memory`, `ask_memory`, `chat`, and `get_config`.
- Optional synthesis through `client`, `command`, `codex`, or `openai-compatible`.
- A Honcho importer that migrated the existing Honcho local store into Pathmark.

The current gap is automatic capture. Pathmark can search and answer from memory, but new Codex sessions are not written into Pathmark unless an agent explicitly calls a memory tool.

The local Codex setup also still has Honcho hooks in `~/.codex/hooks.json`. Removing Honcho from the MCP list did not remove those hooks. Pathmark must manage hooks explicitly to avoid half-migrated setups.

## Architecture

Add a Codex adapter layer beside the core MCP server.

The core server remains responsible for:

- Store reads and writes.
- MCP tool registration.
- Search and chat behavior.
- Import/export operations.

The Codex adapter is responsible for:

- Installing and uninstalling Codex hooks.
- Registering the Pathmark MCP server in Codex.
- Capturing hook events.
- Parsing Codex transcript files.
- Maintaining capture cursors.
- Injecting compact Pathmark context into Codex sessions.

### CLI Surface

Add these commands:

```bash
pathmark codex install
pathmark codex install --replace-honcho
pathmark codex uninstall
pathmark codex status
pathmark codex recall
pathmark codex prompt
pathmark codex observe
pathmark codex writeback
```

`install`, `uninstall`, and `status` are user-facing commands. `install --replace-honcho` removes Honcho hook commands from Codex while preserving the old Honcho local store.

`recall`, `prompt`, `observe`, and `writeback` are hook commands called by Codex.

## Hook Integration

`pathmark codex install` writes Pathmark-owned hook commands into `~/.codex/hooks.json`:

- `SessionStart`: `pathmark codex recall`
- `UserPromptSubmit`: `pathmark codex prompt`
- `PostToolUse`: `pathmark codex observe`
- `Stop`: `pathmark codex writeback`
- `PreCompact`: `pathmark codex writeback`

The installer also ensures `[features].hooks = true` in `~/.codex/config.toml`.

Pathmark-owned hook commands must be detectable and replaceable, so reinstalling does not duplicate hooks. The installer should strip old Pathmark hook commands before adding the new set.

The installer should detect Honcho hook commands. It should report them in `status`. During `pathmark codex install --replace-honcho`, Pathmark should remove Honcho hook commands from `~/.codex/hooks.json`. Removing Honcho hooks must not delete `/Users/mac/.honcho/codex/local`.

## Data Model

Use the existing Pathmark JSONL record shape:

```json
{
  "id": "uuid-or-deterministic-id",
  "kind": "memory",
  "text": "Captured text.",
  "tags": ["codex-raw", "role-user"],
  "source": "codex:session:<id>",
  "createdAt": "2026-06-29T00:00:00.000Z",
  "updatedAt": "2026-06-29T00:00:00.000Z"
}
```

### Raw Capture Records

Raw records preserve the session trail:

- `kind: "memory"`
- Tags:
  - `codex-raw`
  - `codex-session`
  - `role-user`, `role-assistant`, or `role-tool`
  - `session:<id>`
- Source:
  - `codex:session:<id>`
- Text:
  - User prompt, assistant response, or concise tool summary.

Raw records are used for auditability and transparent "what did Pathmark search?" behavior.

### Searchable Records

Searchable records are higher-signal:

- `kind: "conclusion"` for durable decisions, preferences, and stable facts.
- `kind: "memory"` with tags such as `codex-summary`, `project-note`, or `decision`.

The first auto-capture release should prioritize raw and structured captures. Automatic summarization into conclusions can be added later once capture is stable.

### Deduplication

Captured records should use deterministic ids derived from:

- Session id.
- Role.
- Timestamp or transcript index.
- Normalized text hash.

This makes hook retries and repeated `Stop`/`PreCompact` calls idempotent.

Pathmark should maintain a cursor per Codex session, stored under the Pathmark store directory, to track the transcript message count already imported.

## Data Flow

### Session Start

`pathmark codex recall` runs when a Codex session starts, resumes, clears, or compacts.

It should:

- Ensure the Pathmark store exists.
- Search for compact context relevant to the current workspace/session.
- Return a hook-specific context block for Codex to inject.
- Include a short tool hint that says Pathmark memory tools are available and should be used when prior context matters.
- Include the active store path.

### User Prompt

`pathmark codex prompt` runs on `UserPromptSubmit`.

It should:

- Skip empty or trivial prompts like `ok`, `yes`, `continue`, and `do it`.
- Redact obvious secret-shaped values.
- Save meaningful prompts as raw records immediately.
- Add a short Pathmark nudge only when the prompt is memory-sensitive.

### Tool Use

`pathmark codex observe` runs after tool calls.

It should:

- Save concise summaries for useful tool activity.
- Skip Pathmark's own hook and MCP calls to avoid recursion.
- Skip noisy or trivial shell reads by default.
- Capture edits, builds, tests, installs, package commands, git operations, and meaningful MCP calls.
- Store summaries, not full tool output.

### Stop And Pre-Compact

`pathmark codex writeback` runs on `Stop` and `PreCompact`.

It should:

- Read the transcript path from the hook input.
- Parse Codex transcript JSONL.
- Extract only user and assistant text turns.
- Skip injected system/context blocks.
- Append only new turns based on the session cursor.
- Leave the cursor unchanged if parsing fails.

## Search And Chat Behavior

`search_memory`, `get_context`, `ask_memory`, and `chat` should benefit from captured records without being dominated by raw tool logs.

Ranking should prefer:

1. Explicit conclusions.
2. Searchable summaries and project notes.
3. User and assistant turns.
4. Tool summaries.

The current lexical ranking can stay for the first implementation, but it should add a simple kind/tag boost so `honcho-import` and `role-tool` noise ranks lower than durable conclusions and user/assistant records.

`chat` should continue returning the exact retrieved records and summary so the Codex UI can show what Pathmark searched.

## Safety And Privacy

Capture should be local-first and conservative.

Required safeguards:

- Redact obvious values for `KEY=...`, `TOKEN=...`, `PASSWORD=...`, `SECRET=...`, `PRIVATE_KEY=...`, and `Bearer ...`.
- Avoid storing full command output.
- Avoid storing private keys, API keys, wallet seeds, raw wallet addresses when they are clearly credential-like, and live order instructions as trusted conclusions.
- Treat captured memory as context, not authority.
- Do not let memory drive live trading or destructive automation decisions.

If redaction changes a record, the record can still be saved with a `redacted` tag.

## Error Handling

Runtime hooks should fail quietly:

- Invalid hook JSON input returns no output and writes nothing.
- Store write failures do not block Codex.
- Transcript parse failure does not write partial records and does not advance the cursor.
- Hook timeout lets Codex continue.

Installer/status commands should fail loudly:

- Missing `~/.codex/config.toml` or malformed `hooks.json` should be reported.
- Backups should be created before editing `hooks.json`.
- `status` should show enough information to diagnose the installation state.

## Installer Safety

`pathmark codex install` should:

- Back up `~/.codex/hooks.json` before modifying it.
- Remove old Pathmark-owned hook commands before adding new ones.
- Register the Pathmark MCP server when missing, equivalent to `codex mcp add pathmark --env PATHMARK_STORE_DIR=<store> --env PATHMARK_SYNTHESIS_PROVIDER=client -- pathmark`.
- Enable `[features].hooks = true` if needed.
- Detect Honcho hook commands and report whether they remain.
- Remove Honcho hook commands only when called with `--replace-honcho`.
- Preserve unrelated hooks.

`pathmark codex uninstall` should:

- Remove only Pathmark-owned hook commands.
- Preserve unrelated hooks.
- Leave the Pathmark store intact.
- Leave the migrated Honcho store intact.

`pathmark codex status` should show:

- Pathmark MCP registered: yes/no.
- Pathmark hooks installed: yes/no.
- Honcho hooks present: yes/no.
- Store path.
- Record count.
- Last captured session id/time when available.

## Testing

### Unit And Script Tests

Cover:

- Hook input parsing.
- Secret redaction.
- Trivial prompt skipping.
- Tool summary filtering.
- Transcript parsing.
- Injected block skipping.
- Cursor idempotency.
- Deterministic id generation.
- Hook installer preserves unrelated hooks.
- Hook uninstaller removes only Pathmark hooks.

### Smoke Tests

Use temporary fake Codex homes and stores:

- Install hooks into a temp `CODEX_HOME`.
- Run `pathmark codex prompt`, `observe`, `writeback`, and `recall`.
- Verify raw records are created.
- Verify no duplicates after repeated writeback.
- Verify uninstall removes Pathmark hooks only.
- Verify Honcho hook detection works.

### Live Local Verification

After implementation:

- Install in the local Codex setup.
- Remove stale Honcho hook commands from `~/.codex/hooks.json` while preserving `/Users/mac/.honcho/codex/local`.
- Start a new Codex thread.
- Confirm Pathmark appears as MCP.
- Confirm `chat`, `search_memory`, and `get_config` work.
- Confirm new session activity lands in `~/.pathmark/memory/memory.jsonl`.

## Success Criteria

- Honcho can be fully off.
- Pathmark captures new Codex sessions automatically.
- Search/chat retrieve migrated Honcho memories and new Pathmark captures.
- Repeated hook calls do not duplicate records.
- Hook installation is reversible.
- The store remains local and inspectable.
- No API key is required for capture or basic chat retrieval.

## Implementation Boundary

This design is ready for one implementation plan focused on the Codex adapter. Future harness adapters should reuse the same concepts but are not part of the first implementation.
