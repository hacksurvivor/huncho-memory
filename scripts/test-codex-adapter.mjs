import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../dist/config.js";
import { deterministicId } from "../dist/ids.js";
import { redactSecrets } from "../dist/redact.js";
import { PathmarkStore } from "../dist/store.js";

const temp = await mkdtemp(path.join(os.tmpdir(), "pathmark-codex-adapter-"));
process.env.PATHMARK_STORE_DIR = path.join(temp, "store");

try {
  assert.equal(deterministicId(["session", "user", "hello"]), deterministicId(["session", "user", "hello"]));

  const redacted = redactSecrets("OPENAI_API_KEY=sk-testsecret123456789 Bearer abcdefghijklmnop");
  assert.equal(redacted.redacted, true);
  assert.equal(redacted.text.includes("sk-testsecret"), false);
  assert.equal(redacted.text.includes("abcdefghijklmnop"), false);

  const store = new PathmarkStore(loadConfig());
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

  const file = await readFile(path.join(temp, "store", "memory.jsonl"), "utf8");
  assert.equal(file.trim().split("\n").length, 1);
  console.log("Codex adapter base tests passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
