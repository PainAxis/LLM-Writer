/** Real Chromium committed-source microbenchmark; production modules stay untouched. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import { makeMixedWriterMemoryFixture, mixedMemoryProbe, writerMemoryProjectId } from './fixtures/writer-memory-corpus.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const argument = (name, fallback) => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const sourceRoot = path.resolve(argument('source-root', root))
const output = path.resolve(argument('output', 'artifacts/memory-source-capacity'))
const label = argument('label', 'current')
const profile = argument('profile', 'all')
const samples = Number(argument('samples', '3'))
assert.match(label, /^[\w-]+$/)
assert.ok(['all', 'million', 'ten-million'].includes(profile))
assert.ok(Number.isSafeInteger(samples) && samples >= 1 && samples <= 10)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const sourceFiles = ['src/services/novelPersistence.ts', 'src/services/blobStore.ts', 'src/utils/storage.ts', 'src/utils/writerContent.ts', 'src/services/memory/labData.ts', 'src/services/memory/writerContext.ts', 'src/services/memory/client.ts', 'src/services/memory/engine.ts', 'src/services/memory/revision.ts', 'src/services/memory/factGraphStore.ts', 'src/services/memory/factGraph.ts', 'src/services/memory/matchSignals.ts', 'src/services/memory/identifiers.ts', 'src/services/memory/providers.ts', 'src/services/storageCoordination.ts', 'src/utils/novelConcurrency.ts', 'src/services/memory/memory.worker.ts']
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, sha256(await readFile(path.join(sourceRoot, file)))])))
const temporary = await mkdtemp(path.join(os.tmpdir(), 'llm-memory-source-'))
const built = path.join(temporary, 'dist')
const report = {
  schemaVersion: 1, status: 'running', label, startedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceWorkingTreeChanged: !!execFileSync('git', ['-C', sourceRoot, 'status', '--porcelain', '--', ...sourceFiles], { encoding: 'utf8' }).trim(),
  sourceHashes,
  harnessHashes: Object.fromEntries(await Promise.all(['scripts/benchmark-memory-source.mjs', 'scripts/fixtures/memory-source-probe.ts', 'scripts/fixtures/writer-memory-corpus.mjs'].map(async file => [file, sha256(await readFile(path.join(root, file)))]))),
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), loadAverage: os.loadavg() },
  samples, scenarios: [], blockedRequests: [], browserErrors: [],
  notes: [
    'Standalone Vite production bundle imports real persistence, source and Writer-memory services. This is a service-level Chromium measurement, not a mounted product UI or model-generation latency benchmark.',
    'Each sample opens a new page on the same committed IndexedDB/localStorage collection. page.coldPersistenceInit measures application hydration, not browser launch, module download, or operating-system cold disk cache.',
    'Per-phase timing includes instrumented IndexedDB calls and browser heap observations. IDB counters cover the main page only; worker indexing uses memory and is timed separately. Phases are sequential, not additive: readMemoryNovel includes committed reads and HTML conversion.',
    'Target-only and target-plus-one-equally-sized-unrelated-novel use isolated browser contexts. Fixture import and reporting are outside measured intervals. Three samples are descriptive, not latency percentiles.',
    'Writer cold prepare and fresh-page restore run only on the 600-chapter profile. The current index is not persisted: fresh-page restore rebuilds it. The 2500-chapter profile measures committed-source reads, conversion, cloning and revision hashing only; Node capacity and existing built-UI suites cover its other costs.',
    'All remote providers remain disabled. pre-transport/pre-accept checks call the real freshness guard without sending a model request. Existing browser-writer-memory acceptance owns Memory Lab-to-Writer business and real request-boundary assertions.',
  ],
}
await mkdir(output, { recursive: true })
const reportPath = path.join(output, `${label}-${profile}.json`)
const checkpoint = async () => writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
let server
let browser
function fixtureFor(name) {
  const fixture = makeMixedWriterMemoryFixture('http://disabled.invalid/v1', { long: true })
  const novel = fixture.backup.data.novels[0]
  if (name === 'ten-million') {
    const core = novel.chapterList.slice(0, -2)
    for (const chapter of core) {
      if (chapter.content.length > 2000) {
        const text = chapter.content.slice(3, -4)
        chapter.content = `<p>${text.repeat(2).slice(0, 4200)}</p>`
        chapter.wordCount = 4200
      }
    }
    const additions = Array.from({ length: 1900 }, (_, index) => {
      const text = `第${index + 601}日，行人在河边记录草木山川，整理绳索和行囊，继续前往下一座驿站。`.repeat(150).slice(0, 4200)
      return { ...core[5], id: 900000 + index, title: `容量附章${index + 601}`, content: `<p>${text}</p>`, wordCount: text.length }
    })
    novel.chapterList = [...core, ...additions, ...novel.chapterList.slice(-2)]
  }
  const chars = novel.chapterList.reduce((sum, chapter) => sum + chapter.content.length - 7, 0)
  novel.chapters = novel.chapterList.length
  novel.wordCount = novel.totalWords = chars
  const targetChapterId = String(novel.chapterList.at(-3).id)
  // All fixture HTML is exactly one paragraph; independently derive the source
  // oracle without calling the production converter being measured.
  const expectedSource = { id: writerMemoryProjectId, title: novel.title, clues: [], chapters: novel.chapterList.map(chapter => ({ id: String(chapter.id), title: chapter.title, text: chapter.content.slice(3, -4) })) }
  return {
    novel, graph: fixture.backup.data.factGraphs[0],
    config: { projectId: writerMemoryProjectId, targetChapterId, query: mixedMemoryProbe.query,
      exactIdentifier: mixedMemoryProbe.identifier, expectedChars: chars,
      expectedChapters: novel.chapterList.length, expectedDisclosed: novel.chapterList.length - 2 },
    manifest: { chapters: novel.chapterList.length, sourceChars: chars,
      disclosedChapters: novel.chapterList.length - 2,
      fixtureSha256: sha256(JSON.stringify(novel)), sourceSha256: sha256(JSON.stringify(expectedSource)), splitChapters: novel.chapterList.filter(chapter => chapter.content.length > 2000).length },
  }
}
try {
  await build({ configFile: false, root, logLevel: 'warn', resolve: { alias: { '@': path.join(sourceRoot, 'src') } },
    build: { outDir: built, emptyOutDir: true, minify: true, lib: { entry: path.join(root, 'scripts/fixtures/memory-source-probe.ts'), formats: ['es'], fileName: () => 'probe.js' } },
  })
  if (process.argv.includes('--build-only')) {
    report.status = 'build-only'
    report.notes.push('Bundle compilation only: no browser or performance measurements were run.')
  } else {
  await writeFile(path.join(built, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Memory source benchmark</title><script type="module" src="/probe.js"></script>')
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname)
      const target = path.resolve(built, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (!target.startsWith(`${built}${path.sep}`)) { response.writeHead(403).end(); return }
      const bytes = await readFile(target)
      response.writeHead(200, { 'Content-Type': target.endsWith('.html') ? 'text/html' : 'text/javascript', 'Cache-Control': 'no-store' }).end(bytes)
    } catch { response.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ args: ['--enable-precise-memory-info'] })
  report.environment.chromium = browser.version()
  for (const name of profile === 'all' ? ['million', 'ten-million'] : [profile]) {
    for (const unrelated of [false, true]) {
      const fixture = fixtureFor(name)
      const context = await browser.newContext()
      await context.route('**/*', route => {
        const url = new URL(route.request().url())
        if (['blob:', 'data:'].includes(url.protocol) || url.origin === origin) return route.continue()
        report.blockedRequests.push(url.origin + url.pathname)
        return route.abort('blockedbyclient')
      })
      context.on('page', page => page.on('pageerror', error => report.browserErrors.push(String(error.stack || error))))
      const open = async () => {
        const page = await context.newPage()
        page.setDefaultTimeout(120000)
        await page.goto(origin)
        await page.waitForFunction(() => !!globalThis.__memorySourceBenchmark)
        return page
      }
      try {
        let page = await open()
        const novels = [fixture.novel]
        if (unrelated) novels.push({ ...structuredClone(fixture.novel), id: 69500, title: 'Unrelated equally sized synthetic novel' })
        const seed = await page.evaluate(({ novels, graph }) => globalThis.__memorySourceBenchmark.seed(novels, graph), { novels, graph: fixture.graph })
        assert.equal(seed.splitChapters, fixture.manifest.splitChapters * novels.length, 'Use actual committed split bodies')
        await page.close()
        const scenario = { profile: name, unrelatedNovels: Number(unrelated), fixture: fixture.manifest, seed, samples: [] }
        report.scenarios.push(scenario)
        for (let sample = 0; sample < samples; sample++) {
          page = await open()
          const reads = await page.evaluate(config => globalThis.__memorySourceBenchmark.readPhases(config), fixture.config)
          assert.equal(reads.validation.sourceSha256, fixture.manifest.sourceSha256, 'Read source must exactly equal the independently constructed fixture')
          const result = { sample, ...reads }
          scenario.samples.push(result)
          await checkpoint()
          if (name === 'million' && sample < 2) {
            result.writer = await page.evaluate(({ config, mode }) => globalThis.__memorySourceBenchmark.writerPhases(config, mode), { config: fixture.config, mode: sample === 0 ? 'cold' : 'newPageRestore' })
          }
          await page.close()
          await checkpoint()
          process.stdout.write(`${label} ${name} unrelated=${Number(unrelated)} sample=${sample + 1}/${samples} passed\n`)
        }
      } finally { await context.close() }
    }
  }
  assert.equal(report.blockedRequests.length, 0, 'Unexpected external request')
  assert.equal(report.browserErrors.length, 0, 'Unexpected browser error')
  for (const [file, expected] of Object.entries(sourceHashes)) assert.equal(sha256(await readFile(path.join(sourceRoot, file))), expected, 'Production source changed during measurement')
  report.status = 'passed'
  }
} catch (error) {
  report.status = 'failed'
  report.error = String(error.stack || error)
  process.exitCode = 1
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(temporary, { recursive: true, force: true })
  report.finishedAt = new Date().toISOString()
  await checkpoint()
  process.stdout.write(`${report.status}: ${reportPath}\n`)
}
