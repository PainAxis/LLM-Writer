/** CI-only native-IDB proof boundaries. No memory IO, clock replacement, durable
 * proof records, network/model adapters, or application imports of this driver.
 * Every injected repository/IO wrapper delegates to the real production path. */
import type { CampaignActionProofStats, CampaignActionScope, CampaignCheckpoint, CampaignHead, CampaignMutation, CampaignRepository, CampaignRepositoryIO, CampaignSnapshot, CampaignState } from '../../src/types/writerCampaign'
import { idbCompareAndSwapMany, idbGetMany } from '../../src/services/blobStore'
import { getCampaignBuildIdentity } from '../../src/services/writerCampaign/buildIdentity'
import { emptyCampaignBudget, reserveCampaignBudget } from '../../src/services/writerCampaign/budget'
import { createOfflineCampaignEngine, type OfflineCampaignEngine } from '../../src/services/writerCampaign/engine'
import { CampaignProtocolError, canonicalStringify, decodeStorageBytes, hashText, parseCampaignRecord, validateCampaignCheckpoint, validateCampaignHead } from '../../src/services/writerCampaign/protocol'
import { campaignKeys, createCampaignRepository } from '../../src/services/writerCampaign/store'
import type { StorageObservation } from './writer-campaign-capacity-profile'

export const ACTION_PROOF_BOUNDARIES = Object.freeze(['P01', 'P02', 'P03', 'P04', 'P05', 'P06'] as const)
type ProofCase = typeof ACTION_PROOF_BOUNDARIES[number]
type FaultSelector = 'none' | 'settled_origin' | 'historical_checkpoint' | 'retained_response'
type RestartOutcome = 'readable' | 'integrity_refused'
export interface ActionProofRestartExpected {
  checkpointHash: string
  outcome: RestartOutcome
  faultSelector: FaultSelector
  faultHash: string | null
}
export interface ActionProofBoundaryReport {
  id: ProofCase
  status: 'pass'
  failureStage: null
  faultTriggered: 1
  proofObserved: 1
  fixtureDispatchEntries: number
  committedTransactions: number
  cumulativeWrittenBytes: number
  outstandingBytes: number
  releasedBytes: number
  accountingMismatches: number
  coldReplayCount: number
  exactObservationCount: number
  exactObservedRecords: number
  proofInvalidations: number
  coldFallbacks: number
  restartOutcome: 'not_run' | RestartOutcome
  coldProcessReadMs: number
  coldProcessReadBytes: number
  coldProcessReadCalls: number
}
const verify: (condition: unknown) => asserts condition = condition => { if (!condition) throw new Error('action_proof_boundary_failed') }
const meter = () => (globalThis as unknown as { __campaignStorageMeter: { snapshot(): StorageObservation } }).__campaignStorageMeter.snapshot()
const phase = (value: string) => { (globalThis as unknown as { __campaignStorageStage: string }).__campaignStorageStage = value }
const same = (left: unknown, right: unknown) => canonicalStringify(left) === canonicalStringify(right)
const stats = (repository: CampaignRepository): CampaignActionProofStats => { verify(repository.getActionProofStats); return repository.getActionProofStats() }
const invalidations = (value: CampaignActionProofStats) => Object.entries(value.disposalReasons).reduce((total, [reason, count]) => total + (reason === 'completed' ? 0 : count), 0)
const operation = (entries: Parameters<CampaignRepositoryIO['compareAndSwapMany']>[0]) => {
  const receipt = entries.find(entry => entry.key.includes(':receipt:'))
  return receipt ? (JSON.parse(receipt.value) as { kind: CampaignMutation['kind'] }).kind : null
}
async function read(repository: CampaignRepository, id: string, scope?: CampaignActionScope) {
  const snapshot = await repository.read(id, scope); verify(snapshot); return snapshot
}
/** Evidence classification, not merely promise rejection: an unrelated runtime,
 * IO, or unknown-ack failure must never be reported as integrity refusal. */
export async function requireCampaignIntegrityRefusal(operation: () => Promise<unknown>) {
  let rejected = false
  try { await operation() } catch (error) {
    verify(error instanceof CampaignProtocolError && error.code === 'integrity')
    rejected = true
  }
  verify(rejected)
}
function totals(checkpoint: CampaignCheckpoint) {
  const storage = checkpoint.storage
  const result = { written: decodeStorageBytes(storage.writtenBytes), outstanding: decodeStorageBytes(storage.outstandingBytes), released: decodeStorageBytes(storage.releasedBytes) }
  verify(decodeStorageBytes(storage.allocatedBytes) - decodeStorageBytes(storage.allocationConsumedBytes) - result.released === result.outstanding)
  verify(storage.openAllocations.reduce((total, allocation) => total + decodeStorageBytes(allocation.remainingBytes), 0) === result.outstanding)
  verify(result.written + result.outstanding + decodeStorageBytes(storage.recoveryRemainingBytes) <= 67_108_864)
  return result
}
/** This is only a raw restart fence, not a substitute for a full repository read.
 * Corrupt historical bytes intentionally make the latter refuse. */
async function durableHead(id: string): Promise<{ head: CampaignHead; checkpoint: CampaignCheckpoint; rawHead: string }> {
  const headKey = campaignKeys.head(id), rawHead = (await idbGetMany([headKey])).get(headKey)
  verify(typeof rawHead === 'string')
  const head = validateCampaignHead(parseCampaignRecord(rawHead)), key = campaignKeys.checkpoint(id, head.sequence)
  const checkpoint = await validateCampaignCheckpoint(parseCampaignRecord((await idbGetMany([key])).get(key) ?? null))
  verify(head.campaignId === id && checkpoint.campaignId === id && checkpoint.hash === head.checkpointHash)
  return { head, checkpoint, rawHead }
}
function faultKey(id: string, selector: FaultSelector, checkpoint: CampaignCheckpoint): string {
  if (selector === 'historical_checkpoint') return campaignKeys.checkpoint(id, 1)
  const request = checkpoint.tasks[0]?.request
  verify(request && (selector === 'settled_origin' || selector === 'retained_response'))
  return campaignKeys.request(id, request.id, selector === 'settled_origin' ? 0 : request.revision)
}
/** A deliberately out-of-repository writer uses a native transaction. Marking
 * it as oracle traffic excludes the attack itself from legitimate write-charge
 * observations; the changed bytes are still read through real blobStore IO. */
async function corruptNative(key: string, expected: string, replacement: string) {
  verify(replacement !== expected)
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('llm-writer')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('action_proof_fault_open_failed'))
    request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error('action_proof_fault_database_missing')) }
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite') as IDBTransaction & { __campaignOracle?: boolean }
      tx.__campaignOracle = true
      let matched = false
      tx.oncomplete = () => matched ? resolve() : reject(new Error('action_proof_fault_compare_failed'))
      tx.onabort = tx.onerror = () => reject(new Error('action_proof_fault_write_failed'))
      const store = tx.objectStore('kv'), request = store.get(key)
      request.onsuccess = () => {
        if (request.result !== expected) return
        matched = true; store.put(replacement, key)
      }
    })
  } finally { db.close() }
  verify((await idbGetMany([key])).get(key) === replacement)
}
function controlMutation(snapshot: CampaignSnapshot, kind: 'pause' | 'resume' | 'cancel', operationId: string): CampaignMutation {
  const checkpoint = snapshot.checkpoint
  const next: CampaignState = { status: kind === 'pause' ? 'paused' : kind === 'cancel' ? 'cancelled' : 'running', reason: kind === 'pause' ? 'user_paused' : kind === 'cancel' ? 'user_cancelled' : null,
    executionEpoch: checkpoint.executionEpoch + 1, candidateId: checkpoint.candidateId, tasks: structuredClone(checkpoint.tasks), budget: { ...checkpoint.budget }, storage: structuredClone(checkpoint.storage), lastWallTime: Math.max(Date.now(), checkpoint.lastWallTime) }
  const delta = emptyCampaignBudget(); delta.activeMs = 10_000
  next.budget = reserveCampaignBudget(snapshot.manifest, next.budget, delta, kind !== 'resume')
  return { kind, operationId, next }
}
/** Preserve only expected identity/raw-head fencing; poison every other public
 * object family, including Maps that Object.freeze alone would not protect. */
function poison(snapshot: CampaignSnapshot) {
  snapshot.manifest.language = snapshot.manifest.language === 'en' ? 'zh' : 'en'
  snapshot.manifest.budget.attempts = 0; snapshot.manifest.tasks[0]!.dependsOn.push('poison')
  snapshot.head.status = 'completed'; snapshot.head.sequence = 0
  snapshot.checkpoint.status = 'completed'; snapshot.checkpoint.budget.attempts = 0
  snapshot.checkpoint.storage.openAllocations.length = 0
  snapshot.checkpoint.tasks[0]!.status = 'pending'
  snapshot.receipt.kind = 'cancel'; snapshot.receipt.artifactHashes.length = 0
  for (const artifact of snapshot.artifacts.values()) { artifact.text = 'poison'; artifact.dependencies.length = 0; artifact.raw.scalars = 0; artifact.canonical.utf8Bytes = 0 }
  for (const request of snapshot.requests.values()) { request.preparedInput = 'poison'; if (request.response) request.response.text = 'poison' }
  snapshot.artifacts.clear(); snapshot.requests.clear()
}

export async function runActionProofBoundary(caseId: string): Promise<{ report: ActionProofBoundaryReport; restartExpected: ActionProofRestartExpected }> {
  verify(ACTION_PROOF_BOUNDARIES.includes(caseId as ProofCase))
  const id = `proof-${caseId}`, identity = getCampaignBuildIdentity(), engines: OfflineCampaignEngine[] = [], repositories: CampaignRepository[] = []
  let calls = 0, fired = false, proofObserved = false, armed = false, exactBeforeAction = 0, recordsBeforeAction = 0
  let selector: FaultSelector = 'none', corruptKey: string | null = null, corruptRaw: string | null = null, corruptHash: string | null = null
  let faultHead: string | null = null, faultWrites = 0, reobserved = false
  let beforeCommit: ((expected: CampaignSnapshot, mutation: CampaignMutation) => Promise<void>) | undefined
  let afterCAS: ((entries: Parameters<CampaignRepositoryIO['compareAndSwapMany']>[0]) => Promise<void>) | undefined
  const io: CampaignRepositoryIO = {
    async getMany(keys) {
      const proving = stats(repository).retainedEntries > 0
      const values = await idbGetMany(keys)
      if (corruptKey && keys.includes(corruptKey) && proving && values.get(corruptKey) === corruptRaw) reobserved = true
      return values
    },
    async compareAndSwapMany(entries, canCommit) {
      const committed = await idbCompareAndSwapMany(entries, canCommit)
      if (committed) await afterCAS?.(entries)
      return committed
    },
  }
  const repository = createCampaignRepository(io); repositories.push(repository)
  const proxy: CampaignRepository = { ...repository, async commit(expected, mutation, canCommit, scope) {
    await beforeCommit?.(expected, mutation)
    return repository.commit(expected, mutation, canCommit, scope)
  } }
  const make = (repo: CampaignRepository = proxy) => {
    const engine = createOfflineCampaignEngine({ identity, repository: repo, fixture: { onDispatch: () => { calls++ } } })
    engines.push(engine); return engine
  }
  const fresh = () => { const repo = createCampaignRepository(); repositories.push(repo); return repo }
  const assertProving = () => { const value = stats(repository); verify(value.retainedEntries > 0 && value.exactPasses > exactBeforeAction && value.exactRecords > recordsBeforeAction); proofObserved = true }
  const inject = async (kind: Exclude<FaultSelector, 'none'>) => {
    assertProving(); verify(!fired); selector = kind
    const current = await durableHead(id), key = faultKey(id, kind, current.checkpoint), raw = (await idbGetMany([key])).get(key)
    verify(typeof raw === 'string')
    let replacement: string
    if (kind === 'settled_origin') replacement = `${raw} `
    else if (kind === 'historical_checkpoint') {
      const value = JSON.parse(raw) as { hash: string }; value.hash = `${value.hash[0] === '0' ? '1' : '0'}${value.hash.slice(1)}`; replacement = canonicalStringify(value)
    } else {
      const value = JSON.parse(raw) as { response: { text: string } }; verify(value.response.text.length > 0)
      value.response.text = `${value.response.text[0] === 'X' ? 'Y' : 'X'}${value.response.text.slice(1)}`; replacement = canonicalStringify(value)
    }
    await corruptNative(key, raw, replacement)
    corruptKey = key; corruptRaw = replacement; corruptHash = await hashText(replacement)
    faultHead = current.rawHead; faultWrites = meter().committedTransactions; fired = true
  }
  phase('prepare')
  try {
    const engine = make(); await engine.prepare({ campaignId: id, language: 'en' })
    if (caseId === 'P01' || caseId === 'P02' || caseId === 'P04' || caseId === 'P06') await engine.step(id, 'seed')
    const dispatchesBefore = calls
    exactBeforeAction = stats(repository).exactPasses; recordsBeforeAction = stats(repository).exactRecords
    phase('exercise'); armed = true
    if (caseId === 'P01') {
      const seed = await read(fresh(), id), request = seed.checkpoint.tasks[0]!.request
      verify(request && request.revision > 0 && seed.checkpoint.tasks[0]!.status === 'committed' && seed.checkpoint.storage.openAllocations.length === 0)
      verify(![...seed.requests.values()].some(value => value.id === request.id && value.revision === 0))
      afterCAS = async entries => { if (armed && !fired && operation(entries) === 'reserve') await inject('settled_origin') }
      await requireCampaignIntegrityRefusal(() => engine.step(id, 'exercise'))
      verify(calls === dispatchesBefore)
    } else if (caseId === 'P02') {
      beforeCommit = async (_expected, mutation) => {
        if (armed && !fired && mutation.kind === 'retain_response') { verify(mutation.requests?.[0]?.response && calls === dispatchesBefore + 1); await inject('historical_checkpoint') }
      }
      await requireCampaignIntegrityRefusal(() => engine.step(id, 'exercise'))
      verify(calls === dispatchesBefore + 1)
    } else if (caseId === 'P03') {
      afterCAS = async entries => { if (armed && !fired && operation(entries) === 'retain_response') await inject('retained_response') }
      await requireCampaignIntegrityRefusal(() => engine.step(id, 'exercise'))
      verify(calls === 1)
    } else if (caseId === 'P04') {
      let fencedHead: string | null = null, writes = 0
      beforeCommit = async (expected, mutation) => {
        if (!armed || fired || mutation.kind !== 'accept_artifact') return
        assertProving(); fired = true
        verify(expected.checkpoint.tasks[1]!.status === 'response_retained')
        const other = make(fresh()), priorStorage = structuredClone(expected.checkpoint.storage)
        const replaced = await other.replaceCandidate(id, 'outline', 'Controlled replacement outline.', 'replace-fence')
        verify(replaced.checkpoint.candidateId !== expected.checkpoint.candidateId)
        verify(same(replaced.checkpoint.storage.openAllocations, priorStorage.openAllocations))
        const cancelled = await other.cancel(id, 'cancel-fence')
        verify(cancelled.head.status === 'cancelled' && same(cancelled.checkpoint.storage.openAllocations, priorStorage.openAllocations))
        verify(cancelled.checkpoint.storage.releasedBytes === priorStorage.releasedBytes)
        fencedHead = cancelled.rawHead; writes = meter().committedTransactions
      }
      const result = await engine.step(id, 'exercise')
      verify(fired && result.rawHead === fencedHead && meter().committedTransactions === writes && calls === dispatchesBefore + 1)
      verify(await repository.getReceipt(id, 'exercise:artifact') === null && stats(repository).disposalReasons.conflict > 0)
    } else if (caseId === 'P05') {
      let coldAtFault = 0, committedAtFault = 0
      afterCAS = async entries => {
        if (!armed || fired || operation(entries) !== 'accept_artifact') return
        assertProving(); fired = true; coldAtFault = stats(repository).coldReplays; committedAtFault = meter().committedTransactions
        // A positively completed native transaction, but no positive repository ACK.
        throw new Error('controlled_action_proof_ack_lost')
      }
      const recovered = await engine.step(id, 'exercise')
      verify(fired && recovered.checkpoint.tasks[0]!.status === 'committed' && calls === 1)
      verify(stats(repository).coldReplays > coldAtFault && stats(repository).retainedBytes === 0 && invalidations(stats(repository)) > 0)
      verify(meter().committedTransactions === committedAtFault && totals(recovered.checkpoint).outstanding === 0)
      const accepted = await fresh().getReceipt(id, 'exercise:artifact'); verify(accepted?.kind === 'accept_artifact')
      const writes = meter().committedTransactions, released = recovered.checkpoint.storage.releasedBytes
      const replayed = await make(fresh()).step(id, 'exercise')
      verify(replayed.rawHead === recovered.rawHead && calls === 1 && meter().committedTransactions === writes && replayed.checkpoint.storage.releasedBytes === released)
    } else {
      verify(caseId === 'P06' && repository.createActionScope && repository.disposeActionScope)
      const scope = repository.createActionScope(id), scopes = [scope]
      try {
        let snapshot = await read(repository, id, scope), expected = structuredClone(snapshot)
        verify(snapshot.artifacts.size > 0 && snapshot.requests.size > 0)
        let mutation = controlMutation(snapshot, 'pause', 'private-snapshot'), count = stats(repository).exactPasses
        poison(snapshot); fired = true
        const paused = await repository.commit(snapshot, mutation, undefined, scope)
        verify(stats(repository).exactPasses === count + 1 && same(paused.snapshot.manifest, expected.manifest))
        verify(same([...paused.snapshot.artifacts], [...expected.artifacts]) && same([...paused.snapshot.requests], [...expected.requests]))
        snapshot = paused.snapshot; expected = structuredClone(snapshot); mutation = controlMutation(snapshot, 'resume', 'private-result'); count = stats(repository).exactPasses
        poison(snapshot)
        const resumed = await repository.commit(snapshot, mutation, undefined, scope)
        verify(stats(repository).exactPasses === count + 1 && same(resumed.snapshot.manifest, expected.manifest))
        verify(same([...resumed.snapshot.artifacts], [...expected.artifacts]) && same([...resumed.snapshot.requests], [...expected.requests]))
        assertProving()
        // A foreign repository cannot use another instance's token as authority.
        const other = fresh(), foreignBefore = stats(other), foreign = await read(other, id, scope), foreignAfter = stats(other)
        verify(foreign.rawHead === resumed.snapshot.rawHead && foreignAfter.coldReplays === foreignBefore.coldReplays + 1 && foreignAfter.exactPasses === 0 && foreignAfter.admittedScopes === 0)
        // The admitted scope remains live. Another scope must actually cold-read
        // and cold-commit, rather than silently sharing or replacing its proof.
        const rejected = repository.createActionScope(id); scopes.push(rejected)
        const before = stats(repository), cold = await read(repository, id, rejected)
        const result = await repository.commit(cold, controlMutation(cold, 'cancel', 'cold-fallback'), undefined, rejected), after = stats(repository)
        verify(result.snapshot.head.status === 'cancelled' && after.coldReplays >= before.coldReplays + 2 && after.exactPasses === before.exactPasses)
        verify(after.fallbackScopes > before.fallbackScopes && after.disposalReasons.admission > before.disposalReasons.admission && calls === dispatchesBefore)
      } finally { scopes.forEach(scope => repository.disposeActionScope!(scope)) }
    }
    armed = false; beforeCommit = undefined; afterCAS = undefined
    verify(fired && proofObserved)
    if (selector !== 'none') {
      verify(reobserved && corruptKey && corruptRaw && faultHead)
      verify((await idbGetMany([corruptKey])).get(corruptKey) === corruptRaw && (await durableHead(id)).rawHead === faultHead)
      verify(meter().committedTransactions === faultWrites)
      const before = calls
      await requireCampaignIntegrityRefusal(() => make(fresh()).step(id, 'exercise'))
      verify(calls === before && meter().committedTransactions === faultWrites)
      verify(await repository.getReceipt(id, 'exercise:artifact') === null)
    }
    engines.forEach(engine => engine.dispose())
    phase('accounting')
    const current = await durableHead(id), storage = totals(current.checkpoint), measured = meter(), observations = repositories.map(stats)
    verify(storage.written === measured.cumulativeWrittenBytes && measured.accountingMismatches === 0)
    verify(observations.every(value => value.retainedEntries === 0 && value.retainedBytes === 0 && value.activeRecords === 0))
    const sum = (key: 'coldReplays' | 'exactPasses' | 'exactRecords' | 'fallbackScopes') => observations.reduce((total, value) => total + value[key], 0)
    const proofInvalidations = observations.reduce((total, value) => total + invalidations(value), 0)
    verify(proofInvalidations > 0 && sum('coldReplays') > 0 && sum('exactPasses') > 0 && sum('exactRecords') > 0)
    phase('complete')
    return { restartExpected: { checkpointHash: current.head.checkpointHash, outcome: selector === 'none' ? 'readable' : 'integrity_refused', faultSelector: selector, faultHash: corruptHash },
      report: { id: caseId as ProofCase, status: 'pass', failureStage: null, faultTriggered: 1, proofObserved: 1, fixtureDispatchEntries: calls, committedTransactions: measured.committedTransactions,
        cumulativeWrittenBytes: storage.written, outstandingBytes: storage.outstanding, releasedBytes: storage.released, accountingMismatches: measured.accountingMismatches,
        coldReplayCount: sum('coldReplays'), exactObservationCount: sum('exactPasses'), exactObservedRecords: sum('exactRecords'), proofInvalidations, coldFallbacks: sum('fallbackScopes'),
        restartOutcome: 'not_run', coldProcessReadMs: 0, coldProcessReadBytes: 0, coldProcessReadCalls: 0 } }
  } finally { engines.forEach(engine => engine.dispose()) }
}

/** Called only in a newly launched persistent browser context. No raw snapshot,
 * key, request, response, or scope crosses the process-restart boundary. */
export async function inspectActionProofAfterRestart(caseId: string, report: ActionProofBoundaryReport, expected: ActionProofRestartExpected) {
  verify(ACTION_PROOF_BOUNDARIES.includes(caseId as ProofCase) && report.id === caseId && /^[a-f0-9]{64}$/.test(expected.checkpointHash))
  const id = `proof-${caseId}`, started = performance.now(), repository = createCampaignRepository(), before = meter()
  verify(before.committedTransactions === 0 && stats(repository).retainedBytes === 0 && stats(repository).exactPasses === 0)
  phase('restart')
  const current = await durableHead(id), storage = totals(current.checkpoint)
  verify(current.head.checkpointHash === expected.checkpointHash)
  verify(storage.written === report.cumulativeWrittenBytes && storage.outstanding === report.outstandingBytes && storage.released === report.releasedBytes)
  if (expected.outcome === 'integrity_refused') {
    verify(expected.faultSelector !== 'none' && expected.faultHash && /^[a-f0-9]{64}$/.test(expected.faultHash))
    const key = faultKey(id, expected.faultSelector, current.checkpoint), raw = (await idbGetMany([key])).get(key)
    verify(typeof raw === 'string' && await hashText(raw) === expected.faultHash)
    await requireCampaignIntegrityRefusal(() => repository.read(id))
    verify((await idbGetMany([key])).get(key) === raw && (await durableHead(id)).rawHead === current.rawHead)
  } else {
    verify(expected.outcome === 'readable' && expected.faultSelector === 'none' && expected.faultHash === null)
    const snapshot = await read(repository, id); verify(snapshot.rawHead === current.rawHead)
    if (caseId === 'P05') {
      const receipt = await repository.getReceipt(id, 'exercise:artifact')
      verify(receipt?.kind === 'accept_artifact' && snapshot.checkpoint.tasks[0]!.status === 'committed' && storage.outstanding === 0)
      let dispatches = 0
      const engine = createOfflineCampaignEngine({ identity: getCampaignBuildIdentity(), repository, fixture: { onDispatch: () => { dispatches++ } } })
      try { verify((await engine.step(id, 'exercise')).rawHead === current.rawHead && dispatches === 0) }
      finally { engine.dispose() }
    } else verify(snapshot.head.status === 'cancelled')
  }
  const observed = meter(), proof = stats(repository)
  verify(observed.committedTransactions === 0 && proof.coldReplays > 0 && proof.exactPasses === 0 && proof.retainedBytes === 0)
  return { restartOutcome: expected.outcome, coldProcessReadMs: Math.round(performance.now() - started), coldProcessReadBytes: observed.totalReadBytes, coldProcessReadCalls: observed.totalReadCalls }
}
