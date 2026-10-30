/** One explicit nine-task grant. Durable records describe outcomes, never a
 * restored execution grant; every new HTTP call needs a fresh winning intent. */
import type {
  CreativeAdapterResult, CreativeCommitGuard, CreativeGenerationAdapter, CreativeHeadCommand, CreativeMutation,
  CreativeOfflineHost, CreativePhase, CreativePilotEngine, CreativeProgressEvent, CreativeProgressKind,
  CreativeRepository, CreativeRequest, CreativeResponse, CreativeRuntimeIdentity, CreativeSnapshot, CreativeTaskId, CreativeUnknownReason,
} from '../../types/creativePilot'
import { BoundedGenerationError } from '../aiRequestLimits'
import { getCampaignBuildIdentity } from './buildIdentity'
import { canonicalStringify, encodeStorageBytes } from './protocol'
import {
  CREATIVE_LIMITS, CreativePilotError, creativeId, creativeRequestReservation, sealCreativeRequest, sealCreativeResponse,
} from './creativePilotProtocol'
import { createCreativePilotRepository } from './creativePilotStore'
import { compileCreativeInput } from './creativePilotContext'
import { getCreativeOfflineSdkAdapter } from './creativePilotTransport'

export interface CreativePilotEngineOptions {
  repository?: CreativeRepository
  host?: CreativeOfflineHost
  identity?: CreativeRuntimeIdentity
  clock?: () => number
  monotonic?: () => number
}
interface Owner {
  id: number; campaignId: string; taskId: CreativeTaskId | null
  startedWall: number; startedMono: number; lastWall: number; deadlineWall: number; deadlineMono: number
  controller: AbortController; timer: ReturnType<typeof setTimeout>; closed: boolean
  lastProgress?: Readonly<CreativeProgressEvent>
}
interface Run {
  key: string; id: string; campaignId: string; candidateHash: string; manifestHash: string | null
  controller: AbortController; promise: Promise<CreativeSnapshot>
}
const equal = (left: unknown, right: unknown) => canonicalStringify(left) === canonicalStringify(right)
const nextId = () => `creative-${crypto.randomUUID()}`
function throwCode(code: ConstructorParameters<typeof CreativePilotError>[0]): never { throw new CreativePilotError(code) }

export function createCreativePilotEngine(options: CreativePilotEngineOptions = {}): CreativePilotEngine {
  const clock = options.clock ?? Date.now, monotonic = options.monotonic ?? (() => performance.now())
  const repository = options.repository ?? createCreativePilotRepository({ clock, monotonic })
  const identity = structuredClone(options.identity ?? getCampaignBuildIdentity())
  const adapter = getCreativeOfflineSdkAdapter(options.host)
  const owners = new Set<Owner>(), listeners = new Set<(event: Readonly<CreativeProgressEvent>) => void>()
  let disposed = false, ownerSequence = 0, activeRun: Run | null = null

  function owner(campaignId: string, duration: number, taskId: CreativeTaskId | null = null, expiresAt = Infinity): Owner {
    if (disposed) throwCode('cancelled')
    const now = clock(), remaining = Math.min(duration, expiresAt - now)
    if (!Number.isSafeInteger(now) || now < 0) throwCode('clock_rollback')
    if (!(remaining > 0)) throwCode('expired')
    const controller = new AbortController(), startedMono = monotonic()
    const value: Owner = { id: ++ownerSequence, campaignId, taskId, startedWall: now, lastWall: now,
      startedMono, deadlineWall: now + remaining, deadlineMono: startedMono + remaining, controller,
      timer: setTimeout(() => controller.abort(), remaining), closed: false }
    owners.add(value)
    return value
  }
  function finish(value: Owner): void { value.closed = true; clearTimeout(value.timer); owners.delete(value) }
  function checkTime(value: Owner): void {
    const now = clock()
    if (!Number.isSafeInteger(now) || now < value.lastWall) throwCode('clock_rollback')
    value.lastWall = now
    if (now >= value.deadlineWall || monotonic() >= value.deadlineMono) throwCode('deadline_exceeded')
    if (value.closed) throwCode('cancelled')
  }
  function check(value: Owner): void {
    checkTime(value)
    if (disposed || value.controller.signal.aborted) throwCode('cancelled')
  }
  function can(checker: () => void): boolean { try { checker(); return true } catch { return false } }
  function guard(checker: () => void, publisher = checker): CreativeCommitGuard {
    return { canCommit: () => can(checker), canPublish: () => can(publisher) }
  }
  function emit(value: Owner, kind: CreativeProgressKind, snapshot: CreativeSnapshot | null): void {
    if (disposed) return
    const tasks = snapshot?.checkpoint.tasks ?? []
    const event: Readonly<CreativeProgressEvent> = Object.freeze({ ownerId: value.id, campaignId: value.campaignId, kind,
      taskId: value.taskId, attemptsReserved: snapshot?.checkpoint.budget.attempts ?? value.lastProgress?.attemptsReserved ?? 0,
      acceptedTasks: snapshot ? tasks.filter(task => task.status === 'accepted').length : value.lastProgress?.acceptedTasks ?? 0,
      acceptedBodies: snapshot ? tasks.filter(task => task.status === 'accepted' && task.taskId.startsWith('b-')).length : value.lastProgress?.acceptedBodies ?? 0,
      bodyCanonicalScalars: snapshot?.checkpoint.bodyCharacters ?? value.lastProgress?.bodyCanonicalScalars ?? 0 })
    value.lastProgress = event
    for (const listener of [...listeners]) { try { Reflect.apply(listener, undefined, [event]) } catch { /* Observers cannot control execution through errors. */ } }
  }
  function checkSource(snapshot: CreativeSnapshot): void {
    if (snapshot.manifest.runtimeIdentity !== identity.runtimeIdentity || !equal(snapshot.manifest.source, identity.source)) throwCode('source_changed')
  }
  function checkHost(snapshot: CreativeSnapshot): CreativeGenerationAdapter {
    if (!adapter) throwCode('unconfigured')
    adapter.assertCurrent()
    if (snapshot.checkpoint.adapter && !equal(snapshot.checkpoint.adapter, adapter.identity)) throwCode('configuration_changed')
    return adapter
  }
  function checkCreative(value: Owner, run: Run, snapshot: CreativeSnapshot): void {
    check(value)
    if (activeRun !== run || run.controller.signal.aborted || run.candidateHash !== snapshot.candidate.hash
      || (run.manifestHash !== null && run.manifestHash !== snapshot.manifest.hash)) throwCode('authority_revoked')
    if (snapshot.checkpoint.status === 'cancelled') throwCode('cancelled')
    if (clock() >= snapshot.manifest.expiresAt) throwCode('expired')
    checkSource(snapshot); checkHost(snapshot)
  }
  async function within<T>(value: Owner, action: () => Promise<T>, checker: () => void,
    until = value.deadlineMono, allowStopped = false): Promise<T> {
    checker()
    const remaining = Math.min(value.deadlineMono, until) - monotonic()
    if (remaining <= 0) throwCode('deadline_exceeded')
    let rejectBoundary!: (error: CreativePilotError) => void
    const boundary = new Promise<never>((_resolve, reject) => { rejectBoundary = reject })
    const timer = setTimeout(() => rejectBoundary(new CreativePilotError('deadline_exceeded')), remaining)
    const abort = () => {
      try { checkTime(value) } catch (error) {
        if (error instanceof CreativePilotError) { rejectBoundary(error); return }
      }
      rejectBoundary(new CreativePilotError('cancelled'))
    }
    if (!allowStopped) value.controller.signal.addEventListener('abort', abort, { once: true })
    try {
      const result = await Promise.race([Promise.resolve().then(() => { checker(); return action() }), boundary])
      checker()
      if (monotonic() >= until) throwCode('deadline_exceeded')
      return result
    } finally { clearTimeout(timer); value.controller.signal.removeEventListener('abort', abort) }
  }
  async function read(value: Owner, checker = () => check(value), until = value.deadlineMono, allowStopped = false): Promise<CreativeSnapshot> {
    const snapshot = await within(value, () => repository.read(value.campaignId, checker), checker, until, allowStopped)
    if (!snapshot) throwCode('input_invalid')
    return snapshot
  }
  function commit(value: Owner, snapshot: CreativeSnapshot, mutation: CreativeMutation,
    checker: () => void, publisher = checker, allowStopped = false) {
    return within(value, () => repository.commit(snapshot, mutation, guard(checker, publisher)), checker, value.deadlineMono, allowStopped)
  }
  function exact(snapshot: CreativeSnapshot, command: CreativeHeadCommand): void {
    creativeId(command.operationId)
    if (snapshot.rawHead !== command.expectedRawHead || snapshot.candidate.hash !== command.expectedCandidateHash) throwCode('source_changed')
  }
  function currentPhase(snapshot: CreativeSnapshot, requestHash: string): CreativePhase {
    const index = snapshot.checkpoint.requests.find(request => request.requestHash === requestHash)
    const phase = index && snapshot.phases.get(index.phaseHash)
    if (!phase || phase.requestHash !== requestHash) throwCode('integrity')
    return phase
  }
  function requestFor(snapshot: CreativeSnapshot, requestHash: string): CreativeRequest {
    const request = snapshot.requests.get(requestHash)
    if (!request) throwCode('integrity')
    return request
  }
  async function metadata<T>(campaignId: string, action: (value: Owner) => Promise<T>): Promise<T> {
    const value = owner(campaignId, CREATIVE_LIMITS.metadataMs)
    try { return await within(value, () => action(value), () => check(value)) } finally { finish(value) }
  }
  function unknownReason(error: unknown): CreativeUnknownReason {
    if (error instanceof BoundedGenerationError) return error.code === 'cancelled' ? 'interrupted' : error.code === 'timeout' ? 'deadline' : 'transport_unknown'
    if (error instanceof CreativePilotError) {
      if (error.code === 'storage_unknown') return 'ack_uncertain'
      if (['deadline_exceeded', 'operation_timeout', 'expired'].includes(error.code)) return 'deadline'
      if (['cancelled', 'authority_revoked', 'configuration_changed', 'source_changed'].includes(error.code)) return 'interrupted'
    }
    return 'transport_unknown'
  }
  /** One bounded cleanup against the original deadline, never a new owner/time
   * grant. It may preserve evidence but cannot publish or advance a stage. */
  async function settleAfterFailure(value: Owner, request: CreativeRequest | null, response: CreativeResponse | null,
    error: unknown): Promise<CreativeSnapshot | null> {
    if (!request) return null
    const settlementCheck = () => checkTime(value)
    if (!can(settlementCheck)) return null
    try {
      let snapshot = await read(value, settlementCheck, value.deadlineMono, true)
      if (!snapshot.requests.has(request.hash)) return snapshot
      let phase = currentPhase(snapshot, request.hash)
      if (phase.status === 'resolved') return snapshot
      if (response && ['dispatch_intent', 'outcome_unknown'].includes(phase.status)) {
        snapshot = (await commit(value, snapshot, { operationId: `${request.operationId}:retain`, kind: 'retain_response',
          recovery: false, requestHash: request.hash, response }, settlementCheck, () => throwCode('authority_revoked'), true)).snapshot
        phase = currentPhase(snapshot, request.hash)
      }
      if (phase.status === 'dispatch_intent') snapshot = (await commit(value, snapshot, {
        operationId: `${request.operationId}:unknown`, kind: 'outcome_unknown', recovery: false,
        requestHash: request.hash, reason: unknownReason(error),
      }, settlementCheck, () => throwCode('authority_revoked'), true)).snapshot
      // A valid retained reply is deliberately left for explicit local Resolve.
      // A verified reserved origin is also left resumable within its old deadline.
      return snapshot
    } catch { return null /* Unconfirmed persistence is never labelled safely settled. */ }
  }

  async function executeStage(run: Run, previous: CreativeSnapshot, taskId: CreativeTaskId): Promise<CreativeSnapshot> {
    const existingTask = previous.checkpoint.tasks.find(task => task.taskId === taskId)!
    let request: CreativeRequest | null = existingTask.requestHash ? requestFor(previous, existingTask.requestHash) : null
    const value = owner(previous.manifest.campaignId, CREATIVE_LIMITS.stageMs, taskId,
      Math.min(previous.manifest.expiresAt, request?.expiresAt ?? Infinity))
    let snapshot = previous, knownResponse: CreativeResponse | null = null
    const creativeCheck = () => checkCreative(value, run, snapshot)
    const settlementCheck = () => checkTime(value)
    const onAbort = () => value.controller.abort()
    run.controller.signal.addEventListener('abort', onAbort, { once: true })
    try {
      emit(value, 'verifying', snapshot); creativeCheck()
      const coldDeadline = Math.min(value.deadlineMono, value.startedMono + CREATIVE_LIMITS.repositoryMs)
      const coldCheck = () => { creativeCheck(); if (monotonic() >= coldDeadline) throwCode('deadline_exceeded') }
      const reopened = await read(value, coldCheck, coldDeadline)
      if (reopened.rawHead !== snapshot.rawHead) throwCode('source_changed')
      snapshot = reopened; creativeCheck()
      const task = snapshot.checkpoint.tasks.find(task => task.taskId === taskId)!
      const producer = checkHost(snapshot)
      if (!request) {
        if (task.status !== 'pending') throwCode('attempt_spent')
        const prepared = await within(value, () => compileCreativeInput(snapshot, taskId, creativeCheck), creativeCheck)
        creativeCheck()
        const id = nextId()
        request = await within(value, () => sealCreativeRequest({ schemaVersion: 1, protocol: 'creative-pilot-request-v1',
          campaignId: snapshot.manifest.campaignId, id, operationId: id, manifestHash: snapshot.manifest.hash,
          candidateHash: snapshot.candidate.hash, taskId, taskRevision: task.revision, dependencies: prepared.sourceRefs,
          prepared, adapter: { ...producer.identity }, invocationId: run.id, reservation: creativeRequestReservation(),
          createdAt: value.startedWall, expiresAt: value.deadlineWall,
          storageAllocationBytes: encodeStorageBytes(CREATIVE_LIMITS.requestAllowance) }), creativeCheck)
        creativeCheck()
        snapshot = (await commit(value, snapshot, { operationId: `${request.operationId}:reserve`, kind: 'reserve',
          recovery: false, request }, creativeCheck)).snapshot
        emit(value, 'reserved', snapshot); creativeCheck()
      } else {
        const phase = currentPhase(snapshot, request.hash)
        if (phase.status !== 'reserved' || task.status !== 'reserved' || request.candidateHash !== snapshot.candidate.hash) throwCode('unknown_outcome')
        if (clock() >= request.expiresAt) throwCode('expired')
        const rebuilt = await within(value, () => compileCreativeInput(snapshot, taskId, creativeCheck), creativeCheck)
        if (!equal(rebuilt, request.prepared) || !equal(producer.identity, request.adapter)) throwCode('source_changed')
      }
      const admitted = request
      let intentHash: string | null = null
      const result: CreativeAdapterResult = await within(value, () => producer.invoke({ requestHash: admitted.hash, wire: admitted.prepared.wire,
        signal: value.controller.signal, beforeRequest: async binding => {
          creativeCheck()
          const current = await read(value, creativeCheck)
          if (current.rawHead !== snapshot.rawHead || currentPhase(current, admitted.hash).status !== 'reserved') throwCode('source_changed')
          const committed = await commit(value, current, { operationId: `${admitted.operationId}:intent`,
            kind: 'dispatch_intent', recovery: false, requestHash: admitted.hash, dispatchWire: binding }, creativeCheck)
          // A late ACK cannot bypass the old owner's synchronous revocation.
          creativeCheck()
          if (committed.replayed || committed.receipt.kind !== 'dispatch_intent') throwCode('unknown_outcome')
          snapshot = committed.snapshot
          const phase = currentPhase(snapshot, admitted.hash)
          if (phase.status !== 'dispatch_intent' || !equal(phase.dispatchWire, binding)) throwCode('integrity')
          intentHash = phase.hash
          emit(value, 'dispatch_intent', snapshot); creativeCheck()
        } }), settlementCheck, value.deadlineMono, true)
      if (!intentHash) throwCode('integrity')
      knownResponse = await within(value, () => sealCreativeResponse({ schemaVersion: 1, protocol: 'creative-pilot-response-v1',
        campaignId: snapshot.manifest.campaignId, requestHash: admitted.hash, intentHash: intentHash!, ...result }), settlementCheck, value.deadlineMono, true)
      snapshot = (await commit(value, snapshot, { operationId: `${admitted.operationId}:retain`, kind: 'retain_response',
        recovery: false, requestHash: admitted.hash, response: knownResponse }, settlementCheck, creativeCheck, true)).snapshot
      emit(value, 'response_retained', snapshot); creativeCheck()
      snapshot = (await commit(value, snapshot, { operationId: `${admitted.operationId}:resolve`, kind: 'resolve',
        recovery: false, requestHash: admitted.hash, disposition: 'publish_if_valid' }, creativeCheck)).snapshot
      const resolution = currentPhase(snapshot, admitted.hash).resolution
      if (!resolution) throwCode('integrity')
      emit(value, resolution.outcome === 'accepted' ? 'accepted' : resolution.outcome === 'authority_revoked' ? 'authority_revoked' : 'refused', snapshot)
      creativeCheck()
      if (snapshot.checkpoint.status === 'completed') { emit(value, 'completed', snapshot); creativeCheck() }
      return snapshot
    } catch (error) {
      value.controller.abort()
      const settled = await settleAfterFailure(value, request, knownResponse, error)
      emit(value, error instanceof CreativePilotError && error.code === 'expired' ? 'expired' : 'blocked', settled ?? snapshot)
      if (error instanceof CreativePilotError) throw error
      if (error instanceof BoundedGenerationError) throw new CreativePilotError(error.code === 'cancelled' ? 'cancelled' : error.code === 'timeout' ? 'deadline_exceeded' : 'unknown_outcome')
      throw new CreativePilotError('storage_unknown')
    } finally { run.controller.signal.removeEventListener('abort', onAbort); finish(value) }
  }

  async function executeRun(run: Run, command: CreativeHeadCommand, mode: 'start' | 'resume'): Promise<CreativeSnapshot> {
    let snapshot = await metadata(command.campaignId, async value => {
      const current = await read(value); exact(current, command); checkSource(current); checkHost(current)
      if (run.controller.signal.aborted || activeRun !== run) throwCode('authority_revoked')
      if (clock() >= current.manifest.expiresAt) throwCode('expired')
      if (mode === 'start' && current.checkpoint.budget.attempts !== 0) throwCode('attempt_spent')
      if (['cancelled', 'completed', 'blocked'].includes(current.checkpoint.status)) throwCode('already_terminal')
      return current
    })
    run.manifestHash = snapshot.manifest.hash
    for (let stage = 0; stage < CREATIVE_LIMITS.tasks; stage++) {
      if (run.controller.signal.aborted || activeRun !== run || disposed) throwCode('cancelled')
      if (snapshot.checkpoint.status === 'completed') return snapshot
      const task = snapshot.checkpoint.tasks.find(row => row.status !== 'accepted')
      if (!task || !['pending', 'reserved'].includes(task.status)) throwCode('unknown_outcome')
      snapshot = await executeStage(run, snapshot, task.taskId)
      if (snapshot.checkpoint.status === 'blocked' || snapshot.checkpoint.status === 'cancelled') return snapshot
    }
    if (snapshot.checkpoint.status !== 'completed') throwCode('integrity')
    return snapshot
  }
  function startRun(command: CreativeHeadCommand, mode: 'start' | 'resume'): Promise<CreativeSnapshot> {
    if (disposed) return Promise.reject(new CreativePilotError('cancelled'))
    const key = canonicalStringify({ mode, campaignId: command.campaignId, expectedRawHead: command.expectedRawHead, candidate: command.expectedCandidateHash })
    if (activeRun) return activeRun.key === key ? activeRun.promise : Promise.reject(new CreativePilotError('conflict'))
    const run: Run = { key, id: nextId(), campaignId: command.campaignId, candidateHash: command.expectedCandidateHash,
      manifestHash: null, controller: new AbortController(), promise: null as unknown as Promise<CreativeSnapshot> }
    run.promise = Promise.resolve().then(() => executeRun(run, command, mode)).finally(() => { if (activeRun === run) activeRun = null })
    activeRun = run
    return run.promise
  }
  function stop(campaignId?: string): void {
    if (activeRun && (!campaignId || activeRun.campaignId === campaignId)) activeRun.controller.abort()
    for (const value of owners) if (!campaignId || value.campaignId === campaignId) { value.controller.abort(); emit(value, 'stopped', null) }
  }

  return {
    inspect: campaignId => metadata(campaignId, value => repository.read(campaignId, () => check(value))),
    async prepare(input) {
      if (activeRun) throwCode('conflict')
      return metadata(input.campaignId, async value => {
        const result = await repository.create({ ...input, identity: structuredClone(identity) }, guard(() => check(value)))
        check(value); emit(value, 'prepared', result.snapshot); check(value)
        return result.snapshot
      })
    },
    async dryPrepare(campaignId) {
      return metadata(campaignId, async value => {
        const snapshot = await read(value); checkSource(snapshot)
        if (['blocked', 'cancelled', 'completed'].includes(snapshot.checkpoint.status)) throwCode('already_terminal')
        if (clock() >= snapshot.manifest.expiresAt) throwCode('expired')
        const task = snapshot.checkpoint.tasks.find(row => row.status !== 'accepted')
        if (!task || !['pending', 'reserved'].includes(task.status)) throwCode('unknown_outcome')
        const prepared = await compileCreativeInput(snapshot, task.taskId, () => check(value))
        if (task.requestHash) {
          const request = requestFor(snapshot, task.requestHash)
          if (currentPhase(snapshot, request.hash).status !== 'reserved' || request.expiresAt <= clock()) throwCode('unknown_outcome')
          if (!equal(request.prepared, prepared)) throwCode('source_changed')
        }
        if (adapter) checkHost(snapshot)
        check(value)
        return { campaignId, rawHead: snapshot.rawHead, candidateHash: snapshot.candidate.hash, prepared,
          adapter: adapter ? { ...adapter.identity } : null, readiness: adapter ? 'offline_control_ready' as const : 'unconfigured' as const }
      })
    },
    async replaceBrief(input) {
      if (activeRun) throwCode('conflict')
      return metadata(input.campaignId, async value => {
        const snapshot = await read(value); exact(snapshot, input); checkSource(snapshot)
        const result = await repository.replaceBrief(snapshot, { operationId: input.operationId, brief: structuredClone(input.brief) }, guard(() => check(value)))
        check(value); emit(value, 'prepared', result.snapshot); check(value); return result.snapshot
      })
    },
    start: command => startRun(structuredClone(command), 'start'),
    resume: command => startRun(structuredClone(command), 'resume'),
    async resolveRetained(input) {
      if (activeRun) throwCode('conflict')
      return metadata(input.campaignId, async value => {
        const snapshot = await read(value); exact(snapshot, input)
        const publish = () => {
          check(value); checkSource(snapshot); checkHost(snapshot)
          if (clock() >= snapshot.manifest.expiresAt) throwCode('expired')
          if (snapshot.checkpoint.status === 'cancelled') throwCode('cancelled')
        }
        const result = await commit(value, snapshot, { operationId: input.operationId, kind: 'resolve', recovery: true,
          requestHash: input.requestHash, disposition: input.disposition }, () => check(value), publish)
        check(value)
        const outcome = currentPhase(result.snapshot, input.requestHash).resolution?.outcome
        emit(value, outcome === 'accepted' ? 'accepted' : outcome === 'authority_revoked' ? 'authority_revoked' : 'refused', result.snapshot)
        check(value); return result.snapshot
      })
    },
    async cancel(input) {
      stop(input.campaignId)
      return metadata(input.campaignId, async value => {
        const snapshot = await read(value); exact(snapshot, input)
        const mutation: CreativeMutation = { operationId: input.operationId, kind: 'cancel', recovery: false }
        const result = await commit(value, snapshot, mutation, () => check(value), () => throwCode('authority_revoked'))
        check(value); emit(value, 'cancelled', result.snapshot); check(value); return result.snapshot
      })
    },
    stop,
    subscribeProgress(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    dispose() { if (!disposed) { stop(); disposed = true; listeners.clear() } },
  }
}
