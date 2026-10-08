/**
 * Portable graph backups through the built Settings download/upload interface.
 * Only the first manuscript and a synthetic provider configuration are seeded.
 * Annotations are created in the UI; restores use independent browser contexts.
 * No graph storage internals or production globals are accessed by this suite.
 */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium, expect as playwrightExpect } from '@playwright/test'
import { startPreviewServer } from './browser-preview.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = path.join(root, 'artifacts/browser-graph-backup')
await mkdir(artifacts, { recursive: true })
const server = await startPreviewServer({ port: 0, sha: process.env.GITHUB_SHA || 'local' })
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true }).catch(error => {
  server.closeAllConnections()
  server.close()
  throw error
})
const expect = playwrightExpect.configure({ timeout: 15_000 })
const contexts = []
const errors = []
const blockedRequests = []
const modelRequests = []
const report = {
  startedAt: new Date().toISOString(),
  fixture: 'Four-chapter synthetic author manuscript; one local model response; no external services',
  tests: [], screenshots: [],
}
const novelId = 49301
const projectId = `novel:${novelId}`
const chapterIds = [49302, 49303, 49304, 49305]
const texts = [
  '青岚在旧仓库发现航海图，准备明日交给船长。',
  '青岚把铜铃系在窗边，约定三声铃响后前往西渡口。',
  '船长等在西渡口，听见三声铜铃便开始接应。',
  '终局才揭晓：玄衣客的真名是顾行，先前无人知道。',
]
const revisedText = '青岚在旧仓库发现潮汐册，准备明日交给船长。'
const stamp = '2026-10-08T00:00:00.000Z'
const fixtureNovel = {
  id: novelId, title: '图谱备份恢复验收作品', genre: 'fantasy', description: 'Synthetic backup acceptance.',
  tags: [], status: 'writing', createdAt: stamp, updatedAt: stamp,
  chapters: 4, wordCount: texts.join('').length, totalWords: texts.join('').length,
  characters: [], worldSettings: [], events: [], corpusData: [],
  chapterList: texts.map((text, index) => ({
    id: chapterIds[index], title: ['第一章：仓库', '第二章：铜铃伏笔', '第三章：接应', '第四章：身份揭晓'][index],
    content: `<p>${text}</p>`, status: 'draft', tags: [], wordCount: text.length, createdAt: stamp, updatedAt: stamp,
  })),
}
const predicates = { old: '在仓库发现', clue: '三声铃响指向接应地点', inference: '铜铃可能用于船长接应', future: '终局真名是' }
let page
let originalExport
let staleExport
let originalGraph

async function newContext(name, seed = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, locale: 'zh-CN', acceptDownloads: true })
  contexts.push({ context, name })
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
  context.on('page', target => {
    target.setDefaultTimeout(15_000)
    target.on('pageerror', error => errors.push(String(error.stack || error)))
  })
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin && url.pathname === '/__test/graph-backup/v1/chat/completions') {
      const body = request.postDataJSON()
      modelRequests.push(body)
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        id: 'backup-synthetic-response', created: 1, model: body.model, object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ relations: [{
          source: { type: 'object', label: '铜铃' }, target: { type: 'person', label: '船长' },
          predicate: predicates.inference, origin: 'inferred', evidence: [1, 2],
        }] }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 30, completion_tokens: 30, total_tokens: 60 },
      }) })
      return
    }
    if (['data:', 'blob:'].includes(url.protocol) || url.origin === origin) return route.continue()
    blockedRequests.push(`${url.origin}${url.pathname}`)
    await route.abort('blockedbyclient')
  })
  if (seed) await context.addInitScript(({ novel, fixtureOrigin }) => {
    if (location.origin !== fixtureOrigin) return
    if (localStorage.getItem('novels') === null) localStorage.setItem('novels', JSON.stringify([novel]))
    if (localStorage.getItem('apiConfig') === null) localStorage.setItem('apiConfig', JSON.stringify({
      apiKey: 'synthetic-backup-key', baseURL: `${fixtureOrigin}/__test/graph-backup/v1`, provider: 'custom',
      selectedModel: 'backup-fixture', maxTokens: 2048, unlimitedTokens: false, temperature: 0,
      thinkingProtocol: 'auto', thinkingMode: 'default', customHeaders: {},
    }))
  }, { novel: fixtureNovel, fixtureOrigin: origin })
  return context.newPage()
}
const memory = id => page.getByTestId(`memory-${id}`)
const graph = id => page.getByTestId(`fact-graph-${id}`)
const relations = () => page.locator('[data-testid^="fact-graph-relation-"]')
const graphFrom = backup => {
  assert.ok(Array.isArray(backup.data.factGraphs), 'Novel backups must explicitly include the graph sidecar')
  return backup.data.factGraphs.find(document => document.projectId === projectId)
}
const graphContent = document => {
  assert.ok(document)
  const { revision, ...content } = document
  assert.equal(typeof revision, 'string')
  assert.ok(revision.length > 0, 'A persisted document needs a concurrency revision')
  return content
}
const filePayload = (name, backup) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
async function dismissAnnouncement(target = page) {
  const button = target.getByRole('button', { name: '我知道了', exact: true })
  try { await button.waitFor({ state: 'visible', timeout: 2200 }) } catch { return }
  await button.click()
}
async function step(name, run) {
  const entry = { name, status: 'running' }
  report.tests.push(entry)
  const started = Date.now()
  console.log(`START ${name}`)
  try { await run(); entry.status = 'passed'; console.log(`PASS  ${name}`) } catch (error) {
    entry.status = 'failed'; entry.error = String(error.stack || error)
    await page?.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {})
    throw error
  } finally { entry.durationMs = Date.now() - started }
}
async function screenshot(name) {
  const filename = `${name}.png`
  await page.screenshot({ path: path.join(artifacts, filename), fullPage: true })
  report.screenshots.push(filename)
}
async function settingsData() {
  await page.goto(`${origin}/#/settings`)
  await dismissAnnouncement()
  await page.getByRole('tab', { name: '数据管理', exact: true }).click()
  await expect(page.getByRole('button', { name: '导出所有数据', exact: true })).toBeVisible()
}
async function exportBackup(name, novelsOnly = true) {
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: novelsOnly ? '小说数据' : '导出所有数据', exact: true }).click()
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
  await Promise.all([page.waitForEvent('load'), completed.getByRole('button', { name: '确定', exact: true }).click()])
  await dismissAnnouncement()
}
async function openGraph(cutoff = chapterIds[3]) {
  await page.goto(`${origin}/#/memory`)
  await dismissAnnouncement()
  await expect(memory('search')).toBeEnabled()
  await memory('source').selectOption(projectId)
  await expect(memory('search')).toBeEnabled()
  await expect(graph('canvas')).toBeVisible()
  await memory('cutoff').selectOption(String(cutoff))
  await expect(memory('cutoff')).toHaveValue(String(cutoff))
  await expect(graph('query')).toBeVisible()
  await graph('query').fill('')
}
async function selectCutoff(index) {
  await memory('cutoff').selectOption(String(chapterIds[index]))
  await expect(memory('cutoff')).toHaveValue(String(chapterIds[index]))
  await expect(graph('query')).toBeVisible()
}
async function choose(predicate) {
  await graph('query').fill(predicate)
  await expect(relations()).toHaveCount(1)
  await relations().first().click()
  await expect(graph('evidence')).toContainText(predicate)
}
async function addAnchor(index) {
  await graph('chapter').selectOption(String(chapterIds[index]))
  await graph('quote-input').fill(texts[index])
  await graph('add-evidence').click()
  await expect(graph('anchors')).toContainText(texts[index])
}
async function authorRelation(index, source, sourceType, target, targetType, predicate) {
  await graph('create').click()
  await addAnchor(index)
  await graph('source-label').fill(source)
  await graph('source-type').selectOption(sourceType)
  await graph('target-label').fill(target)
  await graph('target-type').selectOption(targetType)
  await graph('predicate').fill(predicate)
  await graph('save').click()
  await expect(graph('form')).toHaveCount(0)
  await choose(predicate)
  await graph('confirm').click()
  await expect(graph('provenance')).toContainText('作者确认')
}

try {
  await step('01 Create author facts, a distant clue and a confirmed multi-source model inference in the real UI', async () => {
    page = await newContext('source', true)
    await openGraph()
    await authorRelation(0, '青岚', 'person', '航海图', 'object', predicates.old)
    await authorRelation(1, '铜铃', 'object', '西渡口', 'place', predicates.clue)
    await authorRelation(3, '玄衣客', 'person', '顾行', 'person', predicates.future)
    await graph('create').click()
    await addAnchor(1)
    await addAnchor(2)
    await graph('extract').click()
    await expect(graph('accept-0')).toBeVisible()
    await graph('accept-0').click()
    await choose(predicates.inference)
    await expect(graph('provenance')).toContainText('模型推断')
    await graph('confirm').click()
    await expect(graph('provenance')).toContainText('作者确认')
    await expect(graph('provenance')).toContainText('模型推断')
    await expect(graph('quote')).toHaveCount(2)
    assert.equal(modelRequests.length, 1)
    const user = modelRequests[0].messages.find(message => message.role === 'user')
    assert.ok(user.content.startsWith('SOURCE_EXCERPTS_JSON\n'))
    assert.deepEqual(JSON.parse(user.content.slice('SOURCE_EXCERPTS_JSON\n'.length)), {
      sources: [texts[1], texts[2]].map((quote, index) => ({ reference: index + 1, quote })),
    })
    assert.equal(modelRequests[0].tools, undefined)
    await screenshot('source-confirmed-inference')
  })

  await step('02 Full and novels-only downloads carry identical portable graph annotations and chapter anchors', async () => {
    await settingsData()
    originalExport = await exportBackup('novels-with-graphs.json')
    const complete = await exportBackup('complete-with-graphs.json', false)
    assert.equal(originalExport.data.format, 'llm-writer-backup')
    assert.equal(originalExport.data.version, 2)
    assert.deepEqual(originalExport.data.data.novels, [fixtureNovel])
    originalGraph = graphFrom(originalExport.data)
    assert.equal(originalGraph.relations.length, 4)
    assert.equal(originalExport.data.data.factGraphs.length, 1, 'The private memory demo is excluded')
    assert.deepEqual(graphFrom(complete.data), originalGraph)
    assert.equal(originalExport.data.data.apiConfig, undefined, 'Novel-only export must not include API settings')
    for (const relation of originalGraph.relations) {
      assert.equal(relation.authorConfirmed, true)
      assert.equal(relation.projectId, projectId)
      for (const anchor of relation.evidence) {
        assert.match(anchor.sourceRevision, /^[a-f0-9]{64}$/)
        const index = chapterIds.indexOf(Number(anchor.chapterId))
        assert.equal(texts[index].slice(anchor.start, anchor.end), anchor.quote)
      }
    }
    const inferred = originalGraph.relations.find(relation => relation.predicate === predicates.inference)
    assert.equal(inferred.origin, 'inferred')
    assert.equal(inferred.createdBy, 'model')
    assert.equal(inferred.evidence.length, 2)
    report.exported = { novels: 1, chapters: 4, relationships: 4, anchors: 5, modelInferences: 1 }
  })

  await step('03 Restore a downloaded file in a clean browser and verify source revisions and provenance round-trip', async () => {
    page = await newContext('restored')
    await settingsData()
    const initial = await exportBackup('fresh-browser.json')
    assert.equal(initial.data.data.novels?.some(novel => novel.id === novelId) || false, false)
    await importBackup(originalExport.target)
    await settingsData()
    const restored = await exportBackup('restored-roundtrip.json')
    assert.deepEqual(restored.data.data.novels, originalExport.data.data.novels)
    assert.deepEqual(graphContent(graphFrom(restored.data)), graphContent(originalGraph))
    assert.notEqual(graphFrom(restored.data).revision, originalGraph.revision, 'Restore must rotate the concurrency token')
    await openGraph()
    await choose(predicates.inference)
    await expect(graph('provenance')).toContainText('作者确认')
    await expect(graph('provenance')).toContainText('模型推断')
    await expect(graph('quote')).toHaveText([texts[1], texts[2]])
    const anchors = originalGraph.relations.find(relation => relation.predicate === predicates.inference).evidence
    await expect(graph('revision')).toHaveText(anchors.map(anchor => anchor.sourceRevision))
    await screenshot('restored-confirmation-and-evidence')
  })

  await step('04 Restored clue survives reload while all inference premises and future identities obey disclosure', async () => {
    await selectCutoff(1)
    await graph('query').fill(predicates.inference)
    await expect(relations()).toHaveCount(0)
    await expect(graph('evidence')).toHaveCount(0)
    await graph('query').fill('玄衣客')
    await expect(relations()).toHaveCount(0)
    await expect(graph('canvas')).toHaveAttribute('data-edge-count', '0')
    await graph('query').fill('铜铃')
    await expect(relations()).toHaveCount(1)
    await relations().first().click()
    await expect(graph('quote')).toHaveText([texts[1]])
    await expect(graph('evidence')).toContainText('第 2 章')
    await page.reload()
    await dismissAnnouncement()
    await expect(memory('search')).toBeEnabled()
    await memory('source').selectOption(projectId)
    await expect(memory('search')).toBeEnabled()
    await selectCutoff(1)
    await choose(predicates.clue)
    await expect(graph('provenance')).toContainText('作者确认')
    await selectCutoff(2)
    await choose(predicates.inference)
    await expect(graph('quote')).toHaveCount(2)
    await selectCutoff(3)
    await choose(predicates.future)
    await expect(graph('quote')).toHaveText([texts[3]])
    await selectCutoff(1)
    await expect(relations()).toHaveCount(0)
    await expect(graph('evidence')).toHaveCount(0)
    await expect(graph('list')).not.toContainText('玄衣客')
    await choose(predicates.clue)
    await screenshot('restored-early-clue-with-future-hidden')
  })

  await step('05 An actual Writer edit invalidates confirmed old facts and keeps their original anchors in the next backup', async () => {
    await page.goto(`${origin}/#/writer?novelId=${novelId}`)
    await dismissAnnouncement()
    const editor = page.locator('.editor-panel [contenteditable="true"]')
    await expect(editor).toContainText(texts[0])
    await editor.fill(revisedText)
    await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem('novels') || '[]')
      .find(novel => novel.id === id)?.chapterList?.[0]?.content || '', novelId), { timeout: 20_000 }).toContain(revisedText)
    await expect(page.locator('.saving-indicator')).toHaveCount(0)
    await openGraph()
    await graph('query').fill(predicates.old)
    await expect(relations()).toHaveCount(0)
    await expect(graph('evidence')).toHaveCount(0)
    await choose(predicates.clue)
    await settingsData()
    staleExport = await exportBackup('edited-novel-stale-anchors.json')
    assert.deepEqual(graphContent(graphFrom(staleExport.data)), graphContent(originalGraph), 'Backups must retain stale anchors, never relabel them with new source revisions')
    const chapters = staleExport.data.data.novels[0].chapterList
    assert.ok(chapters[0].content.includes(revisedText))
    for (let index = 1; index < chapters.length; index++) assert.equal(chapters[index].content, fixtureNovel.chapterList[index].content)
    report.writerEdit = { changedChapters: 1, unchangedChapters: 3, oldGraphAnchorsPreserved: true }
  })

  await step('06 A second clean restore never revives stale facts and still finds the independent early clue', async () => {
    page = await newContext('restored-after-edit')
    await settingsData()
    await importBackup(staleExport.target)
    await openGraph(chapterIds[1])
    await graph('query').fill('航海图')
    await expect(relations()).toHaveCount(0)
    await expect(graph('canvas')).toHaveAttribute('data-edge-count', '0')
    await choose(predicates.clue)
    await expect(graph('quote')).toHaveText([texts[1]])
    await graph('query').fill('玄衣客')
    await expect(relations()).toHaveCount(0)
    await selectCutoff(3)
    await choose(predicates.future)
    await graph('query').fill('航海图')
    await expect(relations()).toHaveCount(0)
    await memory('query').fill('潮汐册')
    await memory('search').click()
    await expect(memory('search')).toBeEnabled()
    await page.getByTestId('memory-result-0').click()
    await expect(memory('evidence-quote')).toHaveText(revisedText)
    const oldAnchor = originalGraph.relations.find(relation => relation.predicate === predicates.old).evidence[0]
    await expect(memory('evidence-revision')).not.toHaveText(oldAnchor.sourceRevision)
    await screenshot('restored-new-prose-old-fact-excluded')
  })

  await step('07 Malformed graph imports and cancelled valid imports leave prose and annotations unchanged', async () => {
    await settingsData()
    const before = await exportBackup('before-invalid-import.json')
    const invalid = structuredClone(staleExport.data)
    invalid.data.novels[0].title = '不得写入的无效备份'
    invalid.data.factGraphs[0].relations[0].evidence[0].sourceRevision = 'invalid-revision'
    await page.locator('.data-management input[type="file"]').setInputFiles(filePayload('invalid-graph.json', invalid))
    await expect(page.locator('.el-message--error')).toBeVisible()
    await expect(page.getByRole('dialog', { name: '确认导入', exact: true })).toHaveCount(0)
    const afterInvalid = await exportBackup('after-invalid-import.json')
    assert.deepEqual(afterInvalid.data.data, before.data.data)
    await page.locator('.data-management input[type="file"]').setInputFiles(originalExport.target)
    const confirm = page.getByRole('dialog', { name: '确认导入', exact: true })
    await confirm.getByRole('button', { name: '取消', exact: true }).click()
    await expect(confirm).toBeHidden()
    const afterCancel = await exportBackup('after-cancelled-import.json')
    assert.deepEqual(afterCancel.data.data, before.data.data)
  })

  await step('08 Legacy novel import retains annotations while changed source invalidates affected clue and inference', async () => {
    const legacyNovels = structuredClone(staleExport.data.data.novels)
    legacyNovels[0].chapterList[1].content = `<p>${texts[1].replaceAll('铜铃', '木哨')}</p>`
    await importBackup(filePayload('legacy-novels.json', { novels: legacyNovels }))
    await settingsData()
    const legacy = await exportBackup('legacy-preserved-graphs.json')
    assert.deepEqual(graphContent(graphFrom(legacy.data)), graphContent(originalGraph))
    assert.deepEqual(legacy.data.data.novels, legacyNovels)
    await openGraph()
    await graph('query').fill(predicates.clue)
    await expect(relations()).toHaveCount(0)
    await graph('query').fill(predicates.inference)
    await expect(relations()).toHaveCount(0)
    await choose(predicates.future)
    await expect(graph('provenance')).toContainText('作者确认')
  })

  await step('09 An explicit empty graph sidecar clears imported annotations without losing novel content', async () => {
    await settingsData()
    const before = await exportBackup('before-explicit-empty.json')
    const cleared = structuredClone(before.data)
    cleared.data.factGraphs = []
    await importBackup(filePayload('explicit-empty-graphs.json', cleared))
    await settingsData()
    const after = await exportBackup('after-explicit-empty.json')
    assert.deepEqual(after.data.data.novels, before.data.data.novels)
    assert.ok(after.data.data.factGraphs.every(document => document.relations.length === 0))
    await openGraph()
    await expect(relations()).toHaveCount(0)
    await expect(graph('canvas')).toHaveAttribute('data-edge-count', '0')
    await page.reload()
    await dismissAnnouncement()
    await expect(memory('search')).toBeEnabled()
    await memory('source').selectOption(projectId)
    await expect(memory('search')).toBeEnabled()
    await selectCutoff(3)
    await graph('query').fill('')
    await expect(relations()).toHaveCount(0)
    assert.deepEqual(errors, [], 'Backup and restore must not cause uncaught browser errors')
    assert.deepEqual(blockedRequests, [], 'No external request is needed by this workflow')
    assert.equal(modelRequests.length, 1, 'Restores and source edits must not trigger extraction')
  })
  console.log(`PASS ${report.tests.length} graph backup browser scenarios`)
} catch (error) {
  report.error = String(error.stack || error)
  report.diagnostics = { url: page?.url(), bodyText: await page?.locator('body').innerText({ timeout: 5000 }).catch(() => '') }
  console.error(report.error)
  process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString()
  report.browserErrors = errors
  report.blockedRequests = blockedRequests
  report.modelRequests = modelRequests
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  for (const { context, name } of contexts) await context.tracing.stop({ path: path.join(artifacts, `${name}-trace.zip`) }).catch(() => {})
  await browser.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
