/** Private Writer selection bridge and separate author-approval lifecycle. */
import assert from 'node:assert/strict'
import { nextTick, ref } from 'vue'
import { MemoryIndex } from '../src/services/memory/engine'
import { chapterRevision } from '../src/services/memory/revision'
import type { PreparedWriterMemoryContext, WriterMemoryRequest } from '../src/services/memory/writerContext'
import type { FactGraphDocument } from '../src/types/factGraph'
import type { MemoryProjectInput } from '../src/types/memory'
import type { SupportGenerationRequest, SupportResponseV1 } from '../src/types/memorySupport'
import type { WriterChapter, WriterNovel } from '../src/types/writer'

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } })
const { prepareWriterMemoryContext } = await import('../src/services/memory/writerContext')
const { useWriterMemoryContext } = await import('../src/composables/useWriterMemoryContext')
const { SupportCheckError } = await import('../src/services/memory/supportCheck')

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const noOwnerChange = { assertOwner() {} }
const raw = JSON.stringify({ version: 1, verdict: 'supported', reason: 'combined_premises', answer: '接应点在石桥。',
  explanation: '所选原文明示两个必要前提。', premises: [
    { text: '阿宁可凭蓝牌进入北库。', references: [1] }, { text: '北库接应点在石桥。', references: [2] },
  ], missing: [] } satisfies SupportResponseV1)
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
async function fixture() {
  const project: MemoryProjectInput = { id: 'novel:1', title: 'Writer support synthetic', clues: [], chapters: [
    { id: '11', title: '蓝牌', text: '阿宁持有蓝牌；持蓝牌的人可以进入北库。' },
    { id: '22', title: '接应', text: '北库的接应点是石桥。' },
    { id: '33', title: '当前章', text: '旅人等候消息。' },
  ] }
  const evidence = await Promise.all(project.chapters.slice(0, 2).map(async chapter => ({ chapterId: chapter.id,
    sourceRevision: await chapterRevision(chapter), start: 0, end: chapter.text.length, quote: chapter.text })))
  const graph: FactGraphDocument = { version: 1, projectId: project.id, revision: 'graph-one', relations: [{
    id: 'whole-chain', projectId: project.id, source: { type: 'person', label: '阿宁' }, target: { type: 'place', label: '石桥' },
    predicate: '未来身份别名不得发往支持检查', origin: 'inferred', createdBy: 'author', authorConfirmed: true, evidence,
  }] }
  const client = new MemoryIndex()
  const dependencies = { client, readProject: async () => copy(project), readGraph: async () => copy(graph) }
  const request: WriterMemoryRequest = { projectId: project.id, query: '阿宁 北库 石桥', throughChapterId: '22', targetChapterId: '33', maxChars: 16000 }
  return { project, graph, client, dependencies, request, prepare: () => prepareWriterMemoryContext(request, dependencies) }
}
const source = await fixture()
const candidate = await source.prepare()
assert.ok(candidate.relations.some(item => item.id === 'whole-chain'))
await assert.rejects(() => candidate.prepareSupportCheck('接应点在哪里？', noOwnerChange), error => error instanceof SupportCheckError && error.reason === 'invalid_input')
for (const selection of [
  { hitIds: ['unknown'], relationIds: [] },
  { hitIds: [], relationIds: ['whole-chain', 'whole-chain'] },
]) await assert.rejects(() => candidate.selectEvidence(selection))
const empty = await candidate.selectEvidence({ hitIds: [], relationIds: [] })
await assert.rejects(() => empty.prepareSupportCheck('接应点在哪里？', noOwnerChange), SupportCheckError)
// Relation selection sends every original premise, not annotation labels, aliases, or approval.
candidate.relations[0]!.evidence.pop()
candidate.relations[0]!.predicate = 'forged preview'
const selected = await candidate.selectEvidence({ hitIds: [], relationIds: ['whole-chain'] })
const originalPrompt = selected.prompt
const plan = await selected.prepareSupportCheck('阿宁凭蓝牌可进入之处的接应点在哪里？', noOwnerChange)
assert.equal(plan.preview.sourceCount, 2)
selected.relations[0]!.evidence[0]!.quote = 'forged public quote'
const result = await plan.run(async request => {
  await request.beforeRequest()
  const wire = JSON.parse(request.prompt)
  assert.equal(wire.sources.length, 2)
  assert.deepEqual(wire.sources.map((item: { quote: string }) => item.quote), source.project.chapters.slice(0, 2).map(item => item.text))
  for (const hidden of ['未来身份别名', 'authorConfirmed', 'whole-chain', 'forged', 'chapterTitle', 'novel:1', 'inferred']) assert.ok(!request.prompt.includes(hidden))
  return raw
})
assert.equal(result.state, 'assessed')
assert.equal(selected.prompt, originalPrompt, 'Model answer/explanation never changes Writer prompt')
assert.ok(!selected.prompt.includes('所选原文明示两个必要前提。'))
assert.equal(selected.assessment.answerability, 'unverified', 'Literal-match summary is not promoted')

// One stale premise invalidates the selected relation, even if authorConfirmed.
const stale = await fixture(); const staleCandidate = await stale.prepare()
const staleSelected = await staleCandidate.selectEvidence({ hitIds: [], relationIds: ['whole-chain'] })
const stalePlan = await staleSelected.prepareSupportCheck('接应点在哪里？', noOwnerChange)
stale.project.chapters[1]!.text = '北库的接应点已变更。'
let staleCalls = 0
const staleResult = await stalePlan.run(async () => { staleCalls++; return raw })
assert.equal(staleResult.state, 'unverified'); assert.equal(staleCalls, 0)
await assert.rejects(() => staleSelected.assertFresh())
// Graph provenance edits also revoke, without changing quote locations.
const graphEdit = await fixture(); const graphCandidate = await graphEdit.prepare()
const graphSelected = await graphCandidate.selectEvidence({ hitIds: [], relationIds: ['whole-chain'] })
const graphPlan = await graphSelected.prepareSupportCheck('接应点在哪里？', noOwnerChange)
graphEdit.graph.relations[0]!.authorConfirmed = false
assert.equal((await graphPlan.run(async () => raw)).state, 'unverified')
// An invalid source revision is never rescued by copying the returned index manifest.
const forged = await fixture(); forged.graph.relations[0]!.evidence[1]!.sourceRevision = 'a'.repeat(64)
assert.ok(!(await forged.prepare()).relations.some(item => item.id === 'whole-chain'))
// A whole relation exceeding the check budget is rejected, not trimmed to fit.
const large = await fixture()
large.project.chapters[0]!.text = Array.from({ length: 6 }, (_, index) => `${index}阿宁石桥${'甲'.repeat(1495)}`).join('\n')
const chapter = large.project.chapters[0]!
const revision = await chapterRevision(chapter)
large.graph.relations[0]!.evidence = chapter.text.split('\n').map(quote => ({ chapterId: chapter.id, sourceRevision: revision,
  start: chapter.text.indexOf(quote), end: chapter.text.indexOf(quote) + quote.length, quote }))
const largeCandidate = await large.prepare()
assert.ok(largeCandidate.relations.some(item => item.id === 'whole-chain'))
const largeSelected = await largeCandidate.selectEvidence({ hitIds: [], relationIds: ['whole-chain'] })
await assert.rejects(() => largeSelected.prepareSupportCheck('阿宁在哪里？', noOwnerChange), error => error instanceof SupportCheckError && error.reason === 'input_budget')

// Real Writer composable, real private service, controlled model transport only.
const uiSource = await fixture()
const chapterList = uiSource.project.chapters.map(chapter => ({ id: Number(chapter.id), title: chapter.title, content: chapter.text })) as WriterChapter[]
const novel = ref({ id: 1, title: 'Synthetic' } as WriterNovel)
const chapters = ref(chapterList)
const current = ref(chapterList[2]!)
const content = ref(current.value.content!)
let saveOK = true
let calls = 0
let pending: ReturnType<typeof deferred<string>> | null = null
let dispatched: ReturnType<typeof deferred<void>> | null = null
let failProvider = false
function wrap(candidate: PreparedWriterMemoryContext): PreparedWriterMemoryContext {
  return { ...candidate,
    selectEvidence: async selection => wrap(await candidate.selectEvidence(selection)),
    prepareSupportCheck: async (question, owner) => {
      const plan = await candidate.prepareSupportCheck(question, owner)
      return { ...plan, run: () => plan.run(async (request: SupportGenerationRequest) => {
        await request.beforeRequest(); calls++; dispatched?.resolve()
        if (failProvider) throw new Error('Synthetic failed provider, not a semantic result')
        return pending ? pending.promise : raw
      }) }
    },
  }
}
const memory = useWriterMemoryContext({ currentNovel: novel, chapters, currentChapter: current, targetChapter: current, content,
  saveCurrentChapter: async () => saveOK, client: uiSource.client,
  prepare: async request => wrap(await prepareWriterMemoryContext({ ...request, maxChars: 16000 }, uiSource.dependencies)),
})
memory.state.enabled = true; memory.state.query = '阿宁 北库 石桥'; memory.state.cutoffId = '22'
assert.equal(await memory.search(), true, memory.state.error)
assert.deepEqual(memory.state.selection, { hitIds: [], relationIds: [] })
memory.select({ hitIds: [], relationIds: ['whole-chain'] })
assert.equal(await memory.approve(), true)
const oldLease = await memory.acquire(); assert.ok(oldLease)
memory.support.state.setEnabled(true)
assert.equal(await memory.support.state.prepare(), true, JSON.stringify(memory.support.state.result))
assert.equal(calls, 0, 'Local review planning must never call the provider')
assert.equal(memory.state.approved, false, 'Preparing a support check revokes prior generation approval')
assert.equal(await memory.support.state.run(), true, JSON.stringify(memory.support.state.result))
assert.equal(memory.support.state.result.state, 'assessed')
assert.equal(memory.state.approved, false)
await assert.rejects(() => memory.acquire()!)
assert.equal(await memory.approve(), true, 'Only independent author approval enables writing')
const afterSupportLease = await memory.acquire(); assert.ok(afterSupportLease)
assert.ok(!afterSupportLease!.prompt.includes('所选原文明示两个必要前提。'))
// Running state cannot race an approval or a second Start; cancel drops late success.
pending = deferred<string>(); dispatched = deferred<void>()
assert.equal(await memory.support.state.prepare(), true)
const run = memory.support.state.run(); await dispatched.promise
assert.equal(await memory.approve(), false)
assert.equal(await memory.support.state.run(), false)
const callsBeforeCancel = calls
memory.support.state.cancel()
assert.equal(await run, false)
pending.resolve(raw); await nextTick()
assert.equal(memory.support.state.result.state, 'unverified'); assert.equal(memory.state.approved, false)
assert.equal(calls, callsBeforeCancel)
pending = null; dispatched = null
// Provider failure does not approve; genuinely current selected evidence remains reviewable.
failProvider = true
assert.equal(await memory.support.state.prepare(), true); assert.equal(await memory.support.state.run(), false)
assert.equal(memory.state.approved, false); assert.ok(memory.state.result)
assert.equal(await memory.approve(), true)
failProvider = false
// Selection/query/cutoff/editor changes clear a displayed assessment synchronously.
for (const change of [
  () => memory.select({ hitIds: [], relationIds: [] }),
  () => { memory.state.query += '变化' },
  () => { memory.state.cutoffId = '11' },
  () => { content.value += '改' },
]) {
  memory.state.query = '阿宁 北库 石桥'; memory.state.cutoffId = '22'; content.value = uiSource.project.chapters[2]!.text
  await nextTick(); assert.equal(await memory.search(), true); memory.select({ hitIds: [], relationIds: ['whole-chain'] })
  assert.equal(await memory.support.state.prepare(), true); assert.equal(await memory.support.state.run(), true, JSON.stringify(memory.support.state.result))
  change()
  assert.equal(memory.support.state.result.state, 'unverified')
}
await nextTick()
// Failed editor persistence cannot create retrieval or support capability.
saveOK = false; memory.state.query = '阿宁 北库 石桥'; memory.state.cutoffId = '22'
assert.equal(await memory.search(), false)
assert.equal(await memory.support.state.prepare(), false)
await assert.rejects(() => oldLease!.assertFresh())
memory.dispose()
assert.equal(await memory.support.state.prepare(), false)
console.log(JSON.stringify({ suite: 'writer-memory-support', privateCompleteRelations: true, stalePremiseBlocks: true,
  independentApproval: true, noPromptInjection: true, cancellationAndSourceInvalidation: true, controlledCalls: calls, realModelCalls: 0 }))
