/** Composable ownership and SSR presentation plus real injected-IO integration. Native NOT RUN. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import { createOfflineCampaignEngine } from '../src/services/writerCampaign/engine'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { useWriterCampaign, type CampaignLabEngine } from '../src/composables/useWriterCampaign'
import { canonicalStringify } from '../src/services/writerCampaign/protocol'
import { buildBodyEvidenceFixtureProposal } from '../src/services/writerCampaign/bodyEvidenceFixture'
import type { BodyEvidencePreviewResult } from '../src/services/writerCampaign/bodyEvidenceProtocol'
import type { PlanningPreviewResult } from '../src/services/writerCampaign/planningContext'
import type { CampaignSnapshot } from '../src/types/writerCampaign'

const engines: Array<ReturnType<typeof createOfflineCampaignEngine>> = []
const views: Array<ReturnType<typeof useWriterCampaign>> = []
let cases = 0
const test = async (action: () => Promise<void>) => { await action(); cases++ }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
const identity = { runtimeIdentity: 'body-ui-production-v1', source: { commit: 'c'.repeat(40), tree: 'd'.repeat(40) } }
async function production(id: string, language: 'zh' | 'en' = 'en') {
  const disk = new Map<string, string>()
  let writes = 0, dispatches = 0
  const repository = createCampaignRepository({
    async getMany(keys) { return new Map(keys.map(key => [key, disk.get(key) ?? null])) },
    async compareAndSwapMany(entries, canCommit = () => true) {
      if (!canCommit() || entries.some(entry => (disk.get(entry.key) ?? null) !== entry.expectedValue)) return false
      writes++; for (const entry of entries) disk.set(entry.key, entry.value)
      return true
    },
  })
  const engine = createOfflineCampaignEngine({ repository, identity, fixture: { onDispatch() { dispatches++ } } }); engines.push(engine)
  const ui = useWriterCampaign({ engine, newId: () => id }); views.push(ui)
  assert.equal(await ui.createBodyEvidence(language), true)
  return { id, disk, repository, engine, ui, counts: () => ({ writes, dispatches }) }
}
try {
  const seed = await production('body-ui-seed')
  for (let i = 0; i < 9; i++) assert.equal(await seed.ui.step(), true)
  const seedSnapshot = structuredClone(seed.ui.snapshot.value) as CampaignSnapshot
  const seedText = await buildBodyEvidenceFixtureProposal(seedSnapshot, 3)
  const seedResult = await seed.engine.previewBodyEvidence(seed.id, seedText)
  const seedPlanning = await seed.engine.previewPlanningContext(seed.id, 3)
  assert.equal(seedResult.status, 'ready'); assert.equal(seedPlanning.status, 'ready')
  function snapshot(id: string, status: CampaignSnapshot['head']['status'] = 'running', complete = false) {
    const value = structuredClone(seedSnapshot)
    value.manifest.campaignId = id; value.head.campaignId = id; value.checkpoint.campaignId = id
    value.head.status = status; value.checkpoint.status = status
    if (!complete) { const task = value.checkpoint.tasks.at(-1)!; task.status = 'pending'; task.artifact = null; task.request = null }
    return value
  }
  function ready(ordinal = 2): BodyEvidencePreviewResult {
    if (seedResult.status !== 'ready') throw new Error('seed_not_ready')
    const result = structuredClone(seedResult), packet = JSON.parse(result.packetText)
    packet.claims[0].statement = '<script>not executable</script>&'
    result.packetText = canonicalStringify(packet); result.throughChapterOrdinal = ordinal
    return result // Explicit presentation-only fixture, not source-proof evidence.
  }
  function fixture() {
    const records = new Map<string, CampaignSnapshot>()
    const calls = { create: 0, preview: 0, planning: 0, load: 0, stop: 0, cancelPreview: 0, step: 0, pause: 0, cancel: 0 }
    const bodyGates: Array<Promise<BodyEvidencePreviewResult>> = [], planGates: Array<Promise<PlanningPreviewResult>> = [], draftGates: Array<Promise<string>> = []
    let received = ''
    const engine: CampaignLabEngine = {
      async list() { return [...records.keys()] }, async inspect(id) { return records.get(id) ?? null },
      async prepare({ campaignId }) { records.set(campaignId, snapshot(campaignId)) },
      async preparePlanning({ campaignId }) { records.set(campaignId, snapshot(campaignId)) },
      async prepareBodyEvidence({ campaignId }) { calls.create++; records.set(campaignId, snapshot(campaignId)) },
      async previewBodyEvidence(_id, text) { calls.preview++; received = text; return bodyGates.shift() ?? ready() },
      async previewPlanningContext() { calls.planning++; return planGates.shift() ?? seedPlanning },
      async step(id) { calls.step++; records.set(id, snapshot(id, 'completed', true)) },
      async pause(id) { calls.pause++; records.set(id, snapshot(id, 'paused')) },
      async cancel(id) { calls.cancel++; records.set(id, snapshot(id, 'cancelled')) },
      async resume(id) { records.set(id, snapshot(id)) }, async recoverSaveOnly() {},
      cancelPreviews() { calls.cancelPreview++ }, stopLocal() { calls.stop++ },
    }
    const ui = useWriterCampaign({ engine, newId: () => 'body-ui', bodyEvidenceDraftBuilder: async (_source, ordinal, check) => {
      calls.load++; check?.(); return draftGates.shift() ?? canonicalStringify({ fixtureDraft: ordinal })
    } }); views.push(ui)
    return { ui, records, calls, received: () => received,
      body() { const gate = deferred<BodyEvidencePreviewResult>(); bodyGates.push(gate.promise); return gate },
      planning() { const gate = deferred<PlanningPreviewResult>(); planGates.push(gate.promise); return gate },
      draft() { const gate = deferred<string>(); draftGates.push(gate.promise); return gate },
      refuse() { bodyGates.push(Promise.resolve({ status: 'refused', refusalCode: 'source_identity_mismatch' })) } }
  }
  const source = fs.readFileSync(new URL('../src/views/CampaignLab.vue', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(compileScript(parse(source).descriptor, { id: 'body-evidence-ui', inlineTemplate: true }).content,
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  function component(ui: ReturnType<typeof useWriterCampaign>) {
    const exports: { default?: Vue.Component } = {}
    new Function('require', 'exports', compiled)((id: string) => {
      if (id === 'vue') return Vue
      if (id === '@/composables/useWriterCampaign') return { useWriterCampaign: () => ui }
      if (id === '@/components/ProducerLabPanel.vue') return { default: { render: () => null } }
      if (id === '@/components/CreativePilotPanel.vue') return { default: { render: () => null } }
      if (id === '@/composables/useCreativePilotLab') return { createCreativePilotLegacyRouter: () => ({ engine: {}, version: Vue.ref('legacy'), error: Vue.ref(''), reset() {}, dispose() {} }) }
      throw new Error('unexpected_ui_import')
    }, exports)
    return exports.default!
  }
  await test(async () => {
    const f = fixture(); await f.ui.refresh(); assert.equal(f.calls.create + f.calls.preview + f.calls.load, 0)
    await f.ui.createBodyEvidence('en'); assert.equal(f.calls.create, 1); assert.equal(f.calls.step + f.calls.preview + f.calls.load, 0)
    assert.equal(f.ui.bodyPrefixRows.value.length, 2); assert.equal(f.ui.bodyDraft.value, '')
    assert.equal(await f.ui.loadBodyEvidenceExample(), true); assert.equal(f.calls.preview, 0)
    assert.equal(f.ui.bodyDraft.value, canonicalStringify({ fixtureDraft: 1 })); f.ui.dispose()
  })
  await test(async () => {
    const f = fixture(); await f.ui.createBodyEvidence('en')
    for (const task of f.records.get('body-ui')!.checkpoint.tasks) if (task.taskId.startsWith('b-')) { task.status = 'pending'; task.artifact = null }
    await f.ui.refresh(); assert.equal(f.ui.bodyPrefixRows.value.length, 0); assert.equal(f.ui.canLoadBodyDraft.value, false)
    assert.equal(await f.ui.loadBodyEvidenceExample(), false); assert.equal(f.calls.load, 0); f.ui.dispose()
  })
  await test(async () => {
    const f = fixture(); await f.ui.createBodyEvidence('en')
    const text = canonicalStringify({ generic: 'caller text is not fixture-selected' })
    f.ui.setBodyDraft(text); assert.equal(await f.ui.previewBody(), true); assert.equal(f.received(), text)
    const html = await renderToString(Vue.createSSRApp(component(f.ui)))
    for (const key of ['ready', 'digest', 'coverage', 'prefix', 'packet']) assert.match(html, new RegExp(`campaign-body-preview-${key}`))
    assert.match(html, /not_reviewed/); assert.match(html, /unauthenticated declaration/); assert.match(html, /NOT RUN/)
    assert.match(html, /&lt;script&gt;not executable/); assert.doesNotMatch(html, /<script>not executable/)
    assert.equal(f.calls.step + f.calls.pause + f.calls.cancel, 0); f.ui.dispose()
  })
  await test(async () => {
    const f = fixture(); await f.ui.createBodyEvidence('en'); f.ui.setBodyDraft('{}'); await f.ui.previewBody()
    const stop = f.calls.stop, cancellations = f.calls.cancelPreview
    f.ui.setBodyDraft('{"edited":true}')
    assert.equal(f.ui.bodyPreview.value, null); assert.equal(f.ui.bodyPreviewLoading.value, false)
    assert.equal(f.calls.stop, stop); assert.ok(f.calls.cancelPreview > cancellations); f.ui.dispose()
  })
  for (const change of ['edit', 'prefix', 'planning', 'load'] as const) await test(async () => {
    const f = fixture(); await f.ui.createBodyEvidence('en'); f.ui.setBodyDraft('{}')
    const gate = f.body(), pending = f.ui.previewBody(), stop = f.calls.stop
    assert.equal(f.ui.bodyPreviewLoading.value, true)
    if (change === 'edit') f.ui.setBodyDraft('{"new":true}')
    if (change === 'prefix') f.ui.selectBodyPrefix(2)
    if (change === 'planning') await f.ui.previewChapter(3)
    if (change === 'load') await f.ui.loadBodyEvidenceExample()
    gate.resolve(ready()); assert.equal(await pending, false); assert.equal(f.ui.bodyPreview.value, null)
    assert.equal(f.calls.stop, stop); f.ui.dispose()
  })
  await test(async () => {
    const f = fixture(); await f.ui.createBodyEvidence('en'); const gate = f.planning(), pending = f.ui.previewChapter(1)
    f.ui.setBodyDraft('{}'); assert.equal(await f.ui.previewBody(), true)
    gate.resolve(seedPlanning); assert.equal(await pending, false); assert.equal(f.ui.planningPreview.value, null)
    assert.equal(f.ui.bodyPreview.value?.status, 'ready'); f.ui.dispose()
  })
  for (const action of ['refresh', 'step', 'pause', 'cancel'] as const) await test(async () => {
    const f = fixture(); await f.ui.createBodyEvidence('en'); f.ui.setBodyDraft('{}')
    const gate = f.body(), pending = f.ui.previewBody(); await f.ui[action]()
    assert.equal(f.ui.bodyPreview.value, null); assert.equal(f.ui.bodyPreviewLoading.value, false)
    gate.resolve(ready()); assert.equal(await pending, false); assert.equal(f.ui.bodyPreview.value, null); f.ui.dispose()
  })
  await test(async () => {
    const f = fixture(); await f.ui.createBodyEvidence('en'); f.records.set('second', snapshot('second')); await f.ui.refresh(); f.ui.setBodyDraft('{}')
    const gate = f.body(), pending = f.ui.previewBody(), stops = f.calls.stop
    await f.ui.select('second'); assert.ok(f.calls.stop > stops); assert.equal(f.ui.bodyDraft.value, '')
    gate.resolve(ready()); assert.equal(await pending, false); assert.equal(f.ui.bodyPreview.value, null); f.ui.dispose()
  })
  await test(async () => {
    const f = fixture(); await f.ui.createBodyEvidence('en'); f.ui.setBodyDraft('{}')
    const gate = f.body(), pending = f.ui.previewBody(); f.ui.dispose(); gate.resolve(ready())
    assert.equal(await pending, false); assert.equal(f.ui.bodyDraft.value, ''); assert.equal(f.ui.bodyPreview.value, null)
    assert.equal(await f.ui.previewBody(), false)
  })
  for (const action of ['edit', 'prefix', 'refresh', 'planning', 'step', 'cancel', 'select', 'dispose'] as const) await test(async () => {
    const f = fixture(); await f.ui.createBodyEvidence('en'); f.ui.setBodyDraft('{"kept":true}')
    f.records.set('second', snapshot('second')); await f.ui.refresh()
    const gate = f.draft(), pending = f.ui.loadBodyEvidenceExample(); assert.equal(f.ui.bodyDraftLoading.value, true)
    if (action === 'edit') f.ui.setBodyDraft('{"authorEdited":true}')
    if (action === 'prefix') f.ui.selectBodyPrefix(2)
    if (action === 'refresh' || action === 'step' || action === 'cancel') await f.ui[action]()
    if (action === 'planning') await f.ui.previewChapter(1)
    if (action === 'select') await f.ui.select('second')
    if (action === 'dispose') f.ui.dispose()
    assert.equal(await pending, false); const retained = f.ui.bodyDraft.value
    gate.resolve('{"lateOldExample":true}'); await Promise.resolve(); await Promise.resolve()
    assert.equal(f.ui.bodyDraft.value, retained); assert.equal(f.ui.bodyDraftLoading.value, false)
    if (action === 'edit') assert.equal(retained, '{"authorEdited":true}')
    f.ui.dispose()
  })
  await test(async () => {
    const f = fixture(); await f.ui.createBodyEvidence('en'); const first = f.draft(), old = f.ui.loadBodyEvidenceExample()
    const second = f.draft(), next = f.ui.loadBodyEvidenceExample()
    assert.equal(await old, false); second.resolve('{"newExample":true}'); assert.equal(await next, true)
    first.resolve('{"oldExample":true}'); await Promise.resolve(); assert.equal(f.ui.bodyDraft.value, '{"newExample":true}')
    assert.equal(f.ui.bodyDraftLoading.value, false); f.ui.dispose()
  })
  await test(async () => {
    const f = fixture(); await f.ui.createBodyEvidence('en'); const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance')!
    let now = 0
    try {
      Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } })
      const gate = f.draft(), pending = f.ui.loadBodyEvidenceExample(); now = 10_001; gate.resolve('{}')
      assert.equal(await pending, false); assert.equal(f.ui.bodyDraftRefusal.value, 'deadline_exceeded')
      assert.equal(f.ui.bodyDraft.value, ''); assert.equal(f.ui.bodyDraftLoading.value, false)
    } finally { Object.defineProperty(globalThis, 'performance', descriptor); f.ui.dispose() }
  })
  await test(async () => {
    const f = fixture(); await f.ui.createBodyEvidence('en'); f.ui.setBodyDraft('{}'); await f.ui.previewBody()
    assert.equal(f.ui.setBodyDraft('x'.repeat(65_537)), false); assert.equal(f.ui.bodyDraft.value, '')
    assert.equal(f.ui.bodyDraftRefusal.value, 'envelope_budget_exceeded'); assert.equal(f.ui.bodyPreview.value, null)
    assert.equal(await f.ui.previewBody(), false)
    assert.equal(f.ui.setBodyDraft('中'.repeat(22_000)), false); assert.equal(f.ui.bodyDraft.value, '')
    f.ui.setBodyDraft('{}'); f.refuse(); assert.equal(await f.ui.previewBody(), false)
    assert.deepEqual(f.ui.bodyPreview.value, { status: 'refused', refusalCode: 'source_identity_mismatch' })
    const html = await renderToString(Vue.createSSRApp(component(f.ui)))
    assert.match(html, /campaign-body-preview-refusal/); assert.doesNotMatch(html, /campaign-body-preview-digest/); f.ui.dispose()
  })
  for (const language of ['zh', 'en'] as const) await test(async () => {
    const t = await production(`body-ui-production-${language}`, language)
    assert.equal(t.ui.bodyDraft.value, ''); assert.equal(t.counts().dispatches, 0)
    assert.equal(t.ui.canLoadBodyDraft.value, false)
    for (let i = 0; i < 9; i++) assert.equal(await t.ui.step(), true)
    assert.equal(t.ui.selectBodyPrefix(3), true)
    const before = [...t.disk], counts = t.counts()
    assert.equal(await t.ui.loadBodyEvidenceExample(), true); assert.equal(t.ui.bodyPreview.value, null)
    assert.equal(await t.ui.previewBody(), true)
    const first = t.ui.bodyPreview.value as BodyEvidencePreviewResult | null; assert.equal(first?.status, 'ready')
    if (first?.status !== 'ready') throw new Error('production_not_ready')
    const changed = JSON.parse(t.ui.bodyDraft.value); changed.producer = { kind: 'local_declaration', version: 'ui-generic-v1' }
    changed.claims[0].statement = language === 'zh' ? '另一条尚未审阅的解释。' : 'Another unreviewed interpretation.'
    t.ui.setBodyDraft(canonicalStringify(changed)); assert.equal(await t.ui.previewBody(), true)
    const edited = t.ui.bodyPreview.value as BodyEvidencePreviewResult | null; assert.equal(edited?.status, 'ready')
    if (edited?.status !== 'ready') throw new Error('generic_not_ready')
    assert.notEqual(edited.packetDigest, first.packetDigest); assert.equal(edited.bodyPrefixRoot, first.bodyPrefixRoot)
    assert.deepEqual([...t.disk], before); assert.deepEqual(t.counts(), counts)
    const html = await renderToString(Vue.createSSRApp(component(t.ui))); assert.match(html, /campaign-body-preview-ready/)
    t.ui.dispose()
    const reopenedEngine = createOfflineCampaignEngine({ repository: t.repository, identity }); engines.push(reopenedEngine)
    const reopened = useWriterCampaign({ engine: reopenedEngine }); views.push(reopened)
    await reopened.refresh(); await reopened.select(t.id)
    assert.equal(reopened.bodyDraft.value, ''); assert.equal(reopened.bodyPreview.value, null)
    reopened.selectBodyPrefix(3); assert.equal(await reopened.loadBodyEvidenceExample(), true); assert.equal(await reopened.previewBody(), true)
    assert.equal((reopened.bodyPreview.value as BodyEvidencePreviewResult | null)?.status, 'ready'); assert.deepEqual([...t.disk], before); assert.deepEqual(t.counts(), counts)
  })
  assert.doesNotMatch(source, /v-html|localStorage|indexedDB|apiConfig|fetch\(/)
  console.log(`Body evidence UI: ${cases} cases passed; composable/SSR and injected IO, native and semantic review NOT RUN.`)
} catch {
  process.stderr.write(`Body evidence UI failed at bounded case ${cases + 1}; source details withheld.\n`)
  process.exitCode = 1
} finally { for (const view of views) view.dispose(); for (const engine of engines) engine.dispose() }
