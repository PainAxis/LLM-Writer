import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getHeapStatistics } from 'node:v8'
import { MemoryIndex } from '../src/services/memory/engine'
import type { MemoryIndexStats, MemoryProjectInput, MemorySearchResult } from '../src/types/memory'
import { createStressNovel, type StressProbe } from './fixtures/memory-stress-corpus'

const outputDirectory = path.resolve('artifacts/memory-stress')
const profiles = {
  million: { chapters: 600, charsPerChapter: 2_200 },
  'three-million': { chapters: 1_500, charsPerChapter: 2_200 },
  'ten-million': { chapters: 2_500, charsPerChapter: 4_200 },
} as const
type Profile = keyof typeof profiles
const startedAt = new Date().toISOString()
const script = fileURLToPath(import.meta.url)
const argument = process.argv.find(value => value.startsWith('--profile='))?.slice('--profile='.length) ?? 'all'
const childMode = process.argv.includes('--child')
const rounded = (value: number) => Number(value.toFixed(3))
const mib = (bytes: number) => rounded(bytes / 1024 / 1024)

function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = (fraction: number) => rounded(sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? 0)
  return { count: values.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maximumMs: rounded(sorted.at(-1) ?? 0) }
}

function recall(ranks: number[]) {
  return {
    probes: ranks.length,
    at1: rounded(ranks.filter(rank => rank > 0 && rank <= 1).length / ranks.length),
    at5: rounded(ranks.filter(rank => rank > 0 && rank <= 5).length / ranks.length),
    at8: rounded(ranks.filter(rank => rank > 0 && rank <= 8).length / ranks.length),
  }
}

function verifySyncWork(stats: MemoryIndexStats, mode: MemoryIndexStats['sync']['mode'], rebuiltChapters: number) {
  assert.equal(stats.sync.mode, mode)
  assert.equal(stats.sync.rebuiltChapters, rebuiltChapters, 'only changed/new chapter bodies may be hashed and chunked')
  assert.equal(stats.sync.reusedChapters, stats.chapters.length - rebuiltChapters)
  assert.equal(stats.sync.insertedDocuments + stats.sync.reusedDocuments, stats.chunks + stats.clues)
  if (mode === 'unchanged') {
    assert.equal(stats.sync.insertedDocuments, 0)
    assert.equal(stats.sync.removedDocuments, 0)
  }
}

async function runProfile(profile: Profile) {
  const wallStart = performance.now()
  await writeFile(path.join(outputDirectory, `local-${profile}.json`), `${JSON.stringify({ status: 'running', profile, startedAt, stage: 'corpus generation / initial build' }, null, 2)}\n`)
  const engineSha256 = createHash('sha256').update(await readFile('src/services/memory/engine.ts')).digest('hex')
  const loadAverageAtStart = os.loadavg()
  let networkAttempts = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    networkAttempts++
    throw new Error('Network requests are forbidden in the local memory stress suite.')
  }
  let observedHeapPeak = process.memoryUsage().heapUsed
  const sampleHeap = () => { observedHeapPeak = Math.max(observedHeapPeak, process.memoryUsage().heapUsed) }
  const sampler = setInterval(sampleHeap, 25)
  const heapStart = process.memoryUsage().heapUsed
  const corpusStarted = performance.now()
  const corpus = await createStressNovel(profiles[profile])
  const corpusMs = performance.now() - corpusStarted
  const index = new MemoryIndex()
  const buildStarted = performance.now()
  let currentStats = await index.sync(corpus.project)
  const coldFullRebuildMs = performance.now() - buildStarted
  const initialStats = currentStats
  let currentProject = corpus.project
  let searched = 0
  let checkedEvidence = 0
  const cases: Array<{ name: string; passed: boolean; details?: unknown }> = []
  const positiveRows: Array<{ id: string; query: string; expectedChapter: string; rank: number; searchMs: number; visibleChapters: number; visibleChars: number; visiblePassages: number }> = []
  const allRanks: number[] = []
  const queryTimes: number[] = []
  const warmQueryTimes: number[] = []

  function validateEvidence(result: MemorySearchResult, cutoff: string) {
    assert.equal(result.projectId, currentProject.id)
    assert.equal(result.fingerprint, currentStats.fingerprint)
    const through = currentProject.chapters.findIndex(chapter => chapter.id === cutoff)
    const chaptersById = new Map(currentProject.chapters.map((chapter, position) => [chapter.id, { chapter, position }]))
    const revisions = new Map(currentStats.chapters.map(chapter => [chapter.id, chapter.revision]))
    for (const hit of result.hits) {
      const source = chaptersById.get(hit.chapterId)
      assert.ok(source, 'every evidence item has an active source chapter')
      assert.ok(source.position <= through, 'future chapters never appear in evidence')
      assert.equal(hit.ordinal, source.position + 1)
      assert.equal(hit.revision, revisions.get(hit.chapterId), 'only the current chapter revision can be returned')
      assert.equal(hit.quote, source.chapter.text.slice(hit.start, hit.end), 'the source span reproduces the quote exactly')
      assert.equal(hit.projectId, currentProject.id)
      assert.ok(!/^[\udc00-\udfff]/u.test(hit.quote), 'evidence must not start inside an emoji surrogate pair')
      assert.ok(!/[\ud800-\udbff]$/u.test(hit.quote), 'evidence must not end inside an emoji surrogate pair')
      checkedEvidence++
    }
    sampleHeap()
    assert.equal(networkAttempts, 0, 'the local suite must not attempt external API calls')
  }

  async function search(text: string, throughChapterId: string, limit = 8) {
    const result = await index.search({ text, throughChapterId, limit })
    searched++
    validateEvidence(result, throughChapterId)
    assert.equal(result.diagnostics.semantic, 'disabled')
    assert.equal(result.diagnostics.rerank, 'disabled')
    return result
  }

  const probeRank = (result: MemorySearchResult, probe: StressProbe) =>
    result.hits.findIndex(hit => hit.chapterId === probe.chapterId && hit.quote.includes(probe.quote)) + 1

  try {
    assert.equal(initialStats.chars, profiles[profile].chapters * profiles[profile].charsPerChapter)
    assert.equal(initialStats.chapters.length, profiles[profile].chapters)
    assert.equal(initialStats.clues, corpus.project.clues.length)
    assert.equal(initialStats.staleClues, 0)
    verifySyncWork(initialStats, 'full', profiles[profile].chapters)
    assert.equal(initialStats.sync.reusedDocuments, 0)
    assert.equal(initialStats.sync.removedDocuments, 0)
    cases.push({ name: 'Build the complete varied multivolume manuscript with all anchored clues', passed: true })

    for (const probe of corpus.positiveQueries) {
      const result = await search(probe.query, probe.throughChapterId)
      const rank = probeRank(result, probe)
      const visibleChapters = corpus.project.chapters.findIndex(chapter => chapter.id === probe.throughChapterId) + 1
      positiveRows.push({
        id: probe.id, query: probe.query, expectedChapter: probe.chapterId, rank,
        searchMs: rounded(result.searchMs), visibleChapters,
        visibleChars: initialStats.chapters.slice(0, visibleChapters).reduce((sum, chapter) => sum + chapter.chars, 0),
        visiblePassages: result.diagnostics.eligiblePassages,
      })
      allRanks.push(rank)
      queryTimes.push(result.searchMs)
      assert.ok(rank > 0, `${probe.id}: planted compound identifier / clue alias must recover its exact source in the top 8`)
    }
    cases.push({ name: '48 fixed exact-source probes distributed across the whole book and narrative cutoffs', passed: true, details: recall(allRanks) })
    for (const probe of corpus.positiveQueries) {
      const result = await search(probe.query, probe.throughChapterId)
      assert.ok(probeRank(result, probe) > 0)
      warmQueryTimes.push(result.searchMs)
    }
    cases.push({ name: 'Repeat the same 48 searches against the already built index', passed: true })

    const naturalRows: Array<{ id: string; query: string; relevantChapters: string[]; rank: number; searchMs: number }> = []
    for (const probe of corpus.naturalQueries) {
      const result = await search(probe.query, probe.throughChapterId)
      naturalRows.push({
        id: probe.id, query: probe.query, relevantChapters: probe.relevantChapterIds,
        rank: result.hits.findIndex(hit => probe.relevantChapterIds.includes(hit.chapterId)) + 1,
        searchMs: rounded(result.searchMs),
      })
    }
    cases.push({ name: '12 natural multi-entity queries, with oracle chapters defined by generated fact relationships', passed: true,
      details: { role: 'Descriptive lexical retrieval quality; no semantic model is enabled and there is no claimed universal quality threshold.', ...recall(naturalRows.map(row => row.rank)) } })
    const negativeRows: Array<{ query: string; hits: number }> = []
    for (const text of corpus.negativeQueries) {
      const result = await search(text, corpus.project.chapters.at(-1)!.id)
      negativeRows.push({ query: text, hits: result.hits.length })
      assert.equal(result.hits.length, 0, `out-of-domain query has no fabricated evidence: ${text}`)
    }
    cases.push({ name: '8 no-answer queries return no source evidence', passed: true })

    for (const secret of corpus.futureSecrets) {
      const before = await search(secret.query, secret.beforeChapterId)
      assert.ok(before.hits.every(hit => !hit.quote.includes(secret.query)))
      const disclosed = await search(secret.query, secret.throughChapterId)
      assert.ok(probeRank(disclosed, secret) > 0, `${secret.id}: explicit disclosure recovers the secret`)
      const recut = await search(secret.query, secret.beforeChapterId)
      assert.ok(recut.hits.every(hit => !hit.quote.includes(secret.query)), 'opening future chapters must not poison the earlier cutoff')
    }
    cases.push({ name: '12 late identities stay hidden, become visible at disclosure, and disappear again when the cutoff is restored', passed: true })

    const crowded = await search('旧日约定', corpus.project.chapters[9]!.id)
    assert.ok(crowded.hits.length >= 5, 'early anchored clues survive many later clues with the same alias')
    assert.ok(crowded.hits.every(hit => hit.ordinal <= 10))
    cases.push({ name: 'Shared aliases in hundreds of future chapters cannot displace five disclosed early clues', passed: true,
      details: { visibleClues: 5, laterCompetingClues: initialStats.clues - 5 } })

    // Simulate receiving a fresh deserialized manuscript, not the original object identity.
    const rehydratedSnapshot = JSON.parse(JSON.stringify(currentProject)) as MemoryProjectInput
    const secondBuild = performance.now()
    currentStats = await index.sync(rehydratedSnapshot)
    const unchangedSyncMs = performance.now() - secondBuild
    assert.equal(currentStats.fingerprint, initialStats.fingerprint)
    verifySyncWork(currentStats, 'unchanged', 0)
    const unchangedSyncWork = currentStats.sync
    const afterFullSync = await search(corpus.clues[0]!.query, corpus.clues.at(-1)!.throughChapterId)
    assert.ok(probeRank(afterFullSync, corpus.clues[0]!) > 0)
    cases.push({ name: 'Repeat a fresh-source sync, reusing the index only for a completely unchanged snapshot', passed: true })

    const originalRevisions = new Map(initialStats.chapters.map(chapter => [chapter.id, chapter.revision]))
    const edited = structuredClone(corpus.project)
    for (const fact of corpus.editTargets) {
      const chapter = edited.chapters.find(chapter => chapter.id === fact.chapterId)!
      chapter.text = chapter.text.replaceAll(fact.oldValue, fact.replacementValue)
    }
    const editStarted = performance.now()
    const pendingSync = index.sync(edited)
    await assert.rejects(index.search({ text: corpus.editTargets[0]!.query, throughChapterId: edited.chapters.at(-1)!.id }), /尚未就绪/)
    currentStats = await pendingSync
    currentProject = edited
    const editSyncMs = performance.now() - editStarted
    verifySyncWork(currentStats, 'incremental', corpus.editTargets.length)
    const editSyncWork = currentStats.sync
    assert.equal(currentStats.staleClues, corpus.editTargets.length)
    assert.equal(currentStats.clues, initialStats.clues - corpus.editTargets.length)
    assert.equal(currentStats.chunks, initialStats.chunks, 'same-length substitutions must preserve passage boundaries')
    assert.equal(currentStats.sync.removedDocuments, currentStats.sync.insertedDocuments + corpus.editTargets.length,
      'changed chapter passages are replaced, while the now-stale anchored clues are removed')
    assert.equal(currentStats.sync.reusedDocuments, initialStats.chunks + initialStats.clues - currentStats.sync.removedDocuments)
    for (const fact of corpus.editTargets) {
      const old = await search(fact.oldValue, edited.chapters.at(-1)!.id)
      assert.ok(old.hits.every(hit => !hit.quote.includes(fact.oldValue)), 'the old fact cannot remain in evidence after a chapter edit')
      const replacement = await search(fact.replacementValue, edited.chapters.at(-1)!.id)
      assert.ok(replacement.hits.some(hit => hit.chapterId === fact.chapterId && hit.quote.includes(fact.replacementValue)), 'the replacement is searchable')
      assert.ok(replacement.hits.filter(hit => hit.chapterId === fact.chapterId).every(hit => hit.revision !== originalRevisions.get(fact.chapterId)))
      const clue = corpus.clues.find(clue => clue.chapterId === fact.chapterId)!
      const staleClue = await search(clue.query, edited.chapters.at(-1)!.id)
      assert.ok(staleClue.hits.every(hit => !(hit.kind === 'clue' && hit.chapterId === fact.chapterId)), 'unchanged annotation text cannot bypass a source revision change')
    }
    cases.push({ name: 'Batch-edit 30 old chapters after warm searches; retract every stale fact and all 30 stale clues', passed: true,
      details: { editedChapters: corpus.editTargets.length, staleClues: currentStats.staleClues, sync: editSyncWork } })

    const repeatedEdits: Array<{ iteration: number; syncMs: number; sync: MemoryIndexStats['sync'] }> = []
    const repeatedTarget = corpus.editTargets[0]!
    const alternateValue = repeatedTarget.replacementValue.replace('赤铜封蜡', '碧玉封蜡')
    let previousValue = repeatedTarget.replacementValue
    for (let iteration = 1; iteration <= 12; iteration++) {
      const nextValue = iteration % 2 ? alternateValue : repeatedTarget.replacementValue
      const nextProject = { ...currentProject, chapters: currentProject.chapters.map(chapter => chapter.id === repeatedTarget.chapterId
        ? { ...chapter, text: chapter.text.replaceAll(previousValue, nextValue) } : chapter) }
      const started = performance.now()
      currentStats = await index.sync(nextProject)
      repeatedEdits.push({ iteration, syncMs: rounded(performance.now() - started), sync: currentStats.sync })
      currentProject = nextProject
      verifySyncWork(currentStats, 'incremental', 1)
      assert.equal(currentStats.sync.insertedDocuments, currentStats.sync.removedDocuments)
      assert.ok(currentStats.sync.insertedDocuments > 0 && currentStats.sync.insertedDocuments <= 6,
        'a single edited chapter must not accumulate or rebuild other chapters\' index documents')
      assert.equal(currentStats.chunks, initialStats.chunks)
      assert.ok((await search(previousValue, nextProject.chapters.at(-1)!.id)).hits.every(hit => !hit.quote.includes(previousValue)))
      assert.ok((await search(nextValue, nextProject.chapters.at(-1)!.id)).hits.some(hit => hit.chapterId === repeatedTarget.chapterId && hit.quote.includes(nextValue)))
      previousValue = nextValue
    }
    assert.equal(previousValue, repeatedTarget.replacementValue, 'the alternating edit cycle ends on the original revised fixture')
    cases.push({ name: '12 consecutive saves of one early chapter replace only its own documents and never recover a superseded revision', passed: true,
      details: { editedChapter: repeatedTarget.chapterId, iterations: repeatedEdits.length, syncMs: distribution(repeatedEdits.map(edit => edit.syncMs)) } })

    const reordered = structuredClone(edited)
    const movedClue = corpus.clues.find(clue => clue.ordinal > 60)!
    const movedChapter = reordered.chapters.splice(reordered.chapters.findIndex(chapter => chapter.id === movedClue.chapterId), 1)[0]!
    reordered.chapters.push(movedChapter)
    const movedSecret = corpus.futureSecrets[0]!
    const disclosedChapter = reordered.chapters.splice(reordered.chapters.findIndex(chapter => chapter.id === movedSecret.chapterId), 1)[0]!
    reordered.chapters.unshift(disclosedChapter)
    const deletedIds = new Set(corpus.editTargets.slice(0, 10).map(fact => fact.chapterId))
    const untouchedDeleted = corpus.clues.filter(clue => clue.ordinal > 100 && clue.chapterId !== movedClue.chapterId).slice(0, 10)
    for (const clue of untouchedDeleted) deletedIds.add(clue.chapterId)
    reordered.chapters = reordered.chapters.filter(chapter => !deletedIds.has(chapter.id))
    const reorderStarted = performance.now()
    currentStats = await index.sync(reordered)
    currentProject = reordered
    const reorderDeleteSyncMs = performance.now() - reorderStarted
    verifySyncWork(currentStats, 'incremental', 0)
    const reorderDeleteSyncWork = currentStats.sync
    assert.equal(currentStats.sync.insertedDocuments, 0, 'ordinal changes must not re-tokenize retained text')
    assert.ok(currentStats.sync.removedDocuments > 0)
    assert.equal(currentStats.chapters.length, initialStats.chapters.length - 20)
    assert.equal(currentStats.staleClues, corpus.editTargets.length + untouchedDeleted.length)
    const midCutoff = reordered.chapters[Math.floor(reordered.chapters.length / 2)]!.id
    assert.ok((await search(movedClue.query, midCutoff)).hits.every(hit => hit.chapterId !== movedClue.chapterId))
    assert.ok(probeRank(await search(movedClue.query, movedClue.chapterId), movedClue) > 0)
    assert.ok(probeRank(await search(movedSecret.query, reordered.chapters[0]!.id), movedSecret) > 0)
    for (const removed of untouchedDeleted) {
      await assert.rejects(index.search({ text: removed.query, throughChapterId: removed.chapterId }), /截止章节不存在/)
      assert.ok((await search(removed.query, reordered.chapters.at(-1)!.id)).hits.every(hit => hit.chapterId !== removed.chapterId))
    }
    cases.push({ name: 'Reorder disclosure and delete 20 chapters: late-moved clues hide, early-moved secrets disclose, deleted cutoffs fail closed', passed: true })

    const other: MemoryProjectInput = {
      id: `${corpus.project.id}-other`, title: '另一部小说，同名章节与人物', clues: [],
      chapters: corpus.project.chapters.slice(0, 80).map(chapter => ({
        id: chapter.id, title: chapter.title, text: '同名人物在另一部小说中收藏一枚黑曜石。来源隔离必须遵守项目身份，不能只看章节编号。',
      })),
    }
    currentStats = await index.sync(other)
    currentProject = other
    assert.equal((await search(corpus.facts[0]!.query, other.chapters.at(-1)!.id)).hits.length, 0)
    const otherHits = await search('黑曜石', other.chapters.at(-1)!.id)
    assert.ok(otherHits.hits.length > 0 && otherHits.hits.every(hit => hit.projectId === other.id))
    cases.push({ name: 'Switch to another project reusing 80 chapter IDs without cross-project facts', passed: true })

    const maxChunk = '界'.repeat(2_000_000)
    const overLimit: MemoryProjectInput = {
      id: 'over-capacity', title: 'The 20,000,001-character failure boundary', clues: [],
      chapters: [...Array.from({ length: 10 }, (_, position) => ({ id: `cap-${position}`, title: '', text: maxChunk })),
        { id: 'cap-over', title: '', text: '界' }],
    }
    await assert.rejects(index.sync(overLimit), /2,000 万字符/)
    await assert.rejects(index.search({ text: '黑曜石', throughChapterId: other.chapters[0]!.id }), /尚未就绪/)
    cases.push({ name: '20,000,001 characters fail before indexing and leave no stale usable index', passed: true })

    sampleHeap()
    const result = {
      status: 'passed', startedAt, finishedAt: new Date().toISOString(), profile,
      source: { fixture: 'scripts/fixtures/memory-stress-corpus.ts', engineSha256 },
      runtime: { node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: rounded(os.totalmem() / 1024 ** 3), loadAverageAtStart },
      corpus: corpus.manifest,
      index: { characters: initialStats.chars, chapters: initialStats.chapters.length, passages: initialStats.chunks, clues: initialStats.clues },
      timings: { corpusGenerationMs: rounded(corpusMs), coldFullRebuildMs: rounded(coldFullRebuildMs), unchangedSyncMs: rounded(unchangedSyncMs),
        editSyncMs: rounded(editSyncMs), reorderDeleteSyncMs: rounded(reorderDeleteSyncMs), repeatedSingleChapterSync: distribution(repeatedEdits.map(edit => edit.syncMs)),
        firstPassSearchOnly: distribution(queryTimes), repeatedSearchOnly: distribution(warmQueryTimes), totalWallMs: rounded(performance.now() - wallStart) },
      syncWork: { cold: initialStats.sync, unchanged: unchangedSyncWork, thirtyChapterEdit: editSyncWork, reorderDelete: reorderDeleteSyncWork, repeatedEdits },
      memory: { heapLimitMiB: mib(getHeapStatistics().heap_size_limit), baselineHeapMiB: mib(heapStart), finalHeapMiB: mib(process.memoryUsage().heapUsed), observedHeapPeakMiB: mib(observedHeapPeak),
        processPeakRssMiB: rounded(process.resourceUsage().maxRSS / 1024),
        measurement: 'Each profile runs in a fresh child process. Peak RSS is the OS-reported high-water mark for the entire profile, including source, snapshots, index rebuild overlap and fixture creation. Heap peak is sampled at 25 ms and explicit checkpoints; brief synchronous peaks may be missed.' },
      summary: { cases: cases.length, searches: searched, evidenceItemsChecked: checkedEvidence, networkAttempts, noExternalRequests: networkAttempts === 0 },
      compoundIdentifierAndClueRecall: recall(allRanks), naturalMultiEntityRecall: recall(naturalRows.map(row => row.rank)),
      cases, probes: positiveRows, naturalQueries: naturalRows, noAnswerQueries: negativeRows,
      limitations: [
        'This corpus uses eight procedural paragraph templates and per-event numbers; unique paragraph strings do not imply natural literary diversity.',
        'The 48 planted compound-identifier/author-alias queries test exact-source retrieval. They are not an embedding-model semantic-quality benchmark.',
        'Natural multi-entity query quality is descriptive and includes the generated fact relation as its oracle; no external model is used.',
        'Search-only timings exclude the fresh-source sync the UI performs before searching; unchanged, incremental edit and reorder/delete synchronization are reported separately. Work counters enforce scope without machine-specific latency thresholds.',
        'Node memory and timing do not substitute for browser measurements. The 20,000,001-character test covers rejection, not successful operation at the limit.',
      ],
    }
    await writeFile(path.join(outputDirectory, `local-${profile}.json`), `${JSON.stringify(result, null, 2)}\n`)
    console.log(`[memory stress ${profile}] ${initialStats.chars.toLocaleString('en-US')} chars; ${cases.length} workflows; ${searched} searches; ${checkedEvidence} exact evidence checks; build ${rounded(coldFullRebuildMs)} ms; search p95 ${distribution(queryTimes).p95Ms} ms; peak RSS ${result.memory.processPeakRssMiB} MiB`)
    return result
  } catch (error) {
    await writeFile(path.join(outputDirectory, `local-${profile}.json`), `${JSON.stringify({ status: 'failed', profile, corpus: corpus.manifest, cases, probes: positiveRows, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`)
    throw error
  } finally {
    clearInterval(sampler)
    globalThis.fetch = originalFetch
  }
}

await mkdir(outputDirectory, { recursive: true })
if (childMode) {
  assert.ok(argument in profiles, `Unknown stress profile: ${argument}`)
  await runProfile(argument as Profile)
} else {
  const selected = argument === 'all' ? Object.keys(profiles) as Profile[] : [argument as Profile]
  assert.ok(selected.every(profile => profile in profiles), `Unknown stress profile: ${argument}`)
  const results: Array<Record<string, unknown>> = []
  for (const profile of selected) {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', script, `--profile=${profile}`, '--child'], { stdio: 'inherit' })
      child.once('error', reject)
      child.once('exit', resolve)
    })
    const result = JSON.parse(await readFile(path.join(outputDirectory, `local-${profile}.json`), 'utf8')) as Record<string, unknown>
    if (exitCode !== 0) {
      result.status = 'failed'
      result.processExitCode = exitCode
      result.error ??= 'The isolated stress process terminated before completing; inspect its console output for runtime resource limits.'
      await writeFile(path.join(outputDirectory, `local-${profile}.json`), `${JSON.stringify(result, null, 2)}\n`)
    }
    results.push(result)
    const status = results.length < selected.length ? 'running' : results.every(result => result.status === 'passed') ? 'passed' : 'failed'
    await writeFile(path.join(outputDirectory, 'local.json'), `${JSON.stringify({ status, requestedProfiles: selected, completedProfiles: results.length, startedAt, updatedAt: new Date().toISOString(), isolatedProfileProcesses: true, results }, null, 2)}\n`)
  }
  assert.ok(results.every(result => result.status === 'passed'), 'One or more memory stress profiles failed; inspect artifacts/memory-stress/local.json')
  console.log('All selected local memory stress profiles passed. Report: artifacts/memory-stress/local.json')
}
