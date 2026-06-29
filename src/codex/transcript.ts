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
  return readCodexTranscriptFile(file, { strict: false });
}

export async function readCodexTranscriptStrict(file: string): Promise<CodexTurn[]> {
  return readCodexTranscriptFile(file, { strict: true });
}

async function readCodexTranscriptFile(file: string, options: { strict: boolean }): Promise<CodexTurn[]> {
  const raw = await readFile(file, "utf8");
  const turns: CodexTurn[] = [];
  let lineNumber = 0;

  for (const line of raw.split("\n")) {
    lineNumber += 1;
    if (!line.trim()) continue;

    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      if (options.strict) throw new Error(`Invalid Codex transcript JSON at line ${lineNumber}: ${file}`);
      continue;
    }

    const parsed = parseTranscriptEvent(event, turns.length);
    if (parsed) turns.push(parsed);
  }

  return turns;
}

export function parseTranscriptEvent(event: unknown, index: number): CodexTurn | undefined {
  if (!isRecord(event) || event.type !== "response_item") return undefined;

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
    .flatMap((block) => {
      if (typeof block === "string") return [block];
      if (!isRecord(block) || !TEXT_BLOCK_TYPES.has(String(block.type))) return [];
      return typeof block.text === "string" ? [block.text] : [];
    })
    .join("\n");
}

function isInjectedContext(text: string): boolean {
  const trimmed = text.trimStart();
  return INJECTED_TAGS.some((tag) => startsWithTag(trimmed, tag));
}

function startsWithTag(text: string, tag: string): boolean {
  if (!text.startsWith(`<${tag}`)) return false;
  const next = text.at(tag.length + 1);
  return next === ">" || next === undefined || /\s/.test(next);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
