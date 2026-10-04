import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getHeapStatistics } from 'node:v8'
import type { MemoryIndex as MemoryIndexType } from '../src/services/memory/engine'
import { chapterRevision } from '../src/services/memory/revision'
import type { MemoryIndexStats, MemorySearchResult } from '../src/types/memory'
import { createStressNovel } from './fixtures/memory-stress-corpus'

// Use this same script and fixture against both engine roots. Preparation, queries,
// JSON reporting and explicit GC are outside the measured sync call.
const profiles = {
  million: { chapters: 600, charsPerChapter: 2_200 },
  'three-million': { chapters: 1_500, charsPerChapter: 2_200 },
  'ten-million': { chapters: 2_500, charsPerChapter: 4_200 },
} as const
type Profile = keyof typeof profiles
const argument = (key: string, fallback: string) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback
const engineRoot = path.resolve(argument('engine-root', '.'))
const outputDirectory = path.resolve(argument('output', 'artifacts/memory-incremental'))
const label = argument('label', 'current')
assert.match(label, /^[a-zA-Z0-9_-]+$/, 'The report label must be a safe filename segment.')
const selectedProfile = argument('profile', 'all')
const childMode = process.argv.includes('--child')
const script = fileURLToPath(import.meta.url)
const rounded = (value: number) => Number(value.toFixed(3))
const mib = (bytes: number) => rounded(bytes / 1024 / 1024)
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

interface Measurement {
  operation: string
  syncMs: number
  sourceSha256: string
  fingerprint: string
  chapters: number
  chars: number
  passages: number
  acceptedClues: number
  staleClues: number
  work: MemoryIndexStats['sync'] | null
  rssMiB: number
  heapMiB: number
  sourceChecks: number
  queries: number
}

async function runProfile(profile: Profile) {
  const startedAt = new Date().toISOString()
  const started = performance.now()
  const reportPath = path.join(outputDirectory, `${label}-${profile}.json`)
  const engineSource = await readFile(path.join(engineRoot, 'src/services/memory/engine.ts'))
  const engineSha256 = sha256(engineSource)
  const engineCommit = execFileSync('git', ['-C', engineRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const engineWorkingTreeChanged = Boolean(execFileSync('git', ['-C', engineRoot, 'status', '--porcelain', '--', 'src/services/memory'], { encoding: 'utf8' }).trim())
  const { MemoryIndex } = await import(pathToFileURL(path.join(engineRoot, 'src/services/memory/engine.ts')).href) as { MemoryIndex: typeof MemoryIndexType }
  const originalFetch = globalThis.fetch
  let networkAttempts = 0
  globalThis.fetch = async () => { networkAttempts++; throw new Error('Network is forbidden in the incremental benchmark.') }
  const corpus = await createStressNovel(profiles[profile])
  const fixtureSha256 = sha256(JSON.stringify(corpus.project))
  const source = structuredClone(corpus.project)
  const index = new MemoryIndex()
  let stats: MemoryIndexStats
  let evidenceChecks = 0
  let queries = 0
  const measurements: Measurement[] = []
  const forbiddenValues: string[] = []
  const revisionCache = new Map<string, { title: string; text: string; revision: string }>()
  const loadAverageAtStart = os.loadavg()
  const environment = {
    node: process.version, platform: process.platform, arch: process.arch,
    cpu: os.cpus()[0]?.model ?? 'unknown', logicalCpus: os.cpus().length,
    totalMemoryMiB: mib(os.totalmem()), heapLimitMiB: mib(getHeapStatistics().heap_size_limit),
    loadAverageAtStart,
  }
  const hashes = {
    scriptSha256: sha256(await readFile(script)),
    fixtureGeneratorSha256: sha256(await readFile(new URL('./fixtures/memory-stress-corpus.ts', import.meta.url))),
    revisionHelperSha256: sha256(await readFile(new URL('../src/services/memory/revision.ts', import.meta.url))),
    fixtureSha256, engineSha256, engineCommit, engineWorkingTreeChanged,
  }

  async function checkpoint(status: 'running' | 'passed' | 'failed', error?: string) {
    await writeFile(reportPath, `${JSON.stringify({
      status, label, profile, startedAt, finishedAt: status === 'running' ? null : new Date().toISOString(),
      ...hashes, environment: { ...environment, loadAverageAtCheckpoint: os.loadavg() }, corpus: corpus.manifest, measurements,
      queries, exactSourceChecks: evidenceChecks, networkAttempts,
      totalMs: rounded(performance.now() - started), processPeakRssMiB: mib(process.resourceUsage().maxRSS * 1024),
      notes: [
        'The same immutable procedural source and operation order are used for both engine roots; compare fixture and per-operation source hashes.',
        'syncMs measures only await index.sync(snapshot). Source cloning, explicit GC, query validation, checksums and file IO are outside that interval.',
        'A fresh child process runs each profile sequentially. Explicit GC before each sync limits retained previous snapshots; these are engine microbenchmarks, not Writer save or UI latency.',
        'Cold, unchanged, edit 30 and combined reorder/delete run at all scales. Additional single chapter, append, clue-only and repeated edits run only at 1.32M.',
        'Source checks verify exact active text spans, independent chapter hashes, narrative cutoff and exclusion of superseded facts. These synthetic queries do not measure literary or semantic model quality.',
        'Baseline has no sync work counters; null means unavailable, not zero. Peak RSS covers the entire child, including fixture generation and validations.',
        'Development lint/build may overlap the baseline run. Load averages are recorded; one sample per operation is descriptive and is not a controlled hardware or percentile guarantee.',
      ], ...(error ? { error } : {}),
    }, null, 2)}\n`)
  }

  async function validate(result: MemorySearchResult, cutoff: string) {
    queries++
    assert.equal(result.projectId, source.id)
    assert.equal(result.fingerprint, stats.fingerprint)
    const through = source.chapters.findIndex(chapter => chapter.id === cutoff)
    assert.ok(through >= 0)
    for (const hit of result.hits) {
      const position = source.chapters.findIndex(chapter => chapter.id === hit.chapterId)
      assert.ok(position >= 0 && position <= through, 'Evidence belongs to an active disclosed chapter.')
      const chapter = source.chapters[position]!
      assert.equal(hit.ordinal, position + 1)
      assert.equal(hit.projectId, source.id)
      assert.equal(hit.chapterTitle, chapter.title)
      assert.equal(hit.quote, chapter.text.slice(hit.start, hit.end))
      let revision = revisionCache.get(chapter.id)
      if (!revision || revision.title !== chapter.title || revision.text !== chapter.text) {
        revision = { title: chapter.title, text: chapter.text, revision: await chapterRevision(chapter) }
        revisionCache.set(chapter.id, revision)
      }
      assert.equal(hit.revision, revision.revision, 'Revision is independently derived from the active source.')
      for (const forbidden of forbiddenValues) assert.ok(!hit.quote.includes(forbidden), `Superseded value must not appear: ${forbidden}`)
      evidenceChecks++
    }
    assert.equal(result.diagnostics.semantic, 'disabled')
    assert.equal(result.diagnostics.rerank, 'disabled')
    assert.equal(networkAttempts, 0)
    return result
  }

  async function search(text: string, cutoff = source.chapters.at(-1)!.id) {
    return validate(await index.search({ text, throughChapterId: cutoff, limit: 8 }), cutoff)
  }

  async function step(operation: string, verify?: () => Promise<void>) {
    const snapshot = structuredClone(source)
    const sourceSha256 = sha256(JSON.stringify(snapshot))
    globalThis.gc?.()
    const syncStarted = performance.now()
    stats = await index.sync(snapshot)
    const syncMs = performance.now() - syncStarted
    assert.equal(stats.chapters.length, source.chapters.length)
    assert.equal(stats.chars, source.chapters.reduce((sum, chapter) => sum + chapter.text.length, 0))
    const checksBefore = evidenceChecks
    const queriesBefore = queries
    for (const ordinal of [0, Math.floor(corpus.facts.length / 2), corpus.facts.length - 1]) {
      const fact = corpus.facts[ordinal]!
      const chapter = source.chapters.find(chapter => chapter.id === fact.chapterId)
      if (!chapter) continue
      const expected = chapter.text.includes(fact.oldValue) ? fact.oldValue : fact.replacementValue
      const result = await search(expected)
      assert.ok(result.hits.some(hit => hit.chapterId === chapter.id && hit.quote.includes(expected)), 'The fixed distant fact is retrievable.')
    }
    const cutoff = source.chapters[Math.floor(source.chapters.length / 2)]!.id
    await search('旧日约定', cutoff)
    if (verify) await verify()
    const memory = process.memoryUsage()
    measurements.push({
      operation, syncMs: rounded(syncMs), sourceSha256, fingerprint: stats.fingerprint,
      chapters: stats.chapters.length, chars: stats.chars, passages: stats.chunks,
      acceptedClues: stats.clues, staleClues: stats.staleClues,
      work: stats.sync ? { ...stats.sync } : null,
      rssMiB: mib(memory.rss), heapMiB: mib(memory.heapUsed),
      sourceChecks: evidenceChecks - checksBefore, queries: queries - queriesBefore,
    })
    await checkpoint('running')
    console.log(`[incremental ${label}/${profile}] ${operation}: ${rounded(syncMs)} ms`)
  }

  try {
    await checkpoint('running')
    await step('cold')
    const initialFingerprint = stats!.fingerprint
    await step('unchanged', async () => { assert.equal(stats.fingerprint, initialFingerprint) })
    const firstFact = corpus.facts[0]!
    if (profile === 'million') {
      const chapter = source.chapters.find(chapter => chapter.id === firstFact.chapterId)!
      chapter.text = chapter.text.replaceAll(firstFact.oldValue, firstFact.replacementValue)
      forbiddenValues.push(firstFact.oldValue)
      await step('edit-one-chapter', async () => { await search(firstFact.oldValue) })
    }
    for (const fact of corpus.editTargets) {
      const chapter = source.chapters.find(chapter => chapter.id === fact.chapterId)!
      chapter.text = chapter.text.replaceAll(fact.oldValue, fact.replacementValue)
      forbiddenValues.push(fact.oldValue)
    }
    await step('edit-30-chapters', async () => {
      for (const fact of corpus.editTargets) {
        await search(fact.oldValue)
        const replacement = await search(fact.replacementValue)
        assert.ok(replacement.hits.some(hit => hit.chapterId === fact.chapterId && hit.quote.includes(fact.replacementValue)))
      }
      assert.equal(stats.staleClues, 30)
    })
    const deletedFacts = corpus.facts.filter(fact => fact.ordinal > 100 && fact.ordinal <= 110)
    const deletedIds = new Set(deletedFacts.map(fact => fact.chapterId))
    source.chapters = source.chapters.filter(chapter => !deletedIds.has(chapter.id))
    source.chapters.unshift(source.chapters.pop()!)
    const disclosedSecret = corpus.futureSecrets.find(secret => secret.chapterId === source.chapters[0]!.id)!
    assert.ok(disclosedSecret)
    await step('reorder-and-delete-10', async () => {
      for (const fact of deletedFacts) {
        const result = await search(fact.oldValue)
        assert.ok(result.hits.every(hit => !deletedIds.has(hit.chapterId)))
      }
      const disclosed = await search(disclosedSecret.query, source.chapters[0]!.id)
      assert.ok(disclosed.hits.some(hit => hit.quote.includes(disclosedSecret.query)))
      assert.ok(disclosed.hits.every(hit => hit.ordinal === 1))
    })
    if (profile === 'million') {
      const added = { id: 'benchmark-appended-chapter', title: '追加章节', text: `追加密约 APPEND73129：旧舟将在今夜归航。\n\n${source.chapters[3]!.text}` }
      source.chapters.push(added)
      await step('append-one-chapter', async () => {
        assert.ok((await search('APPEND73129')).hits.some(hit => hit.chapterId === added.id))
        assert.ok((await search('APPEND73129', source.chapters.at(-2)!.id)).hits.every(hit => hit.chapterId !== added.id))
      })
      const activeClue = source.clues.find(clue => {
        const chapter = source.chapters.find(chapter => chapter.id === clue.chapterId)
        return chapter && chapter.text.slice(clue.start, clue.end) === clue.quote
      })!
      assert.ok(activeClue)
      activeClue.label = '修订后的作者伏笔'
      activeClue.aliases = [...activeClue.aliases, '修订索引别名 CLUE48276']
      await step('edit-clue-only', async () => {
        assert.ok((await search('CLUE48276')).hits.some(hit => hit.kind === 'clue' && hit.chapterId === activeClue.chapterId))
      })
      let previousMarker: string | undefined
      for (let cycle = 1; cycle <= 2; cycle++) {
        const chapter = source.chapters.find(chapter => chapter.id === firstFact.chapterId)!
        if (previousMarker) {
          chapter.text = chapter.text.replace(`\n\n${previousMarker}`, '')
          forbiddenValues.push(previousMarker)
        }
        const marker = `REPEAT${cycle}89761`
        chapter.text += `\n\n${marker}`
        await step(`repeat-edit-${cycle}`, async () => {
          assert.ok((await search(marker)).hits.some(hit => hit.chapterId === chapter.id && hit.quote.includes(marker)))
          if (previousMarker) await search(previousMarker)
        })
        previousMarker = marker
      }
    }
    assert.equal(networkAttempts, 0)
    // Abort publication if the implementation changed while a profile ran.
    assert.equal(sha256(await readFile(path.join(engineRoot, 'src/services/memory/engine.ts'))), engineSha256, 'Engine source changed during measurement.')
    await checkpoint('passed')
  } catch (error) {
    await checkpoint('failed', error instanceof Error ? error.stack ?? error.message : String(error))
    throw error
  } finally {
    globalThis.fetch = originalFetch
  }
}

await mkdir(outputDirectory, { recursive: true })
if (childMode) {
  assert.ok(selectedProfile in profiles, `Unknown profile: ${selectedProfile}`)
  await runProfile(selectedProfile as Profile)
} else {
  const selected = selectedProfile === 'all' ? Object.keys(profiles) as Profile[] : [selectedProfile as Profile]
  assert.ok(selected.every(profile => profile in profiles), `Unknown profile: ${selectedProfile}`)
  const reports: unknown[] = []
  for (const profile of selected) {
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, ['--expose-gc', '--import', 'tsx', script, `--engine-root=${engineRoot}`, `--output=${outputDirectory}`, `--label=${label}`, `--profile=${profile}`, '--child'], { stdio: 'inherit' })
      child.once('error', reject)
      child.once('exit', code => resolve(code ?? 1))
    })
    reports.push(JSON.parse(await readFile(path.join(outputDirectory, `${label}-${profile}.json`), 'utf8')))
    await writeFile(path.join(outputDirectory, `${label}.json`), `${JSON.stringify({ label, profiles: reports }, null, 2)}\n`)
    assert.equal(code, 0, `The ${profile} child failed; inspect ${label}-${profile}.json.`)
  }
}
