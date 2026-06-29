import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { observe, prompt, recall, writeback } from "../dist/codex/capture.js";
import { readCursor, writeCursor } from "../dist/codex/cursor.js";
import { summarizeToolUse } from "../dist/codex/tool-summary.js";
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

  const standaloneOpenAiKey = "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890";
  const standaloneRedacted = redactSecrets(`Use ${standaloneOpenAiKey} carefully`);
  assert.equal(standaloneRedacted.redacted, true);
  assert.equal(standaloneRedacted.text.includes(standaloneOpenAiKey), false);
  assert.equal(standaloneRedacted.text.includes("[REDACTED]"), true);

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

  assert.equal(summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "pwd" } }), "");
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "npm test" } }),
    "ran: npm test",
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "rg -l old src" } }),
    "",
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "rg -l old src | xargs sed -i 's/old/new/g'" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "rg TODO src | tee todo.txt" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "cat input | tee output" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "sed -i.bak 's/a/b/' file" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "sed -i'' 's/a/b/' file" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "cat <<EOF > file\nvalue\nEOF" } }).startsWith(
      "ran:",
    ),
    true,
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "pathmark codex status" } }),
    "",
  );
  assert.equal(
    summarizeToolUse({
      tool_name: "functions.exec_command",
      tool_input: { cmd: "PATHMARK_STORE_DIR=/tmp pathmark codex status" },
    }),
    "",
  );
  assert.equal(
    summarizeToolUse({ tool_name: "functions.exec_command", tool_input: { cmd: "npm test && pathmark codex status" } }),
    "",
  );
  assert.equal(
    summarizeToolUse({
      tool_name: "functions.exec_command",
      tool_input: { cmd: "PATHMARK_STORE_DIR=/tmp node ./dist/index.js codex prompt" },
    }),
    "",
  );
  assert.equal(
    summarizeToolUse({
      tool_name: "functions.exec_command",
      tool_input: { cmd: "node /Users/mac/Coding /Codex/huncho/dist/index.js codex observe" },
    }),
    "",
  );
  assert.equal(summarizeToolUse({ tool_name: "mcp__pathmark__search_memory", tool_input: {} }), "");
  assert.equal(
    summarizeToolUse({
      tool_name: "functions.apply_patch",
      tool_input: "*** Begin Patch\n*** Update File: src/example.ts\n@@\n-old\n+new\n*** End Patch\n",
    }),
    "edited: src/example.ts",
  );

  createStore("capture");
  const nudge = await prompt({
    session_id: "capture-session",
    prompt: "Remember that Pathmark uses hybrid capture.",
  });
  assert.equal(nudge.includes("<pathmark-memory-nudge>"), true);
  assert.equal(await prompt({ session_id: "capture-session", prompt: "ok." }), "");
  await observe({
    session_id: "capture-session",
    tool_name: "functions.exec_command",
    tool_input: { cmd: "npm run build" },
  });
  await prompt({
    session_id: "capture-session",
    prompt: "Remember OPENAI_API_KEY=sk-testsecret123 for this test.",
  });
  await prompt({
    session_id: "token-session",
    prompt: `Use standalone token ${standaloneOpenAiKey} carefully.`,
  });
  const longPrivateKey = `-----BEGIN PRIVATE KEY-----${"secret-material".repeat(40)}-----END PRIVATE KEY-----`;
  await observe({
    session_id: "capture-session",
    tool_name: "functions.exec_command",
    tool_input: { cmd: `npm run deploy -- PRIVATE_KEY="${longPrivateKey}"` },
  });
  await writeback({ session_id: "capture-session", transcript_path: transcript });

  const captureStore = new PathmarkStore(loadConfig());
  const captured = await captureStore.search({ query: "hybrid capture build", limit: 20 });
  assert.equal(captured.some((result) => result.record.tags.includes("role-user")), true);
  assert.equal(captured.some((result) => result.record.tags.includes("role-tool")), true);

  const assistantCapture = await captureStore.search({ query: "Decision captured", limit: 20 });
  assert.equal(assistantCapture.some((result) => result.record.tags.includes("role-assistant")), true);

  const redactedCapture = await captureStore.search({ query: "OPENAI_API_KEY", limit: 20 });
  const redactedRecord = redactedCapture.find((result) => result.record.tags.includes("redacted"))?.record;
  assert.ok(redactedRecord);
  assert.equal(redactedRecord.text.includes("sk-testsecret123"), false);
  assert.equal(redactedRecord.text.includes("[REDACTED]"), true);

  const standaloneTokenCapture = await captureStore.search({ query: "standalone token", limit: 20 });
  const standaloneTokenRecord = standaloneTokenCapture.find((result) => result.record.source === "codex:session:token-session")
    ?.record;
  assert.ok(standaloneTokenRecord);
  assert.equal(standaloneTokenRecord.tags.includes("redacted"), true);
  assert.equal(standaloneTokenRecord.text.includes(standaloneOpenAiKey), false);
  assert.equal(standaloneTokenRecord.text.includes("[REDACTED]"), true);

  const privateKeyCapture = await captureStore.search({ query: "npm run deploy", limit: 20 });
  const privateKeyRecord = privateKeyCapture.find((result) => result.record.tags.includes("role-tool"))?.record;
  assert.ok(privateKeyRecord);
  assert.equal(privateKeyRecord.tags.includes("redacted"), true);
  assert.equal(privateKeyRecord.text.includes("BEGIN PRIVATE KEY"), false);
  assert.equal(privateKeyRecord.text.includes("secret-material"), false);
  assert.equal(privateKeyRecord.text.includes("[REDACTED]"), true);

  const duplicatePrompt = "Remember that Pathmark uses hybrid capture.";
  const duplicateTranscript = path.join(temp, "duplicate-transcript.jsonl");
  await prompt({ session_id: "dedupe-session", prompt: duplicatePrompt });
  const duplicateAt = new Date().toISOString();
  await writeFile(
    duplicateTranscript,
    [
      JSON.stringify({
        timestamp: duplicateAt,
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: duplicatePrompt }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:00:05.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "ok" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:00:06.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "do it" }],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  await writeback({ session_id: "dedupe-session", transcript_path: duplicateTranscript });
  const dedupeRecords = await captureStore.all();
  const duplicateUserRecords = dedupeRecords.filter(
    (record) =>
      record.source === "codex:session:dedupe-session" &&
      record.tags.includes("role-user") &&
      record.text === duplicatePrompt,
  );
  assert.equal(duplicateUserRecords.length, 1);
  assert.equal(
    dedupeRecords.some(
      (record) =>
        record.source === "codex:session:dedupe-session" &&
        record.tags.includes("role-user") &&
        (record.text === "ok" || record.text === "do it"),
    ),
    false,
  );

  const repeatedPrompt = "Please preserve this repeated nontrivial prompt.";
  const repeatedTranscript = path.join(temp, "repeated-transcript.jsonl");
  await writeFile(
    repeatedTranscript,
    [
      JSON.stringify({
        timestamp: "2026-06-29T00:00:07.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: repeatedPrompt }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-29T00:00:08.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: repeatedPrompt }],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  await writeback({ session_id: "repeat-session", transcript_path: repeatedTranscript });
  const repeatedUserRecords = (await captureStore.all()).filter(
    (record) =>
      record.source === "codex:session:repeat-session" &&
      record.tags.includes("role-user") &&
      record.text === repeatedPrompt,
  );
  assert.equal(repeatedUserRecords.length, 2);

  const stalePrompt = "Please preserve this stale repeated prompt.";
  const staleTranscript = path.join(temp, "stale-transcript.jsonl");
  await captureStore.addRecord({
    id: deterministicId(["stale", "immediate"]),
    kind: "memory",
    text: stalePrompt,
    tags: ["codex-raw", "codex-session", "role-user", "session:stale-session", "immediate-prompt"],
    source: "codex:session:stale-session",
    createdAt: "2026-06-29T00:00:00.000Z",
  });
  await writeFile(
    staleTranscript,
    [
      JSON.stringify({
        timestamp: "2026-06-29T00:30:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: stalePrompt }],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  await writeback({ session_id: "stale-session", transcript_path: staleTranscript });
  const staleUserRecords = (await captureStore.all()).filter(
    (record) =>
      record.source === "codex:session:stale-session" &&
      record.tags.includes("role-user") &&
      record.text === stalePrompt,
  );
  assert.equal(staleUserRecords.length, 2);
  assert.equal(staleUserRecords.some((record) => !record.tags.includes("immediate-prompt")), true);

  const malformedTranscript = path.join(temp, "malformed-transcript.jsonl");
  const malformedStoreDir = loadConfig().storeDir;
  await writeFile(
    malformedTranscript,
    [
      JSON.stringify({
        timestamp: "2026-06-29T00:40:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "This malformed writeback must not advance cursor." }],
        },
      }),
      "{not-json",
    ].join("\n") + "\n",
    "utf8",
  );
  assert.equal(await writeback({ session_id: "malformed-session", transcript_path: malformedTranscript }), "");
  assert.equal(await readCursor(malformedStoreDir, "malformed-session"), 0);
  assert.equal(
    (await captureStore.all()).some((record) => record.source === "codex:session:malformed-session"),
    false,
  );

  const malformedMessageTranscript = path.join(temp, "malformed-message-transcript.jsonl");
  await writeFile(
    malformedMessageTranscript,
    [
      JSON.stringify({
        timestamp: "2026-06-29T00:45:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "unsupported", text: "This strict malformed message must not be captured." }],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  assert.equal(await writeback({ session_id: "malformed-message-session", transcript_path: malformedMessageTranscript }), "");
  assert.equal(await readCursor(malformedStoreDir, "malformed-message-session"), 0);
  assert.equal(
    (await captureStore.all()).some((record) => record.source === "codex:session:malformed-message-session"),
    false,
  );

  const recallStore = createStore("recall");
  const recallRecordId = deterministicId(["recall", "long"]);
  const recallTail = "tail-should-not-appear";
  await recallStore.addRecord({
    id: deterministicId(["recall", "unrelated"]),
    kind: "memory",
    text: "Generic raw captured turn.",
    tags: ["codex-raw", "codex-session", "role-user", "session:other"],
    source: "codex:session:other",
    createdAt: "2026-06-29T00:00:07.000Z",
  });
  await recallStore.addRecord({
    id: deterministicId(["recall", "unrelated-project"]),
    kind: "memory",
    text: "Other project decision from a different session should not appear.",
    tags: ["codex-raw", "codex-session", "role-user", "session:other"],
    source: "codex:session:other",
    createdAt: "2026-06-29T00:00:08.000Z",
  });
  for (let index = 0; index < 40; index += 1) {
    await recallStore.addRecord({
      id: deterministicId(["recall", "generic", String(index)]),
      kind: "memory",
      text: `Other project decision filler ${index} from a different session should not appear.`,
      tags: ["codex-raw", "codex-session", "role-user", "session:other"],
      source: "codex:session:other",
      createdAt: `2026-06-29T00:01:${String(index).padStart(2, "0")}.000Z`,
    });
  }
  await recallStore.addRecord({
    id: recallRecordId,
    kind: "memory",
    text: `Huncho recall relevant project decision: OPENAI_API_KEY=sk-recallsecret ${"detail ".repeat(80)} ${recallTail}`,
    tags: ["codex-raw", "codex-session", "role-user", "session:recall-session"],
    source: "codex:session:recall-session",
    createdAt: "2026-06-29T00:00:09.000Z",
  });
  const recallOutput = await recall({
    cwd: "/Users/mac/Coding /Codex/huncho",
    session_id: "recall-session",
  });
  assert.equal(recallOutput.includes("Generic raw captured turn."), false);
  assert.equal(recallOutput.includes("Other project decision from a different session"), false);
  assert.equal(recallOutput.includes("Other project decision filler"), false);
  assert.equal(recallOutput.includes("Huncho recall relevant project decision"), true);
  assert.equal(recallOutput.includes("sk-recallsecret"), false);
  assert.equal(recallOutput.includes("[REDACTED]"), true);
  assert.equal(recallOutput.includes(recallTail), false);
  assert.equal(recallOutput.includes(recallRecordId), false);
  assert.equal(recallOutput.includes("codex-session"), false);
  assert.equal(recallOutput.includes("Store:"), true);
  assert.equal(recallOutput.includes("mcp__pathmark__chat"), true);

  const noSignalStore = createStore("recall-no-signal");
  await noSignalStore.addRecord({
    id: deterministicId(["recall", "no-signal"]),
    kind: "memory",
    text: "Arbitrary recent memory must not appear without recall signals.",
    tags: ["codex-raw", "codex-session", "role-user", "session:other"],
    source: "codex:session:other",
    createdAt: "2026-06-29T00:50:00.000Z",
  });
  const noSignalRecall = await recall({});
  assert.equal(noSignalRecall.includes("Arbitrary recent memory must not appear"), false);
  assert.equal(noSignalRecall.includes("No matching Pathmark memory found."), true);
  assert.equal(noSignalRecall.includes("Store:"), true);
  assert.equal(noSignalRecall.includes("mcp__pathmark__chat"), true);

  createStore("project-recall");
  await prompt({
    cwd: "/Users/mac/Coding /Codex/huncho",
    session_id: "project-session-a",
    prompt: "Remember alpha workspace behavior.",
  });
  const projectRecall = await recall({
    cwd: "/Users/mac/Coding /Codex/huncho",
    session_id: "project-session-b",
  });
  assert.equal(projectRecall.includes("alpha workspace behavior"), true);

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
