/**
 * Built-app Chromium stress acceptance with 1.56M characters / 600 chapters.
 * Initial fixtures use the real chunked persistence format; all later manuscript
 * edits use Writer's UI. Synthetic provider responses test integration, not quality.
 * Run with node --import tsx after npm run build. No paid model calls or full traces.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium, expect as playwrightExpect } from '@playwright/test'
import { startPreviewServer } from './browser-preview.mjs'
import { createStressNovel } from './fixtures/memory-stress-corpus.ts'
import { plainTextToWriterHtml, stripWriterHtml } from '../src/utils/writerContent.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = path.join(root, 'artifacts/browser-memory-stress')
await mkdir(artifacts, { recursive: true })
const corpus = await createStressNovel({ chapters: 600, charsPerChapter: 2600 })
// Generated Writer content is stored as HTML. Seeding legacy plain text would
// exercise wangEditor's per-line migration (including empty paragraphs) instead
// of a manuscript that has already been saved by the production writer flow.
const expectedSources = new Map(corpus.project.chapters.map((chapter, index) => [index + 1, chapter.text.trim()]))
const initialIndexedChars = [...expectedSources.values()].reduce((total, text) => total + text.length, 0)
const novelId = 49001
const idFor = ordinal => 490_000 + ordinal
const idMap = new Map(corpus.project.chapters.map((chapter, index) => [chapter.id, idFor(index + 1)]))
const fact = corpus.editTargets[0]
const firstChapterId = idMap.get(fact.chapterId)
const oldIdentifier = fact.oldValue.match(/FS\d+/)[0]
const newIdentifier = fact.replacementValue.match(/RN\d+/)[0]
const timestamp = '2026-10-04T00:00:00.000Z'
const novel = {
  id: novelId, title: '九河行记·百万字业务压力验收', genre: 'fantasy',
  description: '程序化合成测试作品，不含用户原稿。', tags: [], status: 'writing',
  createdAt: timestamp, updatedAt: timestamp, chapters: corpus.manifest.chapters,
  wordCount: corpus.manifest.totalChars, totalWords: corpus.manifest.totalChars,
  characters: [], worldSettings: [], events: [], corpusData: [],
  chapterList: corpus.project.chapters.map((chapter, index) => ({
    id: idFor(index + 1), title: chapter.title, content: plainTextToWriterHtml(chapter.text),
    status: 'draft', tags: [], wordCount: chapter.text.length,
    createdAt: timestamp, updatedAt: timestamp,
  })),
}
for (const [index, chapter] of novel.chapterList.entries()) {
  assert.equal(stripWriterHtml(chapter.content), expectedSources.get(index + 1), 'Canonical Writer HTML must preserve every chapter of the independently generated prose')
}
const storedHtmlChars = novel.chapterList.reduce((total, chapter) => total + chapter.content.length, 0)
const storedHtmlUtf8Bytes = novel.chapterList.reduce((total, chapter) => total + Buffer.byteLength(chapter.content, 'utf8'), 0)
const server = await startPreviewServer({ port: 0, sha: process.env.GITHUB_SHA || 'local' })
const origin = `http://127.0.0.1:${server.address().port}`
const remote = { hold: false, requests: [], held: new Set(), errors: [] }
let providerCutoff = 0
const fixture = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  response.setHeader('Content-Type', 'application/json')
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return }
  const kind = request.url === '/v1/embeddings' ? 'embeddings' : request.url === '/v1/rerank' ? 'rerank' : null
  if (request.method !== 'POST' || !kind) { response.writeHead(404).end('{}'); return }
  try {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const texts = kind === 'embeddings' ? body.input : body.documents
    assert.ok(Array.isArray(texts) && texts.every(text => typeof text === 'string'))
    assert.ok(texts.length <= (kind === 'rerank' ? 60 : 32), 'Browser provider requests must respect production batch limits')
    const sourceOrdinals = body.task === 'retrieval.query' ? [] : texts.map(text => {
      const match = [...expectedSources].find(([ordinal, source]) => ordinal <= providerCutoff && source.includes(text))
      assert.ok(match, 'Every submitted passage/rerank candidate must be an exact span of the independently expected current, disclosed source')
      return match[0]
    })
    const entry = {
      kind, task: body.task, texts: texts.length, chars: texts.reduce((total, text) => total + text.length, 0),
      sourceOrdinals,
      oldFact: texts.some(text => text.includes(fact.oldValue)),
      revisedFact: texts.some(text => text.includes(fact.replacementValue)),
      futureFact: texts.some(text => /MASK\d+/.test(text)), status: 'pending',
    }
    remote.requests.push(entry)
    const send = () => {
      remote.held.delete(send)
      if (response.destroyed) { entry.status = 'aborted'; return }
      const output = kind === 'embeddings'
        ? { data: texts.map((text, index) => ({ index, embedding: text.includes(oldIdentifier) || text.includes(newIdentifier) ? [1, 0, 0] : /MASK\d+/.test(text) ? [0, 0, 1] : [0, 1, 0] })) }
        : { results: texts.map((text, index) => ({ index, relevance_score: text.includes(body.query) ? 0.99 : 0.2 - index / 10_000 })).sort((a, b) => b.relevance_score - a.relevance_score).slice(0, body.top_n) }
      entry.status = 200
      response.writeHead(200).end(JSON.stringify(output))
    }
    if (remote.hold && body.task === 'retrieval.passage') remote.held.add(send)
    else send()
  } catch (error) {
    remote.errors.push(String(error.stack || error))
    if (!response.destroyed) response.writeHead(500).end('{}')
  }
})
await new Promise((resolve, reject) => { fixture.once('error', reject); fixture.listen(0, '127.0.0.1', resolve) })
const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`
const browser = await chromium.launch({ headless: true }).catch(error => {
  for (const service of [server, fixture]) { service.closeAllConnections(); service.close() }
  throw error
})
const viewport = { width: 1440, height: 1080 }
const context = await browser.newContext({ viewport, locale: 'zh-CN' })
const expect = playwrightExpect.configure({ timeout: 60_000 })
const errors = []
const blockedRequests = []
const report = {
  startedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA || 'local',
  fixture: {
    ...corpus.manifest, storedHtmlChars, storedHtmlUtf8Bytes, indexedChars: initialIndexedChars,
    characterCounts: 'totalChars counts generated prose; storedHtmlChars counts canonical persisted Writer HTML; indexedChars sums the exact visible chapter texts',
  },
  environment: {
    browser: browser.version(), node: process.version, platform: `${process.platform}/${process.arch}`,
    cpuModel: os.cpus()[0]?.model ?? 'unknown', logicalCpus: os.cpus().length,
    availableParallelism: os.availableParallelism(), viewport,
  },
  provider: 'Local synthetic vectors and reranking; no external service or quality benchmark',
  tests: [], queries: [], screenshots: [],
}
context.on('page', target => {
  target.setDefaultTimeout(60_000)
  target.on('pageerror', error => errors.push(String(error.stack || error)))
})
await context.route('**/*', route => {
  const url = new URL(route.request().url())
  if (['data:', 'blob:'].includes(url.protocol) || [origin, fixtureOrigin].includes(url.origin)) return route.continue()
  blockedRequests.push(`${url.origin}${url.pathname}`)
  return route.abort('blockedbyclient')
})
const page = await context.newPage()
const control = id => page.getByTestId(`memory-${id}`)
const results = () => page.locator('[data-testid^="memory-result-"]')
let baseline
let oldRevision

async function step(name, run) {
  const entry = { name, status: 'running' }
  report.tests.push(entry)
  const started = performance.now()
  console.log(`START ${name}`)
  try {
    await run()
    entry.status = 'passed'
    console.log(`PASS  ${name}`)
  } catch (error) {
    entry.status = 'failed'
    entry.error = String(error.stack || error)
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), timeout: 5000 }).catch(() => {})
    throw error
  } finally { entry.durationMs = Math.round(performance.now() - started) }
}

async function dismissAnnouncement(target = page) {
  const button = target.getByRole('button', { name: '我知道了', exact: true })
  try { await button.waitFor({ state: 'visible', timeout: 2200 }) } catch { return }
  await button.click()
}

async function search(query, cutoff = 600) {
  providerCutoff = cutoff
  await control('cutoff').selectOption(String(idFor(cutoff)))
  await control('query').fill(query)
  const started = performance.now()
  await control('search').click()
  await expect(control('search')).toBeEnabled()
  await expect(control('retrieval-status')).toBeVisible()
  await expect(control('error')).toHaveCount(0)
  const ordinals = await results().locator('.result-meta').allTextContents()
  assert.ok(ordinals.every(text => Number(text.match(/第\s*(\d+)\s*章/)?.[1]) <= cutoff), 'Every candidate must respect the selected disclosure cutoff')
  report.queries.push({ query, cutoff, durationMs: Math.round(performance.now() - started), hits: ordinals.length })
}

async function inspectEvidence(probe, expectedText = probe.quote) {
  const hit = results().filter({ hasText: expectedText }).first()
  await expect(hit).toBeVisible()
  await hit.click()
  await expect(control('evidence')).toContainText(`第 ${probe.ordinal} 章`)
  await expect(control('evidence-quote')).toContainText(expectedText)
  const quote = await control('evidence-quote').textContent()
  const source = await control('evidence-source').textContent()
  assert.equal(source, expectedSources.get(probe.ordinal), 'The whole displayed chapter must equal its committed source, independently of the UI revision')
  assert.ok(source.includes(quote), 'The evidence quote must be an exact substring of the disclosed source chapter')
  const span = (await control('evidence-range').textContent()).match(/(\d+)–(\d+)/)
  assert.ok(span, 'Evidence must expose an exact UTF-16 source range')
  assert.equal(source.slice(Number(span[1]), Number(span[2])), quote, 'The displayed source offsets must select exactly the evidence quote')
  const title = corpus.project.chapters[probe.ordinal - 1].title
  const revision = createHash('sha256').update(JSON.stringify([title, source])).digest('hex')
  assert.equal(await control('evidence-revision').textContent(), revision, 'Evidence revision must hash the actual chapter, not just the matching quote')
  return revision
}

async function storedSnapshot(verifySources = false) {
  const { records, ...snapshot } = await page.evaluate(async id => {
    const raw = localStorage.getItem('novels')
    const novels = JSON.parse(raw || '[]')
    const current = novels.find(item => item.id === id)
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('llm-writer', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const records = await Promise.all(current.chapterList.map(chapter => new Promise((resolve, reject) => {
      if (typeof chapter.content === 'string') { resolve({ id: chapter.id, content: chapter.content }); return }
      const request = db.transaction('kv', 'readonly').objectStore('kv').get(chapter.contentRef)
      request.onsuccess = () => resolve({ id: chapter.id, content: request.result })
      request.onerror = () => reject(request.error)
    })))
    db.close()
    const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('')
    return {
      metadataHash: await hash(raw), bodyHash: await hash(JSON.stringify(records)),
      chunks: current.chapterList.filter(chapter => chapter.contentRef).length,
      chars: records.reduce((total, record) => total + record.content.length, 0),
      chapters: records.length, records,
    }
  }, novelId)
  if (verifySources) {
    assert.equal(records.length, expectedSources.size)
    for (const record of records) {
      const ordinal = record.id - 490_000
      assert.equal(stripWriterHtml(record.content), expectedSources.get(ordinal), `Committed chapter ${ordinal} must preserve its independently expected visible text`)
    }
  }
  return snapshot
}

async function committedChapter(id) {
  return page.evaluate(async ({ novelId, id }) => {
    const chapter = JSON.parse(localStorage.getItem('novels') || '[]').find(novel => novel.id === novelId)?.chapterList?.find(chapter => chapter.id === id)
    if (!chapter) return ''
    if (typeof chapter.content === 'string') return chapter.content
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('llm-writer', 1)
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const read = db.transaction('kv', 'readonly').objectStore('kv').get(chapter.contentRef)
        read.onsuccess = () => { resolve(read.result || ''); db.close() }
        read.onerror = () => { reject(read.error); db.close() }
      }
    })
  }, { novelId, id })
}

async function screenshot(name) {
  const file = `${name}.png`
  await control('evidence-quote').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(artifacts, file) })
  report.screenshots.push(file)
}

try {
  await step('01 Load a 1.56M-character, 600-chapter novel from committed IndexedDB chunks', async () => {
    // This blank same-origin fixture page prevents mounting the application before
    // the initial immutable blobs and metadata have both been committed.
    await page.route(`${origin}/__memory_stress_seed`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Initial stress fixture</title>' }))
    await page.goto(`${origin}/__memory_stress_seed`)
    await page.evaluate(async novel => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('llm-writer', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('kv')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('kv', 'readwrite')
        for (const chapter of novel.chapterList) {
          const key = `novel:${novel.id}:chapter:${chapter.id}:content:stress-initial`
          transaction.objectStore('kv').put(chapter.content, key)
          delete chapter.content
          chapter.contentRef = key
        }
        transaction.oncomplete = resolve
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      db.close()
      localStorage.setItem('novels', JSON.stringify([novel]))
    }, novel)
    baseline = await storedSnapshot(true)
    assert.equal(corpus.manifest.totalChars, 1_560_000)
    assert.equal(baseline.chars, storedHtmlChars)
    assert.equal(baseline.chunks, 600)
    await page.goto(`${origin}/#/memory`)
    await dismissAnnouncement()
    await expect(control('search')).toBeEnabled()
    await page.evaluate(() => {
      window.__memoryStressPerformance = { started: performance.now(), frames: [], longTasks: [], stopped: false }
      const metrics = window.__memoryStressPerformance
      let previous = performance.now()
      const frame = now => {
        if (metrics.stopped) return
        if (document.visibilityState === 'visible' && previous !== null) metrics.frames.push(now - previous)
        previous = document.visibilityState === 'visible' ? now : null
        requestAnimationFrame(frame)
      }
      document.addEventListener('visibilitychange', () => { previous = null })
      requestAnimationFrame(frame)
      if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        const observer = new PerformanceObserver(list => {
          if (!metrics.stopped && document.visibilityState === 'visible') metrics.longTasks.push(...list.getEntries().map(entry => entry.duration))
        })
        observer.observe({ type: 'longtask' })
      }
    })
    const started = performance.now()
    await control('source').selectOption(`novel:${novelId}`)
    await expect(control('search')).toBeEnabled()
    report.initialLoadMs = Math.round(performance.now() - started)
    await expect(control('cutoff').locator('option')).toHaveCount(600)
    await expect(control('stats').locator('strong').nth(1)).toHaveText(initialIndexedChars.toLocaleString('zh-CN'))
    await expect(control('chapter-editor')).toHaveCount(0)
    assert.deepEqual(await storedSnapshot(), baseline, 'Indexing must preserve metadata and all 600 immutable source bodies')
  })

  await step('02 Perform 24 consecutive cross-volume queries with exact source and revision checks', async () => {
    const probes = Array.from({ length: 24 }, (_, index) => corpus.facts[Math.floor(index * 599 / 23)])
    for (const probe of probes) {
      const cutoff = Math.min(600, probe.ordinal + (probe.ordinal % 2 ? 130 : 20))
      await search(probe.oldValue.match(/FS\d+/)[0], cutoff)
      await inspectEvidence(probe)
    }
    await search(oldIdentifier, 500)
    oldRevision = await inspectEvidence(fact)
    // Actual novels currently have no imported author clue annotations. This
    // checks the distant planted passage, rather than pretending aliases exist.
    const planted = corpus.clues.find(clue => clue.chapterId === fact.chapterId)
    await search(`${oldIdentifier} 第三声`, 500)
    await inspectEvidence(planted)
    assert.deepEqual(await storedSnapshot(), baseline)
    await screenshot('long-range-source-evidence')
  })

  await step('03 Exclude later identities across 12 disclosure boundaries and immediately clear evidence', async () => {
    for (const secret of corpus.futureSecrets) {
      await search(secret.query, secret.ordinal - 1)
      await expect(results()).toHaveCount(0)
      await search(secret.query, secret.ordinal)
      await inspectEvidence(secret)
      await control('cutoff').selectOption(String(idFor(10)))
      await expect(results()).toHaveCount(0)
      await expect(control('evidence-quote')).toHaveCount(0)
    }
    assert.deepEqual(remote.requests, [], 'Local million-character searches must make no provider requests')
  })

  await step('04 Cold and warm hybrid searches process hundreds of passages without sending future chapters', async () => {
    await control('provider-settings').locator('summary').click()
    await control('embedding-enabled').check()
    await control('embedding-endpoint').fill(`${fixtureOrigin}/v1/embeddings`)
    await control('embedding-model').fill('synthetic-memory-stress')
    await control('embedding-dimensions').fill('3')
    await control('embedding-key').fill('synthetic-stress-key')
    await control('rerank-enabled').check()
    await control('rerank-endpoint').fill(`${fixtureOrigin}/v1/rerank`)
    await control('rerank-model').fill('synthetic-memory-stress-rerank')
    await control('rerank-key').fill('synthetic-stress-key')
    await search(oldIdentifier, 400)
    await expect(control('retrieval-status')).toContainText('已参与混合检索')
    await expect(control('retrieval-status')).toContainText('已完成')
    await inspectEvidence(fact)
    const cold = remote.requests.filter(entry => entry.task === 'retrieval.passage')
    const embeddedPassages = cold.reduce((sum, entry) => sum + entry.texts, 0)
    assert.equal(embeddedPassages, 1200, 'The 400 disclosed 2600-character chapters contain three passages each')
    assert.equal(cold.length, 38)
    assert.equal(cold.flatMap(entry => entry.sourceOrdinals).filter(ordinal => ordinal === fact.ordinal).length, 3)
    await search(oldIdentifier, 400)
    await expect(control('retrieval-status')).toContainText('本次新嵌入 0 个')
    assert.equal(remote.requests.filter(entry => entry.task === 'retrieval.passage').length, cold.length)
    assert.ok(remote.requests.every(entry => !entry.futureFact), 'Future source identities must not reach either provider')
    report.hybridColdPassages = embeddedPassages
    report.hybridColdBatches = cold.length
    assert.deepEqual(await storedSnapshot(), baseline)
  })

  await step('05 Regain focus with unchanged source, clear evidence immediately and retain every validated vector', async () => {
    await inspectEvidence(fact)
    const before = remote.requests.length
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(results()).toHaveCount(0)
    await expect(control('evidence-quote')).toHaveCount(0)
    await search(oldIdentifier, 400)
    await expect(control('retrieval-status')).toContainText('本次新嵌入 0 个')
    await expect(control('retrieval-status')).toContainText('复用缓存 1200 个')
    assert.equal(remote.requests.slice(before).filter(entry => entry.task === 'retrieval.passage').length, 0)
    await inspectEvidence(fact)
    assert.deepEqual(await storedSnapshot(true), baseline)
    report.unchangedFocus = { reembeddedPassages: 0, reusedPassages: 1200, invalidatedVisibleEvidence: true }
  })

  await step('06 Commit an early chapter edit in Writer and re-embed only that chapter while excluding its old revision', async () => {
    const writer = await context.newPage()
    const revisedBody = corpus.project.chapters[fact.ordinal - 1].text.replaceAll(fact.oldValue, fact.replacementValue)
    try {
      await writer.goto(`${origin}/#/writer?novelId=${novelId}`)
      await dismissAnnouncement(writer)
      await writer.locator('.chapter-item').filter({ has: writer.locator('p', { hasText: corpus.project.chapters[fact.ordinal - 1].title }) }).click()
      const editor = writer.locator('.editor-panel [contenteditable="true"]')
      await expect(editor).toContainText(fact.oldValue)
      await editor.fill(revisedBody)
      await expect.poll(() => committedChapter(firstChapterId), { timeout: 60_000 }).toContain(fact.replacementValue)
      await expect(writer.locator('.saving-indicator')).toHaveCount(0)
    } finally { await writer.close() }
    await page.bringToFront()
    await expect(results()).toHaveCount(0)
    await expect(control('evidence-quote')).toHaveCount(0)
    expectedSources.set(fact.ordinal, revisedBody.trim())
    const committed = await storedSnapshot(true)
    assert.equal(committed.chapters, 600)
    assert.equal(committed.chunks, 600, 'A real Writer save must retain chunked persistence at this size')
    assert.notEqual(committed.bodyHash, baseline.bodyHash)
    report.writerEditVerification = { verifiedChapters: 600, unchangedChapterTexts: 599, editedOrdinals: [fact.ordinal] }
    const before = remote.requests.length
    await search(newIdentifier, 400)
    const revision = await inspectEvidence(fact, fact.quote.replaceAll(fact.oldValue, fact.replacementValue))
    assert.notEqual(revision, oldRevision)
    const revisedPassages = remote.requests.slice(before).filter(entry => entry.task === 'retrieval.passage')
    assert.equal(revisedPassages.length, 1, 'Returning from Writer must preserve the worker cache, requiring one partial batch')
    assert.equal(revisedPassages.reduce((total, entry) => total + entry.texts, 0), 3, 'Only the edited chapter\'s three passages need replacement vectors')
    assert.ok(revisedPassages.some(entry => entry.revisedFact))
    assert.ok(revisedPassages.every(entry => entry.sourceOrdinals.every(ordinal => ordinal === fact.ordinal)), 'Unedited chapters must never be re-embedded after a Writer save')
    await expect(control('retrieval-status')).toContainText('本次新嵌入 3 个')
    await expect(control('retrieval-status')).toContainText('复用缓存 1197 个')
    assert.ok(remote.requests.slice(before).every(entry => !entry.oldFact && !entry.futureFact), 'Only the committed revision may be embedded or reranked')
    report.writerEditVerification = { ...report.writerEditVerification, reembeddedPassages: 3, reusedPassages: 1197, passageBatches: 1 }
    await screenshot('revised-long-novel-evidence')
    await search(oldIdentifier, 400)
    await expect(control('results')).not.toContainText(fact.oldValue)
    await expect(control('evidence')).not.toContainText(fact.oldValue)
    assert.deepEqual(await storedSnapshot(), committed, 'Memory retrieval must not overwrite the Writer commit')
    baseline = committed
  })

  await step('07 Cancel an in-flight large retrieval and prevent a late response from publishing or seeding cache', async () => {
    await control('clear-cache').click()
    remote.hold = true
    providerCutoff = 400
    await control('cutoff').selectOption(String(idFor(400)))
    await control('query').fill(newIdentifier)
    await control('search').click()
    await expect.poll(() => remote.held.size).toBeGreaterThan(0)
    const started = performance.now()
    await control('cancel').click()
    await expect(control('search')).toBeEnabled()
    report.cancelResponseMs = Math.round(performance.now() - started)
    await expect(results()).toHaveCount(0)
    await expect(control('evidence-quote')).toHaveCount(0)
    remote.hold = false
    for (const send of [...remote.held]) send()
    const before = remote.requests.length
    await search(newIdentifier, 400)
    await expect(control('retrieval-status')).toContainText('复用缓存 0 个')
    assert.equal(remote.requests.slice(before).filter(entry => entry.task === 'retrieval.passage').length, 38)
    await inspectEvidence(fact, fact.quote.replaceAll(fact.oldValue, fact.replacementValue))
    assert.deepEqual(await storedSnapshot(true), baseline)
  })

  await step('08 Reload the chunked novel and verify persisted revision with providers disabled', async () => {
    report.responsiveness = await page.evaluate(() => {
      const metrics = window.__memoryStressPerformance
      metrics.stopped = true
      const sorted = [...metrics.frames].sort((a, b) => a - b)
      return {
        visibleFrames: sorted.length, frameGapP95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] || 0,
        frameGapMaxMs: sorted.at(-1) || 0, longTaskCount: metrics.longTasks.length,
        longTaskMaxMs: metrics.longTasks.reduce((maximum, duration) => Math.max(maximum, duration), 0),
      }
    })
    await page.reload()
    await dismissAnnouncement()
    await expect(control('search')).toBeEnabled()
    await control('source').selectOption(`novel:${novelId}`)
    await expect(control('search')).toBeEnabled()
    const before = remote.requests.length
    await search(newIdentifier, 600)
    await inspectEvidence(fact, fact.quote.replaceAll(fact.oldValue, fact.replacementValue))
    await expect(control('results')).not.toContainText(fact.oldValue)
    assert.equal(remote.requests.length, before)
    assert.deepEqual(await storedSnapshot(), baseline)
    await expect(control('stats').locator('strong').nth(0)).toHaveText('600')
    const indexedChars = [...expectedSources.values()].reduce((total, text) => total + text.length, 0)
    await expect(control('stats').locator('strong').nth(1)).toHaveText(indexedChars.toLocaleString('zh-CN'))
    await screenshot('reloaded-persisted-revision')
  })

  await step('09 Check UI heartbeat, end-to-end latency, uncaught errors and durable source integrity', async () => {
    const durations = report.queries.map(query => query.durationMs).sort((a, b) => a - b)
    report.queryLatency = {
      count: durations.length, p50Ms: durations[Math.ceil(durations.length * 0.5) - 1],
      p95Ms: durations[Math.ceil(durations.length * 0.95) - 1], maxMs: durations.at(-1),
      scope: 'UI click through committed source read, Worker synchronization (reuse or rebuild), retrieval and rendered results; includes synthetic cold/warm provider cases',
    }
    assert.ok(report.responsiveness.visibleFrames >= 30, 'Animation-frame heartbeat must continue while the corpus is processed')
    assert.ok(report.responsiveness.longTaskMaxMs < 2000, 'No individual main-thread task may block this stress run for two seconds')
    assert.ok(report.queryLatency.maxMs < 60_000, 'No end-to-end query may exceed the explicit one-minute acceptance budget')
    assert.deepEqual(errors, [])
    assert.deepEqual(remote.errors, [])
    assert.ok(remote.requests.every(entry => !entry.futureFact))
    assert.deepEqual(await storedSnapshot(), baseline)
    report.persistence = {
      ...baseline, initialChars: storedHtmlChars, generatedProseChars: corpus.manifest.totalChars, initialIndexedChars,
      indexedChars: [...expectedSources.values()].reduce((total, text) => total + text.length, 0),
    }
  })
  console.log(`PASS ${report.tests.length} million-character browser stress scenarios; ${report.queries.length} searches`)
} catch (error) {
  report.error = String(error.stack || error)
  report.diagnostics = { url: page.url(), bodyText: (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).slice(0, 14_000) }
  console.error(report.error)
  process.exitCode = 1
} finally {
  remote.hold = false
  for (const send of [...remote.held]) send()
  report.finishedAt = new Date().toISOString()
  report.browserErrors = errors
  report.blockedRequests = blockedRequests
  report.providerRequests = remote.requests
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
  for (const service of [server, fixture]) {
    service.closeAllConnections()
    await new Promise(resolve => service.close(resolve))
  }
}
