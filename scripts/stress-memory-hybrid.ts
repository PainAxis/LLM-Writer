import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
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
  actionId: string
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
  actionId: string
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
  sync: MemoryIndexStats['sync']
}

const logs: RequestLog[] = []
const violations: string[] = []
const measurements: Measurement[] = []
const checks: Array<{ name: string; details: Record<string, unknown> }> = []
let faultPlan: FaultPlan | undefined
let latency = 0
let maximumHeap = 0
let maximumRss = 0
let corpusManifest: Record<string, unknown> | undefined
interface ActionScope {
  project: MemoryProjectInput
  cutoff: number
  sourceLocations: Map<string, number[]>
  faultPlan?: FaultPlan
  faultSeen: number
  latency: number
}
const actionContext = new AsyncLocalStorage<string>()
const actionScopes = new Map<string, ActionScope>()
const sourceSnapshots = new Map<string, Pick<ActionScope, 'project' | 'sourceLocations'>>()
let actionSequence = 0

function sampleMemory() {
  const memory = process.memoryUsage()
  maximumHeap = Math.max(maximumHeap, memory.heapUsed)
  maximumRss = Math.max(maximumRss, memory.rss)
  return { heapMiB: memory.heapUsed / 1024 ** 2, rssMiB: memory.rss / 1024 ** 2 }
}

function setScope(actionId: string, project: MemoryProjectInput, cutoff: number, fingerprint: string) {
  const source = sourceSnapshots.get(fingerprint) ?? { project, sourceLocations: new Map<string, number[]>() }
  // The engine fingerprint is only a lookup hint for this independent oracle.
  // A production fingerprint bug must not let old text validate a new request.
  assert.equal(source.project.id, project.id)
  assert.equal(source.project.chapters.length, project.chapters.length)
  for (const [position, chapter] of project.chapters.entries()) {
    const canonical = source.project.chapters[position]!
    assert.equal(canonical.id, chapter.id, 'A shared oracle snapshot must preserve exact chapter identity and order')
    assert.equal(canonical.title, chapter.title)
    assert.equal(canonical.text, chapter.text, 'A shared oracle snapshot must equal the independently supplied complete chapter text')
  }
  sourceSnapshots.set(fingerprint, source)
  actionScopes.set(actionId, { ...source, cutoff, faultPlan, faultSeen: 0, latency })
}

function assertPayload(texts: string[], scope: ActionScope) {
  const chapterIds = new Set<string>()
  for (const text of texts) {
    let locations = scope.sourceLocations.get(text)
    if (!locations) {
      locations = scope.project.chapters.flatMap((chapter, i) => chapter.text.includes(text) ? [i + 1] : [])
      scope.sourceLocations.set(text, locations)
    }
    assert.ok(locations.some(ordinal => ordinal <= scope.cutoff), 'outbound document must be an exact quote from the disclosed snapshot that authorized its request')
    locations.filter(ordinal => ordinal <= scope.cutoff).forEach(ordinal => chapterIds.add(scope.project.chapters[ordinal - 1]!.id))
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
    const actionId = request.headers['x-memory-stress-action']
    assert.equal(typeof actionId, 'string', 'Every actual HTTP request must identify the action that issued it')
    const requestScope = actionScopes.get(actionId as string)
    assert.ok(requestScope, 'Every outbound document must belong to its own recorded disclosure scope')
    const sourceChapterIds = kind !== 'query' ? assertPayload(inputs, requestScope) : []
    if (kind !== 'rerank') assert.equal(body.dimensions, DIMENSIONS)
    item = { actionId: actionId as string, kind, items: inputs.length, requestBytes: raw.byteLength, responseBytes: 0, completed: false, sourceChapterIds }
    logs.push(item)
    let injected: FaultPlan | undefined
    if (requestScope.faultPlan && kind === requestScope.faultPlan.kind && ++requestScope.faultSeen === requestScope.faultPlan.nth) injected = requestScope.faultPlan
    if (injected) {
      item.fault = injected.fault
      injected.entered?.()
      if (injected.fault === 'hold') await injected.release
    }
    if (requestScope.latency) await delay(requestScope.latency)
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
const nativeFetch = globalThis.fetch
// Correlate at transport invocation, before an aborted request can arrive late at
// the server. This adds only a fixture-local header; native fetch still does HTTP.
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  assert.equal(url.origin, origin, 'The engineering suite may only call its loopback fixture')
  const actionId = actionContext.getStore()
  assert.ok(actionId && actionScopes.has(actionId), 'HTTP calls require a source-bound action context')
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  headers.set('x-memory-stress-action', actionId)
  return nativeFetch(input, { ...init, headers })
}
const options: MemoryRemoteOptions = {
  embedding: { protocol: 'jina', endpoint: `${origin}/v1/embeddings`, model: 'engineering-feature-hash-512', apiKey: 'local-synthetic-test-only', dimensions: DIMENSIONS },
  rerank: { endpoint: `${origin}/v1/rerank`, model: 'engineering-bigram-overlap', apiKey: 'local-synthetic-test-only' },
}

function injected(fault: Fault, nth = 1, kind: RequestLog['kind'] = 'passage') {
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
  const actionId = `${++actionSequence}:${name}`
  return actionContext.run(actionId, async () => {
    const started = performance.now()
    // Mirror MemoryLab's fresh-read/sync-before-search lifecycle, including clone and validation cost.
    const freshSnapshot = structuredClone(project)
    const stats = await index.sync(freshSnapshot)
    const syncMs = performance.now() - started
    setScope(actionId, freshSnapshot, cutoff, stats.fingerprint)
    const searched = performance.now()
    const result = await index.search({ text, throughChapterId: project.chapters[cutoff - 1]!.id, limit: 12 }, remote)
    const searchMs = performance.now() - searched
    verifyResult(result, project, stats, cutoff)
    // A cancelled prior request can reach the server after this action starts.
    // Log-array offsets would wrongly count that old batch toward the new result.
    const currentRequests = logs.filter(request => request.actionId === actionId)
    if (result.diagnostics.semantic === 'used') {
      assert.equal(currentRequests.filter(request => request.kind === 'passage' && request.completed && !request.fault).reduce((sum, request) => sum + request.items, 0), result.diagnostics.embeddedPassages, 'claimed embeddings must match completed valid HTTP response items')
    }
    measurements.push({ name, actionId, syncMs, searchMs, totalMs: performance.now() - started,
      chars: stats.chars, passages: stats.chunks, ...sampleMemory(), requests: currentRequests.length,
      requestBytes: currentRequests.reduce((sum, request) => sum + request.requestBytes, 0),
      responseBytes: currentRequests.reduce((sum, request) => sum + request.responseBytes, 0), diagnostics: result.diagnostics, sync: stats.sync })
    return { result, stats, requests: currentRequests }
  })
}

function hybrid(result: MemorySearchResult) {
  assert.equal(result.diagnostics.semantic, 'used', 'never report fallback as semantic success')
  assert.equal(result.method, 'bm25+clues+semantic')
  assert.equal(result.diagnostics.rerank, 'used')
  assert.ok(result.diagnostics.rerankedCandidates > 0)
  assert.equal(result.diagnostics.cachedPassages + result.diagnostics.embeddedPassages, result.diagnostics.eligiblePassages)
}

function syncWork(stats: MemoryIndexStats, mode: MemoryIndexStats['sync']['mode'], rebuiltChapters: number) {
  assert.equal(stats.sync.mode, mode)
  assert.equal(stats.sync.rebuiltChapters, rebuiltChapters)
  assert.equal(stats.sync.reusedChapters, stats.chapters.length - rebuiltChapters)
  assert.equal(stats.sync.insertedDocuments + stats.sync.reusedDocuments, stats.chunks + stats.clues)
  if (mode === 'unchanged') {
    assert.equal(stats.sync.insertedDocuments, 0)
    assert.equal(stats.sync.removedDocuments, 0)
  }
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
  syncWork(cold.stats, 'full', 600)
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
    syncWork(query.stats, 'unchanged', 0)
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
  syncWork(edited.stats, 'incremental', 20)
  assert.ok(edited.result.hits.some(hit => hit.quote.includes(fixture.editTargets[0]!.replacementValue)))
  assert.equal(edited.stats.staleClues, 20)
  assert.equal(edited.result.diagnostics.embeddedPassages, 40, 'each of the 20 changed 2200-character chapters has two passages')
  assert.equal(edited.stats.sync.insertedDocuments, 40)
  assert.equal(edited.stats.sync.removedDocuments, 60, 'replace 40 passages and remove 20 stale anchored clues')
  assert.equal(edited.result.diagnostics.cachedPassages + edited.result.diagnostics.embeddedPassages, edited.result.diagnostics.eligiblePassages)
  // Captured request counts plus diagnostics prove unchanged spans were not re-embedded.
  const changedChunks = edited.stats.chunks - edited.result.diagnostics.cachedPassages
  assert.equal(edited.result.diagnostics.embeddedPassages, changedChunks)
  assert.equal(edited.requests.filter(request => request.kind === 'passage').reduce((sum, request) => sum + request.items, 0), changedChunks)
  assert.ok(edited.requests.filter(request => request.kind === 'passage').every(request => request.sourceChapterIds.every(id => editedIds.has(id))), 'only changed chapters may be re-embedded, including all spans under each changed chapter hash')
  for (const chapterId of editedIds) {
    assert.notEqual(edited.stats.chapters.find(chapter => chapter.id === chapterId)!.revision, cold.stats.chapters.find(chapter => chapter.id === chapterId)!.revision)
  }
  checkpoint('twenty edited old chapters invalidate source revisions', { editedChapters: 20, reembeddedPassages: changedChunks, reusedPassages: edited.result.diagnostics.cachedPassages, staleClues: edited.stats.staleClues, sync: edited.stats.sync })
  const oldFact = await run(index, project, 600, fixture.editTargets[0]!.oldValue, 'old-fact-after-twenty-edits')
  hybrid(oldFact.result)
  assert.ok(oldFact.result.hits.every(hit => !hit.quote.includes(fixture.editTargets[0]!.oldValue)))

  const repeatedTarget = fixture.editTargets[0]!
  const alternateValue = repeatedTarget.replacementValue.replace('赤铜封蜡', '碧玉封蜡')
  let previousValue = repeatedTarget.replacementValue
  for (let iteration = 1; iteration <= 8; iteration++) {
    const nextValue = iteration % 2 ? alternateValue : repeatedTarget.replacementValue
    project = { ...project, chapters: project.chapters.map(chapter => chapter.id === repeatedTarget.chapterId
      ? { ...chapter, text: chapter.text.replaceAll(previousValue, nextValue) } : chapter) }
    const updated = await run(index, project, 600, nextValue, `warm-single-chapter-edit-${iteration}`)
    hybrid(updated.result)
    syncWork(updated.stats, 'incremental', 1)
    assert.equal(updated.stats.sync.insertedDocuments, 2)
    assert.equal(updated.stats.sync.removedDocuments, 2)
    assert.equal(updated.result.diagnostics.embeddedPassages, 2)
    assert.equal(updated.result.diagnostics.cachedPassages, 1198)
    const passageRequests = updated.requests.filter(request => request.kind === 'passage')
    assert.equal(passageRequests.length, 1)
    assert.ok(passageRequests.every(request => request.sourceChapterIds.length === 1 && request.sourceChapterIds[0] === repeatedTarget.chapterId))
    assert.ok(updated.result.hits.some(hit => hit.chapterId === repeatedTarget.chapterId && hit.quote.includes(nextValue)))
    assert.ok(updated.result.hits.every(hit => !hit.quote.includes(previousValue)), 'a saved chapter must never return its prior revision')
    previousValue = nextValue
  }
  assert.equal(previousValue, repeatedTarget.replacementValue)
  checkpoint('eight consecutive warm single-chapter edits retain all unrelated vectors and keyword documents', {
    iterations: 8, reembeddedPassagesPerEdit: 2, reusedPassagesPerEdit: 1198, passageRequestsPerEdit: 1,
  })

  const tail = project.chapters.splice(500, 1)[0]!
  project = { ...project, chapters: [tail, ...project.chapters] }
  const reordered = await run(index, project, 100, tail.text.slice(0, 28), 'reordered-narrative-cutoff')
  hybrid(reordered.result)
  syncWork(reordered.stats, 'incremental', 0)
  assert.equal(reordered.stats.sync.insertedDocuments, 0)
  assert.equal(reordered.stats.sync.removedDocuments, 0)
  assert.equal(reordered.result.diagnostics.embeddedPassages, 0)
  assert.ok(reordered.result.hits.some(hit => hit.chapterId === tail.id && hit.ordinal === 1))
  project = { ...project, chapters: project.chapters.filter((_, i) => i < 590) }
  const deleted = await run(index, project, 590, probe(), 'delete-ten-chapters')
  hybrid(deleted.result)
  syncWork(deleted.stats, 'incremental', 0)
  assert.equal(deleted.stats.sync.insertedDocuments, 0)
  assert.equal(deleted.result.diagnostics.embeddedPassages, 0)
  await assert.rejects(index.search({ text: '删除检查', throughChapterId: 'nonexistent-chapter' }, options), /截止章节不存在/)
  const existingIds = new Set(project.chapters.map(chapter => chapter.id))
  const regrown = { ...project, chapters: [...project.chapters, ...beforeEdit.chapters.filter(chapter => !existingIds.has(chapter.id))] }
  const grown = await run(index, regrown, 600, probe(), 'append-ten-chapters')
  hybrid(grown.result)
  syncWork(grown.stats, 'incremental', 10)
  assert.equal(grown.result.diagnostics.embeddedPassages, cold.stats.chunks - deleted.stats.chunks)
  assert.equal(grown.result.diagnostics.cachedPassages, deleted.stats.chunks)
  const other = { ...project, id: 'stress-hybrid-independent-project' }
  const switched = await run(index, other, 60, probe(), 'same-manuscript-different-project')
  hybrid(switched.result)
  syncWork(switched.stats, 'full', 590)
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
  const cancelSnapshot = structuredClone(project)
  const cancelStats = await cancelledIndex.sync(cancelSnapshot)
  faultPlan = { kind: 'passage', nth: 1, fault: 'hold', entered: enter, release: held }
  const cancelActionId = `${++actionSequence}:cancelled-source-snapshot`
  setScope(cancelActionId, cancelSnapshot, 590, cancelStats.fingerprint)
  const pending = actionContext.run(cancelActionId, () => cancelledIndex.search({ text: probe(), throughChapterId: project.chapters[589]!.id }, options))
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
  globalThis.fetch = nativeFetch
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  const warm = measurements.filter(item => item.name.startsWith('warm-session-'))
  const report = {
    status: reportStatus, elapsedMs: performance.now() - started,
    method: 'Production MemoryIndex and provider adapters; real loopback HTTP; deterministic 512-dimensional feature-hash embedding and literal/bigram reranker.',
    limitations: ['Synthetic mixed Chinese/English prose, not a human-authored production novel.', 'Hash vectors and lexical reranking cannot establish paid-model semantic recall or relevance quality.', 'Node execution excludes browser IndexedDB hydration, Worker messaging and rendering.', 'Warm timings include structuredClone and MemoryIndex.sync source validation before every query; an exactly unchanged source may reuse its keyword index.', 'Fixture-local HTTP action IDs and retained canonical snapshots instrument request ownership, disclosure and exact response accounting. Their overhead is included here; use the paired engine benchmark for performance comparisons.', 'The overall 65000ms budget control-flow test uses an explicitly accelerated 350ms timer.', 'More than 2000 eligible passages is reported as a capability fallback, never semantic success.'],
    dimensions: DIMENSIONS, corpusManifest, warmQueries: warm.length, checks,
    timingsMs: Object.fromEntries(['syncMs', 'searchMs', 'totalMs'].map(key => [key, {
      p50: percentile(warm.map(item => item[key as 'syncMs']), 0.5),
      p95: percentile(warm.map(item => item[key as 'syncMs']), 0.95),
      max: Math.max(0, ...warm.map(item => item[key as 'syncMs'])),
    }])),
    memory: { observedPeakHeapMiB: maximumHeap / 1024 ** 2, observedPeakRssMiB: maximumRss / 1024 ** 2, sampling: 'after requests and queries; process-wide, not exact allocation tracing' },
    http: { requests: logs.length, requestBytes: logs.reduce((sum, item) => sum + item.requestBytes, 0), responseBytes: logs.reduce((sum, item) => sum + item.responseBytes, 0), passagesSubmitted: logs.filter(item => item.kind === 'passage').reduce((sum, item) => sum + item.items, 0), violations,
      actionAttribution: 'Fixture-local header assigned at native fetch invocation; late requests retain their issuing snapshot, cutoff, fault plan and latency.', capturedActions: actionScopes.size, canonicalSourceSnapshots: sourceSnapshots.size },
    measurements,
  }
  await mkdir('artifacts/memory-stress', { recursive: true })
  await writeFile('artifacts/memory-stress/hybrid.json', `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ status: report.status, elapsedMs: report.elapsedMs, warmTimingsMs: report.timingsMs, memory: report.memory, http: report.http }, null, 2))
}
