import type { MemoryIndexStats, MemoryProjectInput } from '../../types/memory'
import type {
  FactAnchor, FactEntity, FactEntityType, FactGraphDocument, FactGraphNode,
  FactGraphSelection, FactRelation, VisibleFactAnchor, VisibleFactRelation,
  FactCandidateProvenance, FactPlotLink, FactPlotPremise, FactPlotLinkSelection, VisibleFactPlotLink,
} from '../../types/factGraph'
import { chapterRevision } from './revision'

export const FACT_GRAPH_MAX_RELATIONS = 10_000
export const FACT_GRAPH_MAX_PLOT_LINKS = 2_000
export const FACT_GRAPH_VISIBLE_LIMIT = 200
export const FACT_GRAPH_MAX_QUOTE_CHARS = 8_000_000
export const FACT_GRAPH_MAX_DOCUMENT_CHARS = 24_000_000
const ENTITY_TYPES: FactEntityType[] = ['person', 'event', 'object', 'place']

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function string(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= maximum && (allowEmpty || value.trim().length > 0)
}

export class FactGraphValidationError extends Error {
  constructor(readonly code: 'invalid-data' | 'unsupported-version', message: string) {
    super(message)
    this.name = 'FactGraphValidationError'
  }
}

function invalid(): never {
  throw new FactGraphValidationError('invalid-data', '事实关系图格式无效或超过容量上限；原有数据不会被自动覆盖。')
}

/** Future formats are not corrupt legacy data and must never be repaired over. */
export function assertFactGraphSupportedVersion(value: unknown): void {
  if (record(value) && Object.hasOwn(value, 'version') && value.version !== 1 && value.version !== 2) {
    throw new FactGraphValidationError('unsupported-version', '不支持的事实关系图版本（unsupported-version）；请使用支持该版本的应用，原有数据不会被覆盖。')
  }
}

function provenance(value: unknown): FactCandidateProvenance {
  if (!record(value) || !string(value.campaignId, 256) || !string(value.segmentId, 256)
    || !string(value.jobId, 256) || !string(value.candidateId, 256)) return invalid()
  return { campaignId: value.campaignId, segmentId: value.segmentId, jobId: value.jobId, candidateId: value.candidateId }
}

function entity(value: unknown): FactEntity {
  if (!record(value) || !ENTITY_TYPES.includes(value.type as FactEntityType) || !string(value.label, 120)) return invalid()
  return { type: value.type as FactEntityType, label: value.label }
}

function anchor(value: unknown): FactAnchor {
  if (!record(value) || !string(value.chapterId, 256) || typeof value.sourceRevision !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.sourceRevision) || !Number.isSafeInteger(value.start)
    || !Number.isSafeInteger(value.end) || typeof value.start !== 'number' || typeof value.end !== 'number'
    || value.start < 0 || value.end <= value.start || !string(value.quote, 2_000)
    || value.end - value.start !== value.quote.length) return invalid()
  return {
    chapterId: value.chapterId, sourceRevision: value.sourceRevision,
    start: value.start, end: value.end, quote: value.quote,
  }
}

/** Validate one typed proposal, retaining every premise role and source revision. */
export function validateFactPlotLink(value: unknown, expectedProjectId?: string): FactPlotLink {
  if (!record(value) || !string(value.id, 256) || !string(value.projectId, 256)
    || (expectedProjectId !== undefined && value.projectId !== expectedProjectId)
    || (value.mode !== 'setup_candidate' && value.mode !== 'possible_recovery')
    || !string(value.title, 120) || !string(value.explanation, 240)
    || (value.origin !== 'explicit' && value.origin !== 'inferred')
    || (value.createdBy !== 'author' && value.createdBy !== 'model')
    || typeof value.authorConfirmed !== 'boolean'
    || value.semanticValidation !== 'protocol-and-current-sources'
    || !Array.isArray(value.premises) || value.premises.length < 1 || value.premises.length > 4) return invalid()
  const references = new Set<string>()
  const premises = value.premises.map((premise): FactPlotPremise => {
    if (!record(premise) || !['setup', 'recovery', 'context'].includes(String(premise.role))
      || !Array.isArray(premise.evidence) || premise.evidence.length < 1 || premise.evidence.length > 8) return invalid()
    const evidence = premise.evidence.map(anchor)
    for (const reference of evidence) {
      const key = JSON.stringify([reference.chapterId, reference.sourceRevision, reference.start, reference.end])
      if (references.has(key)) return invalid()
      references.add(key)
    }
    return { role: premise.role as FactPlotPremise['role'], evidence }
  })
  if (references.size > 8 || !premises.some(item => item.role === 'setup')
    || (value.mode === 'possible_recovery' && !premises.some(item => item.role === 'recovery'))
    || premises.flatMap(item => item.evidence).reduce((total, item) => total + item.quote.length, 0) > 8_000) return invalid()
  return {
    id: value.id, projectId: value.projectId, mode: value.mode, title: value.title, explanation: value.explanation,
    origin: value.origin, createdBy: value.createdBy, authorConfirmed: value.authorConfirmed,
    semanticValidation: 'protocol-and-current-sources', provenance: provenance(value.provenance), premises,
  }
}

/** Caller supplies application-assigned provenance; model flags can never confirm a proposal. */
export function createFactPlotLink(
  input: Omit<FactPlotLink, 'id' | 'createdBy' | 'authorConfirmed' | 'semanticValidation'> & { id?: string },
): FactPlotLink {
  return validateFactPlotLink({
    ...input, id: input.id ?? crypto.randomUUID(), createdBy: 'model', authorConfirmed: false,
    semanticValidation: 'protocol-and-current-sources',
  })
}

/** Read v1 without writing; normalize to v2 only in memory until an explicit save. */
export function validateFactGraphDocument(value: unknown, expectedProjectId?: string): FactGraphDocument {
  assertFactGraphSupportedVersion(value)
  if (!record(value) || (value.version !== 1 && value.version !== 2) || !string(value.projectId, 256)
    || (expectedProjectId !== undefined && value.projectId !== expectedProjectId)
    || !string(value.revision, 128, true) || !Array.isArray(value.relations)
    || value.relations.length > FACT_GRAPH_MAX_RELATIONS
    || (value.version === 2 && (!Array.isArray(value.plotLinks) || value.plotLinks.length > FACT_GRAPH_MAX_PLOT_LINKS))
    // A mislabeled v1 payload must not silently discard v2 annotations.
    || (value.version === 1 && Object.hasOwn(value, 'plotLinks'))) return invalid()
  const ids = new Set<string>()
  let quoteChars = 0
  const addQuotes = (evidence: FactAnchor[]) => {
    quoteChars += evidence.reduce((total, reference) => total + reference.quote.length, 0)
    if (quoteChars > FACT_GRAPH_MAX_QUOTE_CHARS) return invalid()
  }
  const relations = value.relations.map((item): FactRelation => {
    if (!record(item) || !string(item.id, 256) || ids.has(item.id) || item.projectId !== value.projectId
      || !string(item.predicate, 200) || (item.origin !== 'explicit' && item.origin !== 'inferred')
      || (item.createdBy !== 'author' && item.createdBy !== 'model')
      || typeof item.authorConfirmed !== 'boolean' || !Array.isArray(item.evidence)
      || item.evidence.length < 1 || item.evidence.length > 8
      || (item.semanticValidation !== undefined && item.semanticValidation !== 'protocol-and-current-sources')) return invalid()
    ids.add(item.id)
    const evidence = item.evidence.map(anchor)
    addQuotes(evidence)
    return {
      id: item.id, projectId: item.projectId as string, source: entity(item.source), target: entity(item.target),
      predicate: item.predicate, origin: item.origin, createdBy: item.createdBy, authorConfirmed: item.authorConfirmed,
      evidence,
      ...(item.provenance === undefined ? {} : { provenance: provenance(item.provenance) }),
      ...(item.semanticValidation === undefined ? {} : { semanticValidation: item.semanticValidation }),
    }
  })
  const plotLinks = (value.version === 2 ? value.plotLinks as unknown[] : []).map(item => {
    const link = validateFactPlotLink(item, value.projectId as string)
    if (ids.has(link.id)) return invalid()
    ids.add(link.id)
    for (const premise of link.premises) addQuotes(premise.evidence)
    return link
  })
  const document: FactGraphDocument = { version: 2, projectId: value.projectId, revision: value.revision, relations, plotLinks }
  if (JSON.stringify(document).length > FACT_GRAPH_MAX_DOCUMENT_CHARS) return invalid()
  return document
}

export function emptyFactGraph(projectId: string): FactGraphDocument {
  if (!string(projectId, 256)) return invalid()
  return { version: 2, projectId, revision: '', relations: [], plotLinks: [] }
}

/** IDs encode occurrence labels, not a cross-chapter canonical name or alias. */
export function factEntityId(value: FactEntity): string {
  return `entity:${JSON.stringify([value.type, value.label])}`
}

function splitsSurrogate(text: string, offset: number): boolean {
  const left = text.charCodeAt(offset - 1)
  const right = text.charCodeAt(offset)
  return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff
}

interface SourceContext {
  cutoff: number
  chapters: Map<string, { text: string; title: string; ordinal: number; revision: string }>
}

function sourceContext(project: MemoryProjectInput, stats: MemoryIndexStats, throughChapterId: string): SourceContext {
  if (stats.projectId !== project.id || stats.chapters.length !== project.chapters.length) {
    throw new Error('事实关系图需要当前稿件的有效索引快照。')
  }
  const cutoff = project.chapters.findIndex(chapter => chapter.id === throughChapterId)
  if (cutoff < 0) throw new Error('截止章节不存在，请重新选择披露范围。')
  const chapters: SourceContext['chapters'] = new Map()
  for (const [position, chapter] of project.chapters.entries()) {
    const manifest = stats.chapters[position]
    if (!manifest || manifest.id !== chapter.id || manifest.title !== chapter.title
      || manifest.ordinal !== position + 1 || manifest.chars !== chapter.text.length || chapters.has(chapter.id)) {
      throw new Error('事实关系图需要当前稿件的有效索引快照。')
    }
    chapters.set(chapter.id, { text: chapter.text, title: chapter.title, ordinal: position + 1, revision: manifest.revision })
  }
  return { chapters, cutoff: cutoff + 1 }
}

function resolveAnchors(context: SourceContext, evidence: FactAnchor[]): VisibleFactAnchor[] | null {
  if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 8) return null
  const visible: VisibleFactAnchor[] = []
  for (const input of evidence) {
    let reference: FactAnchor
    try { reference = anchor(input) } catch { return null }
    const chapter = context.chapters.get(reference.chapterId)
    if (!chapter || chapter.ordinal > context.cutoff || chapter.revision !== reference.sourceRevision
      || reference.end > chapter.text.length || chapter.text.slice(reference.start, reference.end) !== reference.quote
      || splitsSurrogate(chapter.text, reference.start) || splitsSurrogate(chapter.text, reference.end)) return null
    visible.push({ ...reference, chapterTitle: chapter.title, ordinal: chapter.ordinal })
  }
  return visible
}

/** Resolve ALL exact current premises. Invalid, stale, or undisclosed input returns null. */
export function resolveFactAnchors(
  project: MemoryProjectInput, stats: MemoryIndexStats, throughChapterId: string, evidence: FactAnchor[],
): VisibleFactAnchor[] | null {
  try { return resolveAnchors(sourceContext(project, stats, throughChapterId), evidence) } catch { return null }
}

/**
 * The project/stats pair must come from the same completed MemoryClient.sync.
 * No hidden graph data is included in the return value, even for canvas styling.
 */
export function selectFactGraph(
  project: MemoryProjectInput, stats: MemoryIndexStats, document: FactGraphDocument,
  throughChapterId: string, query = '',
): FactGraphSelection {
  const accepted = validateFactGraphDocument(document, project.id)
  if (!string(query, 500, true)) throw new Error('关系图检索内容最多 500 字符。')
  const context = sourceContext(project, stats, throughChapterId)
  const needle = query.trim().toLocaleLowerCase()
  const relations: VisibleFactRelation[] = []
  const nodes = new Map<string, FactGraphNode>()
  let truncated = false
  for (const relation of accepted.relations) {
    const evidence = resolveAnchors(context, relation.evidence)
    // Every premise matters, including when the author has confirmed an inference.
    if (!evidence
      || !evidence.some(item => item.quote.includes(relation.source.label))
      || !evidence.some(item => item.quote.includes(relation.target.label))) continue
    if (needle && ![
      relation.source.label, relation.target.label, relation.predicate,
      ...evidence.flatMap(item => [item.quote, item.chapterTitle]),
    ].some(text => text.toLocaleLowerCase().includes(needle))) continue
    // Apply the display budget only after source, cutoff, and query filtering.
    if (relations.length >= FACT_GRAPH_VISIBLE_LIMIT) {
      truncated = true
      break
    }
    relations.push({ ...relation, evidence })
    for (const value of [relation.source, relation.target]) {
      const id = factEntityId(value)
      if (!nodes.has(id)) nodes.set(id, { id, ...value })
    }
  }
  return { relations, nodes: [...nodes.values()], truncated }
}

function resolvePlotLink(context: SourceContext, link: FactPlotLink): VisibleFactPlotLink | null {
  const premises: VisibleFactPlotLink['premises'] = []
  for (const premise of link.premises) {
    const evidence = resolveAnchors(context, premise.evidence)
    if (!evidence) return null
    premises.push({ role: premise.role, evidence })
  }
  return { ...link, premises }
}

/** Filter all premises before any query or display budget. Nothing undisclosed leaks. */
export function selectFactPlotLinks(
  project: MemoryProjectInput, stats: MemoryIndexStats, document: FactGraphDocument,
  throughChapterId: string, query = '',
): FactPlotLinkSelection {
  const accepted = validateFactGraphDocument(document, project.id)
  if (!string(query, 500, true)) throw new Error('伏笔检索内容最多 500 字符。')
  const context = sourceContext(project, stats, throughChapterId)
  const needle = query.trim().toLocaleLowerCase()
  const plotLinks: VisibleFactPlotLink[] = []
  let truncated = false
  for (const link of accepted.plotLinks) {
    const visible = resolvePlotLink(context, link)
    if (!visible) continue
    if (needle && ![visible.title, visible.explanation,
      ...visible.premises.flatMap(item => item.evidence.flatMap(reference => [reference.quote, reference.chapterTitle])),
    ].some(text => text.toLocaleLowerCase().includes(needle))) continue
    if (plotLinks.length >= FACT_GRAPH_VISIBLE_LIMIT) { truncated = true; break }
    plotLinks.push(visible)
  }
  return { plotLinks, truncated }
}

/** Pure author decision. Caller must explicitly save with the graph CAS revision. */
export function confirmFactPlotLink(
  project: MemoryProjectInput, stats: MemoryIndexStats, document: FactGraphDocument,
  throughChapterId: string, id: string,
): FactGraphDocument {
  const accepted = validateFactGraphDocument(document, project.id)
  const link = accepted.plotLinks.find(item => item.id === id)
  if (!link || !resolvePlotLink(sourceContext(project, stats, throughChapterId), link)) {
    throw new Error('伏笔提议的全部原文前提必须仍然有效且已披露，不能确认旧版本或未来信息。')
  }
  link.authorConfirmed = true
  return accepted
}

/** Seed ONLY from the original demo and its completed sync, never an edited copy. */
export async function createDemoFactGraph(project: MemoryProjectInput): Promise<FactGraphDocument> {
  if (project.id !== 'memory-demo') throw new Error('只能为内置示例建立初始关系图。')
  // Capture before hashing so callers cannot change the seeded source mid-flight.
  const chapters = project.chapters.map(chapter => ({ ...chapter }))
  const document = emptyFactGraph(project.id)
  const revisions = new Map(await Promise.all(['c1', 'c2', 'c40', 'c80'].map(async id => {
    const chapter = chapters.find(item => item.id === id)
    if (!chapter) throw new Error('初始示例来源不匹配，不能自动重新标记修改后的事实。')
    return [id, await chapterRevision(chapter)] as const
  })))
  const citation = (chapterId: string, quote: string): FactAnchor => {
    const chapter = chapters.find(item => item.id === chapterId)
    const revision = revisions.get(chapterId)
    const start = chapter?.text.indexOf(quote) ?? -1
    if (!chapter || !revision || start < 0) throw new Error('初始示例来源不匹配，不能自动重新标记修改后的事实。')
    return { chapterId, sourceRevision: revision, start, end: start + quote.length, quote }
  }
  const transfer = citation('c1', '顾行将银钥匙交给沈砚，嘱咐他保管到天亮。')
  const bell = citation('c2', '沈砚把一枚缺角的铜铃系在窗边，嘱咐阿宁听见三声铃响就去西渡口。')
  const reunion = citation('c40', '沈砚和阿宁在城外重逢。他们需要约定接应的办法，却不愿让街上的守卫听见谈话。')
  const identity = citation('c80', '玄衣客摘下面具：玄衣客的真名是顾行。')
  const add = (
    id: string, source: FactEntity, predicate: string, target: FactEntity,
    evidence: FactAnchor[], origin: FactRelation['origin'] = 'explicit', authorConfirmed = false,
  ) => document.relations.push({ id, projectId: project.id, source, target, predicate, origin, createdBy: origin === 'inferred' ? 'model' : 'author', authorConfirmed, evidence })
  add('demo-key-custody', { type: 'person', label: '沈砚' }, '受托保管', { type: 'object', label: '银钥匙' }, [transfer])
  add('demo-key-transfer', { type: 'person', label: '顾行' }, '将钥匙交给', { type: 'person', label: '沈砚' }, [transfer])
  add('demo-bell-signal', { type: 'object', label: '铜铃' }, '三声铃响指向接应地点', { type: 'place', label: '西渡口' }, [bell], 'explicit', true)
  add('demo-bell-event', { type: 'event', label: '三声铃响' }, '通知前往西渡口', { type: 'person', label: '阿宁' }, [bell])
  add('demo-reunion-inference', { type: 'object', label: '铜铃' }, '可能用于重逢时接应（示例推断）', { type: 'event', label: '重逢' }, [bell, reunion], 'inferred')
  add('demo-hidden-identity', { type: 'person', label: '玄衣客' }, '真名是', { type: 'person', label: '顾行' }, [identity])
  return validateFactGraphDocument(document)
}
