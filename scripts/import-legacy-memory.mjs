#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_LEGACY_DIR = "~/.pathmark/legacy/codex";
const DEFAULT_PATHMARK_DIR = "~/.pathmark/memory";

const args = parseArgs(process.argv.slice(2));
const legacyDir = expandHome(args["source-dir"] ?? args["legacy-dir"] ?? process.env.PATHMARK_LEGACY_STORE_DIR ?? DEFAULT_LEGACY_DIR);
const pathmarkDir = expandHome(args["pathmark-dir"] ?? process.env.PATHMARK_STORE_DIR ?? DEFAULT_PATHMARK_DIR);
const memoryFile = path.join(pathmarkDir, "memory.jsonl");
const dryRun = Boolean(args["dry-run"]);
const noBackup = Boolean(args["no-backup"]);

const stats = {
  conclusionsRead: 0,
  sessionsRead: 0,
  recordsPrepared: 0,
  duplicatesSkipped: 0,
  invalidLinesSkipped: 0,
  emptySkipped: 0,
  redactedRecords: 0,
  written: 0,
};

await assertDirectory(legacyDir, "Legacy memory store");
await mkdir(pathmarkDir, { recursive: true });
await ensureFile(memoryFile);

const existingRecords = await readJsonl(memoryFile);
const existingIds = new Set(existingRecords.records.map((record) => record.id));
const imported = [];

await importConclusions();
await importSessions();

const newRecords = imported.filter((record) => {
  if (existingIds.has(record.id)) {
    stats.duplicatesSkipped += 1;
    return false;
  }
  existingIds.add(record.id);
  return true;
});

stats.written = newRecords.length;

if (!dryRun && newRecords.length > 0) {
  if (!noBackup) {
    const backupFile = path.join(pathmarkDir, `memory.jsonl.backup-${timestamp()}`);
    await writeFile(backupFile, await readFile(memoryFile, "utf8"), "utf8");
  }

  const body = [...existingRecords.records, ...newRecords].map((record) => JSON.stringify(record)).join("\n");
  const tmp = path.join(pathmarkDir, `.memory.import-legacy.${Date.now()}.tmp`);
  await writeFile(tmp, body ? `${body}\n` : "", "utf8");
  await rename(tmp, memoryFile);
}

console.log(
  JSON.stringify(
    {
      legacyDir,
      pathmarkDir,
      memoryFile,
      dryRun,
      ...stats,
      existingPathmarkRecords: existingRecords.records.length,
      parseErrorsInExistingPathmark: existingRecords.invalidLines,
    },
    null,
    2,
  ),
);

async function importConclusions() {
  const file = path.join(legacyDir, "conclusions.jsonl");
  if (!(await exists(file))) return;

  const parsed = await readJsonl(file);
  stats.invalidLinesSkipped += parsed.invalidLines;

  for (const raw of parsed.records) {
    stats.conclusionsRead += 1;
    const text = String(raw.text ?? "").trim();
    if (!text) {
      stats.emptySkipped += 1;
      continue;
    }

    const redacted = redact(text);
    if (redacted.changed) stats.redactedRecords += 1;

    imported.push({
      id: deterministicId(`legacy:conclusion:${raw.id ?? text}`),
      kind: "conclusion",
      text: redacted.text,
      tags: ["legacy-conclusion", "legacy-import"],
      source: "legacy:conclusions",
      createdAt: isoDate(raw.createdAt),
      updatedAt: isoDate(raw.createdAt),
    });
    stats.recordsPrepared += 1;
  }
}

async function importSessions() {
  const sessionsDir = path.join(legacyDir, "sessions");
  if (!(await exists(sessionsDir))) return;

  const files = (await readdir(sessionsDir)).filter((file) => file.endsWith(".jsonl")).sort();
  for (const fileName of files) {
    const file = path.join(sessionsDir, fileName);
    const parsed = await readJsonl(file);
    stats.invalidLinesSkipped += parsed.invalidLines;

    for (const [index, raw] of parsed.records.entries()) {
      stats.sessionsRead += 1;
      const text = String(raw.text ?? "").trim();
      if (!text) {
        stats.emptySkipped += 1;
        continue;
      }

      const session = String(raw.session ?? path.basename(fileName, ".jsonl"));
      const role = normalizeRole(raw.role);
      const redacted = redact(text);
      if (redacted.changed) stats.redactedRecords += 1;

      imported.push({
        id: deterministicId(`legacy:session:${session}:${index}:${role}:${text}`),
        kind: "memory",
        text: redacted.text,
        tags: ["legacy-import", "legacy-session", `role-${role}`],
        source: `legacy:session:${session}`,
        createdAt: isoDate(raw.at),
        updatedAt: isoDate(raw.at),
      });
      stats.recordsPrepared += 1;
    }
  }
}

async function readJsonl(file) {
  const raw = await readFile(file, "utf8");
  const records = [];
  let invalidLines = 0;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      invalidLines += 1;
    }
  }

  return { records, invalidLines };
}

async function assertDirectory(dir, label) {
  const info = await stat(dir).catch(() => undefined);
  if (!info?.isDirectory()) {
    throw new Error(`${label} not found or not a directory: ${dir}`);
  }
}

async function ensureFile(file) {
  if (await exists(file)) return;
  await writeFile(file, "", "utf8");
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function deterministicId(value) {
  const hash = createHash("sha256").update(value).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function isoDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function normalizeRole(value) {
  return String(value ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "unknown";
}

function redact(text) {
  let changed = false;
  const redacted = text
    .replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PRIVATE[_-]?KEY)[A-Z0-9_]*)\s*[:=]\s*(['"]?)([^\s'",}]{8,})\2/gi, (_match, name) => {
      changed = true;
      return `${name}=[REDACTED]`;
    })
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, () => {
      changed = true;
      return "Bearer [REDACTED]";
    });

  return { text: redacted, changed };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
