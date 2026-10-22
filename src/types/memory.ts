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
  /** Work performed for this validated sync; documents include passages and accepted clues. */
  sync: {
    mode: 'full' | 'incremental' | 'unchanged'
    rebuiltChapters: number
    reusedChapters: number
    insertedDocuments: number
    /** Documents removed in-place; a discarded full index is not counted. */
    removedDocuments: number
    reusedDocuments: number
  }
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

/** Explicit, bounded author authorization. Processing time excludes decision waits. */
export interface MemoryFullScanOptions {
  maxCalls: number
  maxActiveMs: number
}

export interface MemoryFullScanHandle {
  sessionId: string
  generation: number
}

/** Counts only. No source text, intermediate hits, provider identities, or vectors. */
export interface MemoryFullScanProgress extends MemoryFullScanHandle {
  eligiblePassages: number
  cachedPassages: number
  missingPassages: number
  scoredPassages: number
  embeddedPassages: number
  scoredCachedPassages: number
  sourceChars: number
  attemptedSourceChars: number
  queryCalls: number
  passageCalls: number
  rerankCalls: number
  callsAttempted: number
  callsApproved: number
  activeMsUsed: number
  activeMsApproved: number
  coldEstimatedCalls: number
  currentEstimatedCalls: number
  /** Absolute wall-clock expiry; not an extra processing-time allowance. */
  expiresAt: number
}

export interface MemoryFullScanGrant extends MemoryFullScanHandle {
  grantId: string
  addCalls: number
  addActiveMs: number
}

export type MemoryFullScanDecision =
  | ({ type: 'continue' } & MemoryFullScanGrant)
  | ({ type: 'use-local' | 'cancel' } & MemoryFullScanHandle)

export interface MemoryFullScanPause {
  reason: 'ready' | 'budget' | 'provider'
  progress: MemoryFullScanProgress
}

export interface MemorySearchControls {
  signal?: AbortSignal
  onProgress?: (progress: MemoryFullScanProgress) => void
  onPause?: (pause: MemoryFullScanPause) => Promise<MemoryFullScanDecision> | MemoryFullScanDecision
}

export type MemoryFullScanPage =
  | { state: 'ready' | 'page-complete' | 'paused-budget' | 'paused-provider'; progress: MemoryFullScanProgress }
  | { state: 'complete'; progress: MemoryFullScanProgress; result: MemorySearchResult }

export interface MemoryFullScanDiagnostics extends MemoryFullScanProgress {
  status: 'complete' | 'stopped-local'
  coverage: 'complete' | 'incomplete'
}

export interface MemoryRemoteOptions {
  fullScan?: MemoryFullScanOptions
  embedding?: MemoryEmbeddingConfig
  rerank?: MemoryRerankConfig
}

export interface MemoryRetrievalDiagnostics {
  fullScan?: MemoryFullScanDiagnostics
  semantic: 'disabled' | 'used' | 'fallback'
  rerank: 'disabled' | 'used' | 'fallback' | 'skipped'
  eligiblePassages: number
  embeddedPassages: number
  cachedPassages: number
  rerankedCandidates: number
  /** Safe local messages; never provider response bodies or request credentials. */
  warnings: string[]
}

/** Reproducible query contact only. Neither literal contact nor a model score proves an answer. */
export interface MemoryMatchSignals {
  version: 1
  answerability: 'unverified'
  literal: { quote: boolean; title: boolean; annotation: boolean }
  /** Intersections with the requested identifiers; never arbitrary annotation text. */
  identifiers: { quote: string[]; title: string[]; annotation: string[] }
}

/** Describes only the supplied candidates/selection, never absence from the whole manuscript. */
export interface MemoryMatchSummary {
  answerability: 'unverified'
  state: 'none' | 'candidates' | 'matched'
  requestedIdentifiers: string[]
  missingIdentifiers: string[]
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
  /** Optional for legacy callers; production retrieval always supplies structured signals. */
  match?: MemoryMatchSignals
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
  assessment?: MemoryMatchSummary
}

export type MemoryWorkerRequest =
  | { id: number; type: 'invalidate' }
  | { id: number; type: 'sync'; project: MemoryProjectInput }
  | { id: number; type: 'search'; query: MemoryQuery; options?: MemoryRemoteOptions; guardRemote?: boolean }
  | { id: number; type: 'full-scan-start'; handle: MemoryFullScanHandle; query: MemoryQuery; options: MemoryRemoteOptions; guardRemote?: boolean }
  | { id: number; type: 'full-scan-advance'; handle: MemoryFullScanHandle }
  | { id: number; type: 'full-scan-resume'; grant: MemoryFullScanGrant }
  | { id: number; type: 'full-scan-local'; handle: MemoryFullScanHandle }
  | { id: number; type: 'full-scan-cancel'; handle: MemoryFullScanHandle }
  | { id: number; type: 'remote-ack'; guardId: number; ok: boolean; handle?: MemoryFullScanHandle }

export type MemoryWorkerResponse =
  | { id: number; ok: true; type: 'full-scan'; page: MemoryFullScanPage }
  | { id: number; ok: true; type: 'full-scan-local'; handle: MemoryFullScanHandle; result: MemorySearchResult }
  | { id: number; ok: true; type: 'full-scan-cancel'; handle: MemoryFullScanHandle }
  | { id: number; ok: true; type: 'remote-check'; guardId: number; handle?: MemoryFullScanHandle }
  | { id: number; ok: true; type: 'sync'; result: MemoryIndexStats }
  | { id: number; ok: true; type: 'search'; result: MemorySearchResult }
  | { id: number; ok: false; error: string; handle?: MemoryFullScanHandle }
