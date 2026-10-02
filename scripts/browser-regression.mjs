/**
 * Real Chromium regression for a disposable GitHub Actions preview.
 * Start scripts/browser-preview.mjs first, then:
 *   node scripts/browser-regression.mjs
 * Requires @playwright/test and its Chromium installation. No real API/key is used.
 * All app state changes go through the visible UI; storage evaluation is read-only.
 */
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
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

function observePage(target) {
  target.setDefaultTimeout(15_000)
  target.on('pageerror', error => {
    const entry = {
      at: new Date().toISOString(),
      scenario: report.tests.at(-1)?.name || 'bootstrap',
      url: target.url(),
      message: String(error),
      stack: error.stack || null,
    }
    errors.push(entry)
    console.error('BROWSER PAGE ERROR ' + JSON.stringify(entry))
  })
  target.on('console', message => {
    if (['warning', 'error'].includes(message.type())) consoleMessages.push({ url: target.url(), type: message.type(), text: message.text() })
  })
  // Native beforeunload dialogs should not silently discard an unfinished save.
  target.on('dialog', async dialog => {
    errors.push(`Unexpected native dialog at ${target.url()}: ${dialog.type()}: ${dialog.message()}`)
    await dialog.dismiss()
  })
}

async function newTestContext() {
  const isolated = await browser.newContext({ viewport: { width: 1600, height: 1100 }, locale: 'zh-CN', acceptDownloads: true })
  isolated.on('page', observePage)
  await isolated.tracing.start({ screenshots: true, snapshots: true, sources: true })
  // Apply the same network guard to every page, including clean-install contexts.
  await isolated.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (['data:', 'blob:'].includes(url.protocol) || url.origin === previewOrigin) return route.continue()
    blockedRequests.push(route.request().url())
    return route.abort('blockedbyclient')
  })
  return isolated
}

const context = await newTestContext()
const page = await context.newPage()

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

async function screenshot(name, target = page) {
  await target.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: true })
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

async function dismissAnnouncement(target = page) {
  const acknowledgement = target.getByRole('button', { name: '我知道了', exact: true })
  try { await acknowledgement.waitFor({ state: 'visible', timeout: 2200 }) } catch { return }
  await acknowledgement.click()
  await expect(acknowledgement).toBeHidden()
}

async function go(route, target = page) {
  await target.goto(`${previewURL}/#/${route}`)
  await expect(target.locator('#app[data-v-app]')).not.toBeEmpty()
  await dismissAnnouncement(target)
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

async function settingsData(target = page) {
  await go('settings', target)
  await target.getByRole('tab', { name: '数据管理', exact: true }).click()
  await expect(target.getByRole('button', { name: '导出所有数据', exact: true })).toBeVisible()
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

async function importBackup(file, target = page) {
  await target.locator('.data-management input[type="file"]').setInputFiles(file)
  const confirm = target.getByRole('dialog', { name: '确认导入', exact: true })
  await confirm.getByRole('button', { name: '确定', exact: true }).click()
  const completed = target.getByRole('dialog', { name: '导入完成', exact: true })
  await expect(completed).toContainText('成功导入')
  await Promise.all([
    target.waitForEvent('load'),
    completed.getByRole('button', { name: '确定', exact: true }).click(),
  ])
  await dismissAnnouncement(target)
}

async function withIsolatedPage(name, run) {
  const isolated = await newTestContext()
  const target = await isolated.newPage()
  try {
    await run(target)
  } finally {
    await screenshot(name, target).catch(() => {})
    await isolated.tracing.stop({ path: path.join(artifacts, `${name}-trace.zip`) })
    await isolated.close()
  }
}

async function selectMockModel(target, model) {
  await target.getByPlaceholder('输入模型名称，如 qwen-max').fill(model)
  await target.getByRole('button', { name: '添加', exact: true }).click()
  await target.locator('.el-form-item').filter({ hasText: '模型选择' }).locator('.el-select__wrapper').click()
  await target.getByRole('option', { name: new RegExp(`^${model}\\s+自定义模型$`) }).click()
}

async function configureDisposableApi(target) {
  await go('config', target)
  await target.getByPlaceholder('请输入API密钥').fill('preview-test-key')
  await target.getByPlaceholder('例如：https://api.openai.com/v1').fill(mockURL)
  await selectMockModel(target, 'writer-mock')
  await target.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(target.getByText('配置保存成功', { exact: true })).toBeVisible()
  await expect(target.getByRole('button', { name: '测试连接', exact: true })).toBeEnabled()
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
    await expect.poll(async () => (await metrics()).chunks).toBeGreaterThan(before.chunks)
    // Chapter generation commits once complete; in-flight text stays out of the editor.
    await expect(editor()).toHaveText(textA)
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

  await step('08 Stop, restart and clear article generation without late editor writes', async () => {
    await go('short-story')
    const workspace = page.locator('.short-story-page .workspace:visible')
    const articleEditor = workspace.locator('[contenteditable="true"]')
    await workspace.getByRole('button', { name: '选择模板', exact: true }).click()
    const templates = page.getByRole('dialog', { name: '选择短文提示词模板', exact: true })
    const title = await templates.locator('.prompt-title').first().innerText()
    await templates.getByPlaceholder('搜索提示词模板...').fill(title)
    await templates.locator('.prompt-item').first().click()
    await expect(templates).toBeHidden()
    await expect(page.getByPlaceholder('描述您想要创作的短文内容、主题、风格等要求...')).not.toHaveValue('')
    await page.getByPlaceholder('请输入文章标题').fill('短文生命周期测试')
    await page.getByPlaceholder('描述您想要创作的短文内容、主题、风格等要求...').fill('描写雨后的城市，只使用测试内容。')
    const before = await metrics()
    await workspace.getByRole('button', { name: '生成短文', exact: true }).click()
    await expect(workspace.locator('.streaming-content')).toContainText('联调生成片段 1')
    await workspace.getByRole('button', { name: '停止生成', exact: true }).click()
    await expect.poll(async () => (await metrics()).cancelled).toBeGreaterThan(before.cancelled)
    await expect(articleEditor).toContainText('联调生成片段 1')
    const partial = await articleEditor.innerText()
    await delay(1800)
    await expect(articleEditor).toHaveText(partial)
    await workspace.getByRole('button', { name: '生成短文', exact: true }).click()
    await expect(workspace.locator('.streaming-content')).toContainText('联调生成片段 2')
    await workspace.getByRole('button', { name: '清空', exact: true }).click()
    await page.getByRole('dialog', { name: '确认', exact: true }).getByRole('button', { name: 'OK', exact: true }).click()
    await expect.poll(async () => (await metrics()).cancelled).toBeGreaterThan(before.cancelled + 1)
    await expect(articleEditor).toHaveText('')
    await delay(1800)
    await expect(articleEditor).toHaveText('')
    await screenshot('08-short-article-cancel-clear')
  })

  await step('09 Stop story generation and cancel continuation and optimization dialogs', async () => {
    await page.getByRole('tab', { name: '📖 短篇小说', exact: true }).click()
    const workspace = page.locator('.short-story-page .workspace:visible')
    const storyEditor = workspace.locator('[contenteditable="true"]')
    await page.getByPlaceholder('请输入小说标题').fill('短篇生命周期测试')
    await page.getByPlaceholder('请输入主角姓名').fill('阿宁')
    await page.getByPlaceholder('请详细描述您想要创作的短篇小说，包括：', { exact: false }).fill('描写主角在雨后寻找失物。')
    let before = await metrics()
    await workspace.getByRole('button', { name: '生成小说', exact: true }).click()
    await expect(storyEditor).toContainText('联调生成片段 3')
    await workspace.getByRole('button', { name: '停止生成', exact: true }).click()
    await expect.poll(async () => (await metrics()).cancelled).toBeGreaterThan(before.cancelled)
    const partial = await storyEditor.innerText()
    await delay(1800)
    await expect(storyEditor).toHaveText(partial)
    const exporting = page.waitForEvent('download')
    await workspace.getByRole('button', { name: '导出', exact: true }).click()
    const download = await exporting
    const exportedStory = path.join(artifacts, 'short-story.txt')
    await download.saveAs(exportedStory)
    const storyText = await readFile(exportedStory, 'utf8')
    assert.ok(storyText.startsWith('短篇生命周期测试'))
    assert.ok(storyText.includes('联调生成片段'))
    assert.ok(!storyText.includes('undefined'), 'Story export must contain only the title and body')

    for (let attempt = 0; attempt < 2; attempt++) {
      before = await metrics()
      await workspace.getByRole('button', { name: '续写', exact: true }).click()
      const dialog = page.locator('.modern-continue-dialog')
      await dialog.getByRole('button', { name: '开始续写', exact: true }).click()
      await expect(dialog.locator('.streaming-text-content')).toContainText('联调生成片段 1')
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect.poll(async () => (await metrics()).cancelled).toBeGreaterThan(before.cancelled)
    }
    await storyEditor.click()
    await page.keyboard.press('ControlOrMeta+a')
    await workspace.getByRole('button', { name: '优化', exact: true }).click()
    const optimize = page.getByRole('dialog', { name: '✨ 选段优化', exact: true })
    await expect(optimize.locator('.selected-text-preview')).toContainText('联调生成片段')
    await optimize.getByPlaceholder('请描述优化方向，例如：', { exact: false }).fill('增加雨后的声音描写')
    before = await metrics()
    await optimize.getByRole('button', { name: '开始优化', exact: true }).click()
    await expect(optimize.locator('.optimized-content')).toContainText('联调生成片段 1')
    await optimize.getByRole('button', { name: '取消', exact: true }).click()
    await expect.poll(async () => (await metrics()).cancelled).toBeGreaterThan(before.cancelled)
    await delay(1800)
    await expect(storyEditor).toHaveText(partial)
    await screenshot('09-short-story-dialog-cancellation')
  })

  await step('10 Leaving ShortStory cancels its active request on component unmount', async () => {
    const before = await metrics()
    const workspace = page.locator('.short-story-page .workspace:visible')
    await workspace.getByRole('button', { name: '生成小说', exact: true }).click()
    await expect(workspace.locator('[contenteditable="true"]')).toContainText('联调生成片段 1')
    // Queue the editor's trailing selection throttle immediately before the
    // same visible menu action unmounts it. This makes the teardown race repeatable.
    await page.getByRole('menuitem', { name: '首页', exact: true }).evaluate(item => {
      document.dispatchEvent(new Event('selectionchange'))
      document.dispatchEvent(new Event('selectionchange'))
      item.click()
    })
    await expect(page.locator('.short-story-page')).toHaveCount(0)
    await expect.poll(async () => (await metrics()).cancelled).toBeGreaterThan(before.cancelled)
    await expect.poll(async () => (await metrics()).active).toBe(0)
    await delay(1800)
    await expect(page.getByText('小说生成成功！', { exact: true })).toHaveCount(0)
    await screenshot('10-short-story-unmount-aborts')
  })

  await step('11 Edit novel metadata with validation, tags, cover removal and persisted status', async () => {
    await go('novels')
    const card = page.locator('.novel-card').filter({ hasText: novelTitle })
    await card.getByRole('button').last().click()
    await page.getByRole('menuitem', { name: '编辑信息', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '编辑小说信息', exact: true })
    await dialog.getByPlaceholder('请输入小说标题').fill('')
    await dialog.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(dialog.locator('.el-form-item__error')).toContainText('请输入小说标题')
    const updatedTitle = `${novelTitle}（已编辑）`
    await dialog.getByPlaceholder('请输入小说标题').fill(updatedTitle)
    await dialog.locator('.el-form-item').filter({ hasText: '状态' }).locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: '已完成', exact: true }).click()
    await dialog.getByPlaceholder('输入标签后按回车添加').fill('回归标签')
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog.getByText('回归标签', { exact: true })).toBeVisible()
    await dialog.locator('input[type="file"]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT1sAAAAASUVORK5CYII=', 'base64') })
    await expect(dialog.locator('.cover-preview')).toBeVisible()
    await dialog.getByRole('button', { name: '移除封面', exact: true }).click()
    await expect(dialog.locator('.cover-preview')).toHaveCount(0)
    await dialog.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(dialog).toBeHidden()
    await page.reload()
    await dismissAnnouncement()
    const updated = page.locator('.novel-card').filter({ hasText: updatedTitle })
    await expect(updated.getByText('已完成', { exact: true })).toBeVisible()
    await updated.getByRole('button').last().click()
    await page.getByRole('menuitem', { name: '编辑信息', exact: true }).click()
    await expect(dialog.getByText('回归标签', { exact: true })).toBeVisible()
    await expect(dialog.locator('.cover-preview')).toHaveCount(0)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await updated.getByRole('button', { name: '详情', exact: true }).click()
    const details = page.getByRole('dialog', { name: '小说详情', exact: true })
    await details.locator('.chapter-item').filter({ hasText: chapterB }).getByRole('button', { name: '编辑', exact: true }).click()
    await expect(page.locator('.editor-header .chapter-title')).toHaveText(chapterB)
    await expect(editor()).toHaveText(textB)
    await screenshot('11-novel-metadata-persisted')
  })

  await step('12 Generate a title through the tool catalog and download the result', async () => {
    await go('config')
    await page.getByPlaceholder('输入模型名称，如 qwen-max').fill('writer-mock')
    await page.getByRole('button', { name: '添加', exact: true }).click()
    await page.locator('.el-form-item').filter({ hasText: '模型选择' }).locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: /^writer-mock\s+自定义模型$/ }).click()
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    await expect(page.getByText('配置保存成功', { exact: true })).toBeVisible()
    await go('tools')
    await expect(page.locator('.tool-card')).toHaveCount(10)
    await page.locator('.tool-card').filter({ hasText: '爆款书名生成器' }).click()
    const dialog = page.getByRole('dialog', { name: '爆款书名生成器', exact: true })
    const generate = dialog.getByRole('button', { name: '生成内容', exact: true })
    await expect(generate).toBeDisabled()
    await dialog.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label', { hasText: /^生成数量$/ }) }).locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: '5个书名', exact: true }).click()
    await dialog.locator('.el-form-item').filter({ hasText: '小说类型' }).locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: '都市', exact: true }).click()
    await dialog.getByPlaceholder('输入相关关键词，用逗号分隔').fill('城市,旅行')
    await generate.click()
    await expect(dialog.getByPlaceholder('生成的内容将在这里显示...')).toHaveValue(/联调生成片段 3/)
    const downloading = page.waitForEvent('download')
    await dialog.getByRole('button', { name: '保存到本地', exact: true }).click()
    const download = await downloading
    const target = path.join(artifacts, 'tool-titles.txt')
    await download.saveAs(target)
    assert.equal(await download.failure(), null)
    const exported = await readFile(target, 'utf8')
    assert.ok(exported.includes('爆款书名生成器'))
    assert.ok(exported.includes('联调生成片段 3'))
    await screenshot('12-tools-generated-title')
    await dialog.getByRole('button', { name: 'Close this dialog' }).click()
  })

  await step('13 Cancel book analysis and isolate chapter summaries on chapter switch', async () => {
    await go('config')
    await page.locator('.el-form-item').filter({ hasText: '模型选择' }).locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: /^writer-mock-slow\s+自定义模型$/ }).click()
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    await go('book-analysis')
    await page.locator('.upload-area input[type="file"]').setInputFiles({
      name: 'generation-source.txt', mimeType: 'text/plain',
      buffer: Buffer.from('雨后\n' + '旅人走过城市。'.repeat(400) + '\n河岸\n' + '朋友等待归来。'.repeat(400)),
    })
    await expect(page.locator('.file-name')).toHaveText('generation-source.txt')
    await page.locator('.setting-item').filter({ hasText: '拆书模板' }).locator('.el-select__wrapper').click()
    await page.getByRole('option').first().click()
    const before = await metrics()
    await page.getByRole('button', { name: '开始拆书分析', exact: true }).click()
    await expect(page.locator('.analysis-editor textarea')).toHaveValue(/联调生成片段/)
    await page.getByRole('button', { name: '停止分析', exact: true }).click()
    await expect.poll(async () => (await metrics()).cancelled).toBeGreaterThan(before.cancelled)
    const partial = await page.locator('.analysis-editor textarea').inputValue()
    assert.ok(!partial.includes('✅ 分析完成'))
    await delay(900)
    await expect(page.locator('.analysis-editor textarea')).toHaveValue(partial)
    await page.getByRole('button', { name: '本地自动分章', exact: true }).click()
    await page.getByRole('button', { name: '查看简读', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '章节管理', exact: true })
    await expect(dialog.locator('.chapter-list-item')).toHaveCount(2)
    await dialog.getByRole('tab', { name: '章节简读', exact: true }).click()
    const summaryBefore = await metrics()
    await dialog.getByRole('button', { name: '调用AI解读', exact: true }).click()
    await expect.poll(async () => (await metrics()).chunks).toBeGreaterThan(summaryBefore.chunks)
    await dialog.locator('.chapter-list-item').nth(1).click()
    await expect.poll(async () => (await metrics()).cancelled).toBeGreaterThan(summaryBefore.cancelled)
    await delay(900)
    await expect(dialog.locator('.chapter-item-summary').nth(0)).toContainText('暂无简读')
    await expect(dialog.locator('.chapter-item-summary').nth(1)).toContainText('暂无简读')
    await dialog.getByRole('button', { name: 'Close this dialog' }).click()
  })

  await step('14 Cancel novel descriptions on source edits and form closure', async () => {
    await go('novels')
    await page.getByRole('button', { name: '创建新小说', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '创建新小说', exact: true })
    await dialog.getByPlaceholder('请输入小说标题').fill('旧标题')
    await dialog.locator('.el-form-item').filter({ hasText: '类型' }).locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: /玄幻/ }).click()
    const before = await metrics()
    await dialog.getByRole('button', { name: 'AI智能生成', exact: true }).click()
    const description = dialog.getByPlaceholder('请输入小说简介或点击AI生成')
    await expect(description).toHaveValue(/联调生成片段/)
    await dialog.getByPlaceholder('请输入小说标题').fill('新标题')
    await expect.poll(async () => (await metrics()).cancelled).toBeGreaterThan(before.cancelled)
    const partial = await description.inputValue()
    await delay(900)
    await expect(description).toHaveValue(partial)
    const restart = await metrics()
    await dialog.getByRole('button', { name: 'AI智能生成', exact: true }).click()
    await expect.poll(async () => (await metrics()).chunks).toBeGreaterThan(restart.chunks)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect.poll(async () => (await metrics()).cancelled).toBeGreaterThan(restart.cancelled)
    await page.getByRole('button', { name: '创建新小说', exact: true }).click()
    await expect(description).toHaveValue('')
    await delay(900)
    await expect(description).toHaveValue('')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
  })

  await step('15 Cancel tools on stop, dialog close and route unmount', async () => {
    await go('tools')
    await page.locator('.tool-card').filter({ hasText: '爆款书名生成器' }).click()
    const dialog = page.getByRole('dialog', { name: '爆款书名生成器', exact: true })
    await dialog.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label', { hasText: /^生成数量$/ }) }).locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: '5个书名', exact: true }).click()
    await dialog.locator('.el-form-item').filter({ hasText: '小说类型' }).locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: '都市', exact: true }).click()
    await dialog.getByPlaceholder('输入相关关键词，用逗号分隔').fill('城市,旅行')
    const result = dialog.getByPlaceholder('生成的内容将在这里显示...')
    const before = await metrics()
    await dialog.getByRole('button', { name: '生成内容', exact: true }).click()
    await expect(result).toHaveValue(/联调生成片段/)
    await dialog.getByRole('button', { name: '停止生成', exact: true }).click()
    await expect.poll(async () => (await metrics()).cancelled).toBeGreaterThan(before.cancelled)
    const partial = await result.inputValue()
    await delay(900)
    await expect(result).toHaveValue(partial)
    const restart = await metrics()
    await dialog.getByRole('button', { name: '生成内容', exact: true }).click()
    await expect.poll(async () => (await metrics()).chunks).toBeGreaterThan(restart.chunks)
    await dialog.getByRole('button', { name: 'Close this dialog' }).click()
    await expect.poll(async () => (await metrics()).cancelled).toBeGreaterThan(restart.cancelled)
    await page.locator('.tool-card').filter({ hasText: '爆款书名生成器' }).click()
    await expect(result).toHaveCount(0)
    await dialog.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label', { hasText: /^生成数量$/ }) }).locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: '5个书名', exact: true }).click()
    await dialog.locator('.el-form-item').filter({ hasText: '小说类型' }).locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: '都市', exact: true }).click()
    await dialog.getByPlaceholder('输入相关关键词，用逗号分隔').fill('城市')
    const unmount = await metrics()
    await dialog.getByRole('button', { name: '生成内容', exact: true }).click()
    await expect(result).toHaveValue(/联调生成片段/)
    await go('home')
    await expect.poll(async () => (await metrics()).cancelled).toBeGreaterThan(unmount.cancelled)
  })

  await step('16 Edit mind-map titles and entities, persist bodies and discard drafts', async () => {
    const originalChapter = await page.evaluate(() => JSON.parse(localStorage.getItem('novels') || '[]')[0].chapterList[1])
    await go('mindmap')
    await expect(page.getByRole('button', { name: '编辑导图', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '编辑导图', exact: true }).click()
    const chapter = page.locator('me-tpc[data-nodeid="memm-edit-chapterList-1"]')
    await chapter.dblclick()
    const nodeInput = page.locator('#input-box[contenteditable="true"]')
    await nodeInput.fill('乙章：导图修改')
    await nodeInput.press('Enter')
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByText('导图修改已保存', { exact: true })).toBeVisible()
    await page.reload()
    await dismissAnnouncement()
    await page.locator('me-tpc').filter({ hasText: '章节大纲' }).locator('..').locator('me-epd').click()
    await expect(page.locator('me-tpc').filter({ hasText: '乙章：导图修改' })).toBeVisible()
    const persistedChapter = await page.evaluate(() => JSON.parse(localStorage.getItem('novels') || '[]')[0].chapterList[1])
    assert.equal(persistedChapter.content, originalChapter.content)
    assert.equal(persistedChapter.description, originalChapter.description)
    await page.getByRole('button', { name: '编辑导图', exact: true }).click()
    await page.locator('me-tpc[data-nodeid="memm-edit-group-characters"]').click()
    await page.keyboard.press('Tab')
    await expect(nodeInput).toBeVisible()
    await nodeInput.fill('导图新增人物')
    await nodeInput.press('Enter')
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('button', { name: '编辑导图', exact: true })).toBeVisible()
    await page.locator('me-tpc').filter({ hasText: '👥 人物' }).locator('..').locator('me-epd').click()
    await expect(page.locator('me-tpc').filter({ hasText: '导图新增人物' })).toBeVisible()
    await page.getByRole('button', { name: '编辑导图', exact: true }).click()
    await page.locator('me-tpc[data-nodeid="memm-edit-characters-0"]').click()
    await page.keyboard.press('Delete')
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    const deletion = page.getByRole('dialog', { name: '确认删除', exact: true })
    await expect(deletion).toContainText('将删除 1 个条目')
    await deletion.getByRole('button', { name: '继续编辑', exact: true }).click()
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await deletion.getByRole('button', { name: '保存并删除', exact: true }).click()
    await expect(page.getByRole('button', { name: '编辑导图', exact: true })).toBeVisible()
    await expect(page.locator('me-tpc').filter({ hasText: '导图新增人物' })).toHaveCount(0)
    await page.getByRole('button', { name: '编辑导图', exact: true }).click()
    await chapter.dblclick()
    await nodeInput.fill('不保存的修改')
    await nodeInput.press('Enter')
    await page.getByRole('button', { name: '取消编辑', exact: true }).click()
    const discard = page.getByRole('dialog', { name: '取消编辑', exact: true })
    await discard.getByRole('button', { name: '放弃修改', exact: true }).click()
    await page.reload()
    await dismissAnnouncement()
    await page.locator('me-tpc').filter({ hasText: '章节大纲' }).locator('..').locator('me-epd').click()
    await expect(page.locator('me-tpc').filter({ hasText: '乙章：导图修改' })).toBeVisible()
    await expect(page.locator('me-tpc').filter({ hasText: '不保存的修改' })).toHaveCount(0)
    await screenshot('16-mindmap-edits-persisted')
  })

  await step('17 Persist assistant policies and verify custom/global/summary request contexts', async () => {
    await go('config')
    await page.locator('.el-form-item').filter({ hasText: '模型选择' }).locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: /^writer-mock\s+自定义模型$/ }).click()
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    await go('assistants')
    await page.getByRole('button', { name: '新建', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByPlaceholder('例如：情节构思助手').fill('独立上下文助手')
    await dialog.getByText('自定义', { exact: true }).click()
    const turns = () => dialog.locator('.el-form-item').filter({ hasText: '消息条数' }).getByRole('spinbutton')
    await turns().fill('1')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('自定义上下文', { exact: true })).toBeVisible()
    const requests = []
    const recordRequest = request => {
      if (!request.url().endsWith('/chat/completions') || request.method() !== 'POST') return
      const body = request.postDataJSON()
      if (body.stream) requests.push(body)
    }
    page.on('request', recordRequest)
    const send = async (text, withSummary = false) => {
      const count = requests.length
      await page.getByPlaceholder('输入消息，Enter 发送，Shift+Enter 换行').fill(text)
      await page.getByRole('button', { name: '发送', exact: true }).click()
      if (withSummary) {
        await page.getByRole('dialog', { name: '上下文管理', exact: true }).getByRole('button', { name: '重试摘要', exact: true }).click()
      }
      await expect.poll(() => requests.length).toBeGreaterThan(count)
      await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible()
      return requests.at(-1)
    }
    const messages = request => request.messages.filter(message => message.role !== 'system')
    try {
      await send('独立第一条')
      const narrow = await send('独立第二条')
      assert.equal(messages(narrow).length, 1)
      assert.equal(messages(narrow)[0].content, '独立第二条')
      await page.reload()
      await dismissAnnouncement()
      await expect(page.locator('.message-row')).toHaveCount(4)
      await expect(page.getByText('自定义上下文', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '编辑助手', exact: true }).click()
      await expect(turns()).toHaveValue('1')
      await turns().fill('3')
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
      await page.getByRole('button', { name: '编辑助手', exact: true }).click()
      await expect(turns()).toHaveValue('1')
      await dialog.getByText('跟随全局', { exact: true }).click()
      await dialog.getByRole('button', { name: '保存', exact: true }).click()
      const inherited = await send('跟随全局第三条')
      assert.equal(messages(inherited).length, 5)
      await expect(page.locator('.message-row')).toHaveCount(6)
      await page.getByRole('button', { name: '编辑助手', exact: true }).click()
      await dialog.getByText('自定义', { exact: true }).click()
      await turns().fill('4')
      await dialog.getByText('滚动摘要', { exact: true }).click()
      await dialog.locator('.el-form-item').filter({ hasText: '保留原文' }).getByRole('spinbutton').fill('1')
      await dialog.getByRole('button', { name: '保存', exact: true }).click()
      const summarized = await send('摘要后第四条', true)
      assert.equal(messages(summarized).length, 2)
      assert.ok(summarized.messages.some(message => message.role === 'system' && message.content.includes('【此前对话摘要】')))
      await expect(page.locator('.message-row')).toHaveCount(8)
      await expect(page.getByText('已折叠摘要', { exact: true })).toBeVisible()
      await settingsData()
      const downloading = page.waitForEvent('download')
      await page.getByRole('button', { name: '导出所有数据', exact: true }).click()
      const download = await downloading
      const target = path.join(artifacts, 'assistant-backup.json')
      await download.saveAs(target)
      const backup = JSON.parse(await readFile(target, 'utf8'))
      assert.equal(backup.data.assistants[0].contextPolicyMode, 'custom')
      assert.equal(backup.data.assistants[0].contextPolicy.strategy, 'summary')
      const assistantId = backup.data.assistants[0].id
      assert.equal(backup.data.assistantConversations[assistantId].length, 8)
      await importBackup(target)
      await go('assistants')
      await expect(page.getByText('自定义上下文', { exact: true })).toBeVisible()
      await expect(page.locator('.message-row')).toHaveCount(8)
      await screenshot('17-assistant-policy-restored')
    } finally {
      page.off('request', recordRequest)
    }
  })

  await step('18 Virtualize long assistant histories and preserve scroll intent', async () => {
    await settingsData()
    const downloadEvent = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出所有数据', exact: true }).click()
    const download = await downloadEvent
    const target = path.join(artifacts, 'virtual-history-backup.json')
    await download.saveAs(target)
    const backup = JSON.parse(await readFile(target, 'utf8'))
    const assistant = backup.data.assistants[0]
    assistant.contextPolicyMode = 'custom'
    assistant.contextPolicy = { maxTokens: 4000, maxTurns: 2, strategy: 'truncation', summaryThreshold: 80, retainTurns: 1 }
    assistant.defaultModel = 'writer-mock-slow'
    const history = Array.from({ length: 2000 }, (_, index) => ({
      id: `history-${index}`, isUser: index % 2 === 0,
      content: `历史消息 ${String(index).padStart(4, '0')}\n` + (index % 13 === 0 ? '多行内容\n'.repeat(20) : '保留完整原文'),
      timestamp: new Date().toISOString(),
    }))
    backup.data.assistantConversations = { [assistant.id]: history }
    backup.data.assistantSummaries = {}
    backup.data.assistants.push({ ...assistant, id: assistant.id + 1, name: '空白会话助手' })
    await importBackup({ name: 'long-history.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
    await go('assistants')
    const messages = page.locator('.chat-messages')
    await expect(messages.getByText(/历史消息 1999/)).toBeVisible()
    assert.ok(await page.locator('.message-row').count() < 50)
    const count = () => page.evaluate(id => JSON.parse(localStorage.getItem('assistantConversations'))[id].length, assistant.id)
    assert.equal(await count(), 2000)
    await messages.focus()
    await messages.press('Control+Home')
    await expect(messages.getByText(/历史消息 0000/)).toBeVisible()
    await expect(page.getByRole('button', { name: '返回最新', exact: true })).toBeVisible()
    await page.waitForTimeout(300)
    assert.equal(await messages.evaluate(node => node.scrollTop), 0, 'Measurement preserves the top anchor')
    await page.getByRole('button', { name: '返回最新', exact: true }).click()
    await expect(messages.getByText(/历史消息 1999/)).toBeVisible()
    await page.locator('.chat-input textarea').fill('验证流式滚动意图')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible()
    await messages.focus()
    await messages.press('Control+Home')
    await expect(messages.getByText(/历史消息 0000/)).toBeVisible()
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible({ timeout: 45_000 })
    assert.equal(await messages.evaluate(node => node.scrollTop), 0, 'Streaming does not pull a reader back to the bottom')
    assert.equal(await count(), 2002)
    await page.locator('.assistant-item').filter({ hasText: '空白会话助手' }).click()
    await expect(messages.getByText('开始与助手对话，会话将按助手隔离保存')).toBeVisible()
    await page.locator('.assistant-item').filter({ hasText: assistant.name }).click()
    await expect(messages.getByText('验证流式滚动意图', { exact: true })).toBeVisible()
    assert.ok(await page.locator('.message-row').count() < 50)
    await screenshot('18-virtual-assistant-history')
  })

  await step('19 Import legacy corpus into a novel and roundtrip portable files', async () => {
    await go('novels')
    await page.locator('.novel-card').first().getByRole('button', { name: '编辑', exact: true }).click()
    await expect(page.locator('.writer-container')).toBeVisible()
    const corpusTab = page.getByRole('tab', { name: /语料库/ })
    await corpusTab.click()
    const panel = page.locator('.panel-content:visible').filter({ has: page.locator('.corpus-toolbar') })
    const source = [{ id: 7001, content: '旧语料保留内容', createdAt: '2020-01-01', extension: { retained: true } }]
    const upload = () => panel.getByLabel('导入语料文件').setInputFiles({ name: 'corpus.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) })
    await upload()
    await expect(panel.getByText('旧语料保留内容', { exact: true }).first()).toBeVisible()
    const novelId = Number(new URLSearchParams(page.url().split('?')[1]).get('novelId'))
    const corpus = () => page.evaluate(id => JSON.parse(localStorage.getItem('novels')).find(n => n.id === id).corpusData, novelId)
    await expect.poll(async () => (await corpus()).filter(item => item.content === source[0].content).length).toBe(1)
    await upload()
    await expect.poll(async () => (await corpus()).filter(item => item.content === source[0].content).length).toBe(2)
    const retained = (await corpus()).filter(item => item.content === source[0].content)
    assert.equal(new Set(retained.map(item => item.id)).size, 2)
    assert.deepEqual(retained.map(item => item.extension), [{ retained: true }, { retained: true }])
    await page.reload()
    await dismissAnnouncement()
    await corpusTab.click()
    const downloading = page.waitForEvent('download')
    await panel.getByRole('button', { name: '导出', exact: true }).click()
    const download = await downloading
    const target = path.join(artifacts, 'portable-corpus.json')
    await download.saveAs(target)
    const portable = JSON.parse(await readFile(target, 'utf8'))
    assert.equal(portable.format, 'llm-writer-corpus')
    assert.deepEqual(portable.items, await corpus())
    await panel.getByLabel('导入语料文件').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('[null]') })
    await expect(page.getByText('第 1 条语料格式错误', { exact: true })).toBeVisible()
    assert.deepEqual(await corpus(), portable.items)
    await settingsData()
    const saved = await exportBackup('unified-corpus-backup.json')
    assert.deepEqual(saved.data.data.novels.find(n => n.id === novelId).corpusData, portable.items)
    await screenshot('19-unified-corpus-backup')
  })

  await step('20 Follow light/dark/system themes without losing mind-map drafts', async () => {
    await page.emulateMedia({ colorScheme: 'light' })
    await go('mindmap')
    const toggle = page.locator('.theme-toggle')
    for (let i = 0; i < 3 && await toggle.getAttribute('aria-label') !== '当前：亮色模式（点击切换）'; i++) await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', '当前：亮色模式（点击切换）')
    const canvas = page.locator('.mindmap-canvas .map-canvas')
    const background = () => canvas.evaluate(node => getComputedStyle(node).backgroundColor)
    await expect.poll(background).toBe('rgb(246, 246, 246)')
    const original = await page.evaluate(() => JSON.parse(localStorage.getItem('novels'))[0].title)
    await page.getByRole('button', { name: '编辑导图', exact: true }).click()
    const rootTopic = page.locator('.mindmap-canvas me-root me-tpc')
    await rootTopic.dblclick()
    const input = page.locator('#input-box[contenteditable="true"]')
    await input.fill('主题切换保留草稿')
    await input.press('Enter')
    await expect(page.getByRole('button', { name: '保存修改', exact: true })).toBeEnabled()
    await toggle.click()
    await expect.poll(background).toBe('rgb(37, 37, 38)')
    await expect(rootTopic).toHaveText('主题切换保留草稿')
    const readPixel = async name => {
      const downloading = page.waitForEvent('download')
      await page.getByRole('button', { name: '导出 PNG', exact: true }).click()
      const download = await downloading
      const target = path.join(artifacts, name)
      await download.saveAs(target)
      const png = await readFile(target)
      assert.equal(png.subarray(1, 4).toString(), 'PNG')
      const chunks = []
      for (let offset = 8; offset < png.length;) {
        const length = png.readUInt32BE(offset)
        if (png.subarray(offset + 4, offset + 8).toString() === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length))
        offset += length + 12
      }
      // The first pixel has zero left/up neighbours for every PNG row filter.
      return [...inflateSync(Buffer.concat(chunks)).subarray(1, 4)]
    }
    assert.ok((await readPixel('20-dark-mindmap.png')).every(value => value < 100))
    await screenshot('20-dark-mindmap-draft')
    await toggle.click() // dark -> system
    await expect(toggle).toHaveAttribute('aria-label', '当前：跟随系统（点击切换）')
    await expect.poll(background).toBe('rgb(246, 246, 246)')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect.poll(background).toBe('rgb(37, 37, 38)')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(background).toBe('rgb(246, 246, 246)')
    await expect(rootTopic).toHaveText('主题切换保留草稿')
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('novels'))[0].title), original)
    assert.ok((await readPixel('20-light-mindmap.png')).every(value => value > 200))
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByText('导图修改已保存', { exact: true })).toBeVisible()
    await page.reload()
    await dismissAnnouncement()
    await expect(page.locator('.mindmap-canvas me-root me-tpc')).toContainText('主题切换保留草稿')
  })

  await step('21 Share goal histories, notes and activity streaks across both goal entry points', async () => {
    await go('')
    await page.getByRole('button', { name: '管理目标', exact: true }).click()
    let manager = page.getByRole('dialog', { name: '写作目标管理', exact: true })
    await manager.getByRole('button', { name: '新增目标', exact: true }).click()
    const create = page.getByRole('dialog', { name: '新增写作目标', exact: true })
    await create.locator('.el-form-item').filter({ hasText: '目标标题' }).locator('input').fill('目标入口一致性回归')
    await create.getByRole('button', { name: '保存', exact: true }).click()
    await expect(create).toBeHidden()
    const readGoal = () => page.evaluate(() => JSON.parse(localStorage.getItem('writingGoals') || '[]').find(goal => goal.title === '目标入口一致性回归'))
    await expect.poll(async () => (await readGoal())?.currentValue).toBe(0)
    await manager.locator('.goal-item').filter({ hasText: '目标入口一致性回归' }).getByRole('button', { name: '更新进度', exact: true }).click()
    let progress = page.getByRole('dialog', { name: '更新进度', exact: true })
    await progress.locator('.el-input-number input').fill('100')
    await progress.locator('textarea').fill('首页进度备注')
    await progress.getByRole('button', { name: '保存', exact: true }).click()
    await expect(progress).toBeHidden()
    await expect.poll(async () => (await readGoal())?.progressHistory?.[0]?.note).toBe('首页进度备注')
    await expect(manager.locator('.overview-card').filter({ hasText: '连续天数' }).locator('.card-value')).toHaveText('1')
    await manager.locator('.el-dialog__headerbtn').first().click()

    await go('goals')
    await page.locator('.goal-card').filter({ hasText: '目标入口一致性回归' }).getByRole('button', { name: '更新进度', exact: true }).click()
    progress = page.getByRole('dialog', { name: '更新进度', exact: true })
    await progress.locator('.el-input-number input').fill('50')
    await progress.locator('textarea').fill('目标页进度备注')
    await progress.getByRole('button', { name: '保存', exact: true }).click()
    await expect(progress).toBeHidden()
    await expect.poll(async () => (await readGoal())?.currentValue).toBe(150)
    const goal = await readGoal()
    assert.deepEqual(goal.progressHistory.map(record => record.increment), [50, 100])
    assert.deepEqual(goal.progressHistory.map(record => record.note), ['目标页进度备注', '首页进度备注'])
    await expect(page.locator('.overview-item').filter({ hasText: '连续天数' }).locator('.overview-value')).toHaveText('1')
    await go('')
    await expect(page.locator('.streak-info')).toContainText('连续写作 1 天')
    await page.getByRole('button', { name: '管理目标', exact: true }).click()
    manager = page.getByRole('dialog', { name: '写作目标管理', exact: true })
    await expect(manager.locator('.goal-item').filter({ hasText: '目标入口一致性回归' }).locator('.progress-info')).toContainText('150/1000')
    await screenshot('21-shared-writing-goals.png')
  })

  await step('22 Initialize default templates when Book Analysis or Tools is the first page', async () => {
    for (const route of ['book-analysis', 'tools']) {
      const cleanContext = await newTestContext()
      const cleanPage = await cleanContext.newPage()
      try {
        await go(route, cleanPage)
        // These independent contexts have never visited Writer or imported a backup.
        assert.equal(await cleanPage.evaluate(() => localStorage.getItem('apiConfig')), null)
        if (route === 'book-analysis') {
          await cleanPage.locator('.upload-area input[type="file"]').setInputFiles({
            name: 'first-visit.txt', mimeType: 'text/plain',
            buffer: Buffer.from('第一章 初访\n' + '旅人在清晨来到城门，记录沿途看到的故事。'.repeat(30)),
          })
          await expect(cleanPage.locator('.file-name')).toHaveText('first-visit.txt')
          await cleanPage.locator('.setting-item').filter({ hasText: '拆书模板' }).locator('.el-select__wrapper').click()
          const templates = cleanPage.locator('.el-select-dropdown:visible').getByRole('option')
          await expect(templates.first()).toBeVisible()
          assert.ok(await templates.count() > 0, 'Direct Book Analysis visits must have default templates')
          await templates.first().click()
          await expect(cleanPage.getByRole('button', { name: '开始拆书分析', exact: true })).toBeDisabled()
          await cleanPage.getByRole('button', { name: '全选', exact: true }).click()
          await expect(cleanPage.getByRole('button', { name: '开始拆书分析', exact: true })).toBeEnabled()
        } else {
          await cleanPage.locator('.tool-card').filter({ hasText: '细纲生成器' }).click()
          const tool = cleanPage.getByRole('dialog', { name: '细纲生成器', exact: true })
          await tool.locator('.el-form-item').filter({ hasText: '提示词模板' }).locator('.el-select__wrapper').click()
          const templates = cleanPage.locator('.el-select-dropdown:visible').getByRole('option')
          await expect(templates.first()).toBeVisible()
          assert.ok(await templates.count() > 0, 'Direct Tools visits must have default templates')
          await templates.first().click()
        }
        const categories = await cleanPage.evaluate(() => JSON.parse(localStorage.getItem('prompts') || '[]').map(prompt => prompt.category))
        assert.ok(categories.includes('book-analysis') && categories.includes('outline'))
      } finally {
        await screenshot(`22-first-visit-${route}`, cleanPage).catch(() => {})
        await cleanContext.tracing.stop({ path: path.join(artifacts, `22-first-visit-${route}-trace.zip`) })
        await cleanContext.close()
      }
    }
  })

  await step('23 Merge edits to different novels across tabs and retain conflicting drafts', async () => {
    await settingsData()
    const fixture = (await exportBackup('23-before-multitab.json')).data
    const timestamp = new Date().toISOString()
    const makeNovel = (id, title) => ({
      id, title, genre: 'fantasy', description: '合成的跨标签页保存回归作品', tags: [],
      createdAt: timestamp, updatedAt: timestamp, chapters: 1, wordCount: 4, totalWords: 4,
      characters: [], worldSettings: [], events: [], corpusData: [],
      chapterList: [{ id: id + 1, title: '第一章', content: '初始正文', status: 'draft', tags: [], wordCount: 4, createdAt: timestamp, updatedAt: timestamp }],
    })
    fixture.data.novels = [makeNovel(23001, '跨页作品甲'), makeNovel(23011, '跨页作品乙')]
    await importBackup({ name: 'multitab-novels.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) })
    const first = await context.newPage()
    const second = await context.newPage()
    let stale
    const editing = target => target.locator('.editor-panel [contenteditable="true"]')
    const storedContent = id => page.evaluate(novelId => JSON.parse(localStorage.getItem('novels') || '[]').find(novel => novel.id === novelId)?.chapterList?.[0]?.content || '', id)
    try {
      // Both tabs load the same initial collection before either one edits it.
      await Promise.all([go('writer?novelId=23001', first), go('writer?novelId=23011', second)])
      await expect(editing(first)).toHaveText('初始正文')
      await expect(editing(second)).toHaveText('初始正文')
      await Promise.all([
        editing(first).fill('作品甲独立修改，必须与另一标签页的作品乙同时保存。'),
        editing(second).fill('作品乙独立修改，不能覆盖另一标签页的作品甲。'),
      ])
      await expect.poll(() => storedContent(23001), { timeout: 20_000 }).toContain('作品甲独立修改')
      await expect.poll(() => storedContent(23011), { timeout: 20_000 }).toContain('作品乙独立修改')
      for (const target of [first, second]) {
        await expect(target.locator('.saving-indicator')).toHaveCount(0)
        await expect(target.getByRole('button', { name: '保存失败，点击重试', exact: true })).toHaveCount(0)
      }
      await screenshot('23-independent-novels-first-tab', first)
      await screenshot('23-independent-novels-second-tab', second)

      stale = await context.newPage()
      await go('writer?novelId=23001', stale)
      await expect(editing(stale)).toContainText('作品甲独立修改')
      await editing(first).fill('作品甲已提交的新版本，迟到保存不得覆盖。')
      await expect.poll(() => storedContent(23001), { timeout: 20_000 }).toContain('作品甲已提交的新版本')
      const committed = await storedContent(23001)
      const draft = '作品甲迟到标签页的草稿，冲突后必须留在编辑器中。'
      await editing(stale).fill(draft)
      const retry = stale.getByRole('button', { name: '保存失败，点击重试', exact: true })
      await expect(retry).toBeVisible({ timeout: 20_000 })
      await expect(stale.locator('.persistence-error')).toContainText('已在其他标签页修改')
      await expect(editing(stale)).toHaveText(draft)
      assert.equal(await storedContent(23001), committed)
      // Retrying without resolving the conflict must still preserve the newer saved text.
      await retry.click()
      await expect(retry).toBeVisible()
      await expect(stale.locator('.persistence-error')).toContainText('当前草稿仍保留')
      await expect(editing(stale)).toHaveText(draft)
      assert.equal(await storedContent(23001), committed)
      assert.ok((await storedContent(23011)).includes('作品乙独立修改'))
      await screenshot('23-conflict-retains-draft', stale)
    } finally {
      // These disposable test tabs intentionally close after checking the retained draft.
      if (stale) await stale.close()
      await first.close()
      await second.close()
    }
  })

  await step('24 Preserve both concurrent goal increments and histories across tabs', async () => {
    const title = '跨标签目标增量回归'
    await go('')
    await page.getByRole('button', { name: '管理目标', exact: true }).click()
    const manager = page.getByRole('dialog', { name: '写作目标管理', exact: true })
    await manager.getByRole('button', { name: '新增目标', exact: true }).click()
    const create = page.getByRole('dialog', { name: '新增写作目标', exact: true })
    await create.locator('.el-form-item').filter({ hasText: '目标标题' }).locator('input').fill(title)
    await create.getByRole('button', { name: '保存', exact: true }).click()
    await expect(create).toBeHidden()
    await manager.locator('.el-dialog__headerbtn').first().click()
    await go('goals')
    const peer = await context.newPage()
    const readGoal = () => page.evaluate(goalTitle => JSON.parse(localStorage.getItem('writingGoals') || '[]').find(goal => goal.title === goalTitle), title)
    const card = target => target.locator('.goal-card').filter({ hasText: title })
    try {
      await go('goals', peer)
      const dialogs = []
      for (const [target, increment, note] of [[page, '100', '标签甲增量'], [peer, '50', '标签乙增量']]) {
        await expect(card(target).locator('.progress-text')).toContainText('0 / 1000')
        await card(target).getByRole('button', { name: '更新进度', exact: true }).click()
        const progress = target.getByRole('dialog', { name: '更新进度', exact: true })
        await progress.locator('.el-input-number input').fill(increment)
        await progress.locator('textarea').fill(note)
        dialogs.push(progress)
      }
      await Promise.all(dialogs.map(dialog => dialog.getByRole('button', { name: '保存', exact: true }).click()))
      for (const dialog of dialogs) await expect(dialog).toBeHidden()
      await expect.poll(async () => (await readGoal())?.currentValue).toBe(150)
      const goal = await readGoal()
      assert.deepEqual(goal.progressHistory.map(record => record.increment).sort((a, b) => a - b), [50, 100])
      assert.deepEqual(goal.progressHistory.map(record => record.note).sort(), ['标签乙增量', '标签甲增量'].sort())
      assert.equal(new Set(goal.progressHistory.map(record => record.id)).size, 2)
      for (const target of [page, peer]) {
        await expect(card(target).locator('.progress-text')).toContainText('150 / 1000')
        await target.reload()
        await dismissAnnouncement(target)
        await expect(card(target).locator('.progress-text')).toContainText('150 / 1000')
      }
      assert.deepEqual((await readGoal()).progressHistory, goal.progressHistory)
      await screenshot('24-concurrent-goal-increments', peer)
    } finally {
      await peer.close()
    }
  })

  await step('25 Replace only the second occurrence of a selected short-story passage', () => withIsolatedPage('25-short-story-exact-selection', async target => {
    await configureDisposableApi(target)
    await go('short-story', target)
    await target.getByRole('tab', { name: '📖 短篇小说', exact: true }).click()
    const workspace = target.locator('.short-story-page .workspace:visible')
    const storyEditor = workspace.locator('[contenteditable="true"]')
    const repeated = '雨落无声。'
    const before = `第一处：${repeated}第二处：`
    const after = '末尾保留。'
    await storyEditor.fill(before + repeated + after)
    await storyEditor.press('ControlOrMeta+End')
    for (let index = 0; index < after.length; index++) await target.keyboard.press('ArrowLeft')
    for (let index = 0; index < repeated.length; index++) await target.keyboard.press('Shift+ArrowLeft')
    assert.equal(await target.evaluate(() => window.getSelection()?.toString()), repeated)
    await workspace.getByRole('button', { name: '优化', exact: true }).click()
    const dialog = target.getByRole('dialog', { name: '✨ 选段优化', exact: true })
    await expect(dialog.locator('.selected-text-preview')).toHaveText(repeated)
    await dialog.getByPlaceholder('请描述优化方向，例如：', { exact: false }).fill('只优化当前选中的第二处雨声，保留其他文字。')
    await dialog.getByRole('button', { name: '开始优化', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '替换原文', exact: true })).toBeVisible()
    const replacement = await dialog.locator('.optimized-content').innerText()
    assert.ok(replacement.includes('联调生成片段'))
    await dialog.getByRole('button', { name: '替换原文', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(storyEditor).toHaveText(before + replacement + after)
    assert.equal((await storyEditor.innerText()).split(repeated).length - 1, 1, 'The first identical passage must remain intact')
  }))

  await step('26 Keep event targets stable through chapter moves and both deletion entry points', () => withIsolatedPage('26-chapter-event-links', async target => {
    const timestamp = new Date().toISOString()
    const fixture = {
      format: 'llm-writer-backup', version: 2, exportTime: timestamp,
      data: { novels: [{
        id: 26000, title: '事件关联回归', genre: 'fantasy', tags: [], createdAt: timestamp, updatedAt: timestamp,
        chapterList: ['甲章', '乙章', '丙章'].map((title, index) => ({ id: 26001 + index, title, content: '<p>合成正文。</p>', wordCount: 5, description: '', status: 'draft', createdAt: timestamp, updatedAt: timestamp })),
        events: [
          { id: 26101, title: '甲事件', chapter: '1', extension: { retained: true } },
          { id: 26102, title: '乙事件', chapter: 2 },
          { id: 26103, title: '丙事件', chapter: '丙章' },
          { id: 26104, title: '旧规划事件', chapter: '尚未写到的章节' },
        ],
      }] },
    }
    await settingsData(target)
    await importBackup({ name: 'chapter-event-links.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) }, target)
    const novel = () => target.evaluate(() => JSON.parse(localStorage.getItem('novels') || '[]').find(item => item.id === 26000))
    const links = async () => (await novel()).events.map(event => event.chapter)
    await go('chapters', target)
    const managementChapter = title => target.locator('.chapter-item').filter({ has: target.locator('h4', { hasText: title }) })
    await managementChapter('甲章').locator('.el-dropdown button').click()
    await target.getByRole('menuitem', { name: '下移', exact: true }).click()
    await expect.poll(links).toEqual(['2', 1, '3', '尚未写到的章节'])
    await expect(target.locator('.chapter-title h4')).toHaveText(['乙章', '甲章', '丙章'])
    await target.reload()
    await dismissAnnouncement(target)
    await managementChapter('甲章').locator('.el-dropdown button').click()
    await target.getByRole('menuitem', { name: '删除', exact: true }).click()
    await target.getByRole('dialog', { name: '确认删除', exact: true }).getByRole('button', { name: '确定', exact: true }).click()
    await expect.poll(links).toEqual(['', 1, '2', '尚未写到的章节'])
    await go('writer?novelId=26000', target)
    await target.getByRole('tab', { name: '📊 事件线', exact: true }).click()
    const event = title => target.locator('.event-item').filter({ hasText: title })
    await expect(event('甲事件')).toContainText('未指定章节')
    await expect(event('乙事件')).toContainText('第1章 乙章')
    await expect(event('丙事件')).toContainText('第2章 丙章')
    await target.getByRole('tab', { name: '📝 编辑', exact: true }).click()
    await target.locator('.chapter-item').filter({ has: target.locator('.chapter-info > p', { hasText: '乙章' }) }).locator('.el-dropdown button').hover()
    await target.getByRole('menuitem', { name: '删除', exact: true }).click()
    await target.getByRole('dialog', { name: '确认删除', exact: true }).getByRole('button', { name: /^(OK|确定)$/ }).click()
    await expect.poll(links).toEqual(['', '', '1', '尚未写到的章节'])
    await expect(target.locator('.saving-indicator')).toHaveCount(0)
    await target.reload()
    await dismissAnnouncement(target)
    await target.getByRole('tab', { name: '📊 事件线', exact: true }).click()
    await expect(event('乙事件')).toContainText('未指定章节')
    await expect(event('丙事件')).toContainText('第1章 丙章')
    assert.deepEqual((await novel()).events[0].extension, { retained: true })
  }))

  await step('27 Save, reopen, update and delete a book-analysis reference report after reload', () => withIsolatedPage('27-book-analysis-library', async target => {
    await go('book-analysis', target)
    await target.locator('.upload-area input[type="file"]').setInputFiles({ name: 'reference-source.txt', mimeType: 'text/plain', buffer: Buffer.from('第一章 清晨\n旅人沿河走向城门。') })
    await expect(target.locator('.file-name')).toHaveText('reference-source.txt')
    const reportTitle = '拆书参考库浏览器回归'
    const reportText = '主题：旅人与归途。\n叙事结构：从清晨出发，在河岸完成转折。'
    const analysis = target.locator('.analysis-editor textarea')
    await analysis.fill(reportText)
    const saveReport = async () => {
      await target.locator('.right-panel').getByRole('button', { name: '保存', exact: true }).click()
      const saveDialog = target.getByRole('dialog', { name: '保存拆书报告', exact: true })
      await saveDialog.getByPlaceholder('请输入报告标题').fill(reportTitle)
      await saveDialog.getByRole('button', { name: '保存报告', exact: true }).click()
      await expect(saveDialog).toBeHidden()
    }
    const records = () => target.evaluate(() => JSON.parse(localStorage.getItem('bookAnalysisLibrary') || '[]'))
    await saveReport()
    await expect.poll(async () => (await records()).length).toBe(1)
    const original = (await records())[0]
    assert.equal(original.sourceFileName, 'reference-source.txt')
    await target.reload()
    await dismissAnnouncement(target)
    await expect(target.locator('.file-name')).toHaveCount(0)
    await target.getByRole('button', { name: '拆书参考库', exact: true }).click()
    const library = target.getByRole('dialog', { name: '拆书参考库', exact: true })
    const row = library.locator('.library-report').filter({ hasText: reportTitle })
    await row.getByRole('button', { name: '打开报告', exact: true }).click()
    await expect(library).toBeHidden()
    await expect(analysis).toHaveValue(reportText)
    await analysis.fill('')
    await expect(analysis).toHaveValue('')
    const updated = reportText + '\n补充：第二次阅读补充人物动机。'
    await analysis.fill(updated)
    await saveReport()
    await expect.poll(async () => (await records())[0]?.content).toBe(updated)
    assert.equal((await records()).length, 1)
    assert.equal((await records())[0].id, original.id)
    await target.getByRole('button', { name: '拆书参考库', exact: true }).click()
    await row.getByRole('button', { name: '删除', exact: true }).click()
    await target.getByRole('dialog', { name: '删除参考报告', exact: true }).getByRole('button', { name: /^(OK|确定)$/ }).click()
    await expect(library.locator('.library-report')).toHaveCount(0)
    await expect.poll(async () => (await records()).length).toBe(0)
    await target.reload()
    await dismissAnnouncement(target)
    await target.getByRole('button', { name: '拆书参考库', exact: true }).click()
    await expect(library.getByText('暂无保存的拆书报告', { exact: true })).toBeVisible()
  }))

  await step('28 Test API drafts without persisting them and cancel closed-dialog requests', () => withIsolatedPage('28-api-draft-isolation', async target => {
    await configureDisposableApi(target)
    const storedConfig = () => target.evaluate(() => localStorage.getItem('apiConfig'))
    const saved = await storedConfig()
    assert.equal(JSON.parse(saved).selectedModel, 'writer-mock')
    await selectMockModel(target, 'writer-mock-slow')
    await target.getByRole('button', { name: '添加请求头', exact: true }).click()
    await target.getByPlaceholder('Header 名称').fill('x-regression-draft')
    await target.getByPlaceholder('值', { exact: true }).fill('unsaved-draft')
    const waitForModels = () => target.waitForRequest(request => request.method() === 'GET' && request.url() === `${mockURL}/models`)
    let probe = waitForModels()
    await target.getByRole('button', { name: '测试连接', exact: true }).click()
    assert.equal((await (await probe).allHeaders())['x-regression-draft'], 'unsaved-draft')
    await expect(target.getByText('连接测试成功', { exact: true })).toBeVisible()
    assert.equal(await storedConfig(), saved)
    await target.getByPlaceholder('请输入API密钥').fill('preview-invalid-draft-key')
    probe = waitForModels()
    await target.getByRole('button', { name: '测试连接', exact: true }).click()
    assert.equal((await (await probe).allHeaders()).authorization, 'Bearer preview-invalid-draft-key')
    await expect(target.locator('.el-message--error').filter({ hasText: '连接测试失败' })).toBeVisible()
    assert.equal(await storedConfig(), saved)
    await target.reload()
    await dismissAnnouncement(target)
    await expect(target.getByPlaceholder('请输入API密钥')).toHaveValue('preview-test-key')
    await expect(target.locator('.el-form-item').filter({ hasText: '模型选择' }).locator('.el-select__wrapper')).toHaveText('writer-mock')
    await expect(target.getByPlaceholder('Header 名称')).toHaveCount(0)
    assert.equal(await storedConfig(), saved)

    await go('', target)
    for (const action of ['probe', 'models']) {
      const cachedModels = await target.evaluate(() => localStorage.getItem('providerModels'))
      await target.getByRole('button', { name: 'API已配置', exact: true }).click()
      const dialog = target.getByRole('dialog', { name: 'API配置', exact: true })
      await expect(dialog).toBeVisible()
      let release
      let reached
      let finished
      const gate = new Promise(resolve => { release = resolve })
      const intercepted = new Promise(resolve => { reached = resolve })
      const handled = new Promise(resolve => { finished = resolve })
      const holdModels = async route => {
        reached()
        try {
          await gate
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'closed-dialog-late-model' }] }) })
        } catch {
          // AbortController may cancel the intercepted request before fulfillment.
        } finally {
          finished()
        }
      }
      await target.route(`${mockURL}/models`, holdModels)
      try {
        const cancelled = target.waitForEvent('requestfailed', { predicate: request => request.url() === `${mockURL}/models` })
        await dialog.getByRole('button', { name: action === 'probe' ? '测试连接' : /^(获取|同步)模型列表$/, exact: true }).click()
        await intercepted
        await dialog.locator('.el-dialog__headerbtn').click()
        await expect(dialog).toBeHidden()
        await cancelled
        release()
        await handled
        assert.equal(await storedConfig(), saved)
        assert.equal(await target.evaluate(() => localStorage.getItem('providerModels')), cachedModels, 'Closing the API dialog must discard a delayed model response')
        await expect(target.getByText('连接测试成功', { exact: true })).toHaveCount(0)
        await expect(target.getByText(/已同步.*模型/)).toHaveCount(0)
      } finally {
        release()
        await target.unroute(`${mockURL}/models`, holdModels)
      }
    }
  }))

  await step('29 Require explicit detected chapters and preserve book heading boundaries', () => withIsolatedPage('29-book-analysis-scope', async target => {
    await configureDisposableApi(target)
    await go('book-analysis', target)
    const source = '第一章 清晨\r\n他说：“第十章的线索还没解开。”\r\n' + '首章独有的街道。'.repeat(700) + '\r\n第二章 终点\r\n最终线索只在第二章。';
    await target.locator('.upload-area input[type="file"]').setInputFiles({ name: 'explicit-chapters.txt', mimeType: 'text/plain', buffer: Buffer.from(source) })
    await expect(target.locator('.file-name')).toHaveText('explicit-chapters.txt')
    await target.locator('.setting-item').filter({ hasText: '拆书模板' }).locator('.el-select__wrapper').click()
    await target.locator('.el-select-dropdown:visible').getByRole('option').first().click()
    const start = target.getByRole('button', { name: '开始拆书分析', exact: true })
    await expect(start).toBeDisabled()
    await target.locator('.setting-item').filter({ hasText: '章节选择' }).locator('.el-select__wrapper').click()
    const chapters = target.locator('.el-select-dropdown:visible').getByRole('option')
    await expect(chapters).toHaveCount(2)
    await chapters.filter({ hasText: '第二章 终点' }).click()
    await target.keyboard.press('Escape')
    await expect(start).toBeEnabled()
    const request = target.waitForRequest(request => request.method() === 'POST' && request.url() === `${mockURL}/chat/completions`)
    await start.click()
    const sent = JSON.stringify((await request).postDataJSON().messages)
    assert.ok(sent.includes('最终线索只在第二章。'))
    assert.ok(!sent.includes('首章独有的街道。'), 'Only explicitly selected chapter content may be sent')
    await expect(target.locator('.analysis-editor textarea')).toHaveValue(/联调生成片段/)
    await expect(start).toBeEnabled()
    await target.getByRole('button', { name: '清空', exact: true }).click()
    await expect(start).toBeDisabled()
  }))

  await step('30 Retain invalid outline replies and survive autosave before retrying', () => withIsolatedPage('30-writer-outline-and-polish', async target => {
    await configureDisposableApi(target)
    await settingsData(target)
    const fixture = { novels: [{ id: 30000, title: '生成边界测试', genre: 'fantasy', chapterList: [{ id: 30001, title: '现有章节', description: '主角抵达河岸', content: '<p>原有正文。</p>', wordCount: 5, status: 'draft' }] }] }
    await importBackup({ name: 'outline-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) }, target)
    await go('writer?novelId=30000', target)
    const novel = () => target.evaluate(() => JSON.parse(localStorage.getItem('novels') || '[]').find(item => item.id === 30000))
    const openBatch = async () => {
      await target.getByRole('button', { name: '新增章节', exact: true }).hover()
      await target.getByRole('menuitem', { name: 'AI批量生成', exact: true }).click()
      const dialog = target.getByRole('dialog', { name: 'AI批量生成章节', exact: true })
      await dialog.locator('.el-input-number input').fill('3')
      return dialog
    }
    let dialog = await openBatch()
    await dialog.getByRole('button', { name: '批量生成', exact: true }).click()
    await expect(dialog.locator('.el-alert--error')).toBeVisible()
    await expect(dialog.locator('.streaming-text-plain')).toContainText('联调生成片段 3')
    assert.equal((await novel()).chapterList.length, 1, 'An unstructured reply cannot create a fallback chapter')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()

    const latest = '刚刚补写：<林> A & B 😀。'
    await target.locator('.editor-panel [contenteditable="true"]').fill(latest)
    dialog = await openBatch()
    let release
    const gate = new Promise(resolve => { release = resolve })
    const completion = ['章节1：\n标题：启程\n大纲：主角准备出发。', '章节2：\n标题：河岸\n大纲：主角在河岸遇见朋友。', '章节3：\n标题：归途\n大纲：两人结伴返回。'].join('\n')
    const heldResponse = async route => {
      await gate
      const common = { id: 'outline-regression', object: 'chat.completion.chunk', created: 1, model: 'writer-mock' }
      const chunks = [
        { ...common, choices: [{ index: 0, delta: { content: completion }, finish_reason: null }] },
        { ...common, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 24, total_tokens: 36 } },
      ]
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n' })
    }
    await target.route(`${mockURL}/chat/completions`, heldResponse)
    try {
      const sent = target.waitForRequest(request => request.method() === 'POST' && request.url() === `${mockURL}/chat/completions`)
      await dialog.getByRole('button', { name: '批量生成', exact: true }).click()
      await sent
      await expect.poll(async () => (await novel()).chapterList[0].wordCount).toBe([...latest.replace(/\s/g, '')].length)
      release()
      await expect(dialog).toBeHidden()
      await expect.poll(async () => (await novel()).chapterList.length).toBe(4)
      assert.deepEqual((await novel()).chapterList.map(chapter => chapter.title), ['现有章节', '启程', '河岸', '归途'])
    } finally {
      release()
      await target.unroute(`${mockURL}/chat/completions`, heldResponse)
    }
    await target.locator('.chapter-item').filter({ has: target.locator('.chapter-info > p', { hasText: '现有章节' }) }).click()
    await target.getByRole('button', { name: '优化', exact: true }).click()
    const polish = target.getByRole('dialog', { name: 'AI文本润色', exact: true })
    await expect(polish.locator('.original-content-textarea textarea')).toHaveValue(latest)
    await polish.locator('.prompt-item').first().click()
    const polished = target.waitForRequest(request => request.method() === 'POST' && request.url() === `${mockURL}/chat/completions`)
    await polish.getByRole('button', { name: '开始润色', exact: true }).click()
    const prompt = JSON.stringify((await polished).postDataJSON().messages)
    assert.ok(prompt.includes(latest))
    assert.ok(!prompt.includes('{原文内容}'))
    await expect(polish.getByRole('button', { name: '开始润色', exact: true })).toBeEnabled()
    await polish.getByRole('button', { name: 'Close this dialog' }).click()
    await expect(target.locator('.saving-indicator')).toHaveCount(0)
  }))


  await step('31 Keep chapter totals, safe previews and chapter-goal units consistent after reload', () => withIsolatedPage('31-management-correctness', async target => {
    const timestamp = new Date().toISOString()
    const fixture = {
      format: 'llm-writer-backup', version: 2, exportTime: timestamp,
      data: { novels: [{
        id: 31000, title: '统计与预览回归', genre: 'fantasy', tags: [], createdAt: timestamp, updatedAt: timestamp,
        wordCount: 500, totalWords: 999, chapters: 2,
        chapterList: [
          { id: 31001, title: '保留章', content: '<p>甲&nbsp;乙</p><p>&lt;林&gt;&amp;&#x1F600;</p>', wordCount: 250, description: '', status: 'draft', createdAt: timestamp, updatedAt: timestamp },
          { id: 31002, title: '删除章', content: '<p>结尾</p>', wordCount: 250, description: '', status: 'draft', createdAt: timestamp, updatedAt: timestamp },
        ],
      }] },
    }
    await settingsData(target)
    await importBackup({ name: 'management-correctness.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) }, target)
    const readNovel = () => target.evaluate(() => JSON.parse(localStorage.getItem('novels') || '[]').find(novel => novel.id === 31000))
    await go('chapters', target)
    const total = target.locator('.novel-stats .stat-item').filter({ hasText: '总字数' }).locator('.stat-value')
    await expect(total).toHaveText('9字')
    await expect(target.getByRole('button', { name: '排序', exact: true })).toBeDisabled()
    await expect(target.getByRole('button', { name: '批量编辑', exact: true })).toBeDisabled()
    const chapter = title => target.locator('.chapter-item').filter({ has: target.locator('h4', { hasText: title }) })
    await chapter('保留章').getByRole('button', { name: '预览', exact: true }).click()
    const preview = target.getByRole('dialog', { name: '章节预览', exact: true })
    await expect(preview.locator('.preview-content p')).toHaveText(['甲 乙', '<林>&😀'])
    await expect(preview.locator('.preview-content')).not.toContainText('<p>')
    await expect(preview.locator('.preview-content')).not.toContainText('&nbsp;')
    await preview.locator('.el-dialog__headerbtn').click()
    await chapter('删除章').locator('.el-dropdown button').click()
    await target.getByRole('menuitem', { name: '删除', exact: true }).click()
    await target.getByRole('dialog', { name: '确认删除', exact: true }).getByRole('button', { name: '确定', exact: true }).click()
    await expect.poll(async () => {
      const novel = await readNovel()
      return [novel.wordCount, novel.totalWords, novel.chapterList.length]
    }).toEqual([7, 7, 1])
    await target.reload()
    await dismissAnnouncement(target)
    await expect(total).toHaveText('7字')

    await go('goals', target)
    const title = '章节单位回归目标'
    await target.getByRole('button', { name: '设定新目标', exact: true }).click()
    const create = target.getByRole('dialog', { name: '创建新目标', exact: true })
    await create.getByPlaceholder('请输入目标标题').fill(title)
    await create.locator('.el-form-item').filter({ hasText: '目标类型' }).locator('.el-select__wrapper').click()
    await target.getByRole('option', { name: '章节数', exact: true }).click()
    await expect(create.locator('.el-form-item').filter({ hasText: '计量单位' }).locator('.el-select__wrapper')).toHaveText('章')
    await create.locator('.el-form-item').filter({ hasText: '目标数值' }).getByRole('spinbutton').fill('10')
    const date = new Date().toISOString().slice(0, 10)
    await create.getByPlaceholder('开始日期').fill(date)
    await create.getByPlaceholder('结束日期').fill(date)
    await create.getByPlaceholder('结束日期').press('Enter')
    await create.getByPlaceholder('请输入目标标题').click()
    await create.getByRole('button', { name: '保存', exact: true }).click()
    await expect(create).toBeHidden()
    const card = target.locator('.goal-card').filter({ hasText: title })
    await expect(card.locator('.progress-text')).toContainText('0 / 10 章')
    await card.getByRole('button', { name: '更新进度', exact: true }).click()
    const progress = target.getByRole('dialog', { name: '更新进度', exact: true })
    await progress.getByRole('spinbutton').fill('2')
    await progress.getByRole('button', { name: '保存', exact: true }).click()
    await expect(progress).toBeHidden()
    await expect(card.locator('.progress-text')).toContainText('2 / 10 章')
    await expect(target.locator('.overview-item').filter({ hasText: '今日字数' }).locator('.overview-value')).toHaveText('0')
    await target.reload()
    await dismissAnnouncement(target)
    await expect(card.locator('.progress-text')).toContainText('2 / 10 章')
    await expect(target.locator('.overview-item').filter({ hasText: '今日字数' }).locator('.overview-value')).toHaveText('0')
    const saved = await target.evaluate(goalTitle => JSON.parse(localStorage.getItem('writingGoals') || '[]').find(goal => goal.title === goalTitle), title)
    assert.equal(saved.type, 'chapters')
    assert.equal(saved.unit, '章')
    assert.equal(saved.progressHistory[0].unit, '章')
    await go('', target)
    await target.getByRole('button', { name: '管理目标', exact: true }).click()
    const manager = target.getByRole('dialog', { name: '写作目标管理', exact: true })
    await expect(manager.locator('.goal-item').filter({ hasText: title }).locator('.progress-info')).toContainText(/2\s*\/\s*10\s*章/)
  }))


  await step('32 Keep Tools novel IDs and template tasks aligned with generation parameters', () => withIsolatedPage('32-tools-contracts', async target => {
    const timestamp = new Date().toISOString()
    const title = '同名工具回归作品'
    const fixture = {
      format: 'llm-writer-backup', version: 2, exportTime: timestamp,
      data: { novels: [
        { id: 32001, title, genre: '玄幻', description: '第一本龙王专属简介', tags: [], createdAt: timestamp, updatedAt: timestamp,
          characters: [{ id: 32101, name: '龙王', description: '第一本龙族主角' }],
          chapterList: [{ id: 32201, title: '龙王章', content: '<p>第一本龙王正文。</p>', status: 'draft', createdAt: timestamp, updatedAt: timestamp }] },
        { id: 32002, title, genre: '科幻', description: '第二本星舰专属简介', tags: [], createdAt: timestamp, updatedAt: timestamp,
          characters: [{ id: 32102, name: '舰长', description: '第二本人类舰长' }],
          chapterList: [{ id: 32202, title: '星舰章', content: '<p>星舰&amp;舰长。</p><p>第二段：起航。</p>', status: 'draft', createdAt: timestamp, updatedAt: timestamp }] },
      ] },
    }
    await settingsData(target)
    await importBackup({ name: 'tools-contracts.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) }, target)
    await configureDisposableApi(target)
    await go('tools', target)
    await target.locator('.tool-card').filter({ hasText: '简介生成器' }).click()
    const synopsis = target.getByRole('dialog', { name: '简介生成器', exact: true })
    await synopsis.locator('.el-form-item').filter({ hasText: '选择小说' }).locator('.el-select__wrapper').click()
    await target.getByRole('option', { name: title, exact: true }).nth(1).click()
    await synopsis.locator('.el-form-item').filter({ hasText: '参考章节' }).locator('.el-select__wrapper').click()
    await target.getByRole('option', { name: '星舰章', exact: true }).click()
    await synopsis.locator('.el-form-item').filter({ hasText: '简介风格' }).locator('.el-select__wrapper').click()
    await target.getByRole('option', { name: '直白介绍', exact: true }).click()
    await synopsis.locator('.el-form-item').filter({ hasText: '提示词模板' }).locator('.el-select__wrapper').click()
    await expect(target.getByRole('option', { name: '基础章节生成器', exact: true })).toHaveCount(0)
    await target.getByRole('option', { name: /^简介生成器默认模板/ }).click()
    const capture = () => target.waitForRequest(request => request.method() === 'POST' && request.url() === `${mockURL}/chat/completions`)
    let sent = capture()
    await synopsis.getByRole('button', { name: '生成内容', exact: true }).click()
    let body = (await sent).postDataJSON()
    const promptText = payload => payload.messages.map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n')
    let prompt = promptText(body)
    assert.ok(prompt.includes('第二本星舰专属简介') && prompt.includes('舰长'))
    assert.ok(!prompt.includes('第一本龙王专属简介') && !prompt.includes('龙王'))
    assert.ok(prompt.includes('星舰&舰长。\n\n第二段：起航。'))
    assert.ok(prompt.includes('100-200字') && prompt.includes('简介风格：直白介绍'))
    assert.ok(!prompt.includes('Write the full prose') && !prompt.includes('[待填充]'))
    await expect(synopsis.getByPlaceholder('生成的内容将在这里显示...')).toHaveValue(/联调生成片段 3/)
    await synopsis.locator('.el-dialog__headerbtn').click()
    await expect(synopsis).toBeHidden()

    await target.locator('.tool-card').filter({ hasText: '角色生成器' }).click()
    const character = target.getByRole('dialog', { name: '角色生成器', exact: true })
    await character.getByPlaceholder('输入数量（1-15个角色）').fill('5')
    await character.locator('.el-form-item').filter({ hasText: '角色定位' }).locator('.el-select__wrapper').click()
    await target.getByRole('option', { name: '主角', exact: true }).click()
    await character.locator('.el-form-item').filter({ hasText: '性别' }).locator('.el-select__wrapper').click()
    await target.getByRole('option', { name: '女性', exact: true }).click()
    const personality = '内向但善于伪装 $& $1 $$ {count}'
    await character.getByPlaceholder('期望的性格特点').fill(personality)
    await character.locator('.el-form-item').filter({ hasText: '提示词模板' }).locator('.el-select__wrapper').click()
    await expect(target.getByRole('option', { name: '基础人物设定生成器', exact: true })).toHaveCount(0)
    await target.getByRole('option', { name: /^角色生成器默认模板/ }).click()
    sent = capture()
    await character.getByRole('button', { name: '生成内容', exact: true }).click()
    body = (await sent).postDataJSON()
    prompt = promptText(body)
    assert.ok(prompt.includes('生成数量：5个') && prompt.includes('性别：女性') && prompt.includes('角色定位：主角'))
    assert.ok(prompt.includes(personality), 'Literal dollar and placeholder-like text must reach the API unchanged')
    assert.ok(!prompt.includes('Design one') && !prompt.includes('[待填充]'))
    await expect(character.getByPlaceholder('生成的内容将在这里显示...')).toHaveValue(/联调生成片段 3/)
  }))


  await step('33 Filter usage records and render real local-calendar trends', () => withIsolatedPage('33-billing-empty-state', async target => {
    // Read the browser's calendar so fixture dates match the date picker's local timezone.
    const calendar = await target.evaluate(() => {
      const now = new Date()
      const stamp = (offset, hour, minute = 0, second = 0, millisecond = 0) => {
        const date = new Date(now)
        date.setDate(date.getDate() - offset)
        date.setHours(hour, minute, second, millisecond)
        return {
          timestamp: date.toISOString(),
          day: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        }
      }
      return { today: stamp(0, 0), yesterdayLate: stamp(1, 23, 59, 59, 999), yesterdayMorning: stamp(1, 10), fortnight: stamp(14, 12), older: stamp(60, 12) }
    })
    const record = (id, date, type, model, content, inputTokens, outputTokens) => ({
      id, timestamp: date.timestamp, type, model, content, response: '合成统计响应',
      inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cost: 0,
      status: 'success', usageSource: 'reported',
    })
    const records = [
      record(33001, calendar.yesterdayLate, 'content_generation', 'Vendor/MyModel', '截止日深夜生成记录', 20, 10),
      record(33002, calendar.yesterdayMorning, 'optimize', 'Vendor/MyModel', '截止日润色记录', 30, 15),
      record(33003, calendar.today, 'content_generation', 'Vendor/MyModel-Pro', '后一天生成记录', 10, 5),
      record(33004, calendar.fortnight, 'content_generation', 'Another/Model', '十四天前生成记录', 50, 25),
      record(33005, calendar.older, 'chat', 'Another/Model', '六十天前聊天记录', 80, 40),
    ]
    const fixture = {
      format: 'llm-writer-backup', version: 2, exportTime: new Date().toISOString(),
      data: {
        billing_records: records,
        token_usage_stats: { totalInputTokens: 190, totalOutputTokens: 95, totalCost: 0 },
      },
    }
    const importFixture = async (name, data) => {
      await settingsData(target)
      await importBackup({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) }, target)
      await go('billing', target)
    }
    await importFixture('billing-calendar-fixture.json', fixture)
    const rows = target.locator('.billing-records .el-table__body-wrapper tr.el-table__row')
    const stats = target.locator('.record-stats')
    await expect(stats).toContainText('共 5 条记录')
    const selectFilter = async (index, option) => {
      await target.locator('.filter-left .el-select').nth(index).locator('.el-select__wrapper').click()
      await target.locator('.el-select-dropdown:visible').getByRole('option', { name: option, exact: true }).click()
    }

    await selectFilter(0, '文本生成')
    await expect(stats).toContainText('共 3 条记录')
    await expect(rows.filter({ hasText: '截止日深夜生成记录' })).toHaveCount(1)
    await expect(rows.filter({ hasText: '十四天前生成记录' })).toHaveCount(1)
    await selectFilter(0, '文本润色')
    await expect(stats).toContainText('共 1 条记录')
    await expect(rows.filter({ hasText: '截止日润色记录' })).toHaveCount(1)
    await selectFilter(0, '全部')
    await selectFilter(1, 'Vendor/MyModel')
    await expect(stats).toContainText('共 2 条记录')
    await expect(rows.filter({ hasText: '后一天生成记录' })).toHaveCount(0)
    await selectFilter(1, '全部模型')

    // The end date includes its 23:59:59.999 record and excludes the following day.
    await target.getByPlaceholder('开始日期').fill(calendar.yesterdayLate.day)
    await target.getByPlaceholder('结束日期').fill(calendar.yesterdayLate.day)
    await target.getByPlaceholder('结束日期').press('Enter')
    await target.getByRole('heading', { name: 'Token 使用统计', exact: true }).click()
    await expect(target.getByPlaceholder('结束日期')).toHaveValue(calendar.yesterdayLate.day)
    await expect(stats).toContainText('共 2 条记录')
    await expect(rows.filter({ hasText: '截止日深夜生成记录' })).toHaveCount(1)
    await expect(rows.filter({ hasText: '后一天生成记录' })).toHaveCount(0)

    // The summary charts use the selected reporting period and all retained records.
    for (const [days, tokens, inputs, outputs, requests] of [[7, 90, 60, 30, 3], [30, 165, 110, 55, 4], [90, 285, 190, 95, 5]]) {
      await target.locator('.time-filter').getByText(`最近${days}天`, { exact: true }).click()
      const chart = target.getByRole('img', { name: `最近${days}天Token使用趋势，共${tokens}Token`, exact: true })
      await expect(chart).toBeVisible()
      await expect(chart.locator('rect.chart-bar')).toHaveCount(days)
      const actualTokens = await chart.locator('rect.chart-bar').evaluateAll(bars => bars.reduce((total, bar) => total + Number(bar.getAttribute('data-tokens')), 0))
      assert.equal(actualTokens, tokens)
      await expect(chart.locator(`rect[data-date="${calendar.yesterdayLate.day}"]`)).toHaveAttribute('data-tokens', '75')
      await expect(target.getByRole('img', { name: `输入${inputs}Token，输出${outputs}Token`, exact: true })).toBeVisible()
      await expect(target.locator('.period-summary').first()).toHaveText(`${requests}次请求 · ${tokens} Token`)
    }
    await screenshot('33-billing-filters-and-trends', target)

    // Import an empty ledger through the same supported UI to cover both chart empty states.
    const empty = { ...fixture, data: { billing_records: [], token_usage_stats: { totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0 } } }
    await importFixture('billing-empty-fixture.json', empty)
    await expect(stats).toContainText('共 0 条记录')
    await expect(target.getByText('该时段暂无使用记录', { exact: true })).toBeVisible()
    await expect(target.getByText('该时段未记录Token用量', { exact: true })).toBeVisible()
    await expect(target.locator('.usage-chart')).toHaveCount(0)
    await expect(target.locator('.distribution-bar')).toHaveCount(0)
  }))

  await step('34 Persist thinking settings and send the configured generation budget after reload', () => withIsolatedPage('34-generation-budget-request', async target => {
    await configureDisposableApi(target)
    const field = label => target.locator('.api-config .el-form-item').filter({
      has: target.locator('.el-form-item__label', { hasText: new RegExp(`^${label}$`) }),
    })
    const output = field('输出预算')
    const providerDefault = output.getByRole('checkbox', { name: '服务商默认', exact: true })
    await expect(providerDefault).not.toBeChecked()
    await output.getByRole('spinbutton').fill('24576')
    await output.getByRole('spinbutton').press('Tab')
    // Element Plus visually hides its native checkbox; users click the label.
    await output.locator('.el-checkbox__label').click()
    await expect(providerDefault).toBeChecked()
    await expect(output.getByRole('spinbutton')).toHaveCount(0)
    await output.locator('.el-checkbox__label').click()
    await expect(providerDefault).not.toBeChecked()
    await expect(output.getByRole('spinbutton')).toHaveValue('24576')

    // The mock model is a custom alias: choose its accepted protocol explicitly.
    await field('思考协议').locator('.el-select__wrapper').click()
    await target.getByRole('option', { name: 'OpenAI 思考强度', exact: true }).click()
    await field('思考设置').locator('.el-select__wrapper').click()
    await target.getByRole('option', { name: '按思考强度', exact: true }).click()
    await field('思考强度').locator('.el-select__wrapper').click()
    await target.getByRole('option', { name: '低', exact: true }).click()
    await target.getByRole('button', { name: '保存配置', exact: true }).click()
    const savedBudget = () => target.evaluate(() => {
      const { provider, selectedModel, maxTokens, unlimitedTokens, thinkingProtocol, thinkingMode, thinkingEffort } = JSON.parse(localStorage.getItem('apiConfig') || '{}')
      return { provider, selectedModel, maxTokens, unlimitedTokens, thinkingProtocol, thinkingMode, thinkingEffort }
    })
    const expected = {
      provider: 'custom', selectedModel: 'writer-mock', maxTokens: 24576, unlimitedTokens: false,
      thinkingProtocol: 'openai', thinkingMode: 'effort', thinkingEffort: 'low',
    }
    await expect.poll(savedBudget).toEqual(expected)
    await expect(target.getByRole('button', { name: '测试连接', exact: true })).toBeEnabled()
    await target.reload()
    await dismissAnnouncement(target)
    await expect(providerDefault).not.toBeChecked()
    await expect(output.getByRole('spinbutton')).toHaveValue('24576')
    await expect(field('模型选择').locator('.el-select__wrapper')).toHaveText('writer-mock')
    await expect(field('思考协议').locator('.el-select__wrapper')).toHaveText('OpenAI 思考强度')
    await expect(field('思考设置').locator('.el-select__wrapper')).toHaveText('按思考强度')
    await expect(field('思考强度').locator('.el-select__wrapper')).toHaveText('低')
    assert.deepEqual(await savedBudget(), expected)
    await screenshot('34-generation-budget-settings', target)

    await go('tools', target)
    await target.locator('.tool-card').filter({ hasText: '爆款书名生成器' }).click()
    const dialog = target.getByRole('dialog', { name: '爆款书名生成器', exact: true })
    await dialog.locator('.el-form-item').filter({ has: target.locator('.el-form-item__label', { hasText: /^生成数量$/ }) }).locator('.el-select__wrapper').click()
    await target.getByRole('option', { name: '5个书名', exact: true }).click()
    await dialog.locator('.el-form-item').filter({ hasText: '小说类型' }).locator('.el-select__wrapper').click()
    await target.getByRole('option', { name: '都市', exact: true }).click()
    await dialog.getByPlaceholder('输入相关关键词，用逗号分隔').fill('雨后城市,预算回归')
    const captured = target.waitForRequest(request => request.method() === 'POST' && request.url() === `${mockURL}/chat/completions`)
    await dialog.getByRole('button', { name: '生成内容', exact: true }).click()
    const body = (await captured).postDataJSON()
    assert.equal(body.model, 'writer-mock')
    assert.equal(body.stream, true)
    assert.equal(body.reasoning_effort, 'low', 'The reloaded thinking setting must reach the actual SDK request')
    assert.equal(body.max_completion_tokens, 24576, 'OpenAI-compatible reasoning requests must retain the configured total output cap')
    assert.equal(Object.hasOwn(body, 'max_tokens'), false, 'The legacy output field must not accompany max_completion_tokens')
    await expect(dialog.getByPlaceholder('生成的内容将在这里显示...')).toHaveValue(/联调生成片段 3/)
  }))

  await step('35 Configure a native Anthropic gateway and preserve its thinking budget through reload and generation', () => withIsolatedPage('35-anthropic-gateway-budget', async target => {
    const model = 'qwen3.8-flash'
    const reply = '雾港失物局：消失的雨夜来客。'
    const probes = []
    // Both mock routes stay on the guarded preview origin; no real API or key is used.
    await target.route(`${mockURL}/models`, async route => {
      probes.push(route.request())
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: model }] }) })
    })
    await target.route(`${mockURL}/messages`, async route => {
      const events = [
        { type: 'message_start', message: { id: 'native-browser-test', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 24 } },
        { type: 'message_stop' },
      ]
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('') })
    })
    const field = label => target.locator('.api-config .el-form-item').filter({
      has: target.locator('.el-form-item__label', { hasText: new RegExp(`^${label}$`) }),
    })
    await go('config', target)
    await field('服务商').locator('.el-select__wrapper').click()
    await target.getByRole('option', { name: 'Anthropic / 兼容接口', exact: true }).click()
    const address = field('API地址').getByRole('textbox')
    await expect(address).toBeEnabled()
    await expect(address).toHaveValue('https://api.anthropic.com/v1')
    await address.fill(`${mockURL}/`)
    await target.getByPlaceholder('请输入API密钥').fill('preview-test-key')
    await target.getByRole('button', { name: '获取模型列表', exact: true }).click()
    await expect(field('模型选择').locator('.el-select__wrapper')).toHaveText(model)
    await expect.poll(() => probes.length).toBe(1)
    const probeHeaders = await probes[0].allHeaders()
    assert.equal(probes[0].method(), 'GET')
    assert.equal(probeHeaders['x-api-key'], 'preview-test-key')
    assert.equal(probeHeaders['anthropic-version'], '2023-06-01')
    assert.equal(probeHeaders.authorization, undefined)

    // An unknown native model stays conservative until the user confirms its budget format.
    await field('思考设置').locator('.el-select__wrapper').click()
    await expect(target.locator('.el-select-dropdown:visible').getByRole('option')).toHaveCount(1)
    await target.getByRole('option', { name: '服务商默认', exact: true }).click()
    await field('思考协议').locator('.el-select__wrapper').click()
    await expect(target.locator('.el-select-dropdown:visible').getByRole('option')).toHaveCount(2)
    await target.getByRole('option', { name: 'Anthropic 兼容思考预算', exact: true }).click()
    await field('思考设置').locator('.el-select__wrapper').click()
    await expect(target.locator('.el-select-dropdown:visible').getByRole('option')).toHaveCount(3)
    await target.getByRole('option', { name: '按 Token 预算', exact: true }).click()
    await field('输出预算').getByRole('spinbutton').fill('4096')
    await field('输出预算').getByRole('spinbutton').press('Tab')
    await field('思考预算').getByRole('spinbutton').fill('1024')
    await field('思考预算').getByRole('spinbutton').press('Tab')
    await target.getByRole('button', { name: '保存配置', exact: true }).click()
    await expect(target.getByRole('button', { name: '测试连接', exact: true })).toBeEnabled()
    await expect.poll(() => probes.length).toBe(2)
    const savedConfig = () => target.evaluate(() => {
      const { provider, baseURL, selectedModel, thinkingProtocol, thinkingMode, thinkingBudget, maxTokens, unlimitedTokens } = JSON.parse(localStorage.getItem('apiConfig') || '{}')
      return { provider, baseURL, selectedModel, thinkingProtocol, thinkingMode, thinkingBudget, maxTokens, unlimitedTokens }
    })
    const expected = { provider: 'anthropic', baseURL: `${mockURL}/`, selectedModel: model, thinkingProtocol: 'anthropic', thinkingMode: 'budget', thinkingBudget: 1024, maxTokens: 4096, unlimitedTokens: false }
    await expect.poll(savedConfig).toEqual(expected)
    await target.reload()
    await dismissAnnouncement(target)
    await expect(address).toHaveValue(`${mockURL}/`)
    await expect(field('思考协议').locator('.el-select__wrapper')).toHaveText('Anthropic 兼容思考预算')
    await expect(field('思考设置').locator('.el-select__wrapper')).toHaveText('按 Token 预算')
    await expect(field('思考预算').getByRole('spinbutton')).toHaveValue('1024')
    await expect(field('输出预算').getByRole('spinbutton')).toHaveValue('4096')
    assert.deepEqual(await savedConfig(), expected)
    await screenshot('35-anthropic-gateway-settings', target)

    await go('tools', target)
    await target.locator('.tool-card').filter({ hasText: '爆款书名生成器' }).click()
    const dialog = target.getByRole('dialog', { name: '爆款书名生成器', exact: true })
    await dialog.locator('.el-form-item').filter({ hasText: '小说类型' }).locator('.el-select__wrapper').click()
    await target.getByRole('option', { name: '都市', exact: true }).click()
    await dialog.getByPlaceholder('输入相关关键词，用逗号分隔').fill('雾港,失物局')
    const captured = target.waitForRequest(request => request.method() === 'POST' && request.url() === `${mockURL}/messages`)
    await dialog.getByRole('button', { name: '生成内容', exact: true }).click()
    const request = await captured
    const body = request.postDataJSON()
    const headers = await request.allHeaders()
    assert.equal(headers['x-api-key'], 'preview-test-key')
    assert.equal(headers['anthropic-version'], '2023-06-01')
    assert.equal(headers.authorization, undefined)
    assert.equal(body.model, model)
    assert.equal(body.stream, true)
    assert.equal(body.max_tokens, 4096, 'The native adapter must preserve the configured total output cap')
    assert.deepEqual(body.thinking, { type: 'enabled', budget_tokens: 1024 })
    assert.equal(Object.hasOwn(body, 'max_completion_tokens'), false)
    assert.equal(Object.hasOwn(body, 'enable_thinking'), false, 'A Qwen model on a native gateway must not receive DashScope parameters')
    assert.equal(Object.hasOwn(body, 'thinking_budget'), false)
    await expect(dialog.getByPlaceholder('生成的内容将在这里显示...')).toHaveValue(reply)
  }))

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
