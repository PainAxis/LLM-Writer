/** Pure, closed v4 storage protocol. No compiler, repository, transport or authority import. */
import type {
  CreativeAdapterIdentity, CreativeAdapterResult, CreativeArtifact, CreativeArtifactRef, CreativeArtifactTextV1, CreativeBriefV1,
  CreativeBudget, CreativeCandidate, CreativeCheckpoint, CreativeDispatchWire, CreativeErrorCode, CreativeHead, CreativeManifest,
  CreativePhase, CreativePolicy, CreativeReceipt, CreativeRequest, CreativeResolutionReason, CreativeResponse, CreativeRuntimeIdentity,
  CreativeTaskId, CreativeTaskSpec,
} from '../../types/creativePilot'
import {
  assertScalarText, canonicalCampaignText, canonicalStringify, decodeStorageBytes, encodeStorageBytes, hashCampaignValue, hashText,
  measureCampaignText, utf8Bytes, validateCampaignStorage,
} from './protocol'

export class CreativePilotError extends Error {
  constructor(readonly code: CreativeErrorCode, message: string = code) { super(message); this.name = 'CreativePilotError' }
}
export function creativeAssert(value: unknown, message = 'Invalid creative-pilot record', code: CreativeErrorCode = 'integrity'): asserts value {
  if (!value) throw new CreativePilotError(code, message)
}
export const CREATIVE_LIMITS = Object.freeze({ tasks: 9, attempts: 9, operations: 48, observedKeys: 174, recordBytes: 1_048_576,
  storageBytes: 67_108_864, recoveryBytes: 524_288, metadataBytes: 65_536, createBytes: 131_072, originBytes: 524_288,
  responseRecordBytes: 524_288, artifactBytes: 524_288, requestAllowance: 1_900_544, inputBytes: 65_536, inputUtf16: 65_536,
  httpBytes: 65_536, textUtf16: 65_536, outputTokens: 4096, stageMs: 60_000, metadataMs: 10_000, sdkMs: 30_000,
  ioMs: 3_000, repositoryMs: 10_000, runMs: 900_000, briefUtf16: 1024, briefBytes: 4096, bodyUtf16: 2048,
  bodyBytes: 8192, bodyMinScalars: 256, bodyMaxScalars: 1024 })
export const CREATIVE_POLICY: Readonly<CreativePolicy> = Object.freeze({ protocol: 'creative-pilot-policy-v1', mode: 'sdk_offline_readiness',
  transportPolicy: 'creative-pilot-sdk-v1', inputTokenEnforcement: 'not_enforced_offline_control', retention: 'local_campaign_lifetime_no_automatic_deletion' })
export const CREATIVE_BUDGET_LIMITS: Readonly<CreativeBudget> = Object.freeze({ attempts: 9, inputBytes: 589824, inputUtf16: 589824,
  inputTokens: null, outputTokens: 36864, reasoningTokens: 0, responseBytes: 589824, activeMs: 600000, artifacts: 9, operations: 48 })
export const CREATIVE_DOMAIN = Object.freeze({ manifest: 'creative-pilot-manifest-v4', candidate: 'creative-pilot-candidate-v1',
  checkpoint: 'creative-pilot-checkpoint-v4', receipt: 'creative-pilot-receipt-v4', request: 'creative-pilot-request-v1',
  phase: 'creative-pilot-phase-v1', response: 'creative-pilot-response-v1', artifact: 'creative-pilot-artifact-v1' })
export const CREATIVE_COMPILE_REASONS = Object.freeze(['finish_incomplete', 'reported_model_absent', 'reported_model_mismatch', 'reported_model_invalid',
  'reasoning_disallowed', 'usage_invalid', 'content_evidence_invalid', 'empty_output', 'invalid_scalar', 'raw_output_capacity',
  'invalid_json', 'duplicate_json_key', 'output_schema', 'invalid_reference', 'invalid_schedule', 'planning_capacity', 'compiled_capacity', 'body_length'] as const)
export const CREATIVE_RESOLUTION_REASONS: readonly CreativeResolutionReason[] = Object.freeze([...CREATIVE_COMPILE_REASONS,
  'cancelled', 'expired', 'stage_expired_before_intent', 'closed_before_intent', 'authority_revoked'])
export const CREATIVE_ANOMALIES = Object.freeze(['reasoning_present', 'tool_calls_present', 'unexpected_content', 'invalid_step_count', 'invalid_content_metadata'] as const)
const UNKNOWN = ['interrupted', 'deadline', 'transport_unknown', 'ack_uncertain'] as const
const PHASES = ['reserved', 'dispatch_intent', 'outcome_unknown', 'response_retained', 'resolved'] as const
const STATUSES = ['prepared', 'running', 'blocked', 'completed', 'cancelled'] as const
const BUDGET_KEYS = Object.keys(CREATIVE_BUDGET_LIMITS) as Array<keyof CreativeBudget>
export function creativeEqual(a: unknown, b: unknown): boolean { return canonicalStringify(a) === canonicalStringify(b) }
export function creativeRecord(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  creativeAssert(value !== null && typeof value === 'object' && !Array.isArray(value))
  creativeAssert(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'Unknown or missing creative record field')
}
export function creativeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER, minimum = 0): asserts value is number {
  creativeAssert(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum)
}
export function creativeId(value: unknown): asserts value is string { creativeAssert(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value)) }
export function creativeHash(value: unknown): asserts value is string { creativeAssert(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) }
function nullableHash(value: unknown): void { if (value !== null) creativeHash(value) }
function choice(value: unknown, choices: readonly unknown[]): void { creativeAssert(choices.includes(value)) }
function text(value: unknown, maximum = 512, nonempty = true): asserts value is string {
  creativeAssert(typeof value === 'string' && value.length <= maximum && (!nonempty || value.trim().length > 0)); assertScalarText(value)
}
function array(value: unknown, max: number): asserts value is unknown[] { creativeAssert(Array.isArray(value) && value.length <= max) }
export function creativeTaskGraph(): CreativeTaskSpec[] {
  const global: CreativeTaskSpec[] = [{ id: 'outline', kind: 'outline', chapterOrdinal: null, dependsOn: [] },
    { id: 'characters', kind: 'character_bible', chapterOrdinal: null, dependsOn: ['outline'] },
    { id: 'details', kind: 'detailed_outline', chapterOrdinal: null, dependsOn: ['outline', 'characters'] }]
  const outlines: CreativeTaskSpec[] = [1, 2, 3].map(n => ({ id: `o-${n}` as CreativeTaskId, kind: 'chapter_outline', chapterOrdinal: n as 1 | 2 | 3, dependsOn: global.map(t => t.id) }))
  const plans = [...global, ...outlines]
  return [...plans, ...[1, 2, 3].map(n => ({ id: `b-${n}` as CreativeTaskId, kind: 'chapter_body' as const, chapterOrdinal: n as 1 | 2 | 3,
    dependsOn: [...plans.map(t => t.id), ...Array.from({ length: n - 1 }, (_, i) => `b-${i + 1}` as CreativeTaskId)] }))]
}
const taskIds = creativeTaskGraph().map(t => t.id)
export function emptyCreativeBudget(): CreativeBudget { return { attempts: 0, inputBytes: 0, inputUtf16: 0, inputTokens: null, outputTokens: 0, reasoningTokens: 0, responseBytes: 0, activeMs: 0, artifacts: 0, operations: 0 } }
export function creativeRequestReservation(): CreativeBudget { return { ...emptyCreativeBudget(), attempts: 1, inputBytes: 65536, inputUtf16: 65536, outputTokens: 4096, responseBytes: 65536, activeMs: 60000 } }
function budget(value: unknown): asserts value is CreativeBudget {
  creativeRecord(value, BUDGET_KEYS); creativeAssert(value.inputTokens === null)
  for (const key of BUDGET_KEYS) if (key !== 'inputTokens') creativeInteger(value[key], CREATIVE_BUDGET_LIMITS[key]!)
}
function runtimeIdentity(value: CreativeRuntimeIdentity): void {
  text(value.runtimeIdentity); creativeRecord(value.source, ['commit', 'tree'])
  creativeAssert((value.source.commit === null) === (value.source.tree === null))
  for (const v of Object.values(value.source)) creativeAssert(v === null || typeof v === 'string' && /^[a-f0-9]{40}$/.test(v))
}
export function validateCreativeBrief(value: unknown): asserts value is CreativeBriefV1 {
  creativeRecord(value, ['protocol', 'language', 'premise', 'constraints']); choice(value.protocol, ['creative-brief-v1']); choice(value.language, ['zh', 'en'])
  text(value.premise, 1024); array(value.constraints, 8); value.constraints.forEach(v => text(v, 1024))
  const parts = [value.premise, ...value.constraints as string[]]
  creativeAssert(parts.reduce((n, s) => n + s.length, 0) <= 1024 && parts.reduce((n, s) => n + utf8Bytes(s), 0) <= 4096, 'Brief capacity', 'input_invalid')
}
export function validateCreativeAdapter(value: unknown): asserts value is CreativeAdapterIdentity {
  creativeRecord(value, ['mode', 'adapterId', 'adapterVersion', 'requestedModelId', 'effectiveModelId', 'configurationRevision', 'endpointIdentity']); choice(value.mode, ['offline_control'])
  for (const key of ['adapterId', 'adapterVersion', 'requestedModelId', 'effectiveModelId', 'configurationRevision']) creativeAssert(typeof value[key] === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(value[key] as string))
  text(value.endpointIdentity, 512)
  try { const url = new URL(value.endpointIdentity); creativeAssert(['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && !url.username && !url.password && !url.search && !url.hash && url.href === value.endpointIdentity) } catch { throw new CreativePilotError('integrity') }
}
export function validateCreativeDispatchWire(value: unknown): asserts value is CreativeDispatchWire {
  creativeRecord(value, ['wireProtocol', 'bodyDigest', 'bodyBytes', 'bodyUtf16']); choice(value.wireProtocol, ['creative-pilot-http-wire-v1'])
  creativeHash(value.bodyDigest); creativeInteger(value.bodyBytes, 65536, 1); creativeInteger(value.bodyUtf16, 65536, 1)
}
function ref(value: unknown): asserts value is CreativeArtifactRef { creativeRecord(value, ['taskId', 'revision', 'hash']); choice(value.taskId, taskIds); choice(value.revision, [0]); creativeHash(value.hash) }
function refs(value: unknown): void { array(value, 8); value.forEach(ref); creativeAssert(new Set(value.map(v => (v as CreativeArtifactRef).taskId)).size === value.length) }
async function hashed<T extends { hash: string }>(value: T, domain: string): Promise<T> {
  creativeHash(value.hash); const { hash: actual, ...payload } = value
  creativeAssert(actual === await hashCampaignValue(domain, payload), 'Creative record hash mismatch'); return value
}
export async function sealCreativeRecord<T extends { hash: string }>(value: Omit<T, 'hash'>, domain: string): Promise<T> {
  const payload = structuredClone(value); return { ...payload, hash: await hashCampaignValue(domain, payload) } as T
}
export function parseCreativeRecord(raw: string | null, maximum: number = CREATIVE_LIMITS.recordBytes): unknown {
  creativeAssert(typeof raw === 'string' && raw.length <= maximum && utf8Bytes(raw) <= maximum, 'Creative record capacity', 'retention_capacity')
  let value: unknown; try { value = JSON.parse(raw) } catch { throw new CreativePilotError('integrity') }
  creativeAssert(canonicalStringify(value) === raw, 'Noncanonical creative record'); return value
}
export async function validateCreativeCandidate(value: CreativeCandidate): Promise<CreativeCandidate> {
  creativeRecord(value, ['schemaVersion', 'protocol', 'campaignId', 'id', 'revision', 'parentHash', 'brief', 'briefHash', 'createdAt', 'hash'])
  choice(value.schemaVersion, [1]); choice(value.protocol, ['creative-pilot-candidate-v1']); creativeId(value.campaignId); creativeId(value.id)
  choice(value.revision, [0, 1]); nullableHash(value.parentHash); creativeAssert((value.revision === 0) === (value.parentHash === null)); validateCreativeBrief(value.brief)
  creativeHash(value.briefHash); creativeAssert(value.briefHash === await hashCampaignValue('creative-brief-v1', value.brief)); creativeInteger(value.createdAt)
  return hashed(value, CREATIVE_DOMAIN.candidate)
}
export async function createCreativeCandidate(campaignId: string, brief: CreativeBriefV1, createdAt: number, previous?: CreativeCandidate): Promise<CreativeCandidate> {
  return validateCreativeCandidate(await sealCreativeRecord<CreativeCandidate>({ schemaVersion: 1, protocol: 'creative-pilot-candidate-v1', campaignId,
    id: `candidate-${previous ? 1 : 0}`, revision: previous ? 1 : 0, parentHash: previous?.hash ?? null,
    brief: structuredClone(brief), briefHash: await hashCampaignValue('creative-brief-v1', brief), createdAt }, CREATIVE_DOMAIN.candidate))
}
export async function validateCreativeManifest(value: CreativeManifest): Promise<CreativeManifest> {
  creativeRecord(value, ['schemaVersion', 'protocolVersion', 'campaignId', 'language', 'initialCandidateHash', 'taskGraphVersion', 'tasks', 'compilerVersion', 'promptVersion', 'countingVersion', 'runtimeIdentity', 'source', 'policy', 'budget', 'storage', 'createdAt', 'expiresAt', 'hash'])
  choice(value.schemaVersion, [4]); choice(value.protocolVersion, ['creative-pilot-v4']); creativeId(value.campaignId); choice(value.language, ['zh', 'en']); creativeHash(value.initialCandidateHash)
  choice(value.taskGraphVersion, ['creative-three-chapter-v1']); creativeAssert(creativeEqual(value.tasks, creativeTaskGraph())); choice(value.compilerVersion, ['creative-plan-compiler-v1']); choice(value.promptVersion, ['creative-pilot-prompt-v1'])
  choice(value.countingVersion, ['crlf-lf-nfc-scalar-v1']); runtimeIdentity(value); creativeAssert(creativeEqual(value.policy, CREATIVE_POLICY) && creativeEqual(value.budget, CREATIVE_BUDGET_LIMITS))
  creativeAssert(creativeEqual(value.storage, { limitBytes: encodeStorageBytes(67108864), recoveryReserveBytes: encodeStorageBytes(524288) }))
  creativeInteger(value.createdAt); creativeInteger(value.expiresAt); creativeAssert(value.expiresAt === value.createdAt + 900000)
  return hashed(value, CREATIVE_DOMAIN.manifest)
}
export async function createCreativeManifest(campaignId: string, candidate: CreativeCandidate, identity: CreativeRuntimeIdentity): Promise<CreativeManifest> {
  return validateCreativeManifest(await sealCreativeRecord<CreativeManifest>({ schemaVersion: 4, protocolVersion: 'creative-pilot-v4', campaignId,
    language: candidate.brief.language, initialCandidateHash: candidate.hash, taskGraphVersion: 'creative-three-chapter-v1', tasks: creativeTaskGraph(),
    compilerVersion: 'creative-plan-compiler-v1', promptVersion: 'creative-pilot-prompt-v1', countingVersion: 'crlf-lf-nfc-scalar-v1', ...structuredClone(identity),
    policy: { ...CREATIVE_POLICY }, budget: { ...CREATIVE_BUDGET_LIMITS }, storage: { limitBytes: encodeStorageBytes(67108864), recoveryReserveBytes: encodeStorageBytes(524288) },
    createdAt: candidate.createdAt, expiresAt: candidate.createdAt + 900000 }, CREATIVE_DOMAIN.manifest))
}
export async function validateCreativeRequest(value: CreativeRequest): Promise<CreativeRequest> {
  creativeRecord(value, ['schemaVersion', 'protocol', 'campaignId', 'id', 'operationId', 'manifestHash', 'candidateHash', 'taskId', 'taskRevision', 'dependencies', 'prepared', 'adapter', 'invocationId', 'reservation', 'createdAt', 'expiresAt', 'storageAllocationBytes', 'hash'])
  choice(value.schemaVersion, [1]); choice(value.protocol, ['creative-pilot-request-v1']); creativeId(value.campaignId); creativeId(value.id); creativeId(value.operationId); creativeId(`${value.operationId}:resolve`)
  creativeHash(value.manifestHash); creativeHash(value.candidateHash); choice(value.taskId, taskIds); creativeInteger(value.taskRevision, 1); refs(value.dependencies); validateCreativeAdapter(value.adapter); creativeId(value.invocationId)
  creativeAssert(creativeEqual(value.reservation, creativeRequestReservation())); creativeInteger(value.createdAt); creativeInteger(value.expiresAt)
  creativeAssert(value.expiresAt > value.createdAt && value.expiresAt <= value.createdAt + 60000 && value.storageAllocationBytes === encodeStorageBytes(CREATIVE_LIMITS.requestAllowance))
  creativeAssert(value.prepared && value.prepared.protocol === 'creative-pilot-input-v1'); creativeRecord(value.prepared.wire, ['system', 'prompt'])
  text(value.prepared.wire.system, 65536); text(value.prepared.wire.prompt, 65536)
  const wire = canonicalStringify(value.prepared.wire)
  creativeAssert(utf8Bytes(wire) <= 65536 && wire.length <= 65536 && value.prepared.inputBytes === utf8Bytes(wire) && value.prepared.inputUtf16 === wire.length)
  creativeAssert(value.prepared.inputDigest === await hashText(wire))
  return hashed(value, CREATIVE_DOMAIN.request)
}
export async function sealCreativeRequest(value: Omit<CreativeRequest, 'hash'>): Promise<CreativeRequest> { return validateCreativeRequest(await sealCreativeRecord<CreativeRequest>(value, CREATIVE_DOMAIN.request)) }
export async function encodeCreativeResponseText(textValue: string): Promise<Pick<CreativeAdapterResult, 'textJson' | 'textJsonHash' | 'textUtf16' | 'scalarMetrics'>> {
  creativeAssert(typeof textValue === 'string' && textValue.length <= 65536, 'Response text exceeds retention capacity', 'retention_capacity')
  const textJson = JSON.stringify(textValue)
  let scalarMetrics = null
  try { assertScalarText(textValue); scalarMetrics = await measureCampaignText(textValue); creativeAssert(scalarMetrics.utf8Bytes <= 65536, 'Response text exceeds retention capacity', 'retention_capacity') }
  catch (error) { if (error instanceof CreativePilotError) throw error }
  return { textJson, textJsonHash: await hashCampaignValue('creative-visible-text-json-v1', textJson), textUtf16: textValue.length, scalarMetrics }
}
export async function validateCreativeResponse(value: CreativeResponse): Promise<CreativeResponse> {
  creativeRecord(value, ['schemaVersion', 'protocol', 'campaignId', 'requestHash', 'intentHash', 'evidenceId', 'textJson', 'textJsonHash', 'textUtf16', 'scalarMetrics', 'finishReason', 'contentEvidence', 'usage', 'reportedModel', 'hash'])
  choice(value.schemaVersion, [1]); choice(value.protocol, ['creative-pilot-response-v1']); creativeId(value.campaignId); creativeHash(value.requestHash); creativeHash(value.intentHash); creativeId(value.evidenceId)
  text(value.textJson, 393218); let decoded: unknown; try { decoded = JSON.parse(value.textJson) } catch { throw new CreativePilotError('integrity') }
  creativeAssert(typeof decoded === 'string' && JSON.stringify(decoded) === value.textJson)
  creativeAssert(creativeEqual(await encodeCreativeResponseText(decoded), { textJson: value.textJson, textJsonHash: value.textJsonHash, textUtf16: value.textUtf16, scalarMetrics: value.scalarMetrics }))
  choice(value.finishReason, ['stop', 'length', 'content_filter', 'tool_calls', 'error', 'other', 'unknown'])
  creativeRecord(value.contentEvidence, ['stepCount', 'anomalies']); if (value.contentEvidence.stepCount !== null) creativeInteger(value.contentEvidence.stepCount)
  array(value.contentEvidence.anomalies, 5); creativeAssert(creativeEqual(value.contentEvidence.anomalies, CREATIVE_ANOMALIES.filter(x => value.contentEvidence.anomalies.includes(x))))
  creativeRecord(value.usage, ['status', 'provenance', 'inputTokens', 'outputTokens', 'reasoningTokens']); choice(value.usage.status, ['complete', 'partial', 'unavailable', 'invalid']); choice(value.usage.provenance, ['synthetic_control'])
  for (const key of ['inputTokens', 'outputTokens', 'reasoningTokens'] as const) if (value.usage[key] !== null) creativeInteger(value.usage[key])
  creativeRecord(value.reportedModel, ['status', 'value']); choice(value.reportedModel.status, ['absent', 'matched', 'mismatch', 'invalid'])
  if (['absent', 'invalid'].includes(value.reportedModel.status)) creativeAssert(value.reportedModel.value === null)
  else creativeAssert(typeof value.reportedModel.value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(value.reportedModel.value))
  const { textJson: _text, ...metadata } = value; creativeAssert(utf8Bytes(canonicalStringify(metadata)) + 1024 <= 8192, 'Response metadata capacity', 'retention_capacity')
  return hashed(value, CREATIVE_DOMAIN.response)
}
export async function sealCreativeResponse(value: Omit<CreativeResponse, 'hash'>): Promise<CreativeResponse> { return validateCreativeResponse(await sealCreativeRecord<CreativeResponse>(value, CREATIVE_DOMAIN.response)) }
export async function validateCreativeArtifact(value: CreativeArtifact): Promise<CreativeArtifact> {
  creativeRecord(value, ['schemaVersion', 'protocol', 'campaignId', 'candidateHash', 'taskId', 'taskRevision', 'revision', 'kind', 'dependencies', 'requestHash', 'responseHash', 'compilerVersion', 'promptVersion', 'catalogRoot', 'text', 'raw', 'canonical', 'semanticStatus', 'hash'])
  choice(value.schemaVersion, [1]); choice(value.protocol, ['creative-pilot-artifact-v1']); creativeId(value.campaignId); creativeHash(value.candidateHash); choice(value.taskId, taskIds); creativeInteger(value.taskRevision, 1); choice(value.revision, [0])
  creativeAssert(value.kind === creativeTaskGraph().find(t => t.id === value.taskId)!.kind); refs(value.dependencies); creativeHash(value.requestHash); creativeHash(value.responseHash); creativeHash(value.catalogRoot)
  choice(value.compilerVersion, ['creative-plan-compiler-v1']); choice(value.promptVersion, ['creative-pilot-prompt-v1']); choice(value.semanticStatus, ['not_reviewed']); text(value.text, 65536)
  creativeAssert(creativeEqual(value.raw, await measureCampaignText(value.text)) && creativeEqual(value.canonical, await measureCampaignText(canonicalCampaignText(value.text))))
  return hashed(value, CREATIVE_DOMAIN.artifact)
}
export async function sealCreativeArtifactCandidate(request: CreativeRequest, response: CreativeResponse, value: CreativeArtifactTextV1): Promise<CreativeArtifact> {
  creativeRecord(value, ['text', 'raw', 'canonical', 'catalogRoot', 'semanticStatus'])
  creativeAssert(response.requestHash === request.hash && response.campaignId === request.campaignId)
  return validateCreativeArtifact(await sealCreativeRecord<CreativeArtifact>({ schemaVersion: 1, protocol: 'creative-pilot-artifact-v1', campaignId: request.campaignId,
    candidateHash: request.candidateHash, taskId: request.taskId, taskRevision: request.taskRevision, revision: 0, kind: request.prepared.identity.stage,
    dependencies: structuredClone(request.dependencies), requestHash: request.hash, responseHash: response.hash,
    compilerVersion: request.prepared.compilerVersion, promptVersion: request.prepared.promptVersion, ...structuredClone(value) }, CREATIVE_DOMAIN.artifact))
}
export async function validateCreativePhase(value: CreativePhase): Promise<CreativePhase> {
  creativeRecord(value, ['schemaVersion', 'protocol', 'campaignId', 'requestHash', 'revision', 'parentHash', 'status', 'intentHash', 'dispatchWire', 'responseHash', 'resolution', 'reason', 'hash'])
  choice(value.schemaVersion, [1]); choice(value.protocol, ['creative-pilot-phase-v1']); creativeId(value.campaignId); creativeHash(value.requestHash); creativeInteger(value.revision, 4)
  nullableHash(value.parentHash); creativeAssert((value.revision === 0) === (value.parentHash === null)); choice(value.status, PHASES); nullableHash(value.intentHash); nullableHash(value.responseHash)
  if (value.dispatchWire !== null) validateCreativeDispatchWire(value.dispatchWire)
  if (value.reason !== null) choice(value.reason, UNKNOWN)
  creativeAssert((value.status === 'outcome_unknown') === (value.reason !== null))
  creativeAssert((value.status === 'resolved') === (value.resolution !== null))
  if (value.status === 'reserved') creativeAssert(value.revision === 0 && value.intentHash === null && value.dispatchWire === null && value.responseHash === null)
  if (value.status === 'dispatch_intent') creativeAssert(value.revision === 1 && value.intentHash === null && value.dispatchWire !== null && value.responseHash === null)
  if (value.status === 'outcome_unknown') creativeAssert(value.intentHash !== null && value.dispatchWire !== null && value.responseHash === null)
  if (value.status === 'response_retained') creativeAssert(value.intentHash !== null && value.dispatchWire !== null && value.responseHash !== null)
  if (value.resolution) {
    creativeRecord(value.resolution, ['outcome', 'reason', 'artifactHash']); choice(value.resolution.outcome, ['accepted', 'refused', 'not_dispatched', 'authority_revoked'])
    nullableHash(value.resolution.artifactHash); if (value.resolution.reason !== null) choice(value.resolution.reason, CREATIVE_RESOLUTION_REASONS)
    if (value.resolution.outcome === 'accepted') creativeAssert(value.resolution.reason === null && value.resolution.artifactHash !== null && value.responseHash !== null)
    else creativeAssert(value.resolution.artifactHash === null && value.resolution.reason !== null)
    if (value.resolution.outcome === 'not_dispatched') creativeAssert(value.intentHash === null && value.dispatchWire === null && value.responseHash === null && ['cancelled', 'stage_expired_before_intent', 'closed_before_intent'].includes(value.resolution.reason!))
    else creativeAssert(value.intentHash !== null && value.dispatchWire !== null && value.responseHash !== null)
    if (value.resolution.outcome === 'authority_revoked') creativeAssert(value.resolution.reason === 'authority_revoked')
    if (value.resolution.outcome === 'refused') creativeAssert(['cancelled', 'expired', ...CREATIVE_COMPILE_REASONS].includes(value.resolution.reason! as never))
  }
  return hashed(value, CREATIVE_DOMAIN.phase)
}
export function validateCreativeHead(value: CreativeHead): CreativeHead {
  creativeRecord(value, ['schemaVersion', 'protocolVersion', 'campaignId', 'manifestHash', 'sequence', 'checkpointHash', 'receiptId', 'candidateHash', 'executionEpoch', 'status'])
  choice(value.schemaVersion, [4]); choice(value.protocolVersion, ['creative-pilot-head-v4']); creativeId(value.campaignId); creativeHash(value.manifestHash)
  creativeInteger(value.sequence, 47); creativeHash(value.checkpointHash); creativeId(value.receiptId); creativeHash(value.candidateHash); creativeInteger(value.executionEpoch, 48); choice(value.status, STATUSES); return value
}
export async function validateCreativeCheckpoint(value: CreativeCheckpoint): Promise<CreativeCheckpoint> {
  creativeRecord(value, ['schemaVersion', 'protocolVersion', 'campaignId', 'manifestHash', 'sequence', 'previousHash', 'operationId', 'candidateHash', 'adapter', 'executionEpoch', 'status', 'reason', 'tasks', 'requests', 'budget', 'metadata', 'storage', 'bodyCharacters', 'lastWallTime', 'hash'])
  choice(value.schemaVersion, [4]); choice(value.protocolVersion, ['creative-pilot-checkpoint-v4']); creativeId(value.campaignId); creativeHash(value.manifestHash)
  creativeInteger(value.sequence, 47); nullableHash(value.previousHash); creativeAssert((value.sequence === 0) === (value.previousHash === null)); creativeId(value.operationId); creativeHash(value.candidateHash)
  if (value.adapter !== null) validateCreativeAdapter(value.adapter)
  creativeInteger(value.executionEpoch, 48); choice(value.status, STATUSES); if (value.reason !== null) choice(value.reason, [...CREATIVE_RESOLUTION_REASONS, ...UNKNOWN])
  array(value.tasks, 9); creativeAssert(value.tasks.length === 9)
  value.tasks.forEach((task, index) => { creativeRecord(task, ['taskId', 'revision', 'status', 'requestHash', 'artifactHash']); creativeAssert(task.taskId === taskIds[index]); creativeInteger(task.revision, 1)
    choice(task.status, ['pending', ...PHASES.filter(s => s !== 'resolved'), 'accepted', 'refused', 'not_dispatched', 'authority_revoked']); nullableHash(task.requestHash); nullableHash(task.artifactHash) })
  array(value.requests, 9); value.requests.forEach(row => { creativeRecord(row, ['id', 'requestHash', 'phaseHash', 'phaseRevision']); creativeId(row.id); creativeHash(row.requestHash); creativeHash(row.phaseHash); creativeInteger(row.phaseRevision, 4) })
  creativeAssert(new Set(value.requests.map(r => r.id)).size === value.requests.length)
  budget(value.budget); creativeRecord(value.metadata, ['createUsed', 'replacementUsed', 'recoveryUsed', 'cancelUsed'])
  creativeAssert(value.metadata.createUsed === true && typeof value.metadata.replacementUsed === 'boolean' && typeof value.metadata.cancelUsed === 'boolean'); creativeInteger(value.metadata.recoveryUsed, 3)
  creativeAssert(value.budget.activeMs === value.budget.attempts * 60000 + (1 + Number(value.metadata.replacementUsed) + value.metadata.recoveryUsed + Number(value.metadata.cancelUsed)) * 10000)
  validateCampaignStorage(value.storage); creativeAssert(value.storage.openAllocations.length <= 1)
  creativeInteger(value.bodyCharacters, 3072); creativeInteger(value.lastWallTime)
  return hashed(value, CREATIVE_DOMAIN.checkpoint)
}
export async function validateCreativeReceipt(value: CreativeReceipt): Promise<CreativeReceipt> {
  creativeRecord(value, ['schemaVersion', 'protocolVersion', 'campaignId', 'manifestHash', 'operationId', 'kind', 'businessDigest', 'sequence', 'previousHash', 'checkpointHash', 'event', 'metadataSlot', 'serializedBytes', 'storageEffect', 'hash'])
  choice(value.schemaVersion, [4]); choice(value.protocolVersion, ['creative-pilot-receipt-v4']); creativeId(value.campaignId); creativeHash(value.manifestHash); creativeId(value.operationId)
  choice(value.kind, ['create', 'replace_brief', 'reserve', 'dispatch_intent', 'outcome_unknown', 'retain_response', 'resolve', 'cancel']); creativeHash(value.businessDigest); creativeInteger(value.sequence, 47)
  nullableHash(value.previousHash); creativeAssert((value.sequence === 0) === (value.previousHash === null)); creativeHash(value.checkpointHash)
  creativeRecord(value.event, ['candidateHash', 'requestHash', 'phaseHash', 'responseHash', 'artifactHash']); Object.values(value.event).forEach(nullableHash)
  choice(value.metadataSlot, [null, 'create', 'replacement', 'recovery', 'cancel']); decodeStorageBytes(value.serializedBytes)
  creativeRecord(value.storageEffect, ['source', 'requestId', 'allocatedBytes', 'consumedBytes', 'releasedBytes']); choice(value.storageEffect.source, ['direct', 'request', 'recovery'])
  if (value.storageEffect.requestId !== null) creativeId(value.storageEffect.requestId)
  for (const key of ['allocatedBytes', 'consumedBytes', 'releasedBytes'] as const) decodeStorageBytes(value.storageEffect[key])
  return hashed(value, CREATIVE_DOMAIN.receipt)
}
