import { spawn } from "node:child_process";
import type { PathmarkConfig, SearchResult } from "./types.js";

export async function synthesizeWithCommand(input: {
  config: PathmarkConfig;
  question: string;
  context: SearchResult[];
}): Promise<string | undefined> {
  if (input.config.synthesisProvider === "client") return undefined;

  const prompt = [
    "Answer the question using the local memory context below.",
    "If the context is insufficient, say what is missing.",
    "",
    `Question: ${input.question}`,
    "",
    "Memory context:",
    ...input.context.map((result, index) => {
      const record = result.record;
      return [
        `#${index + 1} ${record.kind} ${record.id}`,
        `createdAt: ${record.createdAt}`,
        `tags: ${record.tags.join(", ") || "none"}`,
        record.text,
      ].join("\n");
    }),
  ].join("\n");

  if (input.config.synthesisProvider === "codex") {
    return runCodex(input.config, prompt);
  }

  if (!input.config.chatCommand) return undefined;
  const [command, ...args] = input.config.chatCommand.split(" ").filter(Boolean);
  return runCommand(command, args, prompt, input.config.chatTimeoutMs);
}

function runCodex(config: PathmarkConfig, prompt: string): Promise<string> {
  const args = [
    "--ask-for-approval",
    "never",
    "--disable",
    "hooks",
    "--disable",
    "memories",
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--sandbox",
    "read-only",
  ];
  if (config.codexModel) args.push("--model", config.codexModel);
  args.push(prompt);

  return runCommand(config.codexCommand, args, "", config.chatTimeoutMs, parseCodexJsonAnswer);
}

function parseCodexJsonAnswer(stdout: string): string {
  let answer = "";
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = JSON.parse(trimmed) as { type?: string; item?: { type?: string; text?: string } };
      if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
        answer = event.item.text;
      }
    } catch {
      // Keep parsing robust against non-JSON warnings or future event types.
    }
  }
  return answer.trim();
}

function runCommand(
  command: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
  parse: (stdout: string) => string = (stdout) => stdout.trim(),
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Synthesis command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(parse(Buffer.concat(stdout).toString("utf8")));
        return;
      }
      reject(
        new Error(
          `PATHMARK_CHAT_COMMAND exited with code ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`,
        ),
      );
    });
    child.stdin.end(stdin);
  });
}
