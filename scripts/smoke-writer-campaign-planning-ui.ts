/** Presentation/lifecycle checks plus injected-IO production integration, not native-IDB evidence. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import process from 'node:process'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import { createOfflineCampaignEngine } from '../src/services/writerCampaign/engine'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { useWriterCampaign, type CampaignLabEngine } from '../src/composables/useWriterCampaign'
import type { PlanningPreviewResult } from '../src/services/writerCampaign/planningContext'
import { PLANNING_THREE_CHAPTER_PROFILE } from '../src/services/writerCampaign/planningProfile'
import { encodeStorageBytes } from '../src/services/writerCampaign/protocol'
import type { CampaignSnapshot, CampaignTaskSpec } from '../src/types/writerCampaign'

async function run() {
  let assertions = 0
  const hash = 'a'.repeat(64), secondHash = 'b'.repeat(64)
  const zero = { attempts: 0, inputBytes: 0, inputUtf16: 0, outputTokens: 0, reasoningTokens: 0,
    responseBytes: 0, activeMs: 0, artifacts: 0, operations: 0 }
  const tasks: CampaignTaskSpec[] = [
    { id: 'outline', kind: 'outline', chapterOrdinal: null, dependsOn: [] },
    { id: 'characters', kind: 'character_bible', chapterOrdinal: null, dependsOn: ['outline'] },
    { id: 'details', kind: 'detailed_outline', chapterOrdinal: null, dependsOn: ['outline', 'characters'] },
    ...[1, 2, 3].map(ordinal => ({ id: `chapter-${ordinal}-outline`, kind: 'chapter_outline' as const,
      chapterOrdinal: ordinal, dependsOn: ['outline', 'characters', 'details'] })),
    ...[1, 2, 3].map(ordinal => ({ id: `chapter-${ordinal}-body`, kind: 'chapter_body' as const,
      chapterOrdinal: ordinal, dependsOn: ['outline', 'characters', 'details', 'chapter-1-outline', 'chapter-2-outline', 'chapter-3-outline',
        ...(ordinal === 1 ? [] : [`chapter-${ordinal - 1}-body`])] })),
  ]
  function snapshot(id: string, status: CampaignSnapshot['checkpoint']['status'] = 'running', profile = PLANNING_THREE_CHAPTER_PROFILE): CampaignSnapshot {
    return {
      manifest: { schemaVersion: 2, protocolVersion: 'campaign-v2', campaignId: id, candidateId: 'candidate-0', language: 'en',
        bodyTarget: { unit: 'unicode_scalar', characters: 1_000_000 }, mode: 'offline_fixture', adapterId: 'offline-fixture-v1',
        fixtureVersion: profile, countingVersion: 'crlf-lf-nfc-scalar-v1', runtimeIdentity: 'ui-presentation-only',
        source: { commit: null, tree: null }, createdAt: 1, expiresAt: 1_000_000,
        maxRepairRounds: 0, maxProviderRetries: 0, tasks: structuredClone(tasks), budget: { ...zero, attempts: 128 },
        storage: { limitBytes: encodeStorageBytes(67_108_864), recoveryReserveBytes: encodeStorageBytes(524_288) }, hash },
      head: { schemaVersion: 2, campaignId: id, sequence: 1, manifestHash: hash, checkpointHash: hash, executionEpoch: 1, status, receiptId: 'create' },
      checkpoint: { schemaVersion: 2, campaignId: id, sequence: 1, manifestHash: hash, previousHash: null, operationId: 'create', bodyCharacters: 0,
        hash, status, reason: null, executionEpoch: 1, candidateId: 'candidate-0',
        tasks: tasks.map(task => ({ taskId: task.id, revision: 1, status: 'pending', artifact: null, priorArtifact: null, request: null })),
        budget: { ...zero }, storage: { writtenBytes: encodeStorageBytes(1000), allocatedBytes: encodeStorageBytes(0),
          allocationConsumedBytes: encodeStorageBytes(0), releasedBytes: encodeStorageBytes(0), outstandingBytes: encodeStorageBytes(0),
          recoveryRemainingBytes: encodeStorageBytes(524_288), openAllocations: [] }, lastWallTime: 1 },
      receipt: { schemaVersion: 2, campaignId: id, operationId: 'create', kind: 'create', businessDigest: hash, expectedSequence: null,
        sequence: 1, executionEpoch: 1, manifestHash: hash, checkpointHash: hash, artifactHashes: [], requestHashes: [],
        serializedBytes: encodeStorageBytes(1000), storageEffect: { source: 'direct', requestId: null,
          allocatedBytes: encodeStorageBytes(0), releasedBytes: encodeStorageBytes(0), remainingBytes: encodeStorageBytes(0) }, hash },
      artifacts: new Map(), requests: new Map(), rawHead: 'presentation-only',
    }
  }
  function ready(ordinal: number): PlanningPreviewResult {
    const input = '<script>private packet is not executable</script>&'
    // The real compiler is tested separately. This explicit UI-only fixture has
    // no authority and deliberately does not assert a cryptographic identity.
    return {
      status: 'ready', selectedChapter: { ordinal, outlineTaskId: `chapter-${ordinal}-outline`, bodyTaskId: `chapter-${ordinal}-body` },
      nextEligibleBodyTaskId: 'chapter-1-body', canonBaseRoot: hash, fullPlanRoot: secondHash,
      sourceRefs: [{ taskId: 'outline', revision: 1, hash }],
      scope: { planningCoverage: 'complete_global_planning_canon_and_selected_chapter', declaredReferenceCoverage: 'complete',
        semanticCompleteness: 'not_reviewed', realizedBodyCoverage: 'none', proseEvidenceScope: 'planning_only',
        includedChapterOutlineCount: 1, omittedChapterOutlineCount: 2 },
      input, inputDigest: hash, inputBytes: new TextEncoder().encode(input).length, inputUtf16: input.length,
    }
  }
  function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (error: Error) => void
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
  }
  function fixture() {
    const records = new Map<string, CampaignSnapshot>()
    const calls = { prepare: 0, planning: 0, preview: 0, step: 0, pause: 0, resume: 0, cancel: 0, save: 0, stop: 0 }
    let next: Promise<PlanningPreviewResult> | null = null
    const engine: CampaignLabEngine = {
      async list() { return [...records.keys()] },
      async inspect(id) { return records.get(id) ?? null },
      async prepare({ campaignId }) { calls.prepare++; records.set(campaignId, snapshot(campaignId, 'prepared', 'tiny-bilingual-v1')) },
      async preparePlanning({ campaignId }) { calls.planning++; records.set(campaignId, snapshot(campaignId)) },
      async previewPlanningContext(_id, ordinal) {
        calls.preview++; const result = next; next = null
        return result ? result : ready(ordinal)
      },
      async step(id) { calls.step++; records.set(id, snapshot(id)) },
      async pause(id) { calls.pause++; records.set(id, snapshot(id, 'paused')) },
      async resume(id) { calls.resume++; records.set(id, snapshot(id)) },
      async cancel(id) { calls.cancel++; records.set(id, snapshot(id, 'cancelled')) },
      async recoverSaveOnly() { calls.save++ },
      stopLocal() { calls.stop++ },
    }
    const ui = useWriterCampaign({ engine, newId: () => 'planning-ui' })
    return { ui, calls, records, hold() { const gate = deferred<PlanningPreviewResult>(); next = gate.promise; return gate },
      refuse() { next = Promise.resolve({ status: 'refused', refusalCode: 'missing_planning_source' }) } }
  }
  function noExecution(calls: ReturnType<typeof fixture>['calls']) {
    assert.equal(calls.step + calls.resume + calls.save, 0)
    assertions++
  }
  const source = fs.readFileSync(new URL('../src/views/CampaignLab.vue', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(compileScript(parse(source).descriptor, { id: 'planning-ui', inlineTemplate: true }).content,
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  function component(ui: ReturnType<typeof useWriterCampaign>) {
    const exports: { default?: Vue.Component } = {}
    new Function('require', 'exports', compiled)((id: string) => {
      if (id === 'vue') return Vue
      if (id === '@/composables/useWriterCampaign') return { useWriterCampaign: () => ui }
      if (id === '@/components/ProducerLabPanel.vue') return { default: { render: () => null } }
      throw new Error('Unexpected Campaign Lab import')
    }, exports)
    return exports.default!
  }
  {
    const f = fixture()
    await f.ui.refresh(); assert.equal(f.calls.planning + f.calls.prepare + f.calls.preview, 0)
    assert.equal(await f.ui.createPlanning('en'), true)
    assert.equal(f.calls.planning, 1); assert.equal(f.calls.prepare, 0); assert.equal(f.calls.preview, 0)
    assert.equal(f.ui.planningProfile.value, true); assert.equal(f.ui.chapterRows.value.length, 3)
    assert.equal(await f.ui.previewChapter(4), false); assert.equal(f.calls.preview, 0)
    noExecution(f.calls); f.ui.dispose(); assertions += 8
  }
  {
    const f = fixture(); await f.ui.createPlanning('zh'); f.refuse()
    assert.equal(await f.ui.previewChapter(3), false)
    assert.deepEqual(f.ui.planningPreview.value, { status: 'refused', refusalCode: 'missing_planning_source' })
    const html = await renderToString(Vue.createSSRApp(component(f.ui)))
    assert.match(html, /campaign-preview-refusal/); assert.match(html, /missing_planning_source/)
    assert.doesNotMatch(html, /campaign-preview-digest/); noExecution(f.calls); f.ui.dispose(); assertions += 5
  }
  {
    const f = fixture(); await f.ui.createPlanning('en')
    assert.equal(await f.ui.previewChapter(3), true)
    const result = f.ui.planningPreview.value
    assert.equal(result?.status, 'ready'); if (result?.status !== 'ready') throw new Error('not ready')
    assert.equal(result.selectedChapter.ordinal, 3); assert.equal(result.nextEligibleBodyTaskId, 'chapter-1-body')
    const html = await renderToString(Vue.createSSRApp(component(f.ui)))
    for (const id of ['selected', 'next-body', 'canon-root', 'plan-root', 'digest', 'size', 'scope-details', 'sources', 'packet']) {
      assert.match(html, new RegExp(`campaign-preview-${id}`)); assertions++
    }
    assert.match(html, /planning_preview/); assert.match(html, /body_fixture_dispatch/)
    assert.match(html, /&lt;script&gt;private packet/); assert.doesNotMatch(html, /<script>private packet/)
    assert.match(html, /NOT RUN/); noExecution(f.calls); f.ui.dispose(); assertions += 9
  }
  {
    const f = fixture(); await f.ui.createPlanning('en'); const gate = f.hold()
    const old = f.ui.previewChapter(1); assert.equal(f.ui.previewLoading.value, true)
    assert.equal(await f.ui.previewChapter(3), true); gate.resolve(ready(1)); assert.equal(await old, false)
    assert.deepEqual(f.ui.planningPreview.value, ready(3)); assert.equal(f.ui.previewLoading.value, false)
    noExecution(f.calls); f.ui.dispose(); assertions += 5
  }
  for (const action of ['refresh', 'step', 'pause', 'cancel'] as const) {
    const f = fixture(); await f.ui.createPlanning('en'); await f.ui.previewChapter(1)
    const gate = f.hold(), pending = f.ui.previewChapter(2)
    await f.ui[action](); assert.equal(f.ui.planningPreview.value, null)
    gate.resolve(ready(2)); assert.equal(await pending, false)
    assert.equal(f.ui.planningPreview.value, null); assert.equal(f.ui.previewLoading.value, false)
    assert.equal(f.calls.step, action === 'step' ? 1 : 0)
    assert.equal(f.calls.preview, 2); f.ui.dispose(); assertions += 6
  }
  {
    const f = fixture(); await f.ui.createPlanning('en'); f.records.set('second', snapshot('second')); await f.ui.refresh()
    const gate = f.hold(), pending = f.ui.previewChapter(1)
    await f.ui.select('second'); gate.resolve(ready(1)); assert.equal(await pending, false)
    assert.equal(f.ui.planningPreview.value, null); assert.equal(f.ui.selectedId.value, 'second')
    noExecution(f.calls); f.ui.dispose(); assertions += 3
  }
  {
    const f = fixture(); await f.ui.createPlanning('en'); const gate = f.hold(), pending = f.ui.previewChapter(1)
    gate.reject(new Error('private source exception must remain local'))
    assert.equal(await pending, false)
    assert.deepEqual(f.ui.planningPreview.value, { status: 'refused', refusalCode: 'preview_unavailable' })
    assert.equal(f.ui.error.value, ''); noExecution(f.calls); f.ui.dispose(); assertions += 3
  }
  {
    const f = fixture(); await f.ui.createPlanning('en'); const gate = f.hold(), pending = f.ui.previewChapter(1)
    f.ui.dispose(); gate.resolve(ready(1)); assert.equal(await pending, false)
    assert.equal(f.ui.planningPreview.value, null); assert.equal(f.ui.previewLoading.value, false)
    assert.equal(await f.ui.previewChapter(2), false); noExecution(f.calls); assertions += 4
  }
  {
    const f = fixture(); await f.ui.create('en')
    assert.equal(f.ui.planningProfile.value, false); assert.equal(f.ui.canPreview.value, false)
    assert.equal(await f.ui.previewChapter(1), false); assert.equal(f.calls.preview, 0)
    noExecution(f.calls); f.ui.dispose(); assertions += 4
  }
  // Actual production facade/compiler/repository, with only the IO transport
  // injected. Preview must leave every persisted byte and invocation unchanged.
  for (const language of ['zh', 'en'] as const) {
    const disk = new Map<string, string>()
    let writes = 0, dispatches = 0
    const repository = createCampaignRepository({
      async getMany(keys) { return new Map(keys.map(key => [key, disk.get(key) ?? null])) },
      async compareAndSwapMany(entries, canCommit = () => true) {
        if (!canCommit() || entries.some(entry => (disk.get(entry.key) ?? null) !== entry.expectedValue)) return false
        writes++
        for (const entry of entries) disk.set(entry.key, entry.value)
        return true
      },
    })
    const identity = { runtimeIdentity: 'planning-ui-injected-io-v1', source: { commit: null, tree: null } }
    const engine = createOfflineCampaignEngine({ repository, identity, fixture: { onDispatch() { dispatches++ } } })
    const ui = useWriterCampaign({ engine, newId: () => `planning-ui-production-${language}` })
    assert.equal(await ui.createPlanning(language), true); assert.equal(dispatches, 0)
    assert.equal(await ui.previewChapter(3), false)
    for (let i = 0; i < 6; i++) assert.equal(await ui.step(), true)
    assert.equal(ui.completedTasks.value, 6); assert.equal(dispatches, 6)
    const before = [...disk], writesBefore = writes
    assert.equal(await ui.previewChapter(3), true)
    const preview = ui.planningPreview.value
    assert.equal(preview?.status, 'ready'); if (preview?.status !== 'ready') throw new Error('not ready')
    assert.equal(preview.selectedChapter.ordinal, 3); assert.equal(preview.scope.realizedBodyCoverage, 'none')
    assert.equal(preview.nextEligibleBodyTaskId, ui.snapshot.value!.manifest.tasks.find(task => task.kind === 'chapter_body')!.id)
    assert.equal(JSON.parse(preview.input).purpose, 'planning_preview')
    assert.deepEqual([...disk], before); assert.equal(writes, writesBefore); assert.equal(dispatches, 6)
    for (let i = 0; i < 3; i++) assert.equal(await ui.step(), true)
    assert.equal(ui.completedTasks.value, 9); assert.equal(dispatches, 9)
    const complete = [...disk]
    ui.dispose()
    const reopened = useWriterCampaign({ engine: createOfflineCampaignEngine({ repository, identity }) })
    await reopened.refresh(); await reopened.select(`planning-ui-production-${language}`)
    assert.equal(reopened.planningPreview.value, null)
    assert.equal(await reopened.previewChapter(1), true)
    const final = reopened.planningPreview.value as PlanningPreviewResult | null
    assert.equal(final?.status, 'ready'); if (final?.status !== 'ready') throw new Error('not ready')
    assert.equal(final.nextEligibleBodyTaskId, null)
    assert.deepEqual([...disk], complete); assert.equal(dispatches, 9)
    reopened.dispose(); assertions += 31
  }
  assert.doesNotMatch(source, /v-html|localStorage|indexedDB|apiConfig|fetch\(/)
  assertions++
  console.log(`Campaign planning UI: ${assertions} assertions passed; facade and injected-IO integration, not native persistence evidence.`)
}
try { await run() } catch {
  process.stderr.write('Campaign planning UI: failed (planning_ui_assertion_failed).\n')
  process.exitCode = 1
}
