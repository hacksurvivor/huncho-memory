import { redactSecrets } from "../redact.js";
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
        if (isTrivialShellCommand(command))
            return "";
        const redacted = redactSecrets(command);
        return `ran: ${redacted.text.slice(0, 200)}`;
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
    return command
        .split(/\s*(?:&&|\|\||;|\|)\s*/)
        .map(stripLeadingEnvAssignments)
        .some((segment) => {
        return (/^pathmark(?:\s|$)/.test(segment) ||
            /^npx(?:\s+(?:--yes|-y))*\s+pathmark(?:\s|$)/.test(segment) ||
            /^node(?:\s+--?[^\s]+)*\s+\S*pathmark\S*(?:\s|$)/.test(segment) ||
            /^node\b[\s\S]*\bdist\/index\.js\s+codex(?:\s|$)/.test(segment));
    });
}
function stripLeadingEnvAssignments(command) {
    let text = command.trim();
    if (text.startsWith("env "))
        text = text.slice(4).trimStart();
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(text)) {
        text = text.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s*/, "").trimStart();
    }
    return text;
}
function isTrivialShellCommand(command) {
    if (hasMutationShellMarker(command))
        return false;
    return TRIVIAL_COMMANDS.some((trivial) => {
        if (command === trivial)
            return true;
        if (!command.startsWith(`${trivial} `))
            return false;
        if (trivial === "sed" && /\s-i(?:\s|$)/.test(command))
            return false;
        if (trivial === "find" && /\s(?:-delete|-exec)(?:\s|$)/.test(command))
            return false;
        return true;
    });
}
function hasMutationShellMarker(command) {
    return (/\|\s*xargs\b/.test(command) ||
        /\|\s*tee\b/.test(command) ||
        command.includes(">") ||
        command.includes("<<") ||
        /\bsed\b[^|;&]*\s-i(?:\S*)?(?:\s|$)/.test(command) ||
        /\bfind\b[\s\S]*(?:\s-delete\b|\s-exec\b)/.test(command));
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=tool-summary.js.map