import type { CampaignActionScope, CampaignArtifact, CampaignBudget, CampaignManifest, CampaignMutation, CampaignRepository, CampaignRequest, CampaignResponse, CampaignSnapshot, CampaignState, CampaignTaskSpec, CampaignTaskState } from '../../types/writerCampaign'
import { createCampaignRepository } from './store'
import { getCampaignBuildIdentity } from './buildIdentity'
import { CampaignProtocolError, campaignId, encodeStorageBytes, hashCampaignValue, hashText, sealCampaignArtifact, sealCampaignManifest, sealCampaignRequest, utf8Bytes } from './protocol'
import { CampaignRuntimeError, CAMPAIGN_DISPATCH_TIMEOUT_MS, CAMPAIGN_IO_TIMEOUT_MS, campaignMetadataReservation, campaignRequestReservation, campaignRequestStorageAllowance, checkCampaignClock, emptyCampaignBudget, reserveCampaignBudget } from './budget'
import { createOfflineFixtureHost, isOfflineCampaignHost, type CampaignAuthorizationHost, type CampaignProviderContext, type OfflineFixtureOptions } from './fixtureAdapter'

import { isPlanningProfile, planningManifestOptions, PLANNING_THREE_CHAPTER_PROFILE, BODY_EVIDENCE_THREE_CHAPTER_PROFILE } from './planningProfile'
import { compilePlanningContext, type PlanningPreviewResult } from './planningContext'
import { PlanningRefusalError } from './planningProtocol'
import { PlanningValidationView } from './planningValidation'
import { compileBodyEvidence } from './bodyEvidence'
import { BodyEvidenceRefusalError, parseBodyEvidenceProposal, type BodyEvidencePreviewResult } from './bodyEvidenceProtocol'

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
    reasoningTokens: 0, responseBytes: 8_388_608, activeMs: 1_600_000, artifacts: 256, operations: 2048 }
  return sealCampaignManifest({ schemaVersion: 2, protocolVersion: 'campaign-v2', campaignId: options.campaignId, candidateId: 'candidate-0',
    language: options.language, bodyTarget: { unit: 'unicode_scalar', characters: options.bodyTarget ?? 1_000_000 }, mode: 'offline_fixture', adapterId: 'offline-fixture-v1',
    fixtureVersion: options.fixtureVersion ?? 'tiny-bilingual-v1', countingVersion: 'crlf-lf-nfc-scalar-v1', runtimeIdentity: identity.runtimeIdentity, source: { ...identity.source },
    createdAt: now, expiresAt: options.expiresAt ?? now + 7 * 86_400_000, maxRepairRounds: 0, maxProviderRetries: 0,
    tasks: options.tasks ?? defaultTasks(), budget, storage: { limitBytes: encodeStorageBytes(67_108_864), recoveryReserveBytes: encodeStorageBytes(524_288) } })
}
const stateOf = (snapshot: CampaignSnapshot): CampaignState => {
  const c = snapshot.checkpoint
  return { status: c.status, reason: c.reason, executionEpoch: c.executionEpoch, candidateId: c.candidateId,
    tasks: structuredClone(c.tasks), budget: { ...c.budget }, storage: structuredClone(c.storage), lastWallTime: c.lastWallTime }
}
const requestRef = (request: CampaignRequest) => ({ id: request.id, revision: request.revision, hash: request.hash })
const artifactRef = (artifact: CampaignArtifact) => ({ taskId: artifact.taskId, revision: artifact.revision, hash: artifact.hash })
const newCommand = () => `op-${crypto.randomUUID()}`
const terminal = (snapshot: CampaignSnapshot) => snapshot.head.status === 'cancelled' || snapshot.head.status === 'completed'
export const CAMPAIGN_TIMEOUT_DIAGNOSTIC_LIMIT = 8
export const CAMPAIGN_TIMEOUT_PHASES = Object.freeze(['read', 'receipt', 'commit', 'prepare', 'dispatch', 'reconcile', 'save', 'recovery_read', 'recovery_receipt', 'recovery_commit'] as const)
export type CampaignTimeoutPhase = typeof CAMPAIGN_TIMEOUT_PHASES[number]
export interface CampaignTimeoutDiagnostic {
  phase: CampaignTimeoutPhase
  trigger: 'timer' | 'action_deadline_check'
  selectedBudget: 'operation' | 'action' | 'tie'
  operationTimeoutMs: number | null
  actionTimeoutMs: number | null
  actionRemainingMs: number | null
  scheduledTimeoutMs: number | null
  operationElapsedMs: number | null
  actionElapsedMs: number | null
}
export interface CampaignTimeoutDiagnostics {
  status: 'not_collected' | 'not_observed' | 'observed'
  events: CampaignTimeoutDiagnostic[]
  overflow: number
}
export const CAMPAIGN_OPERATION_TIMING_UPPER_MS = Object.freeze([1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 3000, 5000, 10000, Infinity] as const)
export interface CampaignOperationTiming {
  phase: CampaignTimeoutPhase
  count: number
  success: number
  error: number
  abort: number
  timeout: number
  minMs: number | null
  maxMs: number | null
  histogram: number[]
}
export interface CampaignOperationTimings {
  status: 'collected' | 'not_collected'
  phases: CampaignOperationTiming[]
}
const emptyOperationTimings = (): CampaignOperationTiming[] => CAMPAIGN_TIMEOUT_PHASES.map(phase => ({
  phase, count: 0, success: 0, error: 0, abort: 0, timeout: 0, minMs: null, maxMs: null,
  histogram: Array<number>(CAMPAIGN_OPERATION_TIMING_UPPER_MS.length).fill(0),
}))
interface PreviewRun { id: string; controller: AbortController; startedAt: number }
interface Run { id: string; controller: AbortController; epoch: number | null; startedAt: number; phase: CampaignTimeoutPhase; recovering?: boolean; deadlineObserved?: boolean; scope?: CampaignActionScope }

/** Generic orchestration over a repository and an explicit host capability. No stored JSON supplies authority. */
export function createCampaignEngine(options: CampaignEngineOptions) {
  if (!isOfflineCampaignHost(options.host) || options.host.provider.id !== 'offline-fixture-v1' || options.host.provider.capabilities.network !== false) throw new CampaignRuntimeError('unsupported_authority')
  const identity = options.identity ?? getCampaignBuildIdentity()
  const repository = options.repository ?? createCampaignRepository()
  const host = options.host, provider = host.provider, clock = options.clock ?? Date.now
  const ioTimeout = options.ioTimeoutMs ?? CAMPAIGN_IO_TIMEOUT_MS, dispatchTimeout = options.dispatchTimeoutMs ?? CAMPAIGN_DISPATCH_TIMEOUT_MS
  if (![ioTimeout, dispatchTimeout].every(n => Number.isSafeInteger(n) && n > 0 && n <= 10_000)) throw new CampaignRuntimeError('timeout_invalid')
  const runs = new Map<string, Run>(), commands = new Map<string, Promise<CampaignSnapshot>>()
  let activePreview: PreviewRun | null = null
  let disposed = false
  function disposeScope(run?: Run) {
    const scope = run?.scope
    if (!run || !scope) return
    // Drop local authority before calling an injected repository's cleanup. A
    // late promise can never acquire this Run's capability again.
    run.scope = undefined
    try { repository.disposeActionScope?.(scope) } catch { /* Cache cleanup must not change the action outcome. */ }
  }
  function beginRun(id: string, scoped = true): Run {
    cancelPreviews(id)
    const run: Run = { id, controller: new AbortController(), epoch: null, startedAt: performance.now(), phase: 'read' }
    runs.set(id, run)
    run.controller.signal.addEventListener('abort', () => disposeScope(run), { once: true })
    // Both optional methods are needed: old/injected repositories continue on
    // their ordinary cold path, never through a bypass around read/commit.
    if (scoped && repository.createActionScope && repository.disposeActionScope) {
      try { run.scope = repository.createActionScope(id) } catch { /* Proof admission is optional. */ }
    }
    if (run.controller.signal.aborted || runs.get(id) !== run) disposeScope(run)
    return run
  }
  /** Preview revocation never takes durable Run ownership. */
  function cancelPreviews(id?: string) {
    const current = activePreview
    if (current && (id === undefined || id === current.id)) {
      activePreview = null
      current.controller.abort()
    }
  }
  function stopLocal(id?: string) {
    cancelPreviews(id)
    for (const [key, run] of runs) if (id === undefined || key === id) { run.controller.abort(); runs.delete(key) }
  }
  // Engine-local, bounded and source-free. Observation has no callbacks, durable
  // state or authority; a failed diagnostic must never change the command result.
  const timeoutEvents: CampaignTimeoutDiagnostic[] = []
  let timeoutOverflow = 0
  // Fixed-size, source-free operation observations. A failed measurement makes
  // the whole report unavailable rather than presenting a partial distribution.
  const operationTimings = emptyOperationTimings()
  let operationTimingsCollected = true
  function recordOperation(phase: CampaignTimeoutPhase, outcome: 'success' | 'error' | 'abort' | 'timeout', start: number | null, end: number | null) {
    if (!operationTimingsCollected) return
    try {
      const elapsed = start === null || end === null ? NaN : end - start
      if (!Number.isFinite(elapsed) || elapsed < 0) { operationTimingsCollected = false; return }
      const row = operationTimings[CAMPAIGN_TIMEOUT_PHASES.indexOf(phase)]!
      if (!Number.isSafeInteger(row.count + 1)) { operationTimingsCollected = false; return }
      let bucket = 0
      while (elapsed >= CAMPAIGN_OPERATION_TIMING_UPPER_MS[bucket]!) bucket++
      row.count++; row[outcome]++; row.histogram[bucket]++
      row.minMs = row.minMs === null ? elapsed : Math.min(row.minMs, elapsed)
      row.maxMs = row.maxMs === null ? elapsed : Math.max(row.maxMs, elapsed)
    } catch { operationTimingsCollected = false }
  }
  function recordTimeout(event: CampaignTimeoutDiagnostic) {
    try {
      if (timeoutEvents.length < CAMPAIGN_TIMEOUT_DIAGNOSTIC_LIMIT) timeoutEvents.push(event)
      else timeoutOverflow = Math.min(Number.MAX_SAFE_INTEGER, timeoutOverflow + 1)
    } catch { /* Diagnostics are best effort, never a runtime failure. */ }
  }
  function recordDeadline(run: Run, elapsed: number) {
    if (run.deadlineObserved) return
    run.deadlineObserved = true
    recordTimeout({ phase: run.phase, trigger: 'action_deadline_check', selectedBudget: 'action',
      operationTimeoutMs: null, actionTimeoutMs: 10_000, actionRemainingMs: null, scheduledTimeoutMs: null,
      operationElapsedMs: null, actionElapsedMs: elapsed })
  }
  function phaseOf(phase: CampaignTimeoutPhase, run?: Run): CampaignTimeoutPhase {
    return run?.recovering && (phase === 'read' || phase === 'receipt' || phase === 'commit') ? `recovery_${phase}` : phase
  }
  function assertRun(run?: Run, phase?: CampaignTimeoutPhase) {
    if (run && phase) run.phase = phaseOf(phase, run)
    if (run) {
      const elapsed = performance.now() - run.startedAt
      if (elapsed >= 10_000) {
        const active = !disposed && !run.controller.signal.aborted && runs.get(run.id) === run
        run.controller.abort()
        if (active) recordDeadline(run, elapsed)
      }
    }
    if (disposed || (run && (run.controller.signal.aborted || runs.get(run.id) !== run))) { disposeScope(run); throw new CampaignRuntimeError('local_stopped') }
  }
  function diagnosticNow(): number | null {
    try {
      const now = performance.now()
      return Number.isFinite(now) && now >= 0 ? now : null
    } catch { return null }
  }
  function canCommit(run?: Run) {
    if (disposed || (run && (runs.get(run.id) !== run || run.controller.signal.aborted))) { disposeScope(run); return false }
    if (run) {
      const elapsed = performance.now() - run.startedAt
      if (elapsed < 10_000) return true
      if (elapsed >= 10_000) recordDeadline(run, elapsed)
      disposeScope(run)
      return false
    }
    return true
  }
  function bounded<T>(operation: () => Promise<T>, phase: CampaignTimeoutPhase, timeout = ioTimeout, run?: Run): Promise<T> {
    const operationStartedAt = diagnosticNow(), observedPhase = phaseOf(phase, run)
    if (operationStartedAt === null) operationTimingsCollected = false
    if (run) run.phase = observedPhase
    // Preserve the existing timer boundary: the operation is invoked before
    // selecting/scheduling its timer. Elapsed time also includes synchronous work.
    let promise: Promise<T>
    try { promise = operation() } catch (error) {
      const observedAt = diagnosticNow()
      disposeScope(run); recordOperation(observedPhase, 'error', operationStartedAt, observedAt); throw error
    }
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error: unknown, value?: T, outcome: 'success' | 'error' | 'abort' | 'timeout' = error ? 'error' : 'success', observedAt?: number | null) => {
        if (settled) return false
        settled = true; clearTimeout(timer); run?.controller.signal.removeEventListener('abort', abort)
        const finishedAt = observedAt === undefined ? diagnosticNow() : observedAt
        if (error) { disposeScope(run); reject(error) } else resolve(value as T)
        recordOperation(observedPhase, outcome, operationStartedAt, finishedAt)
        return true
      }
      const abort = () => { finish(new CampaignRuntimeError('local_stopped'), undefined, 'abort') }
      const remaining = run ? Math.max(0, 10_000 - (performance.now() - run.startedAt)) : timeout
      const scheduledTimeoutMs = Math.min(timeout, remaining)
      const timer = setTimeout(() => {
        // Sample the firing boundary, not time spent in synchronous abort listeners.
        const observedAt = diagnosticNow()
        const won = finish(new CampaignRuntimeError('operation_timeout'), undefined, 'timeout', observedAt)
        run?.controller.abort()
        if (won && observedAt !== null && operationStartedAt !== null) {
          try {
            recordTimeout({ phase: observedPhase, trigger: 'timer',
              selectedBudget: !run || timeout < remaining ? 'operation' : timeout > remaining ? 'action' : 'tie',
              operationTimeoutMs: timeout, actionTimeoutMs: run ? 10_000 : null,
              actionRemainingMs: run ? remaining : null, scheduledTimeoutMs,
              operationElapsedMs: observedAt - operationStartedAt, actionElapsedMs: run ? observedAt - run.startedAt : null })
          } catch { /* A failed observation cannot undo settlement or abort. */ }
        }
      }, scheduledTimeoutMs)
      run?.controller.signal.addEventListener('abort', abort, { once: true })
      if (run?.controller.signal.aborted) abort()
      promise.then(value => finish(null, value), error => finish(error, undefined, 'error'))
    })
  }
  async function read(id: string, run?: Run): Promise<CampaignSnapshot> {
    assertRun(run, 'read')
    const snapshot = await bounded(() => repository.read(id, run?.scope, () => assertRun(run, 'read')), 'read', ioTimeout, run)
    assertRun(run)
    if (!snapshot) throw new CampaignRuntimeError('campaign_missing')
    if (snapshot.manifest.runtimeIdentity !== identity.runtimeIdentity || snapshot.manifest.source.commit !== identity.source.commit || snapshot.manifest.source.tree !== identity.source.tree) throw new CampaignRuntimeError('runtime_identity_changed')
    if (run?.epoch !== null && run?.epoch !== undefined && snapshot.head.executionEpoch !== run.epoch) throw new CampaignRuntimeError('stale_owner')
    return snapshot
  }
  function checkClock(snapshot: CampaignSnapshot) { checkCampaignClock(snapshot.manifest, snapshot.checkpoint.lastWallTime, clock()) }
  async function commit(snapshot: CampaignSnapshot, mutation: CampaignMutation, run?: Run) {
    assertRun(run, 'commit')
    const result = await bounded(() => repository.commit(snapshot, mutation, () => canCommit(run), run?.scope), 'commit', ioTimeout, run)
    assertRun(run)
    if (result.replayed) disposeScope(run)
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
  function context(snapshot: CampaignSnapshot, task: CampaignTaskState, run?: Run): CampaignProviderContext {
    return { manifest: snapshot.manifest, candidateId: snapshot.checkpoint.candidateId, task: snapshot.manifest.tasks.find(item => item.id === task.taskId)!, taskRevision: task.revision, dependencies: dependencies(snapshot, task.taskId), check: () => assertRun(run, 'prepare') }
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
    disposeScope(run)
    run.recovering = true
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
  async function prepareAcceptedArtifact(snapshot: CampaignSnapshot, request: CampaignRequest, run: Run): Promise<CampaignArtifact> {
    const task = snapshot.checkpoint.tasks.find(t => t.taskId === request.taskId)!
    const refs = dependencies(snapshot, request.taskId).map(artifactRef)
    const artifact = await bounded(() => sealCampaignArtifact({ schemaVersion: 2, campaignId: snapshot.manifest.campaignId, candidateId: request.candidateId,
      taskId: request.taskId, taskRevision: request.taskRevision, revision: task.priorArtifact ? task.priorArtifact.revision + 1 : 0, kind: snapshot.manifest.tasks.find(t => t.id === task.taskId)!.kind,
      dependencies: refs, parentHash: task.priorArtifact?.hash ?? null, text: request.response!.text, semanticStatus: 'not_reviewed' }), 'save', ioTimeout, run)
    if (isPlanningProfile(snapshot.manifest)) {
      const validation = new PlanningValidationView(snapshot.manifest, () => assertRun(run, 'save'))
      validation.seed(snapshot.checkpoint, snapshot.artifacts)
      const proposed = stateOf(snapshot), state = proposed.tasks.find(task => task.taskId === request.taskId)!
      state.status = 'committed'; state.artifact = artifactRef(artifact)
      await bounded(() => validation.advance(proposed, 'accept_artifact', [artifact]), 'save', ioTimeout, run)
    }
    return artifact
  }
  async function saveResponse(snapshot: CampaignSnapshot, request: CampaignRequest, run: Run, preparedArtifact?: CampaignArtifact): Promise<CampaignSnapshot> {
    checkClock(snapshot); assertRun(run, 'save')
    if (snapshot.head.status !== 'running' || request.status !== 'response_retained' || !request.response) throw new CampaignRuntimeError('save_not_eligible')
    const task = snapshot.checkpoint.tasks.find(t => t.taskId === request.taskId)!
    if (task.request?.hash !== request.hash || task.revision !== request.taskRevision) throw new CampaignRuntimeError('stale_request')
    const artifact = preparedArtifact ?? await prepareAcceptedArtifact(snapshot, request, run)
    const committed = await updateRequest(request, { status: 'committed' })
    assertRun(run)
    const next = withRequest(snapshot, committed)
    next.tasks.find(t => t.taskId === task.taskId)!.artifact = artifactRef(artifact)
    next.status = next.tasks.every(t => t.status === 'committed') ? 'completed' : 'running'; next.reason = null
    try {
      return (await commit(snapshot, { operationId: `${request.commandId}:artifact`, kind: 'accept_artifact', next, artifacts: [artifact], requests: [committed] }, run)).snapshot
    } catch (error) {
      // A durable matching receipt confirms this logical save, even when its acknowledgment was lost.
      const receipt = await bounded(() => repository.getReceipt(snapshot.manifest.campaignId, `${request.commandId}:artifact`), 'recovery_receipt')
      if (receipt?.kind === 'accept_artifact' && receipt.artifactHashes.length === 1 && receipt.artifactHashes[0] === artifact.hash && receipt.requestHashes.length === 1 && receipt.requestHashes[0] === committed.hash) {
        const current = await bounded(() => repository.read(snapshot.manifest.campaignId), 'recovery_read')
        if (current) return current
      }
      throw error
    }
  }
  async function retainResponse(snapshot: CampaignSnapshot, request: CampaignRequest, response: CampaignResponse, run: Run): Promise<CampaignSnapshot> {
    assertRun(run, 'save'); checkClock(snapshot)
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
    const run = beginRun(id)
    try {
      let snapshot = await read(id, run); run.epoch = snapshot.head.executionEpoch
      // Duplicate business commands are read-only even after completion, budget exhaustion or restart.
      const commandReceipt = await bounded(() => repository.getReceipt(id, `${commandId}:artifact`), 'receipt', ioTimeout, run)
      if (commandReceipt) {
        if (commandReceipt.kind !== 'accept_artifact') throw new CampaignRuntimeError('operation_conflict')
        return snapshot
      }
      if (await bounded(() => repository.getReceipt(id, commandId), 'receipt', ioTimeout, run)) throw new CampaignRuntimeError('operation_conflict')
      for (const [suffix, kind] of [['start', 'start'], ['reserve', 'reserve'], ['continue', 'resume']] as const) {
        const prior = await bounded(() => repository.getReceipt(id, `${commandId}:${suffix}`), 'receipt', ioTimeout, run)
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
        if (await bounded(() => repository.getReceipt(id, `${commandId}:continue`), 'receipt', ioTimeout, run)) return snapshot
        const next = stateOf(snapshot); next.executionEpoch++; next.lastWallTime = clock()
        const delta = campaignMetadataReservation(next.tasks.length); delta.activeMs = 10_000
        next.budget = reserveCampaignBudget(snapshot.manifest, next.budget, delta)
        snapshot = (await commit(snapshot, { operationId: `${commandId}:continue`, kind: 'resume', next }, run)).snapshot
        run.epoch = snapshot.head.executionEpoch
      }
      if (request?.status === 'response_retained') return await saveResponse(snapshot, request, run)
      if (request?.status === 'dispatch_intent' || request?.status === 'outcome_unknown') {
        // A committed intent is never replayed, even if this fixture could regenerate the same text.
        const response = await bounded(() => provider.reconcile(request!), 'reconcile', ioTimeout, run)
        if (!response) return await failClosed(id, run, 'dispatch_outcome_unknown')
        snapshot = await retainResponse(snapshot, request, response, run)
        request = snapshot.requests.get(snapshot.checkpoint.tasks.find(t => t.taskId === task!.taskId)!.request!.hash)!
        return await saveResponse(snapshot, request, run)
      }
      if (request?.status === 'known_failed') return await failClosed(id, run, 'provider_failed')
      const prepared = await bounded(() => provider.prepareRequest(context(snapshot, task!, run)), 'prepare', ioTimeout, run)
      assertRun(run); checkClock(snapshot)
      if (request) {
        if (request.status !== 'reserved' || request.inputDigest !== prepared.digest || request.preparedInput !== prepared.text) throw new CampaignRuntimeError('prepared_identity_changed')
      } else {
        const reservation = campaignRequestReservation(prepared.bytes, prepared.utf16, snapshot.checkpoint.tasks.length, prepared.responseBytes)
        const next = stateOf(snapshot)
        next.budget = reserveCampaignBudget(snapshot.manifest, next.budget, reservation)
        const requestId = `req-${(await hashCampaignValue('request-identity', { campaignId: id, candidateId: next.candidateId, taskId: task.taskId, revision: task.revision, commandId })).slice(0, 48)}`
        request = await sealCampaignRequest({ schemaVersion: 2, campaignId: id, id: requestId, revision: 0, parentHash: null, taskId: task.taskId,
          taskRevision: task.revision, candidateId: next.candidateId, adapterId: provider.id, inputDigest: prepared.digest, preparedInput: prepared.text,
          commandId, inputBytes: prepared.bytes, inputUtf16: prepared.utf16, storageAllocationBytes: campaignRequestStorageAllowance(prepared.text, next.tasks.length, prepared.responseBytes), status: 'reserved', reservation, response: null, failureReason: null })
        const reservedTask = next.tasks.find(t => t.taskId === task!.taskId)!
        reservedTask.status = 'reserved'; reservedTask.request = requestRef(request); next.lastWallTime = clock()
        const result = await commit(snapshot, { operationId: `${commandId}:reserve`, kind: 'reserve', next, requests: [request] }, run)
        snapshot = result.snapshot
        if (result.replayed) return snapshot
      }
      // The repository re-verifies the full durable state and compares this exact
      // raw head/epoch before its authorization CAS. A second engine read would
      // repeat that verification, not strengthen the fence.
      assertRun(run); checkClock(snapshot)
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
      const response = await bounded(() => provider.dispatch(intent, permit, run.controller.signal), 'dispatch', dispatchTimeout, run)
      // Retention commits against the exact intent snapshot. A cross-owner change
      // or same-head corruption is rejected by its fresh repository verification;
      // do not refresh/rebase the old result onto a newer owner or candidate.
      assertRun(run)
      const currentTask = snapshot.checkpoint.tasks.find(t => t.taskId === intent.taskId)
      if (snapshot.head.status !== 'running' || currentTask?.request?.hash !== intent.hash) throw new CampaignRuntimeError('stale_request')
      snapshot = await retainResponse(snapshot, intent, response, run)
      const retained = snapshot.requests.get(snapshot.checkpoint.tasks.find(t => t.taskId === intent.taskId)!.request!.hash)!
      return await saveResponse(snapshot, retained, run)
    } catch (error) {
      disposeScope(run)
      const code = error instanceof CampaignRuntimeError || error instanceof CampaignProtocolError || error instanceof PlanningRefusalError ? error.code : 'persistence_or_integrity'
      if (code === 'operation_conflict') throw error
      if (code === 'conflict') { const current = await bounded(() => repository.read(id), 'recovery_read'); if (current) return current }
      if (code === 'local_stopped' || code === 'stale_owner' || code === 'stale_request') {
        const snapshot = await bounded(() => repository.read(id), 'recovery_read')
        if (snapshot) return snapshot
      }
      if (code === 'operation_timeout' && runs.get(id) === run) {
        const recoveryRun = beginRun(id, false); recoveryRun.epoch = run.epoch
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
    const run = beginRun(id)
    try {
      let snapshot = await read(id, run); run.epoch = snapshot.head.executionEpoch
      const receipt = await bounded(() => repository.getReceipt(id, commandId), 'receipt', ioTimeout, run)
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
    const run = beginRun(id, false)
    try {
      let snapshot = await read(id, run); run.epoch = snapshot.head.executionEpoch
      const previous = await bounded(() => repository.getReceipt(id, commandId), 'receipt', ioTimeout, run)
      if (previous) {
        if (previous.kind !== 'reconcile') throw new CampaignRuntimeError('operation_conflict')
        return snapshot
      }
      if (snapshot.head.status === 'cancelled' || snapshot.head.status === 'completed') return snapshot
      const task = snapshot.checkpoint.tasks.find(task => task.status === 'response_retained')
      const request = task?.request && snapshot.requests.get(task.request.hash)
      if (!request || request.status !== 'response_retained') throw new CampaignRuntimeError('no_retained_response')
      checkClock(snapshot)
      // Validate before restoring running state; malformed retained evidence is
      // inspectable but cannot gain save authority through recovery.
      const artifact = await prepareAcceptedArtifact(snapshot, request, run)
      const next = stateOf(snapshot); next.executionEpoch++; next.status = 'running'; next.reason = null; next.lastWallTime = clock()
      const delta = emptyCampaignBudget(); delta.activeMs = 10_000
      next.budget = reserveCampaignBudget(snapshot.manifest, next.budget, delta, true)
      snapshot = (await commit(snapshot, { operationId: commandId, kind: 'reconcile', next }, run)).snapshot
      run.epoch = snapshot.head.executionEpoch
      return await saveResponse(snapshot, request, run, artifact)
    } catch (error) {
      if (error instanceof PlanningRefusalError && !run.controller.signal.aborted && runs.get(id) === run) {
        try { await failClosed(id, run, error.code) } catch { /* The original typed refusal remains authoritative. */ }
      }
      throw error
    } finally { run.controller.abort(); if (runs.get(id) === run) runs.delete(id) }
  }
  async function replaceCandidate(id: string, taskId: string, text: string, commandId = newCommand()): Promise<CampaignSnapshot> {
    stopLocal(id); assertRun()
    const run = beginRun(id)
    try {
    let snapshot = await read(id, run); run.epoch = snapshot.head.executionEpoch
    const priorReceipt = await bounded(() => repository.getReceipt(id, commandId), 'receipt', ioTimeout, run)
    if (priorReceipt) {
      const priorArtifacts = await bounded(() => repository.getOperationArtifacts(id, commandId), 'read', ioTimeout, run)
      if (priorReceipt.kind !== 'replace_candidate' || priorArtifacts?.length !== 1 || priorArtifacts[0]!.taskId !== taskId || priorArtifacts[0]!.text !== text) throw new CampaignRuntimeError('operation_conflict')
      return snapshot
    }
    if (snapshot.head.status === 'cancelled') throw new CampaignRuntimeError('cancelled')
    checkClock(snapshot)
    const oldTask = snapshot.checkpoint.tasks.find(t => t.taskId === taskId)
    const oldArtifact = oldTask?.artifact && snapshot.artifacts.get(oldTask.artifact.hash)
    if (!oldTask || !oldArtifact) throw new CampaignRuntimeError('replacement_requires_artifact')
    if (isPlanningProfile(snapshot.manifest) && oldArtifact.kind === 'chapter_body') throw new PlanningRefusalError('invalid_planning_payload')
    const next = stateOf(snapshot), candidateId = `candidate-${(await hashCampaignValue('candidate', { id, commandId })).slice(0, 32)}`
    const affected = new Set([taskId])
    for (const spec of snapshot.manifest.tasks) if (spec.dependsOn.some(id => affected.has(id))) affected.add(spec.id)
    for (const task of next.tasks) if (affected.has(task.taskId)) { task.revision++; task.status = 'invalidated'; task.priorArtifact = task.artifact ?? task.priorArtifact; task.artifact = null; task.request = null }
    const artifact = await sealCampaignArtifact({ schemaVersion: 2, campaignId: id, candidateId, taskId, taskRevision: oldTask.revision + 1,
      revision: oldArtifact.revision + 1, parentHash: oldArtifact.hash, kind: oldArtifact.kind, dependencies: dependencies(snapshot, taskId).map(artifactRef), text, semanticStatus: 'not_reviewed' })
    const target = next.tasks.find(t => t.taskId === taskId)!
    target.status = 'committed'; target.artifact = artifactRef(artifact)
    next.candidateId = candidateId; next.executionEpoch++; next.status = 'paused'; next.reason = 'candidate_replaced'; next.lastWallTime = clock()
    const reservation = campaignMetadataReservation(next.tasks.length)
    next.budget = reserveCampaignBudget(snapshot.manifest, next.budget, reservation)
    snapshot = (await commit(snapshot, { operationId: commandId, kind: 'replace_candidate', next, artifacts: [artifact] }, run)).snapshot
    return snapshot
    } finally { run.controller.abort(); if (runs.get(id) === run) runs.delete(id) }
  }
  /** One shared read-only owner. Its deadline and abort cannot acquire a durable Run. */
  function beginPreview(id: string, refusal: (code: 'cancelled' | 'deadline_exceeded') => Error) {
    cancelPreviews()
    const preview: PreviewRun = { id, controller: new AbortController(), startedAt: performance.now() }
    activePreview = preview
    let totalDeadlineObserved = false
    const check = () => {
      if (disposed || preview.controller.signal.aborted || activePreview !== preview) throw refusal('cancelled')
      if (performance.now() - preview.startedAt >= 10_000) { totalDeadlineObserved = true; throw refusal('deadline_exceeded') }
    }
    const wait = <T>(operation: (operationCheck: () => void) => Promise<T>, phase: 'read' | 'prepare'): Promise<T> => {
      check()
      const operationStartedAt = performance.now(), start = diagnosticNow(), remaining = Math.max(0, 10_000 - (operationStartedAt - preview.startedAt))
      const operationLimit = Math.min(CAMPAIGN_IO_TIMEOUT_MS, ioTimeout), timeout = Math.min(operationLimit, remaining)
      if (start === null) operationTimingsCollected = false
      let operationDeadlineObserved = false
      const operationCheck = () => {
        check()
        // Cooperative timeouts count in operationTimings; timeoutEvents contains only
        // its existing timer/action diagnostics, not an exhaustive timeout total.
        if (performance.now() - operationStartedAt >= operationLimit) { operationDeadlineObserved = true; throw refusal('deadline_exceeded') }
      }
      return new Promise<T>((resolve, reject) => {
        let settled = false
        const finish = (error: unknown, value: T | undefined, outcome: 'success' | 'error' | 'abort' | 'timeout') => {
          if (settled) return
          settled = true; clearTimeout(timer); preview.controller.signal.removeEventListener('abort', abort)
          recordOperation(phase, outcome, start, diagnosticNow())
          if (error) reject(error); else resolve(value as T)
        }
        const abort = () => finish(refusal('cancelled'), undefined, 'abort')
        const timer = setTimeout(() => {
          const now = diagnosticNow()
          finish(refusal('deadline_exceeded'), undefined, 'timeout')
          if (now !== null && start !== null) recordTimeout({ phase, trigger: 'timer',
            selectedBudget: operationLimit < remaining ? 'operation' : operationLimit > remaining ? 'action' : 'tie',
            operationTimeoutMs: operationLimit, actionTimeoutMs: 10_000, actionRemainingMs: remaining,
            scheduledTimeoutMs: timeout, operationElapsedMs: now - start, actionElapsedMs: now - preview.startedAt })
          if (activePreview === preview) activePreview = null
          preview.controller.abort()
        }, timeout)
        preview.controller.signal.addEventListener('abort', abort, { once: true })
        try {
          operationCheck()
          // A timer cannot preempt synchronous work. Cooperative checks before/after
          // every operation and compiler loop are the corresponding deadline gate.
          Promise.resolve(operation(operationCheck)).then(value => {
            if (settled) return
            try {
              operationCheck()
              finish(null, value, 'success')
            } catch (error) { finish(error, undefined, preview.controller.signal.aborted ? 'abort' : 'timeout') }
          }, error => finish(error, undefined, totalDeadlineObserved || operationDeadlineObserved ? 'timeout' : 'error'))
        } catch (error) { finish(error, undefined, totalDeadlineObserved || operationDeadlineObserved ? 'timeout' : 'error') }
      })
    }
    const finish = () => {
      if (activePreview === preview) activePreview = null
      preview.controller.abort()
    }
    return { check, wait, finish }
  }
  /** Read-only, independently fenced preview. Never owns/replaces an executing Run. */
  async function previewPlanningContext(id: string, chapterOrdinal: number): Promise<PlanningPreviewResult> {
    const preview = beginPreview(id, code => new PlanningRefusalError(code === 'cancelled' ? 'planning_cancelled' : 'preview_unavailable'))
    const { check, wait } = preview
    const validate = (snapshot: CampaignSnapshot | null): CampaignSnapshot => {
      check()
      if (!snapshot) throw new PlanningRefusalError('missing_planning_source')
      if (!isPlanningProfile(snapshot.manifest)) throw new PlanningRefusalError('unsupported_profile')
      if (snapshot.manifest.runtimeIdentity !== identity.runtimeIdentity || snapshot.manifest.source.commit !== identity.source.commit || snapshot.manifest.source.tree !== identity.source.tree) throw new PlanningRefusalError('runtime_identity_changed')
      if (snapshot.head.status === 'cancelled') throw new PlanningRefusalError('planning_cancelled')
      try { checkClock(snapshot) } catch { throw new PlanningRefusalError('expired') }
      return snapshot
    }
    try {
      check(); campaignId(id)
      const snapshot = validate(await wait(operationCheck => repository.read(id, undefined, operationCheck), 'read'))
      const task = snapshot.manifest.tasks.find(task => task.kind === 'chapter_body' && task.chapterOrdinal === chapterOrdinal)
      const outline = snapshot.manifest.tasks.find(task => task.kind === 'chapter_outline' && task.chapterOrdinal === chapterOrdinal)
      const state = task && snapshot.checkpoint.tasks.find(state => state.taskId === task.id)
      if (!task || !outline || !state) throw new PlanningRefusalError('invalid_planning_graph')
      const sources = task.dependsOn.filter(id => snapshot.manifest.tasks.find(task => task.id === id)!.kind !== 'chapter_body').map(id => {
        const state = snapshot.checkpoint.tasks.find(task => task.taskId === id)
        const artifact = state?.artifact && snapshot.artifacts.get(state.artifact.hash)
        if (state?.status !== 'committed' || !artifact) throw new PlanningRefusalError('incomplete_plan')
        return artifact
      })
      const compiled = await wait(operationCheck => compilePlanningContext({ manifest: snapshot.manifest, candidateId: snapshot.checkpoint.candidateId, task, taskRevision: state.revision, dependencies: sources }, 'planning_preview', operationCheck), 'prepare')
      check()
      const fresh = validate(await wait(operationCheck => repository.read(id, undefined, operationCheck), 'read'))
      if (fresh.rawHead !== snapshot.rawHead) throw new PlanningRefusalError('source_changed')
      const next = snapshot.checkpoint.tasks.find(task => task.status !== 'committed')
      const nextSpec = next && snapshot.manifest.tasks.find(task => task.id === next.taskId)
      const eligible = ['prepared', 'running'].includes(snapshot.head.status) && nextSpec?.kind === 'chapter_body' && ['pending', 'invalidated'].includes(next!.status)
        && nextSpec.dependsOn.every(id => snapshot.checkpoint.tasks.find(task => task.taskId === id)!.status === 'committed')
      if (!compiled.canonBaseRoot || !compiled.fullPlanRoot) throw new PlanningRefusalError('incomplete_plan')
      check()
      return { status: 'ready', selectedChapter: { ordinal: chapterOrdinal, outlineTaskId: outline.id, bodyTaskId: task.id }, nextEligibleBodyTaskId: eligible ? next!.taskId : null,
        canonBaseRoot: compiled.canonBaseRoot, fullPlanRoot: compiled.fullPlanRoot, sourceRefs: compiled.sourceRefs, scope: compiled.scope,
        input: compiled.text, inputDigest: compiled.digest, inputBytes: compiled.bytes, inputUtf16: compiled.utf16 }
    } catch (error) {
      return { status: 'refused', refusalCode: error instanceof PlanningRefusalError ? error.code : 'preview_unavailable' }
    } finally { preview.finish() }
  }
  /** Caller text is untrusted; only fresh repository reads establish the source view. */
  async function previewBodyEvidence(id: string, proposalText: string): Promise<BodyEvidencePreviewResult> {
    const preview = beginPreview(id, code => new BodyEvidenceRefusalError(code))
    const { check, wait } = preview
    const validate = (snapshot: CampaignSnapshot | null): CampaignSnapshot => {
      check()
      if (!snapshot) throw new BodyEvidenceRefusalError('no_accepted_body')
      try { if (!isPlanningProfile(snapshot.manifest)) throw new BodyEvidenceRefusalError('unsupported_profile') } catch { throw new BodyEvidenceRefusalError('unsupported_profile') }
      if (snapshot.manifest.runtimeIdentity !== identity.runtimeIdentity || snapshot.manifest.source.commit !== identity.source.commit || snapshot.manifest.source.tree !== identity.source.tree) throw new BodyEvidenceRefusalError('runtime_identity_changed')
      if (snapshot.head.status === 'cancelled') throw new BodyEvidenceRefusalError('cancelled')
      try { checkClock(snapshot) } catch { throw new BodyEvidenceRefusalError('expired') }
      return snapshot
    }
    try {
      check(); campaignId(id)
      parseBodyEvidenceProposal(proposalText, check)
      const snapshot = validate(await wait(operationCheck => repository.read(id, undefined, operationCheck), 'read'))
      const compiled = await wait(operationCheck => compileBodyEvidence(snapshot, proposalText, operationCheck), 'prepare')
      const rawHeadHash = await wait(() => hashText(snapshot.rawHead), 'prepare')
      check()
      const fresh = validate(await wait(operationCheck => repository.read(id, undefined, operationCheck), 'read'))
      if (fresh.rawHead !== snapshot.rawHead) throw new BodyEvidenceRefusalError('source_changed')
      check()
      return { status: 'ready', packetText: compiled.packetText, packetDigest: compiled.packetDigest, packetBytes: compiled.packetBytes, packetUtf16: compiled.packetUtf16,
        throughChapterOrdinal: compiled.throughChapterOrdinal, bodyPrefixRoot: compiled.bodyPrefixRoot,
        canonBaseRoot: compiled.canonBaseRoot, fullPlanRoot: compiled.fullPlanRoot, coverage: compiled.coverage,
        sourceHead: { sequence: snapshot.head.sequence, checkpointHash: snapshot.head.checkpointHash, executionEpoch: snapshot.head.executionEpoch, rawHeadHash },
        sourceIdentity: { runtimeIdentity: identity.runtimeIdentity, source: { ...identity.source } } }
    } catch (error) {
      return { status: 'refused', refusalCode: error instanceof BodyEvidenceRefusalError ? error.code
        : error instanceof PlanningRefusalError && error.code === 'unsupported_profile' ? 'unsupported_profile' : 'preview_unavailable' }
    } finally { preview.finish() }
  }
  return {
    previewPlanningContext,
    previewBodyEvidence,
    cancelPreviews,
    async preparePlanning(input: PrepareOfflineCampaign, commandId?: string) {
      assertRun()
      const existing = await bounded(() => repository.read(input.campaignId), 'read')
      if (existing) {
        const prior = await bounded(() => repository.getReceipt(input.campaignId, commandId ?? `create-${input.campaignId}`), 'receipt')
        if (prior?.kind !== 'create' || existing.manifest.fixtureVersion !== PLANNING_THREE_CHAPTER_PROFILE || existing.manifest.language !== input.language || existing.manifest.runtimeIdentity !== identity.runtimeIdentity || existing.manifest.source.commit !== identity.source.commit || existing.manifest.source.tree !== identity.source.tree) throw new CampaignRuntimeError('operation_conflict')
        return existing
      }
      const manifest = await createOfflineCampaignManifest(planningManifestOptions({ ...input, identity, now: clock() }))
      return (await bounded(() => repository.create(manifest, commandId ?? `create-${manifest.campaignId}`), 'prepare')).snapshot
    },
    async prepareBodyEvidence(input: PrepareOfflineCampaign, commandId?: string) {
      assertRun(); cancelPreviews(input.campaignId)
      const existing = await bounded(() => repository.read(input.campaignId), 'read')
      if (existing) {
        const prior = await bounded(() => repository.getReceipt(input.campaignId, commandId ?? `create-${input.campaignId}`), 'receipt')
        if (prior?.kind !== 'create' || existing.manifest.fixtureVersion !== BODY_EVIDENCE_THREE_CHAPTER_PROFILE || existing.manifest.language !== input.language || existing.manifest.runtimeIdentity !== identity.runtimeIdentity || existing.manifest.source.commit !== identity.source.commit || existing.manifest.source.tree !== identity.source.tree) throw new CampaignRuntimeError('operation_conflict')
        return existing
      }
      const manifest = await createOfflineCampaignManifest(planningManifestOptions({ ...input, identity, now: clock(), profile: 'body-evidence-three-chapter' }))
      return (await bounded(() => repository.create(manifest, commandId ?? `create-${manifest.campaignId}`), 'prepare')).snapshot
    },
    async prepare(input: PrepareOfflineCampaign | CampaignManifest, commandId?: string) {
      assertRun()
      if (!('schemaVersion' in input)) {
        const existing = await bounded(() => repository.read(input.campaignId), 'read')
        if (existing) {
          const prior = await bounded(() => repository.getReceipt(input.campaignId, commandId ?? `create-${input.campaignId}`), 'receipt')
          if (prior?.kind !== 'create' || existing.manifest.language !== input.language || existing.manifest.runtimeIdentity !== identity.runtimeIdentity || existing.manifest.source.commit !== identity.source.commit || existing.manifest.source.tree !== identity.source.tree) throw new CampaignRuntimeError('operation_conflict')
          return existing
        }
      }
      const manifest = 'schemaVersion' in input ? input : await createOfflineCampaignManifest({ ...input, now: clock(), identity })
      if (manifest.runtimeIdentity !== identity.runtimeIdentity || manifest.source.commit !== identity.source.commit || manifest.source.tree !== identity.source.tree) throw new CampaignRuntimeError('runtime_identity_changed')
      return (await bounded(() => repository.create(manifest, commandId ?? `create-${manifest.campaignId}`), 'prepare')).snapshot
    },
    // A detached snapshot only. Disposal and later commands do not erase prior
    // observations; a new engine starts empty. Nothing here clears/changes runs.
    readTimeoutDiagnostics(): CampaignTimeoutDiagnostics {
      return { status: timeoutEvents.length ? 'observed' : 'not_observed',
        events: timeoutEvents.map(event => ({ ...event })), overflow: timeoutOverflow }
    },
    readOperationTimings(): CampaignOperationTimings {
      return { status: operationTimingsCollected ? 'collected' : 'not_collected',
        phases: operationTimingsCollected ? operationTimings.map(row => ({ ...row, histogram: [...row.histogram] })) : emptyOperationTimings() }
    },
    step,
    pause(id: string, commandId = newCommand()) { stopLocal(id); return control(id, 'pause', commandId) },
    resume(id: string, commandId = newCommand()) { stopLocal(id); return control(id, 'resume', commandId) },
    cancel(id: string, commandId = newCommand()) { stopLocal(id); return control(id, 'cancel', commandId) },
    replaceCandidate,
    recoverSaveOnly,
    inspect(id: string) { return bounded(() => repository.inspect(id), 'read') },
    list() { return bounded(() => repository.list(), 'read') },
    stopLocal,
    dispose() { stopLocal(); disposed = true },
  }
}
export function createOfflineCampaignEngine(options: OfflineCampaignEngineOptions = {}) {
  return createCampaignEngine({ ...options, host: options.host ?? createOfflineFixtureHost(options.fixture) })
}
export type OfflineCampaignEngine = ReturnType<typeof createOfflineCampaignEngine>
