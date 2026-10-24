/** Synthetic fixture integrity and real local retrieval. No model-quality claim. */
import assert from 'node:assert/strict'
import type { MemoryEvidence } from '../src/types/memory'
import type { WriterAgentEvalFixture, WriterAgentEvalPremise } from './lib/writer-agent-eval-fixture'

const FROZEN_SHA256 = '1ea222f85ab3fb4809ab3216d72754e24e1101bcbd80bd617d0f1b9c4aa1a222'
const originalFetch = globalThis.fetch
let networkAttempts = 0
globalThis.fetch = async () => {
  networkAttempts++
  throw new Error('Network is forbidden in the Writer Agent evaluation fixture smoke')
}

let stage = 'fixture-load'
const counts = { cases: 0, chapters: 0, premises: 0, retrievals: 0, draftEligibleControls: 0,
  authorInputControls: 0, retrievalMissControls: 0, staleTransitions: 0, rejectedMutations: 0 }
function covers(hit: MemoryEvidence, premise: WriterAgentEvalPremise): boolean {
  return hit.chapterId === premise.chapterId && hit.revision === premise.revision
    && hit.start <= premise.start && hit.end >= premise.end
    && hit.quote.slice(premise.start - hit.start, premise.end - hit.start) === premise.quote
}

try {
  // Install the fetch trap before importing any production module.
  const { loadWriterAgentEvalFixture, validateWriterAgentEvalFixture } = await import('./lib/writer-agent-eval-fixture')
  const { MemoryIndex } = await import('../src/services/memory/engine')
  const { chapterRevision } = await import('../src/services/memory/revision')
  const { parseWriterAgentPlan, WRITER_AGENT_LIMITS } = await import('../src/services/writerAgentProtocol')
  const { fixture, sha256 } = await loadWriterAgentEvalFixture()
  assert.equal(sha256, FROZEN_SHA256, 'Do not silently change the frozen cases and sidecar together')
  assert.equal(fixture.cases.length, 8)

  for (const row of fixture.cases) {
    stage = 'chapter-revisions'
    counts.cases++
    const target = row.project.chapters.find(chapter => chapter.id === row.targetChapterId)!
    assert.equal(row.throughChapterId, row.targetChapterId)
    assert.ok(target.text.length <= WRITER_AGENT_LIMITS.tailChars)
    for (const chapter of [...row.project.chapters, ...(row.staleChapters ?? [])]) {
      assert.equal(await chapterRevision(chapter), chapter.revision)
      counts.chapters++
    }
    for (const premise of row.requiredPremises) {
      const chapter = row.project.chapters.find(item => item.id === premise.chapterId)!
      assert.equal(chapter.text.slice(premise.start, premise.end), premise.quote)
      assert.equal(premise.revision, chapter.revision)
      assert.ok(!target.text.includes(premise.quote), 'Required evidence must not already be supplied in the target tail')
      counts.premises++
    }
    const plan = parseWriterAgentPlan(row.expectedMock.planText)
    if ('outcome' in plan) {
      assert.equal(row.expectedMock.outcome, 'needs_author_input')
      assert.equal(row.requiredPremises.length, 0)
      assert.equal(row.expectedMock.draftText, null)
      assert.ok(row.authorInputNeeded?.length)
      counts.authorInputControls++
      continue
    }

    const index = new MemoryIndex()
    try {
      const query = { text: plan.input.query, throughChapterId: row.throughChapterId, limit: WRITER_AGENT_LIMITS.candidates }
      if (row.staleChapters?.length) {
        stage = 'stale-index-prewarm'
        const oldProject = structuredClone(row.project)
        for (const old of row.staleChapters) oldProject.chapters[oldProject.chapters.findIndex(chapter => chapter.id === old.id)] = old
        await index.sync(oldProject)
        const oldResult = await index.search(query)
        counts.retrievals++
        for (const old of row.staleChapters) {
          assert.ok(oldResult.hits.some(hit => hit.chapterId === old.id && hit.revision === old.revision), 'Old indexed source is genuinely retrievable before replacement')
        }
      }
      stage = 'current-index-retrieval'
      const currentStats = await index.sync(row.project)
      if (row.staleChapters?.length) {
        assert.equal(currentStats.sync.mode, 'incremental')
        assert.equal(currentStats.sync.rebuiltChapters, row.staleChapters.length)
        assert.ok(currentStats.sync.removedDocuments > 0)
        counts.staleTransitions++
      }
      const result = await index.search(query)
      counts.retrievals++
      assert.ok(result.hits.length > 0, 'The miss controls return real distractors, not an empty fabricated result')
      for (const hit of result.hits) {
        const chapter = row.project.chapters.find(item => item.id === hit.chapterId)!
        assert.ok(chapter)
        assert.equal(hit.projectId, row.project.id)
        assert.equal(hit.revision, chapter.revision)
        assert.equal(hit.quote, chapter.text.slice(hit.start, hit.end))
        assert.ok(row.project.chapters.indexOf(chapter) <= row.project.chapters.indexOf(target))
        for (const excluded of row.excluded.filter(item => item.locations.includes('retrieval'))) {
          assert.ok(!hit.quote.includes(excluded.exact), 'Excluded future/old source must not appear in returned evidence')
        }
      }
      const missing = row.requiredPremises.filter(premise => !result.hits.some(hit => covers(hit, premise))).map(premise => premise.id).sort()
      assert.deepEqual(missing, [...row.expectedMock.missingPremiseIds].sort())
      if (row.expectedMock.outcome === 'retrieval_insufficient') {
        assert.ok(missing.length > 0)
        assert.equal(row.expectedMock.draftText, null)
        counts.retrievalMissControls++
      } else {
        assert.equal(row.expectedMock.outcome, 'draft_ready')
        assert.equal(missing.length, 0)
        counts.draftEligibleControls++
      }
      if (row.id === 'q02-separated-premises') {
        assert.equal(new Set(row.requiredPremises.map(premise => premise.chapterId)).size, 2)
        assert.ok(!result.hits.some(hit => row.requiredPremises.every(premise => covers(hit, premise))))
      }
      if (row.id === 'q05-source-injection') {
        assert.equal(row.requiredPremises.length, 2)
        assert.ok(result.hits.some(hit => row.requiredPremises.every(premise => covers(hit, premise))))
        const violations = row.excluded.filter(item => item.locations.includes('draft_output') && row.expectedMock.draftText!.includes(item.exact)).map(item => item.id)
        assert.equal(violations.length, 1)
        assert.deepEqual(violations, row.expectedMock.draftForbiddenMatches)
      }
    } finally { index.invalidateSource() }
  }

  stage = 'mutation-rejections'
  const mutations: Array<(changed: WriterAgentEvalFixture) => void> = [
    changed => { changed.cases.pop() },
    changed => { changed.cases[0]!.project.chapters[0]!.revision = '0'.repeat(64) },
    changed => { changed.cases[0]!.requiredPremises[0]!.end-- },
    changed => { changed.cases[0]!.project.clues.push({} as never) },
    changed => { changed.cases[4]!.expectedMock.draftForbiddenMatches = [] },
    changed => { changed.cases[6]!.expectedMock.draftText = 'MUTANT_DRAFT_AFTER_MISSING_EVIDENCE' },
    changed => { changed.cases[6]!.requiredPremises = [] },
    changed => {
      const chapter = changed.cases[3]!.project.chapters[3]!
      changed.cases[3]!.requiredPremises = [{ id: 'mutant-future-premise', chapterId: chapter.id,
        quote: chapter.text, revision: chapter.revision, start: 0, end: chapter.text.length }]
    },
  ]
  for (const mutate of mutations) {
    const changed = structuredClone(fixture)
    mutate(changed)
    await assert.rejects(validateWriterAgentEvalFixture(changed))
    counts.rejectedMutations++
  }
  stage = 'final-counts'
  assert.equal(counts.cases, 8)
  assert.equal(counts.draftEligibleControls, 5)
  assert.equal(counts.authorInputControls, 1)
  assert.equal(counts.retrievalMissControls, 2)
  assert.equal(counts.staleTransitions, 1)
  assert.equal(counts.rejectedMutations, 8)
  assert.equal(networkAttempts, 0)
  console.log(`✓ Writer Agent evaluation fixture integrity: ${JSON.stringify({ ...counts, networkAttempts })}; no model-quality measurement`)
} catch {
  // Even a failing assertion must not dump full story/response values into CI logs.
  console.error(`Writer Agent evaluation fixture smoke failed at ${stage}; counts=${JSON.stringify({ ...counts, networkAttempts })}`)
  process.exitCode = 1
} finally { globalThis.fetch = originalFetch }
