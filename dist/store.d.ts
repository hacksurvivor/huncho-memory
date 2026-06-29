import type { PathmarkConfig, PathmarkRecord, PathmarkRecordKind, SearchResult } from "./types.js";
export declare class PathmarkStore {
    private readonly config;
    constructor(config: PathmarkConfig);
    ensureReady(): Promise<void>;
    add(input: {
        kind: PathmarkRecordKind;
        text: string;
        tags?: string[];
        source?: string;
    }): Promise<PathmarkRecord>;
    all(options?: {
        includeDeleted?: boolean;
        kind?: PathmarkRecordKind;
    }): Promise<PathmarkRecord[]>;
    delete(id: string): Promise<PathmarkRecord | undefined>;
    search(input: {
        query: string;
        limit?: number;
        tags?: string[];
        kind?: PathmarkRecordKind;
    }): Promise<SearchResult[]>;
    private append;
    private rewrite;
}
