import os from "node:os";
import path from "node:path";

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function codexHome(): string {
  return path.resolve(expandHome(process.env.CODEX_HOME ?? "~/.codex"));
}

export function codexHooksPath(): string {
  return path.join(codexHome(), "hooks.json");
}

export function codexConfigPath(): string {
  return path.join(codexHome(), "config.toml");
}

export function pathmarkStoreDir(): string {
  return path.resolve(expandHome(process.env.PATHMARK_STORE_DIR ?? "~/.pathmark/memory"));
}

export function codexCursorDir(storeDir = pathmarkStoreDir()): string {
  return path.join(storeDir, "codex-cursors");
}
