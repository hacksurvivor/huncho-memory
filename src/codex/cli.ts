export async function runCodexCommand(args: string[]): Promise<void> {
  void args;
  console.error("Usage: pathmark codex <command> [args]");
  process.exitCode = 2;
}
