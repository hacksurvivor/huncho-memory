import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface CaptureCursor {
  count: number;
  updatedAt: string;
}

export function cursorPath(storeDir: string, sessionId: string): string {
  const safeSession = sessionId.replace(/[^a-zA-Z0-9_.-]/g, "_") || "_";
  return path.join(storeDir, "codex-cursors", `${safeSession}.json`);
}

export async function readCursor(storeDir: string, sessionId: string): Promise<number> {
  try {
    const parsed = JSON.parse(await readFile(cursorPath(storeDir, sessionId), "utf8")) as Partial<CaptureCursor>;
    return typeof parsed.count === "number" && Number.isFinite(parsed.count) && parsed.count >= 0 ? parsed.count : 0;
  } catch {
    return 0;
  }
}

export async function writeCursor(storeDir: string, sessionId: string, count: number): Promise<void> {
  const file = cursorPath(storeDir, sessionId);
  const safeCount = Number.isFinite(count) && count >= 0 ? count : 0;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ count: safeCount, updatedAt: new Date().toISOString() }, null, 2), "utf8");
}
