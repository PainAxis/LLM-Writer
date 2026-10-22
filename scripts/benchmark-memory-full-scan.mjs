/** Real adapter parsing + production engine capacity, synthetic vectors and zero network. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MemoryIndex } from '../src/services/memory/engine.ts'
import { createFrozenSemanticFixture } from './fixtures/memory-semantic-fixture.mjs'

const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const dimensions = Number(arg('dimensions', '128'))
const rounds = Number(arg('rounds', '3'))
const output = path.resolve(arg('output', 'artifacts/memory-full-scan'))
const label = arg('label', `dense-${dimensions}`)
assert.ok([128, 512, 4096].includes(dimensions))
assert.ok(Number.isSafeInteger(rounds) && rounds >= 1 && rounds <= 10)
assert.match(label, /^[a-zA-Z0-9_-]+$/)
assert.equal(typeof globalThis.gc, 'function', 'Run in a fresh process with --expose-gc')
const round = number => Number(number.toFixed(3))
const mib = bytes => round(bytes / 1024 ** 2)
const sha = value => createHash('sha256').update(value).digest('hex')
const fixture = createFrozenSemanticFixture()
const probe = fixture.cases.find(item => item.group === 'evaluation-fixed-seed-multi' && item.premises.length === 3)
assert.ok(probe)
const sourceByText = new Map(fixture.project.chapters.map(chapter => [chapter.text, chapter]))
const sourceById = new Map(fixture.project.chapters.map(chapter => [chapter.id, chapter]))
const axesById = new Map(fixture.controlledVectors.passageAxes.map(row => [row.id, row.axes]))
const queryAxes = fixture.controlledVectors.queryVectors.find(row => row.query === probe.query).axes
const revision = chapter => sha(JSON.stringify([chapter.title, chapter.text]))
const revisions = new Map(fixture.project.chapters.map(chapter => [chapter.id, revision(chapter)]))
const sourcePaths = [
  'src/services/memory/engine.ts', 'src/services/memory/fullSemanticScan.ts', 'src/services/memory/providers.ts',
  'src/services/memory/tokenScoreIndex.ts', 'src/services/memory/identifiers.ts', 'src/services/memory/matchSignals.ts',
  'src/services/memory/revision.ts', 'src/types/memory.ts', 'package-lock.json',
]
const hashes = async paths => Object.fromEntries(await Promise.all(paths.map(async file => [file, sha(await readFile(file))])))
const implementationHashes = await hashes(sourcePaths)
const harnessPaths = ['scripts/benchmark-memory-full-scan.mjs', 'scripts/fixtures/memory-semantic-fixture.mjs']
const harnessHashes = await hashes(harnessPaths)
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const workingTreeChanged = Boolean(execFileSync('git', ['status', '--porcelain', '--', ...sourcePaths], { encoding: 'utf8' }).trim())
const endpoint = 'https://full-scan-benchmark.invalid/embeddings'
const options = { embedding: { endpoint, protocol: 'jina', model: 'synthetic-dense-vector', apiKey: 'synthetic-only', dimensions }, fullScan: { maxCalls: 160, maxActiveMs: 65_000 } }
const query = { text: probe.query, throughChapterId: probe.throughChapterId, limit: 8 }
const originalFetch = globalThis.fetch
let requestRows = []
let sourceChecks = 0
let guardChecks = 0
let externalAttempts = 0
let sampledHeapPeak = 0
let sampledRssPeak = 0
let sampledArrayBuffersPeak = 0
const sample = () => {
  const memory = process.memoryUsage()
  sampledHeapPeak = Math.max(sampledHeapPeak, memory.heapUsed)
  sampledRssPeak = Math.max(sampledRssPeak, memory.rss)
  sampledArrayBuffersPeak = Math.max(sampledArrayBuffersPeak, memory.arrayBuffers)
}
const sampler = setInterval(sample, 10)
const phases = []
const report = {
  status: 'running', label, dimensions, rounds, startedAt: new Date().toISOString(), commit, workingTreeChanged,
  implementationHashes, harnessHashes, fixtureHashes: fixture.hashes,
  fixture: { passages: 4096, sourceChars: fixture.project.chapters.reduce((n, chapter) => n + chapter.text.length, 0), caseId: probe.id },
  environment: { node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, loadAverage: os.loadavg() },
  provider: 'In-process dense decimal JSON fixture through production providers.ts bounded parsing; no external network, no real model and no simulated latency.',
  phases,
  limitations: [
    'This measures Node engine, adapter JSON/number[][] parsing, typed-vector conversion and synthetic response construction. It excludes browser Worker transfer, IndexedDB source reads, editor work and real network/model delay.',
    'Source guards verify the fixed in-memory snapshot. Their cost does not measure committed-storage hydration.',
    'The 32MiB bound covers cached Float32 vector payload only, not the full process, JS arrays, JSON, input source text, query/batch temporaries or the index.',
    'Dense small decimals stress JSON parsing; synthetic axes test engineering coverage, not actual embedding relevance or cross-lingual model quality.',
    'Fresh-process high-water RSS includes fixture construction and local index build. Per-phase sampled peaks may miss sub-10ms transient allocations; checkpoints additionally sample during response construction and page completion.',
    'Cold and immediate warm alternate. The 2000-entry limit still requires 2096 embeddings on the next full scan; this is not a no-cost warm query.',
    'Timing samples are host-specific and not a browser SLA or paired speedup claim. Projected provider latency is arithmetic, never measured service performance.',
  ],
}
const vector = axes => Array.from({ length: dimensions }, (_, index) => (axes.includes(index) ? 1 : 0) + ((index * 37) % 257 + 1) / 10_000_000)
const passageVector = text => {
  const chapter = sourceByText.get(text)
  assert.ok(chapter, 'Only exact disclosed current source text may be transmitted')
  return vector(axesById.get(`passage:${JSON.stringify([chapter.id, 0])}`) ?? fixture.controlledVectors.irrelevantPassageAxes)
}
globalThis.fetch = async (url, init) => {
  if (String(url) !== endpoint) { externalAttempts++; throw new Error('Unexpected external endpoint') }
  const raw = String(init?.body)
  const body = JSON.parse(raw)
  assert.equal(body.dimensions, dimensions)
  assert.ok(body.input.length > 0 && body.input.length <= 32)
  if (body.task === 'retrieval.query') assert.deepEqual(body.input, [probe.query])
  else assert.equal(body.task, 'retrieval.passage')
  const data = body.input.map((text, index) => ({ index, embedding: body.task === 'retrieval.query' ? vector(queryAxes) : passageVector(text) }))
  const payload = JSON.stringify({ data: data.reverse() })
  requestRows.push({ task: body.task, items: body.input.length, chars: body.input.reduce((n, text) => n + text.length, 0), requestBytes: Buffer.byteLength(raw), responseBytes: Buffer.byteLength(payload) })
  sample()
  return new Response(payload, { headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } })
}
const guard = async () => { guardChecks++; }
const handle = progress => ({ sessionId: progress.sessionId, generation: progress.generation })
async function scan(index, warm, iteration) {
  globalThis.gc()
  requestRows = []
  guardChecks = 0
  sampledHeapPeak = sampledRssPeak = sampledArrayBuffersPeak = 0
  sample()
  const memoryBefore = process.memoryUsage()
  const cpuStart = process.cpuUsage()
  const started = performance.now()
  let page = await index.startFullScan(query, options)
  assert.equal(page.state, 'ready')
  assert.equal(requestRows.length, 0)
  assert.equal(page.progress.cachedPassages, warm ? 2000 : 0)
  assert.equal(page.progress.currentEstimatedCalls, warm ? 67 : 129)
  let pages = 0
  page = await index.resumeFullScan({ ...handle(page.progress), grantId: `start-${iteration}-${warm}`, addCalls: 0, addActiveMs: 0 }, guard)
  while (page.state !== 'complete') {
    assert.equal(page.state, 'page-complete', 'The synthetic no-latency profile must finish within the explicit allowance')
    sample()
    page = await index.advanceFullScan(handle(page.progress), guard)
    assert.ok(++pages < 100)
  }
  sample()
  const elapsedMs = performance.now() - started
  const cpu = process.cpuUsage(cpuStart)
  const result = page.result
  assert.equal(result.diagnostics.fullScan.coverage, 'complete')
  assert.equal(result.diagnostics.fullScan.scoredPassages, 4096)
  assert.equal(result.diagnostics.fullScan.callsAttempted, warm ? 67 : 129)
  assert.equal(requestRows.length, warm ? 67 : 129)
  assert.equal(guardChecks, requestRows.length)
  assert.equal(requestRows.filter(row => row.task === 'retrieval.passage').reduce((n, row) => n + row.items, 0), warm ? 2096 : 4096)
  for (const hit of result.hits) {
    const chapter = sourceById.get(hit.chapterId)
    assert.ok(chapter)
    assert.equal(hit.projectId, fixture.project.id)
    assert.equal(hit.revision, revisions.get(hit.chapterId))
    assert.equal(hit.quote, chapter.text.slice(hit.start, hit.end))
    assert.equal(hit.match.answerability, 'unverified')
    sourceChecks++
  }
  for (const premise of probe.premises) assert.ok(result.hits.slice(0, 5).some(hit => hit.chapterId === premise.chapterId && hit.start <= premise.start && hit.end >= premise.end))
  // Read-only diagnostic inspection of TS-private cache fields. Never mutates the cache.
  assert.equal(index.vectorCache.size, 2000)
  assert.equal(index.vectorBytes, 2000 * dimensions * 4)
  assert.ok(index.vectorBytes <= 32 * 1024 ** 2)
  const after = process.memoryUsage()
  phases.push({
    round: iteration, state: warm ? 'immediate-warm' : 'cold', elapsedMs: round(elapsedMs), cpuMs: round((cpu.user + cpu.system) / 1000),
    activeMsUsed: round(page.progress.activeMsUsed), pages: pages + 1, resultDigest: sha(JSON.stringify(result.hits)),
    callsAttempted: requestRows.length, guardChecks, embeddedPassages: result.diagnostics.fullScan.embeddedPassages,
    scoredCachedPassages: result.diagnostics.fullScan.scoredCachedPassages,
    sourceCharsSent: requestRows.filter(row => row.task === 'retrieval.passage').reduce((n, row) => n + row.chars, 0),
    requestBytes: requestRows.reduce((n, row) => n + row.requestBytes, 0), responseBytes: requestRows.reduce((n, row) => n + row.responseBytes, 0),
    largestResponseBytes: Math.max(...requestRows.map(row => row.responseBytes)),
    residentVectorEntries: index.vectorCache.size, residentVectorPayloadBytes: index.vectorBytes,
    memory: { heapBeforeMiB: mib(memoryBefore.heapUsed), heapAfterMiB: mib(after.heapUsed), sampledHeapPeakMiB: mib(sampledHeapPeak), sampledRssPeakMiB: mib(sampledRssPeak), sampledArrayBuffersPeakMiB: mib(sampledArrayBuffersPeak), processMaxRssMiB: round(process.resourceUsage().maxRSS / 1024) },
    projectedSequentialProviderMs: Object.fromEntries([100, 500, 1500].map(ms => [String(ms), requestRows.length * ms])),
  })
  return result.hits
}
await mkdir(output, { recursive: true })
try {
  const index = new MemoryIndex()
  const syncStart = performance.now()
  const stats = await index.sync(fixture.project)
  assert.equal(stats.chunks, 4096)
  report.syncMs = round(performance.now() - syncStart)
  for (let iteration = 1; iteration <= rounds; iteration++) {
    await index.search({ ...query, text: '' })
    const cold = await scan(index, false, iteration)
    const warm = await scan(index, true, iteration)
    assert.deepEqual(warm, cold)
    console.log(`PASS ${dimensions}d round ${iteration}: cold129 / warm67; identical exact sources and returned scores`)
  }
  assert.equal(externalAttempts, 0)
  assert.deepEqual(await hashes(sourcePaths), implementationHashes, 'Measured implementation must remain frozen during a run')
  assert.deepEqual(await hashes(harnessPaths), harnessHashes, 'Harness and frozen fixture must remain unchanged')
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.failure = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
} finally {
  clearInterval(sampler)
  globalThis.fetch = originalFetch
  report.finishedAt = new Date().toISOString()
  report.sourceChecks = sourceChecks
  report.externalAttempts = externalAttempts
  report.processMaxRssMiB = round(process.resourceUsage().maxRSS / 1024)
  await writeFile(path.join(output, `${label}.json`), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`${report.status.toUpperCase()} ${label}; sourceChecks=${sourceChecks}; externalAttempts=${externalAttempts}`)
}
