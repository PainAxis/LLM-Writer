/**
 * Real Chromium acceptance of optional Memory Lab providers and source gates.
 * The local HTTP fixture uses intentionally synthetic three-dimensional vectors:
 * it verifies integration, cache lifetime, and disclosure safety, not model quality.
 * Run npm run build first. No paid or external model service is called.
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium, expect as playwrightExpect } from '@playwright/test'
import { startPreviewServer } from './browser-preview.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = path.join(root, 'artifacts/browser-memory-hybrid')
await mkdir(artifacts, { recursive: true })
const server = await startPreviewServer({ port: 0, sha: process.env.GITHUB_SHA || 'local' })
const origin = `http://127.0.0.1:${server.address().port}`
const requests = []
const heldResponses = new Set()
const fixtureState = { embeddings: 'ok', rerank: 'ok' }
const fixtureErrors = []
const syntheticEmbeddingKey = 'memory-fixture-embedding-key'
const syntheticRerankKey = 'memory-fixture-rerank-key'
const futureFact = '玄衣客的真名是顾行'

function vectorFor(text) {
  if (/紧急联络|铜铃|接应信号|约定的渡口/.test(text)) return [1, 0, 0]
  if (/钥匙/.test(text)) return [0, 1, 0]
  if (/玄衣客|真名/.test(text)) return [0, 0, 1]
  return [0.15, 0.15, 0.1]
}

function responseFor(kind, body) {
  if (kind === 'embeddings') {
    assert.ok(Array.isArray(body.input), 'Embedding input must be an array')
    assert.equal(body.dimensions, 3, 'The configured output dimension must reach the provider')
    assert.ok(body.input.every(text => typeof text === 'string' && text.length > 0))
    return { data: body.input.map((text, index) => ({ index, embedding: vectorFor(text) })) }
  }
  assert.ok(Array.isArray(body.documents) && body.documents.length > 0)
  assert.ok(body.documents.every(text => typeof text === 'string'))
  assert.equal(typeof body.query, 'string')
  const preferred = /钥匙/.test(body.query) ? '钥匙' : /玄衣客|真名/.test(body.query) ? futureFact : '铜铃'
  const results = body.documents.map((text, index) => ({
    index, relevance_score: text.includes(preferred) ? 0.99 : 0.2 - index / 10_000,
  })).sort((a, b) => b.relevance_score - a.relevance_score)
  return { results: results.slice(0, body.top_n ?? results.length) }
}

const fixture = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  response.setHeader('Content-Type', 'application/json')
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return }
  const pathname = new URL(request.url || '/', 'http://fixture').pathname
  const kind = pathname.endsWith('/embeddings') ? 'embeddings' : pathname.endsWith('/rerank') ? 'rerank' : null
  if (request.method !== 'POST' || !kind) { response.writeHead(404).end('{}'); return }
  try {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    // Intentionally do not retain request headers or bearer credentials.
    const entry = { kind, body, status: 'pending' }
    requests.push(entry)
    const send = () => {
      heldResponses.delete(send)
      if (response.destroyed) { entry.status = 'aborted'; return }
      if (fixtureState[kind] === 'error') {
        entry.status = 500
        response.writeHead(500).end(JSON.stringify({ error: 'Synthetic temporary provider failure' }))
      } else {
        const output = responseFor(kind, body)
        entry.status = 200
        response.writeHead(200).end(JSON.stringify(output))
      }
    }
    if (fixtureState[kind] === 'hold' && body.task === 'retrieval.passage') heldResponses.add(send)
    else send()
  } catch (error) {
    fixtureErrors.push(String(error.stack || error))
    if (!response.destroyed) response.writeHead(500).end(JSON.stringify({ error: 'Invalid synthetic fixture request' }))
  }
})
await new Promise((resolve, reject) => { fixture.once('error', reject); fixture.listen(0, '127.0.0.1', resolve) })
const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`
const browser = await chromium.launch({ headless: true }).catch(error => {
  for (const runningServer of [server, fixture]) { runningServer.closeAllConnections(); runningServer.close() }
  throw error
})
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, locale: 'zh-CN' })
await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
const expect = playwrightExpect.configure({ timeout: 15_000 })
const errors = []
const blockedRequests = []
const report = { startedAt: new Date().toISOString(), fixture: 'synthetic vectors; no external model', tests: [], screenshots: [] }
context.on('page', target => {
  target.setDefaultTimeout(15_000)
  target.on('pageerror', error => errors.push(String(error.stack || error)))
})
await context.route('**/*', route => {
  const url = new URL(route.request().url())
  if (['data:', 'blob:'].includes(url.protocol) || [origin, fixtureOrigin].includes(url.origin)) return route.continue()
  blockedRequests.push(`${url.origin}${url.pathname}`)
  return route.abort('blockedbyclient')
})
const page = await context.newPage()
const control = id => page.getByTestId(`memory-${id}`)
const results = () => page.locator('[data-testid^="memory-result-"]')
const documentRequests = () => requests.filter(entry => entry.kind === 'embeddings' && entry.body.task === 'retrieval.passage')
const requestText = entries => entries.flatMap(entry => entry.kind === 'embeddings' ? entry.body.input : entry.body.documents).join('\n')

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

async function dismissAnnouncement() {
  const button = page.getByRole('button', { name: '我知道了', exact: true })
  try { await button.waitFor({ state: 'visible', timeout: 2200 }) } catch { return }
  await button.click()
}

async function openSettings() {
  if (await control('provider-settings').getAttribute('open') === null) await control('provider-settings').locator('summary').click()
}

async function configureProviders() {
  await openSettings()
  await control('embedding-enabled').check()
  await control('embedding-protocol').selectOption('jina')
  await control('embedding-endpoint').fill(`${fixtureOrigin}/v1/embeddings`)
  await control('embedding-model').fill('synthetic-memory-embedding')
  await control('embedding-dimensions').fill('3')
  await control('rerank-enabled').check()
  await control('rerank-endpoint').fill(`${fixtureOrigin}/v1/rerank`)
  await control('rerank-model').fill('synthetic-memory-reranker')
  // Destination or protocol changes deliberately clear keys; fill them last.
  await control('embedding-key').fill(syntheticEmbeddingKey)
  await control('rerank-key').fill(syntheticRerankKey)
}

async function search(query) {
  await control('query').fill(query)
  await expect(control('search')).toBeEnabled()
  await control('search').click()
  await expect(control('search')).toBeEnabled()
  await expect(control('retrieval-status')).toBeVisible()
}

async function screenshot(name) {
  const filename = `${name}.png`
  await page.screenshot({ path: path.join(artifacts, filename), fullPage: true })
  report.screenshots.push(filename)
}

async function assertNoStoredKeys() {
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  for (const key of [syntheticEmbeddingKey, syntheticRerankKey]) assert.ok(!stored.includes(key), 'Provider credentials must not be persisted in browser storage')
}

try {
  await step('01 Providers are opt-in and ordinary local search makes no requests', async () => {
    await page.goto(`${origin}/#/memory`)
    await dismissAnnouncement()
    await expect(control('search')).toBeEnabled()
    await search('银钥匙')
    await expect(results().first()).toBeVisible()
    await expect(control('retrieval-status')).toContainText('未启用')
    await openSettings()
    await expect(control('embedding-enabled')).not.toBeChecked()
    await expect(control('rerank-enabled')).not.toBeChecked()
    assert.deepEqual(requests, [], 'Default local retrieval must not contact a provider')
  })

  await step('02 Enable both providers and inspect original evidence from the hybrid result', async () => {
    await configureProviders()
    await search('紧急联络')
    await expect(control('retrieval-status')).toContainText('已参与混合检索')
    await expect(control('retrieval-status')).toContainText('已完成')
    const clue = results().filter({ hasText: '铜铃' }).first()
    await expect(clue).toBeVisible()
    await clue.click()
    await expect(control('evidence-quote')).toContainText('西渡口')
    await expect(control('evidence')).toContainText('第 2 章')
    assert.match(await control('evidence-revision').textContent(), /^[a-f0-9]{64}$/)
    assert.ok(documentRequests().length > 0)
    assert.ok(requests.some(entry => entry.kind === 'embeddings' && entry.body.task === 'retrieval.query'))
    assert.ok(requests.some(entry => entry.kind === 'rerank'))
    assert.ok(!requestText(requests).includes(futureFact), 'Initial provider payloads must exclude the future identity')
    await assertNoStoredKeys()
    await screenshot('hybrid-evidence')
  })

  await step('03 Repeated queries reuse unchanged source vectors', async () => {
    const before = documentRequests().length
    await search('约定的渡口')
    assert.equal(documentRequests().length, before, 'Unchanged source passages must not be embedded again')
    await expect(control('retrieval-status')).toContainText('本次新嵌入 0 个')
    await expect(results().filter({ hasText: '铜铃' }).first()).toBeVisible()
  })

  await step('04 Disclosure gates exclude future text from requests and evidence after cutoff reduction', async () => {
    await control('cutoff').selectOption('c80')
    await search('玄衣客 真名')
    const disclosed = results().filter({ hasText: futureFact }).first()
    await expect(disclosed).toBeVisible()
    await disclosed.click()
    await expect(control('evidence-quote')).toContainText(futureFact)
    assert.ok(requestText(requests).includes(futureFact), 'Chapter 80 becomes eligible only after the cutoff is extended')
    const before = requests.length
    await control('cutoff').selectOption('c10')
    await expect(results()).toHaveCount(0)
    await expect(control('evidence')).not.toContainText(futureFact)
    await search('玄衣客 真名')
    await expect(control('results')).not.toContainText(futureFact)
    assert.ok(!requestText(requests.slice(before)).includes(futureFact), 'Even previously cached future text must not enter reranker payloads')
  })

  await step('05 Editing an old chapter excludes its former vectors and excerpts', async () => {
    await control('edit-chapter').selectOption('c1')
    const original = await control('chapter-editor').inputValue()
    assert.ok(original.includes('银钥匙'))
    await control('chapter-editor').fill(original.replaceAll('银钥匙', '铜钥匙'))
    await expect(control('search')).toBeDisabled()
    await control('save-demo').click()
    await expect(control('search')).toBeEnabled()
    const before = requests.length
    await search('铜钥匙')
    const current = results().filter({ hasText: '铜钥匙' }).first()
    await expect(current).toBeVisible()
    await current.click()
    await expect(control('evidence-quote')).toContainText('铜钥匙')
    await expect(control('results')).not.toContainText('银钥匙')
    const newRequests = requests.slice(before)
    assert.ok(requestText(newRequests.filter(entry => entry.kind === 'embeddings')).includes('铜钥匙'), 'The revised passage must get a new vector')
    assert.ok(!requestText(newRequests).includes('银钥匙'), 'Superseded text must not reach embeddings or reranking')
  })

  await step('06 Provider failures retain usable local results and visible fallback warnings', async () => {
    fixtureState.rerank = 'error'
    await search('铜钥匙')
    await expect(control('retrieval-warning').first()).toBeVisible()
    await expect(control('retrieval-status')).toContainText('保留召回顺序')
    await expect(results().filter({ hasText: '铜钥匙' }).first()).toBeVisible()
    fixtureState.embeddings = 'error'
    await control('clear-cache').click()
    await search('铜钥匙')
    await expect(control('retrieval-status')).toContainText('已回退至本地检索')
    await expect(control('retrieval-warning').first()).toBeVisible()
    await expect(results().filter({ hasText: '铜钥匙' }).first()).toBeVisible()
    assert.ok(requests.some(entry => entry.kind === 'embeddings' && entry.status === 500))
    assert.ok(requests.some(entry => entry.kind === 'rerank' && entry.status === 500))
    await screenshot('provider-fallback')
    fixtureState.embeddings = 'ok'
    fixtureState.rerank = 'ok'
  })

  await step('07 Cancelled delayed responses cannot republish results or populate a later search cache', async () => {
    await control('clear-cache').click()
    fixtureState.embeddings = 'hold'
    await control('query').fill('铜钥匙')
    await control('search').click()
    await expect.poll(() => heldResponses.size).toBeGreaterThan(0)
    await expect(control('cancel')).toBeVisible()
    await control('cancel').click()
    await expect(control('search')).toBeEnabled()
    await expect(results()).toHaveCount(0)
    fixtureState.embeddings = 'ok'
    for (const release of [...heldResponses]) release()
    // Allow a queued late response to reach the UI before checking invalidation.
    await page.waitForTimeout(150)
    await expect(results()).toHaveCount(0)
    await expect(control('retrieval-status')).toHaveCount(0)
    const before = documentRequests().length
    await search('铜钥匙')
    assert.ok(documentRequests().length > before, 'A cancelled worker must not seed the next worker cache')
    await expect(results().filter({ hasText: '铜钥匙' }).first()).toBeVisible()
  })

  await step('08 Explicit cache clearing invalidates evidence and re-embeds current source', async () => {
    await results().filter({ hasText: '铜钥匙' }).first().click()
    await expect(control('evidence-quote')).toContainText('铜钥匙')
    const before = documentRequests().length
    await control('clear-cache').click()
    await expect(results()).toHaveCount(0)
    await expect(control('evidence')).not.toContainText('铜钥匙')
    await search('铜钥匙')
    assert.ok(documentRequests().length > before)
    await expect(control('retrieval-status')).toContainText('已参与混合检索')
  })

  await step('09 Destination and protocol changes forget keys and invalidate current results', async () => {
    await control('embedding-endpoint').fill(`${fixtureOrigin}/alternate/embeddings`)
    await expect(control('embedding-key')).toHaveValue('')
    await expect(results()).toHaveCount(0)
    await control('embedding-key').fill(syntheticEmbeddingKey)
    await control('embedding-protocol').selectOption('openai-compatible')
    await expect(control('embedding-key')).toHaveValue('')
    await control('rerank-endpoint').fill(`${fixtureOrigin}/alternate/rerank`)
    await expect(control('rerank-key')).toHaveValue('')
    await assertNoStoredKeys()
    await control('embedding-key').fill(syntheticEmbeddingKey)
    await control('rerank-key').fill(syntheticRerankKey)
    const before = requests.length
    await search('铜钥匙')
    const compatible = requests.slice(before).filter(entry => entry.kind === 'embeddings')
    assert.ok(compatible.length > 0, 'OpenAI-compatible embeddings must work through the real worker')
    for (const entry of compatible) {
      assert.equal(entry.body.encoding_format, 'float')
      assert.equal(entry.body.task, undefined, 'Jina-only task fields must not leak into OpenAI-compatible requests')
    }
    await expect(control('retrieval-status')).toContainText('已参与混合检索')
    await configureProviders()
    await search('铜钥匙')
    await expect(control('retrieval-status')).toContainText('已参与混合检索')
  })

  await step('10 Leaving or reloading the route forgets settings and credentials', async () => {
    await assertNoStoredKeys()
    await page.evaluate(() => { location.hash = '/' })
    await page.waitForURL(/#\/$/)
    await page.getByRole('menuitem', { name: /记忆/ }).click()
    await page.waitForURL(/#\/memory$/)
    await expect(control('search')).toBeEnabled()
    await openSettings()
    await expect(control('embedding-enabled')).not.toBeChecked()
    await expect(control('rerank-enabled')).not.toBeChecked()
    await control('embedding-enabled').check()
    await control('rerank-enabled').check()
    await expect(control('embedding-key')).toHaveValue('')
    await expect(control('rerank-key')).toHaveValue('')
    await configureProviders()
    const before = requests.length
    await page.reload()
    await dismissAnnouncement()
    await expect(control('search')).toBeEnabled()
    await openSettings()
    await expect(control('embedding-enabled')).not.toBeChecked()
    await expect(control('rerank-enabled')).not.toBeChecked()
    await control('embedding-enabled').check()
    await control('rerank-enabled').check()
    await expect(control('embedding-key')).toHaveValue('')
    await expect(control('rerank-key')).toHaveValue('')
    assert.equal(requests.length, before, 'Reload and settings interaction alone must not contact a provider')
    await assertNoStoredKeys()
    assert.deepEqual(errors, [], 'The built application must not have uncaught errors')
    assert.deepEqual(fixtureErrors, [], 'Requests must conform to the local provider contract')
    assert.deepEqual(blockedRequests, [], 'No external service must be contacted by this suite')
  })
  console.log(`PASS ${report.tests.length} Memory hybrid browser scenarios`)
} catch (error) {
  report.error = String(error.stack || error)
  report.diagnostics = { url: page.url(), bodyText: await page.locator('body').innerText({ timeout: 5000 }).catch(() => '') }
  console.error(report.error)
  process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString()
  report.browserErrors = errors
  report.fixtureErrors = fixtureErrors
  report.blockedRequests = blockedRequests
  report.requests = requests.map(({ kind, body, status }) => ({ kind, task: body.task, items: (body.input || body.documents).length, status }))
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  await context.tracing.stop({ path: path.join(artifacts, 'trace.zip') })
  for (const release of [...heldResponses]) release()
  await browser.close()
  for (const runningServer of [server, fixture]) {
    runningServer.closeAllConnections()
    await new Promise(resolve => runningServer.close(resolve))
  }
}
