import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getHeapStatistics } from 'node:v8'
import type { MemoryIndex as MemoryIndexType } from '../src/services/memory/engine'
import type { MemoryIndexStats, MemoryProjectInput, MemoryRemoteOptions, MemorySearchResult } from '../src/types/memory'
import { chapterRevision } from '../src/services/memory/revision'
import { createStressNovel, type StressNovel } from './fixtures/memory-stress-corpus'

/** Capacity accounting, not a language-model benchmark. Run each profile in a fresh process. */
const argument = (name: string, fallback: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const profile = argument('profile', 'million')
const label = argument('label', 'current')
const engineRoot = path.resolve(argument('engine-root', '.'))
const output = path.resolve(argument('output', 'artifacts/memory-capacity'))
if (process.argv.includes('--help')) {
  console.log('node --expose-gc --import tsx scripts/benchmark-memory-capacity.ts --profile=million|ten-million|semantic --output=DIR [--engine-root=DIR] [--label=NAME]')
  process.exit(0)
}
assert.ok(['million', 'ten-million', 'semantic'].includes(profile), 'Unknown capacity profile')
assert.match(label, /^[a-zA-Z0-9_-]+$/, 'The label must be a safe filename segment')
const rounded = (value: number) => Number(value.toFixed(3))
const mib = (bytes: number) => rounded(bytes / 1024 ** 2)
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const sourceHash = (project: MemoryProjectInput) => sha256(JSON.stringify(project))
const code = (query: string) => query.match(/(?:FS|RN|PACT|MASK)\d+/)?.[0] ?? query
const started = performance.now()
const startedAt = new Date().toISOString()
const phases: Array<Record<string, unknown>> = []
const searches: Array<Record<string, unknown>> = []
let exactSourceChecks = 0
let sourceGuardChecks = 0
let networkAttempts = 0
let requestScope: { project: MemoryProjectInput; cutoff: number; query: string; dimensions: number; requests: ProviderRequest[] } | undefined
interface ProviderRequest { task: string; items: number; chars: number; dimensions: number; requestBytes: number; responseBytes: number }
const providerRequests: ProviderRequest[] = []
const originalFetch = globalThis.fetch
let observedHeap = process.memoryUsage().heapUsed
let observedRss = process.memoryUsage().rss
const sample = () => {
  const value = process.memoryUsage()
  observedHeap = Math.max(observedHeap, value.heapUsed)
  observedRss = Math.max(observedRss, value.rss)
}
const sampler = setInterval(sample, 25)
const sourcePaths = ['src/services/memory/engine.ts', 'src/services/memory/providers.ts', 'src/services/memory/identifiers.ts', 'src/services/memory/matchSignals.ts', 'src/services/memory/revision.ts']
const implementationHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async filename => [filename, sha256(await readFile(path.join(engineRoot, filename)))])))
const harnessHashes = {
  script: sha256(await readFile(fileURLToPath(import.meta.url))),
  fixture: sha256(await readFile(new URL('./fixtures/memory-stress-corpus.ts', import.meta.url))),
  revision: sha256(await readFile(new URL('../src/services/memory/revision.ts', import.meta.url))),
}
const engineCommit = execFileSync('git', ['-C', engineRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const engineWorkingTreeChanged = Boolean(execFileSync('git', ['-C', engineRoot, 'status', '--porcelain', '--', ...sourcePaths], { encoding: 'utf8' }).trim())
const { MemoryIndex } = await import(pathToFileURL(path.join(engineRoot, 'src/services/memory/engine.ts')).href) as { MemoryIndex: typeof MemoryIndexType }
let fixture: unknown
let initialSourceHash = ''
let status = 'running'
let failure: string | undefined
const revisionCache = new Map<string, { title: string; text: string; revision: string }>()

async function checkpoint() {
  sample()
  await writeFile(path.join(output, `${label}-${profile}.json`), `${JSON.stringify({
    status, profile, label, startedAt, finishedAt: status === 'running' ? null : new Date().toISOString(),
    elapsedMs: rounded(performance.now() - started), engineCommit, engineWorkingTreeChanged,
    implementationHashes, harnessHashes, fixture, initialSourceHash,
    environment: { node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length, totalMemoryMiB: mib(os.totalmem()), heapLimitMiB: mib(getHeapStatistics().heap_size_limit),
      explicitGc: typeof globalThis.gc === 'function', loadAverage: os.loadavg() },
    phases, searches, exactSourceChecks, sourceGuardChecks, networkAttempts,
    provider: { implementation: 'In-process fetch fixture through production provider parsing; deterministic all-one vectors; no network or real model.',
      requests: providerRequests, requestsCount: providerRequests.length,
      passageItems: providerRequests.filter(row => row.task === 'retrieval.passage').reduce((sum, row) => sum + row.items, 0),
      queryItems: providerRequests.filter(row => row.task === 'retrieval.query').reduce((sum, row) => sum + row.items, 0) },
    memory: { sampledHeapPeakMiB: mib(observedHeap), sampledRssPeakMiB: mib(observedRss), processMaxRssMiB: rounded(process.resourceUsage().maxRSS / 1024) },
    limitations: [
      'Node engine/service capacity only: excludes actual committed storage reads, browser IndexedDB, Worker transfer, editor layout, and live provider latency.',
      'Each phase is one descriptive sample, not a hardware guarantee or statistically controlled latency distribution. CPU measures process user/system time.',
      'Explicit GC, input preparation, source hashes, evidence verification, and report writing are outside measured sync calls; each profile must run in its own process.',
      'Semantic search timings include mock JSON creation/parsing and a full-source SHA-256 guard before every outbound request. This is an instrumented capacity workload, not raw provider or browser latency.',
      'Phase memory endpoints and 25ms samples can miss synchronous peaks. Process maximum RSS covers fixture generation and all checks, not isolated index allocation.',
      'Semantic fixtures use an independent generated 2001-chapter / 600-character-per-chapter manuscript, exactly one passage each; the long-novel fixture is not clipped or sampled. Both dimensions run sequentially and are capacity cases, not a dimension-speed comparison.',
      'All-one mock vectors validate cache accounting and source boundaries, not semantic relevance. Float32 payload bytes exclude maps, source metadata, JSON, transient arrays and index memory.',
      'Expected resident vector bytes are reference accounting for this operation sequence, not a direct heap measurement; narrowing and over-capacity fallback do not empty the prior cache. 2000 entries at 4096 dimensions occupy 31.25 MiB, below the unchanged 32 MiB byte bound; this does not exercise byte-limit eviction.',
      'No persistent index snapshot exists: retained recovery revalidates an in-memory completed baseline; new-instance recovery is a complete rebuild.',
    ], ...(failure ? { failure } : {}),
  }, null, 2)}\n`)
}

async function measure<T>(operation: string, action: () => Promise<T>, details: Record<string, unknown> = {}): Promise<T> {
  globalThis.gc?.()
  const before = process.memoryUsage()
  const cpu = process.cpuUsage()
  const start = performance.now()
  const value = await action()
  const wallMs = performance.now() - start
  const usedCpu = process.cpuUsage(cpu)
  const after = process.memoryUsage()
  sample()
  phases.push({ operation, wallMs: rounded(wallMs), cpuUserMs: rounded(usedCpu.user / 1000), cpuSystemMs: rounded(usedCpu.system / 1000),
    heapBeforeMiB: mib(before.heapUsed), heapAfterMiB: mib(after.heapUsed), rssBeforeMiB: mib(before.rss), rssAfterMiB: mib(after.rss),
    processMaxRssMiB: rounded(process.resourceUsage().maxRSS / 1024), ...details })
  return value
}

async function validate(result: MemorySearchResult, project: MemoryProjectInput, stats: MemoryIndexStats) {
  assert.equal(result.projectId, project.id)
  assert.equal(result.fingerprint, stats.fingerprint)
  assert.equal(result.assessment?.answerability, 'unverified')
  const cutoff = project.chapters.findIndex(chapter => chapter.id === result.throughChapterId)
  assert.ok(cutoff >= 0)
  const chapters = new Map(project.chapters.map((chapter, ordinal) => [chapter.id, { chapter, ordinal }]))
  for (const hit of result.hits) {
    const source = chapters.get(hit.chapterId)
    assert.ok(source && source.ordinal <= cutoff, 'No missing or future source may appear')
    assert.equal(hit.projectId, project.id)
    assert.equal(hit.ordinal, source.ordinal + 1)
    assert.equal(hit.chapterTitle, source.chapter.title)
    assert.equal(hit.quote, source.chapter.text.slice(hit.start, hit.end))
    let cached = revisionCache.get(source.chapter.id)
    if (!cached || cached.title !== source.chapter.title || cached.text !== source.chapter.text) {
      cached = { ...source.chapter, revision: await chapterRevision(source.chapter) }
      revisionCache.set(source.chapter.id, cached)
    }
    assert.equal(hit.revision, cached.revision, 'Returned revision must be derived independently from current source')
    assert.equal(hit.match?.answerability, 'unverified')
    exactSourceChecks++
  }
}

async function synchronize(index: MemoryIndexType, project: MemoryProjectInput, operation: string) {
  const hash = sourceHash(project)
  const snapshot = structuredClone(project)
  const stats = await measure(operation, () => index.sync(snapshot), { sourceSha256: hash })
  Object.assign(phases.at(-1)!, { fingerprint: stats.fingerprint, chapters: stats.chapters.length, chars: stats.chars,
    passages: stats.chunks, clues: stats.clues, staleClues: stats.staleClues, work: stats.sync, engineBuildMs: rounded(stats.buildMs) })
  await checkpoint()
  return stats
}

async function localSearch(index: MemoryIndexType, project: MemoryProjectInput, stats: MemoryIndexStats, query: string, cutoff: string, operation: string) {
  const result = await index.search({ text: query, throughChapterId: cutoff, limit: 8 })
  await validate(result, project, stats)
  assert.equal(result.diagnostics.semantic, 'disabled')
  assert.equal(result.diagnostics.rerank, 'disabled')
  searches.push({ operation, query, cutoff, searchMs: rounded(result.searchMs), assessment: result.assessment,
    hitIds: result.hits.map(hit => hit.id), sourceRevisions: result.hits.map(hit => hit.revision) })
  return result
}

async function regression(index: MemoryIndexType, project: MemoryProjectInput, stats: MemoryIndexStats, corpus: StressNovel, operation: string) {
  for (const probe of corpus.positiveQueries) {
    const result = await localSearch(index, project, stats, code(probe.query), probe.throughChapterId, operation)
    const rank = result.hits.findIndex(hit => hit.chapterId === probe.chapterId && hit.quote.includes(probe.quote)) + 1
    assert.ok(rank > 0, `Exact identifier or clue source must remain retrievable: ${probe.id}`)
    Object.assign(searches.at(-1)!, { expectedChapter: probe.chapterId, rank })
  }
  for (const probe of corpus.positiveQueries.filter(row => row.id.startsWith('fact-'))) {
    const result = await localSearch(index, project, stats, probe.query, probe.throughChapterId, `${operation}:mixed-query`)
    const rank = result.hits.findIndex(hit => hit.chapterId === probe.chapterId && hit.quote.includes(probe.quote)) + 1
    assert.ok(rank > 0, `Mixed Chinese/exact-code recall must remain intact: ${probe.id}`)
    Object.assign(searches.at(-1)!, { expectedChapter: probe.chapterId, rank })
  }
  for (const secret of corpus.futureSecrets) {
    const hidden = await localSearch(index, project, stats, secret.query, secret.beforeChapterId, `${operation}:future-hidden`)
    assert.ok(hidden.hits.every(hit => !hit.quote.includes(secret.query)))
    const revealed = await localSearch(index, project, stats, secret.query, secret.throughChapterId, `${operation}:future-revealed`)
    assert.ok(revealed.hits.some(hit => hit.quote.includes(secret.quote)))
  }
  const cutoff = project.chapters.at(-1)!.id
  const absent = await localSearch(index, project, stats, 'MISSING-946_Z', cutoff, `${operation}:absent`)
  assert.equal(absent.assessment!.state, 'none')
  const weak = await localSearch(index, project, stats, '封存 MISSING-946_Z', cutoff, `${operation}:weak`)
  assert.equal(weak.assessment!.state, 'candidates')
  assert.ok(weak.assessment!.missingIdentifiers.includes('missing-946_z'))
  await checkpoint()
}

async function localProfile() {
  const settings = profile === 'million' ? { chapters: 600, charsPerChapter: 2200 } : { chapters: 2500, charsPerChapter: 4200 }
  const corpus = await measure('fixture-generation', () => createStressNovel(settings))
  fixture = corpus.manifest
  let project = corpus.project
  initialSourceHash = sourceHash(project)
  const jsonClone = await measure('whole-source-json-clone', async () => JSON.parse(JSON.stringify(project)) as MemoryProjectInput)
  assert.equal(sourceHash(jsonClone), initialSourceHash)
  const structured = await measure('whole-source-structured-clone', async () => structuredClone(project))
  assert.equal(sourceHash(structured), initialSourceHash)
  const hashes = await measure('independent-all-chapter-hashes', async () => {
    const values = new Map<string, string>()
    for (const chapter of project.chapters) values.set(chapter.id, await chapterRevision(chapter))
    return values
  })
  assert.equal(hashes.size, project.chapters.length)
  let index = new MemoryIndex()
  let stats = await synchronize(index, project, 'cold-full-sync')
  assert.equal(stats.sync.mode, 'full')
  assert.equal(stats.sync.rebuiltChapters, project.chapters.length)
  for (const chapter of stats.chapters) assert.equal(chapter.revision, hashes.get(chapter.id))
  await regression(index, project, stats, corpus, 'cold')
  const originalFingerprint = stats.fingerprint
  stats = await synchronize(index, project, 'unchanged-sync')
  assert.equal(stats.sync.mode, 'unchanged')
  assert.equal(stats.sync.insertedDocuments, 0)
  assert.equal(stats.fingerprint, originalFingerprint)
  index.invalidateSource()
  await assert.rejects(index.search({ text: 'FS00001', throughChapterId: project.chapters.at(-1)!.id }))
  stats = await synchronize(index, project, 'retained-baseline-recovery')
  assert.equal(stats.sync.mode, 'unchanged')
  assert.equal(stats.fingerprint, originalFingerprint)
  const changed = corpus.editTargets[0]!
  project = { ...project, chapters: project.chapters.map(chapter => chapter.id === changed.chapterId
    ? { ...chapter, text: chapter.text.replaceAll(changed.oldValue, changed.replacementValue) } : chapter) }
  stats = await synchronize(index, project, 'old-chapter-incremental-sync')
  assert.equal(stats.sync.mode, 'incremental')
  assert.equal(stats.sync.rebuiltChapters, 1)
  assert.equal(stats.sync.reusedChapters, project.chapters.length - 1)
  assert.equal(stats.staleClues, 1)
  const cutoff = project.chapters.at(-1)!.id
  const old = await localSearch(index, project, stats, code(changed.oldValue), cutoff, 'edit-old-code')
  assert.ok(old.hits.every(hit => !hit.quote.includes(changed.oldValue)))
  const replacement = await localSearch(index, project, stats, code(changed.replacementValue), cutoff, 'edit-new-code')
  assert.ok(replacement.hits.some(hit => hit.quote.includes(changed.replacementValue)))
  const stale = await localSearch(index, project, stats, 'PACT00002', cutoff, 'edit-stale-clue')
  assert.ok(stale.hits.every(hit => hit.kind !== 'clue' || hit.chapterId !== changed.chapterId))
  const liveClue = corpus.clues.at(-2)!
  const distant = await localSearch(index, project, stats, code(liveClue.query), liveClue.throughChapterId, 'edit-distant-clue')
  assert.ok(distant.hits.some(hit => hit.kind === 'clue' && hit.quote === liveClue.quote))
  // Drop the old database before full recovery: do not report a two-index heap as a cold index.
  index = new MemoryIndex()
  const editedFingerprint = stats.fingerprint
  stats = await synchronize(index, project, 'new-instance-full-recovery')
  assert.equal(stats.sync.mode, 'full')
  assert.equal(stats.sync.rebuiltChapters, project.chapters.length)
  assert.equal(stats.fingerprint, editedFingerprint)
  const restored = await localSearch(index, project, stats, code(changed.replacementValue), cutoff, 'recovered-new-code')
  assert.ok(restored.hits.some(hit => hit.quote.includes(changed.replacementValue)))
  const unchangedCorpus = { ...corpus, positiveQueries: corpus.positiveQueries.filter(probe => probe.chapterId !== changed.chapterId) }
  await regression(index, project, stats, unchangedCorpus, 'full-recovery')
}

async function createSemanticCorpus() {
  // Dedicated cache-capacity source; do not relax or truncate the long-novel fixture.
  const project: MemoryProjectInput = { id: 'semantic-capacity-2001-600-v1', title: '语义缓存容量专用案卷', chapters: [], clues: [] }
  const editTargets: Array<{ chapterId: string; oldValue: string; replacementValue: string }> = []
  const futureSecrets: Array<{ ordinal: number; query: string; quote: string; beforeChapterId: string; throughChapterId: string }> = []
  for (let ordinal = 1; ordinal <= 2001; ordinal++) {
    const identifier = String(ordinal).padStart(5, '0')
    const oldValue = `白银封蜡FS${identifier}`
    const replacementValue = `赤铜封蜡RN${identifier}`
    const quote = `守卷人将${oldValue}交给沈砚，约定在第三声更鼓后回到渡口。`
    const clueQuote = `沈砚收好${oldValue}，见到铜铃才通知守卷人前来接应。`
    const secret = ordinal === 2001 ? '本章才揭晓：镜面行者MASK02001的真名是顾行。' : ''
    const chapter = { id: `capacity-chapter-${ordinal}`, title: `案卷第${ordinal}章`,
      text: `案卷${ordinal}记载：\n\n${quote}\n\n${clueQuote}\n\n${secret}`.padEnd(600, '。') }
    assert.equal(chapter.text.length, 600)
    project.chapters.push(chapter)
    if (ordinal % 2 === 0) {
      const start = chapter.text.indexOf(clueQuote)
      project.clues.push({ id: `capacity-clue-${ordinal}`, chapterId: chapter.id, sourceRevision: await chapterRevision(chapter),
        start, end: start + clueQuote.length, quote: clueQuote, label: '铜铃接应', aliases: [`PACT${identifier}`] })
      editTargets.push({ chapterId: chapter.id, oldValue, replacementValue })
    }
    if (secret) futureSecrets.push({ ordinal, query: 'MASK02001', quote: secret,
      beforeChapterId: `capacity-chapter-${ordinal - 1}`, throughChapterId: chapter.id })
  }
  return { project, editTargets, futureSecrets, manifest: { fixtureVersion: 'semantic-capacity-v1', chapters: 2001,
    charsPerChapter: 600, totalChars: 2001 * 600, expectedPassages: 2001, clues: project.clues.length,
    description: 'Independent deterministic cache-accounting fixture; short complete chapters with planted old/new codes, source-bound clues and a last-chapter secret. Padding is synthetic and does not establish novel or semantic quality.' } }
}

async function semanticProfile() {
  const corpus = await measure('fixture-generation', createSemanticCorpus)
  fixture = corpus.manifest
  initialSourceHash = sourceHash(corpus.project)
  for (const dimensions of [512, 4096]) {
    let project = structuredClone(corpus.project)
    const index = new MemoryIndex()
    let stats = await synchronize(index, project, `semantic-${dimensions}:cold-full-sync`)
    assert.equal(stats.chunks, 2001, 'The complete fixture must have exactly one passage per chapter')
    const remote: MemoryRemoteOptions = { embedding: { protocol: 'jina', endpoint: 'https://capacity.invalid/embeddings',
      model: 'synthetic-all-one-capacity', apiKey: 'synthetic-capacity-only', dimensions } }
    let expectedResidentEntries = 0
    async function searchCase(name: string, cutoff: number, expectedEmbedded: number, expectedCached: number, enabled = true) {
      const requests: ProviderRequest[] = []
      const query = project.chapters[1]!.text.includes('RN00002') ? 'RN00002' : 'FS00002'
      const sourceSha256 = sourceHash(project)
      requestScope = { project, cutoff, query, dimensions, requests }
      const result = await measure(`semantic-${dimensions}:${name}`, () => index.search({ text: query, throughChapterId: project.chapters[cutoff - 1]!.id, limit: 8 }, enabled ? remote : undefined,
        async () => { sourceGuardChecks++; assert.equal(sourceHash(project), sourceSha256) }), { sourceSha256, dimensions, cutoff })
      requestScope = undefined
      await validate(result, project, stats)
      assert.equal(result.diagnostics.eligiblePassages, cutoff)
      assert.equal(result.diagnostics.embeddedPassages, expectedEmbedded)
      assert.equal(result.diagnostics.cachedPassages, expectedCached)
      const passages = requests.filter(row => row.task === 'retrieval.passage')
      const queries = requests.filter(row => row.task === 'retrieval.query')
      assert.equal(passages.reduce((sum, row) => sum + row.items, 0), expectedEmbedded)
      assert.ok(passages.every(row => row.items <= 32))
      const supported = enabled && cutoff <= 2000
      assert.equal(result.diagnostics.semantic, !enabled ? 'disabled' : supported ? 'used' : 'fallback')
      assert.equal(queries.length, supported ? 1 : 0)
      if (!supported) assert.equal(requests.length, 0, 'Disabled or over-capacity semantic retrieval must not send partial source')
      if (cutoff > 2000 && enabled) assert.ok(result.diagnostics.warnings.some(warning => warning.includes('2,000')))
      if (!enabled) expectedResidentEntries = 0
      else if (supported) expectedResidentEntries = Math.max(expectedResidentEntries, cutoff)
      const source = project.chapters[1]!
      assert.ok(result.hits.some(hit => hit.chapterId === source.id && hit.quote.includes(query)))
      Object.assign(phases.at(-1)!, { diagnostics: result.diagnostics, assessment: result.assessment,
        passageRequests: passages.length, queryRequests: queries.length, requestChars: requests.reduce((sum, row) => sum + row.chars, 0),
        requestBytes: requests.reduce((sum, row) => sum + row.requestBytes, 0), responseBytes: requests.reduce((sum, row) => sum + row.responseBytes, 0),
        evaluatedVectorPayloadBytes: supported ? cutoff * dimensions * Float32Array.BYTES_PER_ELEMENT : 0,
        expectedResidentEntries, expectedResidentVectorPayloadBytes: expectedResidentEntries * dimensions * Float32Array.BYTES_PER_ELEMENT,
        embeddedVectorPayloadBytes: expectedEmbedded * dimensions * Float32Array.BYTES_PER_ELEMENT,
        cachedEligibleVectorPayloadBytes: expectedCached * dimensions * Float32Array.BYTES_PER_ELEMENT })
      if (supported) assert.ok(cutoff * dimensions * Float32Array.BYTES_PER_ELEMENT <= 32 * 1024 * 1024)
      await checkpoint()
      return result
    }
    await searchCase('cold-2000', 2000, 2000, 0)
    await searchCase('warm-2000', 2000, 0, 2000)
    await searchCase('narrow-1000', 1000, 0, 1000)
    await searchCase('expand-2000', 2000, 0, 2000)
    index.invalidateSource()
    stats = await synchronize(index, project, `semantic-${dimensions}:retained-recovery-sync`)
    assert.equal(stats.sync.mode, 'unchanged')
    await searchCase('retained-cache-recovery', 2000, 0, 2000)
    const target = corpus.editTargets[0]!
    project = { ...project, chapters: project.chapters.map(chapter => chapter.id === target.chapterId
      ? { ...chapter, text: chapter.text.replaceAll(target.oldValue, target.replacementValue) } : chapter) }
    stats = await synchronize(index, project, `semantic-${dimensions}:old-chapter-edit-sync`)
    assert.equal(stats.sync.mode, 'incremental')
    assert.equal(stats.sync.rebuiltChapters, 1)
    assert.equal(stats.staleClues, 1)
    const edited = await searchCase('old-chapter-edit', 2000, 1, 1999)
    assert.ok(edited.hits.every(hit => !hit.quote.includes(target.oldValue)))
    await searchCase('disabled-clears-vector-cache', 2000, 0, 0, false)
    await searchCase('cleared-cache-restore', 2000, 2000, 0)
    const boundary = await searchCase('complete-2001-fallback', 2001, 0, 0)
    assert.equal(boundary.method, 'bm25+clues')
    // A cache built up to chapter 2000 must never reveal the last chapter's identity.
    const secret = corpus.futureSecrets.find(row => row.ordinal === 2001)!
    const hidden = await localSearch(index, project, stats, secret.query, secret.beforeChapterId, `semantic-${dimensions}:future-hidden`)
    assert.ok(hidden.hits.every(hit => !hit.quote.includes(secret.query)))
    const disclosed = await localSearch(index, project, stats, secret.query, secret.throughChapterId, `semantic-${dimensions}:future-revealed`)
    assert.ok(disclosed.hits.some(hit => hit.quote.includes(secret.quote)))
    const stale = await localSearch(index, project, stats, 'PACT00002', secret.throughChapterId, `semantic-${dimensions}:stale-clue`)
    assert.ok(stale.hits.every(hit => hit.kind !== 'clue' || hit.chapterId !== target.chapterId))
  }
}

globalThis.fetch = async (url, init) => {
  if (profile !== 'semantic' || !requestScope || String(url) !== 'https://capacity.invalid/embeddings') {
    networkAttempts++
    throw new Error('Unapproved network request in capacity benchmark')
  }
  const body = JSON.parse(String(init?.body)) as { input: string[]; task: string; dimensions: number }
  assert.equal(body.dimensions, requestScope.dimensions)
  assert.ok(body.task === 'retrieval.passage' || body.task === 'retrieval.query')
  assert.ok(Array.isArray(body.input) && body.input.length > 0)
  if (body.task === 'retrieval.passage') {
    const allowed = new Set(requestScope.project.chapters.slice(0, requestScope.cutoff).map(chapter => chapter.text))
    for (const text of body.input) assert.ok(allowed.has(text), 'Every outgoing passage is an exact current disclosed complete chapter')
    assert.ok(body.input.length <= 32)
  } else assert.deepEqual(body.input, [requestScope.query])
  const payload = JSON.stringify({ data: body.input.map((_, index) => ({ index, embedding: Array.from({ length: body.dimensions }, () => 1) })) })
  const row: ProviderRequest = { task: body.task, items: body.input.length, chars: body.input.reduce((sum, text) => sum + text.length, 0),
    dimensions: body.dimensions, requestBytes: Buffer.byteLength(String(init?.body)), responseBytes: Buffer.byteLength(payload) }
  providerRequests.push(row)
  requestScope.requests.push(row)
  return new Response(payload, { headers: { 'Content-Type': 'application/json' } })
}

await mkdir(output, { recursive: true })
try {
  await checkpoint()
  if (profile === 'semantic') await semanticProfile()
  else await localProfile()
  assert.equal(networkAttempts, 0)
  for (const filename of sourcePaths) assert.equal(sha256(await readFile(path.join(engineRoot, filename))), implementationHashes[filename], 'Measured implementation must not change during a run')
  assert.equal(sha256(await readFile(fileURLToPath(import.meta.url))), harnessHashes.script, 'Harness must remain frozen during the run')
  assert.equal(sha256(await readFile(new URL('./fixtures/memory-stress-corpus.ts', import.meta.url))), harnessHashes.fixture)
  assert.equal(sha256(await readFile(new URL('../src/services/memory/revision.ts', import.meta.url))), harnessHashes.revision)
  status = 'passed'
  console.log(`PASS ${profile}: ${phases.length} phases; ${searches.length} local queries; ${exactSourceChecks} exact-source checks; ${providerRequests.length} mock requests`)
} catch (error) {
  status = 'failed'
  failure = error instanceof Error ? error.stack ?? error.message : String(error)
  process.exitCode = 1
  console.error(failure)
} finally {
  globalThis.fetch = originalFetch
  clearInterval(sampler)
  await checkpoint()
}
