/**
 * Focused acceptance of the actual built Memory Lab in real Chromium.
 * The single initial novel is a synthetic fixture. All subsequent edits use UI;
 * storage reads only verify that committed author content is retained.
 * Run npm run build first. No model, embeddings, reranker, or external API is used.
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium, expect as playwrightExpect } from '@playwright/test'
import { startPreviewServer } from './browser-preview.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = path.join(root, 'artifacts/browser-memory')
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
const apiRequests = []
const report = { startedAt: new Date().toISOString(), tests: [], screenshots: [] }
context.on('page', target => {
  target.setDefaultTimeout(15_000)
  target.on('pageerror', error => errors.push(String(error.stack || error)))
})
await context.route('**/*', route => {
  const url = new URL(route.request().url())
  if (url.pathname.startsWith('/__test/v1/')) apiRequests.push(url.pathname)
  if (['data:', 'blob:'].includes(url.protocol) || url.origin === origin) return route.continue()
  blockedRequests.push(route.request().url())
  return route.abort('blockedbyclient')
})

const novelId = 39001
const chapterId = 39002
const initialNovelText = '青岚在旧仓库发现一张航海图，约定明日把航海图交给船长。'
const revisedNovelText = '青岚在旧仓库发现一本潮汐册，约定明日把潮汐册交给船长。'
const timestamp = '2026-10-03T00:00:00.000Z'
const fixtureNovel = {
  id: novelId, title: '记忆原型只读验收作品', genre: 'fantasy',
  description: '浏览器合成验收素材，无用户原稿。', tags: [],
  status: 'writing', createdAt: timestamp, updatedAt: timestamp,
  chapters: 1, wordCount: initialNovelText.length, totalWords: initialNovelText.length,
  characters: [], worldSettings: [], events: [], corpusData: [],
  chapterList: [{
    id: chapterId, title: '第一章：仓库', content: initialNovelText,
    status: 'draft', tags: [], wordCount: initialNovelText.length,
    createdAt: timestamp, updatedAt: timestamp,
  }],
}
// Seed once before the first app load; reloads and Writer edits must never reseed.
await context.addInitScript(({ novel, fixtureOrigin }) => {
  if (location.origin !== fixtureOrigin) return
  if (localStorage.getItem('novels') === null) localStorage.setItem('novels', JSON.stringify([novel]))
}, { novel: fixtureNovel, fixtureOrigin: origin })
const page = await context.newPage()
const control = id => page.getByTestId(`memory-${id}`)
const results = () => page.locator('[data-testid^="memory-result-"]')
const readNovels = () => page.evaluate(() => localStorage.getItem('novels'))
let originalNovels
let originalDemoRevision

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

async function search(query) {
  await control('query').fill(query)
  await expect(control('search')).toBeEnabled()
  await control('search').click()
  await expect(control('search')).toBeEnabled()
}

async function screenshot(name) {
  const filename = `${name}.png`
  await page.screenshot({ path: path.join(artifacts, filename), fullPage: true })
  report.screenshots.push(filename)
}

try {
  await step('01 Enter the 80-chapter Memory Lab through the real app menu', async () => {
    await page.goto(`${origin}/#/`)
    await dismissAnnouncement()
    originalNovels = await readNovels()
    await page.getByRole('menuitem', { name: /记忆/ }).click()
    await page.waitForURL(/#\/memory$/)
    await expect(control('source')).toHaveValue('memory-demo')
    await expect(control('cutoff').locator('option')).toHaveCount(80)
    await expect(control('cutoff')).toHaveValue('c10')
    await expect(control('search')).toBeEnabled()
    await search('银钥匙')
    await expect(results().first()).toBeVisible()
    await results().first().click()
    await expect(control('evidence-quote')).toContainText('银钥匙')
    await expect(control('evidence')).toContainText('第 1 章')
    originalDemoRevision = await control('evidence-revision').textContent()
    assert.match(originalDemoRevision, /^[a-f0-9]{64}$/)
  })

  await step('02 Save an old chapter through the UI and exclude the superseded fact', async () => {
    await control('edit-chapter').selectOption('c1')
    const oldText = await control('chapter-editor').inputValue()
    assert.ok(oldText.includes('银钥匙'), 'The initial chapter must contain the old fact')
    await control('chapter-editor').fill(oldText.replaceAll('银钥匙', '铜钥匙'))
    await expect(control('search')).toBeDisabled()
    await control('save-demo').click()
    await expect(control('search')).toBeEnabled()
    await expect(control('evidence')).not.toContainText('银钥匙')
    await search('银钥匙')
    // Lexical retrieval may still match the shared word 钥匙 in the new revision.
    // The contract is that the old fact is absent, not that fuzzy search is empty.
    await expect(control('results')).not.toContainText('银钥匙')
    await search('铜钥匙')
    await expect(results().first()).toBeVisible()
    await results().first().click()
    await expect(control('evidence-quote')).toContainText('铜钥匙')
    await expect(control('evidence-quote')).not.toContainText('银钥匙')
    const revised = await control('evidence-revision').textContent()
    assert.match(revised, /^[a-f0-9]{64}$/)
    assert.notEqual(revised, originalDemoRevision, 'A saved chapter edit must change its source revision')
  })

  await step('03 Retrieve an early planted clue from an alias with source evidence', async () => {
    await control('cutoff').selectOption('c10')
    await search('接应信号')
    const clue = results().filter({ hasText: '铜铃' }).first()
    await expect(clue).toContainText('西渡口')
    await clue.click()
    await expect(control('evidence-quote')).toContainText('铜铃')
    await expect(control('evidence-quote')).toContainText('西渡口')
    await expect(control('evidence')).toContainText('第 2 章')
    await screenshot('clue-light')
  })

  await step('04 Exclude future identity and immediately clear evidence on cutoff reduction', async () => {
    await control('cutoff').selectOption('c10')
    await search('玄衣客真名')
    await expect(results()).toHaveCount(0)
    await control('cutoff').selectOption('c80')
    await search('玄衣客真名')
    const future = results().filter({ hasText: '顾行' }).first()
    await expect(future).toBeVisible()
    await future.click()
    await expect(control('evidence-quote')).toContainText('顾行')
    await screenshot('future-disclosed-at-80')
    await control('cutoff').selectOption('c10')
    await expect(control('evidence')).not.toContainText('顾行')
    await expect(results()).toHaveCount(0)
    await search('玄衣客真名')
    await expect(results()).toHaveCount(0)
    await expect(control('evidence')).not.toContainText('顾行')
  })

  await step('05 Reload retains the edited demo while rebuilding valid source evidence', async () => {
    await page.reload()
    await dismissAnnouncement()
    await expect(control('search')).toBeEnabled()
    await control('edit-chapter').selectOption('c1')
    await expect(control('chapter-editor')).toHaveValue(/铜钥匙/)
    await expect(control('chapter-editor')).not.toHaveValue(/银钥匙/)
    await search('银钥匙')
    await expect(control('results')).not.toContainText('银钥匙')
    await search('铜钥匙')
    await expect(results().first()).toBeVisible()
    await results().first().click()
    await expect(control('evidence-quote')).toContainText('铜钥匙')
    assert.equal(await readNovels(), originalNovels, 'Demo editing must not modify the author novel collection')
  })

  await step('06 Read a real novel without modifying its saved text or metadata', async () => {
    await control('source').selectOption(`novel:${novelId}`)
    await expect(control('search')).toBeEnabled()
    await search('航海图')
    await expect(results().first()).toBeVisible()
    await results().first().click()
    await expect(control('evidence-quote')).toContainText(initialNovelText)
    assert.equal(await readNovels(), originalNovels, 'Indexing and searching a real novel must be read-only')
  })

  await step('07 Search and explicit refresh use the latest chapter committed by Writer', async () => {
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
      const committed = await readNovels()
      await search('航海图')
      await expect(results()).toHaveCount(0)
      await expect(control('evidence')).not.toContainText('航海图')
      await control('refresh').click()
      await expect(control('search')).toBeEnabled()
      await search('潮汐册')
      await expect(results().first()).toBeVisible()
      await results().first().click()
      await expect(control('evidence-quote')).toContainText(revisedNovelText)
      assert.equal(await readNovels(), committed, 'Memory search/refresh must not overwrite the committed Writer edit')
    } finally {
      await writer.close()
    }
  })

  await step('08 Capture theme and narrow-screen evidence without model calls', async () => {
    await control('source').selectOption('memory-demo')
    await expect(control('search')).toBeEnabled()
    await search('接应信号')
    await results().filter({ hasText: '铜铃' }).first().click()
    const toggle = page.locator('.theme-toggle')
    for (let i = 0; i < 3 && await toggle.getAttribute('aria-label') !== '当前：暗色模式（点击切换）'; i++) await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', '当前：暗色模式（点击切换）')
    await screenshot('clue-dark')
    await page.setViewportSize({ width: 390, height: 844 })
    await screenshot('clue-mobile')
    report.mobileLayout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }))
    assert.deepEqual(errors, [], 'No uncaught errors may occur in the built application')
    assert.deepEqual(apiRequests, [], 'Memory acceptance must not call even the synthetic model endpoint')
  })
  console.log(`PASS ${report.tests.length} Memory Lab browser scenarios`)
} catch (error) {
  report.error = String(error.stack || error)
  report.diagnostics = {
    url: page.url(),
    bodyText: await page.locator('body').innerText({ timeout: 5000 }).catch(() => ''),
  }
  console.error(report.error)
  process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString()
  report.browserErrors = errors
  report.blockedRequests = blockedRequests
  report.apiRequests = apiRequests
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  await context.tracing.stop({ path: path.join(artifacts, 'trace.zip') })
  await browser.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
