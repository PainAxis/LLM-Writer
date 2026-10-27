/** Closed v4 creative-pilot contracts. Stored descriptors never grant runtime authority. */
import type { CampaignRepositoryIO, CampaignStoragePolicy, CampaignStorageState, CampaignTextMetrics, StorageBytes16 } from './writerCampaign'
import type { PlanningRecordKind, OutlinePayload, CharacterBiblePayload, ChapterOutlinePayload, ChapterAddress, ChapterEntry } from '../services/writerCampaign/planningProtocol'
import type { GlobalPlanningCanonV1 } from '../services/writerCampaign/planningCanon'
export type { CampaignTextMetrics }
declare const creativeOfflineHostBrand: unique symbol
export interface CreativeOfflineHost { readonly [creativeOfflineHostBrand]: true }
export type CreativeLanguage = 'zh' | 'en'
export type CreativeTaskId = 'outline' | 'characters' | 'details' |
  'o-1' | 'o-2' | 'o-3' | 'b-1' | 'b-2' | 'b-3'
export type CreativeStage = 'outline' | 'character_bible' | 'detailed_outline' |
  'chapter_outline' | 'chapter_body'
export type CreativePlanStage = Exclude<CreativeStage, 'chapter_body'>
export type CreativeOrdinal = 1 | 2 | 3
export interface CreativeBriefV1 {
  protocol: 'creative-brief-v1'; language: CreativeLanguage
  premise: string; constraints: string[]
}
export interface CreativeArtifactRef {
  taskId: CreativeTaskId; revision: 0; hash: string
}
export interface CreativeSourceView {
  manifest: CreativeManifest; candidate: CreativeCandidate
  checkpoint: CreativeCheckpoint
  artifacts: ReadonlyMap<string, CreativeArtifact> // keyed by artifact hash
  rawHead: string
}
export interface CreativeRecordIdentity {
  artifact: CreativeArtifactRef; recordKind: PlanningRecordKind; recordId: string
}
export interface CreativeCatalogRow { token: number; identity: CreativeRecordIdentity }
export interface CreativePreviousBody {
  source: CreativeArtifactRef; taskRevision: number
  text: string; raw: CampaignTextMetrics
}
export interface CreativeTemporalPartition {
  current: CreativeRecordIdentity[]; future: CreativeRecordIdentity[]
  past: CreativeRecordIdentity[]
}
export interface CreativeInputScope {
  planningCoverage: 'complete_available_global_stages' |
    'complete_global_canon' | 'complete_global_canon_and_selected_chapter'
  suppliedChapterOutlineOrdinals: CreativeOrdinal[]
  omittedChapterOutlineOrdinals: CreativeOrdinal[]
  realizedBodyCoverage: 'none' | 'complete_accepted_preceding_prefix'
  suppliedBodyOrdinals: CreativeOrdinal[]
  semanticCompleteness: 'not_reviewed'
  exposure: 'author_and_offline_control_writer_only'
}
export type CreativeJson = null | boolean | number | string |
  CreativeJson[] | { [key: string]: CreativeJson }
export interface CreativePlanOutputSchemaV1 {
  protocol: 'creative-plan-schema-v1'; stage: CreativePlanStage
  taskId: CreativeTaskId
  // Complete local JSON schema, all referenced definitions included; no remote $ref.
  // A source-built constant plus this task's ID namespace, never model/user supplied.
  schema: CreativeJson
}
export interface CreativePromptPayloadV1 {
  protocol: 'creative-pilot-input-v1'
  promptVersion: 'creative-pilot-prompt-v1'
  compilerVersion: 'creative-plan-compiler-v1'
  identity: { campaignId: string; manifestHash: string; candidateHash: string
    briefHash: string; taskId: CreativeTaskId; taskRevision: number
    stage: CreativeStage; chapterOrdinal: CreativeOrdinal | null
    language: CreativeLanguage }
  brief: CreativeBriefV1
  target: { chapters: 3; perChapterTargetScalars: 512
    acceptedMinScalars: 256; acceptedMaxScalars: 1024 }
  sourceRefs: CreativeArtifactRef[]
  canonBaseRoot: string | null; fullPlanRoot: string | null
  earlyPlanning: { outline: OutlinePayload | null
    characterBible: CharacterBiblePayload | null }
  globalCanon: GlobalPlanningCanonV1 | null
  selectedChapter: null | { address: ChapterAddress; entry: ChapterEntry
    outline: null | { source: CreativeArtifactRef; payload: ChapterOutlinePayload }
    applicableObligations: CreativeRecordIdentity[]
    applicableTransitions: CreativeRecordIdentity[] }
  catalog: CreativeCatalogRow[]; catalogDigest: string
  partitions: { authorOnlyFactRefs: CreativeRecordIdentity[]
    readerVisibleFactRefs: CreativeRecordIdentity[]
    characterEpistemic: CreativeTemporalPartition
    narratorClaims: CreativeTemporalPartition }
  previousBodies: CreativePreviousBody[]
  scope: CreativeInputScope
  stageInstruction: string
  outputSchema: CreativePlanOutputSchemaV1 | null
}
export interface PreparedCreativeInputV1 extends CreativePromptPayloadV1 {
  wire: { system: string; prompt: string }
  inputDigest: string; inputBytes: number; inputUtf16: number
}
export interface CreativeDispatchWire {
  wireProtocol: 'creative-pilot-http-wire-v1'
  bodyDigest: string; bodyBytes: number; bodyUtf16: number
}
export interface CreativeAdapterIdentity {
  mode: 'offline_control'; adapterId: string; adapterVersion: string
  requestedModelId: string; effectiveModelId: string
  configurationRevision: string; endpointIdentity: string
}
export type CreativeFinishReason = 'stop' | 'length' | 'content_filter' |
  'tool_calls' | 'error' | 'other' | 'unknown'
export type CreativeContentAnomaly = 'reasoning_present' | 'tool_calls_present' |
  'unexpected_content' | 'invalid_step_count' | 'invalid_content_metadata'
export interface CreativeContentEvidence {
  stepCount: number | null; anomalies: CreativeContentAnomaly[]
}
export interface CreativeUsageEvidence {
  status: 'complete' | 'partial' | 'unavailable' | 'invalid'
  provenance: 'synthetic_control'
  inputTokens: number | null; outputTokens: number | null
  reasoningTokens: number | null
}
export interface CreativeReportedModel {
  status: 'absent' | 'matched' | 'mismatch' | 'invalid'; value: string | null
}
export interface CreativeAdapterResult {
  evidenceId: string
  textJson: string; textJsonHash: string; textUtf16: number
  scalarMetrics: CampaignTextMetrics | null
  finishReason: CreativeFinishReason
  contentEvidence: CreativeContentEvidence
  usage: CreativeUsageEvidence; reportedModel: CreativeReportedModel
}
export interface CreativeGenerationAdapter {
  readonly identity: Readonly<CreativeAdapterIdentity>
  assertCurrent(): void
  invoke(input: {
    requestHash: string; wire: Readonly<{ system: string; prompt: string }>
    signal: AbortSignal
    beforeRequest: (binding: Readonly<CreativeDispatchWire>) => Promise<void>
  }): Promise<CreativeAdapterResult>
}
export type CreativeCompileRefusal = 'finish_incomplete' |
  'reported_model_absent' | 'reported_model_mismatch' | 'reported_model_invalid' |
  'reasoning_disallowed' | 'usage_invalid' | 'content_evidence_invalid' |
  'empty_output' | 'invalid_scalar' | 'raw_output_capacity' |
  'invalid_json' | 'duplicate_json_key' | 'output_schema' |
  'invalid_reference' | 'invalid_schedule' | 'planning_capacity' |
  'compiled_capacity' | 'body_length'
export interface CreativeArtifactTextV1 {
  text: string; raw: CampaignTextMetrics; canonical: CampaignTextMetrics
  catalogRoot: string; semanticStatus: 'not_reviewed'
}

export type CreativeCompileResult =
  | { outcome: 'accepted'; artifact: CreativeArtifact }
  | { outcome: 'refused'; reason: CreativeCompileRefusal }

export interface CreativeHeadCommand {
  campaignId: string; operationId: string; expectedRawHead: string
  expectedCandidateHash: string
}
export interface CreativeDryPreview {
  campaignId: string; rawHead: string; candidateHash: string
  prepared: PreparedCreativeInputV1
  adapter: Readonly<CreativeAdapterIdentity> | null
  readiness: 'unconfigured' | 'offline_control_ready'
}
export type CreativeProgressKind = 'verifying' | 'prepared' | 'reserved' |
  'dispatch_intent' | 'response_retained' | 'accepted' | 'refused' |
  'blocked' | 'stopped' | 'cancelled' | 'expired' | 'authority_revoked' | 'completed'
export interface CreativeProgressEvent {
  ownerId: number; campaignId: string; kind: CreativeProgressKind
  taskId: CreativeTaskId | null; attemptsReserved: number
  acceptedTasks: number; acceptedBodies: number
  bodyCanonicalScalars: number
}
export interface CreativePilotEngine {
  inspect(campaignId: string): Promise<CreativeSnapshot | null>
  prepare(input: { campaignId: string; operationId: string
    brief: CreativeBriefV1 }): Promise<CreativeSnapshot>
  dryPrepare(campaignId: string): Promise<CreativeDryPreview>
  replaceBrief(input: CreativeHeadCommand & {
    brief: CreativeBriefV1 }): Promise<CreativeSnapshot>
  start(input: CreativeHeadCommand): Promise<CreativeSnapshot>
  resume(input: CreativeHeadCommand): Promise<CreativeSnapshot>
  resolveRetained(input: CreativeHeadCommand & {
    requestHash: string
    disposition: 'publish_if_valid' | 'accounting_only' }): Promise<CreativeSnapshot>
  cancel(input: CreativeHeadCommand): Promise<CreativeSnapshot>
  stop(campaignId?: string): void
  subscribeProgress(listener: (event: Readonly<CreativeProgressEvent>) => void):
    () => void
  dispose(): void
}

export type CreativeResolutionReason = CreativeCompileRefusal | 'cancelled' | 'expired' | 'stage_expired_before_intent' | 'closed_before_intent' | 'authority_revoked'
export type CreativeUnknownReason = 'interrupted' | 'deadline' | 'transport_unknown' | 'ack_uncertain'
export type CreativeErrorCode = 'unsupported_schema' | 'integrity' | 'conflict' | 'operation_conflict' | 'budget' | 'storage_unknown' | 'cancelled' | 'deadline_exceeded' | 'operation_timeout' | 'unconfigured' | 'configuration_changed' | 'authority_revoked' | 'expired' | 'clock_rollback' | 'context_capacity' | 'source_changed' | 'input_invalid' | 'transport_wire_invalid' | 'retention_capacity' | 'unknown_outcome' | 'attempt_spent' | 'replacement_after_reservation' | 'already_terminal' | 'metadata_capacity'
export interface CreativePolicy {
  protocol: 'creative-pilot-policy-v1'; mode: 'sdk_offline_readiness'; transportPolicy: 'creative-pilot-sdk-v1'
  inputTokenEnforcement: 'not_enforced_offline_control'; retention: 'local_campaign_lifetime_no_automatic_deletion'
}
export interface CreativeTaskSpec { id: CreativeTaskId; kind: CreativeStage; chapterOrdinal: CreativeOrdinal | null; dependsOn: CreativeTaskId[] }
export interface CreativeBudget {
  attempts: number; inputBytes: number; inputUtf16: number; inputTokens: null; outputTokens: number; reasoningTokens: number
  responseBytes: number; activeMs: number; artifacts: number; operations: number
}
export interface CreativeRuntimeIdentity { runtimeIdentity: string; source: { commit: string | null; tree: string | null } }
export interface CreativeManifest extends CreativeRuntimeIdentity {
  schemaVersion: 4; protocolVersion: 'creative-pilot-v4'; campaignId: string; language: CreativeLanguage
  initialCandidateHash: string; taskGraphVersion: 'creative-three-chapter-v1'; tasks: CreativeTaskSpec[]
  compilerVersion: 'creative-plan-compiler-v1'; promptVersion: 'creative-pilot-prompt-v1'; countingVersion: 'crlf-lf-nfc-scalar-v1'
  policy: CreativePolicy; budget: CreativeBudget; storage: CampaignStoragePolicy; createdAt: number; expiresAt: number; hash: string
}
export interface CreativeCandidate {
  schemaVersion: 1; protocol: 'creative-pilot-candidate-v1'; campaignId: string; id: string; revision: 0 | 1; parentHash: string | null
  brief: CreativeBriefV1; briefHash: string; createdAt: number; hash: string
}
export type CreativeStatus = 'prepared' | 'running' | 'blocked' | 'completed' | 'cancelled'
export type CreativeTaskStatus = 'pending' | 'reserved' | 'dispatch_intent' | 'outcome_unknown' | 'response_retained' | 'accepted' | 'refused' | 'not_dispatched' | 'authority_revoked'
export interface CreativeTaskState { taskId: CreativeTaskId; revision: number; status: CreativeTaskStatus; requestHash: string | null; artifactHash: string | null }
export interface CreativeRequestIndex { id: string; requestHash: string; phaseHash: string; phaseRevision: number }
export interface CreativeMetadata { createUsed: boolean; replacementUsed: boolean; recoveryUsed: number; cancelUsed: boolean }
export interface CreativeHead {
  schemaVersion: 4; protocolVersion: 'creative-pilot-head-v4'; campaignId: string; manifestHash: string; sequence: number
  checkpointHash: string; receiptId: string; candidateHash: string; executionEpoch: number; status: CreativeStatus
}
export interface CreativeCheckpoint {
  schemaVersion: 4; protocolVersion: 'creative-pilot-checkpoint-v4'; campaignId: string; manifestHash: string; sequence: number
  previousHash: string | null; operationId: string; candidateHash: string; adapter: CreativeAdapterIdentity | null; executionEpoch: number
  status: CreativeStatus; reason: CreativeResolutionReason | CreativeUnknownReason | null; tasks: CreativeTaskState[]; requests: CreativeRequestIndex[]
  budget: CreativeBudget; metadata: CreativeMetadata; storage: CampaignStorageState; bodyCharacters: number; lastWallTime: number; hash: string
}
export type CreativeOperationKind = 'create' | 'replace_brief' | 'reserve' | 'dispatch_intent' | 'outcome_unknown' | 'retain_response' | 'resolve' | 'cancel'
export interface CreativeEvent { candidateHash: string | null; requestHash: string | null; phaseHash: string | null; responseHash: string | null; artifactHash: string | null }
export interface CreativeStorageEffect { source: 'direct' | 'request' | 'recovery'; requestId: string | null; allocatedBytes: StorageBytes16; consumedBytes: StorageBytes16; releasedBytes: StorageBytes16 }
export interface CreativeReceipt {
  schemaVersion: 4; protocolVersion: 'creative-pilot-receipt-v4'; campaignId: string; manifestHash: string; operationId: string; kind: CreativeOperationKind
  businessDigest: string; sequence: number; previousHash: string | null; checkpointHash: string; event: CreativeEvent
  metadataSlot: null | 'create' | 'replacement' | 'recovery' | 'cancel'; serializedBytes: StorageBytes16; storageEffect: CreativeStorageEffect; hash: string
}
export interface CreativeRequest {
  schemaVersion: 1; protocol: 'creative-pilot-request-v1'; campaignId: string; id: string; operationId: string; manifestHash: string; candidateHash: string
  taskId: CreativeTaskId; taskRevision: number; dependencies: CreativeArtifactRef[]; prepared: PreparedCreativeInputV1; adapter: CreativeAdapterIdentity
  invocationId: string; reservation: CreativeBudget; createdAt: number; expiresAt: number; storageAllocationBytes: StorageBytes16; hash: string
}
export type CreativePhaseStatus = 'reserved' | 'dispatch_intent' | 'outcome_unknown' | 'response_retained' | 'resolved'
export type CreativeResolutionOutcome = 'accepted' | 'refused' | 'not_dispatched' | 'authority_revoked'
export interface CreativePhase {
  schemaVersion: 1; protocol: 'creative-pilot-phase-v1'; campaignId: string; requestHash: string; revision: number; parentHash: string | null
  status: CreativePhaseStatus; intentHash: string | null; dispatchWire: CreativeDispatchWire | null; responseHash: string | null
  resolution: null | { outcome: CreativeResolutionOutcome; reason: CreativeResolutionReason | null; artifactHash: string | null }
  reason: CreativeUnknownReason | null; hash: string
}
export interface CreativeResponse extends CreativeAdapterResult {
  schemaVersion: 1; protocol: 'creative-pilot-response-v1'; campaignId: string; requestHash: string; intentHash: string; hash: string
}
export interface CreativeArtifact extends CreativeArtifactTextV1 {
  schemaVersion: 1; protocol: 'creative-pilot-artifact-v1'; campaignId: string; candidateHash: string; taskId: CreativeTaskId
  taskRevision: number; revision: 0; kind: CreativeStage; dependencies: CreativeArtifactRef[]; requestHash: string; responseHash: string
  compilerVersion: 'creative-plan-compiler-v1'; promptVersion: 'creative-pilot-prompt-v1'; hash: string
}
export interface CreativeSnapshot extends CreativeSourceView {
  head: CreativeHead; receipt: CreativeReceipt
  requests: Map<string, CreativeRequest>; phases: Map<string, CreativePhase>; responses: Map<string, CreativeResponse>
}
export interface CreativeCommitGuard { canCommit(): boolean; canPublish(): boolean }
export interface CreateCreativeCommand { campaignId: string; operationId: string; brief: CreativeBriefV1; identity: CreativeRuntimeIdentity }
export interface ReplaceCreativeBriefCommand { operationId: string; brief: CreativeBriefV1 }
export type CreativeMutation = { operationId: string; recovery: boolean } & (
  | { kind: 'reserve'; request: CreativeRequest }
  | { kind: 'dispatch_intent'; requestHash: string; dispatchWire: CreativeDispatchWire }
  | { kind: 'outcome_unknown'; requestHash: string; reason: CreativeUnknownReason }
  | { kind: 'retain_response'; requestHash: string; response: CreativeResponse }
  | { kind: 'resolve'; requestHash: string; disposition: 'publish_if_valid' | 'accounting_only' }
  | { kind: 'cancel' }
)
export interface CreativeCommitResult { snapshot: CreativeSnapshot; receipt: CreativeReceipt; replayed: boolean }
export interface CreativeRepository {
  read(id: string, check?: () => void): Promise<CreativeSnapshot | null>
  create(command: CreateCreativeCommand, guard: CreativeCommitGuard): Promise<CreativeCommitResult>
  replaceBrief(expected: CreativeSnapshot, command: ReplaceCreativeBriefCommand, guard: CreativeCommitGuard): Promise<CreativeCommitResult>
  commit(expected: CreativeSnapshot, mutation: CreativeMutation, guard: CreativeCommitGuard): Promise<CreativeCommitResult>
  getReceipt(id: string, operationId: string, check?: () => void): Promise<CreativeReceipt | null>
}
export interface CreativeRepositoryOptions { io?: CampaignRepositoryIO; clock?: () => number; monotonic?: () => number }
