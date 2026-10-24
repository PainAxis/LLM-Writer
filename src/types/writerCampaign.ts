/** Version one is an offline durability protocol, not a long-form quality verdict. */
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
  serializedBytes: number
  storageReservedBytes: number
  artifacts: number
  operations: number
}

export interface CampaignManifest {
  schemaVersion: 1
  protocolVersion: 'campaign-v1'
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
  /** Reserved subset of serializedBytes available only to bounded recovery/terminal commits. */
  recoveryReserveBytes: number
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
  schemaVersion: 1
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
  schemaVersion: 1
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
  lastWallTime: number
}
export interface CampaignCheckpoint extends CampaignState {
  schemaVersion: 1
  campaignId: string
  sequence: number
  manifestHash: CampaignHash
  previousHash: CampaignHash | null
  operationId: string
  bodyCharacters: number
  hash: CampaignHash
}
export interface CampaignHead {
  schemaVersion: 1
  campaignId: string
  sequence: number
  manifestHash: CampaignHash
  checkpointHash: CampaignHash
  executionEpoch: number
  status: CampaignStatus
  receiptId: string
}
export interface CampaignReceipt {
  schemaVersion: 1
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
  serializedBytes: number
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
export interface CampaignRepository {
  list(): Promise<string[]>
  create(manifest: CampaignManifest, operationId: string): Promise<CampaignCommitResult>
  read(campaignId: string): Promise<CampaignSnapshot | null>
  commit(expected: CampaignSnapshot, mutation: CampaignMutation, canCommit?: () => boolean): Promise<CampaignCommitResult>
  getReceipt(campaignId: string, operationId: string): Promise<CampaignReceipt | null>
  getOperationArtifacts(campaignId: string, operationId: string): Promise<CampaignArtifact[] | null>
}
