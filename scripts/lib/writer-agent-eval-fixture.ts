/** Frozen synthetic inputs for evaluation readiness, not model-quality results. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { MemoryChapterInput, MemoryProjectInput } from '../../src/types/memory'
import { chapterRevision } from '../../src/services/memory/revision'
import {
  parseWriterAgentPlan, validateWriterAgentDraft, writerAgentPlanPrompt,
  WRITER_AGENT_LIMITS,
} from '../../src/services/writerAgentProtocol'

export type WriterAgentEvalLocation = 'plan_input' | 'retrieval' | 'draft_input' | 'draft_output'
export interface WriterAgentEvalChapter extends MemoryChapterInput { revision: string }
export interface WriterAgentEvalPremise {
  id: string
  chapterId: string
  quote: string
  revision: string
  start: number
  end: number
}
export interface WriterAgentEvalExclusion {
  id: string
  kind: 'future' | 'stale' | 'injection'
  exact: string
  chapterId: string
  reason: string
  locations: WriterAgentEvalLocation[]
}
export interface WriterAgentEvalCase {
  id: string
  title: string
  tags: string[]
  project: Omit<MemoryProjectInput, 'chapters'> & { chapters: WriterAgentEvalChapter[] }
  targetChapterId: string
  throughChapterId: string
  brief: string
  requiredPremises: WriterAgentEvalPremise[]
  excluded: WriterAgentEvalExclusion[]
  staleChapters?: WriterAgentEvalChapter[]
  permissibleCreativeFreedom: string[]
  humanReviewFacts: string[]
  authorInputNeeded?: string[]
  expectedMock: {
    outcome: 'draft_ready' | 'needs_author_input' | 'retrieval_insufficient'
    missingPremiseIds: string[]
    planText: string
    draftText: string | null
    draftForbiddenMatches: string[]
  }
}
export interface WriterAgentEvalFixture {
  schemaVersion: 1
  id: 'writer-agent-quality-v1'
  status: 'FROZEN_SYNTHETIC_EVALUATION_INPUTS_NOT_QUALITY_RESULTS'
  sourceLanguage: 'zh-CN'
  boundaryContract: {
    purpose: string
    sourceLimits: { cases: 8; totalSourceUtf16: 20000; briefUtf16: 1000; targetUtf16: 2000 }
    authorSelectionPolicy: { id: string; rule: string; missingEvidence: string; label: string }
    queryIsolation: string
    mockInterpretation: string
    outputHandling: string
    nonGoals: string[]
  }
  humanRubric: {
    status: 'human_review_required'
    scale: [0, 1, 2]
    dimensions: Array<{
      id: 'factual_consistency' | 'premise_use' | 'brief_and_style' | 'narrative_usefulness'
      label: string
      anchors: { '0': string; '1': string; '2': string }
    }>
    rationaleRequirement: string
    aggregatePolicy: string
    noDraftPolicy: string
  }
  cases: WriterAgentEvalCase[]
}

function record(value: unknown, context: string): asserts value is Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), context)
}
function text(value: unknown, context: string, max = 10000): asserts value is string {
  assert.ok(typeof value === 'string' && value.trim().length > 0 && value.length <= max, context)
}
function list(value: unknown, context: string): asserts value is unknown[] {
  assert.ok(Array.isArray(value), context)
}
function strings(value: unknown, context: string, allowEmpty = false): asserts value is string[] {
  list(value, context)
  assert.ok(allowEmpty || value.length > 0, context)
  for (const entry of value) text(entry, context)
  assert.equal(new Set(value).size, value.length, `${context}: duplicate`)
}
function integer(value: unknown, context: string): asserts value is number {
  assert.ok(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, context)
}
async function validateChapter(value: unknown, context: string): Promise<WriterAgentEvalChapter> {
  record(value, context)
  text(value.id, `${context}: id`, 256)
  text(value.title, `${context}: title`, 1000)
  text(value.text, `${context}: text`, 20000)
  text(value.revision, `${context}: revision`, 64)
  assert.match(value.revision, /^[a-f0-9]{64}$/)
  assert.equal(value.revision, await chapterRevision({ title: value.title, text: value.text }), `${context}: production revision`)
  return value as unknown as WriterAgentEvalChapter
}

/** Validate the full denominator and exact current-source spans before any run.
 * The runner must still validate returned production hits and current revisions. */
export async function validateWriterAgentEvalFixture(value: unknown): Promise<WriterAgentEvalFixture> {
  record(value, 'fixture')
  assert.equal(value.schemaVersion, 1)
  assert.equal(value.id, 'writer-agent-quality-v1')
  assert.equal(value.status, 'FROZEN_SYNTHETIC_EVALUATION_INPUTS_NOT_QUALITY_RESULTS')
  assert.equal(value.sourceLanguage, 'zh-CN')
  record(value.boundaryContract, 'boundary contract')
  assert.deepEqual(value.boundaryContract.sourceLimits, { cases: 8, totalSourceUtf16: 20000, briefUtf16: 1000, targetUtf16: 2000 })
  record(value.boundaryContract.authorSelectionPolicy, 'author selection policy')
  assert.equal(value.boundaryContract.authorSelectionPolicy.id, 'verified-complete-span-minimum-cover-v1')
  for (const key of ['rule', 'missingEvidence', 'label']) text(value.boundaryContract.authorSelectionPolicy[key], `selection ${key}`)
  for (const key of ['purpose', 'queryIsolation', 'mockInterpretation', 'outputHandling']) text(value.boundaryContract[key], `contract ${key}`)
  strings(value.boundaryContract.nonGoals, 'non-goals')
  record(value.humanRubric, 'human rubric')
  assert.equal(value.humanRubric.status, 'human_review_required')
  assert.deepEqual(value.humanRubric.scale, [0, 1, 2])
  list(value.humanRubric.dimensions, 'rubric dimensions')
  assert.deepEqual(value.humanRubric.dimensions.map(dimension => { record(dimension, 'dimension'); return dimension.id }),
    ['factual_consistency', 'premise_use', 'brief_and_style', 'narrative_usefulness'])
  for (const dimension of value.humanRubric.dimensions) {
    record(dimension, 'dimension'); text(dimension.label, 'dimension label')
    record(dimension.anchors, 'rubric anchors')
    for (const score of ['0', '1', '2']) text(dimension.anchors[score], `rubric score ${score}`)
  }
  for (const key of ['rationaleRequirement', 'aggregatePolicy', 'noDraftPolicy']) text(value.humanRubric[key], `rubric ${key}`)
  list(value.cases, 'cases')
  assert.equal(value.cases.length, 8, 'The frozen denominator is eight cases, including misses and abstentions')
  const caseIds = new Set<string>()
  const projectIds = new Set<string>()
  let sourceChars = 0
  for (const row of value.cases) {
    record(row, 'case'); text(row.id, 'case id', 80)
    assert.ok(!caseIds.has(row.id), `duplicate case ${row.id}`); caseIds.add(row.id)
    const context = row.id
    text(row.title, `${context}: title`); strings(row.tags, `${context}: tags`)
    text(row.brief, `${context}: brief`, WRITER_AGENT_LIMITS.briefChars)
    text(row.targetChapterId, `${context}: target`, 256)
    assert.equal(row.targetChapterId, row.throughChapterId, `${context}: target must equal disclosure cutoff`)
    record(row.project, `${context}: project`)
    text(row.project.id, `${context}: project id`, 256)
    assert.ok(!projectIds.has(row.project.id), 'case projects must be distinct'); projectIds.add(row.project.id)
    text(row.project.title, `${context}: project title`, 1000)
    list(row.project.chapters, `${context}: chapters`)
    assert.ok(row.project.chapters.length > 0 && row.project.chapters.length <= WRITER_AGENT_LIMITS.chapters)
    assert.deepEqual(row.project.clues, [], `${context}: fixture must not inject gold through annotations or aliases`)
    const chapters = await Promise.all(row.project.chapters.map((chapter, index) => validateChapter(chapter, `${context}: chapter ${index}`)))
    const chapterMap = new Map(chapters.map(chapter => [chapter.id, chapter]))
    assert.equal(chapterMap.size, chapters.length, `${context}: chapter IDs are unique`)
    const target = chapterMap.get(row.targetChapterId)
    assert.ok(target, `${context}: target exists`)
    assert.ok(target.text.length <= WRITER_AGENT_LIMITS.tailChars, `${context}: full saved target fits preview tail`)
    const cutoff = chapters.indexOf(target)
    // This is the production prompt; rubric, query gold and source chapters do not enter it.
    writerAgentPlanPrompt({ brief: row.brief, tail: { text: target.text, start: 0, end: target.text.length, revision: target.revision } })
    const stale: WriterAgentEvalChapter[] = []
    if (row.staleChapters !== undefined) {
      list(row.staleChapters, `${context}: stale chapters`)
      for (const previous of row.staleChapters) {
        const chapter = await validateChapter(previous, `${context}: stale chapter`)
        const current = chapterMap.get(chapter.id)
        assert.ok(current, `${context}: stale chapter must replace an actual current chapter`)
        assert.notEqual(current.revision, chapter.revision, `${context}: stale revision differs`)
        assert.ok(!stale.some(item => item.id === chapter.id), `${context}: duplicate stale revision`)
        stale.push(chapter)
      }
    }
    sourceChars += [...chapters, ...stale].reduce((total, chapter) => total + chapter.text.length, 0)
    list(row.requiredPremises, `${context}: required premises`)
    const premiseIds = new Set<string>()
    for (const premise of row.requiredPremises) {
      record(premise, `${context}: premise`)
      text(premise.id, 'premise id', 80); text(premise.chapterId, 'premise chapter', 256)
      text(premise.quote, 'premise quote', 6000); text(premise.revision, 'premise revision', 64)
      integer(premise.start, 'premise start'); integer(premise.end, 'premise end')
      assert.ok(!premiseIds.has(premise.id), `${context}: duplicate premise`); premiseIds.add(premise.id)
      const chapter = chapterMap.get(premise.chapterId)
      assert.ok(chapter && chapters.indexOf(chapter) <= cutoff, `${context}: premise must be disclosed`)
      assert.equal(premise.revision, chapter.revision, `${context}: premise uses current revision`)
      assert.equal(chapter.text.slice(premise.start, premise.end), premise.quote, `${context}: exact complete premise span`)
      assert.equal(premise.end - premise.start, premise.quote.length, `${context}: UTF-16 offsets`)
    }
    strings(row.permissibleCreativeFreedom, `${context}: creative freedom`)
    strings(row.humanReviewFacts, `${context}: human review facts`)
    if (row.authorInputNeeded !== undefined) strings(row.authorInputNeeded, `${context}: author input`)
    list(row.excluded, `${context}: exclusions`)
    const exclusions = new Map<string, WriterAgentEvalExclusion>()
    for (const exclusion of row.excluded) {
      record(exclusion, `${context}: exclusion`)
      text(exclusion.id, 'exclusion id', 80); text(exclusion.exact, 'exclusion exact')
      text(exclusion.chapterId, 'exclusion chapter', 256); text(exclusion.reason, 'exclusion reason')
      assert.ok(['future', 'stale', 'injection'].includes(String(exclusion.kind)), 'exclusion kind')
      strings(exclusion.locations, 'exclusion locations')
      assert.ok(exclusion.locations.every(location => ['plan_input', 'retrieval', 'draft_input', 'draft_output'].includes(location)))
      assert.ok(!exclusions.has(exclusion.id), `${context}: duplicate exclusion`)
      if (exclusion.kind === 'stale') {
        assert.ok(stale.some(chapter => chapter.id === exclusion.chapterId && chapter.text.includes(exclusion.exact as string)), 'stale exclusion exists in old source')
        assert.ok(!chapters.some(chapter => chapter.text.includes(exclusion.exact as string)), 'stale exclusion is absent from current source')
      } else {
        const chapter = chapterMap.get(exclusion.chapterId)
        assert.ok(chapter, `${context}: exclusion chapter exists`)
        assert.ok(chapter.text.includes(exclusion.exact), `${context}: exclusion exists in saved chapter`)
        if (exclusion.kind === 'future') assert.ok(chapters.indexOf(chapter) > cutoff, 'future exclusion is after cutoff')
      }
      if (exclusion.locations.includes('plan_input')) assert.ok(!JSON.stringify({ brief: row.brief, tail: target.text }).includes(exclusion.exact), 'excluded plan input absent')
      exclusions.set(exclusion.id, exclusion as unknown as WriterAgentEvalExclusion)
    }
    record(row.expectedMock, `${context}: mock`)
    text(row.expectedMock.planText, `${context}: plan`, WRITER_AGENT_LIMITS.planChars)
    const plan = parseWriterAgentPlan(row.expectedMock.planText)
    strings(row.expectedMock.missingPremiseIds, `${context}: missing premises`, true)
    assert.ok(row.expectedMock.missingPremiseIds.every(id => premiseIds.has(id)))
    strings(row.expectedMock.draftForbiddenMatches, `${context}: mock forbidden matches`, true)
    assert.ok(row.expectedMock.draftForbiddenMatches.every(id => exclusions.get(id)?.locations.includes('draft_output')))
    assert.ok(['draft_ready', 'needs_author_input', 'retrieval_insufficient'].includes(String(row.expectedMock.outcome)))
    if (row.expectedMock.outcome === 'needs_author_input') {
      assert.ok('outcome' in plan && plan.outcome === 'needs_author_input')
      assert.equal(row.requiredPremises.length, 0)
      strings(row.authorInputNeeded, `${context}: abstention requires a concrete unresolved author decision`)
    } else {
      assert.ok('tool' in plan)
      assert.ok(row.requiredPremises.length > 0, `${context}: retrieval must have required anchors`)
    }
    if (row.expectedMock.outcome === 'draft_ready') {
      assert.equal(row.expectedMock.missingPremiseIds.length, 0)
      text(row.expectedMock.draftText, `${context}: draft`, WRITER_AGENT_LIMITS.draftChars)
      validateWriterAgentDraft(row.expectedMock.draftText)
      const draft = row.expectedMock.draftText
      const found = [...exclusions.values()].filter(exclusion => exclusion.locations.includes('draft_output') && draft.includes(exclusion.exact)).map(exclusion => exclusion.id).sort()
      assert.deepEqual(found, [...row.expectedMock.draftForbiddenMatches].sort(), `${context}: negative output controls are explicit`)
    } else {
      assert.equal(row.expectedMock.draftText, null, `${context}: no draft response for abstentions or retrieval misses`)
      assert.equal(row.expectedMock.draftForbiddenMatches.length, 0)
      if (row.expectedMock.outcome === 'retrieval_insufficient') assert.ok(row.expectedMock.missingPremiseIds.length > 0)
    }
  }
  assert.ok(sourceChars <= 20000, `source corpus is bounded: ${sourceChars} UTF-16 units`)
  return value as unknown as WriterAgentEvalFixture
}

export async function loadWriterAgentEvalFixture(): Promise<{ fixture: WriterAgentEvalFixture; sha256: string }> {
  const bytes = await readFile(new URL('../fixtures/writer-agent-quality-v1.json', import.meta.url))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const frozen = (await readFile(new URL('../fixtures/writer-agent-quality-v1.sha256', import.meta.url), 'utf8')).trim()
  assert.match(frozen, /^[a-f0-9]{64}  writer-agent-quality-v1\.json$/)
  assert.equal(sha256, frozen.split(' ')[0], 'frozen Writer Agent evaluation fixture hash')
  return { fixture: await validateWriterAgentEvalFixture(JSON.parse(bytes.toString('utf8'))), sha256 }
}
