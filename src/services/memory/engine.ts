import { create, insertMultiple, remove, search, type Tokenizer } from '@orama/orama'
import { createTokenizer } from '@orama/tokenizers/mandarin'
import type {
  MemoryChapterInput,
  MemoryClue,
  MemoryEvidence,
  MemoryIndexStats,
  MemoryProjectInput,
  MemoryQuery,
  MemoryRemoteOptions,
  MemoryRetrievalDiagnostics,
  MemorySearchResult,
} from '../../types/memory'
import { chapterRevision } from './revision'
import { identifierEdges, memoryIdentifiers } from './identifiers'
import { buildMemoryMatch, summarizeMemoryMatches } from './matchSignals'
import { embedMemoryTexts, normalizeEmbeddingConfig, normalizeRerankConfig, rerankMemoryTexts } from './providers'

// Deliberately generous prototype limits, including novels well beyond 1M Chinese characters.
const MAX_CHARS = 20_000_000
const MAX_CHAPTER_CHARS = 2_000_000
const MAX_CHAPTERS = 10_000
const MAX_CLUES = 50_000
const MAX_DOCUMENTS = 100_000
const CHUNK_CHARS = 1_200
const LONG_PARAGRAPH_OVERLAP = 120
const MAX_SEMANTIC_PASSAGES = 2_000
const MAX_VECTOR_BYTES = 32 * 1024 * 1024
const EMBEDDING_BATCH_SIZE = 32
const MAX_RERANK_CANDIDATES = 60
const REMOTE_BUDGET_MS = 65_000

const schema = {
  projectId: 'enum',
  chapterId: 'enum',
  kind: 'enum',
  content: 'string',
  title: 'string',
  annotations: 'string',
  identifiers: 'enum[]',
} as const

/** Mandarin words plus Han bigrams keep unfamiliar names searchable across segmentation choices. */
function createMemoryTokenizer(): Tokenizer {
  const mandarin = createTokenizer()
  return {
    language: 'mandarin',
    normalizationCache: new Map(),
    tokenize(raw, language, property) {
      const normalized = raw.toLocaleLowerCase('zh-CN')
      const tokens = new Set<string>()
      const singleCharacterQuery = Array.from(normalized.trim()).length === 1
      for (const word of mandarin.tokenize(normalized, language, property)) {
        // Unigram matches are useful for a one-character query, but swamp longer Chinese queries.
        if (/^\p{Script=Han}$/u.test(word)) {
          if (property || singleCharacterQuery) tokens.add(`c:${word}`)
        } else tokens.add(`w:${word}`)
      }
      for (const run of normalized.matchAll(/\p{Script=Han}+/gu)) {
        const chars = Array.from(run[0])
        // Index every Han character, including characters inside segmented multi-character words.
        if (property || singleCharacterQuery) for (const char of chars) tokens.add(`c:${char}`)
        for (let i = 0; i + 1 < chars.length; i++) tokens.add(`b:${chars[i]!}${chars[i + 1]!}`)
      }
      return [...tokens]
    },
  }
}

function createDatabase() {
  return create({ schema, sort: { enabled: false }, components: { tokenizer: createMemoryTokenizer() } })
}

type EvidenceRecord = Omit<MemoryEvidence, 'score' | 'reason' | 'match'>
interface IndexDocument {
  id: string
  projectId: string
  chapterId: string
  kind: string
  content: string
  title: string
  annotations: string
  identifiers: string[]
  identifierEdges: number
  annotationItems: readonly string[]
}

function sameDocument(left: IndexDocument, right: IndexDocument): boolean {
  return left.id === right.id && left.projectId === right.projectId && left.chapterId === right.chapterId
    && left.kind === right.kind && left.content === right.content && left.title === right.title
    && left.annotations === right.annotations && left.identifierEdges === right.identifierEdges
    && left.annotationItems.length === right.annotationItems.length
    && left.annotationItems.every((value, position) => value === right.annotationItems[position])
}
interface ReadyIndex {
  database: ReturnType<typeof createDatabase>
  project: MemoryProjectInput
  chapters: Map<string, MemoryChapterInput>
  revisions: Map<string, string>
  ordinals: Map<string, number>
  evidence: Map<string, EvidenceRecord>
  passages: Map<string, EvidenceRecord[]>
  documents: Map<string, IndexDocument>
  removedSinceRebuild: number
  stats: MemoryIndexStats
}

function validString(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= maximum && (allowEmpty || value.trim().length > 0)
}

function snapshotProject(project: MemoryProjectInput): MemoryProjectInput {
  if (!project || !validString(project.id, 256) || !validString(project.title, 1_000, true)
    || !Array.isArray(project.chapters) || project.chapters.length > MAX_CHAPTERS
    || !Array.isArray(project.clues) || project.clues.length > MAX_CLUES) {
    throw new Error('记忆项目格式无效，或超过原型容量上限。')
  }
  const ids = new Set<string>()
  let chars = 0
  const chapters = project.chapters.map(chapter => {
    if (!chapter || !validString(chapter.id, 256) || ids.has(chapter.id)
      || !validString(chapter.title, 1_000, true)
      || !validString(chapter.text, MAX_CHAPTER_CHARS, true)) {
      throw new Error('章节 ID 重复、章节格式无效，或单章超过 200 万字符。')
    }
    ids.add(chapter.id)
    chars += chapter.text.length
    if (chars > MAX_CHARS) throw new Error('原型单项目最多支持 2,000 万字符。')
    return { id: chapter.id, title: chapter.title, text: chapter.text }
  })
  // Clone accepted shapes before any await. Invalid clues are counted and omitted during sync.
  const clues = project.clues.map(clue => {
    if (!clue || (Array.isArray(clue.aliases) && clue.aliases.length > 20)) {
      // Preserve an invalid record for the stale counter without copying an unbounded array.
      return {} as MemoryClue
    }
    return {
      id: clue.id, chapterId: clue.chapterId, sourceRevision: clue.sourceRevision,
      start: clue.start, end: clue.end, quote: clue.quote, label: clue.label,
      aliases: Array.isArray(clue.aliases) ? [...clue.aliases] : clue.aliases,
    }
  })
  return { id: project.id, title: project.title, chapters, clues }
}

function copyStats(stats: MemoryIndexStats): MemoryIndexStats {
  return { ...stats, sync: { ...stats.sync }, chapters: stats.chapters.map(chapter => ({ ...chapter })) }
}

/** Compare the complete accepted source, never timestamps or only chapter lengths. */
function sameProjectSource(left: MemoryProjectInput, right: MemoryProjectInput): boolean {
  if (left.id !== right.id || left.title !== right.title
    || left.chapters.length !== right.chapters.length || left.clues.length !== right.clues.length) return false
  for (let i = 0; i < left.chapters.length; i++) {
    const a = left.chapters[i]!
    const b = right.chapters[i]!
    if (a.id !== b.id || a.title !== b.title || a.text !== b.text) return false
  }
  for (let i = 0; i < left.clues.length; i++) {
    const a = left.clues[i]!
    const b = right.clues[i]!
    if (!validClueShape(a) || !validClueShape(b)
      || a.id !== b.id || a.chapterId !== b.chapterId || a.sourceRevision !== b.sourceRevision
      || a.start !== b.start || a.end !== b.end || a.quote !== b.quote || a.label !== b.label
      || !Array.isArray(a.aliases) || !Array.isArray(b.aliases) || a.aliases.length !== b.aliases.length
      || a.aliases.some((alias, position) => alias !== b.aliases[position])) return false
  }
  return true
}

function safeBoundary(text: string, end: number): number {
  const previous = text.charCodeAt(end - 1)
  const next = text.charCodeAt(end)
  // Preserve malformed source text too: only a real high/low pair requires moving a boundary.
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? end - 1 : end
}

/** Pack short paragraphs; split long paragraphs with overlap, keeping exact source offsets. */
function* chunkSpans(text: string): Generator<{ start: number; end: number }> {
  let start = 0
  while (start < text.length) {
    while (start < text.length && /\s/u.test(text[start]!)) start++
    if (start === text.length) break
    const maximum = safeBoundary(text, Math.min(start + CHUNK_CHARS, text.length))
    let end = maximum
    let hasBoundary = maximum === text.length
    if (!hasBoundary) {
      const window = text.slice(start, maximum)
      const paragraph = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('\r'))
      if (paragraph >= CHUNK_CHARS / 3) {
        end = start + paragraph + 1
        hasBoundary = true
      } else {
        const sentences = [...window.matchAll(/[。！？.!?](?:[”」』"])?/gu)]
        const last = sentences.at(-1)
        if (last && last.index! >= CHUNK_CHARS / 3) {
          end = start + last.index! + last[0].length
          hasBoundary = true
        }
      }
    }
    const next = hasBoundary ? end : safeBoundary(text, end - LONG_PARAGRAPH_OVERLAP)
    while (end > start && /\s/u.test(text[end - 1]!)) end--
    if (end > start) yield { start, end }
    start = next
  }
}

function validClueShape(clue: MemoryClue): boolean {
  return Boolean(validString(clue.id, 256) && validString(clue.chapterId, 256)
    && typeof clue.sourceRevision === 'string' && /^[a-f0-9]{64}$/u.test(clue.sourceRevision)
    && Number.isSafeInteger(clue.start) && Number.isSafeInteger(clue.end)
    && clue.start >= 0 && clue.end > clue.start && validString(clue.quote, 4_000)
    && validString(clue.label, 300) && Array.isArray(clue.aliases) && clue.aliases.length <= 20
    && clue.aliases.every(alias => validString(alias, 100)))
}

function validClue(clue: MemoryClue, chapter: MemoryChapterInput | undefined, revision: string | undefined): boolean {
  return Boolean(chapter && validClueShape(clue) && clue.sourceRevision === revision
    && clue.end <= chapter.text.length && chapter.text.slice(clue.start, clue.end) === clue.quote)
}

interface CachedVector {
  projectId: string
  chapterId: string
  revision: string
  start: number
  end: number
  vector: Float32Array
}

function sourceKey(record: EvidenceRecord): string {
  return JSON.stringify([record.projectId, record.chapterId, record.revision, record.start, record.end])
}

/** Backend rankings never grant visibility, including before sending text to remote services. */
function isAllowed(record: EvidenceRecord, ready: ReadyIndex, cutoff: number): boolean {
  const chapter = ready.chapters.get(record.chapterId)
  return Boolean(chapter && record.projectId === ready.project.id
    && ready.ordinals.get(record.chapterId) === record.ordinal && record.ordinal <= cutoff
    && ready.revisions.get(record.chapterId) === record.revision
    && Number.isSafeInteger(record.start) && Number.isSafeInteger(record.end)
    && record.start >= 0 && record.end > record.start && record.end <= chapter.text.length
    && chapter.text.slice(record.start, record.end) === record.quote)
}

function cosine(left: Float32Array, right: Float32Array): number {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let i = 0; i < left.length; i++) {
    dot += left[i]! * right[i]!
    leftNorm += left[i]! ** 2
    rightNorm += right[i]! ** 2
  }
  return dot / Math.sqrt(leftNorm * rightNorm)
}

/** A rebuildable index with opt-in remote retrieval and a bounded, source-versioned vector cache. */
export class MemoryIndex {
  private epoch = 0
  private ready: ReadyIndex | undefined
  // An invalidated, completed snapshot can be reused only after a fresh source sync.
  // A build consumes this baseline exclusively before any await or database mutation.
  private retained: ReadyIndex | undefined
  private searchSequence = 0
  private searchController: AbortController | undefined
  private vectorCache = new Map<string, CachedVector>()
  private vectorBytes = 0
  // This private identity includes the credential so changing accounts cannot reuse another account's cache.
  // It is never returned, logged, or persisted. Individual cache keys contain source identities only.
  private cacheConfig = ''
  private cacheProjectId = ''

  private clearVectors() {
    this.vectorCache.clear()
    this.vectorBytes = 0
  }

  private cacheVector(record: EvidenceRecord, vector: Float32Array) {
    const key = sourceKey(record)
    const previous = this.vectorCache.get(key)
    if (previous) this.vectorBytes -= previous.vector.byteLength
    this.vectorCache.delete(key)
    if (vector.byteLength > MAX_VECTOR_BYTES) return
    while (this.vectorCache.size >= MAX_SEMANTIC_PASSAGES || this.vectorBytes + vector.byteLength > MAX_VECTOR_BYTES) {
      const oldest = this.vectorCache.entries().next().value
      if (!oldest) break
      this.vectorBytes -= oldest[1].vector.byteLength
      this.vectorCache.delete(oldest[0])
    }
    this.vectorCache.set(key, {
      projectId: record.projectId, chapterId: record.chapterId, revision: record.revision,
      start: record.start, end: record.end, vector,
    })
    this.vectorBytes += vector.byteLength
  }

  /** Hide stale evidence and cancel requests without discarding an untouched completed baseline. */
  invalidateSource(): void {
    ++this.epoch
    this.searchController?.abort()
    if (this.ready) this.retained = this.ready
    this.ready = undefined
  }

  async sync(project: MemoryProjectInput): Promise<MemoryIndexStats> {
    // Exclusive ownership: an overlapping sync must build its own database. It cannot
    // observe or republish this build's partially removed/inserted documents.
    const baseline = this.ready ?? this.retained
    this.ready = undefined
    this.retained = undefined
    const epoch = ++this.epoch
    this.searchController?.abort()
    const started = performance.now()
    const snapshot = snapshotProject(project)
    const previous = baseline?.project.id === snapshot.id ? baseline : undefined
    const assertCurrent = () => {
      if (epoch !== this.epoch) throw new Error('索引构建已被较新的项目快照替代。')
    }
    assertCurrent()
    if (previous && sameProjectSource(previous.project, snapshot)) {
      const stats: MemoryIndexStats = {
        ...previous.stats, buildMs: performance.now() - started,
        sync: {
          mode: 'unchanged', rebuiltChapters: 0, reusedChapters: snapshot.chapters.length,
          insertedDocuments: 0, removedDocuments: 0, reusedDocuments: previous.documents.size,
        },
      }
      this.ready = { ...previous, stats }
      return copyStats(stats)
    }
    if (this.cacheProjectId !== snapshot.id) this.clearVectors()
    this.cacheProjectId = snapshot.id
    const chapters = new Map(snapshot.chapters.map(chapter => [chapter.id, chapter]))
    const revisions = new Map<string, string>()
    const ordinals = new Map<string, number>()
    const manifests: MemoryIndexStats['chapters'] = []
    const evidence = new Map<string, EvidenceRecord>()
    const passages = new Map<string, EvidenceRecord[]>()
    const documents = new Map<string, IndexDocument>()
    const work: MemoryIndexStats['sync'] = {
      mode: previous ? 'incremental' : 'full', rebuiltChapters: 0, reusedChapters: 0,
      insertedDocuments: 0, removedDocuments: 0, reusedDocuments: 0,
    }
    const add = (record: EvidenceRecord, annotationItems: readonly string[] = []) => {
      if (evidence.size >= MAX_DOCUMENTS) throw new Error('索引条目超过原型的 100,000 条上限。')
      evidence.set(record.id, record)
      const old = previous?.documents.get(record.id)
      const document: IndexDocument = {
        id: record.id, projectId: snapshot.id, chapterId: record.chapterId, kind: record.kind,
        content: record.quote, title: record.chapterTitle, annotations: annotationItems.join('\n'), annotationItems,
        identifiers: [], identifierEdges: identifierEdges(chapters.get(record.chapterId)!.text, record.start, record.end),
      }
      if (old && sameDocument(old, document)) documents.set(record.id, old)
      else {
        document.identifiers = [...new Set([
          ...memoryIdentifiers(document.content, document.identifierEdges),
          ...memoryIdentifiers(document.title), ...memoryIdentifiers(document.annotations),
        ])]
        documents.set(record.id, document)
      }
    }

    let chars = 0
    let chunks = 0
    for (const [position, chapter] of snapshot.chapters.entries()) {
      const oldChapter = previous?.chapters.get(chapter.id)
      const unchanged = oldChapter?.title === chapter.title && oldChapter.text === chapter.text
      const revision = unchanged ? previous!.revisions.get(chapter.id)! : await chapterRevision(chapter)
      assertCurrent()
      const ordinal = position + 1
      revisions.set(chapter.id, revision)
      ordinals.set(chapter.id, ordinal)
      manifests.push({ id: chapter.id, title: chapter.title, ordinal, revision, chars: chapter.text.length })
      chars += chapter.text.length
      let chapterPassages: EvidenceRecord[]
      if (unchanged) {
        work.reusedChapters++
        chapterPassages = previous!.passages.get(chapter.id)!.map(record =>
          record.ordinal === ordinal ? record : { ...record, ordinal })
      } else {
        work.rebuiltChapters++
        chapterPassages = []
        for (const { start, end } of chunkSpans(chapter.text)) {
          chapterPassages.push({
            // Identity is independent of chapter order, revision, or shifting offsets.
            id: `passage:${JSON.stringify([chapter.id, chapterPassages.length])}`,
            projectId: snapshot.id, chapterId: chapter.id, chapterTitle: chapter.title,
            ordinal, revision, start, end, quote: chapter.text.slice(start, end), kind: 'passage', label: '',
          })
        }
      }
      passages.set(chapter.id, chapterPassages)
      for (const record of chapterPassages) add(record)
      chunks += chapterPassages.length
    }

    let staleClues = 0
    const clueIds = new Set<string>()
    const acceptedClues: MemoryClue[] = []
    for (const clue of snapshot.clues) {
      const chapter = chapters.get(clue.chapterId)
      if (!validClue(clue, chapter, revisions.get(clue.chapterId)) || clueIds.has(clue.id)) {
        staleClues++
        continue
      }
      clueIds.add(clue.id)
      acceptedClues.push(clue)
      add({
        id: `clue:${JSON.stringify(clue.id)}`,
        projectId: snapshot.id, chapterId: chapter!.id, chapterTitle: chapter!.title,
        ordinal: ordinals.get(chapter!.id)!, revision: revisions.get(chapter!.id)!,
        start: clue.start, end: clue.end, quote: clue.quote, kind: 'clue', label: clue.label,
      }, [clue.label, ...clue.aliases])
    }
    const fingerprintBytes = new TextEncoder().encode(JSON.stringify([snapshot.id, manifests, acceptedClues]))
    const digest = await crypto.subtle.digest('SHA-256', fingerprintBytes)
    const fingerprint = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    assertCurrent()

    let removals = previous ? [...previous.documents.keys()].filter(id => previous.documents.get(id) !== documents.get(id)) : []
    // Orama retains empty token nodes and internal IDs after removal. Periodic rebuilds
    // bound edit-history growth instead of keeping every retired term for a long session.
    const removedSinceRebuild = (previous?.removedSinceRebuild ?? 0) + removals.length
    const compact = previous && removedSinceRebuild > Math.max(1_024, documents.size * 2)
    const database = previous && !compact ? previous.database : createDatabase()
    if (compact) {
      work.mode = 'full'
      removals = []
    }
    const additions = [...documents.values()].filter(document => !previous || compact || previous.documents.get(document.id) !== document)
    work.removedDocuments = removals.length
    work.insertedDocuments = additions.length
    work.reusedDocuments = documents.size - additions.length
    const yieldToMessages = async () => {
      // A real task yield lets worker invalidation/cancel messages interrupt large edits.
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      assertCurrent()
    }
    // removeMultiple in Orama 3.1.18 returns before later timer batches finish.
    // Own these batches and await each public remove so publication is truly complete.
    for (let offset = 0; offset < removals.length; offset += 64) {
      assertCurrent()
      for (const id of removals.slice(offset, offset + 64)) {
        if (!await remove(database, id)) throw new Error('索引增量移除失败，请重新构建。')
        assertCurrent()
      }
      await yieldToMessages()
    }
    for (let offset = 0; offset < additions.length; offset += 64) {
      assertCurrent()
      await insertMultiple(database, additions.slice(offset, offset + 64))
      await yieldToMessages()
    }
    assertCurrent()
    const stats: MemoryIndexStats = {
      projectId: snapshot.id, fingerprint, chapters: manifests,
      chunks, clues: acceptedClues.length, staleClues, chars, buildMs: performance.now() - started, sync: work,
    }
    const activeKeys = new Set([...evidence.values()].filter(record => record.kind === 'passage').map(sourceKey))
    for (const [key, entry] of this.vectorCache) {
      if (!activeKeys.has(key)) {
        this.vectorBytes -= entry.vector.byteLength
        this.vectorCache.delete(key)
      }
    }
    this.ready = {
      database, project: snapshot, chapters, revisions, ordinals, evidence, passages, documents, stats,
      removedSinceRebuild: previous && !compact ? removedSinceRebuild : 0,
    }
    return copyStats(stats)
  }

  async search(query: MemoryQuery, options?: MemoryRemoteOptions, beforeRemote?: () => Promise<void>): Promise<MemorySearchResult> {
    this.searchController?.abort()
    const sequence = ++this.searchSequence
    const controller = new AbortController()
    this.searchController = controller
    const ready = this.ready
    const epoch = this.epoch
    if (!ready) throw new Error('索引尚未就绪，请先根据当前稿件重建。')
    if (!query || !validString(query.text, 512, true)
      || !validString(query.throughChapterId, 256)
      || (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 50))) {
      throw new Error('检索条件无效：查询最多 512 字符，结果数为 1–50。')
    }
    const cutoff = ready.ordinals.get(query.throughChapterId)
    if (cutoff === undefined) throw new Error('披露截止章节不存在；检索已阻止。')
    const disclosedChapterIds = ready.project.chapters.slice(0, cutoff).map(chapter => chapter.id)
    // Snapshot primitive settings and query before the first await; callers may mutate UI objects.
    const embeddingInput = options?.embedding ? { ...options.embedding } : undefined
    const rerankInput = options?.rerank ? { ...options.rerank } : undefined
    const throughChapterId = query.throughChapterId
    const started = performance.now()
    const text = query.text.trim()
    const identifiers = new Set(memoryIdentifiers(text))
    const coverage = (document: { identifiers: Array<string | number> }) => document.identifiers.reduce<number>(
      (count, identifier) => count + Number(typeof identifier === 'string' && identifiers.has(identifier)), 0)
    const limit = query.limit ?? 8
    const diagnostics: MemoryRetrievalDiagnostics = {
      semantic: embeddingInput ? 'fallback' : 'disabled',
      rerank: rerankInput ? 'skipped' : 'disabled',
      eligiblePassages: 0, embeddedPassages: 0, cachedPassages: 0, rerankedCandidates: 0,
      warnings: [],
    }
    const assertCurrent = () => {
      if (epoch !== this.epoch || this.ready !== ready || sequence !== this.searchSequence) {
        throw new Error('稿件快照已变化，或检索已被新的请求替代，请重新检索。')
      }
    }
    const assertRemoteReady = () => {
      assertCurrent()
      if (controller.signal.aborted) throw new Error('远程检索时间预算已用完。')
    }
    let sourceGuardFailed = false
    const beforeRemoteRequest = async () => {
      assertRemoteReady()
      try {
        await beforeRemote?.()
        assertRemoteReady()
      } catch {
        sourceGuardFailed = true
        controller.abort()
        throw new Error('已保存稿件或关系标注已改变，已阻止远程检索，请重新预览。')
      }
    }
    const timer = embeddingInput || rerankInput
      ? setTimeout(() => controller.abort(), REMOTE_BUDGET_MS) : undefined
    const scores = new Map<string, number>()
    const reasons = new Map<string, string[]>()
    const addRank = (id: string, rank: number, weight: number, reason: string) => {
      const record = ready.evidence.get(id)
      if (!record || !isAllowed(record, ready, cutoff)) return
      scores.set(id, (scores.get(id) ?? 0) + weight / (60 + rank + 1))
      reasons.set(id, [...(reasons.get(id) ?? []), reason])
    }
    try {
      if (text) {
        let hasIdentifierMatches = false
        // Each local channel filters disclosure/project BEFORE ranking and top-k selection.
        for (const kind of ['passage', 'clue'] as const) {
          const properties = kind === 'clue' ? ['annotations', 'content', 'title'] as const : ['content', 'title'] as const
          const boost = kind === 'clue' ? { annotations: 2, content: 1, title: 0.3 } : { content: 1, title: 0.3 }
          const where = { projectId: { eq: ready.project.id }, chapterId: { in: disclosedChapterIds }, kind: { eq: kind } }
          const candidateLimit = Math.min(limit * 4, 200)
          const result = await search(ready.database, {
            term: text,
            properties: [...properties], boost,
            // Orama 3.1.18 exact=true adds ASCII \b checks, which reject normal Han text.
            exact: false,
            threshold: 0.7,
            limit: candidateLimit, where,
          })
          assertCurrent()
          // Enum postings rescue complete codes before BM25's length bias and top-k.
          // Coverage only reads indexed token arrays, never scans manuscript text per query.
          const exact = identifiers.size ? await search(ready.database, {
            term: text, properties: [...properties], boost, exact: false, threshold: 1,
            where: { ...where, identifiers: { containsAny: [...identifiers] } }, limit: candidateLimit,
            sortBy: (a, b) => coverage(b[2]) - coverage(a[2]) || b[1] - a[1]
              || String(a[2].id).localeCompare(String(b[2].id)),
          }) : undefined
          assertCurrent()
          if (exact?.hits.length) hasIdentifierMatches = true
          const ordered = new Map((exact?.hits ?? []).map(hit => [hit.id, hit]))
          for (const hit of result.hits) if (!ordered.has(hit.id)) ordered.set(hit.id, hit)
          // Give the best result from each channel a comparable chance to survive fusion.
          // A fixed clue bonus otherwise lets ten weak clue matches outrank the best passage;
          // author labels/aliases already receive a boost within their own BM25 channel.
          ;[...ordered.values()].slice(0, candidateLimit).forEach((hit, rank) => {
            const document = ready.documents.get(hit.id)!
            const sources = identifiers.size ? [
              [memoryIdentifiers(document.content, document.identifierEdges), '原文'],
              [memoryIdentifiers(document.title), '章节标题'],
              [memoryIdentifiers(document.annotations), '作者标签／别名'],
            ] as const : []
            const matched = sources.filter(([values]) => values.some(value => identifiers.has(value))).map(([, label]) => label)
            addRank(hit.id, rank, 1, matched.length ? `完整编号匹配（${matched.join('、')}）`
              : kind === 'clue' ? '作者伏笔标记（含标签／别名）与原文关键词匹配' : '原文／章节标题 BM25 关键词匹配')
          })
        }
        if (hasIdentifierMatches) {
          // Treat bounded local evidence as one channel for code queries. Complete
          // multi-code coverage leads locally; semantic fusion and remote rerank still follow.
          const local = [...scores].sort((a, b) => coverage(ready.documents.get(b[0])!) - coverage(ready.documents.get(a[0])!)
            || b[1] - a[1] || a[0].localeCompare(b[0]))
          local.forEach(([id], rank) => scores.set(id, 1 / (60 + rank + 1)))
        }
      }
      const eligible = [...ready.evidence.values()].filter(record => record.kind === 'passage' && isAllowed(record, ready, cutoff))
      diagnostics.eligiblePassages = eligible.length
      if (!embeddingInput) {
        this.clearVectors()
        this.cacheConfig = ''
      } else {
        let config: ReturnType<typeof normalizeEmbeddingConfig> | undefined
        try {
          config = normalizeEmbeddingConfig(embeddingInput)
          const identity = JSON.stringify([config.protocol, config.endpoint, config.model, config.dimensions, config.apiKey])
          if (identity !== this.cacheConfig) this.clearVectors()
          this.cacheConfig = identity
        } catch {
          this.clearVectors()
          this.cacheConfig = ''
          diagnostics.warnings.push('嵌入设置无效，已保留本地关键词和伏笔结果。')
        }
        if (config && text && eligible.length) {
          try {
            if (eligible.length > MAX_SEMANTIC_PASSAGES) {
              diagnostics.warnings.push('当前披露范围超过 2,000 个片段，语义检索已回退为本地检索；未发送部分章节建立不完整索引。')
            } else {
              const vectors = new Map<string, Float32Array>()
              const missing: EvidenceRecord[] = []
              for (const record of eligible) {
                const cached = this.vectorCache.get(sourceKey(record))
                if (cached) {
                  vectors.set(record.id, cached.vector)
                  diagnostics.cachedPassages++
                } else missing.push(record)
              }
              for (let start = 0; start < missing.length; start += EMBEDDING_BATCH_SIZE) {
                await beforeRemoteRequest()
                const batch = missing.slice(start, start + EMBEDDING_BATCH_SIZE)
                // Recheck immediately before every outbound batch, never send undisclosed chapter text.
                if (!batch.every(record => isAllowed(record, ready, cutoff))) throw new Error('稿件依据失效。')
                const returned = await embedMemoryTexts(config, batch.map(record => record.quote), 'retrieval.passage', controller.signal)
                assertCurrent()
                assertRemoteReady()
                for (const [position, raw] of returned.entries()) {
                  const record = batch[position]!
                  const vector = new Float32Array(raw)
                  vectors.set(record.id, vector)
                  this.cacheVector(record, vector)
                  diagnostics.embeddedPassages++
                }
              }
              await beforeRemoteRequest()
              const queryVectors = await embedMemoryTexts(config, [text], 'retrieval.query', controller.signal)
              assertCurrent()
              assertRemoteReady()
              const queryVector = new Float32Array(queryVectors[0]!)
              const ranked = eligible.map(record => ({ id: record.id, similarity: cosine(queryVector, vectors.get(record.id)!) }))
                .filter(item => Number.isFinite(item.similarity) && item.similarity > 0)
                .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id))
                .slice(0, Math.min(limit * 4, 200))
              ranked.forEach((item, rank) => addRank(item.id, rank, 1, '原文片段语义相似度匹配'))
              diagnostics.semantic = 'used'
            }
          } catch {
            if (sourceGuardFailed) throw new Error('稿件依据校验失败，已阻止远程检索，请重新预览。')
            assertCurrent()
            diagnostics.semantic = 'fallback'
            diagnostics.warnings.push('语义检索不可用或超时，已保留本地关键词和伏笔结果。')
          }
        }
      }
      assertCurrent()
      let ranked = [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      if (rerankInput && text && ranked.length) {
        try {
          const config = normalizeRerankConfig(rerankInput)
          const candidates = ranked.slice(0, MAX_RERANK_CANDIDATES)
            .map(([id]) => ready.evidence.get(id)!)
            .filter(record => isAllowed(record, ready, cutoff))
          await beforeRemoteRequest()
          const returned = await rerankMemoryTexts(config, text, candidates.map(record => record.quote), controller.signal)
          assertCurrent()
          assertRemoteReady()
          const seen = new Set<number>()
          for (const item of returned) {
            if (!Number.isSafeInteger(item.index) || item.index < 0 || item.index >= candidates.length
              || !Number.isFinite(item.score) || seen.has(item.index)) throw new Error('重排映射无效。')
            seen.add(item.index)
          }
          if (!returned.length) throw new Error('重排映射为空。')
          const reranked = returned.slice().sort((a, b) => b.score - a.score || a.index - b.index)
            .map(item => [candidates[item.index]!.id, item.score] as [string, number])
          const rerankedIds = new Set(reranked.map(([id]) => id))
          for (const [id] of reranked) reasons.set(id, [...reasons.get(id)!, '远程重排'])
          // Candidates outside the remote cap retain their original fusion order after the reranked candidates.
          ranked = [...reranked, ...ranked.filter(([id]) => !rerankedIds.has(id))]
          diagnostics.rerank = 'used'
          diagnostics.rerankedCandidates = returned.length
        } catch {
          if (sourceGuardFailed) throw new Error('稿件依据校验失败，已阻止远程检索，请重新预览。')
          assertCurrent()
          diagnostics.rerank = 'fallback'
          diagnostics.warnings.push('重排不可用或超时，已保留融合检索顺序。')
        }
      }
      assertCurrent()
      const hits: MemoryEvidence[] = []
      for (const [id, score] of ranked) {
        const record = ready.evidence.get(id)
        if (!record || !isAllowed(record, ready, cutoff)) continue
        const document = ready.documents.get(id)!
        hits.push({ ...record, score, reason: reasons.get(id)!.join('；'), match: buildMemoryMatch(text, {
          quote: record.quote, chapterTitle: record.chapterTitle,
          quoteEdges: document.identifierEdges, annotations: document.annotationItems,
        }) })
        if (hits.length === limit) break
      }
      return {
        projectId: ready.project.id, fingerprint: ready.stats.fingerprint,
        query: text, throughChapterId, hits, assessment: summarizeMemoryMatches(text, hits.map(hit => hit.match!)),
        searchMs: performance.now() - started,
        method: diagnostics.semantic === 'used' ? 'bm25+clues+semantic' : 'bm25+clues', diagnostics,
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (this.searchController === controller) this.searchController = undefined
    }
  }
}
