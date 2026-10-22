/** Synthetic UI/state contract tests only. No network, providers or credentials. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createSSRApp, nextTick, ref } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MemoryIndex } from '../src/services/memory/engine'
import { prepareWriterMemoryContext, type WriterMemoryClient } from '../src/services/memory/writerContext'
import { createSemanticScanUi, createCommittedMemorySourceGuard, memorySourceSignature, FULL_SCAN_TIME_CHOICES, scanPauseText, scanSummary, scanTimeExhausted, withMemoryAbort } from '../src/services/memory/semanticScanUi'
import { useWriterMemoryContext } from '../src/composables/useWriterMemoryContext'
import { createWriterMemoryProviders, writerMemoryRemoteOptions } from '../src/composables/writerMemoryUi'
import { stripWriterHtml } from '../src/utils/writerContent'
import type { MemoryFullScanDecision, MemoryFullScanProgress, MemorySearchControls, MemorySearchResult } from '../src/types/memory'
import type { WriterChapter, WriterNovel } from '../src/types/writer'

async function until(condition: () => boolean) {
  for (let turn = 0; turn < 100 && !condition(); turn++) await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(condition(), 'Expected state boundary was not reached')
}
function progress(patch: Partial<MemoryFullScanProgress> = {}): MemoryFullScanProgress {
  return { sessionId: 'synthetic-session', generation: 1, eligiblePassages: 4096, cachedPassages: 2000,
    missingPassages: 2096, scoredPassages: 0, embeddedPassages: 0, scoredCachedPassages: 0,
    sourceChars: 400_000, attemptedSourceChars: 0, queryCalls: 0, passageCalls: 0, rerankCalls: 0,
    callsAttempted: 0, callsApproved: 160, activeMsUsed: 0, activeMsApproved: 65_000,
    coldEstimatedCalls: 129, currentEstimatedCalls: 67, expiresAt: Date.now() + 3_600_000, ...patch }
}

const defaults = createWriterMemoryProviders()
assert.equal(defaults.fullScanEnabled, false)
assert.equal(defaults.fullScanMaxCalls, 160)
assert.equal(defaults.fullScanMaxActiveMs, 65_000)
assert.deepEqual(FULL_SCAN_TIME_CHOICES.map(choice => choice.value), [65_000, 300_000, 600_000])
assert.deepEqual(writerMemoryRemoteOptions(defaults), {})
defaults.fullScanEnabled = true
assert.deepEqual(writerMemoryRemoteOptions(defaults), {}, 'Scan alone cannot enable an embedding provider')
defaults.embeddingEnabled = true
const copied = writerMemoryRemoteOptions(defaults)
assert.deepEqual(copied.fullScan, { maxCalls: 160, maxActiveMs: 65_000 })
defaults.fullScanMaxCalls = 1
assert.equal(copied.fullScan?.maxCalls, 160, 'Request options must be primitive snapshots')
assert.match(scanPauseText('ready'), /尚未发送/)
assert.match(scanPauseText('provider'), /失败与重试/)
assert.match(scanSummary(progress()), /调用尝试 0 \/ 160/)
console.log('✓ Full scan defaults off, 160 calls / 65 s; explicit 5/10 min choices and snapshotted settings')

// Decision gates bind the private pause, not an editable presentation copy.
const ui = createSemanticScanUi()
const abort = new AbortController()
const controls = ui.controls(abort.signal)
const ready = controls.onPause!({ reason: 'ready', progress: progress() })
ui.state.progress!.sessionId = 'tampered-presentation'
assert.equal(ui.state.start(), true)
assert.deepEqual(await ready, { type: 'continue', sessionId: 'synthetic-session', generation: 1, grantId: 'ui-1-1', addCalls: 0, addActiveMs: 0 })
assert.equal(ui.state.start(), false, 'Repeated Start cannot grant twice')
const paused = controls.onPause!({ reason: 'budget', progress: progress({ callsAttempted: 160, activeMsUsed: 65_000 }) })
assert.equal(ui.state.retry(), false)
for (const value of [NaN, Infinity, -1, 0.5, 4096]) {
  ui.state.setAddCalls(value)
  ui.state.setAddActiveMs(65_000)
  assert.equal(ui.state.extend(), false, 'Malformed or excessive additions cannot settle pause')
}
ui.state.setAddCalls(40)
ui.state.setAddActiveMs(300_000)
assert.equal(ui.state.extend(), true)
const grant = await paused
assert.equal(grant.type, 'continue')
if (grant.type === 'continue') assert.deepEqual([grant.addCalls, grant.addActiveMs], [40, 300_000])
const cancelled = controls.onPause!({ reason: 'provider', progress: progress() })
abort.abort()
assert.equal((await cancelled).type, 'cancel')
assert.equal(ui.state.progress, null)
controls.onProgress!(progress())
assert.equal(ui.state.progress, null, 'Late progress cannot republish an aborted scan')
assert.equal((await controls.onPause!({ reason: 'ready', progress: progress() })).type, 'cancel')
const ignored = new AbortController()
const ignorePromise = withMemoryAbort(new Promise<never>(() => {}), ignored.signal)
ignored.abort()
await assert.rejects(ignorePromise, { name: 'AbortError' })
for (const exhaustedTime of [false, true]) {
  const budgetUi = createSemanticScanUi()
  const budgetAbort = new AbortController()
  const budgetProgress = progress({ callsAttempted: 160, activeMsUsed: exhaustedTime ? 65_000 : 60_000 })
  assert.equal(scanTimeExhausted(budgetProgress), exhaustedTime)
  const paused = budgetUi.controls(budgetAbort.signal).onPause!({ reason: 'budget', progress: budgetProgress })
  assert.equal(budgetUi.state.useLocal(), !exhaustedTime, 'Time exhaustion must not offer an operation lacking validation time')
  if (exhaustedTime) {
    assert.match(budgetUi.state.error, /关闭嵌入与重排/)
    assert.equal(budgetUi.state.pauseReason, 'budget')
    budgetAbort.abort()
    assert.equal((await paused).type, 'cancel')
  } else assert.equal((await paused).type, 'use-local', 'Call exhaustion alone still permits guarded local fallback')
}
console.log('✓ Bound author decisions, atomic UI grant validation, duplicate clicks and late callbacks fail closed')

function fixture() {
  const chapters = ref([
    { id: 11, title: '旧章', content: '<p>阿宁保管铜铃。</p>' },
    { id: 22, title: '当前章', content: '<p>渡口的旅人正在等候。</p>' },
  ] as WriterChapter[])
  const currentChapter = ref<WriterChapter | null>(chapters.value[1]!)
  const targetChapter = ref<WriterChapter | null>(currentChapter.value)
  const currentNovel = ref<WriterNovel | null>({ id: 1, title: '合成测试', chapterList: chapters.value } as WriterNovel)
  const content = ref(currentChapter.value!.content!)
  const index = new MemoryIndex()
  const calls = { save: 0, prepare: 0, sync: 0, search: 0 }
  const decisions: MemoryFullScanDecision[] = []
  let captured: MemorySearchControls | undefined
  let final: MemorySearchResult | undefined
  const readProject = async () => ({ id: 'novel:1', title: '合成测试', clues: [], chapters: chapters.value.map(chapter => ({
    id: String(chapter.id), title: chapter.title, text: stripWriterHtml(chapter.content || ''),
  })) })
  const client: WriterMemoryClient = {
    async sync(project) { calls.sync++; return index.sync(project) },
    async search(query, _remote, guard, searchControls) {
      calls.search++
      captured = searchControls
      let status = progress()
      let local = false
      for (const reason of ['ready', 'budget', 'provider'] as const) {
        captured!.onProgress!(status)
        const decision = await captured!.onPause!({ reason, progress: status })
        decisions.push(decision)
        if (decision.type === 'cancel' || captured!.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
        if (decision.type === 'use-local') { local = true; break }
        status = { ...status, callsApproved: status.callsApproved + decision.addCalls,
          activeMsApproved: status.activeMsApproved + decision.addActiveMs }
        if (reason === 'ready') status = { ...status, callsAttempted: 160, activeMsUsed: 60_000, scoredPassages: 1024 }
        if (reason === 'budget') status = { ...status, callsAttempted: 161, activeMsUsed: 66_000, scoredPassages: 2048 }
      }
      await guard?.()
      final = await index.search(query)
      final.diagnostics.fullScan = { ...status, scoredPassages: local ? status.scoredPassages : 4096,
        status: local ? 'stopped-local' : 'complete', coverage: local ? 'incomplete' : 'complete' }
      return final
    },
    invalidateSource() { index.invalidateSource() },
  }
  const memory = useWriterMemoryContext({ currentNovel, chapters, currentChapter, targetChapter, content, client,
    saveCurrentChapter: async () => { calls.save++; currentChapter.value!.content = content.value; return true },
    prepare(request, dependencies) {
      calls.prepare++
      return prepareWriterMemoryContext(request, { ...dependencies, readProject,
        readGraph: async () => ({ version: 1, projectId: 'novel:1', revision: 'test', relations: [] }) })
    },
  })
  memory.state.enabled = true
  memory.state.query = '铜铃'
  memory.state.cutoffId = '11'
  memory.state.providers.embeddingEnabled = true
  memory.state.providers.fullScanEnabled = true
  const once = () => assert.deepEqual(calls, { save: 1, prepare: 1, sync: 1, search: 1 })
  return { memory, chapters, content, calls, decisions, once, captured: () => captured, final: () => final }
}

const complete = fixture()
const providerSnapshot = JSON.stringify(complete.memory.state.providers)
const searching = complete.memory.search()
await until(() => complete.memory.state.scan.pauseReason === 'ready')
complete.once()
assert.equal(complete.memory.state.result, null)
assert.equal(complete.memory.state.busy, true)
assert.equal(await complete.memory.approve(), false)
assert.deepEqual(complete.memory.state.selection, { hitIds: [], relationIds: [] })
complete.memory.state.scan.start()
await until(() => complete.memory.state.scan.pauseReason === 'budget')
assert.equal(complete.memory.state.result, null)
assert.equal(await complete.memory.approve(), false)
complete.memory.state.scan.setAddCalls(40)
complete.memory.state.scan.setAddActiveMs(300_000)
complete.memory.state.scan.extend()
await until(() => complete.memory.state.scan.pauseReason === 'provider')
complete.once()
assert.equal(JSON.stringify(complete.memory.state.providers), providerSnapshot, 'Pause, progress and grants must not mutate watched providers')
complete.memory.state.scan.retry()
assert.equal(await searching, true)
complete.once()
assert.equal(complete.memory.state.busy, false)
assert.equal(complete.memory.state.approved, false)
assert.deepEqual(complete.memory.state.selection, { hitIds: [], relationIds: [] })
assert.equal(await complete.memory.approve(), false)
const hit = complete.memory.state.result!.hits[0]!
complete.memory.select({ hitIds: [hit.id], relationIds: [] })
assert.equal(await complete.memory.approve(), true)
const lease = await complete.memory.acquire()
assert.match(lease!.prompt, /铜铃/)
await lease!.assertFresh()
complete.memory.dispose()
console.log('✓ Real prepare/selection pipeline: one save/sync/search across plan, budget/provider pauses and final explicit approval')

for (const stage of ['ready', 'budget'] as const) {
  const local = fixture()
  const pending = local.memory.search()
  await until(() => local.memory.state.scan.pauseReason === 'ready')
  if (stage === 'budget') {
    local.memory.state.scan.start()
    await until(() => local.memory.state.scan.pauseReason === 'budget')
  }
  assert.equal(local.memory.state.scan.useLocal(), true)
  assert.equal(await pending, true)
  assert.equal(local.memory.state.result!.diagnostics!.fullScan!.status, 'stopped-local')
  assert.equal(local.memory.state.result!.diagnostics!.semantic, 'disabled')
  assert.equal(local.decisions.at(-1)!.type, 'use-local')
  assert.equal(local.memory.state.approved, false)
  local.once()
  local.memory.dispose()
}
console.log('✓ Use local resolves the original preparation without selecting or approving partial semantic evidence')

for (const mode of ['cancel', 'query', 'provider', 'cutoff', 'editor', 'old-chapter', 'dispose'] as const) {
  const changed = fixture()
  const pending = changed.memory.search()
  await until(() => changed.memory.state.scan.pauseReason === 'ready')
  const oldControls = changed.captured()!
  if (mode === 'cancel') changed.memory.cancel()
  if (mode === 'query') changed.memory.state.query = '新查询'
  if (mode === 'provider') changed.memory.state.providers.embedding.model = 'new-model'
  if (mode === 'cutoff') changed.memory.state.cutoffId = '22'
  if (mode === 'editor') changed.content.value += '正在编辑'
  if (mode === 'old-chapter') changed.chapters.value[0]!.content += '旧章改动'
  if (mode === 'dispose') changed.memory.dispose()
  await nextTick()
  assert.equal(await pending, false, `${mode} must settle the same preparation promise`)
  assert.equal(oldControls.signal?.aborted, true)
  assert.equal(changed.memory.state.busy, false)
  assert.equal(changed.memory.state.result, null)
  assert.equal(changed.memory.state.approved, false)
  oldControls.onProgress!(progress({ scoredPassages: 4096 }))
  assert.equal(changed.memory.state.scan.progress, null)
  assert.equal((await oldControls.onPause!({ reason: 'ready', progress: progress() })).type, 'cancel')
  changed.memory.dispose()
}
console.log('✓ Cancel/query/provider/cutoff/editor/old-chapter/disposal revoke waits; late decisions cannot revive them')

// No focus/storage event is delivered: every boundary must read committed data itself.
for (const boundary of ['query', 'passage', 'rerank', 'use-local', 'publication']) {
  const source = { id: 'memory-demo', title: 'test', chapters: [{ id: 'c1', title: 'old', text: 'original' }], clues: [] }
  const current = structuredClone(source)
  let reads = 0
  let sends = 0
  let release!: () => void
  let ownerCurrent = true
  const gate = new Promise<void>(resolve => { release = resolve })
  const signal = new AbortController()
  const guard = createCommittedMemorySourceGuard(source, async () => {
    reads++
    if (reads === 2) await gate
    return structuredClone(current)
  }, () => { if (!ownerCurrent) throw new Error('Owner changed') }, signal.signal)
  await guard()
  const changedDuringRead = guard().then(() => { sends++ })
  current.chapters[0]!.text = `changed during ${boundary}`
  release()
  await assert.rejects(changedDuringRead, /已保存原文已改变/)
  assert.equal(sends, 0, `${boundary} must not send or publish after committed source change`)
  assert.equal(reads, 2)
  current.chapters[0]!.text = 'original'
  ownerCurrent = false
  await assert.rejects(guard(), /Owner changed/)
  assert.equal(reads, 2, 'Invalid owner should fail before reading more source')
}
const orderedSource = { id: 'x', title: 't', chapters: [{ id: 'c', title: 't', text: 'body' }], clues: [] }
assert.equal(memorySourceSignature(orderedSource), memorySourceSignature({
  clues: [], chapters: [{ text: 'body', title: 't', id: 'c' }], title: 't', id: 'x',
}), 'Source identity must not depend on object key insertion order')
const postReadAbort = new AbortController()
let changeOwner = () => {}
const readPending = new Promise<typeof orderedSource>(resolve => { changeOwner = () => { postReadAbort.abort(); resolve(orderedSource) } })
const guarded = createCommittedMemorySourceGuard(orderedSource, () => readPending, () => {
  if (postReadAbort.signal.aborted) throw new Error('Revoked owner')
}, postReadAbort.signal)()
changeOwner()
await assert.rejects(guarded)
console.log('✓ Shared Lab guard blocks concurrent committed edits/owner changes; source wiring checked below (no production network exercised)')

// Structural checks complement state tests without requiring a prohibited local browser.
const writer = fs.readFileSync(new URL('../src/components/writer/WriterMemoryContext.vue', import.meta.url), 'utf8')
const lab = fs.readFileSync(new URL('../src/views/MemoryLab.vue', import.meta.url), 'utf8')
for (const [source, prefix] of [[writer, 'writer-memory'], [lab, 'memory']] as const) {
  for (const suffix of ['enabled', 'max-calls', 'max-time', 'plan', 'progress', 'pause', 'start', 'retry', 'continue', 'use-local', 'cancel', 'local-restart', 'final']) {
    assert.ok(source.includes(`data-testid="${prefix}-full-scan-${suffix}"`), `${prefix} missing stable ID ${suffix}`)
  }
  assert.match(source, /不是金额上限/)
  assert.match(source, /不代表已回答问题/)
  assert.match(source, /停止全部远程请求/)
  assert.doesNotMatch(source, /64\/128\/256|candidateSemantic|candidateLimit/)
}
assert.match(writer, /:value="query" :disabled="disabled"/)
assert.match(writer, /:value="cutoffId" :disabled="disabled"/)
assert.match(lab, /memory-chapter-editor" rows="7" :disabled="controlsLocked"/)
assert.match(lab, /const controlsLocked = computed\(\(\) => busy.value && operation.value !== 'search'\)/)
assert.match(lab, /v-if="result\?\.diagnostics"/)
assert.match(lab, /assertCurrentSource, scanController.controls\(controller.signal\)/)
assert.match(lab, /await assertCurrentSource\(\)[\s\S]*?result.value = response/)
console.log('✓ Both surfaces expose stable control IDs, honest costs/coverage, editable inputs and legacy diagnostics guards')
// Compile and render the actual component without launching any browser.
const root = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ configFile: false, root, plugins: [vue()],
  resolve: { alias: { '@': path.join(root, 'src') } }, server: { middlewareMode: true }, logLevel: 'error' })
try {
  const { default: WriterMemoryContext } = await server.ssrLoadModule('/src/components/writer/WriterMemoryContext.vue')
  const providers = createWriterMemoryProviders()
  providers.embeddingEnabled = true
  providers.fullScanEnabled = true
  const view = createSemanticScanUi()
  const controller = new AbortController()
  const viewControls = view.controls(controller.signal)
  const props = { enabled: true, query: '铜铃', cutoffId: 'c1', chapters: [{ id: 'c1', title: '旧章', ordinal: 1 }],
    busy: true, selection: { hitIds: [], relationIds: [] }, approved: false, result: null, providers, scan: view.state }
  const render = () => renderToString(createSSRApp(WriterMemoryContext, props))
  for (const reason of ['ready', 'budget', 'provider'] as const) {
    const waiting = viewControls.onPause!({ reason, progress: progress() })
    const html = await render()
    assert.match(html, /有效缓存 2000/)
    assert.match(html, /当前预计 67 次调用，冷缓存预计 129 次/)
    assert.ok(html.includes(`data-state="${reason}"`))
    assert.ok(html.includes('data-testid="writer-memory-full-scan-use-local"'))
    assert.ok(html.includes('data-testid="writer-memory-full-scan-cancel"'))
    assert.equal(html.includes('data-testid="writer-memory-approve"'), false, 'No approval UI before complete result')
    assert.equal(html.includes('data-testid="writer-memory-select-hit-0"'), false)
    const queryInput = html.match(/<input[^>]*data-testid="writer-memory-query"[^>]*>/)![0]
    assert.doesNotMatch(queryInput, /\bdisabled(?:=| |>|\/)/, 'Query remains editable during a paused scan')
    view.state.useLocal()
    await waiting
  }
  const exhausted = viewControls.onPause!({ reason: 'budget', progress: progress({ activeMsUsed: 65_000 }) })
  const exhaustedHtml = await render()
  const useLocalButton = exhaustedHtml.match(/<button[^>]*data-testid="writer-memory-full-scan-use-local"[^>]*>/)![0]
  assert.match(useLocalButton, /\bdisabled(?:=| |>|\/)/)
  assert.ok(exhaustedHtml.includes('writer-memory-full-scan-local-restart'))
  assert.match(exhaustedHtml, /关闭嵌入与重排/)
  controller.abort()
  await exhausted
  const legacyHtml = await renderToString(createSSRApp(WriterMemoryContext, { ...props, busy: false,
    result: { hits: [], relations: [] } }))
  assert.ok(legacyHtml.includes('data-testid="writer-memory-result"'), 'Legacy previews without diagnostics must render')
  controller.abort()
} finally { await server.close() }
console.log('✓ Actual Vue SSR renders ready/budget/provider controls, no partial approval, editable query and legacy previews')
console.log('=== WRITER FULL-SCAN UI TESTS PASSED ===')
