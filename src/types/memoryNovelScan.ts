import type { FactAnchor, FactEntity } from './factGraph'
import type { MemoryIndexStats, MemoryProjectInput } from './memory'

export interface NovelScanIdentity { campaignId: string; segmentId: string; generation: number }
export interface NovelScanAllocation {
  attempts: number; activeMs: number; inputChars: number; inputBytes: number; outputTokens: number; responseBytes: number
}
export const NOVEL_SCAN_DEFAULT_ALLOCATION: Readonly<NovelScanAllocation> = Object.freeze({
  attempts: 64, activeMs: 65_000, inputChars: 1_024_000, inputBytes: 3_072_000, outputTokens: 76_800, responseBytes: 4_194_304,
})
export const NOVEL_SCAN_HARD_ALLOCATION: Readonly<NovelScanAllocation> = Object.freeze({
  attempts: 4_096, activeMs: 3_600_000, inputChars: 65_536_000, inputBytes: 196_608_000, outputTokens: 4_915_200, responseBytes: 268_435_456,
})
export const NOVEL_SCAN_LIMITS = Object.freeze({
  atomChars: 1_000, primaryAtoms: 6, sourceChars: 8_000, inputChars: 16_000, inputBytes: 48_000,
  outputTokens: 1_200 as const, responseBytes: 65_536, providerMs: 30_000, guardMs: 10_000,
  prepareMs: 10_000, readyMs: 300_000, campaignMs: 3_600_000,
  cues: 2_048, maxCues: 8_192, indexCues: 8_192, indexBytes: 16 * 1024 * 1024,
  candidates: 512, candidateBytes: 8 * 1024 * 1024, plannedJobs: 65_536, pagePlanningSteps: 256,
})
export type NovelScanPhase = 'collect' | 'connect'
export type NovelScanState = 'ready_a' | 'running_a' | 'ready_b' | 'running_b' | 'paused'
  | 'reviewing_partial' | 'reviewing_complete_for_contract' | 'cancelled' | 'expired' | 'invalidated' | 'closed'
export type NovelScanReason = 'user' | 'budget' | 'provider' | 'invalid_response' | 'response_capacity'
  | 'cue_capacity' | 'index_capacity' | 'review_capacity' | 'planning_capacity' | 'context_overflow'
  | 'source_changed' | 'graph_changed' | 'owner_changed' | 'configuration_changed' | 'guard_timeout'
  | 'cancelled' | 'expired' | 'invalid_input' | 'stale_handle' | 'invalid_decision' | 'output_incomplete'
export interface NovelScanInput {
  project: MemoryProjectInput; stats: MemoryIndexStats; throughChapterId: string; graphRevision: string | null
  allocation?: NovelScanAllocation; cueCapacity?: number; signal?: AbortSignal
  assertOwner(): void
  /** Must re-read committed project + graph; throw on any change other than expected graph revision. */
  /** Check operationSignal after every await and before starting another committed read. */
  assertFresh(expectedGraphRevision: string | null, operationSignal?: AbortSignal): Promise<void>
}
export interface NovelScanGrant extends NovelScanIdentity { grantId: string; add: NovelScanAllocation }
export type NovelScanDecision =
  | { type: 'pause' | 'cancel' | 'continue' | 'finish-partial' }
  | { type: 'retry' | 'skip'; failedJobId: string }
  | { type: 'extend'; grant: NovelScanGrant }
  | { type: 'extend-cue-capacity'; newCapacity: number }
  | { type: 'skip-index-remainder' }
  | { type: 'ignore'; candidateId: string }
export interface NovelScanLedger {
  authorized: NovelScanAllocation; used: NovelScanAllocation
  observedResponseBytes: number; attemptedSourceChars: number; guardMs: number; providerMs: number
  /** Separate local phases; not additional scan processing authorization. */
  preparationMs: number; reviewMs: number
}
export interface NovelScanChapterCoverage {
  chapterId: string; title: string; revision: string; eligibleChars: number; processedChars: number
  remainingChars: number; skippedChars: number; failedChars: number; empty: boolean
}
export interface NovelScanMiss {
  scope: 'source' | 'connection' | 'representation'; reason: string; knownCount: number; lowerBound: boolean
  segmentId?: string
  source?: { chapterId: string; revision: string; start: number; end: number; firstWindow: number; lastWindow: number }
  job?: { id: string; route: 'singleton' | 'adjacent' | 'shared_key' | 'bridge'; atomIds: number[] }
}
export interface NovelScanProgress {
  eligibleChars: number; processedChars: number; remainingChars: number; skippedChars: number; failedChars: number
  eligibleWindows: number; processedWindows: number; skippedWindows: number; failedWindows: number
  sourceCoverage: 'complete' | 'incomplete'; connectionCoverage: 'complete_for_contract' | 'incomplete'
  representationLimited: boolean; crossSegmentGap: boolean; indexCueCount: number; segmentCueCount: number
  candidateCount: number; jobsPlanned: number; jobsProcessed: number; jobsSkipped: number; jobsFailed: number
  /** Cumulative unique singleton anchor sets; a strict lower bound, never the remaining/total job count. */
  minimumConnectionCalls: number
  planningComplete: boolean; routeCounts: { singleton: number; adjacent: number; shared_key: number; bridge: number }
  /** At most 128 exact range entries plus three scope-specific overflow lower-bound entries; never source text. */
  misses: NovelScanMiss[]
  ledger: NovelScanLedger; expiresAt: number
}
export interface NovelScanPreview extends NovelScanIdentity {
  projectId: string; throughChapterId: string; chapterCount: number; eligibleChars: number; windows: number
  providerLabel: string; modelId: string; endpointLabel: string; readyExpiresAt: number; expiresAt: number
  allocation: NovelScanAllocation; cueCapacity: number; bounds: typeof NOVEL_SCAN_LIMITS
}
export interface NovelScanCandidateBase extends NovelScanIdentity {
  id: string; jobId: string; projectId: string; createdBy: 'model'; authorConfirmed: false
  semanticValidation: 'protocol-and-current-sources'
}
export interface NovelScanRelationshipCandidate extends NovelScanCandidateBase {
  kind: 'relationship'; source: FactEntity; target: FactEntity; predicate: string; origin: 'explicit' | 'inferred'
  evidence: FactAnchor[]
}
export interface NovelScanPlotCandidate extends NovelScanCandidateBase {
  kind: 'foreshadowing'; mode: 'setup_candidate' | 'possible_recovery'; title: string; explanation: string
  origin: 'inferred'; premises: Array<{ role: 'setup' | 'recovery' | 'context'; evidence: FactAnchor[] }>
}
export type NovelScanCandidate = NovelScanRelationshipCandidate | NovelScanPlotCandidate
export interface NovelScanPage extends NovelScanIdentity {
  state: NovelScanState; phase: NovelScanPhase; reason?: NovelScanReason; failedJobId?: string
  progress: NovelScanProgress
  /** Present only after terminal scan and successful publication guard. Bounded to 512. */
  candidates?: NovelScanCandidate[]
}
export interface NovelScanGenerationRequest {
  phase: NovelScanPhase; system: string; prompt: string; signal: AbortSignal
  beforeRequest(): Promise<void>; maxOutputTokens: 1200; timeoutMs: number
}
export type NovelScanGenerator = (request: NovelScanGenerationRequest) => Promise<string>
export interface PreparedNovelScan {
  readonly preview: NovelScanPreview
  startA(handle: NovelScanIdentity, generator?: NovelScanGenerator): Promise<NovelScanPage>
  startB(handle: NovelScanIdentity, generator?: NovelScanGenerator): Promise<NovelScanPage>
  advance(handle: NovelScanIdentity): Promise<NovelScanPage>
  decide(handle: NovelScanIdentity, decision: NovelScanDecision): Promise<NovelScanPage>
  /** Zero transport. Previous review candidates must all have been saved or explicitly ignored. */
  nextSegment(handle: NovelScanIdentity, input: NovelScanInput | ((signal: AbortSignal) => Promise<NovelScanInput>)): Promise<NovelScanPage>
  /** Review guard is local and bounded; never dispatches provider calls. */
  reviewCandidate(handle: NovelScanIdentity, candidateId: string): Promise<NovelScanCandidate | null>
  /** Only an actual successful CAS, using the passed previous revision, may advance the review baseline. */
  notifyAccepted(handle: NovelScanIdentity, candidateId: string, previousRevision: string | null, actualRevision: string): Promise<NovelScanPage>
  chapterCoverage(offset?: number, limit?: number): NovelScanChapterCoverage[]
  audit(handle: NovelScanIdentity): Promise<NovelScanPage>
  snapshot(): NovelScanPage
  cancel(): void
}
