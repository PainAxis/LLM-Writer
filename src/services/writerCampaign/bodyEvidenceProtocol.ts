/** Closed, bounded local claim proposals. Source integrity is never semantic truth. */
import type { CampaignArtifactRef } from '../../types/writerCampaign'
import type { PlanningRecordKind, PlanningRecordValue } from './planningProtocol'
import { PLANNING_RECORD_KINDS } from './planningProtocol'
import { assertScalarText, canonicalStringify, utf8Bytes } from './protocol'

export const BODY_EVIDENCE_PROPOSAL_PROTOCOL = 'campaign-body-evidence-proposals-v1' as const
export const BODY_EVIDENCE_PACKET_PROTOCOL = 'campaign-body-evidence-packet-v1' as const
export const BODY_EVIDENCE_PREFIX_PROTOCOL = 'campaign-body-prefix-v1' as const
export const BODY_EVIDENCE_PURPOSE = 'local_author_continuity_preview' as const
export const BODY_EVIDENCE_LIMITS = Object.freeze({
  chapters: 60, envelopeBytes: 65_536, envelopeUtf16: 65_536, packetBytes: 65_536, packetUtf16: 65_536,
  claims: 128, spans: 256, examinedWindows: 256, edges: 1024, references: 16, relationEnds: 8,
  depth: 12, nodes: 16_384, quoteUtf16: 8192, statementUtf16: 512, sourceBytes: 60 * 65_536,
  unionIntervals: 256, prefixGaps: 316,
})
export const BODY_EVIDENCE_REFUSAL_CODES = Object.freeze([
  'unsupported_contract', 'unsupported_profile', 'unsupported_purpose', 'invalid_envelope', 'invalid_scalar_text',
  'duplicate_identity', 'invalid_reference', 'invalid_anchor', 'quote_mismatch', 'quote_hash_mismatch',
  'missing_required_premise', 'support_cycle', 'unsupported_subject', 'unsupported_relation', 'invalid_coverage',
  'incomplete_plan', 'no_accepted_body', 'noncontiguous_prefix', 'source_identity_mismatch', 'source_outside_prefix',
  'envelope_budget_exceeded', 'proposal_budget_exceeded', 'packet_budget_exceeded', 'runtime_identity_changed',
  'expired', 'source_changed', 'cancelled', 'deadline_exceeded', 'preview_unavailable',
] as const)
export type BodyEvidenceRefusalCode = typeof BODY_EVIDENCE_REFUSAL_CODES[number]
export class BodyEvidenceRefusalError extends Error {
  constructor(readonly code: BodyEvidenceRefusalCode) { super(code); this.name = 'BodyEvidenceRefusalError' }
}
export type BodyEvidenceCheck = () => void
export function bodyEvidenceAssert(value: unknown, code: BodyEvidenceRefusalCode = 'invalid_envelope'): asserts value {
  if (!value) throw new BodyEvidenceRefusalError(code)
}
export interface PlanningRecordIdentity { artifact: CampaignArtifactRef; recordKind: PlanningRecordKind; recordId: string }
export interface BodySource {
  chapterOrdinal: number; artifact: CampaignArtifactRef; taskRevision: number; artifactCandidateId: string
  rawBodyHash: string; rawUtf16Units: number; rawUtf8Bytes: number; rawScalars: number
}
export interface EvidenceSpan { id: string; artifact: CampaignArtifactRef; startUtf16: number; endUtf16: number; quote: string; quoteHash: string }
export interface ExaminedWindow { artifact: CampaignArtifactRef; startUtf16: number; endUtf16: number }
interface ClaimBase {
  id: string; statement: string; atChapterOrdinal: number; anchorIds: string[]; premiseClaimIds: string[]; planningRefs: PlanningRecordIdentity[]
}
export type ClaimProposal = ClaimBase & (
  | { kind: 'world_assertion'; payload: { polarity: 'affirmed' | 'negated' } }
  | { kind: 'attributed_belief'; payload: { holderRef: PlanningRecordIdentity; subjectFactRef: PlanningRecordIdentity; attitude: 'believes' | 'doubts' | 'unaware' | 'claims_to_know' } }
  | { kind: 'narrator_claim'; payload: { reliability: 'unspecified' | 'proposed_unreliable' } }
  | { kind: 'character_change'; payload: { holderRef: PlanningRecordIdentity; changeKind: 'state' | 'knowledge_acquired' | 'knowledge_lost'; beforeClaimId: string; afterClaimId: string } }
  | { kind: 'setup_payoff'; payload: { obligationRef: PlanningRecordIdentity; setupClaimIds: string[]; payoffClaimIds: string[]; contextClaimIds: string[] } }
)
export interface BodyEvidenceProposalEnvelope {
  protocol: typeof BODY_EVIDENCE_PROPOSAL_PROTOCOL; purpose: typeof BODY_EVIDENCE_PURPOSE
  campaignId: string; currentCandidateId: string; manifestHash: string; canonBaseRoot: string; fullPlanRoot: string; bodyPrefixRoot: string
  throughChapterOrdinal: number; producer: { kind: 'local_declaration' | 'offline_fixture'; version: string }
  spans: EvidenceSpan[]; claims: ClaimProposal[]
  examination: { status: 'not_run'; windows: [] } | { status: 'producer_declared'; windows: ExaminedWindow[] }
}
export type BodyEvidenceRange = [number, number]
export type CoverageStatus = 'none' | 'partial' | 'complete'
export interface CoverageRow { sourceIndex: number; intervals: BodyEvidenceRange[]; coveredUtf16Units: number; gaps: BodyEvidenceRange[]; status: CoverageStatus }
export interface BodyCoverage {
  availablePrefix: { sourceCount: number; totalUtf16Units: number; plannedChapterCount: number; acceptedBodyCount: number; acceptedOutsidePrefix: number }
  supplied: { rows: CoverageRow[]; coveredUtf16Units: number; status: CoverageStatus }
  examinedDeclaration:
    | { status: 'not_run'; provenance: null; verification: 'not_run'; rows: []; declaredUtf16Units: 0; coverageStatus: 'none' }
    | { status: 'producer_declared'; provenance: 'local_declaration' | 'offline_fixture_declaration'; verification: 'range_and_identity_only'; rows: CoverageRow[]; declaredUtf16Units: number; coverageStatus: CoverageStatus }
  semanticReview: { status: 'not_reviewed'; reviewedUtf16Units: 0; relationCompleteness: 'not_assessed' }
  declaredPremiseClosure: 'complete'; semanticAdjudication: 'not_run'
}
export interface PacketSpan { id: string; sourceIndex: number; startUtf16: number; endUtf16: number; quote: string; quoteHash: string }
export interface PlanningClosureRow { sourceIndex: number; recordKind: PlanningRecordKind; recordId: string; value: PlanningRecordValue }
export interface PacketPlanning {
  sources: CampaignArtifactRef[]; records: PlanningClosureRow[]; suppliedRecordCount: number; omittedRecordCount: number
  chapterOutlinesSupplied: 0; chapterOutlinesOmitted: number; chapterOutlineScenesSupplied: 0; chapterOutlineScenesOmitted: number
}
export const BODY_EVIDENCE_LIMITATIONS = Object.freeze({
  sourceVerification: 'Exact stored source and declared references only; valid quotations do not establish semantic support.',
  examination: 'Producer declarations are not authenticated review receipts.',
  planning: 'Planning intent is not prose truth, character knowledge or reader disclosure.',
  semantic: 'Semantic extraction, adjudication, autonomous generation and whole-work audit NOT RUN.',
} as const)
export type BodyLimitations = typeof BODY_EVIDENCE_LIMITATIONS
export interface BodyEvidencePacket {
  protocol: typeof BODY_EVIDENCE_PACKET_PROTOCOL; purpose: typeof BODY_EVIDENCE_PURPOSE; exposure: 'local_author_only'
  campaignId: string; currentCandidateId: string; manifestHash: string; canonBaseRoot: string; fullPlanRoot: string; bodyPrefixRoot: string
  throughChapterOrdinal: number; producer: BodyEvidenceProposalEnvelope['producer']; proposalDigest: string
  bodySources: BodySource[]; spans: PacketSpan[]; claims: ClaimProposal[]; planning: PacketPlanning; coverage: BodyCoverage; limitations: BodyLimitations
}
export interface ObservedSourceHead { sequence: number; checkpointHash: string; executionEpoch: number; rawHeadHash: string }
export interface PreviewSourceIdentity { runtimeIdentity: string; source: { commit: string | null; tree: string | null } }
export type BodyEvidencePreviewResult = {
  status: 'ready'; packetText: string; packetDigest: string; packetBytes: number; packetUtf16: number
  throughChapterOrdinal: number; bodyPrefixRoot: string; canonBaseRoot: string; fullPlanRoot: string
  coverage: BodyCoverage; sourceHead: ObservedSourceHead; sourceIdentity: PreviewSourceIdentity
} | { status: 'refused'; refusalCode: BodyEvidenceRefusalCode }

function object(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  bodyEvidenceAssert(value !== null && typeof value === 'object' && !Array.isArray(value))
  const actual = Object.keys(value)
  bodyEvidenceAssert(actual.length === keys.length && keys.every(key => Object.hasOwn(value, key)))
}
function array(value: unknown, max: number, min = 0): asserts value is unknown[] {
  bodyEvidenceAssert(Array.isArray(value))
  bodyEvidenceAssert(value.length >= min && value.length <= max, 'proposal_budget_exceeded')
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER, min = 0, code: BodyEvidenceRefusalCode = 'invalid_envelope'): asserts value is number {
  bodyEvidenceAssert(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max, code)
}
function choice(value: unknown, allowed: readonly unknown[], code: BodyEvidenceRefusalCode = 'invalid_envelope'): void { bodyEvidenceAssert(allowed.includes(value), code) }
function scalar(value: string): void { try { assertScalarText(value) } catch { throw new BodyEvidenceRefusalError('invalid_scalar_text') } }
function text(value: unknown, max: number): asserts value is string {
  bodyEvidenceAssert(typeof value === 'string' && value.length > 0)
  bodyEvidenceAssert(value.length <= max, 'proposal_budget_exceeded'); scalar(value)
}
function id(value: unknown): asserts value is string { bodyEvidenceAssert(typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_.:-]{0,63}$/.test(value)) }
function campaignId(value: unknown): void { bodyEvidenceAssert(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value)) }
function hash(value: unknown): void { bodyEvidenceAssert(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) }
function artifactRef(value: unknown): void {
  object(value, ['taskId', 'revision', 'hash']); campaignId(value.taskId); integer(value.revision, 2048); hash(value.hash)
}
function planningRef(value: unknown): void {
  object(value, ['artifact', 'recordKind', 'recordId']); artifactRef(value.artifact); choice(value.recordKind, PLANNING_RECORD_KINDS, 'invalid_reference'); id(value.recordId)
}
function unique(values: readonly unknown[]): void { bodyEvidenceAssert(new Set(values.map(value => canonicalStringify(value))).size === values.length, 'duplicate_identity') }
function ids(value: unknown, max: number = BODY_EVIDENCE_LIMITS.references, min = 0): asserts value is string[] {
  array(value, max, min); value.forEach(id); unique(value)
}
function window(value: Record<string, unknown>, code: 'invalid_anchor' | 'invalid_coverage'): void {
  artifactRef(value.artifact); integer(value.startUtf16, Number.MAX_SAFE_INTEGER, 0, code); integer(value.endUtf16, Number.MAX_SAFE_INTEGER, 0, code)
  bodyEvidenceAssert(value.startUtf16 < value.endUtf16, code)
}
function boundedTree(value: unknown, check: BodyEvidenceCheck): void {
  let nodes = 0
  const walk = (item: unknown, depth: number) => {
    check(); bodyEvidenceAssert(++nodes <= BODY_EVIDENCE_LIMITS.nodes && depth <= BODY_EVIDENCE_LIMITS.depth, 'proposal_budget_exceeded')
    if (typeof item === 'string') scalar(item)
    else if (typeof item === 'number') bodyEvidenceAssert(Number.isFinite(item))
    else if (Array.isArray(item)) item.forEach(child => walk(child, depth + 1))
    else if (item !== null && typeof item === 'object') Object.values(item).forEach(child => walk(child, depth + 1))
    else bodyEvidenceAssert(item === null || typeof item === 'boolean')
  }
  walk(value, 0)
}
/** Pure bounded admission. The returned envelope is untrusted source/semantic input. */
export function parseBodyEvidenceProposal(raw: unknown, check: BodyEvidenceCheck = () => {}): BodyEvidenceProposalEnvelope {
  check(); bodyEvidenceAssert(typeof raw === 'string')
  bodyEvidenceAssert(raw.length <= BODY_EVIDENCE_LIMITS.envelopeUtf16, 'envelope_budget_exceeded')
  scalar(raw); bodyEvidenceAssert(utf8Bytes(raw) <= BODY_EVIDENCE_LIMITS.envelopeBytes, 'envelope_budget_exceeded')
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new BodyEvidenceRefusalError('invalid_envelope') }
  boundedTree(value, check)
  object(value, ['protocol', 'purpose', 'campaignId', 'currentCandidateId', 'manifestHash', 'canonBaseRoot', 'fullPlanRoot', 'bodyPrefixRoot', 'throughChapterOrdinal', 'producer', 'spans', 'claims', 'examination'])
  choice(value.protocol, [BODY_EVIDENCE_PROPOSAL_PROTOCOL], 'unsupported_contract'); choice(value.purpose, [BODY_EVIDENCE_PURPOSE], 'unsupported_purpose')
  campaignId(value.campaignId); campaignId(value.currentCandidateId)
  for (const key of ['manifestHash', 'canonBaseRoot', 'fullPlanRoot', 'bodyPrefixRoot']) hash(value[key])
  integer(value.throughChapterOrdinal, BODY_EVIDENCE_LIMITS.chapters, 1)
  object(value.producer, ['kind', 'version']); choice(value.producer.kind, ['local_declaration', 'offline_fixture']); id(value.producer.version)
  array(value.spans, BODY_EVIDENCE_LIMITS.spans)
  for (const row of value.spans) {
    check(); object(row, ['id', 'artifact', 'startUtf16', 'endUtf16', 'quote', 'quoteHash']); id(row.id); window(row, 'invalid_anchor')
    text(row.quote, BODY_EVIDENCE_LIMITS.quoteUtf16); hash(row.quoteHash)
  }
  unique(value.spans.map(row => (row as EvidenceSpan).id))
  array(value.claims, BODY_EVIDENCE_LIMITS.claims)
  let edges = 0
  for (const row of value.claims) {
    check(); object(row, ['id', 'kind', 'statement', 'atChapterOrdinal', 'anchorIds', 'premiseClaimIds', 'planningRefs', 'payload'])
    id(row.id); text(row.statement, BODY_EVIDENCE_LIMITS.statementUtf16); integer(row.atChapterOrdinal, value.throughChapterOrdinal, 1)
    ids(row.anchorIds, BODY_EVIDENCE_LIMITS.references, 1); ids(row.premiseClaimIds)
    array(row.planningRefs, BODY_EVIDENCE_LIMITS.references); row.planningRefs.forEach(planningRef); unique(row.planningRefs)
    edges += row.anchorIds.length + row.premiseClaimIds.length + row.planningRefs.length
    const p = row.payload
    switch (row.kind) {
      case 'world_assertion': object(p, ['polarity']); choice(p.polarity, ['affirmed', 'negated']); break
      case 'attributed_belief':
        object(p, ['holderRef', 'subjectFactRef', 'attitude']); planningRef(p.holderRef); planningRef(p.subjectFactRef)
        choice(p.attitude, ['believes', 'doubts', 'unaware', 'claims_to_know']); edges += 2; break
      case 'narrator_claim': object(p, ['reliability']); choice(p.reliability, ['unspecified', 'proposed_unreliable']); break
      case 'character_change':
        object(p, ['holderRef', 'changeKind', 'beforeClaimId', 'afterClaimId']); planningRef(p.holderRef)
        choice(p.changeKind, ['state', 'knowledge_acquired', 'knowledge_lost']); id(p.beforeClaimId); id(p.afterClaimId)
        bodyEvidenceAssert(p.beforeClaimId !== p.afterClaimId, 'unsupported_relation'); edges += 3; break
      case 'setup_payoff':
        object(p, ['obligationRef', 'setupClaimIds', 'payoffClaimIds', 'contextClaimIds']); planningRef(p.obligationRef)
        ids(p.setupClaimIds, BODY_EVIDENCE_LIMITS.relationEnds, 1); ids(p.payoffClaimIds, BODY_EVIDENCE_LIMITS.relationEnds, 1); ids(p.contextClaimIds)
        bodyEvidenceAssert(p.setupClaimIds.every(id => !(p.payoffClaimIds as string[]).includes(id)), 'unsupported_relation')
        edges += 1 + p.setupClaimIds.length + p.payoffClaimIds.length + p.contextClaimIds.length; break
      default: throw new BodyEvidenceRefusalError('unsupported_relation')
    }
    bodyEvidenceAssert(edges <= BODY_EVIDENCE_LIMITS.edges, 'proposal_budget_exceeded')
  }
  unique(value.claims.map(row => (row as ClaimProposal).id))
  object(value.examination, ['status', 'windows']); choice(value.examination.status, ['not_run', 'producer_declared'])
  array(value.examination.windows, value.examination.status === 'not_run' ? 0 : BODY_EVIDENCE_LIMITS.examinedWindows)
  for (const row of value.examination.windows) { check(); object(row, ['artifact', 'startUtf16', 'endUtf16']); window(row, 'invalid_coverage') }
  check(); bodyEvidenceAssert(canonicalStringify(value) === raw); check()
  return value as unknown as BodyEvidenceProposalEnvelope
}
