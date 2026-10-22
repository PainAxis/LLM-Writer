/** Complete-source oracle integration through the real provider JSON parser. No network/model. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { MemoryIndex } from '../src/services/memory/engine.ts'
import { createFrozenSemanticFixture } from './fixtures/memory-semantic-fixture.mjs'

const fixture = createFrozenSemanticFixture()
const originalFetch = globalThis.fetch
const endpoint = 'https://full-scan-fixture.invalid/v1/embeddings'
const options = {
  embedding: { protocol: 'jina', endpoint, model: 'frozen-oracle', apiKey: 'synthetic-test-only', dimensions: 128 },
  fullScan: { maxCalls: 160, maxActiveMs: 65_000 },
}
const passageAxes = new Map(fixture.controlledVectors.passageAxes.map(row => [row.id, row.axes]))
const queryAxes = new Map(fixture.controlledVectors.queryVectors.map(row => [row.query, row.axes]))
const originalSources = new Map(fixture.project.chapters.map(chapter => [chapter.text, chapter]))
let allowedSources = new Set(fixture.project.chapters.map(chapter => chapter.id))
let requests = []
let failureAt = 0
let malformedAt = 0
let beforeResponse
let sourceGuards = 0
const revision = chapter => createHash('sha256').update(JSON.stringify([chapter.title, chapter.text])).digest('hex')
const sourceRevisions = new Map(fixture.project.chapters.map(chapter => [chapter.id, revision(chapter)]))
const handleOf = progress => ({ sessionId: progress.sessionId, generation: progress.generation })

function vector(text, task, dimensions) {
  const axes = task === 'retrieval.query'
    ? queryAxes.get(text) ?? fixture.controlledVectors.negativeQueryAxes
    : passageAxes.get(`passage:${JSON.stringify([originalSources.get(text).id, 0])}`) ?? fixture.controlledVectors.irrelevantPassageAxes
  return Array.from({ length: dimensions }, (_, index) => Number(axes.includes(index)))
}

globalThis.fetch = async (url, init) => {
  assert.equal(String(url), endpoint, 'Only the in-process fixture endpoint is permitted')
  const body = JSON.parse(String(init?.body))
  assert.ok(['retrieval.query', 'retrieval.passage'].includes(body.task))
  assert.ok(Array.isArray(body.input) && body.input.length > 0 && body.input.length <= 32)
  const sourceIds = []
  if (body.task === 'retrieval.passage') {
    for (const text of body.input) {
      const source = originalSources.get(text)
      assert.ok(source, 'Every outbound passage must be an exact frozen current source')
      assert.ok(allowedSources.has(source.id), 'No cached or uncached undisclosed source may be sent')
      sourceIds.push(source.id)
    }
  } else assert.equal(body.input.length, 1)
  const record = { task: body.task, items: body.input.length, chars: body.input.reduce((n, text) => n + text.length, 0), sourceIds }
  requests.push(record)
  await beforeResponse?.({ record, body, signal: init?.signal })
  if (requests.length === failureAt) return new Response('Synthetic provider failure; no credentials retained', { status: 500 })
  const data = body.input.map((text, index) => ({ index, embedding: vector(text, body.task, body.dimensions) }))
  if (requests.length === malformedAt) data[data.length - 1].embedding = [Number.NaN]
  // Reverse provider rows to verify index mapping, not order-dependent fixture behavior.
  return Response.json({ data: data.reverse() })
}

async function guard() { sourceGuards++; }
function exactSources(result, project = fixture.project, cutoff = project.chapters.length) {
  for (const hit of result.hits) {
    const chapter = project.chapters[hit.ordinal - 1]
    assert.ok(chapter && hit.ordinal <= cutoff)
    assert.equal(hit.projectId, project.id)
    assert.equal(hit.chapterId, chapter.id)
    assert.equal(hit.revision, revision(chapter))
    assert.equal(hit.quote, chapter.text.slice(hit.start, hit.end))
    assert.equal(hit.match.answerability, 'unverified')
  }
  assert.equal(result.assessment.answerability, 'unverified')
}
function hasPremise(hits, premise) {
  return hits.some(hit => hit.projectId === premise.projectId && hit.chapterId === premise.chapterId
    && hit.revision === premise.revision && hit.start <= premise.start && hit.end >= premise.end
    && hit.quote.slice(premise.start - hit.start, premise.end - hit.start) === premise.quote)
}
async function start(index, item, remote = options) {
  const previousCalls = requests.length
  const page = await index.startFullScan({ text: item.query, throughChapterId: item.throughChapterId, limit: item.limit ?? 8 }, remote)
  assert.equal(page.state, 'ready')
  assert.equal(requests.length, previousCalls, 'Planning requires zero provider calls')
  assert.equal(page.progress.scoredPassages, 0)
  assert.ok(!('hits' in page) && !('result' in page), 'A plan contains no selectable evidence')
  return page
}
async function finish(index, page, pauseDecision) {
  let current = page
  let grantNumber = 0
  for (let iterations = 0; iterations < 1000; iterations++) {
    const handle = handleOf(current.progress)
    if (current.state === 'complete') return current.result
    if (current.state === 'ready') {
      current = await index.resumeFullScan({ ...handle, grantId: `start-${randomUUID()}`, addCalls: 0, addActiveMs: 0 }, guard)
    } else if (current.state === 'page-complete') {
      current = await index.advanceFullScan(handle, guard)
    } else {
      assert.ok(pauseDecision, `Unexpected ${current.state}`)
      const additions = await pauseDecision(current)
      current = await index.resumeFullScan({ ...handle, grantId: `retry-${++grantNumber}`, ...additions }, guard)
    }
    assert.ok(current.progress.callsAttempted <= current.progress.callsApproved)
    assert.ok(current.progress.scoredPassages <= current.progress.eligiblePassages)
    if (current.state !== 'complete') assert.ok(!('result' in current), 'Partial pages cannot expose final evidence')
  }
  throw new Error('Finite scan page limit exceeded')
}
function assertComplete(result, calls, passages = 4096) {
  assert.equal(result.method, 'bm25+clues+semantic')
  assert.equal(result.diagnostics.fullScan.status, 'complete')
  assert.equal(result.diagnostics.fullScan.coverage, 'complete')
  assert.equal(result.diagnostics.fullScan.scoredPassages, passages)
  assert.equal(result.diagnostics.fullScan.callsAttempted, calls)
  assert.equal(requests.length, calls)
  assert.equal(requests.filter(row => row.task === 'retrieval.query').length, 1)
  assert.equal(new Set(requests.flatMap(row => row.sourceIds)).size, requests.filter(row => row.task === 'retrieval.passage').reduce((n, row) => n + row.items, 0), 'No duplicate passage transmissions in a successful scan')
}

try {
  const index = new MemoryIndex()
  const stats = await index.sync(structuredClone(fixture.project))
  assert.equal(stats.chunks, 4096)
  for (const chapter of stats.chapters) assert.equal(chapter.revision, sourceRevisions.get(chapter.id))
  const probe = fixture.cases.find(item => item.id === 'eval-single-1-1')
  requests = []
  const defaultFallback = await index.search({ text: probe.query, throughChapterId: probe.throughChapterId }, { embedding: options.embedding })
  assert.equal(defaultFallback.diagnostics.semantic, 'fallback')
  assert.equal(requests.length, 0)
  const direct = await index.search({ text: probe.query, throughChapterId: probe.throughChapterId }, options, guard)
  assert.equal(requests.length, 0, 'Direct search has no author decision callback; it must not auto-start')
  assert.equal(direct.diagnostics.fullScan.status, 'stopped-local')
  console.log('✓ Default over-capacity fallback and callback-free explicit plan make zero provider calls')

  let independent = 0
  let premises = 0
  for (const item of fixture.cases.filter(item => item.group.startsWith('evaluation'))) {
    await index.search({ text: '', throughChapterId: item.throughChapterId }) // Public disable path clears vectors.
    requests = []
    sourceGuards = 0
    const cold = await finish(index, await start(index, item))
    assertComplete(cold, 129)
    assert.equal(sourceGuards, 129)
    exactSources(cold)
    for (const expected of item.premises) {
      assert.ok(hasPremise(cold.hits.slice(0, 5), expected), `${item.id}: all required exact sources must reach Top-5`)
      premises++
    }
    requests = []
    sourceGuards = 0
    const plan = await start(index, item)
    assert.equal(plan.progress.cachedPassages, 2000)
    assert.equal(plan.progress.currentEstimatedCalls, 67)
    const warm = await finish(index, plan)
    assertComplete(warm, 67)
    assert.equal(sourceGuards, 67)
    assert.deepEqual(warm.hits, cold.hits, 'Cache residency must not change scores, ranks, sources or match signals')
    assert.equal(warm.diagnostics.fullScan.scoredCachedPassages, 2000)
    independent++
  }
  assert.equal(independent, 46)
  assert.equal(premises, 62)
  console.log('✓ All 46 unchanged independent probes / 62 premises pass cold and warm real-adapter scans; 129/67 calls')

  for (const item of fixture.cases.filter(item => !item.group.startsWith('evaluation'))) {
    requests = []
    const local = await index.search({ text: item.query, throughChapterId: item.throughChapterId, limit: item.limit })
    const result = await finish(index, await start(index, item))
    exactSources(result)
    if (item.group.startsWith('protocol')) for (const expected of item.premises) assert.ok(hasPremise(result.hits, expected), item.id)
    if (item.group === 'local-channel-regression') assert.deepEqual(result.hits, local.hits, 'Existing local code/clue ordering cannot be trimmed or changed')
    if (item.group === 'negative-synthetic-construction') assert.equal(result.hits.length, 0)
  }
  console.log('✓ Separate protocol positives, exact-code/clue regressions and closed-fixture negatives retain their own denominators')

  await index.search({ text: '', throughChapterId: probe.throughChapterId })
  requests = []
  failureAt = 3 // Query + first passage batch complete, then fail the next batch.
  let observedFailure = false
  const retried = await finish(index, await start(index, probe), page => {
    assert.equal(page.state, 'paused-provider')
    assert.equal(page.progress.scoredPassages, 32)
    assert.equal(page.progress.embeddedPassages, 32)
    assert.equal(page.progress.callsAttempted, 3)
    observedFailure = true
    failureAt = 0
    return { addCalls: 0, addActiveMs: 0 }
  })
  assert.ok(observedFailure)
  assert.equal(retried.diagnostics.fullScan.callsAttempted, 130)
  assert.equal(requests.length, 130)
  assert.equal(retried.diagnostics.fullScan.scoredPassages, 4096)
  exactSources(retried)
  console.log('✓ A real adapter middle-batch failure pauses; explicit retry consumes another call without duplicate accepted coverage')

  await index.search({ text: '', throughChapterId: probe.throughChapterId })
  requests = []
  malformedAt = 3
  const malformed = await finish(index, await start(index, probe), page => {
    assert.equal(page.state, 'paused-provider')
    assert.equal(page.progress.scoredPassages, 32, 'One malformed JSON vector rejects the entire second batch')
    assert.equal(page.progress.embeddedPassages, 32)
    malformedAt = 0
    return { addCalls: 0, addActiveMs: 0 }
  })
  assert.equal(malformed.diagnostics.fullScan.callsAttempted, 130)
  exactSources(malformed)
  console.log('✓ A malformed real JSON middle batch is atomic; retry does not accept its earlier valid rows twice')

  await index.search({ text: '', throughChapterId: probe.throughChapterId })
  requests = []
  beforeResponse = async ({ record }) => { if (record.task === 'retrieval.passage') index.invalidateSource() }
  await assert.rejects(finish(index, await start(index, probe)), /取消|失效|变化|替代|重新/)
  beforeResponse = undefined
  await index.sync(structuredClone(fixture.project))
  const afterInvalidation = await start(index, probe)
  assert.equal(afterInvalidation.progress.cachedPassages, 0, 'An invalidated in-flight adapter response cannot populate cache')
  index.cancelFullScan(handleOf(afterInvalidation.progress))
  console.log('✓ Source invalidation during an actual adapter response settles and cannot publish or cache the late batch')

  const narrow = structuredClone(fixture.project)
  narrow.chapters = narrow.chapters.slice(0, 2000)
  narrow.clues = narrow.clues.filter(clue => narrow.chapters.some(chapter => chapter.id === clue.chapterId))
  await index.sync(narrow)
  allowedSources = new Set(narrow.chapters.map(chapter => chapter.id))
  const smallQuery = { text: probe.query, throughChapterId: narrow.chapters.at(-1).id, limit: 8 }
  requests = []
  const ordinary = await index.search(smallQuery, { embedding: options.embedding }, guard)
  requests = []
  const small = await finish(index, await start(index, { query: probe.query, throughChapterId: smallQuery.throughChapterId }))
  assert.deepEqual(small.hits, ordinary.hits)
  exactSources(small, narrow)
  assert.ok(requests.flatMap(row => row.sourceIds).every(id => allowedSources.has(id)))
  console.log('✓ Explicit small-range scan preserves ordinary semantic fusion and excludes cached future sources after narrowing')
} finally {
  globalThis.fetch = originalFetch
}
