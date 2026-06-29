import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
export function cursorPath(storeDir, sessionId) {
    const safeSession = sessionId.replace(/[^a-zA-Z0-9_.-]/g, "_") || "_";
    return path.join(storeDir, "codex-cursors", `${safeSession}.json`);
}
export async function readCursor(storeDir, sessionId) {
    try {
        const parsed = JSON.parse(await readFile(cursorPath(storeDir, sessionId), "utf8"));
        return typeof parsed.count === "number" && Number.isFinite(parsed.count) && parsed.count >= 0 ? parsed.count : 0;
    }
    catch {
        return 0;
    }
}
export async function writeCursor(storeDir, sessionId, count) {
    const file = cursorPath(storeDir, sessionId);
    const safeCount = Number.isFinite(count) && count >= 0 ? count : 0;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ count: safeCount, updatedAt: new Date().toISOString() }, null, 2), "utf8");
}
//# sourceMappingURL=cursor.js.map