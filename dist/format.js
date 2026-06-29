export function jsonText(value) {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(value, null, 2),
            },
        ],
    };
}
export function publicConfig(config) {
    return {
        storeDir: config.storeDir,
        memoryFile: config.memoryFile,
        synthesisProvider: config.synthesisProvider,
        chatCommand: config.chatCommand ? "configured" : "not_configured",
        codexCommand: config.codexCommand,
        codexModel: config.codexModel ?? "default",
        openaiBaseUrl: config.openaiBaseUrl,
        openaiApiKey: config.openaiApiKey ? "set" : "missing",
        openaiModel: config.openaiModel ?? "unset",
        chatTimeoutMs: config.chatTimeoutMs,
        maxSearchResults: config.maxSearchResults,
    };
}
export function summarizeRecords(records) {
    if (records.length === 0)
        return "No records found.";
    return records
        .map((record) => {
        const tagText = record.tags.length > 0 ? ` tags=${record.tags.join(",")}` : "";
        return `- ${record.kind} ${record.id} (${record.createdAt}${tagText})\n  ${record.text}`;
    })
        .join("\n");
}
export function summarizeSearch(results) {
    if (results.length === 0)
        return "No matching memory found.";
    return results
        .map((result) => {
        const record = result.record;
        const matches = result.matchedTerms.length > 0 ? ` matches=${result.matchedTerms.join(",")}` : "";
        const tagText = record.tags.length > 0 ? ` tags=${record.tags.join(",")}` : "";
        return `- ${record.kind} ${record.id} score=${result.score}${matches} (${record.createdAt}${tagText})\n  ${record.text}`;
    })
        .join("\n");
}
//# sourceMappingURL=format.js.map