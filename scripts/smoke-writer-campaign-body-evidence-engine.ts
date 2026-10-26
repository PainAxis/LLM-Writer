/** Real production engine/repository, injected atomic IO. Not native or semantic evidence. */
import assert from 'node:assert/strict'
import type { CampaignRepository, CampaignSnapshot } from '../src/types/writerCampaign'
import { createOfflineCampaignEngine } from '../src/services/writerCampaign/engine'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { PlanningRefusalError } from '../src/services/writerCampaign/planningProtocol'
import { buildBodyEvidenceFixtureProposal } from '../src/services/writerCampaign/bodyEvidenceFixture'
import { canonicalStringify } from '../src/services/writerCampaign/protocol'
import type { BodyEvidencePreviewResult } from '../src/services/writerCampaign/bodyEvidenceProtocol'
import { installNodePlanningAuthorityGuard } from './fixtures/writer-campaign-planning-authority.mjs'

const identity = { runtimeIdentity: 'body-evidence-engine-smoke-v1', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }
const engines: Array<ReturnType<typeof createOfflineCampaignEngine>> = []
const guard = installNodePlanningAuthorityGuard()
let cases = 0
const test = async (action: () => Promise<void>) => { await action(); cases++ }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
function ready(value: BodyEvidencePreviewResult) {
  assert.equal(value.status, 'ready')
  if (value.status !== 'ready') throw new Error('body_evidence_not_ready')
  return value
}
async function setup(id: string, language: 'zh' | 'en' = 'en', steps = 9) {
  const disk = new Map<string, string>()
  let writes = 0, dispatches = 0, clock = 1_900_000_000_000
  const repository = createCampaignRepository({
    async getMany(keys) { return new Map(keys.map(key => [key, disk.get(key) ?? null])) },
    async compareAndSwapMany(entries, canCommit = () => true) {
      if (!canCommit() || entries.some(entry => (disk.get(entry.key) ?? null) !== entry.expectedValue)) return false
      writes++; for (const entry of entries) disk.set(entry.key, entry.value)
      return true
    },
  })
  const engine = createOfflineCampaignEngine({ repository, identity, clock: () => clock, fixture: { onDispatch() { dispatches++ } } })
  engines.push(engine)
  await engine.prepareBodyEvidence({ campaignId: id, language })
  for (let i = 0; i < steps; i++) await engine.step(id, `step-${i}`)
  const snapshot = (await repository.read(id))!
  const proposal = steps >= 7 ? await buildBodyEvidenceFixtureProposal(snapshot, Math.min(3, steps - 6)) : ''
  return { id, disk, repository, engine, snapshot, proposal, counts: () => ({ writes, dispatches }), setClock(value: number) { clock = value }, clock: () => clock }
}
function readOnlyEngine(t: Awaited<ReturnType<typeof setup>>, read?: CampaignRepository['read'], ioTimeoutMs?: number) {
  let mutations = 0
  const repository: CampaignRepository = { ...t.repository, ...(read ? { read } : {}),
    async create() { mutations++; throw new Error('preview_mutation') },
    async commit() { mutations++; throw new Error('preview_mutation') },
  }
  const engine = createOfflineCampaignEngine({ repository, identity, clock: t.clock, ...(ioTimeoutMs ? { ioTimeoutMs } : {}) })
  engines.push(engine)
  return { engine, mutations: () => mutations }
}
try {
  for (const language of ['zh', 'en'] as const) await test(async () => {
    const t = await setup(`generic-${language}`, language), p = readOnlyEngine(t)
    assert.equal(t.snapshot.checkpoint.tasks.filter(row => row.status === 'committed').length, 9)
    const before = [...t.disk], counts = t.counts()
    const first = ready(await p.engine.previewBodyEvidence(t.id, t.proposal))
    assert.equal(first.throughChapterOrdinal, 3)
    assert.equal(first.coverage.semanticReview.status, 'not_reviewed')
    assert.equal(first.coverage.examinedDeclaration.verification, 'range_and_identity_only')
    assert.equal(first.coverage.supplied.coveredUtf16Units, first.coverage.availablePrefix.totalUtf16Units)
    assert.equal(first.packetBytes, new TextEncoder().encode(first.packetText).length)
    const wire = JSON.parse(t.proposal)
    wire.producer = { kind: 'local_declaration', version: 'edited-generic-v1' }
    wire.claims[0].statement = language === 'zh' ? '这是一条未经语义审阅的不同解释。' : 'A deliberately different interpretation, not semantically reviewed.'
    const generic = ready(await p.engine.previewBodyEvidence(t.id, canonicalStringify(wire)))
    assert.notEqual(generic.packetDigest, first.packetDigest)
    assert.equal(generic.bodyPrefixRoot, first.bodyPrefixRoot)
    assert.equal(JSON.parse(generic.packetText).producer.kind, 'local_declaration')
    assert.ok(JSON.parse(first.packetText).claims.some((row: { id: string }) => row.id === 'claim.contradictory'))
    const cold = readOnlyEngine(t)
    const reopened = ready(await cold.engine.previewBodyEvidence(t.id, t.proposal))
    assert.equal(reopened.packetText, first.packetText); assert.equal(reopened.sourceHead.rawHeadHash, first.sourceHead.rawHeadHash)
    assert.deepEqual([...t.disk], before); assert.deepEqual(t.counts(), counts)
    assert.equal(p.mutations() + cold.mutations(), 0)
  })
  await test(async () => {
    const t = await setup('admission'), before = [...t.disk]
    let reads = 0
    const p = readOnlyEngine(t, async (...args) => { reads++; return t.repository.read(...args) })
    assert.deepEqual(await p.engine.previewBodyEvidence(t.id, 'x'.repeat(65_537)), { status: 'refused', refusalCode: 'envelope_budget_exceeded' })
    assert.deepEqual(await p.engine.previewBodyEvidence(t.id, '{"unknown":true}'), { status: 'refused', refusalCode: 'invalid_envelope' })
    assert.equal(reads, 0); assert.deepEqual([...t.disk], before)
    const wire = JSON.parse(t.proposal); wire.purpose = 'external_provider_dispatch'
    assert.deepEqual(await p.engine.previewBodyEvidence(t.id, canonicalStringify(wire)), { status: 'refused', refusalCode: 'unsupported_purpose' })
    assert.equal(reads, 0)
    wire.purpose = 'local_author_continuity_preview'; wire.spans[0].quote += 'forged'
    assert.deepEqual(await p.engine.previewBodyEvidence(t.id, canonicalStringify(wire)), { status: 'refused', refusalCode: 'quote_mismatch' })
    assert.equal(p.mutations(), 0)
  })
  await test(async () => {
    const t = await setup('source-head-race', 'en', 8)
    let reads = 0
    const p = readOnlyEngine(t, async (...args) => {
      const value = await t.repository.read(...args)
      if (++reads === 1) await t.engine.step(t.id, 'other-tab-step')
      return value
    })
    assert.deepEqual(await p.engine.previewBodyEvidence(t.id, t.proposal), { status: 'refused', refusalCode: 'source_changed' })
    assert.equal(reads, 2); assert.equal(p.mutations(), 0)
    assert.equal((await t.repository.read(t.id))!.checkpoint.tasks.filter(row => row.status === 'committed').length, 9)
  })
  await test(async () => {
    const t = await setup('replacement-race', 'en', 8)
    let reads = 0
    const p = readOnlyEngine(t, async (...args) => {
      const value = await t.repository.read(...args)
      if (++reads === 1) await t.engine.replaceCandidate(t.id, 'outline', [...t.snapshot.artifacts.values()].find(row => row.kind === 'outline')!.text, 'replace-plan')
      return value
    })
    assert.deepEqual(await p.engine.previewBodyEvidence(t.id, t.proposal), { status: 'refused', refusalCode: 'source_changed' })
    const after = await p.engine.previewBodyEvidence(t.id, t.proposal)
    assert.equal(after.status, 'refused'); assert.equal(p.mutations(), 0)
  })
  await test(async () => {
    const t = await setup('cancel-source-race', 'en', 8)
    let reads = 0
    const p = readOnlyEngine(t, async (...args) => {
      const value = await t.repository.read(...args)
      if (++reads === 1) await t.engine.cancel(t.id, 'other-tab-cancel')
      return value
    })
    assert.deepEqual(await p.engine.previewBodyEvidence(t.id, t.proposal), { status: 'refused', refusalCode: 'cancelled' })
    assert.equal(p.mutations(), 0)
  })
  await test(async () => {
    const t = await setup('runtime-expiry'), p = readOnlyEngine(t)
    const wrong = createOfflineCampaignEngine({ repository: t.repository, identity: { ...identity, runtimeIdentity: 'changed-runtime' }, clock: t.clock }); engines.push(wrong)
    assert.deepEqual(await wrong.previewBodyEvidence(t.id, t.proposal), { status: 'refused', refusalCode: 'runtime_identity_changed' })
    t.setClock(t.snapshot.manifest.expiresAt + 1)
    assert.deepEqual(await p.engine.previewBodyEvidence(t.id, t.proposal), { status: 'refused', refusalCode: 'expired' })
    assert.equal(p.mutations(), 0)
  })
  await test(async () => {
    const t = await setup('preview-cancel'), gate = deferred<CampaignSnapshot | null>(), entered = deferred<void>()
    let held = false
    const p = readOnlyEngine(t, async (...args) => {
      if (!held) { held = true; entered.resolve(); return gate.promise }
      return t.repository.read(...args)
    })
    const before = [...t.disk], counts = t.counts(), pending = p.engine.previewBodyEvidence(t.id, t.proposal)
    await entered.promise; p.engine.cancelPreviews(t.id)
    assert.deepEqual(await pending, { status: 'refused', refusalCode: 'cancelled' })
    const next = ready(await p.engine.previewBodyEvidence(t.id, t.proposal))
    gate.resolve(t.snapshot); await Promise.resolve()
    assert.equal(next.throughChapterOrdinal, 3); assert.deepEqual([...t.disk], before); assert.deepEqual(t.counts(), counts)
    assert.equal(p.mutations(), 0)
  })
  for (const direction of ['body-to-planning', 'planning-to-body'] as const) await test(async () => {
    const t = await setup(direction), gate = deferred<CampaignSnapshot | null>(), entered = deferred<void>()
    let held = false
    const p = readOnlyEngine(t, async (...args) => { if (!held) { held = true; entered.resolve(); return gate.promise }; return t.repository.read(...args) })
    const first = direction === 'body-to-planning' ? p.engine.previewBodyEvidence(t.id, t.proposal) : p.engine.previewPlanningContext(t.id, 3)
    await entered.promise
    const second = direction === 'body-to-planning' ? await p.engine.previewPlanningContext(t.id, 3) : await p.engine.previewBodyEvidence(t.id, t.proposal)
    assert.equal(second.status, 'ready')
    const cancelled = await first; assert.equal(cancelled.status, 'refused')
    if (cancelled.status === 'refused') assert.equal(cancelled.refusalCode, direction === 'body-to-planning' ? 'cancelled' : 'planning_cancelled')
    gate.resolve(t.snapshot); assert.equal(p.mutations(), 0)
  })
  await test(async () => {
    const t = await setup('cross-campaign-owner'), other = 'other-preview-campaign'
    await t.engine.prepareBodyEvidence({ campaignId: other, language: 'en' })
    for (let i = 0; i < 6; i++) await t.engine.step(other, `other-step-${i}`)
    const gate = deferred<CampaignSnapshot | null>(), entered = deferred<void>()
    let held = false
    const p = readOnlyEngine(t, async (...args) => { if (!held) { held = true; entered.resolve(); return gate.promise }; return t.repository.read(...args) })
    const first = p.engine.previewBodyEvidence(t.id, t.proposal); await entered.promise
    assert.equal((await p.engine.previewPlanningContext(other, 3)).status, 'ready')
    assert.deepEqual(await first, { status: 'refused', refusalCode: 'cancelled' })
    gate.resolve(t.snapshot); assert.equal(p.mutations(), 0)
  })
  await test(async () => {
    const t = await setup('cancel-packet-hash'), p = readOnlyEngine(t), entered = deferred<void>(), release = deferred<void>()
    const digest = crypto.subtle.digest.bind(crypto.subtle), before = [...t.disk]
    try {
      crypto.subtle.digest = async (algorithm, data) => {
        const result = await digest(algorithm, data)
        if (new TextDecoder().decode(data).includes('"protocol":"campaign-body-evidence-packet-v1"')) { entered.resolve(); await release.promise }
        return result
      }
      const pending = p.engine.previewBodyEvidence(t.id, t.proposal); await entered.promise
      p.engine.cancelPreviews(t.id)
      assert.deepEqual(await pending, { status: 'refused', refusalCode: 'cancelled' })
      release.resolve(); await Promise.resolve(); await Promise.resolve()
    } finally { release.resolve(); crypto.subtle.digest = digest }
    assert.deepEqual([...t.disk], before); assert.equal(p.mutations(), 0)
  })
  await test(async () => {
    const t = await setup('cancel-final-read')
    let reads = 0
    const p = readOnlyEngine(t, async (...args) => {
      const value = await t.repository.read(...args)
      if (++reads === 2) p.engine.cancelPreviews(t.id)
      return value
    })
    assert.deepEqual(await p.engine.previewBodyEvidence(t.id, t.proposal), { status: 'refused', refusalCode: 'cancelled' })
    assert.equal(reads, 2); assert.equal(p.mutations(), 0)
  })
  await test(async () => {
    const t = await setup('tampered-source'), p = readOnlyEngine(t), before = t.snapshot.rawHead
    const entry = [...t.disk].find(([, text]) => { try { const value = JSON.parse(text); return value.kind === 'chapter_body' && value.taskId === 'b-1' && typeof value.text === 'string' } catch { return false } })!
    const altered = JSON.parse(entry[1]); altered.text += 'x'; t.disk.set(entry[0], canonicalStringify(altered))
    assert.deepEqual(await p.engine.previewBodyEvidence(t.id, t.proposal), { status: 'refused', refusalCode: 'preview_unavailable' })
    assert.ok([...t.disk.values()].includes(before)); assert.equal(p.mutations(), 0)
    t.disk.set(entry[0], entry[1])
  })
  await test(async () => {
    const t = await setup('preview-dispose'), gate = deferred<CampaignSnapshot | null>(), entered = deferred<void>()
    const p = readOnlyEngine(t, async () => { entered.resolve(); return gate.promise })
    const pending = p.engine.previewBodyEvidence(t.id, t.proposal)
    await entered.promise; p.engine.dispose()
    assert.deepEqual(await pending, { status: 'refused', refusalCode: 'cancelled' })
    gate.resolve(t.snapshot); assert.equal(p.mutations(), 0)
  })
  await test(async () => {
    const t = await setup('preview-io-fault'), p = readOnlyEngine(t, async () => { throw new Error('private source exception') })
    assert.deepEqual(await p.engine.previewBodyEvidence(t.id, t.proposal), { status: 'refused', refusalCode: 'preview_unavailable' })
    assert.equal(p.mutations(), 0)
  })
  await test(async () => {
    const t = await setup('replay-unsupported-profile'), p = readOnlyEngine(t, async () => { throw new PlanningRefusalError('unsupported_profile') })
    assert.deepEqual(await p.engine.previewBodyEvidence(t.id, t.proposal), { status: 'refused', refusalCode: 'unsupported_profile' })
    assert.equal(p.mutations(), 0)
  })
  await test(async () => {
    const t = await setup('preview-timeout'), gate = deferred<CampaignSnapshot | null>()
    const p = readOnlyEngine(t, async () => gate.promise, 20), before = [...t.disk], started = performance.now()
    assert.deepEqual(await p.engine.previewBodyEvidence(t.id, t.proposal), { status: 'refused', refusalCode: 'deadline_exceeded' })
    assert.ok(performance.now() - started < 1000)
    gate.resolve(t.snapshot); await Promise.resolve(); assert.deepEqual([...t.disk], before); assert.equal(p.mutations(), 0)
  })
  // Controlled monotonic time is a unit test of elapsed-time fences, not a capacity result.
  await test(async () => {
    const t = await setup('preview-sync-deadline'), real = globalThis.performance, descriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance')!
    let now = 0
    const p = readOnlyEngine(t, async (...args) => { const value = await t.repository.read(...args); now = 3001; return value })
    try {
      Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } })
      assert.deepEqual(await p.engine.previewBodyEvidence(t.id, t.proposal), { status: 'refused', refusalCode: 'deadline_exceeded' })
    } finally { Object.defineProperty(globalThis, 'performance', { ...descriptor, ...(Object.hasOwn(descriptor, 'value') ? { value: real } : {}) }) }
    assert.equal(p.mutations(), 0)
    const read = p.engine.readOperationTimings().phases.find(row => row.phase === 'read')!
    assert.equal(read.timeout, 1); assert.equal(read.success, 0)
    assert.equal(p.engine.readTimeoutDiagnostics().events.length, 0) // Not an exhaustive timeout count.
  })
  await test(async () => {
    const t = await setup('preview-total-deadline'), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance')!
    const digest = crypto.subtle.digest.bind(crypto.subtle), timer = globalThis.setTimeout, delays: number[] = []
    let now = 0, reads = 0
    const p = readOnlyEngine(t, async (...args) => { const value = await t.repository.read(...args); now = ++reads === 1 ? 2900 : 10_001; return value })
    try {
      Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } })
      crypto.subtle.digest = async (algorithm, data) => {
        const result = await digest(algorithm, data)
        const value = new TextDecoder().decode(data)
        if (value.includes('"protocol":"campaign-body-evidence-packet-v1"')) now = 5800
        if (value === t.snapshot.rawHead) now = 8700
        return result
      }
      globalThis.setTimeout = ((handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]) => { delays.push(timeout ?? 0); return timer(handler, timeout, ...args) }) as typeof setTimeout
      assert.deepEqual(await p.engine.previewBodyEvidence(t.id, t.proposal), { status: 'refused', refusalCode: 'deadline_exceeded' })
      assert.equal(reads, 2); assert.ok(delays.includes(1300)); assert.ok(delays.every(value => value <= 3000))
    } finally { crypto.subtle.digest = digest; globalThis.setTimeout = timer; Object.defineProperty(globalThis, 'performance', descriptor) }
    assert.equal(p.mutations(), 0)
  })
  // Preview-only revocation cannot stop an independently authorized durable step.
  await test(async () => {
    const t = await setup('run-isolation', 'en', 8), entered = deferred<void>(), release = deferred<void>()
    const writer = createOfflineCampaignEngine({ repository: t.repository, identity, clock: t.clock, fixture: { async onDispatch() { entered.resolve(); await release.promise } } }); engines.push(writer)
    const run = writer.step(t.id, 'held-authorized-step'); await entered.promise
    const inspection = await t.repository.read(t.id)
    assert.equal(inspection!.checkpoint.tasks.at(-1)!.status, 'dispatch_intent')
    writer.cancelPreviews(t.id)
    release.resolve(); assert.equal((await run).checkpoint.tasks.at(-1)!.status, 'committed')
  })
  assert.deepEqual(guard.snapshot(), { networkEntries: 0, credentialEntries: 0, configurationReads: 0, ordinaryWriterMutations: 0, externalToolEntries: 0 })
  console.log(`Body evidence engine: ${cases} cases passed; real engine/injected IO, native and semantic review NOT RUN.`)
} catch {
  process.stderr.write(`Body evidence engine failed at bounded case ${cases + 1}; source details withheld.\n`)
  process.exitCode = 1
} finally { for (const engine of engines) engine.dispose(); guard.restore() }
