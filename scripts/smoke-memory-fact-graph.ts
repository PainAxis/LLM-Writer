import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { MemoryIndex } from '../src/services/memory/engine'
import { chapterRevision } from '../src/services/memory/revision'
import { emptyFactGraph, factEntityId, selectFactGraph, validateFactGraphDocument } from '../src/services/memory/factGraph'
import type { FactAnchor, FactGraphDocument, FactGraphSelection, FactRelation } from '../src/types/factGraph'
import type { MemoryChapterInput, MemoryProjectInput } from '../src/types/memory'
import { createFactGraphCorpus } from './fixtures/memory-fact-graph-corpus'

let scenarios = 0
let exactEvidenceChecks = 0
let networkRequests = 0
const originalFetch = globalThis.fetch
globalThis.fetch = async () => {
  networkRequests++
  throw new Error('Fact graph source-integrity tests must not make external requests')
}
const measurements: Record<string, number> = {}
const check = (label: string) => { console.log(`✓ ${++scenarios}. ${label}`) }
const makeChapter = (id: string, text: string): MemoryChapterInput => ({ id, title: `章节 ${id}`, text })
const makeProject = (chapters: MemoryChapterInput[], id = 'graph-novel'): MemoryProjectInput => ({
  id, title: '渡口与铜符', chapters, clues: [],
})
const makeDocument = (project: MemoryProjectInput, relations: FactRelation[]): FactGraphDocument => ({
  ...emptyFactGraph(project.id), relations,
})
async function anchor(chapter: MemoryChapterInput, quote = chapter.text): Promise<FactAnchor> {
  const start = chapter.text.indexOf(quote)
  assert.ok(start >= 0)
  return { chapterId: chapter.id, sourceRevision: await chapterRevision(chapter), start, end: start + quote.length, quote }
}
function relation(projectId: string, evidence: FactAnchor[], overrides: Partial<FactRelation> = {}): FactRelation {
  return {
    id: 'copper-token', projectId,
    source: { type: 'person', label: '沈砚' }, target: { type: 'object', label: '断角铜符' },
    predicate: '保管', origin: 'explicit', createdBy: 'author', authorConfirmed: false, evidence, ...overrides,
  }
}

/** Independent oracle hashes full source and checks current array positions, not selector manifests. */
async function assertEvidence(selection: FactGraphSelection, project: MemoryProjectInput, document: FactGraphDocument, through: string) {
  const cutoff = project.chapters.findIndex(chapter => chapter.id === through)
  assert.ok(cutoff >= 0)
  const sourceRows = new Map(document.relations.map(row => [row.id, row]))
  const sourceChapters = new Map(project.chapters.map((chapter, ordinal) => [chapter.id, { chapter, ordinal }]))
  const revisions = new Map<string, string>()
  const labels = new Set<string>()
  for (const row of selection.relations) {
    const original = sourceRows.get(row.id)
    assert.ok(original, 'a rendered row must exist in the source graph document')
    assert.equal(row.projectId, project.id)
    assert.deepEqual(row.source, original.source)
    assert.deepEqual(row.target, original.target)
    assert.equal(row.evidence.length, original.evidence.length)
    for (const [evidenceIndex, evidence] of original.evidence.entries()) {
      const current = sourceChapters.get(evidence.chapterId)
      assert.ok(current && current.ordinal <= cutoff, 'every inference premise must be disclosed in the current order')
      if (!revisions.has(current.chapter.id)) revisions.set(current.chapter.id, await chapterRevision(current.chapter))
      assert.equal(evidence.sourceRevision, revisions.get(current.chapter.id), 'complete title/body hash must still match')
      assert.equal(current.chapter.text.slice(evidence.start, evidence.end), evidence.quote, 'quote must match its exact source span')
      assert.ok(Number.isSafeInteger(evidence.start) && Number.isSafeInteger(evidence.end))
      assert.deepEqual(row.evidence[evidenceIndex], {
        ...evidence, chapterTitle: current.chapter.title, ordinal: current.ordinal + 1,
      }, 'rendered evidence must retain the exact source span and use current chapter metadata')
      exactEvidenceChecks++
    }
    for (const endpoint of [original.source, original.target]) {
      assert.ok(original.evidence.some(item => item.quote.includes(endpoint.label)), 'each node name must occur in disclosed evidence')
      labels.add(factEntityId(endpoint))
    }
  }
  assert.equal(selection.nodes.length, labels.size, 'only nodes connected to returned relations may be exposed')
  assert.ok(selection.relations.length <= 200 && selection.nodes.length <= 400, 'canvas workload is bounded')
}

const opening = makeChapter('c1', '🌧️沈砚把断角铜符交给顾宁。两人约定第三声更鼓后接应。窗外尚有一盏灯。')
const middle = makeChapter('c2', '顾宁在青岚渡口守候。沈砚参与夜渡事件，断角铜符仍由沈砚保管。')
const reveal = makeChapter('c80', '宁玄璟就是鸦面使者。沈砚终于查清断角铜符对应的旧朝身份。')
const project = makeProject([opening, middle, reveal])
const initialAnchor = await anchor(opening, '沈砚把断角铜符交给顾宁。')
const explicit = relation(project.id, [initialAnchor])
const inferred = relation(project.id, [initialAnchor, await anchor(middle)], {
  id: 'inferred-rendezvous', target: { type: 'place', label: '青岚渡口' }, predicate: '可能赴约于', origin: 'inferred', createdBy: 'model',
})
const confirmed = relation(project.id, [await anchor(middle)], {
  id: 'confirmed-event', target: { type: 'event', label: '夜渡事件' }, predicate: '参与', origin: 'inferred', createdBy: 'model', authorConfirmed: true,
})
const future = relation(project.id, [initialAnchor, await anchor(reveal)], {
  id: 'future-alias', target: { type: 'person', label: '鸦面使者' }, predicate: '可能知晓身份', origin: 'inferred', createdBy: 'model',
})
const document = makeDocument(project, [future, explicit, inferred, confirmed])
const index = new MemoryIndex()
let stats = await index.sync(project)
const initial = selectFactGraph(project, stats, document, 'c2')
assert.deepEqual(new Set(initial.relations.map(row => row.id)), new Set([explicit.id, inferred.id, confirmed.id]))
assert.ok(initial.relations.some(row => row.origin === 'explicit' && !row.authorConfirmed))
assert.ok(initial.relations.some(row => row.origin === 'inferred' && !row.authorConfirmed))
assert.ok(initial.relations.some(row => row.origin === 'inferred' && row.authorConfirmed), 'author confirmation must preserve the original inference status')
assert.deepEqual(new Set(initial.nodes.map(node => node.type)), new Set(['person', 'object', 'place', 'event']))
await assertEvidence(initial, project, document, 'c2')
check('人物、事件、物件、地点均有原文依据；作者确认保留模型推断的原始来源')

const cutoffOne = selectFactGraph(project, stats, document, 'c1')
assert.deepEqual(cutoffOne.relations.map(row => row.id), [explicit.id])
assert.ok(!JSON.stringify(initial).includes('鸦面使者'), 'hidden identities must not leak through nodes, aliases, counts or relation text')
assert.equal(selectFactGraph(project, stats, document, 'c2', '鸦面使者').relations.length, 0)
const all = selectFactGraph(project, stats, document, 'c80')
assert.ok(all.relations.some(row => row.id === future.id))
await assertEvidence(all, project, document, 'c80')
check('多依据推断必须等全部前提披露；未来身份不能污染早期节点或查询结果')

for (const mutation of [
  { name: 'same-length edit outside quoted span', apply: (value: MemoryProjectInput) => { value.chapters[0]!.text = value.chapters[0]!.text.replace('一盏灯', '两盏灯') } },
  { name: 'chapter title only', apply: (value: MemoryProjectInput) => { value.chapters[0]!.title += '（修订）' } },
  { name: 'identical quote moved within same chapter', apply: (value: MemoryProjectInput) => { value.chapters[0]!.text = `另起一页。${value.chapters[0]!.text}` } },
  { name: 'source chapter deletion', apply: (value: MemoryProjectInput) => { value.chapters.shift() } },
]) {
  const changed = structuredClone(project)
  mutation.apply(changed)
  const updated = await index.sync(changed)
  const selection = selectFactGraph(changed, updated, document, 'c2')
  assert.deepEqual(selection.relations.map(row => row.id), [confirmed.id], `${mutation.name} must reject all stale premises`)
  await assertEvidence(selection, changed, document, 'c2')
}
const confirmedOpening = makeDocument(project, [{ ...explicit, authorConfirmed: true }])
const edited = structuredClone(project)
edited.chapters[0]!.text = edited.chapters[0]!.text.replace('断角铜符', '白纸信笺')
assert.equal(selectFactGraph(edited, await index.sync(edited), confirmedOpening, 'c2').relations.length, 0,
  'author confirmation cannot override a source revision change')
check('同长度正文修改、章名修改、引文移位及删章立即排除旧事实；作者确认不能绕过版本失效')

const reordered = makeProject([middle, reveal, opening])
const reorderedStats = await index.sync(reordered)
assert.deepEqual(selectFactGraph(reordered, reorderedStats, document, 'c2').relations.map(row => row.id), [confirmed.id])
const afterReorder = selectFactGraph(reordered, reorderedStats, document, 'c1')
assert.equal(afterReorder.relations.length, 4)
await assertEvidence(afterReorder, reordered, document, 'c1')
stats = await index.sync(project)
assert.throws(() => selectFactGraph(project, stats, document, ''))
assert.throws(() => selectFactGraph(project, stats, document, 'deleted-cutoff'))
assert.throws(() => selectFactGraph(makeProject(project.chapters, 'other-novel'), stats, document, 'c2'))
assert.throws(() => selectFactGraph(project, { ...stats, projectId: 'other-novel' }, document, 'c2'))
assert.throws(() => selectFactGraph(project, stats, { ...document, projectId: 'other-novel' }, 'c2'))
assert.throws(() => selectFactGraph(project, { ...stats, chapters: [...stats.chapters].reverse() }, document, 'c2'))
const wrongTitle = structuredClone(project)
wrongTitle.chapters[0]!.title += '尚未完成索引的修改'
assert.throws(() => selectFactGraph(wrongTitle, stats, document, 'c2'), 'obviously mismatched source/manifest pairs must fail closed')
check('披露顺序随章节重排更新；缺失截止、跨作品数据和错配清单全部关闭可见范围')

const copiedQuote = makeChapter('copy', initialAnchor.quote)
const relocated = makeProject([copiedQuote, middle])
assert.equal(selectFactGraph(relocated, await index.sync(relocated), makeDocument(project, [explicit]), 'copy').relations.length, 0,
  'an identical quote in a different chapter must not re-anchor a deleted source')
stats = await index.sync(project)
for (const badEvidence of [
  { ...initialAnchor, sourceRevision: '0'.repeat(64) },
  { ...initialAnchor, chapterId: 'deleted' },
  { ...initialAnchor, quote: initialAnchor.quote.replace('铜符', '银符') },
  { ...initialAnchor, start: initialAnchor.start + 1, end: initialAnchor.end + 1 },
]) {
  assert.equal(selectFactGraph(project, stats, makeDocument(project, [relation(project.id, [badEvidence])]), 'c2').relations.length, 0)
}
const ungrounded = relation(project.id, [initialAnchor], { target: { type: 'person', label: '鸦面使者' } })
assert.equal(selectFactGraph(project, stats, makeDocument(project, [ungrounded]), 'c80').relations.length, 0,
  'a future canonical name cannot be attached to early evidence, even when the full book is disclosed')
const extraMetadata = {
  ...makeDocument(project, [explicit]),
  undisclosedTitle: '鸦面使者',
  relations: [{ ...explicit, source: { ...explicit.source, canonicalName: '鸦面使者' }, futureAliases: ['鸦面使者'] }],
}
assert.ok(!JSON.stringify(selectFactGraph(project, stats, extraMetadata, 'c2')).includes('鸦面使者'),
  'untrusted extra metadata must not cross the visualization boundary')
check('相同引文不会跨章自动重挂；错误修订、偏移、引用和无原文支撑的身份标签均被排除')

const emojiChapter = makeChapter('emoji', '🦉沈砚保管断角铜符🦉')
const emojiProject = makeProject([emojiChapter])
const emojiStats = await index.sync(emojiProject)
const emojiAnchor = await anchor(emojiChapter)
assert.equal(selectFactGraph(emojiProject, emojiStats, makeDocument(emojiProject, [relation(project.id, [emojiAnchor])]), 'emoji').relations.length, 1)
for (const [start, end] of [[1, emojiChapter.text.length], [0, emojiChapter.text.length - 1]]) {
  const broken = { ...emojiAnchor, start: start!, end: end!, quote: emojiChapter.text.slice(start, end) }
  const bad = makeDocument(emojiProject, [relation(project.id, [broken])])
  assert.equal(selectFactGraph(emojiProject, emojiStats, bad, 'emoji').relations.length, 0, 'evidence must not split a surrogate pair')
}
const oddChapter = makeChapter('__proto__', '__proto__把constructor交给toString。')
const oddProject = makeProject([oddChapter], '__proto__')
const oddRow = relation(oddProject.id, [await anchor(oddChapter)], {
  id: '__proto__', source: { type: 'person', label: '__proto__' }, target: { type: 'object', label: 'constructor' },
})
const oddDocument = makeDocument(oddProject, [oddRow])
const oddSelection = selectFactGraph(oddProject, await index.sync(oddProject), oddDocument, '__proto__')
assert.equal(oddSelection.relations.length, 1)
assert.equal(oddSelection.nodes.length, 2)
assert.notEqual(factEntityId({ type: 'person', label: 'constructor' }), factEntityId({ type: 'object', label: 'constructor' }))
await assertEvidence(oddSelection, oddProject, oddDocument, '__proto__')
check('UTF-16 引文边界保持完整；特殊键名不会污染映射，相同名称的不同实体类型保持区分')

const validClone = validateFactGraphDocument(document, project.id)
validClone.relations[0]!.evidence[0]!.quote = '调用者修改'
assert.notEqual(document.relations[0]!.evidence[0]!.quote, '调用者修改', 'validation must return an independent document')
const invalidDocuments: unknown[] = [
  null, [], {}, { ...document, version: 2 }, { ...document, projectId: '' }, { ...document, revision: 5 },
  { ...document, relations: {} }, { ...document, relations: [explicit, explicit] },
  { ...document, revision: 'r'.repeat(129) },
  { ...document, relations: Array.from({ length: 10_001 }, (_, i) => ({ ...explicit, id: `over-capacity-${i}` })) },
  ...[
    { id: '' }, { projectId: 'other-novel' }, { origin: 'rumour' }, { createdBy: 'external' }, { authorConfirmed: 'yes' },
    { predicate: '' }, { source: { type: 'unknown', label: '沈砚' } }, { source: { type: 'person', label: '' } },
    { id: 'i'.repeat(257) }, { predicate: '谓'.repeat(201) }, { source: { type: 'person', label: '名'.repeat(121) } },
    { evidence: [] }, { evidence: Array.from({ length: 9 }, () => initialAnchor) },
    { evidence: [{ ...initialAnchor, start: -1 }] }, { evidence: [{ ...initialAnchor, start: 1.5 }] },
    { evidence: [{ ...initialAnchor, end: initialAnchor.start }] }, { evidence: [{ ...initialAnchor, quote: '' }] },
    { evidence: [{ ...initialAnchor, sourceRevision: 'old-version' }] },
    { evidence: [{ ...initialAnchor, quote: '文'.repeat(2_001), start: 0, end: 2_001 }] },
  ].map(override => ({ ...document, relations: [{ ...explicit, ...override }] })),
]
for (const invalid of invalidDocuments) assert.throws(() => validateFactGraphDocument(invalid, project.id))
assert.throws(() => validateFactGraphDocument(document, 'other-novel'))
assert.throws(() => selectFactGraph(project, stats, document, 'c2', '字'.repeat(501)))
check(`严格文档校验拒绝 ${invalidDocuments.length + 1} 组损坏或越界输入，返回值不会反向污染原数据`)

// Structural capacity is independent of source eligibility: individually valid anchors
// cannot multiply into an unbounded document before the source gate runs.
const maximumQuote = { ...initialAnchor, start: 0, end: 2_000, quote: '文'.repeat(2_000) }
const quoteBudgetDocument = makeDocument(project, Array.from({ length: 4_000 }, (_, i) => ({
  ...explicit, id: `quote-budget-${i}`, evidence: [maximumQuote],
})))
assert.equal(validateFactGraphDocument(quoteBudgetDocument, project.id).relations.length, 4_000)
quoteBudgetDocument.relations.push({ ...explicit, id: 'over-quote-budget', evidence: [maximumQuote] })
assert.throws(() => validateFactGraphDocument(quoteBudgetDocument, project.id))
check('单条引文与总体引文容量分别受限，合法小条目也不能累积绕过文档预算')

const fixtureStart = performance.now()
const large = await createFactGraphCorpus()
measurements.fixtureMs = performance.now() - fixtureStart
assert.equal(large.manifest.chapters, 600)
assert.ok(large.manifest.chars > 1_000_000)
assert.equal(large.manifest.relations, 5_400)
validateFactGraphDocument(large.document, large.project.id)
const syncStart = performance.now()
const largeStats = await index.sync(large.project)
measurements.syncMs = performance.now() - syncStart
const selectionStart = performance.now()
const bounded = selectFactGraph(large.project, largeStats, large.document, 'graph-chapter-599')
measurements.boundedSelectionMs = performance.now() - selectionStart
assert.equal(bounded.relations.length, 200)
assert.equal(bounded.truncated, true)
assert.ok(!JSON.stringify(bounded).includes('鸦面使者'))
await assertEvidence(bounded, large.project, large.document, 'graph-chapter-599')
assert.equal(selectFactGraph(large.project, largeStats, large.document, 'graph-chapter-599', '鸦面使者').relations.length, 0)
const finalIdentity = selectFactGraph(large.project, largeStats, large.document, 'graph-chapter-600', '鸦面使者')
assert.equal(finalIdentity.relations.length, 3, 'the hidden identity has real graph rows, and becomes searchable only at its disclosure chapter')
await assertEvidence(finalIdentity, large.project, large.document, 'graph-chapter-600')
const earliest = selectFactGraph(large.project, largeStats, large.document, 'graph-chapter-1')
assert.equal(earliest.relations.length, 9, '5,391 later rows must not crowd the nine disclosed rows out before filtering')
assert.equal(earliest.truncated, false, 'excluded future rows must not influence the render bound indicator')
await assertEvidence(earliest, large.project, large.document, 'graph-chapter-1')
const clueStart = performance.now()
const distant = selectFactGraph(large.project, largeStats, large.document, 'graph-chapter-599', large.distantQuery)
measurements.distantQueryMs = performance.now() - clueStart
assert.equal(distant.relations.length, 4, 'a distant chapter-one clue must be found despite being stored after thousands of later rows')
assert.equal(distant.truncated, false)
assert.ok(distant.relations.every(row => row.evidence.every(item => item.chapterId === 'graph-chapter-1')))
await assertEvidence(distant, large.project, large.document, 'graph-chapter-599')
check(`长篇业务压力：${large.manifest.chapters} 章 / ${large.manifest.chars} UTF-16 字符 / ${large.manifest.relations} 条关系；先披露和查询过滤，再限制画布数量`)

const largeEdited = structuredClone(large.project)
largeEdited.chapters[0]!.text = largeEdited.chapters[0]!.text.replace(large.distantQuery, '新修订纸笺替代0001')
const editedStats = await index.sync(largeEdited)
assert.equal(selectFactGraph(largeEdited, editedStats, large.document, 'graph-chapter-599', large.distantQuery).relations.length, 0)
const largeReordered = structuredClone(large.project)
largeReordered.chapters.push(largeReordered.chapters.shift()!)
const movedStats = await index.sync(largeReordered)
assert.equal(selectFactGraph(largeReordered, movedStats, large.document, 'graph-chapter-599', large.distantQuery).relations.length, 0)
const redisclosed = selectFactGraph(largeReordered, movedStats, large.document, 'graph-chapter-1', large.distantQuery)
assert.equal(redisclosed.relations.length, 4)
await assertEvidence(redisclosed, largeReordered, large.document, 'graph-chapter-1')
check('百万字长篇中修订旧章排除全部旧版关联；章节移动到未来后伏笔隐藏，再披露时才恢复')

const report = {
  fixture: large.manifest, scenarios, exactEvidenceChecks, networkRequests, measurements,
  runtime: { node: process.version, generatedAt: new Date().toISOString() },
  limits: [
    'Deterministic synthetic source-integrity and graph workload tests; not model extraction or literary quality evaluation.',
    'Single-process single-run timings include no browser canvas and impose no timing assertions.',
    'The selector consumes completed sync manifests; UI freshness and real canvas interaction are covered separately by browser tests.',
  ],
}
assert.equal(networkRequests, 0)
globalThis.fetch = originalFetch
const reportIndex = process.argv.indexOf('--report')
const destination = reportIndex < 0 ? 'artifacts/memory-fact-graph/core.json' : process.argv[reportIndex + 1]
assert.ok(destination && !destination.startsWith('--'), '--report requires a destination')
const absolute = resolve(destination)
await mkdir(dirname(absolute), { recursive: true })
await writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
