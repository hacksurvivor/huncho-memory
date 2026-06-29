import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readCursor, writeCursor } from "../dist/codex/cursor.js";
import { readCodexTranscript } from "../dist/codex/transcript.js";
import { loadConfig } from "../dist/config.js";
import { deterministicId } from "../dist/ids.js";
import { redactSecrets } from "../dist/redact.js";
import { PathmarkStore } from "../dist/store.js";

const temp = await mkdtemp(path.join(os.tmpdir(), "pathmark-codex-adapter-"));

try {
  assert.equal(deterministicId(["session", "user", "hello"]), deterministicId(["session", "user", "hello"]));

  const redacted = redactSecrets("OPENAI_API_KEY=sk-testsecret123456789 Bearer abcdefghijklmnop");
  assert.equal(redacted.redacted, true);
  assert.equal(redacted.text.includes("sk-testsecret"), false);
  assert.equal(redacted.text.includes("abcdefghijklmnop"), false);

  const privateKey = redactSecrets('PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nsecret-material\n-----END PRIVATE KEY-----"');
  assert.equal(privateKey.redacted, true);
  assert.equal(privateKey.text.includes("BEGIN PRIVATE KEY"), false);
  assert.equal(privateKey.text.includes("secret-material"), false);

  const store = createStore("base");
  const id = deterministicId(["capture", "same"]);
  const first = await store.addRecord({
    id,
    kind: "memory",
    text: "Captured prompt about Pathmark auto capture.",
    tags: ["codex-raw", "role-user"],
    source: "codex:session:test",
    createdAt: "2026-06-29T00:00:00.000Z",
  });
  const second = await store.addRecord({
    id,
    kind: "memory",
    text: "Captured prompt about Pathmark auto capture.",
    tags: ["codex-raw", "role-user"],
    source: "codex:session:test",
    createdAt: "2026-06-29T00:00:00.000Z",
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(await store.count(), 1);
  assert.equal((await jsonlLines("base")).length, 1);

  const concurrentStore = createStore("concurrent");
  const concurrentId = deterministicId(["capture", "concurrent"]);
  const concurrentWrites = await Promise.all(
    Array.from({ length: 20 }, (_value, index) =>
      concurrentStore.addRecord({
        id: concurrentId,
        kind: "memory",
        text: `Concurrent prompt capture ${index}`,
        tags: ["codex-raw", "role-user"],
        source: "codex:session:concurrent",
        createdAt: "2026-06-29T00:00:00.000Z",
      }),
    ),
  );
  assert.equal(concurrentWrites.filter((result) => result.created).length, 1);
  assert.equal(await concurrentStore.count(), 1);
  assert.equal((await jsonlLines("concurrent")).length, 1);

  const rankingStore = createStore("ranking");
  const conclusionId = deterministicId(["ranking", "conclusion"]);
  const toolId = deterministicId(["ranking", "tool"]);
  const summaryId = deterministicId(["ranking", "summary"]);
  const honchoSummaryId = deterministicId(["ranking", "honcho-summary"]);
  await rankingStore.addRecord({
    id: conclusionId,
    kind: "conclusion",
    text: "Stable architecture preference.",
    tags: ["decision"],
    source: "test",
    createdAt: "2026-06-29T00:00:00.000Z",
  });
  await rankingStore.addRecord({
    id: toolId,
    kind: "memory",
    text: "needle",
    tags: ["role-tool"],
    source: "test",
    createdAt: "2026-06-29T00:00:01.000Z",
  });
  await rankingStore.addRecord({
    id: summaryId,
    kind: "memory",
    text: "shared capture",
    tags: ["codex-summary"],
    source: "test",
    createdAt: "2026-06-29T00:00:02.000Z",
  });
  await rankingStore.addRecord({
    id: honchoSummaryId,
    kind: "memory",
    text: "shared capture",
    tags: ["codex-summary", "honcho-import"],
    source: "test",
    createdAt: "2026-06-29T00:00:03.000Z",
  });

  const unrelatedResults = await rankingStore.search({ query: "unrelated", limit: 10 });
  assert.equal(unrelatedResults.some((result) => result.record.id === conclusionId), false);

  const toolResults = await rankingStore.search({ query: "needle", limit: 10 });
  assert.equal(toolResults.some((result) => result.record.id === toolId), true);

  const summaryResults = await rankingStore.search({ query: "shared", limit: 10 });
  const summaryScore = summaryResults.find((result) => result.record.id === summaryId)?.score;
  const honchoSummaryScore = summaryResults.find((result) => result.record.id === honchoSummaryId)?.score;
  assert.equal(typeof summaryScore, "number");
  assert.equal(typeof honchoSummaryScore, "number");
  assert.equal(summaryScore - honchoSummaryScore, 1);

  const compatStore = createStore("compat");
  const compatRecord = await compatStore.add({
    kind: "memory",
    text: " Add compatibility memory ",
    tags: [" TEST ", "test"],
    source: " ",
  });
  assert.equal(compatRecord.text, "Add compatibility memory");
  assert.deepEqual(compatRecord.tags, ["test"]);
  assert.equal(compatRecord.source, "mcp");
  assert.equal(await compatStore.count(), 1);
  const deletedRecord = await compatStore.delete(compatRecord.id);
  assert.ok(deletedRecord?.deletedAt);
  assert.equal(await compatStore.count(), 1);
  assert.equal((await compatStore.all()).length, 0);
  assert.equal((await compatStore.all({ includeDeleted: true })).length, 1);

  const transcript = path.join(temp, "transcript.jsonl");
  await writeFile(
    transcript,
    [
      JSON.stringify({
        timestamp: "2026-06-29T00:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<pathmark-memory>skip</pathmark-memory>" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Please remember this Pathmark decision." }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:00:03.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Decision captured." }],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );

  const turns = await readCodexTranscript(transcript);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].role, "user");
  assert.equal(turns[1].role, "assistant");

  const cursorStoreDir = path.join(temp, "cursor");
  assert.equal(await readCursor(cursorStoreDir, "session-a"), 0);
  await writeCursor(cursorStoreDir, "session-a", 2);
  assert.equal(await readCursor(cursorStoreDir, "session-a"), 2);

  console.log("Codex adapter base tests passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}

function createStore(name) {
  process.env.PATHMARK_STORE_DIR = path.join(temp, name);
  return new PathmarkStore(loadConfig());
}

async function jsonlLines(name) {
  const file = await readFile(path.join(temp, name, "memory.jsonl"), "utf8");
  return file.trim() ? file.trim().split("\n") : [];
}
