import os from "node:os";
import path from "node:path";
function expandHome(input) {
    if (input === "~")
        return os.homedir();
    if (input.startsWith("~/"))
        return path.join(os.homedir(), input.slice(2));
    return input;
}
export function codexHome() {
    return path.resolve(expandHome(process.env.CODEX_HOME ?? "~/.codex"));
}
export function codexHooksPath() {
    return path.join(codexHome(), "hooks.json");
}
export function codexConfigPath() {
    return path.join(codexHome(), "config.toml");
}
export function pathmarkStoreDir() {
    return path.resolve(expandHome(process.env.PATHMARK_STORE_DIR ?? "~/.pathmark/memory"));
}
export function codexCursorDir(storeDir = pathmarkStoreDir()) {
    return path.join(storeDir, "codex-cursors");
}
//# sourceMappingURL=paths.js.map