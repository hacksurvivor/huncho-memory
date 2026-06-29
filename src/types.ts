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
  synthesisProvider: "client" | "command" | "codex" | "openai-compatible";
  chatCommand?: string;
  codexCommand: string;
  codexModel?: string;
  openaiBaseUrl: string;
  openaiApiKey?: string;
  openaiModel?: string;
  chatTimeoutMs: number;
  maxSearchResults: number;
}

export interface SearchResult {
  record: PathmarkRecord;
  score: number;
  matchedTerms: string[];
}
