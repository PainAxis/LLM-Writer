/** Chapter-grounded retrieval prototype. All offsets use UTF-16 code units. */
export interface MemoryChapterInput {
  id: string
  title: string
  text: string
}

/** Author-marked clue, tied to an exact revision and original quote. */
export interface MemoryClue {
  id: string
  chapterId: string
  sourceRevision: string
  start: number
  end: number
  quote: string
  label: string
  aliases: string[]
}

export interface MemoryProjectInput {
  id: string
  title: string
  /** Narrative disclosure order; never inferred from chapter IDs or story dates. */
  chapters: MemoryChapterInput[]
  clues: MemoryClue[]
}

export interface MemoryChapterManifest {
  id: string
  title: string
  ordinal: number
  revision: string
  chars: number
}

export interface MemoryIndexStats {
  projectId: string
  fingerprint: string
  chapters: MemoryChapterManifest[]
  chunks: number
  clues: number
  staleClues: number
  chars: number
  buildMs: number
}

export interface MemoryQuery {
  text: string
  /** Inclusive last disclosed chapter, independent of event time. */
  throughChapterId: string
  limit?: number
}

/** Route-session settings only. Never persist credentials or include them in results. */
export interface MemoryEmbeddingConfig {
  protocol: 'jina' | 'openai-compatible'
  endpoint: string
  model: string
  apiKey: string
  dimensions: number
}

export interface MemoryRerankConfig {
  endpoint: string
  model: string
  apiKey: string
}

export interface MemoryRemoteOptions {
  embedding?: MemoryEmbeddingConfig
  rerank?: MemoryRerankConfig
}

export interface MemoryRetrievalDiagnostics {
  semantic: 'disabled' | 'used' | 'fallback'
  rerank: 'disabled' | 'used' | 'fallback' | 'skipped'
  eligiblePassages: number
  embeddedPassages: number
  cachedPassages: number
  rerankedCandidates: number
  /** Safe local messages; never provider response bodies or request credentials. */
  warnings: string[]
}

export interface MemoryEvidence {
  id: string
  projectId: string
  chapterId: string
  chapterTitle: string
  ordinal: number
  revision: string
  start: number
  end: number
  quote: string
  kind: 'passage' | 'clue'
  label: string
  score: number
  reason: string
}

export interface MemorySearchResult {
  projectId: string
  fingerprint: string
  query: string
  throughChapterId: string
  hits: MemoryEvidence[]
  searchMs: number
  method: 'bm25+clues' | 'bm25+clues+semantic'
  diagnostics: MemoryRetrievalDiagnostics
}

export type MemoryWorkerRequest =
  | { id: number; type: 'sync'; project: MemoryProjectInput }
  | { id: number; type: 'search'; query: MemoryQuery; options?: MemoryRemoteOptions }

export type MemoryWorkerResponse =
  | { id: number; ok: true; type: 'sync'; result: MemoryIndexStats }
  | { id: number; ok: true; type: 'search'; result: MemorySearchResult }
  | { id: number; ok: false; error: string }
