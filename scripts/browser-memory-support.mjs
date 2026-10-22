/**
 * Production-build acceptance for optional, selected-excerpt support checks.
 * Run only after npm run build. Synthetic loopback HTTP is the sole provider.
 * Controlled replies/one-hot retrieval prove wiring and boundaries, NOT model quality.
 * No credentials are discovered and no unmocked external request is allowed.
 */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium, expect as playwrightExpect } from '@playwright/test'
import { startPreviewServer } from './browser-preview.mjs'
import { installSupportBodyConsumptionHook } from './fixtures/support-response-consumption-hook.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = path.join(root, 'artifacts/browser-memory-support')
const fixtureFile = path.join(root, 'scripts/fixtures/support-check-fixture-v1.json')
const frozenBytes = await readFile(fixtureFile)
const frozenHash = createHash('sha256').update(frozenBytes).digest('hex')
assert.equal(frozenHash, 'ebf0a7ea662e6ddd3e2079598954888cd553c72ae74c666691ae822704b20c2d', 'Frozen semantic fixture must not drift')
assert.equal((await readFile(`${fixtureFile.slice(0, -5)}.sha256`, 'utf8')).trim().split(/\s+/)[0], frozenHash)
const frozen = JSON.parse(frozenBytes)
const semanticCases = frozen.cases.filter(item => item.kind === 'semantic')
assert.equal(semanticCases.length, 25)
const caseFor = id => { const value = frozen.cases.find(item => item.id === id); assert.ok(value, id); return value }
const expect = playwrightExpect.configure({ timeout: 25_000 })
const smallNovelId = 62210
const longNovelId = 62211
let novelId = smallNovelId
const stamp = '2026-10-22T00:00:00.000Z'
const targetText = '雨点落在桥头，沈砚望着两岸的灯火，思索如何与旧友重新取得联系。街边的茶棚还亮着一盏灯，他收好湿透的行囊，慢慢走过积水的石阶，准备向店主打听附近的住处。'
const writingCompletion = '沈砚抬头望向河岸，决定先寻找一处避雨之所，再细细回想旧日的约定。远处的茶棚传来人声，他整理好行囊，沿着铺满石板的小路继续前行，直到一扇亮着灯光的木门出现在雨幕之中。'
const titleCanary = 'TITLE_ONLY_FUTURE_IDENTITY_62210'
const aliasCanary = 'ALIAS_ONLY_FUTURE_IDENTITY_62210'
let sources = frozen.corpus.filter(source => source.sourceId !== 'S80').map(source => ({ ...source, title: `${source.chapterTitle} · ${source.sourceId} · ${titleCanary}` }))
sources.push({ sourceId: 'TARGET', quote: targetText, title: '本次写作目标' })
sources.push({ ...frozen.corpus.find(source => source.sourceId === 'S80'), title: `未披露终局 ${titleCanary}` })
let targetOrdinal = sources.findIndex(source => source.sourceId === 'TARGET') + 1
const smallSources = sources
const smallTargetOrdinal = targetOrdinal
const idFor = ordinal => novelId * 1000 + ordinal
const ordinalFor = id => { const index = sources.findIndex(source => source.sourceId === id); assert.ok(index >= 0); return index + 1 }
const quoteFor = id => sources[ordinalFor(id) - 1].quote
const htmlFor = text => `<p>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br/>')}</p>`
const revisionFor = source => createHash('sha256').update(JSON.stringify([source.title, source.quote])).digest('hex')
const novelFor = () => ({ id: novelId, title: '合成支持检查作品', genre: 'fantasy', description: 'Wholly synthetic browser fixture.', tags: [], status: 'writing', createdAt: stamp, updatedAt: stamp,
  chapters: sources.length, wordCount: sources.reduce((sum, source) => sum + source.quote.length, 0), characters: [], worldSettings: [], events: [], corpusData: [],
  chapterList: sources.map((source, index) => ({ id: idFor(index + 1), title: source.title, content: htmlFor(source.quote), description: '沿河寻找旧友，复核早先约定。', status: 'draft', tags: [], wordCount: source.quote.length, createdAt: stamp, updatedAt: stamp })) })
const graphFor = () => ({ version: 1, projectId: `novel:${novelId}`, revision: 'support-browser-graph-1', relations: [{
  id: 'metadata-canary', projectId: `novel:${novelId}`, source: { type: 'person', label: aliasCanary }, target: { type: 'object', label: '银钥匙' },
  predicate: `顾行把银钥匙交给谁 ${aliasCanary}`, origin: 'explicit', createdBy: 'author', authorConfirmed: true,
  evidence: [{ chapterId: String(idFor(1)), sourceRevision: revisionFor(sources[0]), start: 0, end: sources[0].quote.length, quote: sources[0].quote }],
}] })
// Separately named capacity expansion. It does not edit or add cases to the frozen semantic fixture.
const longCode = 'LATE-SUPPORT-62211'
const longFutureCanary = 'FUTURE_LONG_SUPPORT_62211'
const longEvidence = [
  { sourceId: 'LATE-A', ordinal: 588, quote: `末站登记：编号 ${longCode} 的封条由阿宁收存。` },
  { sourceId: 'LATE-B', ordinal: 590, quote: `编号 ${longCode} 的封条交接地点是西渡口的石桥。` },
]
const longSources = Array.from({ length: 600 }, (_, index) => {
  const ordinal = index + 1
  const evidence = longEvidence.find(source => source.ordinal === ordinal)
  if (evidence) return { ...evidence, title: `第${ordinal}章：末站原始登记 ${titleCanary}` }
  if (ordinal === 599) return { sourceId: 'TARGET', quote: targetText, title: '第599章：本次写作目标' }
  if (ordinal === 600) return { sourceId: 'S80', quote: `直到终局才揭晓：${longCode} 背后的身份是月宫主人，暗号 ${longFutureCanary}，此前没有披露。`, title: `第600章：未披露终局 ${titleCanary}` }
  const unit = `第${ordinal}日，行人经过第${ordinal}座驿站，记录山川草木与炊烟方向。村民晾晒绳索，整备行囊，等待天气放晴后沿河出发。`
  return { sourceId: `FILLER-${ordinal}`, title: `第${ordinal}章：沿河记事`, quote: unit.repeat(Math.ceil(2330 / unit.length)).slice(0, 2330) }
})
const longSourceChars = longSources.reduce((sum, source) => sum + source.quote.length, 0)
assert.equal(longSources.length, 600)
assert.ok(longSourceChars >= 1_320_000, 'Enabled support gate must use a genuinely long source, not only many tiny chapters')
const longCase = { id: 'LONG-CAPACITY-1', throughChapterId: 'long-599', question: `${longCode} 的封条由谁收存，应在哪里交接？`,
  sourceExcerpts: longEvidence.map((source, index) => ({ ...source, reference: index + 1 })), expected: { verdict: 'supported' },
  controlledResponse: { version: 1, verdict: 'supported', reason: 'combined_premises', answer: '阿宁收存；在西渡口的石桥交接。',
    explanation: '收存人和交接点来自两条分别披露的末站登记。', premises: [
      { text: '编号封条由阿宁收存。', references: [1] }, { text: '同编号封条在西渡口的石桥交接。', references: [2] },
    ], missing: [] } }
function useScope(long = false) { novelId = long ? longNovelId : smallNovelId; sources = long ? longSources : smallSources; targetOrdinal = long ? 599 : smallTargetOrdinal }
const seedGraph = graphFor()
const seedNovels = [novelFor()]
useScope(true); seedNovels.push({ ...novelFor(), title: '600章长篇支持检查容量扩展' }); useScope(false)
const report = { startedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA || 'local', fixture: { version: frozen.version, sha256: frozenHash, semanticCases: 25,
  sourceChapters: sources.length, targetOrdinal, disclaimer: 'Frozen quotes/replies with synthetic one-hot retrieval. Protocol/lifecycle acceptance, not real-model answerability accuracy.' },
  longForm: { profile: 'support-enabled-long-novel-v1', chapters: 600, sourceChars: longSourceChars, disclosedChapters: 599, disclosedChars: longSources.slice(0, 599).reduce((sum, source) => sum + source.quote.length, 0), selectedOrdinals: [588, 590], futureOrdinal: 600, fixtureHash: createHash('sha256').update(JSON.stringify(longSources)).digest('hex'), journeys: [], disclaimer: 'Separate deterministic capacity/lifecycle profile; excluded from the frozen 25-case semantic denominator.' },
  tests: [], semantic: [], screenshots: [], browserErrors: [], blockedRequests: [], fixtureErrors: [], mutationControls: {} }
const requests = []
const held = new Set()
const liveQuotes = new Map([...smallSources.map((source, index) => [smallNovelId * 1000 + index + 1, source.quote]), ...longSources.map((source, index) => [longNovelId * 1000 + index + 1, source.quote])])
let origin, fixtureOrigin, preview, provider, browser, context, page, dialog
let activeCase = caseFor('P01')
let cutoff = targetOrdinal
let mode = 'ok'
let replyOverride = null
let holdEmbeddings = false
let supportQuestion = activeCase.question
const lab = id => page.getByTestId(`memory-${id}`)
const wm = id => dialog.getByTestId(`writer-memory-${id}`)
const supportRequests = () => requests.filter(entry => entry.kind === 'support')
const writingRequests = () => requests.filter(entry => entry.kind === 'writing')
const retrievalRequests = () => requests.filter(entry => entry.kind === 'embeddings' || entry.kind === 'rerank')
const editor = () => page.locator('.editor-panel [contenteditable="true"]')
const support = (control, id) => control(`support-${id}`)
const selectedQuotes = () => activeCase.sourceExcerpts.map(source => source.quote)
function embedding(text, query) {
  return Array.from({ length: sources.length }, (_, index) => query ? Number(selectedQuotes().includes(sources[index].quote)) : Number(sources[index].quote === text))
}
function supportPayload(body) {
  assert.ok(Array.isArray(body.messages))
  const user = body.messages.filter(message => message.role === 'user')
  if (user.length !== 1 || typeof user[0].content !== 'string') return null
  try { const parsed = JSON.parse(user[0].content); return parsed.version === 1 && Array.isArray(parsed.sources) ? parsed : null } catch { return null }
}
function validateSupport(body, payload) {
  assert.deepEqual(Object.keys(payload).sort(), ['question', 'sources', 'version'])
  assert.equal(payload.question, supportQuestion, 'Wire question must exactly match the disclosed question, including whitespace')
  assert.equal(payload.sources.length, activeCase.sourceExcerpts.length, 'Only explicitly selected complete sources may be transmitted')
  assert.deepEqual(payload.sources.map(source => source.quote).sort(), selectedQuotes().sort())
  for (const [index, source] of payload.sources.entries()) {
    assert.deepEqual(Object.keys(source).sort(), ['quote', 'reference'])
    assert.equal(source.reference, index + 1)
    const ordinal = sources.findIndex(candidate => candidate.quote === source.quote) + 1
    assert.ok(ordinal > 0 && ordinal <= cutoff)
    assert.equal(liveQuotes.get(idFor(ordinal)), source.quote, 'No stale source may be dispatched')
  }
  assert.equal(body.tools, undefined)
  assert.notEqual(body.stream, true, 'Support checks must not show partial model text')
  assert.ok((body.max_tokens ?? body.max_completion_tokens) > 0 && (body.max_tokens ?? body.max_completion_tokens) <= 1200)
  const all = JSON.stringify(body.messages)
  assert.ok(!all.includes(titleCanary) && !all.includes(aliasCanary) && !all.includes(longFutureCanary), 'No title, alias, graph annotation or project metadata on support wire')
  if (cutoff < sources.length) assert.ok(!all.includes(quoteFor('S80')), 'Future text may not enter the support request')
}
function reboundResponse(payload) {
  const reply = structuredClone(replyOverride ?? activeCase.controlledResponse)
  if (typeof reply === 'string') return reply
  for (const premise of reply.premises ?? []) premise.references = premise.references.map(reference => {
    const expectedSource = activeCase.sourceExcerpts.find(source => source.reference === reference)
    if (!expectedSource) return reference // Intentionally forged-reference scenario.
    const actual = payload.sources.find(source => source.quote === expectedSource.quote)
    assert.ok(actual, 'Every controlled reference must map to a selected exact original quote')
    return actual.reference
  })
  return JSON.stringify(reply)
}
async function startProvider() {
  provider = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    if (request.method === 'OPTIONS') return response.writeHead(204).end()
    try {
      const pathname = new URL(request.url || '/', 'http://fixture').pathname
      assert.equal(request.method, 'POST', 'No model discovery, automatic fallback or unmocked provider action')
      const chunks = []; for await (const chunk of request) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const payload = pathname.endsWith('/chat/completions') ? supportPayload(body) : null
      const kind = pathname.endsWith('/embeddings') ? 'embeddings' : pathname.endsWith('/rerank') ? 'rerank' : pathname.endsWith('/chat/completions') ? payload ? 'support' : 'writing' : null
      assert.ok(kind, `Unexpected fixture endpoint ${pathname}`)
      const entry = { kind, scenario: report.tests.at(-1)?.name, caseId: activeCase.id, status: 'pending', startedAt: Date.now(), inputBytes: Buffer.byteLength(JSON.stringify(body)), body, cutoff, novelId }
      requests.push(entry)
      response.on('close', () => { if (!response.writableEnded) entry.status = 'aborted' })
      let content, contentType = 'application/json'
      if (kind === 'embeddings' || kind === 'rerank') {
        const texts = kind === 'embeddings' ? body.input : body.documents
        assert.ok(Array.isArray(texts) && texts.length)
        if (body.task !== 'retrieval.query') for (const text of texts) {
          const ordinal = sources.findIndex(source => liveQuotes.get(idFor(ordinalFor(source.sourceId))) === text) + 1
          assert.ok(ordinal > 0 && ordinal <= cutoff, 'Retrieval sends only exact current disclosed text')
        }
        if (kind === 'embeddings') {
          assert.equal(body.dimensions, sources.length)
          content = JSON.stringify({ data: body.input.map((text, index) => ({ index, embedding: embedding(text, body.task === 'retrieval.query') })) })
        } else content = JSON.stringify({ results: body.documents.map((text, index) => ({ index, relevance_score: selectedQuotes().includes(text) ? 0.99 - selectedQuotes().indexOf(text) / 100 : 0.01 })).sort((a, b) => b.relevance_score - a.relevance_score).slice(0, body.top_n) })
      } else {
        if (kind === 'support') validateSupport(body, payload)
        const answer = kind === 'support' ? reboundResponse(payload) : writingCompletion
        const common = { id: `support-browser-${requests.length}`, created: 1, model: body.model }
        if (body.stream) {
          contentType = 'text/event-stream'
          content = [{ ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: answer }, finish_reason: null }] },
            { ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 } }]
            .map(item => `data: ${JSON.stringify(item)}\n\n`).join('') + 'data: [DONE]\n\n'
        } else content = JSON.stringify({ ...common, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: mode === 'truncated' ? 'length' : 'stop' }], usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 } })
      }
      entry.sourceCount = payload?.sources.length ?? (body.input ?? body.documents ?? []).length
      entry.responseBytes = Buffer.byteLength(content)
      const chosenMode = mode
      const deliver = async () => {
        held.delete(deliver)
        if (response.destroyed) { entry.status = 'aborted'; return }
        entry.durationMs = Date.now() - entry.startedAt
        if (kind === 'support' && chosenMode === 'failure') { entry.status = 503; response.writeHead(503, { 'Content-Type': 'application/json' }).end('{"error":"Synthetic provider unavailable"}'); return }
        if (kind === 'support' && chosenMode === 'interrupt') {
          entry.status = 'interrupted-body'; response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': String(Buffer.byteLength(content)) }); response.write(content.slice(0, 40)); setTimeout(() => response.destroy(), 20); return
        }
        entry.status = 200
        response.writeHead(200, { 'Content-Type': contentType }).end(content)
      }
      if (kind === 'support' && chosenMode === 'hold' || kind === 'embeddings' && holdEmbeddings) held.add(deliver)
      else await deliver()
    } catch (error) {
      report.fixtureErrors.push(String(error.stack || error))
      if (!response.destroyed) response.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"Fixture validation failed"}')
    }
  })
  await new Promise((resolve, reject) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', resolve) })
  fixtureOrigin = `http://127.0.0.1:${provider.address().port}`
}
async function releaseHeld() { await Promise.all([...held].map(send => send())) }
async function step(name, run) {
  const item = { name, status: 'running', callsBefore: requests.length }; report.tests.push(item)
  const started = Date.now(); console.log(`START ${name}`)
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false })
  try { await run(); item.status = 'passed'; console.log(`PASS  ${name}`) }
  catch (error) {
    item.status = 'failed'; item.error = String(error.stack || error)
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true, timeout: 5000 }).catch(() => {})
    await context.tracing.stop({ path: path.join(artifacts, 'failure-trace.zip') }).catch(() => {})
    throw error
  } finally { item.durationMs = Date.now() - started; item.callsAfter = requests.length; if (item.status === 'passed') await context.tracing.stop() }
}
async function screenshot(name) { const file = `${name}.png`; await page.screenshot({ path: path.join(artifacts, file), fullPage: false }); report.screenshots.push(file) }
async function quiet(before, message) { await page.waitForTimeout(200); assert.equal(requests.length, before, message) }
async function dismissAnnouncement() {
  const button = page.getByRole('button', { name: '我知道了', exact: true })
  try { await button.waitFor({ state: 'visible', timeout: 1500 }) } catch { return }
  await button.click()
}
async function seed() {
  await page.goto(`${origin}/__support_seed`)
  await page.evaluate(async ({ novels, graph, apiBase }) => {
    localStorage.clear()
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('llm-writer', 1); request.onupgradeneeded = () => request.result.createObjectStore('kv'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite'), store = tx.objectStore('kv')
      store.put(JSON.stringify(graph), `memory-fact-graph:v1:${graph.projectId}`)
      for (const novel of novels) for (const chapter of novel.chapterList) {
        const key = `novel:${novel.id}:chapter:${chapter.id}:content:support-browser-initial`
        store.put(chapter.content, key); delete chapter.content; chapter.contentRef = key
      }
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
    }); db.close()
    localStorage.setItem('novels', JSON.stringify(novels))
    localStorage.setItem('apiConfig', JSON.stringify({ apiKey: 'synthetic-support-fixture-not-a-real-key', baseURL: apiBase, provider: 'custom', selectedModel: 'support-browser-fixture', maxTokens: 2048, unlimitedTokens: false, temperature: 0, thinkingProtocol: 'auto', thinkingMode: 'default', customHeaders: {} }))
  }, { novels: [structuredClone(seedNovels[0])], graph: seedGraph, apiBase: `${fixtureOrigin}/v1` })
}
async function seedLongNovel() {
  // Seed capacity data only for the capacity journeys, avoiding 600 unrelated
  // hydration reads in every small frozen semantic case.
  await page.goto(`${origin}/__support_seed`)
  await page.evaluate(async novel => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('llm-writer', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite'), store = tx.objectStore('kv')
      for (const chapter of novel.chapterList) {
        const key = `novel:${novel.id}:chapter:${chapter.id}:content:support-browser-initial`
        store.put(chapter.content, key); delete chapter.content; chapter.contentRef = key
      }
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
    }); db.close()
    const novels = JSON.parse(localStorage.getItem('novels'))
    if (novels.some(item => item.id === novel.id)) throw new Error('Long synthetic fixture already seeded')
    novels.push(novel); localStorage.setItem('novels', JSON.stringify(novels))
  }, structuredClone(seedNovels[1]))
}
async function openLab() {
  await page.goto(`${origin}/#/memory`); await dismissAnnouncement()
  await expect(lab('source')).toBeEnabled(); await lab('source').selectOption(`novel:${novelId}`)
  await expect(lab('stats')).toBeVisible({ timeout: novelId === longNovelId ? 90_000 : 25_000 }); cutoff = targetOrdinal
  await lab('cutoff').selectOption(String(idFor(cutoff)))
}
async function configureRetrieval(control, detailsId) {
  const details = control(detailsId); if (await details.getAttribute('open') === null) await details.locator('summary').click()
  await control('embedding-enabled').check(); await control('embedding-protocol').selectOption('jina')
  await control('embedding-endpoint').fill(`${fixtureOrigin}/v1/embeddings`); await control('embedding-model').fill('synthetic-source-oracle')
  await control('embedding-dimensions').fill(String(sources.length)); await control('embedding-key').fill('synthetic-embedding-not-a-real-key')
  await control('rerank-enabled').check(); await control('rerank-endpoint').fill(`${fixtureOrigin}/v1/rerank`)
  await control('rerank-model').fill('synthetic-selected-source-oracle'); await control('rerank-key').fill('synthetic-rerank-not-a-real-key')
  await control('full-scan-enabled').uncheck()
}
async function search(control, fixtureCase = caseFor('P01'), { question = fixtureCase.question, through = fixtureCase.throughChapterId === 'c80' ? sources.length : targetOrdinal } = {}) {
  activeCase = fixtureCase; supportQuestion = question; cutoff = through
  await control('cutoff').selectOption(String(idFor(cutoff))); await control('query').fill(question)
  await expect(control('search')).toBeEnabled(); await control('search').click(); await expect(control('search')).toBeEnabled({ timeout: novelId === longNovelId ? 90_000 : 25_000 })
  await expect(control('assessment')).toHaveAttribute('data-answerability', 'unverified')
}
async function selectLab(fixtureCase = activeCase) {
  await support(lab, 'enabled').check()
  const checked = page.locator('input[data-testid^="memory-support-select-"]:checked')
  await expect(checked).toHaveCount(0)
  await expect(support(lab, 'prepare')).toBeDisabled()
  for (const source of fixtureCase.sourceExcerpts) {
    const hit = page.locator('[data-testid^="memory-result-"]').filter({ has: page.locator('.quote', { hasText: source.quote }) })
    await expect(hit).toHaveCount(1)
    await expect(hit.locator('.quote')).toHaveText(source.quote)
    await hit.click()
    await expect(checked).toHaveCount(fixtureCase.sourceExcerpts.indexOf(source))
    await expect(lab('evidence-quote')).toHaveText(source.quote)
    await hit.locator('..').locator('input[type="checkbox"]').check()
  }
  await expect(checked).toHaveCount(fixtureCase.sourceExcerpts.length)
}
async function prepare(control) {
  await support(control, 'check-question').fill(supportQuestion)
  const before = requests.length
  await support(control, 'prepare').click()
  await expect(control('support')).toHaveAttribute('data-state', 'ready')
  assert.equal(await support(control, 'question').textContent(), supportQuestion)
  await expect(support(control, 'destination')).toContainText('support-browser-fixture')
  await expect(support(control, 'destination')).toContainText(fixtureOrigin)
  const prefix = control === lab ? 'memory' : 'writer-memory'
  const sourceRows = (control === lab ? page : dialog).locator(`[data-testid^="${prefix}-support-source-"]`)
  const quotes = await sourceRows.locator('blockquote').allTextContents()
  assert.deepEqual([...quotes].sort(), selectedQuotes().sort(), 'Preview must disclose every exact selected quote and no others')
  for (const [index, quote] of quotes.entries()) {
    const source = sources.find(item => item.quote === quote)
    assert.ok(source)
    await expect(sourceRows.nth(index)).toContainText(source.title)
    await expect(sourceRows.nth(index)).toContainText(revisionFor(source))
    await expect(sourceRows.nth(index)).toContainText(`0–${quote.length}`)
  }
  await expect(support(control, 'budget')).toContainText(`本次 ${selectedQuotes().length} 段`)
  await quiet(before, 'Prepare/preview must send zero HTTP requests')
}
async function send(control, { doubleClick = false } = {}) {
  const before = supportRequests().length
  if (doubleClick) await support(control, 'send').evaluate(button => { button.click(); button.click() })
  else await support(control, 'send').click()
  await expect.poll(() => supportRequests().length).toBe(before + 1)
  return supportRequests()[before]
}
async function assertAssessment(control, fixtureCase = activeCase) {
  const result = support(control, 'assessment')
  await expect(result).toHaveAttribute('data-verdict', fixtureCase.expected.verdict)
  await expect(result).toContainText('语义仍须作者复核')
  await expect(result).toContainText('不证明全书有或没有答案')
  const response = fixtureCase.controlledResponse
  if (response.answer === null) await expect(support(control, 'answer')).toHaveCount(0)
  else await expect(support(control, 'answer')).toHaveText(response.answer)
  await expect(support(control, 'explanation')).toHaveText(response.explanation)
  const host = control === lab ? page : dialog
  const prefix = control === lab ? 'memory' : 'writer-memory'
  await expect(host.locator(`[data-testid^="${prefix}-support-premise-"]`)).toHaveCount(response.premises.length)
  let citationCount = 0
  for (const [index, premise] of response.premises.entries()) {
    const row = support(control, `premise-${index}`); await expect(row).toContainText(premise.text)
    const expectedQuotes = premise.references.map(reference => fixtureCase.sourceExcerpts.find(source => source.reference === reference).quote)
    assert.deepEqual(await row.getByTestId(`${prefix}-support-citation`).allTextContents(), expectedQuotes)
    citationCount += expectedQuotes.length
  }
  for (const missing of response.missing) await expect(support(control, 'missing')).toContainText(missing)
  await expect(control('assessment')).toHaveAttribute('data-answerability', 'unverified')
  return citationCount
}
async function noAssessment(control, { hidden = false } = {}) {
  await expect(support(control, 'assessment')).toHaveCount(0)
  await expect(support(control, 'answer')).toHaveCount(0)
  if (!hidden) await expect(support(control, 'unverified')).toBeVisible()
}
async function readyLab(fixtureCase = caseFor('P01')) { mode = 'ok'; replyOverride = null; await search(lab, fixtureCase); await selectLab(fixtureCase); await prepare(lab) }
async function mutateCommitted(sourceId, { title = false, restore = false, storageEvent = false } = {}) {
  const ordinal = ordinalFor(sourceId), original = sources[ordinal - 1]
  const nextText = restore ? original.quote : `${original.quote}（正文已在检查期间修改）`
  await page.evaluate(({ novelId, chapterId, text, originalTitle, title, restore, storageEvent }) => {
    const before = localStorage.getItem('novels'); const novels = JSON.parse(before)
    const chapter = novels.find(novel => novel.id === novelId).chapterList.find(chapter => chapter.id === chapterId)
    if (title) chapter.title = restore ? originalTitle : `${originalTitle}（改题）`
    else { chapter.content = `<p>${text}</p>`; delete chapter.contentRef }
    localStorage.setItem('novels', JSON.stringify(novels))
    if (storageEvent) window.dispatchEvent(new StorageEvent('storage', { key: 'novels', oldValue: before, newValue: localStorage.getItem('novels'), storageArea: localStorage }))
  }, { novelId, chapterId: idFor(ordinal), text: nextText, originalTitle: original.title, title, restore, storageEvent })
  if (!title) liveQuotes.set(idFor(ordinal), nextText)
}
async function openWriter(kind, { localOnly = false } = {}) {
  cutoff = targetOrdinal
  await page.goto(`${origin}/#/writer?novelId=${novelId}&chapterId=${idFor(targetOrdinal)}`); await dismissAnnouncement()
  await expect(editor()).toContainText(targetText.slice(0, 10), { useInnerText: true, timeout: novelId === longNovelId ? 90_000 : 25_000 })
  if (kind === 'chapter') { await page.getByRole('button', { name: '根据大纲生成', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'AI生成章节内容', exact: true }); await dialog.locator('.prompt-item-modern').first().click() }
  else if (kind === 'continue') { await page.getByRole('button', { name: '续写', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'AI智能续写', exact: true }) }
  else { await page.getByRole('button', { name: '优化', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'AI文本润色', exact: true }); await dialog.locator('.prompt-item').first().click() }
  await expect(dialog).toBeVisible(); await expect(wm('enabled')).not.toBeChecked(); await wm('enabled').check()
  if (!localOnly) await configureRetrieval(wm, 'providers')
}

async function selectWriter() {
  await expect(dialog.locator('input[data-testid^="writer-memory-select-"]:checked')).toHaveCount(0)
  for (const source of activeCase.sourceExcerpts) {
    const hit = dialog.locator('[data-testid^="writer-memory-hit-"]').filter({ has: dialog.getByTestId('writer-memory-quote').filter({ hasText: source.quote }) })
    await expect(hit).toHaveCount(1); await hit.locator('input[type="checkbox"]').check()
  }
  await expect(dialog.locator('input[data-testid^="writer-memory-select-"]:checked')).toHaveCount(activeCase.sourceExcerpts.length)
}
function writerEnvelope(body) {
  const marker = 'WRITER_MEMORY_CONTEXT_JSON'
  const text = body.messages.find(message => typeof message.content === 'string' && message.content.includes(marker))?.content
  assert.ok(text, 'Explicitly approved selected-source bundle must reach actual writing request')
  const after = text.slice(text.indexOf(marker) + marker.length); const start = after.indexOf('{')
  for (let end = start + 1; end <= after.length; end++) { try { return JSON.parse(after.slice(start, end)) } catch { /* Look for the exact complete JSON boundary. */ } }
  assert.fail('Missing complete Writer source envelope')
}

await mkdir(artifacts, { recursive: true })
try {
  preview = await startPreviewServer({ port: 0, sha: process.env.GITHUB_SHA || 'local' }); origin = `http://127.0.0.1:${preview.address().port}`
  await startProvider()
  browser = await chromium.launch({ headless: true })
  context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, locale: 'zh-CN', serviceWorkers: 'block' })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === origin && url.pathname === '/__support_seed') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic support fixture</title>' })
    if ([origin, fixtureOrigin].includes(url.origin) || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
    report.blockedRequests.push(`${url.origin}${url.pathname}`); return route.abort('blockedbyclient')
  })
  await context.addInitScript(({ fixtureOrigin }) => {
    const original = window.fetch
    window.__supportIgnoreAbort = false
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (window.__supportIgnoreAbort && url.startsWith(`${fixtureOrigin}/`) && url.endsWith('/chat/completions')) {
        const detached = input instanceof Request ? new Request(input, { signal: new AbortController().signal }) : input
        return original(detached, { ...init, signal: new AbortController().signal })
      }
      return original(input, init)
    }
  }, { fixtureOrigin })
  page = await context.newPage(); page.setDefaultTimeout(25_000)
  page.on('pageerror', error => report.browserErrors.push(String(error.stack || error)))
  await seed()
  await step('01 Default off, local retrieval/viewing does not opt in or send support', async () => {
    await openLab(); await expect(support(lab, 'enabled')).not.toBeChecked()
    await search(lab, caseFor('P01')); await expect(lab('assessment')).toHaveAttribute('data-answerability', 'unverified')
    const before = requests.length; await page.locator('[data-testid^="memory-result-"]').first().click()
    await quiet(before, 'Opening a retrieved quote is not permission for model traffic')
    assert.equal(supportRequests().length, 0)
    await support(lab, 'enabled').check(); await expect(page.locator('input[data-testid^="memory-support-select-"]:checked')).toHaveCount(0)
    await expect(support(lab, 'prepare')).toBeDisabled()
    await configureRetrieval(lab, 'provider-settings')
  })
  for (const fixtureCase of semanticCases) await step(`02 ${fixtureCase.id} ${fixtureCase.category}: exact selected-source assessment`, async () => {
    await search(lab, fixtureCase); await selectLab(fixtureCase); await prepare(lab)
    const before = supportRequests().length; const entry = await send(lab)
    const citations = await assertAssessment(lab, fixtureCase)
    assert.equal(supportRequests().length, before + 1, 'Exactly one request per explicitly sent plan')
    const required = new Set(fixtureCase.expected.requiredPremiseIds)
    const actual = new Set(fixtureCase.controlledResponse.premises.flatMap(premise => premise.references.map(reference => fixtureCase.sourceExcerpts.find(source => source.reference === reference).sourceId)))
    assert.ok([...required].every(id => actual.has(id)), 'Every frozen required premise must be present')
    report.semantic.push({ id: fixtureCase.id, expected: fixtureCase.expected.verdict, actual: await support(lab, 'assessment').getAttribute('data-verdict'), selectedSources: entry.sourceCount, validCitations: citations, requiredPremises: required.size, recoveredRequiredPremises: [...required].filter(id => actual.has(id)).length, attemptedCalls: 1, inputBytes: entry.inputBytes, responseBytes: entry.responseBytes, durationMs: entry.durationMs })
    if (fixtureCase.id === 'N01') await expect(lab('assessment')).toHaveAttribute('data-state', 'matched')
    if (fixtureCase.id === 'P04') { await support(lab, 'assessment').scrollIntoViewIfNeeded(); await screenshot('desktop-two-premise-supported') }
  })
  await step('03 Exact question, private request survives DOM preview edit, double-click sends once', async () => {
    await search(lab, caseFor('P01'), { question: `  ${caseFor('P01').question}  ` }); await selectLab(); await prepare(lab)
    await support(lab, 'source-0').locator('blockquote').evaluate(node => { node.textContent = 'FORGED_DISPLAY_ONLY_62210' })
    mode = 'hold'; const entry = await send(lab, { doubleClick: true }); const before = requests.length
    await expect(support(lab, 'running')).toBeVisible(); await quiet(before, 'Double click cannot make a second dispatch')
    assert.equal(entry.body.messages.some(message => String(message.content).includes('FORGED_DISPLAY_ONLY_62210')), false)
    await releaseHeld(); mode = 'ok'; await assertAssessment(lab)
  })
  for (const failure of ['fake-reference', 'malformed-json', 'failure', 'interrupt', 'oversize', 'truncated']) await step(`04 ${failure} remains unverified, never supported, no retry`, async () => {
    await readyLab(); mode = failure
    if (failure === 'fake-reference') { replyOverride = structuredClone(activeCase.controlledResponse); replyOverride.premises[0].references = [999] }
    if (failure === 'malformed-json') replyOverride = '{"version":1,invalid'
    if (failure === 'oversize') replyOverride = 'x'.repeat(70_000)
    const before = supportRequests().length; await send(lab); await expect(support(lab, 'unverified')).toBeVisible(); await noAssessment(lab)
    await page.waitForTimeout(350); assert.equal(supportRequests().length, before + 1)
    mode = 'ok'; replyOverride = null
  })
  await step('05 Source body changes during held response without storage event invalidate publication', async () => {
    await readyLab(); mode = 'hold'; await send(lab)
    await mutateCommitted('S1'); await releaseHeld(); await noAssessment(lab)
    await mutateCommitted('S1', { restore: true }); mode = 'ok'
  })
  await step('06 Source title changes after HTTP response consumption invalidate final publication', async () => {
    await readyLab()
    await page.evaluate(installSupportBodyConsumptionHook, { fixtureOrigin, novelId, chapterId: idFor(ordinalFor('S1')) })
    const entry = await send(lab)
    await expect.poll(() => page.evaluate(() => window.__supportFinalReadHook?.fired)).toBe(true)
    const hook = await page.evaluate(() => window.__supportFinalReadHook)
    assert.equal(hook.status, 200); assert.equal(hook.reachedEof, true)
    assert.equal(hook.bytes, entry.responseBytes, 'Mutation must occur only after every actual HTTP response byte is consumed')
    assert.ok(hook.chunks > 0)
    report.mutationControls.responseConsumption = hook
    await noAssessment(lab)
    await expect(support(lab, 'unverified')).toContainText('引用来源已改变或未通过校验，请重新检索')
    await expect(support(lab, 'preview')).toHaveCount(0)
    await expect(page.locator('input[data-testid^="memory-support-select-"]:checked')).toHaveCount(0)
    await mutateCommitted('S1', { title: true, restore: true })
  })
  for (const change of ['selection', 'query', 'check-question', 'cutoff', 'provider', 'cancel', 'close', 'new-search', 'navigation']) await step(`07 Late output rejected after ${change}`, async () => {
    await readyLab(); await page.evaluate(() => { window.__supportIgnoreAbort = true }); mode = 'hold'; const late = await send(lab); await expect(support(lab, 'running')).toBeVisible()
    if (change === 'selection') await page.locator('input[data-testid^="memory-support-select-"]:checked').first().uncheck()
    else if (change === 'query') await lab('query').fill('另一问题')
    else if (change === 'check-question') await support(lab, 'check-question').fill('所选片段能说明哪个不同的问题？')
    else if (change === 'cutoff') await lab('cutoff').selectOption(String(idFor(targetOrdinal - 1)))
    else if (change === 'provider') await page.evaluate(() => { const previous = localStorage.getItem('apiConfig'); const next = JSON.parse(previous); next.selectedModel = 'synthetic-new-model'; localStorage.setItem('apiConfig', JSON.stringify(next)); window.dispatchEvent(new StorageEvent('storage', { key: 'apiConfig', oldValue: previous, newValue: JSON.stringify(next), storageArea: localStorage })) })
    else if (change === 'cancel') await support(lab, 'cancel').click()
    else if (change === 'close') await support(lab, 'close').click()
    else if (change === 'new-search') await lab('search').click()
    else await page.goto(`${origin}/#/settings`)
    await releaseHeld(); mode = 'ok'; await page.waitForTimeout(200)
    if (change !== 'navigation') assert.equal(late.status, 200, 'Transport deliberately ignores AbortSignal and returns success; obsolete owner must still reject it')
    await page.evaluate(() => { window.__supportIgnoreAbort = false })
    if (change === 'navigation') { await page.goBack(); await expect(support(lab, 'enabled')).not.toBeChecked(); await page.goForward(); await openLab(); await configureRetrieval(lab, 'provider-settings'); await expect(support(lab, 'enabled')).not.toBeChecked() }
    else await noAssessment(lab, { hidden: change === 'close' })
    if (change === 'provider') await page.evaluate(() => { const config = JSON.parse(localStorage.getItem('apiConfig')); config.selectedModel = 'support-browser-fixture'; localStorage.setItem('apiConfig', JSON.stringify(config)) })
    if (change === 'new-search') await expect(lab('search')).toBeEnabled()
  })
  await step('08 Full-scan ready, running, paused and canceled phases cannot be checked', async () => {
    await lab('clear-cache').click(); await lab('full-scan-enabled').check(); await lab('full-scan-max-calls').fill('1')
    activeCase = caseFor('P01'); supportQuestion = activeCase.question; cutoff = targetOrdinal
    await lab('query').fill(supportQuestion); await lab('search').click()
    await expect(lab('full-scan-status')).toHaveAttribute('data-state', 'ready'); await support(lab, 'enabled').check(); await expect(support(lab, 'prepare')).toBeDisabled()
    holdEmbeddings = true; const before = supportRequests().length; await lab('full-scan-start').click()
    await expect.poll(() => held.size).toBeGreaterThan(0); await expect(support(lab, 'prepare')).toBeDisabled()
    holdEmbeddings = false; await releaseHeld(); await expect(lab('full-scan-status')).toHaveAttribute('data-state', 'budget')
    await expect(support(lab, 'prepare')).toBeDisabled(); await expect(page.locator('input[data-testid^="memory-support-select-"]')).toHaveCount(0)
    await lab('full-scan-cancel').click(); await expect(lab('search')).toBeEnabled(); await expect(support(lab, 'prepare')).toBeDisabled()
    assert.equal(supportRequests().length, before); await lab('full-scan-enabled').uncheck()
  })
  await step('09 Long-novel Lab: enabled support checks late exact-code evidence within 600 chapters', async () => {
    await seedLongNovel(); useScope(true); await openLab(); await expect(lab('stats')).toContainText('600')
    await expect(lab('stats')).toContainText(longSourceChars.toLocaleString('zh-CN'))
    await expect(support(lab, 'enabled')).not.toBeChecked()
    const beforeRemote = retrievalRequests().length
    await search(lab, longCase); await expect(lab('results')).not.toContainText(longFutureCanary); await selectLab(longCase); await prepare(lab)
    const sent = await send(lab); const citations = await assertAssessment(lab, longCase)
    assert.equal(sent.sourceCount, 2); assert.equal(citations, 2)
    assert.equal(retrievalRequests().length, beforeRemote, 'Long-form exact-code retrieval stays local while explicitly sent support is enabled')
    report.longForm.journeys.push({ entry: 'lab', supportCalls: 1, writingCalls: 0, selectedSources: 2, validCitations: citations, sourceChecks: longEvidence.map(source => ({ ordinal: source.ordinal, chapterId: String(idFor(source.ordinal)), revision: revisionFor(longSources[source.ordinal - 1]), start: 0, end: source.quote.length, quote: source.quote })) })
  })
  for (const kind of ['continue', 'polish', 'chapter']) await step(`10 Long-novel Writer ${kind}: enabled check and explicit writing approval`, async () => {
    useScope(true); const beforeRemote = retrievalRequests().length
    await openWriter(kind, { localOnly: true }); await expect(wm('cutoff').locator(`option[value="${idFor(600)}"]`)).toHaveCount(0)
    await search(wm, longCase); await expect(wm('result')).not.toContainText(longFutureCanary); await selectWriter()
    await expect(support(wm, 'enabled')).not.toBeChecked(); await wm('approve').click(); await expect(wm('approved')).toBeVisible()
    await support(wm, 'enabled').check(); await prepare(wm); await expect(wm('approved')).toHaveCount(0)
    mode = 'hold'; const entry = await send(wm); await expect(wm('approve')).toBeDisabled(); assert.equal(entry.sourceCount, 2)
    await releaseHeld(); mode = 'ok'; await assertAssessment(wm); await expect(wm('approved')).toHaveCount(0)
    await expect(wm('approve')).toBeEnabled(); await wm('approve').click(); await expect(wm('approved')).toBeVisible()
    const before = writingRequests().length
    await dialog.getByRole('button', { name: kind === 'chapter' ? '开始生成' : kind === 'continue' ? '开始续写' : '开始润色', exact: true }).click()
    await expect.poll(() => writingRequests().length).toBe(before + 1)
    const writing = writingRequests()[before]; const envelope = writerEnvelope(writing.body)
    assert.equal(envelope.sources.length, 2); assert.deepEqual(envelope.relations, [])
    assert.equal(envelope.projectId, `novel:${longNovelId}`); assert.equal(envelope.throughChapterId, String(idFor(599)))
    assert.deepEqual(envelope.sources.map(source => source.quote).sort(), longEvidence.map(source => source.quote).sort())
    for (const source of envelope.sources) {
      const original = longEvidence.find(item => item.quote === source.quote)
      assert.ok(original); assert.equal(source.ordinal, original.ordinal); assert.equal(source.chapterId, String(idFor(original.ordinal)))
      assert.equal(source.start, 0); assert.equal(source.end, original.quote.length); assert.equal(source.revision, revisionFor(longSources[original.ordinal - 1]))
      assert.equal(source.quote, liveQuotes.get(idFor(original.ordinal)))
    }
    assert.equal(retrievalRequests().length, beforeRemote, 'Long-form selected-source writing must not silently enable remote retrieval')
    report.longForm.journeys.push({ entry: kind, supportCalls: 1, writingCalls: 1, selectedSources: 2, validCitations: 2, sources: envelope.sources.map(({ chapterId, ordinal, revision, start, end, quote }) => ({ chapterId, ordinal, revision, start, end, quote })) })
    assert.equal(envelope.assessment.answerability, 'unverified')
    const full = JSON.stringify(writing.body.messages)
    assert.ok(!full.includes(activeCase.controlledResponse.answer), 'Model support answer must not enter Writer prompt')
    assert.ok(!full.includes(activeCase.controlledResponse.explanation), 'Model explanation must not enter Writer prompt')
    assert.ok(!full.includes(quoteFor('S80')) && !full.includes(aliasCanary) && !full.includes(longFutureCanary), 'No future/graph-label leakage into selected-source Writer prompt')
    if (kind === 'chapter') { await expect(dialog).toBeHidden(); await expect(editor()).toContainText(writingCompletion); await expect(page.locator('.saving-indicator')).toHaveCount(0); liveQuotes.set(idFor(targetOrdinal), `${sources[targetOrdinal - 1].title}\n\n${writingCompletion}`) }
    else { await expect(dialog.locator('.result-content')).toContainText(writingCompletion); await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(dialog).toBeHidden() }
  })
  await step('11 Writer close during held check rejects late output and resets approval', async () => {
    // Return to the separate small fixture for this lifecycle-only scenario.
    await page.goto(`${origin}/__support_seed`)
    await page.evaluate(longNovelId => { const novels = JSON.parse(localStorage.getItem('novels')); localStorage.setItem('novels', JSON.stringify(novels.filter(novel => novel.id !== longNovelId))) }, longNovelId)
    useScope(false); await openWriter('continue')
    await search(wm); await selectWriter(); await support(wm, 'enabled').check(); await prepare(wm); mode = 'hold'; await send(wm)
    await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(dialog).toBeHidden(); await releaseHeld(); mode = 'ok'
    await openWriter('continue'); await expect(wm('approved')).toHaveCount(0); await expect(wm('result')).toHaveCount(0)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
  })
  await step('12 Narrow mobile cancel and individual cited premises remain usable', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await openLab(); await configureRetrieval(lab, 'provider-settings')
    await readyLab(caseFor('P04')); mode = 'hold'; await send(lab)
    await support(lab, 'cancel').scrollIntoViewIfNeeded(); const bounds = await support(lab, 'cancel').boundingBox()
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.height >= 44, 'Cancel is in viewport and finger-sized')
    await support(lab, 'cancel').click(); await releaseHeld(); await noAssessment(lab); mode = 'ok'
    await readyLab(caseFor('P04')); await send(lab); await assertAssessment(lab)
    for (let index = 0; index < 2; index++) { const row = support(lab, `premise-${index}`); await row.scrollIntoViewIfNeeded(); await expect(row).toBeVisible(); const box = await row.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= 391, `Premise ${index + 1} must fit narrow viewport`) }
    await screenshot('mobile-individual-premises')
  })
  await step('13 Frozen gold oracle rejects always-insufficient and always-supported mutants', async () => {
    const allInsufficientFailures = semanticCases.filter(item => item.expected.verdict !== 'insufficient').length
    const positiveFailures = semanticCases.filter(item => item.expected.verdict === 'supported').length
    const allSupportedFailures = semanticCases.filter(item => item.expected.verdict !== 'supported').length
    assert.equal(positiveFailures, 12); assert.equal(allInsufficientFailures, 19); assert.equal(allSupportedFailures, 13)
    Object.assign(report.mutationControls, { total: 25, alwaysInsufficient: { rejected: 19, positiveRecovery: '0/12' }, alwaysSupported: { rejected: 13 }, disclaimer: 'Oracle sensitivity control, not a claim that protocol validation proves semantic entailment.' })
  })
  assert.deepEqual(report.fixtureErrors, []); assert.deepEqual(report.browserErrors, []); assert.deepEqual(report.blockedRequests, [])
  assert.equal(report.semantic.length, 25)
  assert.deepEqual(report.longForm.journeys.map(item => item.entry), ['lab', 'continue', 'polish', 'chapter'], 'Long-form feature-on acceptance must include Lab and all three Writer modes')
  assert.equal(report.tests.length, 52, 'Every declared built-app scenario must execute, without skips')
  assert.equal(supportRequests().length, 50, 'Each explicit send contributes exactly one call; all other actions contribute zero')
  assert.equal(writingRequests().length, 3, 'Each Writer entry point produces one separately approved writing request')
  assert.equal(supportRequests().reduce((sum, entry) => sum + entry.sourceCount, 0), 62, 'Exact selected-source transmission denominator')
  assert.equal(report.semantic.reduce((sum, entry) => sum + entry.validCitations, 0), 27, 'Exact valid-citation denominator for 25 controlled cases')
  console.log(`PASS ${report.tests.length} support browser scenarios; ${report.semantic.length} frozen semantic cases`)
} catch (error) {
  report.error = String(error.stack || error); console.error(report.error); process.exitCode = 1
  report.diagnostics = { url: page?.url(), text: await page?.locator('body').innerText({ timeout: 3000 }).catch(() => '') }
} finally {
  holdEmbeddings = false; await releaseHeld(); report.finishedAt = new Date().toISOString()
  report.longForm.totals = { supportCalls: supportRequests().filter(entry => entry.novelId === longNovelId).length, writingCalls: writingRequests().filter(entry => entry.novelId === longNovelId).length, retrievalCalls: retrievalRequests().filter(entry => entry.novelId === longNovelId).length, selectedSourcesSent: supportRequests().filter(entry => entry.novelId === longNovelId).reduce((sum, entry) => sum + (entry.sourceCount ?? 0), 0), expectedSupportCalls: 4, expectedWritingCalls: 3, expectedRetrievalCalls: 0, expectedSelectedSourcesSent: 8 }
  report.requests = requests; report.totals = { tests: report.tests.length, passed: report.tests.filter(item => item.status === 'passed').length, failed: report.tests.filter(item => item.status === 'failed').length,
    expectedTests: 52, expectedSupportCalls: 50, expectedWritingCalls: 3, expectedSelectedSourcesSent: 62, expectedSemanticCitations: 27, semanticCompleted: report.semantic.length, semanticExpected: 25, supportCalls: supportRequests().length, writingCalls: writingRequests().length, retrievalCalls: retrievalRequests().length,
    selectedSourcesSent: supportRequests().reduce((sum, entry) => sum + (entry.sourceCount ?? 0), 0), validCitations: report.semantic.reduce((sum, entry) => sum + entry.validCitations, 0),
    retrievalAllPremiseRecovery: `${report.semantic.filter(item => item.recoveredRequiredPremises === item.requiredPremises && item.requiredPremises > 0).length}/${semanticCases.filter(item => item.expected.requiredPremiseIds.length > 0).length}`,
    endToEndSupportedRecovery: `${report.semantic.filter(item => item.expected === 'supported' && item.actual === 'supported' && item.recoveredRequiredPremises === item.requiredPremises).length}/12`,
    supportedRecoveryGivenCompleteSelection: `${report.semantic.filter(item => item.expected === 'supported' && item.actual === 'supported').length}/12`,
    appropriateInsufficiency: `${report.semantic.filter(item => item.expected === 'insufficient' && item.actual === 'insufficient').length}/6`,
    appropriateUncertainty: `${report.semantic.filter(item => item.expected === 'uncertain' && item.actual === 'uncertain').length}/7`,
    requiredPremiseCompleteness: `${report.semantic.reduce((sum, item) => sum + item.recoveredRequiredPremises, 0)}/${semanticCases.reduce((sum, item) => sum + item.expected.requiredPremiseIds.length, 0)}`,
    unmockedExternalRequests: report.blockedRequests.length }
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  await browser?.close()
  for (const server of [provider, preview]) if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}
