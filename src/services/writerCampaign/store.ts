import { idbCompareAndSwapMany, idbGetMany } from '../blobStore'
import type {
  CampaignActionScope, CampaignArtifact, CampaignArtifactRef, CampaignCheckpoint, CampaignCommitResult, CampaignHead,
  CampaignManifest, CampaignMutation, CampaignReceipt, CampaignRepository, CampaignRepositoryIO,
  CampaignRequest, CampaignRequestRef, CampaignSnapshot, CampaignState, CampaignTaskState,
} from '../../types/writerCampaign'
import {
  CAMPAIGN_BUDGET_KEYS, CAMPAIGN_LIMITS, CampaignProtocolError,
  campaignAssert, campaignId, campaignInteger, campaignRecord, canonicalStringify,
  emptyCampaignBudget, hashCampaignValue, parseCampaignRecord, utf8Bytes, createCampaignRawReadValidator,
  validateCampaignArtifact, validateCampaignCheckpoint, validateCampaignHead, validateCampaignManifest,
  validateCampaignReceipt, validateCampaignRequest, validateCampaignState, decodeStorageBytes, encodeStorageBytes,
} from './protocol'

import { applyCampaignStorage, assertCampaignStorage, campaignRequestStorageAllowance, campaignStorageSource, emptyCampaignStorage } from './storageAccounting'
import { createLegacyCampaignInspector } from './legacyStore'
import { PlanningValidationView } from './planningValidation'
import { validatePlanningProfile } from './planningProfile'
import { CampaignActionProofPool, CAMPAIGN_PROOF_BATCH_BYTES, type CampaignProofLease } from './actionProof'
import { ProducerVerificationError, registerCampaignVerificationBridge, type ProducerVerificationExecutor } from './verificationSession'

export const CAMPAIGN_KEY_PREFIX = 'writer-campaign:'
export const CAMPAIGN_CATALOG_KEY = `${CAMPAIGN_KEY_PREFIX}catalog`
export const CAMPAIGN_RECOVERY_OPERATION_RESERVE = 16
const RECOVERY_KINDS = new Set(['pause', 'cancel', 'reconcile', 'block', 'retain_response', 'accept_artifact'])
const EPOCH_KINDS = new Set(['start', 'resume', 'pause', 'cancel', 'block', 'replace_candidate', 'reconcile'])
export const campaignKeys = {
  head: (id: string) => `${root(id)}head`,
  manifest: (id: string, hash: string) => `${root(id)}manifest:${hash}`,
  checkpoint: (id: string, sequence: number) => `${root(id)}checkpoint:${sequence}`,
  receipt: (id: string, operationId: string) => { campaignId(operationId); return `${root(id)}receipt:${encodeURIComponent(operationId)}` },
  artifact: (id: string, taskId: string, revision: number) => { campaignId(taskId); return `${root(id)}artifact:${encodeURIComponent(taskId)}:${revision}` },
  request: (id: string, requestId: string, revision: number) => { campaignId(requestId); return `${root(id)}request:${encodeURIComponent(requestId)}:${revision}` },
}
function root(id: string): string { campaignId(id); return `${CAMPAIGN_KEY_PREFIX}${encodeURIComponent(id)}:` }
function same(a: unknown, b: unknown): boolean { return canonicalStringify(a) === canonicalStringify(b) }

/** Equality only for closed-schema values after their full protocol validators.
 * Keep these explicit field inventories locked to the validators. The cheap
 * shape guards also prevent an added/unknown field from being silently ignored.
 */
export function campaignArtifactRefEqual(a: CampaignArtifactRef | null, b: CampaignArtifactRef | null): boolean {
  if (a === null || b === null) return a === b
  campaignRecord(a, ['taskId', 'revision', 'hash'], 'artifact reference comparison')
  campaignRecord(b, ['taskId', 'revision', 'hash'], 'artifact reference comparison')
  return a.taskId === b.taskId && a.revision === b.revision && a.hash === b.hash
}
export function campaignRequestRefEqual(a: CampaignRequestRef | null, b: CampaignRequestRef | null): boolean {
  if (a === null || b === null) return a === b
  campaignRecord(a, ['id', 'revision', 'hash'], 'request reference comparison')
  campaignRecord(b, ['id', 'revision', 'hash'], 'request reference comparison')
  return a.id === b.id && a.revision === b.revision && a.hash === b.hash
}
export function campaignTaskEqual(a: CampaignTaskState, b: CampaignTaskState): boolean {
  campaignRecord(a, ['taskId', 'revision', 'status', 'artifact', 'priorArtifact', 'request'], 'task comparison')
  campaignRecord(b, ['taskId', 'revision', 'status', 'artifact', 'priorArtifact', 'request'], 'task comparison')
  return a.taskId === b.taskId && a.revision === b.revision && a.status === b.status
    && campaignArtifactRefEqual(a.artifact, b.artifact) && campaignArtifactRefEqual(a.priorArtifact, b.priorArtifact)
    && campaignRequestRefEqual(a.request, b.request)
}
function catalog(raw: string | null): string[] {
  if (raw === null) return []
  const value = parseCampaignRecord(raw)
  campaignAssert(value !== null && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 1, 'Unsupported Campaign catalog; bytes preserved', 'unsupported_schema')
  campaignRecord(value, ['schemaVersion', 'ids'], 'catalog')
  const record = value as Record<string, unknown>
  campaignAssert(Array.isArray(record.ids) && record.ids.length <= CAMPAIGN_LIMITS.campaigns, 'Invalid catalog bound')
  record.ids.forEach(campaignId)
  campaignAssert(new Set(record.ids).size === record.ids.length, 'Duplicate Campaign catalog ID')
  return record.ids as string[]
}
function businessState(state: CampaignState, previous: CampaignState): unknown {
  const { budget, status, reason, candidateId, tasks } = state
  const rest = { status, reason, candidateId, tasks }
  const reserved = Object.fromEntries(CAMPAIGN_BUDGET_KEYS.filter(key => !['artifacts', 'operations'].includes(key)).map(key => [key, budget[key] - previous.budget[key]]))
  return { ...rest, budgetDelta: reserved }
}
function counterSum(a: number, b: number): number { const result = a + b; campaignInteger(result); return result }
function headMatches(head: CampaignHead, checkpoint: CampaignCheckpoint, receipt: CampaignReceipt): void {
  campaignAssert(head.campaignId === checkpoint.campaignId && head.campaignId === receipt.campaignId && head.sequence === checkpoint.sequence && head.sequence === receipt.sequence && head.manifestHash === checkpoint.manifestHash && head.manifestHash === receipt.manifestHash && head.checkpointHash === checkpoint.hash && head.checkpointHash === receipt.checkpointHash && head.executionEpoch === checkpoint.executionEpoch && head.executionEpoch === receipt.executionEpoch && head.status === checkpoint.status && head.receiptId === checkpoint.operationId && head.receiptId === receipt.operationId, 'Head/checkpoint/receipt identity mismatch')
}
function assertIndex(manifest: CampaignManifest, checkpoint: CampaignState): void {
  campaignAssert(checkpoint.tasks.length === manifest.tasks.length && checkpoint.tasks.every((task, index) => task.taskId === manifest.tasks[index]!.id), 'Task index differs from immutable manifest')
  for (const key of CAMPAIGN_BUDGET_KEYS) campaignAssert(checkpoint.budget[key] <= manifest.budget[key], `Campaign ${key} budget exceeded`, 'budget')
  assertCampaignStorage(manifest, checkpoint.storage)
}
function assertActiveRefs(manifest: CampaignManifest, checkpoint: CampaignCheckpoint | CampaignState, artifacts: Map<string, CampaignArtifact>, requests: Map<string, CampaignRequest>): number {
  let body = 0
  for (const task of checkpoint.tasks) {
    const spec = manifest.tasks.find(item => item.id === task.taskId)!
    if (task.request) {
      const request = requests.get(task.request.hash)
      campaignAssert(request && request.campaignId === manifest.campaignId && request.taskId === task.taskId && request.taskRevision === task.revision && request.id === task.request.id && request.revision === task.request.revision, 'Task request identity mismatch')
      campaignAssert(request.status === task.status, 'Task/request status mismatch')
    }
    if (task.priorArtifact) {
      const prior = artifacts.get(task.priorArtifact.hash)
      campaignAssert(prior && prior.campaignId === manifest.campaignId && prior.taskId === task.taskId && prior.revision === task.priorArtifact.revision && prior.taskRevision < task.revision, 'Prior artifact lineage mismatch')
    }
    if (task.artifact) {
      const artifact = artifacts.get(task.artifact.hash)
      campaignAssert(artifact && artifact.campaignId === manifest.campaignId && artifact.taskId === task.taskId && artifact.taskRevision === task.revision && artifact.kind === spec.kind && artifact.revision === task.artifact.revision, 'Task artifact identity mismatch')
      const dependencies = spec.dependsOn.map(id => checkpoint.tasks.find(item => item.taskId === id)!.artifact)
      campaignAssert(dependencies.every(Boolean) && same(artifact.dependencies, dependencies), 'Artifact dependencies are missing or stale')
      if (task.request) campaignAssert(requests.get(task.request.hash)!.response?.text === artifact.text, 'Accepted text differs from retained exact response')
      if (spec.kind === 'chapter_body') body = counterSum(body, artifact.canonical.scalars)
    }
    if (['reserved', 'dispatch_intent', 'response_retained', 'committed'].includes(task.status)) {
      campaignAssert(spec.dependsOn.every(id => checkpoint.tasks.find(item => item.taskId === id)!.status === 'committed'), 'Executable task has unmet dependencies')
    }
  }
  return body
}

function assertStateTransition(previous: CampaignState, next: CampaignState, kind: CampaignMutation['kind'], requestCount: number): void {
    campaignAssert(next.lastWallTime >= previous.lastWallTime, 'Wall clock regressed')
    campaignAssert(next.executionEpoch === previous.executionEpoch + (EPOCH_KINDS.has(kind) ? 1 : 0), 'Invalid execution fence transition')
    campaignAssert(next.candidateId === previous.candidateId || kind === 'replace_candidate', 'Candidate changed outside replacement')
    campaignAssert(previous.status !== 'cancelled' || (kind === 'reconcile' && next.status === 'cancelled'), 'Cancellation is terminal')
    campaignAssert(previous.status !== 'completed' || ['replace_candidate', 'cancel'].includes(kind), 'Completed fixture cannot resume execution')
    if (kind === 'start') campaignAssert(previous.status === 'prepared' && next.status === 'running', 'Start requires prepared to running')
    if (kind === 'resume') campaignAssert(next.status === 'running', 'Resume must persist running status')
    if (kind === 'pause') campaignAssert(previous.status !== 'paused', 'Already paused; no new terminal envelope may be consumed')
    if (kind === 'block') campaignAssert(previous.status !== 'blocked' || requestCount > 0, 'Already blocked; no new terminal envelope may be consumed')
    if (kind === 'cancel') campaignAssert(next.status === 'cancelled', 'Cancel must persist terminal status')
    if (kind === 'pause') campaignAssert(next.status === 'paused', 'Pause must persist paused status')
    if (kind === 'block') campaignAssert(next.status === 'blocked', 'Block must persist blocked status')
    if (kind === 'reserve' || kind === 'dispatch_intent' || kind === 'accept_artifact') campaignAssert(previous.status === 'running' && (next.status === 'running' || next.status === 'completed'), 'Execution requires a running campaign')
    for (const key of CAMPAIGN_BUDGET_KEYS) if (!['artifacts', 'operations'].includes(key)) campaignAssert(next.budget[key] >= previous.budget[key], 'Campaign budget cannot be refunded')
}
function assertTaskTransition(manifest: CampaignManifest, previous: CampaignState, next: CampaignState, kind: CampaignMutation['kind'], artifacts: CampaignArtifact[], requests: CampaignRequest[]): void {
    for (const request of requests) {
      const old = previous.tasks.find(task => task.taskId === request.taskId)
      campaignAssert(old && old.revision === request.taskRevision && previous.candidateId === request.candidateId, 'Request is not bound to current task/candidate')
      if (kind === 'reserve') campaignAssert(old.request === null && old.artifact === null && ['pending', 'invalidated'].includes(old.status), 'New request requires pending unoccupied task')
      else campaignAssert(old.request?.hash === request.parentHash, 'Request predecessor is no longer active')
    }
    // Both indices have already passed assertIndex against the immutable manifest.
    const changed = next.tasks.map((task, index) => !campaignTaskEqual(task, previous.tasks[index]!))
    const changedCount = changed.filter(Boolean).length
    for (const [index, task] of next.tasks.entries()) {
      const old = previous.tasks[index]!
      const expectedPrior = kind === 'replace_candidate' && task.revision === old.revision + 1 ? (old.artifact ?? old.priorArtifact) : old.priorArtifact
      campaignAssert(campaignArtifactRefEqual(task.priorArtifact, expectedPrior), 'Historical artifact lineage was discarded or replaced')
      campaignAssert(task.revision === old.revision || (kind === 'replace_candidate' && task.revision === old.revision + 1), 'Task revision changed outside replacement')
      if (task.artifact && !campaignArtifactRefEqual(task.artifact, old.artifact)) campaignAssert(artifacts.some(item => item.hash === task.artifact!.hash), 'Task points to unsubmitted artifact')
      if (task.request && !campaignRequestRefEqual(task.request, old.request)) campaignAssert(requests.some(item => item.hash === task.request!.hash), 'Task points to unsubmitted request')
      if (changed[index] && kind !== 'replace_candidate') campaignAssert(requests.some(item => item.taskId === task.taskId), 'Task changed without its request revision')
    }
    for (const artifact of artifacts) campaignAssert(next.tasks.some(task => task.artifact?.hash === artifact.hash), 'Orphan artifact write')
    for (const request of requests) campaignAssert(next.tasks.some(task => task.request?.hash === request.hash), 'Orphan request write')
    if (kind === 'replace_candidate') {
      campaignAssert(next.candidateId !== previous.candidateId && artifacts.length === 1, 'Replacement needs one new candidate artifact')
      const root = artifacts[0]!.taskId
      const affected = new Set([root])
      for (const spec of manifest.tasks) if (spec.dependsOn.some(dep => affected.has(dep))) affected.add(spec.id)
      for (const [index, task] of next.tasks.entries()) {
        const old = previous.tasks[index]!
        if (affected.has(task.taskId)) campaignAssert(task.revision === old.revision + 1 && task.request === null && (task.taskId === root ? task.status === 'committed' : task.status === 'invalidated' && task.artifact === null), 'Replacement must invalidate transitive dependencies and in-flight requests')
        else campaignAssert(!changed[index], 'Replacement changed an unrelated task')
      }
    } else campaignAssert(changedCount <= 1, 'One logical request/task transition per commit')
}
function assertRequestPhase(manifest: CampaignManifest, kind: CampaignReceipt['kind'], operationId: string, request: CampaignRequest, old: CampaignRequest | null): void {
  // Every admitted origin must be able to name its mandatory final acceptance.
  campaignId(`${request.commandId}:artifact`)
  campaignAssert(request.storageAllocationBytes === campaignRequestStorageAllowance(request.preparedInput, manifest.tasks.length, request.reservation.responseBytes), 'Request allocation differs from its envelope')
  campaignAssert(request.reservation.attempts === 1 && request.reservation.inputBytes === request.inputBytes && request.reservation.inputUtf16 === request.inputUtf16 && request.reservation.activeMs > 0, 'Request reservation identity mismatch')
  if (request.response) campaignAssert(utf8Bytes(request.response.text) <= request.reservation.responseBytes, 'Response exceeds immutable reservation')
  const allowed: Partial<Record<CampaignReceipt['kind'], string[]>> = {
    reserve: ['reserved'], dispatch_intent: ['dispatch_intent'], retain_response: ['response_retained'], accept_artifact: ['committed'],
    reconcile: ['response_retained', 'known_failed', 'outcome_unknown'], block: ['outcome_unknown', 'known_failed'],
  }
  campaignAssert(allowed[kind]?.includes(request.status), 'Request transition is not authorized by operation kind')
  if (!old) campaignAssert(kind === 'reserve' && request.revision === 0 && request.parentHash === null, 'Request allocation needs one reserve origin')
  else {
    campaignAssert(kind !== 'reserve' && request.revision === old.revision + 1 && request.parentHash === old.hash, 'Request revision/parent mismatch')
    const identity = (item: CampaignRequest) => {
      const { hash: _hash, revision: _revision, parentHash: _parent, status: _status, response: _response, failureReason: _reason, ...immutable } = item
      return immutable
    }
    campaignAssert(same(identity(request), identity(old)), 'Immutable request identity/reservation changed')
    if (old.response) campaignAssert(same(old.response, request.response), 'Retained exact response cannot change')
    const transitions: Record<string, string[]> = { reserved: ['dispatch_intent', 'known_failed'], dispatch_intent: ['response_retained', 'outcome_unknown', 'known_failed'], outcome_unknown: ['response_retained', 'known_failed'], response_retained: ['committed'], committed: [], known_failed: [] }
    campaignAssert(transitions[old.status]?.includes(request.status), 'Invalid request state transition')
  }
  if (kind === 'accept_artifact') campaignAssert(operationId === `${request.commandId}:artifact`, 'Acceptance must retain its original operation identity')
}
function assertAcceptedArtifact(request: CampaignRequest, artifacts: CampaignArtifact[], state: CampaignState): void {
  campaignAssert(artifacts.length === 1 && request.status === 'committed' && request.response !== null, 'Acceptance needs exact retained response and one artifact')
  const artifact = artifacts[0]!, task = state.tasks.find(task => task.taskId === request.taskId)
  campaignAssert(artifact.campaignId === request.campaignId && artifact.candidateId === request.candidateId && artifact.taskId === request.taskId && artifact.taskRevision === request.taskRevision && artifact.text === request.response.text && task?.artifact?.hash === artifact.hash && task.request?.hash === request.hash && task.status === 'committed', 'Acceptance artifact/request identity mismatch')
}

/** Reads and commits use only the dedicated Campaign namespace. No fallback storage. */
export function createCampaignRepository(io: CampaignRepositoryIO = { getMany: idbGetMany, compareAndSwapMany: idbCompareAndSwapMany }): CampaignRepository {
  const proofs = new CampaignActionProofPool()
  const sessionLeases = new WeakMap<CampaignActionScope, { lease: CampaignProofLease; executor: ProducerVerificationExecutor }>()
  function observeRaw(lease: CampaignProofLease | null, key: string, raw: string, bytes: number, executor?: ProducerVerificationExecutor): void {
    if (executor) { executor.captureRaw('origin', key, raw, bytes); executor.validated(key) }
    else proofs.observe(lease, key, raw, bytes)
  }
  async function readRecord(key: string): Promise<string | null> { return (await io.getMany([key])).get(key) ?? null }
  async function list(): Promise<string[]> { return catalog(await readRecord(CAMPAIGN_CATALOG_KEY)) }

  async function getReceipt(campaignIdValue: string, operationId: string): Promise<CampaignReceipt | null> {
    const key = campaignKeys.receipt(campaignIdValue, operationId)
    const raw = await readRecord(key)
    if (raw === null) return null
    const receipt = await validateCampaignReceipt(parseCampaignRecord(raw))
    campaignAssert(receipt.campaignId === campaignIdValue && receipt.operationId === operationId, 'Receipt key mismatch')
    const checkpointKey = campaignKeys.checkpoint(campaignIdValue, receipt.sequence)
    const values = await io.getMany([key, checkpointKey])
    campaignAssert(values.get(key) === raw, 'Receipt changed during verification')
    const checkpoint = await validateCampaignCheckpoint(parseCampaignRecord(values.get(checkpointKey) ?? null))
    campaignAssert(checkpoint.hash === receipt.checkpointHash && checkpoint.operationId === receipt.operationId && checkpoint.campaignId === receipt.campaignId && checkpoint.manifestHash === receipt.manifestHash && checkpoint.sequence === receipt.sequence && checkpoint.executionEpoch === receipt.executionEpoch, 'Receipt lacks matching immutable commit evidence')
    return receipt
  }

  async function getOperationArtifacts(campaignIdValue: string, operationId: string): Promise<CampaignArtifact[] | null> {
    const receipt = await getReceipt(campaignIdValue, operationId)
    if (!receipt) return null
    const checkpoint = await validateCampaignCheckpoint(parseCampaignRecord(await readRecord(campaignKeys.checkpoint(campaignIdValue, receipt.sequence))))
    campaignAssert(checkpoint.hash === receipt.checkpointHash, 'Operation checkpoint changed')
    const refs = checkpoint.tasks.flatMap(task => [task.artifact, task.priorArtifact].filter((ref): ref is NonNullable<typeof ref> => ref !== null))
    const result: CampaignArtifact[] = []
    for (const hash of receipt.artifactHashes) {
      const ref = refs.find(item => item.hash === hash)
      campaignAssert(ref, 'Operation artifact absent from its checkpoint')
      const artifact = await validateCampaignArtifact(parseCampaignRecord(await readRecord(campaignKeys.artifact(campaignIdValue, ref.taskId, ref.revision))))
      campaignAssert(artifact.hash === hash && artifact.campaignId === campaignIdValue && artifact.taskId === ref.taskId && artifact.revision === ref.revision, 'Operation artifact identity mismatch')
      result.push(artifact)
    }
    return result
  }

  async function coldRead(campaignIdValue: string, lease: CampaignProofLease | null = null, check: () => void = () => {}, executor?: ProducerVerificationExecutor): Promise<CampaignSnapshot | null> {
    const started = proofs.coldStart()
    proofs.capture(lease)
    if (executor && !proofs.collecting(lease)) throw new ProducerVerificationError('verification_capacity')
    try {
      const result = await replayRead(campaignIdValue, lease, check, executor)
      proofs.coldCompleted()
      return result
    } finally { proofs.timed('cold', started) }
  }

  async function read(campaignIdValue: string, scope?: CampaignActionScope, check: () => void = () => {}): Promise<CampaignSnapshot | null> {
    const lease = proofs.begin(scope, campaignIdValue)
    // Only the initial full read can seed a scope. A caller asking for another
    // independent read does not silently rebase its already established proof.
    if (lease?.snapshot) proofs.discard(lease, 'conflict')
    try {
      const snapshot = await coldRead(campaignIdValue, lease, check)
      proofs.seedVerification(lease, snapshot)
      return snapshot
    }
    catch (cause) { proofs.discard(lease, 'error'); throw cause }
    finally { proofs.end(lease) }
  }

  async function replayRead(campaignIdValue: string, lease: CampaignProofLease | null, check: () => void = () => {}, executor?: ProducerVerificationExecutor): Promise<CampaignSnapshot | null> {
    const headKey = campaignKeys.head(campaignIdValue)
    const initial = await readRecord(headKey)
    if (initial !== null && (parseCampaignRecord(initial) as { schemaVersion?: unknown }).schemaVersion === 1) throw new CampaignProtocolError('legacy_read_only', 'Campaign v1 is available for read-only inspection')
    // Retry only a concurrently advanced head, never corrupt records. Immutable
    // records are checked again with the head in one final committed snapshot.
    for (let retry = 0; retry < (executor ? 1 : 4); retry++) {
      const rawValidator = createCampaignRawReadValidator()
      try {
        const discovery = await io.getMany([headKey, CAMPAIGN_CATALOG_KEY])
        const rawHead = discovery.get(headKey) ?? null
        const ids = catalog(discovery.get(CAMPAIGN_CATALOG_KEY) ?? null)
        if (rawHead === null) {
          campaignAssert(!ids.includes(campaignIdValue), 'Catalog Campaign has no head; stored bytes preserved')
          return null
        }
        campaignAssert(ids.includes(campaignIdValue), 'Campaign head is absent from its catalog; stored bytes preserved')
        const head = validateCampaignHead(parseCampaignRecord(rawHead))
        campaignAssert(head.campaignId === campaignIdValue, 'Head key mismatch')
        const manifestKey = campaignKeys.manifest(campaignIdValue, head.manifestHash)
        const checkpointKey = campaignKeys.checkpoint(campaignIdValue, head.sequence)
        const receiptKey = campaignKeys.receipt(campaignIdValue, head.receiptId)
        const successorKey = campaignKeys.checkpoint(campaignIdValue, head.sequence + 1)
        const values = await io.getMany([headKey, manifestKey, checkpointKey, receiptKey, successorKey])
        if (values.get(headKey) !== rawHead) { proofs.discard(lease, 'conflict'); continue }
        campaignAssert(values.get(successorKey) == null, 'Campaign head sequence rolled back behind an immutable checkpoint; stored bytes preserved')
        const manifest = await rawValidator.manifest(values.get(manifestKey) ?? null)
        const checkpoint = await rawValidator.checkpoint(values.get(checkpointKey) ?? null)
        const receipt = await rawValidator.receipt(values.get(receiptKey) ?? null)
        if (proofs.collecting(lease)) {
          observeRaw(lease, manifestKey, values.get(manifestKey)!, utf8Bytes(values.get(manifestKey)!), executor)
          observeRaw(lease, checkpointKey, values.get(checkpointKey)!, utf8Bytes(values.get(checkpointKey)!), executor)
          observeRaw(lease, receiptKey, values.get(receiptKey)!, utf8Bytes(values.get(receiptKey)!), executor)
        }
        campaignAssert(manifest.campaignId === campaignIdValue && manifest.hash === head.manifestHash, 'Manifest key mismatch')
        const planning = new PlanningValidationView(manifest, check)
        headMatches(head, checkpoint, receipt); assertIndex(manifest, checkpoint)
        campaignAssert(checkpoint.budget.operations === head.sequence + 1, 'Operation count differs from checkpoint sequence')
        // Only final-index records survive this read. Full history is still fetched
        // and verified below; this is not a cache across reads or head versions.
        const wantedArtifacts = new Map<string, CampaignArtifactRef>(), wantedRequests = new Map<string, CampaignRequestRef>()
        for (const ref of checkpoint.tasks.flatMap(task => [task.artifact, task.priorArtifact].filter((ref): ref is CampaignArtifactRef => ref !== null))) {
          const key = campaignKeys.artifact(campaignIdValue, ref.taskId, ref.revision), prior = wantedArtifacts.get(key)
          campaignAssert(!prior || same(prior, ref), 'Conflicting final artifact references')
          wantedArtifacts.set(key, ref)
        }
        for (const ref of [...checkpoint.tasks.flatMap(task => task.request ? [task.request] : []), ...checkpoint.storage.openAllocations.map(row => row.request)]) {
          const key = campaignKeys.request(campaignIdValue, ref.id, ref.revision), prior = wantedRequests.get(key)
          campaignAssert(!prior || same(prior, ref), 'Conflicting final request references')
          wantedRequests.set(key, ref)
        }
        campaignAssert(wantedArtifacts.size + wantedRequests.size <= 4 * CAMPAIGN_LIMITS.tasks, 'Final record retention count exceeded')
        const artifacts = new Map<string, CampaignArtifact>(), requests = new Map<string, CampaignRequest>()
        const captured = new Map<string, string>()
        let retainedSerializedBytes = 0
        function retain(key: string, valueBytes: number, hash: string): void {
          const prior = captured.get(key)
          campaignAssert(prior === undefined || prior === hash, 'Conflicting verified final record')
          if (prior !== undefined) return
          retainedSerializedBytes = counterSum(retainedSerializedBytes, utf8Bytes(key) + valueBytes)
          // This counts serialized payload, not JS heap. Each unique retained
          // immutable record was charged in W; no raw duplicate is retained here.
          campaignAssert(retainedSerializedBytes <= decodeStorageBytes(checkpoint.storage.writtenBytes) && retainedSerializedBytes <= CAMPAIGN_LIMITS.serializedBytes, 'Final record retention bytes exceeded')
          captured.set(key, hash)
        }

        // Immutable records are create-only. Every bounded read includes the actual
        // head; if it moves, restart rather than joining revisions from two commits.
        // An admitted action additionally retains the actual validated raw strings;
        // independent/public reads retain only their bounded active final index.
        let moved = false
        async function guarded(keys: string[]): Promise<Map<string, string | null>> {
          campaignAssert(keys.length <= 32, 'Internal read batch exceeded its bound')
          const result = await io.getMany([headKey, ...keys])
          if (result.get(headKey) !== rawHead) moved = true
          return result
        }
        let previous: CampaignCheckpoint | null = null
        let accumulatedBytes = 0
        let replayStorage = emptyCampaignStorage(manifest.storage.recoveryReserveBytes)
        let replayPrevious: CampaignCheckpoint | null = null
        const allocationIds = new Set<string>()
        const allocationRequests = new Map<string, CampaignRequest>()
        const operationIds = new Set<string>()
        for (let from = 0; from <= head.sequence && !moved; from += 32) {
          rawValidator.beginHistoryBatch()
          try {
            const sequences = Array.from({ length: Math.min(32, head.sequence - from + 1) }, (_, index) => from + index)
            const keys = sequences.map(sequence => campaignKeys.checkpoint(campaignIdValue, sequence))
            const history = await guarded(keys)
            if (moved) break
            const batch: CampaignCheckpoint[] = [], checkpointBytes: number[] = []
            for (const [index, sequence] of sequences.entries()) {
              const raw = history.get(keys[index]!) ?? null
              const item = await rawValidator.historyCheckpoint(raw)
              checkpointBytes.push(utf8Bytes(raw!))
              observeRaw(lease, keys[index]!, raw!, checkpointBytes[index]!, executor)
              history.delete(keys[index]!)
              campaignAssert(item.sequence === sequence && item.campaignId === campaignIdValue && item.manifestHash === manifest.hash && item.previousHash === (previous?.hash ?? null), 'Broken immutable checkpoint chain')
              campaignAssert(item.executionEpoch >= (previous?.executionEpoch ?? 0) && item.budget.operations === sequence + 1, 'Checkpoint epoch/count regression')
              assertIndex(manifest, item)
              if (previous) for (const key of CAMPAIGN_BUDGET_KEYS) campaignAssert(item.budget[key] >= previous.budget[key], 'Checkpoint budget regression')
              campaignAssert(!operationIds.has(item.operationId), 'Operation reused in checkpoint chain')
              operationIds.add(item.operationId); previous = item; batch.push(item)
              if (executor) await executor.checkpoint()
            }
            const receiptKeys = batch.map(item => campaignKeys.receipt(campaignIdValue, item.operationId))
            const evidenceBatch = await guarded(receiptKeys)
            if (moved) break
            const evidenceItems: CampaignReceipt[] = [], receiptBytes: number[] = [], eventKeys = new Set<string>()
            for (const [index, item] of batch.entries()) {
              const raw = evidenceBatch.get(receiptKeys[index]!) ?? null
              const evidence = await rawValidator.receipt(raw)
              receiptBytes.push(utf8Bytes(raw!))
              observeRaw(lease, receiptKeys[index]!, raw!, receiptBytes[index]!, executor)
              campaignAssert(evidence.campaignId === campaignIdValue && evidence.operationId === item.operationId && evidence.sequence === item.sequence && evidence.checkpointHash === item.hash && evidence.manifestHash === manifest.hash && evidence.executionEpoch === item.executionEpoch, 'Broken receipt chain')
              campaignAssert(evidence.requestHashes.length <= 1 && evidence.artifactHashes.length <= 1, 'Receipt exceeds one-request/one-artifact envelope')
              if (item.sequence === head.sequence) campaignAssert(item.hash === checkpoint.hash && evidence.hash === receipt.hash, 'Final immutable records changed behind the verified head')
              evidenceItems.push(evidence)
              for (const hash of evidence.requestHashes) {
                const ref = [...item.tasks.flatMap(task => task.request ? [task.request] : []), ...item.storage.openAllocations.map(row => row.request)].find(ref => ref.hash === hash)
                campaignAssert(ref, 'Receipt request is absent from checkpoint')
                eventKeys.add(campaignKeys.request(campaignIdValue, ref.id, ref.revision))
              }
              for (const hash of evidence.artifactHashes) {
                const ref = item.tasks.flatMap(task => task.artifact ? [task.artifact] : []).find(ref => ref.hash === hash)
                campaignAssert(ref, 'Receipt artifact is absent from checkpoint')
                eventKeys.add(campaignKeys.artifact(campaignIdValue, ref.taskId, ref.revision))
              }
              if (executor) await executor.checkpoint()
            }
            campaignAssert(eventKeys.size <= 64, 'History event frontier exceeded its bound')
            // Raw bytes and their measured length share this guarded batch's lifetime.
            // The public parser still independently checks bounds and canonical bytes.
            const eventRaw = new Map<string, { raw: string | null; valueBytes: number }>(), eventKeyList = [...eventKeys]
            for (let start = 0; start < eventKeyList.length && !moved; start += 32) {
              const keys = eventKeyList.slice(start, start + 32), records = await guarded(keys)
              if (moved) break
              for (const key of keys) {
                const raw = records.get(key) ?? null
                const valueBytes = raw === null ? 0 : utf8Bytes(raw)
                campaignAssert(raw === null || valueBytes <= CAMPAIGN_LIMITS.recordBytes, 'Oversized history event record')
                eventRaw.set(key, { raw, valueBytes })
              }
            }
            if (moved) break
            for (const [index, item] of batch.entries()) {
              const evidence = evidenceItems[index]!
              try {
                const requestRefs = [...item.tasks.flatMap(task => task.request ? [task.request] : []), ...item.storage.openAllocations.map(row => row.request)]
                let phaseRequest: CampaignRequest | null = null
                let phaseRequestWire: { key: string; valueBytes: number } | null = null
                if (evidence.requestHashes.length) {
                  const ref = requestRefs.find(ref => ref.hash === evidence.requestHashes[0])
                  campaignAssert(ref, 'Receipt request is absent from checkpoint')
                  const key = campaignKeys.request(campaignIdValue, ref.id, ref.revision), { raw, valueBytes } = eventRaw.get(key) ?? { raw: null, valueBytes: 0 }
                  eventRaw.delete(key)
                  phaseRequest = await rawValidator.request(raw); phaseRequestWire = { key, valueBytes }
                  observeRaw(lease, key, raw!, valueBytes, executor)
                  campaignAssert(phaseRequest.hash === ref.hash && phaseRequest.campaignId === campaignIdValue && phaseRequest.id === ref.id && phaseRequest.revision === ref.revision, 'Receipt request identity mismatch')
                  const task = item.tasks.find(task => task.taskId === phaseRequest!.taskId)
                  campaignAssert(task?.request?.hash === phaseRequest.hash && task.revision === phaseRequest.taskRevision && task.status === phaseRequest.status && phaseRequest.candidateId === item.candidateId, 'Historical request is detached from its committing task')
                  const old = allocationRequests.get(phaseRequest.id) ?? null
                  assertRequestPhase(manifest, evidence.kind, evidence.operationId, phaseRequest, old)
                  if (evidence.kind === 'reserve') {
                    campaignAssert(!allocationIds.has(phaseRequest.id), 'Allocation identity reused in history')
                    allocationIds.add(phaseRequest.id)
                    campaignAssert(replayPrevious !== null, 'Genesis cannot reserve a request')
                    await planning.reserve(replayPrevious, phaseRequest)
                    for (const key of CAMPAIGN_BUDGET_KEYS) if (!['artifacts', 'operations'].includes(key)) campaignAssert(item.budget[key] - replayPrevious.budget[key] >= phaseRequest.reservation[key], 'Historical request was not reserved')
                  }
                  allocationRequests.set(phaseRequest.id, phaseRequest)
                  campaignAssert(allocationRequests.size <= 128, 'Replay open-request retention exceeded its bound')
                }
                if (['reserve', 'dispatch_intent', 'retain_response', 'accept_artifact'].includes(evidence.kind)) campaignAssert(phaseRequest, 'Request operation lacks request evidence')
                const eventArtifacts: CampaignArtifact[] = [], artifactWires: Array<{ key: string; valueBytes: number }> = []
                for (const artifactHash of evidence.artifactHashes) {
                  const ref = item.tasks.flatMap(task => task.artifact ? [task.artifact] : []).find(ref => ref.hash === artifactHash)
                  campaignAssert(ref, 'Receipt artifact is absent from checkpoint')
                  const key = campaignKeys.artifact(campaignIdValue, ref.taskId, ref.revision), { raw, valueBytes } = eventRaw.get(key) ?? { raw: null, valueBytes: 0 }
                  eventRaw.delete(key)
                  const artifact = await rawValidator.artifact(raw)
                  observeRaw(lease, key, raw!, valueBytes, executor)
                  campaignAssert(artifact.hash === artifactHash && artifact.campaignId === campaignIdValue && artifact.taskId === ref.taskId && artifact.revision === ref.revision, 'Receipt artifact identity mismatch')
                  const spec = manifest.tasks.find(task => task.id === artifact.taskId), active = item.tasks.find(task => task.taskId === artifact.taskId)
                  campaignAssert(spec && active && active.revision === artifact.taskRevision && artifact.candidateId === item.candidateId && artifact.kind === spec.kind && same(artifact.dependencies, spec.dependsOn.map(id => item.tasks.find(task => task.taskId === id)!.artifact)), 'Historical artifact dependency identity mismatch')
                  const oldTask = replayPrevious?.tasks.find(task => task.taskId === artifact.taskId), parent = oldTask?.artifact ?? oldTask?.priorArtifact
                  campaignAssert(artifact.revision === (parent ? parent.revision + 1 : 0) && artifact.parentHash === (parent?.hash ?? null), 'Historical artifact parent mismatch')
                  eventArtifacts.push(artifact); artifactWires.push({ key, valueBytes })
                }
                campaignAssert(eventArtifacts.length === 0 || ['accept_artifact', 'replace_candidate'].includes(evidence.kind), 'Unauthorized artifact receipt')
                await planning.advance(item, evidence.kind, eventArtifacts)
                if (evidence.kind === 'accept_artifact') {
                  campaignAssert(phaseRequest, 'Settlement lacks request evidence')
                  assertAcceptedArtifact(phaseRequest, eventArtifacts, item)
                }
                if (evidence.kind === 'cancel') campaignAssert(phaseRequest === null && eventArtifacts.length === 0 && item.reason === 'user_cancelled' && replayPrevious !== null && same(item.tasks, replayPrevious.tasks), 'Invalid final cancellation shape')
                if (replayPrevious) {
                  campaignAssert(evidence.kind !== 'create', 'Create cannot recur in history')
                  assertStateTransition(replayPrevious, item, evidence.kind, phaseRequest ? 1 : 0)
                  campaignAssert(item.budget.artifacts === counterSum(replayPrevious.budget.artifacts, eventArtifacts.length), 'Historical artifact count differs from actual writes')
                  assertTaskTransition(manifest, replayPrevious, item, evidence.kind, eventArtifacts, phaseRequest ? [phaseRequest] : [])
                  if (phaseRequest) {
                    const spec = manifest.tasks.find(task => task.id === phaseRequest!.taskId)!
                    if (['reserved', 'dispatch_intent', 'response_retained', 'committed'].includes(phaseRequest.status)) campaignAssert(spec.dependsOn.every(id => item.tasks.find(task => task.taskId === id)!.status === 'committed'), 'Historical request has unmet dependencies')
                    if (evidence.kind === 'accept_artifact') {
                      const oldTask = replayPrevious.tasks.find(task => task.taskId === phaseRequest!.taskId)
                      campaignAssert(oldTask?.status === 'response_retained' && oldTask.request?.hash === phaseRequest.parentHash && oldTask.revision === phaseRequest.taskRevision && replayPrevious.candidateId === phaseRequest.candidateId, 'Settlement lacks still-active retained response')
                    }
                  }
                  const expectedDigest = await rawValidator.operationDigest({ kind: evidence.kind, next: businessState(item, replayPrevious), storageRule: { source: campaignStorageSource(evidence.kind, phaseRequest), requestId: phaseRequest?.id ?? null, settle: evidence.kind === 'accept_artifact' }, artifacts: evidence.artifactHashes, requests: evidence.requestHashes })
                  campaignAssert(evidence.businessDigest === expectedDigest, 'Historical operation business identity mismatch')
                }
                const D = decodeStorageBytes(evidence.serializedBytes)
                const rebuilt = applyCampaignStorage(manifest, replayStorage, evidence.kind, phaseRequest, D)
                campaignAssert(same(rebuilt.storage, item.storage) && same(rebuilt.effect, evidence.storageEffect), 'Receipt allocation ledger mismatch')
                accumulatedBytes = counterSum(accumulatedBytes, D)
                campaignAssert(accumulatedBytes === decodeStorageBytes(item.storage.writtenBytes), 'Receipt/checkpoint accounting mismatch')
                const historicalHead: CampaignHead = { schemaVersion: 2, campaignId: campaignIdValue, sequence: item.sequence, manifestHash: manifest.hash, checkpointHash: item.hash, executionEpoch: item.executionEpoch, status: item.status, receiptId: item.operationId }
                // The already validated canonical raw values were actually read above.
                // Retain only their byte counts for this batch, not another raw copy.
                const baseWireBytes = counterSum(utf8Bytes(campaignKeys.checkpoint(campaignIdValue, item.sequence)) + checkpointBytes[index]!, utf8Bytes(receiptKeys[index]!) + receiptBytes[index]!)
                const wire = [...artifactWires, ...(phaseRequestWire ? [phaseRequestWire] : []), { key: headKey, valueBytes: utf8Bytes(canonicalStringify(historicalHead)) }]
                if (item.sequence === 0) {
                  campaignAssert(evidence.kind === 'create' && phaseRequest === null && eventArtifacts.length === 0, 'Invalid genesis receipt')
                  const initialBudget = emptyCampaignBudget(); initialBudget.activeMs = 10_000; initialBudget.operations = 1
                  campaignAssert(item.status === 'prepared' && item.reason === null && item.executionEpoch === 0 && item.candidateId === manifest.candidateId && item.lastWallTime === manifest.createdAt && item.bodyCharacters === 0 && same(item.budget, initialBudget) && item.tasks.every(task => task.revision === 0 && task.status === 'pending' && task.request === null && task.artifact === null && task.priorArtifact === null), 'Invalid genesis state')
                  campaignAssert(evidence.businessDigest === await hashCampaignValue('campaign-operation-v2', { kind: 'create', manifestHash: manifest.hash }), 'Genesis business identity mismatch')
                  // The only catalog writer appends one ID. Its creation-time value is
                  // therefore this immutable ordering's prefix, not the current catalog.
                  wire.push({ key: CAMPAIGN_CATALOG_KEY, valueBytes: utf8Bytes(canonicalStringify({ schemaVersion: 1, ids: ids.slice(0, ids.indexOf(campaignIdValue) + 1) })) }, { key: manifestKey, valueBytes: utf8Bytes(canonicalStringify(manifest)) })
                }
                campaignAssert(wire.reduce((total, entry) => counterSum(total, utf8Bytes(entry.key) + entry.valueBytes), baseWireBytes) === D, 'Receipt differs from actual immutable write bytes')
                if (phaseRequest && phaseRequestWire) {
                  const wanted = wantedRequests.get(phaseRequestWire.key)
                  if (wanted) {
                    campaignAssert(phaseRequest.id === wanted.id && phaseRequest.revision === wanted.revision && phaseRequest.hash === wanted.hash, 'Final request reference differs from verified history')
                    retain(phaseRequestWire.key, phaseRequestWire.valueBytes, phaseRequest.hash); requests.set(phaseRequest.hash, phaseRequest)
                  }
                }
                for (const [index, artifact] of eventArtifacts.entries()) {
                  const wire = artifactWires[index]!, wanted = wantedArtifacts.get(wire.key)
                  if (wanted) {
                    campaignAssert(artifact.taskId === wanted.taskId && artifact.revision === wanted.revision && artifact.hash === wanted.hash, 'Final artifact reference differs from verified history')
                    retain(wire.key, wire.valueBytes, artifact.hash); artifacts.set(artifact.hash, artifact)
                  }
                }

                if (phaseRequest && evidence.kind === 'accept_artifact') allocationRequests.delete(phaseRequest.id)
                replayStorage = rebuilt.storage; replayPrevious = item
                evidenceBatch.delete(receiptKeys[index]!)
                if (executor) await executor.checkpoint(true)
              } finally { rawValidator.releaseHistoryCheckpoint(item) }
            }
          } finally { rawValidator.endHistoryBatch() }
        }
        if (moved) { proofs.discard(lease, 'conflict'); continue }
        // Every parent revision was already checked in chronological receipt
        // replay. Require exact final key/id/revision/hash coverage before using
        // these objects, rather than walking and hashing the same history twice.
        for (const [key, ref] of wantedRequests) {
          const request = requests.get(ref.hash)
          campaignAssert(captured.get(key) === ref.hash && request?.id === ref.id && request.revision === ref.revision, 'Final request lacks verified immutable history coverage')
        }
        for (const [key, ref] of wantedArtifacts) {
          const artifact = artifacts.get(ref.hash)
          campaignAssert(captured.get(key) === ref.hash && artifact?.taskId === ref.taskId && artifact.revision === ref.revision, 'Final artifact lacks verified immutable history coverage')
        }
        campaignAssert(assertActiveRefs(manifest, checkpoint, artifacts, requests) === checkpoint.bodyCharacters, 'Canonical body count/index mismatch')
        const finalFence = await io.getMany([headKey, CAMPAIGN_CATALOG_KEY, successorKey])
        if (finalFence.get(headKey) !== rawHead) { proofs.discard(lease, 'conflict'); continue }
        campaignAssert(finalFence.get(successorKey) == null, 'Campaign successor appeared behind an unchanged head; stored bytes preserved')
        const finalIds = catalog(finalFence.get(CAMPAIGN_CATALOG_KEY) ?? null), prefixLength = ids.indexOf(campaignIdValue) + 1
        campaignAssert(same(finalIds.slice(0, prefixLength), ids.slice(0, prefixLength)), 'Append-only catalog prefix changed during verification')
        const snapshot = { manifest, head, checkpoint, receipt, artifacts, requests, rawHead }
        proofs.seal(lease, snapshot, ids.slice(0, prefixLength))
        if (executor && (!proofs.collecting(lease) || !lease.snapshot)) throw new ProducerVerificationError('verification_capacity')
        return snapshot
      } finally { rawValidator.dispose() }
    }
    throw new CampaignProtocolError('conflict', 'Campaign changed repeatedly while reading; refresh before acting')
  }

  async function buildWrite(
    manifest: CampaignManifest, state: CampaignState, sequence: number, previousHash: string | null,
    operationId: string, kind: CampaignReceipt['kind'], businessDigest: string, bodyCharacters: number,
    fixed: Array<{ key: string; expectedValue: string | null; value: string }>, previousStorage: CampaignState['storage'],
    artifactHashes: string[], requestHashes: string[], request: CampaignRequest | null,
  ): Promise<{ entries: Array<{ key: string; expectedValue: string | null; value: string }>; checkpoint: CampaignCheckpoint; receipt: CampaignReceipt; head: CampaignHead; valueBytes: Map<string, number> }> {
    const zeroHash = '0'.repeat(64)
    // Freeze the operation-derived open-index shape, never a guessed residual.
    const skeleton = applyCampaignStorage(manifest, previousStorage, kind, request, 0)
    const checkpointPayload = { ...structuredClone(state), storage: skeleton.storage, schemaVersion: 2 as const, campaignId: manifest.campaignId, sequence, manifestHash: manifest.hash, previousHash, operationId, bodyCharacters }
    const checkpoint: CampaignCheckpoint = { ...checkpointPayload, hash: zeroHash }
    const receiptPayload = { schemaVersion: 2 as const, campaignId: manifest.campaignId, operationId, kind, businessDigest, expectedSequence: sequence === 0 ? null : sequence - 1, sequence, executionEpoch: state.executionEpoch, manifestHash: manifest.hash, checkpointHash: zeroHash, artifactHashes, requestHashes, serializedBytes: encodeStorageBytes(0), storageEffect: skeleton.effect }
    const receipt: CampaignReceipt = { ...receiptPayload, hash: zeroHash }
    const head: CampaignHead = { schemaVersion: 2, campaignId: manifest.campaignId, sequence, manifestHash: manifest.hash, checkpointHash: zeroHash, executionEpoch: state.executionEpoch, status: state.status, receiptId: operationId }
    const entriesFor = () => [...fixed, { key: campaignKeys.checkpoint(manifest.campaignId, sequence), expectedValue: null, value: canonicalStringify(checkpoint) }, { key: campaignKeys.receipt(manifest.campaignId, operationId), expectedValue: null, value: canonicalStringify(receipt) }, { key: campaignKeys.head(manifest.campaignId), expectedValue: null as string | null, value: canonicalStringify(head) }]
    const measured = entriesFor().reduce((sum, entry) => counterSum(sum, counterSum(utf8Bytes(entry.key), utf8Bytes(entry.value))), 0)
    const accounting = applyCampaignStorage(manifest, previousStorage, kind, request, measured)
    checkpoint.storage = accounting.storage
    const { hash: _checkpointHash, ...finalCheckpointPayload } = checkpoint
    checkpoint.hash = await hashCampaignValue('campaign-checkpoint-v2', finalCheckpointPayload)
    receipt.serializedBytes = encodeStorageBytes(measured); receipt.storageEffect = accounting.effect; receipt.checkpointHash = checkpoint.hash
    const { hash: _receiptHash, ...finalReceiptPayload } = receipt
    receipt.hash = await hashCampaignValue('campaign-receipt-v2', finalReceiptPayload)
    head.checkpointHash = checkpoint.hash
    const entries = entriesFor()
    let verifiedBytes = 0
    const measuredValues = new Map<string, number>()
    for (const entry of entries) {
      const valueBytes = utf8Bytes(entry.value)
      measuredValues.set(entry.key, valueBytes)
      verifiedBytes = counterSum(verifiedBytes, utf8Bytes(entry.key)); verifiedBytes = counterSum(verifiedBytes, valueBytes)
      campaignAssert(valueBytes <= CAMPAIGN_LIMITS.recordBytes, 'Campaign record exceeds serialization bound', 'budget')
    }
    campaignAssert(verifiedBytes === measured, 'Frozen storage serialization length changed')
    assertIndex(manifest, checkpoint)
    if (kind !== 'cancel') {
      campaignAssert(state.budget.operations < manifest.budget.operations, 'Final operation slot is reserved for cancellation', 'budget')
      campaignAssert(state.budget.activeMs <= manifest.budget.activeMs - 10_000, 'Final active-time envelope is reserved for cancellation', 'budget')
    }
    campaignAssert(state.budget.operations <= manifest.budget.operations - (RECOVERY_KINDS.has(kind) ? 0 : CAMPAIGN_RECOVERY_OPERATION_RESERVE), 'Normal operation capacity reserved for recovery', 'budget')
    await validateCampaignCheckpoint(checkpoint); await validateCampaignReceipt(receipt); validateCampaignHead(head)
    return { entries, checkpoint, receipt, head, valueBytes: measuredValues }
  }

  async function create(input: CampaignManifest, operationId: string): Promise<CampaignCommitResult> {
    const frozen = structuredClone(input); campaignId(operationId)
    const manifest = await validateCampaignManifest(frozen)
    validatePlanningProfile(manifest)
    const digest = await hashCampaignValue('campaign-operation-v2', { kind: 'create', manifestHash: manifest.hash })
    const prior = await getReceipt(manifest.campaignId, operationId)
    if (prior) {
      campaignAssert(prior.businessDigest === digest && prior.kind === 'create', 'Operation ID has another payload', 'operation_conflict')
      const snapshot = await read(manifest.campaignId); campaignAssert(snapshot, 'Creation receipt campaign is missing')
      return { snapshot, receipt: prior, replayed: true }
    }
    const headKey = campaignKeys.head(manifest.campaignId)
    const values = await io.getMany([CAMPAIGN_CATALOG_KEY, headKey])
    const rawCatalog = values.get(CAMPAIGN_CATALOG_KEY) ?? null
    const ids = catalog(rawCatalog)
    campaignAssert(values.get(headKey) == null && !ids.includes(manifest.campaignId), 'Campaign already exists', 'conflict')
    campaignAssert(ids.length < CAMPAIGN_LIMITS.campaigns, 'Campaign catalog is full', 'budget')
    const budget = emptyCampaignBudget(); budget.activeMs = 10_000; budget.operations = 1
    const state: CampaignState = { status: 'prepared', reason: null, executionEpoch: 0, candidateId: manifest.candidateId, tasks: manifest.tasks.map(task => ({ taskId: task.id, revision: 0, status: 'pending', artifact: null, priorArtifact: null, request: null })), budget, storage: emptyCampaignStorage(manifest.storage.recoveryReserveBytes), lastWallTime: manifest.createdAt }
    const fixed = [{ key: CAMPAIGN_CATALOG_KEY, expectedValue: rawCatalog, value: canonicalStringify({ schemaVersion: 1, ids: [...ids, manifest.campaignId] }) }, { key: campaignKeys.manifest(manifest.campaignId, manifest.hash), expectedValue: null, value: canonicalStringify(manifest) }]
    const write = await buildWrite(manifest, state, 0, null, operationId, 'create', digest, 0, fixed, state.storage, [], [], null)
    try {
      if (!await io.compareAndSwapMany(write.entries)) {
        const winner = await getReceipt(manifest.campaignId, operationId)
        if (winner) {
          campaignAssert(winner.businessDigest === digest && winner.kind === 'create', 'Concurrent creation operation collision', 'operation_conflict')
          const snapshot = await read(manifest.campaignId); campaignAssert(snapshot, 'Committed Campaign disappeared')
          return { snapshot, receipt: winner, replayed: true }
        }
        throw new CampaignProtocolError('conflict', 'Campaign create conflict; nothing overwritten')
      }
    } catch (cause) {
      if (cause instanceof CampaignProtocolError) throw cause
      throw new CampaignProtocolError('storage_unknown', 'Campaign create outcome is unconfirmed; read its receipt before retrying')
    }
    return { snapshot: { manifest, head: write.head, checkpoint: write.checkpoint, receipt: write.receipt, artifacts: new Map(), requests: new Map(), rawHead: canonicalStringify(write.head) }, receipt: write.receipt, replayed: false }
  }

  async function verifyProof(lease: CampaignProofLease, expectedRawHead: string, check: () => void = () => {}, executor?: ProducerVerificationExecutor): Promise<CampaignSnapshot> {
    const started = performance.now()
    const id = lease.campaignId, headKey = campaignKeys.head(id), successorKey = campaignKeys.checkpoint(id, lease.snapshot!.head.sequence + 1)
    const live = () => { check(); campaignAssert(proofs.isLive(lease), 'Campaign action proof expired during verification', 'conflict') }
    const prefix = (raw: string | null) => {
      const ids = catalog(raw)
      campaignAssert(same(ids.slice(0, lease.catalogPrefix.length), lease.catalogPrefix), 'Append-only catalog prefix changed during verification')
    }
    try {
      live()
      const discovery = await io.getMany([headKey, CAMPAIGN_CATALOG_KEY, successorKey])
      live()
      campaignAssert(discovery.get(headKey) === expectedRawHead, 'Campaign head/epoch changed; mutation not committed', 'conflict')
      const head = validateCampaignHead(parseCampaignRecord(discovery.get(headKey) ?? null))
      campaignAssert(head.campaignId === id, 'Head key mismatch')
      prefix(discovery.get(CAMPAIGN_CATALOG_KEY) ?? null)
      campaignAssert(discovery.get(successorKey) == null, 'Campaign head sequence rolled back behind an immutable checkpoint; stored bytes preserved')
      let batch: Array<[string, { raw: string; bytes: number }]> = [], bytes = 0
      const observe = async () => {
        const records = await io.getMany([headKey, ...batch.map(([key]) => key)])
        live()
        campaignAssert(records.get(headKey) === expectedRawHead, 'Campaign head/epoch changed during proof observation', 'conflict')
        for (const [key, entry] of batch) {
          campaignAssert(records.get(key) === entry.raw, 'Immutable Campaign record differs from its verified action prefix')
          proofs.observed(entry.bytes)
          executor?.matchedRecord(key)
        }
        batch = []; bytes = 0
        if (executor) await executor.checkpoint()
      }
      for (const entry of lease.entries) {
        if (batch.length && (batch.length >= 32 || bytes + entry[1].bytes > CAMPAIGN_PROOF_BATCH_BYTES)) await observe()
        batch.push(entry); bytes += entry[1].bytes
      }
      if (batch.length) await observe()
      const finalFence = await io.getMany([headKey, CAMPAIGN_CATALOG_KEY, successorKey])
      live()
      campaignAssert(finalFence.get(headKey) === expectedRawHead, 'Campaign head/epoch changed during final proof fence', 'conflict')
      campaignAssert(finalFence.get(successorKey) == null, 'Campaign successor appeared behind an unchanged head; stored bytes preserved')
      prefix(finalFence.get(CAMPAIGN_CATALOG_KEY) ?? null)
      proofs.passed()
      return lease.snapshot!
    } catch (cause) {
      proofs.discard(lease, cause instanceof CampaignProtocolError && cause.code === 'conflict' ? 'conflict' : 'mismatch')
      throw cause
    } finally { proofs.timed('exact', started) }
  }

  async function verifyWithinAction(campaignIdValue: string, expectedRawHead: string, scope: CampaignActionScope, check: () => void = () => {}): Promise<CampaignSnapshot> {
    const lease = proofs.acquireForVerification(scope, campaignIdValue, expectedRawHead)
    const live = () => { check(); campaignAssert(proofs.canCommit(lease), 'Campaign verification scope closed', 'conflict') }
    try {
      live()
      // Capacity/admission fallback never captures or seeds a replacement proof.
      const accelerated = proofs.collecting(lease) && lease.snapshot !== null
      if (accelerated) campaignAssert(lease.snapshot!.rawHead === expectedRawHead, 'Campaign verification proof cannot rebase', 'conflict')
      const snapshot = accelerated ? await verifyProof(lease, expectedRawHead, live) : await coldRead(campaignIdValue, null, live)
      live(); campaignAssert(snapshot && snapshot.rawHead === expectedRawHead, 'Campaign verification head changed', 'conflict')
      return accelerated ? structuredClone(snapshot) : snapshot
    } catch (cause) { proofs.discard(lease, 'error'); throw cause }
    finally { proofs.end(lease) }
  }

  async function commit(expected: CampaignSnapshot, input: CampaignMutation, canCommit: () => boolean = () => true, scope?: CampaignActionScope): Promise<CampaignCommitResult> {
    const lease = proofs.begin(scope, expected.manifest.campaignId)
    try { return await commitAction(expected, input, canCommit, lease) }
    catch (cause) {
      proofs.discard(lease, cause instanceof CampaignProtocolError && cause.code === 'conflict' ? 'conflict' : 'error')
      throw cause
    } finally { proofs.end(lease) }
  }

  async function commitAction(expected: CampaignSnapshot, input: CampaignMutation, canCommit: () => boolean, lease: CampaignProofLease | null): Promise<CampaignCommitResult> {
    campaignAssert(expected.manifest.schemaVersion === 2 && expected.head.schemaVersion === 2, 'Legacy Campaign is read-only', 'legacy_read_only')
    const mutation = structuredClone(input)
    const expectedRawHead = expected.rawHead
    const id = expected.manifest.campaignId
    campaignId(id); campaignId(mutation.operationId)
    campaignRecord(mutation, Object.hasOwn(mutation, 'artifacts') ? (Object.hasOwn(mutation, 'requests') ? ['operationId', 'kind', 'next', 'artifacts', 'requests'] : ['operationId', 'kind', 'next', 'artifacts']) : (Object.hasOwn(mutation, 'requests') ? ['operationId', 'kind', 'next', 'requests'] : ['operationId', 'kind', 'next']), 'mutation')
    validateCampaignState(mutation.next)
    campaignAssert(['start', 'reserve', 'dispatch_intent', 'retain_response', 'accept_artifact', 'pause', 'resume', 'cancel', 'reconcile', 'replace_candidate', 'block'].includes(mutation.kind), 'Invalid mutation kind')
    campaignAssert((mutation.artifacts?.length ?? 0) <= 1 && (mutation.requests?.length ?? 0) <= 1, 'Mutation exceeds index bound')
    const artifacts = await Promise.all((mutation.artifacts ?? []).map(validateCampaignArtifact))
    const requests = await Promise.all((mutation.requests ?? []).map(validateCampaignRequest))
    const businessDigest = (previous: CampaignState) => hashCampaignValue('campaign-operation-v2', { kind: mutation.kind, next: businessState(mutation.next, previous), storageRule: { source: campaignStorageSource(mutation.kind, requests[0] ?? null), requestId: requests[0]?.id ?? null, settle: mutation.kind === 'accept_artifact' }, artifacts: artifacts.map(item => item.hash), requests: requests.map(item => item.hash) })
    const prior = await getReceipt(id, mutation.operationId)
    if (prior) {
      proofs.discard(lease, 'replay')
      const digest = await businessDigest(expected.checkpoint)
      campaignAssert(prior.businessDigest === digest && prior.kind === mutation.kind, 'Operation ID has another payload', 'operation_conflict')
      const snapshot = await read(id); campaignAssert(snapshot, 'Receipt campaign is missing')
      return { snapshot, receipt: prior, replayed: true }
    }
    if (lease?.snapshot && lease.snapshot.rawHead !== expectedRawHead) proofs.discard(lease, 'conflict')
    const accelerated = proofs.collecting(lease) && lease.snapshot !== null
    const check = () => campaignAssert(canCommit(), 'Campaign action expired during planning validation', 'conflict')
    const current = accelerated ? await verifyProof(lease!, expectedRawHead) : await coldRead(id, lease, check)
    campaignAssert(current && current.rawHead === expectedRawHead, 'Campaign head/epoch changed; mutation not committed', 'conflict')
    // A public snapshot supplies identity/fencing, never the previous business
    // state. Derive the delta from the freshly verified private/cold state.
    const digest = await businessDigest(current.checkpoint)
    if (accelerated) campaignAssert(!lease!.entries.has(campaignKeys.receipt(id, mutation.operationId)), 'Operation identity already exists in the verified prefix', 'operation_conflict')
    const next = mutation.next
    const previous = current.checkpoint
    const planning = new PlanningValidationView(current.manifest, check)
    planning.seed(previous, current.artifacts)
    campaignAssert(same(next.storage, previous.storage), 'Caller cannot alter repository-owned storage accounting')
    assertStateTransition(previous, next, mutation.kind, requests.length)
    next.budget.operations = counterSum(previous.budget.operations, 1)
    next.budget.artifacts = counterSum(previous.budget.artifacts, artifacts.length)
    const allArtifacts = new Map(current.artifacts)
    const allRequests = new Map(current.requests)
    const fixed: Array<{ key: string; expectedValue: string | null; value: string }> = []
    for (const artifact of artifacts) {
      campaignAssert(artifact.campaignId === id && artifact.candidateId === next.candidateId, 'Artifact belongs to another campaign/candidate')
      campaignAssert(['accept_artifact', 'replace_candidate'].includes(mutation.kind), 'Artifact write not permitted by this operation')
      const oldTask = previous.tasks.find(task => task.taskId === artifact.taskId)
      const old = oldTask?.artifact ?? oldTask?.priorArtifact
      campaignAssert(artifact.revision === (old ? old.revision + 1 : 0) && artifact.parentHash === (old?.hash ?? null), 'Artifact revision/parent mismatch')
      allArtifacts.set(artifact.hash, artifact)
      fixed.push({ key: campaignKeys.artifact(id, artifact.taskId, artifact.revision), expectedValue: null, value: canonicalStringify(artifact) })
    }
    for (const request of requests) {
      campaignAssert(request.campaignId === id && request.candidateId === next.candidateId, 'Request belongs to another campaign/candidate')
      const oldRef = previous.storage.openAllocations.find(row => row.request.id === request.id)?.request ?? previous.tasks.find(task => task.taskId === request.taskId)?.request
      const old = oldRef ? current.requests.get(oldRef.hash) : null
      if (!old || old.id !== request.id) campaignAssert(mutation.kind === 'reserve' && oldRef === null, 'New request requires unoccupied reservation')
      assertRequestPhase(current.manifest, mutation.kind, mutation.operationId, request, old && old.id === request.id ? old : null)
      allRequests.set(request.hash, request)
      fixed.push({ key: campaignKeys.request(id, request.id, request.revision), expectedValue: null, value: canonicalStringify(request) })
    }
    if (['reserve', 'dispatch_intent', 'retain_response', 'accept_artifact'].includes(mutation.kind)) campaignAssert(requests.length === 1, 'Execution operation needs exactly one request revision')
    if (mutation.kind === 'reserve') {
      await planning.reserve(previous, requests[0]!)
      const reservation = requests[0]!.reservation
      campaignAssert(requests[0]!.storageAllocationBytes === campaignRequestStorageAllowance(requests[0]!.preparedInput, current.manifest.tasks.length, reservation.responseBytes), 'Request lacks immutable future-write envelope', 'budget')
      const originKey = campaignKeys.request(id, requests[0]!.id, 0)
      if (accelerated) campaignAssert(!lease!.entries.has(originKey), 'Request allocation identity already used')
      campaignAssert(await readRecord(originKey) === null, 'Request allocation identity already used')
      campaignAssert(reservation.attempts === 1 && reservation.inputBytes === requests[0]!.inputBytes && reservation.inputUtf16 === requests[0]!.inputUtf16 && reservation.responseBytes > 0 && reservation.activeMs > 0, 'Request reservation does not cover its input/output/time')
      for (const key of CAMPAIGN_BUDGET_KEYS) if (!['artifacts', 'operations'].includes(key)) campaignAssert(next.budget[key] - previous.budget[key] >= reservation[key], 'Request was not reserved before dispatch')
      campaignAssert(previous.budget.artifacts < current.manifest.budget.artifacts, 'No reserved artifact capacity remains', 'budget')
    }
    for (const request of requests) if (request.response) campaignAssert(utf8Bytes(request.response.text) <= request.reservation.responseBytes, 'Response exceeds its immutable reservation')
    if (mutation.kind === 'accept_artifact') assertAcceptedArtifact(requests[0]!, artifacts, next)
    if (mutation.kind === 'cancel') campaignAssert(requests.length === 0 && artifacts.length === 0 && next.reason === 'user_cancelled' && same(next.tasks, previous.tasks), 'Invalid final cancellation shape')

    campaignAssert(new Set(fixed.map(entry => entry.key)).size === fixed.length, 'Duplicate immutable target')
    assertIndex(current.manifest, next)
    assertTaskTransition(current.manifest, previous, next, mutation.kind, artifacts, requests)
    const bodyCharacters = assertActiveRefs(current.manifest, next, allArtifacts, allRequests)
    await planning.advance(next, mutation.kind, artifacts)
    if (next.status === 'completed') campaignAssert(next.tasks.every(task => task.status === 'committed'), 'Fixture completion requires every task artifact')
    const write = await buildWrite(current.manifest, next, current.head.sequence + 1, previous.hash, mutation.operationId, mutation.kind, digest, bodyCharacters, fixed, previous.storage, artifacts.map(item => item.hash), requests.map(item => item.hash), requests[0] ?? null)
    write.entries.find(entry => entry.key === campaignKeys.head(id))!.expectedValue = expectedRawHead
    const activeArtifacts = new Map(next.tasks.flatMap(task => [task.artifact, task.priorArtifact].flatMap(ref => ref ? [[ref.hash, allArtifacts.get(ref.hash)!] as const] : [])))
    const activeRequests = new Map([...next.tasks.flatMap(task => task.request ? [task.request] : []), ...write.checkpoint.storage.openAllocations.map(row => row.request)].map(ref => [ref.hash, allRequests.get(ref.hash)!] as const))
    const snapshot = { manifest: current.manifest, head: write.head, checkpoint: write.checkpoint, receipt: write.receipt, artifacts: activeArtifacts, requests: activeRequests, rawHead: canonicalStringify(write.head) }
    // Prepare the detached public graph before CAS. Optional proof maintenance
    // after a confirmed durable write cannot turn success into an error.
    const publicSnapshot = accelerated ? structuredClone(snapshot) : snapshot
    // Keep existing prefix order; append the new checkpoint, receipt, then
    // event records. Batching can differ from the cold reader: neither path is
    // an atomic historical snapshot or a guard against changes after observation.
    const immutableEntries = [
      write.entries.find(entry => entry.key === campaignKeys.checkpoint(id, write.head.sequence))!,
      write.entries.find(entry => entry.key === campaignKeys.receipt(id, mutation.operationId))!,
      ...fixed,
    ]
    proofs.transition()
    try {
      const committed = await io.compareAndSwapMany(write.entries, () => canCommit() && proofs.canCommit(lease))
      if (!committed) {
        proofs.discard(lease, 'conflict')
        // Another identical invocation can win the same CAS. It is a no-write
        // replay only when its independently verified business receipt matches.
        const winner = await getReceipt(id, mutation.operationId)
        if (winner) {
          campaignAssert(winner.businessDigest === digest, 'Concurrent operation ID collision', 'operation_conflict')
          const snapshot = await read(id); campaignAssert(snapshot, 'Committed Campaign disappeared')
          return { snapshot, receipt: winner, replayed: true }
        }
        throw new CampaignProtocolError('conflict', 'Campaign CAS failed; no mutation applied by this attempt')
      }
    } catch (cause) {
      if (cause instanceof CampaignProtocolError) throw cause
      throw new CampaignProtocolError('storage_unknown', 'Commit acknowledgment is unconfirmed; persisted receipt is the only commit evidence')
    }
    proofs.extend(lease, snapshot, immutableEntries, write.valueBytes)
    return { snapshot: publicSnapshot, receipt: write.receipt, replayed: false }
  }
  async function inspect(campaignIdValue: string) {
    const raw = await readRecord(campaignKeys.head(campaignIdValue))
    if (raw !== null && (parseCampaignRecord(raw) as { schemaVersion?: unknown }).schemaVersion === 1) return createLegacyCampaignInspector(io).read(campaignIdValue)
    return read(campaignIdValue)
  }
  const repository: CampaignRepository = { list, create, read, verifyWithinAction, inspect, commit, getReceipt, getOperationArtifacts, createActionScope: id => proofs.create(id), disposeActionScope: scope => proofs.dispose(scope), getActionProofStats: () => proofs.observations() }
  const known = (scope: CampaignActionScope, executor: ProducerVerificationExecutor) => {
    const record = sessionLeases.get(scope)
    campaignAssert(record && record.executor === executor && proofs.canCommit(record.lease), 'Unknown or closed verification bridge', 'conflict')
    return record.lease
  }
  registerCampaignVerificationBridge(repository, {
    async read(id, scope, executor) {
      campaignAssert(!sessionLeases.has(scope), 'Verification baseline cannot be reseeded', 'conflict')
      const lease = proofs.begin(scope, id)
      campaignAssert(lease && !lease.attempted && !lease.snapshot, 'Verification requires a fresh private scope', 'conflict')
      sessionLeases.set(scope, { lease, executor })
      executor.bindCapture((key, raw, bytes) => {
        executor.check(); proofs.observe(lease, key, raw, bytes)
        if (!proofs.collecting(lease)) throw new ProducerVerificationError('verification_capacity')
      }, () => ({ bytes: lease.bytes, entries: lease.entries.size, active: lease.activeRecords }))
      try {
        const snapshot = await coldRead(id, lease, executor.check, executor)
        proofs.seedVerification(lease, snapshot)
        return snapshot
      } catch (error) { proofs.discard(lease, 'error'); throw error }
      finally { proofs.end(lease) }
    },
    capture(scope, executor, key, raw, bytes) {
      const lease = known(scope, executor)
      proofs.observe(lease, key, raw, bytes)
      if (!proofs.collecting(lease)) throw new ProducerVerificationError('verification_capacity')
    },
    requireCapture(scope, executor) {
      const lease = known(scope, executor)
      if (!proofs.collecting(lease) || !lease.snapshot) throw new ProducerVerificationError('verification_capacity')
    },
    sealAggregate(scope, executor, written, active) {
      const lease = known(scope, executor)
      executor.assertCoverage(lease.entries)
      if (active > 4 * CAMPAIGN_LIMITS.tasks) throw new ProducerVerificationError('verification_capacity')
      proofs.sealAggregate(lease, written, active)
    },
    async fence(scope, executor, rawHead) {
      const expected = known(scope, executor), lease = proofs.acquireForVerification(scope, expected.campaignId, rawHead)
      try { await verifyProof(lease, rawHead, executor.check, executor) }
      finally { proofs.end(lease) }
    },
  })
  return repository
}
