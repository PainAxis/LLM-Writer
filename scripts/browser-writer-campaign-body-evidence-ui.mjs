/* global process */
/** Actual built Campaign Lab UI. Native faults delay/abort native readonly transactions
 * or delay already-completed native digest results. No engine/repository/adapter is replaced.
 * Only closed source-free summaries are eligible for later archive; no local browser retry. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect as playwrightExpect } from '@playwright/test'
import { build } from 'vite'
import { bodyEvidenceIdentity, bodyEvidenceIdentityMatches } from './fixtures/writer-campaign-body-evidence-identity.mjs'
import { BODY_UI_CHECKS, emptyBodyEvidenceReport, bodyEvidenceReportExitCode, validateBodyEvidenceReport } from './fixtures/writer-campaign-body-evidence-report.ts'

const root = fileURLToPath(new URL('../', import.meta.url)), hash = bytes => createHash('sha256').update(bytes).digest('hex')
const expect = playwrightExpect.configure({ timeout: 15_000 })
const node = (page, name) => page.getByTestId(`campaign-${name}`)

/** One origin-gated init script owns all native captures; no init-script ordering assumption. */
export function installBodyEvidenceUiGate({ expectedOrigin }) {
  if (location.origin !== expectedOrigin) return
  const nativeStorage = { get: Storage.prototype.getItem, set: Storage.prototype.setItem, remove: Storage.prototype.removeItem, clear: Storage.prototype.clear }
  // Only unrelated release UI is suppressed, before measurement begins.
  nativeStorage.set.call(localStorage, 'lastReadAnnouncementVersion', '1.0.0')
  nativeStorage.set.call(localStorage, 'lastReadAnnouncementDate', '1792920000000')
  const counters = { networkEntries: 0, credentialEntries: 0, configurationReads: 0, ordinaryWriterMutations: 0, externalToolEntries: 0, campaignWriteEntries: 0 }
  const forbidden = kind => { counters[kind]++; throw new Error('body_evidence_ui_authority_entry') }
  globalThis.fetch = () => forbidden('networkEntries')
  for (const name of ['WebSocket', 'EventSource']) if (typeof globalThis[name] === 'function') globalThis[name] = function () { forbidden('networkEntries') }
  XMLHttpRequest.prototype.open = function () { forbidden('networkEntries') }
  navigator.sendBeacon = () => forbidden('networkEntries')
  if (navigator.credentials) for (const name of ['get', 'create', 'store']) navigator.credentials[name] = () => forbidden('credentialEntries')
  window.open = () => forbidden('externalToolEntries')
  Storage.prototype.getItem = function (key) {
    if (this === localStorage && ['apiConfig', 'customApiConfig', 'officialApiConfig'].includes(key)) counters.configurationReads++
    return nativeStorage.get.call(this, key)
  }
  for (const [name, original] of [['setItem', nativeStorage.set], ['removeItem', nativeStorage.remove], ['clear', nativeStorage.clear]]) {
    Storage.prototype[name] = function () { counters.ordinaryWriterMutations++; return original.apply(this, arguments) }
  }
  const nativeTransaction = IDBDatabase.prototype.transaction, nativeGet = IDBObjectStore.prototype.get
  const nativeCursor = IDBObjectStore.prototype.openCursor, nativeDigest = crypto.subtle.digest.bind(crypto.subtle)
  for (const name of ['put', 'add', 'delete', 'clear']) {
    const original = IDBObjectStore.prototype[name]
    IDBObjectStore.prototype[name] = function (_value, key) {
      const actualKey = name === 'delete' ? _value : key
      const campaign = this.transaction.db.name === 'llm-writer' && this.name === 'kv' && typeof actualKey === 'string' && actualKey.startsWith('writer-campaign:')
      counters[campaign ? 'campaignWriteEntries' : 'ordinaryWriterMutations']++
      return original.apply(this, arguments)
    }
  }
  const complete = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')
  let armedRead = null, pendingRead = null, pendingReadBatch = null, readObserved = 0, readReleased = 0, readAborts = 0
  let armedDigest = false, pendingDigest = null, digestObserved = 0, digestReleased = 0
  const selected = new WeakSet(), requestedKeys = new WeakMap()
  IDBObjectStore.prototype.get = function (key) {
    const request = nativeGet.apply(this, arguments)
    const keys = requestedKeys.get(this.transaction)
    // Three expected requests plus one permanent overflow marker, never an
    // unbounded key log or truncation that could turn an extra batch into a match.
    if (keys && keys.length < 4) keys.push(keys.length < 3 ? { store: this.name, key } : null)
    if (armedRead !== null && key === armedRead.key && this.transaction.mode === 'readonly') {
      if (armedRead.skip > 0) armedRead.skip--
      else {
        const action = armedRead.action; armedRead = null
        if (action === 'abort') { readAborts++; this.transaction.abort() }
        else selected.add(this.transaction)
      }
    }
    return request
  }
  IDBDatabase.prototype.transaction = function () {
    const tx = nativeTransaction.apply(this, arguments)
    if (tx.mode !== 'readonly') return tx
    requestedKeys.set(tx, [])
    let callback = null
    Object.defineProperty(tx, 'oncomplete', { configurable: true, get() { return callback }, set(value) {
      callback = value
      complete.set.call(tx, event => {
        // Select only after every native request is known and the native read
        // transaction actually completed. A first head probe is not a snapshot.
        const keys = requestedKeys.get(tx)
        let matchedBatch = null
        if (armedRead?.batchKeys && tx.db.name === 'llm-writer' && keys.length === armedRead.batchKeys.length
          && keys.every((row, index) => row.store === 'kv' && row.key === armedRead.batchKeys[index])) {
          matchedBatch = [...armedRead.batchKeys]; armedRead = null; selected.add(tx)
        }
        const invoke = () => { if (typeof callback === 'function') callback.call(tx, event) }
        if (selected.has(tx)) {
          if (pendingRead) throw new Error('body_evidence_ui_gate_overlap')
          selected.delete(tx); readObserved++; pendingRead = invoke; pendingReadBatch = matchedBatch
        } else invoke()
      })
    } })
    return tx
  }
  crypto.subtle.digest = function () {
    const hold = armedDigest; if (hold) armedDigest = false
    const result = nativeDigest(...arguments)
    if (!hold) return result
    return result.then(value => new Promise(resolve => {
      if (pendingDigest) throw new Error('body_evidence_ui_digest_overlap')
      digestObserved++; pendingDigest = () => resolve(value)
    }))
  }
  const bytesHash = async value => [...new Uint8Array(await nativeDigest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(n => n.toString(16).padStart(2, '0')).join('')
  globalThis.__bodyEvidenceUiGate = {
    armRead(key, action = 'hold', skip = 0) {
      if (armedRead !== null || pendingRead) throw new Error('body_evidence_ui_gate_busy')
      armedRead = { key, action, skip }
    },
    armReadBatch(keys) {
      if (armedRead !== null || pendingRead) throw new Error('body_evidence_ui_gate_busy')
      if (!Array.isArray(keys) || keys.length !== 3 || typeof keys[0] !== 'string' || !/^writer-campaign:.+:head$/.test(keys[0])
        || keys[1] !== 'writer-campaign:catalog' || typeof keys[2] !== 'string'
        || !keys[2].startsWith(`${keys[0].slice(0, -4)}checkpoint:`) || !/^[1-9][0-9]*$/.test(keys[2].slice(`${keys[0].slice(0, -4)}checkpoint:`.length))) throw new Error('body_evidence_ui_gate_batch')
      armedRead = { batchKeys: [...keys] }
    },
    releaseRead() { if (!pendingRead) throw new Error('body_evidence_ui_gate_empty'); const fn = pendingRead; pendingRead = null; pendingReadBatch = null; readReleased++; fn() },
    armDigest() { if (armedDigest || pendingDigest) throw new Error('body_evidence_ui_digest_busy'); armedDigest = true },
    releaseDigest() { if (!pendingDigest) throw new Error('body_evidence_ui_digest_empty'); const fn = pendingDigest; pendingDigest = null; digestReleased++; fn() },
    snapshot: () => ({ readHeld: pendingRead !== null, heldReadKind: pendingRead ? pendingReadBatch ? 'exact_read_batch' : 'key_request' : null, heldReadBatch: pendingReadBatch ? [...pendingReadBatch] : null, digestHeld: pendingDigest !== null, readObserved, readReleased, readAborts, digestObserved, digestReleased }),
    authority: () => ({ ...counters }),
    /** Browser-local independent byte oracle. Captured native reads avoid instrumenting the oracle itself. */
    async observe(id) {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('llm-writer', 1)
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('body_evidence_ui_oracle_open'))
      })
      let rows
      try {
        rows = await new Promise((resolve, reject) => {
          const tx = nativeTransaction.call(db, 'kv', 'readonly'), rows = [], cursor = nativeCursor.call(tx.objectStore('kv'))
          cursor.onsuccess = () => { if (cursor.result) { rows.push([String(cursor.result.key), cursor.result.value]); cursor.result.continue() } }
          tx.oncomplete = () => resolve(rows); tx.onerror = tx.onabort = () => reject(new Error('body_evidence_ui_oracle_read'))
        })
      } finally { db.close() }
      if (!rows.every(([key, value]) => typeof key === 'string' && typeof value === 'string')) throw new Error('body_evidence_ui_oracle_type')
      rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
      const prefix = `writer-campaign:${encodeURIComponent(id)}:`, campaign = rows.filter(([key]) => key.startsWith(prefix))
      const headRaw = campaign.find(([key]) => key === `${prefix}head`), head = headRaw ? JSON.parse(headRaw[1]) : null
      const checkpoint = head && JSON.parse(campaign.find(([key]) => key === `${prefix}checkpoint:${head.sequence}`)[1])
      const manifest = head && JSON.parse(campaign.find(([key]) => key === `${prefix}manifest:${head.manifestHash}`)[1])
      const artifacts = campaign.filter(([key]) => key.startsWith(`${prefix}artifact:`)).map(([, raw]) => JSON.parse(raw))
      const requests = campaign.filter(([key]) => key.startsWith(`${prefix}request:`)).map(([, raw]) => JSON.parse(raw))
      const local = Object.keys(localStorage).sort().map(key => [key, nativeStorage.get.call(localStorage, key)])
      return { campaignSha256: await bytesHash(campaign), campaignNamespaceSha256: await bytesHash(rows.filter(([key]) => key.startsWith('writer-campaign:'))),
        ordinarySha256: await bytesHash([rows.filter(([key]) => !key.startsWith('writer-campaign:')), local]),
        planningArtifacts: artifacts.filter(row => row.kind !== 'chapter_body').length, bodyArtifacts: artifacts.filter(row => row.kind === 'chapter_body').length,
        bodyScalars: checkpoint?.bodyCharacters ?? 0, requestOrigins: requests.filter(row => row.revision === 0).length,
        dispatchIntents: requests.filter(row => row.status === 'dispatch_intent').length, attempts: checkpoint?.budget.attempts ?? 0,
        sequence: head?.sequence ?? 0, status: checkpoint?.status ?? null, runtimeIdentity: manifest?.runtimeIdentity ?? null }
    },
  }
}

const observe = (page, id) => page.evaluate(id => globalThis.__bodyEvidenceUiGate.observe(id), id)
const authority = page => page.evaluate(() => globalThis.__bodyEvidenceUiGate.authority())
const gate = page => page.evaluate(() => globalThis.__bodyEvidenceUiGate.snapshot())
const releaseRead = page => page.evaluate(() => globalThis.__bodyEvidenceUiGate.releaseRead())
const releaseDigest = page => page.evaluate(() => globalThis.__bodyEvidenceUiGate.releaseDigest())

async function main() {
  const privateRoot = await mkdtemp(path.join(tmpdir(), 'body-evidence-ui-')), provenance = await bodyEvidenceIdentity(root)
  const report = emptyBodyEvidenceReport(provenance.source, 'ui'), target = path.join(root, 'artifacts/writer-campaign-body-evidence/ui-summary.json')
  let context, server, origin, activeCheck, lifecycleStage = 'launch'
  const persist = async () => { validateBodyEvidenceReport(report); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, `${JSON.stringify(report, null, 2)}\n`) }
  const watch = page => page.on('pageerror', () => { report.browserErrors++ })
  async function launch(profile) {
    lifecycleStage = 'launch'
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 950 }, locale: 'zh-CN', ...(executablePath ? { executablePath } : {}) })
    await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); report.blockedExternalRequests++; return route.abort() })
    context.on('page', watch); context.pages().forEach(watch)
    await context.addInitScript(installBodyEvidenceUiGate, { expectedOrigin: origin })
    const page = context.pages()[0] ?? await context.newPage()
    lifecycleStage = 'navigation'; await page.goto(`${origin}/#/campaigns`); lifecycleStage = 'initial_ready'; await expect(node(page, 'refresh')).toBeEnabled(); return page
  }
  async function select(page, id) { await node(page, `select-${id}`).click(); await expect(node(page, 'id')).toHaveText(id); await expect(node(page, 'refresh')).toBeEnabled() }
  async function create(page, language, steps) {
    await node(page, `create-body-evidence-${language}`).click(); await expect(node(page, 'status')).toHaveAttribute('data-status', 'prepared')
    const id = await node(page, 'id').innerText()
    for (let step = 1; step <= steps; step++) { await node(page, 'step').click(); await expect(node(page, 'task-progress')).toHaveText(`${step} / 9（不是长篇验收）`); await expect(node(page, 'refresh')).toBeEnabled() }
    return id
  }
  async function load(page, k = 3) {
    await node(page, `body-prefix-${k}`).click(); await node(page, 'body-load-example').click()
    await expect(node(page, 'body-draft-loading')).toHaveCount(0); await expect(node(page, 'body-draft-refusal')).toHaveCount(0)
    await expect(node(page, 'body-proposal-input')).not.toHaveValue('')
  }
  async function validate(page, k = 3) {
    await node(page, 'body-validate').click(); await expect(node(page, 'body-preview-loading')).toHaveCount(0)
    await expect(node(page, 'body-preview-ready')).toBeVisible()
    await expect(node(page, 'body-preview-prefix')).toHaveAttribute('data-prefix', String(k))
    const digest = await node(page, 'body-preview-digest').innerText(); assert.match(digest, /^[a-f0-9]{64}$/); return digest
  }
  async function empty(page) { await expect(node(page, 'body-preview-empty')).toBeVisible(); await expect(node(page, 'body-preview-digest')).toHaveCount(0) }
  async function edit(page, mode) {
    await node(page, 'body-proposal-input').evaluate((element, mode) => {
      const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
        : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
      const value = JSON.parse(element.value)
      if (mode === 'generic') { value.producer = { kind: 'local_declaration', version: 'ui-generic-v1' }; value.claims[0].statement = '<img data-body-evidence-injection="true" src="https://invalid.example/body-evidence-probe" onerror="globalThis.__bodyEvidenceInjected=true">' }
      else if (mode === 'bad-anchor') value.spans[0].quote += '!'
      else if (mode === 'no-examination') value.examination = { status: 'not_run', windows: [] }
      else throw new Error('body_evidence_ui_edit_mode')
      element.value = canonical(value); element.dispatchEvent(new Event('input', { bubbles: true }))
    }, mode)
  }
  async function holdRead(page, id) {
    await page.evaluate(key => globalThis.__bodyEvidenceUiGate.armRead(key), `writer-campaign:${encodeURIComponent(id)}:head`)
    await node(page, 'body-validate').click(); await expect.poll(async () => (await gate(page)).readHeld).toBe(true)
  }
  async function holdReadFence(page, id, successor) {
    const prefix = `writer-campaign:${encodeURIComponent(id)}:`
    const keys = [`${prefix}head`, 'writer-campaign:catalog', `${prefix}checkpoint:${successor}`]
    await page.evaluate(keys => globalThis.__bodyEvidenceUiGate.armReadBatch(keys), keys)
    await node(page, 'body-validate').click(); await expect.poll(async () => (await gate(page)).readHeld).toBe(true)
    const held = await gate(page)
    assert.equal(held.heldReadKind, 'exact_read_batch'); assert.deepEqual(held.heldReadBatch, keys)
  }
  async function holdDraft(page) {
    await page.evaluate(() => globalThis.__bodyEvidenceUiGate.armDigest())
    await node(page, 'body-load-example').click(); await expect.poll(async () => (await gate(page)).digestHeld).toBe(true)
  }
  const namespaceWindows = new WeakMap()
  function addAuthority(row, before, after) {
    const deltas = Object.fromEntries(Object.keys(before).map(key => [key, after[key] - before[key]]))
    assert.ok(Object.values(deltas).every(delta => Number.isSafeInteger(delta) && delta >= 0))
    row.authority.observed = true
    for (const [key, delta] of Object.entries(deltas)) {
      if (key in row.authority) row.authority[key] += delta
      if (key === 'campaignWriteEntries') row.previewCampaignWriteEntries += delta
    }
    assert.ok(Object.values(deltas).every(delta => delta === 0))
  }
  async function readOnly(page, id, row, action, baseline) {
    const before = baseline ?? await observe(page, id), auth = await authority(page)
    await action()
    const after = await observe(page, id)
    addAuthority(row, auth, await authority(page))
    const windows = namespaceWindows.get(row) ?? { before: [], after: [] }
    windows.before.push([activeCheck.id, before.campaignNamespaceSha256, before.ordinarySha256]); windows.after.push([activeCheck.id, after.campaignNamespaceSha256, after.ordinarySha256]); namespaceWindows.set(row, windows)
    row.namespaceHashBefore = hash(JSON.stringify(windows.before)); row.namespaceHashAfter = hash(JSON.stringify(windows.after))
    assert.deepEqual(after, before); row.readOnlyChecks++
  }
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
    await collect(out)
    report.buildArtifacts.ui = hash(JSON.stringify([...assets].map(([name, bytes]) => [name, hash(bytes)]).sort(([a], [b]) => a.localeCompare(b))))
    server = createServer((request, response) => {
      const key = request.url?.split('?')[0] === '/' ? '/index.html' : request.url?.split('?')[0], bytes = assets.get(key)
      if (!bytes || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404).end(); return }
      const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }[path.extname(key)] ?? 'application/octet-stream'
      response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }).end(request.method === 'HEAD' ? undefined : bytes)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`
    await persist()
    for (const row of report.uiCases) {
      const check = async (id, action) => { assert.ok(BODY_UI_CHECKS.includes(id)); activeCheck = row.checks.find(item => item.id === id); await action(); activeCheck.status = 'pass'; await persist() }
      let page, campaignId, secondaryId, primary, fixedDigest
      const profile = await mkdtemp(path.join(privateRoot, `profile-${row.language}-`))
      try {
        page = await launch(profile); row.status = 'running'
        await check('initial_no_body', async () => {
          campaignId = await create(page, row.language, 0)
          const before = await observe(page, campaignId)
          assert.equal(before.bodyArtifacts, 0); assert.equal(before.requestOrigins, 0)
          await readOnly(page, campaignId, row, async () => {
            await expect(node(page, 'body-load-example')).toBeDisabled(); await expect(node(page, 'body-validate')).toBeDisabled()
            await expect(node(page, 'body-proposal-input')).toHaveValue(''); await empty(page)
          }, before)
        })
        await check('nine_task_fixture', async () => {
          for (let step = 1; step <= 9; step++) { await node(page, 'step').click(); await expect(node(page, 'task-progress')).toHaveText(`${step} / 9（不是长篇验收）`); await expect(node(page, 'refresh')).toBeEnabled() }
          primary = await observe(page, campaignId)
          assert.equal(primary.runtimeIdentity, `campaign-core-sha256:${report.source.coreSha256}`)
          assert.equal(primary.status, 'completed'); assert.equal(primary.planningArtifacts, 6); assert.equal(primary.bodyArtifacts, 3)
          for (const key of ['requestOrigins', 'dispatchIntents', 'attempts']) assert.equal(primary[key], 9)
          assert.ok(primary.bodyScalars > 0)
          for (const key of ['planningArtifacts', 'bodyArtifacts', 'bodyScalars', 'requestOrigins', 'dispatchIntents', 'attempts']) row[key] = primary[key]
        })
        await check('fixed_preview', async () => readOnly(page, campaignId, row, async () => { await load(page); fixedDigest = await validate(page) }))
        await check('generic_editor', async () => readOnly(page, campaignId, row, async () => {
          await edit(page, 'generic'); await empty(page); assert.notEqual(await validate(page), fixedDigest)
          await node(page, 'body-preview-packet').locator('summary').click()
          await expect(node(page, 'body-preview-packet').locator('pre')).toContainText('<img data-body-evidence-injection')
          await expect(page.locator('[data-body-evidence-injection]')).toHaveCount(0)
          assert.equal(await page.evaluate(() => globalThis.__bodyEvidenceInjected), undefined)
        }))
        await check('oversized_editor', async () => readOnly(page, campaignId, row, async () => {
          // Repeat while the model is already empty: a :value binding alone must not leave rejected DOM input behind.
          for (let attempt = 0; attempt < 2; attempt++) {
            await node(page, 'body-proposal-input').fill('x'.repeat(65_537))
            await expect(node(page, 'body-proposal-input')).toHaveValue('')
            await expect(node(page, 'body-draft-refusal')).toContainText('envelope_budget_exceeded')
            await expect(node(page, 'body-validate')).toBeDisabled(); await empty(page)
          }
          await load(page); assert.equal(await validate(page), fixedDigest)
        }))
        await check('forged_anchor_refusal', async () => readOnly(page, campaignId, row, async () => {
          await edit(page, 'bad-anchor'); await empty(page); await node(page, 'body-validate').click()
          await expect(node(page, 'body-preview-refusal')).toContainText(/quote_mismatch|quote_hash_mismatch/); await expect(node(page, 'body-preview-digest')).toHaveCount(0)
        }))
        await check('coverage_not_reviewed', async () => readOnly(page, campaignId, row, async () => {
          await load(page); await edit(page, 'no-examination'); await validate(page)
          await expect(node(page, 'body-preview-coverage')).toContainText('not_reviewed')
          await expect(node(page, 'body-preview-coverage')).toContainText('not_run')
          await expect(node(page, 'body-preview-coverage')).toContainText('not_assessed')
          await expect(node(page, 'body-semantic-boundary')).toContainText('NOT RUN')
        }))
        await check('prefix_reselection', async () => readOnly(page, campaignId, row, async () => { await load(page, 1); const first = await validate(page, 1); assert.notEqual(first, fixedDigest); await load(page); assert.equal(await validate(page), fixedDigest) }))
        await check('preview_edit_race', async () => readOnly(page, campaignId, row, async () => {
          await holdRead(page, campaignId); await edit(page, 'generic'); await empty(page); await releaseRead(page); await empty(page); row.heldReadRaces++
        }))
        await check('preview_prefix_race', async () => readOnly(page, campaignId, row, async () => {
          await load(page); await holdRead(page, campaignId); await node(page, 'body-prefix-1').click(); await empty(page); await releaseRead(page); await empty(page); row.heldReadRaces++
        }))
        await check('preview_refresh_race', async () => readOnly(page, campaignId, row, async () => {
          await load(page); await holdRead(page, campaignId); await node(page, 'refresh').click(); await expect(node(page, 'refresh')).toBeEnabled(); await releaseRead(page); await empty(page); row.heldReadRaces++
        }))
        await check('planning_body_race', async () => readOnly(page, campaignId, row, async () => {
          await load(page); await holdRead(page, campaignId); await node(page, 'preview-chapter-3').click(); await expect(node(page, 'preview-digest')).toBeVisible(); await releaseRead(page); await empty(page)
          await validate(page); await expect(node(page, 'preview-digest')).toHaveCount(0); row.heldReadRaces++
        }))
        await check('draft_edit_race', async () => readOnly(page, campaignId, row, async () => {
          await load(page); await holdDraft(page); await edit(page, 'generic'); const edited = await node(page, 'body-proposal-input').inputValue()
          await releaseDigest(page); await expect(node(page, 'body-draft-loading')).toHaveCount(0); await expect(node(page, 'body-proposal-input')).toHaveValue(edited); await empty(page); row.heldDraftRaces++
        }))
        await check('draft_reload_race', async () => readOnly(page, campaignId, row, async () => {
          await holdDraft(page); await node(page, 'body-load-example').click(); await expect(node(page, 'body-draft-loading')).toHaveCount(0)
          const newest = await node(page, 'body-proposal-input').inputValue(); await releaseDigest(page); await expect(node(page, 'body-proposal-input')).toHaveValue(newest); assert.equal(await validate(page), fixedDigest); row.heldDraftRaces++
        }))
        await check('draft_prefix_race', async () => readOnly(page, campaignId, row, async () => {
          await holdDraft(page); await node(page, 'body-prefix-1').click(); const afterChange = await node(page, 'body-proposal-input').inputValue()
          await releaseDigest(page); await expect(node(page, 'body-proposal-input')).toHaveValue(afterChange); await empty(page); row.heldDraftRaces++
        }))
        await check('draft_navigation_race', async () => {
          await load(page); const before = await observe(page, campaignId); await holdDraft(page)
          await page.getByRole('link', { name: '← 返回 LLM-Writer' }).click(); await expect(page.getByTestId('app-navigation')).toBeVisible(); await releaseDigest(page)
          await page.getByTestId('campaign-navigation').click(); await expect(node(page, 'refresh')).toBeEnabled(); await select(page, campaignId); await empty(page)
          await expect(node(page, 'body-proposal-input')).toHaveValue('')
          const after = await observe(page, campaignId); assert.equal(after.campaignSha256, before.campaignSha256); assert.equal(after.campaignNamespaceSha256, before.campaignNamespaceSha256)
          row.heldDraftRaces++
        })
        await check('reload', async () => {
          await load(page); await validate(page); const before = await observe(page, campaignId)
          const documentBefore = await page.evaluate(() => ({ origin: performance.timeOrigin, id: globalThis.__bodyEvidenceDocumentId ??= crypto.randomUUID() }))
          await page.reload(); await expect(node(page, 'refresh')).toBeEnabled(); await select(page, campaignId); await empty(page); await expect(node(page, 'body-proposal-input')).toHaveValue('')
          const documentAfter = await page.evaluate(() => ({ origin: performance.timeOrigin, id: globalThis.__bodyEvidenceDocumentId ??= crypto.randomUUID() }))
          assert.notEqual(documentAfter.origin, documentBefore.origin); assert.notEqual(documentAfter.id, documentBefore.id)
          assert.deepEqual(await observe(page, campaignId), before)
          await readOnly(page, campaignId, row, async () => { await load(page); assert.equal(await validate(page), fixedDigest) }); row.reloads++
        })
        await check('process_reopen', async () => {
          const before = await observe(page, campaignId); await context.close(); context = null; page = await launch(profile); await select(page, campaignId); await empty(page)
          await expect(node(page, 'body-proposal-input')).toHaveValue(''); assert.deepEqual(await observe(page, campaignId), before)
          await readOnly(page, campaignId, row, async () => { await load(page); assert.equal(await validate(page), fixedDigest) }); row.processReopens++
        })
        await check('campaign_selection_race', async () => {
          secondaryId = await create(page, row.language, 7); await select(page, campaignId); await load(page)
          await readOnly(page, campaignId, row, async () => {
            await holdRead(page, campaignId); await select(page, secondaryId); await releaseRead(page); await empty(page); await expect(node(page, 'body-proposal-input')).toHaveValue('')
            await select(page, campaignId); await empty(page); row.heldReadRaces++
          })
        })
        await check('navigation_back_forward', async () => {
          await load(page); const before = await observe(page, campaignId); await holdRead(page, campaignId)
          await page.getByRole('link', { name: '← 返回 LLM-Writer' }).click(); await expect(page.getByTestId('app-navigation')).toBeVisible(); await releaseRead(page)
          await page.goBack(); await expect(node(page, 'refresh')).toBeEnabled(); await select(page, campaignId); await empty(page); await expect(node(page, 'body-proposal-input')).toHaveValue('')
          await page.goForward(); await expect(page.getByTestId('app-navigation')).toBeVisible(); await page.goBack(); await expect(node(page, 'refresh')).toBeEnabled(); await select(page, campaignId); await empty(page)
          const after = await observe(page, campaignId); assert.equal(after.campaignSha256, before.campaignSha256); assert.equal(after.campaignNamespaceSha256, before.campaignNamespaceSha256); row.heldReadRaces++
        })
        await check('step_race', async () => {
          await select(page, secondaryId); await load(page, 1); const before = await observe(page, secondaryId); await holdRead(page, secondaryId)
          await node(page, 'step').click(); await expect(node(page, 'task-progress')).toHaveText('8 / 9（不是长篇验收）'); await expect(node(page, 'refresh')).toBeEnabled()
          const afterStep = await observe(page, secondaryId); assert.equal(afterStep.requestOrigins, before.requestOrigins + 1); assert.equal(afterStep.bodyArtifacts, before.bodyArtifacts + 1); assert.equal(afterStep.attempts, before.attempts + 1)
          await readOnly(page, secondaryId, row, async () => { await releaseRead(page); await empty(page) }, afterStep); row.heldReadRaces++
        })
        await check('cancel_race', async () => {
          const cancelId = await create(page, row.language, 7); await load(page, 1); await holdRead(page, cancelId)
          await node(page, 'cancel').click(); await expect(node(page, 'status')).toHaveAttribute('data-status', 'cancelled')
          const afterCancel = await observe(page, cancelId)
          await readOnly(page, cancelId, row, async () => { await releaseRead(page); await empty(page) }, afterCancel)
          assert.equal(afterCancel.requestOrigins, 7); assert.equal(afterCancel.bodyArtifacts, 1); row.heldReadRaces++
        })
        await check('cross_tab_change', async () => {
          await select(page, secondaryId); await load(page, 2)
          const other = await context.newPage(); await other.goto(`${origin}/#/campaigns`); await expect(node(other, 'refresh')).toBeEnabled(); await select(other, secondaryId)
          const beforeStep = await observe(page, secondaryId)
          assert.equal(beforeStep.bodyArtifacts, 2); assert.equal(beforeStep.attempts, 8)
          // Hold the initial verified read's exact final fence, not its legacy
          // head probe. Appending chapter 3 leaves K2 itself valid, but the later
          // independent read must detect that the observed source head changed.
          await holdReadFence(page, secondaryId, beforeStep.sequence + 1); await node(other, 'step').click(); await expect(node(other, 'task-progress')).toHaveText('9 / 9（不是长篇验收）'); await expect(node(other, 'refresh')).toBeEnabled()
          const afterStep = await observe(page, secondaryId)
          assert.equal(afterStep.sequence, beforeStep.sequence + 4); assert.equal(afterStep.bodyArtifacts, 3); assert.equal(afterStep.attempts, 9)
          await readOnly(page, secondaryId, row, async () => {
            await releaseRead(page); await expect(node(page, 'body-preview-refusal')).toContainText('Body evidence refused: source_changed。'); await expect(node(page, 'body-preview-ready')).toHaveCount(0); await expect(node(page, 'body-preview-digest')).toHaveCount(0)
          }, afterStep)
          await other.close(); row.heldReadRaces++
        })
        await check('read_fault', async () => {
          await select(page, campaignId); await load(page)
          await readOnly(page, campaignId, row, async () => {
            await page.evaluate(key => globalThis.__bodyEvidenceUiGate.armRead(key, 'abort'), `writer-campaign:${encodeURIComponent(campaignId)}:head`)
            await node(page, 'body-validate').click(); await expect(node(page, 'body-preview-refusal')).toContainText('preview_unavailable'); await expect(node(page, 'body-preview-digest')).toHaveCount(0)
            assert.equal((await gate(page)).readAborts, 1)
          })
        })
        row.status = 'pass'; row.failureStage = null
      } catch (error) {
        if (activeCheck) activeCheck.status = 'fail'
        row.status = 'failed'; row.failureStage = activeCheck?.id ?? lifecycleStage
        // Private failure text is never part of source-free report or archive.
        await writeFile(path.join(privateRoot, `${row.language}-failure.txt`), String(error?.stack ?? error))
        process.stderr.write(`Body Evidence UI ${row.language}: ${row.failureStage}_failed\n`)
      } finally {
        if (context) await context.close().catch(() => { report.teardown = 'failed' }); context = null
        await persist(); activeCheck = null
      }
    }
  } catch { if (activeCheck) activeCheck.status = 'fail'; process.stderr.write('Body Evidence UI: setup_failed\n'); process.exitCode = 1 }
  finally {
    if (context) await context.close().catch(() => { report.teardown = 'failed' })
    if (server) await new Promise(resolve => server.close(resolve)).catch(() => { report.teardown = 'failed' })
    if (report.teardown !== 'failed') report.teardown = 'pass'
    report.sourceStable = await bodyEvidenceIdentityMatches(root, report.source) ? 'verified' : 'changed'
    await persist()
  }
  if (bodyEvidenceReportExitCode(report)) process.exitCode = 1
  const passed = report.uiCases.flatMap(row => row.checks).filter(row => row.status === 'pass').length
  process.stdout.write(`Body Evidence UI: ${passed}/${BODY_UI_CHECKS.length * 2}; native IDB, actual adapter entries unavailable; semanticReview=NOT_RUN.\n`)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(() => { process.stderr.write('Body Evidence UI: report_or_setup_failed\n'); process.exitCode = 1 })
}
