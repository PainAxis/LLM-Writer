import { create, insertMultiple, search, type Tokenizer } from '@orama/orama'
import { createTokenizer } from '@orama/tokenizers/mandarin'
import type {
  MemoryChapterInput,
  MemoryClue,
  MemoryEvidence,
  MemoryIndexStats,
  MemoryProjectInput,
  MemoryQuery,
  MemorySearchResult,
} from '../../types/memory'
import { chapterRevision } from './revision'

// Deliberately generous prototype limits, including novels well beyond 1M Chinese characters.
const MAX_CHARS = 20_000_000
const MAX_CHAPTER_CHARS = 2_000_000
const MAX_CHAPTERS = 10_000
const MAX_CLUES = 50_000
const MAX_DOCUMENTS = 100_000
const CHUNK_CHARS = 1_200
const LONG_PARAGRAPH_OVERLAP = 120

const schema = {
  projectId: 'enum',
  ordinal: 'number',
  kind: 'enum',
  content: 'string',
  title: 'string',
  annotations: 'string',
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
  return create({ schema, components: { tokenizer: createMemoryTokenizer() } })
}

type EvidenceRecord = Omit<MemoryEvidence, 'score' | 'reason'>
interface ReadyIndex {
  database: ReturnType<typeof createDatabase>
  project: MemoryProjectInput
  chapters: Map<string, MemoryChapterInput>
  revisions: Map<string, string>
  ordinals: Map<string, number>
  evidence: Map<string, EvidenceRecord>
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
  return { ...stats, chapters: stats.chapters.map(chapter => ({ ...chapter })) }
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

function validClue(clue: MemoryClue, chapter: MemoryChapterInput | undefined, revision: string | undefined): boolean {
  return Boolean(chapter && validString(clue.id, 256)
    && clue.sourceRevision === revision
    && Number.isSafeInteger(clue.start) && Number.isSafeInteger(clue.end)
    && clue.start >= 0 && clue.end > clue.start && clue.end <= chapter.text.length
    && validString(clue.quote, 4_000) && chapter.text.slice(clue.start, clue.end) === clue.quote
    && validString(clue.label, 300) && Array.isArray(clue.aliases) && clue.aliases.length <= 20
    && clue.aliases.every(alias => validString(alias, 100)))
}

/** A rebuildable, memory-only index. It owns its snapshot and never sends manuscript text anywhere. */
export class MemoryIndex {
  private epoch = 0
  private ready: ReadyIndex | undefined

  async sync(project: MemoryProjectInput): Promise<MemoryIndexStats> {
    const epoch = ++this.epoch
    // Invalidate BEFORE cloning/hashing: failed rebuilds must never resurrect old facts.
    this.ready = undefined
    const started = performance.now()
    const snapshot = snapshotProject(project)
    const chapters = new Map(snapshot.chapters.map(chapter => [chapter.id, chapter]))
    const revisions = new Map<string, string>()
    const ordinals = new Map<string, number>()
    const manifests: MemoryIndexStats['chapters'] = []
    const evidence = new Map<string, EvidenceRecord>()
    const database = createDatabase()
    let pending: Array<{ id: string; projectId: string; ordinal: number; kind: string; content: string; title: string; annotations: string }> = []
    const assertCurrent = () => {
      if (epoch !== this.epoch) throw new Error('索引构建已被较新的项目快照替代。')
    }
    const flush = async () => {
      if (pending.length) await insertMultiple(database, pending)
      pending = []
      assertCurrent()
    }
    const add = (record: EvidenceRecord, annotations = '') => {
      if (evidence.size >= MAX_DOCUMENTS) throw new Error('索引条目超过原型的 100,000 条上限。')
      evidence.set(record.id, record)
      pending.push({
        id: record.id,
        projectId: snapshot.id,
        ordinal: record.ordinal,
        kind: record.kind,
        content: record.quote,
        title: record.chapterTitle,
        annotations,
      })
    }

    let chars = 0
    let chunks = 0
    for (const [position, chapter] of snapshot.chapters.entries()) {
      const revision = await chapterRevision(chapter)
      assertCurrent()
      const ordinal = position + 1
      revisions.set(chapter.id, revision)
      ordinals.set(chapter.id, ordinal)
      manifests.push({ id: chapter.id, title: chapter.title, ordinal, revision, chars: chapter.text.length })
      chars += chapter.text.length
      for (const { start, end } of chunkSpans(chapter.text)) {
        add({
          id: `passage:${position}:${start}:${end}`,
          projectId: snapshot.id,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          ordinal,
          revision,
          start,
          end,
          quote: chapter.text.slice(start, end),
          kind: 'passage',
          label: '',
        })
        chunks++
        if (pending.length >= 64) await flush()
      }
    }

    let staleClues = 0
    const clueIds = new Set<string>()
    const acceptedClues: MemoryClue[] = []
    for (const [position, clue] of snapshot.clues.entries()) {
      const chapter = chapters.get(clue.chapterId)
      if (!validClue(clue, chapter, revisions.get(clue.chapterId)) || clueIds.has(clue.id)) {
        staleClues++
        continue
      }
      clueIds.add(clue.id)
      acceptedClues.push(clue)
      add({
        id: `clue:${position}`,
        projectId: snapshot.id,
        chapterId: chapter!.id,
        chapterTitle: chapter!.title,
        ordinal: ordinals.get(chapter!.id)!,
        revision: revisions.get(chapter!.id)!,
        start: clue.start,
        end: clue.end,
        quote: clue.quote,
        kind: 'clue',
        label: clue.label,
      }, [clue.label, ...clue.aliases].join('\n'))
      if (pending.length >= 64) await flush()
    }
    await flush()
    // Include order and author annotations, so an otherwise unchanged index has an unambiguous identity.
    const fingerprintBytes = new TextEncoder().encode(JSON.stringify([snapshot.id, manifests, acceptedClues]))
    const digest = await crypto.subtle.digest('SHA-256', fingerprintBytes)
    const fingerprint = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    assertCurrent()
    const stats: MemoryIndexStats = {
      projectId: snapshot.id, fingerprint, chapters: manifests,
      chunks, clues: acceptedClues.length, staleClues, chars, buildMs: performance.now() - started,
    }
    this.ready = { database, project: snapshot, chapters, revisions, ordinals, evidence, stats }
    return copyStats(stats)
  }

  async search(query: MemoryQuery): Promise<MemorySearchResult> {
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
    const started = performance.now()
    const text = query.text.trim()
    const limit = query.limit ?? 8
    const scores = new Map<string, number>()
    const reasons = new Map<string, string>()
    if (text) {
      // Each channel applies disclosure/project filters BEFORE ranking and top-k selection.
      // This is keyword + curated-clue fusion, not semantic/vector retrieval.
      for (const kind of ['passage', 'clue'] as const) {
        const result = await search(ready.database, {
          term: text,
          properties: kind === 'clue' ? ['annotations', 'content', 'title'] : ['content', 'title'],
          boost: kind === 'clue' ? { annotations: 2, content: 1, title: 0.3 } : { content: 1, title: 0.3 },
          // Orama 3.1.18 exact=true adds ASCII \b checks, which reject normal Han text.
          exact: false,
          threshold: 0.7,
          limit: Math.min(limit * 4, 200),
          where: { projectId: { eq: ready.project.id }, ordinal: { lte: cutoff }, kind: { eq: kind } },
        })
        result.hits.forEach((hit, rank) => {
          scores.set(hit.id, (scores.get(hit.id) ?? 0) + (kind === 'clue' ? 1.15 : 1) / (60 + rank + 1))
          reasons.set(hit.id, kind === 'clue' ? '作者伏笔标记（含标签／别名）与原文关键词匹配' : '原文／章节标题 BM25 关键词匹配')
        })
      }
    }
    if (epoch !== this.epoch || this.ready !== ready) throw new Error('稿件快照已变化，请重新检索。')
    const hits: MemoryEvidence[] = []
    for (const [id, score] of [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      const record = ready.evidence.get(id)
      if (!record) continue
      const chapter = ready.chapters.get(record.chapterId)
      // Independent final gate: a retrieval backend result alone never grants visibility.
      if (record.projectId !== ready.project.id || !chapter
        || ready.ordinals.get(chapter.id) !== record.ordinal || record.ordinal > cutoff
        || ready.revisions.get(chapter.id) !== record.revision
        || record.start < 0 || record.end > chapter.text.length
        || chapter.text.slice(record.start, record.end) !== record.quote) continue
      hits.push({ ...record, score, reason: reasons.get(id)! })
      if (hits.length === limit) break
    }
    return {
      projectId: ready.project.id,
      fingerprint: ready.stats.fingerprint,
      query: text,
      throughChapterId: query.throughChapterId,
      hits,
      searchMs: performance.now() - started,
      method: 'bm25+clues',
    }
  }
}
