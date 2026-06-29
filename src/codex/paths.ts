import os from "node:os";
import path from "node:path";

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function envPath(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value : fallback;
}

export function codexHome(): string {
  return path.resolve(expandHome(envPath("CODEX_HOME", "~/.codex")));
}

export function codexHooksPath(): string {
  return path.join(codexHome(), "hooks.json");
}

export function codexConfigPath(): string {
  return path.join(codexHome(), "config.toml");
}

export function pathmarkStoreDir(): string {
  return path.resolve(expandHome(envPath("PATHMARK_STORE_DIR", "~/.pathmark/memory")));
}

export function codexCursorDir(storeDir = pathmarkStoreDir()): string {
  return path.join(storeDir, "codex-cursors");
}
