/* global process */
/** Real production Campaign Lab UI over native IndexedDB. The only race injection
 * delays a completed native readonly transaction callback; it never replaces the
 * engine/adapter/repository or edits data. No trace, screenshot, text, backup or
 * arbitrary exception is emitted. Browser profiles stay private and local. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect as playwrightExpect } from '@playwright/test'
import { build } from 'vite'
import { campaignBuildIdentity, CAMPAIGN_CORE_PATHS } from './campaign-build-identity.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)), hash = bytes => createHash('sha256').update(bytes).digest('hex')
const expect = playwrightExpect.configure({ timeout: 15_000 })
const CHECKS = ['create_refusal', 'plans_freeze', 'later_preview_readonly', 'chapter_reselection', 'newer_chapter_race', 'refresh_race', 'reload', 'process_reopen', 'campaign_selection_race', 'navigation_race', 'cancel_race', 'cross_tab_change']
export const PLANNING_UI_SOURCE_PATHS = Object.freeze([...CAMPAIGN_CORE_PATHS, 'src/composables/useWriterCampaign.ts', 'src/views/CampaignLab.vue', 'src/router/index.ts', 'src/main.ts', 'src/App.vue', 'scripts/campaign-build-identity.mjs'].sort())
const sourceDigest = async (base = root) => hash(JSON.stringify(await Promise.all(PLANNING_UI_SOURCE_PATHS.map(async name => [name, hash(await readFile(path.join(base, name)))]))))
/** Exact source/harness identity reused by the closed archive validator. No build claim. */
export async function planningUiEvidenceIdentity(rootOverride = root) {
  const identity = campaignBuildIdentity(rootOverride)
  return { ...identity.source, sourceSha256: await sourceDigest(rootOverride), coreSha256: identity.runtimeIdentity.split(':')[1],
    harnessSha256: hash(await readFile(path.join(rootOverride, 'scripts/browser-writer-campaign-planning-ui.mjs'))) }
}
const node = (page, name) => page.getByTestId(`campaign-${name}`)

/** Serialized by Playwright. Origin-gated; opaque about:blank touches no storage. */
export function installPreviewReadGate({ expectedOrigin }) {
  if (location.origin !== expectedOrigin) return
  // Only the unrelated release announcement is suppressed, with stable values.
  localStorage.setItem('lastReadAnnouncementVersion', '1.0.0')
  localStorage.setItem('lastReadAnnouncementDate', '1792920000000')
  const nativeGetItem = Storage.prototype.getItem
  let configReads = 0
  Storage.prototype.getItem = function (key) {
    if (this === localStorage && ['apiConfig', 'customApiConfig', 'officialApiConfig'].includes(key)) configReads++
    return nativeGetItem.call(this, key)
  }
  const nativeTransaction = IDBDatabase.prototype.transaction, nativeGet = IDBObjectStore.prototype.get
  const complete = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')
  let armedKey = null, pending = null, observed = 0, released = 0
  const selected = new WeakSet()
  IDBObjectStore.prototype.get = function (key) {
    if (armedKey !== null && key === armedKey && this.transaction.mode === 'readonly') {
      selected.add(this.transaction); armedKey = null
    }
    return nativeGet.apply(this, arguments)
  }
  IDBDatabase.prototype.transaction = function () {
    const tx = nativeTransaction.apply(this, arguments)
    if (tx.mode !== 'readonly') return tx
    let callback = null
    Object.defineProperty(tx, 'oncomplete', {
      configurable: true,
      get() { return callback },
      set(value) {
        callback = value
        complete.set.call(tx, event => {
          const invoke = () => { if (typeof callback === 'function') callback.call(tx, event) }
          if (selected.has(tx)) {
            if (pending) throw new Error('planning_ui_gate_overlap')
            selected.delete(tx); observed++; pending = invoke
          } else invoke()
        })
      },
    })
    return tx
  }
  globalThis.__planningUiReadGate = {
    arm(key) { if (armedKey !== null || pending) throw new Error('planning_ui_gate_busy'); armedKey = key },
    release() { if (!pending) throw new Error('planning_ui_gate_empty'); const fn = pending; pending = null; released++; fn() },
    snapshot: () => ({ held: pending !== null, observed, released, configurationReads: configReads }),
  }
}

/** Browser-local oracle: raw records never leave this function. */
async function observe(page, id) {
  return page.evaluate(async id => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('llm-writer', 1)
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('oracle_open'))
    })
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly'), rows = [], cursor = tx.objectStore('kv').openCursor()
      cursor.onsuccess = () => { if (cursor.result) { rows.push([String(cursor.result.key), cursor.result.value]); cursor.result.continue() } }
      tx.oncomplete = () => resolve(rows); tx.onerror = tx.onabort = () => reject(new Error('oracle_read'))
    })
    db.close(); if (!rows.every(([key, value]) => typeof key === 'string' && typeof value === 'string')) throw new Error('oracle_non_string_record'); rows.sort((a, b) => a[0].localeCompare(b[0]))
    const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(n => n.toString(16).padStart(2, '0')).join('')
    const prefix = `writer-campaign:${encodeURIComponent(id)}:`, campaign = rows.filter(([key]) => key.startsWith(prefix))
    const headRow = campaign.find(([key]) => key === `${prefix}head`), head = headRow ? JSON.parse(headRow[1]) : null
    const checkpoint = head && JSON.parse(campaign.find(([key]) => key === `${prefix}checkpoint:${head.sequence}`)[1])
    const manifest = head && JSON.parse(campaign.find(([key]) => key === `${prefix}manifest:${head.manifestHash}`)[1])
    const artifacts = campaign.filter(([key]) => key.startsWith(`${prefix}artifact:`)).map(([, raw]) => JSON.parse(raw))
    const requests = campaign.filter(([key]) => key.startsWith(`${prefix}request:`)).map(([, raw]) => JSON.parse(raw))
    const receipts = campaign.filter(([key]) => key.startsWith(`${prefix}receipt:`)).map(([, raw]) => JSON.parse(raw))
    const local = Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])
    return {
      campaignSha256: await digest(campaign), campaignNamespaceSha256: await digest(rows.filter(([key]) => key.startsWith('writer-campaign:'))), ordinarySha256: await digest([rows.filter(([key]) => !key.startsWith('writer-campaign:')), local]),
      planningArtifacts: artifacts.filter(a => a.kind !== 'chapter_body').length, bodyArtifacts: artifacts.filter(a => a.kind === 'chapter_body').length,
      bodyScalars: checkpoint?.bodyCharacters ?? 0, requestOrigins: requests.filter(r => r.revision === 0).length,
      dispatchIntents: requests.filter(r => r.status === 'dispatch_intent').length,
      attempts: checkpoint?.budget.attempts ?? 0, operations: receipts.length,
      status: checkpoint?.status ?? null, sequence: head?.sequence ?? 0, runtimeIdentity: manifest?.runtimeIdentity ?? null,
    }
  }, id)
}

export function validatePlanningUiReport(report) {
  const keys = (value, names) => { assert.ok(value && typeof value === 'object' && !Array.isArray(value)); assert.deepEqual(Object.keys(value).sort(), names.sort()) }
  keys(report, ['schemaVersion', 'reportKind', 'source', 'buildMode', 'raceInjection', 'privacyScope', 'denominator', 'cases', 'browserErrors', 'blockedExternalRequests', 'liveModelCalls', 'actualFixtureInvocations', 'teardown', 'sourceStable', 'semanticConsistency', 'autonomousGeneration', 'wholeWorkAudit'])
  assert.equal(report.schemaVersion, 1); assert.equal(report.reportKind, 'campaign-planning-ui-v1')
  keys(report.source, ['commit', 'tree', 'sourceSha256', 'coreSha256', 'harnessSha256', 'buildSha256'])
  for (const name of ['commit', 'tree']) assert.ok(report.source[name] === null || /^[a-f0-9]{40}$/.test(report.source[name]))
  assert.equal(report.source.commit === null, report.source.tree === null)
  for (const name of ['sourceSha256', 'coreSha256', 'harnessSha256', 'buildSha256']) assert.match(report.source[name], /^[a-f0-9]{64}$/)
  assert.equal(report.buildMode, 'production_ui_native_idb'); assert.equal(report.raceInjection, 'native_read_completion_only'); assert.equal(report.privacyScope, 'campaign_actions_before_dashboard_navigation')
  assert.equal(report.denominator, 24); assert.equal(report.cases.length, 2)
  for (const [index, row] of report.cases.entries()) {
    keys(row, ['language', 'setup', 'failureStage', 'checks', 'planningArtifacts', 'bodyArtifacts', 'bodyScalars', 'requestOrigins', 'dispatchIntents', 'attempts', 'readOnlyChecks', 'reloads', 'processReopens', 'heldReadRaces', 'configurationReads'])
    assert.equal(row.language, ['zh', 'en'][index]); assert.ok(['not_run', 'pass', 'failed'].includes(row.setup)); assert.ok(row.failureStage === null || ['launch', 'navigation', 'initial_ready', ...CHECKS, 'teardown'].includes(row.failureStage)); assert.equal(row.checks.length, CHECKS.length)
    for (const [i, check] of row.checks.entries()) { keys(check, ['id', 'status']); assert.equal(check.id, CHECKS[i]); assert.ok(['not_run', 'pass', 'failed'].includes(check.status)) }
    for (const key of ['planningArtifacts', 'bodyArtifacts', 'bodyScalars', 'requestOrigins', 'dispatchIntents', 'attempts', 'readOnlyChecks', 'reloads', 'processReopens', 'heldReadRaces', 'configurationReads']) assert.ok(Number.isSafeInteger(row[key]) && row[key] >= 0)
    if (row.checks.every(check => check.status === 'pass')) {
      assert.equal(row.setup, 'pass'); assert.equal(row.failureStage, null)
      for (const key of ['planningArtifacts', 'requestOrigins', 'dispatchIntents', 'attempts']) assert.equal(row[key], 6)
      for (const key of ['bodyArtifacts', 'bodyScalars', 'configurationReads']) assert.equal(row[key], 0)
      assert.ok(row.readOnlyChecks >= 8); assert.equal(row.reloads, 1); assert.equal(row.processReopens, 1); assert.equal(row.heldReadRaces, 6)
    }
  }
  for (const key of ['browserErrors', 'blockedExternalRequests']) assert.ok(Number.isSafeInteger(report[key]) && report[key] >= 0)
  assert.equal(report.liveModelCalls, 0); assert.equal(report.actualFixtureInvocations, null)
  assert.ok(['not_run', 'pass', 'failed'].includes(report.teardown)); assert.ok(['not_checked', 'verified', 'changed'].includes(report.sourceStable))
  for (const key of ['semanticConsistency', 'autonomousGeneration', 'wholeWorkAudit']) assert.equal(report[key], 'NOT_RUN')
}

export function planningUiReportExitCode(report) {
  validatePlanningUiReport(report)
  return report.cases.some(row => row.setup !== 'pass' || row.failureStage !== null || row.checks.some(check => check.status !== 'pass'))
    || report.browserErrors !== 0 || report.blockedExternalRequests !== 0 || report.teardown !== 'pass' || report.sourceStable !== 'verified' ? 1 : 0
}

async function main() {
  const privateRoot = await mkdtemp(path.join(tmpdir(), 'planning-ui-browser-')), provenance = await planningUiEvidenceIdentity(root)
  const report = { schemaVersion: 1, reportKind: 'campaign-planning-ui-v1', source: { ...provenance, buildSha256: '0'.repeat(64) },
    buildMode: 'production_ui_native_idb', raceInjection: 'native_read_completion_only', privacyScope: 'campaign_actions_before_dashboard_navigation', denominator: 24,
    cases: ['zh', 'en'].map(language => ({ language, setup: 'not_run', failureStage: null, checks: CHECKS.map(id => ({ id, status: 'not_run' })), planningArtifacts: 0, bodyArtifacts: 0, bodyScalars: 0,
      requestOrigins: 0, dispatchIntents: 0, attempts: 0, readOnlyChecks: 0, reloads: 0, processReopens: 0, heldReadRaces: 0, configurationReads: 0 })),
    browserErrors: 0, blockedExternalRequests: 0, liveModelCalls: 0, actualFixtureInvocations: null,
    teardown: 'not_run', sourceStable: 'not_checked', semanticConsistency: 'NOT_RUN', autonomousGeneration: 'NOT_RUN', wholeWorkAudit: 'NOT_RUN' }
  const target = path.join(root, 'artifacts/writer-campaign-planning/ui-summary.json')
  let context, server, origin, activeCheck, lifecycleStage = 'launch'
  const persist = async () => { validatePlanningUiReport(report); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, `${JSON.stringify(report, null, 2)}\n`) }
  const watch = page => page.on('pageerror', () => { report.browserErrors++ })
  async function launch(profile) {
    lifecycleStage = 'launch'
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 950 }, locale: 'zh-CN', env: { ...process.env, HOME: privateRoot, XDG_CONFIG_HOME: path.join(privateRoot, 'config'), XDG_CACHE_HOME: path.join(privateRoot, 'cache') }, ...(executablePath ? { executablePath } : {}) })
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue()
      report.blockedExternalRequests++; return route.abort()
    })
    context.on('page', watch); context.pages().forEach(watch)
    await context.addInitScript(installPreviewReadGate, { expectedOrigin: origin })
    const page = context.pages()[0] ?? await context.newPage()
    lifecycleStage = 'navigation'; await page.goto(`${origin}/#/campaigns`); lifecycleStage = 'initial_ready'; await expect(node(page, 'refresh')).toBeEnabled(); return page
  }
  async function select(page, id) { await node(page, `select-${id}`).click(); await expect(node(page, 'id')).toHaveText(id); await expect(node(page, 'refresh')).toBeEnabled() }
  async function preview(page, chapter) {
    await node(page, `preview-chapter-${chapter}`).click(); await expect(node(page, 'preview-selected')).toContainText(`${chapter} ·`)
    await expect(node(page, 'preview-loading')).toHaveCount(0)
    const digest = await node(page, 'preview-digest').innerText(); assert.match(digest, /^[a-f0-9]{64}$/); return digest
  }
  async function hold(page, id, chapter = 1) {
    await page.evaluate(key => globalThis.__planningUiReadGate.arm(key), `writer-campaign:${encodeURIComponent(id)}:head`)
    await node(page, `preview-chapter-${chapter}`).click()
    await expect.poll(() => page.evaluate(() => globalThis.__planningUiReadGate.snapshot().held)).toBe(true)
  }
  const release = page => page.evaluate(() => globalThis.__planningUiReadGate.release())
  const empty = async page => { await expect(node(page, 'preview-empty')).toBeVisible(); await expect(node(page, 'preview-digest')).toHaveCount(0) }
  const noWrites = async (page, id, before, row) => { const after = await observe(page, id); assert.deepEqual(after, before); row.readOnlyChecks++ }
  try {
    const out = path.join(privateRoot, 'dist')
    await build({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'silent', build: { outDir: out, emptyOutDir: true } })
    const assets = new Map()
    async function collect(directory, prefix = '') {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue
        const name = `${prefix}/${entry.name}`, actual = path.join(directory, entry.name)
        if (entry.isDirectory()) await collect(actual, name); else assets.set(name, await readFile(actual))
      }
    }
    await collect(out); report.source.buildSha256 = hash(JSON.stringify([...assets].map(([name, bytes]) => [name, hash(bytes)]).sort(([a], [b]) => a.localeCompare(b))))
    server = createServer((request, response) => {
      const key = request.url?.split('?')[0] === '/' ? '/index.html' : request.url?.split('?')[0], bytes = assets.get(key)
      if (!bytes || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404).end(); return }
      const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }[path.extname(key)] ?? 'application/octet-stream'
      response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }).end(request.method === 'HEAD' ? undefined : bytes)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`
    await persist()
    for (const row of report.cases) {
      const check = async (id, fn) => { activeCheck = row.checks.find(check => check.id === id); await fn(); activeCheck.status = 'pass'; await persist() }
      let page, campaignId, secondaryId, plans, digest3
      const profile = await mkdtemp(path.join(privateRoot, `profile-${row.language}-`))
      try {
        page = await launch(profile); row.setup = 'pass'
        await check('create_refusal', async () => {
          await node(page, `create-planning-${row.language}`).click(); await expect(node(page, 'status')).toHaveAttribute('data-status', 'prepared')
          campaignId = await node(page, 'id').innerText(); const before = await observe(page, campaignId)
          assert.equal(before.requestOrigins, 0); assert.equal(before.bodyArtifacts, 0)
          await node(page, 'preview-chapter-3').click(); await expect(node(page, 'preview-refusal')).toContainText('incomplete_plan')
          await noWrites(page, campaignId, before, row)
        })
        await check('plans_freeze', async () => {
          for (let step = 1; step <= 6; step++) { await node(page, 'step').click(); await expect(node(page, 'task-progress')).toHaveText(`${step} / 9（不是长篇验收）`); await expect(node(page, 'refresh')).toBeEnabled() }
          plans = await observe(page, campaignId)
          assert.equal(plans.runtimeIdentity, `campaign-core-sha256:${report.source.coreSha256}`)
          for (const key of ['planningArtifacts', 'requestOrigins', 'dispatchIntents', 'attempts']) { assert.equal(plans[key], 6); row[key] = plans[key] }
          for (const key of ['bodyArtifacts', 'bodyScalars']) { assert.equal(plans[key], 0); row[key] = plans[key] }
        })
        await check('later_preview_readonly', async () => {
          digest3 = await preview(page, 3); await expect(node(page, 'preview-next-body')).toContainText('b-1')
          await expect(node(page, 'preview-scope-details')).toContainText('"realizedBodyCoverage": "none"')
          await expect(node(page, 'preview-scope-details')).toContainText('"omittedChapterOutlineCount": 2')
          await noWrites(page, campaignId, plans, row)
        })
        await check('chapter_reselection', async () => { assert.notEqual(await preview(page, 1), digest3); assert.equal(await preview(page, 3), digest3); await noWrites(page, campaignId, plans, row) })
        await check('newer_chapter_race', async () => {
          await hold(page, campaignId); assert.equal(await preview(page, 3), digest3); await release(page)
          await expect(node(page, 'preview-selected')).toContainText('3 ·'); assert.equal(await node(page, 'preview-digest').innerText(), digest3)
          await noWrites(page, campaignId, plans, row); row.heldReadRaces++
        })
        await check('refresh_race', async () => {
          await hold(page, campaignId); await node(page, 'refresh').click(); await expect(node(page, 'refresh')).toBeEnabled(); await release(page); await empty(page)
          await noWrites(page, campaignId, plans, row); row.heldReadRaces++
        })
        await check('reload', async () => {
          await preview(page, 3)
          const beforeDocument = await page.evaluate(() => ({ origin: performance.timeOrigin, id: globalThis.__planningUiDocumentId ??= crypto.randomUUID() }))
          await page.reload(); await expect(node(page, 'refresh')).toBeEnabled(); await select(page, campaignId); await empty(page)
          const afterDocument = await page.evaluate(() => ({ origin: performance.timeOrigin, id: globalThis.__planningUiDocumentId ??= crypto.randomUUID() }))
          assert.notEqual(afterDocument.origin, beforeDocument.origin); assert.notEqual(afterDocument.id, beforeDocument.id)
          assert.equal(await preview(page, 3), digest3); await noWrites(page, campaignId, plans, row); row.reloads++
        })
        await check('process_reopen', async () => {
          await context.close(); context = null; page = await launch(profile); await select(page, campaignId); await empty(page)
          assert.equal(await preview(page, 3), digest3); await noWrites(page, campaignId, plans, row); row.processReopens++
        })
        await check('campaign_selection_race', async () => {
          await node(page, `create-planning-${row.language}`).click(); await expect(node(page, 'status')).toHaveAttribute('data-status', 'prepared')
          secondaryId = await node(page, 'id').innerText(); assert.notEqual(secondaryId, campaignId)
          const afterCreate = await observe(page, campaignId)
          // Only this explicit creation may change the all-Campaign namespace baseline.
          // The original selected Campaign and all ordinary bytes must stay exact.
          assert.deepEqual({ ...afterCreate, campaignNamespaceSha256: plans.campaignNamespaceSha256 }, plans)
          assert.notEqual(afterCreate.campaignNamespaceSha256, plans.campaignNamespaceSha256)
          plans = { ...plans, campaignNamespaceSha256: afterCreate.campaignNamespaceSha256 }
          await select(page, campaignId); await hold(page, campaignId); await select(page, secondaryId); await release(page); await empty(page)
          assert.equal((await observe(page, secondaryId)).requestOrigins, 0)
          await select(page, campaignId); assert.equal(await preview(page, 3), digest3); await noWrites(page, campaignId, plans, row); row.heldReadRaces++
        })
        await check('navigation_race', async () => {
          row.configurationReads = await page.evaluate(() => globalThis.__planningUiReadGate.snapshot().configurationReads); assert.equal(row.configurationReads, 0)
          await hold(page, campaignId); await page.getByRole('link', { name: '← 返回 LLM-Writer' }).click()
          await expect(page.getByTestId('app-navigation')).toBeVisible(); await release(page)
          await page.getByTestId('campaign-navigation').click(); await expect(node(page, 'refresh')).toBeEnabled(); await select(page, campaignId); await empty(page)
          const after = await observe(page, campaignId); assert.equal(after.campaignSha256, plans.campaignSha256)
          assert.equal(after.campaignNamespaceSha256, plans.campaignNamespaceSha256)
          // Dashboard's ordinary initialization is outside the privacy denominator;
          // it is not permission to rebase or ignore any Campaign namespace write.
          row.heldReadRaces++
        })
        await check('cancel_race', async () => {
          await select(page, secondaryId); await hold(page, secondaryId); await node(page, 'cancel').click()
          await expect(node(page, 'status')).toHaveAttribute('data-status', 'cancelled')
          const afterCancel = await observe(page, secondaryId)
          await release(page); await empty(page); await noWrites(page, secondaryId, afterCancel, row)
          const state = await observe(page, secondaryId); assert.equal(state.requestOrigins, 0); assert.equal(state.dispatchIntents, 0); assert.equal(state.bodyScalars, 0)
          await select(page, campaignId); row.heldReadRaces++
        })
        await check('cross_tab_change', async () => {
          const other = await context.newPage(); await other.goto(`${origin}/#/campaigns`); await expect(node(other, 'refresh')).toBeEnabled(); await select(other, campaignId)
          await hold(page, campaignId); await node(other, 'cancel').click(); await expect(node(other, 'status')).toHaveAttribute('data-status', 'cancelled')
          const afterCancel = await observe(page, campaignId)
          await release(page); await expect(node(page, 'preview-refusal')).toContainText('planning_cancelled'); await expect(node(page, 'preview-digest')).toHaveCount(0)
          await noWrites(page, campaignId, afterCancel, row)
          const state = await observe(page, campaignId); assert.equal(state.requestOrigins, 6); assert.equal(state.dispatchIntents, 6); assert.equal(state.bodyScalars, 0)
          assert.equal(state.status, 'cancelled'); assert.ok(state.sequence > plans.sequence)
          await node(page, 'refresh').click(); await expect(node(page, 'status')).toHaveAttribute('data-status', 'cancelled'); await empty(page)
          await other.close(); row.heldReadRaces++
        })
      } catch (error) {
        if (activeCheck) activeCheck.status = 'failed'
        else row.setup = 'failed'
        row.failureStage = activeCheck?.id ?? lifecycleStage
        // Failure details are private runner-local, excluded from every report/archive.
        await writeFile(path.join(privateRoot, `${row.language}-failure.txt`), String(error?.stack ?? error))
        process.stderr.write(`Planning UI ${row.language}: ${row.failureStage}_failed.\n`)
      } finally {
        if (context) await context.close().catch(() => { report.teardown = 'failed' }); context = null
        await persist(); activeCheck = null
      }
    }
  } catch { if (activeCheck) activeCheck.status = 'failed'; process.stderr.write('Planning UI: setup_failed.\n'); process.exitCode = 1 }
  finally {
    if (context) await context.close().catch(() => { report.teardown = 'failed' })
    if (server) await new Promise(resolve => server.close(resolve)).catch(() => { report.teardown = 'failed' })
    if (report.teardown !== 'failed') report.teardown = 'pass'
    const after = await planningUiEvidenceIdentity(root)
    report.sourceStable = ['sourceSha256', 'coreSha256', 'harnessSha256'].every(key => report.source[key] === after[key]) ? 'verified' : 'changed'
    await persist() // Only this closed derived summary; source-bearing local profiles are not archived.
  }
  const passed = report.cases.flatMap(row => row.checks).filter(check => check.status === 'pass').length
  if (planningUiReportExitCode(report)) process.exitCode = 1
  process.stdout.write(`Planning UI: ${passed}/${report.denominator} passed; native IDB, actual adapter entries unavailable; semanticConsistency=NOT_RUN.\n`)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(() => { process.stderr.write('Planning UI: report_or_setup_failed.\n'); process.exitCode = 1 })
}
