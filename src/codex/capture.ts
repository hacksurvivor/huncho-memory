import { loadConfig } from "../config.js";
import { deterministicId } from "../ids.js";
import { redactSecrets } from "../redact.js";
import { PathmarkStore } from "../store.js";
import type { PathmarkRecordDraft, SearchResult } from "../types.js";
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

const TRIVIAL_PROMPT = /^(?:y|n|yes|no|ok|okay|sure|thanks|yep|nope|continue|go ahead|do it|proceed)\.?$/i;
const MEMORY_CUE =
  /\b(?:before|previous|previously|earlier|last time|remember|memory|context|history|decided|decision|same as|again|preference|prefer|repo|project)\b/i;

export async function recall(input: CodexHookInput): Promise<string> {
  const config = loadConfig();
  const store = new PathmarkStore(config);
  const query = [input.cwd, input.session_id, "project decisions preferences"].filter(isNonEmptyString).join(" ");

  try {
    const results = await store.search({ query, limit: 8 });
    return memoryBlock(results, config.memoryFile);
  } catch {
    return memoryBlock([], config.memoryFile);
  }
}

export async function prompt(input: CodexHookInput): Promise<string> {
  const text = input.prompt?.trim() ?? "";
  if (!text || TRIVIAL_PROMPT.test(text)) return "";

  try {
    await saveCapturedRecord({
      sessionId: sessionId(input),
      role: "user",
      text,
      at: new Date().toISOString(),
    });
  } catch {
    return "";
  }

  if (!MEMORY_CUE.test(text)) return "";
  return [
    "<pathmark-memory-nudge>",
    "This prompt may depend on Pathmark memory. Prefer mcp__pathmark__chat for synthesized answers and mcp__pathmark__search_memory when exact evidence is needed.",
    "</pathmark-memory-nudge>",
  ].join("\n");
}

export async function observe(input: CodexHookInput): Promise<string> {
  const summary = summarizeToolUse({ tool_name: input.tool_name, tool_input: input.tool_input });
  if (!summary) return "";

  try {
    await saveCapturedRecord({
      sessionId: sessionId(input),
      role: "tool",
      text: summary,
      at: new Date().toISOString(),
    });
  } catch {
    return "";
  }

  return "";
}

export async function writeback(input: CodexHookInput): Promise<string> {
  if (!input.transcript_path) return "";

  try {
    const config = loadConfig();
    const store = new PathmarkStore(config);
    const session = sessionId(input);
    const turns = await readCodexTranscript(input.transcript_path);
    const cursor = await readCursor(config.storeDir, session);
    const freshTurns = turns.slice(cursor);

    for (const turn of freshTurns) {
      await store.addRecord(
        capturedRecord({
          sessionId: session,
          role: turn.role,
          text: turn.text,
          at: turn.at ?? new Date().toISOString(),
          stablePart: String(turn.index),
        }),
      );
    }

    await writeCursor(config.storeDir, session, turns.length);
  } catch {
    return "";
  }

  return "";
}

async function saveCapturedRecord(input: {
  sessionId: string;
  role: "user" | "assistant" | "tool";
  text: string;
  at: string;
  stablePart?: string;
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
  stablePart?: string;
}): PathmarkRecordDraft {
  const redacted = redactSecrets(input.text);
  const roleTag = `role-${input.role}`;
  const tags = ["codex-raw", "codex-session", roleTag, `session:${input.sessionId}`];
  if (redacted.redacted) tags.push("redacted");

  return {
    id: deterministicId(["codex", input.sessionId, input.role, input.stablePart ?? input.at, redacted.text]),
    kind: "memory",
    text: redacted.text,
    tags,
    source: `codex:session:${input.sessionId}`,
    createdAt: input.at,
    updatedAt: input.at,
  };
}

function memoryBlock(results: SearchResult[], memoryFile: string): string {
  return [
    "<pathmark-memory>",
    "Pathmark memory context:",
    results.length > 0 ? summarizeResults(results) : "No matching Pathmark memory found.",
    "",
    `Store: ${memoryFile}`,
    "MCP tools: use mcp__pathmark__chat for synthesized memory answers or mcp__pathmark__search_memory for exact records.",
    "</pathmark-memory>",
  ].join("\n");
}

function summarizeResults(results: SearchResult[]): string {
  return results
    .map((result, index) => {
      const record = result.record;
      const tags = record.tags.length > 0 ? ` tags=${record.tags.join(",")}` : "";
      return `${index + 1}. ${record.kind} ${record.id} (${record.createdAt}${tags})\n${record.text}`;
    })
    .join("\n");
}

function sessionId(input: CodexHookInput): string {
  return input.session_id?.trim() || input.cwd?.trim() || "codex";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
