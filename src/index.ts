#!/usr/bin/env node
import { runMcpServer } from "./mcp.js";

const [domain, ...rest] = process.argv.slice(2);

if (domain === "codex") {
  const { runCodexCommand } = await import("./codex/cli.js");
  await runCodexCommand(rest);
} else if (domain === "setup") {
  const { runSetupCommand } = await import("./setup.js");
  await runSetupCommand(rest);
} else if (domain === "help" || domain === "--help" || domain === "-h") {
  console.log("Usage: pathmark [setup <client>|codex <command>]");
  console.log("");
  console.log("No arguments starts the Pathmark MCP stdio server.");
} else {
  if (domain) {
    console.error(`Unknown command: ${domain}`);
    console.error("Usage: pathmark [setup <client>|codex <command>]");
    process.exitCode = 2;
  } else {
    await runMcpServer();
  }
}
