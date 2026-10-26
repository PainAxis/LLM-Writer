/** Explicit offline-readiness records. Stored values never grant transport authority. */
import type { ProducerVerificationContext, ProducerVerificationProgress, ProducerVerificationStats } from '../services/writerCampaign/verificationTypes'
import type { CampaignActionProofStats, CampaignArtifact, CampaignArtifactRef, CampaignBudget, CampaignRepositoryIO, CampaignSnapshot, CampaignStorageState, CampaignTaskState } from './writerCampaign'
import type { BodyEvidenceSourceView } from '../services/writerCampaign/bodyEvidence'
import type { PlanningRecordIdentity } from '../services/writerCampaign/bodyEvidenceProtocol'
import type { PlanningRecordValue } from '../services/writerCampaign/planningProtocol'
import type { CompiledProducedBodyEvidence } from '../services/writerCampaign/bodyProducerEvidence'
export type { ProducerVerificationContext, ProducerVerificationProgress, ProducerVerificationStats } from '../services/writerCampaign/verificationTypes'

export interface BodyProducerIdentity {
  adapterId: string
  adapterVersion: string
  mode: 'offline_control' | 'live'
  requestedModelId: string
  effectiveModelId: string
  configurationRevision: string
  endpointIdentity: string
}
export interface BodyProducerSelection {
  chapterOrdinal: number
  startUtf16: number
  endUtf16: number
  planningRefs: PlanningRecordIdentity[]
}
export interface PreparedBodyProducerInput {
  protocol: 'body-producer-input-v1'
  language: 'zh' | 'en'
  source: {
    campaignId: string; currentCandidateId: string; manifestHash: string
    canonBaseRoot: string; fullPlanRoot: string; bodyPrefixRoot: string; throughChapterOrdinal: number
    artifact: CampaignArtifactRef; taskRevision: number; artifactCandidateId: string
    rawBodyHash: string; rawUtf16Units: number; rawUtf8Bytes: number; rawScalars: number
  }
  window: { startUtf16: number; endUtf16: number; text: string }
  catalog: Array<{ token: number; identity: PlanningRecordIdentity; value: PlanningRecordValue }>
  wire: { system: string; prompt: string }
  inputDigest: string
  inputBytes: number
  inputUtf16: number
}
export interface BodyProducerUsage {
  provenance: 'synthetic_control' | 'reported' | 'estimated' | 'unavailable'
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
}
export interface BodyProducerRequest {
  schemaVersion: 1; protocol: 'body-producer-request-v1'
  campaignId: string; id: string; operationId: string
  aggregateManifestHash: string; sourceEpoch: number
  prepared: PreparedBodyProducerInput; producer: BodyProducerIdentity
  reservation: CampaignBudget; createdAt: number; expiresAt: number; hash: string
}
export interface BodyProducerResponse {
  schemaVersion: 1; protocol: 'body-producer-response-v1'
  campaignId: string; requestId: string; requestHash: string; intentHash: string
  evidenceId: string; text: string; textHash: string; bytes: number
  usage: BodyProducerUsage; reportedModelId: string | null; hash: string
}
export interface BodyProducerCompileBinding {
  requestId: string; requestHash: string; responseHash: string; intentHash: string
  aggregateManifestHash: string; sourceEpoch: number
  producer: BodyProducerIdentity; reportedModelId: string | null
}
export interface BodyProducerReview {
  schemaVersion: 1; protocol: 'body-producer-review-v1'
  campaignId: string; requestId: string; requestHash: string; responseHash: string
  result: CompiledProducedBodyEvidence; hash: string
}
export type BodyProducerPhaseStatus = 'reserved' | 'dispatch_intent' | 'outcome_unknown' | 'response_retained' | 'resolved'
export interface BodyProducerPhase {
  schemaVersion: 1; protocol: 'body-producer-phase-v1'
  campaignId: string; requestId: string; requestHash: string; revision: number; parentHash: string | null
  status: BodyProducerPhaseStatus; intentHash: string | null; responseHash: string | null
  resolution: { outcome: 'review_ready' | 'refused' | 'not_dispatched'; reason: string | null; reviewHash: string | null } | null
  reason: string | null; hash: string
}
export interface ProducerPolicy {
  protocol: 'body-producer-policy-v1'
  requestLimit: 8; openLimit: 1; liveEnabled: false
  retention: 'local_campaign_lifetime_no_automatic_deletion'
}
export interface ProducerCampaignManifest {
  schemaVersion: 3; protocolVersion: 'campaign-v3'
  campaignId: string; adoptedRawHead: string; adoptedManifestHash: string
  runtimeIdentity: string; source: { commit: string | null; tree: string | null }
  createdAt: number; expiresAt: number; policy: ProducerPolicy; hash: string
}
export interface ProducerRequestIndex {
  id: string; requestHash: string; phaseHash: string; phaseRevision: number
}
export interface ProducerCampaignCheckpoint {
  schemaVersion: 3; protocolVersion: 'campaign-v3-checkpoint'
  campaignId: string; manifestHash: string; sequence: number; previousHash: string | null; operationId: string
  status: 'active' | 'cancelled'; executionEpoch: number; sourceEpoch: number; candidateId: string
  tasks: CampaignTaskState[]; bodyCharacters: number; producerRequests: ProducerRequestIndex[]
  budget: CampaignBudget; storage: CampaignStorageState; lastWallTime: number; hash: string
}
export interface ProducerCampaignHead {
  schemaVersion: 3; protocolVersion: 'campaign-v3-head'
  campaignId: string; manifestHash: string; sequence: number; checkpointHash: string
  receiptId: string; executionEpoch: number; status: 'active' | 'cancelled'
}
export type ProducerOperationKind = 'adopt' | 'body_revision' | 'reserve' | 'dispatch_intent' | 'outcome_unknown' | 'retain_response' | 'resolve' | 'cancel'
export interface ProducerCampaignReceipt {
  schemaVersion: 3; protocolVersion: 'campaign-v3-receipt'
  campaignId: string; operationId: string; kind: ProducerOperationKind; businessDigest: string; recovery: boolean
  sequence: number; previousHash: string | null; checkpointHash: string; manifestHash: string
  event: ProducerEvent; serializedBytes: string
  storageEffect: { allocatedBytes: string; consumedBytes: string; releasedBytes: string; source: 'direct' | 'request' | 'recovery'; requestId: string | null }
  hash: string
}
/** Hash references only; replay loads and validates every referenced immutable record. */
export interface ProducerEvent {
  requestHash: string | null; phaseHash: string | null; responseHash: string | null; reviewHash: string | null
  artifact: CampaignArtifactRef | null
}
export interface ProducerCampaignSnapshot {
  manifest: ProducerCampaignManifest; head: ProducerCampaignHead; checkpoint: ProducerCampaignCheckpoint; receipt: ProducerCampaignReceipt
  origin: CampaignSnapshot; source: BodyEvidenceSourceView
  requests: Map<string, BodyProducerRequest>; phases: Map<string, BodyProducerPhase>
  responses: Map<string, BodyProducerResponse>; reviews: Map<string, BodyProducerReview>
  artifacts: Map<string, CampaignArtifact>; rawHead: string
}
export type ProducerMutation = { operationId: string; recovery?: true } & (
  | { kind: 'body_revision'; chapterOrdinal: number; text: string }
  | { kind: 'reserve'; request: BodyProducerRequest }
  | { kind: 'dispatch_intent'; requestId: string }
  | { kind: 'outcome_unknown'; requestId: string; reason: string }
  | { kind: 'retain_response'; requestId: string; response: BodyProducerResponse }
  | { kind: 'resolve'; requestId: string; outcome: 'review_ready' | 'refused' | 'not_dispatched'; reason: string | null; review?: BodyProducerReview }
  | { kind: 'cancel' }
)
export interface ProducerCommitResult { snapshot: ProducerCampaignSnapshot; receipt: ProducerCampaignReceipt; replayed: boolean }
declare const producerActionScope: unique symbol
/** Runtime-only verification lifetime; never persisted or accepted as dispatch authority. */
export interface ProducerActionScope { readonly [producerActionScope]: true }
/** No replay to subscribers and no source/partial snapshot in progress events. */
export interface BodyProducerVerificationEvent {
  ownerId: number
  campaignId: string
  status: 'started' | 'progress' | 'completed' | 'failed' | 'cancelled'
  progress: ProducerVerificationProgress | null
}
/** Terminal owner outcomes are disjoint. An internal IO timeout wrapped as
 * storage_unknown may be refused rather than expired; raw IO/CAS gates remain
 * independent and zero ownersExpired never proves there were no IO deadlines. */
export interface BodyProducerExecutionStats {
  protocol: 'producer-execution-owner-v1'
  metadataOwnersStarted: number
  invocationOwnersStarted: number
  ownersCompleted: number
  ownersRefused: number
  ownersCancelled: number
  ownersExpired: number
  activeOwners: number
  peakActiveOwners: number
  maxMetadataOwnerMs: number
  maxInvocationOwnerMs: number
  deadlineRefusals: number
  lateResultRefusals: number
}
export interface ProducerCampaignRepository {
  createActionScope?(campaignId: string): ProducerActionScope
  disposeActionScope?(scope: ProducerActionScope): void
  getActionProofStats?(): CampaignActionProofStats
  getVerificationStats?(): ProducerVerificationStats
  verifyCurrent?(campaignId: string, context: ProducerVerificationContext, scope: ProducerActionScope): Promise<ProducerCampaignSnapshot | null>
  adoptVerified?(campaignId: string, operationId: string, identity: { runtimeIdentity: string; source: { commit: string | null; tree: string | null } }, context: ProducerVerificationContext, scope: ProducerActionScope): Promise<ProducerCommitResult>
  read(campaignId: string, check?: () => void, scope?: ProducerActionScope): Promise<ProducerCampaignSnapshot | null>
  adopt(campaignId: string, operationId: string, identity: { runtimeIdentity: string; source: { commit: string | null; tree: string | null } }, canCommit?: () => boolean): Promise<ProducerCommitResult>
  commit(expected: ProducerCampaignSnapshot, mutation: ProducerMutation, canCommit?: () => boolean, scope?: ProducerActionScope): Promise<ProducerCommitResult>
  getReceipt(campaignId: string, operationId: string, check?: () => void, scope?: ProducerActionScope): Promise<ProducerCampaignReceipt | null>
}
export interface ProducerRepositoryOptions { io?: CampaignRepositoryIO; clock?: () => number }
export interface BodyProducerAdapterResult {
  text: string; evidenceId: string; usage: BodyProducerUsage; reportedModelId: string | null
}
export interface BodyProducerAdapter {
  readonly identity: BodyProducerIdentity
  /** Revalidates opaque config binding; no new capability is acquired by this check. */
  assertCurrent(): void
  invoke(input: { wire: PreparedBodyProducerInput['wire']; signal: AbortSignal; beforeRequest(): Promise<void> }): Promise<BodyProducerAdapterResult>
}
export interface PreparedBodyProducerHandle {
  id: string; campaignId: string; sourceEpoch: number; aggregateManifestHash: string
  producer: BodyProducerIdentity; prepared: PreparedBodyProducerInput; reservation: CampaignBudget
  createdAt: number; expiresAt: number; invocationAllowed: boolean
}
export interface BodyProducerEngine {
  subscribeVerification?(listener: (event: BodyProducerVerificationEvent) => void): () => void
  getExecutionStats?(): BodyProducerExecutionStats
  inspect(campaignId: string): Promise<ProducerCampaignSnapshot | null>
  adopt(campaignId: string, operationId?: string): Promise<ProducerCampaignSnapshot>
  reviseBody(campaignId: string, chapterOrdinal: number, text: string, expectedRawHead: string, operationId?: string): Promise<ProducerCampaignSnapshot>
  prepare(campaignId: string, selection: BodyProducerSelection, producerId: string): Promise<PreparedBodyProducerHandle>
  invoke(handle: PreparedBodyProducerHandle, operationId?: string): Promise<ProducerCampaignSnapshot>
  recover(campaignId: string, requestId: string, operationId?: string): Promise<ProducerCampaignSnapshot>
  cancel(campaignId: string, operationId?: string): Promise<ProducerCampaignSnapshot>
  cancelLocal(campaignId?: string): void
  availableProducers(): readonly BodyProducerIdentity[]
}
