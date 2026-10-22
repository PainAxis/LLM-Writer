/** Synthetic lifecycle/SSR tests. No real provider, credentials, browser or network. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSSRApp, nextTick, ref } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import type { PreparedSupportCheck, SupportCheckResult, SupportVerdict } from '../src/types/memorySupport'
import type { WriterChapter, WriterNovel } from '../src/types/writer'

const storage = new Map<string, string>()
Object.assign(globalThis, { localStorage: { getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } })
const { useMemorySupportCheck } = await import('../src/composables/useMemorySupportCheck')
const { useWriterMemoryContext } = await import('../src/composables/useWriterMemoryContext')
const { prepareWriterMemoryContext } = await import('../src/services/memory/writerContext')
const { SupportCheckError } = await import('../src/services/memory/supportCheck')
const { MemoryIndex } = await import('../src/services/memory/engine')
const { SUPPORT_CHECK_LIMITS } = await import('../src/types/memorySupport')
const { useApiConfig } = await import('../src/services/apiConfig')
const { apiConfig } = useApiConfig()
apiConfig.value = { ...apiConfig.value, provider: 'custom', baseURL: 'https://synthetic.invalid/v1',
  selectedModel: 'synthetic-model', apiKey: 'synthetic-test-key', customHeaders: {} }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { resolve, promise } }
async function until(test: () => boolean) { for (let i = 0; i < 100 && !test(); i++) await new Promise(done => setTimeout(done, 0)); assert.ok(test()) }
const source = { chapterId: '11', sourceRevision: 'a'.repeat(64), start: 0, end: 7, quote: '阿宁保管铜铃。', ordinal: 1, chapterTitle: '旧章' }
function assessed(verdict: SupportVerdict = 'supported'): SupportCheckResult {
  return { state: 'assessed', semanticOrigin: 'model', validation: 'protocol-and-current-sources', scope: 'selected-excerpts',
    manuscriptAbsenceEstablished: false, requestId: 'synthetic', selectionFingerprint: 'selection', throughChapterId: '11',
    providerLabel: 'synthetic', modelId: 'synthetic-model', completedAt: Date.now(), verdict,
    reason: verdict === 'supported' ? 'direct_statement' : verdict === 'insufficient' ? 'missing_premise' : 'ambiguous_reference',
    answer: verdict === 'supported' ? '阿宁保管铜铃。<script>alert(1)</script>' : null,
    explanation: '这是模型判断，仍须复核。', premises: [{ text: '阿宁持有铜铃。', citations: [{ ...source }] }],
    missing: verdict === 'supported' ? [] : ['没有说明交接的确切时间。'] }
}
function preview() { return { question: '谁保管铜铃？', sources: [{ ...source }], sourceCount: 1, sourceChars: 7,
  inputChars: 1500, inputBytes: 3000, providerLabel: 'synthetic', modelId: 'synthetic-model',
  endpointLabel: 'https://synthetic.invalid/v1', expiresAt: Date.now() + 300000, bounds: SUPPORT_CHECK_LIMITS } }
function controllerFixture() {
  const configuration = ref({ model: 'test', proxy: '', headers: { authorization: 'synthetic' } })
  const counts = { prepare: 0, run: 0, cancel: 0, start: 0 }
  let available = true
  let readyGate: Promise<void> | null = null
  let runGate: Promise<SupportCheckResult> | null = null
  let latestSignal: AbortSignal | undefined
  const controller = useMemorySupportCheck({ configuration, canPrepare: () => available,
    onStart: () => { counts.start++ },
    async prepare(signal, assertOwner) {
      counts.prepare++; latestSignal = signal
      const plan: PreparedSupportCheck = { preview: preview(), cancel() { counts.cancel++ },
        async run() { counts.run++; assertOwner(); return runGate ?? assessed() } }
      if (readyGate) await readyGate
      return plan
    },
  })
  controller.state.setQuestion('谁保管铜铃？')
  return { controller, counts, configuration, signal: () => latestSignal,
    readyGate: (gate: Promise<void>) => { readyGate = gate }, runGate: (gate: Promise<SupportCheckResult>) => { runGate = gate },
    available: (value: boolean) => { available = value } }
}
{
  const f = controllerFixture()
  assert.equal(f.controller.state.enabled, false)
  assert.equal(await f.controller.state.prepare(), false)
  assert.equal(await f.controller.state.run(), false)
  f.controller.state.setEnabled(true)
  assert.deepEqual(f.counts, { prepare: 0, run: 0, cancel: 0, start: 0 })
  f.available(false)
  assert.equal(await f.controller.state.prepare(), false)
  f.available(true)
  const gate = deferred<void>(); f.readyGate(gate.promise)
  const pending = f.controller.state.prepare()
  assert.equal(await f.controller.state.prepare(), false)
  assert.equal(await f.controller.state.run(), false)
  gate.resolve(); assert.equal(await pending, true)
  assert.equal(f.counts.run, 0, 'Preparation is local only')
  f.controller.state.preview!.sources[0]!.quote = 'Presentation tampering'
  const running = deferred<SupportCheckResult>(); f.runGate(running.promise)
  const sent = f.controller.state.run()
  assert.equal(await f.controller.state.run(), false)
  assert.equal(f.counts.run, 1)
  running.resolve(assessed()); assert.equal(await sent, true)
  assert.equal(f.controller.state.result.state, 'assessed')
  f.configuration.value.headers.authorization = 'different-synthetic-header'
  assert.equal(f.controller.state.result.state, 'unverified', 'Nested config changes synchronously hide results')
  assert.equal(f.controller.state.preview, null)
  f.controller.dispose()
}
for (const phase of ['preparing', 'ready', 'running', 'settled'] as const) {
  for (const action of ['cancel', 'close', 'dispose', 'config', 'selection', 'question'] as const) {
    const f = controllerFixture()
    const ready = deferred<void>(); const result = deferred<SupportCheckResult>()
    f.controller.state.setEnabled(true)
    if (phase === 'preparing') f.readyGate(ready.promise)
    if (phase === 'running') f.runGate(result.promise)
    const pending = f.controller.state.prepare()
    if (phase !== 'preparing') await pending
    const sent = phase === 'running' || phase === 'settled' ? f.controller.state.run() : Promise.resolve(false)
    if (phase === 'settled') await sent
    if (action === 'cancel') f.controller.state.cancel()
    if (action === 'close') f.controller.state.setEnabled(false)
    if (action === 'dispose') f.controller.dispose()
    if (action === 'config') { f.configuration.value.proxy = 'https://different.invalid'; f.configuration.value.proxy = '' }
    if (action === 'selection') f.controller.invalidate()
    if (action === 'question') f.controller.state.setQuestion('另一个问题')
    assert.equal(f.controller.state.preview, null, `${phase}/${action} clears preview synchronously`)
    assert.equal(f.controller.state.result.state, 'unverified')
    if (phase === 'preparing') assert.equal(await pending, false, 'Cancellation settles ignored prepare dependency')
    if (phase === 'running') assert.equal(await sent, false, 'Cancellation settles ignored provider dependency')
    ready.resolve(); result.resolve(assessed()); await nextTick(); await Promise.resolve()
    assert.equal(f.controller.state.result.state, 'unverified', 'Late results cannot resurrect closed output')
    assert.equal(f.signal()?.aborted, true)
    f.controller.dispose()
  }
}
console.log('✓ Initial off, zero-call prepare, explicit send, duplicate clicks, every async boundary, close/cancel/navigation and late promise ownership')

async function writerFixture() {
  const chapters = ref<WriterChapter[]>([{ id: 11, title: '旧章', content: '<p>阿宁保管铜铃。</p>' }, { id: 22, title: '当前章', content: '<p>旅人等候消息。</p>' }] as WriterChapter[])
  const currentChapter = ref<WriterChapter | null>(chapters.value[1]!)
  const targetChapter = ref(currentChapter.value)
  const content = ref(currentChapter.value!.content!)
  const currentNovel = ref<WriterNovel | null>({ id: 1, title: 'synthetic', chapterList: chapters.value } as WriterNovel)
  const committed = { id: 'novel:1', title: 'synthetic', clues: [], chapters: [{ id: '11', title: '旧章', text: '阿宁保管铜铃。' }, { id: '22', title: '当前章', text: '旅人等候消息。' }] }
  const client = new MemoryIndex()
  const counts = { prepare: 0, model: 0 }
  let save = true
  let hold: Promise<void> | null = null
  let providerFailure: false | true | 'timeout' = false
  let readHold: Promise<void> | null = null
  const memory = useWriterMemoryContext({ chapters, currentChapter, targetChapter, content, currentNovel, client,
    saveCurrentChapter: async () => save,
    async prepare(request, dependencies) {
      counts.prepare++
      const root = await prepareWriterMemoryContext(request, { ...dependencies, readProject: async () => { if (readHold) await readHold; return structuredClone(committed) },
        readGraph: async () => ({ version: 1, projectId: 'novel:1', revision: 'synthetic', relations: [] }) })
      const choose = root.selectEvidence
      root.selectEvidence = async selection => {
        const selected = await choose(selection)
        const createPlan = selected.prepareSupportCheck
        selected.prepareSupportCheck = async (question, owner) => {
          const plan = await createPlan(question, owner)
          return { ...plan, run: () => plan.run(async request => {
            await request.beforeRequest()
            counts.model++
            if (hold) await hold
            if (providerFailure === 'timeout') throw new SupportCheckError('timeout')
            if (providerFailure) throw new Error('SYNTHETIC SECRET RAW ERROR MUST NOT DISPLAY')
            return JSON.stringify({ version: 1, verdict: 'supported', reason: 'direct_statement', answer: '阿宁保管铜铃。',
              explanation: '所选原文明确写出持有人。', premises: [{ text: '阿宁保管铜铃。', references: [1] }], missing: [] })
          }) }
        }
        return selected
      }
      return root
    },
  })
  memory.state.enabled = true; memory.state.query = '铜铃'; memory.state.cutoffId = '11'
  await nextTick()
  const searchSelect = async () => {
    assert.equal(await memory.search(), true)
    assert.deepEqual(memory.state.selection, { hitIds: [], relationIds: [] })
    memory.support.state.setEnabled(true)
    assert.equal(await memory.support.state.prepare(), false, 'No implicit support selection')
    memory.select({ hitIds: [memory.state.result!.hits[0]!.id], relationIds: [] })
  }
  return { memory, counts, chapters, committed, content, searchSelect,
    save: (value: boolean) => { save = value }, readHold: (value: Promise<void>) => { readHold = value }, hold: (value: Promise<void>) => { hold = value }, fail: (reason: true | 'timeout' = true) => { providerFailure = reason } }
}
{
  const f = await writerFixture(); f.save(false)
  assert.equal(await f.memory.search(), false)
  f.memory.support.state.setEnabled(true)
  assert.equal(await f.memory.support.state.prepare(), false)
  assert.deepEqual(f.counts, { prepare: 0, model: 0 }); f.memory.dispose()
}
{
  const f = await writerFixture(); await f.searchSelect()
  const candidates = f.memory.state.result
  const selected = structuredClone({ hitIds: [...f.memory.state.selection.hitIds], relationIds: [] })
  f.memory.support.state.setQuestion('  阿宁拿着的物品是什么？  ')
  assert.equal(f.memory.state.result, candidates)
  assert.deepEqual(f.memory.state.selection, selected)
  assert.equal(f.memory.state.query, '铜铃', 'Changing support question never rewrites retrieval query')
  assert.equal(await f.memory.support.state.prepare(), true)
  assert.equal(f.memory.support.state.preview!.question, '  阿宁拿着的物品是什么？  ', 'Exact outbound question preserves whitespace')
  f.memory.dispose()
}
{
  const f = await writerFixture(); await f.searchSelect()
  assert.equal(await f.memory.support.state.prepare(), true)
  const read = deferred<void>(); f.readHold(read.promise)
  const approving = f.memory.approve()
  assert.equal(f.memory.state.busy, true)
  assert.equal(await f.memory.support.state.run(), false, 'A same-tick Send cannot supersede an in-flight approval and strand busy state')
  read.resolve()
  assert.equal(await approving, true)
  assert.equal(f.memory.state.busy, false)
  assert.equal(await f.memory.support.state.run(), true)
  assert.equal(f.memory.state.approved, false)
  f.memory.dispose()
}
{
  const f = await writerFixture(); await f.searchSelect()
  const read = deferred<void>(); f.readHold(read.promise)
  const started = performance.now()
  assert.equal(await f.memory.support.state.prepare(), false, 'Stalled first committed read must time out before engine preparation')
  assert.ok(performance.now() - started >= 9000)
  assert.equal(f.memory.support.state.result.state, 'unverified')
  assert.equal(f.memory.support.state.result.reason, 'timeout')
  assert.equal(f.memory.state.result, null)
  assert.equal(f.memory.state.approved, false)
  assert.equal(f.counts.model, 0)
  read.resolve(); await nextTick(); await new Promise(done => setTimeout(done, 0))
  assert.equal(f.memory.support.state.preview, null, 'Late storage completion cannot restore the expired plan')
  f.memory.dispose()
}
{
  const f = await writerFixture(); await f.searchSelect()
  assert.equal(await f.memory.support.state.prepare(), true)
  const read = deferred<void>(); f.readHold(read.promise)
  assert.equal(await f.memory.support.state.run(), false, 'A stalled dispatch source guard cannot publish an assessment')
  assert.equal(f.memory.support.state.result.state, 'unverified')
  assert.equal(f.memory.support.state.result.reason, 'timeout')
  assert.equal(f.memory.state.result, null, 'Application-owned sourceValidationFailed revokes old retrieval, unlike provider-only timeout')
  assert.deepEqual(f.memory.state.selection, { hitIds: [], relationIds: [] })
  assert.equal(f.counts.model, 0)
  read.resolve(); f.memory.dispose()
}
for (const outcome of ['success', 'failure', 'provider-timeout', 'source-before-send', 'source-before-publish', 'editor', 'selection', 'config', 'close'] as const) {
  const f = await writerFixture(); await f.searchSelect()
  assert.equal(await f.memory.approve(), true)
  const lease = await f.memory.acquire()
  assert.equal(await f.memory.support.state.prepare(), true)
  assert.equal(f.counts.model, 0)
  assert.equal(f.memory.state.approved, false, 'Preparing support revokes earlier approval')
  await assert.rejects(lease!.assertFresh())
  // Restore because a stale acquired lease conservatively revokes retrieval.
  await f.searchSelect(); assert.equal(await f.memory.support.state.prepare(), true)
  if (outcome === 'source-before-send') f.committed.chapters[0]!.text = '已提交的新原文。'
  if (outcome === 'failure') f.fail()
  if (outcome === 'provider-timeout') f.fail('timeout')
  const gate = deferred<void>()
  if (['source-before-publish', 'editor', 'selection', 'config', 'close'].includes(outcome)) f.hold(gate.promise)
  const pending = f.memory.support.state.run()
  assert.equal(await f.memory.approve(), false, 'Approval is unavailable while support runs')
  if (['source-before-publish', 'editor', 'selection', 'config', 'close'].includes(outcome)) {
    await until(() => f.counts.model === 1)
    if (outcome === 'source-before-publish') f.committed.chapters[0]!.text = '响应期间保存的新原文。'
    if (outcome === 'editor') f.content.value += '同标签修改'
    if (outcome === 'selection') f.memory.select({ hitIds: [], relationIds: [] })
    if (outcome === 'config') apiConfig.value.customHeaders = { 'X-Test': 'changed' }
    if (outcome === 'close') f.memory.revoke()
    gate.resolve()
  }
  const success = await pending
  assert.equal(success, outcome === 'success')
  assert.equal(f.memory.state.approved, false, 'No semantic result approves writing')
  if (outcome === 'source-before-send') assert.equal(f.counts.model, 0, 'Committed source changes block dispatch without storage events')
  if (outcome === 'success' || outcome === 'failure' || outcome === 'provider-timeout') {
    assert.ok(f.memory.state.result, 'Current local candidates remain usable after model failure')
    assert.equal(await f.memory.approve(), true, 'Author explicitly reapproves current local references')
    const approved = await f.memory.acquire()
    assert.doesNotMatch(approved!.prompt, /所选原文明确写出持有人|semanticOrigin|supportAssessment/)
  }
  if (outcome === 'source-before-publish' || outcome === 'source-before-send') {
    assert.equal(f.memory.support.state.result.state, 'unverified')
    assert.equal(f.memory.support.state.preview, null)
    assert.equal(f.memory.state.result, null, 'Invalid committed sources revoke old candidates')
    assert.deepEqual(f.memory.state.selection, { hitIds: [], relationIds: [] })
    assert.equal(await f.memory.approve(), false, 'Source-invalid candidates cannot be reapproved')
  }
  f.memory.dispose()
}
console.log('✓ Real Writer selection/source bridge: failed saves, lease revocation, no implicit approval, no model text in prompt, source changes without events and explicit local reapproval')

// Focus and visibility must hide output before any asynchronous revalidation.
const fakeWindow = new EventTarget(); const fakeDocument = new EventTarget()
Object.assign(fakeDocument, { visibilityState: 'visible' })
Object.assign(globalThis, { window: fakeWindow, document: fakeDocument })
for (const event of ['focus', 'storage', 'visibilitychange']) {
  const f = controllerFixture(); f.controller.state.setEnabled(true)
  await f.controller.state.prepare(); await f.controller.state.run()
  ;(event === 'visibilitychange' ? fakeDocument : fakeWindow).dispatchEvent(new Event(event))
  assert.equal(f.controller.state.result.state, 'unverified')
  assert.equal(f.controller.state.preview, null)
  f.controller.dispose()
}
Reflect.deleteProperty(globalThis, 'window'); Reflect.deleteProperty(globalThis, 'document')

const root = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ configFile: false, root, plugins: [vue()], resolve: { alias: { '@': path.join(root, 'src') } }, server: { middlewareMode: true }, logLevel: 'error' })
try {
  const { default: Panel } = await server.ssrLoadModule('/src/components/memory/MemorySupportCheck.vue')
  for (const verdict of ['supported', 'insufficient', 'uncertain'] as const) {
    const state = { enabled: true, phase: 'settled', question: '谁保管铜铃？', preview: null, result: assessed(verdict), setEnabled() {}, prepare() {}, run() {}, cancel() {} }
    const html = await renderToString(createSSRApp(Panel, { state, available: true }))
    assert.ok(html.includes(`data-verdict="${verdict}"`))
    assert.ok(html.includes('memory-support-premise-0'))
    assert.ok(html.includes('memory-support-citation'))
    assert.ok(html.includes('memory-support-explanation'))
    assert.ok(html.includes('引用位置已核对，语义仍须作者复核'))
    assert.doesNotMatch(html, /<script>alert/)
    if (verdict === 'supported') assert.match(html, /&lt;script&gt;/)
    else assert.ok(html.includes('memory-support-missing'))
  }
  for (const reason of ['invalid_response', 'transport', 'source_changed', 'timeout', 'response_too_large']) {
    const html = await renderToString(createSSRApp(Panel, { state: { enabled: true, phase: 'settled', question: '谁保管铜铃？', preview: null, result: { state: 'unverified', reason } }, available: true }))
    assert.ok(html.includes('memory-support-unverified'))
    assert.ok(!html.includes('data-verdict='))
    assert.ok(!html.includes('memory-support-answer'))
  }
  const { default: WriterPanel } = await server.ssrLoadModule('/src/components/writer/WriterMemoryContext.vue')
  const { createWriterMemoryProviders } = await import('../src/composables/writerMemoryUi')
  const writer = await writerFixture(); await writer.searchSelect()
  const html = await renderToString(createSSRApp(WriterPanel, { ...writer.memory.state, support: { ...writer.memory.support.state, phase: 'running' }, chapters: writer.memory.chapters.value, providers: createWriterMemoryProviders() }))
  assert.match(html.match(/<button[^>]*data-testid="writer-memory-approve"[^>]*>/)![0], /disabled/)
  writer.memory.dispose()
  // Compile the actual Lab route too, without invoking onMounted or a browser.
  await server.ssrLoadModule('/src/views/MemoryLab.vue')
} finally { await server.close() }
const lab = fs.readFileSync(new URL('../src/views/MemoryLab.vue', import.meta.url), 'utf8')
const writerEntry = fs.readFileSync(new URL('../src/views/Writer.vue', import.meta.url), 'utf8')
assert.match(lab, /const selectedSupportIds = ref<string\[\]>\(\[\]\)/)
assert.match(lab, /supportRetrieval = \{ project: structuredClone\(snapshot\), stats: structuredClone\(index\), result: structuredClone\(response\)/)
assert.match(lab, /createCommittedMemorySourceGuard\(snapshot.project/)
assert.match(lab, /@click="selectedId = hit.id"/)
assert.match(lab, /memory-support-select-\$\{index\}/)
assert.equal((writerEntry.match(/<WriterMemoryContext[\s\S]*?v-bind="writerMemoryState"/g) ?? []).length, 3)
assert.equal(storage.size, 0, 'UI and model assessments never write storage')
console.log('✓ Actual Vue SSR: cited verdicts, missing premises, safe failures, escaped text, disabled approval, Lab compilation and all three Writer modes')
console.log('=== MEMORY SUPPORT UI TESTS PASSED ===')
