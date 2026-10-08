/** Approved memory attachments share the Writer controller/transport lifetime. */
import assert from 'node:assert/strict'
import { nextTick, ref } from 'vue'
import { useWriterMemoryContext } from '../src/composables/useWriterMemoryContext'
import { createWriterMemoryStream } from '../src/composables/writerMemoryStream'
import { useWriterContinue } from '../src/composables/useWriterContinue'
import { useWriterOptimize } from '../src/composables/useWriterOptimize'
import { createAIRequestScope } from '../src/utils/aiRequestScope'
import type { GenerateOptions, StreamCallback } from '../src/types/api'
import type { WriterChapter, WriterNovel } from '../src/types/writer'
import type { PreparedWriterMemoryContext, WriterMemoryRequest } from '../src/services/memory/writerContext'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
async function until(condition: () => boolean) {
  for (let turn = 0; turn < 30 && !condition(); turn++) await Promise.resolve()
  assert.ok(condition(), 'Expected asynchronous boundary was not reached')
}
function baseStream() {
  const isStreaming = ref(false)
  const streamingContent = ref('')
  const requests: Array<{
    prompt: string; options: GenerateOptions; callback: StreamCallback | null
    resolve: (value: string) => void
  }> = []
  const scope = createAIRequestScope((prompt, options, callback) => {
    const result = deferred<string>()
    requests.push({ prompt, options, callback, resolve: result.resolve })
    return result.promise
  }, state => { isStreaming.value = state.isStreaming; streamingContent.value = state.streamingContent })
  return { ...scope, isStreaming, streamingContent, requests }
}
function fixture() {
  const chapters = ref<WriterChapter[]>([
    { id: 11, title: '旧章', content: '<p>阿宁保管铜铃。</p>' },
    { id: 22, title: '当前章', content: `<p>${'已有正文'.repeat(20)}</p>` },
  ] as WriterChapter[])
  const currentChapter = ref<WriterChapter | null>(chapters.value[1]!)
  const targetChapter = ref<WriterChapter | null>(currentChapter.value)
  const currentNovel = ref<WriterNovel | null>({ id: 1, title: '测试小说', chapterList: chapters.value } as WriterNovel)
  const content = ref(currentChapter.value!.content!)
  let save = async () => { currentChapter.value!.content = content.value; return true }
  let fresh = async () => undefined as void
  let prepareCalls = 0
  let freshCalls = 0
  let savedCalls = 0
  let prepareGate: Promise<PreparedWriterMemoryContext> | null = null
  let lastRequest: WriterMemoryRequest | null = null
  let lastSignal: AbortSignal | undefined
  const prepared = (): PreparedWriterMemoryContext => ({
    projectId: 'novel:1', query: '铜铃', throughChapterId: '11', fingerprint: 'preview',
    prompt: 'WRITER_MEMORY_CONTEXT_JSON\n{"quote":"阿宁保管铜铃。"}',
    hits: [], relations: [], maxChars: 6000, truncated: false,
    diagnostics: { semantic: 'disabled', rerank: 'disabled', eligiblePassages: 1, embeddedPassages: 0, cachedPassages: 0, rerankedCandidates: 0, warnings: [] },
    assertFresh: () => { freshCalls++; return fresh() },
  })
  const client = {
    async sync(): Promise<never> { throw new Error('Injected preparation should own the test client') },
    async search(): Promise<never> { throw new Error('Injected preparation should own the test client') },
    invalidateSource() {}, dispose() {},
  }
  const memory = useWriterMemoryContext({
    currentNovel, chapters, currentChapter, targetChapter, content, client,
    saveCurrentChapter: () => { savedCalls++; return save() },
    prepare: (request, dependencies) => {
      prepareCalls++; lastRequest = request; lastSignal = dependencies.signal
      return prepareGate ?? Promise.resolve(prepared())
    },
  })
  const base = baseStream()
  const stream = createWriterMemoryStream(base, memory)
  async function approve() {
    memory.state.enabled = true
    memory.state.query = '铜铃'
    memory.state.cutoffId = '11'
    await nextTick()
    assert.equal(await memory.search(), true)
    assert.equal(await memory.approve(), true)
  }
  return {
    chapters, currentNovel, currentChapter, targetChapter, content, memory, base, stream, approve, prepared,
    setSave: (value: () => Promise<boolean>) => { save = value },
    setFresh: (value: () => Promise<void>) => { fresh = value },
    setPrepareGate: (value: Promise<PreparedWriterMemoryContext>) => { prepareGate = value },
    prepareCalls: () => prepareCalls, freshCalls: () => freshCalls, savedCalls: () => savedCalls,
    lastRequest: () => lastRequest, lastSignal: () => lastSignal,
    dispose() { stream.dispose(); memory.dispose() },
  }
}

const ordinary = fixture()
const ordinaryRequest = ordinary.stream.generate('原始提示词')
assert.equal(ordinary.base.requests.length, 1, 'Default-off transport remains synchronous')
assert.equal(ordinary.base.requests[0]!.prompt, '原始提示词')
assert.equal(ordinary.savedCalls(), 0)
assert.equal(ordinary.prepareCalls(), 0)
ordinary.base.requests[0]!.resolve('普通结果')
assert.equal(await ordinaryRequest, '普通结果')
ordinary.dispose()
console.log('✓ Default-off keeps the existing synchronous request without saving, indexing or attaching context')

for (const mode of ['failed-save', 'editor-edit', 'other-source-edit'] as const) {
  const f = fixture()
  f.memory.state.enabled = true
  f.memory.state.query = '铜铃'
  const saved = deferred<boolean>()
  f.setSave(() => saved.promise)
  const pending = f.memory.search()
  if (mode === 'editor-edit') f.content.value += '保存期间的新输入'
  if (mode === 'other-source-edit') f.chapters.value[0]!.content = '保存期间修改旧章'
  saved.resolve(mode !== 'failed-save')
  assert.equal(await pending, false)
  assert.equal(f.prepareCalls(), 0)
  assert.equal(f.memory.state.approved, false)
  f.dispose()
}
const draft = fixture()
draft.content.value = '<p>当前未保存正文 &amp; 铜铃。</p>'
await draft.approve()
assert.equal(draft.lastRequest()!.expectedTarget!.text, '当前未保存正文 & 铜铃。')
assert.equal(draft.chapters.value[1]!.content, draft.content.value)
assert.equal(draft.memory.state.approved, true, 'The save operation itself must not revoke a valid preview')
draft.dispose()
const switchedTarget = fixture()
switchedTarget.targetChapter.value = switchedTarget.chapters.value[0]!
await switchedTarget.approve()
switchedTarget.currentChapter.value = switchedTarget.chapters.value[0]!
switchedTarget.content.value = switchedTarget.chapters.value[0]!.content!
await nextTick()
assert.equal(switchedTarget.memory.state.approved, true, 'Expected target selection must not revoke a matching saved preview')
const selectedLease = await switchedTarget.memory.acquire()
assert.ok(selectedLease?.prompt)
switchedTarget.dispose()
console.log('✓ Preview requires saved current text; local editor/other-chapter edits during saving revoke preparation')

const latePreview = fixture()
latePreview.memory.state.enabled = true
latePreview.memory.state.query = '铜铃'
const previewGate = deferred<PreparedWriterMemoryContext>()
latePreview.setPrepareGate(previewGate.promise)
const previewing = latePreview.memory.search()
await until(() => latePreview.prepareCalls() === 1)
latePreview.memory.cancel()
assert.equal(latePreview.lastSignal()!.aborted, true)
previewGate.resolve(latePreview.prepared())
assert.equal(await previewing, false)
assert.equal(latePreview.memory.state.result, null)
assert.equal(latePreview.memory.state.busy, false)
latePreview.dispose()
console.log('✓ A cancelled delayed preview cannot republish evidence or approval')

const preflight = fixture()
await preflight.approve()
const freshnessGate = deferred<void>()
preflight.setFresh(() => freshnessGate.promise)
const cancelledPreflight = preflight.stream.generate('续写任务')
assert.equal(preflight.stream.isStreaming.value, true)
assert.equal(preflight.base.requests.length, 0)
preflight.stream.stop()
assert.equal(preflight.stream.isStreaming.value, false)
freshnessGate.resolve()
await assert.rejects(cancelledPreflight, { name: 'AbortError' })
assert.equal(preflight.base.requests.length, 0, 'Late preflight must never dispatch generation')
preflight.dispose()
const callerCancelled = fixture()
await callerCancelled.approve()
const callerGate = deferred<void>()
callerCancelled.setFresh(() => callerGate.promise)
const callerAbort = new AbortController()
const pendingCaller = callerCancelled.stream.generate('调用方取消', { signal: callerAbort.signal })
callerAbort.abort()
assert.equal(callerCancelled.stream.isStreaming.value, false)
callerGate.resolve()
await assert.rejects(pendingCaller, { name: 'AbortError' })
assert.equal(callerCancelled.base.requests.length, 0)
callerCancelled.dispose()
console.log('✓ Cancelling delayed freshness preflight immediately clears busy and never starts a late model request')

const staleBeforeWire = fixture()
await staleBeforeWire.approve()
staleBeforeWire.setFresh(async () => { throw new Error('引用旧章已改稿') })
await assert.rejects(staleBeforeWire.stream.generate('生成'), /旧章已改稿/)
assert.equal(staleBeforeWire.base.requests.length, 0)
assert.equal(staleBeforeWire.memory.state.approved, false)
staleBeforeWire.dispose()

const actualWire = fixture()
await actualWire.approve()
let callerChecks = 0
const wireGeneration = actualWire.stream.generate('模型请求', { beforeRequest: async () => { callerChecks++ } })
await until(() => actualWire.base.requests.length === 1)
const wireRequest = actualWire.base.requests[0]!
assert.ok(wireRequest.options.beforeRequest)
await wireRequest.options.beforeRequest()
assert.equal(callerChecks, 1)
actualWire.setFresh(async () => { throw new Error('SDK实际发送前旧章已改变') })
await assert.rejects(wireRequest.options.beforeRequest(), /SDK实际发送前/)
assert.equal(wireRequest.options.signal!.aborted, true)
wireRequest.resolve('不应接受的回复')
await assert.rejects(wireGeneration, { name: 'AbortError' })
assert.equal(actualWire.stream.streamingContent.value, '')
actualWire.dispose()

const active = fixture()
await active.approve()
const activeGeneration = active.stream.generate('续写')
await until(() => active.base.requests.length === 1)
const activeRequest = active.base.requests[0]!
assert.match(activeRequest.prompt, /WRITER_MEMORY_CONTEXT_JSON/)
activeRequest.callback?.('部分', '部分结果')
active.chapters.value[0]!.content = '刚刚修改的旧章'
await nextTick()
assert.equal(activeRequest.options.signal!.aborted, true)
assert.equal(active.stream.streamingContent.value, '')
activeRequest.callback?.('迟到', '迟到输出')
activeRequest.resolve('迟到输出')
await assert.rejects(activeGeneration, { name: 'AbortError' })
assert.equal(active.stream.streamingContent.value, '')
active.dispose()

const completed = fixture()
await completed.approve()
const completedGeneration = completed.stream.generate('续写')
await until(() => completed.base.requests.length === 1)
completed.base.requests[0]!.resolve('已完成续写')
assert.equal(await completedGeneration, '已完成续写')
completed.memory.revoke('其他标签页修改旧章')
assert.equal(completed.stream.streamingContent.value, '')
await assert.rejects(completed.stream.assertApplicationFresh(), /失效/)
completed.dispose()
console.log('✓ Before-wire, active-stream and completed-result invalidation all reject old evidence and late output')

const finalCheck = fixture()
await finalCheck.approve()
const finishing = finalCheck.stream.generate('续写')
await until(() => finalCheck.base.requests.length === 1)
finalCheck.setFresh(async () => { throw new Error('最终来源检查失败') })
finalCheck.base.requests[0]!.resolve('应丢弃的生成结果')
await assert.rejects(finishing, /最终来源检查失败/)
assert.equal(finalCheck.stream.streamingContent.value, '')
finalCheck.dispose()

const overlapping = fixture()
await overlapping.approve()
const oldGate = deferred<void>()
overlapping.setFresh(() => oldGate.promise)
const older = overlapping.stream.generate('旧任务')
overlapping.setFresh(async () => undefined)
const newer = overlapping.stream.generate('新任务')
await until(() => overlapping.base.requests.length === 1)
overlapping.base.requests[0]!.callback?.('新', '新任务正在生成')
oldGate.reject(new Error('迟到的旧检查失败'))
await assert.rejects(older)
assert.equal(overlapping.stream.streamingContent.value, '新任务正在生成')
overlapping.base.requests[0]!.resolve('新任务完成')
assert.equal(await newer, '新任务完成')
overlapping.dispose()
console.log('✓ Final freshness failure clears output; late old preflight failures cannot reset a newer stream')

const notifications = { success() {}, info() {}, warning() {}, error() {} }
const continuation = fixture()
let continueSaves = 0
const continueController = useWriterContinue({
  currentNovel: continuation.currentNovel, currentChapter: continuation.currentChapter,
  content: continuation.content, characters: ref([]), hasUnsavedChanges: ref(false),
  ensureApiReady: () => true, saveCurrentChapter: async () => ++continueSaves > 1,
  beforeApply: continuation.stream.assertApplicationFresh,
  describeGenre: () => '通用小说', notify: notifications, writeText: async () => undefined,
  stream: continuation.stream,
})
continueController.open()
await continuation.approve()
const continuing = continueController.start()
await until(() => continuation.base.requests.length === 1)
continuation.base.requests[0]!.resolve('只追加一次的续写')
assert.equal(await continuing, true)
assert.equal(await continueController.append(), false)
const appliedContinue = continuation.content.value
assert.match(appliedContinue, /只追加一次的续写/)
assert.equal(continuation.stream.streamingContent.value, '只追加一次的续写')
assert.equal(await continueController.append(), true)
assert.equal(continuation.content.value, appliedContinue)
assert.equal(continueSaves, 2)
continuation.dispose()
console.log('✓ Continuation own-apply invalidation preserves a failed-save retry without duplicate append')

function optimizeFixture(initialSelection = '') {
  const f = fixture()
  let selection = initialSelection
  let saved = 0
  let inserts = 0
  let saveResult = true
  let confirm = async () => undefined as unknown
  const controller = useWriterOptimize({
    currentChapter: f.currentChapter, content: f.content, hasUnsavedChanges: ref(false), availablePrompts: ref([]),
    ensureApiReady: () => true, saveCurrentChapter: async () => { saved++; return saveResult },
    beforeApply: f.stream.assertApplicationFresh, confirmFullReplace: () => confirm(),
    notify: notifications, writeText: async () => undefined,
    editor: { readSelection: () => selection, insertText: () => { inserts++ }, getHtml: () => '<p>替换选择</p>' },
    stream: f.stream,
  })
  async function generate() {
    controller.openFromEditor()
    controller.form.value.customPrompt = '改写得更清晰'
    await f.approve()
    const result = controller.start()
    await until(() => f.base.requests.length === 1)
    f.base.requests[0]!.resolve('已润色的新正文')
    assert.equal(await result, true)
  }
  return { ...f, controller, generate, saves: () => saved, inserts: () => inserts,
    setSaveResult: (value: boolean) => { saveResult = value },
    setSelection: (value: string) => { selection = value },
    setConfirm: (value: () => Promise<unknown>) => { confirm = value },
  }
}
const confirmed = optimizeFixture()
await confirmed.generate()
const confirmGate = deferred<unknown>()
let confirming = false
confirmed.setConfirm(() => { confirming = true; return confirmGate.promise })
const applying = confirmed.controller.applyFull()
await until(() => confirming)
confirmed.chapters.value[0]!.content = '确认弹窗期间改写了依据'
const beforeConfirmation = confirmed.content.value
confirmGate.resolve(undefined)
assert.equal(await applying, false)
assert.equal(confirmed.content.value, beforeConfirmation)
assert.equal(confirmed.saves(), 0)
confirmed.dispose()

const polishRetry = optimizeFixture()
await polishRetry.generate()
polishRetry.setSaveResult(false)
assert.equal(await polishRetry.controller.applyFull(), false)
const appliedPolish = polishRetry.content.value
polishRetry.setSaveResult(true)
assert.equal(await polishRetry.controller.applyFull(), true)
assert.equal(polishRetry.content.value, appliedPolish)
assert.equal(polishRetry.saves(), 2)
polishRetry.dispose()

const selection = optimizeFixture('选定原文')
await selection.generate()
selection.setSelection('另一个选区')
assert.equal(await selection.controller.applySelection(), false)
selection.memory.revoke()
selection.setSelection('选定原文')
assert.equal(await selection.controller.applySelection(), false)
assert.equal(selection.inserts(), 0)
assert.equal(selection.saves(), 0)
selection.dispose()
console.log('✓ Polish rechecks after confirmation, retries applied drafts once, and cannot reuse an unused stale application grant')
console.log('\n=== WRITER MEMORY LIFECYCLE TESTS PASSED ===')
