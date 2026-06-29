#!/usr/bin/env node
import { runMcpServer } from "./mcp.js";
const [domain] = process.argv.slice(2);
if (domain === "codex") {
    const { runCodexCommand } = await import("./codex/cli.js");
    await runCodexCommand(process.argv.slice(3));
}
else {
    await runMcpServer();
}
//# sourceMappingURL=index.js.map