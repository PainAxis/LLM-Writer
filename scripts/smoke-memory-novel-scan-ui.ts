/** Real engine + synthetic transport / storage, Vue SSR only. No browser or network. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSSRApp, nextTick, ref, shallowRef } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import type { FactGraphDocument, VisibleFactRelation } from '../src/types/factGraph'
import type { MemoryProjectInput } from '../src/types/memory'
import type { NovelScanGenerator, NovelScanPage } from '../src/types/memoryNovelScan'
import type { WriterChapter, WriterNovel } from '../src/types/writer'

const storage = new Map<string, string>()
Object.assign(globalThis, { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } })
let networkCalls = 0
globalThis.fetch = async () => { networkCalls++; throw new Error('UI smoke must never use network') }
const { useNovelCandidateScan } = await import('../src/composables/useNovelCandidateScan')
const { prepareNovelCandidateScan } = await import('../src/services/memory/novelScan')
const { MemoryIndex } = await import('../src/services/memory/engine')
const { emptyFactGraph, selectFactPlotLinks } = await import('../src/services/memory/factGraph')
const { useApiConfig } = await import('../src/services/apiConfig')
const { apiConfig } = useApiConfig()
apiConfig.value = { ...apiConfig.value, provider: 'custom', baseURL: 'https://synthetic.invalid/v1', selectedModel: 'synthetic', apiKey: 'test-only', customHeaders: {} }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { resolve, promise } }
async function until(test: () => boolean) { for (let i = 0; i < 200 && !test(); i++) await new Promise(done => setTimeout(done, 0)); assert.ok(test()) }
let checks = 0
function check(label: string) { console.log(`✓ ${++checks}. ${label}`) }

// Four unchanged chapters from the frozen long profile, not another capacity
// run. Keep this regression in the existing UI suite and aggregate smoke entry.
async function writerSafeRelationRoundTrip() {
  const { buildLongProfile, LONG_FUTURE_CANARY } = await import('./fixtures/novel-candidate-long-profile.mjs')
  const { chapterRevision } = await import('../src/services/memory/revision')
  const { prepareWriterMemoryContext, WRITER_MEMORY_MARKER } = await import('../src/services/memory/writerContext')
  const { useWriterMemoryContext } = await import('../src/composables/useWriterMemoryContext')
  const profile = buildLongProfile()
  assert.equal(profile.sourceSha256, '4cfaf40d8471e0af289016a58560792c7d1fb4f8dd572f78d41876e982ee3928')
  const project: MemoryProjectInput = { id: 'novel:64111', title: 'Writer safe relation regression', clues: [],
    chapters: [586, 587, 599, 600].map(ordinal => {
      const chapter = profile.chapters[ordinal - 1]!
      return { id: String(ordinal), title: chapter.title, text: chapter.text }
    }),
  }
  const source = project.chapters[1]!
  const quote = '沈砚将渡口药铺托付给阿宁，阿宁点头接下钥匙。'
  const predicate = '委托阿宁照看渡口药铺'
  assert.equal(source.text.slice(0, quote.length), quote)
  assert.ok(!source.text.includes(predicate), 'The controlled model predicate is a paraphrase, not a source quote')
  const graph: FactGraphDocument = { ...emptyFactGraph(project.id), revision: 'saved-novel-scan-relation', relations: [{
    id: 'saved-long-relation-587', projectId: project.id,
    source: { type: 'person', label: '沈砚' }, target: { type: 'person', label: '阿宁' },
    predicate, origin: 'explicit', createdBy: 'model', authorConfirmed: true,
    evidence: [{ chapterId: source.id, sourceRevision: await chapterRevision(source), start: 0, end: quote.length, quote }],
    provenance: { campaignId: 'long-campaign', segmentId: 'long-segment', jobId: 'long-job-587', candidateId: 'long-candidate-587' },
    semanticValidation: 'protocol-and-current-sources',
  }] }
  const persisted = JSON.stringify(graph)
  const relation = graph.relations[0]!
  const expected: VisibleFactRelation = { ...clone(relation), predicate: '原文关联',
    evidence: [{ ...relation.evidence[0]!, chapterTitle: source.title, ordinal: 2 }],
  }
  const client = new MemoryIndex()
  let sourceRead: ReturnType<typeof deferred<void>> | null = null
  let sourceReadStarted: ReturnType<typeof deferred<void>> | null = null
  const readProject = async () => {
    sourceReadStarted?.resolve()
    if (sourceRead) await sourceRead.promise
    return clone(project)
  }
  // Return the backing object deliberately: even a mutation of a reader's
  // in-memory return value must not rewrite the saved annotation or provenance.
  const readGraph = async () => graph
  const request = { projectId: project.id, query: '沈砚 阿宁 渡口药铺', throughChapterId: '599', targetChapterId: '599' }
  const assertSaved = () => assert.equal(JSON.stringify(graph), persisted, 'Writer must not rewrite or delete the saved graph')
  const assertEnvelope = (prompt: string) => {
    const wire = JSON.parse(prompt.split(`${WRITER_MEMORY_MARKER}\n`)[1]!)
    assert.equal(wire.projectId, project.id); assert.equal(wire.throughChapterId, '599')
    assert.deepEqual(wire.sources, [], 'Selecting the relation must not silently select direct search hits')
    assert.deepEqual(wire.relations, [{ id: relation.id, source: relation.source, target: relation.target,
      predicate: '原文关联', origin: 'explicit', createdBy: 'model', authorConfirmed: true, evidence: expected.evidence }],
    'The exact selected ID, complete source/revision/offsets and generation provenance must survive the envelope')
    assert.ok(!prompt.includes(predicate) && !prompt.includes(LONG_FUTURE_CANARY))
    assert.equal(wire.relations[0].provenance, undefined, 'Campaign metadata is not generation evidence')
    assert.equal(wire.relations[0].semanticValidation, undefined)
    assertSaved()
  }
  const prepared = await prepareWriterMemoryContext(request, { client, readProject, readGraph })
  assert.deepEqual(prepared.relations, [expected], 'Author confirmation cannot bypass nonliteral predicate sanitization or change identity/provenance')
  assert.ok(prepared.hits.length > 0, 'Use real MemoryIndex search, not a fabricated prepared result')
  assert.ok(!prepared.prompt.includes(predicate))
  assertEnvelope((await prepared.selectEvidence({ hitIds: [], relationIds: [relation.id] })).prompt)

  const chapterList: WriterChapter[] = project.chapters.map(chapter => ({ id: Number(chapter.id), title: chapter.title, content: chapter.text }))
  const current = ref(chapterList[2]!)
  const memory = useWriterMemoryContext({ currentNovel: ref<WriterNovel>({ id: 64111, title: project.title }),
    chapters: ref(chapterList), currentChapter: current, targetChapter: current, content: ref(current.value.content!),
    saveCurrentChapter: async () => true, client,
    prepare: (input, dependencies) => prepareWriterMemoryContext(input, { ...dependencies, readProject, readGraph }),
  })
  const root = fileURLToPath(new URL('..', import.meta.url))
  const server = await createServer({ configFile: false, root, plugins: [vue()],
    resolve: { alias: { '@': path.join(root, 'src') } },
    server: { middlewareMode: true, ws: false, hmr: false, watch: null }, logLevel: 'error' })
  try {
    assert.equal(server.httpServer, null, 'The SSR loader must not create an HTTP listener')
    const { default: WriterMemoryContext } = await server.ssrLoadModule('/src/components/writer/WriterMemoryContext.vue')
    const render = () => renderToString(createSSRApp(WriterMemoryContext, { ...memory.state, chapters: memory.chapters.value }))
    const tag = (html: string, id: string) => {
      const tags = [...html.matchAll(new RegExp(`<[^>]+data-testid="writer-memory-${id}"[^>]*>`, 'g'))]
      assert.equal(tags.length, 1, `Expected exactly one actual SFC ${id} control`)
      return tags[0]![0]
    }
    const flag = (html: string, id: string, attribute: 'checked' | 'disabled', value: boolean) =>
      assert.equal(new RegExp(`\\s${attribute}(?:[\\s=>])`).test(tag(html, id)), value, `${id} ${attribute}`)
    const assertUnapproved = (html: string) => {
      assert.equal(memory.state.approved, false)
      assert.ok(!html.includes('data-testid="writer-memory-approved"'))
    }
    memory.state.enabled = true; memory.state.query = request.query; memory.state.cutoffId = request.throughChapterId
    assert.equal(await memory.search(), true, memory.state.error)
    assert.deepEqual(memory.state.result!.relations, [expected])
    assert.deepEqual(memory.state.selection, { hitIds: [], relationIds: [] })
    let html = await render()
    const card = html.match(/<article[^>]+data-testid="writer-memory-relation-0"[^>]*>[\s\S]*?<\/article>/)?.[0]
    assert.ok(card, 'The actual Writer SFC must render the retrieved relation')
    assert.ok(card.includes('原文关联') && !card.includes(predicate))
    assert.ok(card.includes(quote) && card.includes(relation.evidence[0]!.sourceRevision))
    assert.match(card, /作者确认 · 原文明示 · 模型提议/)
    const inputs = [...html.matchAll(/<input[^>]+data-testid="writer-memory-select-(?:hit|relation)-\d+"[^>]*>/g)]
    assert.ok(inputs.length > 1)
    for (const [input] of inputs) assert.doesNotMatch(input, /\schecked(?:[\s=>])/, 'No search result may start selected')
    // A confirmed saved graph edge is not approval for this writing session.
    flag(html, 'approve', 'disabled', true); assertUnapproved(html)
    assert.equal(await memory.approve(), false)
    await assert.rejects(() => memory.acquire()!, /请先检索并核对/)

    memory.select({ hitIds: [], relationIds: [relation.id] })
    assert.deepEqual(memory.state.selection, { hitIds: [], relationIds: [relation.id] })
    assert.deepEqual(memory.state.result!.relations, [expected], 'Selecting by exact saved ID preserves quote, revision and provenance')
    html = await render()
    flag(html, 'select-relation-0', 'checked', true); flag(html, 'approve', 'disabled', false); assertUnapproved(html)
    sourceRead = deferred<void>(); sourceReadStarted = deferred<void>()
    const approval = memory.approve()
    await sourceReadStarted.promise
    assert.equal(memory.state.busy, true)
    html = await render()
    flag(html, 'approve', 'disabled', true); assertUnapproved(html)
    await assert.rejects(() => memory.acquire()!, /请先检索并核对/)
    sourceRead.resolve(); sourceRead = null; sourceReadStarted = null
    assert.equal(await approval, true, memory.state.error)
    html = await render(); tag(html, 'approved'); flag(html, 'approve', 'disabled', true)
    const lease = await memory.acquire(); assert.ok(lease)
    assertEnvelope(lease.prompt); await lease.assertFresh()

    // A cutoff before the exact source excludes the whole edge without deleting
    // author data. Restoring the cutoff finds the same saved ID, unselected.
    memory.state.cutoffId = '586'
    assert.equal(await memory.search(), true, memory.state.error)
    assert.deepEqual(memory.state.result!.relations, [])
    html = await render()
    assert.ok(!html.includes('data-testid="writer-memory-relation-') && !html.includes(quote))
    assertUnapproved(html); assertSaved()
    memory.state.cutoffId = '599'
    assert.equal(await memory.search(), true, memory.state.error)
    assert.deepEqual(memory.state.result!.relations, [expected])
    assert.deepEqual(memory.state.selection, { hitIds: [], relationIds: [] })
    memory.select({ hitIds: [], relationIds: [relation.id] })
    assert.equal(await memory.approve(), true, memory.state.error)
    const currentLease = await memory.acquire(); assert.ok(currentLease)
    assertEnvelope(currentLease.prompt)

    // An eventless committed edit keeps the old quotation byte-for-byte in the
    // source, but changes its revision. Revision validation must still hide it.
    source.text += '提交后的章末修订。'
    await assert.rejects(() => currentLease.assertFresh(), /已保存稿件/)
    assert.equal(await memory.search(), true, memory.state.error)
    assert.deepEqual(memory.state.result!.relations, [])
    html = await render()
    assert.ok(!html.includes('data-testid="writer-memory-relation-'))
    assert.ok(!html.includes('data-testid="writer-memory-select-relation-'))
    flag(html, 'approve', 'disabled', true); assertUnapproved(html); assertSaved()
    assert.equal(networkCalls, 0); assert.equal(storage.size, 0)
  } finally {
    sourceRead?.resolve()
    memory.dispose()
    await server.close()
  }
  check('Writer real-index/service/composable/SFC roundtrip: safe predicate, exact selected evidence and provenance, deferred approval, cutoff/revision exclusion, unchanged saved graph; Node SSR only')
}

await writerSafeRelationRoundTrip()
async function fixture(chapterCount = 2) {
  const project = { id: 'novel:ui', title: '测试', chapters: [
    { id: 'one', title: '铺垫', text: '阿宁持有铜铃，约定三响后开门。<script>bad()</script>' },
    { id: 'two', title: '回收', text: '阿宁听见铜铃三响，依约打开门。' },
    { id: 'future', title: '未来', text: '未来身份不得披露。' },
  ], clues: [] }
  if (chapterCount !== 2) project.chapters = [...Array.from({ length: chapterCount }, (_, index) => ({ id: `chapter-${index}`, title: `章节 ${index}`, text: `线索${String(index).padStart(4, '0')}：阿宁持有铜铃，约定三响后开门。` })), project.chapters[2]!]
  const cutoff = project.chapters[project.chapters.length - 2]!.id
  const index = new MemoryIndex(); const stats = await index.sync(project)
  const source = shallowRef({ project, stats, throughChapterId: cutoff })
  const available = ref(true)
  const configuration = ref({ model: 'synthetic', headers: { key: 'not-saved' } })
  const committed = clone(project)
  let graph = emptyFactGraph(project.id)
  let readError = false
  let readGraphHook: (() => void) | undefined
  let readProjectHook: (() => void) | undefined
  let projectReads = 0; let graphReads = 0
  let holdPrepare: Promise<void> | null = null
  let holdModel: Promise<void> | null = null
  let holdSave: Promise<void> | null = null
  let holdProject: Promise<void> | null = null
  let afterSave: (() => void) | undefined
  let afterAdvance: ((page: NovelScanPage) => void) | undefined
  let afterAccept: (() => void) | undefined
  let afterDecision: (() => void) | undefined
  let failProvider = false
  let rawError = false
  let aCalls = 0; let bCalls = 0; let saves = 0
  const requests: string[] = []
  const generator: NovelScanGenerator = async request => {
    await request.beforeRequest(); requests.push(request.prompt)
    if (request.phase === 'collect') aCalls++; else bCalls++
    if (holdModel) await holdModel
    if (failProvider) throw new Error('PRIVATE RAW PROVIDER DIAGNOSTIC')
    const wire = JSON.parse(request.prompt) as { sources: { reference: number; quote: string }[]; primaryReferences?: number[] }
    if (request.phase === 'collect') return JSON.stringify({ version: 1, cues: [{ kind: 'setup', keys: [wire.sources.find(source => source.reference === wire.primaryReferences![0])!.quote.match(/线索\d{4}/)?.[0] ?? '铜铃'], references: [wire.primaryReferences![0]!] }], saturated: false })
    const first = wire.sources[0]!.reference
    return JSON.stringify({ version: 1, candidates: [
      { kind: 'relationship', source: { type: 'person', label: '阿宁' }, target: { type: 'object', label: '铜铃' }, predicate: '与铜铃有关<script>bad()</script>', origin: 'inferred', premises: [{ role: 'support', references: [first] }] },
      { kind: 'foreshadowing', mode: 'setup_candidate', title: '铜铃约定<script>bad()</script>', explanation: '模型解释<svg onload="bad()">', premises: [{ role: 'setup', references: [first] }] },
    ], saturated: false })
  }
  const controller = useNovelCandidateScan({ configuration, current: () => source.value, canPrepare: () => available.value,
    async readProject() { projectReads++; readProjectHook?.(); if (holdProject) await holdProject; return clone(committed) },
    async readGraph() { graphReads++; readGraphHook?.(); if (readError) throw new Error('unsupported-version PRIVATE'); return clone(graph) },
    async saveGraph(next, expected) { saves++; if (holdSave) await holdSave; if (rawError) throw new Error('PRIVATE CAS'); assert.equal(expected, graph.revision || null); graph = { ...clone(next), revision: `cas-${saves}` }; afterSave?.(); return clone(graph) },
    async preparePlan(input) { if (holdPrepare) await holdPrepare; const real = await prepareNovelCandidateScan(input); return { ...real, startA: handle => real.startA(handle, generator), startB: handle => real.startB(handle, generator), async advance(handle) { const page = await real.advance(handle); afterAdvance?.(page); return page }, async decide(...args) { const page = await real.decide(...args); afterDecision?.(); return page }, async notifyAccepted(...args) { const page = await real.notifyAccepted(...args); afterAccept?.(); return page } } },
  })
  const enablePrepare = async () => { controller.state.setEnabled(true); assert.equal(await controller.state.prepare(), true) }
  const review = async () => { await enablePrepare(); assert.equal(await controller.state.startA(), true); assert.equal(controller.state.page?.state, 'ready_b'); assert.equal(await controller.state.startB(), true); assert.match(controller.state.page!.state, /^reviewing_/); assert.ok(controller.state.page!.candidates!.length) }
  return { controller, source, available, configuration, review, enablePrepare, requests,
    graph: () => graph, counts: () => ({ aCalls, bCalls, saves }), reads: () => ({ projectReads, graphReads }),
    changeSource: () => { committed.chapters[0]!.text += '已经提交的变动' },
    externalGraph: () => { graph = { ...graph, revision: 'outside' } },
    holdProject: (value: Promise<void> | null) => { holdProject = value },
    holdPrepare: (value: Promise<void>) => { holdPrepare = value }, holdModel: (value: Promise<void>) => { holdModel = value }, holdSave: (value: Promise<void>) => { holdSave = value },
    onReadProject: (value: () => void) => { readProjectHook = value },
    onReadGraph: (value: () => void) => { readGraphHook = value },
    afterSave: (value: () => void) => { afterSave = value }, afterAdvance: (value: (page: NovelScanPage) => void) => { afterAdvance = value }, afterAccept: (value: () => void) => { afterAccept = value }, afterDecision: (value: () => void) => { afterDecision = value }, failProvider: () => { failProvider = true }, readError: () => { readError = true }, rawError: () => { rawError = true },
  }
}
{
  const f = await fixture()
  assert.equal(f.controller.state.enabled, false)
  assert.equal(await f.controller.state.prepare(), false)
  await f.enablePrepare()
  assert.deepEqual(f.counts(), { aCalls: 0, bCalls: 0, saves: 0 })
  assert.equal(f.controller.state.preview!.eligibleChars, f.source.value.project.chapters.slice(0, 2).reduce((sum, chapter) => sum + chapter.text.length, 0))
  assert.equal(await f.controller.state.save('anything'), false)
  assert.equal(await f.controller.state.startA(), true)
  assert.equal(f.counts().bCalls, 0)
  assert.equal(f.controller.state.page!.state, 'ready_b')
  assert.equal(await f.controller.state.startB(), true)
  assert.match(f.controller.state.page!.state, /^reviewing_/)
  assert.ok(f.requests.every(prompt => !prompt.includes('未来身份')))
  assert.equal(networkCalls, 0)
  f.controller.dispose()
  check('Default off, zero-call preview, independent A/B starts, no save before stopped review, future source excluded')
}
for (const phase of ['preparing', 'ready', 'running', 'review'] as const) {
  for (const cause of ['cancel', 'disable', 'config', 'source', 'dispose'] as const) {
    const f = await fixture(); const hold = deferred<void>()
    if (phase === 'preparing') f.holdPrepare(hold.promise)
    if (phase === 'running') f.holdModel(hold.promise)
    f.controller.state.setEnabled(true)
    const pending = f.controller.state.prepare()
    if (phase !== 'preparing') await pending
    let running: Promise<boolean> = Promise.resolve(false)
    if (phase === 'running') { running = f.controller.state.startA(); await until(() => f.counts().aCalls === 1); assert.equal(f.controller.state.busy, true) }
    if (phase === 'review') { await f.controller.state.startA(); await f.controller.state.startB() }
    if (cause === 'cancel') f.controller.state.cancel()
    if (cause === 'disable') f.controller.state.setEnabled(false)
    if (cause === 'config') f.configuration.value.headers.key = 'changed'
    if (cause === 'source') f.source.value = { ...f.source.value, throughChapterId: 'one' }
    if (cause === 'dispose') f.controller.dispose()
    assert.equal(f.controller.state.preview, null, `${phase}/${cause}`)
    assert.equal(f.controller.state.page, null)
    assert.equal(f.controller.state.busy, false)
    if (phase === 'preparing') assert.equal(await pending, false)
    if (phase === 'running') assert.equal(await running, false)
    hold.resolve(); await nextTick(); await new Promise(done => setTimeout(done, 0))
    assert.equal(f.controller.state.page, null, 'Late completion cannot resurrect candidates')
    f.controller.dispose()
  }
}
check('Twenty lifecycle races: cancel/disable/config/disclosure/unmount during prepare, ready, running and review')
{
  const f = await fixture(); await f.review()
  const list = clone(f.controller.state.page!.candidates!)
  const relation = list.find(item => item.kind === 'relationship')!
  const plot = list.find(item => item.kind === 'foreshadowing')!
  assert.equal(await f.controller.state.save(relation.id), true)
  assert.equal(f.graph().revision, 'cas-1')
  assert.equal(f.graph().relations[0]!.authorConfirmed, false)
  assert.ok(f.controller.state.page!.candidates!.some(item => item.id === plot.id), 'Own CAS preserves other candidates after fresh revalidation')
  assert.equal(await f.controller.state.save(plot.id), true)
  assert.equal(f.graph().revision, 'cas-2')
  assert.equal(f.graph().plotLinks[0]!.authorConfirmed, false)
  assert.equal(f.graph().relations.length, 1)
  assert.equal(selectFactPlotLinks(f.source.value.project, f.source.value.stats, f.graph(), 'two').plotLinks.length, 1)
  assert.equal(f.controller.state.savedCount, 2)
  const duplicate = f.controller.state.page!.candidates!.find(item => item.kind === 'relationship' && JSON.stringify(item.evidence) === JSON.stringify((relation as Extract<typeof relation, { kind: 'relationship' }>).evidence))
  assert.ok(duplicate)
  assert.equal(await f.controller.state.save(duplicate.id), true)
  assert.equal(f.counts().saves, 2, 'Exact duplicate is acknowledged without another CAS')
  assert.equal(f.controller.state.savedCount, 2)
  for (const candidate of [...f.controller.state.page!.candidates!]) await f.controller.state.ignore(candidate.id)
  const attempts = f.controller.state.page!.progress.ledger.used.attempts
  await f.controller.state.nextSegment()
  assert.equal(f.counts().aCalls + f.counts().bCalls, attempts, 'Continuing a drained campaign never resets or dispatches by itself')
  f.controller.dispose()
  check('Own actual-CAS baseline only, two independent typed saves default unconfirmed, no dropped opposite type, explicit ignore and zero-call next segment')
}
for (const action of ['source', 'graph', 'unknown-version'] as const) {
  const f = await fixture(); await f.review()
  if (action === 'source') f.changeSource()
  if (action === 'graph') f.externalGraph()
  if (action === 'unknown-version') f.readError()
  await f.controller.auditCurrent()
  assert.equal(f.controller.state.preview, null)
  assert.equal(f.controller.state.page, null)
  assert.equal(f.counts().saves, 0)
  f.controller.dispose()
}
check('Eventless committed source/external graph/unsupported graph reads clear stale review without writing')
{
  const f = await fixture(); await f.review()
  f.afterSave(f.changeSource)
  assert.equal(await f.controller.state.save(f.controller.state.page!.candidates![0]!.id), false)
  assert.equal(f.graph().relations.length, 1)
  assert.equal(f.controller.state.savedCount, 1)
  assert.equal(f.controller.state.savedInvalid, true)
  assert.match(f.controller.state.error + f.controller.state.notice, /已保存/)
  f.controller.dispose()
  check('Source changes after actual CAS retain author data and show saved-but-invalid, never rollback')
}
{
  const f = await fixture(); await f.review(); const hold = deferred<void>(); f.holdSave(hold.promise)
  const pending = f.controller.state.save(f.controller.state.page!.candidates![0]!.id)
  await until(() => f.counts().saves === 1)
  f.controller.state.cancel(); assert.equal(await pending, false)
  hold.resolve(); await until(() => f.graph().relations.length === 1)
  await nextTick()
  assert.equal(f.controller.state.savedCount, 1)
  assert.equal(f.controller.state.savedInvalid, true)
  assert.equal(f.controller.state.page, null)
  f.controller.dispose()
  check('Cancellation during pending CAS never lies that nothing saved; late commit is retained and surfaced')
}
{
  const f = await fixture(); f.failProvider(); await f.enablePrepare()
  assert.equal(await f.controller.state.startA(), true)
  assert.equal(f.controller.state.page!.state, 'paused')
  assert.ok(f.controller.state.page!.failedJobId)
  assert.equal(f.controller.state.page!.progress.ledger.used.attempts, 1)
  const before = f.counts().aCalls
  await f.controller.state.retry()
  assert.equal(f.counts().aCalls, before + 1)
  await f.controller.state.skip()
  assert.ok(f.controller.state.page!.progress.skippedWindows > 0)
  assert.ok(f.controller.state.page!.progress.misses.length)
  assert.doesNotMatch(JSON.stringify(f.controller.state), /PRIVATE RAW/)
  f.controller.dispose()
  check('Provider failures pause, explicit retry is charged, skip enters miss ledger, raw errors never leak')
}
{
  const f = await fixture(); await f.enablePrepare(); const hold = deferred<void>(); f.holdModel(hold.promise)
  const running = f.controller.state.startA()
  await until(() => f.counts().aCalls === 1)
  assert.equal(f.controller.state.page!.state, 'running_a')
  assert.equal(await f.controller.state.pause(), true)
  hold.resolve(); await running
  assert.equal(f.controller.state.page!.state, 'paused')
  f.controller.state.cancel(); f.controller.dispose()
  check('First provider request exposes pause and cancel, pause returns immediately and settles at checkpoint')
}
{
  const f = await fixture(); await f.review()
  let reads = 0
  f.onReadGraph(() => { if (++reads === 1) f.changeSource() })
  assert.equal(await f.controller.state.save(f.controller.state.page!.candidates![0]!.id), false)
  assert.equal(f.counts().saves, 0)
  assert.equal(f.controller.state.page, null)
  f.controller.dispose()
  check('Committed source changes during graph read are rejected by the post-graph source guard before any write')
}
{
  const f = await fixture(); f.controller.state.setEnabled(true)
  f.controller.state.changeAllocation('attempts', 1)
  assert.equal(await f.controller.state.prepare(), true)
  await f.controller.state.startA()
  assert.equal(f.controller.state.page!.state, 'paused')
  const original = clone(f.controller.state.page!.progress.ledger)
  f.controller.state.setAdd('attempts', 4096)
  assert.equal(await f.controller.state.grant(), false)
  assert.equal(f.controller.state.page!.state, 'paused')
  assert.deepEqual(f.controller.state.page!.progress.ledger.authorized, original.authorized)
  f.controller.state.setAdd('attempts', 20)
  assert.equal(await f.controller.state.grant(), true)
  assert.equal(f.controller.state.page!.progress.ledger.authorized.attempts, 21)
  assert.equal(f.controller.state.page!.progress.ledger.used.attempts, 1)
  assert.equal(f.counts().aCalls, 1, 'Grant itself does not dispatch or retry a provider')
  await f.controller.state.resume()
  assert.equal(f.controller.state.page!.state, 'ready_b')
  f.controller.dispose()
  check('Invalid grants preserve paused campaign and ledger; finite additive grants neither reset nor implicitly dispatch')
}
{
  const f = await fixture(90); f.controller.state.setEnabled(true)
  const { NOVEL_SCAN_HARD_ALLOCATION } = await import('../src/types/memoryNovelScan')
  for (const key of Object.keys(NOVEL_SCAN_HARD_ALLOCATION) as (keyof typeof NOVEL_SCAN_HARD_ALLOCATION)[]) f.controller.state.changeAllocation(key, NOVEL_SCAN_HARD_ALLOCATION[key])
  assert.equal(await f.controller.state.prepare(), true)
  const campaign = f.controller.state.page!.campaignId
  await f.controller.state.startA(); assert.equal(f.controller.state.page!.progress.sourceCoverage, 'complete')
  await f.controller.state.startB()
  assert.equal(f.controller.state.page!.reason, 'review_capacity')
  await f.controller.state.finishPartial()
  assert.match(f.controller.state.page!.state, /^reviewing_/)
  assert.equal(f.controller.state.page!.candidates!.length, 512)
  const processed = f.controller.state.page!.progress.jobsProcessed
  const attempts = f.controller.state.page!.progress.ledger.used.attempts
  const segment = f.controller.state.page!.segmentId
  for (const candidate of [...f.controller.state.page!.candidates!]) assert.equal(await f.controller.state.ignore(candidate.id), true)
  await f.controller.state.nextSegment()
  assert.equal(f.controller.state.page!.state, 'ready_b')
  assert.equal(f.controller.state.page!.campaignId, campaign)
  assert.notEqual(f.controller.state.page!.segmentId, segment)
  assert.equal(f.controller.state.page!.progress.ledger.used.attempts, attempts)
  assert.equal(f.controller.state.page!.progress.jobsProcessed, processed)
  await f.controller.state.startB()
  assert.match(f.controller.state.page!.state, /^reviewing_/)
  assert.equal(f.controller.state.page!.progress.jobsProcessed, 267)
  assert.equal(f.counts().bCalls, 267, 'No B job repeats after review capacity segment')
  assert.equal(f.controller.state.page!.progress.connectionCoverage, 'complete_for_contract')
  f.controller.dispose()
  check('Real 90-chapter/267-job UI campaign stops at 512 review capacity and resumes B in new segment without repeats or ledger reset')
}
{
  const fakeWindow = new EventTarget(); const fakeDocument = new EventTarget()
  Object.assign(fakeDocument, { visibilityState: 'visible' })
  Object.assign(globalThis, { window: fakeWindow, document: fakeDocument })
  const f = await fixture(); await f.review(); const hold = deferred<void>(); f.holdSave(hold.promise)
  const oldCampaign = f.controller.state.page!.campaignId
  const pending = f.controller.state.save(f.controller.state.page!.candidates![0]!.id)
  await until(() => f.counts().saves === 1)
  f.controller.state.cancel(); assert.equal(await pending, false)
  const oldHistory = JSON.stringify(f.controller.state.history[0])
  assert.equal(await f.controller.state.prepare(), true)
  assert.notEqual(f.controller.state.page!.campaignId, oldCampaign)
  hold.resolve(); await until(() => f.graph().relations.length === 1); await nextTick()
  assert.equal(f.controller.state.page, null, 'A late older-campaign CAS is an external graph change to the newer campaign')
  assert.equal(f.controller.state.preview, null)
  assert.equal(f.controller.state.savedCount, 0, 'Old campaign completion cannot increment newer campaign saved count')
  assert.match(f.controller.state.notice, /先前批次/)
  assert.equal(f.controller.state.historyCount, 2)
  assert.equal(JSON.stringify(f.controller.state.history.find(item => item.campaignId === oldCampaign)), oldHistory, 'Late old CAS cannot rewrite frozen old costs')
  f.controller.dispose()
  Reflect.deleteProperty(globalThis, 'window'); Reflect.deleteProperty(globalThis, 'document')
  check('Late prior-campaign CAS invalidates a newly prepared baseline without polluting its saved count')
}
{
  const f = await fixture(); await f.enablePrepare(); const hold = deferred<void>(); f.holdModel(hold.promise)
  const pending = f.controller.state.startA(); await until(() => f.counts().aCalls === 1)
  f.controller.state.cancel(); await pending
  const prior = JSON.stringify(f.controller.state.history)
  assert.equal(f.controller.state.history[0]!.reason, 'cancelled')
  assert.equal(f.controller.state.history[0]!.ledger.used.attempts, 1, 'Dispatch cost is captured even before a provider response/page update')
  assert.ok(f.controller.state.history[0]!.ledger.used.inputBytes > 0)
  assert.equal(f.controller.state.history[0]!.inFlightAtStop, true)
  assert.ok(!prior.includes('沈砚') && !prior.includes('quote') && !prior.includes('endpoint'))
  hold.resolve(); await new Promise(done => setTimeout(done, 0))
  assert.equal(JSON.stringify(f.controller.state.history), prior, 'Late model results cannot mutate frozen costs')
  for (let index = 0; index < 10; index++) { assert.equal(await f.controller.state.prepare(), true); f.controller.state.cancel() }
  assert.equal(f.controller.state.history.length, 8)
  assert.equal(f.controller.state.historyCount, 11)
  assert.equal(f.controller.state.historyUsed.attempts, 1, 'Evicted detailed history retains route aggregate cost')
  assert.ok(f.controller.state.historySourceChars > 0)
  assert.equal(await f.controller.state.prepare(), true)
  const now = Date.now; Date.now = () => now() + 3_600_001
  try { await f.controller.state.startA() } finally { Date.now = now }
  assert.equal(f.controller.state.history[0]!.reason, 'expired')
  f.controller.dispose()
  check('Route-only bounded history preserves stopped/expired campaign costs, dispatched in-flight attempt, earlier aggregates and late-result isolation')
}
{
  const f = await fixture(); await f.enablePrepare(); await f.controller.state.startA()
  f.afterAdvance(page => { if (page.state.startsWith('reviewing_')) queueMicrotask(() => queueMicrotask(() => f.controller.state.cancel())) })
  assert.equal(await f.controller.state.startB(), false)
  assert.equal(f.controller.state.page, null, 'Cancel wins the resolved page → await continuation boundary before publication')
  assert.equal(f.controller.state.preview, null)
  f.controller.dispose()
  const g = await fixture(); await g.review()
  g.afterAccept(() => queueMicrotask(() => queueMicrotask(() => g.controller.state.cancel())))
  assert.equal(await g.controller.state.save(g.controller.state.page!.candidates![0]!.id), false)
  assert.equal(g.controller.state.page, null, 'Cancelled notifyAccepted result cannot restore review')
  assert.equal(g.graph().relations.length, 1); assert.equal(g.controller.state.savedCount, 1)
  g.controller.dispose()
  const h = await fixture(); await h.review(); let replacement: Promise<boolean> | undefined
  h.afterSave(() => queueMicrotask(() => queueMicrotask(() => { h.controller.state.cancel(); replacement = h.controller.state.prepare() })))
  assert.equal(await h.controller.state.save(h.controller.state.page!.candidates![0]!.id), false)
  await replacement
  assert.equal(h.graph().relations.length, 1)
  assert.equal(h.controller.state.savedCount, 0, 'Resolved old CAS cannot increment a newer campaign when cancel precedes its await continuation')
  h.controller.dispose()
  const d = await fixture(); await d.review()
  const relation = d.controller.state.page!.candidates!.find(item => item.kind === 'relationship')!
  await d.controller.state.save(relation.id)
  const duplicate = d.controller.state.page!.candidates!.find(item => item.kind === 'relationship' && relation.kind === 'relationship' && JSON.stringify(item.evidence) === JSON.stringify(relation.evidence))!
  assert.ok(duplicate)
  d.afterDecision(() => queueMicrotask(() => queueMicrotask(() => d.controller.state.cancel())))
  assert.equal(await d.controller.state.save(duplicate.id), false)
  assert.equal(d.controller.state.page, null, 'Duplicate-save ignore cannot republish after cancellation')
  assert.equal(d.counts().saves, 1)
  d.controller.dispose()
  check('Resolved-page/notifyAccepted/CAS microtask races never republish cancelled review or contaminate a newer saved count')
}
{
  const f = await fixture(); await f.review()
  for (const candidate of [...f.controller.state.page!.candidates!]) await f.controller.state.ignore(candidate.id)
  f.holdProject(new Promise<void>(() => {}))
  const original = globalThis.setTimeout; let boundedGuards = 0
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => { if (delay === 10_000) { boundedGuards++; return original(callback, 5, ...args) }; return original(callback, delay, ...args) }) as typeof setTimeout
  try { assert.equal(await f.controller.state.nextSegment(), false) } finally { globalThis.setTimeout = original }
  assert.ok(boundedGuards > 0)
  assert.equal(f.controller.state.busy, false)
  assert.equal(f.controller.state.page, null)
  assert.equal(f.controller.state.history[0]!.reason, 'guard_timeout')
  f.controller.dispose()
  check('Next-segment committed source preparation has its own bounded deadline even when a read ignores abort forever')
}
for (const boundary of ['first_a', 'next_segment'] as const) {
  const f = await fixture(3); const originalNow = performance.now; let time = 100
  Object.defineProperty(performance, 'now', { configurable: true, value: () => time })
  try {
    f.controller.state.changeAllocation('activeMs', 50); f.controller.state.setCueCapacity(4)
    await f.enablePrepare()
    if (boundary === 'next_segment') {
      await f.controller.state.startA(); assert.equal(f.controller.state.page!.reason, 'cue_capacity')
      await f.controller.state.finishPartial(); await f.controller.state.startB()
      assert.equal(f.controller.state.page!.state, 'reviewing_partial')
      for (const candidate of [...f.controller.state.page!.candidates!]) await f.controller.state.ignore(candidate.id)
    }
    const beforeCalls = f.counts(); const beforeReads = f.reads(); const held = deferred<void>()
    f.holdProject(held.promise); f.onReadProject(() => { time += 50 })
    if (boundary === 'first_a') await f.controller.state.startA(); else await f.controller.state.nextSegment()
    assert.equal(f.controller.state.page!.state, 'paused')
    assert.equal(f.controller.state.page!.reason, 'budget')
    assert.equal(f.controller.state.page!.progress.ledger.used.activeMs, 50)
    assert.equal(f.controller.state.busy, false)
    const pausedReads = f.reads()
    assert.equal(pausedReads.projectReads, beforeReads.projectReads + 1)
    assert.equal(pausedReads.graphReads, beforeReads.graphReads)
    held.resolve(); await new Promise(done => setTimeout(done, 0))
    assert.deepEqual(f.reads(), pausedReads, `${boundary}: expired operation must not begin graph/source reads after releasing an ignored-abort source read`)
    assert.deepEqual(f.counts(), beforeCalls, `${boundary}: no provider or CAS call after guard budget pause`)
  } finally { f.controller.dispose(); Object.defineProperty(performance, 'now', { configurable: true, value: originalNow }) }
}
check('First A and next-segment guard budget pauses abort the operation lease, so releasing old reads cannot begin any later committed read')
const root = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ configFile: false, root, plugins: [vue()], resolve: { alias: { '@': path.join(root, 'src') } }, server: { middlewareMode: true, ws: false, hmr: false, watch: null }, logLevel: 'error' })
try {
  assert.equal(server.httpServer, null, 'The SSR loader must not create an HTTP listener')
  const { default: Panel } = await server.ssrLoadModule('/src/components/memory/NovelCandidateScan.vue')
  const f = await fixture(); await f.review()
  const html = await renderToString(createSSRApp(Panel, { state: f.controller.state, available: true }))
  for (const id of ['novel-scan-source-coverage', 'novel-scan-connection-coverage', 'novel-scan-ledger', 'novel-scan-miss-ledger', 'novel-scan-premise', 'novel-scan-revision', 'novel-scan-quote', 'novel-scan-candidate-0', 'novel-scan-save-0', 'novel-scan-ignore-0']) assert.ok(html.includes(id), id)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script>bad|<svg onload=/)
  assert.match(html, /远程扫描已停止/)
  assert.match(html, /不代表发现全书所有语义关系|不等于所有语义已提取/)
  const preview = clone(f.controller.state.page) as NovelScanPage
  for (const state of ['ready_a', 'ready_b', 'paused', 'running_a', 'running_b'] as const) {
    const page = { ...preview, state, candidates: undefined }
    const rendered = await renderToString(createSSRApp(Panel, { state: { ...f.controller.state, page }, available: true }))
    assert.ok(!rendered.includes('novel-scan-save-0'))
    assert.ok(rendered.includes('novel-scan-cancel'))
  }
  f.controller.dispose()
  await server.ssrLoadModule('/src/components/memory/PlotLinksPanel.vue')
  await server.ssrLoadModule('/src/views/MemoryLab.vue')
} finally { await server.close() }
const lab = fs.readFileSync(path.join(root, 'src/views/MemoryLab.vue'), 'utf8')
assert.match(lab, /<NovelCandidateScan/); assert.match(lab, /<PlotLinksPanel/); assert.match(lab, /novelScan.dispose\(\)/)
const writer = fs.readFileSync(path.join(root, 'src/views/Writer.vue'), 'utf8')
assert.doesNotMatch(writer, /NovelCandidateScan|plotLinks|novelScan/)
assert.equal(networkCalls, 0)
assert.equal(storage.size, 0)
check('Actual Vue SSR escapes model text, shows all typed premise/revision controls, never saves while running; Lab compiled, Writer untouched, no persisted scan state')
console.log('=== MEMORY NOVEL SCAN UI TESTS PASSED ===')
