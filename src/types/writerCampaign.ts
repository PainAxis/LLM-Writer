/** Version two separates cumulative writes from unresolved storage obligations. */
import type { CampaignSnapshot as LegacyCampaignSnapshot } from '../services/writerCampaign/legacyTypes'
export type { LegacyCampaignSnapshot }
export type CampaignInspection = CampaignSnapshot | LegacyCampaignSnapshot

/** Canonical wire representation; use protocol helpers for all arithmetic. */
export type StorageBytes16 = string & { readonly __storageBytes16: unique symbol }
export interface CampaignStoragePolicy { limitBytes: StorageBytes16; recoveryReserveBytes: StorageBytes16 }
export interface CampaignOpenAllocation { request: CampaignRequestRef; remainingBytes: StorageBytes16 }
export interface CampaignStorageState {
  writtenBytes: StorageBytes16
  allocatedBytes: StorageBytes16
  allocationConsumedBytes: StorageBytes16
  releasedBytes: StorageBytes16
  outstandingBytes: StorageBytes16
  recoveryRemainingBytes: StorageBytes16
  openAllocations: CampaignOpenAllocation[]
}
export interface CampaignStorageEffect {
  source: 'request' | 'recovery' | 'direct'
  requestId: string | null
  allocatedBytes: StorageBytes16
  releasedBytes: StorageBytes16
  remainingBytes: StorageBytes16
}
export type CampaignTaskKind = 'outline' | 'character_bible' | 'detailed_outline' | 'chapter_outline' | 'chapter_body'
export type CampaignStatus = 'prepared' | 'running' | 'paused' | 'blocked' | 'cancelled' | 'completed'
export type CampaignTaskStatus = 'pending' | 'reserved' | 'dispatch_intent' | 'response_retained' | 'committed' | 'known_failed' | 'outcome_unknown' | 'invalidated'
export type CampaignOperationKind = 'create' | 'start' | 'reserve' | 'dispatch_intent' | 'retain_response' | 'accept_artifact' | 'pause' | 'resume' | 'cancel' | 'reconcile' | 'replace_candidate' | 'block'
export type CampaignHash = string

export interface CampaignTaskSpec {
  id: string
  kind: CampaignTaskKind
  chapterOrdinal: number | null
  dependsOn: string[]
}

/** Cumulative ceilings, not bills. Unknown dispatch reservations are never refunded. */
export interface CampaignBudget {
  attempts: number
  inputBytes: number
  inputUtf16: number
  outputTokens: number
  reasoningTokens: number
  responseBytes: number
  activeMs: number
  artifacts: number
  operations: number
}

export interface CampaignManifest {
  schemaVersion: 2
  protocolVersion: 'campaign-v2'
  campaignId: string
  candidateId: string
  language: 'zh' | 'en'
  bodyTarget: { unit: 'unicode_scalar'; characters: number }
  mode: 'offline_fixture'
  adapterId: 'offline-fixture-v1'
  fixtureVersion: string
  countingVersion: 'crlf-lf-nfc-scalar-v1'
  runtimeIdentity: string
  source: { commit: string | null; tree: string | null }
  createdAt: number
  expiresAt: number
  maxRepairRounds: 0
  maxProviderRetries: 0
  tasks: CampaignTaskSpec[]
  budget: CampaignBudget
  storage: CampaignStoragePolicy
  hash: CampaignHash
}

export interface CampaignTextMetrics {
  hash: CampaignHash
  utf8Bytes: number
  utf16Units: number
  scalars: number
}
export interface CampaignArtifactRef { taskId: string; revision: number; hash: CampaignHash }
export interface CampaignRequestRef { id: string; revision: number; hash: CampaignHash }
export interface CampaignArtifact {
  schemaVersion: 2
  campaignId: string
  candidateId: string
  taskId: string
  taskRevision: number
  revision: number
  kind: CampaignTaskKind
  dependencies: CampaignArtifactRef[]
  parentHash: CampaignHash | null
  text: string
  raw: CampaignTextMetrics
  canonical: CampaignTextMetrics
  semanticStatus: 'not_reviewed'
  hash: CampaignHash
}

export interface CampaignUsage {
  provenance: 'fixture' | 'unknown' | 'unavailable' | 'estimated' | 'reported'
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
}
export interface CampaignResponse {
  requestId: string
  inputDigest: CampaignHash
  text: string
  usage: CampaignUsage
  /** Evidence was produced by a completed adapter invocation, not reconstructed from its ID. */
  evidenceId: string
}
export interface CampaignRequest {
  schemaVersion: 2
  campaignId: string
  id: string
  revision: number
  parentHash: CampaignHash | null
  taskId: string
  taskRevision: number
  candidateId: string
  adapterId: 'offline-fixture-v1'
  inputDigest: CampaignHash
  preparedInput: string
  commandId: string
  inputBytes: number
  inputUtf16: number
  status: Exclude<CampaignTaskStatus, 'pending' | 'invalidated'>
  reservation: CampaignBudget
  storageAllocationBytes: StorageBytes16
  response: CampaignResponse | null
  failureReason: string | null
  hash: CampaignHash
}
export interface CampaignTaskState {
  taskId: string
  revision: number
  status: CampaignTaskStatus
  artifact: CampaignArtifactRef | null
  priorArtifact: CampaignArtifactRef | null
  request: CampaignRequestRef | null
}
export interface CampaignState {
  status: CampaignStatus
  reason: string | null
  executionEpoch: number
  candidateId: string
  tasks: CampaignTaskState[]
  budget: CampaignBudget
  storage: CampaignStorageState
  lastWallTime: number
}
export interface CampaignCheckpoint extends CampaignState {
  schemaVersion: 2
  campaignId: string
  sequence: number
  manifestHash: CampaignHash
  previousHash: CampaignHash | null
  operationId: string
  bodyCharacters: number
  hash: CampaignHash
}
export interface CampaignHead {
  schemaVersion: 2
  campaignId: string
  sequence: number
  manifestHash: CampaignHash
  checkpointHash: CampaignHash
  executionEpoch: number
  status: CampaignStatus
  receiptId: string
}
export interface CampaignReceipt {
  schemaVersion: 2
  campaignId: string
  operationId: string
  kind: CampaignOperationKind
  businessDigest: CampaignHash
  expectedSequence: number | null
  sequence: number
  executionEpoch: number
  manifestHash: CampaignHash
  checkpointHash: CampaignHash
  artifactHashes: CampaignHash[]
  requestHashes: CampaignHash[]
  serializedBytes: StorageBytes16
  storageEffect: CampaignStorageEffect
  hash: CampaignHash
}
export interface CampaignSnapshot {
  manifest: CampaignManifest
  head: CampaignHead
  checkpoint: CampaignCheckpoint
  receipt: CampaignReceipt
  artifacts: Map<CampaignHash, CampaignArtifact>
  requests: Map<CampaignHash, CampaignRequest>
  /** Exact persisted head, including the epoch. Not reconstructible from UI state. */
  rawHead: string
}
export interface CampaignMutation {
  operationId: string
  kind: Exclude<CampaignOperationKind, 'create'>
  next: CampaignState
  artifacts?: CampaignArtifact[]
  requests?: CampaignRequest[]
}
export interface CampaignCommitResult {
  snapshot: CampaignSnapshot
  receipt: CampaignReceipt
  replayed: boolean
}
export interface CampaignRepositoryIO {
  getMany(keys: readonly string[]): Promise<Map<string, string | null>>
  compareAndSwapMany(entries: ReadonlyArray<{ key: string; expectedValue: string | null; value: string }>, canCommit?: () => boolean): Promise<boolean>
}
/** Opaque runtime capability. Only its creating repository can admit this token. */
export interface CampaignActionScope { readonly __campaignActionScope: unique symbol }
export type CampaignProofDisposalReason = 'completed' | 'capacity' | 'admission' | 'concurrent' | 'mismatch' | 'conflict' | 'error' | 'replay'
/** Source-free observations. Serialized retention is not a JavaScript heap bound. */
export interface CampaignActionProofStats {
  admittedScopes: number
  fallbackScopes: number
  disposedScopes: number
  coldReplays: number
  coldReplaysCompleted: number
  /** Completed whole-prefix observations. Records/bytes also include matched work in failed passes. */
  exactPasses: number
  exactRecords: number
  exactBytes: number
  /** Fully validated proposed transitions reaching CAS, including cold fallback and unsuccessful CAS attempts. */
  transitions: number
  retainedBytes: number
  retainedEntries: number
  peakRetainedBytes: number
  peakRetainedEntries: number
  activeRecords: number
  peakActiveRecords: number
  coldMs: number
  coldMaxMs: number
  exactMs: number
  exactMaxMs: number
  disposalReasons: Record<CampaignProofDisposalReason, number>
}
export interface CampaignRepository {
  list(): Promise<string[]>
  create(manifest: CampaignManifest, operationId: string): Promise<CampaignCommitResult>
  inspect(campaignId: string): Promise<CampaignInspection | null>
  createActionScope?(campaignId: string): CampaignActionScope
  disposeActionScope?(scope: CampaignActionScope): void
  getActionProofStats?(): CampaignActionProofStats
  read(campaignId: string, scope?: CampaignActionScope, check?: () => void): Promise<CampaignSnapshot | null>
  /** Same seeded head only. Closed/foreign scopes refuse; capacity fallback stays cold and pinned. */
  verifyWithinAction?(campaignId: string, expectedRawHead: string, scope: CampaignActionScope, check?: () => void): Promise<CampaignSnapshot>
  commit(expected: CampaignSnapshot, mutation: CampaignMutation, canCommit?: () => boolean, scope?: CampaignActionScope): Promise<CampaignCommitResult>
  getReceipt(campaignId: string, operationId: string): Promise<CampaignReceipt | null>
  getOperationArtifacts(campaignId: string, operationId: string): Promise<CampaignArtifact[] | null>
}
