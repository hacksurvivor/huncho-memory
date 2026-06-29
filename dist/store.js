import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
const WORD_RE = /[\p{L}\p{N}_'-]+/gu;
export class PathmarkStore {
    config;
    constructor(config) {
        this.config = config;
    }
    async ensureReady() {
        await mkdir(this.config.storeDir, { recursive: true });
        try {
            await readFile(this.config.memoryFile, "utf8");
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
            await writeFile(this.config.memoryFile, "", "utf8");
        }
    }
    async add(input) {
        const { record } = await this.addRecord(input);
        return record;
    }
    async addRecord(input) {
        await this.ensureReady();
        const now = new Date().toISOString();
        const normalizedText = input.text.trim();
        if (!normalizedText) {
            throw new Error("text is required");
        }
        const id = input.id?.trim() || randomUUID();
        const existing = (await this.all({ includeDeleted: true })).find((record) => record.id === id);
        if (existing) {
            return { record: existing, created: false };
        }
        const record = {
            id,
            kind: input.kind,
            text: normalizedText,
            tags: normalizeTags(input.tags ?? []),
            source: input.source?.trim() || "mcp",
            createdAt: input.createdAt ?? now,
            updatedAt: input.updatedAt ?? input.createdAt ?? now,
        };
        await this.append(record);
        return { record, created: true };
    }
    async all(options = {}) {
        await this.ensureReady();
        const raw = await readFile(this.config.memoryFile, "utf8");
        const records = raw
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line))
            .filter((record) => options.includeDeleted || !record.deletedAt)
            .filter((record) => !options.kind || record.kind === options.kind);
        return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    async count() {
        return (await this.all({ includeDeleted: true })).length;
    }
    async delete(id) {
        const records = await this.all({ includeDeleted: true });
        const existing = records.find((record) => record.id === id && !record.deletedAt);
        if (!existing)
            return undefined;
        const now = new Date().toISOString();
        const updatedRecords = records.map((record) => record.id === id ? { ...record, deletedAt: now, updatedAt: now } : record);
        await this.rewrite(updatedRecords);
        return { ...existing, deletedAt: now, updatedAt: now };
    }
    async search(input) {
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
            .filter((result) => result.score > 0 || queryTerms.length === 0)
            .sort((a, b) => b.score - a.score || b.record.createdAt.localeCompare(a.record.createdAt))
            .slice(0, limit);
    }
    async append(record) {
        const line = `${JSON.stringify(record)}\n`;
        const existing = await readFile(this.config.memoryFile, "utf8");
        await writeFile(this.config.memoryFile, `${existing}${line}`, "utf8");
    }
    async rewrite(records) {
        await mkdir(this.config.storeDir, { recursive: true });
        const tmp = path.join(this.config.storeDir, `.memory.${createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 8)}.tmp`);
        const body = records.map((record) => JSON.stringify(record)).join("\n");
        await writeFile(tmp, body ? `${body}\n` : "", "utf8");
        await rename(tmp, this.config.memoryFile);
    }
}
function normalizeTags(tags) {
    return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();
}
function tokenize(text) {
    return [...new Set((text.toLowerCase().match(WORD_RE) ?? []).filter((term) => term.length > 1))];
}
function scoreRecord(record, queryTerms) {
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
function scorePriority(record) {
    if (record.kind === "conclusion")
        return 8;
    if (record.tags.includes("codex-summary"))
        return 6;
    if (record.tags.includes("project-note"))
        return 5;
    if (record.tags.includes("decision"))
        return 5;
    if (record.tags.includes("role-user"))
        return 3;
    if (record.tags.includes("role-assistant"))
        return 2;
    if (record.tags.includes("role-tool"))
        return -4;
    if (record.tags.includes("honcho-import"))
        return -1;
    return 0;
}
//# sourceMappingURL=store.js.map