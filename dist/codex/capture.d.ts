export interface CodexHookInput {
    cwd?: string;
    session_id?: string;
    prompt?: string;
    transcript_path?: string;
    tool_name?: string;
    tool_input?: unknown;
}
export declare function recall(input: CodexHookInput): Promise<string>;
export declare function prompt(input: CodexHookInput): Promise<string>;
export declare function observe(input: CodexHookInput): Promise<string>;
export declare function writeback(input: CodexHookInput): Promise<string>;
