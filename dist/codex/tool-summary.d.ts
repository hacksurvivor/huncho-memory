export interface ToolHookInput {
    tool_name?: string;
    tool_input?: unknown;
}
export declare function summarizeToolUse(input: ToolHookInput): string;
