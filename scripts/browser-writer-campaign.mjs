/* global Buffer, process */
/** CI ONLY. Authored locally; do not launch/install browsers in the engineering workspace.
 * C01–C03 use the uninstrumented production build. C04–C12 use only a test-built
 * branded offline-host observer/gate, with real Lab, engine, CAS and IndexedDB.
 * The fixed 12 cases are engineering boundaries, not long-form or semantic acceptance.
 * No tracing/screenshots/full backups/source collections are emitted or uploaded. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium, expect as playwrightExpect } from '@playwright/test'
import { build } from 'vite'
import { campaignFixtureProbePlugin, installCampaignProbe } from './fixtures/writer-campaign-browser-probe.mjs'
import { installCampaignPageBootstrap } from './fixtures/writer-campaign-browser-bootstrap.mjs'
import { ordinaryStorageProjection, campaignDocumentIdentity, waitForFreshCampaignReload } from './fixtures/writer-campaign-browser-lifecycle.mjs'
import { isCampaignBrowserFailureStage, recordCampaignPageError } from './lib/writer-campaign-browser-diagnostics.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const evidence = path.join(root, 'artifacts/browser-writer-campaign')
const privateRoot = await mkdtemp(path.join(tmpdir(), 'writer-campaign-browser-'))
const expect = playwrightExpect.configure({ timeout: 15_000 })
const hash = value => createHash('sha256').update(value).digest('hex')
const files = ['src/types/writerCampaign.ts', 'src/services/writerCampaign/protocol.ts', 'src/services/writerCampaign/store.ts',
  'src/services/writerCampaign/buildIdentity.ts', 'scripts/campaign-build-identity.mjs',
  'src/services/writerCampaign/budget.ts', 'src/services/writerCampaign/fixtureAdapter.ts', 'src/services/writerCampaign/engine.ts',
  'src/services/blobStore.ts', 'src/composables/useWriterCampaign.ts', 'src/views/CampaignLab.vue', 'src/views/Dashboard.vue',
  'src/router/index.ts', 'src/main.ts', 'src/App.vue', 'src/views/Settings.vue', 'src/services/backup.ts',
  'src/services/novelPersistence.ts', 'src/services/storageCoordination.ts', 'src/utils/storage.ts', 'scripts/browser-writer-campaign.mjs',
  'scripts/fixtures/writer-campaign-browser-probe.mjs', 'scripts/fixtures/writer-campaign-browser-bootstrap.mjs', 'scripts/fixtures/writer-campaign-browser-lifecycle.mjs', 'scripts/lib/writer-campaign-browser-diagnostics.mjs']
const sourceHashes = await Promise.all(files.sort().map(async file => [file, hash(await readFile(path.join(root, file)))]))
const commit = process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
assert.match(commit, /^[a-f0-9]{40}$/)
const fixtureDefinition = { version: 'campaign-browser-v1', languages: ['zh', 'en'], stages: 5, targetCharacters: 1_000_000,
  replacement: 'Controlled replacement outline for stale dependency rejection.',
  source: sourceHashes.find(([name]) => name === 'src/services/writerCampaign/fixtureAdapter.ts')[1] }
const report = { reportKind: 'campaign-browser-foundation', schemaVersion: 2, commit,
  sourceTreeSha256: hash(JSON.stringify(sourceHashes)), fixtureSha256: hash(JSON.stringify(fixtureDefinition)),
  instrumentationSha256: hash(await readFile(path.join(root, 'scripts/fixtures/writer-campaign-browser-probe.mjs'))),
  instrumentationDelta: 'offline-host-observation-only-v1', denominator: 12,
  cases: Array.from({ length: 12 }, (_, i) => ({ id: `C${String(i + 1).padStart(2, '0')}`, status: 'not_run', failureStage: null, browserErrors: 0,
    buildMode: i < 3 ? 'production' : 'test_instrumented_offline_host', fixtureDispatchEntries: i < 3 ? null : 0 })),
  passed: 0, failed: 0, notRun: 12, realModelRequests: 0, browserErrors: 0, pageErrorDiagnostics: [], pageErrorOverflow: 0, blockedExternalRequests: 0, longformAcceptance: 'NOT_RUN' }
const cases = []
let production, instrumented, context, controlChunk, activeCase
let activeStage = 'case_start'
const observed = [] // Exact source-free identities remain runner-local; export contains counts only.
const test = (id, run) => cases.push({ id, run })
const node = (page, name) => page.getByTestId(`campaign-${name}`)
function stage(value) {
  assert.ok(isCampaignBrowserFailureStage(activeCase.id, value), 'Unknown static stage identifier')
  activeStage = value
}

const observedPages = new WeakSet()
function observePage(page, owner) {
  if (observedPages.has(page)) return
  observedPages.add(page)
  page.on('pageerror', error => recordCampaignPageError(report, owner, error))
}


async function staticServer(directory) {
  const assets = new Map()
  async function collect(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue
      const name = `${prefix}/${entry.name}`, actual = path.join(dir, entry.name)
      if (entry.isDirectory()) await collect(actual, name)
      else assets.set(name, await readFile(actual))
    }
  }
  await collect(directory)
  assert.ok(assets.has('/index.html'))
  const server = createServer((request, response) => {
    const pathname = request.url?.split('?')[0] === '/' ? '/index.html' : request.url?.split('?')[0]
    const bytes = assets.get(pathname)
    if (!bytes || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404).end(); return }
    const ext = path.extname(pathname), mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }[ext] ?? 'application/octet-stream'
    response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }).end(request.method === 'HEAD' ? undefined : bytes)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)), assets }
}
async function launch(profile, mode) {
  const origin = mode === 'production' ? production.origin : instrumented.origin
  context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 950 }, locale: 'zh-CN' })
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue()
    report.blockedExternalRequests++; return route.abort()
  })
  const caseOwner = activeCase
  context.on('page', page => observePage(page, caseOwner))
  for (const page of context.pages()) observePage(page, caseOwner)
  await context.exposeBinding('__campaignObserve', (_source, kind, identity) => {
    assert.equal(kind, 'dispatch')
    assert.deepEqual(Object.keys(identity).sort(), ['campaignId', 'inputDigest', 'requestId', 'taskId', 'taskRevision'])
    assert.match(identity.inputDigest, /^[a-f0-9]{64}$/)
    observed.push({ caseId: caseOwner.id, ...identity })
  })
  await context.addInitScript(installCampaignPageBootstrap, { expectedOrigin: origin })
  if (mode !== 'production') await context.addInitScript(installCampaignProbe)
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(`${origin}/#/campaigns`)
  await expect(node(page, 'lab')).toBeVisible()
  await expect(node(page, 'refresh')).toBeEnabled()
  return { page, origin, profile, mode }
}
async function fresh(mode = activeCase.buildMode) {
  const profile = await mkdtemp(path.join(privateRoot, 'profile-'))
  return launch(profile, mode)
}
async function reopen(f) {
  await context.close(); context = null
  return launch(f.profile, f.mode)
}
async function create(page, language = 'zh') {
  await node(page, `create-${language}`).click()
  await expect(node(page, 'status')).toHaveAttribute('data-status', 'prepared')
  return node(page, 'id').innerText()
}
async function choose(page, id) {
  await node(page, `select-${id}`).click()
  await expect(node(page, 'id')).toHaveText(id)
  await expect(node(page, 'refresh')).toBeEnabled()
}
async function step(page, completed) {
  await node(page, 'step').click()
  await expect(node(page, 'task-progress')).toHaveText(`${completed} / 5（不是长篇验收）`)
  await expect(node(page, 'refresh')).toBeEnabled()
}
async function refresh(page) { await node(page, 'refresh').click(); await expect(node(page, 'refresh')).toBeEnabled() }
async function arm(page, rule) { await page.evaluate(rule => globalThis.__campaignProbe.arm(rule), rule) }
async function held(page, label) { await expect.poll(() => page.evaluate(label => globalThis.__campaignProbe.snapshot().holds.includes(label), label)).toBe(true) }
async function release(page, label) { assert.equal(await page.evaluate(label => globalThis.__campaignProbe.release(label), label), 1) }
async function probe(page) { return page.evaluate(() => globalThis.__campaignProbe.snapshot()) }
function entries(id) { return observed.filter(event => event.caseId === activeCase.id && (!id || event.campaignId === id)) }
async function disk(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('llm-writer', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const values = await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly'); tx.__campaignOracle = true
      const map = {}, cursor = tx.objectStore('kv').openCursor()
      cursor.onsuccess = () => { if (cursor.result) { map[String(cursor.result.key)] = cursor.result.value; cursor.result.continue() } }
      tx.oncomplete = () => resolve(map); tx.onerror = tx.onabort = () => reject(new Error('Oracle read failed'))
    })
    db.close()
    globalThis.__campaignOracleRead = true
    try { return { idb: values, local: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])) } }
    finally { globalThis.__campaignOracleRead = false }
  })
}
const campaignBytes = value => Object.fromEntries(Object.entries(value.idb).filter(([key]) => key.startsWith('writer-campaign:')).sort(([a], [b]) => a.localeCompare(b)))
const ordinaryBytes = ordinaryStorageProjection
const rawHead = (value, id) => JSON.parse(value.idb[`writer-campaign:${encodeURIComponent(id)}:head`])
const rawCheckpoint = (value, id) => JSON.parse(value.idb[`writer-campaign:${encodeURIComponent(id)}:checkpoint:${rawHead(value, id).sequence}`])
const records = (value, id, kind) => Object.entries(value.idb).filter(([key]) => key.startsWith(`writer-campaign:${encodeURIComponent(id)}:${kind}:`)).map(([, value]) => JSON.parse(value))
async function seedOrdinary(page) {
  await page.evaluate(async () => {
    localStorage.setItem('novels', '[]')
    localStorage.setItem('apiConfig', JSON.stringify({ provider: 'custom', selectedModel: 'offline-isolation-canary', baseURL: '', apiKey: '' }))
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('llm-writer', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite'); tx.__campaignOracle = true
      tx.objectStore('kv').put('synthetic unattached novel sentinel', 'novel:campaign-isolation-sentinel')
      tx.objectStore('kv').put('synthetic unattached graph sentinel', 'memory-fact-graph:campaign-isolation-sentinel')
      tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(new Error('Seed failed'))
    }); db.close()
  })
}

// Genuine production build, no host injection and no exact adapter-entry claim.
test('C01', async () => {
  const f = await fresh(); await seedOrdinary(f.page); const before = ordinaryBytes(await disk(f.page))
  assert.equal(Object.keys(campaignBytes(await disk(f.page))).length, 0)
  await expect(node(f.page, 'boundary')).toContainText('离线持久化验证，非自主小说')
  await expect(node(f.page, 'local-only')).toContainText('普通 Writer 备份与恢复不包含')
  stage('create_and_isolation')
  const id = await create(f.page)
  const state = await disk(f.page)
  assert.equal(records(state, id, 'request').length, 0); assert.equal(records(state, id, 'artifact').length, 0)
  assert.deepEqual(ordinaryBytes(state), before)
  stage('reload_no_run')
  await f.page.reload(); await choose(f.page, id)
  await expect(node(f.page, 'status')).toHaveAttribute('data-status', 'prepared')
  assert.equal(records(await disk(f.page), id, 'request').length, 0)
  stage('config_privacy')
  assert.equal(await f.page.evaluate(() => globalThis.__campaignConfigReadCount), 0, 'Direct Campaign route does not load API credentials/config')
  stage('dashboard_navigation')
  await f.page.getByRole('link', { name: '← 返回 LLM-Writer' }).click()
  await expect(f.page.getByTestId('app-navigation')).toBeVisible()
  assert.ok(await f.page.evaluate(() => globalThis.__campaignConfigReadCount) > 0, 'Normal Dashboard still initializes its existing API selector')
  await f.page.getByTestId('campaign-navigation').click(); await expect(node(f.page, 'lab')).toBeVisible()
})
test('C02', async () => {
  const f = await fresh(); await seedOrdinary(f.page); const before = ordinaryBytes(await disk(f.page))
  for (const language of ['zh', 'en']) {
    stage(`${language}_create`)
    const id = await create(f.page, language)
    for (let n = 1; n <= 5; n++) { stage(`${language}_task_${n}`); await step(f.page, n) }
    stage('fixture_completion')
    await expect(node(f.page, 'status')).toHaveText('fixture_complete')
    await expect(node(f.page, 'acceptance')).toHaveText('longformAcceptance: NOT_RUN')
    const value = await disk(f.page), checkpoint = rawCheckpoint(value, id), artifacts = records(value, id, 'artifact')
    assert.equal(artifacts.length, 5); assert.ok(checkpoint.bodyCharacters > 0 && checkpoint.bodyCharacters < 1000)
    assert.equal(checkpoint.bodyCharacters, artifacts.find(a => a.kind === 'chapter_body').canonical.scalars)
    stage('artifact_receipts')
    for (const artifact of artifacts) {
      assert.equal(artifact.semanticStatus, 'not_reviewed')
      const receipt = records(value, id, 'receipt').find(r => r.artifactHashes.includes(artifact.hash))
      assert.ok(receipt, 'Every durable artifact has a matching atomic receipt')
    }
  }
  stage('ordinary_isolation')
  assert.deepEqual(ordinaryBytes(await disk(f.page)), before)
})
test('C03', async () => {
  let f = await fresh(); const id = await create(f.page); await step(f.page, 1)
  stage('safe_reopen')
  const before = campaignBytes(await disk(f.page))
  f = await reopen(f); await choose(f.page, id)
  assert.deepEqual(campaignBytes(await disk(f.page)), before, 'Full browser process reopen does not write/auto-run')
  await expect(node(f.page, 'task-progress')).toHaveText('1 / 5（不是长篇验收）')
  stage('paused_reopen')
  await node(f.page, 'pause').click(); await expect(node(f.page, 'status')).toHaveAttribute('data-status', 'paused')
  f = await reopen(f); await choose(f.page, id); await node(f.page, 'resume').click()
  await expect(node(f.page, 'status')).toHaveAttribute('data-status', 'running')
  assert.equal(records(await disk(f.page), id, 'artifact').length, 1, 'Resume does not dispatch the next task')
  for (let n = 2; n <= 5; n++) await step(f.page, n)
  stage('complete_reopen')
  const complete = campaignBytes(await disk(f.page))
  f = await reopen(f)
  const started = performance.now(); await choose(f.page, id); const coldUiInspectElapsedMs = performance.now() - started
  const reopened = campaignBytes(await disk(f.page))
  assert.deepEqual(reopened, complete)
  stage('capacity_sample')
  const serializedBytes = Object.entries(reopened).reduce((total, [key, value]) => total + Buffer.byteLength(key) + Buffer.byteLength(value), 0)
  assert.ok(serializedBytes > 0 && Number.isFinite(coldUiInspectElapsedMs))
  // Bounded five-stage sample only; includes UI click latency, not browser physical disk use.
  // Private metrics intentionally excluded from the frozen upload/report schema.
  await writeFile(path.join(privateRoot, 'C03-capacity.json'), JSON.stringify({ completedTasks: 5,
    serializedBytes, recordCount: Object.keys(reopened).length, coldUiInspectElapsedMs }))
})

// Instrumented only at the actual offline adapter and native storage observation boundaries.
test('C04', async () => {
  const f = await fresh(), id = await create(f.page), other = await context.newPage()
  await other.goto(`${f.origin}/#/campaigns`); await choose(other, id)
  stage('same_head_gate')
  for (const page of [f.page, other]) {
    await arm(page, { kind: 'read', hold: true, label: 'same-head' })
    await arm(page, { kind: 'ack', operation: 'reserve', hold: true, label: 'winner-reserve' })
  }
  await Promise.all([node(f.page, 'step').click(), node(other, 'step').click()])
  await Promise.all([held(f.page, 'same-head'), held(other, 'same-head')])
  await Promise.all([release(f.page, 'same-head'), release(other, 'same-head')])
  stage('reserve_gate')
  await expect.poll(async () => (await probe(f.page)).holds.includes('winner-reserve') || (await probe(other)).holds.includes('winner-reserve')).toBe(true)
  const reserveHolder = (await probe(f.page)).holds.includes('winner-reserve') ? f.page : other
  await release(reserveHolder, 'winner-reserve')
  // A second explicit step can own the reserved-only continuation epoch. The
  // initial reservation ACK holder is not necessarily the eventual dispatcher.
  stage('both_tabs_settled')
  await Promise.all([expect(node(f.page, 'refresh')).toBeEnabled(), expect(node(other, 'refresh')).toBeEnabled()])
  await expect.poll(async () => rawCheckpoint(await disk(f.page), id).tasks[0].status).toBe('committed')
  await refresh(f.page)
  stage('one_dispatch_artifact')
  assert.equal(records(await disk(f.page), id, 'artifact').length, 1)
  assert.equal(entries(id).length, 1)
  assert.equal(new Set(entries(id).map(item => item.requestId)).size, 1)
})
test('C05', async () => {
  let f = await fresh(); const id = await create(f.page)
  stage('intent_ack_gate')
  await arm(f.page, { kind: 'ack', operation: 'dispatch_intent', hold: true, label: 'intent-ack' })
  await node(f.page, 'step').click(); await held(f.page, 'intent-ack')
  const before = await disk(f.page); assert.equal(rawCheckpoint(before, id).tasks[0].status, 'dispatch_intent')
  stage('reopen_unknown')
  f = await reopen(f); await choose(f.page, id)
  await expect(node(f.page, 'step')).toBeDisabled(); await expect(node(f.page, 'unknown')).toBeVisible()
  stage('no_replay')
  await refresh(f.page); assert.deepEqual(campaignBytes(await disk(f.page)), campaignBytes(before))
  assert.equal(entries(id).length, 0, 'Observed pre-entry gate was not released; absence is not a recovery permission')
})
test('C06', async () => {
  let f = await fresh(); const id = await create(f.page)
  stage('adapter_entry_gate')
  await arm(f.page, { kind: 'dispatch', hold: true, label: 'after-entry' })
  await node(f.page, 'step').click(); await held(f.page, 'after-entry')
  assert.equal(entries(id).length, 1)
  const reserved = rawCheckpoint(await disk(f.page), id).budget
  stage('reopen_unknown')
  f = await reopen(f); await choose(f.page, id)
  await expect(node(f.page, 'step')).toBeDisabled(); await expect(node(f.page, 'unknown')).toBeVisible()
  stage('no_replay')
  await refresh(f.page); assert.equal(entries(id).length, 1)
  assert.deepEqual(rawCheckpoint(await disk(f.page), id).budget, reserved)
  assert.equal(records(await disk(f.page), id, 'artifact').length, 0)
})
test('C07', async () => {
  let f = await fresh(); const id = await create(f.page)
  stage('retained_ack_gate')
  await arm(f.page, { kind: 'ack', operation: 'retain_response', hold: true, label: 'retained-ack' })
  await node(f.page, 'step').click(); await held(f.page, 'retained-ack')
  const before = await disk(f.page); assert.equal(rawCheckpoint(before, id).tasks[0].status, 'response_retained')
  assert.equal(records(before, id, 'artifact').length, 0); assert.equal(entries(id).length, 1)
  stage('reopen_save_only')
  f = await reopen(f); await choose(f.page, id)
  await node(f.page, 'save-only').click(); await expect(node(f.page, 'task-progress')).toHaveText('1 / 5（不是长篇验收）')
  stage('atomic_saved')
  assert.equal(entries(id).length, 1); assert.equal(records(await disk(f.page), id, 'artifact').length, 1)
})
// Synchronous native-put failure: production catch performs the atomic rollback.
test('C08', async () => {
  const f = await fresh(), id = await create(f.page)
  stage('synchronous_put_failure')
  await arm(f.page, { kind: 'write', operation: 'accept_artifact', abort: true })
  await node(f.page, 'step').click(); await expect(node(f.page, 'refresh')).toBeEnabled()
  stage('assert_rollback')
  const value = await disk(f.page)
  assert.equal(records(value, id, 'artifact').length, 0)
  assert.equal(records(value, id, 'receipt').filter(item => item.kind === 'accept_artifact').length, 0)
  assert.equal(entries(id).length, 1); assert.equal((await probe(f.page)).aborted, 1)
  stage('save_only')
  await node(f.page, 'save-only').click(); await expect(node(f.page, 'task-progress')).toHaveText('1 / 5（不是长篇验收）')
  assert.equal(entries(id).length, 1)
  stage('assert_atomic_saved')
  const saved = await disk(f.page), artifact = records(saved, id, 'artifact')[0]
  assert.ok(records(saved, id, 'receipt').some(receipt => receipt.artifactHashes.includes(artifact.hash)))
})
test('C09', async () => {
  const f = await fresh(), id = await create(f.page); await step(f.page, 1); await step(f.page, 2)
  // Load the counterpart and fixed control module before starting the real 5s deadline.
  stage('prewarm')
  const other = await context.newPage(); await other.goto(`${f.origin}/#/campaigns`); await choose(other, id)
  await other.evaluate(async file => { await import(file) }, `${f.origin}/${controlChunk}`)
  stage('stale_response_gate')
  await arm(f.page, { kind: 'response', hold: true, label: 'stale-response' })
  await node(f.page, 'step').click(); await held(f.page, 'stale-response')
  const beforeReplacement = await disk(f.page)
  assert.equal(rawHead(beforeReplacement, id).status, 'running')
  stage('replace_outline')
  await other.evaluate(async ({ file, id }) => { const control = await import(file); await control.replaceOutline(id) }, { file: `${f.origin}/${controlChunk}`, id })
  const replaced = await disk(other), checkpoint = rawCheckpoint(replaced, id)
  assert.equal(checkpoint.status, 'paused'); assert.equal(checkpoint.bodyCharacters, 0)
  assert.ok(records(replaced, id, 'receipt').every(receipt => receipt.kind !== 'block'), 'No timeout/block alternative explains stale-response rejection')
  assert.ok(checkpoint.tasks.slice(1).every(task => task.status === 'invalidated' && task.artifact === null))
  stage('release_stale')
  await release(f.page, 'stale-response'); await expect(node(f.page, 'refresh')).toBeEnabled(); await refresh(f.page)
  assert.deepEqual(campaignBytes(await disk(f.page)), campaignBytes(replaced), 'Old response cannot overwrite the new candidate/dependency root')
  assert.equal(checkpoint.budget.attempts, rawCheckpoint(beforeReplacement, id).budget.attempts, 'Replacement never refunds stale in-flight reservations')
  stage('regenerate')
  await node(f.page, 'resume').click(); await expect(node(f.page, 'step')).toBeEnabled(); await step(f.page, 2)
  stage('assert_lineage')
  const regenerated = await disk(f.page), active = rawCheckpoint(regenerated, id).tasks.find(task => task.taskId === 'characters')
  assert.equal(active.status, 'committed'); assert.ok(active.artifact.revision > 0, 'Dependent immutable revision does not collide with its historical artifact')
})
test('C10', async () => {
  const f = await fresh()
  // Cancel before intent: hold the real reservation commit acknowledgment.
  stage('cancel_before_intent')
  let id = await create(f.page)
  await arm(f.page, { kind: 'ack', operation: 'reserve', hold: true, label: 'before-intent' })
  await node(f.page, 'step').click(); await held(f.page, 'before-intent'); await node(f.page, 'cancel').click()
  await expect(node(f.page, 'status')).toHaveAttribute('data-status', 'cancelled'); await release(f.page, 'before-intent')
  assert.equal(entries(id).length, 0); assert.equal(records(await disk(f.page), id, 'artifact').length, 0)
  stage('cancel_after_intent')
  // Cross-tab cancellation after durable intent cannot revoke the already-authorized dispatch.
  id = await create(f.page)
  // Counterpart selection precedes the real 3s held-ACK deadline.
  const other = await context.newPage(); await other.goto(`${f.origin}/#/campaigns`); await choose(other, id)
  await arm(f.page, { kind: 'ack', operation: 'dispatch_intent', hold: true, label: 'authorized' })
  await node(f.page, 'step').click(); await held(f.page, 'authorized')
  await node(other, 'cancel').click(); await expect(node(other, 'status')).toHaveAttribute('data-status', 'cancelled')
  await release(f.page, 'authorized'); await expect(node(f.page, 'refresh')).toBeEnabled(); await refresh(f.page)
  assert.equal(entries(id).length, 1, 'One previously authorized dispatch may still enter; not a zero-call guarantee')
  assert.equal(records(await disk(f.page), id, 'artifact').length, 0)
  await expect(node(f.page, 'status')).toHaveAttribute('data-status', 'cancelled')
  stage('cancel_failure')
  // Failed durable cancel must not become a fake global-success message.
  id = await create(f.page)
  await arm(f.page, { kind: 'write', operation: 'cancel', abort: true })
  await node(f.page, 'cancel').click()
  await expect(node(f.page, 'persistent-outcome')).toHaveAttribute('data-outcome', 'unconfirmed')
  await expect(node(f.page, 'step')).toBeDisabled()
  assert.notEqual(rawHead(await disk(f.page), id).status, 'cancelled')
})
test('C11', async () => {
  const f = await fresh()
  stage('prewarm')
  // Warm the lazy destination before any held dispatch. Deadlines remain real.
  await f.page.getByRole('link', { name: '← 返回 LLM-Writer' }).click()
  await expect(f.page.getByTestId('app-navigation')).toBeVisible()
  await f.page.getByTestId('campaign-navigation').click()
  await expect(node(f.page, 'lab')).toBeVisible(); await expect(node(f.page, 'refresh')).toBeEnabled()
  stage('resolve_cancel')
  let id = await create(f.page)
  await arm(f.page, { kind: 'response', hold: true, label: 'resolve-cancel', after: 'cancel' })
  await node(f.page, 'step').click(); await held(f.page, 'resolve-cancel'); await release(f.page, 'resolve-cancel')
  await expect(node(f.page, 'status')).toHaveAttribute('data-status', 'cancelled')
  assert.equal(records(await disk(f.page), id, 'artifact').length, 0)
  stage('unmount_gate')
  id = await create(f.page)
  await arm(f.page, { kind: 'response', hold: true, label: 'unmount-response' })
  await node(f.page, 'step').click(); await held(f.page, 'unmount-response')
  const beforeUnmount = await disk(f.page), documentIdentity = await campaignDocumentIdentity(f.page)
  assert.equal(rawHead(beforeUnmount, id).status, 'running')
  assert.ok(records(beforeUnmount, id, 'receipt').every(receipt => receipt.kind !== 'block'))
  stage('route_unmount')
  await f.page.goto(`${f.origin}/#/`); await expect(node(f.page, 'lab')).toHaveCount(0)
  assert.deepEqual(await campaignDocumentIdentity(f.page), documentIdentity, 'Hash navigation tests unmount, not document destruction')
  await release(f.page, 'unmount-response')
  await f.page.goto(`${f.origin}/#/campaigns`); await choose(f.page, id)
  stage('assert_unmount')
  const afterUnmount = await disk(f.page)
  assert.deepEqual(campaignBytes(afterUnmount), campaignBytes(beforeUnmount), 'Unmount revocation, not a timeout/block write, prevents late acceptance')
  assert.equal(records(afterUnmount, id, 'artifact').length, 0)
  await expect(node(f.page, 'unknown')).toBeVisible(); await expect(node(f.page, 'step')).toBeDisabled()
})
test('C12', async () => {
  const f = await fresh(), id = await create(f.page); await step(f.page, 1)
  const before = campaignBytes(await disk(f.page))
  stage('settings')
  await f.page.goto(`${f.origin}/#/settings`)
  await f.page.getByRole('tab', { name: '数据管理' }).click()
  const input = f.page.locator('input[type="file"][accept=".json"]').first()
  await input.setInputFiles({ name: 'synthetic-legacy-backup.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'llm-writer-backup', version: 2, exportTime: '2026-01-01T00:00:00.000Z', data: { novels: [] } })) })
  stage('restore_confirm')
  await f.page.getByRole('dialog', { name: '确认导入' }).getByRole('button', { name: '确定', exact: true }).click()
  stage('restore_completed_dialog')
  const completed = f.page.getByRole('dialog', { name: '导入完成', exact: true })
  await expect(completed).toContainText('成功导入')
  stage('restore_committed')
  const restored = await disk(f.page)
  assert.equal(restored.local.novels, '[]', 'Success dialog follows the actual ordinary backup commit')
  assert.deepEqual(campaignBytes(restored), before, 'Ordinary restore preserves every Campaign byte before reload')
  await waitForFreshCampaignReload(f.page, () => completed.getByRole('button', { name: '确定', exact: true }).click(), stage)
  stage('reload_storage')
  const reloaded = await disk(f.page)
  assert.equal(reloaded.local.novels, '[]')
  assert.deepEqual(campaignBytes(reloaded), before, 'Reload preserves every Campaign byte before return or selection')
  stage('return_to_campaign')
  await f.page.goto(`${f.origin}/#/campaigns`)
  stage('campaign_list_ready')
  await expect(node(f.page, 'lab')).toBeVisible(); await expect(node(f.page, 'refresh')).toBeEnabled()
  stage('campaign_select')
  await choose(f.page, id)
  stage('assert_isolation')
  assert.deepEqual(campaignBytes(await disk(f.page)), before)
  await expect(node(f.page, 'task-progress')).toHaveText('1 / 5（不是长篇验收）')
})

try {
  assert.deepEqual(cases.map(item => item.id), report.cases.map(item => item.id), 'Frozen denominator cannot skip cases')
  production = await staticServer(path.join(root, 'dist'))
  for (const [name, bytes] of production.assets) if (name.endsWith('.js')) {
    assert.ok(!bytes.includes(Buffer.from('__campaignProbe')), 'Production assets cannot contain test hooks')
    assert.ok(!bytes.includes(Buffer.from('writer-campaign-test-host')), 'Test host absent from normal build')
  }
  const testOutput = path.join(privateRoot, 'instrumented-dist')
  await build({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'silent',
    plugins: [campaignFixtureProbePlugin(root, name => { controlChunk = name })],
    build: { outDir: testOutput, emptyOutDir: true, rolldownOptions: { preserveEntrySignatures: 'exports-only', input: { app: path.join(root, 'index.html'),
      'campaign-test-control': 'writer-campaign-test-control' } } } })
  assert.ok(controlChunk)
  instrumented = await staticServer(testOutput)
  for (const item of cases) {
    activeCase = report.cases.find(row => row.id === item.id)
    activeStage = 'case_start'
    const externalBefore = report.blockedExternalRequests
    try {
      await item.run()
      stage('page_errors'); assert.equal(activeCase.browserErrors, 0)
      stage('external_requests'); assert.equal(report.blockedExternalRequests, externalBefore)
      stage('dispatch_evidence')
      const actual = entries()
      const durable = await disk(context.pages()[0])
      for (const entry of actual) {
        const intents = records(durable, entry.campaignId, 'request').filter(request => request.id === entry.requestId && request.status === 'dispatch_intent')
        assert.equal(intents.length, 1, 'Every observed actual entry binds one durable request intent')
        assert.equal(intents[0].inputDigest, entry.inputDigest); assert.equal(intents[0].taskId, entry.taskId)
        assert.equal(intents[0].taskRevision, entry.taskRevision); assert.equal(intents[0].reservation.attempts, 1)
      }
      const allReceipts = Object.entries(durable.idb).filter(([key]) => key.startsWith('writer-campaign:') && key.includes(':receipt:')).map(([, value]) => JSON.parse(value))
      stage('cancel_evidence')
      for (const cancel of allReceipts.filter(receipt => receipt.kind === 'cancel')) {
        assert.ok(!allReceipts.some(receipt => receipt.campaignId === cancel.campaignId && receipt.sequence > cancel.sequence
          && ['reserve', 'dispatch_intent', 'accept_artifact'].includes(receipt.kind)), 'Durable cancellation forbids new intents or accepted artifacts')
      }
      stage('duplicate_dispatch')
      assert.equal(new Set(actual.map(entry => `${entry.campaignId}/${entry.requestId}`)).size, actual.length, 'No duplicate actual adapter entry for any request')
      // Errors can arrive during the awaited oracle reads after the first gate.
      if (activeCase.browserErrors) { stage('page_errors'); assert.equal(activeCase.browserErrors, 0) }
      activeCase.status = 'pass'; activeCase.failureStage = null
    } catch (error) {
      await writeFile(path.join(privateRoot, `${item.id}-failure.txt`), String(error?.stack ?? error))
      activeCase.status = 'fail'; activeCase.failureStage = activeStage
      // Do not print Playwright DOM excerpts, source, requests, storage, URLs or arbitrary exceptions.
      process.stderr.write(`Campaign browser ${item.id}: boundary_assertion_failed\n`)
    } finally {
      if (context) { await context.close().catch(() => {}); context = null }
      if (activeCase.browserErrors > 0 && activeCase.status !== 'fail') {
        activeCase.status = 'fail'; activeCase.failureStage = 'page_errors'
      }
      if (activeCase.buildMode !== 'production') activeCase.fixtureDispatchEntries = entries().length
    }
  }
} catch {
  process.stderr.write('Campaign browser setup: setup_failed\n')
} finally {
  if (context) await context.close().catch(() => {})
  if (instrumented) await instrumented.close()
  if (production) await production.close()
  report.passed = report.cases.filter(item => item.status === 'pass').length
  report.failed = report.cases.filter(item => item.status === 'fail').length
  report.notRun = report.cases.filter(item => item.status === 'not_run').length
  await mkdir(evidence, { recursive: true })
  await writeFile(path.join(evidence, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  // Success-only cleanup. Failure diagnostics/profiles remain private runner-local, never uploaded.
  if (!report.failed && !report.notRun) await rm(privateRoot, { recursive: true, force: true })
}
if (report.failed || report.notRun || report.browserErrors || report.blockedExternalRequests) process.exitCode = 1
process.stdout.write(`Campaign browser: ${report.passed}/12 passed, ${report.failed} failed, ${report.notRun} not run; longformAcceptance=NOT_RUN.\n`)
