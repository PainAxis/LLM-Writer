/** Closed untrusted producer output. Parsing never confers semantic or execution authority. */
import { assertScalarText, canonicalStringify, utf8Bytes } from './protocol'

export const BODY_PRODUCER_INPUT_PROTOCOL = 'body-producer-input-v1' as const
export const BODY_PRODUCER_OUTPUT_PROTOCOL = 'body-producer-output-v1' as const
export const BODY_PRODUCER_PROMPT_VERSION = 'body-producer-prompt-v1' as const
export const BODY_PRODUCER_ENVELOPE_PROTOCOL = 'campaign-body-evidence-proposals-v2' as const
export const BODY_PRODUCER_PACKET_PROTOCOL = 'campaign-body-evidence-packet-v2' as const
export const BODY_PRODUCER_LIMITS = Object.freeze({
  windowUtf16: 4096, planningRecords: 32, planningBytes: 12_288, inputBytes: 32_768, inputUtf16: 16_384,
  items: 8, spans: 16, spansPerItem: 4, quoteUtf16: 512, statementUtf16: 256, explanationUtf16: 256,
  subjects: 32, subjectsPerItem: 4, subjectUtf16: 128, examinedIntervals: 16, responseBytes: 16_384,
  responseUtf16: 16_384, httpResponseBytes: 65_536, outputTokens: 1200, providerMs: 30_000,
  invocationMs: 60_000, preparedMs: 300_000, reviewBytes: 98_304, depth: 8, nodes: 2048,
})
export const BODY_PRODUCER_REFUSALS = Object.freeze(['invalid_output', 'output_capacity', 'invalid_scalar_text', 'invalid_selection',
  'invalid_reference', 'input_capacity', 'source_changed', 'binding_mismatch', 'review_capacity', 'unsupported_purpose'] as const)
export type BodyProducerRefusalCode = typeof BODY_PRODUCER_REFUSALS[number]
export class BodyProducerRefusalError extends Error {
  constructor(readonly code: BodyProducerRefusalCode) { super(code); this.name = 'BodyProducerRefusalError' }
}
export function bodyProducerAssert(value: unknown, code: BodyProducerRefusalCode = 'invalid_output'): asserts value {
  if (!value) throw new BodyProducerRefusalError(code)
}
export const BODY_PRODUCER_UNRESOLVED_REASONS = Object.freeze(['unmapped_subject', 'unmapped_topic', 'ambiguous_attribution',
  'ambiguous_reference', 'missing_body_premise', 'character_change_out_of_scope', 'setup_payoff_out_of_scope', 'unsupported_relation', 'output_capacity'] as const)
export type BodyProducerUnresolvedReason = typeof BODY_PRODUCER_UNRESOLVED_REASONS[number]
export interface BodyProducerSpan { startUtf16: number; endUtf16: number; quote: string }
export interface BodyProducerSubject { spanIndex: number; label: string; planningReference: number | null; role: 'holder' | 'topic' | 'other' }
interface ItemBase { spans: BodyProducerSpan[]; subjects: BodyProducerSubject[] }
export type BodyProducerItem = ItemBase & (
  | { kind: 'world_assertion'; statement: string; polarity: 'affirmed' | 'negated' }
  | { kind: 'attributed_belief'; statement: string; attitude: 'believes' | 'doubts' | 'unaware' | 'claims_to_know'; holderReference: number | null; subjectFactReference: number | null }
  | { kind: 'narrator_claim'; statement: string; reliability: 'unspecified' | 'proposed_unreliable' }
  | { kind: 'unresolved'; reason: BodyProducerUnresolvedReason; intendedKind: 'world_assertion' | 'attributed_belief' | 'narrator_claim' | 'character_change' | 'setup_payoff' | 'other'; explanation: string }
)
export interface BodyProducerOutput {
  protocol: typeof BODY_PRODUCER_OUTPUT_PROTOCOL; items: BodyProducerItem[]; saturated: boolean
  examination: { status: 'not_declared' | 'producer_declared'; intervals: Array<{ startUtf16: number; endUtf16: number }> }
}
function object(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  bodyProducerAssert(value !== null && typeof value === 'object' && !Array.isArray(value))
  const actual = Object.keys(value)
  bodyProducerAssert(actual.length === keys.length && keys.every(key => Object.hasOwn(value, key)))
}
function array(value: unknown, max: number, min = 0): asserts value is unknown[] {
  bodyProducerAssert(Array.isArray(value)); bodyProducerAssert(value.length >= min && value.length <= max, 'output_capacity')
}
function integer(value: unknown, max: number, min = 0): asserts value is number {
  bodyProducerAssert(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max)
}
function scalar(value: string): void { try { assertScalarText(value) } catch { throw new BodyProducerRefusalError('invalid_scalar_text') } }
function text(value: unknown, max: number, whitespace = false): asserts value is string {
  bodyProducerAssert(typeof value === 'string' && value.length > 0 && (whitespace || value.trim().length > 0))
  bodyProducerAssert(value.length <= max, 'output_capacity'); scalar(value)
}
function choice(value: unknown, values: readonly unknown[]): void { bodyProducerAssert(values.includes(value)) }
function reference(value: unknown): void { if (value !== null) integer(value, BODY_PRODUCER_LIMITS.planningRecords, 1) }
function unique(values: readonly unknown[]): void {
  bodyProducerAssert(new Set(values.map(value => canonicalStringify(value))).size === values.length)
}
function interval(value: Record<string, unknown>): void {
  integer(value.startUtf16, BODY_PRODUCER_LIMITS.windowUtf16); integer(value.endUtf16, BODY_PRODUCER_LIMITS.windowUtf16)
  bodyProducerAssert(value.startUtf16 < value.endUtf16)
}
/** Reject duplicate keys and excessive nesting before JSON.parse; JSON.parse still
 * owns syntax acceptance. Token work is bounded by the already-limited raw text. */
function lexicalAdmission(raw: string, check: () => void): void {
  const stack: Array<{ object: boolean; expectKey: boolean; keys: Set<string> }> = []
  let nodes = 0
  for (const token of raw.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? []) {
    check()
    if (token === '{' || token === '[') {
      bodyProducerAssert(++nodes <= BODY_PRODUCER_LIMITS.nodes && stack.length < BODY_PRODUCER_LIMITS.depth, 'output_capacity')
      stack.push({ object: token === '{', expectKey: token === '{', keys: new Set() }); continue
    }
    if (token === '}' || token === ']') { stack.pop(); continue }
    const current = stack.at(-1)
    if (token === ',') { if (current?.object) current.expectKey = true; continue }
    if (token === ':') { if (current?.object) current.expectKey = false; continue }
    bodyProducerAssert(++nodes <= BODY_PRODUCER_LIMITS.nodes, 'output_capacity')
    if (current?.object && current.expectKey && token.startsWith('"')) {
      let key: string
      try { key = JSON.parse(token) as string } catch { throw new BodyProducerRefusalError('invalid_output') }
      bodyProducerAssert(!current.keys.has(key)); current.keys.add(key); current.expectKey = false
    }
  }
}
export function parseBodyProducerOutput(raw: unknown, check: () => void = () => {}): BodyProducerOutput {
  check(); bodyProducerAssert(typeof raw === 'string')
  bodyProducerAssert(raw.length <= BODY_PRODUCER_LIMITS.responseUtf16, 'output_capacity'); scalar(raw)
  bodyProducerAssert(utf8Bytes(raw) <= BODY_PRODUCER_LIMITS.responseBytes, 'output_capacity')
  lexicalAdmission(raw, check)
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new BodyProducerRefusalError('invalid_output') }
  object(value, ['protocol', 'items', 'saturated', 'examination'])
  choice(value.protocol, [BODY_PRODUCER_OUTPUT_PROTOCOL]); bodyProducerAssert(typeof value.saturated === 'boolean')
  array(value.items, BODY_PRODUCER_LIMITS.items)
  let spanCount = 0, subjectCount = 0
  for (const item of value.items) {
    check(); bodyProducerAssert(item !== null && typeof item === 'object' && !Array.isArray(item))
    const row = item as Record<string, unknown>
    switch (row.kind) {
      case 'world_assertion': object(row, ['kind', 'statement', 'polarity', 'spans', 'subjects']); choice(row.polarity, ['affirmed', 'negated']); break
      case 'attributed_belief':
        object(row, ['kind', 'statement', 'attitude', 'holderReference', 'subjectFactReference', 'spans', 'subjects'])
        choice(row.attitude, ['believes', 'doubts', 'unaware', 'claims_to_know']); reference(row.holderReference); reference(row.subjectFactReference); break
      case 'narrator_claim': object(row, ['kind', 'statement', 'reliability', 'spans', 'subjects']); choice(row.reliability, ['unspecified', 'proposed_unreliable']); break
      case 'unresolved':
        object(row, ['kind', 'reason', 'intendedKind', 'explanation', 'spans', 'subjects']); choice(row.reason, BODY_PRODUCER_UNRESOLVED_REASONS)
        choice(row.intendedKind, ['world_assertion', 'attributed_belief', 'narrator_claim', 'character_change', 'setup_payoff', 'other'])
        text(row.explanation, BODY_PRODUCER_LIMITS.explanationUtf16); break
      default: throw new BodyProducerRefusalError('invalid_output')
    }
    if (row.kind !== 'unresolved') text(row.statement, BODY_PRODUCER_LIMITS.statementUtf16)
    array(row.spans, BODY_PRODUCER_LIMITS.spansPerItem, 1)
    for (const span of row.spans) { object(span, ['startUtf16', 'endUtf16', 'quote']); interval(span); text(span.quote, BODY_PRODUCER_LIMITS.quoteUtf16, true) }
    unique(row.spans); spanCount += row.spans.length
    array(row.subjects, BODY_PRODUCER_LIMITS.subjectsPerItem)
    for (const subject of row.subjects) {
      object(subject, ['spanIndex', 'label', 'planningReference', 'role']); integer(subject.spanIndex, row.spans.length, 1)
      text(subject.label, BODY_PRODUCER_LIMITS.subjectUtf16); reference(subject.planningReference); choice(subject.role, ['holder', 'topic', 'other'])
      bodyProducerAssert((row.spans[subject.spanIndex - 1] as BodyProducerSpan).quote.includes(subject.label))
    }
    unique(row.subjects); subjectCount += row.subjects.length
    bodyProducerAssert(spanCount <= BODY_PRODUCER_LIMITS.spans && subjectCount <= BODY_PRODUCER_LIMITS.subjects, 'output_capacity')
  }
  unique(value.items)
  object(value.examination, ['status', 'intervals']); choice(value.examination.status, ['not_declared', 'producer_declared'])
  array(value.examination.intervals, value.examination.status === 'not_declared' ? 0 : BODY_PRODUCER_LIMITS.examinedIntervals)
  for (const entry of value.examination.intervals) { object(entry, ['startUtf16', 'endUtf16']); interval(entry) }
  unique(value.examination.intervals); check()
  return value as unknown as BodyProducerOutput
}
