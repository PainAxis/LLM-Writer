/**
 * Real Chromium regression for a disposable GitHub Actions preview.
 * Start scripts/browser-preview.mjs first, then:
 *   node scripts/browser-regression.mjs
 * Requires @playwright/test and its Chromium installation. No real API/key is used.
 * All app state changes go through the visible UI; storage evaluation is read-only.
 */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium, expect as playwrightExpect } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const previewURL = (process.env.PREVIEW_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const mockURL = process.env.MOCK_API_URL || `${previewURL}/__test/v1`
const artifacts = path.resolve(process.env.BROWSER_ARTIFACT_DIR || path.join(root, 'artifacts/browser'))
const previewOrigin = new URL(previewURL).origin
const expect = playwrightExpect.configure({ timeout: 15_000 })
assert.equal(new URL(mockURL).origin, previewOrigin, 'Only the disposable same-origin mock API is allowed')
assert.match(new URL(mockURL).pathname, /^\/__test\/v1$/, 'Do not point browser regression at a real API')
await mkdir(artifacts, { recursive: true })

const healthResponse = await fetch(`${previewURL}/__test/health`)
assert.equal(healthResponse.status, 200, 'The disposable preview must be running')
const health = await healthResponse.json()
const report = { sha: process.env.GITHUB_SHA || null, preview: health, startedAt: new Date().toISOString(), tests: [] }
const errors = []
const consoleMessages = []
const blockedRequests = []
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, locale: 'zh-CN', acceptDownloads: true })
await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
// A bad API configuration must fail locally instead of reaching a real service.
await context.route('**/*', async route => {
  const url = new URL(route.request().url())
  if (['data:', 'blob:'].includes(url.protocol) || url.origin === previewOrigin) return route.continue()
  blockedRequests.push(route.request().url())
  return route.abort('blockedbyclient')
})
const page = await context.newPage()
page.setDefaultTimeout(15_000)
page.on('pageerror', error => {
  const entry = {
    at: new Date().toISOString(),
    scenario: report.tests.at(-1)?.name || 'bootstrap',
    message: String(error),
    stack: error.stack || null,
  }
  errors.push(entry)
  console.error('BROWSER PAGE ERROR ' + JSON.stringify(entry))
})
page.on('console', message => {
  if (['warning', 'error'].includes(message.type())) consoleMessages.push({ type: message.type(), text: message.text() })
})
// Native beforeunload dialogs should not silently discard an unfinished save.
page.on('dialog', async dialog => {
  errors.push(`Unexpected native dialog: ${dialog.type()}: ${dialog.message()}`)
  await dialog.dismiss()
})

const novelTitle = '浏览器回归测试小说'
const chapterA = '甲章：保存与取消'
const chapterB = '乙章：独立正文'
const textA = '甲章原始正文。黎明时分，旅人站在城门前，反复核对地图与行囊。她决定沿着河流寻找失踪的朋友，并把每天发生的事情写进笔记。这段内容用于验证编辑器输入、自动保存与页面刷新，不能被迟到的生成结果覆盖。'
const textB = '乙章保留正文。这里是另一个章节的独立内容，切换章节后必须保持原样。任何属于甲章的生成片段都不能写入本章。这段文字足够长，可以同时用于后续的备份恢复和编辑持久化检查。'
let writerURL = ''
let backupPath = ''
let exportedBackup

async function step(name, run) {
  const started = Date.now()
  const entry = { name, status: 'running' }
  report.tests.push(entry)
  console.log(`START ${name}`)
  try {
    await run()
    entry.status = 'passed'
    console.log(`PASS  ${name}`)
  } catch (error) {
    entry.status = 'failed'
    entry.error = error.stack || String(error)
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {})
    throw error
  } finally {
    entry.durationMs = Date.now() - started
  }
}

async function screenshot(name) {
  await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: true })
}

async function failureDiagnostics() {
  const snapshot = { url: page.url(), browserErrors: [...errors] }
  try {
    snapshot.bodyText = (await page.locator('body').innerText({ timeout: 5000 })).slice(0, 6000)
    snapshot.visibleControls = await page.locator('input:visible, [role="combobox"]:visible, button:visible').evaluateAll(elements => elements.slice(0, 80).map(element => ({
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role'),
      type: element.getAttribute('type'),
      id: element.id,
      label: element.getAttribute('aria-label'),
      labelledBy: element.getAttribute('aria-labelledby'),
      placeholder: element.getAttribute('placeholder'),
      text: (element.innerText || '').trim().slice(0, 180),
      disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
    })))
  } catch (error) {
    snapshot.diagnosticError = String(error)
  }
  return snapshot
}

async function dismissAnnouncement() {
  const acknowledgement = page.getByRole('button', { name: '我知道了', exact: true })
  try { await acknowledgement.waitFor({ state: 'visible', timeout: 2200 }) } catch { return }
  await acknowledgement.click()
  await expect(acknowledgement).toBeHidden()
}

async function go(route) {
  await page.goto(`${previewURL}/#/${route}`)
  await expect(page.locator('#app[data-v-app]')).not.toBeEmpty()
  await dismissAnnouncement()
}

const editor = () => page.locator('.editor-panel [contenteditable="true"]')
const chapterItem = title => page.locator('.chapter-item').filter({ has: page.locator('.chapter-info > p').filter({ hasText: title }) })

async function selectChapter(title) {
  await chapterItem(title).click()
  await expect(page.locator('.editor-header .chapter-title')).toHaveText(title)
  await expect(editor()).toBeVisible()
}

async function savedChapter(title) {
  return page.evaluate(({ novel, chapter }) => {
    const novels = JSON.parse(localStorage.getItem('novels') || '[]')
    return novels.find(item => item.title === novel)?.chapterList?.find(item => item.title === chapter) ?? null
  }, { novel: novelTitle, chapter: title })
}

async function waitSaved(title, text) {
  await expect.poll(async () => (await savedChapter(title))?.content || '', { timeout: 20_000 }).toContain(text)
  await expect(page.locator('.saving-indicator')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '保存失败，点击重试' })).toHaveCount(0)
}

async function createChapter(title, content) {
  await page.getByRole('button', { name: '新增章节' }).hover()
  await page.getByRole('menuitem', { name: '手动创建', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新增章节', exact: true })
  await dialog.getByPlaceholder('请输入章节标题').fill(title)
  await dialog.getByPlaceholder('简要描述本章节内容...').fill('旅人从城门出发，沿河寻找朋友；用于浏览器生成回归。')
  await dialog.getByRole('button', { name: '确定', exact: true }).click()
  await expect(dialog).toBeHidden()
  await selectChapter(title)
  await editor().fill(content)
  await waitSaved(title, content)
}

async function metrics() {
  const response = await fetch(`${previewURL}/__test/metrics`)
  assert.equal(response.status, 200)
  return response.json()
}

async function settingsData() {
  await go('settings')
  await page.getByRole('tab', { name: '数据管理', exact: true }).click()
  await expect(page.getByRole('button', { name: '导出所有数据', exact: true })).toBeVisible()
}

async function exportBackup(name) {
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出所有数据', exact: true }).click()
  const download = await downloading
  const target = path.join(artifacts, name)
  await download.saveAs(target)
  assert.equal(await download.failure(), null)
  return { target, data: JSON.parse(await readFile(target, 'utf8')) }
}

async function importBackup(file) {
  await page.locator('.data-management input[type="file"]').setInputFiles(file)
  const confirm = page.getByRole('dialog', { name: '确认导入', exact: true })
  await confirm.getByRole('button', { name: '确定', exact: true }).click()
  const completed = page.getByRole('dialog', { name: '导入完成', exact: true })
  await expect(completed).toContainText('成功导入')
  await Promise.all([
    page.waitForEvent('load'),
    completed.getByRole('button', { name: '确定', exact: true }).click(),
  ])
  await dismissAnnouncement()
}

try {
  await step('01 Configure disposable API through the settings UI', async () => {
    await go('config')
    await page.getByPlaceholder('请输入API密钥').fill('preview-test-key')
    await page.getByPlaceholder('例如：https://api.openai.com/v1').fill(mockURL)
    await page.getByPlaceholder('输入模型名称，如 qwen-max').fill('writer-mock-slow')
    await page.getByRole('button', { name: '添加', exact: true }).click()
    await page.locator('.el-form-item').filter({ hasText: '模型选择' }).getByRole('combobox').click()
    await page.getByRole('option', { name: /writer-mock-slow/ }).click()
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    await expect(page.getByText('配置保存成功', { exact: true })).toBeVisible()
    await screenshot('01-mock-api-configured')
  })

  await step('02 Create a novel and two chapters, edit WangEditor and reload', async () => {
    await go('novels')
    await page.getByRole('button', { name: '创建新小说', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '创建新小说', exact: true })
    await dialog.getByPlaceholder('请输入小说标题').fill(novelTitle)
    await dialog.locator('.el-select').click()
    await page.locator('.el-select-dropdown:visible').getByRole('option').first().click()
    await dialog.getByPlaceholder('请输入小说简介或点击AI生成').fill('只使用合成内容的浏览器回归项目。')
    await dialog.getByRole('button', { name: '创建', exact: true }).click()
    await expect(dialog).toBeHidden()
    await page.waitForURL(/#\/writer\?novelId=/)
    await expect(page.locator('.writer-container .novel-title')).toHaveText(novelTitle)
    writerURL = page.url()
    await createChapter(chapterA, textA)
    await createChapter(chapterB, textB)
    await page.reload()
    await dismissAnnouncement()
    await selectChapter(chapterA)
    await expect(editor()).toHaveText(textA)
    await selectChapter(chapterB)
    await expect(editor()).toHaveText(textB)
    await screenshot('02-editor-persisted-after-reload')
  })

  await step('03 Stop streaming continuation and verify server-side cancellation', async () => {
    await selectChapter(chapterA)
    const before = await metrics()
    await page.getByRole('button', { name: '续写', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'AI智能续写', exact: true })
    await dialog.getByRole('button', { name: '开始续写', exact: true }).click()
    await expect(dialog.locator('.streaming-text')).not.toHaveText('')
    await expect.poll(async () => (await metrics()).active).toBeGreaterThan(0)
    await dialog.getByRole('button', { name: '停止', exact: true }).click()
    await expect(dialog.locator('.result-content')).not.toHaveText('')
    const partial = await dialog.locator('.result-content').innerText()
    await expect.poll(async () => (await metrics()).cancelled).toBeGreaterThan(before.cancelled)
    await delay(1800) // More than two server chunks: stopped previews must remain stable.
    await expect(dialog.locator('.result-content')).toHaveText(partial)
    await expect(page.getByText('续写完成', { exact: true })).toHaveCount(0)
    await screenshot('03-cancelled-stream-preserves-partial')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(editor()).toHaveText(textA)
    await waitSaved(chapterA, textA)
  })

  await step('04 Switch chapters during generation without late writes', async () => {
    const before = await metrics()
    await page.getByRole('button', { name: '根据大纲生成', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'AI生成章节内容', exact: true })
    await dialog.locator('.prompt-item-modern').first().click()
    await dialog.getByRole('button', { name: '开始生成', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await metrics()).active).toBeGreaterThan(0)
    await expect(editor()).not.toHaveText(textA)
    await selectChapter(chapterB)
    await expect.poll(async () => (await metrics()).cancelled).toBeGreaterThan(before.cancelled)
    await expect(editor()).toHaveText(textB)
    await delay(1800)
    await expect(editor()).toHaveText(textB)
    await waitSaved(chapterB, textB)
    await page.reload()
    await dismissAnnouncement()
    await selectChapter(chapterB)
    await expect(editor()).toHaveText(textB)
    await screenshot('04-chapter-switch-does-not-cross-write')
    // Keep the exported fixture deterministic after deliberately interrupting A.
    await selectChapter(chapterA)
    await editor().fill(textA)
    await waitSaved(chapterA, textA)
  })

  await step('05 Parse a real DOCX upload and retain it after a corrupt upload', async () => {
    await go('book-analysis')
    const upload = page.locator('.upload-area input[type="file"]')
    await upload.setInputFiles(path.join(root, 'scripts/fixtures/book-import.docx'))
    await expect(page.locator('.file-name')).toHaveText('book-import.docx')
    await expect(page.locator('.file-encoding')).toHaveText('DOCX（自动解析）')
    await page.getByRole('button', { name: '查看内容', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '章节内容查看', exact: true })
    await expect(dialog.locator('.chapter-text')).toContainText('正文第一段。')
    await expect(dialog.locator('.chapter-text')).toContainText('显式换行。')
    await expect(dialog.locator('.chapter-text')).toContainText('<script>只是文字</script>')
    await expect(dialog.locator('.chapter-text')).toContainText('阿青')
    await expect(dialog.locator('.chapter-text script')).toHaveCount(0)
    await screenshot('05-docx-real-parser-output')
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await upload.setInputFiles(path.join(root, 'scripts/fixtures/book-import-invalid.docx'))
    await expect(page.locator('.el-message--error')).toContainText('DOCX 解析失败')
    await expect(page.locator('.file-name')).toHaveText('book-import.docx')
    await page.getByRole('button', { name: '查看内容', exact: true }).click()
    await expect(dialog.locator('.chapter-text')).toContainText('正文第一段。')
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  })

  await step('06 Download backup, change content, restore file and reload runtime state', async () => {
    await settingsData()
    const exported = await exportBackup('full-backup.json')
    backupPath = exported.target
    exportedBackup = exported.data
    assert.equal(exportedBackup.format, 'llm-writer-backup')
    assert.equal(exportedBackup.version, 2)
    assert.equal(exportedBackup.data.apiConfig.baseURL, mockURL)
    assert.equal(exportedBackup.data.apiConfig.selectedModel, 'writer-mock-slow')
    assert.ok(exportedBackup.data.prompts.length > 0)
    const novel = exportedBackup.data.novels.find(item => item.title === novelTitle)
    assert.equal(novel.chapterList.length, 2)
    assert.ok(novel.chapterList.find(item => item.title === chapterB).content.includes(textB))
    await page.goto(writerURL)
    await selectChapter(chapterB)
    const changed = '备份导出之后的临时修改，恢复后应该消失。'
    await editor().fill(changed)
    await waitSaved(chapterB, changed)
    await settingsData()
    await importBackup(backupPath)
    await page.goto(writerURL)
    await selectChapter(chapterB)
    await expect(editor()).toHaveText(textB)
    await selectChapter(chapterA)
    await expect(editor()).toHaveText(textA)
    await screenshot('06-restored-backup-editor')
  })

  await step('07 Persist large content in real IndexedDB and hydrate on reload', async () => {
    const largeBackup = structuredClone(exportedBackup)
    const largeContent = `<p>${'浏览器分片正文。'.repeat(200_000)}</p>`
    const novel = largeBackup.data.novels.find(item => item.title === novelTitle)
    novel.chapterList.find(item => item.title === chapterA).content = largeContent
    await settingsData()
    await importBackup({ name: 'synthetic-large-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(largeBackup)) })
    const stored = await savedChapter(chapterA)
    assert.equal(typeof stored.contentRef, 'string', 'Large chapters should be committed through IndexedDB references')
    assert.ok(!stored.content || stored.content.length < largeContent.length, 'Metadata should not duplicate the long body')
    await page.getByRole('tab', { name: '数据管理', exact: true }).click()
    const hydrated = await exportBackup('hydrated-large-backup.json')
    const actual = hydrated.data.data.novels.find(item => item.title === novelTitle).chapterList.find(item => item.title === chapterA)
    assert.equal(actual.content, largeContent, 'Reload must hydrate every character before a backup can be exported')
    assert.equal(actual.contentRef, undefined, 'Exported backups must contain portable content instead of local references')
    await screenshot('07-indexeddb-hydrated-after-reload')
    await importBackup(backupPath)
  })

  assert.deepEqual(errors, [], 'The browser must not raise uncaught errors or unsaved-data navigation dialogs')
  console.log(`PASS ${report.tests.length} real-browser regression scenarios`)
} catch (error) {
  report.error = error.stack || String(error)
  console.error(report.error)
  report.diagnostics = await failureDiagnostics()
  console.error('BROWSER FAILURE DIAGNOSTICS\n' + JSON.stringify(report.diagnostics, null, 2))
  process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString()
  report.metrics = await metrics().catch(error => ({ error: String(error) }))
  report.browserErrors = errors
  report.consoleMessages = consoleMessages
  report.blockedRequests = blockedRequests
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  await context.tracing.stop({ path: path.join(artifacts, 'trace.zip') })
  await browser.close()
}
