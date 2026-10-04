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
  method: 'bm25+clues'
}

export type MemoryWorkerRequest =
  | { id: number; type: 'sync'; project: MemoryProjectInput }
  | { id: number; type: 'search'; query: MemoryQuery }

export type MemoryWorkerResponse =
  | { id: number; ok: true; type: 'sync'; result: MemoryIndexStats }
  | { id: number; ok: true; type: 'search'; result: MemorySearchResult }
  | { id: number; ok: false; error: string }
