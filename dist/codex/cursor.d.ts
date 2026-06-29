export interface CaptureCursor {
    count: number;
    updatedAt: string;
}
export declare function cursorPath(storeDir: string, sessionId: string): string;
export declare function readCursor(storeDir: string, sessionId: string): Promise<number>;
export declare function writeCursor(storeDir: string, sessionId: string, count: number): Promise<void>;
