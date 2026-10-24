/** Local human review is testimony, not an automatic quality score or model judge.
 * Public output is an allowlisted projection: never explanations, quotations or identity. */
import { createHash } from 'node:crypto'
import { parseDocument } from 'yaml'

export const QUALITY_DIMENSIONS = ['factual_consistency', 'premise_use', 'brief_and_style', 'narrative_usefulness'] as const
type Dimension = typeof QUALITY_DIMENSIONS[number]
type Dict = Record<string, unknown>
export class AgentReviewError extends Error {
  constructor(readonly category: string) { super(category); this.name = 'AgentReviewError' }
}
function requireValue(value: unknown, category: string): asserts value {
  if (!value) throw new AgentReviewError(category)
}
const object = (value: unknown): value is Dict => !!value && typeof value === 'object' && !Array.isArray(value)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const scalarBoundary = (text: string, at: number) => !(at > 0 && at < text.length
  && /[\uD800-\uDBFF]/.test(text[at - 1]!) && /[\uDC00-\uDFFF]/.test(text[at]!))
function exact(value: unknown, keys: string[], category: string): asserts value is Dict {
  requireValue(object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), category)
}
function canonical(value: unknown, depth = 0): unknown {
  requireValue(depth <= 40, 'json_depth')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') { requireValue(Number.isFinite(value), 'json_number'); return value }
  if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1))
  requireValue(object(value), 'json_type')
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key], depth + 1)]))
}
export const reviewPacketSha256 = (value: unknown) => hash(JSON.stringify(canonical(value)))

/** JSON-only, bounded, duplicate-key rejecting. YAML is used solely for the already
 * JSON-valid key-uniqueness check, never as an alternative input syntax. */
export function parseReviewJSON(text: string): unknown {
  requireValue(Buffer.byteLength(text, 'utf8') <= 2_097_152, 'json_size')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new AgentReviewError('invalid_json') }
  const document = parseDocument(text, { uniqueKeys: true, schema: 'json', strict: true })
  requireValue(document.errors.length === 0, 'duplicate_or_invalid_json')
  canonical(value)
  return value
}

export interface HumanReviewPacketCase {
  caseId: string
  draft: string | null
  status: 'draft_ready' | 'needs_author_input' | 'retrieval_insufficient' | 'failed' | 'not_run'
}
export interface HumanReviewFixture {
  sha256: string
  cases: { id: string; project: { chapters: { id: string; text: string }[] } }[]
}
export interface HumanReviewPacket {
  schemaVersion: 1
  kind: 'writer-agent-evaluation-private'
  runId: string
  mode: 'mock' | 'live'
  fixtureSha256: string
  sourceTreeSha256: string
  cases: HumanReviewPacketCase[]
}
/** Validate the fields needed for review; additional private runner fields stay
 * bound by the packet digest but are never copied into the public projection. */
export function validateReviewPacket(value: unknown): asserts value is HumanReviewPacket {
  requireValue(object(value) && value.schemaVersion === 1 && value.kind === 'writer-agent-evaluation-private', 'packet_schema')
  requireValue(typeof value.runId === 'string' && value.runId.length > 0 && value.runId.length <= 100
    && (value.mode === 'mock' || value.mode === 'live') && digest(value.fixtureSha256) && digest(value.sourceTreeSha256), 'packet_identity')
  requireValue(Array.isArray(value.cases) && value.cases.length === 8, 'packet_case_count')
  const ids = new Set<string>()
  for (const row of value.cases) {
    requireValue(object(row) && typeof row.caseId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(row.caseId) && !ids.has(row.caseId), 'packet_case_id')
    ids.add(row.caseId)
    requireValue(row.draft === null || (typeof row.draft === 'string' && row.draft.length > 0 && row.draft.length <= 2_000), 'packet_draft')
    requireValue(typeof row.status === 'string' && ['draft_ready', 'needs_author_input', 'retrieval_insufficient', 'failed', 'not_run'].includes(row.status)
      && (row.status === 'draft_ready') === (row.draft !== null), 'packet_outcome')
  }
}
const emptyJudgment = () => ({ score: null, rationale: '', citations: [] })
export function createHumanReviewTemplate(packet: unknown) {
  validateReviewPacket(packet)
  return {
    schemaVersion: 1, kind: 'writer-agent-human-review', packetSha256: reviewPacketSha256(packet),
    fixtureSha256: packet.fixtureSha256, sourceTreeSha256: packet.sourceTreeSha256,
    reviewer: '', reviewedAt: null,
    cases: packet.cases.map(row => ({ caseId: row.caseId, draftSha256: row.draft === null ? null : hash(row.draft),
      decision: { value: null, rationale: '', citations: [] },
      quality: Object.fromEntries(QUALITY_DIMENSIONS.map(name => [name, emptyJudgment()])),
    })),
  }
}
function validateCitations(value: unknown, row: HumanReviewPacketCase, fixtureCase: HumanReviewFixture['cases'][number]) {
  requireValue(Array.isArray(value) && value.length <= 8, 'citation_count')
  for (const citation of value) {
    requireValue(object(citation), 'citation_schema')
    exact(citation, citation.kind === 'source' ? ['kind', 'chapterId', 'start', 'end', 'quote'] : ['kind', 'start', 'end', 'quote'], 'citation_schema')
    requireValue(citation.kind === 'source' || citation.kind === 'draft', 'citation_kind')
    const text = citation.kind === 'draft' ? row.draft : fixtureCase.project.chapters.find(item => item.id === citation.chapterId)?.text
    requireValue(typeof text === 'string' && Number.isInteger(citation.start) && Number.isInteger(citation.end)
      && (citation.start as number) >= 0 && (citation.end as number) > (citation.start as number)
      && (citation.end as number) <= text.length && typeof citation.quote === 'string'
      && citation.quote.length <= 1_000 && scalarBoundary(text, citation.start as number) && scalarBoundary(text, citation.end as number)
      && text.slice(citation.start as number, citation.end as number) === citation.quote, 'citation_mismatch')
  }
}
function validateJudgment(value: unknown, row: HumanReviewPacketCase, fixtureCase: HumanReviewFixture['cases'][number], decision: boolean) {
  const key = decision ? 'value' : 'score'
  exact(value, [key, 'rationale', 'citations'], 'judgment_schema')
  requireValue(typeof value.rationale === 'string' && value.rationale.length <= 1_000, 'rationale_size')
  const choices: unknown[] = decision ? [null, 'appropriate', 'inappropriate', 'uncertain'] : [null, 0, 1, 2]
  requireValue(choices.includes(value[key]), 'judgment_value')
  validateCitations(value.citations, row, fixtureCase)
  if (value[key] !== null) {
    requireValue(row.status !== 'not_run', 'not_run_judgment')
    requireValue(value.rationale.trim().length > 0, 'judgment_needs_rationale')
    requireValue((value.citations as unknown[]).length > 0, 'judgment_needs_exact_citation')
    if (!decision) {
      requireValue(row.draft !== null, 'no_draft_quality_rating')
      const citations = value.citations as Dict[]
      requireValue(citations.some(item => item.kind === 'source') && citations.some(item => item.kind === 'draft'), 'quality_needs_source_and_draft')
    }
  }
}

export function summarizeHumanReview(packet: unknown, review: unknown, fixture: HumanReviewFixture) {
  validateReviewPacket(packet)
  requireValue(fixture.sha256 === packet.fixtureSha256 && fixture.cases.length === packet.cases.length
    && new Set(fixture.cases.map(row => row.id)).size === packet.cases.length
    && fixture.cases.every(row => packet.cases.some(item => item.caseId === row.id)), 'fixture_identity')
  exact(review, ['schemaVersion', 'kind', 'packetSha256', 'fixtureSha256', 'sourceTreeSha256', 'reviewer', 'reviewedAt', 'cases'], 'review_schema')
  requireValue(review.schemaVersion === 1 && review.kind === 'writer-agent-human-review'
    && review.packetSha256 === reviewPacketSha256(packet) && review.fixtureSha256 === packet.fixtureSha256
    && review.sourceTreeSha256 === packet.sourceTreeSha256, 'review_identity')
  requireValue(typeof review.reviewer === 'string' && review.reviewer.length <= 100, 'reviewer_size')
  requireValue(review.reviewedAt === null || (typeof review.reviewedAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(review.reviewedAt)
    && Number.isFinite(Date.parse(review.reviewedAt))), 'review_date')
  requireValue(Array.isArray(review.cases) && review.cases.length === packet.cases.length, 'review_case_count')
  const seen = new Set<string>()
  const cases = review.cases.map(value => {
    exact(value, ['caseId', 'draftSha256', 'decision', 'quality'], 'review_case_schema')
    const row = packet.cases.find(item => item.caseId === value.caseId)
    requireValue(row && !seen.has(row.caseId), 'review_case_id')
    seen.add(row.caseId)
    requireValue(value.draftSha256 === (row.draft === null ? null : hash(row.draft)), 'review_draft_identity')
    const fixtureCase = fixture.cases.find(item => item.id === row.caseId)!
    validateJudgment(value.decision, row, fixtureCase, true)
    exact(value.quality, [...QUALITY_DIMENSIONS], 'quality_dimensions')
    for (const dimension of QUALITY_DIMENSIONS) validateJudgment(value.quality[dimension], row, fixtureCase, false)
    return { caseId: row.caseId, draftAvailable: row.draft !== null,
      decision: (value.decision as Dict).value as null | 'appropriate' | 'inappropriate' | 'uncertain',
      quality: Object.fromEntries(QUALITY_DIMENSIONS.map(name => [name, (value.quality as Dict)[name] as Dict])) as Record<Dimension, Dict>,
    }
  })
  const judgmentCount = cases.reduce((count, row) => count + Number(row.decision !== null)
    + QUALITY_DIMENSIONS.filter(name => row.quality[name].score !== null).length, 0)
  const qualityJudgmentCount = cases.reduce((count, row) => count + QUALITY_DIMENSIONS.filter(name => row.quality[name].score !== null).length, 0)
  const decisionJudgmentCount = cases.filter(row => row.decision !== null).length
  if (judgmentCount) requireValue(review.reviewer.trim().length > 0 && review.reviewedAt !== null, 'reviewer_required')
  // A valid manual record does not prove that the judgments are correct, independent,
  // blind, or genuinely made by a human. Never label this as automated validation.
  return { schemaVersion: 1, kind: 'writer-agent-human-review-summary',
    packetSha256: review.packetSha256, reviewSha256: reviewPacketSha256(review),
    fixtureSha256: packet.fixtureSha256, sourceTreeSha256: packet.sourceTreeSha256,
    mode: packet.mode, provenance: 'operator-entered-judgments-not-independently-verified',
    decisionReviewStatus: decisionJudgmentCount ? 'manual_review_recorded' : 'not_reviewed',
    qualityReviewStatus: qualityJudgmentCount ? 'manual_review_recorded' : 'not_reviewed',
    denominator: packet.cases.length, draftCases: cases.filter(row => row.draftAvailable).length,
    decisions: { reviewed: cases.filter(row => row.decision !== null).length,
      appropriate: cases.filter(row => row.decision === 'appropriate').length,
      inappropriate: cases.filter(row => row.decision === 'inappropriate').length,
      uncertain: cases.filter(row => row.decision === 'uncertain').length },
    dimensions: Object.fromEntries(QUALITY_DIMENSIONS.map(name => {
      const scores = cases.map(row => row.quality[name].score).filter(value => value !== null) as number[]
      return [name, { reviewed: scores.length, unreviewedDrafts: cases.filter(row => row.draftAvailable).length - scores.length,
        scoreCounts: [0, 1, 2].map(score => scores.filter(value => value === score).length) }]
    })),
    cases: cases.map(row => ({ caseId: row.caseId, draftAvailable: row.draftAvailable, decision: row.decision,
      quality: Object.fromEntries(QUALITY_DIMENSIONS.map(name => [name, row.quality[name].score])) })),
  }
}
