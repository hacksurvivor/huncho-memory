import os from "node:os";
import path from "node:path";
import type { HunchoConfig } from "./types.js";

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function loadConfig(): HunchoConfig {
  const storeDir = path.resolve(
    expandHome(process.env.HUNCHO_STORE_DIR ?? "~/.huncho/memory"),
  );

  return {
    storeDir,
    memoryFile: path.join(storeDir, "memory.jsonl"),
    synthesisProvider: synthesisProvider(),
    chatCommand: process.env.HUNCHO_CHAT_COMMAND,
    codexCommand: process.env.HUNCHO_CODEX_COMMAND ?? "codex",
    codexModel: process.env.HUNCHO_CODEX_MODEL,
    chatTimeoutMs: Number.parseInt(process.env.HUNCHO_CHAT_TIMEOUT_MS ?? "120000", 10),
    maxSearchResults: Number.parseInt(process.env.HUNCHO_MAX_SEARCH_RESULTS ?? "12", 10),
  };
}

function synthesisProvider(): HunchoConfig["synthesisProvider"] {
  const value = process.env.HUNCHO_SYNTHESIS_PROVIDER;
  if (value === "command" || value === "codex") return value;
  if (process.env.HUNCHO_CHAT_COMMAND) return "command";
  return "client";
}
