export type HunchoRecordKind = "memory" | "conclusion";

export interface HunchoRecord {
  id: string;
  kind: HunchoRecordKind;
  text: string;
  tags: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface HunchoConfig {
  storeDir: string;
  memoryFile: string;
  synthesisProvider: "client" | "command" | "codex";
  chatCommand?: string;
  codexCommand: string;
  codexModel?: string;
  chatTimeoutMs: number;
  maxSearchResults: number;
}

export interface SearchResult {
  record: HunchoRecord;
  score: number;
  matchedTerms: string[];
}
