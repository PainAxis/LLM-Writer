/** Real Vue + real Agent/retrieval/project integration and SFC SSR. Synthetic ports only; no live HTTP/browser. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSSRApp, defineComponent, h, nextTick, ref, watch } from 'vue'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { useWriterAgent, writerAgentAuditText, type WriterAgentUiPhase } from '../src/composables/useWriterAgent'
import { useWriterProject } from '../src/composables/useWriterProject'
import { useWriterGenerationArbiter } from '../src/composables/useWriterGenerationArbiter'
import { useWriterChapterCrud } from '../src/composables/useWriterChapterCrud'
import { useWriterMaterialCrud } from '../src/composables/useWriterMaterialCrud'
import { MemoryIndex } from '../src/services/memory/engine'
import { formatGeneratedBody, stripWriterHtml } from '../src/utils/writerContent'
import { assertWriterEditorTextRoundTrip, WriterEditorApplyBlockedError } from '../src/utils/writerEditorApply'
import type { WriterNovel } from '../src/types/writer'
import type { ApiConfig } from '../src/types/api'
import type { MemoryProjectInput } from '../src/types/memory'
import type { StorageSetOptions } from '../src/utils/storage'

const root = fileURLToPath(new URL('..', import.meta.url))
const matrix = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/writer-agent-v1.json'), 'utf8'))
const fixed = matrix.fixtures
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); await nextTick() }
async function until(check: () => boolean) {
  for (let i = 0; i < 150 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(check(), 'Expected integration boundary was not reached')
}
// Advance the existing two-second editor debounce deterministically, without
// shortening Agent deadlines or waiting on wall time. Other timers remain real.
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const autosaveTimers = new Map<object, () => void>()
const acknowledgementTimers = new Map<object, () => void>()
globalThis.setTimeout = ((callback: () => void, ms: number, ...args: unknown[]) => {
  const bucket = ms === 2_000 ? autosaveTimers : ms > 29_000 && ms <= 30_000 ? acknowledgementTimers : null
  if (!bucket) return realSetTimeout(callback, ms, ...args)
  const token = {}
  bucket.set(token, () => callback(...args))
  return token
}) as typeof setTimeout
globalThis.clearTimeout = ((token: ReturnType<typeof setTimeout>) => {
  if (autosaveTimers.delete(token as object) || acknowledgementTimers.delete(token as object)) return
  realClearTimeout(token)
}) as typeof clearTimeout
function advanceAcknowledgementWindow() {
  for (const [token, callback] of [...acknowledgementTimers]) { acknowledgementTimers.delete(token); callback() }
}
async function advanceAutosaveWindow() {
  for (const [token, callback] of [...autosaveTimers]) { autosaveTimers.delete(token); callback() }
  await flush()
}
async function fixture(draftText = fixed.escapedDraftText) {
  let disk: WriterNovel[] = [fixed.novelA, fixed.novelB].map(novel => ({
    id: Number(novel.id), title: novel.title,
    chapterList: novel.chapters.map(chapter => ({ id: Number(chapter.id), title: chapter.title,
      content: formatGeneratedBody(chapter.text), status: 'draft' })),
  }))
  const calls = { reads: 0, model: 0, dispatch: 0, clients: 0, sync: 0, search: 0, saves: 0, commits: 0, writes: 0 }
  let mode: 'auto' | 'hold' | 'fail' = 'auto'
  const pending: Array<{ novels: WriterNovel[]; options?: StorageSetOptions; done: ReturnType<typeof deferred<void>> }> = []
  let nextRead: ReturnType<typeof deferred<MemoryProjectInput>> | null = null
  let waitingRead: ReturnType<typeof deferred<MemoryProjectInput>> | null = null
  let capturedRead: MemoryProjectInput | null = null
  let nextModel: ReturnType<typeof deferred<string>> | null = null
  let waitingModel: ReturnType<typeof deferred<string>> | null = null
  let modelResult = ''
  const config = ref<ApiConfig>({ provider: 'custom', selectedModel: 'gpt-4.1-mini', apiKey: 'synthetic-test-not-a-key',
    baseURL: 'http://fixture.invalid/v1', maxTokens: 1200, unlimitedTokens: false, temperature: .5,
    thinkingMode: 'default', customHeaders: {} })
  const copies: string[] = []
  const messages: string[] = []
  let notifyEditorChanges = true
  let prepareEditorApply = () => (html: string) => html
  const project = useWriterProject({ novelStore: { worldSettings: [] }, beforeUnloadTarget: null,
    notifyError: text => messages.push(text), persistence: { rejectsBeforeCommit: true, load: () => clone(disk), save: (novels, options) => {
      calls.saves++
      if (mode === 'fail') return Promise.reject(new Error('synthetic known precommit failure'))
      if (mode === 'hold') {
        const done = deferred<void>()
        pending.push({ novels: clone(novels), options, done })
        return done.promise
      }
      disk = clone(novels); calls.commits++; options?.onCommit?.({ committed: true })
    } },
  })
  await project.initNovel(String(fixed.novelA.id))
  await project.selectChapter(project.chapters.value.find(chapter => String(chapter.id) === fixed.novelA.targetChapterId)!)
  for (const key of Object.keys(calls)) calls[key] = 0
  const editorWatch = watch(project.content, () => { calls.writes++; if (notifyEditorChanges) project.onContentChange() }, { flush: 'sync' })
  const source = (): MemoryProjectInput => ({ id: `novel:${fixed.novelA.id}`, title: fixed.novelA.title, clues: [],
    chapters: disk[0].chapterList!.map(chapter => ({ id: String(chapter.id), title: chapter.title, text: stripWriterHtml(chapter.content ?? '') })) })
  const arbiter = useWriterGenerationArbiter({ checkApiReady: () => true, notifyBlocked: text => messages.push(text) })
  const agent = useWriterAgent({ ...project, config, eventTarget: null,
    prepare: () => arbiter.prepare('writerAgent'),
    acquireApplyLease: () => arbiter.prepare('writerAgent') ? project.acquireApplyLease() : null,
    prepareEditorApply: () => prepareEditorApply(),
    writeText: async text => { copies.push(text) }, notify: text => messages.push(text),
    runtimePorts: {
      getConfig: () => config.value,
      readProject: async () => {
        calls.reads++
        const value = source()
        if (nextRead) { waitingRead = nextRead; nextRead = null; capturedRead = value; return waitingRead.promise }
        return value
      },
      createMemoryClient: () => {
        calls.clients++
        const index = new MemoryIndex()
        return {
          async sync(input) { calls.sync++; return index.sync(input) },
          async search(query, _remote, guard) { calls.search++; await guard?.(); return index.search(query) },
          invalidateSource: () => index.invalidateSource(), dispose: () => index.invalidateSource(),
        }
      },
      generateText: async (_prompt, options) => {
        calls.model++
        await options.beforeRequest?.()
        assert.equal(options.signal?.aborted, false)
        calls.dispatch++
        const result = options.type === 'writer-agent-plan' ? fixed.validPlanText : draftText
        if (nextModel) { waitingModel = nextModel; nextModel = null; modelResult = result; return waitingModel.promise }
        return result
      },
    },
  })
  arbiter.registerScope('writerAgent', { reset: agent.reset, interrupt: agent.close, revokeBeforeWait: agent.close })
  arbiter.registerBarrier('writerAgentApply', { isPending: agent.isBarrierPending, wait: agent.waitForCommit })
  const prepare = async () => {
    assert.equal(agent.open(), true)
    agent.brief.value = fixed.authorBrief
    agent.cutoffId.value = fixed.novelA.targetChapterId
    assert.equal(await agent.preview(), true)
  }
  const evidence = async () => {
    await prepare(); agent.granted.value = true
    assert.equal(await agent.start(), true)
    assert.equal(agent.phase.value, 'awaiting_evidence')
  }
  const review = async () => {
    await evidence()
    const hit = agent.snapshot.value.evidence.find(hit => hit.chapterId === fixed.anchorSelection.choose.chapterId
      && hit.quote.includes(fixed.anchorSelection.choose.quote))!
    assert.ok(hit, 'Real retrieval must provide the exact frozen source anchor')
    agent.select([hit.id]); assert.equal(await agent.approve(), true)
    assert.equal(agent.phase.value, 'awaiting_author')
  }
  return { agent, project, arbiter, calls, config, copies, messages, pending, prepare, evidence, review,
    setEditorApply(prepare: typeof prepareEditorApply) { prepareEditorApply = prepare },
    setEditorChangeNotifications(value: boolean) { notifyEditorChanges = value },
    setMode(value: typeof mode) { mode = value },
    holdRead() { nextRead = deferred(); return nextRead }, readWaiting: () => Boolean(waitingRead),
    resolveRead() { waitingRead!.resolve(capturedRead!) },
    holdModel() { nextModel = deferred(); return nextModel }, modelWaiting: () => Boolean(waitingModel),
    resolveModel() { waitingModel!.resolve(modelResult) },
    changeCommittedSource() { disk[0].chapterList![1].content += '<p>另一页改稿。</p>' },
    commit(index = pending.length - 1, acknowledge = true, reportReceipt = true) {
      disk = clone(pending[index].novels); calls.commits++
      if (reportReceipt) pending[index].options?.onCommit?.({ committed: true })
      if (acknowledge) pending[index].done.resolve()
    },
    async dispose() { agent.dispose(); editorWatch(); arbiter.dispose(); mode = 'auto'; await project.dispose() },
  }
}

// R18 + R01: opening/mount-equivalent and synthetic impossible handlers never authorize work.
{
  const f = await fixture()
  assert.equal(f.agent.open(), true)
  assert.equal(f.agent.phase.value, 'idle')
  assert.equal(await f.agent.start(), false)
  assert.equal(await f.agent.approve(), false)
  assert.equal(await f.agent.append(), false)
  assert.deepEqual([f.calls.reads, f.calls.dispatch, f.calls.search, f.calls.writes, f.calls.saves], [0, 0, 0, 0, 0])
  f.agent.brief.value = fixed.authorBrief
  f.agent.cutoffId.value = fixed.novelA.chapters[0].id
  assert.equal(await f.agent.preview(), false)
  assert.equal(f.calls.reads, 0)
  f.agent.cutoffId.value = fixed.novelA.targetChapterId
  assert.equal(await f.agent.preview(), true)
  assert.equal(f.agent.granted.value, false)
  assert.equal(await f.agent.start(), false)
  f.agent.close(); f.agent.open()
  assert.equal(f.agent.cutoffId.value, '')
  assert.equal(f.agent.granted.value, false)
  assert.deepEqual(f.agent.selectedHitIds.value, [])
  assert.equal(f.agent.snapshot.value.preview, null)
  assert.equal(f.calls.saves, 0)
  await f.dispose()
}
console.log('✓ R18/R01 UI lifecycle: no mount/open/invalid handler side effects, explicit equal cutoff and fresh unchecked grant')

// Resolve then synchronously revoke BEFORE the awaited continuation runs.
for (const change of ['close', 'cutoff', 'brief', 'config', 'raw-format', 'saved-source'] as const) {
  const f = await fixture()
  await f.prepare()
  f.agent.granted.value = true
  f.holdModel()
  const pending = f.agent.start()
  await until(f.modelWaiting)
  f.resolveModel()
  if (change === 'close') f.agent.close()
  if (change === 'cutoff') f.agent.cutoffId.value = fixed.novelA.chapters[0].id
  if (change === 'brief') f.agent.brief.value += ' 新方向'
  if (change === 'config') f.config.value.customHeaders = { 'X-Synthetic': 'changed' }
  if (change === 'raw-format') f.project.content.value = f.project.content.value.replace('<p>', '<p class="format-only">')
  if (change === 'saved-source') f.changeCommittedSource()
  await pending; await flush()
  assert.ok(['cancelled', 'stale'].includes(f.agent.phase.value), `${change}: stale continuation rejected`)
  assert.deepEqual([f.calls.dispatch, f.calls.clients, f.calls.search, f.calls.saves], [1, 0, 0, 0])
  assert.equal(f.agent.snapshot.value.evidence.length, 0)
  await f.dispose()
}
console.log('✓ Resolve→cancel microtask races: close/cutoff/brief/config/raw HTML/committed source stop before new retrieval')

// Same-owner double Start/Approve cannot take another model reservation.
{
  const f = await fixture(); await f.prepare(); f.agent.granted.value = true; f.holdModel()
  const start = f.agent.start(); assert.equal(await f.agent.start(), false)
  await until(f.modelWaiting); f.resolveModel(); assert.equal(await start, true)
  assert.equal(f.calls.dispatch, 1)
  f.agent.select([f.agent.snapshot.value.evidence[0].id]); f.holdRead()
  const approve = f.agent.approve(); assert.equal(await f.agent.approve(), false)
  await until(f.readWaiting); f.resolveRead(); assert.equal(await approve, true)
  assert.equal(f.calls.dispatch, 2)
  // UI strings and objects are never the authoritative proposal or source capability.
  f.agent.snapshot.value.proposal!.text = 'FORGED PRESENTATION DRAFT'
  f.agent.snapshot.value.evidence[0].quote = 'FORGED PRESENTATION EVIDENCE'
  assert.equal(await f.agent.append(), true)
  assert.equal(f.project.content.value.includes('FORGED PRESENTATION'), false)
  assert.ok(f.project.content.value.includes('&lt;木门&gt;'))
  await f.dispose()
}
console.log('✓ Same-owner double Start/Approve and mutated UI copies cannot acquire extra requests or forge append text')

// R18 and author approval is a separate action; closing a resolved guard does not dispatch draft.
{
  const f = await fixture(); await f.evidence()
  assert.deepEqual(f.agent.selectedHitIds.value, [])
  assert.equal(await f.agent.approve(), false)
  assert.equal(f.calls.dispatch, 1)
  f.agent.select([f.agent.snapshot.value.evidence[0].id]); f.holdRead()
  const pending = f.agent.approve(); await until(f.readWaiting)
  f.resolveRead(); f.agent.visible.value = false
  await pending; await flush()
  assert.equal(f.calls.dispatch, 1)
  assert.equal(f.agent.snapshot.value.evidence.length, 0)
  assert.equal(f.agent.snapshot.value.proposal, null)
  await f.dispose()
}
console.log('✓ Approval guard resolves then visibility closes: no second request or resurrected evidence')

// R14.b both cancellation schedules, plus another scope waiting on the precommit barrier.
for (const resolvedFirst of [false, true]) {
  const f = await fixture(); await f.review(); f.holdRead()
  const baseline = f.project.content.value
  const pending = f.agent.append()
  assert.equal(f.agent.isBarrierPending.value, true)
  await until(f.readWaiting)
  if (resolvedFirst) f.resolveRead()
  const navigation = f.arbiter.waitForCommits()
  if (!resolvedFirst) f.resolveRead()
  assert.equal(await pending, false)
  assert.equal(await navigation, true)
  assert.equal(f.agent.isBarrierPending.value, false)
  assert.equal(f.project.content.value, baseline)
  assert.deepEqual([f.calls.dispatch, f.calls.writes, f.calls.saves], [2, 0, 0])
  assert.equal(f.project.allowMutation(), true)
  await f.dispose()
}
console.log('✓ R14.b both pre-append guard cancellation schedules release barrier and leave zero editor/save mutations')

// R14.a first write once; real project save and editor-change/autosave integration.
{
  const f = await fixture(); await f.review()
  const before = f.project.content.value
  const first = f.agent.append(), second = f.agent.append()
  assert.equal(first, second)
  assert.equal(await first, true)
  assert.equal(f.agent.phase.value, 'applied')
  assert.equal(f.project.content.value, `${before}\n${formatGeneratedBody(fixed.escapedDraftText)}`)
  assert.ok(f.project.content.value.includes('&lt;木门&gt; &amp; 铜铃'))
  assert.deepEqual([f.calls.dispatch, f.calls.sync, f.calls.search, f.calls.writes, f.calls.saves, f.calls.commits], [2, 1, 1, 1, 1, 1])
  assert.equal(await f.agent.append(), false)
  assert.equal(f.agent.isBarrierPending.value, false)
  assert.equal(f.project.allowMutation(), true)
  await advanceAutosaveWindow()
  assert.equal(f.calls.saves, 1, 'No hidden Agent-induced autosave after the two-second window')
  await f.agent.copyAudit()
  const audit = JSON.parse(f.copies.at(-1)!)
  assert.equal(audit.application.applied, true)
  assert.equal(audit.application.saveState, 'clean')
  assert.equal(audit.application.initialCommit, 'committed')
  assert.ok(audit.events.some(event => event.kind === 'apply_consumed'))
  await f.dispose()
}
console.log('✓ R14.a real runtime→private original→escaped append→real Writer save exactly once, double click idempotent')

// Model the installed editor wrapper's actual ordering: synchronous setHtml /
// getHtml, followed by onChange reading CURRENT editor HTML. The serializer
// examples are source-derived, not a replacement browser/DOM editor assertion.
for (const authorEdits of [false, true]) {
  const draft = `${fixed.escapedDraftText}\n“我们会再见。”`
  const f = await fixture(draft); await f.review(); f.setMode('hold')
  const before = f.project.content.value
  let editorHtml = before
  let applications = 0
  const emitEditorChange = () => { f.project.content.value = editorHtml; f.project.onContentChange() }
  f.setEditorApply(() => html => {
    applications++
    assert.equal(f.project.isMutationBlocked.value, true)
    assert.equal(f.calls.saves, 0, 'Serialization must precede the first save snapshot')
    assert.equal(html, `${before}\n${formatGeneratedBody(draft)}`)
    assert.ok(html.includes('class="dialogue"'))
    assert.ok(html.includes('&lt;木门&gt; &amp; 铜铃'))
    editorHtml = html.replace(/>\n</g, '><').replaceAll(' class="dialogue"', '').replaceAll('&amp;', '&')
    emitEditorChange() // A synchronous onChange is already post-apply, not lease revocation.
    queueMicrotask(emitEditorChange)
    return editorHtml
  })
  const appended = f.agent.append()
  await until(() => f.pending.length === 1)
  const canonical = editorHtml
  const initial = f.pending[0].novels[0].chapterList!.find(chapter => String(chapter.id) === fixed.novelA.targetChapterId)!
  assert.equal(initial.content, canonical)
  assert.equal(f.calls.saves, 1)
  const handle = f.agent.saveHandle.value!
  if (authorEdits) {
    // Even a raw formatting-only edit is real: do not compare stripped text or
    // replay a cached normalization callback over the author's current content.
    editorHtml = `${canonical.replace('<p>', '<p class="author-format">')}<p>作者后续修改。</p>`
    queueMicrotask(emitEditorChange)
    await flush()
  }
  f.commit(0)
  if (authorEdits) {
    await until(() => f.pending.length === 2)
    assert.equal(f.agent.saveHandle.value, handle)
    assert.equal(f.pending[1].novels[0].chapterList!.find(chapter => String(chapter.id) === fixed.novelA.targetChapterId)!.content, editorHtml)
    f.commit(1)
  }
  assert.equal(await appended, true)
  emitEditorChange() // A later equal notification after clean also stays clean.
  await advanceAutosaveWindow()
  assert.equal(applications, 1)
  assert.deepEqual([f.calls.saves, f.calls.commits], authorEdits ? [2, 2] : [1, 1])
  assert.equal(f.project.content.value, editorHtml)
  assert.equal(f.agent.phase.value, 'applied')
  await f.dispose()
}
console.log('✓ Canonical editor HTML is the first snapshot; delayed equal onChange is zero-write, real author changes still drain')

// An unavailable editor is known not to have been touched and fails before
// consuming the draft. Once the one-shot mutation begins, any throw is unknown.
{
  const f = await fixture(); await f.review()
  const before = f.project.content.value
  f.setEditorApply(() => { throw new Error('synthetic unavailable editor') })
  assert.equal(await f.agent.append(), false)
  assert.equal(f.project.content.value, before)
  assert.equal(f.project.isMutationBlocked.value, false)
  assert.equal(f.agent.snapshot.value.audit.some(event => event.kind === 'apply_consumed'), false)
  assert.deepEqual([f.calls.writes, f.calls.saves], [0, 0])
  assert.equal(f.agent.close(), true)
  await f.dispose()
}
for (const partialMutation of [false, true]) {
  const f = await fixture(); await f.review()
  const before = f.project.content.value
  let applications = 0
  f.setEditorApply(() => html => {
    applications++
    if (partialMutation) f.project.content.value = html
    throw new Error('synthetic editor mutation failure')
  })
  assert.equal(await f.agent.append(), false)
  assert.equal(f.agent.phase.value, 'commit_unknown')
  assert.equal(f.agent.draftText.value, fixed.escapedDraftText)
  assert.equal(f.project.isMutationBlocked.value, true)
  assert.equal(f.agent.close(), false)
  assert.equal(await f.agent.append(), false)
  assert.equal(await f.agent.retrySave(), false)
  assert.equal(applications, 1)
  assert.equal(f.calls.saves, 0)
  assert.equal(f.project.content.value === before, !partialMutation)
  assert.match(f.agent.localError.value, /追加或保存状态尚未明确，草稿已保留/)
  await f.dispose()
}
console.log('✓ Editor readiness fails before consume; mutation throws before/after changes remain unknown without re-append or save')

for (const literal of ['&lt;木门&gt;', '&#60;木门&#62;', '&#x3c;木门&#x3e;', '&amp;', '&copy', '&#60']) {
  const draft = `${fixed.escapedDraftText}\n纸上写着 ${literal}`
  const f = await fixture(draft); await f.review()
  const before = f.project.content.value
  let applications = 0
  f.agent.snapshot.value.proposal!.text = '修改展示副本也不能绕过私有原稿校验。'
  f.setEditorApply(() => html => { applications++; return html })
  assert.equal(await f.agent.append(), false)
  assert.equal(f.agent.phase.value, 'awaiting_author')
  assert.equal(f.agent.draftText.value, draft)
  assert.match(f.agent.localError.value, /草稿含有编辑器暂不能原样保存的实体字面文本/)
  assert.equal(f.agent.snapshot.value.audit.some(event => event.kind === 'apply_consumed'), false)
  assert.equal(f.project.isMutationBlocked.value, false)
  assert.equal(f.project.content.value, before)
  assert.deepEqual([applications, f.calls.saves], [0, 0])
  assert.equal(await f.agent.copy(), true)
  assert.equal(f.copies.at(-1), draft)
  assert.equal(await f.agent.append(), false, 'Repeated refusal cannot consume or modify')
  assert.equal(f.agent.close(), true)
  await f.dispose()
}
{
  const f = await fixture(); await f.review()
  f.setEditorApply(() => { assertWriterEditorTextRoundTrip('&lt;既有正文&gt;', '当前正文'); return html => html })
  assert.equal(await f.agent.append(), false)
  assert.equal(f.agent.phase.value, 'awaiting_author')
  assert.match(f.agent.localError.value, /当前正文含有/)
  assert.equal(f.agent.snapshot.value.audit.some(event => event.kind === 'apply_consumed'), false)
  assert.equal(await f.agent.copy(), true)
  assert.equal(f.copies.at(-1), fixed.escapedDraftText)
  assert.equal(f.calls.saves, 0)
  await f.dispose()
}
{
  const f = await fixture()
  f.project.content.value += '<p>&amp;lt;已导入的实体字面正文&amp;gt;</p>'
  assert.equal(await f.project.saveCurrentChapter(), true)
  await f.review()
  const saves = f.calls.saves
  let prepared = false
  f.setEditorApply(() => { prepared = true; return html => html })
  assert.equal(await f.agent.append(), false)
  assert.equal(f.agent.phase.value, 'awaiting_author')
  assert.match(f.agent.localError.value, /当前正文含有/)
  assert.equal(prepared, false, 'Imported HTML semantic text is checked before touching the editor')
  assert.equal(f.calls.saves, saves)
  assert.equal(await f.agent.copy(), true)
  assert.equal(f.copies.at(-1), fixed.escapedDraftText)
  await f.dispose()
}
console.log('✓ Literal named/numeric/hex/semicolon-less entities in private draft or existing text fail before consume; Copy remains exact')

{
  const f = await fixture(); await f.review()
  const original = f.project.content.value
  f.setEditorApply(() => html => {
    // Synthetic teardown/target replacement during a synchronous editor callback
    // must not redirect the canonical assignment into the new target.
    f.project.currentChapter.value = f.project.chapters.value[0]
    f.project.content.value = '<p>新目标自己的正文</p>'
    return html
  })
  assert.equal(await f.agent.append(), false)
  assert.equal(f.agent.phase.value, 'commit_unknown')
  assert.equal(f.project.content.value, '<p>新目标自己的正文</p>')
  assert.notEqual(f.project.content.value, original)
  assert.equal(f.calls.saves, 0)
  assert.equal(await f.agent.append(), false)
  await f.dispose()
}
console.log('✓ Synchronous editor target replacement cannot redirect canonical HTML or acquire a new append')

// R16.a/R17.b failure retains applied token even with no pending promise; only panel retry.
{
  const f = await fixture(); await f.review(); f.setMode('fail')
  assert.equal(await f.agent.append(), false)
  const body = f.project.content.value
  assert.equal(f.agent.phase.value, 'applied_unsaved')
  assert.equal(f.agent.isBarrierPending.value, true)
  assert.equal(f.agent.close(), false)
  assert.equal(f.agent.open(), false)
  assert.equal(await f.agent.start(), false)
  assert.equal(await f.agent.append(), false)
  assert.equal(await f.arbiter.waitForCommits(), false)
  assert.equal(await f.project.saveCurrentChapter(), false, 'Header/global bridge cannot retry retained Agent save')
  assert.equal(f.calls.saves, 1)
  const reads = f.calls.reads
  f.setMode('auto')
  assert.equal(await f.agent.retrySave(), true)
  assert.equal(f.project.content.value, body)
  assert.deepEqual([f.calls.dispatch, f.calls.writes, f.calls.saves, f.calls.commits], [2, 1, 2, 1])
  assert.equal(f.calls.reads, reads, 'Save-only retry must not rerun old evidence guards')
  assert.equal(f.agent.phase.value, 'applied')
  assert.equal(f.agent.visible.value, false, 'Queued close waits for clean acknowledgement')
  await f.dispose()
}
console.log('✓ R16.a/R17.b known failed recovery rejects navigation/new run/header retry, retained-token retry saves only')

// R16.b/c, R17.a: unknown does not settle or retry. Delayed commit belongs to same handle.
{
  const f = await fixture(); await f.review(); f.setMode('hold')
  const pending = f.agent.append(); await until(() => f.pending.length === 1)
  const originalHandle = f.agent.saveHandle.value!
  assert.equal(acknowledgementTimers.size, 1)
  advanceAcknowledgementWindow()
  assert.equal(f.agent.phase.value, 'commit_unknown')
  assert.equal(await f.agent.retrySave(), false)
  assert.equal(f.agent.open(), false)
  assert.equal(f.arbiter.prepare('continue'), false)
  const header = f.project.saveCurrentChapter()
  const autosave = f.project.autoSave()
  let navigationDone = false
  const navigation = f.arbiter.waitForCommits().then(result => { navigationDone = true; return result })
  await flush()
  assert.equal(navigationDone, false)
  assert.equal(f.agent.visible.value, true)
  assert.equal(f.agent.close(), false)
  f.agent.visible.value = false
  assert.equal(f.agent.visible.value, true, 'Synthetic programmatic close cannot bypass save recovery')
  assert.equal(f.agent.cancel(), false)
  assert.equal(await f.agent.copy(), true)
  assert.equal(f.calls.saves, 1)
  await advanceAutosaveWindow()
  assert.equal(f.calls.saves, 1, 'Unknown outcome never recreates a debounce save')
  await f.agent.copyAudit()
  const audit = JSON.parse(f.copies.at(-1)!)
  assert.equal(audit.application.saveState, 'unknown')
  assert.equal(audit.application.initialCommit, 'unknown')
  assert.equal(audit.application.applied, true)
  f.commit()
  assert.equal(await pending, true); assert.equal(await header, true); await autosave
  assert.equal(await navigation, true)
  assert.equal(f.agent.saveHandle.value, originalHandle)
  assert.equal(f.agent.phase.value, 'applied')
  assert.equal(f.agent.visible.value, false)
  await advanceAutosaveWindow()
  assert.deepEqual([f.calls.writes, f.calls.saves, f.calls.commits], [1, 1, 1])
  await f.dispose()
}
console.log('✓ R16.b/c/R17.a unresolved save keeps same barrier/handle, copy works, late clean result alone permits close/navigation')

// ACK resolves in the same turn immediately before the UI indicator callback.
// It may briefly be unresolved, but that callback cannot win over the real result.
for (const receiptVisible of [false, true]) {
  const f = await fixture(); await f.review(); f.setMode('hold')
  const pending = f.agent.append(); await until(() => f.pending.length === 1)
  const [lateToken, lateTimer] = [...acknowledgementTimers.entries()][0]!
  assert.ok(lateTimer)
  f.commit(0, true, receiptVisible)
  acknowledgementTimers.delete(lateToken)
  lateTimer() // Deliberately invoke the already-queued timer even after clearTimeout.
  assert.equal(await pending, true)
  assert.equal(f.agent.phase.value, 'applied')
  assert.equal(f.agent.saveHandle.value!.initialCommit, 'committed')
  assert.equal(acknowledgementTimers.size, 0)
  assert.deepEqual([f.calls.writes, f.calls.saves, f.calls.commits], [1, 1, 1])
  await f.dispose()
}
console.log('✓ ACK-resolve→timer microtask race and late cleared callback cannot downgrade committed result or cause a retry')

// Initial append committed; later real author edit requires catch-up, whose failure is not append failure.
{
  const f = await fixture(); await f.review(); f.setMode('hold')
  const pending = f.agent.append(); await until(() => f.pending.length === 1)
  f.project.content.value += '<p>作者后来修改。</p>'
  f.setMode('fail'); f.commit(0)
  assert.equal(await pending, false)
  assert.equal(f.agent.phase.value, 'applied_unsaved')
  assert.equal(f.agent.saveHandle.value!.initialCommit, 'committed')
  assert.equal(f.agent.saveOutcome.value!.catchUpFailed, true)
  await f.agent.copyAudit()
  const audit = JSON.parse(f.copies.at(-1)!)
  assert.equal(audit.application.initialCommit, 'committed')
  assert.equal(audit.application.catchUpFailed, true)
  assert.equal(audit.application.hasUnsavedChanges, true)
  assert.equal(f.calls.commits, 1)
  const body = f.project.content.value
  f.setMode('auto'); assert.equal(await f.agent.retrySave(), true)
  assert.equal(f.project.content.value, body)
  assert.equal(f.calls.dispatch, 2)
  assert.equal(f.calls.saves, 3)
  await f.dispose()
}
console.log('✓ R16 extra: original append commit survives failed catch-up; later edits retained and no second append')

// Existing material/file-read barrier wins BEFORE Agent acquires its apply lease.
{
  const f = await fixture(); await f.review(); const fileRead = deferred<string>()
  const materials = useWriterMaterialCrud({ ...f.project, confirmDelete: async () => true,
    notify: { success() {}, warning() {} } })
  f.arbiter.registerBarrier('materialMutation', { isPending: materials.isMutating, wait: materials.waitForMutation })
  const imported = materials.importCorpusFile({ text: () => fileRead.promise })
  assert.equal(materials.isMutating.value, true)
  assert.equal(await f.agent.append(), false)
  assert.equal(f.agent.phase.value, 'awaiting_author', 'Same-owner barrier rejection preserves current review')
  assert.deepEqual([f.calls.writes, f.calls.saves], [0, 0])
  assert.equal(f.project.isMutationBlocked.value, false, 'No apply lease was acquired around an existing barrier')
  fileRead.resolve('not valid json')
  assert.equal(await imported, false)
  assert.equal(materials.isMutating.value, false)
  assert.equal(await f.agent.append(), true)
  assert.deepEqual([f.calls.writes, f.calls.saves], [1, 1])
  await f.dispose()
}
// A real pending chapter metadata save invalidates the original review as well
// as holding its chapter-mutation barrier; fresh explicit preview is needed later.
{
  const f = await fixture(); await f.review(); f.setMode('hold')
  const crud = useWriterChapterCrud({ ...f.project, persist: f.project.saveNovelData,
    confirmDelete: async () => true, notify: { success() {}, warning() {} } })
  f.arbiter.registerBarrier('chapterMutation', { isPending: crud.isMutating, wait: crud.waitForMutation })
  crud.openEdit(f.project.chapters.value[0]); crud.form.value.title += '（作者改名）'
  const edited = crud.save(); await until(() => f.pending.length === 1)
  assert.equal(crud.isMutating.value, true)
  assert.equal(await f.agent.append(), false)
  assert.equal(f.calls.writes, 0)
  assert.equal(f.calls.saves, 1, 'Only the author chapter save exists, no Agent save')
  f.commit(); assert.equal(await edited, true)
  f.setMode('auto'); await f.review()
  assert.equal(await f.agent.append(), true)
  assert.equal(f.calls.writes, 1)
  assert.equal(f.calls.saves, 2)
  await f.dispose()
}
console.log('✓ Existing file.text/chapter CRUD barriers reject Agent apply before lease/mutation; retry only after safe completion')

// Actual CRUD confirmation is older than the Agent lease: after await it must not mutate.
{
  const f = await fixture(); await f.review(); const decision = deferred<boolean>()
  const crud = useWriterChapterCrud({ ...f.project, persist: f.project.saveNovelData,
    confirmDelete: () => decision.promise, notify: { success() {}, warning() {} } })
  const oldChapterIds = f.project.chapters.value.map(chapter => chapter.id)
  const deletion = crud.remove(f.project.chapters.value[0]); await flush()
  f.setMode('hold'); const pending = f.agent.append(); await until(() => f.pending.length === 1)
  decision.resolve(true)
  assert.equal(await deletion, false)
  assert.deepEqual(f.project.chapters.value.map(chapter => chapter.id), oldChapterIds)
  const materials = useWriterMaterialCrud({ ...f.project, confirmDelete: async () => true,
    notify: { success() {}, warning() {} } })
  materials.addCharacter(); materials.characterForm.value.name = '不应保存'
  assert.equal(await materials.saveCharacter(), false)
  assert.equal(f.project.characters.value.length, 0)
  assert.equal(f.project.allowMutation(), false, 'Controlled status gate rejects before assigning status')
  f.commit(); assert.equal(await pending, true)
  await f.dispose()
}
console.log('✓ R17 extra: delayed chapter delete and material saves cannot mutate through retained Agent lease')

// Clean receipt-to-UI continuation race: a genuine author edit arrives after
// the save loop has chosen clean but before the UI consumes that outcome.
for (const notifyEditorChanges of [true, false]) {
  const f = await fixture(); await f.review(); f.setMode('hold')
  f.setEditorChangeNotifications(notifyEditorChanges)
  let edited = false
  const stop = watch(() => f.agent.saveHandle.value?.state, state => {
    if (state === 'clean' && !edited) {
      edited = true
      queueMicrotask(() => { f.project.content.value += '<p>回执间隙的作者编辑。</p>' })
    }
  }, { flush: 'sync' })
  const applied = f.agent.append(); await until(() => f.pending.length === 1)
  const originalHandle = f.agent.saveHandle.value!
  const firstSettlement = originalHandle.settled
  f.commit(); await until(() => f.pending.length === 2)
  assert.equal(f.agent.saveHandle.value, originalHandle)
  assert.notEqual(originalHandle.settled, firstSettlement)
  assert.equal(originalHandle.initialCommit, 'committed')
  assert.equal(f.agent.isBarrierPending.value, true)
  assert.equal(f.project.hasUnsavedChanges.value, true)
  assert.equal(f.agent.phase.value, 'commit_pending')
  f.commit(1)
  assert.equal(await applied, true)
  assert.equal(f.agent.phase.value, 'applied')
  assert.equal(f.project.hasUnsavedChanges.value, false)
  assert.equal(f.agent.isBarrierPending.value, false)
  assert.deepEqual([f.calls.dispatch, f.calls.writes, f.calls.saves, f.calls.commits], [2, 2, 2, 2])
  assert.equal(f.project.content.value.split('&lt;木门&gt;').length - 1, 1)
  stop(); await f.dispose()
}
console.log('✓ Receipt-gap author edit drains the same handle, including raw update before editor change notification')

// Undo in the same receipt gap is exactly the committed full snapshot, not a
// second save. Project reconciliation restores clean authority for this owner.
{
  const f = await fixture(); await f.review(); f.setMode('hold')
  let edited = false
  const stop = watch(() => f.agent.saveHandle.value?.state, state => {
    if (state === 'clean' && !edited) {
      edited = true
      queueMicrotask(() => {
        const saved = f.project.content.value
        f.project.content.value = `${saved}<p>临时编辑后撤销。</p>`
        f.project.content.value = saved
      })
    }
  }, { flush: 'sync' })
  const applied = f.agent.append(); await until(() => f.pending.length === 1)
  const originalHandle = f.agent.saveHandle.value!
  const firstSettlement = originalHandle.settled
  f.commit()
  assert.equal(await applied, true)
  assert.equal(f.agent.saveHandle.value, originalHandle)
  assert.notEqual(originalHandle.settled, firstSettlement)
  assert.equal(originalHandle.initialCommit, 'committed')
  assert.equal(f.agent.phase.value, 'applied')
  assert.equal(f.project.hasUnsavedChanges.value, false)
  assert.equal(f.agent.isBarrierPending.value, false)
  await advanceAutosaveWindow()
  assert.deepEqual([f.calls.dispatch, f.calls.writes, f.calls.saves, f.calls.commits], [2, 3, 1, 1])
  assert.equal(f.project.content.value.split('&lt;木门&gt;').length - 1, 1)
  assert.equal(f.agent.close(), true)
  stop(); await f.dispose()
}
console.log('✓ Receipt-gap edit→Undo reconciles the exact committed snapshot and releases without a second save')

globalThis.setTimeout = realSetTimeout
globalThis.clearTimeout = realClearTimeout

// Actual SFC SSR branch matrix. The shell slot is transparent in Node; Element Plus focus/overlay is browser-only.
const server = await createServer({ configFile: false, root, plugins: [vue()],
  resolve: { alias: { '@': path.join(root, 'src') } }, server: { middlewareMode: true }, logLevel: 'error' })
try {
  const { default: Panel } = await server.ssrLoadModule('/src/components/writer/panels/WriterAgentPanel.vue')
  const f = await fixture(); await f.review()
  const original = clone(f.agent.snapshot.value)
  const render = async (phase: WriterAgentUiPhase, visible = true, initialCommitted = false) => {
    const app = createSSRApp(Panel, { visible, phase, snapshot: original, brief: fixed.authorBrief,
      cutoffId: fixed.novelA.targetChapterId, granted: false, selectedHitIds: [], chapters: f.agent.choices.value,
      targetTitle: '木门', canPreview: true, blocker: '', draftText: fixed.escapedDraftText, localError: '', initialCommitted })
    app.component('ElDialog', defineComponent({ setup(_props, { slots }) { return () => h('div', slots.default?.()) } }))
    return renderToString(app)
  }
  const exists = (html: string, id: string) => html.includes(`data-testid="writer-agent-${id}"`)
  for (const phase of ['idle', 'previewing', 'previewed', 'planning', 'executing_retrieval_tool', 'awaiting_evidence',
    'selecting_evidence', 'drafting', 'awaiting_author', 'applying', 'commit_pending', 'commit_unknown', 'applied_unsaved',
    'applied', 'cancelled', 'expired', 'stale', 'failed', 'needs_author_input'] as WriterAgentUiPhase[]) {
    const html = await render(phase)
    assert.ok(html.includes(`data-phase="${phase}"`))
    assert.equal(exists(html, 'preview'), phase === 'previewed')
    assert.equal(exists(html, 'grant'), phase === 'previewed')
    assert.equal(exists(html, 'start'), phase === 'previewed')
    assert.equal(exists(html, 'evidence'), ['awaiting_evidence', 'selecting_evidence'].includes(phase))
    assert.equal(exists(html, 'draft'), ['awaiting_author', 'applying', 'commit_pending', 'commit_unknown', 'applied_unsaved', 'applied'].includes(phase))
    assert.equal(exists(html, 'apply'), phase === 'awaiting_author')
    assert.equal(exists(html, 'retry-save'), phase === 'applied_unsaved')
    assert.equal(exists(html, 'audit'), true)
    if (phase === 'previewed') assert.match(html.match(/<button[^>]*data-testid="writer-agent-start"[^>]*>/)![0], /disabled/)
    if (phase === 'awaiting_evidence') {
      assert.match(html.match(/<button[^>]*data-testid="writer-agent-approve"[^>]*>/)![0], /disabled/)
      for (const input of html.match(/<input[^>]*writer-agent-select-hit-[^>]*>/g) ?? []) assert.doesNotMatch(input, / checked/)
      assert.ok(html.includes('data-chapter-id=')); assert.ok(exists(html, 'source-quote'))
    }
  }
  const previousUsage = original.usage
  original.usage = [
    { runId: 'test', requestId: 'reported-partial', phase: 'plan', status: 'success', usageSource: 'reported', inputTokens: 12, outputTokens: null, totalTokens: null },
    { runId: 'test', requestId: 'estimated', phase: 'draft', status: 'success', usageSource: 'estimated', inputTokens: null, outputTokens: null, totalTokens: null },
    { runId: 'test', requestId: 'unavailable', phase: 'draft', status: 'failed', usageSource: 'unavailable', inputTokens: null, outputTokens: null, totalTokens: null },
  ]
  const usageHtml = await render('awaiting_author')
  assert.match(usageHtml, /来源：服务商报告；输入 12 · 输出 未知 · 合计 未知/)
  assert.match(usageHtml, /来源：估计（不作为实际用量）；输入 未知 · 输出 未知 · 合计 未知/)
  assert.match(usageHtml, /来源：未提供；输入 未知 · 输出 未知 · 合计 未知/)
  original.usage = previousUsage
  const closed = await render('awaiting_author', false)
  assert.equal(exists(closed, 'panel'), false)
  assert.equal(exists(closed, 'apply'), false)
  const catchup = await render('applied_unsaved', true, true)
  assert.match(catchup, /追加已保存，但后续修改尚未保存/)
  const exported = writerAgentAuditText(original, 'awaiting_author')
  for (const canary of [fixed.authorBrief, fixed.escapedDraftText, fixed.anchorSelection.choose.quote, 'synthetic-test-not-a-key', '铜铃 归讯']) {
    assert.equal(exported.includes(canary), false, `No source/config/query canary in audit export: ${canary}`)
  }
  await f.dispose()
} finally { await server.close() }
const writer = fs.readFileSync(path.join(root, 'src/views/Writer.vue'), 'utf8')
assert.match(writer, /prepareEditorApply: \(\) => \{[\s\S]*?if \(!editor\) throw[\s\S]*?return editor.prepareHtmlApply\(\)/)
assert.match(writer, /:model-value="currentChapter.status"/)
assert.doesNotMatch(writer, /v-model="currentChapter.status"/)
assert.match(writer, /if \(!allowMutation\(\)\)[\s\S]*?currentChapter.value.status = status/)
assert.match(writer, /registerBarrier\('chapterMutation'/)
assert.match(writer, /registerScope\('writerAgent'/)
assert.match(writer, /registerBarrier\('writerAgentApply'/)
assert.match(writer, /acquireApplyLease: \(\) => prepareIndependentWriterAI\('writerAgent'\) \? acquireApplyLease\(\) : null/)
assert.match(writer, /v-if="writerAgent.visible.value"/)
console.log('✓ R18 actual SFC SSR phase/absence/disabled matrix, source-free audit export, Writer controlled status and barriers')

// Execute the actual WriterEditor SFC with Vue's no-DOM renderer. Only the
// third-party editor API and destroy helper are synthetic; component setup,
// exposed methods, instance capture and unmount hooks are production code.
{
  const source = fs.readFileSync(path.join(root, 'src/components/writer/WriterEditor.vue'), 'utf8')
  const script = compileScript(parse(source).descriptor, { id: 'writer-editor-apply', inlineTemplate: true }).content
  const compiled = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const renderer = Vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
  function mountEditor(instance?: { isDestroyed: boolean; children?: Array<{ children: Array<{ text: string }> }>; setHtml(html: string): void; getHtml(): string }) {
    if (instance && !instance.children) instance.children = []
    const exports: { default?: Parameters<typeof renderer.createApp>[0] } = {}
    const editorModule = { Toolbar: defineComponent(() => () => null), Editor: defineComponent({
      emits: ['onCreated'], setup(_props, { emit }) { if (instance) emit('onCreated', instance); return () => null },
    }) }
    const require = (id: string) => {
      if (id === 'vue') return Vue
      if (id === '@wangeditor/editor-for-vue') return editorModule
      if (id === '@wangeditor/editor') return { SlateNode: { string: (block: { children: Array<{ text: string }> }) =>
        block.children.map(leaf => leaf.text).join('') } }
      if (id === '@/utils/writerEditorApply') return { assertWriterEditorTextRoundTrip }
      if (id === '@/utils/destroyEditor') return { destroyEditor: (editor?: typeof instance) => { if (editor) editor.isDestroyed = true } }
      if (id.endsWith('.css')) return {}
      throw new Error(`Unexpected component import: ${id}`)
    }
    new Function('require', 'exports', compiled)(require, exports)
    const app = renderer.createApp(exports.default!, { modelValue: '<p>原文</p>' })
    const exposed = app.mount({}) as unknown as { prepareHtmlApply(): (html: string) => string }
    return { app, exposed }
  }
  const unavailable = mountEditor()
  assert.throws(() => unavailable.exposed.prepareHtmlApply(), /尚未就绪/)
  unavailable.app.unmount()
  const destroyed = mountEditor({ isDestroyed: true, setHtml() { assert.fail('Destroyed editor cannot be written') }, getHtml: () => '' })
  assert.throws(() => destroyed.exposed.prepareHtmlApply(), /尚未就绪/)
  destroyed.app.unmount()
  for (const text of ['&lt;既有正文&gt;', '&#60;既有正文&#62;', '&amp;', '&copy']) {
    const unsafe = mountEditor({ isDestroyed: false, children: [{ children: [{ text: text.slice(0, 2) }, { text: text.slice(2) }] }],
      setHtml() { assert.fail('Existing literal entity must be refused without mutation') }, getHtml: () => '' })
    assert.throws(() => unsafe.exposed.prepareHtmlApply(), WriterEditorApplyBlockedError)
    unsafe.app.unmount()
  }
  const events: string[] = []
  const instance = { isDestroyed: false, children: [{ children: [{ text: '<木门> & 铜铃' }] }, { children: [{ text: '&zzzz;' }] }], setHtml: (html: string) => { events.push(`set:${html}`) },
    getHtml: () => { events.push('get'); return '<p>canonical</p>' } }
  const mounted = mountEditor(instance)
  const apply = mounted.exposed.prepareHtmlApply()
  assert.deepEqual(events, [], 'Preparation is non-mutating')
  assert.equal(apply('<p>candidate</p>'), '<p>canonical</p>')
  assert.deepEqual(events, ['set:<p>candidate</p>', 'get'])
  assert.throws(() => apply('<p>again</p>'), /已使用/)
  const late = mounted.exposed.prepareHtmlApply()
  mounted.app.unmount()
  assert.throws(() => late('<p>late</p>'), /已关闭/)
  assert.equal(events.length, 2)
  const partial = mountEditor({ isDestroyed: false, setHtml: () => partial.app.unmount(),
    getHtml: () => { assert.fail('Unmount during setHtml must not yield stale HTML') } })
  assert.throws(() => partial.exposed.prepareHtmlApply()('<p>partial</p>'), /已关闭/)
  for (const step of ['set', 'get']) {
    const throwing = mountEditor({ isDestroyed: false,
      setHtml: () => { if (step === 'set') throw new Error('synthetic set failure') },
      getHtml: () => { throw new Error('synthetic get failure') },
    })
    const oneShot = throwing.exposed.prepareHtmlApply()
    assert.throws(() => oneShot('<p>candidate</p>'), /synthetic/)
    assert.throws(() => oneShot('<p>candidate</p>'), /已使用/)
    throwing.app.unmount()
  }
}
console.log('✓ Actual WriterEditor SFC: readiness is non-mutating, one-shot set/get is synchronous, unmount rejects stale application')
console.log('=== WRITER AGENT UI TESTS PASSED (R14/R16/R17/R18 integration; R15 durable CAS is separate) ===')
