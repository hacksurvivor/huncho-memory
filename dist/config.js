import os from "node:os";
import path from "node:path";
function expandHome(input) {
    if (input === "~")
        return os.homedir();
    if (input.startsWith("~/"))
        return path.join(os.homedir(), input.slice(2));
    return input;
}
export function loadConfig() {
    const storeDir = path.resolve(expandHome(process.env.PATHMARK_STORE_DIR ?? "~/.pathmark/memory"));
    return {
        storeDir,
        memoryFile: path.join(storeDir, "memory.jsonl"),
        synthesisProvider: synthesisProvider(),
        chatCommand: process.env.PATHMARK_CHAT_COMMAND,
        codexCommand: process.env.PATHMARK_CODEX_COMMAND ?? "codex",
        codexModel: process.env.PATHMARK_CODEX_MODEL,
        openaiBaseUrl: process.env.PATHMARK_OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        openaiApiKey: process.env.PATHMARK_OPENAI_API_KEY,
        openaiModel: process.env.PATHMARK_OPENAI_MODEL,
        chatTimeoutMs: Number.parseInt(process.env.PATHMARK_CHAT_TIMEOUT_MS ?? "120000", 10),
        maxSearchResults: Number.parseInt(process.env.PATHMARK_MAX_SEARCH_RESULTS ?? "12", 10),
    };
}
function synthesisProvider() {
    const value = process.env.PATHMARK_SYNTHESIS_PROVIDER;
    if (value === "command" || value === "codex" || value === "openai-compatible")
        return value;
    if (process.env.PATHMARK_OPENAI_API_KEY && process.env.PATHMARK_OPENAI_MODEL)
        return "openai-compatible";
    if (process.env.PATHMARK_CHAT_COMMAND)
        return "command";
    return "client";
}
//# sourceMappingURL=config.js.map