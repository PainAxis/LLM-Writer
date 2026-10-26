/** V3 adoption and immutable producer replay. No persisted value grants dispatch authority. */
import type { CampaignActionProofStats, CampaignActionScope, CampaignArtifact, CampaignArtifactRef, CampaignBudget, CampaignRepository, CampaignRepositoryIO, CampaignSnapshot, CampaignTaskState } from '../../types/writerCampaign'
import type {
  BodyProducerPhase, BodyProducerRequest, BodyProducerResponse, BodyProducerReview, ProducerCampaignCheckpoint,
  ProducerCampaignHead, ProducerCampaignManifest, ProducerCampaignReceipt, ProducerCampaignRepository,
  ProducerActionScope, ProducerCampaignSnapshot, ProducerCommitResult, ProducerEvent, ProducerMutation, ProducerOperationKind, ProducerRepositoryOptions,
  ProducerVerificationContext, ProducerVerificationStats,
} from '../../types/bodyProducer'
import { idbCompareAndSwapMany, idbGetMany } from '../blobStore'
import { campaignKeys, createCampaignRepository } from './store'
import { CampaignActionProofPool } from './actionProof'
import { campaignVerificationBridge, emptyVerificationStats, ProducerVerificationError, ProducerVerificationExecutor } from './verificationSession'
import {
  CAMPAIGN_BUDGET_KEYS, CAMPAIGN_LIMITS, CampaignProtocolError, campaignAssert, campaignId, campaignInteger,
  campaignRecord, canonicalStringify, decodeStorageBytes, emptyCampaignBudget, encodeStorageBytes,
  hashCampaignValue, hashText, parseCampaignRecord, sealCampaignArtifact, utf8Bytes, validateCampaignArtifact,
  validateCampaignBudget, validateCampaignHead, validateCampaignState,
} from './protocol'
import { validatePlanningProfile } from './planningProfile'
import { compileProducedBodyEvidence, validatePreparedBodyProducerInput } from './bodyProducerEvidence'
import { applyProducerStorage, producerFuturePhases, PRODUCER_ORIGIN_RECORD_BYTES, PRODUCER_RESPONSE_RECORD_BYTES, PRODUCER_REVIEW_RECORD_BYTES } from './producerStorage'

const HASH = /^[a-f0-9]{64}$/
const ZERO_HASH = '0'.repeat(64)
const KINDS: ProducerOperationKind[] = ['adopt', 'body_revision', 'reserve', 'dispatch_intent', 'outcome_unknown', 'retain_response', 'resolve', 'cancel']
const POLICY = Object.freeze({ protocol: 'body-producer-policy-v1', requestLimit: 8, openLimit: 1, liveEnabled: false, retention: 'local_campaign_lifetime_no_automatic_deletion' } as const)
const DOMAIN = Object.freeze({ manifest: 'campaign-manifest-v3', checkpoint: 'campaign-checkpoint-v3', receipt: 'campaign-receipt-v3', request: 'body-producer-request-v1', phase: 'body-producer-phase-v1', response: 'body-producer-response-v1', review: 'body-producer-review-v1' })
const equal = (a: unknown, b: unknown) => canonicalStringify(a) === canonicalStringify(b)
const emptyEvent = (): ProducerEvent => ({ requestHash: null, phaseHash: null, responseHash: null, reviewHash: null, artifact: null })
function root(id: string): string { campaignId(id); return `writer-campaign:${encodeURIComponent(id)}:v3:` }
export const producerKeys = {
  head: campaignKeys.head,
  manifest: (id: string, hash: string) => `${root(id)}manifest:${hash}`,
  checkpoint: (id: string, sequence: number) => `${root(id)}checkpoint:${sequence}`,
  receipt: (id: string, operationId: string) => { campaignId(operationId); return `${root(id)}receipt:${encodeURIComponent(operationId)}` },
  request: (id: string, hash: string) => `${root(id)}request:${hash}`,
  phase: (id: string, hash: string) => `${root(id)}phase:${hash}`,
  response: (id: string, hash: string) => `${root(id)}response:${hash}`,
  review: (id: string, hash: string) => `${root(id)}review:${hash}`,
  artifact: (id: string, hash: string) => `${root(id)}artifact:${hash}`,
}
type Entry = { key: string; expectedValue: string | null; value: string }
type Records = { request: BodyProducerRequest | null; phase: BodyProducerPhase | null; response: BodyProducerResponse | null; review: BodyProducerReview | null; artifact: CampaignArtifact | null }
const noRecords = (): Records => ({ request: null, phase: null, response: null, review: null, artifact: null })
function hash(value: unknown): asserts value is string { campaignAssert(typeof value === 'string' && HASH.test(value), 'Invalid producer digest') }
function label(value: unknown, max = 256): asserts value is string { campaignAssert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'Invalid producer text'); utf8Bytes(value) }
function reason(value: unknown, nullable = false): void { if (nullable && value === null) return; campaignAssert(typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value), 'Invalid bounded producer reason') }
function nullableHash(value: unknown): void { if (value !== null) hash(value) }
/** Legacy parsing remains unchanged; every new record must preserve its exact canonical bytes. */
function parseProducerRecord(raw: string | null): unknown {
  const value = parseCampaignRecord(raw)
  campaignAssert(typeof raw === 'string' && canonicalStringify(value) === raw, 'Producer record is not canonical')
  return value
}
async function sealed<T extends { hash: string }>(value: T, domain: string): Promise<T> {
  const { hash: actual, ...payload } = value
  hash(actual); campaignAssert(actual === await hashCampaignValue(domain, payload), `${domain} hash mismatch`)
  return value
}
async function seal<T extends { hash: string }>(payload: Omit<T, 'hash'>, domain: string): Promise<T> {
  return { ...structuredClone(payload), hash: await hashCampaignValue(domain, payload) } as T
}
function sourceIdentity(value: unknown): void {
  campaignRecord(value, ['commit', 'tree'], 'producer build source')
  campaignAssert((value.commit === null) === (value.tree === null), 'Incomplete producer build source')
  for (const item of Object.values(value)) campaignAssert(item === null || typeof item === 'string' && /^[a-f0-9]{40}$/.test(item), 'Invalid producer build source')
}
function recordRef(value: unknown): asserts value is CampaignArtifactRef {
  campaignRecord(value, ['taskId', 'revision', 'hash'], 'producer artifact reference'); campaignId(value.taskId); campaignInteger(value.revision, 2048); hash(value.hash)
}
async function validateRequest(value: BodyProducerRequest): Promise<BodyProducerRequest> {
  campaignRecord(value, ['schemaVersion', 'protocol', 'campaignId', 'id', 'operationId', 'aggregateManifestHash', 'sourceEpoch', 'prepared', 'producer', 'reservation', 'createdAt', 'expiresAt', 'hash'], 'producer request')
  campaignAssert(value.schemaVersion === 1 && value.protocol === 'body-producer-request-v1', 'Unsupported producer request schema', 'unsupported_schema')
  campaignId(value.campaignId); campaignId(value.id); campaignId(value.operationId); campaignId(`${value.operationId}:resolve`); hash(value.aggregateManifestHash); campaignInteger(value.sourceEpoch, 2048)
  campaignRecord(value.producer, ['adapterId', 'adapterVersion', 'mode', 'requestedModelId', 'effectiveModelId', 'configurationRevision', 'endpointIdentity'], 'producer identity')
  for (const key of ['adapterId', 'adapterVersion', 'requestedModelId', 'effectiveModelId', 'configurationRevision', 'endpointIdentity'] as const) label(value.producer[key])
  campaignAssert(value.producer.mode === 'offline_control', 'Live producer grants are not enabled')
  campaignRecord(value.prepared, ['protocol', 'language', 'source', 'window', 'catalog', 'wire', 'inputDigest', 'inputBytes', 'inputUtf16'], 'prepared producer input')
  campaignAssert(value.prepared.protocol === 'body-producer-input-v1' && ['zh', 'en'].includes(value.prepared.language), 'Invalid prepared producer protocol')
  campaignRecord(value.prepared.wire, ['system', 'prompt'], 'producer wire')
  label(value.prepared.wire.system, 16_384); label(value.prepared.wire.prompt, 16_384)
  const wire = canonicalStringify(value.prepared.wire)
  hash(value.prepared.inputDigest); campaignInteger(value.prepared.inputBytes, 32_768, 1); campaignInteger(value.prepared.inputUtf16, 16_384, 1)
  campaignAssert(value.prepared.inputDigest === await hashText(wire) && value.prepared.inputBytes === utf8Bytes(wire) && value.prepared.inputUtf16 === wire.length, 'Producer exact wire identity mismatch')
  validateCampaignBudget(value.reservation)
  const expected = emptyCampaignBudget()
  Object.assign(expected, { attempts: 1, inputBytes: value.prepared.inputBytes, inputUtf16: value.prepared.inputUtf16, outputTokens: 1200, responseBytes: 65_536, activeMs: 60_000 })
  campaignAssert(equal(expected, value.reservation), 'Producer reservation differs from immutable bounds')
  campaignInteger(value.createdAt); campaignInteger(value.expiresAt)
  campaignAssert(value.expiresAt > value.createdAt && value.expiresAt <= value.createdAt + 300_000, 'Invalid prepared request expiry')
  await sealed(value, DOMAIN.request)
  campaignAssert(utf8Bytes(producerKeys.request(value.campaignId, value.hash)) + utf8Bytes(canonicalStringify(value)) <= PRODUCER_ORIGIN_RECORD_BYTES, 'Producer origin serialization exceeds bound', 'budget')
  return value
}
async function validateResponse(value: BodyProducerResponse): Promise<BodyProducerResponse> {
  campaignRecord(value, ['schemaVersion', 'protocol', 'campaignId', 'requestId', 'requestHash', 'intentHash', 'evidenceId', 'text', 'textHash', 'bytes', 'usage', 'reportedModelId', 'hash'], 'producer response')
  campaignAssert(value.schemaVersion === 1 && value.protocol === 'body-producer-response-v1', 'Unsupported producer response schema', 'unsupported_schema')
  campaignId(value.campaignId); campaignId(value.requestId); campaignId(value.evidenceId); hash(value.requestHash); hash(value.intentHash)
  campaignAssert(typeof value.text === 'string' && value.text.length <= 16_384 && utf8Bytes(value.text) <= 16_384, 'Producer returned text exceeds bound', 'budget')
  campaignAssert(value.bytes === utf8Bytes(value.text) && value.textHash === await hashText(value.text), 'Producer response text identity mismatch')
  campaignRecord(value.usage, ['provenance', 'inputTokens', 'outputTokens', 'reasoningTokens'], 'producer usage')
  campaignAssert(['synthetic_control', 'reported', 'estimated', 'unavailable'].includes(value.usage.provenance), 'Invalid producer usage provenance')
  for (const key of ['inputTokens', 'outputTokens', 'reasoningTokens'] as const) if (value.usage[key] !== null) campaignInteger(value.usage[key])
  if (value.reportedModelId !== null) label(value.reportedModelId)
  await sealed(value, DOMAIN.response)
  campaignAssert(utf8Bytes(producerKeys.response(value.campaignId, value.hash)) + utf8Bytes(canonicalStringify(value)) <= PRODUCER_RESPONSE_RECORD_BYTES, 'Producer response serialization exceeds bound', 'budget')
  return value
}
async function validateReview(value: BodyProducerReview): Promise<BodyProducerReview> {
  campaignRecord(value, ['schemaVersion', 'protocol', 'campaignId', 'requestId', 'requestHash', 'responseHash', 'result', 'hash'], 'producer review')
  campaignAssert(value.schemaVersion === 1 && value.protocol === 'body-producer-review-v1', 'Unsupported producer review schema', 'unsupported_schema')
  campaignId(value.campaignId); campaignId(value.requestId); hash(value.requestHash); hash(value.responseHash)
  await sealed(value, DOMAIN.review)
  campaignAssert(utf8Bytes(producerKeys.review(value.campaignId, value.hash)) + utf8Bytes(canonicalStringify(value)) <= PRODUCER_REVIEW_RECORD_BYTES, 'Producer review serialization exceeds bound', 'budget')
  return value
}
export async function sealProducerRequest(value: Omit<BodyProducerRequest, 'hash'>): Promise<BodyProducerRequest> { return validateRequest(await seal<BodyProducerRequest>(value, DOMAIN.request)) }
export async function sealProducerResponse(value: Omit<BodyProducerResponse, 'hash'>): Promise<BodyProducerResponse> { return validateResponse(await seal<BodyProducerResponse>(value, DOMAIN.response)) }
export async function sealProducerReview(value: Omit<BodyProducerReview, 'hash'>): Promise<BodyProducerReview> { return validateReview(await seal<BodyProducerReview>(value, DOMAIN.review)) }
async function validatePhase(value: BodyProducerPhase): Promise<BodyProducerPhase> {
  campaignRecord(value, ['schemaVersion', 'protocol', 'campaignId', 'requestId', 'requestHash', 'revision', 'parentHash', 'status', 'intentHash', 'responseHash', 'resolution', 'reason', 'hash'], 'producer phase')
  campaignAssert(value.schemaVersion === 1 && value.protocol === 'body-producer-phase-v1', 'Unsupported producer phase schema', 'unsupported_schema')
  campaignId(value.campaignId); campaignId(value.requestId); hash(value.requestHash); campaignInteger(value.revision, 4)
  nullableHash(value.parentHash); nullableHash(value.intentHash); nullableHash(value.responseHash); reason(value.reason, true)
  campaignAssert(['reserved', 'dispatch_intent', 'outcome_unknown', 'response_retained', 'resolved'].includes(value.status), 'Invalid producer phase')
  campaignAssert((value.revision === 0) === (value.parentHash === null), 'Invalid producer phase parent')
  if (value.resolution !== null) {
    campaignRecord(value.resolution, ['outcome', 'reason', 'reviewHash'], 'producer resolution')
    campaignAssert(['review_ready', 'refused', 'not_dispatched'].includes(value.resolution.outcome), 'Invalid producer resolution')
    reason(value.resolution.reason, true); nullableHash(value.resolution.reviewHash)
  }
  campaignAssert((value.status === 'resolved') === (value.resolution !== null), 'Producer terminal phase lacks resolution')
  return sealed(value, DOMAIN.phase)
}
function validateHead(value: ProducerCampaignHead): ProducerCampaignHead {
  campaignRecord(value, ['schemaVersion', 'protocolVersion', 'campaignId', 'manifestHash', 'sequence', 'checkpointHash', 'receiptId', 'executionEpoch', 'status'], 'producer head')
  campaignAssert(value.schemaVersion === 3 && value.protocolVersion === 'campaign-v3-head', 'Unsupported producer aggregate schema', 'unsupported_schema')
  campaignId(value.campaignId); campaignId(value.receiptId); hash(value.manifestHash); hash(value.checkpointHash); campaignInteger(value.sequence, 2047); campaignInteger(value.executionEpoch, 2048)
  campaignAssert(['active', 'cancelled'].includes(value.status), 'Invalid producer aggregate status')
  return value
}
async function validateManifest(value: ProducerCampaignManifest): Promise<ProducerCampaignManifest> {
  campaignRecord(value, ['schemaVersion', 'protocolVersion', 'campaignId', 'adoptedRawHead', 'adoptedManifestHash', 'runtimeIdentity', 'source', 'createdAt', 'expiresAt', 'policy', 'hash'], 'producer manifest')
  campaignAssert(value.schemaVersion === 3 && value.protocolVersion === 'campaign-v3', 'Unsupported producer manifest schema', 'unsupported_schema')
  campaignId(value.campaignId); hash(value.adoptedManifestHash); label(value.runtimeIdentity, 512); sourceIdentity(value.source)
  campaignInteger(value.createdAt); campaignInteger(value.expiresAt); campaignAssert(value.expiresAt > value.createdAt, 'Invalid producer expiry')
  campaignAssert(equal(value.policy, POLICY), 'Invalid producer policy')
  const old = validateCampaignHead(parseCampaignRecord(value.adoptedRawHead))
  campaignAssert(old.campaignId === value.campaignId && old.manifestHash === value.adoptedManifestHash && old.status === 'completed', 'Invalid adopted source identity')
  return sealed(value, DOMAIN.manifest)
}
async function validateCheckpoint(value: ProducerCampaignCheckpoint): Promise<ProducerCampaignCheckpoint> {
  campaignRecord(value, ['schemaVersion', 'protocolVersion', 'campaignId', 'manifestHash', 'sequence', 'previousHash', 'operationId', 'status', 'executionEpoch', 'sourceEpoch', 'candidateId', 'tasks', 'bodyCharacters', 'producerRequests', 'budget', 'storage', 'lastWallTime', 'hash'], 'producer checkpoint')
  campaignAssert(value.schemaVersion === 3 && value.protocolVersion === 'campaign-v3-checkpoint', 'Unsupported producer checkpoint schema', 'unsupported_schema')
  campaignId(value.campaignId); campaignId(value.operationId); hash(value.manifestHash); nullableHash(value.previousHash); campaignInteger(value.sequence, 2047); campaignInteger(value.sourceEpoch, 2048)
  campaignAssert(['active', 'cancelled'].includes(value.status), 'Invalid producer status')
  validateCampaignState({ status: value.status === 'cancelled' ? 'cancelled' : 'paused', reason: null, executionEpoch: value.executionEpoch, candidateId: value.candidateId, tasks: value.tasks, budget: value.budget, storage: value.storage, lastWallTime: value.lastWallTime })
  campaignInteger(value.bodyCharacters, 128 * 65_536)
  campaignAssert(Array.isArray(value.producerRequests) && value.producerRequests.length <= 8, 'Producer request index exceeds bound')
  for (const item of value.producerRequests) { campaignRecord(item, ['id', 'requestHash', 'phaseHash', 'phaseRevision'], 'producer index'); campaignId(item.id); hash(item.requestHash); hash(item.phaseHash); campaignInteger(item.phaseRevision, 4) }
  campaignAssert(new Set(value.producerRequests.map(row => row.id)).size === value.producerRequests.length, 'Duplicate producer index identity')
  return sealed(value, DOMAIN.checkpoint)
}
async function validateReceipt(value: ProducerCampaignReceipt): Promise<ProducerCampaignReceipt> {
  campaignRecord(value, ['schemaVersion', 'protocolVersion', 'campaignId', 'operationId', 'kind', 'businessDigest', 'sequence', 'previousHash', 'checkpointHash', 'manifestHash', 'event', 'serializedBytes', 'storageEffect', 'recovery', 'hash'], 'producer receipt')
  campaignAssert(value.schemaVersion === 3 && value.protocolVersion === 'campaign-v3-receipt', 'Unsupported producer receipt schema', 'unsupported_schema')
  campaignId(value.campaignId); campaignId(value.operationId); campaignAssert(KINDS.includes(value.kind), 'Invalid producer operation')
  campaignAssert(typeof value.recovery === 'boolean' && (!value.recovery || ['outcome_unknown', 'retain_response', 'resolve'].includes(value.kind)), 'Invalid explicit producer recovery marker')
  hash(value.businessDigest); hash(value.checkpointHash); hash(value.manifestHash); nullableHash(value.previousHash); campaignInteger(value.sequence, 2047); decodeStorageBytes(value.serializedBytes)
  campaignRecord(value.event, ['requestHash', 'phaseHash', 'responseHash', 'reviewHash', 'artifact'], 'producer event')
  for (const key of ['requestHash', 'phaseHash', 'responseHash', 'reviewHash'] as const) nullableHash(value.event[key])
  if (value.event.artifact !== null) recordRef(value.event.artifact)
  campaignRecord(value.storageEffect, ['allocatedBytes', 'consumedBytes', 'releasedBytes', 'source', 'requestId'], 'producer storage effect')
  for (const key of ['allocatedBytes', 'consumedBytes', 'releasedBytes'] as const) decodeStorageBytes(value.storageEffect[key])
  campaignAssert(['direct', 'request', 'recovery'].includes(value.storageEffect.source), 'Invalid producer storage source')
  if (value.storageEffect.requestId !== null) campaignId(value.storageEffect.requestId)
  return sealed(value, DOMAIN.receipt)
}
function sourceView(origin: CampaignSnapshot, checkpoint: ProducerCampaignCheckpoint, artifacts: Map<string, CampaignArtifact>) {
  return { sourceManifest: origin.manifest, candidateId: checkpoint.candidateId, tasks: checkpoint.tasks, artifacts }
}
function activeArtifacts(tasks: CampaignTaskState[], artifacts: Map<string, CampaignArtifact>): Map<string, CampaignArtifact> {
  return new Map(tasks.flatMap(task => [task.artifact, task.priorArtifact].flatMap(ref => {
    if (!ref) return []
    const value = artifacts.get(ref.hash); campaignAssert(value && equal(ref, { taskId: value.taskId, revision: value.revision, hash: value.hash }), 'Missing producer source artifact')
    return [[ref.hash, value] as const]
  })))
}
function bodyCount(origin: CampaignSnapshot, tasks: CampaignTaskState[], artifacts: Map<string, CampaignArtifact>): number {
  let sum = 0
  for (const spec of origin.manifest.tasks) {
    const state = tasks.find(task => task.taskId === spec.id); campaignAssert(state, 'Producer source task missing')
    if (!state.artifact) continue
    const artifact = artifacts.get(state.artifact.hash)
    campaignAssert(artifact && artifact.campaignId === origin.manifest.campaignId && artifact.taskId === spec.id && artifact.taskRevision === state.revision && artifact.kind === spec.kind, 'Producer source lineage mismatch')
    const dependencies = spec.dependsOn.map(id => tasks.find(task => task.taskId === id)?.artifact)
    campaignAssert(dependencies.every(Boolean) && equal(dependencies, artifact.dependencies), 'Producer source dependencies are stale')
    if (spec.kind === 'chapter_body') sum += artifact.canonical.scalars
  }
  return sum
}
function budgetAdd(current: CampaignBudget, delta: CampaignBudget, limit: CampaignBudget): CampaignBudget {
  const next = { ...current }
  for (const key of CAMPAIGN_BUDGET_KEYS) { next[key] += delta[key]; campaignInteger(next[key]); campaignAssert(next[key] <= limit[key], 'Shared Campaign budget exhausted', 'budget') }
  return next
}
function requestPhase(snapshot: ProducerCampaignSnapshot, id: string): { request: BodyProducerRequest; phase: BodyProducerPhase } {
  const ref = snapshot.checkpoint.producerRequests.find(row => row.id === id)
  campaignAssert(ref, 'Producer request is not indexed')
  const request = snapshot.requests.get(ref.requestHash), phase = snapshot.phases.get(ref.phaseHash)
  campaignAssert(request && phase && phase.requestHash === request.hash && phase.revision === ref.phaseRevision, 'Producer indexed request/phase mismatch')
  return { request, phase }
}
async function mutationDigest(mutation: ProducerMutation): Promise<string> {
  const { operationId: _operationId, ...business } = mutation
  return hashCampaignValue('campaign-operation-v3', business)
}
function checkClock(snapshot: ProducerCampaignSnapshot, now: number, recovery: boolean): void {
  campaignInteger(now); campaignAssert(now >= snapshot.checkpoint.lastWallTime, 'Producer wall clock regressed')
  if (!recovery) campaignAssert(now < snapshot.manifest.expiresAt && snapshot.checkpoint.status === 'active', 'Producer campaign expired or cancelled')
}

export function createProducerCampaignRepository(options: ProducerRepositoryOptions = {}): ProducerCampaignRepository {
  const io: CampaignRepositoryIO = options.io ?? { getMany: idbGetMany, compareAndSwapMany: idbCompareAndSwapMany }
  const clock = options.clock ?? Date.now
  type Guard = { adoptedRawHead: string; rawHead: string; check: () => void }
  type Action = { campaignId: string; live: boolean; busy: boolean; admission: 'new' | 'admitted' | 'fallback';
    repository: CampaignRepository | null; token: CampaignActionScope | null; seeded: boolean; identity: string | null; guard: Guard | null;
    sessionAttempted: boolean; executor: ProducerVerificationExecutor | null }
  const actions = new WeakMap<ProducerActionScope, Action>()
  let admitted: Action | null = null
  const statistics = new CampaignActionProofPool().observations()
  const verificationStatistics = emptyVerificationStats()
  function mergeStats(target: CampaignActionProofStats, source: CampaignActionProofStats): void {
    for (const key of Object.keys(target) as Array<keyof CampaignActionProofStats>) {
      if (key === 'disposalReasons') {
        for (const reason of Object.keys(target.disposalReasons) as Array<keyof CampaignActionProofStats['disposalReasons']>) target.disposalReasons[reason] = Math.min(Number.MAX_SAFE_INTEGER, target.disposalReasons[reason] + source.disposalReasons[reason])
      } else target[key] = key.startsWith('peak') || key.endsWith('MaxMs') ? Math.max(target[key], source[key]) : Math.min(Number.MAX_SAFE_INTEGER, target[key] + source[key])
    }
  }
  function closeAction(action: Action, cause: unknown = { code: 'cancelled' }): void {
    action.executor?.fail(cause)
    action.live = false; action.guard = null
    if (action.repository && action.token) {
      action.repository.disposeActionScope!(action.token)
      mergeStats(statistics, action.repository.getActionProofStats!())
    }
    action.repository = null; action.token = null; action.identity = null
    if (admitted === action) admitted = null
    refreshVerificationRetention()
  }
  function createActionScope(campaignIdValue: string): ProducerActionScope {
    campaignId(campaignIdValue)
    const token = Object.freeze({}) as ProducerActionScope
    actions.set(token, { campaignId: campaignIdValue, live: true, busy: false, admission: 'new', repository: null, token: null, seeded: false, identity: null, guard: null, sessionAttempted: false, executor: null })
    return token
  }
  function disposeActionScope(token: ProducerActionScope): void { const action = actions.get(token); if (action) closeAction(action) }
  function getActionProofStats(): CampaignActionProofStats {
    const result = structuredClone(statistics)
    if (admitted?.repository) mergeStats(result, admitted.repository.getActionProofStats!())
    return result
  }
  function refreshVerificationRetention(): void {
    const proof = admitted?.repository?.getActionProofStats?.()
    verificationStatistics.retainedBytes = proof?.retainedBytes ?? 0
    verificationStatistics.retainedEntries = proof?.retainedEntries ?? 0
    verificationStatistics.activePayloadRecords = proof?.activeRecords ?? 0
    verificationStatistics.peakRetainedBytes = Math.max(verificationStatistics.peakRetainedBytes, proof?.peakRetainedBytes ?? 0)
    verificationStatistics.peakRetainedEntries = Math.max(verificationStatistics.peakRetainedEntries, proof?.peakRetainedEntries ?? 0)
    verificationStatistics.peakActivePayloadRecords = Math.max(verificationStatistics.peakActivePayloadRecords, proof?.peakActiveRecords ?? 0)
  }
  function getVerificationStats(): ProducerVerificationStats { refreshVerificationRetention(); return structuredClone(verificationStatistics) }
  async function withinAction<T>(id: string, token: ProducerActionScope | undefined, check: () => void, run: (check: () => void, action: Action | null) => Promise<T>): Promise<T> {
    const action = token ? actions.get(token) : null
    if (token) {
      campaignAssert(action && action.live && action.campaignId === id, 'Unknown or closed producer action scope', 'conflict')
      if (action.busy) { const error = new CampaignProtocolError('conflict', 'Concurrent producer action scope'); closeAction(action, error); throw error }
      action.busy = true
    }
    const live = () => { campaignAssert(!action || action.live && action.busy, 'Producer action scope closed', 'conflict'); check(); campaignAssert(!action || action.live, 'Producer action scope closed', 'conflict') }
    try { live(); const result = await run(live, action ?? null); live(); return result }
    catch (cause) { if (action) closeAction(action, cause); throw cause }
    finally { if (action) action.busy = false }
  }
  async function readMany(keys: readonly string[], executor?: ProducerVerificationExecutor): Promise<Map<string, string | null>> {
    return executor ? executor.io('read', () => io.getMany(keys)) : io.getMany(keys)
  }
  async function rawRecord(key: string, executor?: ProducerVerificationExecutor): Promise<string | null> { return (await readMany([key], executor)).get(key) ?? null }
  function makeOriginView(id: string, context: () => Guard, action: Action | null): CampaignRepositoryIO {
    const headKey = producerKeys.head(id)
    return {
      async getMany(keys) {
        const guard = context(); guard.check()
        const actual = await readMany([...new Set([headKey, ...keys])], action?.executor ?? undefined); guard.check()
        campaignAssert(context() === guard && actual.get(headKey) === guard.rawHead, 'Producer head changed during legacy verification', 'conflict')
        if (keys.includes(headKey)) actual.set(headKey, guard.adoptedRawHead)
        return new Map(keys.map(key => [key, actual.get(key) ?? null]))
      },
      async compareAndSwapMany() { throw new CampaignProtocolError('legacy_read_only', 'Legacy verification view is read-only') },
    }
  }
  function admitOrigin(action: Action, id: string): void {
    if (action.admission !== 'new') return
    if (admitted) {
      action.admission = 'fallback'; statistics.fallbackScopes++; statistics.disposedScopes++; statistics.disposalReasons.admission++
      if (action.executor) throw new ProducerVerificationError('verification_capacity')
    } else {
      admitted = action; action.admission = 'admitted'
      action.repository = createCampaignRepository(makeOriginView(id, () => { campaignAssert(action.live && action.busy && action.guard, 'Producer origin scope closed', 'conflict'); return action.guard }, action))
      action.token = action.repository.createActionScope!(id)
    }
  }
  async function readOrigin(manifest: ProducerCampaignManifest, expectedRawHead: string, check: () => void, action: Action | null, executor?: ProducerVerificationExecutor): Promise<CampaignSnapshot> {
    const guard = { adoptedRawHead: manifest.adoptedRawHead, rawHead: expectedRawHead, check }
    if (action) {
      const identity = canonicalStringify({ manifestHash: manifest.hash, adoptedRawHead: manifest.adoptedRawHead })
      campaignAssert(action.identity === null || action.identity === identity, 'Producer origin scope cannot rebase', 'conflict')
      action.identity = identity
    }
    if (action) admitOrigin(action, manifest.campaignId)
    let origin: CampaignSnapshot | null
    if (action?.admission === 'admitted') {
      action.guard = guard
      try {
        if (executor) {
          campaignAssert(!action.seeded, 'Cold verification cannot reseed an existing proof', 'conflict')
          executor.setStage('origin_replay')
          origin = await campaignVerificationBridge(action.repository!).read(manifest.campaignId, action.token!, executor)
        } else origin = action.seeded
          ? await action.repository!.verifyWithinAction!(manifest.campaignId, manifest.adoptedRawHead, action.token!, check)
          : await action.repository!.read(manifest.campaignId, action.token!, check)
        action.seeded = true
      } finally { action.guard = null }
    } else {
      if (executor) throw new ProducerVerificationError('verification_capacity')
      const repository = createCampaignRepository(makeOriginView(manifest.campaignId, () => guard, null))
      try { origin = await repository.read(manifest.campaignId, undefined, check) }
      finally { mergeStats(statistics, repository.getActionProofStats!()) }
    }
    campaignAssert(origin && origin.rawHead === manifest.adoptedRawHead && origin.manifest.hash === manifest.adoptedManifestHash, 'Adoption baseline mismatch')
    campaignAssert(origin.head.status === 'completed' && origin.checkpoint.tasks.every(task => task.status === 'committed') && origin.checkpoint.storage.openAllocations.length === 0 && decodeStorageBytes(origin.checkpoint.storage.outstandingBytes) === 0, 'Only completed obligation-free v2 sources can be adopted')
    campaignAssert(validatePlanningProfile(origin.manifest), 'Producer adoption requires a registered planning profile')
    return origin
  }
  function baseline(manifest: ProducerCampaignManifest, origin: CampaignSnapshot): ProducerCampaignSnapshot {
    const checkpoint: ProducerCampaignCheckpoint = {
      schemaVersion: 3, protocolVersion: 'campaign-v3-checkpoint', campaignId: manifest.campaignId, manifestHash: manifest.hash,
      sequence: origin.head.sequence, previousHash: null, operationId: origin.receipt.operationId, status: 'active', executionEpoch: origin.head.executionEpoch,
      sourceEpoch: 0, candidateId: origin.checkpoint.candidateId, tasks: structuredClone(origin.checkpoint.tasks), bodyCharacters: origin.checkpoint.bodyCharacters,
      producerRequests: [], budget: { ...origin.checkpoint.budget }, storage: structuredClone(origin.checkpoint.storage), lastWallTime: origin.checkpoint.lastWallTime, hash: origin.checkpoint.hash,
    }
    const artifacts = new Map(origin.artifacts)
    return { manifest, origin, checkpoint, artifacts, source: sourceView(origin, checkpoint, artifacts), requests: new Map(), phases: new Map(), responses: new Map(), reviews: new Map(),
      head: { schemaVersion: 3, protocolVersion: 'campaign-v3-head', campaignId: manifest.campaignId, manifestHash: manifest.hash, sequence: checkpoint.sequence, checkpointHash: checkpoint.hash, receiptId: checkpoint.operationId, executionEpoch: checkpoint.executionEpoch, status: 'active' },
      receipt: null as unknown as ProducerCampaignReceipt, rawHead: manifest.adoptedRawHead }
  }
  async function transition(previous: ProducerCampaignSnapshot, mutation: ProducerMutation, now: number, check: () => void): Promise<{ checkpoint: ProducerCampaignCheckpoint; records: Records; event: ProducerEvent }> {
    check(); campaignId(mutation.operationId)
    const recoveryControl = mutation.recovery === true
    if (Object.hasOwn(mutation, 'recovery')) {
      campaignAssert(recoveryControl && ['outcome_unknown', 'retain_response', 'resolve'].includes(mutation.kind), 'Invalid standalone recovery action')
      const { recovery: _recovery, ...business } = mutation; mutation = business as ProducerMutation
    }
    const recovery = ['outcome_unknown', 'retain_response', 'resolve', 'cancel'].includes(mutation.kind)
    checkClock(previous, now, recovery)
    const checkpoint = structuredClone(previous.checkpoint), records = noRecords(), event = emptyEvent()
    checkpoint.sequence++; checkpoint.previousHash = previous.checkpoint.hash; checkpoint.operationId = mutation.operationId; checkpoint.lastWallTime = now
    const delta = emptyCampaignBudget(); delta.operations = 1
    if (mutation.kind === 'body_revision') {
      campaignRecord(mutation, ['operationId', 'kind', 'chapterOrdinal', 'text'], 'body revision mutation')
      campaignInteger(mutation.chapterOrdinal, 60, 1); campaignAssert(typeof mutation.text === 'string' && utf8Bytes(mutation.text) <= 65_536, 'Manual body exceeds source bound', 'budget')
      const spec = previous.origin.manifest.tasks.find(task => task.kind === 'chapter_body' && task.chapterOrdinal === mutation.chapterOrdinal)
      const task = checkpoint.tasks.find(row => row.taskId === spec?.id)
      campaignAssert(spec && task && ['committed', 'invalidated'].includes(task.status), 'Manual revision requires an existing body task')
      const priorRef = task.artifact ?? task.priorArtifact
      campaignAssert(priorRef, 'Manual revision has no prior accepted body')
      const dependencies = spec.dependsOn.map(id => checkpoint.tasks.find(row => row.taskId === id)?.artifact)
      campaignAssert(dependencies.every(Boolean), 'Manual revision dependencies are not accepted')
      checkpoint.candidateId = `manual-${(await hashText(mutation.operationId)).slice(0, 32)}`
      campaignAssert(checkpoint.candidateId !== previous.checkpoint.candidateId, 'Manual candidate identity already active')
      const artifact = await sealCampaignArtifact({ schemaVersion: 2, campaignId: previous.manifest.campaignId, candidateId: checkpoint.candidateId,
        taskId: spec.id, taskRevision: task.revision + 1, revision: priorRef.revision + 1, kind: 'chapter_body', dependencies: dependencies as CampaignArtifactRef[], parentHash: priorRef.hash, text: mutation.text, semanticStatus: 'not_reviewed' })
      const affected = new Set([spec.id])
      for (const row of previous.origin.manifest.tasks) if (row.dependsOn.some(id => affected.has(id))) affected.add(row.id)
      for (const row of checkpoint.tasks) if (affected.has(row.taskId)) {
        row.revision++; row.priorArtifact = row.artifact ?? row.priorArtifact; row.request = null
        row.artifact = row.taskId === spec.id ? { taskId: artifact.taskId, revision: artifact.revision, hash: artifact.hash } : null
        row.status = row.taskId === spec.id ? 'committed' : 'invalidated'
      }
      checkpoint.sourceEpoch++; checkpoint.executionEpoch++; records.artifact = artifact; event.artifact = { taskId: artifact.taskId, revision: artifact.revision, hash: artifact.hash }
      delta.artifacts = 1; delta.activeMs = 10_000
    } else if (mutation.kind === 'cancel') {
      campaignRecord(mutation, ['operationId', 'kind'], 'producer cancel mutation')
      campaignAssert(previous.checkpoint.status !== 'cancelled', 'Producer campaign already cancelled')
      checkpoint.status = 'cancelled'; checkpoint.executionEpoch++; delta.activeMs = 10_000
    } else {
      let request: BodyProducerRequest, old: BodyProducerPhase | null = null
      if (mutation.kind === 'reserve') {
        campaignRecord(mutation, ['operationId', 'kind', 'request'], 'producer reserve mutation')
        request = await validateRequest(structuredClone(mutation.request))
        campaignAssert(request.campaignId === previous.manifest.campaignId && request.aggregateManifestHash === previous.manifest.hash && request.sourceEpoch === checkpoint.sourceEpoch && `${request.operationId}:reserve` === mutation.operationId, 'Producer origin/source identity mismatch')
        campaignAssert(request.createdAt <= now && now < request.expiresAt && request.expiresAt <= previous.manifest.expiresAt, 'Prepared producer request expired')
        campaignAssert(checkpoint.producerRequests.length < 8 && !checkpoint.producerRequests.some(row => row.id === request.id), 'Producer request identity/capacity conflict', 'budget')
        campaignAssert(!checkpoint.producerRequests.some(row => ['reserved', 'dispatch_intent'].includes(previous.phases.get(row.phaseHash)!.status)), 'Another producer request is actively dispatchable', 'conflict')
        await validatePreparedBodyProducerInput(previous.source, request.prepared, check)
        Object.assign(delta, request.reservation); delta.operations = 1
        records.request = request; event.requestHash = request.hash
      } else {
        campaignId(mutation.requestId)
        const current = requestPhase(previous, mutation.requestId); request = current.request; old = current.phase
        campaignAssert(old.status !== 'resolved', 'Producer request is already resolved')
        const suffix = { dispatch_intent: 'intent', outcome_unknown: 'unknown', retain_response: 'retain', resolve: 'resolve' }[mutation.kind]
        campaignAssert(mutation.operationId === `${request.operationId}:${suffix}`, 'Producer phase operation identity mismatch')
        if (['outcome_unknown', 'retain_response', 'resolve'].includes(mutation.kind)
          && (previous.checkpoint.status === 'cancelled' || now >= request.createdAt + 60_000)) {
          campaignAssert(recoveryControl, 'Standalone recovery marker required after cancellation or expired invocation', 'budget')
        }
      }
      let status: BodyProducerPhase['status'] = 'reserved', resolution: BodyProducerPhase['resolution'] = null, failure: string | null = null
      const intentHash = old?.status === 'dispatch_intent' ? old.hash : old?.intentHash ?? null
      let responseHash = old?.responseHash ?? null
      if (mutation.kind === 'dispatch_intent') {
        campaignRecord(mutation, ['operationId', 'kind', 'requestId'], 'producer intent mutation')
        campaignAssert(old?.status === 'reserved' && request.sourceEpoch === checkpoint.sourceEpoch && now < request.expiresAt && now < request.createdAt + 60_000, 'Producer intent has stale source or phase')
        await validatePreparedBodyProducerInput(previous.source, request.prepared, check)
        status = 'dispatch_intent'
      } else if (mutation.kind === 'outcome_unknown') {
        campaignRecord(mutation, ['operationId', 'kind', 'requestId', 'reason'], 'producer unknown mutation')
        campaignAssert(old?.status === 'dispatch_intent', 'Unknown requires one prior intent'); reason(mutation.reason); failure = mutation.reason; status = 'outcome_unknown'
      } else if (mutation.kind === 'retain_response') {
        campaignRecord(mutation, ['operationId', 'kind', 'requestId', 'response'], 'producer retain mutation')
        campaignAssert(old && ['dispatch_intent', 'outcome_unknown'].includes(old.status), 'Retention requires unresolved intent')
        const response = await validateResponse(structuredClone(mutation.response))
        campaignAssert(response.campaignId === request.campaignId && response.requestId === request.id && response.requestHash === request.hash && response.intentHash === intentHash, 'Producer completion identity mismatch')
        records.response = response; event.responseHash = response.hash; responseHash = response.hash; status = 'response_retained'
      } else if (mutation.kind === 'resolve') {
        campaignRecord(mutation, Object.hasOwn(mutation, 'review') ? ['operationId', 'kind', 'requestId', 'outcome', 'reason', 'review'] : ['operationId', 'kind', 'requestId', 'outcome', 'reason'], 'producer resolution mutation')
        reason(mutation.reason, true)
        campaignAssert(old && (old.status === 'response_retained' || old.status === 'reserved' && mutation.outcome === 'not_dispatched'), 'Producer resolution lacks proven completed/not-dispatched outcome')
        campaignAssert(['review_ready', 'refused', 'not_dispatched'].includes(mutation.outcome), 'Invalid producer outcome')
        campaignAssert((mutation.outcome === 'not_dispatched') === (old.status === 'reserved'), 'Invalid not-dispatched resolution')
        if (mutation.outcome === 'review_ready') {
          campaignAssert(previous.checkpoint.status === 'active' && now < previous.manifest.expiresAt && request.sourceEpoch === checkpoint.sourceEpoch && mutation.review, 'Producer review publication is stale')
          const response = previous.responses.get(responseHash!), review = await validateReview(structuredClone(mutation.review))
          campaignAssert(response && review.campaignId === request.campaignId && review.requestId === request.id && review.requestHash === request.hash && review.responseHash === response.hash, 'Producer review identity mismatch')
          const result = await compileProducedBodyEvidence(previous.source, request.prepared, response.text, {
            requestId: request.id, requestHash: request.hash, responseHash: response.hash, intentHash: response.intentHash,
            aggregateManifestHash: request.aggregateManifestHash, sourceEpoch: request.sourceEpoch, producer: request.producer, reportedModelId: response.reportedModelId,
          }, check)
          campaignAssert(equal(result, review.result), 'Producer review differs from current compiler output')
          records.review = review; event.reviewHash = review.hash
        } else campaignAssert(!Object.hasOwn(mutation, 'review'), 'Refused resolution cannot smuggle a review')
        resolution = { outcome: mutation.outcome, reason: mutation.reason, reviewHash: records.review?.hash ?? null }; status = 'resolved'
      }
      const phase = await seal<BodyProducerPhase>({ schemaVersion: 1, protocol: 'body-producer-phase-v1', campaignId: request.campaignId, requestId: request.id, requestHash: request.hash,
        revision: old ? old.revision + 1 : 0, parentHash: old?.hash ?? null, status, intentHash, responseHash, resolution, reason: failure }, DOMAIN.phase)
      await validatePhase(phase); records.phase = phase; event.phaseHash = phase.hash
      const row = { id: request.id, requestHash: request.hash, phaseHash: phase.hash, phaseRevision: phase.revision }
      const index = checkpoint.producerRequests.findIndex(item => item.id === request.id)
      if (index < 0) checkpoint.producerRequests.push(row)
      else checkpoint.producerRequests[index] = row
    }
    if (recoveryControl) delta.activeMs += 10_000
    checkpoint.budget = budgetAdd(checkpoint.budget, delta, previous.origin.manifest.budget)
    const future = checkpoint.producerRequests.reduce((total, row) => total + producerFuturePhases((records.phase?.hash === row.phaseHash ? records.phase : previous.phases.get(row.phaseHash))!.status), 0)
    const operationReserve = mutation.kind === 'cancel' ? future : Math.max(recovery ? 1 : 16, future + 1)
    campaignAssert(checkpoint.budget.operations + operationReserve <= previous.origin.manifest.budget.operations, 'Producer recovery operation slots are protected', 'budget')
    const timeReserve = mutation.kind === 'cancel' ? future * 10_000 : Math.max(recovery ? 10_000 : 160_000, (future + 1) * 10_000)
    campaignAssert(checkpoint.budget.activeMs + timeReserve <= previous.origin.manifest.budget.activeMs, 'Producer future recovery and final cancel time are protected', 'budget')
    const artifacts = new Map(previous.artifacts); if (records.artifact) artifacts.set(records.artifact.hash, records.artifact)
    checkpoint.bodyCharacters = bodyCount(previous.origin, checkpoint.tasks, artifacts)
    check(); return { checkpoint, records, event }
  }
  function fixedRecords(id: string, records: Records): Entry[] {
    const entries: Entry[] = []
    for (const kind of ['request', 'phase', 'response', 'review', 'artifact'] as const) {
      const record = records[kind]
      if (record) entries.push({ key: producerKeys[kind](id, record.hash), expectedValue: null, value: canonicalStringify(record) })
    }
    return entries
  }
  async function buildWrite(previous: ProducerCampaignSnapshot, checkpoint: ProducerCampaignCheckpoint, kind: ProducerOperationKind,
    operationId: string, businessDigest: string, records: Records, event: ProducerEvent, adoption = false, recovery = false,
  ): Promise<{ entries: Entry[]; checkpoint: ProducerCampaignCheckpoint; receipt: ProducerCampaignReceipt; head: ProducerCampaignHead }> {
    const id = previous.manifest.campaignId
    const fixed = fixedRecords(id, records)
    if (adoption) fixed.push({ key: producerKeys.manifest(id, previous.manifest.hash), expectedValue: null, value: canonicalStringify(previous.manifest) })
    const zero = applyProducerStorage(previous.origin.manifest, previous.checkpoint.storage, kind, records.phase, 0)
    checkpoint.storage = zero.storage; checkpoint.hash = ZERO_HASH
    const receipt: ProducerCampaignReceipt = {
      schemaVersion: 3, protocolVersion: 'campaign-v3-receipt', campaignId: id, operationId, kind, businessDigest,
      sequence: checkpoint.sequence, previousHash: previous.receipt?.hash ?? previous.origin.receipt.hash,
      checkpointHash: ZERO_HASH, manifestHash: previous.manifest.hash, event, recovery, serializedBytes: encodeStorageBytes(0), storageEffect: zero.effect, hash: ZERO_HASH,
    }
    const head: ProducerCampaignHead = { schemaVersion: 3, protocolVersion: 'campaign-v3-head', campaignId: id, manifestHash: previous.manifest.hash,
      sequence: checkpoint.sequence, checkpointHash: ZERO_HASH, receiptId: operationId, executionEpoch: checkpoint.executionEpoch, status: checkpoint.status }
    const entriesFor = (): Entry[] => [...fixed,
      { key: producerKeys.checkpoint(id, checkpoint.sequence), expectedValue: null, value: canonicalStringify(checkpoint) },
      { key: producerKeys.receipt(id, operationId), expectedValue: null, value: canonicalStringify(receipt) },
      { key: producerKeys.head(id), expectedValue: previous.rawHead, value: canonicalStringify(head) }]
    const bytes = (entries: Entry[]) => entries.reduce((total, row) => total + utf8Bytes(row.key) + utf8Bytes(row.value), 0)
    const measured = bytes(entriesFor())
    const charged = applyProducerStorage(previous.origin.manifest, previous.checkpoint.storage, kind, records.phase, measured)
    checkpoint.storage = charged.storage
    const { hash: _checkpointHash, ...checkpointPayload } = checkpoint
    checkpoint.hash = await hashCampaignValue(DOMAIN.checkpoint, checkpointPayload)
    receipt.checkpointHash = checkpoint.hash; receipt.serializedBytes = encodeStorageBytes(measured); receipt.storageEffect = charged.effect
    const { hash: _receiptHash, ...receiptPayload } = receipt
    receipt.hash = await hashCampaignValue(DOMAIN.receipt, receiptPayload)
    head.checkpointHash = checkpoint.hash
    const entries = entriesFor()
    campaignAssert(bytes(entries) === measured, 'Producer frozen serialization charge changed')
    for (const row of entries) campaignAssert(utf8Bytes(row.value) <= CAMPAIGN_LIMITS.recordBytes, 'Producer record exceeds common bound', 'budget')
    await validateCheckpoint(checkpoint); await validateReceipt(receipt); validateHead(head)
    return { entries, checkpoint, receipt, head }
  }
  function advance(previous: ProducerCampaignSnapshot, write: { checkpoint: ProducerCampaignCheckpoint; receipt: ProducerCampaignReceipt; head: ProducerCampaignHead }, records: Records): ProducerCampaignSnapshot {
    const requests = new Map(previous.requests), phases = new Map(previous.phases), responses = new Map(previous.responses), reviews = new Map(previous.reviews), artifactPool = new Map(previous.artifacts)
    if (records.request) requests.set(records.request.hash, records.request)
    if (records.phase) phases.set(records.phase.hash, records.phase)
    if (records.response) responses.set(records.response.hash, records.response)
    if (records.review) reviews.set(records.review.hash, records.review)
    if (records.artifact) artifactPool.set(records.artifact.hash, records.artifact)
    const artifacts = activeArtifacts(write.checkpoint.tasks, artifactPool)
    const retainedHashes = new Set([...previous.origin.artifacts.keys(), ...previous.origin.requests.keys(), ...artifacts.keys(), ...requests.keys(), ...phases.keys(), ...responses.keys(), ...reviews.keys()])
    campaignAssert(retainedHashes.size <= 512, 'Producer aggregate active record retention exceeded', 'budget')
    return { manifest: previous.manifest, origin: previous.origin, ...write, artifacts, requests, phases, responses, reviews,
      source: sourceView(previous.origin, write.checkpoint, artifacts), rawHead: canonicalStringify(write.head) }
  }
  async function adoptionTransition(previous: ProducerCampaignSnapshot, operationId: string, now: number): Promise<ProducerCampaignCheckpoint> {
    campaignAssert(now >= previous.checkpoint.lastWallTime && now < previous.manifest.expiresAt, 'Adoption clock is expired or regressed')
    const checkpoint = structuredClone(previous.checkpoint), delta = emptyCampaignBudget()
    delta.operations = 1; delta.activeMs = 10_000
    checkpoint.sequence++; checkpoint.previousHash = previous.origin.checkpoint.hash; checkpoint.operationId = operationId; checkpoint.executionEpoch++; checkpoint.lastWallTime = now
    checkpoint.budget = budgetAdd(checkpoint.budget, delta, previous.origin.manifest.budget)
    campaignAssert(checkpoint.budget.operations <= previous.origin.manifest.budget.operations - 16 && checkpoint.budget.activeMs <= previous.origin.manifest.budget.activeMs - 160_000, 'Adoption must preserve recovery capacity', 'budget')
    return checkpoint
  }
  async function adoptionDigest(manifest: ProducerCampaignManifest): Promise<string> {
    return hashCampaignValue('campaign-operation-v3', { kind: 'adopt', adoptedRawHead: manifest.adoptedRawHead, runtimeIdentity: manifest.runtimeIdentity, source: manifest.source })
  }
  async function read(campaignIdValue: string, check: () => void = () => {}, scope?: ProducerActionScope): Promise<ProducerCampaignSnapshot | null> {
    return withinAction(campaignIdValue, scope, check, (live, action) => readAction(campaignIdValue, live, action))
  }
  async function readAction(campaignIdValue: string, check: () => void, action: Action | null, executor?: ProducerVerificationExecutor, discoveredRawHead?: string): Promise<ProducerCampaignSnapshot | null> {
    campaignId(campaignIdValue); check()
    campaignAssert(!action?.sessionAttempted || action.seeded || executor, 'Consumed verification scope cannot reseed', 'conflict')
    const headKey = producerKeys.head(campaignIdValue), initialRaw = await rawRecord(headKey, executor); check()
    campaignAssert(discoveredRawHead === undefined || initialRaw === discoveredRawHead, 'Producer discovery source changed', 'conflict')
    if (initialRaw === null) {
      campaignAssert(!action?.identity, 'Producer action scope lost its adopted aggregate', 'conflict')
      executor?.setLegacyInspection()
      return null
    }
    const parsed = parseCampaignRecord(initialRaw)
    const version = (parsed as { schemaVersion?: unknown }).schemaVersion
    campaignAssert(!action?.identity || version === 3, 'Producer action scope cannot downgrade its adopted aggregate', 'conflict')
    if (version === 1 || version === 2) {
      executor?.setLegacyInspection()
      const legacyIO = executor ? { getMany: (keys: readonly string[]) => readMany(keys, executor), compareAndSwapMany: io.compareAndSwapMany.bind(io) } : io
      const inspected = await createCampaignRepository(legacyIO).inspect(campaignIdValue)
      campaignAssert(inspected && inspected.rawHead === initialRaw && await rawRecord(headKey, executor) === initialRaw, 'Legacy source changed during producer inspection', 'conflict')
      check(); return null
    }
    campaignAssert(version === 3, 'Unsupported producer aggregate version; stored bytes preserved', 'unsupported_schema')
    const head = validateHead(parseProducerRecord(initialRaw) as ProducerCampaignHead)
    campaignAssert(head.campaignId === campaignIdValue, 'Producer head key mismatch')
    executor?.setTotal(head.sequence + 1)
    executor?.bindResumeFence(async () => {
      campaignAssert(await rawRecord(headKey, executor) === initialRaw, 'Producer head changed across verification suspension', 'conflict')
    })
    let captureTail = false
    async function guarded(keys: readonly string[]): Promise<Map<string, string | null>> {
      campaignAssert(keys.length <= 32, 'Producer read batch exceeds bound'); check()
      const values = await readMany([...new Set([headKey, ...keys])], executor); check()
      campaignAssert(values.get(headKey) === initialRaw, 'Producer head changed during read', 'conflict')
      if (executor && captureTail) for (const key of keys) {
        const raw = values.get(key)
        if (raw != null) executor.captureRaw('tail', key, raw, utf8Bytes(raw))
      }
      return values
    }
    const manifestKey = producerKeys.manifest(campaignIdValue, head.manifestHash)
    const rawManifest = (await guarded([manifestKey])).get(manifestKey)
    campaignAssert(rawManifest, 'Producer manifest missing')
    const manifest = await validateManifest(parseProducerRecord(rawManifest) as ProducerCampaignManifest)
    campaignAssert(manifest.hash === head.manifestHash && manifest.campaignId === campaignIdValue, 'Producer manifest key mismatch')
    const origin = await readOrigin(manifest, initialRaw, check, action, executor)
    if (executor) {
      executor.captureRaw('tail', manifestKey, rawManifest, utf8Bytes(rawManifest)); executor.validated(manifestKey)
      captureTail = true; executor.setStage('tail_replay')
    }
    campaignAssert(manifest.expiresAt === origin.manifest.expiresAt && manifest.createdAt >= origin.checkpoint.lastWallTime, 'Adoption changed original deadline or chronology')
    let current = baseline(manifest, origin)
    campaignAssert(head.sequence > origin.head.sequence, 'Producer head predates adoption')
    const seen = new Set<string>()
    for (let sequence = origin.head.sequence + 1; sequence <= head.sequence; sequence++) {
      const checkpointKey = producerKeys.checkpoint(campaignIdValue, sequence)
      const rawCheckpoint = (await guarded([checkpointKey])).get(checkpointKey)
      campaignAssert(rawCheckpoint, 'Producer history checkpoint missing')
      const checkpoint = await validateCheckpoint(parseProducerRecord(rawCheckpoint) as ProducerCampaignCheckpoint)
      executor?.validated(checkpointKey)
      campaignAssert(checkpoint.sequence === sequence && checkpoint.campaignId === campaignIdValue && checkpoint.manifestHash === manifest.hash && checkpoint.previousHash === current.checkpoint.hash, 'Producer checkpoint chain mismatch')
      campaignAssert(!seen.has(checkpoint.operationId), 'Producer operation reused'); seen.add(checkpoint.operationId)
      const receiptKey = producerKeys.receipt(campaignIdValue, checkpoint.operationId)
      const rawReceipt = (await guarded([receiptKey])).get(receiptKey)
      campaignAssert(rawReceipt, 'Producer receipt missing')
      const receipt = await validateReceipt(parseProducerRecord(rawReceipt) as ProducerCampaignReceipt)
      executor?.validated(receiptKey)
      campaignAssert(receipt.sequence === sequence && receipt.campaignId === campaignIdValue && receipt.manifestHash === manifest.hash && receipt.operationId === checkpoint.operationId && receipt.checkpointHash === checkpoint.hash && receipt.previousHash === (current.receipt?.hash ?? origin.receipt.hash), 'Producer receipt chain mismatch')
      const keys = (['request', 'phase', 'response', 'review'] as const).flatMap(kind => receipt.event[`${kind}Hash`] ? [producerKeys[kind](campaignIdValue, receipt.event[`${kind}Hash`]!)] : [])
      if (receipt.event.artifact) keys.push(producerKeys.artifact(campaignIdValue, receipt.event.artifact.hash))
      const rawEvents = await guarded(keys), records = noRecords()
      for (const kind of ['request', 'phase', 'response', 'review'] as const) {
        const expectedHash = receipt.event[`${kind}Hash`]
        if (!expectedHash) continue
        const raw = rawEvents.get(producerKeys[kind](campaignIdValue, expectedHash)); campaignAssert(raw, 'Producer event record missing')
        const value = parseProducerRecord(raw)
        if (kind === 'request') records.request = await validateRequest(value as BodyProducerRequest)
        else if (kind === 'phase') records.phase = await validatePhase(value as BodyProducerPhase)
        else if (kind === 'response') records.response = await validateResponse(value as BodyProducerResponse)
        else records.review = await validateReview(value as BodyProducerReview)
        campaignAssert(records[kind]!.hash === expectedHash && records[kind]!.campaignId === campaignIdValue, 'Producer event identity mismatch')
        executor?.validated(producerKeys[kind](campaignIdValue, expectedHash))
      }
      if (receipt.event.artifact) {
        const raw = rawEvents.get(producerKeys.artifact(campaignIdValue, receipt.event.artifact.hash)); campaignAssert(raw, 'Producer source event missing')
        records.artifact = await validateCampaignArtifact(parseProducerRecord(raw))
        campaignAssert(equal(receipt.event.artifact, { taskId: records.artifact.taskId, revision: records.artifact.revision, hash: records.artifact.hash }), 'Producer source event identity mismatch')
        executor?.validated(producerKeys.artifact(campaignIdValue, receipt.event.artifact.hash))
      }
      let rebuilt: Awaited<ReturnType<typeof buildWrite>>
      if (sequence === origin.head.sequence + 1) {
        campaignAssert(receipt.kind === 'adopt' && equal(receipt.event, emptyEvent()) && checkpoint.lastWallTime === manifest.createdAt, 'Invalid producer adoption origin')
        rebuilt = await buildWrite(current, await adoptionTransition(current, checkpoint.operationId, checkpoint.lastWallTime), 'adopt', checkpoint.operationId, await adoptionDigest(manifest), noRecords(), emptyEvent(), true)
      } else {
        campaignAssert(receipt.kind !== 'adopt', 'Producer adoption repeated')
        let mutation: ProducerMutation
        const common = { operationId: checkpoint.operationId, ...(receipt.recovery ? { recovery: true as const } : {}) }
        if (receipt.kind === 'body_revision') {
          campaignAssert(records.artifact, 'Producer body revision lacks artifact')
          const spec = origin.manifest.tasks.find(task => task.id === records.artifact!.taskId)
          campaignAssert(spec?.kind === 'chapter_body' && spec.chapterOrdinal, 'Producer revision has invalid source kind')
          mutation = { ...common, kind: 'body_revision', chapterOrdinal: spec.chapterOrdinal, text: records.artifact.text }
        } else if (receipt.kind === 'cancel') mutation = { ...common, kind: 'cancel' }
        else {
          campaignAssert(records.phase, 'Producer operation lacks phase')
          const requestId = records.phase.requestId
          if (receipt.kind === 'reserve') { campaignAssert(records.request, 'Producer reserve lacks origin'); mutation = { ...common, kind: 'reserve', request: records.request } }
          else if (receipt.kind === 'dispatch_intent') mutation = { ...common, kind: 'dispatch_intent', requestId }
          else if (receipt.kind === 'outcome_unknown') { campaignAssert(records.phase.reason, 'Producer unknown lacks reason'); mutation = { ...common, kind: 'outcome_unknown', requestId, reason: records.phase.reason } }
          else if (receipt.kind === 'retain_response') { campaignAssert(records.response, 'Producer retention lacks response'); mutation = { ...common, kind: 'retain_response', requestId, response: records.response } }
          else {
            campaignAssert(records.phase.resolution, 'Producer resolution lacks disposition')
            mutation = { ...common, kind: 'resolve', requestId, outcome: records.phase.resolution.outcome, reason: records.phase.resolution.reason, ...(records.review ? { review: records.review } : {}) }
          }
        }
        const derived = await transition(current, mutation, checkpoint.lastWallTime, check)
        campaignAssert(equal(derived.event, receipt.event) && equal(derived.records, records), 'Producer historical transition differs from event records')
        rebuilt = await buildWrite(current, derived.checkpoint, mutation.kind, mutation.operationId, await mutationDigest(mutation), records, derived.event, false, receipt.recovery)
      }
      campaignAssert(equal(rebuilt.checkpoint, checkpoint) && equal(rebuilt.receipt, receipt), 'Producer historical state/accounting mismatch')
      // A second, independent actual-wire oracle uses only the validated persisted bytes.
      let measured = utf8Bytes(checkpointKey) + utf8Bytes(rawCheckpoint) + utf8Bytes(receiptKey) + utf8Bytes(rawReceipt)
        + utf8Bytes(headKey) + utf8Bytes(canonicalStringify(rebuilt.head))
      for (const key of keys) measured += utf8Bytes(key) + utf8Bytes(rawEvents.get(key)!)
      if (sequence === origin.head.sequence + 1) measured += utf8Bytes(manifestKey) + utf8Bytes(rawManifest)
      campaignAssert(measured === decodeStorageBytes(receipt.serializedBytes), 'Producer receipt differs from actual stored wire bytes')
      current = advance(current, rebuilt, records)
      if (executor) await executor.checkpoint(true)
    }
    campaignAssert(equal(current.head, head), 'Producer final head differs from replay')
    const successor = producerKeys.checkpoint(campaignIdValue, head.sequence + 1)
    campaignAssert((await guarded([successor])).get(successor) == null, 'Producer head rolled back behind successor')
    check(); return current
  }
  async function lookupReceipt(snapshot: ProducerCampaignSnapshot, operationId: string, check: () => void = () => {}, executor?: ProducerVerificationExecutor): Promise<ProducerCampaignReceipt | null> {
    campaignId(operationId); check()
    const key = producerKeys.receipt(snapshot.manifest.campaignId, operationId)
    const values = await readMany([producerKeys.head(snapshot.manifest.campaignId), key], executor); check()
    campaignAssert(values.get(producerKeys.head(snapshot.manifest.campaignId)) === snapshot.rawHead, 'Producer changed while locating receipt', 'conflict')
    const raw = values.get(key)
    if (raw == null) return null
    const receipt = await validateReceipt(parseProducerRecord(raw) as ProducerCampaignReceipt)
    campaignAssert(receipt.campaignId === snapshot.manifest.campaignId && receipt.operationId === operationId && receipt.sequence > snapshot.origin.head.sequence && receipt.sequence <= snapshot.head.sequence && receipt.manifestHash === snapshot.manifest.hash, 'Producer receipt not in current history')
    const checkpointKey = producerKeys.checkpoint(snapshot.manifest.campaignId, receipt.sequence)
    const evidence = await readMany([producerKeys.head(snapshot.manifest.campaignId), key, checkpointKey], executor); check()
    campaignAssert(evidence.get(producerKeys.head(snapshot.manifest.campaignId)) === snapshot.rawHead && evidence.get(key) === raw, 'Producer receipt changed during verification', 'conflict')
    const checkpoint = await validateCheckpoint(parseProducerRecord(evidence.get(checkpointKey) ?? null) as ProducerCampaignCheckpoint)
    campaignAssert(checkpoint.hash === receipt.checkpointHash && checkpoint.operationId === operationId, 'Producer receipt lacks verified checkpoint')
    return receipt
  }
  async function persist(previous: ProducerCampaignSnapshot, write: Awaited<ReturnType<typeof buildWrite>>, records: Records, canCommit: () => boolean, check: () => void = () => {}, action: Action | null = null): Promise<ProducerCommitResult> {
    // Build the return graph before CAS; optional post-write work cannot obscure a confirmed result.
    const snapshot = advance(previous, write, records)
    try {
      if (!await io.compareAndSwapMany(write.entries, canCommit)) {
        const winner = await readAction(previous.manifest.campaignId, check, action)
        if (winner) {
          const receipt = await lookupReceipt(winner, write.receipt.operationId, check)
          if (receipt) {
            campaignAssert(receipt.businessDigest === write.receipt.businessDigest, 'Producer operation ID has another payload', 'operation_conflict')
            return { snapshot: winner, receipt, replayed: true }
          }
        }
        throw new CampaignProtocolError('conflict', 'Producer CAS failed; no new mutation applied')
      }
    } catch (cause) {
      if (cause instanceof CampaignProtocolError) throw cause
      throw new CampaignProtocolError('storage_unknown', 'Producer commit acknowledgment unconfirmed; verify its receipt before retrying')
    }
    return { snapshot, receipt: write.receipt, replayed: false }
  }
  async function adopt(campaignIdValue: string, operationId: string, identity: Parameters<ProducerCampaignRepository['adopt']>[2], canCommit = () => true): Promise<ProducerCommitResult> {
    campaignId(campaignIdValue); campaignId(operationId)
    campaignRecord(identity, ['runtimeIdentity', 'source'], 'producer adoption identity'); label(identity.runtimeIdentity, 512); sourceIdentity(identity.source)
    const initialRaw = await rawRecord(producerKeys.head(campaignIdValue)); campaignAssert(initialRaw, 'Adoption source does not exist')
    const initial = parseCampaignRecord(initialRaw) as { schemaVersion?: unknown }
    if (initial.schemaVersion === 3) {
      const snapshot = await read(campaignIdValue); campaignAssert(snapshot, 'Adopted Campaign disappeared')
      const receipt = await lookupReceipt(snapshot, operationId)
      campaignAssert(receipt?.kind === 'adopt' && snapshot.manifest.runtimeIdentity === identity.runtimeIdentity && equal(snapshot.manifest.source, identity.source), 'Producer adoption already exists or conflicts', 'operation_conflict')
      return { snapshot, receipt, replayed: true }
    }
    campaignAssert(initial.schemaVersion === 2, 'Only explicit v2 adoption is supported', 'legacy_read_only')
    const origin = await createCampaignRepository(io).read(campaignIdValue)
    campaignAssert(origin && origin.rawHead === initialRaw && origin.head.status === 'completed' && origin.checkpoint.tasks.every(task => task.status === 'committed') && origin.checkpoint.storage.openAllocations.length === 0 && decodeStorageBytes(origin.checkpoint.storage.outstandingBytes) === 0, 'Adoption needs a completed obligation-free source')
    campaignAssert(validatePlanningProfile(origin.manifest), 'Producer adoption requires validated planning')
    const now = clock()
    const manifest = await validateManifest(await seal<ProducerCampaignManifest>({ schemaVersion: 3, protocolVersion: 'campaign-v3', campaignId: campaignIdValue,
      adoptedRawHead: origin.rawHead, adoptedManifestHash: origin.manifest.hash, runtimeIdentity: identity.runtimeIdentity, source: { ...identity.source },
      createdAt: now, expiresAt: origin.manifest.expiresAt, policy: { ...POLICY } }, DOMAIN.manifest))
    const previous = baseline(manifest, origin), checkpoint = await adoptionTransition(previous, operationId, now)
    const write = await buildWrite(previous, checkpoint, 'adopt', operationId, await adoptionDigest(manifest), noRecords(), emptyEvent(), true)
    return persist(previous, write, noRecords(), canCommit)
  }
  async function verificationAction<T>(id: string, context: ProducerVerificationContext, scope: ProducerActionScope,
    run: (action: Action, executor: ProducerVerificationExecutor) => Promise<T>): Promise<T> {
    return withinAction(id, scope, () => {}, async (live, action) => {
      campaignAssert(action && !action.sessionAttempted && action.admission === 'new' && !action.seeded, 'Verification session attempt already consumed', 'conflict')
      action.sessionAttempted = true // Consumed before discovery, including legacy/null inspection.
      const executor = new ProducerVerificationExecutor(context, verificationStatistics, live, id)
      action.executor = executor
      try { executor.start(); return await run(action, executor) }
      catch (error) { executor.fail(error); throw error }
      finally { action.executor = null; refreshVerificationRetention() }
    })
  }
  async function finishCurrentVerification(snapshot: ProducerCampaignSnapshot, action: Action, executor: ProducerVerificationExecutor): Promise<void> {
    campaignAssert(action.repository && action.token && action.seeded, 'Verification has no private origin proof', 'conflict')
    const bridge = campaignVerificationBridge(action.repository)
    bridge.requireCapture(action.token, executor)
    const active = new Set([...snapshot.origin.artifacts.keys(), ...snapshot.origin.requests.keys(), ...snapshot.artifacts.keys(),
      ...snapshot.requests.keys(), ...snapshot.phases.keys(), ...snapshot.responses.keys(), ...snapshot.reviews.keys()]).size
    bridge.sealAggregate(action.token, executor, decodeStorageBytes(snapshot.checkpoint.storage.writtenBytes), active)
    action.guard = { adoptedRawHead: snapshot.origin.rawHead, rawHead: snapshot.rawHead, check: executor.check }
    executor.beginFence()
    let passed = false
    try {
      await bridge.fence(action.token, executor, snapshot.origin.rawHead)
      const headKey = producerKeys.head(snapshot.manifest.campaignId), successor = producerKeys.checkpoint(snapshot.manifest.campaignId, snapshot.head.sequence + 1)
      const values = await readMany([headKey, successor], executor)
      campaignAssert(values.get(headKey) === snapshot.rawHead && values.get(successor) == null, 'Producer final verification fence changed', 'conflict')
      executor.check(); passed = true
    } finally { executor.endFence(passed); action.guard = null }
    executor.complete()
  }
  async function verifyCurrent(id: string, context: ProducerVerificationContext, scope: ProducerActionScope): Promise<ProducerCampaignSnapshot | null> {
    campaignId(id)
    return verificationAction(id, context, scope, async (action, executor) => {
      executor.setPurpose('current_v3')
      const snapshot = await readAction(id, executor.check, action, executor)
      if (snapshot) await finishCurrentVerification(snapshot, action, executor)
      else executor.complete()
      return snapshot
    })
  }
  async function adoptVerified(id: string, operationId: string, suppliedIdentity: Parameters<ProducerCampaignRepository['adopt']>[2], context: ProducerVerificationContext, scope: ProducerActionScope): Promise<ProducerCommitResult> {
    campaignId(id); campaignId(operationId)
    const identity = structuredClone(suppliedIdentity)
    campaignRecord(identity, ['runtimeIdentity', 'source'], 'producer adoption identity'); label(identity.runtimeIdentity, 512); sourceIdentity(identity.source)
    return verificationAction(id, context, scope, async (action, executor) => {
      const initialRaw = await rawRecord(producerKeys.head(id), executor)
      campaignAssert(initialRaw, 'Adoption source does not exist')
      const initial = parseCampaignRecord(initialRaw) as { schemaVersion?: unknown }
      if (initial.schemaVersion === 3) {
        executor.setPurpose('current_v3')
        const snapshot = await readAction(id, executor.check, action, executor, initialRaw)
        campaignAssert(snapshot, 'Adopted Campaign disappeared')
        await finishCurrentVerification(snapshot, action, executor)
        const receipt = await lookupReceipt(snapshot, operationId, () => campaignAssert(executor.canCommit(), 'Adoption retry owner expired', 'conflict'), executor)
        campaignAssert(receipt?.kind === 'adopt' && snapshot.manifest.runtimeIdentity === identity.runtimeIdentity && equal(snapshot.manifest.source, identity.source), 'Producer adoption already exists or conflicts', 'operation_conflict')
        return { snapshot, receipt, replayed: true }
      }
      campaignAssert(initial.schemaVersion === 2, 'Only explicit v2 adoption is supported', 'legacy_read_only')
      const head = validateCampaignHead(initial)
      campaignAssert(head.campaignId === id, 'Adoption head key mismatch')
      executor.setPurpose('adoption_v2'); executor.setTotal(head.sequence + 1); executor.setStage('origin_replay')
      executor.bindResumeFence(async () => {
        campaignAssert(await rawRecord(producerKeys.head(id), executor) === initialRaw, 'Adoption head changed across verification suspension', 'conflict')
      })
      admitOrigin(action, id)
      campaignAssert(action.repository && action.token && action.admission === 'admitted', 'Adoption verification proof not admitted', 'conflict')
      action.guard = { adoptedRawHead: initialRaw, rawHead: initialRaw, check: executor.check }
      const bridge = campaignVerificationBridge(action.repository)
      let origin: CampaignSnapshot
      try {
        const source = await bridge.read(id, action.token, executor)
        campaignAssert(source && source.rawHead === initialRaw && source.head.status === 'completed' && source.checkpoint.tasks.every(task => task.status === 'committed')
          && source.checkpoint.storage.openAllocations.length === 0 && decodeStorageBytes(source.checkpoint.storage.outstandingBytes) === 0, 'Adoption needs a completed obligation-free source')
        campaignAssert(validatePlanningProfile(source.manifest), 'Producer adoption requires validated planning')
        origin = source; action.seeded = true
        action.identity = canonicalStringify({ manifestHash: origin.manifest.hash, adoptedRawHead: initialRaw })
        bridge.requireCapture(action.token, executor)
        bridge.sealAggregate(action.token, executor, decodeStorageBytes(origin.checkpoint.storage.writtenBytes), origin.artifacts.size + origin.requests.size)
        executor.beginFence()
        let passed = false
        try { await bridge.fence(action.token, executor, initialRaw); executor.check(); passed = true }
        finally { executor.endFence(passed) }
        executor.complete()
      } finally { action.guard = null }
      // Consume the private baseline exactly once; never call the old persist
      // fallback, switch purpose, or reconcile inline after this CAS.
      const now = clock()
      const manifest = await validateManifest(await seal<ProducerCampaignManifest>({ schemaVersion: 3, protocolVersion: 'campaign-v3', campaignId: id,
        adoptedRawHead: origin.rawHead, adoptedManifestHash: origin.manifest.hash, runtimeIdentity: identity.runtimeIdentity, source: { ...identity.source },
        createdAt: now, expiresAt: origin.manifest.expiresAt, policy: { ...POLICY } }, DOMAIN.manifest))
      const previous = baseline(manifest, origin), checkpoint = await adoptionTransition(previous, operationId, now)
      const write = await buildWrite(previous, checkpoint, 'adopt', operationId, await adoptionDigest(manifest), noRecords(), emptyEvent(), true)
      const snapshot = advance(previous, write, noRecords())
      let enteredCas = false, applied: boolean
      try {
        applied = await executor.io('cas', () => { enteredCas = true; return io.compareAndSwapMany(write.entries, () => executor.canCommit()) })
      } catch (error) {
        if (enteredCas) throw new CampaignProtocolError('storage_unknown', 'Producer adoption acknowledgment unconfirmed; retry explicitly to verify its receipt')
        throw error
      }
      campaignAssert(applied, 'Producer adoption CAS failed; explicit retry required', 'conflict')
      return { snapshot, receipt: write.receipt, replayed: false }
    })
  }
  async function commit(expected: ProducerCampaignSnapshot, input: ProducerMutation, canCommit = () => true, scope?: ProducerActionScope): Promise<ProducerCommitResult> {
    const check = () => campaignAssert(canCommit(), 'Producer action no longer owns mutation', 'conflict')
    return withinAction(expected.manifest.campaignId, scope, check, (live, action) => commitAction(expected, input, () => { try { live(); return true } catch { return false } }, live, action))
  }
  async function commitAction(expected: ProducerCampaignSnapshot, input: ProducerMutation, canCommit: () => boolean, check: () => void, action: Action | null): Promise<ProducerCommitResult> {
    const mutation = structuredClone(input), id = expected.manifest.campaignId, expectedRawHead = expected.rawHead
    campaignId(id); campaignId(mutation.operationId)
    const current = await readAction(id, check, action)
    campaignAssert(current, 'Producer campaign missing')
    const digest = await mutationDigest(mutation), prior = await lookupReceipt(current, mutation.operationId, check)
    if (prior) {
      campaignAssert(prior.kind === mutation.kind && prior.businessDigest === digest, 'Producer operation ID has another payload', 'operation_conflict')
      return { snapshot: current, receipt: prior, replayed: true }
    }
    campaignAssert(current.rawHead === expectedRawHead, 'Producer head changed before mutation', 'conflict')
    const derived = await transition(current, mutation, clock(), check)
    const write = await buildWrite(current, derived.checkpoint, mutation.kind, mutation.operationId, digest, derived.records, derived.event, false, mutation.recovery === true)
    return persist(current, write, derived.records, canCommit, check, action)
  }
  async function getReceipt(campaignIdValue: string, operationId: string, check: () => void = () => {}, scope?: ProducerActionScope): Promise<ProducerCampaignReceipt | null> {
    return withinAction(campaignIdValue, scope, check, async (live, action) => {
      const snapshot = await readAction(campaignIdValue, live, action)
      return snapshot ? lookupReceipt(snapshot, operationId, live) : null
    })
  }
  return { adopt, read, commit, getReceipt, createActionScope, disposeActionScope, getActionProofStats, verifyCurrent, adoptVerified, getVerificationStats }
}
