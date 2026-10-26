/** One explicit, durable, source-bound invocation. No restored record grants transport authority. */
import type {
  BodyProducerAdapter, BodyProducerEngine, BodyProducerExecutionStats, BodyProducerIdentity, BodyProducerRequest, BodyProducerVerificationEvent,
  BodyProducerSelection, PreparedBodyProducerHandle, ProducerActionScope, ProducerCampaignRepository, ProducerCampaignSnapshot, ProducerVerificationContext, ProducerVerificationProgress,
} from '../../types/bodyProducer'
import { createProducerCampaignRepository, sealProducerRequest, sealProducerResponse, sealProducerReview } from './producerStore'
import { compileProducedBodyEvidence, prepareBodyProducerInput } from './bodyProducerEvidence'
import { getCampaignBuildIdentity } from './buildIdentity'
import { CAMPAIGN_BUDGET_KEYS, canonicalStringify, decodeStorageBytes, emptyCampaignBudget, hashText, utf8Bytes } from './protocol'
import { producerFuturePhases, producerMetadataBound, producerStorageAllowance } from './producerStorage'

export class BodyProducerEngineError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'BodyProducerEngineError' }
}
export interface BodyProducerEngineOptions {
  repository?: ProducerCampaignRepository
  identity?: { runtimeIdentity: string; source: { commit: string | null; tree: string | null } }
  adapters?: readonly BodyProducerAdapter[]
  clock?: () => number
}
const UNCONFIGURED: Readonly<BodyProducerIdentity> = Object.freeze({ adapterId: 'bounded-sdk-v1', adapterVersion: 'body-producer-sdk-v1',
  mode: 'offline_control', requestedModelId: 'unconfigured', effectiveModelId: 'unconfigured', configurationRevision: 'unconfigured', endpointIdentity: 'not-configured' })
export function bodyProducerReservation(input: { inputBytes: number; inputUtf16: number }) {
  return { ...emptyCampaignBudget(), attempts: 1, inputBytes: input.inputBytes, inputUtf16: input.inputUtf16, outputTokens: 1_200, responseBytes: 65_536, activeMs: 60_000 }
}
const operation = () => `producer-${crypto.randomUUID()}`
const equal = (a: unknown, b: unknown) => canonicalStringify(a) === canonicalStringify(b)
const errorCode = (error: unknown): string => {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  return /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : 'producer_failed'
}
interface Owner {
  id: number; campaignId: string; controller: AbortController; started: number; limit: number
  scope?: ProducerActionScope; deadlines: Set<{ at: number }>; verificationUsed: boolean
  finished: boolean; deadlineRecorded: boolean; outcome: 'running' | 'completed' | 'refused' | 'cancelled' | 'expired'
}
interface PreparedPrivate {
  handle: PreparedBodyProducerHandle; selection: BodyProducerSelection; adapter: BodyProducerAdapter | null
  operationId: string | null; requestId: string; promise: Promise<ProducerCampaignSnapshot> | null; invoked: boolean; failureCode: string | null; generation: number
}
export function createBodyProducerEngine(options: BodyProducerEngineOptions = {}): BodyProducerEngine {
  const clock = options.clock ?? Date.now
  const repository = options.repository ?? createProducerCampaignRepository({ clock })
  const identity = options.identity ?? getCampaignBuildIdentity()
  const adapters = new Map<string, BodyProducerAdapter>()
  for (const adapter of options.adapters ?? []) {
    if (adapter.identity.mode !== 'offline_control' || adapters.has(adapter.identity.adapterId)) throw new BodyProducerEngineError('invalid_adapter')
    adapters.set(adapter.identity.adapterId, adapter)
  }
  const prepared = new WeakMap<PreparedBodyProducerHandle, PreparedPrivate>()
  const owners = new Map<string, Owner>()
  const cancellations = new Map<string, Promise<ProducerCampaignSnapshot>>()
  const generations = new Map<string, number>()
  const verificationListeners = new Set<(event: BodyProducerVerificationEvent) => void>()
  const sessionCapable = Boolean(repository.verifyCurrent && repository.adoptVerified && repository.createActionScope && repository.disposeActionScope)
  let ownerSequence = 0
  const execution: BodyProducerExecutionStats = {
    protocol: 'producer-execution-owner-v1', metadataOwnersStarted: 0, invocationOwnersStarted: 0,
    ownersCompleted: 0, ownersRefused: 0, ownersCancelled: 0, ownersExpired: 0,
    activeOwners: 0, peakActiveOwners: 0, maxMetadataOwnerMs: 0, maxInvocationOwnerMs: 0,
    deadlineRefusals: 0, lateResultRefusals: 0,
  }
  const increment = (key: keyof Omit<BodyProducerExecutionStats, 'protocol'>) => { execution[key] = Math.min(Number.MAX_SAFE_INTEGER, execution[key] + 1) }
  const deadlineFailure = (owner: Owner) => {
    if (!owner.deadlineRecorded) { owner.deadlineRecorded = true; increment('deadlineRefusals') }
    owner.outcome = 'expired'
    return new BodyProducerEngineError('deadline_exceeded')
  }
  const emitVerification = (owner: Owner, status: BodyProducerVerificationEvent['status'], progress: ProducerVerificationProgress | null) => {
    const event: BodyProducerVerificationEvent = Object.freeze({ ownerId: owner.id, campaignId: owner.campaignId, status,
      progress: progress ? Object.freeze({ ...progress }) : null })
    // Presentation listeners have no authority and cannot replace the operation
    // outcome. Synchronous cancellation is checked by the caller after emission.
    for (const listener of [...verificationListeners]) { try { listener(event) } catch { /* Isolate presentation failures. */ } }
  }
  const detachedProgress = (value: ProducerVerificationProgress): ProducerVerificationProgress => {
    const keys = ['purpose', 'stage', 'verifiedOperations', 'verifiedRecords', 'capturedBytes', 'capturedEntries', 'totalOperations']
    if (!value || typeof value !== 'object' || Reflect.ownKeys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) throw new BodyProducerEngineError('verification_progress_invalid')
    // Read each primitive exactly once; accessor changes and symbol properties
    // cannot cross the closed, source-free presentation boundary.
    const result = { purpose: value.purpose, stage: value.stage, verifiedOperations: value.verifiedOperations,
      verifiedRecords: value.verifiedRecords, capturedBytes: value.capturedBytes, capturedEntries: value.capturedEntries, totalOperations: value.totalOperations }
    if (!['adoption_v2', 'current_v3'].includes(result.purpose) || !['discovery', 'origin_replay', 'tail_replay', 'final_fence'].includes(result.stage)) throw new BodyProducerEngineError('verification_progress_invalid')
    for (const [key, cap] of [['verifiedOperations', 2048], ['verifiedRecords', 8193], ['capturedBytes', 67_108_864], ['capturedEntries', 8193]] as const) {
      if (!Number.isSafeInteger(result[key]) || result[key] < 0 || result[key] > cap) throw new BodyProducerEngineError('verification_progress_invalid')
    }
    if (result.totalOperations !== null && (!Number.isSafeInteger(result.totalOperations) || result.totalOperations < 0 || result.totalOperations > 2048)) throw new BodyProducerEngineError('verification_progress_invalid')
    return Object.freeze(result)
  }
  const disposeScope = (owner: Owner) => {
    const scope = owner.scope
    if (!scope) return
    owner.scope = undefined // Revoke locally before an injected cleanup callback.
    try { repository.disposeActionScope?.(scope) } catch { /* Optional proof cleanup cannot change a durable outcome. */ }
  }
  const stopped = (owner: Owner) => owner.controller.signal.reason instanceof BodyProducerEngineError
    ? owner.controller.signal.reason : new BodyProducerEngineError('cancelled')
  const check = (owner: Owner) => {
    if (owner.controller.signal.aborted || owners.get(owner.campaignId) !== owner) throw stopped(owner)
    const now = performance.now()
    let expired = now >= owner.started + owner.limit
    for (const deadline of owner.deadlines) if (now >= deadline.at) expired = true
    if (expired) {
      const failure = deadlineFailure(owner)
      owner.controller.abort(failure); throw failure
    }
  }
  const begin = (campaignId: string, limit = 10_000): Owner => {
    if (owners.has(campaignId)) throw new BodyProducerEngineError('operation_in_progress')
    if (ownerSequence >= Number.MAX_SAFE_INTEGER) throw new BodyProducerEngineError('operation_in_progress')
    const owner: Owner = { id: ++ownerSequence, campaignId, controller: new AbortController(), started: performance.now(), limit,
      deadlines: new Set(), verificationUsed: false, finished: false, deadlineRecorded: false, outcome: 'running' }
    increment(limit === 60_000 ? 'invocationOwnersStarted' : 'metadataOwnersStarted')
    increment('activeOwners'); execution.peakActiveOwners = Math.max(execution.peakActiveOwners, execution.activeOwners)
    owners.set(campaignId, owner)
    owner.controller.signal.addEventListener('abort', () => disposeScope(owner), { once: true })
    if (repository.createActionScope && repository.disposeActionScope) {
      try { owner.scope = repository.createActionScope(campaignId) } catch { /* Old/injected repositories retain the cold verified path. */ }
    }
    if (owner.controller.signal.aborted || owners.get(campaignId) !== owner) disposeScope(owner)
    return owner
  }
  const finish = (owner: Owner) => {
    if (owner.finished) return
    owner.finished = true
    const elapsed = Math.max(0, performance.now() - owner.started)
    if (owner.limit === 60_000) execution.maxInvocationOwnerMs = Math.max(execution.maxInvocationOwnerMs, elapsed)
    else execution.maxMetadataOwnerMs = Math.max(execution.maxMetadataOwnerMs, elapsed)
    execution.activeOwners = Math.max(0, execution.activeOwners - 1)
    increment(owner.outcome === 'completed' ? 'ownersCompleted' : owner.outcome === 'cancelled' ? 'ownersCancelled' : owner.outcome === 'expired' ? 'ownersExpired' : 'ownersRefused')
    if (owners.get(owner.campaignId) === owner) owners.delete(owner.campaignId)
    owner.controller.abort()
  }
  const own = async <T>(owner: Owner, task: () => Promise<T>): Promise<T> => {
    try { const result = await task(); check(owner); owner.outcome = 'completed'; return result }
    catch (error) {
      const code = errorCode(error)
      if (owner.deadlineRecorded || ['deadline_exceeded', 'operation_timeout'].includes(code)) { deadlineFailure(owner); owner.outcome = 'expired' }
      else owner.outcome = code === 'cancelled' || owner.controller.signal.aborted && !owner.deadlineRecorded ? 'cancelled' : 'refused'
      throw error
    } finally { finish(owner) }
  }
  const wait = async <T>(owner: Owner, task: () => Promise<T>, milliseconds = 3_000, absoluteDeadline = Infinity): Promise<T> => {
    check(owner)
    const admittedAt = performance.now()
    const deadline = { at: Math.min(admittedAt + milliseconds, owner.started + owner.limit, absoluteDeadline,
      ...[...owner.deadlines].map(value => value.at)) }
    const remaining = deadline.at - admittedAt
    if (remaining <= 0) { const failure = deadlineFailure(owner); owner.controller.abort(failure); throw failure }
    // Cooperative checks and CAS gates share this exact admitted deadline. A
    // delayed timer/microtask cannot admit or publish a successful-but-late result.
    owner.deadlines.add(deadline)
    let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined
    try {
      const value = await new Promise<T>((resolve, reject) => {
        let settled = false
        const end = (error: unknown, result?: T) => {
          if (settled) return; settled = true
          if (timer !== undefined) clearTimeout(timer)
          if (abort) owner.controller.signal.removeEventListener('abort', abort)
          if (error) reject(error); else resolve(result!)
        }
        abort = () => end(stopped(owner))
        owner.controller.signal.addEventListener('abort', abort, { once: true })
        timer = setTimeout(() => {
          const failure = deadlineFailure(owner)
          end(failure); owner.controller.abort(failure)
        }, remaining)
        Promise.resolve().then(() => { check(owner); return task() }).then(value => end(null, value), error => end(error))
      })
      try { check(owner) } catch (error) { if (errorCode(error) === 'deadline_exceeded') increment('lateResultRefusals'); throw error }
      return value
    } catch (error) {
      // A repository may wrap an expired CAS guard as conflict/storage_unknown.
      // Preserve that durable uncertainty while recording the exact admitted
      // deadline before this nested wait is removed from the owner.
      if (performance.now() >= deadline.at) { const failure = deadlineFailure(owner); owner.controller.abort(failure) }
      throw error
    } finally {
      owner.deadlines.delete(deadline)
      if (timer !== undefined) clearTimeout(timer)
      if (abort) owner.controller.signal.removeEventListener('abort', abort)
    }
  }
  const coldVerification = async <T>(owner: Owner, task: (context: ProducerVerificationContext, scope: ProducerActionScope) => Promise<T>): Promise<T> => {
    check(owner)
    const scope = owner.scope
    if (!sessionCapable || !scope || owner.verificationUsed) throw new BodyProducerEngineError('verification_unavailable')
    owner.verificationUsed = true
    const deadline = Math.min(owner.started + 10_000, owner.started + owner.limit)
    const verificationDeadline = { at: deadline }
    owner.deadlines.add(verificationDeadline)
    let active = true
    let progress: ProducerVerificationProgress | null = null
    const context: ProducerVerificationContext = Object.freeze({ ownerStartedAt: owner.started, deadline, signal: owner.controller.signal,
      check: () => check(owner), onProgress: (value: ProducerVerificationProgress) => {
        if (!active) throw new BodyProducerEngineError('verification_unavailable')
        check(owner); progress = detachedProgress(value); check(owner); emitVerification(owner, 'progress', progress); check(owner)
      } })
    try {
      emitVerification(owner, 'started', null); check(owner)
      const result = await wait(owner, () => task(context, scope), 10_000, deadline)
      // Completed describes verification, not action publication. A listener
      // may synchronously revoke ownership; the catch then emits cancellation
      // and returns no snapshot/dispatch authority. Late progress stays closed.
      check(owner); active = false; emitVerification(owner, 'completed', progress); check(owner)
      return result
    } catch (error) {
      const cancelled = errorCode(error) === 'cancelled' || owner.controller.signal.aborted && !owner.deadlineRecorded
      active = false; emitVerification(owner, cancelled ? 'cancelled' : 'failed', progress)
      throw error
    } finally { active = false; owner.deadlines.delete(verificationDeadline) }
  }
  const readCurrent = (id: string, owner: Owner): Promise<ProducerCampaignSnapshot | null> =>
    sessionCapable && owner.scope && !owner.verificationUsed
      ? coldVerification(owner, (context, scope) => repository.verifyCurrent!(id, context, scope))
      : wait(owner, () => repository.read(id, () => check(owner), owner.scope))
  const read = async (id: string, owner: Owner): Promise<ProducerCampaignSnapshot> => {
    const snapshot = await readCurrent(id, owner)
    if (!snapshot) throw new BodyProducerEngineError('producer_not_enabled')
    return snapshot
  }
  const current = (snapshot: ProducerCampaignSnapshot) => {
    if (snapshot.manifest.runtimeIdentity !== identity.runtimeIdentity || !equal(snapshot.manifest.source, identity.source)) throw new BodyProducerEngineError('runtime_identity_changed')
    if (snapshot.checkpoint.status === 'cancelled') throw new BodyProducerEngineError('cancelled')
    const now = clock()
    if (!Number.isSafeInteger(now) || now < snapshot.checkpoint.lastWallTime) throw new BodyProducerEngineError('clock_rollback')
    if (now >= snapshot.manifest.expiresAt) throw new BodyProducerEngineError('expired')
  }
  const sourceCurrent = (snapshot: ProducerCampaignSnapshot, request: Pick<BodyProducerRequest, 'aggregateManifestHash' | 'sourceEpoch' | 'prepared'>) => {
    current(snapshot)
    if (snapshot.manifest.hash !== request.aggregateManifestHash || snapshot.checkpoint.sourceEpoch !== request.sourceEpoch
      || snapshot.source.candidateId !== request.prepared.source.currentCandidateId) throw new BodyProducerEngineError('source_changed')
  }
  const phase = (snapshot: ProducerCampaignSnapshot, requestId: string) => {
    const index = snapshot.checkpoint.producerRequests.find(row => row.id === requestId)
    const value = index && snapshot.phases.get(index.phaseHash)
    if (!index || !value) throw new BodyProducerEngineError('request_missing')
    return value
  }
  const request = (snapshot: ProducerCampaignSnapshot, requestId: string) => {
    const value = snapshot.requests.get(phase(snapshot, requestId).requestHash)
    if (!value) throw new BodyProducerEngineError('request_missing')
    return value
  }
  const preflight = (snapshot: ProducerCampaignSnapshot, input: { inputBytes: number; inputUtf16: number }) => {
    const reservation = bodyProducerReservation(input), state = snapshot.checkpoint, limits = snapshot.origin.manifest.budget
    if (state.producerRequests.length >= 8) throw new BodyProducerEngineError('budget_exhausted')
    let future = 4
    for (const row of state.producerRequests) {
      const existing = phase(snapshot, row.id)
      if (['reserved', 'dispatch_intent', 'response_retained'].includes(existing.status)) throw new BodyProducerEngineError('operation_in_progress')
      future += producerFuturePhases(existing.status)
    }
    for (const key of CAMPAIGN_BUDGET_KEYS) if (state.budget[key] + reservation[key] > limits[key]) throw new BodyProducerEngineError('budget_exhausted')
    if (state.budget.activeMs + reservation.activeMs > limits.activeMs - 160_000
      || state.budget.operations + 1 + Math.max(16, future + 1) > limits.operations) throw new BodyProducerEngineError('budget_exhausted')
    const storage = state.storage, tasks = snapshot.origin.manifest.tasks.length
    if (decodeStorageBytes(storage.writtenBytes) + decodeStorageBytes(storage.outstandingBytes) + decodeStorageBytes(storage.recoveryRemainingBytes)
        + producerStorageAllowance(tasks) > decodeStorageBytes(snapshot.origin.manifest.storage.limitBytes)
      || decodeStorageBytes(storage.recoveryRemainingBytes) < producerMetadataBound(tasks)) throw new BodyProducerEngineError('budget_exhausted')
    return reservation
  }
  const commit = (owner: Owner, snapshot: ProducerCampaignSnapshot, mutation: Parameters<ProducerCampaignRepository['commit']>[1], publicationCheck?: () => void) =>
    wait(owner, () => repository.commit(snapshot, mutation, () => { try { check(owner); publicationCheck?.(); return true } catch { return false } }, owner.scope))

  async function resolveRetained(snapshot: ProducerCampaignSnapshot, requestId: string, owner: Owner, recovery = false, publicationCheck?: () => void): Promise<ProducerCampaignSnapshot> {
    const origin = request(snapshot, requestId), latest = phase(snapshot, requestId)
    if (latest.status === 'resolved') return snapshot
    if (latest.status !== 'response_retained' || !latest.responseHash) throw new BodyProducerEngineError('no_retained_response')
    if (recovery) {
      const future = snapshot.checkpoint.producerRequests.reduce((total, row) => total + (row.id === requestId ? 0 : producerFuturePhases(phase(snapshot, row.id).status)), 0)
      const budget = snapshot.checkpoint.budget, ceiling = snapshot.origin.manifest.budget
      if (budget.activeMs + 10_000 + Math.max(10_000, (future + 1) * 10_000) > ceiling.activeMs
        || budget.operations + 1 + Math.max(1, future + 1) > ceiling.operations) throw new BodyProducerEngineError('budget_exhausted')
    }
    const response = snapshot.responses.get(latest.responseHash)
    if (!response) throw new BodyProducerEngineError('response_missing')
    let review: Awaited<ReturnType<typeof sealProducerReview>> | undefined, reason: string | null = null
    try {
      sourceCurrent(snapshot, origin); publicationCheck?.()
      const result = await wait(owner, () => compileProducedBodyEvidence(snapshot.source, origin.prepared, response.text, {
        requestId, requestHash: origin.hash, responseHash: response.hash, intentHash: response.intentHash,
        aggregateManifestHash: origin.aggregateManifestHash, sourceEpoch: origin.sourceEpoch,
        producer: origin.producer, reportedModelId: response.reportedModelId,
      }, () => check(owner)), 10_000)
      review = await sealProducerReview({ schemaVersion: 1, protocol: 'body-producer-review-v1', campaignId: origin.campaignId,
        requestId, requestHash: origin.hash, responseHash: response.hash, result })
    } catch (error) {
      check(owner); reason = errorCode(error)
    }
    const fresh = await read(origin.campaignId, owner)
    if (phase(fresh, requestId).status === 'resolved') return fresh
    try { sourceCurrent(fresh, origin); publicationCheck?.() } catch (error) { reason = errorCode(error); review = undefined }
    const recoveryControl = recovery || fresh.checkpoint.status === 'cancelled' || clock() >= origin.createdAt + 60_000
    const mutation = { kind: 'resolve' as const, operationId: `${origin.operationId}:resolve`, requestId,
      outcome: review ? 'review_ready' as const : 'refused' as const, reason, ...(review ? { review } : {}), ...(recoveryControl ? { recovery: true as const } : {}) }
    try { return (await commit(owner, fresh, mutation, review ? publicationCheck : undefined)).snapshot }
    catch (error) {
      // A failed repository action revokes its exact proof scope. A handled
      // refusal must verify cold within this owner's existing deadlines; never
      // reuse or reseed the closed token, even after a lost acknowledgment.
      disposeScope(owner)
      if (review && publicationCheck) {
        let revoked: string | null = null
        try { publicationCheck() } catch (cause) { revoked = errorCode(cause) }
        if (revoked) {
          const latestSnapshot = await read(origin.campaignId, owner)
          if (phase(latestSnapshot, requestId).status === 'resolved') return latestSnapshot
          return (await commit(owner, latestSnapshot, { kind: 'resolve', operationId: `${origin.operationId}:resolve`, requestId,
            outcome: 'refused', reason: revoked, ...(recoveryControl ? { recovery: true as const } : {}) })).snapshot
        }
      }
      // A complete retained response remains recoverable if the review wrapper
      // cannot fit. Never truncate its inventory or enlarge an allocation.
      if (!review || !['budget', 'record_capacity', 'review_capacity'].includes(errorCode(error))) throw error
      const latestSnapshot = await read(origin.campaignId, owner)
      return (await commit(owner, latestSnapshot, { kind: 'resolve', operationId: `${origin.operationId}:resolve`, requestId,
        outcome: 'refused', reason: 'review_capacity', ...(recoveryControl ? { recovery: true as const } : {}) })).snapshot
    }
  }
  async function recoverFailure(id: string, requestId: string, code: string): Promise<ProducerCampaignSnapshot> {
    // Let the winning cancel control finish before creating a recovery owner.
    // Its receipt must be observed; cancellation is not a competing replay.
    const cancelling = cancellations.get(id)
    if (cancelling) { try { await cancelling } catch { /* Re-read the uncertain durable outcome below. */ } }
    if (owners.has(id)) throw new BodyProducerEngineError(code === 'cancelled' ? 'cancelled' : 'recovery_pending')
    const owner = begin(id)
    return own(owner, async () => {
      const snapshot = await read(id, owner), index = snapshot.checkpoint.producerRequests.find(row => row.id === requestId)
      if (!index) throw new BodyProducerEngineError(code) // Admission failed; no confirmed request or dispatch exists.
      const state = phase(snapshot, requestId), origin = request(snapshot, requestId)
      if (state.status === 'reserved') return (await commit(owner, snapshot, { kind: 'resolve', operationId: `${origin.operationId}:resolve`,
        requestId, outcome: 'not_dispatched', reason: code, recovery: true })).snapshot
      if (state.status === 'dispatch_intent') return (await commit(owner, snapshot, { kind: 'outcome_unknown', operationId: `${origin.operationId}:unknown`, requestId, reason: code, recovery: true })).snapshot
      // Retained/resolved receipts, including lost acknowledgments, are read
      // before any retry. Unknown is never interpreted as a fresh invocation.
      return snapshot
    })
  }
  async function execute(privateHandle: PreparedPrivate): Promise<ProducerCampaignSnapshot> {
    const value = privateHandle.handle, adapter = privateHandle.adapter
    const handleCurrent = () => { if (generations.get(value.campaignId) !== privateHandle.generation) throw new BodyProducerEngineError('prepared_revoked') }
    handleCurrent()
    if (!adapter || !value.invocationAllowed) throw new BodyProducerEngineError('producer_not_authorized')
    const owner = begin(value.campaignId, 60_000)
    let failed: unknown
    try { return await own(owner, async () => {
      if (clock() >= value.expiresAt || clock() < value.createdAt) throw new BodyProducerEngineError('prepared_expired')
      adapter.assertCurrent()
      if (!equal(adapter.identity, value.producer)) throw new BodyProducerEngineError('configuration_changed')
      let snapshot = await read(value.campaignId, owner)
      sourceCurrent(snapshot, value)
      const input = await wait(owner, () => prepareBodyProducerInput(snapshot.source, privateHandle.selection, () => check(owner)), 10_000)
      if (!equal(input, value.prepared)) throw new BodyProducerEngineError('source_changed')
      const reservation = preflight(snapshot, input)
      const now = clock(), origin = await sealProducerRequest({ schemaVersion: 1, protocol: 'body-producer-request-v1',
        campaignId: value.campaignId, id: privateHandle.requestId, operationId: privateHandle.operationId!,
        aggregateManifestHash: value.aggregateManifestHash, sourceEpoch: value.sourceEpoch, prepared: input, producer: { ...adapter.identity },
        reservation, createdAt: now, expiresAt: Math.min(snapshot.manifest.expiresAt, now + 60_000) })
      snapshot = (await commit(owner, snapshot, { kind: 'reserve', operationId: `${origin.operationId}:reserve`, request: origin })).snapshot
      if (phase(snapshot, origin.id).status !== 'reserved') return snapshot
      let intentHash: string | null = null, entered = false
      const returned = await wait(owner, () => adapter.invoke({ wire: input.wire, signal: owner.controller.signal, beforeRequest: async () => {
        check(owner); handleCurrent()
        if (entered) throw new BodyProducerEngineError('request_limit')
        entered = true; adapter.assertCurrent()
        const fresh = await read(origin.campaignId, owner)
        sourceCurrent(fresh, origin)
        if (phase(fresh, origin.id).status !== 'reserved') throw new BodyProducerEngineError('dispatch_outcome_unknown')
        const intent = await commit(owner, fresh, { kind: 'dispatch_intent', operationId: `${origin.operationId}:intent`, requestId: origin.id })
        if (intent.replayed) throw new BodyProducerEngineError('dispatch_outcome_unknown')
        intentHash = phase(intent.snapshot, origin.id).hash
        // Intent durability is not a current-source receipt: another tab may
        // revise the body while this successful CAS acknowledgment is delayed.
        const dispatchSource = await read(origin.campaignId, owner)
        sourceCurrent(dispatchSource, origin)
        if (phase(dispatchSource, origin.id).status !== 'dispatch_intent' || phase(dispatchSource, origin.id).hash !== intentHash) {
          throw new BodyProducerEngineError('dispatch_outcome_unknown')
        }
        check(owner); handleCurrent(); adapter.assertCurrent()
        if (!equal(adapter.identity, origin.producer)) throw new BodyProducerEngineError('configuration_changed')
      } }), 30_000)
      check(owner)
      if (!intentHash || !entered) throw new BodyProducerEngineError('missing_dispatch_intent')
      if (typeof returned.text !== 'string' || returned.text.length > 16_384 || utf8Bytes(returned.text) > 16_384) throw new BodyProducerEngineError('response_capacity')
      const response = await sealProducerResponse({ schemaVersion: 1, protocol: 'body-producer-response-v1', campaignId: origin.campaignId,
        requestId: origin.id, requestHash: origin.hash, intentHash, evidenceId: returned.evidenceId,
        text: returned.text, textHash: await hashText(returned.text), bytes: utf8Bytes(returned.text),
        usage: returned.usage, reportedModelId: returned.reportedModelId })
      snapshot = await read(origin.campaignId, owner)
      const standaloneRetention = snapshot.checkpoint.status === 'cancelled' || clock() >= origin.createdAt + 60_000
      snapshot = (await commit(owner, snapshot, { kind: 'retain_response', operationId: `${origin.operationId}:retain`, requestId: origin.id, response,
        ...(standaloneRetention ? { recovery: true as const } : {}) })).snapshot
      return await resolveRetained(snapshot, origin.id, owner, standaloneRetention, () => {
        handleCurrent(); adapter.assertCurrent()
        if (!equal(adapter.identity, origin.producer)) throw new BodyProducerEngineError('configuration_changed')
      })
    }) } catch (error) { failed = error }
    // A separate bounded metadata recovery owner cannot grant or repeat a call.
    return recoverFailure(value.campaignId, privateHandle.requestId, errorCode(failed))
  }
  const engine: BodyProducerEngine = {
    subscribeVerification(listener) { verificationListeners.add(listener); return () => { verificationListeners.delete(listener) } },
    getExecutionStats: () => structuredClone(execution),
    availableProducers: () => [...(adapters.size ? [...adapters.values()].map(adapter => ({ ...adapter.identity })) : [{ ...UNCONFIGURED }])],
    async inspect(id) {
      const owner = begin(id)
      return own(owner, () => readCurrent(id, owner))
    },
    async adopt(id, commandId = operation()) {
      const owner = begin(id)
      return own(owner, async () => (sessionCapable && owner.scope
        ? await coldVerification(owner, (context, scope) => repository.adoptVerified!(id, commandId, identity, context, scope))
        : await wait(owner, () => repository.adopt(id, commandId, identity, () => { try { check(owner); return true } catch { return false } }))).snapshot)
    },
    async reviseBody(id, chapterOrdinal, text, expectedRawHead, commandId = operation()) {
      const owner = begin(id)
      return own(owner, async () => { const snapshot = await read(id, owner); current(snapshot)
        // Keep the author's exact preview head as the CAS token. The repository
        // first recognizes an exact committed operation receipt (lost ACK), but
        // never rebases a new replacement onto another tab's current body.
        if (typeof expectedRawHead !== 'string') throw new BodyProducerEngineError('source_changed')
        try {
          return (await commit(owner, { ...snapshot, rawHead: expectedRawHead }, { kind: 'body_revision', operationId: commandId, chapterOrdinal, text })).snapshot
        } catch (error) {
          if (snapshot.rawHead !== expectedRawHead && errorCode(error) === 'conflict') throw new BodyProducerEngineError('source_changed')
          throw error
        }
      })
    },
    async prepare(id, selection, producerId) {
      const owner = begin(id)
      return own(owner, async () => {
        const snapshot = await read(id, owner); current(snapshot)
        const generation = (generations.get(id) ?? 0) + 1; generations.set(id, generation)
        const adapter = adapters.get(producerId) ?? null
        const descriptor = adapter?.identity ?? (producerId === UNCONFIGURED.adapterId && !adapters.size ? UNCONFIGURED : null)
        if (!descriptor) throw new BodyProducerEngineError('invalid_adapter')
        adapter?.assertCurrent()
        const selected = structuredClone(selection)
        const input = await wait(owner, () => prepareBodyProducerInput(snapshot.source, selected, () => check(owner)), 10_000)
        const fresh = await read(id, owner); current(fresh)
        if (fresh.rawHead !== snapshot.rawHead) throw new BodyProducerEngineError('source_changed')
        const reservation = preflight(fresh, input)
        const createdAt = clock(), handle = Object.freeze({ id: operation(), campaignId: id, sourceEpoch: snapshot.checkpoint.sourceEpoch,
          aggregateManifestHash: snapshot.manifest.hash, producer: Object.freeze({ ...descriptor }), prepared: structuredClone(input), reservation,
          createdAt, expiresAt: Math.min(createdAt + 300_000, snapshot.manifest.expiresAt), invocationAllowed: adapter !== null })
        // The public handle's content is presentation; only this private captured
        // value and registered adapter can be used for invocation.
        prepared.set(handle, { handle: structuredClone(handle), selection: selected, adapter, operationId: null,
          requestId: `request-${crypto.randomUUID()}`, promise: null, invoked: false, failureCode: null, generation })
        return handle
      })
    },
    invoke(handle, commandId) {
      const captured = prepared.get(handle)
      if (!captured || !equal(captured.handle, handle)) return Promise.reject(new BodyProducerEngineError('invalid_prepared_handle'))
      if (generations.get(handle.campaignId) !== captured.generation) return Promise.reject(new BodyProducerEngineError('prepared_revoked'))
      if (!captured.handle.invocationAllowed) return Promise.reject(new BodyProducerEngineError('producer_not_authorized'))
      if (captured.operationId !== null && commandId !== undefined && captured.operationId !== commandId) return Promise.reject(new BodyProducerEngineError('operation_conflict'))
      if (captured.promise) return captured.promise
      if (captured.invoked) {
        if (captured.failureCode) return Promise.reject(new BodyProducerEngineError(captured.failureCode))
        return engine.inspect(handle.campaignId).then(value => {
          if (!value) throw new BodyProducerEngineError('producer_not_enabled')
          if (!value.checkpoint.producerRequests.some(row => row.id === captured.requestId)) throw new BodyProducerEngineError('request_missing')
          return value
        })
      }
      captured.operationId = commandId ?? operation(); captured.invoked = true
      const pending = execute(captured).catch(error => { captured.failureCode = errorCode(error); throw error }).finally(() => { if (captured.promise === pending) captured.promise = null })
      captured.promise = pending; return pending
    },
    async recover(id, requestId) {
      const owner = begin(id)
      return own(owner, async () => {
        const snapshot = await read(id, owner), state = phase(snapshot, requestId)
        if (state.status === 'resolved' || state.status === 'outcome_unknown') return snapshot
        if (state.status === 'response_retained') return await resolveRetained(snapshot, requestId, owner, true)
        const origin = request(snapshot, requestId)
        if (state.status === 'reserved') return (await commit(owner, snapshot, { kind: 'resolve', operationId: `${origin.operationId}:resolve`, requestId,
          outcome: 'not_dispatched', reason: 'recovered_before_intent', recovery: true })).snapshot
        return (await commit(owner, snapshot, { kind: 'outcome_unknown', operationId: `${origin.operationId}:unknown`, requestId,
          reason: 'dispatch_outcome_unknown', recovery: true })).snapshot
      })
    },
    async cancel(id, commandId = operation()) {
      const existing = cancellations.get(id)
      if (existing) return existing
      engine.cancelLocal(id)
      const pending = (async () => {
        const owner = begin(id)
        return own(owner, async () => { const snapshot = await read(id, owner)
          if (snapshot.checkpoint.status === 'cancelled') return snapshot
          return (await commit(owner, snapshot, { kind: 'cancel', operationId: commandId })).snapshot
        })
      })()
      cancellations.set(id, pending)
      try { return await pending } finally { if (cancellations.get(id) === pending) cancellations.delete(id) }
    },
    cancelLocal(id) {
      for (const [key, generation] of generations) if (id === undefined || key === id) generations.set(key, generation + 1)
      for (const [key, owner] of owners) if (id === undefined || key === id) { owners.delete(key); owner.controller.abort() }
    },
  }
  return engine
}
