/** Virtual-time repository promise/IO controls. No SDK and no performance claim. */
import assert from 'node:assert/strict'
import { createCreativePilotRepository } from '../../src/services/writerCampaign/creativePilotStore'
import { compileCreativeInput } from '../../src/services/writerCampaign/creativePilotContext'
import { sealCreativeRequest, sealCreativeResponse, creativeRequestReservation, encodeCreativeResponseText } from '../../src/services/writerCampaign/creativePilotProtocol'
import { encodeStorageBytes } from '../../src/services/writerCampaign/protocol'
import { createCreativeMemoryIO } from './creative-pilot-io'
import { creativeControlIdentity, creativeControlText } from './creative-pilot-control'
import type { CreativeCommitGuard, CreativeRepository, CreativeSnapshot, CreateCreativeCommand } from '../../src/types/creativePilot'
import type { CampaignRepositoryIO } from '../../src/types/writerCampaign'

interface DigestPayload { domain: string; value: Record<string, unknown> }
function digestPayload(bytes: Parameters<SubtleCrypto['digest']>[1]): DigestPayload | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (value && typeof value === 'object' && 'domain' in value && typeof value.domain === 'string' && 'value' in value
      && value.value && typeof value.value === 'object' && !Array.isArray(value.value)) return value as DigestPayload
  } catch { /* Scalar text hashes are not domain-tagged records. */ }
  return null
}
export interface CreativeStoreDeadlineResult {
  name: string; status: 'pass'; timeoutCode: string | undefined
  rawCaptureClearedBeforeRelease?: boolean; snapshotMapsClearedBeforeRelease?: boolean
  lateWrites?: number; latePublicationChecks?: number; successfulCas?: number; latePermit?: boolean; lateAdditionalWrites?: number
}
export async function runCreativeStoreDeadlineControls(): Promise<{
  scope: 'focused_virtual_time_not_performance'; status: 'pass'; sdkCalls: 0; cases: number; results: CreativeStoreDeadlineResult[]
}> {
  const guard = { canCommit: () => true, canPublish: () => true }, wall = 1000000
  const command: CreateCreativeCommand = { campaignId: 'deadline-control', operationId: 'create', brief: { protocol: 'creative-brief-v1', language: 'en', premise: 'A letter starts a mystery.', constraints: [] }, identity: { runtimeIdentity: 'probe', source: { commit: null, tree: null } } }
  const setupMemory = createCreativeMemoryIO(), setup = createCreativePilotRepository({ io: setupMemory.io, clock: () => wall })
  let snapshot = (await setup.create(command, guard)).snapshot
  const creation = structuredClone(snapshot), creationRows = new Map(setupMemory.rows)
  const prepared = await compileCreativeInput(snapshot, 'outline')
  const request = await sealCreativeRequest({ schemaVersion: 1, protocol: 'creative-pilot-request-v1', campaignId: command.campaignId, id: 'r', operationId: 'r', manifestHash: snapshot.manifest.hash, candidateHash: snapshot.candidate.hash, taskId: 'outline', taskRevision: 0, dependencies: prepared.sourceRefs, prepared, adapter: creativeControlIdentity('http://127.0.0.1:1234/v1'), invocationId: 'grant', reservation: creativeRequestReservation(), createdAt: wall, expiresAt: wall + 60000, storageAllocationBytes: encodeStorageBytes(1900544) })
  snapshot = (await setup.commit(snapshot, { kind: 'reserve', operationId: 'r:reserve', recovery: false, request }, guard)).snapshot
  snapshot = (await setup.commit(snapshot, { kind: 'dispatch_intent', operationId: 'r:intent', recovery: false, requestHash: request.hash, dispatchWire: { wireProtocol: 'creative-pilot-http-wire-v1', bodyDigest: 'a'.repeat(64), bodyBytes: 20, bodyUtf16: 20 } }, guard)).snapshot
  const intentHash = snapshot.checkpoint.requests[0].phaseHash
  const response = await sealCreativeResponse({ schemaVersion: 1, protocol: 'creative-pilot-response-v1', campaignId: command.campaignId, requestHash: request.hash, intentHash, evidenceId: 'reply', ...await encodeCreativeResponseText(await creativeControlText(prepared)), finishReason: 'stop', contentEvidence: { stepCount: 1, anomalies: [] }, usage: { status: 'complete', provenance: 'synthetic_control', inputTokens: 1, outputTokens: 1, reasoningTokens: 0 }, reportedModel: { status: 'matched', value: request.adapter.effectiveModelId } })
  snapshot = (await setup.commit(snapshot, { kind: 'retain_response', operationId: 'r:retain', recovery: false, requestHash: request.hash, response }, guard)).snapshot
  const retainedRows = new Map(setupMemory.rows), retained = structuredClone(snapshot)
  const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout, realDigest = crypto.subtle.digest, realMapClear = Map.prototype.clear
  const tick = () => new Promise(resolve => setImmediate(resolve))
  async function until(predicate: () => boolean) { for (let i = 0; i < 10000; i++) { if (predicate()) return; await tick() }; throw new Error('control did not reach held boundary') }
  function virtualTime() {
    let now = 0, sequence = 0
    const timers = new Map<number, { at: number; fn: () => void }>()
    globalThis.setTimeout = ((fn: (...args: unknown[]) => void, ms = 0, ...args: unknown[]) => { const id = ++sequence; timers.set(id, { at: now + Number(ms), fn: () => fn(...args) }); return id }) as unknown as typeof setTimeout
    globalThis.clearTimeout = id => { timers.delete(Number(id)) }
    return { now: () => now, set: (value: number) => { now = value }, advance(value: number) { now = value; while (true) { const next = [...timers].filter(([, row]) => row.at <= now).sort(([a, x], [b, y]) => x.at - y.at || a - b)[0]; if (!next) break; timers.delete(next[0]); next[1].fn() } }, restore() { globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout; timers.clear() }, count: () => timers.size }
  }
  function observe(promise: Promise<unknown>) {
    const state: { outcome: { value?: unknown; error?: { code?: string } } | null } = { outcome: null }
    const done = promise.then(value => { state.outcome = { value }; return state.outcome }, error => { state.outcome = { error }; return state.outcome })
    return { done, get: () => state.outcome }
  }
  const results: CreativeStoreDeadlineResult[] = []
  async function hashCase(name: string, initialRows: ReadonlyMap<string, string>, expectedSnapshot: CreativeSnapshot | null, match: (value: DigestPayload) => boolean, action: (repo: CreativeRepository, snapshot: CreativeSnapshot | null, guard: CreativeCommitGuard) => Promise<unknown>, requireSnapshotCleanup: boolean) {
    const time = virtualTime(), memory = createCreativeMemoryIO(initialRows), baseline = [...memory.rows], clears = { raw: 0, snapshot: 0 }
    let held = false, publicationChecks = 0, activeHashes = 0
    const heldHash: { release: (() => void) | null } = { release: null }
    const countedGuard = { canCommit: () => true, canPublish: () => { publicationChecks++; return true } }
    const repo = createCreativePilotRepository({ io: memory.io, clock: () => wall, monotonic: time.now })
    Map.prototype.clear = function (this: Map<unknown, unknown>) {
      if ([...this].some(([key, value]) => typeof key === 'string' && key.includes(':v4:') && typeof value === 'string')) clears.raw++
      if ([...this.values()].some(value => value && typeof value === 'object' && ['creative-pilot-request-v1', 'creative-pilot-phase-v1', 'creative-pilot-response-v1'].includes('protocol' in value ? String(value.protocol) : ''))) clears.snapshot++
      return realMapClear.call(this)
    }
    crypto.subtle.digest = async function (...args: Parameters<SubtleCrypto['digest']>) {
      activeHashes++
      try {
        const value = digestPayload(args[1])
        if (!held && value && match(value)) { held = true; await new Promise<void>(resolve => { heldHash.release = resolve }) }
        return await Reflect.apply(realDigest, crypto.subtle, args)
      } finally { activeHashes-- }
    }
    try {
      const observed = observe(action(repo, expectedSnapshot, countedGuard))
      await until(() => held); const priorPublication = publicationChecks
      time.advance(9999); await tick(); assert.equal(observed.get(), null)
      time.advance(10000); await until(() => observed.get() !== null)
      assert.equal(observed.get()?.error?.code, 'deadline_exceeded')
      if (initialRows.size) assert.ok(clears.raw > 0, 'raw capture must clear before held digest resolves')
      if (requireSnapshotCleanup) assert.ok(clears.snapshot > 0, 'current snapshot maps must clear before held digest resolves')
      assert.deepEqual([...memory.rows], baseline); assert.equal(memory.observe().successfulCas, 0)
      heldHash.release!(); await until(() => activeHashes === 0); await tick(); assert.equal(activeHashes, 0)
      assert.deepEqual([...memory.rows], baseline); assert.equal(memory.observe().successfulCas, 0); assert.equal(publicationChecks, priorPublication)
      assert.equal(time.count(), 0)
      results.push({ name, status: 'pass', timeoutCode: observed.get()?.error?.code, rawCaptureClearedBeforeRelease: clears.raw > 0, snapshotMapsClearedBeforeRelease: clears.snapshot > 0, lateWrites: 0, latePublicationChecks: 0 })
    } finally { crypto.subtle.digest = realDigest; Map.prototype.clear = realMapClear; time.restore(); heldHash.release?.(); await until(() => activeHashes === 0); await tick() }
  }
  const retainedCheckpoint = (value: DigestPayload) => value.domain === 'creative-pilot-checkpoint-v4' && value.value.operationId === 'r:retain'
  await hashCase('read', retainedRows, retained, retainedCheckpoint, repo => repo.read(command.campaignId), true)
  await hashCase('getReceipt', retainedRows, retained, retainedCheckpoint, repo => repo.getReceipt(command.campaignId, 'r:retain'), true)
  await hashCase('create', new Map(), null, value => value.domain === 'creative-pilot-manifest-v4', (repo, _s, g) => repo.create(command, g), false)
  await hashCase('commit_resolve_late_hash', retainedRows, retained, value => value.domain === 'creative-pilot-checkpoint-v4' && value.value.operationId === 'r:resolve', (repo, s, g) => repo.commit(s!, { kind: 'resolve', operationId: 'r:resolve', recovery: false, requestHash: request.hash, disposition: 'publish_if_valid' }, g), true)
  await hashCase('replaceBrief_late_hash', creationRows, creation, value => value.domain === 'creative-pilot-candidate-v1' && value.value.revision === 1, (repo, s, g) => repo.replaceBrief(s!, { operationId: 'replace', brief: { ...command.brief, premise: 'A different letter.' } }, g), false)
  async function ioCase(name: string, mode: 'read' | 'cas', at: number, expectedCode: string, committedBeforeTimeout: boolean) {
    const time = virtualTime(), memory = createCreativeMemoryIO(creationRows), baseline = [...memory.rows]
    let entered = false
    const heldIo: { release: (() => void) | null; permit: (() => boolean) | null } = { release: null, permit: null }
    const io: CampaignRepositoryIO = {
      getMany: async keys => { if (mode === 'read') { entered = true; await new Promise<void>(resolve => { heldIo.release = resolve }) }; return memory.io.getMany(keys) },
      compareAndSwapMany: async (entries, permit) => { entered = true; heldIo.permit = permit ?? null; if (committedBeforeTimeout) { const result = await memory.io.compareAndSwapMany(entries, permit); await new Promise<void>(resolve => { heldIo.release = resolve }); return result }; await new Promise<void>(resolve => { heldIo.release = resolve }); return memory.io.compareAndSwapMany(entries, permit) },
    }
    if (at === 10000) crypto.subtle.digest = async function (...args: Parameters<SubtleCrypto['digest']>) { const value = digestPayload(args[1]); if (value?.domain === 'creative-pilot-checkpoint-v4' && value.value.operationId === 'cancel') time.set(9000); return Reflect.apply(realDigest, crypto.subtle, args) }
    try {
      const repo = createCreativePilotRepository({ io, clock: () => wall, monotonic: time.now })
      const observed = observe(mode === 'read' ? repo.read(command.campaignId) : repo.commit(creation, { kind: 'cancel', operationId: 'cancel', recovery: false }, guard))
      await until(() => entered && heldIo.release !== null)
      time.advance(at - 1); await tick(); assert.equal(observed.get(), null)
      time.advance(at); await until(() => observed.get() !== null); assert.equal(observed.get()?.error?.code, expectedCode)
      if (heldIo.permit) assert.equal(heldIo.permit(), false)
      assert.equal(memory.observe().successfulCas, committedBeforeTimeout ? 1 : 0)
      heldIo.release!(); await tick(); await tick(); await tick()
      assert.equal(memory.observe().successfulCas, committedBeforeTimeout ? 1 : 0)
      if (!committedBeforeTimeout) assert.deepEqual([...memory.rows], baseline)
      assert.equal(time.count(), 0)
      crypto.subtle.digest = realDigest; time.restore()
      const verified = await createCreativePilotRepository({ io: memory.io, clock: () => wall }).read(command.campaignId)
      assert.equal(verified?.checkpoint.status, committedBeforeTimeout ? 'cancelled' : 'prepared')
      assert.equal(memory.observe().accountingMismatches, 0)
      results.push({ name, status: 'pass', timeoutCode: expectedCode, successfulCas: memory.observe().successfulCas, latePermit: false, lateAdditionalWrites: 0 })
    } finally { crypto.subtle.digest = realDigest; time.restore(); heldIo.release?.(); await tick() }
  }
  await ioCase('actual_read_3000', 'read', 3000, 'operation_timeout', false)
  await ioCase('actual_cas_3000', 'cas', 3000, 'storage_unknown', false)
  await ioCase('outer_10000_pending_cas', 'cas', 10000, 'storage_unknown', false)
  await ioCase('outer_10000_committed_lost_ack', 'cas', 10000, 'storage_unknown', true)
  return { scope: 'focused_virtual_time_not_performance', status: 'pass', sdkCalls: 0, cases: results.length, results }
}
