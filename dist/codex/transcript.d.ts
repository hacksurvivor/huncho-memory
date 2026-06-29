export interface CodexTurn {
    role: "user" | "assistant";
    text: string;
    at?: string;
    index: number;
}
export declare function readCodexTranscript(file: string): Promise<CodexTurn[]>;
export declare function parseTranscriptEvent(event: unknown, index: number): CodexTurn | undefined;
