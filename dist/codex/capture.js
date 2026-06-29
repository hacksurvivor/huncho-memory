import path from "node:path";
import { loadConfig } from "../config.js";
import { deterministicId } from "../ids.js";
import { redactSecrets } from "../redact.js";
import { PathmarkStore } from "../store.js";
import { readCursor, writeCursor } from "./cursor.js";
import { summarizeToolUse } from "./tool-summary.js";
import { readCodexTranscriptStrict } from "./transcript.js";
const TRIVIAL_PROMPT = /^(?:y|n|yes|no|ok|okay|sure|thanks|yep|nope|continue|go ahead|do it|proceed)\.?$/i;
const MEMORY_CUE = /\b(?:before|previous|previously|earlier|last time|remember|memory|context|history|decided|decision|same as|again|preference|prefer|repo|project)\b/i;
const GENERIC_RECALL_TOKENS = new Set(["codex", "coding", "users", "user", "mac", "home", "documents"]);
const GENERIC_RECALL_TERMS = ["project", "decisions", "preferences"];
const RECALL_TEXT_LIMIT = 240;
const RECALL_SEARCH_LIMIT = 50;
const IMMEDIATE_PROMPT_TAG = "immediate-prompt";
const IMMEDIATE_PROMPT_WINDOW_MS = 5 * 60 * 1000;
export async function recall(input) {
    const config = loadConfig();
    const store = new PathmarkStore(config);
    const query = recallQuery(input);
    if (!query)
        return memoryBlock([], config.memoryFile);
    try {
        const results = await recallSearchResults(store, query, input);
        return memoryBlock(filterRecallResults(results, input).slice(0, 8), config.memoryFile);
    }
    catch {
        return memoryBlock([], config.memoryFile);
    }
}
export async function prompt(input) {
    const text = input.prompt?.trim() ?? "";
    if (shouldSkipUserPrompt(text))
        return "";
    try {
        await saveCapturedRecord({
            sessionId: sessionId(input),
            role: "user",
            text,
            at: new Date().toISOString(),
            immediatePrompt: true,
        });
    }
    catch {
        return "";
    }
    if (!MEMORY_CUE.test(text))
        return "";
    return [
        "<pathmark-memory-nudge>",
        "This prompt may depend on Pathmark memory. Prefer mcp__pathmark__chat for synthesized answers and mcp__pathmark__search_memory when exact evidence is needed.",
        "</pathmark-memory-nudge>",
    ].join("\n");
}
export async function observe(input) {
    const summary = summarizeToolUse({ tool_name: input.tool_name, tool_input: input.tool_input });
    if (!summary)
        return "";
    try {
        await saveCapturedRecord({
            sessionId: sessionId(input),
            role: "tool",
            text: summary,
            at: new Date().toISOString(),
        });
    }
    catch {
        return "";
    }
    return "";
}
export async function writeback(input) {
    if (!input.transcript_path)
        return "";
    try {
        const config = loadConfig();
        const store = new PathmarkStore(config);
        const session = sessionId(input);
        const turns = await readCodexTranscriptStrict(input.transcript_path);
        const cursor = await readCursor(config.storeDir, session);
        const freshTurns = turns.slice(cursor);
        const immediatePrompts = await immediatePromptRecords(store, session);
        for (const turn of freshTurns) {
            if (turn.role === "user" && shouldSkipUserPrompt(turn.text))
                continue;
            if (turn.role === "user" && consumeImmediatePrompt(immediatePrompts, turn.text, turn.at))
                continue;
            await store.addRecord(capturedRecord({
                sessionId: session,
                role: turn.role,
                text: turn.text,
                at: turn.at ?? new Date().toISOString(),
                stablePart: String(turn.index),
            }));
        }
        await writeCursor(config.storeDir, session, turns.length);
    }
    catch {
        return "";
    }
    return "";
}
async function saveCapturedRecord(input) {
    const config = loadConfig();
    const store = new PathmarkStore(config);
    await store.addRecord(capturedRecord(input));
}
function capturedRecord(input) {
    const redacted = redactSecrets(input.text);
    const roleTag = `role-${input.role}`;
    const tags = ["codex-raw", "codex-session", roleTag, `session:${input.sessionId}`];
    if (input.immediatePrompt)
        tags.push(IMMEDIATE_PROMPT_TAG);
    if (redacted.redacted || redacted.text.includes("[REDACTED]"))
        tags.push("redacted");
    const normalizedText = normalizeCapturedText(redacted.text);
    const stablePart = input.stablePart ?? input.at;
    return {
        id: deterministicId(["codex", input.sessionId, input.role, stablePart, normalizedText]),
        kind: "memory",
        text: redacted.text,
        tags,
        source: `codex:session:${input.sessionId}`,
        createdAt: input.at,
        updatedAt: input.at,
    };
}
function memoryBlock(results, memoryFile) {
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
function summarizeResults(results) {
    return results
        .map((result, index) => {
        const record = result.record;
        const redacted = redactSecrets(record.text);
        return `${index + 1}. ${record.kind}: ${truncate(redacted.text, RECALL_TEXT_LIMIT)}`;
    })
        .join("\n");
}
function recallQuery(input) {
    const specificTerms = recallSpecificTerms(input);
    if (specificTerms.length === 0)
        return "";
    return [...new Set([...specificTerms, ...GENERIC_RECALL_TERMS])].join(" ");
}
async function recallSearchResults(store, query, input) {
    const specificQuery = recallSpecificTerms(input).join(" ");
    const searches = [store.search({ query, limit: RECALL_SEARCH_LIMIT })];
    if (specificQuery && specificQuery !== query) {
        searches.push(store.search({ query: specificQuery, limit: RECALL_SEARCH_LIMIT }));
    }
    const merged = new Map();
    for (const results of await Promise.all(searches)) {
        for (const result of results) {
            const existing = merged.get(result.record.id);
            if (!existing || result.score > existing.score)
                merged.set(result.record.id, result);
        }
    }
    return [...merged.values()].sort((a, b) => b.score - a.score || b.record.createdAt.localeCompare(a.record.createdAt));
}
function filterRecallResults(results, input) {
    const specificTerms = recallSpecificTerms(input);
    const session = input.session_id?.trim().toLowerCase();
    if (specificTerms.length === 0 && !session)
        return results;
    return results.filter((result) => {
        const record = result.record;
        const tags = record.tags.map((tag) => tag.toLowerCase());
        const source = record.source.toLowerCase();
        if (session && (source === `codex:session:${session}` || tags.includes(`session:${session}`)))
            return true;
        const haystack = `${record.text} ${record.tags.join(" ")} ${record.source}`.toLowerCase();
        return specificTerms.some((term) => haystack.includes(term.toLowerCase()));
    });
}
function recallSpecificTerms(input) {
    const cwdTerms = recallTermsFromCwd(input.cwd);
    const session = input.session_id?.trim();
    const sessionTerms = session && !GENERIC_RECALL_TOKENS.has(session.toLowerCase()) ? [session] : [];
    return [...new Set([...cwdTerms, ...sessionTerms])];
}
function recallTermsFromCwd(cwd) {
    if (!cwd?.trim())
        return [];
    const basename = path.basename(cwd.trim());
    return basename
        .toLowerCase()
        .split(/[^a-z0-9_-]+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 1 && !GENERIC_RECALL_TOKENS.has(term));
}
function sessionId(input) {
    return input.session_id?.trim() || input.cwd?.trim() || "codex";
}
function shouldSkipUserPrompt(text) {
    const trimmed = text.trim();
    return !trimmed || TRIVIAL_PROMPT.test(trimmed);
}
async function immediatePromptRecords(store, session) {
    const records = new Map();
    const sessionTag = `session:${session}`.toLowerCase();
    for (const record of await store.all()) {
        if (!record.tags.includes("role-user"))
            continue;
        if (!record.tags.includes(IMMEDIATE_PROMPT_TAG))
            continue;
        if (record.source.toLowerCase() !== `codex:session:${session.toLowerCase()}` && !record.tags.includes(sessionTag)) {
            continue;
        }
        const createdAt = Date.parse(record.createdAt);
        if (!Number.isFinite(createdAt))
            continue;
        const key = normalizeCapturedText(record.text);
        records.set(key, [...(records.get(key) ?? []), createdAt]);
    }
    return records;
}
function consumeImmediatePrompt(records, text, turnAt) {
    if (!turnAt)
        return false;
    const turnTime = Date.parse(turnAt);
    if (!Number.isFinite(turnTime))
        return false;
    const redacted = redactSecrets(text);
    const key = normalizeCapturedText(redacted.text);
    const candidates = records.get(key) ?? [];
    const index = candidates.findIndex((createdAt) => Math.abs(createdAt - turnTime) <= IMMEDIATE_PROMPT_WINDOW_MS);
    if (index < 0)
        return false;
    candidates.splice(index, 1);
    if (candidates.length === 0)
        records.delete(key);
    else
        records.set(key, candidates);
    return true;
}
function normalizeCapturedText(text) {
    return text.trim().replace(/\s+/g, " ").toLowerCase();
}
function truncate(text, limit) {
    const normalized = text.trim().replace(/\s+/g, " ");
    if (normalized.length <= limit)
        return normalized;
    return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}
//# sourceMappingURL=capture.js.map