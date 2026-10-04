import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { MemoryIndex } from '../src/services/memory/engine'
import type { MemoryIndexStats, MemoryProjectInput, MemoryRemoteOptions, MemorySearchResult } from '../src/types/memory'
import { createStressNovel } from './fixtures/memory-stress-corpus'

/** Engineering soak through the real HTTP adapter. Hash vectors are NOT a language model or a quality benchmark. */
const DIMENSIONS = 512
const QUERY_COUNT = Number(process.env.MEMORY_STRESS_QUERIES ?? 80)
const BATCH_DELAY_MS = Number(process.env.MEMORY_STRESS_BATCH_DELAY_MS ?? 25)
assert.ok(Number.isInteger(QUERY_COUNT) && QUERY_COUNT >= 80 && QUERY_COUNT <= 200)
assert.ok(Number.isFinite(BATCH_DELAY_MS) && BATCH_DELAY_MS >= 0 && BATCH_DELAY_MS <= 100)

interface Body { input?: string[]; task?: string; dimensions?: number; documents?: string[]; query?: string }
interface RequestLog {
  kind: 'passage' | 'query' | 'rerank'
  items: number
  requestBytes: number
  responseBytes: number
  fault?: string
  completed: boolean
  sourceChapterIds: string[]
}
type Fault = '429' | '500' | 'dimensions' | 'truncated-json' | 'rerank-index' | 'hold'
interface FaultPlan { kind: RequestLog['kind']; nth: number; fault: Fault; entered?: () => void; release?: Promise<void> }
interface Measurement {
  name: string
  syncMs: number
  searchMs: number
  totalMs: number
  chars: number
  passages: number
  heapMiB: number
  rssMiB: number
  requests: number
  requestBytes: number
  responseBytes: number
  diagnostics: MemorySearchResult['diagnostics']
}

const logs: RequestLog[] = []
const violations: string[] = []
const measurements: Measurement[] = []
const checks: Array<{ name: string; details: Record<string, unknown> }> = []
let faultPlan: FaultPlan | undefined
let faultSeen = 0
let latency = 0
let maximumHeap = 0
let maximumRss = 0
let corpusManifest: Record<string, unknown> | undefined
let scope: { project: MemoryProjectInput; cutoff: number } | undefined
let guardProject: MemoryProjectInput | undefined
const sourceLocations = new Map<string, number[]>()

function sampleMemory() {
  const memory = process.memoryUsage()
  maximumHeap = Math.max(maximumHeap, memory.heapUsed)
  maximumRss = Math.max(maximumRss, memory.rss)
  return { heapMiB: memory.heapUsed / 1024 ** 2, rssMiB: memory.rss / 1024 ** 2 }
}

function setScope(project: MemoryProjectInput, cutoff: number) {
  if (guardProject !== project) sourceLocations.clear()
  guardProject = project
  scope = { project, cutoff }
}

function assertPayload(texts: string[]) {
  assert.ok(scope, 'every outbound document must belong to an active disclosure scope')
  const chapterIds = new Set<string>()
  for (const text of texts) {
    let locations = sourceLocations.get(text)
    if (!locations) {
      locations = scope.project.chapters.flatMap((chapter, i) => chapter.text.includes(text) ? [i + 1] : [])
      sourceLocations.set(text, locations)
    }
    assert.ok(locations.some(ordinal => ordinal <= scope!.cutoff), 'outbound document must be an exact quote from a currently disclosed chapter')
    locations.filter(ordinal => ordinal <= scope!.cutoff).forEach(ordinal => chapterIds.add(scope!.project.chapters[ordinal - 1]!.id))
  }
  return [...chapterIds]
}

/** Signed feature hashing over the actual input, with deterministic small dense values (realistic JSON size). */
function vector(text: string): number[] {
  const result = Array.from({ length: DIMENSIONS }, (_, i) => ((i * 104729 % 997) + 1) / 997000)
  const chars = Array.from(text.toLowerCase().replace(/\s+/gu, ''))
  for (let i = 0; i + 1 < chars.length; i++) {
    const pair = `${chars[i]}${chars[i + 1]}`
    let hash = 2166136261
    for (let p = 0; p < pair.length; p++) hash = Math.imul(hash ^ pair.charCodeAt(p), 16777619) >>> 0
    result[hash % DIMENSIONS]! += ((hash >>> 9) & 1) ? 1 : -1
  }
  const norm = Math.sqrt(result.reduce((sum, item) => sum + item * item, 0))
  return result.map(item => Math.round(item / norm * 10000000) / 10000000)
}

function rerankScore(query: string, text: string): number {
  // Generic literal/bigram overlap, no access to fixture answers or chapter IDs.
  const chars = Array.from(query.toLowerCase())
  const grams = new Set(chars.slice(1).map((char, i) => `${chars[i]}${char}`))
  const overlap = [...grams].filter(gram => text.toLowerCase().includes(gram)).length
  return (text.includes(query) ? 1 : 0) + overlap / Math.max(1, grams.size)
}

const server = createServer(async (request, response) => {
  let item: RequestLog | undefined
  try {
    const parts: Buffer[] = []
    for await (const part of request) parts.push(Buffer.from(part))
    const raw = Buffer.concat(parts)
    const body = JSON.parse(raw.toString('utf8')) as Body
    const kind = body.documents ? 'rerank' : body.task === 'retrieval.passage' ? 'passage' : 'query'
    const inputs = body.documents ?? body.input!
    assert.ok(Array.isArray(inputs) && inputs.every(text => typeof text === 'string'))
    assert.ok(inputs.length <= (kind === 'rerank' ? 60 : 32), 'production request batch limit')
    const sourceChapterIds = kind !== 'query' ? assertPayload(inputs) : []
    if (kind !== 'rerank') assert.equal(body.dimensions, DIMENSIONS)
    item = { kind, items: inputs.length, requestBytes: raw.byteLength, responseBytes: 0, completed: false, sourceChapterIds }
    logs.push(item)
    let injected: FaultPlan | undefined
    if (faultPlan && kind === faultPlan.kind && ++faultSeen === faultPlan.nth) injected = faultPlan
    if (injected) {
      item.fault = injected.fault
      injected.entered?.()
      if (injected.fault === 'hold') await injected.release
    }
    if (latency) await delay(latency)
    if (response.destroyed) return
    let payload: string
    if (injected?.fault === '429' || injected?.fault === '500') {
      response.statusCode = Number(injected.fault)
      payload = 'synthetic provider private failure; never expose this body'
    } else if (injected?.fault === 'truncated-json') {
      payload = '{"data":[{"index":0,"embedding":['
    } else if (kind === 'rerank') {
      payload = JSON.stringify({ results: inputs.map((text, index) => ({ index: injected?.fault === 'rerank-index' ? inputs.length : index, relevance_score: rerankScore(body.query!, text) })).reverse() })
    } else {
      payload = JSON.stringify({ data: inputs.map((text, index) => ({
        index, embedding: injected?.fault === 'dimensions' ? vector(text).slice(0, -1) : vector(text),
      })).reverse() })
    }
    item.responseBytes = Buffer.byteLength(payload)
    response.setHeader('Content-Type', 'application/json')
    response.end(payload)
    item.completed = true
    sampleMemory()
  } catch (error) {
    violations.push(error instanceof Error ? error.message : String(error))
    response.statusCode = 400
    response.end('synthetic test server assertion failed')
  }
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const origin = `http://127.0.0.1:${address.port}`
const options: MemoryRemoteOptions = {
  embedding: { protocol: 'jina', endpoint: `${origin}/v1/embeddings`, model: 'engineering-feature-hash-512', apiKey: 'local-synthetic-test-only', dimensions: DIMENSIONS },
  rerank: { endpoint: `${origin}/v1/rerank`, model: 'engineering-bigram-overlap', apiKey: 'local-synthetic-test-only' },
}

function injected(fault: Fault, nth = 1, kind: RequestLog['kind'] = 'passage') {
  faultSeen = 0
  faultPlan = { fault, nth, kind }
}

function verifyResult(result: MemorySearchResult, project: MemoryProjectInput, stats: MemoryIndexStats, cutoff: number) {
  assert.equal(result.fingerprint, stats.fingerprint)
  assert.equal(result.projectId, project.id)
  assert.equal(result.throughChapterId, project.chapters[cutoff - 1]!.id)
  const manifests = new Map(stats.chapters.map(chapter => [chapter.id, chapter]))
  for (const hit of result.hits) {
    const position = project.chapters.findIndex(chapter => chapter.id === hit.chapterId)
    const chapter = project.chapters[position]!
    assert.ok(position >= 0 && position < cutoff)
    assert.equal(hit.ordinal, position + 1)
    assert.equal(hit.projectId, project.id)
    assert.equal(hit.revision, manifests.get(hit.chapterId)!.revision)
    assert.equal(chapter.text.slice(hit.start, hit.end), hit.quote)
  }
  assert.ok(!JSON.stringify(result).includes('synthetic provider private failure'))
  assert.deepEqual(violations, [], 'HTTP payload disclosure/source checks')
}

async function run(index: MemoryIndex, project: MemoryProjectInput, cutoff: number, text: string, name: string, remote = options) {
  const started = performance.now()
  const fromRequest = logs.length
  // Mirror MemoryLab's fresh-read/sync-before-search lifecycle, including clone and validation cost.
  const freshSnapshot = structuredClone(project)
  const stats = await index.sync(freshSnapshot)
  const syncMs = performance.now() - started
  setScope(project, cutoff)
  const searched = performance.now()
  const result = await index.search({ text, throughChapterId: project.chapters[cutoff - 1]!.id, limit: 12 }, remote)
  const searchMs = performance.now() - searched
  verifyResult(result, project, stats, cutoff)
  const currentRequests = logs.slice(fromRequest)
  if (result.diagnostics.semantic === 'used') {
    assert.equal(currentRequests.filter(request => request.kind === 'passage' && request.completed && !request.fault).reduce((sum, request) => sum + request.items, 0), result.diagnostics.embeddedPassages, 'claimed embeddings must match completed valid HTTP response items')
  }
  measurements.push({ name, syncMs, searchMs, totalMs: performance.now() - started,
    chars: stats.chars, passages: stats.chunks, ...sampleMemory(), requests: currentRequests.length,
    requestBytes: currentRequests.reduce((sum, request) => sum + request.requestBytes, 0),
    responseBytes: currentRequests.reduce((sum, request) => sum + request.responseBytes, 0), diagnostics: result.diagnostics })
  return { result, stats, requests: currentRequests }
}

function hybrid(result: MemorySearchResult) {
  assert.equal(result.diagnostics.semantic, 'used', 'never report fallback as semantic success')
  assert.equal(result.method, 'bm25+clues+semantic')
  assert.equal(result.diagnostics.rerank, 'used')
  assert.ok(result.diagnostics.rerankedCandidates > 0)
  assert.equal(result.diagnostics.cachedPassages + result.diagnostics.embeddedPassages, result.diagnostics.eligiblePassages)
}

function checkpoint(name: string, details: Record<string, unknown> = {}) {
  checks.push({ name, details })
  console.log(`✓ ${name} ${JSON.stringify(details)}`)
}

function percentile(values: number[], percent: number) {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * percent) - 1)] ?? 0
}

const started = performance.now()
let reportStatus = 'failed'
try {
  const fixture = await createStressNovel({ chapters: 600, charsPerChapter: 2200, projectId: 'stress-hybrid-main' })
  corpusManifest = fixture.manifest
  let project = fixture.project
  const index = new MemoryIndex()
  // Probe exact original phrases so positive checks are independent from model quality.
  const probe = (chapter = 0) => project.chapters[chapter]!.text.split(/[。！？\n]/u).find(line => line.trim().length >= 8)!.slice(0, 32)
  latency = BATCH_DELAY_MS
  const cold = await run(index, project, project.chapters.length, probe(), 'cold-full-with-synthetic-latency')
  hybrid(cold.result)
  assert.ok(cold.stats.chars >= 1_300_000)
  assert.ok(cold.stats.chunks > 1000 && cold.stats.chunks <= 2000, `measured semantic scope ${cold.stats.chunks} must fit the production limit`)
  assert.equal(cold.result.diagnostics.embeddedPassages, cold.stats.chunks)
  assert.equal(cold.result.diagnostics.cachedPassages, 0)
  assert.ok(cold.result.hits.some(hit => hit.quote.includes(probe())))
  checkpoint('full cold hybrid retrieval', { chars: cold.stats.chars, utf8Bytes: Buffer.byteLength(project.chapters.map(chapter => chapter.text).join('')), chapters: project.chapters.length, passages: cold.stats.chunks, dimensions: DIMENSIONS, latencyPerHttpRequestMs: latency })
  latency = 0
  let positiveChecks = 0
  for (let i = 0; i < QUERY_COUNT; i++) {
    const cutoff = [60, 150, 300, 450, 600][i % 5]!
    const chapterIndex = (i * 37) % cutoff
    const target = i % 4 === 0
      ? fixture.clues.filter(clue => clue.ordinal <= cutoff)[Math.floor(chapterIndex / 2)]!
      : fixture.facts[chapterIndex]!
    const text = target.query
    const query = await run(index, project, cutoff, text, `warm-session-${i + 1}`)
    hybrid(query.result)
    assert.equal(query.result.diagnostics.embeddedPassages, 0)
    assert.equal(query.result.diagnostics.cachedPassages, query.result.diagnostics.eligiblePassages)
    assert.equal(query.requests.filter(request => request.kind === 'passage').length, 0)
    assert.ok(query.result.hits.some(hit => hit.chapterId === target.chapterId && hit.quote.includes(target.quote)), 'known exact fact or distant clue source must remain retrievable')
    positiveChecks++
    if ((i + 1) % 5 === 0) console.log(`  ${i + 1}/${QUERY_COUNT} fresh-source sync + warm queries checked`)
    if ((i + 1) % 20 === 0) {
      await mkdir('artifacts/memory-stress', { recursive: true })
      await writeFile('artifacts/memory-stress/hybrid-progress.json', `${JSON.stringify({ status: 'in-progress', completedWarmQueries: i + 1, elapsedMs: performance.now() - started, measurements }, null, 2)}\n`)
    }
  }
  checkpoint('long interactive warm session and narrowing disclosure', { queries: QUERY_COUNT, factAndCluePositiveChecks: positiveChecks, clueQueries: Math.ceil(QUERY_COUNT / 4), allRequestsSourceValidated: true })
  for (const secret of fixture.futureSecrets.slice(0, 4)) {
    const before = await run(index, project, secret.ordinal - 1, secret.query, `future-secret-hidden-${secret.ordinal}`)
    hybrid(before.result)
    assert.ok(before.result.hits.every(hit => !hit.quote.includes(secret.query)))
    const disclosed = await run(index, project, secret.ordinal, secret.query, `future-secret-revealed-${secret.ordinal}`)
    hybrid(disclosed.result)
    assert.ok(disclosed.result.hits.some(hit => hit.quote.includes(secret.quote)))
  }
  checkpoint('previously cached future identities stay hidden until their own chapter', { secretPairs: 4 })

  const beforeEdit = project
  project = structuredClone(project)
  const editedIds = new Set<string>()
  for (const target of fixture.editTargets.slice(0, 20)) {
    const chapter = project.chapters.find(chapter => chapter.id === target.chapterId)!
    editedIds.add(chapter.id)
    chapter.text = chapter.text.replaceAll(target.oldValue, target.replacementValue)
  }
  const edited = await run(index, project, 600, fixture.editTargets[0]!.replacementValue, 'twenty-old-chapters-revised')
  hybrid(edited.result)
  assert.ok(edited.result.hits.some(hit => hit.quote.includes(fixture.editTargets[0]!.replacementValue)))
  assert.equal(edited.stats.staleClues, 20)
  assert.ok(edited.result.diagnostics.embeddedPassages >= 40 && edited.result.diagnostics.embeddedPassages <= 80)
  assert.equal(edited.result.diagnostics.cachedPassages + edited.result.diagnostics.embeddedPassages, edited.result.diagnostics.eligiblePassages)
  // Captured request counts plus diagnostics prove unchanged spans were not re-embedded.
  const changedChunks = edited.stats.chunks - edited.result.diagnostics.cachedPassages
  assert.equal(edited.result.diagnostics.embeddedPassages, changedChunks)
  assert.equal(edited.requests.filter(request => request.kind === 'passage').reduce((sum, request) => sum + request.items, 0), changedChunks)
  assert.ok(edited.requests.filter(request => request.kind === 'passage').every(request => request.sourceChapterIds.every(id => editedIds.has(id))), 'only changed chapters may be re-embedded, including all spans under each changed chapter hash')
  for (const chapterId of editedIds) {
    assert.notEqual(edited.stats.chapters.find(chapter => chapter.id === chapterId)!.revision, cold.stats.chapters.find(chapter => chapter.id === chapterId)!.revision)
  }
  checkpoint('twenty edited old chapters invalidate source revisions', { editedChapters: 20, reembeddedPassages: changedChunks, reusedPassages: edited.result.diagnostics.cachedPassages, staleClues: edited.stats.staleClues })
  const oldFact = await run(index, project, 600, fixture.editTargets[0]!.oldValue, 'old-fact-after-twenty-edits')
  hybrid(oldFact.result)
  assert.ok(oldFact.result.hits.every(hit => !hit.quote.includes(fixture.editTargets[0]!.oldValue)))

  const tail = project.chapters.splice(500, 1)[0]!
  project = { ...project, chapters: [tail, ...project.chapters] }
  const reordered = await run(index, project, 100, tail.text.slice(0, 28), 'reordered-narrative-cutoff')
  hybrid(reordered.result)
  assert.equal(reordered.result.diagnostics.embeddedPassages, 0)
  assert.ok(reordered.result.hits.some(hit => hit.chapterId === tail.id && hit.ordinal === 1))
  project = { ...project, chapters: project.chapters.filter((_, i) => i < 590) }
  const deleted = await run(index, project, 590, probe(), 'delete-ten-chapters')
  hybrid(deleted.result)
  assert.equal(deleted.result.diagnostics.embeddedPassages, 0)
  await assert.rejects(index.search({ text: '删除检查', throughChapterId: 'nonexistent-chapter' }, options), /截止章节不存在/)
  const existingIds = new Set(project.chapters.map(chapter => chapter.id))
  const regrown = { ...project, chapters: [...project.chapters, ...beforeEdit.chapters.filter(chapter => !existingIds.has(chapter.id))] }
  const grown = await run(index, regrown, 600, probe(), 'append-ten-chapters')
  hybrid(grown.result)
  assert.equal(grown.result.diagnostics.embeddedPassages, cold.stats.chunks - deleted.stats.chunks)
  assert.equal(grown.result.diagnostics.cachedPassages, deleted.stats.chunks)
  const other = { ...project, id: 'stress-hybrid-independent-project' }
  const switched = await run(index, other, 60, probe(), 'same-manuscript-different-project')
  hybrid(switched.result)
  assert.equal(switched.result.diagnostics.cachedPassages, 0)
  assert.equal(switched.result.diagnostics.embeddedPassages, switched.result.diagnostics.eligiblePassages)
  checkpoint('chapter reorder/delete/growth and project isolation', { remainingChapters: project.chapters.length, readdedChapters: 10, readdedPassages: grown.result.diagnostics.embeddedPassages, projectSwitchEmbedded: switched.result.diagnostics.embeddedPassages })

  for (const fault of ['429', '500', 'dimensions', 'truncated-json'] as const) {
    const faultIndex = new MemoryIndex()
    injected(fault)
    const failure = await run(faultIndex, project, 60, probe(), `provider-${fault}`)
    assert.equal(failure.result.diagnostics.semantic, 'fallback')
    assert.equal(failure.result.diagnostics.embeddedPassages, 0)
    assert.ok(failure.result.hits.some(hit => hit.quote.includes(probe())))
    faultPlan = undefined
    const recovery = await run(faultIndex, project, 60, probe(), `provider-${fault}-recovery`)
    hybrid(recovery.result)
    assert.equal(recovery.result.diagnostics.cachedPassages, 0, 'invalid first response must never poison the cache')
    assert.equal(recovery.result.diagnostics.embeddedPassages, recovery.result.diagnostics.eligiblePassages)
  }
  checkpoint('HTTP failures and malformed responses recover without cache poisoning', { failures: ['429', '500', 'dimensions', 'truncated-json'], exactLocalEvidenceRetained: true })

  const partialIndex = new MemoryIndex()
  injected('500', 19)
  const partial = await run(partialIndex, project, 590, probe(), 'late-batch-failure')
  assert.equal(partial.result.diagnostics.semantic, 'fallback')
  assert.equal(partial.result.diagnostics.embeddedPassages, 18 * 32)
  faultPlan = undefined
  const resumed = await run(partialIndex, project, 590, probe(), 'late-batch-resume')
  hybrid(resumed.result)
  assert.equal(resumed.result.diagnostics.cachedPassages, partial.result.diagnostics.embeddedPassages)
  assert.equal(resumed.result.diagnostics.embeddedPassages + resumed.result.diagnostics.cachedPassages, resumed.result.diagnostics.eligiblePassages)
  checkpoint('late batch failure resumes the validated partial cache', { failedBatch: 19, retainedPassages: resumed.result.diagnostics.cachedPassages, resumedPassages: resumed.result.diagnostics.embeddedPassages })
  for (const fault of ['500', 'rerank-index'] as const) {
    injected(fault, 1, 'rerank')
    const failedRerank = await run(partialIndex, project, 590, probe(), `rerank-${fault}`)
    assert.equal(failedRerank.result.diagnostics.semantic, 'used')
    assert.equal(failedRerank.result.diagnostics.rerank, 'fallback')
    assert.ok(failedRerank.result.hits.every(hit => !hit.reason.includes('远程重排')))
    assert.ok(failedRerank.result.hits.some(hit => hit.quote.includes(probe())))
    faultPlan = undefined
  }
  const rerankRecovered = await run(partialIndex, project, 590, probe(), 'rerank-recovery')
  hybrid(rerankRecovered.result)
  assert.equal(rerankRecovered.result.diagnostics.embeddedPassages, 0)
  checkpoint('HTTP and index-mapping rerank failures retain verified hybrid evidence', { invalidResponses: ['500', 'out-of-range indexes'], candidateCap: 60 })

  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  const cancelledIndex = new MemoryIndex()
  await cancelledIndex.sync(project)
  setScope(project, 590)
  faultSeen = 0
  faultPlan = { kind: 'passage', nth: 1, fault: 'hold', entered: enter, release: held }
  const pending = cancelledIndex.search({ text: probe(), throughChapterId: project.chapters[589]!.id }, options)
  const rejected = assert.rejects(pending, /快照已变化|新的请求/)
  await entered
  await cancelledIndex.sync(beforeEdit)
  release()
  await rejected
  faultPlan = undefined
  const afterCancel = await run(cancelledIndex, beforeEdit, 60, beforeEdit.chapters[0]!.text.slice(0, 28), 'cancelled-request-new-snapshot')
  hybrid(afterCancel.result)
  assert.equal(afterCancel.result.diagnostics.cachedPassages, 0)
  checkpoint('source sync aborts an actual in-flight HTTP request', { delayedResponseCannotPopulateCache: true })

  // Only the production 65-second overall timer is accelerated; this is a control-flow test, not latency data.
  const budgetIndex = new MemoryIndex()
  const nativeTimeout = globalThis.setTimeout
  latency = 10
  globalThis.setTimeout = new Proxy(nativeTimeout, { apply(target, thisArgument, args) {
    if (args[1] === 65_000) args[1] = 350
    return Reflect.apply(target, thisArgument, args)
  } })
  let budget: Awaited<ReturnType<typeof run>>
  try {
    budget = await run(budgetIndex, project, 590, probe(), 'accelerated-total-budget-control-flow')
  } finally {
    globalThis.setTimeout = nativeTimeout
    latency = 0
  }
  assert.equal(budget.result.diagnostics.semantic, 'fallback')
  assert.ok(budget.result.diagnostics.embeddedPassages > 0 && budget.result.diagnostics.embeddedPassages < budget.result.diagnostics.eligiblePassages)
  const afterBudget = await run(budgetIndex, project, 590, probe(), 'budget-partial-cache-resume')
  hybrid(afterBudget.result)
  assert.equal(afterBudget.result.diagnostics.cachedPassages, budget.result.diagnostics.embeddedPassages)
  checkpoint('overall budget stops later batches and resumes only valid vectors', { productionBudgetMs: 65000, acceleratedTimerMs: 350, completedBeforeAbort: budget.result.diagnostics.embeddedPassages, measuredLatencyBenchmark: false })

  const oversized = await createStressNovel({ chapters: 1100, charsPerChapter: 2200, projectId: 'stress-hybrid-over-limit' })
  const overLimit = await run(new MemoryIndex(), oversized.project, 1100, oversized.project.chapters[0]!.text.slice(0, 28), 'over-semantic-capability-limit')
  assert.ok(overLimit.stats.chunks > 2000)
  assert.equal(overLimit.result.diagnostics.semantic, 'fallback')
  assert.equal(overLimit.requests.filter(request => request.kind === 'passage' || request.kind === 'query').length, 0)
  assert.ok(overLimit.result.diagnostics.warnings.some(warning => warning.includes('2,000')))
  assert.ok(overLimit.result.hits.length > 0)
  checkpoint('capability boundary is explicit fallback, not semantic success', { chars: overLimit.stats.chars, passages: overLimit.stats.chunks, semanticSupported: false, outboundEmbeddingRequests: 0, rerank: overLimit.result.diagnostics.rerank })
  assert.deepEqual(violations, [])
  reportStatus = 'passed'
} finally {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  const warm = measurements.filter(item => item.name.startsWith('warm-session-'))
  const report = {
    status: reportStatus, elapsedMs: performance.now() - started,
    method: 'Production MemoryIndex and provider adapters; real loopback HTTP; deterministic 512-dimensional feature-hash embedding and literal/bigram reranker.',
    limitations: ['Synthetic mixed Chinese/English prose, not a human-authored production novel.', 'Hash vectors and lexical reranking cannot establish paid-model semantic recall or relevance quality.', 'Node execution excludes browser IndexedDB hydration, Worker messaging and rendering.', 'Warm timings include structuredClone and MemoryIndex.sync source validation before every query; an exactly unchanged source may reuse its keyword index.', 'The overall 65000ms budget control-flow test uses an explicitly accelerated 350ms timer.', 'More than 2000 eligible passages is reported as a capability fallback, never semantic success.'],
    dimensions: DIMENSIONS, corpusManifest, warmQueries: warm.length, checks,
    timingsMs: Object.fromEntries(['syncMs', 'searchMs', 'totalMs'].map(key => [key, {
      p50: percentile(warm.map(item => item[key as 'syncMs']), 0.5),
      p95: percentile(warm.map(item => item[key as 'syncMs']), 0.95),
      max: Math.max(0, ...warm.map(item => item[key as 'syncMs'])),
    }])),
    memory: { observedPeakHeapMiB: maximumHeap / 1024 ** 2, observedPeakRssMiB: maximumRss / 1024 ** 2, sampling: 'after requests and queries; process-wide, not exact allocation tracing' },
    http: { requests: logs.length, requestBytes: logs.reduce((sum, item) => sum + item.requestBytes, 0), responseBytes: logs.reduce((sum, item) => sum + item.responseBytes, 0), passagesSubmitted: logs.filter(item => item.kind === 'passage').reduce((sum, item) => sum + item.items, 0), violations },
    measurements,
  }
  await mkdir('artifacts/memory-stress', { recursive: true })
  await writeFile('artifacts/memory-stress/hybrid.json', `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ status: report.status, elapsedMs: report.elapsedMs, warmTimingsMs: report.timingsMs, memory: report.memory, http: report.http }, null, 2))
}
