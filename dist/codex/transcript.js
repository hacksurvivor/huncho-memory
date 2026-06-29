import { readFile } from "node:fs/promises";
const TEXT_BLOCK_TYPES = new Set(["input_text", "output_text", "text"]);
const INJECTED_TAGS = [
    "environment_context",
    "turn_aborted",
    "user_instructions",
    "apps_instructions",
    "plugins_instructions",
    "skills_instructions",
    "collaboration_mode",
    "pathmark-memory",
    "pathmark-memory-nudge",
];
export async function readCodexTranscript(file) {
    return readCodexTranscriptFile(file, { strict: false });
}
export async function readCodexTranscriptStrict(file) {
    return readCodexTranscriptFile(file, { strict: true });
}
async function readCodexTranscriptFile(file, options) {
    const raw = await readFile(file, "utf8");
    const turns = [];
    let lineNumber = 0;
    for (const line of raw.split("\n")) {
        lineNumber += 1;
        if (!line.trim())
            continue;
        let event;
        try {
            event = JSON.parse(line);
        }
        catch {
            if (options.strict)
                throw new Error(`Invalid Codex transcript JSON at line ${lineNumber}: ${file}`);
            continue;
        }
        const parsed = parseTranscriptEventInternal(event, turns.length, options.strict ? { file, lineNumber } : undefined);
        if (parsed)
            turns.push(parsed);
    }
    return turns;
}
export function parseTranscriptEvent(event, index) {
    return parseTranscriptEventInternal(event, index);
}
function parseTranscriptEventInternal(event, index, strict) {
    if (!isRecord(event) || event.type !== "response_item")
        return undefined;
    const payload = event.payload;
    if (!isRecord(payload) || payload.type !== "message")
        return undefined;
    if (payload.role !== "user" && payload.role !== "assistant")
        return undefined;
    const text = collectText(payload.content).trim();
    if (!text) {
        if (strict)
            throw new Error(`Malformed Codex transcript message at line ${strict.lineNumber}: ${strict.file}`);
        return undefined;
    }
    if (payload.role === "user" && isInjectedContext(text))
        return undefined;
    return {
        role: payload.role,
        text,
        at: typeof event.timestamp === "string" ? event.timestamp : undefined,
        index,
    };
}
function collectText(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    return content
        .flatMap((block) => {
        if (typeof block === "string")
            return [block];
        if (!isRecord(block) || !TEXT_BLOCK_TYPES.has(String(block.type)))
            return [];
        return typeof block.text === "string" ? [block.text] : [];
    })
        .join("\n");
}
function isInjectedContext(text) {
    const trimmed = text.trimStart();
    if (/^<[a-z0-9-]+-memory(?:-nudge)?(?:\s|>)/i.test(trimmed))
        return true;
    return INJECTED_TAGS.some((tag) => startsWithTag(trimmed, tag));
}
function startsWithTag(text, tag) {
    if (!text.startsWith(`<${tag}`))
        return false;
    const next = text.at(tag.length + 1);
    return next === ">" || next === undefined || /\s/.test(next);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=transcript.js.map