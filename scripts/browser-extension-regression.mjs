/** Actual built Vue app, real local HTTP tools/providers, and real Chromium. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, expect as playwrightExpect } from '@playwright/test'
import { startExtensionFixture, CHAPTER_EVIDENCE, FINAL_REPLY } from './fixtures/extension-server.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = path.join(root, 'artifacts/browser-extensions')
await mkdir(artifacts, { recursive: true })
const fixture = await startExtensionFixture({ distDir: path.join(root, 'dist') })
const browser = await chromium.launch({ headless: true }).catch(async error => { await fixture.close(); throw error })
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, locale: 'zh-CN' })
await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
const page = await context.newPage()
const expect = playwrightExpect.configure({ timeout: 15000 })
const pageErrors = []
const blockedRequests = []
const report = { startedAt: new Date().toISOString(), tests: [] }
page.on('pageerror', error => pageErrors.push(String(error)))
await context.route('**/*', async route => {
  const url = new URL(route.request().url())
  if (['data:', 'blob:'].includes(url.protocol) || url.origin === fixture.origin) return route.continue()
  blockedRequests.push(route.request().url())
  return route.abort('blockedbyclient')
})
const novelTitle = '扩展业务联调小说'
const serverName = '灯塔 MCP 测试资料库'
const sessionToken = 'synthetic-mcp-browser-only-token'
let chapterId

async function step(name, run) {
  const entry = { name, status: 'running', durationMs: 0 }
  report.tests.push(entry)
  const start = Date.now()
  try { await run(); entry.status = 'passed'; console.log(`PASS ${name}`) }
  catch (error) { entry.status = 'failed'; entry.error = String(error.stack || error); await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }); throw error }
  finally { entry.durationMs = Date.now() - start }
}
async function dismissAnnouncement() {
  const button = page.getByRole('button', { name: '我知道了', exact: true })
  try { await button.waitFor({ state: 'visible', timeout: 2200 }); await button.click() } catch { /* no announcement */ }
}
async function go(route) { await page.goto(`${fixture.origin}/#/${route}`); await expect(page.locator('#app[data-v-app]')).not.toBeEmpty(); await dismissAnnouncement() }
const formField = (scope, label) => scope.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label').filter({ hasText: label }) })
const serverCard = () => page.locator('.server-card').filter({ hasText: serverName })
async function chooseModel(model) {
  await go('config')
  await formField(page, '模型选择').locator('.el-select__wrapper').click()
  await page.getByRole('option', { name: new RegExp(`^${model}\\s+自定义模型$`) }).click()
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page.getByText('配置保存成功', { exact: true })).toBeVisible()
}
async function send(text) { await page.getByPlaceholder('输入消息，Enter 发送，Shift+Enter 换行').fill(text); await page.getByRole('button', { name: '发送', exact: true }).click() }

try {
  await step('01 Configure a disposable real-HTTP provider through the UI', async () => {
    await go('config')
    await page.getByPlaceholder('请输入API密钥').fill('synthetic-provider-browser-key')
    await page.getByPlaceholder('例如：https://api.openai.com/v1').fill(`${fixture.origin}/__test/v1`)
    for (const model of ['extension-writing', 'extension-mcp-delay', 'extension-loop', 'extension-context-only']) {
      await page.getByPlaceholder('输入模型名称，如 qwen-max').fill(model)
      await page.getByRole('button', { name: '添加', exact: true }).click()
    }
    await formField(page, '模型选择').locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: /^extension-writing\s+自定义模型$/ }).click()
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    await expect(page.getByText('配置保存成功', { exact: true })).toBeVisible()
  })
  await step('02 MCP create/edit/discover and explicit allowlist', async () => {
    await go('settings?tab=extensions')
    await expect(page.locator('.extension-settings')).toBeVisible()
    await page.getByRole('button', { name: '添加 MCP 服务', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: '添加 MCP 服务', exact: true })
    await formField(dialog, '服务名称').locator('input').fill('灯塔 MCP 初始名称')
    await dialog.getByPlaceholder('https://example.com/mcp').fill(`${fixture.origin}/__test/mcp`)
    await formField(dialog, 'Bearer 访问令牌').locator('input').fill(sessionToken)
    await dialog.getByRole('button', { name: '保存服务', exact: true }).click()
    await expect(dialog).toBeHidden()
    const initial = page.locator('.server-card').filter({ hasText: '灯塔 MCP 初始名称' })
    await initial.getByRole('button', { name: '编辑', exact: true }).click()
    dialog = page.getByRole('dialog', { name: '编辑 MCP 服务', exact: true })
    await formField(dialog, '服务名称').locator('input').fill(serverName)
    await dialog.getByRole('button', { name: '保存服务', exact: true }).click()
    await serverCard().getByRole('button', { name: '检查连接', exact: true }).click()
    await expect(serverCard()).toContainText('读取灯塔资料')
    await expect(serverCard()).toContainText('禁止写入资料')
    // Element Plus hides its native input; interact with the visible label.
    await serverCard().locator('.tool-list .el-checkbox').filter({ hasText: '读取灯塔资料' }).click()
    await expect(serverCard().getByRole('checkbox', { name: /读取灯塔资料/ })).toBeChecked()
    await expect(serverCard().getByRole('checkbox', { name: /禁止写入资料/ })).not.toBeChecked()
    await serverCard().getByRole('button', { name: '保存工具授权', exact: true }).click()
    await expect(serverCard()).toContainText('已授权 1 个工具')
    const persisted = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))
    assert.equal(persisted.includes(sessionToken), false)
    assert.ok(fixture.mcpRequests.some(request => request.headers.authorization === `Bearer ${sessionToken}`))
  })
  await step('03 Preview MCP resource and parameterized prompt without generation', async () => {
    await serverCard().getByRole('button', { name: '资源 (1) · 手动预览', exact: true }).click()
    await serverCard().getByRole('button', { name: '读取资源', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: /资源预览/ })
    await expect(dialog).toContainText('灯塔位于城北')
    await dialog.getByRole('button', { name: 'Close this dialog' }).click()
    await serverCard().getByRole('button', { name: '提示词 (1) · 手动预览', exact: true }).click()
    await serverCard().locator('.prompt-argument input').fill('林遥')
    await serverCard().getByRole('button', { name: '获取提示词', exact: true }).click()
    dialog = page.getByRole('dialog', { name: /提示词预览/ })
    await expect(dialog).toContainText('核对 林遥 的银钥匙')
    await dialog.getByRole('button', { name: 'Close this dialog' }).click()
    assert.equal(fixture.captured.length, 0)
  })
  await step('04 Import a standard Skill and inspect before activation', async () => {
    await page.locator('.extension-settings input[type="file"][accept=".md"]').setInputFiles({ name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from('---\nname: browser-lighthouse-review\ndescription: 浏览器灯塔审校流程\n---\nbrowser-skill-activated-marker：核对章号与银钥匙交接，提供原文依据。') })
    const dialog = page.getByRole('dialog', { name: '技能内容', exact: true })
    await expect(dialog).toContainText('browser-skill-activated-marker')
    await dialog.getByRole('button', { name: 'Close this dialog' }).click()
    await page.locator('.extension-settings .el-switch').first().click()
    await expect(page.locator('.extension-settings').getByRole('switch').first()).toBeChecked()
  })
  await step('05 Create and persist author content through Writer', async () => {
    await go('novels')
    await page.getByRole('button', { name: '创建新小说', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '创建新小说', exact: true })
    await dialog.getByPlaceholder('请输入小说标题').fill(novelTitle)
    await dialog.locator('.el-select').click()
    await page.locator('.el-select-dropdown:visible').getByRole('option').first().click()
    await dialog.getByPlaceholder('请输入小说简介或点击AI生成').fill('用于实际 MCP 与 Skills 业务回归。')
    await dialog.getByRole('button', { name: '创建', exact: true }).click()
    await page.waitForURL(/#\/writer\?novelId=/)
    await page.getByRole('button', { name: '新增章节' }).hover()
    await page.getByRole('menuitem', { name: '手动创建', exact: true }).click()
    const chapter = page.getByRole('dialog', { name: '新增章节', exact: true })
    await chapter.getByPlaceholder('请输入章节标题').fill('第一章：约定')
    await chapter.getByPlaceholder('简要描述本章节内容...').fill('林遥交出银钥匙并约定重逢。')
    await chapter.getByRole('button', { name: '确定', exact: true }).click()
    await expect(chapter).toBeHidden()
    await page.locator('.chapter-item').filter({ hasText: '第一章：约定' }).click()
    await page.locator('.editor-panel [contenteditable="true"]').fill(CHAPTER_EVIDENCE)
    await expect.poll(() => page.evaluate(title => JSON.parse(localStorage.getItem('novels') || '[]').find(item => item.title === title)?.chapterList?.[0]?.content || '', novelTitle), { timeout: 20000 }).toContain(CHAPTER_EVIDENCE)
    chapterId = await page.evaluate(title => JSON.parse(localStorage.getItem('novels') || '[]').find(item => item.title === title).chapterList[0].id, novelTitle)
  })
  await step('06 Select a project and Skill, receive true tool evidence and trace', async () => {
    await go('assistants')
    await page.getByRole('button', { name: '新建', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建助手', exact: true })
    await dialog.getByPlaceholder('例如：情节构思助手').fill('灯塔审校助手')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).toBeHidden()
    const extensions = page.locator('.assistant-extensions')
    await formField(extensions, '允许读取的小说').locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: novelTitle, exact: true }).click()
    await formField(extensions, '写作 Skills').locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: /browser-lighthouse-review/ }).click()
    await page.locator('.chat-title').click()
    await send(`chapter-id=${chapterId} 请读取第一章，核对银钥匙交接。`)
    await expect(page.locator('.message-row:not(.user) .bubble')).toContainText(FINAL_REPLY)
    await page.locator('.tool-activity summary').click()
    await expect(page.locator('.tool-activity')).toContainText('writing_read_chapter · 完成')
    assert.equal(fixture.captured.length, 2)
    assert.ok(JSON.stringify(fixture.captured[0].body).includes('browser-skill-activated-marker'))
    const result = fixture.captured[1].body.messages.find(message => message.role === 'tool')
    assert.ok(JSON.stringify(result).includes(CHAPTER_EVIDENCE))
    assert.equal(fixture.metrics.forbiddenCalls, 0)
  })
  await step('07 Stop during MCP execution with no late completion or author overwrite', async () => {
    await chooseModel('extension-mcp-delay')
    await go('assistants')
    const prior = fixture.metrics.toolCalls
    await send('查询灯塔资料，等待返回后再答复。')
    await expect.poll(() => fixture.metrics.toolCalls).toBeGreaterThan(prior)
    await page.getByRole('button', { name: '停止', exact: true }).click()
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible()
    const bubbles = await page.locator('.message-row:not(.user) .bubble').allTextContents()
    fixture.releasePending()
    await delay(100)
    assert.deepEqual(await page.locator('.message-row:not(.user) .bubble').allTextContents(), bubbles)
    assert.ok((await page.evaluate(title => JSON.parse(localStorage.getItem('novels') || '[]').find(item => item.title === title).chapterList[0].content, novelTitle)).includes(CHAPTER_EVIDENCE))
  })
  await step('08 Reload retains choices and trace while forgetting MCP credentials', async () => {
    await go('settings?tab=extensions')
    await expect(serverCard()).toContainText('已设置本页令牌')
    await page.reload()
    await dismissAnnouncement()
    await expect(serverCard()).toContainText('未设置访问令牌')
    await expect(serverCard()).toContainText('已授权 1 个工具')
    await expect(page.locator('.skill-card').filter({ hasText: 'browser-lighthouse-review' })).toBeVisible()
    await serverCard().getByRole('button', { name: '编辑', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '编辑 MCP 服务', exact: true })
    await expect(formField(dialog, 'Bearer 访问令牌').locator('input')).toHaveValue('')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    assert.equal((await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))).includes(sessionToken), false)
    await go('assistants')
    await expect(page.locator('.assistant-extensions')).toContainText(novelTitle)
    await expect(page.locator('.assistant-extensions')).toContainText('browser-lighthouse-review')
    await expect(page.locator('.tool-activity').first()).toContainText('writing_read_chapter')
  })
  await step('09 Delete MCP metadata through the UI', async () => {
    await go('settings?tab=extensions')
    await serverCard().getByRole('button', { name: '删除', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: '删除服务', exact: true })
    await confirm.getByRole('button', { name: /^(确定|OK)$/ }).click()
    await expect(serverCard()).toHaveCount(0)
    assert.equal(fixture.metrics.forbiddenCalls, 0)
  })
  await step('10 Import upstream Humanizer-zh, preserve it on reload, and isolate activation from tool permissions', async () => {
    const skillPath = path.join(root, 'scripts/fixtures/humanizer-zh/SKILL.md')
    const source = await readFile(skillPath, 'utf8')
    const sourceParts = source.split(/^---\s*$/m)
    assert.equal(sourceParts.length, 3, 'The pinned upstream fixture has one frontmatter block')
    const instructions = sourceParts[2].trim()
    const skillId = 'imported:humanizer-zh'
    const readSettings = () => page.evaluate(() => JSON.parse(localStorage.getItem('extensions')))
    const readSkill = async () => (await readSettings()).importedSkills.find(skill => skill.id === skillId)
    const systemText = body => body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n')
    const assertNoTools = body => assert.deepEqual(body.tools || [], [], 'Skill metadata must not grant Read, Write, Edit, or AskUserQuestion')
    async function captureReply(prompt) {
      const before = fixture.captured.length
      await send(prompt)
      await expect.poll(() => fixture.captured.length).toBe(before + 1)
      await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible()
      await expect(page.locator('.message-row:not(.user) .bubble').last()).toContainText(FINAL_REPLY)
      return fixture.captured[before].body
    }

    // Import the actual unmodified file using the same browser control as an author.
    await page.locator('.extension-settings input[type="file"][accept=".md"]').setInputFiles(skillPath)
    let preview = page.getByRole('dialog', { name: '技能内容', exact: true })
    await expect(preview.getByRole('heading', { name: 'humanizer-zh', exact: true })).toBeVisible()
    await expect(preview).toContainText('allowed-tools 元数据已保留；工具权限由应用设置控制')
    assert.equal(await preview.locator('pre.content-preview').first().textContent(), instructions)
    const imported = await readSkill()
    assert.equal(imported.instructions, instructions)
    assert.deepEqual(imported.metadata['allowed-tools'], ['Read', 'Write', 'Edit', 'AskUserQuestion'])
    assert.equal(imported.files[0].content, source)
    await preview.getByRole('button', { name: 'Close this dialog' }).click()

    await chooseModel('extension-context-only')
    await go('assistants')
    await page.getByRole('button', { name: '新建', exact: true }).click()
    const assistant = page.getByRole('dialog', { name: '新建助手', exact: true })
    await assistant.getByPlaceholder('例如：情节构思助手').fill('第三方中文润色助手')
    // The full upstream Chinese instructions need more than the default 8k token budget.
    await assistant.locator('.el-radio').filter({ hasText: '自定义' }).click()
    await assistant.getByRole('spinbutton', { name: 'Token 预算', exact: true }).fill('32000')
    await assistant.getByRole('button', { name: '保存', exact: true }).click()
    await expect(assistant).toBeHidden()
    const extensions = page.locator('.assistant-extensions')
    const novelSelect = formField(extensions, '允许读取的小说')
    await novelSelect.locator('.el-select__wrapper').hover()
    await novelSelect.locator('.el-select__clear').click()
    await expect.poll(async () => (await readSettings()).writingToolIds).toEqual([])
    const skillsSelect = formField(extensions, '写作 Skills')
    await skillsSelect.locator('.el-select__wrapper').hover()
    await skillsSelect.locator('.el-select__clear').click()
    await expect.poll(async () => (await readSettings()).selectedSkillIds).toEqual([])
    await skillsSelect.locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: /humanizer-zh/ }).click()
    await page.locator('.chat-title').click()
    await expect.poll(async () => (await readSettings()).selectedSkillIds).toEqual([skillId])

    const activated = await captureReply('润色这句话，保留事实：项目计划在五月启动内部测试，目前还没有结果。')
    assert.ok(systemText(activated).includes(JSON.stringify(instructions)), 'The entire upstream body reaches the provider without truncation')
    assert.equal(systemText(activated).includes('browser-skill-activated-marker'), false)
    assertNoTools(activated)

    await page.reload()
    await dismissAnnouncement()
    await expect(extensions).toContainText('humanizer-zh')
    await expect.poll(readSkill).toEqual(imported)
    assert.deepEqual((await readSettings()).selectedSkillIds, [skillId])
    const reloaded = await captureReply('再次润色这句话：团队只完成了原型，尚未开始正式部署。')
    assert.ok(systemText(reloaded).includes(JSON.stringify(instructions)))
    assertNoTools(reloaded)
    await go('settings?tab=extensions')
    await page.locator('.skill-card').filter({ hasText: 'humanizer-zh' }).getByRole('button', { name: '查看内容', exact: true }).click()
    preview = page.getByRole('dialog', { name: '技能内容', exact: true })
    await expect(preview).toContainText('allowed-tools 元数据已保留；工具权限由应用设置控制')
    assert.equal(await preview.locator('pre.content-preview').first().textContent(), instructions)
    await preview.getByRole('button', { name: 'Close this dialog' }).click()

    // Deselection and the master switch independently remove instructions from the next request.
    await go('assistants')
    await skillsSelect.locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: /humanizer-zh/ }).click()
    await page.locator('.chat-title').click()
    await expect.poll(async () => (await readSettings()).selectedSkillIds).toEqual([])
    const deselected = await captureReply('请直接回复已收到。')
    assert.equal(JSON.stringify(deselected).includes('humanizer-zh'), false)
    assert.equal(systemText(deselected).includes(JSON.stringify(instructions)), false)
    assertNoTools(deselected)
    await skillsSelect.locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: /humanizer-zh/ }).click()
    await page.locator('.chat-title').click()
    await expect.poll(async () => (await readSettings()).selectedSkillIds).toEqual([skillId])
    await extensions.locator('.el-switch').click()
    await expect(extensions.getByRole('switch')).not.toBeChecked()
    const disabled = await captureReply('扩展已关闭，请直接回复已收到。')
    assert.equal(JSON.stringify(disabled).includes('humanizer-zh'), false)
    assert.equal(systemText(disabled).includes(JSON.stringify(instructions)), false)
    assertNoTools(disabled)
    assert.equal(fixture.metrics.forbiddenCalls, 0)
  })
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(blockedRequests, [])
  await page.screenshot({ path: path.join(artifacts, 'extensions-passed.png'), fullPage: true })
} catch (error) {
  report.error = String(error.stack || error)
  console.error(error)
  process.exitCode = 1
} finally {
  report.pageErrors = pageErrors
  report.blockedRequests = blockedRequests
  report.metrics = fixture.metrics
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  await context.tracing.stop({ path: path.join(artifacts, 'trace.zip') })
  await browser.close()
  fixture.releasePending()
  await fixture.close()
}
if (!process.exitCode) console.log(`Extension browser regression passed: ${report.tests.length} real Chromium business scenarios`)
