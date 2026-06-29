const SHELL_TOOLS = new Set(["Bash", "shell", "local_shell", "exec", "functions.exec_command"]);
const SKIP_TOOL_PREFIXES = ["mcp__pathmark", "pathmark"];
const TRIVIAL_COMMANDS = [
    "cd",
    "pwd",
    "ls",
    "cat",
    "head",
    "tail",
    "sed",
    "rg",
    "find",
    "wc",
    "git status",
    "git log",
    "git diff",
];
export function summarizeToolUse(input) {
    const name = input.tool_name?.trim() ?? "";
    if (!name)
        return "";
    if (SKIP_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix)))
        return "";
    if (SHELL_TOOLS.has(name)) {
        const command = shellCommand(input.tool_input).trim();
        if (!command)
            return "";
        if (isPathmarkShellCommand(command))
            return "";
        if (TRIVIAL_COMMANDS.some((trivial) => command === trivial || command.startsWith(`${trivial} `))) {
            return "";
        }
        return `ran: ${command.slice(0, 200)}`;
    }
    if (name === "apply_patch" || name === "functions.apply_patch") {
        const patch = patchText(input.tool_input);
        const files = changedFiles(patch);
        return files.length > 0 ? `edited: ${files.slice(0, 8).join(", ")}` : "applied a patch";
    }
    return `used ${name}`;
}
function shellCommand(input) {
    if (Array.isArray(input))
        return input.map(String).join(" ");
    if (!isRecord(input))
        return "";
    if (typeof input.cmd === "string")
        return input.cmd;
    if (Array.isArray(input.cmd))
        return input.cmd.map(String).join(" ");
    if (typeof input.command === "string")
        return input.command;
    if (Array.isArray(input.command))
        return input.command.map(String).join(" ");
    return "";
}
function patchText(input) {
    if (typeof input === "string")
        return input;
    if (!isRecord(input))
        return "";
    if (typeof input.input === "string")
        return input.input;
    if (typeof input.patch === "string")
        return input.patch;
    return "";
}
function changedFiles(patch) {
    const files = [
        ...[...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => match[1]),
        ...[...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]),
    ];
    return [...new Set(files.map((file) => file.trim()).filter((file) => file && file !== "/dev/null"))];
}
function isPathmarkShellCommand(command) {
    const firstCommand = command.trim().split(/\s*(?:&&|\|\||;)\s*/, 1)[0] ?? "";
    const withoutEnv = firstCommand.replace(/^env\s+(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*/, "");
    return (/^pathmark(?:\s|$)/.test(withoutEnv) ||
        /^npx(?:\s+(?:--yes|-y))*\s+pathmark(?:\s|$)/.test(withoutEnv) ||
        /^node(?:\s+--?[^\s]+)*\s+\S*pathmark\S*(?:\s|$)/.test(withoutEnv));
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=tool-summary.js.map