import { createHash } from "node:crypto";
export function deterministicId(parts) {
    const hash = createHash("sha256").update(parts.join("\u001f")).digest("hex");
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
//# sourceMappingURL=ids.js.map