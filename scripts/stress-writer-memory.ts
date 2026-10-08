import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MemoryIndex } from '../src/services/memory/engine'
import { chapterRevision } from '../src/services/memory/revision'
import { prepareWriterMemoryContext } from '../src/services/memory/writerContext'
import type { FactAnchor, FactGraphDocument, FactRelation } from '../src/types/factGraph'
import type { MemoryProjectInput, MemoryRemoteOptions } from '../src/types/memory'
import { createStressNovel } from './fixtures/memory-stress-corpus'

/** Source-integrity and bounded-prompt workload. No real model, literary-quality or device benchmark. */
const profiles = {
  million: { chapters: 600, charsPerChapter: 2_400 },
  'ten-million': { chapters: 2_500, charsPerChapter: 4_200 },
} as const
type Profile = keyof typeof profiles
type Prepared = Awaited<ReturnType<typeof prepareWriterMemoryContext>>
const output = path.resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) ?? 'artifacts/writer-memory-stress')
const selected = process.argv.find(arg => arg.startsWith('--profile='))?.slice(10) ?? 'all'
const child = process.argv.includes('--child')
const rounded = (value: number) => Number(value.toFixed(3))
const mib = (bytes: number) => rounded(bytes / 1024 ** 2)
const script = fileURLToPath(import.meta.url)
const identifier = (query: string) => query.match(/(?:FS|RN|PACT|MASK)\d+/)?.[0] ?? query

async function runProfile(profile: Profile) {
  const started = performance.now()
  const startedAt = new Date().toISOString()
  const sourcePaths = ['src/services/memory/writerContext.ts', 'src/services/memory/engine.ts', 'scripts/fixtures/memory-stress-corpus.ts', 'scripts/stress-writer-memory.ts']
  const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async filename => [filename, createHash('sha256').update(await readFile(filename)).digest('hex')])))
  const cases: Array<{ name: string; durationMs: number }> = []
  const preparations: Array<{ query: string; cutoff: number; budget: number; promptChars: number; hits: number; relations: number; durationMs: number; sync: unknown }> = []
  const mixedQueryRecall: Array<{ query: string; expectedChapter: string; passageRank: number; exactGraphEvidence: boolean }> = []
  let evidenceChecks = 0
  let externalRequests = 0
  let mockedProviderRequests = 0
  let mockFetch: typeof globalThis.fetch | undefined
  let heapPeak = process.memoryUsage().heapUsed
  let rssPeak = process.memoryUsage().rss
  const sample = () => { const memory = process.memoryUsage(); heapPeak = Math.max(heapPeak, memory.heapUsed); rssPeak = Math.max(rssPeak, memory.rss) }
  const interval = setInterval(sample, 25)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    if (mockFetch) return mockFetch(input, init)
    externalRequests++
    throw new Error('External requests are forbidden in Writer memory capacity acceptance')
  }
  let manifest: unknown
  let fixtureMs = 0
  let relationCount = 0
  async function checkpoint(status: string, error?: unknown) {
    sample()
    await writeFile(path.join(output, `${profile}.json`), `${JSON.stringify({
      status, profile, startedAt, finishedAt: new Date().toISOString(), elapsedMs: rounded(performance.now() - started),
      environment: { node: process.version, platform: `${os.platform()} ${os.arch()}`, cpus: os.cpus().length }, sourceHashes,
      fixture: manifest, fixtureMs: rounded(fixtureMs), relationCount, cases, preparations, mixedQueryRecall,
      mixedQuerySummary: { questions: mixedQueryRecall.length, passageHits: mixedQueryRecall.filter(row => row.passageRank > 0).length, graphEvidenceHits: mixedQueryRecall.filter(row => row.exactGraphEvidence).length },
      evidenceChecks, externalRequests, mockedProviderRequests,
      memory: { sampledHeapPeakMiB: mib(heapPeak), sampledRssPeakMiB: mib(rssPeak), processMaxRssMiB: rounded(process.resourceUsage().maxRSS / 1024) },
      limitations: ['Deterministic synthetic Chinese fiction; this is not a language-model retrieval or writing-quality evaluation.', 'Node service execution excludes browser Worker serialization, editor layout and real provider latency.', 'Single-run wall times depend on this machine. Sampled heap can miss synchronous peaks; process max RSS is separately reported.'],
      ...(error ? { error: error instanceof Error ? error.stack ?? error.message : String(error) } : {}),
    }, null, 2)}\n`)
  }
  async function step(name: string, action: () => Promise<void>) {
    const start = performance.now()
    await action()
    cases.push({ name, durationMs: rounded(performance.now() - start) })
    console.log(`PASS ${profile}: ${name}`)
    await checkpoint('running')
  }
  try {
    await checkpoint('running')
    const fixtureStarted = performance.now()
    const corpus = await createStressNovel({ ...profiles[profile], projectId: `novel:writer-memory-${profile}` })
    manifest = corpus.manifest
    let project = corpus.project
    const annotationOnlySecret = 'FUTURE-ANNOTATION-ONLY-91357'
    const clueOnlySecret = 'FUTURE-CLUE-ONLY-19831'
    project.clues[0]!.label = clueOnlySecret
    const revisions = new Map(await Promise.all(project.chapters.map(async chapter => [chapter.id, await chapterRevision(chapter)] as const)))
    const anchor = (chapterId: string, quote: string): FactAnchor => {
      const chapter = project.chapters.find(item => item.id === chapterId)!
      const start = chapter.text.indexOf(quote)
      assert.ok(start >= 0)
      return { chapterId, sourceRevision: revisions.get(chapterId)!, start, end: start + quote.length, quote }
    }
    const relations: FactRelation[] = corpus.facts.flatMap(fact => {
      const evidence = [anchor(fact.chapterId, fact.quote)]
      return [
        { source: { type: 'person' as const, label: fact.actor }, target: { type: 'object' as const, label: fact.oldValue }, predicate: '交付封存物件' },
        { source: { type: 'object' as const, label: fact.oldValue }, target: { type: 'person' as const, label: fact.recipient }, predicate: '交由对方保管' },
        { source: { type: 'object' as const, label: fact.oldValue }, target: { type: 'place' as const, label: fact.location }, predicate: '寄存于约定地点' },
      ].map((relation, index) => ({ ...relation, id: `${fact.id}-relation-${index}`, projectId: project.id, origin: 'explicit' as const, createdBy: 'author' as const, authorConfirmed: true, evidence }))
    })
    const first = corpus.facts[0]!
    const last = project.chapters.at(-1)!.id
    const penultimate = project.chapters.at(-2)!.id
    const secret = corpus.futureSecrets.find(item => item.chapterId === last)!
    const inference: FactRelation = {
      id: 'confirmed-multiple-premises', projectId: project.id, source: { type: 'person', label: first.actor }, target: { type: 'object', label: first.oldValue },
      predicate: '终卷多前提关联验收', origin: 'inferred', createdBy: 'model', authorConfirmed: true,
      evidence: [anchor(first.chapterId, first.quote), anchor(secret.chapterId, secret.quote)],
    }
    relations.find(relation => relation.id === `${first.id}-relation-0`)!.predicate = annotationOnlySecret
    // Late records intentionally precede early clues: eligibility must precede any display/prompt bound.
    let graph: FactGraphDocument = { version: 1, projectId: project.id, revision: 'writer-stress-graph-v1', relations: [inference, ...relations.reverse()] }
    relationCount = graph.relations.length
    fixtureMs = performance.now() - fixtureStarted
    assert.equal(corpus.manifest.totalChars, profiles[profile].chapters * profiles[profile].charsPerChapter)
    assert.ok(relationCount <= 10_000)
    const index = new MemoryIndex()
    let expectedCutoff = project.chapters.length
    let lastSync: unknown
    let mutateBeforeSearch: (() => void) | undefined
    const client = {
      sync: async (source: MemoryProjectInput) => {
        assert.equal(source.id, project.id)
        assert.equal(source.chapters.length, expectedCutoff, 'the Worker boundary receives disclosed chapters only')
        for (const [ordinal, chapter] of source.chapters.entries()) assert.deepEqual(chapter, project.chapters[ordinal])
        const disclosed = new Set(source.chapters.map(chapter => chapter.id))
        assert.ok(source.clues.every(clue => disclosed.has(clue.chapterId)), 'undisclosed clue aliases must not cross the Worker boundary')
        const stats = await index.sync(source)
        lastSync = stats.sync
        return stats
      },
      search: (async (...args: Parameters<MemoryIndex['search']>) => {
        mutateBeforeSearch?.()
        mutateBeforeSearch = undefined
        return index.search(...args)
      }),
      invalidateSource: index.invalidateSource.bind(index),
    }
    let readFailure = false
    const dependencies = { client, readProject: async () => { if (readFailure) throw new Error('Synthetic committed-source read failed'); return project }, readGraph: async () => graph }
    function verify(result: Prepared, cutoff: string, maxChars: number) {
      assert.ok(result.prompt.length <= maxChars, 'the entire appended evidence block, including metadata, fits its budget')
      const cutoffOrdinal = project.chapters.findIndex(chapter => chapter.id === cutoff)
      const sources = new Map(project.chapters.map((chapter, ordinal) => [chapter.id, { chapter, ordinal }]))
      for (const hit of result.hits) {
        const source = sources.get(hit.chapterId)!
        assert.ok(source && source.ordinal <= cutoffOrdinal, 'no missing or future chapter appears in hits')
        assert.equal(hit.quote, source.chapter.text.slice(hit.start, hit.end))
        assert.equal(hit.revision, revisions.get(hit.chapterId))
        evidenceChecks++
      }
      for (const relation of result.relations) for (const reference of relation.evidence) {
        const source = sources.get(reference.chapterId)!
        assert.ok(source && source.ordinal <= cutoffOrdinal, 'every inference premise must be disclosed')
        assert.equal(reference.quote, source.chapter.text.slice(reference.start, reference.end))
        assert.equal(reference.sourceRevision, revisions.get(reference.chapterId))
        evidenceChecks++
      }
      assert.equal(externalRequests, 0)
    }
    async function prepare(query: string, cutoff = last, maxChars = 6_000, includeGraph = true, remote?: MemoryRemoteOptions) {
      expectedCutoff = project.chapters.findIndex(chapter => chapter.id === cutoff) + 1
      const start = performance.now()
      const result = await prepareWriterMemoryContext({ projectId: project.id, query, throughChapterId: cutoff, maxChars, limit: 6, includeGraph, remote }, dependencies)
      verify(result, cutoff, maxChars)
      await result.assertFresh()
      preparations.push({ query, cutoff: expectedCutoff, budget: maxChars, promptChars: result.prompt.length, hits: result.hits.length, relations: result.relations.length, durationMs: rounded(performance.now() - start), sync: lastSync })
      sample()
      return result
    }
    await step('Cold preparation of the full manuscript and thousands of source-anchored relations', async () => {
      const result = await prepare(identifier(first.query))
      assert.ok(result.hits.some(hit => hit.quote.includes(first.quote)))
      assert.ok(result.relations.some(relation => relation.id.startsWith(`${first.id}-relation-`)))
      assert.ok(result.prompt.length > 0)
      assert.ok(!result.prompt.includes(annotationOnlySecret), 'an author-confirmed free-form predicate cannot disclose an ungrounded secret')
      assert.ok(result.relations.every(relation => relation.predicate !== annotationOnlySecret))
    })
    await step('Twenty-four distributed exact-source queries reuse the full disclosed index', async () => {
      for (const probe of corpus.positiveQueries.filter(item => item.id.startsWith('fact-'))) {
        const result = await prepare(identifier(probe.query))
        assert.ok(result.hits.some(hit => hit.chapterId === probe.chapterId && hit.quote.includes(probe.quote)))
      }
    })
    await step('Record mixed Chinese/code query recall without misrepresenting lexical misses as source failures', async () => {
      for (const probe of corpus.positiveQueries.filter(item => item.id.startsWith('fact-'))) {
        const result = await prepare(probe.query)
        mixedQueryRecall.push({ query: probe.query, expectedChapter: probe.chapterId,
          passageRank: result.hits.findIndex(hit => hit.chapterId === probe.chapterId && hit.quote.includes(probe.quote)) + 1,
          exactGraphEvidence: result.relations.some(relation => relation.evidence.some(reference => reference.chapterId === probe.chapterId && reference.quote.includes(probe.quote))),
        })
      }
    })
    await step('Distant author-marked clue alias recovers its original early-volume evidence', async () => {
      const clue = corpus.clues[0]!
      const result = await prepare(identifier(clue.query), last, 6_000, false)
      assert.ok(result.hits.some(hit => hit.kind === 'clue' && hit.chapterId === clue.chapterId && hit.quote === clue.quote))
      assert.ok(!result.prompt.includes(clueOnlySecret), 'a free-form clue label cannot disclose an ungrounded secret')
    })
    await step('Small and large evidence budgets include metadata without splitting source quotations', async () => {
      for (const budget of [1_000, 2_000, 6_000, 16_000]) await prepare('封存', last, budget)
    })
    await step('Future identity and every confirmed inference premise remain behind the disclosure cutoff', async () => {
      const full = await prepare(inference.predicate)
      assert.ok(full.relations.some(relation => relation.id === inference.id && relation.origin === 'inferred' && relation.authorConfirmed))
      const before = await prepare(inference.predicate, penultimate)
      assert.equal(before.relations.length, 0)
      const hidden = await prepare(secret.query, penultimate)
      assert.ok(hidden.hits.every(hit => !hit.quote.includes(secret.quote)))
      assert.ok(!hidden.prompt.includes(secret.quote))
      const disclosed = await prepare(secret.query, last)
      assert.ok(disclosed.hits.some(hit => hit.quote.includes(secret.quote)))
      const narrowed = await prepare(inference.predicate, project.chapters[9]!.id)
      assert.equal(narrowed.relations.length, 0)
      assert.ok(!narrowed.prompt.includes(secret.quote))
    })
    await step('Editing an old chapter invalidates prepared context and its author-confirmed graph anchors', async () => {
      const prepared = await prepare(identifier(first.query))
      project = { ...project, chapters: project.chapters.map(chapter => chapter.id === first.chapterId ? { ...chapter, text: chapter.text.replaceAll(first.oldValue, first.replacementValue) } : chapter) }
      revisions.set(first.chapterId, await chapterRevision(project.chapters[0]!))
      await assert.rejects(prepared.assertFresh())
      const current = await prepare(identifier(first.replacementValue))
      assert.ok(current.hits.some(hit => hit.quote.includes(first.replacementValue)))
      assert.ok(current.hits.every(hit => !hit.quote.includes(first.oldValue)))
      assert.ok(current.relations.every(relation => !relation.evidence.some(evidence => evidence.chapterId === first.chapterId)))
      assert.ok(!current.prompt.includes(first.oldValue))
    })
    await step('Thirty-chapter revision invalidates old clue marks while unrelated distant evidence survives', async () => {
      const changed = new Map(corpus.editTargets.map(fact => [fact.chapterId, fact]))
      project = { ...project, chapters: project.chapters.map(chapter => { const fact = changed.get(chapter.id); return fact ? { ...chapter, text: chapter.text.replaceAll(fact.oldValue, fact.replacementValue) } : chapter }) }
      for (const chapter of project.chapters) if (changed.has(chapter.id)) revisions.set(chapter.id, await chapterRevision(chapter))
      const staleClue = await prepare(identifier(corpus.clues[0]!.query))
      assert.ok(staleClue.hits.every(hit => hit.kind !== 'clue' || hit.chapterId !== corpus.clues[0]!.chapterId))
      const unaffected = corpus.facts[99]!
      const retained = await prepare(identifier(unaffected.query))
      assert.ok(retained.hits.some(hit => hit.quote.includes(unaffected.quote)))
    })
    await step('Chapter reorder and deletion recompute disclosure from the latest narrative order', async () => {
      const target = corpus.facts[99]!
      const moved = project.chapters.find(chapter => chapter.id === target.chapterId)!
      project = { ...project, chapters: [...project.chapters.filter(chapter => chapter.id !== moved.id), moved] }
      const boundary = project.chapters[99]!.id
      const hidden = await prepare(identifier(target.query), boundary)
      assert.ok(hidden.hits.every(hit => hit.chapterId !== moved.id))
      assert.ok(hidden.relations.every(relation => relation.evidence.every(evidence => evidence.chapterId !== moved.id)))
      project = { ...project, chapters: project.chapters.filter(chapter => chapter.id !== moved.id) }
      const deleted = await prepare(identifier(target.query), last)
      assert.ok(deleted.hits.every(hit => hit.chapterId !== moved.id))
    })
    await step('Changed graph state and unavailable committed source block previously prepared context', async () => {
      const prepared = await prepare(identifier(corpus.facts[101]!.query))
      graph = { ...graph, revision: 'writer-stress-graph-v2', relations: graph.relations.map(relation => ({ ...relation, authorConfirmed: false })) }
      await assert.rejects(prepared.assertFresh())
      const next = await prepare(identifier(corpus.facts[101]!.query))
      readFailure = true
      await assert.rejects(next.assertFresh())
      readFailure = false
    })
    await step('Controlled rerank receives current disclosed passages; changed source blocks the next outbound request', async () => {
      const cutoff = project.chapters[19]!.id
      const allowed = project.chapters.slice(0, 20).map(chapter => chapter.text)
      const query = identifier(corpus.facts[4]!.query)
      const remote: MemoryRemoteOptions = { rerank: { endpoint: 'https://writer-memory.invalid/rerank', model: 'synthetic-boundary-fixture', apiKey: 'synthetic-never-sent' } }
      mockFetch = async (input, init) => {
        mockedProviderRequests++
        assert.equal(String(input), remote.rerank!.endpoint)
        const body = JSON.parse(String(init?.body)) as { query: string; documents: string[] }
        assert.equal(body.query, query)
        assert.ok(body.documents.length > 0)
        for (const passage of body.documents) {
          assert.ok(allowed.some(text => text.includes(passage)), 'every remotely reranked passage occurs in the current disclosed prefix')
          assert.ok(!passage.includes(secret.quote))
          evidenceChecks++
        }
        return Response.json({ results: body.documents.map((_, index) => ({ index, relevance_score: 1 - index / (body.documents.length + 1) })) })
      }
      try {
        const result = await prepare(query, cutoff, 6_000, true, remote)
        assert.equal(result.diagnostics.rerank, 'used')
        assert.equal(mockedProviderRequests, 1)
        mutateBeforeSearch = () => { project = { ...project, chapters: project.chapters.map((chapter, ordinal) => ordinal === 4 ? { ...chapter, text: `${chapter.text}\n来源在发送前改变。` } : chapter) } }
        await assert.rejects(prepare(query, cutoff, 6_000, true, remote))
        assert.equal(mockedProviderRequests, 1, 'the stale next request must not reach even the mock provider')
      } finally { mockFetch = undefined; mutateBeforeSearch = undefined }
    })
    for (const filename of sourcePaths) assert.equal(createHash('sha256').update(await readFile(filename)).digest('hex'), sourceHashes[filename], `Measured production source changed during ${profile}: ${filename}`)
    await checkpoint('passed')
  } catch (error) { await checkpoint('failed', error); throw error }
  finally { clearInterval(interval); globalThis.fetch = originalFetch }
}

await mkdir(output, { recursive: true })
const chosen = selected === 'all' ? Object.keys(profiles) as Profile[] : [selected as Profile]
assert.ok(chosen.every(profile => profile in profiles), `Unknown profile: ${selected}`)
if (child) await runProfile(chosen[0]!)
else {
  const reports: unknown[] = []
  for (const profile of chosen) {
    const exitCode = await new Promise<number>((resolve, reject) => {
      const processChild = spawn(process.execPath, ['--expose-gc', '--import', 'tsx', script, `--profile=${profile}`, `--output=${output}`, '--child'], { stdio: 'inherit' })
      processChild.once('error', reject)
      processChild.once('exit', code => resolve(code ?? 1))
    })
    reports.push(JSON.parse(await readFile(path.join(output, `${profile}.json`), 'utf8')))
    await writeFile(path.join(output, 'report.json'), `${JSON.stringify({ profiles: reports }, null, 2)}\n`)
    assert.equal(exitCode, 0, `Writer memory ${profile} failed; inspect its report`)
  }
}
