export interface RedactionResult {
    text: string;
    redacted: boolean;
}
export declare function redactSecrets(text: string): RedactionResult;
