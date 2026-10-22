import type { FactAnchor, VisibleFactAnchor } from './factGraph'
import type { MemoryIndexStats, MemoryProjectInput } from './memory'

/** Input/cost limits only. None of these numbers measure semantic credibility. */
export const SUPPORT_CHECK_LIMITS = Object.freeze({
  questionChars: 500, anchors: 8, anchorChars: 2_000, sourceChars: 8_000,
  inputChars: 16_000, inputBytes: 48_000, outputTokens: 1_200 as const,
  responseChars: 8_000, responseBytes: 65_536,
  totalMs: 45_000, providerMs: 30_000, guardMs: 10_000, readyMs: 300_000,
  attempts: 1 as const,
})

export type SupportVerdict = 'supported' | 'insufficient' | 'uncertain'
export type SupportReason = 'direct_statement' | 'combined_premises' | 'explicit_negative'
  | 'missing_premise' | 'unrelated_sources' | 'conflicting_sources'
  | 'ambiguous_reference' | 'temporal_ambiguity' | 'inferential_gap'
export type SupportUnverifiedReason = 'disabled' | 'not_run' | 'unavailable' | 'stale' | 'invalid_input' | 'input_budget' | 'source_changed'
  | 'owner_changed' | 'configuration_changed' | 'cancelled' | 'expired' | 'timeout'
  | 'invalid_response' | 'response_too_large' | 'output_incomplete' | 'settings'
  | 'transport' | 'request_limit'

export interface SupportResponseV1 {
  version: 1
  verdict: SupportVerdict
  reason: SupportReason
  answer: string | null
  explanation: string
  premises: Array<{ text: string; references: number[] }>
  missing: string[]
}

export interface SupportCheckOwner {
  signal?: AbortSignal
  /** Synchronous current route/query/cutoff/selection/target/config-generation check. */
  assertOwner(): void
}
export interface SupportCheckInput extends SupportCheckOwner {
  question: string
  project: MemoryProjectInput
  stats: MemoryIndexStats
  throughChapterId: string
  evidence: readonly FactAnchor[]
  selectionFingerprint: string
  /** Reread committed source, graph and completed retrieval ownership. */
  assertFresh(): Promise<void>
}
export interface SupportGenerationRequest {
  system: string
  prompt: string
  signal: AbortSignal
  beforeRequest(): Promise<void>
  maxOutputTokens: 1200
}
export type SupportGenerator = (request: SupportGenerationRequest) => Promise<string>

export interface SupportCheckPreview {
  question: string
  sources: VisibleFactAnchor[]
  sourceCount: number
  sourceChars: number
  inputChars: number
  inputBytes: number
  providerLabel: string
  modelId: string
  endpointLabel: string
  expiresAt: number
  bounds: typeof SUPPORT_CHECK_LIMITS
}
interface SupportResultIdentity {
  requestId: string
  selectionFingerprint: string
  throughChapterId: string
}
export interface AssessedSupportCheck extends SupportResultIdentity {
  state: 'assessed'
  semanticOrigin: 'model'
  validation: 'protocol-and-current-sources'
  scope: 'selected-excerpts'
  manuscriptAbsenceEstablished: false
  providerLabel: string
  modelId: string
  completedAt: number
  verdict: SupportVerdict
  reason: SupportReason
  answer: string | null
  explanation: string
  premises: Array<{ text: string; citations: VisibleFactAnchor[] }>
  missing: string[]
}
export interface UnverifiedSupportCheck extends Partial<SupportResultIdentity> {
  state: 'unverified'
  /** A source guard failed or stalled; not an ordinary provider-only failure. */
  sourceValidationFailed?: true
  reason: SupportUnverifiedReason
}
export type SupportCheckResult = AssessedSupportCheck | UnverifiedSupportCheck
export interface PreparedSupportCheck {
  /** Detached presentation copy. Mutations cannot alter the private request. */
  preview: SupportCheckPreview
  /** One-use, including simultaneous and repeated invocations. */
  run(generator?: SupportGenerator): Promise<SupportCheckResult>
  cancel(): void
}
