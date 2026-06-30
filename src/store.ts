import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PathmarkConfig, PathmarkRecord, PathmarkRecordDraft, PathmarkRecordKind, SearchResult } from "./types.js";

const WORD_RE = /[\p{L}\p{N}_'-]+/gu;
const DEFAULT_LOCK_RETRY_MS = 10;
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_STALE_LOCK_MS = 10 * 60 * 1000;
const DEFAULT_NO_OWNER_STALE_LOCK_MS = 5000;
const LOCK_OWNER_FILE = "owner.json";

interface LockHandle {
  dir: string;
  token: string;
}

interface LockOwner {
  pid?: number;
  token?: string;
  createdAtMs?: number;
}

export class PathmarkStore {
  constructor(private readonly config: PathmarkConfig) {}

  async ensureReady(): Promise<void> {
    await mkdir(this.config.storeDir, { recursive: true });
    await appendFile(this.config.memoryFile, "", "utf8");
  }

  async add(input: PathmarkRecordDraft): Promise<PathmarkRecord> {
    const { record } = await this.addRecord(input);
    return record;
  }

  async addRecord(input: PathmarkRecordDraft): Promise<{ record: PathmarkRecord; created: boolean }> {
    const [result] = await this.addRecords([input]);
    return result;
  }

  async addRecords(inputs: PathmarkRecordDraft[]): Promise<{ record: PathmarkRecord; created: boolean }[]> {
    await this.ensureReady();
    const now = new Date().toISOString();
    const drafts = inputs.map((input) => {
      const normalizedText = input.text.trim();
      if (!normalizedText) {
        throw new Error("text is required");
      }
      return { input, normalizedText };
    });

    return this.withWriteLock(async () => {
      const existingRecords = await this.readRecords({ includeDeleted: true });
      const byId = new Map(existingRecords.map((record) => [record.id, record]));
      const results: { record: PathmarkRecord; created: boolean }[] = [];
      const createdRecords: PathmarkRecord[] = [];

      for (const { input, normalizedText } of drafts) {
        const id = input.id?.trim() || randomUUID();
        const existing = byId.get(id);
        if (existing) {
          results.push({ record: existing, created: false });
          continue;
        }

        const record: PathmarkRecord = {
          id,
          kind: input.kind,
          text: normalizedText,
          tags: normalizeTags(input.tags ?? []),
          source: input.source?.trim() || "mcp",
          createdAt: input.createdAt ?? now,
          updatedAt: input.updatedAt ?? input.createdAt ?? now,
        };

        byId.set(id, record);
        createdRecords.push(record);
        results.push({ record, created: true });
      }

      await this.appendMany(createdRecords);
      return results;
    });
  }

  async all(options: { includeDeleted?: boolean; kind?: PathmarkRecordKind } = {}): Promise<PathmarkRecord[]> {
    await this.ensureReady();
    const records = await this.readRecords(options);

    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async count(): Promise<number> {
    return (await this.all({ includeDeleted: true })).length;
  }

  async delete(id: string): Promise<PathmarkRecord | undefined> {
    await this.ensureReady();

    return this.withWriteLock(async () => {
      const records = await this.readRecords({ includeDeleted: true });
      const existing = records.find((record) => record.id === id && !record.deletedAt);
      if (!existing) return undefined;

      const now = new Date().toISOString();
      const updatedRecords = records.map((record) =>
        record.id === id ? { ...record, deletedAt: now, updatedAt: now } : record,
      );
      await this.rewrite(updatedRecords);
      return { ...existing, deletedAt: now, updatedAt: now };
    });
  }

  async search(input: {
    query: string;
    limit?: number;
    tags?: string[];
    kind?: PathmarkRecordKind;
  }): Promise<SearchResult[]> {
    const queryTerms = tokenize(input.query);
    const tagFilter = normalizeTags(input.tags ?? []);
    const records = await this.all({ kind: input.kind });
    const limit = Math.max(1, Math.min(input.limit ?? this.config.maxSearchResults, 50));

    if (queryTerms.length === 0 && tagFilter.length === 0) {
      return records.slice(0, limit).map((record) => ({
        record,
        score: 1,
        matchedTerms: [],
      }));
    }

    return records
      .filter((record) => tagFilter.every((tag) => record.tags.includes(tag)))
      .map((record) => scoreRecord(record, queryTerms))
      .filter((result) => queryTerms.length === 0 || result.matchedTerms.length > 0)
      .sort((a, b) => b.score - a.score || b.record.createdAt.localeCompare(a.record.createdAt))
      .slice(0, limit);
  }

  private async readRecords(
    options: { includeDeleted?: boolean; kind?: PathmarkRecordKind } = {},
  ): Promise<PathmarkRecord[]> {
    const raw = await readFile(this.config.memoryFile, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PathmarkRecord)
      .filter((record) => options.includeDeleted || !record.deletedAt)
      .filter((record) => !options.kind || record.kind === options.kind);
  }

  private async append(record: PathmarkRecord): Promise<void> {
    await this.appendMany([record]);
  }

  private async appendMany(records: PathmarkRecord[]): Promise<void> {
    if (records.length === 0) return;
    await appendFile(this.config.memoryFile, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
  }

  private async rewrite(records: PathmarkRecord[]): Promise<void> {
    await mkdir(this.config.storeDir, { recursive: true });
    const tmp = path.join(
      this.config.storeDir,
      `.memory.${createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 8)}.tmp`,
    );
    const body = records.map((record) => JSON.stringify(record)).join("\n");
    await writeFile(tmp, body ? `${body}\n` : "", "utf8");
    await rename(tmp, this.config.memoryFile);
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.config.storeDir, { recursive: true });
    const lockDir = path.join(this.config.storeDir, ".memory.lock");
    const startedAt = Date.now();
    const lockTimeoutMs = envMs("PATHMARK_LOCK_TIMEOUT_MS", DEFAULT_LOCK_TIMEOUT_MS);
    const lockRetryMs = envMs("PATHMARK_LOCK_RETRY_MS", DEFAULT_LOCK_RETRY_MS);
    const staleLockMs = envMs("PATHMARK_STALE_LOCK_MS", DEFAULT_STALE_LOCK_MS);
    const noOwnerStaleLockMs = envMs("PATHMARK_NO_OWNER_STALE_LOCK_MS", DEFAULT_NO_OWNER_STALE_LOCK_MS);
    let lock: LockHandle | undefined;

    while (true) {
      try {
        await mkdir(lockDir);
        lock = await writeLockOwner(lockDir);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await removeStaleLock(lockDir, { staleLockMs, noOwnerStaleLockMs })) continue;
        if (Date.now() - startedAt > lockTimeoutMs) {
          throw new Error(`Timed out waiting for Pathmark store lock: ${lockDir}`);
        }
        await sleep(lockRetryMs);
      }
    }

    try {
      return await operation();
    } finally {
      if (lock) await releaseLock(lock);
    }
  }
}

async function writeLockOwner(lockDir: string): Promise<LockHandle> {
  const lock = { dir: lockDir, token: randomUUID() };

  try {
    await writeFile(
      path.join(lockDir, LOCK_OWNER_FILE),
      `${JSON.stringify({ pid: process.pid, token: lock.token, createdAtMs: Date.now() })}\n`,
      "utf8",
    );
    return lock;
  } catch (error) {
    await rm(lockDir, { force: true, recursive: true });
    throw error;
  }
}

async function releaseLock(lock: LockHandle): Promise<void> {
  const owner = await readLockOwner(lock.dir);
  if (owner?.token === lock.token) {
    await rm(lock.dir, { force: true, recursive: true });
  }
}

async function removeStaleLock(
  lockDir: string,
  options: { staleLockMs: number; noOwnerStaleLockMs: number },
): Promise<boolean> {
  if (options.staleLockMs <= 0 && options.noOwnerStaleLockMs <= 0) return false;

  try {
    const lock = await stat(lockDir);
    const ageMs = Date.now() - lock.mtimeMs;
    const owner = await readLockOwner(lockDir);
    if (!owner) {
      if (options.noOwnerStaleLockMs <= 0 || ageMs < options.noOwnerStaleLockMs) return false;
    } else if (owner.pid && isPidAlive(owner.pid)) {
      const ownerAgeMs = Date.now() - (owner.createdAtMs ?? lock.mtimeMs);
      if (options.staleLockMs <= 0 || ownerAgeMs < options.staleLockMs) return false;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }

  try {
    await rm(lockDir, { force: false, recursive: true });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

async function readLockOwner(lockDir: string): Promise<LockOwner | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path.join(lockDir, LOCK_OWNER_FILE), "utf8")) as LockOwner;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();
}

function tokenize(text: string): string[] {
  return [...new Set((text.toLowerCase().match(WORD_RE) ?? []).filter((term) => term.length > 1))];
}

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
  let priority = 0;
  if (record.kind === "conclusion") priority += 8;
  if (record.tags.includes("codex-summary")) priority += 6;
  if (record.tags.includes("project-note")) priority += 5;
  if (record.tags.includes("decision")) priority += 5;
  if (record.tags.includes("role-user")) priority += 3;
  if (record.tags.includes("role-assistant")) priority += 2;
  if (record.tags.includes("role-tool")) priority -= 4;
  if (record.tags.some((tag) => tag.endsWith("-import"))) priority -= 1;
  return priority;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
