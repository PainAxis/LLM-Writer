import type { CampaignArtifact, CampaignBudget, CampaignManifest, CampaignMutation, CampaignRepository, CampaignRequest, CampaignResponse, CampaignSnapshot, CampaignState, CampaignTaskSpec, CampaignTaskState } from '../../types/writerCampaign'
import { createCampaignRepository } from './store'
import { getCampaignBuildIdentity } from './buildIdentity'
import { CampaignProtocolError, campaignId, hashCampaignValue, sealCampaignArtifact, sealCampaignManifest, sealCampaignRequest, utf8Bytes } from './protocol'
import { CampaignRuntimeError, CAMPAIGN_DISPATCH_TIMEOUT_MS, CAMPAIGN_IO_TIMEOUT_MS, campaignMetadataReservation, campaignRequestReservation, checkCampaignClock, emptyCampaignBudget, reserveCampaignBudget } from './budget'
import { createOfflineFixtureHost, isOfflineCampaignHost, type CampaignAuthorizationHost, type CampaignProviderContext, type OfflineFixtureOptions } from './fixtureAdapter'

export type CampaignRuntimeIdentity = Pick<CampaignManifest, 'runtimeIdentity' | 'source'>
export interface CampaignEngineOptions {
  identity?: CampaignRuntimeIdentity
  repository?: CampaignRepository
  host: CampaignAuthorizationHost
  clock?: () => number
  ioTimeoutMs?: number
  dispatchTimeoutMs?: number
}
export interface OfflineCampaignEngineOptions extends Omit<CampaignEngineOptions, 'host'> { host?: CampaignAuthorizationHost; fixture?: OfflineFixtureOptions }
export interface PrepareOfflineCampaign { campaignId: string; language: 'zh' | 'en' }
export interface OfflineManifestOptions extends PrepareOfflineCampaign {
  now?: number
  expiresAt?: number
  tasks?: CampaignTaskSpec[]
  budget?: CampaignBudget
  bodyTarget?: number
  fixtureVersion?: string
  identity?: CampaignRuntimeIdentity
}
const defaultTasks = (): CampaignTaskSpec[] => [
  { id: 'outline', kind: 'outline', chapterOrdinal: null, dependsOn: [] },
  { id: 'characters', kind: 'character_bible', chapterOrdinal: null, dependsOn: ['outline'] },
  { id: 'details', kind: 'detailed_outline', chapterOrdinal: null, dependsOn: ['outline', 'characters'] },
  { id: 'chapter-1-outline', kind: 'chapter_outline', chapterOrdinal: 1, dependsOn: ['details', 'characters'] },
  { id: 'chapter-1-body', kind: 'chapter_body', chapterOrdinal: 1, dependsOn: ['chapter-1-outline'] },
]
export async function createOfflineCampaignManifest(options: OfflineManifestOptions): Promise<CampaignManifest> {
  const now = options.now ?? Date.now()
  const identity = options.identity ?? getCampaignBuildIdentity()
  const budget: CampaignBudget = options.budget ?? { attempts: 128, inputBytes: 8_388_608, inputUtf16: 8_388_608, outputTokens: 8_388_608,
    reasoningTokens: 0, responseBytes: 8_388_608, activeMs: 1_600_000, serializedBytes: 67_108_864, storageReservedBytes: 67_108_864, artifacts: 256, operations: 2048 }
  return sealCampaignManifest({ schemaVersion: 1, protocolVersion: 'campaign-v1', campaignId: options.campaignId, candidateId: 'candidate-0',
    language: options.language, bodyTarget: { unit: 'unicode_scalar', characters: options.bodyTarget ?? 1_000_000 }, mode: 'offline_fixture', adapterId: 'offline-fixture-v1',
    fixtureVersion: options.fixtureVersion ?? 'tiny-bilingual-v1', countingVersion: 'crlf-lf-nfc-scalar-v1', runtimeIdentity: identity.runtimeIdentity, source: { ...identity.source },
    createdAt: now, expiresAt: options.expiresAt ?? now + 7 * 86_400_000, maxRepairRounds: 0, maxProviderRetries: 0,
    tasks: options.tasks ?? defaultTasks(), budget, recoveryReserveBytes: 524_288 })
}
const stateOf = (snapshot: CampaignSnapshot): CampaignState => {
  const c = snapshot.checkpoint
  return { status: c.status, reason: c.reason, executionEpoch: c.executionEpoch, candidateId: c.candidateId,
    tasks: structuredClone(c.tasks), budget: { ...c.budget }, lastWallTime: c.lastWallTime }
}
const requestRef = (request: CampaignRequest) => ({ id: request.id, revision: request.revision, hash: request.hash })
const artifactRef = (artifact: CampaignArtifact) => ({ taskId: artifact.taskId, revision: artifact.revision, hash: artifact.hash })
const newCommand = () => `op-${crypto.randomUUID()}`
const terminal = (snapshot: CampaignSnapshot) => snapshot.head.status === 'cancelled' || snapshot.head.status === 'completed'
interface Run { id: string; controller: AbortController; epoch: number | null; startedAt: number }

/** Generic orchestration over a repository and an explicit host capability. No stored JSON supplies authority. */
export function createCampaignEngine(options: CampaignEngineOptions) {
  if (!isOfflineCampaignHost(options.host) || options.host.provider.id !== 'offline-fixture-v1' || options.host.provider.capabilities.network !== false) throw new CampaignRuntimeError('unsupported_authority')
  const identity = options.identity ?? getCampaignBuildIdentity()
  const repository = options.repository ?? createCampaignRepository()
  const host = options.host, provider = host.provider, clock = options.clock ?? Date.now
  const ioTimeout = options.ioTimeoutMs ?? CAMPAIGN_IO_TIMEOUT_MS, dispatchTimeout = options.dispatchTimeoutMs ?? CAMPAIGN_DISPATCH_TIMEOUT_MS
  if (![ioTimeout, dispatchTimeout].every(n => Number.isSafeInteger(n) && n > 0 && n <= 10_000)) throw new CampaignRuntimeError('timeout_invalid')
  const runs = new Map<string, Run>(), commands = new Map<string, Promise<CampaignSnapshot>>()
  let disposed = false
  function stopLocal(id?: string) {
    for (const [key, run] of runs) if (id === undefined || key === id) { run.controller.abort(); runs.delete(key) }
  }
  function assertRun(run?: Run) {
    if (run && performance.now() - run.startedAt >= 10_000) run.controller.abort()
    if (disposed || (run && (run.controller.signal.aborted || runs.get(run.id) !== run))) throw new CampaignRuntimeError('local_stopped')
  }
  function bounded<T>(promise: Promise<T>, timeout = ioTimeout, run?: Run): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error: unknown, value?: T) => {
        if (settled) return
        settled = true; clearTimeout(timer); run?.controller.signal.removeEventListener('abort', abort)
        if (error) reject(error); else resolve(value as T)
      }
      const abort = () => finish(new CampaignRuntimeError('local_stopped'))
      const remaining = run ? Math.max(0, 10_000 - (performance.now() - run.startedAt)) : timeout
      const timer = setTimeout(() => { finish(new CampaignRuntimeError('operation_timeout')); run?.controller.abort() }, Math.min(timeout, remaining))
      run?.controller.signal.addEventListener('abort', abort, { once: true })
      if (run?.controller.signal.aborted) abort()
      promise.then(value => finish(null, value), error => finish(error))
    })
  }
  async function read(id: string, run?: Run): Promise<CampaignSnapshot> {
    assertRun(run)
    const snapshot = await bounded(repository.read(id), ioTimeout, run)
    assertRun(run)
    if (!snapshot) throw new CampaignRuntimeError('campaign_missing')
    if (snapshot.manifest.runtimeIdentity !== identity.runtimeIdentity || snapshot.manifest.source.commit !== identity.source.commit || snapshot.manifest.source.tree !== identity.source.tree) throw new CampaignRuntimeError('runtime_identity_changed')
    if (run?.epoch !== null && run?.epoch !== undefined && snapshot.head.executionEpoch !== run.epoch) throw new CampaignRuntimeError('stale_owner')
    return snapshot
  }
  function checkClock(snapshot: CampaignSnapshot) { checkCampaignClock(snapshot.manifest, snapshot.checkpoint.lastWallTime, clock()) }
  async function commit(snapshot: CampaignSnapshot, mutation: CampaignMutation, run?: Run) {
    assertRun(run)
    const result = await bounded(repository.commit(snapshot, mutation, () => !disposed && (!run || (runs.get(run.id) === run && !run.controller.signal.aborted && performance.now() - run.startedAt < 10_000))), ioTimeout, run)
    assertRun(run)
    return result
  }
  function dependencies(snapshot: CampaignSnapshot, taskId: string): CampaignArtifact[] {
    const spec = snapshot.manifest.tasks.find(task => task.id === taskId)
    if (!spec) throw new CampaignRuntimeError('unknown_task')
    return spec.dependsOn.map(id => {
      const state = snapshot.checkpoint.tasks.find(task => task.taskId === id)
      const artifact = state?.artifact && snapshot.artifacts.get(state.artifact.hash)
      if (!state || state.status !== 'committed' || !artifact || artifact.taskRevision !== state.revision) throw new CampaignRuntimeError('dependency_unavailable')
      return artifact
    })
  }
  function context(snapshot: CampaignSnapshot, task: CampaignTaskState): CampaignProviderContext {
    return { manifest: snapshot.manifest, candidateId: snapshot.checkpoint.candidateId, task: snapshot.manifest.tasks.find(item => item.id === task.taskId)!, taskRevision: task.revision, dependencies: dependencies(snapshot, task.taskId) }
  }
  async function updateRequest(request: CampaignRequest, patch: Partial<Pick<CampaignRequest, 'status' | 'response' | 'failureReason'>>): Promise<CampaignRequest> {
    const { hash: _hash, ...value } = request
    return sealCampaignRequest({ ...value, ...patch, revision: request.revision + 1, parentHash: request.hash })
  }
  function withRequest(snapshot: CampaignSnapshot, request: CampaignRequest): CampaignState {
    const next = stateOf(snapshot), task = next.tasks.find(task => task.taskId === request.taskId)
    if (!task || task.revision !== request.taskRevision || request.candidateId !== next.candidateId) throw new CampaignRuntimeError('stale_request')
    task.status = request.status; task.request = requestRef(request)
    next.lastWallTime = clock()
    return next
  }
  async function failClosed(id: string, run: Run, reason: string): Promise<CampaignSnapshot> {
    const snapshot = await read(id, run)
    if (terminal(snapshot) || snapshot.head.status === 'paused') return snapshot
    const next = stateOf(snapshot)
    next.status = 'blocked'; next.reason = reason; next.executionEpoch++
    const recoveryTime = emptyCampaignBudget(); recoveryTime.activeMs = 10_000
    next.budget = reserveCampaignBudget(snapshot.manifest, next.budget, recoveryTime, true)
    const current = next.tasks.find(task => task.status === 'dispatch_intent')
    const previous = current?.request && snapshot.requests.get(current.request.hash)
    const unknown = previous ? await updateRequest(previous, { status: 'outcome_unknown', failureReason: reason }) : null
    if (current && unknown) { current.status = 'outcome_unknown'; current.request = requestRef(unknown) }
    next.lastWallTime = Math.max(snapshot.checkpoint.lastWallTime, clock())
    const result = await commit(snapshot, { operationId: `block-${snapshot.head.sequence}-${reason}`.slice(0, 128), kind: 'block', next, ...(unknown ? { requests: [unknown] } : {}) }, run)
    run.epoch = result.snapshot.head.executionEpoch
    return result.snapshot
  }
  async function saveResponse(snapshot: CampaignSnapshot, request: CampaignRequest, run: Run): Promise<CampaignSnapshot> {
    checkClock(snapshot); assertRun(run)
    if (snapshot.head.status !== 'running' || request.status !== 'response_retained' || !request.response) throw new CampaignRuntimeError('save_not_eligible')
    const task = snapshot.checkpoint.tasks.find(t => t.taskId === request.taskId)!
    if (task.request?.hash !== request.hash || task.revision !== request.taskRevision) throw new CampaignRuntimeError('stale_request')
    const refs = dependencies(snapshot, request.taskId).map(artifactRef)
    const artifact = await bounded(sealCampaignArtifact({ schemaVersion: 1, campaignId: snapshot.manifest.campaignId, candidateId: request.candidateId,
      taskId: request.taskId, taskRevision: request.taskRevision, revision: task.priorArtifact ? task.priorArtifact.revision + 1 : 0, kind: snapshot.manifest.tasks.find(t => t.id === task.taskId)!.kind,
      dependencies: refs, parentHash: task.priorArtifact?.hash ?? null, text: request.response.text, semanticStatus: 'not_reviewed' }), ioTimeout, run)
    const committed = await updateRequest(request, { status: 'committed' })
    assertRun(run)
    const next = withRequest(snapshot, committed)
    next.tasks.find(t => t.taskId === task.taskId)!.artifact = artifactRef(artifact)
    next.status = next.tasks.every(t => t.status === 'committed') ? 'completed' : 'running'; next.reason = null
    try {
      return (await commit(snapshot, { operationId: `${request.commandId}:artifact`, kind: 'accept_artifact', next, artifacts: [artifact], requests: [committed] }, run)).snapshot
    } catch (error) {
      // A durable matching receipt confirms this logical save, even when its acknowledgment was lost.
      const receipt = await bounded(repository.getReceipt(snapshot.manifest.campaignId, `${request.commandId}:artifact`))
      if (receipt?.kind === 'accept_artifact' && receipt.artifactHashes.length === 1 && receipt.artifactHashes[0] === artifact.hash && receipt.requestHashes.length === 1 && receipt.requestHashes[0] === committed.hash) {
        const current = await bounded(repository.read(snapshot.manifest.campaignId))
        if (current) return current
      }
      throw error
    }
  }
  async function retainResponse(snapshot: CampaignSnapshot, request: CampaignRequest, response: CampaignResponse, run: Run): Promise<CampaignSnapshot> {
    assertRun(run); checkClock(snapshot)
    if (snapshot.head.status !== 'running') throw new CampaignRuntimeError('result_not_eligible')
    if (response.requestId !== request.id || response.inputDigest !== request.inputDigest || utf8Bytes(response.text) > request.reservation.responseBytes) throw new CampaignRuntimeError('response_invalid')
    const retained = await updateRequest(request, { status: 'response_retained', response, failureReason: null })
    assertRun(run)
    return (await commit(snapshot, { operationId: `${request.commandId}:retain`, kind: 'retain_response', next: withRequest(snapshot, retained), requests: [retained] }, run)).snapshot
  }
  async function executeStep(id: string, commandId: string): Promise<CampaignSnapshot> {
    campaignId(commandId)
    if (commandId.length > 100) throw new CampaignRuntimeError('command_id_too_long')
    assertRun()
    if (runs.has(id)) throw new CampaignRuntimeError('operation_in_progress')
    const run: Run = { id, controller: new AbortController(), epoch: null, startedAt: performance.now() }; runs.set(id, run)
    try {
      let snapshot = await read(id, run); run.epoch = snapshot.head.executionEpoch
      // Duplicate business commands are read-only even after completion, budget exhaustion or restart.
      const commandReceipt = await bounded(repository.getReceipt(id, `${commandId}:artifact`), ioTimeout, run)
      if (commandReceipt) {
        if (commandReceipt.kind !== 'accept_artifact') throw new CampaignRuntimeError('operation_conflict')
        return snapshot
      }
      if (await bounded(repository.getReceipt(id, commandId), ioTimeout, run)) throw new CampaignRuntimeError('operation_conflict')
      for (const [suffix, kind] of [['start', 'start'], ['reserve', 'reserve'], ['continue', 'resume']] as const) {
        const prior = await bounded(repository.getReceipt(id, `${commandId}:${suffix}`), ioTimeout, run)
        if (prior) { if (prior.kind !== kind) throw new CampaignRuntimeError('operation_conflict'); return snapshot }
      }
      if ([...snapshot.requests.values()].some(request => request.commandId === commandId && request.status === 'committed')) return snapshot
      if (terminal(snapshot) || snapshot.head.status === 'paused' || snapshot.head.status === 'blocked') return snapshot
      checkClock(snapshot)
      if (snapshot.head.status === 'prepared') {
        const next = stateOf(snapshot); next.status = 'running'; next.executionEpoch++; next.lastWallTime = clock()
        next.budget = reserveCampaignBudget(snapshot.manifest, next.budget, campaignMetadataReservation(next.tasks.length))
        snapshot = (await commit(snapshot, { operationId: `${commandId}:start`, kind: 'start', next }, run)).snapshot
        run.epoch = snapshot.head.executionEpoch
      }
      let task = snapshot.checkpoint.tasks.find(t => t.status !== 'committed')
      if (!task) return snapshot
      let request = task.request ? snapshot.requests.get(task.request.hash) : undefined
      if (request) {
        if (await bounded(repository.getReceipt(id, `${commandId}:continue`), ioTimeout, run)) return snapshot
        const next = stateOf(snapshot); next.executionEpoch++; next.lastWallTime = clock()
        const delta = campaignMetadataReservation(next.tasks.length); delta.activeMs = 10_000
        next.budget = reserveCampaignBudget(snapshot.manifest, next.budget, delta)
        snapshot = (await commit(snapshot, { operationId: `${commandId}:continue`, kind: 'resume', next }, run)).snapshot
        run.epoch = snapshot.head.executionEpoch
      }
      if (request?.status === 'response_retained') return await saveResponse(snapshot, request, run)
      if (request?.status === 'dispatch_intent' || request?.status === 'outcome_unknown') {
        // A committed intent is never replayed, even if this fixture could regenerate the same text.
        const response = await bounded(provider.reconcile(request), ioTimeout, run)
        if (!response) return await failClosed(id, run, 'dispatch_outcome_unknown')
        snapshot = await retainResponse(snapshot, request, response, run)
        request = snapshot.requests.get(snapshot.checkpoint.tasks.find(t => t.taskId === task!.taskId)!.request!.hash)!
        return await saveResponse(snapshot, request, run)
      }
      if (request?.status === 'known_failed') return await failClosed(id, run, 'provider_failed')
      const prepared = await bounded(provider.prepareRequest(context(snapshot, task)), ioTimeout, run)
      assertRun(run); checkClock(snapshot)
      if (request) {
        if (request.status !== 'reserved' || request.inputDigest !== prepared.digest || request.preparedInput !== prepared.text) throw new CampaignRuntimeError('prepared_identity_changed')
      } else {
        const reservation = campaignRequestReservation(prepared.bytes, prepared.utf16, snapshot.checkpoint.tasks.length, prepared.responseBytes)
        const next = stateOf(snapshot)
        next.budget = reserveCampaignBudget(snapshot.manifest, next.budget, reservation)
        const requestId = `req-${(await hashCampaignValue('request-identity', { campaignId: id, candidateId: next.candidateId, taskId: task.taskId, revision: task.revision, commandId })).slice(0, 48)}`
        request = await sealCampaignRequest({ schemaVersion: 1, campaignId: id, id: requestId, revision: 0, parentHash: null, taskId: task.taskId,
          taskRevision: task.revision, candidateId: next.candidateId, adapterId: provider.id, inputDigest: prepared.digest, preparedInput: prepared.text,
          commandId, inputBytes: prepared.bytes, inputUtf16: prepared.utf16, status: 'reserved', reservation, response: null, failureReason: null })
        const reservedTask = next.tasks.find(t => t.taskId === task!.taskId)!
        reservedTask.status = 'reserved'; reservedTask.request = requestRef(request); next.lastWallTime = clock()
        const result = await commit(snapshot, { operationId: `${commandId}:reserve`, kind: 'reserve', next, requests: [request] }, run)
        snapshot = result.snapshot
        if (result.replayed) return snapshot
      }
      // Refresh the actual durable head immediately before the authorization CAS.
      snapshot = await read(id, run); checkClock(snapshot)
      task = snapshot.checkpoint.tasks.find(t => t.taskId === request!.taskId)!
      if (snapshot.head.status !== 'running' || task.request?.hash !== request.hash || task.status !== 'reserved') throw new CampaignRuntimeError('stale_request')
      const intent = await updateRequest(request, { status: 'dispatch_intent' })
      const result = await commit(snapshot, { operationId: `${request.commandId}:intent`, kind: 'dispatch_intent', next: withRequest(snapshot, intent), requests: [intent] }, run)
      snapshot = result.snapshot
      if (result.replayed) return await failClosed(id, run, 'dispatch_outcome_unknown')
      assertRun(run)
      // This durable intent, not a local flag, is the external authorization linearization.
      // A subsequent cross-tab cancel cannot retract it or promise zero calls/cost.
      const permit = host.issuePermit(intent)
      const response = await bounded(provider.dispatch(intent, permit, run.controller.signal), dispatchTimeout, run)
      snapshot = await read(id, run)
      const currentTask = snapshot.checkpoint.tasks.find(t => t.taskId === intent.taskId)
      if (snapshot.head.status !== 'running' || currentTask?.request?.hash !== intent.hash) throw new CampaignRuntimeError('stale_request')
      snapshot = await retainResponse(snapshot, intent, response, run)
      const retained = snapshot.requests.get(snapshot.checkpoint.tasks.find(t => t.taskId === intent.taskId)!.request!.hash)!
      return await saveResponse(snapshot, retained, run)
    } catch (error) {
      const code = error instanceof CampaignRuntimeError || error instanceof CampaignProtocolError ? error.code : 'persistence_or_integrity'
      if (code === 'operation_conflict') throw error
      if (code === 'conflict') { const current = await bounded(repository.read(id)); if (current) return current }
      if (code === 'local_stopped' || code === 'stale_owner' || code === 'stale_request') {
        const snapshot = await bounded(repository.read(id))
        if (snapshot) return snapshot
      }
      if (code === 'operation_timeout' && runs.get(id) === run) {
        const recoveryRun: Run = { id, controller: new AbortController(), epoch: run.epoch, startedAt: performance.now() }; runs.set(id, recoveryRun)
        try { return await failClosed(id, recoveryRun, code) } catch { /* The outcome remains unconfirmed if the fence cannot persist. */ }
        finally { recoveryRun.controller.abort(); if (runs.get(id) === recoveryRun) runs.delete(id) }
      }
      if (!run.controller.signal.aborted && runs.get(id) === run) {
        try { return await failClosed(id, run, code) } catch { /* Unknown write/owner outcome must not be presented as globally blocked. */ }
      }
      throw error
    } finally {
      run.controller.abort()
      if (runs.get(id) === run) runs.delete(id)
    }
  }
  function step(id: string, commandId = newCommand()): Promise<CampaignSnapshot> {
    const key = `${id}/${commandId}`, previous = commands.get(key)
    if (previous) return previous
    const promise = executeStep(id, commandId).finally(() => { if (commands.get(key) === promise) commands.delete(key) })
    commands.set(key, promise)
    return promise
  }
  async function control(id: string, kind: 'pause' | 'resume' | 'cancel', commandId: string): Promise<CampaignSnapshot> {
    campaignId(commandId); assertRun()
    const run: Run = { id, controller: new AbortController(), epoch: null, startedAt: performance.now() }; runs.set(id, run)
    try {
      let snapshot = await read(id, run); run.epoch = snapshot.head.executionEpoch
      const receipt = await bounded(repository.getReceipt(id, commandId), ioTimeout, run)
      if (receipt) {
        if (receipt.kind !== kind) throw new CampaignRuntimeError('operation_conflict')
        return snapshot
      }
      if (snapshot.head.status === 'cancelled' || (snapshot.head.status === 'completed' && kind !== 'cancel')) return snapshot
      if (kind === 'pause' && snapshot.head.status === 'paused') return snapshot
      const next = stateOf(snapshot)
      next.executionEpoch++
      next.lastWallTime = Math.max(clock(), next.lastWallTime)
      next.status = kind === 'cancel' ? 'cancelled' : kind === 'pause' ? 'paused' : 'running'
      next.reason = kind === 'cancel' ? 'user_cancelled' : kind === 'pause' ? 'user_paused' : null
      if (kind === 'resume') {
        checkClock(snapshot)
        next.budget = reserveCampaignBudget(snapshot.manifest, next.budget, campaignMetadataReservation(next.tasks.length))
      } else {
        const delta = emptyCampaignBudget(); delta.activeMs = 10_000
        next.budget = reserveCampaignBudget(snapshot.manifest, next.budget, delta, true)
      }
      snapshot = (await commit(snapshot, { operationId: commandId, kind, next }, run)).snapshot
      return snapshot
    } finally { run.controller.abort(); if (runs.get(id) === run) runs.delete(id) }
  }
  async function recoverSaveOnly(id: string, commandId = newCommand()): Promise<CampaignSnapshot> {
    stopLocal(id); campaignId(commandId); assertRun()
    const run: Run = { id, controller: new AbortController(), epoch: null, startedAt: performance.now() }; runs.set(id, run)
    try {
      let snapshot = await read(id, run); run.epoch = snapshot.head.executionEpoch
      const previous = await bounded(repository.getReceipt(id, commandId), ioTimeout, run)
      if (previous) {
        if (previous.kind !== 'reconcile') throw new CampaignRuntimeError('operation_conflict')
        return snapshot
      }
      if (snapshot.head.status === 'cancelled' || snapshot.head.status === 'completed') return snapshot
      const task = snapshot.checkpoint.tasks.find(task => task.status === 'response_retained')
      const request = task?.request && snapshot.requests.get(task.request.hash)
      if (!request || request.status !== 'response_retained') throw new CampaignRuntimeError('no_retained_response')
      checkClock(snapshot)
      const next = stateOf(snapshot); next.executionEpoch++; next.status = 'running'; next.reason = null; next.lastWallTime = clock()
      const delta = emptyCampaignBudget(); delta.activeMs = 10_000
      next.budget = reserveCampaignBudget(snapshot.manifest, next.budget, delta, true)
      snapshot = (await commit(snapshot, { operationId: commandId, kind: 'reconcile', next }, run)).snapshot
      run.epoch = snapshot.head.executionEpoch
      return await saveResponse(snapshot, request, run)
    } finally { run.controller.abort(); if (runs.get(id) === run) runs.delete(id) }
  }
  async function replaceCandidate(id: string, taskId: string, text: string, commandId = newCommand()): Promise<CampaignSnapshot> {
    stopLocal(id); assertRun()
    const run: Run = { id, controller: new AbortController(), epoch: null, startedAt: performance.now() }; runs.set(id, run)
    try {
    let snapshot = await read(id, run); run.epoch = snapshot.head.executionEpoch
    const priorReceipt = await bounded(repository.getReceipt(id, commandId))
    if (priorReceipt) {
      const priorArtifacts = await bounded(repository.getOperationArtifacts(id, commandId))
      if (priorReceipt.kind !== 'replace_candidate' || priorArtifacts?.length !== 1 || priorArtifacts[0]!.taskId !== taskId || priorArtifacts[0]!.text !== text) throw new CampaignRuntimeError('operation_conflict')
      return snapshot
    }
    if (snapshot.head.status === 'cancelled') throw new CampaignRuntimeError('cancelled')
    checkClock(snapshot)
    const oldTask = snapshot.checkpoint.tasks.find(t => t.taskId === taskId)
    const oldArtifact = oldTask?.artifact && snapshot.artifacts.get(oldTask.artifact.hash)
    if (!oldTask || !oldArtifact) throw new CampaignRuntimeError('replacement_requires_artifact')
    const next = stateOf(snapshot), candidateId = `candidate-${(await hashCampaignValue('candidate', { id, commandId })).slice(0, 32)}`
    const affected = new Set([taskId])
    for (const spec of snapshot.manifest.tasks) if (spec.dependsOn.some(id => affected.has(id))) affected.add(spec.id)
    for (const task of next.tasks) if (affected.has(task.taskId)) { task.revision++; task.status = 'invalidated'; task.priorArtifact = task.artifact ?? task.priorArtifact; task.artifact = null; task.request = null }
    const artifact = await sealCampaignArtifact({ schemaVersion: 1, campaignId: id, candidateId, taskId, taskRevision: oldTask.revision + 1,
      revision: oldArtifact.revision + 1, parentHash: oldArtifact.hash, kind: oldArtifact.kind, dependencies: dependencies(snapshot, taskId).map(artifactRef), text, semanticStatus: 'not_reviewed' })
    const target = next.tasks.find(t => t.taskId === taskId)!
    target.status = 'committed'; target.artifact = artifactRef(artifact)
    next.candidateId = candidateId; next.executionEpoch++; next.status = 'paused'; next.reason = 'candidate_replaced'; next.lastWallTime = clock()
    const reservation = campaignMetadataReservation(next.tasks.length); reservation.storageReservedBytes += utf8Bytes(text) * 6 + 16_384
    next.budget = reserveCampaignBudget(snapshot.manifest, next.budget, reservation)
    snapshot = (await commit(snapshot, { operationId: commandId, kind: 'replace_candidate', next, artifacts: [artifact] }, run)).snapshot
    return snapshot
    } finally { run.controller.abort(); if (runs.get(id) === run) runs.delete(id) }
  }
  return {
    async prepare(input: PrepareOfflineCampaign | CampaignManifest, commandId?: string) {
      assertRun()
      if (!('schemaVersion' in input)) {
        const existing = await bounded(repository.read(input.campaignId))
        if (existing) {
          const prior = await bounded(repository.getReceipt(input.campaignId, commandId ?? `create-${input.campaignId}`))
          if (prior?.kind !== 'create' || existing.manifest.language !== input.language || existing.manifest.runtimeIdentity !== identity.runtimeIdentity || existing.manifest.source.commit !== identity.source.commit || existing.manifest.source.tree !== identity.source.tree) throw new CampaignRuntimeError('operation_conflict')
          return existing
        }
      }
      const manifest = 'schemaVersion' in input ? input : await createOfflineCampaignManifest({ ...input, now: clock(), identity })
      if (manifest.runtimeIdentity !== identity.runtimeIdentity || manifest.source.commit !== identity.source.commit || manifest.source.tree !== identity.source.tree) throw new CampaignRuntimeError('runtime_identity_changed')
      return (await bounded(repository.create(manifest, commandId ?? `create-${manifest.campaignId}`))).snapshot
    },
    step,
    pause(id: string, commandId = newCommand()) { stopLocal(id); return control(id, 'pause', commandId) },
    resume(id: string, commandId = newCommand()) { stopLocal(id); return control(id, 'resume', commandId) },
    cancel(id: string, commandId = newCommand()) { stopLocal(id); return control(id, 'cancel', commandId) },
    replaceCandidate,
    recoverSaveOnly,
    inspect(id: string) { return bounded(repository.read(id)) },
    list() { return bounded(repository.list()) },
    stopLocal,
    dispose() { stopLocal(); disposed = true },
  }
}
export function createOfflineCampaignEngine(options: OfflineCampaignEngineOptions = {}) {
  return createCampaignEngine({ ...options, host: options.host ?? createOfflineFixtureHost(options.fixture) })
}
export type OfflineCampaignEngine = ReturnType<typeof createOfflineCampaignEngine>
