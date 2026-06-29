import type { PathmarkConfig, PathmarkRecord, PathmarkRecordDraft, PathmarkRecordKind, SearchResult } from "./types.js";
export declare class PathmarkStore {
    private readonly config;
    constructor(config: PathmarkConfig);
    ensureReady(): Promise<void>;
    add(input: PathmarkRecordDraft): Promise<PathmarkRecord>;
    addRecord(input: PathmarkRecordDraft): Promise<{
        record: PathmarkRecord;
        created: boolean;
    }>;
    all(options?: {
        includeDeleted?: boolean;
        kind?: PathmarkRecordKind;
    }): Promise<PathmarkRecord[]>;
    count(): Promise<number>;
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
