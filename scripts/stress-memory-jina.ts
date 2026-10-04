/** Opt-in live workload over pinned public-domain prose. Model misses remain in the report. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import { MemoryIndex } from '../src/services/memory/engine'
import { MEMORY_PROVIDER_DEFAULTS } from '../src/services/memory/providers'
import { readPublicMemoryCorpus } from './fixtures/public-memory-corpus'
import type { MemoryProjectInput, MemoryRemoteOptions, MemorySearchResult } from '../src/types/memory'

const apiKey = process.env.JINA_API_KEY?.trim() ?? ''
delete process.env.JINA_API_KEY
if (!apiKey) throw new Error('Set JINA_API_KEY for this optional, billable stress test.')
const transport = process.env.MEMORY_TEST_TRANSPORT === 'curl-proxy-bridge' ? 'curl-proxy-bridge' : 'native-fetch'
const REQUEST_BUDGET = 180
const TEXT_BUDGET = 4_000_000
const MAX_PREPARATION_ATTEMPTS = 8
const options: MemoryRemoteOptions = {
  embedding: { ...MEMORY_PROVIDER_DEFAULTS.embedding, apiKey },
  rerank: { ...MEMORY_PROVIDER_DEFAULTS.rerank, apiKey },
}
const { project, manifest, probes } = await readPublicMemoryCorpus()
const source = project as MemoryProjectInput
const engineSha256 = createHash('sha256').update(await readFile(new URL('../src/services/memory/engine.ts', import.meta.url))).digest('hex')
const index = new MemoryIndex()
const originalFetch = globalThis.fetch
const startedAt = new Date().toISOString()
const started = performance.now()
let currentCutoff = source.chapters.at(-1)!.id
let requests = 0
let sentChars = 0
let sourceViolations = 0
let budgetExhausted = false
let activeAction = ''
let maxRssBytes = process.memoryUsage().rss
const sample = setInterval(() => { maxRssBytes = Math.max(maxRssBytes, process.memoryUsage().rss) }, 100)
const requestRows: Array<{ action: string; kind: string; documents: number; chars: number; status: number | 'transport-error'; elapsedMs: number; usage?: Record<string, number> }> = []
const actions: Array<Record<string, unknown>> = []
let safetyPassed = true
let setupError = ''
let completeHybrid = false
let firstColdComplete = false
let runStatus: 'running' | 'completed' | 'failed' = 'running'
let finishedAt: string | null = null

function percentile(values: number[], fraction: number) {
  if (!values.length) return null
  const ordered = [...values].sort((a, b) => a - b)
  return Math.round(ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)]! * 100) / 100
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  assert.ok(['https://api.jina.ai/v1/embeddings', 'https://api.jina.ai/v1/rerank'].includes(url))
  const body = JSON.parse(String(init?.body)) as { task?: string; input?: string[]; documents?: string[]; query?: string }
  const documents = body.task === 'retrieval.passage' ? body.input ?? [] : body.documents ?? []
  const cutoff = source.chapters.findIndex(chapter => chapter.id === currentCutoff)
  assert.ok(cutoff >= 0)
  const disclosed = source.chapters.slice(0, cutoff + 1)
  for (const text of documents) {
    if (!disclosed.some(chapter => chapter.text.includes(text))) {
      sourceViolations++
      throw new Error('An outbound document failed the active-source disclosure gate')
    }
  }
  const chars = [...body.input ?? [], ...body.documents ?? [], body.query ?? ''].reduce((sum, value) => sum + value.length, 0)
  if (requests + 1 > REQUEST_BUDGET || sentChars + chars > TEXT_BUDGET) {
    budgetExhausted = true
    throw new Error('Live test request budget exhausted')
  }
  requests++
  sentChars += chars
  const row: typeof requestRows[number] = {
    action: activeAction, kind: body.task ?? 'rerank', documents: documents.length,
    chars, status: 'transport-error', elapsedMs: 0,
  }
  requestRows.push(row)
  const requestStart = performance.now()
  try {
    const response = await originalFetch(input, init)
    row.status = response.status
    // Report numeric usage only. Never retain headers, credentials or provider error bodies.
    if (response.ok) {
      const usageBody = await response.clone().json().catch(() => null) as { usage?: Record<string, unknown> } | null
      if (usageBody?.usage && typeof usageBody.usage === 'object') {
        row.usage = Object.fromEntries(Object.entries(usageBody.usage)
          .filter((entry): entry is [string, number] => ['total_tokens', 'prompt_tokens', 'completion_tokens'].includes(entry[0]) && typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0))
      }
    }
    return response
  } finally { row.elapsedMs = Math.round(performance.now() - requestStart) }
}

async function action(name: string, query: string, throughChapterId: string, remote = true) {
  activeAction = name
  currentCutoff = throughChapterId
  const before = requests
  const beforeChars = sentChars
  const start = performance.now()
  const stats = await index.sync(source)
  const syncMs = performance.now() - start
  const result = await index.search({ text: query, throughChapterId, limit: 8 }, remote ? options : undefined)
  const cutoff = source.chapters.findIndex(chapter => chapter.id === throughChapterId)
  for (const hit of result.hits) {
    const position = source.chapters.findIndex(chapter => chapter.id === hit.chapterId)
    const chapter = source.chapters[position]
    assert.ok(chapter && position <= cutoff)
    assert.equal(hit.quote, chapter.text.slice(hit.start, hit.end))
    assert.equal(stats.chapters[position]!.revision, hit.revision)
  }
  assert.equal(sourceViolations, 0)
  const row: Record<string, unknown> = {
    name, query, throughChapterId, remote,
    sourceChapters: source.chapters.length, sourceChars: stats.chars, sourceChunks: stats.chunks,
    disclosedChapters: cutoff + 1,
    disclosedChars: source.chapters.slice(0, cutoff + 1).reduce((sum, chapter) => sum + chapter.text.length, 0),
    syncMs: Math.round(syncMs), searchMs: Math.round(result.searchMs), totalMs: Math.round(performance.now() - start),
    requests: requests - before, sentChars: sentChars - beforeChars, diagnostics: result.diagnostics,
    top8: result.hits.map(hit => ({ chapterId: hit.chapterId, start: hit.start, end: hit.end, revision: hit.revision })),
  }
  actions.push(row)
  console.log(JSON.stringify({ action: name, semantic: result.diagnostics.semantic, embedded: result.diagnostics.embeddedPassages,
    cached: result.diagnostics.cachedPassages, eligible: result.diagnostics.eligiblePassages, totalMs: row.totalMs, requests: row.requests }))
  await checkpoint()
  return { result, row }
}

function rankExpected(result: MemorySearchResult, expected: Array<{ chapterId: string; quote: string }>) {
  const position = result.hits.findIndex(hit => expected.some(item => item.chapterId === hit.chapterId && hit.quote.includes(item.quote)))
  return position < 0 ? null : position + 1
}

async function checkpoint() {
  const quality = actions.filter(row => row.category === 'quality' && row.remote === true && row.kind === 'recall')
  const available = quality.filter(row => (row.diagnostics as MemorySearchResult['diagnostics']).semantic === 'used')
  const fullyHybrid = available.filter(row => (row.diagnostics as MemorySearchResult['diagnostics']).rerank === 'used')
  const at5 = fullyHybrid.filter(row => typeof row.expectedRank === 'number' && row.expectedRank <= 5).length
  const warm = quality.map(row => Number(row.totalMs))
  const report = {
    startedAt, updatedAt: new Date().toISOString(), runStatus, finishedAt, elapsedMs: Math.round(performance.now() - started),
    corpus: manifest, engineSha256, transport, browserCorsValidated: false,
    machine: { node: process.version, platform: process.platform, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, availableParallelism: os.availableParallelism(), totalMemoryBytes: os.totalmem() },
    provider: { embeddingModel: options.embedding!.model, dimensions: options.embedding!.dimensions, rerankModel: options.rerank!.model },
    budgets: { requests: REQUEST_BUDGET, inputChars: TEXT_BUDGET, maxPreparationAttempts: MAX_PREPARATION_ATTEMPTS },
    requests, sentChars, reportedTotalTokens: requestRows.reduce((sum, row) => sum + (row.usage?.total_tokens ?? 0), 0),
    maxRssBytes, safetyPassed, sourceViolations, setupError, budgetExhausted,
    readiness: { firstColdComplete, completeHybridAfterRetries: completeHybrid,
      plannedRecallQueries: probes.filter(probe => probe.kind === 'recall').length, evaluatedRecallQueries: quality.length, semanticAvailableRecallQueries: available.length,
      fullyHybridAvailableRecallQueries: fullyHybrid.length,
      recallAt1: fullyHybrid.length ? fullyHybrid.filter(row => row.expectedRank === 1).length / fullyHybrid.length : null,
      recallAt5: fullyHybrid.length ? at5 / fullyHybrid.length : null,
      allPlannedRecallAt5: at5 / Math.max(1, probes.filter(probe => probe.kind === 'recall').length),
      targetRecallAt5: 0.8, targetMet: quality.length === probes.filter(probe => probe.kind === 'recall').length && fullyHybrid.length === quality.length && at5 / Math.max(1, fullyHybrid.length) >= 0.8,
      warmWholeActionP50Ms: percentile(warm, 0.5), warmWholeActionP95Ms: percentile(warm, 0.95) },
    notes: ['Two different complete editions form an anthology workload, not one coherent million-character novel.',
      'Recall probes were registered before paid retrieval; failed and unavailable queries remain in the denominator.',
      'Source identity/disclosure assertions are separate from model quality and no-answer behavior.',
      'Timing includes the configured environment transport; it is not a browser or provider latency SLA.'],
    probes, actions, requestRows,
  }
  await mkdir('artifacts/memory-stress', { recursive: true })
  await writeFile('artifacts/memory-stress/jina.json', JSON.stringify(report, null, 2) + '\n')
}

try {
  // The complete predefined query set is first measured in local mode with identical snapshots/cutoffs.
  for (const probe of probes) {
    const { result, row } = await action(`local-${probe.id}`, probe.query, probe.throughChapterId, false)
    Object.assign(row, { category: 'quality', kind: probe.kind, expectedRank: rankExpected(result, probe.expected), returnedCount: result.hits.length })
  }
  const fullCutoff = source.chapters.at(-1)!.id
  for (let attempt = 1; attempt <= MAX_PREPARATION_ATTEMPTS && !budgetExhausted; attempt++) {
    const { result, row } = await action(`cold-or-resume-${attempt}`, probes[0]!.query, fullCutoff)
    row.category = 'preparation'
    const complete = result.diagnostics.semantic === 'used' && result.diagnostics.rerank === 'used'
      && result.diagnostics.cachedPassages + result.diagnostics.embeddedPassages === result.diagnostics.eligiblePassages
    if (attempt === 1) firstColdComplete = complete
    if (complete) { completeHybrid = true; break }
    // No provider calls is a hard configured capacity boundary, so retrying cannot prepare this source.
    if (row.requests === 0) break
  }
  if (completeHybrid) {
    for (const probe of probes) {
      if (budgetExhausted) break
      const { result, row } = await action(`remote-${probe.id}`, probe.query, probe.throughChapterId)
      Object.assign(row, { category: 'quality', kind: probe.kind, expectedRank: rankExpected(result, probe.expected), returnedCount: result.hits.length })
      for (const quote of probe.forbiddenQuotes ?? []) assert.ok(result.hits.every(hit => !hit.quote.includes(quote)))
    }
    // A revision edit in a multi-chunk chapter must discard every vector with that chapter revision.
    const chapter = source.chapters[0]!
    const before = chapter.text
    const oldFact = '本压力副本中，密使把青铜星盘交给林照秋保管。'
    const newFact = '本压力副本中，密使把乌木罗盘交给陆听雨保管。'
    chapter.text = `${before}\n\n${oldFact}`
    if (!budgetExhausted) await action('revision-baseline', '压力副本密使保管的物品', chapter.id)
    chapter.text = `${before}\n\n${newFact}`
    if (!budgetExhausted) {
      const { result, row } = await action('revision-replacement', '压力副本密使保管的物品', chapter.id)
      row.category = 'revision'
      assert.ok(result.hits.every(hit => !hit.quote.includes(oldFact)))
      row.revisedFactRetrieved = result.hits.some(hit => hit.quote.includes(newFact))
      row.oldFactExcluded = true
    }
    chapter.text = before
  }
} catch (error) {
  safetyPassed = false
  setupError = error instanceof assert.AssertionError ? 'A source/revision/disclosure assertion failed; inspect the action metadata.' : 'The stress runner could not complete. No raw provider errors or credentials are retained.'
  process.exitCode = 1
} finally {
  clearInterval(sample)
  globalThis.fetch = originalFetch
  runStatus = safetyPassed ? 'completed' : 'failed'
  finishedAt = new Date().toISOString()
  await checkpoint()
  console.log(JSON.stringify({ safetyPassed, firstColdComplete, completeHybrid, requests, sentChars, report: 'artifacts/memory-stress/jina.json' }))
}
