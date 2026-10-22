/** Private Writer selection bridge and separate author-approval lifecycle. */
import assert from 'node:assert/strict'
import { nextTick, ref, shallowRef, watch } from 'vue'
import { useWriterMemoryOwner } from '../src/composables/useWriterMemoryOwner'
import { useWriterChapterContentGeneration } from '../src/composables/useWriterChapterContentGeneration'
import { createWriterMemoryStream } from '../src/composables/writerMemoryStream'
import { MemoryIndex } from '../src/services/memory/engine'
import { chapterRevision } from '../src/services/memory/revision'
import type { PreparedWriterMemoryContext, WriterMemoryRequest } from '../src/services/memory/writerContext'
import type { FactGraphDocument } from '../src/types/factGraph'
import type { MemoryProjectInput } from '../src/types/memory'
import type { SupportGenerationRequest, SupportResponseV1 } from '../src/types/memorySupport'
import type { WriterChapter, WriterNovel } from '../src/types/writer'
import type { GenerateOptions } from '../src/types/api'

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

// Exercise the actual production owner watcher with real Vue refs, private
// memory preparation, chapter launch controller, and memory stream adapter.
type Entry = 'chapter' | 'continue' | 'optimize'
const entries: Entry[] = ['chapter', 'continue', 'optimize']
async function ownerFixture() {
  const source = await fixture()
  const chapters = ref(source.project.chapters.map(chapter => ({
    id: Number(chapter.id), title: chapter.title, content: chapter.text,
  })) as WriterChapter[])
  const currentNovel = ref<WriterNovel | null>({ id: 1, title: 'Synthetic' })
  const currentChapter = ref<WriterChapter | null>(chapters.value[2]!)
  const content = ref(currentChapter.value!.content!)
  const memoryTarget = shallowRef<WriterChapter | null>(null)
  const memory = useWriterMemoryContext({ currentNovel, chapters, currentChapter, targetChapter: memoryTarget, content,
    saveCurrentChapter: async () => true, client: source.client,
    prepare: async request => wrap(await prepareWriterMemoryContext({ ...request, maxChars: 16000 }, source.dependencies)),
  })
  assert.equal(memory.state.enabled, false, 'A new Writer instance starts with memory disabled')
  assert.equal(memory.support.state.enabled, false, 'A new Writer instance starts with support disabled')
  const generated = deferred<string>()
  const generationDispatched = deferred<void>()
  const selectionStarted = deferred<void>()
  const selectionGate = deferred<void>()
  const commitStarted = deferred<void>()
  const commitGate = deferred<boolean>()
  let holdSelection = false
  let holdCommit = false
  let generationCalls = 0
  let persistCalls = 0
  const sentPrompts: string[] = []
  const messages: string[] = []
  const stream = createWriterMemoryStream({
    isStreaming: ref(false), streamingContent: ref(''), reset() {}, stop() {},
    async generate(prompt: string, options?: GenerateOptions) {
      await options?.beforeRequest?.()
      generationCalls++
      sentPrompts.push(prompt)
      generationDispatched.resolve()
      // Deliberately ignore abort, just like a late provider response.
      return generated.promise
    },
  }, memory)
  const controller = useWriterChapterContentGeneration({
    currentNovel, chapters, currentChapter, content, hasUnsavedChanges: ref(false),
    characters: ref([]), worldSettings: ref([]), corpusData: ref([]), events: ref([]),
    prepare: () => true,
    selectChapter: async (chapter, selection) => {
      selectionStarted.resolve()
      if (holdSelection) await selectionGate.promise
      selection?.onPersisted?.(true)
      if (selection?.isCurrent?.() === false) return false
      currentChapter.value = chapter
      content.value = chapter.content || ''
      return true
    },
    persist: async () => {
      persistCalls++
      commitStarted.resolve()
      if (holdCommit && !await commitGate.promise) return false
      currentChapter.value!.content = content.value
      source.project.chapters.find(chapter => chapter.id === String(currentChapter.value!.id))!.text = content.value
      return true
    },
    notify: { success: message => messages.push(message), info() {}, warning: message => messages.push(message), error: message => messages.push(message) },
    stream, formatContent: response => response,
  })
  const visible = { chapter: controller.visible, continue: ref(false), optimize: ref(false) }
  // Match Writer.vue's target update, including its batched chapter switch.
  const stopTarget = watch([controller.visible, controller.targetChapter, currentChapter], () => {
    memoryTarget.value = controller.visible.value ? controller.targetChapter.value : currentChapter.value
  }, { immediate: true })
  const stopOwner = useWriterMemoryOwner({
    chapterVisible: visible.chapter, continueVisible: visible.continue, optimizeVisible: visible.optimize,
    isChapterLaunchClose: controller.isExpectedDialogClose,
    hasApprovedMemory: () => memory.state.approved,
    invalidateSupport: () => memory.support.invalidate(),
    revoke: () => memory.revoke(),
  })
  const open = async (entry: Entry) => {
    if (entry === 'chapter') assert.equal(controller.open(chapters.value[2]!), true)
    else visible[entry].value = true
    await nextTick()
  }
  const select = async () => {
    memory.state.enabled = true
    memory.support.state.setEnabled(true)
    memory.state.query = '阿宁 北库 石桥'
    memory.state.cutoffId = '22'
    await nextTick()
    assert.equal(await memory.search(), true, memory.state.error)
    memory.select({ hitIds: [], relationIds: ['whole-chain'] })
  }
  const assess = async () => {
    assert.equal(await memory.support.state.prepare(), true, JSON.stringify(memory.support.state.result))
    assert.equal(await memory.support.state.run(), true, JSON.stringify(memory.support.state.result))
  }
  const assertCleared = (why: string) => {
    assert.equal(memory.state.result, null, why)
    assert.deepEqual(memory.state.selection, { hitIds: [], relationIds: [] }, why)
    assert.equal(memory.state.approved, false, why)
    assert.equal(memory.state.busy, false, why)
    assert.equal(memory.support.busy, false, why)
    assert.equal(memory.support.state.preview, null, why)
    assert.equal(memory.support.state.result.state, 'unverified', why)
    assert.equal(memory.support.state.phase, 'idle', why)
    assert.equal(memory.state.enabled, true, 'Same-instance owner changes retain the author memory toggle')
    assert.equal(memory.support.state.enabled, true, 'Same-instance owner changes retain the author support toggle')
  }
  const start = () => {
    controller.selectPrompt({ id: 1, title: '生成', category: 'content', content: '继续撰写当前章。' })
    return controller.generateChapterContentWithDialog()
  }
  return { memory, controller, visible, currentChapter, chapters, content, open, select, assess, assertCleared, start,
    generated, generationDispatched, selectionStarted, selectionGate, commitStarted, commitGate, sentPrompts, messages,
    generationCalls: () => generationCalls, persistCalls: () => persistCalls,
    holdSelection: () => { holdSelection = true }, holdCommit: () => { holdCommit = true },
    dispose() { stopOwner(); stopTarget(); controller.dispose(); stream.dispose(); memory.dispose() },
  }
}

// Every entry: close synchronously revokes settled support and author approval;
// reopening the same Writer preserves toggles, but none of its old capabilities.
for (const entry of entries) {
  const f = await ownerFixture()
  await f.open(entry); await f.select(); await f.assess()
  assert.equal(await f.memory.approve(), true)
  const lease = await f.memory.acquire(); assert.ok(lease)
  f.visible[entry].value = false
  f.assertCleared(`${entry}: close must revoke immediately, without nextTick`)
  await assert.rejects(() => lease!.assertFresh())
  await f.open(entry)
  f.assertCleared(`${entry}: same-instance reopen must not restore approval or assessment`)
  assert.equal(await f.memory.support.state.prepare(), false)
  f.dispose()
}

// Every entry: an abort-ignoring support provider cannot return into a closed
// or reopened owner. Support busy is independent of retrieval/approval busy.
for (const entry of entries) {
  const f = await ownerFixture()
  await f.open(entry); await f.select()
  const before = calls
  assert.equal(await f.memory.support.state.prepare(), true)
  assert.equal(f.memory.support.state.phase, 'ready')
  f.visible[entry].value = false
  f.assertCleared(`${entry}: an unsent review plan loses its owner at close`)
  await f.open(entry)
  assert.equal(await f.memory.support.state.run(), false)
  assert.equal(calls, before, 'Reopening cannot dispatch a previous owner review plan')
  f.dispose()
}

for (const entry of entries) {
  const f = await ownerFixture()
  await f.open(entry); await f.select()
  pending = deferred<string>(); dispatched = deferred<void>()
  assert.equal(await f.memory.support.state.prepare(), true)
  const running = f.memory.support.state.run(); await dispatched.promise
  assert.equal(f.memory.state.busy, false)
  assert.equal(f.memory.support.busy, true)
  f.visible[entry].value = false
  f.assertCleared(`${entry}: held support request loses its owner synchronously`)
  await f.open(entry)
  pending.resolve(raw)
  assert.equal(await running, false)
  await nextTick()
  f.assertCleared(`${entry}: ignored-abort late result cannot survive reopen`)
  pending = null; dispatched = null; f.dispose()
}

// Exercise every ordered owner switch, including open-new-before-close-old.
for (const from of entries) for (const to of entries.filter(entry => entry !== from)) {
  const f = await ownerFixture()
  await f.open(from); await f.select(); await f.assess()
  assert.equal(await f.memory.approve(), true)
  f.visible[to].value = true
  f.assertCleared(`${from} -> ${to}: opening another entry revokes old ownership`)
  f.visible[from].value = false
  f.assertCleared(`${from} -> ${to}: closing previous entry cannot resurrect ownership`)
  f.dispose()
}

// Resolve the provider first, then close within the same turn before any await
// continuation can publish the response. A default batched watcher is too late.
for (const entry of entries) {
  const f = await ownerFixture()
  await f.open(entry); await f.select()
  pending = deferred<string>(); dispatched = deferred<void>()
  assert.equal(await f.memory.support.state.prepare(), true)
  const running = f.memory.support.state.run(); await dispatched.promise
  pending.resolve(raw)
  f.visible[entry].value = false
  f.assertCleared(`${entry}: resolve/close microtask boundary must be synchronous`)
  assert.equal(await running, false)
  await nextTick()
  f.assertCleared(`${entry}: resolved-before-close support response stays discarded`)
  pending = null; dispatched = null; f.dispose()
}

// The chapter's private synchronous launch close transfers only an approved
// writing lease. Real memory preflight, provider dispatch, and save all succeed.
{
  const f = await ownerFixture()
  await f.open('chapter'); await f.select(); await f.assess()
  assert.equal(await f.memory.approve(), true)
  f.holdCommit()
  const action = f.start()
  assert.equal(f.visible.chapter.value, false)
  assert.equal(f.controller.isExpectedDialogClose(), false, 'Launch marker ends before the first async request step')
  assert.equal(f.memory.state.approved, true, 'Author-approved memory survives only the launch handoff')
  assert.equal(f.memory.support.state.result.state, 'unverified', 'Hidden support assessment does not transfer')
  assert.equal(f.memory.support.state.preview, null)
  await f.generationDispatched.promise
  assert.equal(f.generationCalls(), 1)
  assert.match(f.sentPrompts[0]!, /北库/)
  assert.ok(!f.sentPrompts[0]!.includes('所选原文明示两个必要前提。'))
  f.generated.resolve('已批准依据生成并保存的正文。')
  await f.commitStarted.promise
  assert.equal(f.controller.cancel(), false, 'Commit remains non-cancellable')
  f.visible.continue.value = true
  f.assertCleared('Opening another entry during commit cleans capabilities without aborting save')
  f.commitGate.resolve(true)
  assert.equal(await action, true)
  assert.equal(f.persistCalls(), 1)
  assert.equal(f.currentChapter.value!.content, '已批准依据生成并保存的正文。')
  await nextTick()
  f.assertCleared('Saved completion leaves no old memory or support capabilities')
  f.visible.continue.value = false
  f.assertCleared('User close after saved completion keeps cleanup intact')
  f.dispose()
}

// Launch alone is not approval. A click while support is running closes the
// dialog, fails memory acquisition, and cannot keep the hidden support owner.
{
  const f = await ownerFixture()
  await f.open('chapter'); await f.select()
  pending = deferred<string>(); dispatched = deferred<void>()
  assert.equal(await f.memory.support.state.prepare(), true)
  const running = f.memory.support.state.run(); await dispatched.promise
  const originalError = console.error
  console.error = () => undefined
  try { assert.equal(await f.start(), false) } finally { console.error = originalError }
  f.assertCleared('Unapproved failed chapter launch must fully revoke the hidden owner')
  assert.equal(f.generationCalls(), 0)
  assert.equal(f.persistCalls(), 0)
  pending.resolve(raw)
  assert.equal(await running, false)
  await nextTick()
  f.assertCleared('Late support result cannot return after failed chapter launch')
  pending = null; dispatched = null; f.dispose()
}

// A slow chapter selection is not the synchronous author-approved launch close.
{
  const f = await ownerFixture()
  f.currentChapter.value = f.chapters.value[0]!
  f.content.value = f.currentChapter.value.content!
  await f.open('chapter'); await f.select()
  assert.equal(await f.memory.approve(), true)
  f.holdSelection()
  const action = f.start()
  await f.selectionStarted.promise
  assert.equal(f.controller.isBusy.value, true)
  assert.equal(f.controller.isExpectedDialogClose(), false)
  f.visible.chapter.value = false
  f.assertCleared('Manual close while selecting cannot masquerade as launch handoff')
  f.selectionGate.resolve()
  assert.equal(await action, false)
  assert.equal(f.generationCalls(), 0)
  assert.equal(f.persistCalls(), 0)
  f.dispose()
}

// Successful chapter switching preserves the approved target's exact source;
// the narrow handoff is not limited to generating the already-current chapter.
{
  const f = await ownerFixture()
  f.currentChapter.value = f.chapters.value[0]!
  f.content.value = f.currentChapter.value.content!
  await f.open('chapter'); await f.select()
  assert.equal(await f.memory.approve(), true)
  f.holdSelection()
  const action = f.start()
  await f.selectionStarted.promise
  assert.equal(f.controller.isExpectedDialogClose(), false)
  f.selectionGate.resolve()
  await f.generationDispatched.promise
  assert.equal(f.currentChapter.value!.id, 33)
  assert.equal(f.memory.state.approved, true)
  f.generated.resolve('切章后合法生成的正文。')
  assert.equal(await action, true)
  assert.equal(f.persistCalls(), 1)
  assert.equal(f.currentChapter.value!.content, '切章后合法生成的正文。')
  await nextTick()
  f.assertCleared('Saved source change cleans up the handed-off approval without reopening a dialog')
  f.dispose()
}

// Default-off chapter launch still dispatches and saves without requesting an
// approval or creating a support capability as a side effect of owner cleanup.
{
  const f = await ownerFixture()
  await f.open('chapter')
  const action = f.start()
  await f.generationDispatched.promise
  assert.equal(f.memory.state.enabled, false)
  assert.equal(f.memory.support.state.enabled, false)
  assert.equal(f.memory.state.approved, false)
  assert.ok(!f.sentPrompts[0]!.includes('WRITER_MEMORY_CONTEXT_JSON'))
  f.generated.resolve('未启用记忆的正常正文。')
  assert.equal(await action, true)
  assert.equal(f.persistCalls(), 1)
  f.dispose()
}

// The narrow handoff cannot exempt a later owner change, even in the exact
// resolved-response/await-continuation window of chapter generation itself.
{
  const f = await ownerFixture()
  await f.open('chapter'); await f.select()
  assert.equal(await f.memory.approve(), true)
  const original = f.content.value
  const action = f.start()
  await f.generationDispatched.promise
  f.generated.resolve('不能保存的迟到正文。')
  f.visible.optimize.value = true
  f.assertCleared('Later entry opening revokes the handed-off writing lease synchronously')
  assert.equal(await action, false)
  assert.equal(f.content.value, original)
  assert.equal(f.persistCalls(), 0)
  f.dispose()
}
// Node-only SSR of the actual parent/child SFC templates, driven by the real
// owner fixture. This verifies render/mount gates, not browser acceptance or DOM
// event dispatch. No HTTP/WebSocket listener, browser, network, or model is used.
{
  const [{ createServer }, { default: vue }, { createSSRApp, h }, { renderToString }, { fileURLToPath }] = await Promise.all([
    import('vite'), import('@vitejs/plugin-vue'), import('vue'), import('@vue/server-renderer'), import('node:url'),
  ])
  const root = fileURLToPath(new URL('..', import.meta.url))
  const server = await createServer({ configFile: false, root, plugins: [vue()],
    resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
    server: { middlewareMode: true, ws: false, hmr: false, watch: null }, logLevel: 'error' })
  const f = await ownerFixture()
  try {
    assert.equal(server.httpServer, null, 'The SSR loader must not create an HTTP listener')
    const { default: WriterMemoryContext } = await server.ssrLoadModule('/src/components/writer/WriterMemoryContext.vue')
    // The small harness owns only dialog visibility. All nested v-if conditions,
    // checkbox states, disabled buttons and child markup are production SFCs.
    const render = () => renderToString(createSSRApp({ render: () => f.visible.chapter.value
      ? h(WriterMemoryContext, { ...f.memory.state, chapters: f.memory.chapters.value }) : null }))
    let html = await render()
    const tag = (id: string) => {
      const matches = [...html.matchAll(new RegExp(`<[^>]+data-testid="writer-memory-${id}"[^>]*>`, 'g'))]
      assert.equal(matches.length, 1, `Expected exactly one rendered ${id} control`)
      return matches[0]![0]
    }
    const absent = (...ids: string[]) => {
      for (const id of ids) assert.ok(!html.includes(`data-testid="writer-memory-${id}"`), `${id} must not be mounted`)
    }
    const flag = (id: string, attribute: 'checked' | 'disabled', expected: boolean) => {
      assert.equal(new RegExp(`\\s${attribute}(?:[\\s=>])`).test(tag(id)), expected, `${id} ${attribute}`)
    }
    const cleanSupport = () => absent('support-preview', 'support-send', 'support-assessment', 'support-answer', 'approved')
    const unselected = () => {
      assert.deepEqual(f.memory.state.selection, { hitIds: [], relationIds: [] })
      const inputs = [...html.matchAll(/<input[^>]+data-testid="writer-memory-select-(?:hit|relation)-\d+"[^>]*>/g)]
      assert.ok(inputs.length > 0, 'The fixture must render actual evidence selection controls')
      for (const [input] of inputs) assert.doesNotMatch(input, /\schecked(?:[\s=>])/, 'Candidates are never auto-selected')
    }
    absent('panel', 'support', 'approve')
    await f.open('chapter')
    html = await render()
    tag('panel'); flag('enabled', 'checked', false)
    absent('query', 'search', 'result', 'support', 'approve')

    f.memory.state.enabled = true
    f.memory.state.query = '阿宁 北库 石桥'; f.memory.state.cutoffId = '22'
    await nextTick()
    html = await render()
    flag('enabled', 'checked', true); tag('query'); flag('search', 'disabled', false)
    absent('result', 'support', 'support-enabled', 'support-prepare', 'approve')
    assert.equal(await f.memory.search(), true, f.memory.state.error)
    html = await render()
    tag('result'); tag('support'); flag('support-enabled', 'checked', false)
    unselected(); flag('approve', 'disabled', true)
    absent('support-check-question', 'support-prepare'); cleanSupport()

    f.memory.support.state.setEnabled(true)
    html = await render()
    flag('support-enabled', 'checked', true); tag('support-check-question')
    tag('support-unavailable'); flag('support-prepare', 'disabled', true); flag('approve', 'disabled', true)
    cleanSupport()
    f.memory.select({ hitIds: [], relationIds: ['whole-chain'] })
    html = await render()
    flag('select-relation-0', 'checked', true)
    flag('support-prepare', 'disabled', false); flag('approve', 'disabled', false)
    absent('support-unavailable'); cleanSupport()
    assert.equal(await f.memory.support.state.prepare(), true)
    html = await render()
    tag('support-preview'); flag('support-send', 'disabled', false); flag('approve', 'disabled', false)
    absent('support-answer', 'approved')
    f.memory.select({ hitIds: [], relationIds: [] })
    html = await render()
    unselected(); flag('support-prepare', 'disabled', true); flag('approve', 'disabled', true)
    cleanSupport()

    f.memory.select({ hitIds: [], relationIds: ['whole-chain'] })
    assert.equal(await f.memory.support.state.prepare(), true)
    pending = deferred<string>(); dispatched = deferred<void>()
    const running = f.memory.support.state.run(); await dispatched.promise
    html = await render()
    tag('support-running'); flag('support-prepare', 'disabled', true); flag('approve', 'disabled', true)
    absent('support-send', 'support-answer', 'approved')
    pending.resolve(raw)
    assert.equal(await running, true)
    pending = null; dispatched = null
    html = await render()
    tag('support-assessment'); tag('support-answer'); flag('approve', 'disabled', false)
    absent('approved')
    assert.equal(await f.memory.approve(), true)
    html = await render()
    tag('approved'); flag('approve', 'disabled', true)

    f.visible.chapter.value = false
    f.assertCleared('SSR close revokes the result, preview, assessment and approval')
    html = await render()
    absent('panel', 'result', 'support', 'approve')
    await f.open('chapter')
    html = await render()
    tag('panel'); flag('enabled', 'checked', true); tag('query')
    assert.equal(f.memory.support.state.enabled, true, 'Reopening retains the support preference, not its subtree')
    absent('result', 'support', 'support-enabled', 'support-prepare', 'approve'); cleanSupport()
    assert.equal(await f.memory.search(), true, f.memory.state.error)
    html = await render()
    tag('result'); tag('support'); flag('support-enabled', 'checked', true); tag('support-check-question')
    unselected(); flag('support-prepare', 'disabled', true); flag('approve', 'disabled', true)
    cleanSupport()
    assert.ok(!html.includes('所选原文明示两个必要前提。'), 'The previous model explanation must not reappear')
  } finally {
    pending?.resolve(raw); pending = null; dispatched = null
    f.dispose()
    await server.close()
  }
}
console.log('✓ Node-only actual-SFC SSR mount lifecycle: default off, result gate, selection/review gates and clean reopen; NOT browser acceptance')
console.log(JSON.stringify({ suite: 'writer-memory-support', privateCompleteRelations: true, stalePremiseBlocks: true,
  independentApproval: true, noPromptInjection: true, cancellationAndSourceInvalidation: true,
  threeEntryOwnership: true, approvedChapterLaunchHandoff: true, resolvedResponseRace: true,
  controlledCalls: calls, realModelCalls: 0 }))
