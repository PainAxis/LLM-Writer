/**
 * Real Chromium acceptance of the built fact graph and its source evidence.
 * Only the initial novel/API settings are seeded. Relationships, review, source
 * edits, and disclosure changes use the actual UI. The local provider response
 * is deliberately synthetic: this tests source gates, not extraction quality.
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium, expect as playwrightExpect } from '@playwright/test'
import { startPreviewServer } from './browser-preview.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = path.join(root, 'artifacts/browser-memory-fact-graph')
await mkdir(artifacts, { recursive: true })
const server = await startPreviewServer({ port: 0, sha: process.env.GITHUB_SHA || 'local' })
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true }).catch(error => {
  server.closeAllConnections()
  server.close()
  throw error
})
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, locale: 'zh-CN' })
await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
const expect = playwrightExpect.configure({ timeout: 15_000 })
const errors = []
const blockedRequests = []
const requests = []
const heldResponses = new Set()
let providerPlan = { mode: 'valid', output: { relations: [] } }
const report = {
  startedAt: new Date().toISOString(),
  fixture: 'Synthetic author manuscript and model response; no external or paid services',
  tests: [], screenshots: [],
}
context.on('page', target => {
  target.setDefaultTimeout(15_000)
  target.on('pageerror', error => errors.push(String(error.stack || error)))
})
await context.route('**/*', async route => {
  const request = route.request()
  const url = new URL(request.url())
  if (url.origin === origin && url.pathname === '/__test/fact/v1/chat/completions') {
    const plan = structuredClone(providerPlan)
    const entry = { body: request.postDataJSON(), mode: plan.mode, status: 'pending' }
    requests.push(entry)
    const send = async () => {
      heldResponses.delete(send)
      try {
        if (plan.mode === 'error') {
          await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Synthetic provider failure' } }) })
          entry.status = 401
          return
        }
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            id: 'fact-graph-fixture-completion', created: 1, model: entry.body.model,
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: typeof plan.output === 'string' ? plan.output : JSON.stringify(plan.output) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 40, completion_tokens: 30, total_tokens: 70 },
          }),
        })
        entry.status = 200
      } catch {
        // Source/cutoff invalidation is expected to abort an in-flight request.
        entry.status = 'aborted'
      }
    }
    if (plan.mode === 'hold') heldResponses.add(send)
    else await send()
    return
  }
  if (['data:', 'blob:'].includes(url.protocol) || url.origin === origin) return route.continue()
  blockedRequests.push(`${url.origin}${url.pathname}`)
  return route.abort('blockedbyclient')
})

const novelId = 39201
const chapterId = 39202
const initialNovelText = '青岚在旧仓库发现一张航海图，约定明日把航海图交给船长。'
const revisedNovelText = '青岚在旧仓库发现一本潮汐册，约定明日把潮汐册交给船长。'
const timestamp = '2026-10-04T00:00:00.000Z'
const fixtureNovel = {
  id: novelId, title: '事实图谱业务验收作品', genre: 'fantasy',
  description: 'Synthetic author source for read-only memory acceptance.', tags: [], status: 'writing',
  createdAt: timestamp, updatedAt: timestamp,
  chapters: 1, wordCount: initialNovelText.length, totalWords: initialNovelText.length,
  characters: [], worldSettings: [], events: [], corpusData: [],
  chapterList: [{ id: chapterId, title: '第一章：仓库', content: `<p>${initialNovelText}</p>`, status: 'draft', tags: [], wordCount: initialNovelText.length, createdAt: timestamp, updatedAt: timestamp }],
}
const emptyNovel = { ...fixtureNovel, id: 39203, title: '尚无章节的图谱作品', chapters: 0, wordCount: 0, totalWords: 0, chapterList: [] }
await context.addInitScript(({ novels, fixtureOrigin }) => {
  if (location.origin !== fixtureOrigin) return
  if (localStorage.getItem('novels') === null) localStorage.setItem('novels', JSON.stringify(novels))
  if (localStorage.getItem('apiConfig') === null) localStorage.setItem('apiConfig', JSON.stringify({
    apiKey: 'synthetic-fact-graph-key', baseURL: `${fixtureOrigin}/__test/fact/v1`,
    provider: 'custom', selectedModel: 'fact-graph-fixture', maxTokens: 2048,
    unlimitedTokens: false, temperature: 0, thinkingProtocol: 'auto', thinkingMode: 'default', customHeaders: {},
  }))
}, { novels: [fixtureNovel, emptyNovel], fixtureOrigin: origin })

const page = await context.newPage()
const memory = id => page.getByTestId(`memory-${id}`)
const graph = id => page.getByTestId(`fact-graph-${id}`)
const relations = () => page.locator('[data-testid^="fact-graph-relation-"]')
const proposals = () => page.locator('[data-testid^="fact-graph-proposal-"]')
const readNovels = () => page.evaluate(() => localStorage.getItem('novels'))
const requestText = request => JSON.stringify(request.body.messages)
let originalNovels
let originalRevision

function modelRelation(predicate = '可能准备交付') {
  return { relations: [{
    source: { type: 'person', label: '青岚' }, target: { type: 'object', label: '航海图' },
    predicate, origin: 'inferred', evidence: [1],
  }] }
}

function assertSourcePayload(entry, expectedQuotes) {
  assert.ok(entry, 'The model request must be observed at the actual provider boundary')
  const messages = entry.body.messages
  assert.ok(Array.isArray(messages), 'The actual provider payload must contain messages')
  const user = messages.find(message => message.role === 'user')
  assert.equal(typeof user?.content, 'string')
  const prefix = 'SOURCE_EXCERPTS_JSON\n'
  assert.ok(user.content.startsWith(prefix), 'The extraction payload must contain only the explicit source envelope')
  const parsed = JSON.parse(user.content.slice(prefix.length))
  assert.deepEqual(parsed, { sources: expectedQuotes.map((quote, index) => ({ reference: index + 1, quote })) })
  assert.equal(entry.body.tools, undefined, 'Fact extraction must not use Agent/tool execution')
  assert.equal(requestText(entry).includes('事实图谱业务验收作品'), false, 'The project title is not selected source evidence')
}

async function step(name, run) {
  const entry = { name, status: 'running' }
  report.tests.push(entry)
  const started = Date.now()
  console.log(`START ${name}`)
  try {
    await run()
    entry.status = 'passed'
    console.log(`PASS  ${name}`)
  } catch (error) {
    entry.status = 'failed'
    entry.error = String(error.stack || error)
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {})
    throw error
  } finally {
    entry.durationMs = Date.now() - started
  }
}

async function dismissAnnouncement(target = page) {
  const button = target.getByRole('button', { name: '我知道了', exact: true })
  try { await button.waitFor({ state: 'visible', timeout: 2200 }) } catch { return }
  await button.click()
}

async function screenshot(name) {
  const filename = `${name}.png`
  await page.screenshot({ path: path.join(artifacts, filename), fullPage: true })
  report.screenshots.push(filename)
}

async function search(query) {
  await memory('query').fill(query)
  await expect(memory('search')).toBeEnabled()
  await memory('search').click()
  await expect(memory('search')).toBeEnabled()
}

async function chooseRelation(text) {
  await graph('query').fill(text)
  const button = relations().filter({ hasText: text }).first()
  await expect(button).toBeVisible()
  await button.focus()
  await button.press('Enter')
  await expect(graph('evidence')).toBeVisible()
  return button
}

async function releaseResponses() {
  await Promise.all([...heldResponses].map(send => send()))
}

async function selectSource(sourceId) {
  await memory('source').selectOption(sourceId)
  await expect(memory('search')).toBeEnabled()
  await expect(graph('canvas')).toBeVisible()
}

async function selectCutoff(chapter) {
  await memory('cutoff').selectOption(chapter)
  await expect(memory('cutoff')).toHaveValue(chapter)
  await expect(graph('query')).toBeVisible()
}

async function prepareAnchors(chapter, quote) {
  await graph('create').click()
  await graph('chapter').selectOption(chapter)
  await graph('quote-input').fill(quote)
  await graph('add-evidence').click()
  await expect(graph('anchors')).toContainText(quote)
}

async function fillRelation({ source = '青岚', sourceType = 'person', target = '航海图', targetType = 'object', predicate = '发现' } = {}) {
  await graph('source-label').fill(source)
  await graph('source-type').selectOption(sourceType)
  await graph('target-label').fill(target)
  await graph('target-type').selectOption(targetType)
  await graph('predicate').fill(predicate)
}

async function runExtraction(plan) {
  providerPlan = plan
  const before = requests.length
  await graph('extract').click()
  await expect.poll(() => requests.length).toBe(before + 1)
  if (plan.mode !== 'hold') await expect(graph('extract')).toBeEnabled()
  return requests[before]
}

// Business scenarios are below; every assertion observes the built UI or its
// actual outbound request. No production globals or graph internals are read.

try {
  await step('01 Click a real Cytoscape edge and inspect its exact source revision', async () => {
    await page.goto(`${origin}/#/memory`)
    await dismissAnnouncement()
    await expect(memory('search')).toBeEnabled()
    await expect(graph('canvas')).toBeVisible()
    originalNovels = await readNovels()
    await graph('query').fill('受托保管')
    await expect(relations()).toHaveCount(1)
    await expect(graph('canvas').locator('canvas').first()).toBeVisible()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    // A graph with a single edge fits its two endpoints symmetrically. Clicking
    // the rendered midpoint exercises Cytoscape's genuine tap handler.
    await graph('canvas').scrollIntoViewIfNeeded()
    const box = await graph('canvas').boundingBox()
    assert.ok(box && box.width > 0 && box.height > 0)
    // Node labels sit below their shapes; fitting their bounding boxes can move
    // the edge slightly above the visual center. Try a small visible midpoint
    // band, using actual pointer taps rather than reading Cytoscape internals.
    for (const offsetY of [0, -8, -16, -24, 8, 16, 24]) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + offsetY)
      if (await graph('canvas').getAttribute('data-selected-relation')) break
    }
    await expect(graph('evidence')).toContainText('受托保管')
    await expect(graph('evidence')).toContainText('原文明示')
    await expect(graph('evidence')).toContainText('第 1 章')
    await expect(graph('quote').first()).toHaveText('顾行将银钥匙交给沈砚，嘱咐他保管到天亮。')
    originalRevision = await graph('revision').first().textContent()
    assert.match(originalRevision, /^[a-f0-9]{64}$/)
    await screenshot('source-edge-light')
  })

  await step('02 Find a distant planted clue and inspect both premises of an inference', async () => {
    await selectCutoff('c40')
    await chooseRelation('三声铃响指向接应地点')
    await expect(graph('evidence')).toContainText('作者确认')
    await expect(graph('evidence')).toContainText('第 2 章')
    await expect(graph('quote').first()).toHaveText('沈砚把一枚缺角的铜铃系在窗边，嘱咐阿宁听见三声铃响就去西渡口。')
    await chooseRelation('可能用于重逢时接应')
    await expect(graph('evidence')).toContainText('模型推断')
    await expect(graph('quote')).toHaveCount(2)
    await expect(graph('evidence')).toContainText('第 2 章')
    await expect(graph('evidence')).toContainText('第 40 章')
    await selectCutoff('c10')
    await expect(relations()).toHaveCount(0)
    await expect(graph('evidence')).not.toContainText('可能用于重逢时接应')
    await graph('query').fill('三声铃响指向接应地点')
    await expect(relations()).toHaveCount(1)
  })

  await step('03 Confirm an explicit relation and retain its evidence after reload', async () => {
    await chooseRelation('受托保管')
    await graph('confirm').click()
    await expect(graph('evidence')).toContainText('作者确认')
    await page.reload()
    await dismissAnnouncement()
    await expect(memory('search')).toBeEnabled()
    await chooseRelation('受托保管')
    await expect(graph('evidence')).toContainText('作者确认')
    await expect(graph('evidence')).toContainText('原文明示')
    await expect(graph('revision').first()).toHaveText(originalRevision)
    assert.equal(await readNovels(), originalNovels, 'A graph confirmation must not rewrite the novel collection')
  })

  await step('04 Editing an old chapter removes even an author-confirmed superseded relation', async () => {
    await memory('edit-chapter').selectOption('c1')
    const oldText = await memory('chapter-editor').inputValue()
    assert.ok(oldText.includes('银钥匙'))
    await memory('chapter-editor').fill(oldText.replaceAll('银钥匙', '铜钥匙'))
    await expect(relations()).toHaveCount(0)
    await expect(graph('evidence')).toHaveCount(0)
    await memory('save-demo').click()
    await expect(memory('search')).toBeEnabled()
    await graph('query').fill('受托保管')
    await expect(relations()).toHaveCount(0)
    await search('铜钥匙')
    await page.getByTestId('memory-result-0').click()
    await expect(memory('evidence-quote')).toContainText('铜钥匙')
    const currentRevision = await memory('evidence-revision').textContent()
    assert.match(currentRevision, /^[a-f0-9]{64}$/)
    assert.notEqual(currentRevision, originalRevision)
    await page.reload()
    await dismissAnnouncement()
    await expect(memory('search')).toBeEnabled()
    await graph('query').fill('银钥匙')
    await expect(relations()).toHaveCount(0)
    assert.equal(await readNovels(), originalNovels, 'Editing the private graph demo must not change saved author novels')
  })

  await step('05 Reveal a future identity only at its chapter and remove it immediately on rollback', async () => {
    await selectCutoff('c10')
    await graph('query').fill('真名是')
    await expect(relations()).toHaveCount(0)
    await expect(graph('list')).not.toContainText('玄衣客')
    await selectCutoff('c80')
    await chooseRelation('真名是')
    await expect(graph('quote').first()).toContainText('玄衣客的真名是顾行')
    await expect(graph('evidence')).toContainText('第 80 章')
    await screenshot('future-identity-disclosed')
    await selectCutoff('c10')
    await expect(relations()).toHaveCount(0)
    await expect(graph('evidence')).not.toContainText('玄衣客')
    await expect(graph('list')).not.toContainText('玄衣客')
    await expect(graph('canvas')).not.toHaveAttribute('aria-label', /玄衣客/)
    await expect(graph('canvas')).toHaveAttribute('data-edge-count', '0')
  })

  await step('06 Create, edit, confirm, and delete author annotations without rewriting a real novel', async () => {
    await selectSource(`novel:${novelId}`)
    await graph('query').fill('')
    await expect(relations()).toHaveCount(0)
    await prepareAnchors(String(chapterId), initialNovelText)
    await fillRelation()
    await graph('save').click()
    await expect(graph('form')).toHaveCount(0)
    await chooseRelation('发现')
    await expect(graph('quote').first()).toHaveText(initialNovelText)
    await graph('edit').click()
    await graph('predicate').fill('在仓库发现')
    await graph('save').click()
    await expect(graph('form')).toHaveCount(0)
    await chooseRelation('在仓库发现')
    await graph('confirm').click()
    await expect(graph('evidence')).toContainText('作者确认')

    await prepareAnchors(String(chapterId), initialNovelText)
    await fillRelation({ target: '旧仓库', targetType: 'place', predicate: '临时地点标注' })
    await graph('save').click()
    await expect(graph('form')).toHaveCount(0)
    await chooseRelation('临时地点标注')
    await graph('delete').click()
    await expect(relations()).toHaveCount(0)
    await chooseRelation('在仓库发现')
    await expect(graph('evidence')).toContainText('作者确认')
    assert.equal(await readNovels(), originalNovels, 'Graph CRUD must not mutate saved prose or novel metadata')
  })

  await step('07 Extract from an explicitly selected search quote, review, and confirm an inference', async () => {
    await search('航海图')
    await page.getByTestId('memory-result-0').click()
    await expect(memory('evidence-quote')).toHaveText(initialNovelText)
    await graph('use-evidence').click()
    await expect(graph('anchors')).toContainText(initialNovelText)
    const entry = await runExtraction({ mode: 'valid', output: modelRelation() })
    assertSourcePayload(entry, [initialNovelText])
    assert.equal(requestText(entry).includes('玄衣客'), false, 'Unselected future story facts must not enter an extraction request')
    await expect(proposals()).toHaveCount(1)
    await expect(proposals().first()).toContainText('模型推断')
    await graph('query').fill('可能准备交付')
    await expect(relations()).toHaveCount(0)
    await graph('accept-0').click()
    await expect(proposals()).toHaveCount(0)
    await chooseRelation('可能准备交付')
    await expect(graph('evidence')).toContainText('模型推断')
    await expect(graph('quote').first()).toHaveText(initialNovelText)
    await graph('confirm').click()
    await expect(graph('evidence')).toContainText('作者确认')
    await expect(graph('evidence')).toContainText('模型推断')
    await page.reload()
    await dismissAnnouncement()
    await expect(memory('search')).toBeEnabled()
    await selectSource(`novel:${novelId}`)
    await chooseRelation('可能准备交付')
    await expect(graph('evidence')).toContainText('作者确认')
    await expect(graph('evidence')).toContainText('模型推断')
    assert.equal(await readNovels(), originalNovels)
  })

  await step('08 Reject malformed responses and invented source references without saving relationships', async () => {
    await graph('query').fill('')
    await expect(relations()).toHaveCount(2)
    await prepareAnchors(String(chapterId), initialNovelText)
    const malformed = await runExtraction({ mode: 'valid', output: '{"relations":' })
    assertSourcePayload(malformed, [initialNovelText])
    await expect(graph('error')).toContainText('失败')
    await expect(proposals()).toHaveCount(0)
    await expect(relations()).toHaveCount(2)
    const invalid = modelRelation('不可核对的提议')
    invalid.relations[0].evidence = [99]
    const badReference = await runExtraction({ mode: 'valid', output: invalid })
    assertSourcePayload(badReference, [initialNovelText])
    await expect(graph('error')).toContainText('失败')
    await expect(proposals()).toHaveCount(0)
    await expect(relations()).toHaveCount(2)
  })

  await step('09 Keep source-backed author work intact when the provider refuses a request', async () => {
    const entry = await runExtraction({ mode: 'error', output: null })
    assertSourcePayload(entry, [initialNovelText])
    await expect(graph('error')).toContainText('失败')
    await expect(graph('error')).not.toContainText('synthetic-fact-graph-key')
    await expect(proposals()).toHaveCount(0)
    await expect(relations()).toHaveCount(2)
    await chooseRelation('在仓库发现')
    await expect(graph('evidence')).toContainText('作者确认')
  })

  await step('10 A disclosure rollback cancels a delayed future-source extraction', async () => {
    await selectSource('memory-demo')
    await selectCutoff('c80')
    const futureQuote = '玄衣客摘下面具：玄衣客的真名是顾行。'
    await prepareAnchors('c80', futureQuote)
    const output = { relations: [{ source: { type: 'person', label: '玄衣客' }, target: { type: 'person', label: '顾行' }, predicate: '延迟身份提议', origin: 'explicit', evidence: [1] }] }
    const entry = await runExtraction({ mode: 'hold', output })
    assertSourcePayload(entry, [futureQuote])
    await expect(graph('cancel-extract')).toBeVisible()
    await selectCutoff('c10')
    await releaseResponses()
    await expect(graph('cancel-extract')).toHaveCount(0)
    await expect(proposals()).toHaveCount(0)
    await expect(graph('form')).toHaveCount(0)
    await graph('query').fill('延迟身份提议')
    await expect(relations()).toHaveCount(0)
    await expect(graph('evidence')).not.toContainText('玄衣客')
    await expect(graph('list')).not.toContainText('玄衣客')
    await selectCutoff('c80')
    await graph('query').fill('延迟身份提议')
    await expect(relations()).toHaveCount(0)
  })

  await step('11 A Writer edit invalidates confirmed facts and a delayed model response from the old revision', async () => {
    await selectSource(`novel:${novelId}`)
    await prepareAnchors(String(chapterId), initialNovelText)
    const entry = await runExtraction({ mode: 'hold', output: modelRelation('过期航海图提议') })
    assertSourcePayload(entry, [initialNovelText])
    const writer = await context.newPage()
    try {
      await writer.goto(`${origin}/#/writer?novelId=${novelId}`)
      await dismissAnnouncement(writer)
      const editor = writer.locator('.editor-panel [contenteditable="true"]')
      await expect(editor).toContainText(initialNovelText)
      await editor.fill(revisedNovelText)
      await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem('novels') || '[]')
        .find(novel => novel.id === id)?.chapterList?.[0]?.content || '', novelId), { timeout: 20_000 }).toContain(revisedNovelText)
      await expect(writer.locator('.saving-indicator')).toHaveCount(0)
      await page.bringToFront()
      await expect(graph('unavailable')).toBeVisible()
      await expect(relations()).toHaveCount(0)
      await expect(graph('evidence')).toHaveCount(0)
      await releaseResponses()
      const committed = await readNovels()
      await memory('refresh').click()
      await expect(memory('search')).toBeEnabled()
      await expect(graph('query')).toBeVisible()
      await graph('query').fill('')
      await expect(relations()).toHaveCount(0)
      await expect(proposals()).toHaveCount(0)
      await expect(graph('evidence')).not.toContainText('航海图')
      await search('潮汐册')
      await page.getByTestId('memory-result-0').click()
      await expect(memory('evidence-quote')).toHaveText(revisedNovelText)
      assert.equal(await readNovels(), committed, 'Graph source refresh must preserve the Writer commit')
    } finally {
      await writer.close()
    }
  })

  await step('12 Selecting a novel without chapters leaves a usable, empty graph state', async () => {
    await memory('source').selectOption(`novel:${emptyNovel.id}`)
    await expect(memory('refresh')).toBeEnabled()
    await expect(memory('cutoff').locator('option')).toHaveCount(0)
    await expect(graph('panel')).toBeVisible()
    await expect(graph('unavailable')).toContainText('尚无可绘制')
    await expect(graph('create')).toBeDisabled()
    await expect(relations()).toHaveCount(0)
    await expect(memory('error')).toHaveCount(0)
    assert.deepEqual(errors, [], 'An empty saved novel must not throw during graph rendering')
  })

  await step('13 Retain independent demo clues with usable dark and narrow-screen graph evidence', async () => {
    await selectSource('memory-demo')
    await selectCutoff('c40')
    await chooseRelation('可能用于重逢时接应')
    await expect(graph('quote')).toHaveCount(2)
    await graph('query').fill('铜铃')
    await relations().filter({ hasText: '三声铃响指向接应地点' }).first().click()
    const toggle = page.locator('.theme-toggle')
    for (let i = 0; i < 3 && await toggle.getAttribute('aria-label') !== '当前：暗色模式（点击切换）'; i++) await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', '当前：暗色模式（点击切换）')
    await screenshot('clue-graph-dark')
    await page.setViewportSize({ width: 390, height: 844 })
    await graph('evidence').scrollIntoViewIfNeeded()
    await screenshot('clue-graph-mobile')
    report.mobileLayout = await page.evaluate(() => ({ viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth }))
    assert.ok(report.mobileLayout.documentWidth <= report.mobileLayout.viewportWidth + 1, 'Graph evidence must not force horizontal page overflow')
    assert.deepEqual(errors, [], 'No uncaught browser errors may occur')
    assert.equal(requests.length, 6, 'Only explicitly requested synthetic model extractions may run')
    assert.deepEqual(blockedRequests, [], 'No unplanned external request may be attempted')
  })
  console.log(`PASS ${report.tests.length} fact graph browser scenarios`)
} catch (error) {
  report.error = String(error.stack || error)
  report.diagnostics = { url: page.url(), bodyText: await page.locator('body').innerText({ timeout: 5000 }).catch(() => '') }
  console.error(report.error)
  process.exitCode = 1
} finally {
  await releaseResponses()
  report.finishedAt = new Date().toISOString()
  report.browserErrors = errors
  report.blockedRequests = blockedRequests
  report.modelRequests = requests
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  await context.tracing.stop({ path: path.join(artifacts, 'trace.zip') })
  await browser.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
