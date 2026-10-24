/** Review-contract tests use fabricated ratings. They are NOT human-quality results. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  AgentReviewError, createHumanReviewTemplate, parseReviewJSON, QUALITY_DIMENSIONS, reviewPacketSha256,
  summarizeHumanReview, type HumanReviewFixture,
} from './lib/writer-agent-eval-review'
import { loadWriterAgentEvalFixture } from './lib/writer-agent-eval-fixture'

const originalFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('Review smoke forbids network') }
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
let checks = 0
function expectFailure(run: () => unknown, category: string) {
  assert.throws(run, error => error instanceof AgentReviewError && error.category === category)
  checks++
}
try {
  const { fixture, sha256 } = await loadWriterAgentEvalFixture()
  const context: HumanReviewFixture = { sha256, cases: fixture.cases }
  const packet = { schemaVersion: 1 as const, kind: 'writer-agent-evaluation-private' as const,
    runId: 'review-contract-test-not-human-results', mode: 'mock' as const,
    fixtureSha256: sha256, sourceTreeSha256: 'a'.repeat(64),
    cases: fixture.cases.map((row, index) => ({ caseId: row.id, draft: index === 0 ? '灯光照着木门。😀他没有改变约定。' : null,
      status: index === 0 ? 'draft_ready' : index === 7 ? 'not_run' : 'needs_author_input' })),
    privateCanary: 'PRIVATE_STORY_NOT_IN_PUBLIC_SUMMARY',
  }
  const blank = createHumanReviewTemplate(packet)
  const pending = summarizeHumanReview(packet, blank, context)
  assert.equal(pending.qualityReviewStatus, 'not_reviewed')
  assert.equal(pending.decisionReviewStatus, 'not_reviewed')
  assert.equal(pending.denominator, 8)
  assert.equal(pending.draftCases, 1)
  assert.ok(!JSON.stringify(pending).includes(packet.privateCanary))
  checks++
  const review: any = structuredClone(blank)
  review.reviewer = 'LOCAL_REVIEWER_ID_NOT_PUBLIC'
  review.reviewedAt = '2026-10-24T00:00:00Z'
  const quote = { kind: 'draft', start: 0, end: 7, quote: packet.cases[0]!.draft!.slice(0, 7) }
  const firstSource = fixture.cases[0]!.project.chapters[0]!
  const sourceQuote = { kind: 'source', chapterId: firstSource.id, start: 0, end: 1, quote: firstSource.text.slice(0, 1) }
  review.cases[0].decision = { value: 'appropriate', rationale: 'PRIVATE_REASON_NOT_PUBLIC', citations: [quote] }
  const decisionOnly = summarizeHumanReview(packet, review, context)
  assert.equal(decisionOnly.decisionReviewStatus, 'manual_review_recorded')
  assert.equal(decisionOnly.qualityReviewStatus, 'not_reviewed')
  for (const name of QUALITY_DIMENSIONS) review.cases[0].quality[name] = { score: 1, rationale: 'PRIVATE_REASON_NOT_PUBLIC', citations: [quote, sourceQuote] }
  const summary = summarizeHumanReview(packet, review, context)
  assert.equal(summary.qualityReviewStatus, 'manual_review_recorded')
  assert.deepEqual(summary.dimensions.factual_consistency, { reviewed: 1, unreviewedDrafts: 0, scoreCounts: [0, 1, 0] })
  for (const secret of [packet.privateCanary, review.reviewer, 'PRIVATE_REASON_NOT_PUBLIC', quote.quote]) assert.ok(!JSON.stringify(summary).includes(secret))
  checks++

  for (const field of ['packetSha256', 'fixtureSha256', 'sourceTreeSha256']) {
    const changed = structuredClone(review); changed[field] = 'b'.repeat(64)
    expectFailure(() => summarizeHumanReview(packet, changed, context), 'review_identity')
  }
  const alteredPacket = structuredClone(packet); alteredPacket.cases[0]!.draft += '改'
  expectFailure(() => summarizeHumanReview(alteredPacket, review, context), 'review_identity')
  const changedFixture = { ...context, sha256: 'b'.repeat(64) }
  expectFailure(() => summarizeHumanReview(packet, review, changedFixture), 'fixture_identity')
  const mutation = (alter: (value: any) => void, expected: string) => {
    const changed = structuredClone(review); alter(changed)
    expectFailure(() => summarizeHumanReview(packet, changed, context), expected)
  }
  mutation(value => { value.cases[0].draftSha256 = hash('wrong') }, 'review_draft_identity')
  mutation(value => { value.cases[1].caseId = value.cases[0].caseId }, 'review_case_id')
  mutation(value => { value.cases.pop() }, 'review_case_count')
  mutation(value => { value.extra = 'unrecognized' }, 'review_schema')
  mutation(value => { value.cases[0].quality.extra = {} }, 'quality_dimensions')
  mutation(value => { value.cases[0].quality.factual_consistency.score = '1' }, 'judgment_value')
  mutation(value => { value.cases[0].quality.factual_consistency.score = 3 }, 'judgment_value')
  mutation(value => { value.cases[0].quality.factual_consistency.rationale = '' }, 'judgment_needs_rationale')
  mutation(value => { value.cases[0].quality.factual_consistency.citations = [] }, 'judgment_needs_exact_citation')
  mutation(value => { value.cases[0].quality.factual_consistency.citations = [quote] }, 'quality_needs_source_and_draft')
  mutation(value => { value.cases[0].quality.factual_consistency.citations = [sourceQuote] }, 'quality_needs_source_and_draft')
  mutation(value => { value.reviewer = '' }, 'reviewer_required')
  mutation(value => { value.reviewedAt = null }, 'reviewer_required')
  mutation(value => { value.cases[0].decision.citations[0].quote = '假引用' }, 'citation_mismatch')
  const chapter = fixture.cases[1]!.project.chapters[0]!
  mutation(value => { value.cases[1].quality.factual_consistency = { score: 0, rationale: 'No draft is not bad prose',
    citations: [{ kind: 'source', chapterId: chapter.id, start: 0, end: 1, quote: chapter.text.slice(0, 1) }] } }, 'no_draft_quality_rating')
  const emojiAt = packet.cases[0]!.draft!.indexOf('😀')
  mutation(value => { value.cases[0].decision.citations = [{ kind: 'draft', start: emojiAt, end: emojiAt + 1,
    quote: packet.cases[0]!.draft!.slice(emojiAt, emojiAt + 1) }] }, 'citation_mismatch')
  mutation(value => { value.cases[0].decision.citations = [{ kind: 'draft', start: emojiAt + 1, end: emojiAt + 2,
    quote: packet.cases[0]!.draft!.slice(emojiAt + 1, emojiAt + 2) }] }, 'citation_mismatch')
  const sourceReview = structuredClone(review)
  sourceReview.cases[1].decision = { value: 'uncertain', rationale: 'Decision is not automatically correct.',
    citations: [{ kind: 'source', chapterId: chapter.id, start: 0, end: 1, quote: chapter.text.slice(0, 1) }] }
  assert.equal(summarizeHumanReview(packet, sourceReview, context).decisions.uncertain, 1)
  checks++
  const notRunSource = fixture.cases[7]!.project.chapters[0]!
  mutation(value => { value.cases[7].decision = { value: 'appropriate', rationale: 'Must not rate an unrun case',
    citations: [{ kind: 'source', chapterId: notRunSource.id, start: 0, end: 1, quote: notRunSource.text.slice(0, 1) }] } }, 'not_run_judgment')
  expectFailure(() => parseReviewJSON('{"x":1,"x":2}'), 'duplicate_or_invalid_json')
  expectFailure(() => parseReviewJSON('{"x":1,"\\u0078":2}'), 'duplicate_or_invalid_json')
  expectFailure(() => parseReviewJSON('x: 1'), 'invalid_json')
  expectFailure(() => parseReviewJSON(' '.repeat(2_097_153)), 'json_size')
  expectFailure(() => parseReviewJSON('['.repeat(45) + '0' + ']'.repeat(45)), 'json_depth')
  assert.equal(reviewPacketSha256({ a: 1, b: 2 }), reviewPacketSha256({ b: 2, a: 1 }))
  checks++

  const temporary = await mkdtemp(join(tmpdir(), 'writer-agent-review-'))
  try {
    const packetPath = join(temporary, 'packet.json')
    const outputPath = join(temporary, 'ratings.json')
    await writeFile(packetPath, JSON.stringify(packet))
    const command = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/review-writer-agent-evaluation.ts', ...args], { encoding: 'utf8' })
    const first = command(['--template', '--packet', packetPath, '--output', outputPath])
    assert.equal(first.status, 0, first.stderr)
    assert.ok(!first.stdout.includes(packet.privateCanary))
    assert.equal((JSON.parse(await readFile(outputPath, 'utf8'))).packetSha256, reviewPacketSha256(packet))
    assert.equal(command(['--template', '--packet', packetPath, '--output', outputPath]).status, 1)
    const inside = command(['--template', '--packet', packetPath, '--output', 'forbidden-review-output.json'])
    assert.equal(inside.status, 1)
    assert.match(inside.stderr, /output_must_be_outside_repository/)
    checks++
  } finally { await rm(temporary, { recursive: true, force: true }) }
  console.log(`Writer Agent human-review contract: ${checks} controlled checks passed; 0 actual human judgments, 0 model calls.`)
} catch {
  // CI logs are public evidence too. Never let assert diagnostics print private
  // packets, handwritten rationales or source/output quotations on failure.
  process.stderr.write(JSON.stringify({ kind: 'writer-agent-review-contract-failure', completedChecks: checks }) + '\n')
  process.exitCode = 1
} finally { globalThis.fetch = originalFetch }
