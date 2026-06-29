# Codex Auto-Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Pathmark's Codex auto-capture adapter so new Codex sessions are saved automatically into the local Pathmark store with hybrid raw/searchable memory.

**Architecture:** Keep the MCP server provider-neutral and move it behind `runMcpServer()`. Add a Codex adapter under `src/codex/` that owns hook install/uninstall/status, hook event handling, transcript parsing, cursors, and compact recall output. The adapter writes into the existing JSONL store through deterministic append methods.

**Tech Stack:** TypeScript ESM on Node 20+, `@modelcontextprotocol/sdk`, `zod`, Codex `hooks.json`, Codex `config.toml`, local JSONL storage, Node script smoke tests.

---

## File Structure

- Create `src/mcp.ts`: exports `runMcpServer()` and contains the existing MCP tool registration.
- Modify `src/index.ts`: becomes the CLI entrypoint; dispatches `pathmark codex ...` or starts MCP server when no subcommand is provided.
- Modify `src/store.ts`: adds deterministic append, record count, tag-aware scoring boosts, and duplicate-safe writes.
- Modify `src/types.ts`: adds capture-facing input types where needed.
- Create `src/redact.ts`: redacts obvious secret-shaped values before capture.
- Create `src/ids.ts`: deterministic id helpers.
- Create `src/codex/paths.ts`: resolves `CODEX_HOME`, hooks path, config path, store path, and cursor directory.
- Create `src/codex/transcript.ts`: parses Codex transcript JSONL and extracts user/assistant turns.
- Create `src/codex/cursor.ts`: reads/writes per-session import cursors.
- Create `src/codex/tool-summary.ts`: summarizes useful tool calls and filters noisy ones.
- Create `src/codex/hooks.ts`: installs, removes, and detects Pathmark/Honcho hooks.
- Create `src/codex/config-file.ts`: enables `[features].hooks = true` and installs/removes the Pathmark MCP config block.
- Create `src/codex/capture.ts`: implements `recall`, `prompt`, `observe`, and `writeback`.
- Create `src/codex/cli.ts`: parses Codex adapter commands and reads hook stdin.
- Create `scripts/test-codex-adapter.mjs`: temp-home smoke tests for adapter utilities.
- Modify `scripts/smoke.mjs`: keep MCP smoke coverage after the `src/index.ts` dispatch change.
- Modify `README.md`: document `pathmark codex install --replace-honcho`, status, uninstall, and auto-capture behavior.
- Modify `package.json`: add `test:codex-adapter` and include any new distributable scripts through `dist`.

## Task 1: Split MCP Server From CLI Entrypoint

**Files:**
- Create: `src/mcp.ts`
- Modify: `src/index.ts`
- Test: `scripts/smoke.mjs`

- [ ] **Step 1: Move current MCP server code into `src/mcp.ts`**

Create `src/mcp.ts` by moving the current contents of `src/index.ts`, removing the shebang, and wrapping startup in `runMcpServer()`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { synthesizeWithCommand } from "./chat.js";
import { loadConfig } from "./config.js";
import { jsonText, publicConfig, summarizeRecords, summarizeSearch } from "./format.js";
import { PathmarkStore } from "./store.js";

export async function runMcpServer(): Promise<void> {
  const config = loadConfig();
  const store = new PathmarkStore(config);
  const server = new McpServer({ name: "pathmark", version: "0.1.0" });

  server.registerTool(
    "get_config",
    {
      title: "Get Pathmark configuration",
      description: "Show the local Pathmark Memory store location and enabled optional features.",
      inputSchema: {},
    },
    async () => jsonText(publicConfig(config)),
  );

  server.registerTool(
    "remember",
    {
      title: "Remember",
      description: "Save a durable local memory item.",
      inputSchema: {
        text: z.string().min(1).describe("Memory text to save."),
        tags: z.array(z.string()).optional().describe("Optional lowercase-ish tags for later filtering."),
        source: z.string().optional().describe("Optional source label, such as repo, thread, or tool name."),
      },
    },
    async ({ text, tags, source }) => {
      const record = await store.add({ kind: "memory", text, tags, source });
      return jsonText(record);
    },
  );

  server.registerTool(
    "create_conclusion",
    {
      title: "Create conclusion",
      description: "Save a durable conclusion or preference that should be treated as higher-signal than raw memory.",
      inputSchema: {
        text: z.string().min(1).describe("Conclusion text to save."),
        tags: z.array(z.string()).optional(),
        source: z.string().optional(),
      },
    },
    async ({ text, tags, source }) => {
      const record = await store.add({ kind: "conclusion", text, tags, source });
      return jsonText(record);
    },
  );

  server.registerTool(
    "search_memory",
    {
      title: "Search memory",
      description: "Search saved local memories and conclusions.",
      inputSchema: {
        query: z.string().default("").describe("Search query. Empty query returns recent records."),
        limit: z.number().int().min(1).max(50).optional(),
        tags: z.array(z.string()).optional(),
        kind: z.enum(["memory", "conclusion"]).optional(),
      },
    },
    async ({ query, limit, tags, kind }) => {
      const results = await store.search({ query, limit, tags, kind });
      return jsonText({
        results: results.map((result) => ({
          ...result.record,
          score: result.score,
          matchedTerms: result.matchedTerms,
        })),
        summary: summarizeSearch(results),
      });
    },
  );

  server.registerTool(
    "get_context",
    {
      title: "Get context",
      description: "Return compact local memory context for a task or question.",
      inputSchema: {
        query: z.string().default("").describe("Task or question to retrieve context for."),
        limit: z.number().int().min(1).max(30).optional(),
      },
    },
    async ({ query, limit }) => {
      const results = await store.search({ query, limit });
      return jsonText({
        context: summarizeSearch(results),
        records: results.map((result) => result.record),
      });
    },
  );

  server.registerTool(
    "list_conclusions",
    {
      title: "List conclusions",
      description: "List saved durable conclusions.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ limit }) => {
      const records = (await store.all({ kind: "conclusion" })).slice(0, limit ?? 50);
      return jsonText({
        records,
        summary: summarizeRecords(records),
      });
    },
  );

  server.registerTool(
    "delete_memory",
    {
      title: "Delete memory",
      description: "Soft-delete a saved memory or conclusion by id.",
      inputSchema: {
        id: z.string().min(1),
      },
    },
    async ({ id }) => {
      const deleted = await store.delete(id);
      return jsonText({ deleted: deleted ?? null });
    },
  );

  server.registerTool(
    "ask_memory",
    {
      title: "Ask memory",
      description:
        "Retrieve relevant context and optionally synthesize an answer through PATHMARK_CHAT_COMMAND. Without a command, returns context for the MCP client to synthesize.",
      inputSchema: {
        question: z.string().min(1),
        limit: z.number().int().min(1).max(30).optional(),
      },
    },
    async ({ question, limit }) => answerFromMemory(store, config, question, limit),
  );

  server.registerTool(
    "chat",
    {
      title: "Chat",
      description:
        "Ask Pathmark memory a question. Returns the exact retrieved context so the MCP client can show what memory was used.",
      inputSchema: {
        question: z.string().min(1),
        limit: z.number().int().min(1).max(30).optional(),
      },
    },
    async ({ question, limit }) => answerFromMemory(store, config, question, limit),
  );

  await store.ensureReady();
  await server.connect(new StdioServerTransport());
}

async function answerFromMemory(
  store: PathmarkStore,
  config: ReturnType<typeof loadConfig>,
  question: string,
  limit?: number,
) {
  const results = await store.search({ query: question, limit });
  const answer = await synthesizeWithCommand({ config, question, context: results });
  return jsonText({
    answer: answer ?? null,
    synthesis: answer ? "server_command" : "client_should_synthesize",
    context: summarizeSearch(results),
    records: results.map((result) => result.record),
  });
}
```

- [ ] **Step 2: Replace `src/index.ts` with a CLI dispatcher**

Modify `src/index.ts`:

```ts
#!/usr/bin/env node
import { runMcpServer } from "./mcp.js";

const [domain] = process.argv.slice(2);

if (domain === "codex") {
  const { runCodexCommand } = await import("./codex/cli.js");
  await runCodexCommand(process.argv.slice(3));
} else {
  await runMcpServer();
}
```

- [ ] **Step 3: Build and run MCP smoke**

Run:

```bash
npm run build
npm run smoke
```

Expected:

```text
Smoke test passed with store
```

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/mcp.ts dist scripts/smoke.mjs
git commit -m "Refactor MCP server behind CLI entrypoint"
```

## Task 2: Add Deterministic Store Writes And Redaction

**Files:**
- Create: `src/ids.ts`
- Create: `src/redact.ts`
- Modify: `src/store.ts`
- Modify: `src/types.ts`
- Create: `scripts/test-codex-adapter.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add deterministic id helper**

Create `src/ids.ts`:

```ts
import { createHash } from "node:crypto";

export function deterministicId(parts: string[]): string {
  const hash = createHash("sha256").update(parts.join("\u001f")).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
```

- [ ] **Step 2: Add redaction utility**

Create `src/redact.ts`:

```ts
export interface RedactionResult {
  text: string;
  redacted: boolean;
}

export function redactSecrets(text: string): RedactionResult {
  let redacted = false;
  const output = text
    .replace(
      /\b([A-Z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PRIVATE[_-]?KEY)[A-Z0-9_]*)\s*[:=]\s*(['"]?)([^\s'",}]{8,})\2/gi,
      (_match, name) => {
        redacted = true;
        return `${name}=[REDACTED]`;
      },
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, () => {
      redacted = true;
      return "Bearer [REDACTED]";
    });

  return { text: output, redacted };
}
```

- [ ] **Step 3: Extend store input types**

Modify `src/types.ts`:

```ts
export type PathmarkRecordKind = "memory" | "conclusion";

export interface PathmarkRecord {
  id: string;
  kind: PathmarkRecordKind;
  text: string;
  tags: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface PathmarkRecordDraft {
  id?: string;
  kind: PathmarkRecordKind;
  text: string;
  tags?: string[];
  source?: string;
  createdAt?: string;
  updatedAt?: string;
}
```

Keep the existing `PathmarkConfig` and `SearchResult` interfaces below this block.

- [ ] **Step 4: Add duplicate-safe append to `PathmarkStore`**

Modify `src/store.ts` imports and add methods:

```ts
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PathmarkConfig, PathmarkRecord, PathmarkRecordDraft, PathmarkRecordKind, SearchResult } from "./types.js";
```

Add this method inside `PathmarkStore`:

```ts
async addRecord(input: PathmarkRecordDraft): Promise<{ record: PathmarkRecord; created: boolean }> {
  await this.ensureReady();
  const normalizedText = input.text.trim();
  if (!normalizedText) {
    throw new Error("text is required");
  }

  const now = new Date().toISOString();
  const record: PathmarkRecord = {
    id: input.id ?? randomUUID(),
    kind: input.kind,
    text: normalizedText,
    tags: normalizeTags(input.tags ?? []),
    source: input.source?.trim() || "mcp",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? input.createdAt ?? now,
  };

  const existing = await this.all({ includeDeleted: true });
  if (existing.some((saved) => saved.id === record.id)) {
    return { record, created: false };
  }

  await this.append(record);
  return { record, created: true };
}

async count(): Promise<number> {
  return (await this.all({ includeDeleted: true })).length;
}
```

Change `add()` to delegate:

```ts
async add(input: {
  kind: PathmarkRecordKind;
  text: string;
  tags?: string[];
  source?: string;
}): Promise<PathmarkRecord> {
  const { record } = await this.addRecord(input);
  return record;
}
```

- [ ] **Step 5: Add ranking boosts**

Modify `scoreRecord()` in `src/store.ts`:

```ts
function scoreRecord(record: PathmarkRecord, queryTerms: string[]): SearchResult {
  const haystack = `${record.text} ${record.tags.join(" ")} ${record.source}`.toLowerCase();
  const textTerms = tokenize(record.text);
  const matchedTerms = queryTerms.filter((term) => haystack.includes(term));
  const exactTextMatches = matchedTerms.filter((term) => textTerms.includes(term)).length;
  const tagMatches = matchedTerms.filter((term) => record.tags.includes(term)).length;
  const priority = scorePriority(record);

  return {
    record,
    score: matchedTerms.length + exactTextMatches * 2 + tagMatches * 3 + priority,
    matchedTerms,
  };
}

function scorePriority(record: PathmarkRecord): number {
  if (record.kind === "conclusion") return 8;
  if (record.tags.includes("codex-summary")) return 6;
  if (record.tags.includes("project-note")) return 5;
  if (record.tags.includes("decision")) return 5;
  if (record.tags.includes("role-user")) return 3;
  if (record.tags.includes("role-assistant")) return 2;
  if (record.tags.includes("role-tool")) return -4;
  if (record.tags.includes("honcho-import")) return -1;
  return 0;
}
```

- [ ] **Step 6: Add adapter test script shell**

Create `scripts/test-codex-adapter.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deterministicId } from "../dist/ids.js";
import { redactSecrets } from "../dist/redact.js";
import { loadConfig } from "../dist/config.js";
import { PathmarkStore } from "../dist/store.js";

const temp = await mkdtemp(path.join(os.tmpdir(), "pathmark-codex-adapter-"));
process.env.PATHMARK_STORE_DIR = path.join(temp, "store");

try {
  assert.equal(
    deterministicId(["session", "user", "hello"]),
    deterministicId(["session", "user", "hello"]),
  );

  const redacted = redactSecrets("OPENAI_API_KEY=sk-testsecret123456789 Bearer abcdefghijklmnop");
  assert.equal(redacted.redacted, true);
  assert.equal(redacted.text.includes("sk-testsecret"), false);
  assert.equal(redacted.text.includes("abcdefghijklmnop"), false);

  const store = new PathmarkStore(loadConfig());
  const id = deterministicId(["capture", "same"]);
  const first = await store.addRecord({
    id,
    kind: "memory",
    text: "Captured prompt about Pathmark auto capture.",
    tags: ["codex-raw", "role-user"],
    source: "codex:session:test",
    createdAt: "2026-06-29T00:00:00.000Z",
  });
  const second = await store.addRecord({
    id,
    kind: "memory",
    text: "Captured prompt about Pathmark auto capture.",
    tags: ["codex-raw", "role-user"],
    source: "codex:session:test",
    createdAt: "2026-06-29T00:00:00.000Z",
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(await store.count(), 1);

  const file = await readFile(path.join(temp, "store", "memory.jsonl"), "utf8");
  assert.equal(file.trim().split("\n").length, 1);
  console.log("Codex adapter base tests passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
```

- [ ] **Step 7: Add npm script**

Modify `package.json`:

```json
"scripts": {
  "build": "tsc",
  "dev": "tsx src/index.ts",
  "smoke": "node scripts/smoke.mjs",
  "test:codex-adapter": "npm run build && node scripts/test-codex-adapter.mjs",
  "import:honcho": "node scripts/import-honcho.mjs",
  "prepack": "npm run build"
}
```

- [ ] **Step 8: Run tests**

Run:

```bash
npm run build
npm run smoke
npm run test:codex-adapter
```

Expected:

```text
Smoke test passed with store
Codex adapter base tests passed
```

- [ ] **Step 9: Commit**

```bash
git add package.json src/ids.ts src/redact.ts src/store.ts src/types.ts scripts/test-codex-adapter.mjs dist
git commit -m "Add capture-safe store primitives"
```

## Task 3: Parse Codex Transcripts And Track Cursors

**Files:**
- Create: `src/codex/transcript.ts`
- Create: `src/codex/cursor.ts`
- Modify: `scripts/test-codex-adapter.mjs`

- [ ] **Step 1: Add transcript parser**

Create `src/codex/transcript.ts`:

```ts
import { readFile } from "node:fs/promises";

export interface CodexTurn {
  role: "user" | "assistant";
  text: string;
  at?: string;
  index: number;
}

const TEXT_BLOCK_TYPES = new Set(["input_text", "output_text", "text"]);
const INJECTED_TAGS = [
  "environment_context",
  "turn_aborted",
  "user_instructions",
  "apps_instructions",
  "plugins_instructions",
  "skills_instructions",
  "collaboration_mode",
  "honcho-memory",
  "honcho-memory-nudge",
  "pathmark-memory",
  "pathmark-memory-nudge",
];

export async function readCodexTranscript(file: string): Promise<CodexTurn[]> {
  const raw = await readFile(file, "utf8");
  const turns: CodexTurn[] = [];
  let index = 0;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const parsed = parseTranscriptEvent(event, index);
    if (!parsed) continue;
    turns.push(parsed);
    index += 1;
  }

  return turns;
}

export function parseTranscriptEvent(event: unknown, index: number): CodexTurn | undefined {
  if (!isRecord(event)) return undefined;
  if (event.type !== "response_item") return undefined;
  const payload = event.payload;
  if (!isRecord(payload) || payload.type !== "message") return undefined;
  if (payload.role !== "user" && payload.role !== "assistant") return undefined;

  const text = collectText(payload.content).trim();
  if (!text) return undefined;
  if (payload.role === "user" && isInjectedContext(text)) return undefined;

  return {
    role: payload.role,
    text,
    at: typeof event.timestamp === "string" ? event.timestamp : undefined,
    index,
  };
}

function collectText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => isRecord(block) && TEXT_BLOCK_TYPES.has(String(block.type)) && typeof block.text === "string")
    .map((block) => (block as { text: string }).text)
    .join("\n");
}

function isInjectedContext(text: string): boolean {
  const trimmed = text.trimStart();
  return INJECTED_TAGS.some((tag) => trimmed.startsWith(`<${tag}>`) || trimmed.startsWith(`<${tag} `));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 2: Add cursor helpers**

Create `src/codex/cursor.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface CaptureCursor {
  count: number;
  updatedAt: string;
}

export function cursorPath(storeDir: string, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(storeDir, "codex-cursors", `${safe}.json`);
}

export async function readCursor(storeDir: string, sessionId: string): Promise<number> {
  try {
    const parsed = JSON.parse(await readFile(cursorPath(storeDir, sessionId), "utf8")) as Partial<CaptureCursor>;
    return typeof parsed.count === "number" && parsed.count >= 0 ? parsed.count : 0;
  } catch {
    return 0;
  }
}

export async function writeCursor(storeDir: string, sessionId: string, count: number): Promise<void> {
  const file = cursorPath(storeDir, sessionId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ count, updatedAt: new Date().toISOString() }, null, 2), "utf8");
}
```

- [ ] **Step 3: Extend adapter test script**

Append to `scripts/test-codex-adapter.mjs` imports:

```js
import { writeFile } from "node:fs/promises";
import { readCursor, writeCursor } from "../dist/codex/cursor.js";
import { readCodexTranscript } from "../dist/codex/transcript.js";
```

Append before the final `console.log`:

```js
const transcript = path.join(temp, "transcript.jsonl");
await writeFile(
  transcript,
  [
    JSON.stringify({
      timestamp: "2026-06-29T00:00:01.000Z",
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<pathmark-memory>skip</pathmark-memory>" }] },
    }),
    JSON.stringify({
      timestamp: "2026-06-29T00:00:02.000Z",
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Please remember this Pathmark decision." }] },
    }),
    JSON.stringify({
      timestamp: "2026-06-29T00:00:03.000Z",
      type: "response_item",
      payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Decision captured." }] },
    }),
  ].join("\n") + "\n",
  "utf8",
);

const turns = await readCodexTranscript(transcript);
assert.equal(turns.length, 2);
assert.equal(turns[0].role, "user");
assert.equal(turns[1].role, "assistant");
assert.equal(await readCursor(process.env.PATHMARK_STORE_DIR, "session-a"), 0);
await writeCursor(process.env.PATHMARK_STORE_DIR, "session-a", 2);
assert.equal(await readCursor(process.env.PATHMARK_STORE_DIR, "session-a"), 2);
```

- [ ] **Step 4: Run adapter tests**

Run:

```bash
npm run test:codex-adapter
```

Expected:

```text
Codex adapter base tests passed
```

- [ ] **Step 5: Commit**

```bash
git add src/codex/transcript.ts src/codex/cursor.ts scripts/test-codex-adapter.mjs dist
git commit -m "Add Codex transcript parsing"
```

## Task 4: Implement Codex Capture Hook Handlers

**Files:**
- Create: `src/codex/tool-summary.ts`
- Create: `src/codex/capture.ts`
- Modify: `scripts/test-codex-adapter.mjs`

- [ ] **Step 1: Add tool summary utility**

Create `src/codex/tool-summary.ts`:

```ts
export interface ToolHookInput {
  tool_name?: string;
  tool_input?: unknown;
}

const SHELL_TOOLS = new Set(["Bash", "shell", "local_shell", "exec", "functions.exec_command"]);
const SKIP_PREFIXES = ["mcp__pathmark", "pathmark"];
const TRIVIAL_COMMANDS = [
  "cd",
  "pwd",
  "ls",
  "cat",
  "head",
  "tail",
  "sed",
  "rg",
  "find",
  "wc",
  "git status",
  "git log",
  "git diff",
];

export function summarizeToolUse(input: ToolHookInput): string {
  const name = input.tool_name ?? "";
  if (!name) return "";
  if (SKIP_PREFIXES.some((prefix) => name.startsWith(prefix))) return "";

  if (SHELL_TOOLS.has(name)) {
    const command = shellCommand(input.tool_input).trim();
    if (!command) return "";
    if (TRIVIAL_COMMANDS.some((trivial) => command === trivial || command.startsWith(`${trivial} `))) return "";
    return `ran: ${command.slice(0, 200)}`;
  }

  if (name === "apply_patch" || name === "functions.apply_patch") {
    const patch = patchText(input.tool_input);
    const files = [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => match[1]);
    return files.length ? `edited: ${files.slice(0, 8).join(", ")}` : "applied a patch";
  }

  return `used ${name}`;
}

function shellCommand(input: unknown): string {
  if (isRecord(input) && typeof input.cmd === "string") return input.cmd;
  if (isRecord(input) && typeof input.command === "string") return input.command;
  if (isRecord(input) && Array.isArray(input.command)) return input.command.join(" ");
  return "";
}

function patchText(input: unknown): string {
  if (typeof input === "string") return input;
  if (isRecord(input) && typeof input.input === "string") return input.input;
  if (isRecord(input) && typeof input.patch === "string") return input.patch;
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 2: Add capture handlers**

Create `src/codex/capture.ts`:

```ts
import { loadConfig } from "../config.js";
import { deterministicId } from "../ids.js";
import { redactSecrets } from "../redact.js";
import { PathmarkStore } from "../store.js";
import type { PathmarkRecordDraft } from "../types.js";
import { readCursor, writeCursor } from "./cursor.js";
import { summarizeToolUse } from "./tool-summary.js";
import { readCodexTranscript } from "./transcript.js";

export interface CodexHookInput {
  cwd?: string;
  session_id?: string;
  prompt?: string;
  transcript_path?: string;
  tool_name?: string;
  tool_input?: unknown;
}

const TRIVIAL_PROMPT = /^(y|n|yes|no|ok|okay|sure|thanks|yep|nope|continue|go ahead|do it|proceed)\.?$/i;
const MEMORY_CUE =
  /\b(before|previous|previously|earlier|last time|remember|memory|context|history|decided|decision|same as|again|preference|prefer|repo|project)\b/i;

export async function recall(input: CodexHookInput): Promise<string> {
  const config = loadConfig();
  const store = new PathmarkStore(config);
  const query = [input.cwd, input.session_id, "project decisions preferences"].filter(Boolean).join(" ");
  const results = await store.search({ query, limit: 8 });
  const context = results.length
    ? results.map((result) => `- ${result.record.text}`).join("\n")
    : "No matching Pathmark memory yet.";

  return [
    "<pathmark-memory>",
    context,
    `Store: ${config.memoryFile}`,
    "</pathmark-memory>",
    "Memory tools are available via MCP. Use Pathmark chat or search_memory when prior context may affect the task.",
  ].join("\n");
}

export async function prompt(input: CodexHookInput): Promise<string> {
  const text = input.prompt?.trim() ?? "";
  if (!text || TRIVIAL_PROMPT.test(text)) return "";

  await saveCapturedRecord({
    sessionId: sessionId(input),
    role: "user",
    text,
    at: new Date().toISOString(),
    tags: ["codex-raw", "codex-session", "role-user"],
  });

  if (!MEMORY_CUE.test(text)) return "";
  return [
    "<pathmark-memory-nudge>",
    "This prompt may depend on Pathmark memory. Prefer Pathmark chat for synthesized answers and search_memory when exact evidence is needed.",
    "</pathmark-memory-nudge>",
  ].join("\n");
}

export async function observe(input: CodexHookInput): Promise<string> {
  const summary = summarizeToolUse({ tool_name: input.tool_name, tool_input: input.tool_input });
  if (!summary) return "";
  await saveCapturedRecord({
    sessionId: sessionId(input),
    role: "tool",
    text: summary,
    at: new Date().toISOString(),
    tags: ["codex-raw", "codex-session", "role-tool"],
  });
  return "";
}

export async function writeback(input: CodexHookInput): Promise<string> {
  if (!input.transcript_path) return "";
  const config = loadConfig();
  const store = new PathmarkStore(config);
  const session = sessionId(input);
  const turns = await readCodexTranscript(input.transcript_path);
  const cursor = await readCursor(config.storeDir, session);
  const fresh = turns.slice(cursor);

  for (const turn of fresh) {
    const record = capturedRecord({
      sessionId: session,
      role: turn.role,
      text: turn.text,
      at: turn.at ?? new Date().toISOString(),
      tags: ["codex-raw", "codex-session", `role-${turn.role}`],
      stablePart: String(turn.index),
    });
    await store.addRecord(record);
  }

  await writeCursor(config.storeDir, session, turns.length);
  return "";
}

async function saveCapturedRecord(input: {
  sessionId: string;
  role: "user" | "assistant" | "tool";
  text: string;
  at: string;
  tags: string[];
}): Promise<void> {
  const config = loadConfig();
  const store = new PathmarkStore(config);
  await store.addRecord(capturedRecord(input));
}

function capturedRecord(input: {
  sessionId: string;
  role: "user" | "assistant" | "tool";
  text: string;
  at: string;
  tags: string[];
  stablePart?: string;
}): PathmarkRecordDraft {
  const redacted = redactSecrets(input.text);
  const tags = redacted.redacted ? [...input.tags, "redacted"] : input.tags;
  return {
    id: deterministicId(["codex", input.sessionId, input.role, input.stablePart ?? input.at, redacted.text]),
    kind: "memory",
    text: redacted.text,
    tags: [...tags, `session:${input.sessionId}`],
    source: `codex:session:${input.sessionId}`,
    createdAt: input.at,
    updatedAt: input.at,
  };
}

function sessionId(input: CodexHookInput): string {
  return input.session_id?.trim() || input.cwd?.trim() || "codex";
}
```

- [ ] **Step 3: Extend tests for tool summaries and writeback**

Append imports to `scripts/test-codex-adapter.mjs`:

```js
import { observe, prompt, writeback } from "../dist/codex/capture.js";
import { summarizeToolUse } from "../dist/codex/tool-summary.js";
```

Append before final `console.log`:

```js
assert.equal(summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "pwd" } }), "");
assert.equal(
  summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "npm test" } }),
  "ran: npm test",
);

await prompt({ session_id: "capture-session", prompt: "Remember that Pathmark uses hybrid capture." });
await observe({ session_id: "capture-session", tool_name: "functions.exec_command", tool_input: { cmd: "npm run build" } });
await writeback({ session_id: "capture-session", transcript_path: transcript });

const captured = await new PathmarkStore(loadConfig()).search({ query: "hybrid capture build", limit: 20 });
assert.equal(captured.some((result) => result.record.tags.includes("role-user")), true);
assert.equal(captured.some((result) => result.record.tags.includes("role-tool")), true);
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm run test:codex-adapter
```

Expected:

```text
Codex adapter base tests passed
```

- [ ] **Step 5: Commit**

```bash
git add src/codex/capture.ts src/codex/tool-summary.ts scripts/test-codex-adapter.mjs dist
git commit -m "Add Codex capture handlers"
```

## Task 5: Add Codex Hook And MCP Installer

**Files:**
- Create: `src/codex/paths.ts`
- Create: `src/codex/hooks.ts`
- Create: `src/codex/config-file.ts`
- Modify: `scripts/test-codex-adapter.mjs`

- [ ] **Step 1: Add path helpers**

Create `src/codex/paths.ts`:

```ts
import os from "node:os";
import path from "node:path";

export function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export function codexHooksPath(): string {
  return path.join(codexHome(), "hooks.json");
}

export function codexConfigPath(): string {
  return path.join(codexHome(), "config.toml");
}
```

- [ ] **Step 2: Add hook installer**

Create `src/codex/hooks.ts`:

```ts
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { codexHooksPath } from "./paths.js";

const PATHMARK_VERBS = ["recall", "prompt", "observe", "writeback"];
const PATHMARK_PATTERN = new RegExp(`\\bpathmark\\b[\\s\\S]*\\bcodex\\b[\\s\\S]*\\b(${PATHMARK_VERBS.join("|")})\\b`);
const HONCHO_PATTERN = /codex-honcho|\/honcho\/codex-honcho\.mjs/;

interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
  statusMessage?: string;
}

interface HookGroup {
  matcher?: string;
  hooks?: HookCommand[];
}

interface HooksFile {
  hooks: Record<string, HookGroup[]>;
}

export async function installPathmarkHooks(options: { replaceHoncho: boolean; hooksPath?: string } = { replaceHoncho: false }): Promise<void> {
  const file = await readHooksFile(options.hooksPath);
  await backupHooksFile(options.hooksPath);
  const stripped = stripOwnedHooks(file, (command) => PATHMARK_PATTERN.test(command) || (options.replaceHoncho && HONCHO_PATTERN.test(command)));
  const next = addPathmarkHooks(stripped);
  await writeHooksFile(next, options.hooksPath);
}

export async function uninstallPathmarkHooks(hooksPath?: string): Promise<void> {
  const file = await readHooksFile(hooksPath);
  await backupHooksFile(hooksPath);
  await writeHooksFile(stripOwnedHooks(file, (command) => PATHMARK_PATTERN.test(command)), hooksPath);
}

export async function hookStatus(hooksPath?: string): Promise<{ pathmark: boolean; honcho: boolean }> {
  const file = await readHooksFile(hooksPath);
  const commands = Object.values(file.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks ?? []).map((hook) => hook.command));
  return {
    pathmark: commands.some((command) => PATHMARK_PATTERN.test(command)),
    honcho: commands.some((command) => HONCHO_PATTERN.test(command)),
  };
}

function addPathmarkHooks(file: HooksFile): HooksFile {
  const next: HooksFile = { hooks: { ...file.hooks } };
  next.hooks.SessionStart = [...(next.hooks.SessionStart ?? []), { matcher: "startup|resume|clear|compact", hooks: [{ type: "command", command: "pathmark codex recall", timeout: 30, statusMessage: "pathmark" }] }];
  next.hooks.UserPromptSubmit = [...(next.hooks.UserPromptSubmit ?? []), { hooks: [{ type: "command", command: "pathmark codex prompt", timeout: 20 }] }];
  next.hooks.PostToolUse = [...(next.hooks.PostToolUse ?? []), { matcher: "*", hooks: [{ type: "command", command: "pathmark codex observe", timeout: 10 }] }];
  next.hooks.Stop = [...(next.hooks.Stop ?? []), { hooks: [{ type: "command", command: "pathmark codex writeback", timeout: 30 }] }];
  next.hooks.PreCompact = [...(next.hooks.PreCompact ?? []), { matcher: "manual|auto", hooks: [{ type: "command", command: "pathmark codex writeback", timeout: 30 }] }];
  return next;
}

function stripOwnedHooks(file: HooksFile, isOwned: (command: string) => boolean): HooksFile {
  const next: HooksFile = { hooks: {} };
  for (const [event, groups] of Object.entries(file.hooks)) {
    const keptGroups: HookGroup[] = [];
    for (const group of groups) {
      const keptHooks = (group.hooks ?? []).filter((hook) => !isOwned(hook.command));
      if (keptHooks.length > 0) keptGroups.push({ ...group, hooks: keptHooks });
    }
    if (keptGroups.length > 0) next.hooks[event] = keptGroups;
  }
  return next;
}

async function readHooksFile(hooksPath = codexHooksPath()): Promise<HooksFile> {
  try {
    const parsed = JSON.parse(await readFile(hooksPath, "utf8")) as Partial<HooksFile>;
    return { hooks: parsed.hooks && typeof parsed.hooks === "object" ? parsed.hooks : {} };
  } catch {
    return { hooks: {} };
  }
}

async function writeHooksFile(file: HooksFile, hooksPath = codexHooksPath()): Promise<void> {
  await mkdir(path.dirname(hooksPath), { recursive: true });
  await writeFile(hooksPath, JSON.stringify(file, null, 2) + "\n", "utf8");
}

async function backupHooksFile(hooksPath = codexHooksPath()): Promise<void> {
  try {
    await copyFile(hooksPath, `${hooksPath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  } catch {
    await mkdir(path.dirname(hooksPath), { recursive: true });
  }
}
```

- [ ] **Step 3: Add config/MCP config helpers**

Create `src/codex/config-file.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.js";
import { codexConfigPath } from "./paths.js";

const PATHMARK_BLOCK_START = "# >>> pathmark MCP >>>";
const PATHMARK_BLOCK_END = "# <<< pathmark MCP <<<";

export async function installPathmarkMcp(configPath = codexConfigPath()): Promise<void> {
  const current = await readText(configPath);
  const pathmark = loadConfig();
  const block = [
    PATHMARK_BLOCK_START,
    "[mcp_servers.pathmark]",
    'command = "pathmark"',
    `env = { PATHMARK_STORE_DIR = ${tomlString(pathmark.storeDir)}, PATHMARK_SYNTHESIS_PROVIDER = "client" }`,
    PATHMARK_BLOCK_END,
  ].join("\n");
  await writeText(configPath, `${stripPathmarkBlock(enableHooksFeature(current)).trimEnd()}\n\n${block}\n`);
}

export async function removePathmarkMcp(configPath = codexConfigPath()): Promise<void> {
  await writeText(configPath, `${stripPathmarkBlock(await readText(configPath)).trimEnd()}\n`);
}

export async function hasPathmarkMcp(configPath = codexConfigPath()): Promise<boolean> {
  return (await readText(configPath)).includes(PATHMARK_BLOCK_START) || (await readText(configPath)).includes("[mcp_servers.pathmark]");
}

export function enableHooksFeature(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trimEnd();
  if (!normalized) return "[features]\nhooks = true\n";
  const lines = normalized.split("\n");
  const header = lines.findIndex((line) => /^\s*\[features\]\s*$/.test(line));
  if (header === -1) return `${normalized}\n\n[features]\nhooks = true\n`;
  let end = lines.length;
  let hooksLine = -1;
  for (let index = header + 1; index < lines.length; index += 1) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[index])) {
      end = index;
      break;
    }
    if (/^\s*hooks\s*=/.test(lines[index])) hooksLine = index;
  }
  if (hooksLine >= 0) lines[hooksLine] = "hooks = true";
  else lines.splice(end, 0, "hooks = true");
  return `${lines.join("\n")}\n`;
}

function stripPathmarkBlock(content: string): string {
  const start = content.indexOf(PATHMARK_BLOCK_START);
  if (start === -1) return content;
  const end = content.indexOf(PATHMARK_BLOCK_END, start);
  if (end === -1) return content;
  return `${content.slice(0, start).trimEnd()}\n${content.slice(end + PATHMARK_BLOCK_END.length).trimStart()}`;
}

async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function writeText(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, "utf8");
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}
```

- [ ] **Step 4: Extend tests for hook installer**

Append imports to `scripts/test-codex-adapter.mjs`:

```js
import { mkdir } from "node:fs/promises";
import { installPathmarkMcp, hasPathmarkMcp } from "../dist/codex/config-file.js";
import { hookStatus, installPathmarkHooks, uninstallPathmarkHooks } from "../dist/codex/hooks.js";
```

Append before final `console.log`:

```js
const codexHome = path.join(temp, "codex-home");
await mkdir(codexHome, { recursive: true });
const hooksPath = path.join(codexHome, "hooks.json");
await writeFile(
  hooksPath,
  JSON.stringify({
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: "node /Users/mac/.codex/honcho/codex-honcho.mjs prompt" }] },
        { hooks: [{ type: "command", command: "echo keep-me" }] },
      ],
    },
  }, null, 2),
  "utf8",
);
await installPathmarkHooks({ replaceHoncho: true, hooksPath });
let status = await hookStatus(hooksPath);
assert.equal(status.pathmark, true);
assert.equal(status.honcho, false);
let hooksText = await readFile(hooksPath, "utf8");
assert.equal(hooksText.includes("echo keep-me"), true);
await uninstallPathmarkHooks(hooksPath);
status = await hookStatus(hooksPath);
assert.equal(status.pathmark, false);
hooksText = await readFile(hooksPath, "utf8");
assert.equal(hooksText.includes("echo keep-me"), true);

const codexConfig = path.join(codexHome, "config.toml");
await installPathmarkMcp(codexConfig);
assert.equal(await hasPathmarkMcp(codexConfig), true);
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test:codex-adapter
```

Expected:

```text
Codex adapter base tests passed
```

- [ ] **Step 6: Commit**

```bash
git add src/codex/paths.ts src/codex/hooks.ts src/codex/config-file.ts scripts/test-codex-adapter.mjs dist
git commit -m "Add Codex hook installer"
```

## Task 6: Wire Codex Adapter CLI Commands

**Files:**
- Create: `src/codex/cli.ts`
- Modify: `README.md`
- Modify: `scripts/test-codex-adapter.mjs`

- [ ] **Step 1: Add CLI command dispatcher**

Create `src/codex/cli.ts`:

```ts
import { loadConfig } from "../config.js";
import { PathmarkStore } from "../store.js";
import { prompt, observe, recall, writeback, type CodexHookInput } from "./capture.js";
import { hasPathmarkMcp, installPathmarkMcp, removePathmarkMcp } from "./config-file.js";
import { hookStatus, installPathmarkHooks, uninstallPathmarkHooks } from "./hooks.js";

export async function runCodexCommand(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (command === "install") {
    await installPathmarkHooks({ replaceHoncho: rest.includes("--replace-honcho") });
    await installPathmarkMcp();
    console.log("Installed Pathmark Codex hooks and MCP server.");
    return;
  }
  if (command === "uninstall") {
    await uninstallPathmarkHooks();
    await removePathmarkMcp();
    console.log("Removed Pathmark Codex hooks and MCP server registration.");
    return;
  }
  if (command === "status") {
    await printStatus();
    return;
  }
  if (command === "recall" || command === "prompt" || command === "observe" || command === "writeback") {
    await runHook(command);
    return;
  }
  console.error("Usage: pathmark codex <install|uninstall|status|recall|prompt|observe|writeback>");
  process.exitCode = 2;
}

async function runHook(command: "recall" | "prompt" | "observe" | "writeback"): Promise<void> {
  const input = await readHookInput();
  const output =
    command === "recall"
      ? await recall(input)
      : command === "prompt"
        ? await prompt(input)
        : command === "observe"
          ? await observe(input)
          : await writeback(input);

  if (!output) return;
  if (command === "recall" || command === "prompt") {
    const hookEventName = command === "recall" ? "SessionStart" : "UserPromptSubmit";
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: output } }) + "\n");
    return;
  }
  process.stdout.write(output + "\n");
}

async function printStatus(): Promise<void> {
  const config = loadConfig();
  const store = new PathmarkStore(config);
  const hooks = await hookStatus();
  const mcp = await hasPathmarkMcp();
  const count = await store.count();
  console.log(JSON.stringify({
    pathmarkMcpRegistered: mcp,
    pathmarkHooksInstalled: hooks.pathmark,
    honchoHooksPresent: hooks.honcho,
    storeDir: config.storeDir,
    memoryFile: config.memoryFile,
    recordCount: count,
  }, null, 2));
}

async function readHookInput(): Promise<CodexHookInput> {
  if (process.stdin.isTTY) return {};
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as CodexHookInput;
  } catch {
    return {};
  }
}
```

- [ ] **Step 2: Add CLI smoke checks**

Append to `scripts/test-codex-adapter.mjs`:

```js
import { spawnSync } from "node:child_process";
```

Append before final `console.log`:

```js
const cliEnv = {
  ...process.env,
  PATHMARK_STORE_DIR: process.env.PATHMARK_STORE_DIR,
  CODEX_HOME: codexHome,
};
const statusRun = spawnSync(process.execPath, ["dist/index.js", "codex", "status"], {
  cwd: process.cwd(),
  env: cliEnv,
  encoding: "utf8",
});
assert.equal(statusRun.status, 0);
const parsedStatus = JSON.parse(statusRun.stdout);
assert.equal(typeof parsedStatus.recordCount, "number");

const promptRun = spawnSync(process.execPath, ["dist/index.js", "codex", "prompt"], {
  cwd: process.cwd(),
  env: cliEnv,
  input: JSON.stringify({ session_id: "cli-session", prompt: "Remember the CLI capture path." }),
  encoding: "utf8",
});
assert.equal(promptRun.status, 0);
```

- [ ] **Step 3: Document auto-capture commands**

Add to `README.md` after "Migrate From Honcho":

```md
## Codex Auto-Capture

Install Pathmark as the Codex memory adapter:

```bash
pathmark codex install --replace-honcho
```

This registers the Pathmark MCP server, enables Codex hooks, and removes old Honcho hook commands from Codex while preserving `~/.honcho/codex/local`.

Check status:

```bash
pathmark codex status
```

Remove Pathmark hooks and MCP registration without deleting memory:

```bash
pathmark codex uninstall
```
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm run build
npm run smoke
npm run test:codex-adapter
```

Expected:

```text
Smoke test passed with store
Codex adapter base tests passed
```

- [ ] **Step 5: Commit**

```bash
git add README.md src/codex/cli.ts scripts/test-codex-adapter.mjs dist
git commit -m "Add Codex adapter CLI"
```

## Task 7: Package, Install, And Verify Locally

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Runtime config: `~/.codex/hooks.json`, `~/.codex/config.toml`

- [ ] **Step 1: Ensure distributable package includes built files**

Run:

```bash
npm pack --dry-run
```

Expected:

```text
npm notice
pathmark-0.1.0.tgz
```

Verify the dry-run output includes:

```text
dist/codex/cli.js
dist/codex/capture.js
dist/codex/hooks.js
dist/codex/transcript.js
```

- [ ] **Step 2: Run full test pass**

Run:

```bash
npm run build
npm run smoke
npm run test:codex-adapter
```

Expected:

```text
Smoke test passed with store
Codex adapter base tests passed
```

- [ ] **Step 3: Commit package/doc adjustments**

If `package.json`, `README.md`, or `dist/` changed in this task:

```bash
git add package.json README.md dist
git commit -m "Package Codex auto-capture adapter"
```

If nothing changed, skip this commit.

- [ ] **Step 4: Install locally from the working tree**

Run:

```bash
npm install -g --install-links=true .
```

Expected:

```text
added
```

- [ ] **Step 5: Install Codex adapter and replace stale Honcho hooks**

Run:

```bash
pathmark codex install --replace-honcho
pathmark codex status
```

Expected status fields:

```json
{
  "pathmarkMcpRegistered": true,
  "pathmarkHooksInstalled": true,
  "honchoHooksPresent": false
}
```

- [ ] **Step 6: Verify existing migrated memory is still present**

Run:

```bash
wc -l /Users/mac/.pathmark/memory/memory.jsonl
du -sh /Users/mac/.honcho/codex/local /Users/mac/.pathmark/memory
```

Expected:

```text
30308 /Users/mac/.pathmark/memory/memory.jsonl
```

The exact Pathmark size may be greater than `15M` after new capture tests. The Honcho directory must still exist.

- [ ] **Step 7: Verify a hook-style prompt write**

Run:

```bash
printf '%s\n' '{"session_id":"manual-live-smoke","prompt":"Remember that Pathmark Codex auto-capture is installed."}' | pathmark codex prompt
pathmark codex status
```

Expected:

```text
pathmarkHooksInstalled
```

Then verify the memory:

```bash
rg -n "Pathmark Codex auto-capture is installed" /Users/mac/.pathmark/memory/memory.jsonl
```

Expected:

```text
Pathmark Codex auto-capture is installed
```

- [ ] **Step 8: Commit final verification notes if docs changed**

If live verification reveals a doc correction:

```bash
git add README.md docs/superpowers/specs/2026-06-29-codex-auto-capture-design.md
git commit -m "Document Codex auto-capture verification"
```

If no docs changed, skip this commit.

## Task 8: Push And Final GitHub Verification

**Files:**
- Git history only unless CI requires a fix.

- [ ] **Step 1: Push implementation branch**

Run:

```bash
git status --short --branch
git push origin main
```

Expected:

```text
main -> main
```

- [ ] **Step 2: Watch CI**

Run:

```bash
gh run list --limit 1
gh run watch $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status
```

Expected:

```text
success
```

- [ ] **Step 3: Reinstall from GitHub**

Run:

```bash
npm uninstall -g pathmark
npm install -g --install-links=true github:hacksurvivor/pathmark
pathmark codex status
```

Expected:

```json
{
  "pathmarkMcpRegistered": true,
  "pathmarkHooksInstalled": true,
  "honchoHooksPresent": false
}
```

- [ ] **Step 4: Final report**

Report:

- Latest commit hash.
- CI status.
- Whether `pathmark codex status` shows Pathmark hooks installed.
- Whether Honcho hooks are absent.
- Whether `/Users/mac/.honcho/codex/local` still exists.
- The current Pathmark record count.
