/**
 * Built-app browser acceptance of the explicit, author-budgeted full semantic scan.
 * Run after npm run build. All provider fetches are synthetic Playwright routes;
 * nothing contacts an external model. Oracle axes test wiring, not model quality.
 * The one 4096-passage cold run is real production Worker scanning. Remaining
 * lifecycle/Writer cases use 64 frozen chapters to keep this CI gate practical.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium, expect as playwrightExpect } from '@playwright/test'
import { startPreviewServer } from './browser-preview.mjs'
import { createFrozenSemanticFixture } from './fixtures/memory-semantic-fixture.mjs'

const frozen = createFrozenSemanticFixture()
const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = path.join(root, 'artifacts/browser-memory-full-scan')
await mkdir(artifacts, { recursive: true })
const expect = playwrightExpect.configure({ timeout: 30_000 })
const timestamp = '2026-10-22T00:00:00.000Z'
const largeId = 61801
const smallId = 61802
const idFor = (novelId, ordinal) => novelId * 10000 + ordinal
const firstCase = frozen.cases.find(item => item.id === 'protocol-first')
const lastCase = frozen.cases.find(item => item.id === 'protocol-last')
const exactCase = frozen.cases.find(item => item.id === 'local-late-exact')
const editedFirst = frozen.mutations.find(item => item.name === 'edit-first-selected-source')
const futureSecret = '终局才公开：FUTURE-FULL-SCAN-61801 的钥匙藏在月宫地下室，此前无人知晓。'
const completion = '江芜抬头看见河岸的灯火，决定先到茶棚避雨，再向守夜人打听渡船的消息。她把行囊放在桌边，慢慢整理路上记下的线索，等风雨稍歇便沿着石阶走向旧桥，寻找那位多年未见的朋友。'
const embeddingKey = 'synthetic-full-scan-embedding-not-a-real-key'
const rerankKey = 'synthetic-full-scan-rerank-not-a-real-key'
const htmlFor = text => `<p>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br/>')}</p>`
const revisionFor = chapter => createHash('sha256').update(JSON.stringify([chapter.title, chapter.text])).digest('hex')
const sourceSets = new Map([
  [largeId, structuredClone(frozen.project.chapters).concat({ id: 'future-secret', title: '未披露终局', text: futureSecret })],
  [smallId, structuredClone(frozen.project.chapters.slice(0, 64)).concat(structuredClone(frozen.project.chapters[4095]), { id: 'future-secret', title: '未披露终局', text: futureSecret })],
])
function novelFor(novelId) {
  const sources = sourceSets.get(novelId)
  return {
    id: novelId, title: novelId === largeId ? '全范围固定语料 4096 章' : '全范围生命周期与写作 64 章',
    genre: 'fantasy', description: 'Wholly synthetic browser fixture.', tags: [], status: 'writing',
    createdAt: timestamp, updatedAt: timestamp, chapters: sources.length,
    wordCount: sources.reduce((sum, source) => sum + source.text.length, 0),
    characters: [], worldSettings: [], events: [], corpusData: [],
    chapterList: sources.map((source, index) => ({
      id: idFor(novelId, index + 1), title: source.title, content: htmlFor(source.text),
      description: '沿河寻找旧友，核对早先约定。', status: 'draft', tags: [], wordCount: source.text.length,
      createdAt: timestamp, updatedAt: timestamp,
    })),
  }
}
const passageAxes = new Map(frozen.controlledVectors.passageAxes.map(item => [item.id, item.axes]))
const originalTextAxes = new Map(frozen.project.chapters.map(source => [source.text, passageAxes.get(`passage:${JSON.stringify([source.id, 0])}`) ?? [127]]))
const queryAxes = new Map(frozen.controlledVectors.queryVectors.map(item => [item.query, item.axes]))
function embeddingFor(text, query) {
  const axes = query ? (queryAxes.get(text) ?? [126]) : (originalTextAxes.get(text) ?? [127])
  return Array.from({ length: frozen.controlledVectors.dimensions }, (_, index) => axes.includes(index) ? 1 : 0)
}

const report = {
  startedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA || 'local',
  fixture: { version: frozen.version, hashes: frozen.hashes, fullScanPassages: 4096, lifecyclePassages: 64,
    disclaimer: 'Exact fixture-oracle axes; no real embedding quality or answerability claim.' },
  tests: [], screenshots: [], browserErrors: [], blockedRequests: [], fixtureErrors: [],
}
const requests = []
const held = new Set()
let holdPassages = false
let sourceScope = { novelId: largeId, cutoff: 4096 }
let server
let browser
let context
let page
let dialog
let origin
const remoteRequests = () => requests.filter(item => item.kind !== 'model')
const modelRequests = () => requests.filter(item => item.kind === 'model')
const lab = id => page.getByTestId(`memory-${id}`)
const wm = id => dialog.getByTestId(`writer-memory-${id}`)
const labHits = () => page.locator('[data-testid^="memory-result-"]')
const editor = () => page.locator('.editor-panel [contenteditable="true"]')
const startGeneration = kind => dialog.getByRole('button', { name: kind === 'chapter' ? '开始生成' : kind === 'continue' ? '开始续写' : '开始润色', exact: true })

async function fixtureRoute(route) {
  const request = route.request()
  const url = new URL(request.url())
  if (url.origin !== origin) {
    if (['data:', 'blob:'].includes(url.protocol)) return route.continue()
    report.blockedRequests.push(`${url.origin}${url.pathname}`)
    return route.abort('blockedbyclient')
  }
  if (url.pathname === '/__full_scan_seed') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic full scan fixture</title>' })
  if (!url.pathname.startsWith('/__full_scan/')) return route.continue()
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 })
  try {
    assert.equal(request.method(), 'POST', 'No unmocked provider or model-discovery network is permitted')
    const kind = url.pathname.endsWith('/embeddings') ? 'embeddings' : url.pathname.endsWith('/rerank') ? 'rerank' : url.pathname.endsWith('/chat/completions') ? 'model' : null
    assert.ok(kind, `Unknown synthetic route: ${url.pathname}`)
    const body = request.postDataJSON()
    const sources = structuredClone(sourceSets.get(sourceScope.novelId))
    const entry = { kind, task: body.task, body, scope: { ...sourceScope }, status: 'pending', sourceOrdinals: [], scenario: report.tests.at(-1)?.name }
    requests.push(entry)
    if (kind !== 'model') {
      const texts = kind === 'embeddings' ? body.input : body.documents
      assert.ok(Array.isArray(texts) && texts.length > 0 && texts.every(text => typeof text === 'string' && text.length > 0))
      assert.ok(texts.length <= (kind === 'embeddings' ? 32 : 60), 'Production batching must stay bounded')
      if (kind === 'embeddings') assert.equal(body.dimensions, frozen.controlledVectors.dimensions)
      if (body.task !== 'retrieval.query') {
        for (const text of texts) {
          const ordinal = sources.findIndex(source => source.text === text) + 1
          assert.ok(ordinal > 0 && ordinal <= entry.scope.cutoff, 'Every provider passage must be an exact current, disclosed chapter, never a future or superseded source')
          entry.sourceOrdinals.push(ordinal)
        }
      }
    }
    let response
    let contentType = 'application/json'
    if (kind === 'embeddings') response = JSON.stringify({ data: body.input.map((text, index) => ({ index, embedding: embeddingFor(text, body.task === 'retrieval.query') })) })
    else if (kind === 'rerank') response = JSON.stringify({ results: body.documents.map((text, index) => ({ index, relevance_score: text.includes(firstCase.premises[0].quote) ? 0.99 : 0.3 - index / 1000 })).slice(0, body.top_n) })
    else {
      const common = { id: `full-scan-${requests.length}`, created: 1, model: body.model }
      if (body.stream) {
        contentType = 'text/event-stream'
        response = [
          { ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: completion }, finish_reason: null }] },
          { ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 } },
        ].map(item => `data: ${JSON.stringify(item)}\n\n`).join('') + 'data: [DONE]\n\n'
      } else response = JSON.stringify({ ...common, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: completion }, finish_reason: 'stop' }], usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 } })
    }
    const deliver = async () => {
      try { await route.fulfill({ contentType, body: response }); entry.status = 'fulfilled' } catch (error) {
        // A cancelled/terminated Worker cannot accept its intentionally late response.
        if (!entry.wasHeld) throw error
        entry.status = 'cancelled-before-delivery'
      }
    }
    if (holdPassages && kind === 'embeddings' && body.task === 'retrieval.passage') {
      entry.wasHeld = true
      await new Promise(resolve => {
        const release = async () => { held.delete(release); try { await deliver() } finally { resolve() } }
        held.add(release)
      })
    } else await deliver()
  } catch (error) {
    report.fixtureErrors.push(String(error.stack || error))
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Synthetic fixture validation failed"}' }).catch(() => {})
  }
}
async function releaseHeld() {
  holdPassages = false
  await Promise.all([...held].map(release => release()))
}
async function step(name, run) {
  const entry = { name, status: 'running' }
  report.tests.push(entry)
  const started = Date.now()
  console.log(`START ${name}`)
  try { await run(); entry.status = 'passed'; console.log(`PASS  ${name}`) } catch (error) {
    entry.status = 'failed'; entry.error = String(error.stack || error)
    await page?.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true, timeout: 5000 }).catch(() => {})
    throw error
  } finally { entry.durationMs = Date.now() - started }
}
async function dismissAnnouncement() {
  const button = page.getByRole('button', { name: '我知道了', exact: true })
  try { await button.waitFor({ state: 'visible', timeout: 1500 }) } catch { return }
  await button.click()
}
async function screenshot(name) {
  const file = `${name}.png`
  await page.screenshot({ path: path.join(artifacts, file), fullPage: true })
  report.screenshots.push(file)
}
async function assertQuiet(before, message, delay = 200) {
  await page.waitForTimeout(delay)
  assert.equal(remoteRequests().length, before, message)
}
async function configureProvider(control, detailsId, { fullScan = true, maxCalls = 10, rerank = false } = {}) {
  const details = control(detailsId)
  if (await details.getAttribute('open') === null) await details.locator('summary').click()
  await control('embedding-enabled').check()
  await control('embedding-protocol').selectOption('jina')
  await control('embedding-endpoint').fill(`${origin}/__full_scan/v1/embeddings`)
  await control('embedding-model').fill('frozen-oracle-128')
  await control('embedding-dimensions').fill(String(frozen.controlledVectors.dimensions))
  await control('embedding-key').fill(embeddingKey)
  if (rerank) {
    await control('rerank-enabled').check()
    await control('rerank-endpoint').fill(`${origin}/__full_scan/v1/rerank`)
    await control('rerank-model').fill('frozen-oracle-reranker')
    await control('rerank-key').fill(rerankKey)
  } else await control('rerank-enabled').uncheck()
  await control('full-scan-enabled').setChecked(fullScan)
  if (fullScan) await control('full-scan-max-calls').fill(String(maxCalls))
}
async function openLab(novelId = smallId, cutoff = 64) {
  sourceScope = { novelId, cutoff }
  await page.goto(`${origin}/#/memory`)
  await dismissAnnouncement()
  await expect(lab('source')).toBeEnabled()
  await lab('source').selectOption(`novel:${novelId}`)
  await expect(lab('stats')).toBeVisible()
  await lab('cutoff').selectOption(String(idFor(novelId, cutoff)))
}
async function prepare(control, query, { novelId = sourceScope.novelId, cutoff = sourceScope.cutoff } = {}) {
  sourceScope = { novelId, cutoff }
  await control('cutoff').selectOption(String(idFor(novelId, cutoff)))
  await control('query').fill(query)
  const before = remoteRequests().length
  await expect(control('search')).toBeEnabled()
  await control('search').click()
  await expect(control('full-scan-status')).toHaveAttribute('data-state', 'ready', { timeout: 90_000 })
  await expect(control('full-scan-progress')).toContainText('调用尝试 0 /')
  await assertQuiet(before, 'Preparing a local plan must not send even a query embedding')
  return before
}
async function completed(control, timeout = 30_000) {
  await expect(control('search')).toBeEnabled({ timeout })
  await expect(control('full-scan-status')).toHaveCount(0)
  await expect(control('full-scan-final')).toContainText('已完成全范围评分', { timeout })
  await expect(control('assessment')).toHaveAttribute('data-answerability', 'unverified')
}
async function noLabEvidence() {
  await expect(labHits()).toHaveCount(0)
  await expect(lab('evidence-quote')).toHaveCount(0)
  await expect(lab('retrieval-status')).toHaveCount(0)
}
async function noWriterEvidence() {
  await expect(wm('result')).toHaveCount(0)
  await expect(dialog.locator('input[data-testid^="writer-memory-select-"]')).toHaveCount(0)
  await expect(wm('approve')).toHaveCount(0)
  await expect(wm('approved')).toHaveCount(0)
}
async function nothingSelected() {
  await expect(dialog.locator('input[data-testid^="writer-memory-select-"]:checked')).toHaveCount(0)
  await expect(wm('approve')).toBeDisabled()
  await expect(wm('approved')).toHaveCount(0)
}
async function inspectLabSource(novelId, ordinal) {
  const source = sourceSets.get(novelId)[ordinal - 1]
  const hit = labHits().filter({ hasText: source.text })
  await expect(hit).toHaveCount(1)
  await hit.click()
  await expect(lab('evidence')).toContainText(`第 ${ordinal} 章`)
  await expect(lab('evidence-quote')).toHaveText(source.text)
  await expect(lab('evidence-source')).toHaveText(source.text)
  assert.equal(await lab('evidence-quote').textContent(), source.text, 'The displayed quote must preserve exact source whitespace and UTF-16 characters')
  assert.equal(await lab('evidence-source').textContent(), source.text)
  await expect(lab('evidence-range')).toHaveText(`0–${source.text.length}（UTF-16，左闭右开）`)
  await expect(lab('evidence-revision')).toHaveText(revisionFor(source))
  return revisionFor(source)
}
async function openWriter(ordinal = 64) {
  sourceScope = { novelId: smallId, cutoff: 64 }
  await page.goto(`${origin}/#/writer?novelId=${smallId}&chapterId=${idFor(smallId, ordinal)}`)
  await dismissAnnouncement()
  await expect(editor()).toContainText(sourceSets.get(smallId)[ordinal - 1].text.split('\n')[0], { useInnerText: true })
}
async function openDialog(kind) {
  if (kind === 'chapter') {
    await page.getByRole('button', { name: '根据大纲生成', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'AI生成章节内容', exact: true })
    await dialog.locator('.prompt-item-modern').first().click()
  } else if (kind === 'continue') {
    await page.getByRole('button', { name: '续写', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'AI智能续写', exact: true })
  } else {
    await page.getByRole('button', { name: '优化', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'AI文本润色', exact: true })
    await dialog.locator('.prompt-item').first().click()
  }
  await expect(dialog).toBeVisible()
}
async function closeDialog() {
  const cancel = dialog.getByRole('button', { name: '取消', exact: true })
  if (await cancel.count()) await cancel.click()
  else await dialog.getByRole('button', { name: 'Close this dialog', exact: true }).click()
  await expect(dialog).toBeHidden()
}
function envelopeFor(entry) {
  const marker = 'WRITER_MEMORY_CONTEXT_JSON'
  const messages = entry.body.messages.filter(message => typeof message.content === 'string' && message.content.includes(marker))
  assert.equal(messages.length, 1, 'Author-approved memory must be injected exactly once')
  const text = messages[0].content.slice(messages[0].content.indexOf(marker) + marker.length)
  const start = text.indexOf('{')
  assert.ok(start >= 0)
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) return JSON.parse(text.slice(start, index + 1))
  }
  assert.fail('The actual model request must contain a complete memory JSON envelope')
}
function assertSelectedPayload(entry, source, oldQuote) {
  const envelope = envelopeFor(entry)
  assert.equal(envelope.projectId, `novel:${smallId}`)
  assert.equal(envelope.throughChapterId, String(idFor(smallId, entry.scope.cutoff)), 'The injected package must retain the exact author-selected disclosure boundary')
  assert.equal(envelope.sources.length, 1, 'Unselected candidates must not enter writing')
  assert.deepEqual(envelope.relations, [], 'No graph relation was selected')
  assert.equal(envelope.assessment.answerability, 'unverified')
  const selected = envelope.sources[0]
  assert.equal(selected.chapterId, String(idFor(smallId, 1)))
  assert.equal(selected.ordinal, 1)
  assert.ok(selected.ordinal <= entry.scope.cutoff)
  assert.equal(selected.chapterTitle, source.title)
  assert.equal(selected.revision, revisionFor(source))
  assert.equal(selected.start, 0)
  assert.equal(selected.end, source.text.length)
  assert.equal(selected.quote, source.text.slice(selected.start, selected.end))
  assert.equal(entry.body.tools, undefined)
  const sent = JSON.stringify(entry.body.messages)
  assert.ok(!sent.includes(futureSecret))
  assert.ok(!sent.includes(lastCase.premises[0].quote), 'Even cached but undisclosed late sources must stay off the writing wire')
  if (oldQuote) assert.ok(!sent.includes(oldQuote), 'Superseded chapter wording must stay off the writing wire')
  return envelope
}
async function committedHtml(ordinal) {
  return page.evaluate(async ({ novelId, chapterId }) => {
    const chapter = JSON.parse(localStorage.getItem('novels') || '[]').find(novel => novel.id === novelId)?.chapterList?.find(chapter => chapter.id === chapterId)
    if (!chapter) return ''
    if (typeof chapter.content === 'string') return chapter.content
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('llm-writer', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try { return await new Promise((resolve, reject) => {
      const request = db.transaction('kv', 'readonly').objectStore('kv').get(chapter.contentRef)
      request.onsuccess = () => resolve(request.result || '')
      request.onerror = () => reject(request.error)
    }) } finally { db.close() }
  }, { novelId: smallId, chapterId: idFor(smallId, ordinal) })
}

try {
  server = await startPreviewServer({ port: 0, sha: process.env.GITHUB_SHA || 'local' })
  origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ headless: true })
  context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, locale: 'zh-CN', serviceWorkers: 'block' })
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
  await context.route('**/*', fixtureRoute)
  page = await context.newPage()
  page.setDefaultTimeout(30_000)
  page.on('pageerror', error => report.browserErrors.push(String(error.stack || error)))
  await page.goto(`${origin}/__full_scan_seed`)
  await page.evaluate(async ({ novels, apiBase }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('llm-writer', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('kv')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('kv', 'readwrite')
      for (const novel of novels) for (const chapter of novel.chapterList) {
        const key = `novel:${novel.id}:chapter:${chapter.id}:content:full-scan-initial`
        transaction.objectStore('kv').put(chapter.content, key)
        delete chapter.content
        chapter.contentRef = key
      }
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    db.close()
    localStorage.setItem('novels', JSON.stringify(novels))
    localStorage.setItem('apiConfig', JSON.stringify({
      apiKey: 'synthetic-full-scan-writer-not-a-real-key', baseURL: apiBase, provider: 'custom',
      selectedModel: 'full-scan-writer-fixture', maxTokens: 2048, unlimitedTokens: false,
      temperature: 0, thinkingProtocol: 'auto', thinkingMode: 'default', customHeaders: {},
    }))
  }, { novels: [novelFor(largeId), novelFor(smallId)], apiBase: `${origin}/__full_scan/v1` })

  await step('01 Full scan is OFF by default; over-2000 fallback never sends a partial corpus', async () => {
    await openLab(largeId, 4096)
    await expect(lab('stats')).toContainText('4097')
    await lab('provider-settings').locator('summary').click()
    await expect(lab('embedding-enabled')).not.toBeChecked()
    await expect(lab('rerank-enabled')).not.toBeChecked()
    await configureProvider(lab, 'provider-settings', { fullScan: false })
    await expect(lab('full-scan-enabled')).not.toBeChecked()
    await lab('query').fill(exactCase.query)
    await lab('search').click()
    await expect(lab('search')).toBeEnabled({ timeout: 90_000 })
    await expect(lab('retrieval-status')).toContainText('超过 2,000 个片段')
    await expect(lab('retrieval-status')).toContainText('披露范围内 4096 个原文块')
    await inspectLabSource(largeId, 3991)
    assert.equal(remoteRequests().length, 0)
    assert.equal(modelRequests().length, 0)
  })

  await step('02 Ready plan is local only; Start obeys cumulative 2 then 3 then 129 attempted calls', async () => {
    await lab('full-scan-enabled').check()
    await expect(lab('full-scan-max-calls')).toHaveValue('160')
    await expect(lab('full-scan-max-time')).toHaveValue('65000')
    assert.deepEqual(await lab('full-scan-max-time').locator('option').evaluateAll(options => options.map(option => option.value)), ['65000', '300000', '600000'])
    await lab('full-scan-max-calls').fill('2')
    // This is an explicit author choice, not an automatically increased deadline.
    await lab('full-scan-max-time').selectOption('300000')
    const before = await prepare(lab, lastCase.query)
    await expect(lab('full-scan-plan')).toContainText('已披露范围 4096 个原文块；有效缓存 0 个；待嵌入 4096 个')
    await expect(lab('full-scan-plan')).toContainText('当前预计 129 次调用，冷缓存预计 129 次')
    await noLabEvidence()
    await lab('full-scan-start').click()
    await expect(lab('full-scan-status')).toHaveAttribute('data-state', 'budget')
    assert.equal(remoteRequests().length - before, 2)
    await expect(lab('full-scan-progress')).toContainText('已评分 32 / 4096')
    await expect(lab('full-scan-progress')).toContainText('调用尝试 2 / 2')
    await noLabEvidence()
    await expect(lab('query')).toBeEnabled()
    await expect(lab('cutoff')).toBeEnabled()
    await expect(lab('full-scan-cancel')).toBeEnabled()
    await expect(lab('full-scan-continue')).toBeDisabled()
    await lab('full-scan-retry').click()
    await assertQuiet(before + 2, 'Zero-addition retry cannot grant more exhausted calls')
    await expect(lab('full-scan-status')).toContainText('剩余预算不足')
    await lab('full-scan-add-calls').fill('1')
    await lab('full-scan-continue').click()
    await expect(lab('full-scan-progress')).toContainText('调用尝试 3 / 3')
    await expect(lab('full-scan-status')).toHaveAttribute('data-state', 'budget')
    await expect(lab('full-scan-progress')).toContainText('已评分 64 / 4096')
    assert.equal(remoteRequests().length - before, 3)
    await noLabEvidence()
    await lab('full-scan-add-calls').fill('126')
    await expect(lab('full-scan-proposed')).toContainText('累计授权：129 次尝试、300 秒')
    await lab('full-scan-continue').click()
    await completed(lab, 300_000)
    const scanRequests = remoteRequests().slice(before)
    assert.equal(scanRequests.length, 129)
    assert.equal(scanRequests.filter(item => item.task === 'retrieval.query').length, 1, 'Continue must not prepare a new scan or re-embed the query')
    const ordinals = scanRequests.filter(item => item.task === 'retrieval.passage').flatMap(item => item.sourceOrdinals)
    assert.equal(ordinals.length, 4096)
    assert.deepEqual([...ordinals].sort((a, b) => a - b), Array.from({ length: 4096 }, (_, index) => index + 1), 'Paging/cache eviction must not duplicate accepted coverage or miss a source')
    await expect(lab('full-scan-final')).toContainText('调用尝试 129 / 129')
    await expect(lab('full-scan-final')).toContainText('已评分 4096 / 4096')
    await expect(lab('evidence-quote')).toHaveCount(0)
    await inspectLabSource(largeId, 4096)
    await expect(lab('results')).not.toContainText(futureSecret)
    report.coldScan = { calls: scanRequests.length, scored: ordinals.length, revision: revisionFor(sourceSets.get(largeId)[4095]) }
    await screenshot('complete-4096-current-source')
  })

  await step('03 Reducing disclosure excludes a previously cached future source from all requests and results', async () => {
    // Do not edit watched provider settings: that would clear the cache and
    // invalidate the point of this previously-cached-future regression.
    const before = await prepare(lab, lastCase.query, { cutoff: 64 })
    await expect(lab('full-scan-plan')).toContainText('已披露范围 64 个原文块')
    await lab('full-scan-start').click()
    await expect(lab('full-scan-status')).toHaveAttribute('data-state', 'budget')
    await expect(lab('full-scan-progress')).toContainText('调用尝试 2 / 2')
    await lab('full-scan-add-calls').fill('1')
    await lab('full-scan-continue').click()
    await completed(lab)
    const fresh = remoteRequests().slice(before)
    assert.ok(fresh.length > 0)
    assert.ok(fresh.every(item => item.sourceOrdinals.every(ordinal => ordinal <= 64)))
    await expect(lab('results')).not.toContainText(lastCase.premises[0].quote)
    await expect(lab('results')).not.toContainText(futureSecret)
  })

  await step('04 Use local discards partial semantics and stops all later embedding and rerank calls', async () => {
    await openLab()
    await configureProvider(lab, 'provider-settings', { maxCalls: 2, rerank: true })
    const before = await prepare(lab, '三声铜铃')
    await expect(lab('full-scan-plan')).toContainText('冷缓存预计 4 次')
    await lab('full-scan-start').click()
    await expect(lab('full-scan-status')).toHaveAttribute('data-state', 'budget')
    await expect(lab('full-scan-progress')).toContainText('已评分 32 / 64')
    await noLabEvidence()
    await lab('full-scan-use-local').click()
    await expect(lab('search')).toBeEnabled()
    await expect(lab('full-scan-final')).toContainText('仅使用本地结果')
    await expect(lab('full-scan-final')).toContainText('未完成的语义评分不参与候选')
    await inspectLabSource(smallId, 1)
    await assertQuiet(before + 2, 'Use local must stop every later provider call, including the enabled reranker')
    assert.ok(remoteRequests().slice(before).every(item => item.kind !== 'rerank'))
  })

  await step('05 Cancel settles both the ready decision and a budget pause without publishing partial evidence', async () => {
    await configureProvider(lab, 'provider-settings', { maxCalls: 1 })
    await lab('clear-cache').click()
    let before = await prepare(lab, firstCase.query)
    await lab('full-scan-cancel').click()
    await expect(lab('search')).toBeEnabled()
    await noLabEvidence()
    await assertQuiet(before, 'Cancelling a plan must not send anything')
    before = await prepare(lab, firstCase.query)
    await lab('full-scan-start').click()
    await expect(lab('full-scan-status')).toHaveAttribute('data-state', 'budget')
    await lab('cancel').click()
    await expect(lab('search')).toBeEnabled()
    await noLabEvidence()
    await assertQuiet(before + 1, 'Cancelling a budget pause must not resume its pending decision')
  })

  for (const change of ['query', 'source', 'provider', 'cutoff', 'cancel']) {
    await step(`06-${change} A held response cannot revive a scan after ${change} invalidation`, async () => {
      if (await lab('source').inputValue() !== `novel:${smallId}`) await lab('source').selectOption(`novel:${smallId}`)
      sourceScope = { novelId: smallId, cutoff: 64 }
      await configureProvider(lab, 'provider-settings', { maxCalls: 10 })
      await lab('clear-cache').click()
      const before = await prepare(lab, firstCase.query)
      holdPassages = true
      await lab('full-scan-start').click()
      await expect.poll(() => held.size).toBe(1)
      assert.equal(remoteRequests().length - before, 2)
      await noLabEvidence()
      if (change === 'query') await lab('query').fill('changed query revokes old scan')
      else if (change === 'source') await lab('source').selectOption(`novel:${largeId}`)
      else if (change === 'provider') await lab('embedding-model').fill('changed-oracle-model')
      else if (change === 'cutoff') await lab('cutoff').selectOption(String(idFor(smallId, 32)))
      else await lab('cancel').click()
      await expect(lab('full-scan-status')).toHaveCount(0)
      await releaseHeld()
      await expect(lab('search')).toBeEnabled({ timeout: 90_000 })
      await noLabEvidence()
      await assertQuiet(before + 2, 'Late responses must not publish, continue, or restart invalidated scans')
    })
  }

  await step('07 Writer plan and partial scan cannot select or approve evidence; cancellation remains usable', async () => {
    await openWriter()
    await openDialog('continue')
    await expect(wm('enabled')).not.toBeChecked()
    await wm('enabled').check()
    await configureProvider(wm, 'providers', { fullScan: false })
    await expect(wm('full-scan-enabled')).not.toBeChecked()
    await wm('full-scan-enabled').check()
    await expect(wm('full-scan-max-calls')).toHaveValue('160')
    await expect(wm('full-scan-max-time')).toHaveValue('65000')
    await wm('full-scan-max-calls').fill('2')
    const before = await prepare(wm, firstCase.query)
    const beforeModel = modelRequests().length
    await noWriterEvidence()
    await wm('full-scan-start').click()
    await expect(wm('full-scan-status')).toHaveAttribute('data-state', 'budget')
    await expect(wm('full-scan-progress')).toContainText('已评分 32 / 64')
    await noWriterEvidence()
    await expect(wm('query')).toBeEnabled()
    await expect(wm('cutoff')).toBeEnabled()
    await expect(wm('embedding-model')).toBeEnabled()
    await expect(editor()).toHaveAttribute('contenteditable', 'true')
    await expect(wm('cancel')).toBeEnabled()
    await wm('full-scan-use-local').click()
    await expect(wm('search')).toBeEnabled()
    await expect(wm('full-scan-final')).toContainText('仅使用本地结果')
    await expect(wm('approved')).toHaveCount(0)
    await assertQuiet(before + 2, 'Writer Use local must settle rather than continue in the background')
    assert.equal(modelRequests().length, beforeModel)
    // A new plan is also revocable by changing the query, not only by Cancel.
    await prepare(wm, firstCase.query)
    await wm('query').fill('a different author question')
    await expect(wm('full-scan-status')).toHaveCount(0)
    await noWriterEvidence()
    await closeDialog()
  })

  await step('08 Editing while a Writer response is held cancels the old scan; late completion cannot approve it', async () => {
    await openDialog('continue')
    await wm('enabled').check()
    await configureProvider(wm, 'providers', { maxCalls: 10 })
    // A changed model creates a cold, separate provider namespace.
    await wm('embedding-model').fill('writer-held-editor-oracle')
    const before = await prepare(wm, firstCase.query)
    holdPassages = true
    await wm('full-scan-start').click()
    await expect.poll(() => held.size).toBe(1)
    await noWriterEvidence()
    const original = sourceSets.get(smallId)[63].text
    const edited = `${original}\n作者补记：雨已停，明日重新出发。`
    await editor().fill(edited)
    await expect(wm('full-scan-status')).toHaveCount(0)
    await releaseHeld()
    await noWriterEvidence()
    await assertQuiet(before + 2, 'An editor change must revoke the scan before any further provider request')
    await closeDialog()
    await expect.poll(() => committedHtml(64)).toContain('作者补记')
    sourceSets.get(smallId)[63].text = edited
  })

  await step('09 An old chapter edit produces a new exact revision in Memory Lab, never the superseded quote', async () => {
    await openWriter(1)
    await editor().fill(editedFirst.replacementChapter.text)
    await expect.poll(() => committedHtml(1)).toContain(editedFirst.newQuote)
    sourceSets.get(smallId)[0] = structuredClone(editedFirst.replacementChapter)
    // The explicit revised-query oracle matches the exact new source, not stale text.
    originalTextAxes.set(editedFirst.replacementChapter.text, originalTextAxes.get(frozen.project.chapters[0].text))
    await openLab()
    await configureProvider(lab, 'provider-settings', { maxCalls: 10 })
    await prepare(lab, firstCase.query)
    await lab('full-scan-start').click()
    await completed(lab)
    const revision = await inspectLabSource(smallId, 1)
    assert.equal(revision, editedFirst.afterRevision)
    assert.notEqual(revision, editedFirst.beforeRevision)
    await expect(lab('results')).not.toContainText(editedFirst.oldQuote)
    await expect(lab('results')).not.toContainText(lastCase.premises[0].quote)
    report.revisedSource = { revision, start: 0, end: editedFirst.replacementChapter.text.length }
    await screenshot('revised-lab-source')
  })

  await openWriter()
  for (const kind of ['continue', 'optimize', 'chapter']) {
    await step(`10-${kind} Only explicitly selected, approved, current full-scan evidence enters Writer ${kind}`, async () => {
      await openDialog(kind)
      await wm('enabled').check()
      await configureProvider(wm, 'providers', { maxCalls: 10 })
      const beforeModel = modelRequests().length
      await prepare(wm, firstCase.query)
      await noWriterEvidence()
      await wm('full-scan-start').click()
      await completed(wm)
      await nothingSelected()
      assert.equal(modelRequests().length, beforeModel, 'Completing semantic coverage never auto-generates or auto-approves')
      const source = sourceSets.get(smallId)[0]
      const hit = dialog.locator('[data-testid^="writer-memory-hit-"]').filter({ hasText: source.text })
      await expect(hit).toHaveCount(1)
      await expect(hit.getByTestId('writer-memory-quote')).toHaveText(source.text)
      await expect(hit.getByTestId('writer-memory-revision')).toHaveText(editedFirst.afterRevision)
      await expect(wm('result')).not.toContainText(editedFirst.oldQuote)
      await expect(wm('result')).not.toContainText(lastCase.premises[0].quote)
      await hit.locator('input[data-testid^="writer-memory-select-hit-"]').check()
      await expect(wm('approved')).toHaveCount(0)
      assert.equal(modelRequests().length, beforeModel, 'Selection alone is not approval')
      if (kind !== 'chapter') {
        await expect(startGeneration(kind)).toBeEnabled()
        await startGeneration(kind).click()
        await expect(page.locator('.el-message--warning, .el-message--error').first()).toBeVisible()
        assert.equal(modelRequests().length, beforeModel, 'Generation with selected but unapproved evidence must be blocked')
      }
      await wm('approve').click()
      await expect(wm('approved')).toBeVisible()
      assert.equal(modelRequests().length, beforeModel, 'Approval alone is not a request to generate')
      await startGeneration(kind).click()
      await expect.poll(() => modelRequests().length).toBe(beforeModel + 1)
      const envelope = assertSelectedPayload(modelRequests()[beforeModel], source, editedFirst.oldQuote)
      report.tests.at(-1).selectedEvidence = { revision: envelope.sources[0].revision, sources: 1, relations: 0, answerability: envelope.assessment.answerability }
      if (kind === 'chapter') {
        await expect(dialog).toBeHidden()
        await expect(editor()).toContainText(completion)
        await expect.poll(() => committedHtml(64)).toContain(completion)
      } else {
        await expect(dialog.locator('.result-content')).toContainText(completion)
        await expect(startGeneration(kind)).toBeEnabled()
        await closeDialog()
      }
    })
  }
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  assert.ok(!stored.includes(embeddingKey) && !stored.includes(rerankKey), 'Route-only retrieval keys must never be persisted')
  assert.deepEqual(report.fixtureErrors, [], 'Every synthetic request must pass the independent current-source/cutoff oracle')
  assert.deepEqual(report.browserErrors, [])
  assert.deepEqual(report.blockedRequests, [], 'The app must not attempt any external network during this suite')
  console.log(`PASS ${report.tests.length} full-scan browser scenarios`)
} catch (error) {
  report.error = String(error.stack || error)
  report.diagnostics = { url: page?.url(), bodyText: await page?.locator('body').innerText({ timeout: 5000 }).catch(() => '') }
  console.error(report.error)
  process.exitCode = 1
} finally {
  await releaseHeld()
  report.finishedAt = new Date().toISOString()
  report.requests = requests.map(({ body, ...entry }) => ({ ...entry, textCount: body.input?.length ?? body.documents?.length, model: body.model }))
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  await context?.tracing.stop({ path: path.join(artifacts, 'trace.zip') }).catch(() => {})
  await browser?.close()
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}
