/** Selection is an author decision, never an inferred answer-confidence threshold. */
import assert from 'node:assert/strict'
import { nextTick, ref } from 'vue'
import { MemoryIndex } from '../src/services/memory/engine'
import { chapterRevision } from '../src/services/memory/revision'
import { prepareWriterMemoryContext, WRITER_MEMORY_MARKER, type PreparedWriterMemoryContext } from '../src/services/memory/writerContext'
import { useWriterMemoryContext } from '../src/composables/useWriterMemoryContext'
import { createWriterMemoryStream } from '../src/composables/writerMemoryStream'
import { createAIRequestScope } from '../src/utils/aiRequestScope'
import type { FactGraphDocument } from '../src/types/factGraph'
import type { MemoryMatchSummary, MemoryProjectInput } from '../src/types/memory'
import type { GenerateOptions, StreamCallback } from '../src/types/api'
import type { WriterChapter, WriterNovel } from '../src/types/writer'

type Selection = { hitIds: string[]; relationIds: string[] }
const emptySelection = (): Selection => ({ hitIds: [], relationIds: [] })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function until(condition: () => boolean) {
  for (let turn = 0; turn < 60 && !condition(); turn++) await Promise.resolve()
  assert.ok(condition(), 'Expected asynchronous selection boundary was not reached')
}
function payload(value: PreparedWriterMemoryContext | { prompt: string }) {
  assert.ok(value.prompt.includes(`${WRITER_MEMORY_MARKER}\n`))
  return JSON.parse(value.prompt.split(`${WRITER_MEMORY_MARKER}\n`)[1]!) as {
    assessment: MemoryMatchSummary
    sources: Array<{ id: string; quote: string }>
    relations: Array<{ id: string; origin: string; authorConfirmed: boolean; evidence: Array<{ quote: string }> }>
  }
}

async function serviceFixture() {
  const project: MemoryProjectInput = {
    id: 'novel:1', title: '人工选择验收', clues: [], chapters: [
      { id: '11', title: '旧仓', text: '铜符AB-12由林青保管。' },
      { id: '22', title: '渡口', text: '匣子ZX_45由顾宁运到渡口。' },
      { id: '33', title: '当前章', text: '旅人留在院内等候消息。' },
    ],
  }
  const evidence = await Promise.all(project.chapters.slice(0, 2).map(async chapter => ({
    chapterId: chapter.id, sourceRevision: await chapterRevision(chapter),
    start: 0, end: chapter.text.length, quote: chapter.text,
  })))
  const graph: FactGraphDocument = {
    version: 1, projectId: project.id, revision: 'selection-graph', relations: [{
      id: 'inference', projectId: project.id, source: { type: 'object', label: '铜符' },
      target: { type: 'object', label: '匣子' }, predicate: '可能同属一次交接',
      origin: 'inferred', createdBy: 'model', authorConfirmed: true, evidence,
    }],
  }
  const client = new MemoryIndex()
  let afterProjectRead: (() => void) | undefined
  let afterGraphRead: (() => void) | undefined
  let beforeProjectRead: (() => Promise<void>) | undefined
  const dependencies = {
    client,
    readProject: async () => {
      await beforeProjectRead?.()
      const value = structuredClone(project)
      const after = afterProjectRead
      afterProjectRead = undefined
      after?.()
      return value
    },
    readGraph: async () => {
      const value = structuredClone(graph)
      const after = afterGraphRead
      afterGraphRead = undefined
      after?.()
      return value
    },
  }
  const request = { projectId: project.id, query: '铜符AB-12 匣子ZX_45', throughChapterId: '22', targetChapterId: '33', maxChars: 16_000 }
  return {
    project, graph, client, dependencies, request,
    prepare: () => prepareWriterMemoryContext(request, dependencies),
    afterProjectRead: (run: () => void) => { afterProjectRead = run },
    afterGraphRead: (run: () => void) => { afterGraphRead = run },
    beforeProjectRead: (run?: () => Promise<void>) => { beforeProjectRead = run },
  }
}

const source = await serviceFixture()
const prepared = await source.prepare()
const first = prepared.hits.find(hit => hit.chapterId === '11')!
const second = prepared.hits.find(hit => hit.chapterId === '22')!
assert.ok(first && second)
assert.equal(prepared.relations.length, 1)
const firstId = first.id
const secondId = second.id
const originalFirstQuote = first.quote
const originalSecondQuote = second.quote
const relationId = prepared.relations[0]!.id

// Exposed preview values are mutable UI copies. Selection must use the trusted
// captured source, not deserialize or copy the edited presentation objects.
first.quote = '篡改后的伪造正文'
first.chapterTitle = '未来身份被篡改'
first.reason = '篡改后的已回答标记'
first.match!.identifiers.quote.push('zx_45')
prepared.assessment.missingIdentifiers.length = 0
prepared.relations[0]!.origin = 'explicit'
prepared.relations[0]!.source.label = '篡改实体'
prepared.relations[0]!.evidence[0]!.quote = '篡改后的伪造前提'
prepared.relationMatches[relationId]!.length = 0
prepared.prompt = '篡改后的任意提示词'
const one = await prepared.selectEvidence({ hitIds: [firstId], relationIds: [] })
assert.equal(payload(one).sources.length, 1)
assert.equal(payload(one).sources[0]!.id, firstId)
assert.equal(payload(one).sources[0]!.quote, originalFirstQuote)
assert.equal(one.hits.length, 1)
assert.equal(one.relations.length, 0)
assert.deepEqual(Object.keys(one.relationMatches), [])
assert.ok(!one.prompt.includes(originalSecondQuote))
assert.ok(!one.prompt.includes('篡改'))
assert.equal(one.assessment.answerability, 'unverified')
assert.deepEqual(one.assessment.requestedIdentifiers, ['ab-12', 'zx_45'])
assert.deepEqual(one.assessment.missingIdentifiers, ['zx_45'], 'Unselected matching sources cannot fill the selected bundle’s missing-code coverage')
assert.deepEqual(payload(one).assessment, one.assessment, 'The actual generation payload keeps the same selected-only, answer-unverified assessment')
console.log('✓ 私有来源快照抵御预览篡改；仅选中引用入上下文，匹配概况不借用未选依据')

const relationOnly = await prepared.selectEvidence({ hitIds: [], relationIds: [relationId] })
const selectedRelation = payload(relationOnly).relations[0]!
assert.equal(payload(relationOnly).sources.length, 0)
assert.equal(selectedRelation.id, relationId)
assert.equal(selectedRelation.origin, 'inferred')
assert.equal(selectedRelation.authorConfirmed, true)
assert.deepEqual(selectedRelation.evidence.map(item => item.quote), [originalFirstQuote, originalSecondQuote])
assert.ok(!relationOnly.prompt.includes('篡改'))
assert.equal(relationOnly.assessment.answerability, 'unverified')
assert.deepEqual(relationOnly.assessment.missingIdentifiers, [])
assert.deepEqual(Object.keys(relationOnly.relationMatches), [relationId])
assert.equal(relationOnly.relationMatches[relationId]!.length, 2)
const both = await prepared.selectEvidence({ hitIds: [firstId, secondId], relationIds: [] })
assert.deepEqual(both.assessment.missingIdentifiers, [])
assert.ok(both.prompt.length <= both.maxChars)
console.log('✓ 关系按全部前提整体选取，作者确认不把推断变成原文明示，多项编号覆盖可合并')

const empty = await prepared.selectEvidence(emptySelection())
assert.equal(empty.prompt, '')
assert.deepEqual(empty.hits, [])
assert.deepEqual(empty.relations, [])
assert.equal(empty.assessment.state, 'none')
for (const selection of [
  { hitIds: ['unknown-hit'], relationIds: [] },
  { hitIds: [firstId, firstId], relationIds: [] },
  { hitIds: [], relationIds: ['unknown-relation'] },
  { hitIds: [], relationIds: [relationId, relationId] },
  { hitIds: [relationId], relationIds: [] },
  { hitIds: [], relationIds: [firstId] },
]) await assert.rejects(prepared.selectEvidence(selection))
const smallFixture = await serviceFixture()
const small = await prepareWriterMemoryContext({ ...smallFixture.request, maxChars: 1_000 }, smallFixture.dependencies)
assert.ok(small.truncated)
assert.equal(small.relations.length, 0, 'A multi-premise relation that cannot fit is omitted whole')
await assert.rejects(small.selectEvidence({ hitIds: [], relationIds: ['inference'] }),
  'Selection cannot restore an item omitted from the trusted budgeted preview')
console.log('✓ 空选择不生成附件；未知、重复及跨类别 ID 均拒绝')

const weakFixture = await serviceFixture()
const weak = await prepareWriterMemoryContext({ ...weakFixture.request, query: '铜符MISSING9', includeGraph: false }, weakFixture.dependencies)
assert.ok(weak.hits.length > 0)
assert.equal(weak.assessment.state, 'candidates')
const selectedWeak = await weak.selectEvidence({ hitIds: [weak.hits[0]!.id], relationIds: [] })
assert.ok(selectedWeak.prompt)
assert.equal(selectedWeak.assessment.state, 'candidates', 'An explicit author selection does not upgrade weak lexical overlap')
assert.equal(selectedWeak.assessment.answerability, 'unverified')
assert.deepEqual(selectedWeak.assessment.missingIdentifiers, ['missing9'])
const noCandidates = await prepareWriterMemoryContext({ ...weakFixture.request, query: 'NOANSWER99999', includeGraph: false }, weakFixture.dependencies)
assert.equal(noCandidates.prompt, '')
assert.equal(noCandidates.assessment.state, 'none')
assert.equal((await noCandidates.selectEvidence(emptySelection())).prompt, '')
console.log('✓ 弱匹配可以由作者选作待核对参考，但不升级已回答；无候选仍产生空附件')

const inputGate = deferred<void>()
let reading = false
source.beforeProjectRead(async () => { reading = true; await inputGate.promise })
const mutableSelection = { hitIds: [firstId], relationIds: [] }
const captured = prepared.selectEvidence(mutableSelection)
await until(() => reading)
mutableSelection.hitIds[0] = secondId
inputGate.resolve()
source.beforeProjectRead()
assert.deepEqual(payload(await captured).sources.map(hit => hit.id), [firstId], 'Selection is captured before its first asynchronous source check')

for (const kind of ['source', 'graph'] as const) {
  const fixture = await serviceFixture()
  const preview = await fixture.prepare()
  if (kind === 'source') fixture.afterProjectRead(() => { fixture.project.chapters[0]!.text += '之后才改写。' })
  else fixture.afterGraphRead(() => { fixture.graph.relations[0]!.predicate = '来源检查之后改变的标注' })
  await assert.rejects(preview.selectEvidence({ hitIds: [preview.hits[0]!.id], relationIds: [] }), /改变|失效/,
    'A source change after the initial fresh snapshot must be caught before selected evidence is published')
}
console.log('✓ 选择参数在调用时捕获，来源／图谱在初次复验后改变也无法发布附件')

function baseStream() {
  const isStreaming = ref(false)
  const streamingContent = ref('')
  const requests: Array<{ prompt: string; options: GenerateOptions; callback: StreamCallback | null; resolve: (text: string) => void }> = []
  const scope = createAIRequestScope((prompt, options, callback) => {
    const result = deferred<string>()
    requests.push({ prompt, options, callback, resolve: result.resolve })
    return result.promise
  }, state => { isStreaming.value = state.isStreaming; streamingContent.value = state.streamingContent })
  return { ...scope, isStreaming, streamingContent, requests }
}
async function controllerFixture() {
  const fixture = await serviceFixture()
  const chapters = ref<WriterChapter[]>(fixture.project.chapters.map(chapter => ({
    id: Number(chapter.id), title: chapter.title, content: `<p>${chapter.text}</p>`,
  })) as WriterChapter[])
  const currentChapter = ref<WriterChapter | null>(chapters.value[2]!)
  const targetChapter = ref<WriterChapter | null>(currentChapter.value)
  const currentNovel = ref<WriterNovel | null>({ id: 1, title: fixture.project.title, chapterList: chapters.value } as WriterNovel)
  const content = ref(currentChapter.value!.content!)
  let selectionGate: Promise<void> | undefined
  let selections = 0
  const memory = useWriterMemoryContext({
    currentNovel, chapters, currentChapter, targetChapter, content, client: fixture.client,
    saveCurrentChapter: async () => true,
    prepare: async (request, dependencies) => {
      const result = await prepareWriterMemoryContext({ ...request, maxChars: 16_000 }, { ...fixture.dependencies, signal: dependencies.signal })
      return { ...result, selectEvidence: async selection => {
        selections++
        const gate = selectionGate
        if (gate) await gate
        return result.selectEvidence(selection)
      } }
    },
  })
  const base = baseStream()
  const stream = createWriterMemoryStream(base, memory)
  memory.state.enabled = true
  memory.state.query = fixture.request.query
  memory.state.cutoffId = '22'
  await nextTick()
  assert.equal(await memory.search(), true)
  const ids = memory.state.result!.hits.map(hit => hit.id)
  return { ...fixture, chapters, memory, base, stream, ids,
    selectionCalls: () => selections,
    gateSelection: (gate?: Promise<void>) => { selectionGate = gate },
    dispose() { stream.dispose(); memory.dispose() },
  }
}

const defaults = await controllerFixture()
assert.deepEqual(defaults.memory.state.selection, emptySelection())
assert.equal(await defaults.memory.approve(), false)
await assert.rejects(defaults.memory.acquire()!)
const previewIdentity = defaults.memory.state.result
defaults.memory.select({ hitIds: [defaults.ids[0]!], relationIds: [] })
assert.equal(await defaults.memory.approve(), true)
const oldLease = await defaults.memory.acquire()
assert.ok(oldLease)
assert.equal(payload(oldLease).sources.length, 1)
assert.equal(payload(oldLease).sources[0]!.id, defaults.ids[0])
let invalidations = 0
defaults.memory.onInvalidate(() => { invalidations++ })
defaults.memory.select({ hitIds: [defaults.ids[1]!], relationIds: [] })
assert.equal(defaults.memory.state.approved, false)
assert.equal(defaults.memory.state.result, previewIdentity, 'Changing selection preserves candidates without another retrieval')
assert.ok(invalidations > 0)
await assert.rejects(oldLease.assertFresh())
await assert.rejects(defaults.memory.acquire()!)
defaults.dispose()
console.log('✓ 新预览默认零选择；空选不能批准，改选保留候选并立即撤销旧审批／租约')

for (const order of ['older-first', 'newer-first'] as const) {
  const late = await controllerFixture()
  const approvalGate = deferred<void>()
  late.memory.select({ hitIds: [late.ids[0]!], relationIds: [] })
  late.gateSelection(approvalGate.promise)
  const obsoleteApproval = late.memory.approve()
  await until(() => late.selectionCalls() === 1)
  late.memory.select({ hitIds: [late.ids[1]!], relationIds: [] })
  const currentGate = deferred<void>()
  late.gateSelection(currentGate.promise)
  const currentApproval = late.memory.approve()
  await until(() => late.selectionCalls() === 2)
  if (order === 'older-first') {
    approvalGate.resolve()
    assert.equal(await obsoleteApproval, false)
    assert.equal(late.memory.state.busy, true, 'Obsolete approval finally must not clear the current approval’s busy state')
    assert.equal(late.memory.state.approved, false)
  }
  currentGate.resolve()
  assert.equal(await currentApproval, true)
  if (order === 'newer-first') {
    approvalGate.resolve()
    assert.equal(await obsoleteApproval, false)
  }
  assert.equal(late.memory.state.approved, true, 'The late obsolete approval cannot revoke or replace the newer selected bundle')
  const latestLease = await late.memory.acquire()
  assert.deepEqual(payload(latestLease!).sources.map(hit => hit.id), [late.ids[1]])
  late.dispose()
}
console.log('✓ 异步旧审批晚返回不能批准旧选择，也不能清除已批准的新选择')

const active = await controllerFixture()
active.memory.select({ hitIds: [active.ids[0]!], relationIds: [] })
assert.equal(await active.memory.approve(), true)
const generating = active.stream.generate('继续写作')
await until(() => active.base.requests.length === 1)
const wire = active.base.requests[0]!
assert.deepEqual(payload(wire).sources.map(hit => hit.id), [active.ids[0]])
wire.callback?.('部分', '已生成一部分')
active.memory.select({ hitIds: [active.ids[1]!], relationIds: [] })
assert.equal(wire.options.signal!.aborted, true)
assert.equal(active.stream.streamingContent.value, '')
wire.resolve('不应接纳的旧选择结果')
await assert.rejects(generating, { name: 'AbortError' })
await assert.rejects(active.stream.assertApplicationFresh(), /失效/)
active.dispose()

const sourceEdit = await controllerFixture()
sourceEdit.memory.select({ hitIds: [sourceEdit.ids[0]!], relationIds: [] })
assert.equal(await sourceEdit.memory.approve(), true)
const beforeEdit = await sourceEdit.memory.acquire()
sourceEdit.chapters.value[0]!.content = '<p>旧章已经修改。</p>'
await nextTick()
assert.equal(sourceEdit.memory.state.result, null)
assert.equal(sourceEdit.memory.state.approved, false)
assert.deepEqual(sourceEdit.memory.state.selection, emptySelection())
await assert.rejects(beforeEdit!.assertFresh())
sourceEdit.dispose()
console.log('✓ 流期间改选阻止迟到输出及应用；真实本地来源变化同时清除候选、选择和审批')
console.log('=== WRITER MEMORY SELECTION TESTS PASSED ===')
