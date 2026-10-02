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
    await dialog.locator('.el-form-item').filter({ hasText: '生成数量' }).locator('.el-select__wrapper').click()
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
    await dialog.locator('.el-form-item').filter({ hasText: '生成数量' }).locator('.el-select__wrapper').click()
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
    await dialog.locator('.el-form-item').filter({ hasText: '生成数量' }).locator('.el-select__wrapper').click()
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
          await cleanPage.locator('.setting-item').filter({ hasText: '拆书模板' }).getByRole('combobox').click()
          const templates = cleanPage.locator('.el-select-dropdown:visible').getByRole('option')
          await expect(templates.first()).toBeVisible()
          assert.ok(await templates.count() > 0, 'Direct Book Analysis visits must have default templates')
          await templates.first().click()
          await expect(cleanPage.getByRole('button', { name: '开始拆书分析', exact: true })).toBeEnabled()
        } else {
          await cleanPage.locator('.tool-card').filter({ hasText: '细纲生成器' }).click()
          const tool = cleanPage.getByRole('dialog', { name: '细纲生成器', exact: true })
          await tool.locator('.el-form-item').filter({ hasText: '提示词模板' }).getByRole('combobox').click()
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
