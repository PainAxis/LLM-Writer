import type { ApiConfig, GenerateOptions } from './api'
import type { MemoryEvidence, MemoryProjectInput } from './memory'
import type { WriterMemoryClient } from '../services/memory/writerContext'

export type WriterAgentPhase = 'idle' | 'previewing' | 'previewed' | 'planning'
  | 'executing_retrieval_tool' | 'awaiting_evidence' | 'selecting_evidence' | 'drafting'
  | 'awaiting_author' | 'cancelled' | 'expired' | 'stale' | 'failed' | 'needs_author_input'
export type WriterAgentModelPhase = 'plan' | 'draft'
export type WriterAgentErrorCode = 'invalid_input' | 'not_ready' | 'stale' | 'cancelled'
  | 'expired' | 'timeout' | 'model_deadline' | 'retrieval_deadline' | 'source_guard_deadline' | 'active_deadline' | 'limits' | 'protocol' | 'no_candidates' | 'needs_author_input'
  | 'transport' | 'output_incomplete' | 'settings' | 'failed'

/** A fresh UI ownership sample, checked synchronously at every asynchronous boundary.
 * ready includes saved/clean, no pending save/save error, and visible route ownership. */
export interface WriterAgentOwner {
  ownershipKey: string | number
  projectId: string
  targetChapterId: string
  throughChapterId: string
  editorHtml: string
  brief: string
  ready: boolean
}

export type WriterAgentPlan =
  | { version: 1; tool: 'writer_retrieve_disclosed_context'; input: { query: string } }
  | { version: 1; outcome: 'needs_author_input' }

export interface WriterAgentPreview {
  previewId: string
  projectId: string
  targetChapterId: string
  throughChapterId: string
  brief: string
  provider: string
  model: string
  tail: { text: string; start: number; end: number; revision: string }
  sourceFingerprint: string
}

/** Source-free host receipt. It is display metadata, never an executable capability. */
export interface WriterAgentToolReceipt {
  runId: string
  callId: string
  tool: 'writer_retrieve_disclosed_context'
  status: 'ready' | 'no_candidates'
  planDigest: string
  queryDigest: string
  queryLength: number
  sourceFingerprint: string
  candidateCount: number
  requiresAuthorSelection: true
}

export interface WriterAgentUsage {
  runId: string
  requestId: string
  phase: WriterAgentModelPhase
  status: 'reserved' | 'success' | 'failed'
  /** Null means not reported, not zero. Never substitute billing estimates. */
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  usageSource: 'unknown' | 'reported' | 'estimated' | 'unavailable'
}

export type WriterAgentAuditKind = 'preview_ready' | 'model_reserved' | 'model_completed'
  | 'plan_validated' | 'tool_started' | 'tool_ready' | 'tool_no_candidates'
  | 'tool_failed' | 'evidence_approved' | 'proposal_ready' | 'apply_consumed' | 'terminal'

/** Deliberately no arbitrary strings, query, evidence, provider error, key or headers. */
export interface WriterAgentAuditEvent {
  sequence: number
  kind: WriterAgentAuditKind
  elapsedMs: number
  phase?: WriterAgentModelPhase
  requestId?: string
  callId?: string
  digest?: string
  queryLength?: number
  candidateCount?: number
  code?: WriterAgentErrorCode
}

export interface WriterAgentSnapshot {
  runId: string | null
  phase: WriterAgentPhase
  preview: WriterAgentPreview | null
  evidence: MemoryEvidence[]
  receipt: WriterAgentToolReceipt | null
  proposal: { text: string; selectionFingerprint: string } | null
  usage: WriterAgentUsage[]
  audit: WriterAgentAuditEvent[]
  budget: {
    modelReservations: number
    outputTokensReserved: number
    toolReservations: number
    activeMs: number
    expiresAt: number | null
  }
  error: { code: WriterAgentErrorCode; message: string } | null
}

export interface WriterAgentMemoryClient extends WriterMemoryClient { dispose(): void }

/** Tests replace ports, not the evidence validator or private tool executor. */
export interface WriterAgentPorts {
  getConfig(): ApiConfig
  generateText(prompt: string, options: GenerateOptions): Promise<string>
  readProject(projectId: string): Promise<MemoryProjectInput>
  createMemoryClient(): WriterAgentMemoryClient
  /** Monotonic clock, for cumulative active work and absolute expiry. */
  now(): number
  wallNow(): number
}
export interface WriterAgentOptions {
  getOwner(): WriterAgentOwner | null
  onChange?(snapshot: WriterAgentSnapshot): void
  ports?: Partial<WriterAgentPorts>
}

/** An opaque, once-only closure. Never serialize this or recover it from UI metadata.
 * Acquire the Writer apply barrier first; call consume immediately before first mutation. */
export interface WriterAgentApplyLease { consume(): string }
export interface WriterAgentController {
  snapshot(): WriterAgentSnapshot
  preview(): Promise<void>
  start(grant: { previewId: string; authorizeTool: true }): Promise<void>
  approveEvidence(hitIds: readonly string[]): Promise<void>
  assertBeforeApply(): Promise<WriterAgentApplyLease>
  /** False means ownership already transferred to the UI's non-cancellable commit. */
  cancel(reason?: 'cancelled' | 'stale'): boolean
  dispose(): void
}
