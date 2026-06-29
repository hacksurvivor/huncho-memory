export type PathmarkRecordKind = "memory" | "conclusion";

export interface PathmarkRecord {
  id: string;
  kind: PathmarkRecordKind;
  text: string;
  tags: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface PathmarkConfig {
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
  record: PathmarkRecord;
  score: number;
  matchedTerms: string[];
}
