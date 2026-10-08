/** Actual touch/keyboard acceptance at two narrow widths; no hidden-app API access. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium, expect as playwrightExpect } from '@playwright/test'
import { startPreviewServer } from './browser-preview.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = path.join(root, 'artifacts/browser-mobile')
await mkdir(artifacts, { recursive: true })
const server = await startPreviewServer({ port: 0, sha: process.env.GITHUB_SHA || 'local' })
const origin = `http://127.0.0.1:${server.address().port}`
const report = { startedAt: new Date().toISOString(), tests: [], screenshots: [], browserErrors: [], blockedRequests: [] }
const expect = playwrightExpect.configure({ timeout: 20_000 })
let browser
let context
let page
let width
const nav = () => page.getByTestId('app-navigation')
const toggle = () => page.getByTestId('navigation-toggle')
const memory = id => page.getByTestId(`memory-${id}`)
const graph = id => page.getByTestId(`fact-graph-${id}`)
const relations = () => page.locator('[data-testid^="fact-graph-relation-"]')
const bellQuote = '沈砚把一枚缺角的铜铃系在窗边，嘱咐阿宁听见三声铃响就去西渡口。'

async function step(name, run) {
  const entry = { width, name, status: 'running' }
  report.tests.push(entry)
  const started = Date.now()
  console.log(`START ${width}px ${name}`)
  try {
    await run()
    entry.status = 'passed'
    console.log(`PASS  ${width}px ${name}`)
  } catch (error) {
    entry.status = 'failed'
    entry.error = String(error.stack || error)
    await page.screenshot({ path: path.join(artifacts, `failure-${width}.png`) }).catch(() => {})
    throw error
  } finally { entry.durationMs = Date.now() - started }
}

async function screenshot(name) {
  const filename = `${width}-${name}.png`
  await page.screenshot({ path: path.join(artifacts, filename) })
  report.screenshots.push(filename)
}

// Bounding checks alone missed the original fixed sidebar. Also inspect the
// actual hit target at the control center before using real touch input.
async function reachable(locator) {
  await locator.scrollIntoViewIfNeeded()
  await expect(locator).toBeVisible()
  const value = await locator.evaluate(element => {
    const box = element.getBoundingClientRect()
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2
    const hit = document.elementFromPoint(x, y)
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: innerWidth, height: innerHeight, clear: !!hit && (hit === element || element.contains(hit)) }
  })
  assert.ok(value.left >= -1 && value.right <= value.width + 1, `Control must fit horizontally: ${JSON.stringify(value)}`)
  assert.ok(value.top >= -1 && value.bottom <= value.height + 1, `Control must be scrollable into the viewport: ${JSON.stringify(value)}`)
  assert.ok(value.clear, `Control is covered by another element: ${JSON.stringify(value)}`)
}

async function tap(locator) { await reachable(locator); await locator.tap() }
async function noHorizontalOverflow() {
  const sizes = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, content: document.querySelector('.content')?.scrollWidth, contentClient: document.querySelector('.content')?.clientWidth }))
  assert.ok(sizes.document <= sizes.viewport + 1, JSON.stringify(sizes))
  assert.ok(sizes.content <= sizes.contentClient + 1, `Inner content must not hide horizontal overflow: ${JSON.stringify(sizes)}`)
}
async function settledGraph() {
  await expect(graph('query')).toBeVisible()
  await expect(graph('canvas').locator('canvas').first()).toBeVisible()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
async function cutoff(id) {
  await reachable(memory('cutoff'))
  await memory('cutoff').selectOption(id)
  await settledGraph()
}
async function chooseRelation(query) {
  await graph('query').fill(query)
  await tap(relations().filter({ hasText: query }).first())
  await expect(graph('evidence')).toContainText(query)
}
async function navigate(name, url) {
  await tap(toggle())
  await expect(nav()).toBeVisible()
  await tap(nav().getByRole('menuitem', { name, exact: true }))
  await expect(page).toHaveURL(`${origin}/#${url}`)
  await expect(nav()).toBeHidden()
  await expect(toggle()).toBeFocused()
}

try {
  browser = await chromium.launch({ headless: true })
  for (width of [390, 320]) {
    context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 640 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, locale: 'zh-CN' })
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
      report.blockedRequests.push(`${url.origin}${url.pathname}`)
      return route.abort('blockedbyclient')
    })
    // Exercise the taller header with configured-model controls, using a
    // synthetic credential that never leaves this isolated browser context.
    await context.addInitScript(({ fixtureOrigin }) => {
      if (location.origin !== fixtureOrigin || localStorage.getItem('apiConfig')) return
      localStorage.setItem('apiConfig', JSON.stringify({ apiKey: 'synthetic-mobile-key', baseURL: `${fixtureOrigin}/__test/v1`, provider: 'custom', selectedModel: 'writer-mock', maxTokens: 2048, temperature: 0.7 }))
    }, { fixtureOrigin: origin })
    page = await context.newPage()
    page.setDefaultTimeout(20_000)
    page.on('pageerror', error => report.browserErrors.push(String(error.stack || error)))
    const customPredicate = `窄屏接应验收${width}`
    let revision

    await step('01 First visit: dismiss the announcement and reach unobscured memory controls', async () => {
      await page.goto(`${origin}/#/memory`)
      const announcement = page.getByRole('button', { name: '我知道了', exact: true })
      await expect(announcement).toBeVisible()
      await tap(announcement)
      await expect(memory('search')).toBeEnabled()
      await settledGraph()
      await expect(nav()).toBeHidden()
      await expect(toggle()).toHaveAttribute('aria-expanded', 'false')
      await reachable(toggle())
      await reachable(memory('source'))
      await reachable(memory('query'))
      await reachable(memory('cutoff'))
      await tap(memory('search'))
      await expect(memory('search')).toBeEnabled()
      await expect(memory('results')).toContainText('银钥匙')
      await noHorizontalOverflow()
      await screenshot('memory-controls')
    })

    await step('02 Modal navigation: touch, focus trap, Escape, backdrop and scrollable route links', async () => {
      await tap(toggle())
      await expect(nav()).toHaveAttribute('aria-modal', 'true')
      const close = page.getByTestId('navigation-close')
      await expect(close).toBeFocused()
      await expect(page.locator('.main-container')).toHaveAttribute('inert', '')
      await close.press('Shift+Tab')
      const settingsRoute = nav().getByRole('menuitem', { name: '系统设置', exact: true })
      await expect(settingsRoute).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(close).toBeFocused()
      await page.keyboard.press('Tab')
      const homeRoute = nav().getByRole('menuitem', { name: '首页', exact: true })
      await expect(homeRoute).toBeFocused()
      await homeRoute.press('Enter')
      await expect(page).toHaveURL(`${origin}/#/`)
      await expect(nav()).toBeHidden()
      await expect(toggle()).toBeFocused()
      await tap(toggle())
      await close.press('Shift+Tab')
      await expect(settingsRoute).toBeFocused()
      await settingsRoute.press('Space')
      await expect(page).toHaveURL(`${origin}/#/settings`)
      await expect(nav()).toBeHidden()
      await expect(toggle()).toBeFocused()
      await navigate('记忆检索 · 原型', '/memory')
      await tap(toggle())
      await page.keyboard.press('Escape')
      await expect(nav()).toBeHidden()
      await expect(toggle()).toBeFocused()
      await tap(toggle())
      const backdrop = page.getByTestId('navigation-backdrop')
      await backdrop.tap({ position: { x: width - 8, y: 100 } })
      await expect(nav()).toBeHidden()
      await expect(toggle()).toBeFocused()
      await tap(toggle())
      await tap(close)
      await expect(toggle()).toBeFocused()
      // Selecting the already-active route must close the drawer as well.
      await navigate('记忆检索 · 原型', '/memory')
      await navigate('系统设置', '/settings')
      await expect(page.getByRole('tab', { name: '数据管理', exact: true })).toBeVisible()
      await navigate('记忆检索 · 原型', '/memory')
      await expect(memory('search')).toBeEnabled()
      await settledGraph()
    })

    await step('03 Tap the rendered Cytoscape edge and read its exact revision and source', async () => {
      await graph('query').fill('受托保管')
      await expect(relations()).toHaveCount(1)
      await settledGraph()
      const attempts = []
      const offsets = [0, ...Array.from({ length: 20 }, (_, index) => -2 * (index + 1)), ...Array.from({ length: 20 }, (_, index) => 2 * (index + 1))]
      for (const offset of offsets) {
        await reachable(graph('canvas'))
        const box = await graph('canvas').boundingBox()
        assert.ok(box)
        await graph('canvas').tap({ position: { x: box.width / 2, y: box.height / 2 + offset } })
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const selected = await graph('canvas').getAttribute('data-selected-relation')
        attempts.push({ offset, selected })
        if (selected) break
      }
      report.tests.at(-1).canvasTouchAttempts = attempts
      await expect(graph('canvas')).toHaveAttribute('data-selected-relation', 'demo-key-custody')
      await expect(graph('quote').first()).toHaveText('顾行将银钥匙交给沈砚，嘱咐他保管到天亮。')
      await expect(graph('evidence')).toContainText('第 1 章')
      assert.match(await graph('revision').first().textContent(), /^[a-f0-9]{64}$/)
      await reachable(graph('confirm'))
      await tap(graph('confirm'))
      await expect(graph('evidence')).toContainText('作者确认')
      await noHorizontalOverflow()
      await screenshot('touch-edge-evidence')
    })

    await step('04 Add, save, confirm and reload a relation using the narrow-screen form', async () => {
      await tap(graph('create'))
      await graph('chapter').selectOption('c2')
      await reachable(graph('quote-input'))
      await graph('quote-input').fill(bellQuote)
      await tap(graph('add-evidence'))
      await expect(graph('anchors')).toContainText(bellQuote)
      await reachable(graph('source-label'))
      await graph('source-label').fill('铜铃')
      await graph('source-type').selectOption('object')
      await reachable(graph('target-label'))
      await graph('target-label').fill('西渡口')
      await graph('target-type').selectOption('place')
      await graph('predicate').fill(customPredicate)
      await noHorizontalOverflow()
      await screenshot('relation-form')
      await tap(graph('save'))
      await expect(graph('form')).toHaveCount(0)
      await expect(graph('evidence')).toContainText(customPredicate)
      await tap(graph('confirm'))
      await expect(graph('evidence')).toContainText('作者确认')
      revision = await graph('revision').first().textContent()
      await page.reload()
      await expect(memory('search')).toBeEnabled()
      await settledGraph()
      await chooseRelation(customPredicate)
      await expect(graph('evidence')).toContainText('作者确认')
      await expect(graph('revision').first()).toHaveText(revision)
      await expect(graph('quote').first()).toHaveText(bellQuote)
      await noHorizontalOverflow()
    })

    await step('05 Recover a distant clue and remove future identity and undisclosed inference premises', async () => {
      await cutoff('c40')
      await chooseRelation('三声铃响指向接应地点')
      await expect(graph('quote').first()).toHaveText(bellQuote)
      await chooseRelation('可能用于重逢时接应')
      await expect(graph('quote')).toHaveCount(2)
      await expect(graph('evidence')).toContainText('模型推断')
      await cutoff('c10')
      await expect(relations()).toHaveCount(0)
      await expect(graph('evidence')).not.toContainText('可能用于重逢时接应')
      await cutoff('c80')
      await chooseRelation('真名是')
      await expect(graph('evidence')).toContainText('第 80 章')
      await cutoff('c10')
      await expect(relations()).toHaveCount(0)
      await expect(graph('panel')).not.toContainText('玄衣客')
      await chooseRelation(customPredicate)
      await expect(graph('quote').first()).toHaveText(bellQuote)
    })

    await step('06 Edit an old chapter through the phone UI and exclude its confirmed old fact', async () => {
      await chooseRelation('受托保管')
      await expect(graph('evidence')).toContainText('作者确认')
      await memory('edit-chapter').selectOption('c1')
      const oldText = await memory('chapter-editor').inputValue()
      await reachable(memory('chapter-editor'))
      await memory('chapter-editor').fill(oldText.replaceAll('银钥匙', '铜钥匙'))
      await expect(relations()).toHaveCount(0)
      await tap(memory('save-demo'))
      await expect(memory('search')).toBeEnabled()
      await settledGraph()
      await graph('query').fill('受托保管')
      await expect(relations()).toHaveCount(0)
      await memory('query').fill('铜钥匙')
      await tap(memory('search'))
      await expect(memory('search')).toBeEnabled()
      await expect(memory('results')).toContainText('铜钥匙')
      await expect(memory('results')).not.toContainText('银钥匙')
      await chooseRelation(customPredicate)
      await expect(graph('revision').first()).toHaveText(revision)
      await noHorizontalOverflow()
      await screenshot('revised-source')
    })

    await step('07 Reach backup export, import options, cancel and complete a restore confirmation', async () => {
      await navigate('系统设置', '/settings')
      await expect(graph('panel')).toHaveCount(0)
      await tap(page.getByRole('tab', { name: '数据管理', exact: true }))
      await noHorizontalOverflow()
      await tap(page.getByRole('button', { name: '导入选项', exact: true }))
      const options = page.getByRole('dialog', { name: '导入选项', exact: true })
      await expect(options).toBeVisible()
      const checkbox = options.getByRole('checkbox', { name: /小说数据/ })
      const checkboxLabel = options.locator('label').filter({ hasText: '小说数据' })
      await expect(checkbox).toBeChecked()
      await tap(checkboxLabel)
      await expect(checkbox).not.toBeChecked()
      await tap(checkboxLabel)
      await expect(checkbox).toBeChecked()
      await reachable(options.getByRole('button', { name: '确定', exact: true }))
      await tap(options.getByRole('button', { name: '取消', exact: true }))
      const downloaded = page.waitForEvent('download')
      await tap(page.getByRole('button', { name: '导出所有数据', exact: true }))
      const download = await downloaded
      const filename = path.join(artifacts, `mobile-backup-${width}.json`)
      await download.saveAs(filename)
      const exported = JSON.parse(await readFile(filename, 'utf8'))
      assert.equal(exported.format, 'llm-writer-backup')
      const chooseBackup = async () => {
        const chosen = page.waitForEvent('filechooser')
        await tap(page.getByRole('button', { name: '选择备份文件', exact: true }))
        await (await chosen).setFiles(filename)
      }
      await chooseBackup()
      const confirmation = page.getByRole('dialog', { name: '确认导入', exact: true })
      await expect(confirmation).toBeVisible()
      await reachable(confirmation.getByRole('button', { name: '确定', exact: true }))
      await tap(confirmation.getByRole('button', { name: '取消', exact: true }))
      await expect(confirmation).toHaveCount(0)
      await chooseBackup()
      await expect(confirmation).toBeVisible()
      await screenshot('backup-confirmation')
      await tap(confirmation.getByRole('button', { name: '确定', exact: true }))
      const completed = page.getByRole('dialog', { name: '导入完成', exact: true })
      await expect(completed).toBeVisible()
      const reloaded = page.waitForEvent('load')
      await tap(completed.getByRole('button', { name: '确定', exact: true }))
      await reloaded
      await expect(page.getByRole('tab', { name: '数据管理', exact: true })).toBeVisible()
      await navigate('记忆检索 · 原型', '/memory')
      await expect(memory('search')).toBeEnabled()
      await settledGraph()
      await noHorizontalOverflow()
    })

    await step('08 Preserve desktop collapse and clear mobile modal state when crossing the breakpoint', async () => {
      await page.setViewportSize({ width: 1440, height: 1080 })
      await expect(nav()).toBeVisible()
      await expect(nav()).toHaveAttribute('role', 'navigation')
      await expect(nav()).toHaveCSS('width', '232px')
      await toggle().click()
      await expect(nav()).toHaveCSS('width', '64px')
      await expect(toggle()).toHaveAttribute('aria-expanded', 'false')
      await page.setViewportSize({ width, height: width === 390 ? 844 : 640 })
      await expect(nav()).toBeHidden()
      await tap(toggle())
      await expect(nav()).toBeVisible()
      assert.ok((await nav().boundingBox()).width > 200, 'Mobile drawer must show labels even when desktop was collapsed')
      await screenshot('navigation-drawer')
      await page.setViewportSize({ width: 1440, height: 1080 })
      await expect(page.getByTestId('navigation-backdrop')).toHaveCount(0)
      await expect(page.locator('.main-container')).not.toHaveAttribute('inert', '')
      await expect(nav()).toHaveCSS('width', '64px')
      await expect(toggle()).toBeFocused()
      await toggle().click()
      await expect(nav()).toHaveCSS('width', '232px')
      await reachable(memory('query'))
    })
    await context.tracing.stop({ path: path.join(artifacts, `trace-${width}.zip`) })
    await context.close()
    context = undefined
  }
  assert.deepEqual(report.browserErrors, [], 'No uncaught browser errors may occur')
  assert.deepEqual(report.blockedRequests, [], 'No unplanned external requests may occur')
  console.log(`PASS ${report.tests.length} mobile/browser scenarios`)
} catch (error) {
  report.error = String(error.stack || error)
  if (page) report.diagnostics = { url: page.url(), body: await page.locator('body').innerText({ timeout: 5000 }).catch(() => '') }
  console.error(report.error)
  process.exitCode = 1
} finally {
  if (context) await context.tracing.stop({ path: path.join(artifacts, `trace-${width}.zip`) }).catch(() => {})
  report.finishedAt = new Date().toISOString()
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  await browser?.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
