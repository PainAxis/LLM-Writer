/**
 * Built-app A/B candidate scan acceptance. Run in authorized CI after npm run build.
 * This file is NOT executed locally where browser launch/install is prohibited.
 * Actual UI actions and real production HTTP adapter, with a loopback-only oracle.
 * Controlled responses test integration and frozen meanings, NOT real-model quality.
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
import { buildLongProfile, buildReviewCapacityProfile, LONG_FUTURE_CANARY, LONG_TARGET_TEXT, PLOT_EXPLANATION_CANARY } from './fixtures/novel-candidate-long-profile.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)), artifacts = path.join(root, 'artifacts/browser-memory-novel-scan')
const frozenBytes = await readFile(new URL('./fixtures/novel-candidate-scan-v1.json', import.meta.url))
const fixtureSha256 = createHash('sha256').update(frozenBytes).digest('hex')
assert.equal(fixtureSha256, '6d54c1cc1a02d0fe1b4b7580b21c8e5fb02d13f15e9f712b853e6721b67a8206')
const frozen = JSON.parse(frozenBytes), corpus = new Map(frozen.corpus.map(source => [source.sourceId, source]))
const gold = id => frozen.cases.find(test => test.id === id)
const stamp = '2026-10-22T00:00:00.000Z'
const future = 'FUTURE_SMALL_NOVEL_SCAN_64110'
const completion = '沈砚抬头望向河岸，决定先寻找一处避雨之所，再细细回想旧日的约定。远处的茶棚传来人声，他整理好行囊，沿着铺满石板的小路继续前行，直到一扇亮着灯光的木门出现在雨幕之中。'
const smallProfile = { id: 'small', chapters: [...gold('P06').sourceIds, ...gold('P01').sourceIds].map(id => {
  const source = corpus.get(id); return { sourceId: id, title: source.chapterTitle, text: source.text, cues: source.cues }
}).concat([{ sourceId: 'TARGET', title: '本次写作', text: LONG_TARGET_TEXT, cues: [] }, { sourceId: 'FUTURE', title: '未来结局', text: future, cues: [] }]), disclosedChapterCount: 7 }
const longProfile = buildLongProfile(), capacityProfile = buildReviewCapacityProfile()
const expect = playwrightExpect.configure({ timeout: 30_000 })
const report = { startedAt: new Date().toISOString(), fixtureSha256, commit: process.env.GITHUB_SHA || 'local',
  semanticQuality: 'Controlled gold integration only; no real-model accuracy claim', tests: [], screenshots: [], fixtureErrors: [], browserErrors: [], blockedRequests: [], longForm: { sourceSha256: longProfile.sourceSha256, totalChars: longProfile.totalChars, disclosedChars: longProfile.disclosedChars, totalChapters: 600, disclosedChapters: 599, journeys: [] } }
const requests = [], held = new Set()
let preview, provider, origin, fixtureOrigin, browser, context, page, dialog
let current, cutoff, mode = 'ok', ignoreAbort = false
const sha = value => createHash('sha256').update(value).digest('hex')
const html = text => `<p>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br/>')}</p>`
const scan = id => page.getByTestId(`novel-scan-${id}`)
const memory = id => page.getByTestId(`memory-${id}`)
const plot = id => page.getByTestId(`plot-links-${id}`)
const wm = id => dialog.getByTestId(`writer-memory-${id}`)
const cards = () => page.locator('[data-testid^="novel-scan-candidate-"]')
const scanRequests = () => requests.filter(entry => entry.kind === 'collect' || entry.kind === 'connect')
const writingRequests = () => requests.filter(entry => entry.kind === 'writing')
const idFor = ordinal => current.novelId * 1000 + ordinal
function selectProfile(profile, novelId) {
  current = { ...profile, novelId, projectId: `novel:${novelId}`, chapters: profile.chapters.map((chapter, index) => ({ ...chapter, ordinal: index + 1, id: String(novelId * 1000 + index + 1) })) }
  cutoff = profile.disclosedChapterCount ?? profile.chapters.length
}
function novel() {
  return { id: current.novelId, title: '受控候选扫描作品', genre: 'fantasy', description: 'Synthetic browser fixture only.', tags: [], status: 'writing', createdAt: stamp, updatedAt: stamp,
    chapters: current.chapters.length, wordCount: current.chapters.reduce((sum, chapter) => sum + chapter.text.length, 0), characters: [], worldSettings: [], events: [], corpusData: [],
    chapterList: current.chapters.map(chapter => ({ id: Number(chapter.id), title: chapter.title, content: html(chapter.text), description: '寻找旧友，回顾已披露线索。', status: 'draft', tags: [], wordCount: chapter.text.length, createdAt: stamp, updatedAt: stamp })) }
}
function scanPayload(body) {
  const message = body.messages?.find(item => item.role === 'user')
  if (typeof message?.content !== 'string') return null
  try { const parsed = JSON.parse(message.content); return parsed.version === 1 && Array.isArray(parsed.sources) ? parsed : null } catch { return null }
}
function controlledReply(payload, kind) {
  const available = payload.sources.map(source => {
    assert.deepEqual(Object.keys(source).sort(), ['quote', 'reference'])
    const chapter = current.chapters.slice(0, cutoff).find(item => item.text.includes(source.quote))
    assert.ok(chapter, 'Only current disclosed original spans are sent, never titles/annotations/future')
    return { ...source, chapter }
  })
  if (kind === 'collect') {
    const cues = available.filter(source => payload.primaryReferences.includes(source.reference)).flatMap(source => source.chapter.cues.filter(cue => cue.keys.every(key => source.quote.includes(key))).map(cue => ({ ...cue, references: [source.reference] })))
    assert.ok(cues.length <= 4)
    return { version: 1, cues, saturated: false }
  }
  if (current.id === capacityProfile.id) {
    const first = available[0], number = first.quote.match(/巡守甲(\d+)/)?.[1]
    assert.ok(number)
    return { version: 1, candidates: [{ kind: 'relationship', source: { type: 'person', label: `巡守甲${number}` }, target: { type: 'person', label: `巡守乙${number}` },
      predicate: `本次受控路线的交接 ${sha(available.map(source => source.quote).sort().join('|')).slice(0, 20)}`, origin: 'explicit', premises: [{ role: 'support', references: available.map(source => source.reference) }] }], saturated: false }
  }
  const candidates = []
  if (current.id === 'small') for (const test of [gold('P01'), gold('P06')]) {
    if (test.gold.requiredPremises.flatMap(group => group.sourceIds).every(id => available.some(source => source.quote === corpus.get(id).text))) candidates.push({ ...test.gold.candidate,
      premises: test.gold.requiredPremises.map(group => ({ role: group.role, references: group.sourceIds.map(id => available.find(source => source.quote === corpus.get(id).text).reference) })) })
  }
  else {
    const relation = available.find(source => source.quote.includes('沈砚将渡口药铺托付给阿宁'))
    if (relation) candidates.push({ kind: 'relationship', source: { type: 'person', label: '沈砚' }, target: { type: 'person', label: '阿宁' }, predicate: '委托阿宁照看渡口药铺', origin: 'explicit', premises: [{ role: 'support', references: [relation.reference] }] })
    const setup = available.find(source => source.quote.includes('白鹭离开前'))
    const bridge = available.find(source => source.quote.includes('白鹭改名裁雨'))
    const recovery = available.find(source => source.quote.includes('裁雨回到故居'))
    if (setup && bridge && recovery) candidates.push({ kind: 'foreshadowing', mode: 'possible_recovery', title: '银匣与归人', explanation: PLOT_EXPLANATION_CANARY,
      premises: [{ role: 'setup', references: [setup.reference] }, { role: 'context', references: [bridge.reference] }, { role: 'recovery', references: [recovery.reference] }] })
  }
  assert.ok(candidates.length <= 2)
  return { version: 1, candidates, saturated: false }
}
async function startProvider() {
  provider = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    if (request.method === 'OPTIONS') return response.writeHead(204).end()
    try {
      assert.equal(request.method, 'POST'); assert.ok(request.url.endsWith('/chat/completions'), 'Embedding, tools, model probes and fallbacks are forbidden')
      const chunks = []; for await (const chunk of request) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')), payload = scanPayload(body)
      const kind = payload ? payload.primaryReferences ? 'collect' : 'connect' : 'writing'
      const entry = { kind, profile: current.id, scenario: report.tests.at(-1)?.name, status: 'pending', body, sourceChars: payload?.sources.reduce((sum, source) => sum + source.quote.length, 0) ?? 0,
        inputChars: body.messages.reduce((sum, message) => sum + message.content.length, 0), inputBytes: Buffer.byteLength(body.messages.map(message => message.content).join('')), sourceCount: payload?.sources.length ?? 0 }
      requests.push(entry)
      response.on('close', () => { if (!response.writableEnded) entry.status = 'aborted' })
      if (payload) {
        assert.equal(body.tools, undefined); assert.notEqual(body.stream, true); assert.equal(body.max_tokens, 1200)
        assert.ok(entry.inputChars <= 16_000 && entry.inputBytes <= 48_000 && entry.sourceChars <= 8_000)
        assert.ok(!JSON.stringify(body.messages).includes(future) && !JSON.stringify(body.messages).includes(LONG_FUTURE_CANARY))
      }
      const controlled = payload ? controlledReply(payload, kind) : null
      entry.candidateCount = controlled?.candidates?.length ?? 0
      const answer = controlled ? JSON.stringify(controlled) : completion
      const common = { id: `novel-scan-http-${requests.length}`, created: 1, model: body.model }
      let output, contentType = 'application/json'
      if (body.stream) {
        contentType = 'text/event-stream'
        output = [{ ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: answer }, finish_reason: null }] },
          { ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 } }].map(item => `data: ${JSON.stringify(item)}\n\n`).join('') + 'data: [DONE]\n\n'
      } else output = JSON.stringify({ ...common, object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: answer } }], usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 } })
      entry.responseBytes = Buffer.byteLength(output)
      const chosenMode = mode
      const deliver = () => {
        held.delete(deliver)
        if (response.destroyed) { entry.status = 'aborted'; return }
        if (payload && chosenMode === 'failure') { entry.status = 503; response.writeHead(503, { 'Content-Type': 'application/json' }).end('{"error":"controlled unavailable"}'); return }
        entry.status = 200; response.writeHead(200, { 'Content-Type': contentType }).end(output)
      }
      if (payload && chosenMode === 'hold') held.add(deliver); else deliver()
    } catch (error) { report.fixtureErrors.push(String(error.stack || error)); response.writeHead(500).end('{}') }
  })
  await new Promise((resolve, reject) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', resolve) })
  fixtureOrigin = `http://127.0.0.1:${provider.address().port}`
}
const release = () => { for (const send of [...held]) send() }
async function step(name, run) {
  const item = { name, status: 'running', callsBefore: requests.length }; report.tests.push(item)
  console.log(`START ${name}`)
  const started = Date.now()
  try { await run(); item.status = 'passed'; console.log(`PASS  ${name}`) }
  catch (error) { item.status = 'failed'; item.error = String(error.stack || error); await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {}); throw error }
  finally { item.durationMs = Date.now() - started; item.callsAfter = requests.length }
}
async function dismiss() { const button = page.getByRole('button', { name: '我知道了', exact: true }); try { await button.waitFor({ state: 'visible', timeout: 1200 }); await button.click() } catch { /* Optional announcement. */ } }
async function seed(profile = smallProfile, novelId = 64110) {
  selectProfile(profile, novelId); mode = 'ok'
  await page.goto(`${origin}/__novel_scan_seed`)
  await page.evaluate(async ({ novel, apiBase }) => {
    localStorage.clear()
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('llm-writer', 1); request.onupgradeneeded = () => request.result.createObjectStore('kv'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite'), store = tx.objectStore('kv'); store.clear()
      for (const chapter of novel.chapterList) { const key = `novel:${novel.id}:chapter:${chapter.id}:content:scan-fixture`; store.put(chapter.content, key); delete chapter.content; chapter.contentRef = key }
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
    }); db.close()
    localStorage.setItem('novels', JSON.stringify([novel]))
    localStorage.setItem('apiConfig', JSON.stringify({ apiKey: 'synthetic-placeholder-not-a-credential', baseURL: apiBase, provider: 'custom', selectedModel: 'novel-scan-browser-fixture', maxTokens: 2048, unlimitedTokens: false, temperature: 0, thinkingProtocol: 'auto', thinkingMode: 'default', customHeaders: {} }))
  }, { novel: novel(), apiBase: `${fixtureOrigin}/v1` })
}
async function openLab() {
  await page.goto(`${origin}/#/memory`); await dismiss()
  await memory('source').selectOption(current.projectId)
  await expect(memory('stats')).toBeVisible({ timeout: 90_000 })
  await memory('cutoff').selectOption(String(idFor(cutoff)))
  await expect(scan('prepare')).toHaveCount(0)
  await expect(scan('enabled')).not.toBeChecked(); await scan('enabled').check()
}
async function prepare(attempts = 64) {
  const allocation = { attempts, 'active-ms': 600_000, 'input-chars': Math.min(attempts * 16_000, 65_536_000), 'input-bytes': Math.min(attempts * 48_000, 196_608_000), 'output-tokens': attempts * 1200, 'response-bytes': attempts * 65_536 }
  for (const [id, value] of Object.entries(allocation)) await scan(`max-${id}`).fill(String(value))
  const before = requests.length
  await scan('prepare').click(); await expect(scan('panel')).toHaveAttribute('data-state', 'ready_a')
  await expect(scan('destination')).toContainText(fixtureOrigin)
  await page.waitForTimeout(150); assert.equal(requests.length, before, 'Preview requires zero remote calls')
}
async function runScan(attempts = 64) {
  await prepare(attempts); await scan('start-a').click()
  await expect(scan('panel')).toHaveAttribute('data-state', 'ready_b', { timeout: 600_000 })
  await expect(scan('source-coverage')).toHaveAttribute('data-coverage', 'complete')
  const before = requests.length; await page.waitForTimeout(150); assert.equal(requests.length, before, 'A completion must not start B')
  await scan('start-b').click(); await expect(scan('panel')).toHaveAttribute('data-state', 'reviewing_complete_for_contract', { timeout: 180_000 })
  await expect(scan('connection-coverage')).toHaveAttribute('data-coverage', 'complete_for_contract')
}
async function readGraph() {
  return page.evaluate(async projectId => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('llm-writer', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    return new Promise((resolve, reject) => { const tx = db.transaction('kv', 'readonly'), request = tx.objectStore('kv').get(`memory-fact-graph:v1:${projectId}`); request.onsuccess = () => resolve(request.result ? JSON.parse(request.result) : null); request.onerror = () => reject(request.error) })
  }, current.projectId)
}
async function confirmFirstPlot() {
  const before = await readGraph(), id = before.plotLinks[0].id, calls = requests.length
  await expect(plot('item-0')).toHaveAttribute('data-confirmed', 'false')
  await plot('confirm-0').click()
  // Disabled alone also means busy before CAS. Observe the post-save state first.
  await expect(plot('item-0')).toHaveAttribute('data-confirmed', 'true')
  await expect(plot('notice')).toHaveText('作者确认已保存，所有前提仍受修订和披露校验。')
  await expect(plot('refresh')).toBeEnabled()
  await expect(plot('confirm-0')).toBeDisabled()
  const saved = await readGraph(), link = saved.plotLinks.find(item => item.id === id)
  assert.equal(link?.authorConfirmed, true)
  assert.deepEqual(link.premises, before.plotLinks[0].premises)
  assert.notEqual(saved.revision, before.revision)
  assert.equal(requests.length, calls, 'Plot confirmation is transport-free')
  return saved
}
async function saveAll() {
  const before = requests.length
  let clicks = 0, duplicates = 0
  while (await cards().count()) {
    assert.ok(clicks++ < 20)
    const count = await cards().count(), previous = await readGraph()
    const beforeCount = previous ? previous.relations.length + previous.plotLinks.length : 0
    await scan('save-0').click(); await expect(cards()).toHaveCount(count - 1)
    const after = await readGraph(), afterCount = after.relations.length + after.plotLinks.length
    assert.ok(afterCount === beforeCount || afterCount === beforeCount + 1)
    if (afterCount === beforeCount) { duplicates++; assert.equal(after.revision, previous.revision); await expect(scan('notice')).toContainText('未重复写入') }
    else assert.notEqual(after.revision, previous?.revision)
    await expect(scan('saved-status')).toContainText(`已保存 ${afterCount} 条`)
  }
  assert.equal(requests.length, before, 'Review/save does not re-run the model')
  const graph = await readGraph()
  assert.equal(graph.version, 2); assert.equal(graph.relations.length, 1); assert.equal(graph.plotLinks.length, 1)
  assert.ok([...graph.relations, ...graph.plotLinks].every(item => !item.authorConfirmed && item.createdBy === 'model'))
  assert.ok(duplicates > 0, 'Real overlapping B jobs exercise typed payload+anchor duplicate detection')
  return graph
}
async function mutateSource(ordinal, { restore = false, dispatch = true } = {}) {
  const chapter = current.chapters[ordinal - 1]
  chapter.originalText ??= chapter.text
  chapter.text = restore ? chapter.originalText : `${chapter.originalText}正文已修改，旧引用不可继续。`
  await page.evaluate(({ novelId, chapterId, text, dispatch }) => {
    const previous = localStorage.getItem('novels'), novels = JSON.parse(previous)
    const chapter = novels.find(novel => novel.id === novelId).chapterList.find(chapter => chapter.id === chapterId)
    chapter.content = `<p>${text}</p>`; delete chapter.contentRef
    localStorage.setItem('novels', JSON.stringify(novels))
    if (dispatch) window.dispatchEvent(new StorageEvent('storage', { key: 'novels', oldValue: previous, newValue: localStorage.getItem('novels'), storageArea: localStorage }))
  }, { novelId: current.novelId, chapterId: idFor(ordinal), text: chapter.text, dispatch })
}
async function externalGraphChange() {
  await page.evaluate(async projectId => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('llm-writer', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise((resolve, reject) => { const tx = db.transaction('kv', 'readwrite'), store = tx.objectStore('kv'), get = store.get(`memory-fact-graph:v1:${projectId}`); get.onsuccess = () => { const graph = get.result ? JSON.parse(get.result) : { version: 2, projectId, relations: [], plotLinks: [] }; graph.revision = crypto.randomUUID(); store.put(JSON.stringify(graph), `memory-fact-graph:v1:${projectId}`) }; tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) })
    window.dispatchEvent(new Event('focus'))
  }, current.projectId)
}
async function takeScreenshot(name) { await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: false }); report.screenshots.push(`${name}.png`) }
async function openWriterDialog(kind) {
  // Dialog-only helper intentionally preserves the current Writer owner. Safety
  // assertions inside a journey must not navigate/reload to clear live state.
  if (kind === 'chapter') { await page.getByRole('button', { name: '根据大纲生成', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'AI生成章节内容', exact: true }); await dialog.locator('.prompt-item-modern').first().click() }
  else if (kind === 'continue') { await page.getByRole('button', { name: '续写', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'AI智能续写', exact: true }) }
  else { await page.getByRole('button', { name: '优化', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'AI文本润色', exact: true }); await dialog.locator('.prompt-item').first().click() }
  await expect(dialog).toBeVisible()
}
async function openWriter(kind) {
  // These are independent default-off journeys, not same-instance reopen tests.
  // Repeating the same hash can reuse Writer; use a fresh document without
  // re-seeding storage, clearing saved graphs, or changing provider configuration.
  const previousDocument = await page.evaluate(() => window.__novelScanDocumentId)
  const savedGraph = await readGraph()
  await page.goto(`${origin}/__novel_scan_seed`)
  await page.goto(`${origin}/#/writer?novelId=${current.novelId}&chapterId=${idFor(599)}`); await dismiss()
  assert.notEqual(await page.evaluate(() => window.__novelScanDocumentId), previousDocument, 'Independent Writer journey must create a fresh document')
  assert.deepEqual(await readGraph(), savedGraph, 'Fresh document preserves previously saved/confirmed graph annotations')
  const config = await page.evaluate(() => JSON.parse(localStorage.getItem('apiConfig')))
  assert.equal(config.baseURL, `${fixtureOrigin}/v1`); assert.equal(config.selectedModel, 'novel-scan-browser-fixture')
  await expect(page.locator('.editor-panel [contenteditable="true"]')).toContainText(LONG_TARGET_TEXT.slice(0, 10), { timeout: 90_000, useInnerText: true })
  await openWriterDialog(kind)
  await expect(wm('enabled')).not.toBeChecked(); await wm('enabled').check()
  await expect(wm('embedding-enabled')).not.toBeChecked(); await expect(wm('rerank-enabled')).not.toBeChecked()
  await expect(wm('approved')).toHaveCount(0); await expect(wm('result')).toHaveCount(0)
  await expect(wm('cutoff').locator(`option[value="${idFor(600)}"]`)).toHaveCount(0)
}
async function searchWriter(through = 599) {
  await wm('cutoff').selectOption(String(idFor(through))); await wm('query').fill('沈砚 阿宁 渡口药铺')
  await wm('search').click(); await expect(wm('search')).toBeEnabled({ timeout: 90_000 })
  await expect(wm('result')).toBeVisible()
}
async function approveWriter() {
  await wm('approve').click()
  await expect(wm('approved')).toBeVisible()
  await expect(wm('notice')).toHaveText('已核对。本次仅发送勾选的完整依据，答案仍须核对；发送前会重新检查修订和披露范围。')
  await expect(wm('search')).toBeEnabled()
}
async function readCommittedChapter(ordinal) {
  return page.evaluate(async ({ novelId, chapterId }) => {
    const novels = JSON.parse(localStorage.getItem('novels'))
    const chapter = novels.find(item => item.id === novelId).chapterList.find(item => item.id === chapterId)
    if (typeof chapter.content === 'string') return chapter.content
    if (!chapter.contentRef) return null
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('llm-writer', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try { return await new Promise((resolve, reject) => { const request = db.transaction('kv', 'readonly').objectStore('kv').get(chapter.contentRef); request.onsuccess = () => resolve(request.result ?? null); request.onerror = () => reject(request.error) }) }
    finally { db.close() }
  }, { novelId: current.novelId, chapterId: idFor(ordinal) })
}
async function closeWriter() { await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(dialog).toBeHidden() }
function writerEnvelope(body) {
  const marker = 'WRITER_MEMORY_CONTEXT_JSON'
  const text = body.messages.find(message => typeof message.content === 'string' && message.content.includes(marker))?.content
  assert.ok(text)
  const rest = text.slice(text.indexOf(marker) + marker.length), start = rest.indexOf('{')
  for (let end = start + 1; end <= rest.length; end++) { try { return JSON.parse(rest.slice(start, end)) } catch { /* Find exact JSON boundary. */ } }
  assert.fail('No complete Writer evidence envelope')
}

await mkdir(artifacts, { recursive: true })
try {
  preview = await startPreviewServer({ port: 0, sha: process.env.GITHUB_SHA || 'local' }); origin = `http://127.0.0.1:${preview.address().port}`
  await startProvider()
  browser = await chromium.launch({ headless: true })
  context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, locale: 'zh-CN', serviceWorkers: 'block' })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === origin && url.pathname === '/__novel_scan_seed') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Controlled candidate scan</title>' })
    if ([origin, fixtureOrigin].includes(url.origin) || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
    report.blockedRequests.push(`${url.origin}${url.pathname}`); return route.abort('blockedbyclient')
  })
  await context.addInitScript(({ fixtureOrigin }) => {
    window.__novelScanDocumentId = crypto.randomUUID()
    const original = window.fetch
    window.__novelScanIgnoreAbort = false
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (window.__novelScanIgnoreAbort && url.startsWith(fixtureOrigin) && url.endsWith('/chat/completions')) return original(input, { ...init, signal: new AbortController().signal })
      return original(input, init)
    }
  }, { fixtureOrigin })
  page = await context.newPage(); page.setDefaultTimeout(30_000)
  page.on('pageerror', error => report.browserErrors.push(String(error.stack || error)))
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false })
  await step('01 Default-off, zero-call preview, separate A/B approval, frozen three-premise bridge', async () => {
    await seed(); await openLab(); await runScan()
    assert.ok(await cards().count() >= 2)
    const bridge = cards().filter({ has: page.getByText(gold('P06').gold.candidate.title, { exact: true }) })
    await expect(bridge).toHaveCount(1)
    assert.deepEqual(await bridge.getByTestId('novel-scan-premise').evaluateAll(nodes => nodes.map(node => node.dataset.role)), ['setup', 'context', 'recovery'])
    assert.deepEqual(await bridge.getByTestId('novel-scan-quote').allTextContents(), gold('P06').gold.requiredPremises.flatMap(group => group.sourceIds.map(id => corpus.get(id).text)))
    assert.equal(await readGraph(), null, 'A+B does not persist or confirm proposals')
    await expect(scan('ledger')).toHaveAttribute('data-attempts', String(scanRequests().length))
    await takeScreenshot('desktop-reviewed-bridge')
  })
  await step('02 Explicit saves advance only own CAS; plot confirmation and reload are separate', async () => {
    const graph = await saveAll()
    await expect(scan('saved-status')).toContainText('尚未经作者确认')
    const confirmed = await confirmFirstPlot(); assert.equal(confirmed.plotLinks[0].authorConfirmed, true); assert.equal(confirmed.relations[0].authorConfirmed, false)
    assert.notEqual(confirmed.revision, graph.revision)
    await page.reload(); await dismiss(); await memory('source').selectOption(current.projectId); await expect(plot('item-0')).toBeVisible()
    assert.deepEqual((await readGraph()).plotLinks[0].premises, confirmed.plotLinks[0].premises)
  })
  await step('03 Download/restore typed plot links through actual Settings backup UI', async () => {
    const before = await readGraph()
    await page.goto(`${origin}/#/settings`); await dismiss(); await page.getByRole('tab', { name: '数据管理', exact: true }).click()
    const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '小说数据', exact: true }).click()
    const download = await downloading, filename = path.join(artifacts, 'novel-candidate-backup.json'); await download.saveAs(filename)
    const backup = JSON.parse(await readFile(filename, 'utf8')), exported = backup.data.factGraphs.find(graph => graph.projectId === current.projectId)
    assert.equal(exported.version, 2); assert.deepEqual(exported.plotLinks, before.plotLinks)
    await page.locator('.data-management input[type="file"]').setInputFiles(filename)
    await page.getByRole('dialog', { name: '确认导入', exact: true }).getByRole('button', { name: '确定', exact: true }).click()
    const completed = page.getByRole('dialog', { name: '导入完成', exact: true }); await expect(completed).toContainText('成功导入')
    await Promise.all([page.waitForEvent('load'), completed.getByRole('button', { name: '确定', exact: true }).click()])
    const restored = await readGraph(); assert.deepEqual(restored.plotLinks, before.plotLinks); assert.deepEqual(restored.relations, before.relations); assert.notEqual(restored.revision, before.revision)
  })
  await step('04 Partial A budget, explicit additive grant and independent B start preserve cumulative ledger', async () => {
    await seed(); await openLab(); await prepare(1); await scan('start-a').click(); await expect(scan('panel')).toHaveAttribute('data-state', 'paused')
    await expect(scan('ledger')).toHaveAttribute('data-attempts', '1'); await expect(scan('source-coverage')).toHaveAttribute('data-coverage', 'incomplete')
    const before = requests.length
    for (const [id, value] of Object.entries({ attempts: 63, 'active-ms': 0, 'input-chars': 63 * 16_000, 'input-bytes': 63 * 48_000, 'output-tokens': 63 * 1200, 'response-bytes': 63 * 65_536 })) await scan(`add-${id}`).fill(String(value))
    await scan('grant').click(); await expect(scan('ledger')).toHaveAttribute('data-attempts', '1'); await expect(scan('ledger')).toHaveAttribute('data-authorized-attempts', '64'); assert.equal(requests.length, before)
    await scan('resume').click(); await expect(scan('panel')).toHaveAttribute('data-state', 'ready_b'); await scan('start-b').click(); await expect(scan('panel')).toHaveAttribute('data-state', 'reviewing_complete_for_contract')
  })
  await step('04b Double-start, in-flight pause, explicit resume and B partial review never duplicate dispatch', async () => {
    await seed(); await openLab(); await prepare(); mode = 'hold'
    const before = requests.length
    await scan('start-a').evaluate(button => { button.click(); button.click() })
    await expect.poll(() => held.size).toBe(1)
    await scan('pause').click(); release(); mode = 'ok'
    await expect(scan('panel')).toHaveAttribute('data-state', 'paused')
    await page.waitForTimeout(150); assert.equal(requests.length, before + 1)
    await scan('resume').click(); await expect(scan('panel')).toHaveAttribute('data-state', 'ready_b')
    assert.equal(requests.slice(before).filter(entry => entry.kind === 'collect').length, 7)
    mode = 'hold'; const beforeB = requests.length
    await scan('start-b').evaluate(button => { button.click(); button.click() })
    await expect.poll(() => held.size).toBe(1); await scan('pause').click(); release(); mode = 'ok'
    await expect(scan('panel')).toHaveAttribute('data-state', 'paused')
    assert.equal(requests.length, beforeB + 1)
    await scan('finish-partial').click(); await expect(scan('panel')).toHaveAttribute('data-state', 'reviewing_partial')
    await expect(scan('connection-coverage')).toHaveAttribute('data-coverage', 'incomplete')
    await expect(cards()).toHaveCount(0)
    await scan('next-segment').click(); await expect(scan('panel')).toHaveAttribute('data-state', 'ready_b')
    await scan('start-b').click(); await expect(scan('panel')).toHaveAttribute('data-state', 'reviewing_complete_for_contract')
    const connections = requests.slice(beforeB).filter(entry => entry.kind === 'connect')
    const identities = connections.map(entry => sha(JSON.stringify(scanPayload(entry.body).sources.map(source => source.quote).sort())))
    assert.equal(new Set(identities).size, identities.length)
  })
  await step('05 Failure has no retry; explicit skip/partial coverage never claims complete', async () => {
    await seed(); await openLab(); await prepare(); mode = 'failure'; const before = requests.length
    await scan('start-a').click(); await expect(scan('panel')).toHaveAttribute('data-state', 'paused'); await page.waitForTimeout(150); assert.equal(requests.length, before + 1)
    mode = 'ok'; await scan('skip').click(); await expect(scan('source-coverage')).toHaveAttribute('data-coverage', 'incomplete')
    if (await scan('resume').count()) await scan('resume').click()
    await expect(scan('panel')).toHaveAttribute('data-state', 'ready_b'); await scan('start-b').click(); await expect(scan('panel')).toHaveAttribute('data-state', 'reviewing_partial')
    await expect(scan('miss-ledger')).not.toBeEmpty(); assert.equal(await readGraph(), null)
  })
  for (const change of ['cancel', 'source', 'disclosure', 'external-graph', 'navigation']) await step(`06 Ignored abort and late success cannot publish after ${change}`, async () => {
    await seed(); await openLab(); await prepare(); mode = 'hold'; ignoreAbort = true
    await page.evaluate(() => { window.__novelScanIgnoreAbort = true })
    const before = requests.length; await scan('start-a').click(); await expect.poll(() => held.size).toBe(1)
    if (change === 'cancel') await scan('cancel').click()
    else if (change === 'source') await mutateSource(1)
    else if (change === 'disclosure') { cutoff--; await memory('cutoff').selectOption(String(idFor(cutoff))) }
    else if (change === 'external-graph') await externalGraphChange()
    else {
      await page.goto(`${origin}/#/settings`)
      // Hash navigation resolving does not itself prove Vue has disposed Lab.
      await expect(scan('panel')).toHaveCount(0)
      await expect(page.getByRole('tab', { name: '数据管理', exact: true })).toBeVisible()
    }
    release(); mode = 'ok'; await page.waitForTimeout(200)
    if (change !== 'navigation') await expect(cards()).toHaveCount(0)
    assert.equal(requests.length, before + 1, 'Obsolete campaign must not continue after a late response')
    assert.ok(!(await readGraph())?.relations.length); ignoreAbort = false
    await page.evaluate(() => { window.__novelScanIgnoreAbort = false })
  })
  for (const change of ['source', 'external-graph']) await step(`07 Published unsaved candidates disappear immediately after ${change}`, async () => {
    await seed(); await openLab(); await runScan(); assert.ok(await cards().count() >= 2)
    if (change === 'source') await mutateSource(1); else await externalGraphChange()
    await expect(cards()).toHaveCount(0); await expect(scan('review')).toHaveCount(0)
  })
  await step('08 >512 B candidates pause, explicit review/ignore then same-campaign remainder without repeat or budget reset', async () => {
    await seed(capacityProfile, 64112); await openLab(); await prepare(900); const before = requests.length
    await scan('start-a').click(); await expect(scan('panel')).toHaveAttribute('data-state', 'ready_b', { timeout: 180_000 })
    await expect(scan('source-coverage')).toHaveAttribute('data-coverage', 'complete')
    await scan('start-b').click(); await expect(scan('panel')).toHaveAttribute('data-state', 'paused', { timeout: 180_000 }); await expect(scan('reason')).toContainText('审阅候选池已满')
    const used = Number(await scan('ledger').getAttribute('data-attempts')), previewText = await scan('preview').textContent()
    const campaign = previewText.match(/campaign\s+([^\s]+)/)?.[1]; assert.ok(campaign)
    await scan('finish-partial').click(); await expect(scan('panel')).toHaveAttribute('data-state', 'reviewing_partial')
    let ignored = 0
    while (await page.locator('[data-testid^="novel-scan-ignore-"]').count()) { await scan('ignore-0').click(); ignored++; assert.ok(ignored <= 512) }
    assert.ok(ignored >= 500, 'Pool must genuinely fill, not simulate capacity with a tiny fixture')
    assert.equal(requests.length - before, used, 'Review is transport-free')
    await scan('next-segment').click(); await expect(scan('panel')).toHaveAttribute('data-state', 'ready_b'); await expect(scan('preview')).toContainText(campaign)
    await expect(scan('ledger')).toHaveAttribute('data-attempts', String(used))
    await scan('start-b').click(); await expect(scan('panel')).toHaveAttribute('data-state', 'reviewing_complete_for_contract', { timeout: 180_000 })
    const b = requests.filter(entry => entry.profile === capacityProfile.id && entry.kind === 'connect')
    assert.equal(b.length, capacityProfile.expectedMinimumJobs)
    const fingerprints = b.map(entry => sha(JSON.stringify(scanPayload(entry.body).sources.map(source => source.quote).sort())))
    assert.equal(new Set(fingerprints).size, b.length, 'Every front B job executes once; remaining jobs really execute after review')
    assert.ok(Number(await scan('ledger').getAttribute('data-attempts')) > used)
    report.capacity = { aCalls: 180, bCalls: b.length, firstBatchIgnored: ignored, finalAttempts: Number(await scan('ledger').getAttribute('data-attempts')), campaignContinued: true }
  })
  await step('09 Long 600-chapter fixture: full disclosed 1,317,800-character A and all retained-cue B jobs', async () => {
    await seed(longProfile, 64111); await openLab(); await expect(memory('stats')).toContainText('600')
    const before = requests.length; await runScan(700)
    await expect(scan('source-coverage')).toHaveAttribute('data-eligible-chars', '1317800'); await expect(scan('source-coverage')).toHaveAttribute('data-processed-chars', '1317800')
    const a = requests.slice(before).filter(entry => entry.kind === 'collect'), b = requests.slice(before).filter(entry => entry.kind === 'connect')
    assert.equal(a.length, 599); assert.equal(a.reduce((sum, entry) => sum + entry.sourceChars, 0), 1_317_800)
    assert.equal(b.length, 9); await expect(cards()).toHaveCount(4)
    await saveAll(); const plotConfirmed = await confirmFirstPlot()
    const relationId = plotConfirmed.relations[0].id, beforeConfirmCalls = requests.length
    await page.getByTestId('fact-graph-relation-0').click(); await page.getByTestId('fact-graph-confirm').click()
    await expect(page.getByTestId('fact-graph-confirm')).toHaveText('已由作者确认')
    await expect(page.getByTestId('fact-graph-notice')).toHaveText('作者确认已保存，原始来源类型保留。')
    const confirmed = await readGraph()
    assert.equal(confirmed.relations.find(item => item.id === relationId)?.authorConfirmed, true)
    assert.equal(confirmed.plotLinks.find(item => item.id === plotConfirmed.plotLinks[0].id)?.authorConfirmed, true)
    assert.notEqual(confirmed.revision, plotConfirmed.revision)
    assert.equal(requests.length, beforeConfirmCalls, 'Relation confirmation is transport-free')
    report.longForm.scan = { aCalls: a.length, bCalls: b.length, aSourceCharsSent: a.reduce((sum, entry) => sum + entry.sourceChars, 0), bSourceCharsSent: b.reduce((sum, entry) => sum + entry.sourceChars, 0), actualInputChars: [...a, ...b].reduce((sum, entry) => sum + entry.inputChars, 0), actualInputBytes: [...a, ...b].reduce((sum, entry) => sum + entry.inputBytes, 0) }
  })
  for (const kind of ['continue', 'polish', 'chapter']) await step(`10 Long Writer ${kind}: plot never auto-enters, relation needs selection+approval, old/future excluded`, async () => {
    await openWriter(kind); await searchWriter()
    await expect(dialog.locator('input[data-testid^="writer-memory-select-"]:checked')).toHaveCount(0)
    await expect(wm('approve')).toBeDisabled(); await expect(wm('result')).not.toContainText(PLOT_EXPLANATION_CANARY)
    const saved = await readGraph()
    assert.equal(saved.relations.length, 1)
    const persisted = saved.relations[0], originalAnchor = persisted.evidence[0]
    assert.equal(persisted.predicate, '委托阿宁照看渡口药铺')
    assert.equal(persisted.authorConfirmed, true)
    assert.equal(persisted.evidence.length, 1)
    // The Writer bridge intentionally does not promote an annotation paraphrase
    // into a source fact. Locate the actual indexed card, then verify every field.
    const relation = wm('relation-0')
    const assertSafeRelation = async () => {
      await expect(dialog.locator('[data-testid^="writer-memory-relation-"]')).toHaveCount(1)
      await expect(relation.locator(':scope > h5')).toHaveText('沈砚 → 阿宁')
      await expect(relation.locator(':scope > p').first()).toHaveText('原文关联')
      await expect(relation.getByTestId('writer-memory-provenance')).toHaveText('作者确认 · 原文明示 · 模型提议')
      await expect(relation.getByTestId('writer-memory-quote')).toHaveText(originalAnchor.quote)
      await expect(relation.getByTestId('writer-memory-revision')).toHaveText(originalAnchor.sourceRevision)
      await expect(relation.locator('.anchor h5')).toHaveText(`第 587 章 · ${current.chapters[586].title}`)
      await expect(relation.locator('.anchor dd').last()).toHaveText(`${originalAnchor.start}–${originalAnchor.end}`)
      await expect(relation).not.toContainText(persisted.predicate)
    }
    await assertSafeRelation(); await relation.locator('input[type="checkbox"]').check()
    await expect(wm('approved')).toHaveCount(0); await approveWriter()
    // Cutoff excludes the relation's source and clears approval, independently in each mode.
    await wm('cutoff').selectOption(String(idFor(586))); await expect(wm('approved')).toHaveCount(0); await searchWriter(586)
    await expect(dialog.locator('[data-testid^="writer-memory-relation-"]')).toHaveCount(0)
    await searchWriter(599); await assertSafeRelation(); await relation.locator('input[type="checkbox"]').check(); await approveWriter()
    const before = writingRequests().length
    await dialog.getByRole('button', { name: kind === 'chapter' ? '开始生成' : kind === 'continue' ? '开始续写' : '开始润色', exact: true }).click()
    await expect.poll(() => writingRequests().length).toBe(before + 1)
    const sent = writingRequests()[before], envelope = writerEnvelope(sent.body)
    assert.equal(envelope.relations.length, 1); assert.equal(envelope.relations[0].source.label, '沈砚'); assert.equal(envelope.relations[0].target.label, '阿宁')
    assert.equal(envelope.relations[0].id, persisted.id)
    assert.equal(envelope.relations[0].predicate, '原文关联')
    assert.equal(envelope.relations[0].origin, 'explicit'); assert.equal(envelope.relations[0].createdBy, 'model'); assert.equal(envelope.relations[0].authorConfirmed, true)
    assert.ok(!JSON.stringify(sent.body.messages).includes(persisted.predicate), 'The model annotation paraphrase must not enter Writer')
    assert.deepEqual(await readGraph(), saved, 'Writer selection and approval never rewrite the saved annotation')
    assert.equal(envelope.plotLinks, undefined)
    assert.equal(envelope.relations[0].evidence.length, 1)
    const anchor = envelope.relations[0].evidence[0], original = current.chapters[586]
    assert.equal(anchor.chapterId, original.id); assert.equal(anchor.ordinal, 587)
    assert.equal(anchor.sourceRevision, sha(JSON.stringify([original.title, original.text])))
    assert.equal(anchor.quote, original.text.slice(anchor.start, anchor.end))
    assert.deepEqual({ chapterId: anchor.chapterId, sourceRevision: anchor.sourceRevision, start: anchor.start, end: anchor.end, quote: anchor.quote }, originalAnchor)
    assert.ok(!JSON.stringify(sent.body.messages).includes(PLOT_EXPLANATION_CANARY) && !JSON.stringify(sent.body.messages).includes(LONG_FUTURE_CANARY))
    assert.ok(envelope.sources.every(source => source.ordinal <= 599))
    report.longForm.journeys.push({ entry: kind, writingCalls: 1, selectedRelations: envelope.relations.length, sourceCount: envelope.sources.length, relationEvidenceCount: envelope.relations[0].evidence.length, relationEvidenceChars: anchor.quote.length, plotLinksSent: 0, futureSent: false })
    if (kind === 'chapter') {
      await expect(dialog).toBeHidden(); await expect(page.locator('.editor-panel [contenteditable="true"]')).toContainText(completion)
      await expect(page.getByText('正文生成成功', { exact: true })).toBeVisible()
      await expect(page.locator('.saving-indicator')).toHaveCount(0)
      assert.ok((await readCommittedChapter(599))?.includes(completion), 'The generated target chapter must actually be committed before restoring the next fixture')
    }
    else { await expect(dialog.locator('.result-content')).toContainText(completion); await closeWriter() }
  })
  await step('11 Old chapter revision removes relation and plot from every Writer mode', async () => {
    // Prepare this independent scenario outside the previous live Writer, preserving
    // its committed result until the explicit fixture restore below. Live mutation
    // invalidation remains covered without reload by scenarios 06 and 07.
    const saved = await readGraph()
    await page.goto(`${origin}/__novel_scan_seed`)
    await mutateSource(599, { restore: true }); await mutateSource(587); await mutateSource(588)
    for (const kind of ['continue', 'polish', 'chapter']) {
      await openWriter(kind); await searchWriter(); await expect(dialog.locator('[data-testid^="writer-memory-relation-"]')).toHaveCount(0)
      await expect(wm('result')).not.toContainText(PLOT_EXPLANATION_CANARY); await expect(wm('approved')).toHaveCount(0); await closeWriter()
    }
    await openLab(); await expect(plot('empty')).toBeVisible(); await expect(plot('refresh')).toBeEnabled()
    await expect(plot('error')).toHaveCount(0); await expect(page.locator('[data-testid^="plot-links-item-"]')).toHaveCount(0)
    assert.deepEqual(await readGraph(), saved, 'Stale source filtering must retain, not delete, the original relation and plot annotations')
  })
  await step('12 Mobile 390px: real review premises and 44px cancel stay within viewport', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await seed(); await openLab(); await prepare(); mode = 'hold'
    await scan('start-a').click(); await expect.poll(() => held.size).toBe(1); await scan('cancel').scrollIntoViewIfNeeded()
    const box = await scan('cancel').boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= 391 && box.height >= 44)
    await scan('cancel').click(); release(); mode = 'ok'; await expect(cards()).toHaveCount(0)
    await seed(); await openLab(); await runScan(); const bridge = cards().filter({ hasText: gold('P06').gold.candidate.title })
    await bridge.scrollIntoViewIfNeeded(); const bounds = await bridge.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391)
    await expect(bridge.getByTestId('novel-scan-premise')).toHaveCount(3); await takeScreenshot('mobile-three-premise-review')
  })
  assert.deepEqual(report.fixtureErrors, []); assert.deepEqual(report.browserErrors, []); assert.deepEqual(report.blockedRequests, [])
  assert.equal(ignoreAbort, false)
  assert.deepEqual(report.longForm.journeys.map(item => item.entry), ['continue', 'polish', 'chapter'])
  assert.equal(report.tests.length, 20, 'Every declared built-app scenario must execute without skipping')
  assert.equal(writingRequests().length, 3)
  assert.equal(requests.filter(entry => entry.kind === 'collect').length, 834)
  assert.equal(requests.filter(entry => entry.kind === 'connect').length, 667)
  assert.equal(scanRequests().length, 1501)
  assert.equal(scanRequests().reduce((sum, entry) => sum + entry.sourceChars, 0), 1_388_842)
  assert.equal(scanRequests().reduce((sum, entry) => sum + entry.sourceCount, 0), 3_354)
  assert.equal(scanRequests().reduce((sum, entry) => sum + entry.candidateCount, 0), 568)
  console.log(`PASS ${report.tests.length} novel candidate built-app journeys; 1,317,800 disclosed source characters; no live model`)
} catch (error) {
  report.error = String(error.stack || error); console.error(report.error); process.exitCode = 1
  report.diagnostics = { url: page?.url(), text: await page?.locator('body').innerText({ timeout: 3000 }).catch(() => '') }
} finally {
  release(); report.finishedAt = new Date().toISOString()
  report.requests = requests
  report.expected = { tests: 20, aCalls: 834, bCalls: 667, scanCalls: 1501, writingCalls: 3, scanSourceCharsSent: 1_388_842, scanSourceSpansSent: 3_354, controlledCandidateProposals: 568, longA: 599, longB: 9, longWriterRelationEvidenceAnchors: 3 }
  report.totals = { tests: report.tests.length, passed: report.tests.filter(item => item.status === 'passed').length, writingCalls: writingRequests().length,
    scanCalls: scanRequests().length, sourceCharsSent: scanRequests().reduce((sum, entry) => sum + entry.sourceChars, 0), inputChars: scanRequests().reduce((sum, entry) => sum + entry.inputChars, 0), inputBytes: scanRequests().reduce((sum, entry) => sum + entry.inputBytes, 0), unmockedRequests: report.blockedRequests.length }
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  await context?.tracing.stop({ path: path.join(artifacts, 'trace.zip') }).catch(() => {})
  await browser?.close()
  for (const server of [provider, preview]) if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}
