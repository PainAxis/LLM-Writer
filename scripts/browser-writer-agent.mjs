/** Frozen 18-group production-build acceptance. CI ONLY: local browser launch,
 * installation and execution are prohibited. Use `node --check` locally.
 * Real Writer, APIService, MemoryWorker, source adapter and ordinary saves.
 * Only model replies are controlled loopback HTTP. No production test hooks.
 * Engineering boundary evidence is not a claim of model/literary quality. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium, expect as playwrightExpect } from '@playwright/test'
import { startPreviewServer } from './browser-preview.mjs'
import { installWriterAgentProbe } from './fixtures/writer-agent-browser-probe.mjs'
import { writerAgentProfile, hash } from './fixtures/writer-agent-browser-corpus.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = path.join(root, 'artifacts/browser-writer-agent')
const fixtureBytes = await readFile(new URL('./fixtures/writer-agent-v1.json', import.meta.url))
const fixtureHash = hash(fixtureBytes)
assert.equal(fixtureHash, 'c50bae17f6a8eaf38906d181fb6307e44b81d2d5abc9fce6ad4f078991bd169f')
assert.equal((await readFile(new URL('./fixtures/writer-agent-v1.sha256', import.meta.url), 'utf8')).trim().split(/\s+/)[0], fixtureHash)
const frozen = JSON.parse(fixtureBytes), fixture = frozen.fixtures
assert.equal(frozen.browserGroups.length, 18)
const expect = playwrightExpect.configure({ timeout: 25_000 })
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? 'unspecified', fixtureHash,
  denominator: 18, mode: 'built-production; controlled loopback model; real indexed retrieval and ordinary persistence', realModelRequests: 0,
  claim: 'Synthetic engineering acceptance, not writing quality, retrieval quality or cost evidence.',
  groups: frozen.browserGroups.map(group => ({ id: group.id, title: group.title, status: 'not_run', scenarios: [] })),
  countersProvenance: { providerHttpDispatches: 'actual loopback HTTP POST arrivals', modelReservations: 'copied production audit', toolReservations: 'copied production audit',
    toolExecutorEntries: 'production tool_started audit events', memoryWorkerSync: 'native real Worker.postMessage(type=sync)', memoryWorkerSearch: 'native real Worker.postMessage(type=search)',
    sourceReads: 'actual application IDBObjectStore.get of committed novel references; oracle-only transactions excluded and counted separately', editorAppendOperations: 'actual editor DOM draft-text multiplicity increase',
    novelSaveAttempts: 'Not observable as exact save-function entries without a production hook. Null in browser; Node exact-entry coverage is required.',
    savingIndicatorTransitions: 'Observed .saving-indicator rising edges only: UI proxy that Vue may coalesce, not exact save attempts',
    persistenceMetadataAttempts: 'Actual native Storage.setItem(novels) attempts, including controlled failures before native commit',
    persistenceCommitGates: 'Actual native IDBObjectStore.get of the ordinary persistence commit-gate sentinel',
    novelDurableCommits: 'successful native localStorage.setItem(novels), not controller knowledge',
    memoryPrepareStarts: 'Not observable independently before first source read without a production hook. Node exact-entry coverage is required; browser reports actual Worker sync separately.' },
  screenshots: [], browserErrors: [], blockedRequests: [], fixtureErrors: [], sourceProfiles: {}, gaps: [],
}
const sourceFiles = [
  'src/services/writerAgent.ts', 'src/services/writerAgentProtocol.ts', 'src/types/writerAgent.ts',
  'src/composables/useWriterAgent.ts', 'src/components/writer/panels/WriterAgentPanel.vue', 'src/views/Writer.vue',
  'src/composables/useWriterProject.ts', 'src/composables/writerPersistenceGate.ts',
  'src/services/novelPersistence.ts', 'src/services/api.ts', 'src/services/aiRequestLimits.ts',
  'src/services/memory/client.ts', 'src/services/memory/writerContext.ts', 'src/services/memory/labData.ts',
  'scripts/browser-writer-agent.mjs', 'scripts/fixtures/writer-agent-browser-probe.mjs', 'scripts/fixtures/writer-agent-browser-corpus.mjs',
]
report.sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, hash(await readFile(path.join(root, file)))])))
report.timeControl = 'Normal scenarios fix only Date for deterministic baseline timestamps and retain native performance/timeOrigin/timers. B12 and B15 pending scenarios install Playwright clock before the app and explicitly verify both wall and monotonic advancement.'
const cases = [], requests = [], boundaryRequests = [], heldHttp = new Set()
let preview, provider, browser, origin, providerOrigin, active, scenario, currentContext
const nodes = (page, id) => page.getByTestId(`writer-agent-${id}`)
const panel = page => nodes(page, 'panel')
const editor = page => page.locator('.editor-panel [contenteditable="true"]')
const dialogs = page => page.getByRole('dialog', { name: '连续性续写草稿 · 有界 Agent', exact: true })
const codeError = (code, message) => Object.assign(new Error(message), { code })
const register = (groupId, id, variant, run, options = {}) => cases.push({ groupId, id, variant, run, options })
function check(condition, label) { assert.ok(condition, label); scenario.assertions.push(label) }
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); scenario.assertions.push(label) }
function scenarioRequests() { return requests.filter(request => request.scenario === scenario.key && request.kind !== 'ordinary') }
function getPayload(body) {
  const content = body.messages?.find(message => message.role === 'user')?.content
  try { const parsed = JSON.parse(content); return parsed && typeof parsed.brief === 'string' && typeof parsed.tail === 'string' ? parsed : null } catch { return null }
}
function evidencePayload(text) {
  const marker = '\nWRITER_MEMORY_CONTEXT_JSON\n', at = text.indexOf(marker)
  assert.ok(at >= 0, 'Selected attachment is the real Writer Memory serialization')
  return JSON.parse(text.slice(at + marker.length))
}
function validateWire(body, payload, kind) {
  assert.deepEqual(Object.keys(payload).sort(), (kind === 'plan' ? ['brief', 'tail'] : ['brief', 'selectedEvidence', 'tail']).sort())
  assert.equal(payload.brief, active.brief)
  assert.equal(payload.tail, active.expectedTail)
  assert.equal(body.tools, undefined); assert.notEqual(body.stream, true)
  assert.equal(body.max_tokens ?? body.max_completion_tokens, 1200)
  const system = body.messages.find(message => message.role === 'system')?.content
  const framed = JSON.stringify({ system, prompt: JSON.stringify(payload) })
  assert.ok(framed.length <= 16384 && Buffer.byteLength(framed) <= 65536)
  const wire = JSON.stringify(body.messages)
  for (const key of ['futureA', 'futureB', 'otherNovel', 'material', 'outline', 'alias']) assert.ok(!wire.includes(fixture.canaries[key]), `${key} excluded from actual wire`)
  if (kind === 'plan') {
    assert.ok(!wire.includes(fixture.anchorSelection.choose.quote), 'Planner has no retrieved source')
    assert.ok(!wire.includes(fixture.canaries.unselected))
  } else {
    assert.equal(typeof payload.selectedEvidence, 'string'); assert.ok(payload.selectedEvidence.length <= 6000)
    const evidence = evidencePayload(payload.selectedEvidence)
    assert.equal(evidence.projectId, active.profile.projectId); assert.equal(evidence.throughChapterId, active.profile.targetId)
    assert.deepEqual(evidence.relations, []); assert.ok(evidence.sources.length > 0 && evidence.sources.length <= 6)
    assert.deepEqual(evidence.sources.map(source => `${source.chapterId}:${source.quote}`), active.selected.map(source => `${source.chapterId}:${source.quote}`))
    for (const source of evidence.sources) {
      const chapter = active.profile.chapters.find(chapter => chapter.id === source.chapterId)
      assert.ok(chapter && active.profile.chapters.indexOf(chapter) <= active.profile.chapters.indexOf(active.profile.target))
      assert.equal(chapter.text.slice(source.start, source.end), source.quote)
      assert.equal(source.revision, hash(JSON.stringify([chapter.title, chapter.text])))
      assert.ok(!/^[\uDC00-\uDFFF]/.test(source.quote) && !/[\uD800-\uDBFF]$/.test(source.quote))
    }
    if (active.profile.kind !== 'source-instruction') assert.ok(!wire.includes(fixture.canaries.unselected))
    assert.ok(!wire.includes(fixture.validPlanText), 'Draft does not inherit planner transcript')
    scenario.selectedSources = evidence.sources.map(source => ({ chapterId: source.chapterId, start: source.start, end: source.end, revision: source.revision, quoteSha256: hash(source.quote) }))
  }
}
async function startProvider() {
  provider = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Synthetic-Identity')
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return }
    boundaryRequests.push({ scenario: scenario?.key, method: request.method, kind: request.url.endsWith('/embeddings') ? 'embeddings' : request.url.endsWith('/rerank') ? 'rerank' : request.url.endsWith('/chat/completions') ? 'model' : 'other' })
    try {
      assert.equal(request.method, 'POST'); assert.ok(request.url.endsWith('/chat/completions'), 'No embedding/rerank/tool/discovery/fallback endpoint')
      const chunks = []; for await (const chunk of request) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')), payload = getPayload(body)
      const kind = payload ? Object.hasOwn(payload, 'selectedEvidence') ? 'draft' : 'plan' : 'ordinary'
      const entry = { scenario: scenario.key, kind, bytes: Buffer.byteLength(JSON.stringify(body)), status: 'pending', body, payload }
      requests.push(entry)
      if (kind !== 'ordinary') {
        assert.ok(scenarioRequests().length <= 2, 'Actual HTTP ceiling is two even after errors or cancellation')
        validateWire(body, payload, kind)
      }
      let answer = kind === 'plan' ? active.plan : active.draft
      const mode = kind === 'plan' ? active.planMode : active.draftMode
      if (mode === 'draft2001') answer = '铃'.repeat(2001)
      if (mode === 'empty') answer = ''
      const envelope = { id: `writer-agent-fixture-${requests.length}`, object: 'chat.completion', created: 1, model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: mode === 'length' ? 'length' : 'stop' }],
        usage: { prompt_tokens: kind === 'plan' ? 80 : 140, completion_tokens: kind === 'plan' ? 30 : 40, total_tokens: kind === 'plan' ? 110 : 180 } }
      if (mode === 'decoded_bytes') envelope.reasoning_envelope = '铃'.repeat(24000)
      const output = JSON.stringify(envelope)
      entry.responseBytes = Buffer.byteLength(output)
      const send = () => {
        heldHttp.delete(send)
        if (response.destroyed) { entry.status = 'aborted'; return }
        entry.status = 200; response.writeHead(200, { 'Content-Type': 'application/json' }).end(output)
      }
      send.scenario = scenario.key; send.kind = kind
      response.on('close', () => { if (!response.writableEnded) entry.status = 'aborted' })
      if (mode === 'hold' || mode === 'timeout' || kind === 'ordinary') heldHttp.add(send)
      else send()
    } catch (error) {
      report.fixtureErrors.push({ scenario: scenario?.key, error: String(error.message).slice(0, 500) })
      if (!response.destroyed) response.writeHead(500).end('{"error":"Synthetic fixture rejected invalid wire"}')
    }
  })
  await new Promise((resolve, reject) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', resolve) })
  providerOrigin = `http://127.0.0.1:${provider.address().port}`
}
const releaseHttp = kind => { for (const send of [...heldHttp]) if (send.scenario === scenario.key && (!kind || send.kind === kind)) send() }

async function advanceClock(milliseconds) {
  const before = await active.page.evaluate(() => ({ wall: Date.now(), monotonic: performance.now() }))
  await active.page.clock.fastForward(milliseconds)
  const after = await active.page.evaluate(() => ({ wall: Date.now(), monotonic: performance.now() }))
  check(after.wall - before.wall >= milliseconds && after.monotonic - before.monotonic >= milliseconds,
    'Controlled deadline advance moves both wall and monotonic clocks')
  scenario.clockAdvances ??= []; scenario.clockAdvances.push({ requestedMs: milliseconds, wallDeltaMs: after.wall - before.wall, monotonicDeltaMs: after.monotonic - before.monotonic })
}

async function dismiss(page) {
  const button = page.getByRole('button', { name: '我知道了', exact: true })
  try { await button.waitFor({ state: 'visible', timeout: 800 }); await button.click() } catch { /* Optional release announcement, not a tested gate. */ }
}
async function fresh(options = {}) {
  const profile = writerAgentProfile(frozen, options.profile ?? 'small'), width = options.width ?? 1280
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, locale: 'zh-CN', deviceScaleFactor: 1,
    isMobile: width === 390, hasTouch: width === 390, permissions: ['clipboard-read', 'clipboard-write'] })
  currentContext = context // Also close failures during fixture initialization, before active exists.
  if (!options.clock) await context.addInitScript(() => {
    // Stabilize incidental ordinary-save timestamps across two real tabs without
    // mocking native timers, performance.now or document timeOrigin.
    const NativeDate = globalThis.Date, epoch = NativeDate.parse('2026-10-23T12:00:00.000Z')
    function FixtureDate(...args) {
      if (new.target) return Reflect.construct(NativeDate, args.length ? args : [epoch], new.target)
      return new NativeDate(epoch).toString()
    }
    Object.setPrototypeOf(FixtureDate, NativeDate); FixtureDate.prototype = NativeDate.prototype
    FixtureDate.now = () => epoch; globalThis.Date = FixtureDate
  })
  await context.addInitScript(installWriterAgentProbe, { providerOrigin })
  context.on('page', page => {
    page.setDefaultTimeout(25_000)
    page.on('pageerror', error => report.browserErrors.push({ scenario: scenario.key, error: error.message.slice(0, 400) }))
    page.on('dialog', dialog => { if (dialog.type() === 'beforeunload') void dialog.accept(); else void dialog.dismiss() })
  })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (['blob:', 'data:'].includes(url.protocol) || [origin, providerOrigin].includes(url.origin)) return route.continue()
    report.blockedRequests.push({ scenario: scenario.key, target: `${url.origin}${url.pathname}` }); return route.abort('blockedbyclient')
  })
  const page = await context.newPage()
  if (options.clock) await page.clock.install({ time: new Date('2026-10-23T12:00:00.000Z') })
  await page.goto(`${origin}/__test/health`)
  await page.evaluate(async ({ novels, apiBase, legacy }) => {
    localStorage.clear()
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('llm-writer', 1); request.onupgradeneeded = () => request.result.createObjectStore('kv'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite'), store = tx.objectStore('kv'); store.clear()
      for (const novel of novels) for (const chapter of novel.chapterList) {
        const key = `novel:${novel.id}:chapter:${chapter.id}:content:writer-agent-fixture`
        store.put(chapter.content, key); delete chapter.content; chapter.contentRef = key
      }
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
    }); db.close()
    localStorage.setItem('novels', JSON.stringify(novels))
    localStorage.setItem('lastReadAnnouncementVersion', '1.0.0') // Verified current source announcement, fixture setup only.
    localStorage.setItem('apiConfig', JSON.stringify({ apiKey: 'synthetic-placeholder-not-a-credential', provider: 'custom', baseURL: apiBase,
      selectedModel: 'writer-agent-browser-fixture', maxTokens: 1200, unlimitedTokens: false, temperature: 0, thinkingProtocol: 'auto', thinkingMode: 'default', customHeaders: {} }))
    localStorage.setItem('extensions', JSON.stringify({ enabled: Boolean(legacy), servers: [], importedSkills: [], selectedSkillIds: [],
      selectedNovelId: 910001, writingToolIds: legacy ? ['writing_search', 'writing_read_chapter'] : [], maxSteps: 5 }))
  }, { novels: profile.novels, apiBase: `${providerOrigin}/v1`, legacy: options.legacy })
  active = { context, page, profile, brief: fixture.authorBrief, expectedTail: profile.target.text.slice(-2000), selected: [],
    plan: fixture.validPlanText, draft: options.draft ?? fixture.draftText, planMode: 'ok', draftMode: 'ok' }
  report.sourceProfiles[profile.kind] = { sourceSha256: profile.sourceHash, chapters: profile.chapters.length, utf16: profile.totalChars, targetId: profile.targetId }
  await openWriter(page)
  await restageCommittedBaseline(page)
  await page.evaluate(draft => globalThis.__writerAgentProbe.reset(draft), active.draft)
  active.timeOrigin = await page.evaluate(() => performance.timeOrigin)
  return active
}

async function restageCommittedBaseline(page) {
  // Normal target selection legitimately saves and can inline short chapters.
  // Complete fixture initialization AFTER that action so later source holds
  // observe real hydration, not a fake reader. Values are unchanged, and no
  // baseline operation is counted as Agent work. No backup/export is written.
  const identity = await page.evaluate(async () => {
    const probe = globalThis.__writerAgentProbe
    if (document.querySelector('[data-testid="writer-agent-panel"]')) throw new Error('Cannot restage a live Agent scenario')
    const previousActor = probe.actor; probe.actor = 'fixture-initialization'
    const novels = JSON.parse(localStorage.getItem('novels'))
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('llm-writer', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    const pending = novels.flatMap(novel => novel.chapterList.filter(chapter => typeof chapter.content !== 'string' && chapter.contentRef))
    if (pending.length) await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly'); tx.__writerAgentOracle = true
      for (const chapter of pending) { const request = tx.objectStore('kv').get(chapter.contentRef); request.onsuccess = () => { chapter.content = request.result }; request.onerror = () => reject(request.error) }
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
    })
    for (const novel of novels) for (const chapter of novel.chapterList) delete chapter.contentRef
    const canonical = data => JSON.stringify(data, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value)
    const before = canonical(novels)
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite'), store = tx.objectStore('kv')
      for (const novel of novels) for (const chapter of novel.chapterList) {
        if (typeof chapter.content !== 'string') throw new Error('Fixture baseline body missing')
        const key = `novel:${novel.id}:chapter:${chapter.id}:content:writer-agent-final-baseline`
        store.put(chapter.content, key); chapter.contentRef = key; delete chapter.content
      }
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
    })
    localStorage.setItem('novels', JSON.stringify(novels))
    const hydrated = JSON.parse(localStorage.getItem('novels'))
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly'); tx.__writerAgentOracle = true
      for (const novel of hydrated) for (const chapter of novel.chapterList) {
        const request = tx.objectStore('kv').get(chapter.contentRef)
        request.onsuccess = () => { chapter.content = request.result; delete chapter.contentRef }
        request.onerror = () => reject(request.error)
      }
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
    })
    const after = canonical(hydrated)
    if (before !== after) throw new Error('Restaging changed the canonical hydrated fixture')
    const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), value => value.toString(16).padStart(2, '0')).join('')
    const result = { beforeSha256: await digest(before), afterSha256: await digest(after) }
    db.close(); probe.actor = previousActor; return result
  })
  equal(identity.beforeSha256, identity.afterSha256, 'Fixture restaging preserves canonical hydrated semantic content')
  scenario.baselineIdentities ??= []; scenario.baselineIdentities.push(identity)
}

async function openWriter(page, { novelId = active.profile.novelId, chapterId = active.profile.targetId, title = active.profile.target.title } = {}) {
  await page.goto(`${origin}/#/writer?novelId=${novelId}`); await dismiss(page)
  const chapter = page.locator('.chapter-item').filter({ has: page.locator('.chapter-info > p', { hasText: title }) }).first()
  await chapter.click()
  await expect(editor(page)).toBeVisible()
  if (chapterId === active.profile.targetId) await expect(editor(page)).toHaveText(active.profile.target.text, { useInnerText: true })
}
async function currentProbe(page = active.page) { return page.evaluate(() => globalThis.__writerAgentProbe.snapshot()) }
async function arm(rule, page = active.page) { await page.evaluate(rule => globalThis.__writerAgentProbe.arm(rule), rule) }
async function waitHold(label, page = active.page) {
  await expect.poll(() => page.evaluate(label => globalThis.__writerAgentProbe.holds.some(hold => hold.label === label), label), { timeout: 25_000 }).toBe(true)
  scenario.assertions.push(`Real callback reached held boundary: ${label}`)
}
async function release(label, page = active.page) { return page.evaluate(label => globalThis.__writerAgentProbe.release(label), label) }
async function phase(value, page = active.page) {
  await expect(panel(page)).toHaveAttribute('data-phase', value, { timeout: value === 'awaiting_evidence' ? 100_000 : 30_000 })
  scenario.assertions.push(`Actual mounted phase: ${value}`)
}
async function absent(ids, page = active.page) { for (const id of ids) await expect(nodes(page, id)).toHaveCount(0) }
async function visible(ids, page = active.page) { for (const id of ids) await expect(nodes(page, id)).toBeVisible() }
async function assertPhaseNodes(value) {
  await phase(value)
  const map = {
    idle: { yes: ['brief', 'cutoff', 'preview-action', 'audit'], no: ['preview', 'start', 'evidence', 'draft', 'apply'] },
    previewed: { yes: ['preview', 'tail', 'grant', 'start', 'audit'], no: ['evidence', 'draft', 'apply'] },
    planning: { yes: ['progress', 'stop', 'audit'], no: ['evidence', 'draft', 'apply'] },
    executing_retrieval_tool: { yes: ['progress', 'stop', 'audit'], no: ['evidence', 'draft', 'apply'] },
    awaiting_evidence: { yes: ['receipt', 'evidence', 'approve', 'audit'], no: ['draft', 'apply'] },
    selecting_evidence: { yes: ['receipt', 'evidence', 'approval-progress', 'stop', 'audit'], no: ['draft', 'apply'] },
    drafting: { yes: ['receipt', 'progress', 'stop', 'audit'], no: ['evidence', 'draft', 'apply'] },
    awaiting_author: { yes: ['receipt', 'draft', 'copy', 'discard', 'apply', 'audit'], no: ['retry-save'] },
    applying: { yes: ['draft', 'copy', 'apply-progress', 'cancel-apply', 'audit'], no: ['apply', 'retry-save'] },
    commit_pending: { yes: ['draft', 'copy', 'save-pending'], no: ['apply', 'retry-save'] },
    commit_unknown: { yes: ['draft', 'copy', 'save-unknown'], no: ['apply', 'retry-save'] },
    applied_unsaved: { yes: ['draft', 'copy', 'save-failure', 'retry-save'], no: ['apply'] },
    applied: { yes: ['draft', 'copy', 'saved'], no: ['apply', 'retry-save'] },
  }
  const expected = map[value]; assert.ok(expected, `Mapped actual phase ${value}`)
  // Existence precedes scroll/visibility: future v-if branches are never searched.
  for (const id of expected.yes) { await expect(nodes(active.page, id)).toHaveCount(1); await nodes(active.page, id).scrollIntoViewIfNeeded(); await expect(nodes(active.page, id)).toBeVisible() }
  await absent(expected.no); scenario.assertions.push(`Actual v-if/disabled node contract: ${value}`)
}
async function openAgent() { await nodes(active.page, 'open').click(); await assertPhaseNodes('idle') }
async function previewAgent() {
  await openAgent()
  await nodes(active.page, 'brief').fill(active.brief); await nodes(active.page, 'cutoff').selectOption(active.profile.targetId)
  await nodes(active.page, 'preview-action').click(); await assertPhaseNodes('previewed')
  active.expectedTail = await nodes(active.page, 'tail').textContent()
  await expect(nodes(active.page, 'grant')).not.toBeChecked(); await expect(nodes(active.page, 'start')).toBeDisabled()
}
async function startAgent({ held = false } = {}) {
  await nodes(active.page, 'grant').check(); await nodes(active.page, 'start').click()
  if (held) await assertPhaseNodes('planning')
  else await evidenceReady()
}
async function evidenceReady() {
  await assertPhaseNodes('awaiting_evidence')
  const inputs = active.page.locator('[data-testid^="writer-agent-select-hit-"]')
  const count = await inputs.count(); check(count > 0 && count <= 6, 'Real candidate count is 1–6')
  for (let index = 0; index < count; index++) await expect(inputs.nth(index)).not.toBeChecked()
  await expect(nodes(active.page, 'approve')).toBeDisabled()
  await expect(nodes(active.page, 'selected-count')).toHaveText('已选择 0 条原文。')
}
async function selectAnchor() {
  // Match the real card's source identity and exact original quote, never a fake ID.
  const card = active.page.locator(`[data-testid^="writer-agent-hit-"][data-chapter-id="${active.profile.anchorId}"]`).filter({ has: active.page.locator('[data-testid="writer-agent-source-quote"]', { hasText: active.profile.anchorText }) }).first()
  await expect(card).toBeVisible(); const quote = await card.getByTestId('writer-agent-source-quote').textContent()
  if (active.profile.kind !== 'large') equal(quote, active.profile.anchorText, 'Selected card preserves exact original text')
  else check(quote.includes(active.profile.anchorText), 'Long profile selects complete chapter-two anchor span')
  active.selected = [{ chapterId: active.profile.anchorId, quote }]
  await card.locator('input[type="checkbox"]').check(); await expect(nodes(active.page, 'approve')).toBeEnabled()
}
async function draftReady() {
  await selectAnchor(); await nodes(active.page, 'approve').click(); await assertPhaseNodes('awaiting_author')
  await expect(nodes(active.page, 'draft-text')).toHaveText(active.draft)
}
async function happyToDraft() { await previewAgent(); await startAgent(); await draftReady() }
async function copyThroughUi(id) {
  const before = await currentProbe()
  check(before.clipboardAvailable, 'Native clipboard API is available; it is not replaced with fabricated success')
  const requestId = before.clipboardRequests + 1
  await nodes(active.page, id).scrollIntoViewIfNeeded(); await nodes(active.page, id).click()
  // DOM click completion does not await Vue's async handler or the native
  // clipboard Promise. Wait for THIS real native write, not old clipboard text.
  await expect.poll(async () => (await currentProbe()).clipboardCompletion?.requestId ?? 0).toBe(requestId)
  const after = await currentProbe()
  equal(after.clipboardRequests, requestId, 'One actual native clipboard request follows the author copy action')
  if (after.clipboardCompletion.status !== 'fulfilled') throw codeError('clipboard_write_rejected', `Native clipboard rejected: ${after.clipboardCompletion.errorName}`)
  return active.page.evaluate(() => globalThis.__writerAgentProbe.clipboard)
}
async function copyAudit() {
  const text = await copyThroughUi('copy-audit')
  const audit = JSON.parse(text)
  check(!text.includes(active.brief) && !text.includes(active.expectedTail) && !text.includes('synthetic-placeholder') && !text.includes(providerOrigin), 'Copied audit excludes source, brief, credentials and endpoint')
  equal(audit.events.length <= 32, true, 'Production audit stays within 32 events')
  scenario.audit = audit
  return audit
}
async function counters({ http, tools, sync, search, append = 0, savingTransitions = 0, commits = 0 } = {}) {
  const observed = await currentProbe(), audit = await copyAudit()
  const value = { providerHttpDispatches: scenarioRequests().length, modelReservations: audit.budget.modelReservations,
    toolReservations: audit.budget.toolReservations, toolExecutorEntries: audit.events.filter(event => event.kind === 'tool_started').length,
    memoryWorkerSync: observed.workerSync, memoryWorkerSearch: observed.workerSearch, sourceReads: observed.sourceReads, oracleReads: observed.oracleReads,
    editorAppendOperations: observed.editorAppends, novelSaveAttempts: null, savingIndicatorTransitions: observed.savingIndicatorTransitions, persistenceMetadataAttempts: observed.metadataAttempts,
    persistenceCommitGates: observed.commitGates, novelDurableCommits: observed.metadataCommits, graphReads: observed.graphReads,
    graphWrites: observed.graphWrites, hiddenDocumentWrites: observed.hiddenWrites, memoryPrepareStarts: null,
    externalSemanticRequests: boundaryRequests.filter(request => request.scenario === scenario.key && ['embeddings', 'rerank'].includes(request.kind)).length, blockedExternalRequests: report.blockedRequests.filter(entry => entry.scenario === scenario.key).length }
  scenario.counters = value
  if (http !== undefined) equal(value.providerHttpDispatches, http, 'Actual provider HTTP count')
  if (tools !== undefined) { equal(value.toolReservations, tools, 'Private tool reservations'); equal(value.toolExecutorEntries, tools, 'Actual production tool_started count') }
  if (sync !== undefined) equal(value.memoryWorkerSync, sync, 'Real indexed Worker sync count')
  if (search !== undefined) equal(value.memoryWorkerSearch, search, 'Real indexed Worker search count')
  equal(value.editorAppendOperations, append, 'Actual editor append count')
  equal(value.savingIndicatorTransitions, savingTransitions, 'Observed saving-indicator rising edges (UI proxy, not exact save entries)')
  equal(value.novelDurableCommits, commits, 'Independent durable commit count')
  for (const key of ['graphReads', 'graphWrites', 'hiddenDocumentWrites', 'externalSemanticRequests', 'blockedExternalRequests']) equal(value[key], 0, `Zero ${key}`)
  const forbidden = observed.events.filter(event => event.kind === 'forbidden-full-scan' || (event.kind === 'worker-search' && event.remotePresent))
  equal(forbidden.length, 0, 'No full scan or remote semantic option')
  return value
}
async function terminal(allowed = ['failed', 'stale', 'cancelled', 'expired', 'needs_author_input']) {
  await expect.poll(() => panel(active.page).getAttribute('data-phase')).toMatch(new RegExp(`^(?:${allowed.join('|')})$`))
  await absent(['evidence', 'draft', 'apply']); await visible(['status', 'audit'])
}
async function close(entry = 'footer') {
  const page = active.page
  if (entry === 'stop') await nodes(page, 'stop').click()
  else if (entry === 'footer') await nodes(page, 'close').click()
  else if (entry === 'x') await dialogs(page).locator('.el-dialog__headerbtn').click()
  else if (entry === 'escape') await page.keyboard.press('Escape')
  else if (entry === 'overlay') await page.locator('.el-overlay-dialog').filter({ has: dialogs(page) }).click({ position: { x: 2, y: 2 } })
  else throw new Error(`Unknown close entry ${entry}`)
  if (entry === 'stop') await terminal(['cancelled'])
  else await expect(panel(page)).toHaveCount(0)
}
async function sameDocumentZeroWindow(action, { releaseLabel, releaseModel = false, reopen = true } = {}) {
  const before = await currentProbe(), calls = scenarioRequests().length, timeOrigin = await active.page.evaluate(() => performance.timeOrigin)
  // This snapshot is intentionally BEFORE close/revoke, not after reopening.
  await action()
  if (releaseLabel) await release(releaseLabel)
  if (releaseModel) releaseHttp()
  if (reopen) { if (await panel(active.page).count()) await nodes(active.page, 'close').click(); await openAgent() }
  await active.page.waitForTimeout(120)
  const after = await currentProbe()
  equal(await active.page.evaluate(() => performance.timeOrigin), timeOrigin, 'Close/reopen preserves actual performance.timeOrigin')
  equal(scenarioRequests().length, calls, 'Zero new HTTP from pre-close through same-document reopen')
  for (const key of ['sourceReads', 'workerSync', 'workerSearch', 'metadataAttempts', 'metadataCommits', 'editorAppends']) equal(after[key], before[key], `Zero new ${key} after revocation`)
}
async function screenshot(name) {
  await nodes(active.page, 'draft').scrollIntoViewIfNeeded()
  await active.page.screenshot({ path: path.join(artifacts, name), fullPage: false })
  report.screenshots.push({ filename: name, scenario: scenario.key, phase: await panel(active.page).getAttribute('data-phase') })
}
async function committed(page = active.page) {
  return page.evaluate(async () => {
    const novels = JSON.parse(localStorage.getItem('novels') || '[]')
    const db = await new Promise((resolve, reject) => { const req = indexedDB.open('llm-writer', 1); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
    for (const novel of novels) for (const chapter of novel.chapterList ?? []) if (chapter.contentRef) chapter.content = await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly'); tx.__writerAgentOracle = true; const req = tx.objectStore('kv').get(chapter.contentRef); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error)
    })
    for (const novel of novels) for (const chapter of novel.chapterList ?? []) delete chapter.contentRef
    db.close(); return novels
  })
}
async function otherPage({ otherNovel = false } = {}) {
  const page = await active.context.newPage()
  const novel = otherNovel ? fixture.novelB : fixture.novelA, chapter = otherNovel ? novel.chapters[0] : novel.chapters[1]
  await openWriter(page, { novelId: Number(novel.id), chapterId: chapter.id, title: chapter.title })
  await restageCommittedBaseline(page)
  await page.evaluate(draft => { globalThis.__writerAgentProbe.reset(draft); globalThis.__writerAgentProbe.actor = 'other-author' }, active.draft)
  return { page, novel, chapter }
}
async function ordinaryEdit(actor, text) {
  await editor(actor.page).fill(text)
  await expect.poll(async () => {
    const novels = await committed(actor.page), chapter = novels.find(novel => novel.id === Number(actor.novel.id))?.chapterList.find(chapter => chapter.id === Number(actor.chapter.id))
    return chapter?.content ?? ''
  }, { timeout: 20_000 }).toContain(text)
  await expect(actor.page.locator('.saving-indicator')).toHaveCount(0)
}
async function forceDomEvent(id, value, event = 'input', releaseLabel = null) {
  // An explicitly labeled adversarial DOM event, not a claim that disabled UI
  // controls are author-clickable, and never a call into Vue/controller internals.
  await nodes(active.page, id).evaluate((element, { value, event, releaseLabel }) => {
    if (releaseLabel && globalThis.__writerAgentProbe.release(releaseLabel) !== 1) throw new Error('Expected one actual held callback before same-turn cancellation')
    if (element.type === 'checkbox') element.checked = value; else element.value = value
    element.dispatchEvent(new Event(event, { bubbles: true }))
  }, { value, event, releaseLabel })
  scenario.assertions.push(`Adversarial DOM event routed through actual template handler: ${id}`)
}

// B01–B06: exact branches, consent, two requests, original candidate selection,
// strict plans, source canaries and single-normalization behavior.
register('B01', 'B01.a', 'open_preview_granted_zero_write', async () => {
  await previewAgent(); await nodes(active.page, 'grant').check()
  await active.page.waitForTimeout(120)
  await counters({ http: 0, tools: 0, sync: 0, search: 0 })
  equal((await currentProbe()).metadataAttempts, 0, 'Granted preview does not save the editor')
  await sameDocumentZeroWindow(() => close('footer'))
})
for (const variant of ['dirty', 'isSaving', 'saveError']) register('B01', 'B01.b', variant, async () => {
  if (variant === 'isSaving') await arm({ kind: 'source-complete', phase: 'closed', label: 'ordinary-save' })
  if (variant === 'saveError') await active.page.evaluate(() => { globalThis.__writerAgentProbe.failMetadata = 1 })
  await editor(active.page).fill(`${active.profile.target.text}作者新写的字。`)
  if (variant === 'isSaving') await waitHold('ordinary-save')
  if (variant === 'saveError') await expect(active.page.getByRole('button', { name: '保存失败，点击重试', exact: true })).toBeVisible()
  const before = await currentProbe()
  await openAgent(); await nodes(active.page, 'brief').fill(active.brief); await nodes(active.page, 'cutoff').selectOption(active.profile.targetId)
  await expect(nodes(active.page, 'preview-action')).toBeDisabled(); await absent(['tail', 'start', 'evidence', 'draft', 'apply'])
  equal(scenarioRequests().length, 0, 'Unclean baseline cannot dispatch a model')
  const after = await currentProbe()
  equal(after.metadataAttempts, before.metadataAttempts, 'Opening blocked Agent did not attempt to save')
  const audit = await copyAudit()
  scenario.counterWindow = 'Actual native operation deltas immediately before and after opening the blocked Agent; earlier ordinary author save is reported separately.'
  scenario.counters = { providerHttpDispatches: scenarioRequests().length, modelReservations: audit.budget.modelReservations,
    toolReservations: audit.budget.toolReservations, toolExecutorEntries: audit.events.filter(event => event.kind === 'tool_started').length,
    memoryPrepareStarts: null, memoryWorkerSync: after.workerSync - before.workerSync, memoryWorkerSearch: after.workerSearch - before.workerSearch,
    editorAppendOperations: after.editorAppends - before.editorAppends, novelSaveAttempts: null, savingIndicatorTransitions: after.savingIndicatorTransitions - before.savingIndicatorTransitions,
    persistenceMetadataAttempts: after.metadataAttempts - before.metadataAttempts, persistenceCommitGates: after.commitGates - before.commitGates,
    novelDurableCommits: after.metadataCommits - before.metadataCommits, graphWrites: after.graphWrites - before.graphWrites,
    hiddenDocumentWrites: after.hiddenWrites - before.hiddenWrites,
    externalSemanticRequests: boundaryRequests.filter(request => request.scenario === scenario.key && ['embeddings', 'rerank'].includes(request.kind)).length }
  equal(scenario.counters.savingIndicatorTransitions, 0, 'Blocked Agent adds no saving-indicator rising edge (UI proxy, not exact save entries)')
  scenario.otherActor = { authorSavingIndicatorTransitions: before.savingIndicatorTransitions, authorCommits: before.metadataCommits }
  if (variant === 'isSaving') await release('ordinary-save')
})
register('B02', 'B02.a', 'earlier_cutoff', async () => {
  await openAgent(); await nodes(active.page, 'brief').fill(active.brief); await nodes(active.page, 'cutoff').selectOption(fixture.novelA.chapters[1].id)
  const before = await currentProbe()
  await expect(nodes(active.page, 'preview-action')).toBeDisabled(); await absent(['tail', 'start', 'evidence', 'draft', 'apply'])
  equal((await currentProbe()).sourceReads, before.sourceReads, 'Earlier cutoff is rejected before any target-tail committed read')
  await counters({ http: 0, tools: 0, sync: 0, search: 0 })
})
register('B02', 'B02.b', 'explicit_target_cutoff', async () => {
  await openAgent(); await nodes(active.page, 'brief').fill(active.brief); await nodes(active.page, 'cutoff').selectOption(fixture.novelA.chapters[1].id)
  await expect(nodes(active.page, 'preview-action')).toBeDisabled()
  await nodes(active.page, 'cutoff').selectOption(active.profile.targetId); await nodes(active.page, 'preview-action').click()
  await assertPhaseNodes('previewed'); equal(await nodes(active.page, 'tail').textContent(), active.profile.target.text, 'Author explicitly chose actual target tail')
  await counters({ http: 0, tools: 0, sync: 0, search: 0 })
  await startAgent(); await draftReady(); await counters({ http: 2, tools: 1, sync: 1, search: 1 })
})
register('B03', 'B03.a', 'two_requests_one_real_retrieval', async () => {
  await previewAgent(); await startAgent(); await counters({ http: 1, tools: 1, sync: 1, search: 1 })
  await draftReady(); await screenshot('desktop-reviewed-draft.png'); const value = await counters({ http: 2, tools: 1, sync: 1, search: 1 })
  equal(value.modelReservations, 2, 'Two and only two model reservations')
  equal(scenario.audit.budget.outputTokensReserved, 2400, 'Total output allowance is 2,400, not a cost claim')
  equal(scenario.audit.usage.map(usage => [usage.phase, usage.totalTokens, usage.usageSource]), [['plan', 110, 'reported'], ['draft', 180, 'reported']], 'Usage is correlated separately to plan and draft')
})
register('B04', 'B04.a', 'all_candidates_unselected', async () => {
  await previewAgent(); await startAgent()
  check(await active.page.locator(`[data-testid^="writer-agent-hit-"][data-chapter-id="${fixture.anchorSelection.leaveUnchecked.chapterId}"]`).count() > 0, 'Unselected canary is a real retrieved candidate')
  await nodes(active.page, 'approve').evaluate(button => button.click())
  await active.page.waitForTimeout(80); await phase('awaiting_evidence')
  await counters({ http: 1, tools: 1, sync: 1, search: 1 })
  await draftReady(); await counters({ http: 2, tools: 1, sync: 1, search: 1 })
})
register('B04', 'B04.b', 'selection_clear', async () => {
  await previewAgent(); await startAgent(); await selectAnchor()
  await active.page.locator('[data-testid^="writer-agent-select-hit-"]:checked').uncheck()
  await expect(nodes(active.page, 'approve')).toBeDisabled(); await nodes(active.page, 'approve').evaluate(button => button.click())
  await counters({ http: 1, tools: 1, sync: 1, search: 1 })
})
for (const invalid of fixture.invalidPlans) register('B05', 'B05.a', invalid.name, async () => {
  active.plan = invalid.text; await previewAgent(); await nodes(active.page, 'grant').check(); await nodes(active.page, 'start').click()
  await terminal(['failed']); await counters({ http: 1, tools: 0, sync: 0, search: 0 })
  equal(scenario.audit.errorCode, 'protocol', 'Strict invalid plan has protocol failure without automatic repair')
})
register('B05', 'B05.b', 'empty_real_retrieval', async () => {
  active.plan = JSON.stringify({ version: 1, tool: 'writer_retrieve_disclosed_context', input: { query: 'UNRECORDED-WRITER-AGENT-Z947' } })
  await previewAgent(); await nodes(active.page, 'grant').check(); await nodes(active.page, 'start').click(); await terminal(['needs_author_input'])
  await counters({ http: 1, tools: 1, sync: 1, search: 1 }); equal(scenario.audit.errorCode, 'no_candidates', 'No-candidate result cannot silently draft or replan')
})
register('B05', 'B05.c', 'needs_author_input', async () => {
  active.plan = fixture.needsInputPlanText; await previewAgent(); await nodes(active.page, 'grant').check(); await nodes(active.page, 'start').click()
  await terminal(['needs_author_input']); await counters({ http: 1, tools: 0, sync: 0, search: 0 })
})
register('B06', 'B06.a', 'future_material_outline_other_novel_unselected', async () => {
  await happyToDraft(); await counters({ http: 2, tools: 1, sync: 1, search: 1 })
  scenario.assertions.push('Both actual HTTP payloads rejected all future/material/outline/alias/other-novel canaries')
  const billing = await active.page.evaluate(() => localStorage.getItem('billing_records') || '')
  check(!billing.includes(active.brief) && !billing.includes(active.expectedTail) && !billing.includes(active.draft), 'Existing billing metadata omits prompt/response content')
})
for (const profile of ['literal', 'legacy-entity', 'source-instruction']) register('B06', 'B06.b', profile, async () => {
  active.plan = JSON.stringify({ version: 1, tool: 'writer_retrieve_disclosed_context', input: { query: '铜铃 木门' } })
  await happyToDraft(); await counters({ http: 2, tools: 1, sync: 1, search: 1 })
  const sent = evidencePayload(scenarioRequests()[1].payload.selectedEvidence).sources[0]
  equal(sent.quote, active.selected[0].quote, 'Selected literal/source-instruction quote survives actual wire exactly once')
}, { profile })

// B07: all real Element Plus close routes share synchronous revocation; no
// page.goto is used to fake a fresh document in the close/reopen window.
for (const variant of ['stop', 'x', 'footer', 'escape', 'overlay']) register('B07', 'B07.a', variant, async () => {
  active.planMode = 'hold'; await previewAgent(); await startAgent({ held: true })
  await expect.poll(() => scenarioRequests().length).toBe(1)
  await counters({ http: 1, tools: 0, sync: 0, search: 0 })
  if (variant === 'stop') {
    await sameDocumentZeroWindow(async () => {
      await active.page.evaluate(() => { globalThis.__writerAgentProbe.afterEof = { ordinal: 1, stop: true } })
      releaseHttp('plan')
      await terminal(['cancelled'])
    })
    equal((await currentProbe()).eof, 1, 'Actual Stop handler cancels after the real HTTP reader EOF, before its await continuation')
  } else await sameDocumentZeroWindow(() => close(variant), { releaseModel: true })
})
for (const boundary of ['tool-pre-guard', 'preparation-read', 'worker-sync', 'worker-search']) {
  for (const race of ['pending_then_cancel', 'resolved_then_cancel_before_await_continuation']) {
    const id = boundary === 'tool-pre-guard' ? 'B08.a' : 'B08.b'
    register('B08', id, `${boundary}:${race}`, async () => {
      await previewAgent()
      const workerType = boundary === 'worker-sync' ? 'sync' : 'search'
      await arm(boundary.startsWith('worker')
        ? { kind: 'worker-response', workerType, label: 'retrieval' }
        : { kind: 'source-complete', phase: 'executing_retrieval_tool', skip: boundary === 'preparation-read' ? 1 : 0, label: 'retrieval' })
      await nodes(active.page, 'grant').check(); await nodes(active.page, 'start').click(); await waitHold('retrieval')
      await assertPhaseNodes('executing_retrieval_tool')
      await counters({ http: 1, tools: 1, sync: boundary.startsWith('worker') ? 1 : 0, search: boundary === 'worker-search' ? 1 : 0 })
      if (race === 'pending_then_cancel') await sameDocumentZeroWindow(() => close('footer'), { releaseLabel: 'retrieval' })
      else await sameDocumentZeroWindow(() => active.page.evaluate(() => {
        // Resolve original browser callback and close in the SAME JS turn.
        globalThis.__writerAgentProbe.release('retrieval')
        document.querySelector('[data-testid="writer-agent-close"]').click()
      }))
    })
  }
}
for (const variant of ['close_reopen', 'selection_epoch']) register('B09', 'B09.a', variant, async () => {
  await previewAgent(); await startAgent(); await selectAnchor()
  await arm({ kind: 'source-complete', phase: 'selecting_evidence', label: 'approval' })
  await nodes(active.page, 'approve').click(); await waitHold('approval'); await assertPhaseNodes('selecting_evidence')
  await counters({ http: 1, tools: 1, sync: 1, search: 1 })
  if (variant === 'close_reopen') await sameDocumentZeroWindow(() => close('footer'), { releaseLabel: 'approval' })
  else {
    await expect(active.page.locator('[data-testid^="writer-agent-select-hit-"]:checked')).toBeDisabled()
    const id = await active.page.locator('[data-testid^="writer-agent-select-hit-"]:checked').getAttribute('data-testid')
    const before = await currentProbe()
    await forceDomEvent(id.slice('writer-agent-'.length), false, 'change', 'approval'); await terminal(['stale', 'cancelled'])
    scenario.assertions.push('Real approval source callback resolved then selection epoch revoked in the same JavaScript turn, before await continuation')
    await active.page.waitForTimeout(100)
    equal(scenarioRequests().length, 1, 'Selection epoch change cannot dispatch draft after held approval')
    equal((await currentProbe()).workerSearch, before.workerSearch, 'Selection change does not rerun search')
  }
})

async function externalSourceChange(actor, variant) {
  if (variant === 'saved_edit') return ordinaryEdit(actor, `${actor.chapter.text}另一页已经修订原文。`)
  if (variant === 'raw_format_only') {
    // The modal deliberately prevents author access to the first page editor.
    // Exercise real ordinary formatting/save in the second page, and explicitly
    // pair same-page raw-ref ownership with Node rather than inventing access.
    await editor(actor.page).click(); await editor(actor.page).press('ControlOrMeta+A'); await editor(actor.page).press('ControlOrMeta+B')
    await expect.poll(async () => {
      const data = await committed(actor.page)
      return data.find(novel => novel.id === Number(actor.novel.id)).chapterList.find(chapter => chapter.id === Number(actor.chapter.id)).content
    }).toMatch(/<(?:strong|b)(?:\s|>)/)
    scenario.pairedNodeBoundary = 'Same-page raw editor HTML mutation while modal owns focus is covered by real-ref UI Node tests; browser observes real second-page formatting/save and storage revocation.'
    return
  }
  // No Writer chapter-reorder UI exists. This is a clearly labeled external
  // author persistence mutation, not a fabricated Agent source/tool response.
  await actor.page.evaluate(({ novelId, variant }) => {
    const novels = JSON.parse(localStorage.getItem('novels'))
    const novel = novels.find(item => item.id === novelId)
    if (variant === 'reorder') [novel.chapterList[0], novel.chapterList[1]] = [novel.chapterList[1], novel.chapterList[0]]
    else if (variant === 'delete') novel.chapterList.splice(1, 1)
    else throw new Error('Unknown source mutation')
    localStorage.setItem('novels', JSON.stringify(novels))
  }, { novelId: Number(actor.novel.id), variant })
  scenario.otherActorMutation = `Second-page native committed metadata ${variant}; not a Writer GUI reorder claim`
}
for (const stage of ['before_plan', 'before_draft', 'before_review', 'before_apply']) {
  for (const variant of ['saved_edit', 'reorder', 'delete', 'raw_format_only']) register('B10', `B10.${stage}`, variant, async () => {
    const actor = await otherPage(); await previewAgent()
    if (stage === 'before_plan') {
      await arm({ kind: 'source-complete', phase: 'planning', label: 'freshness' })
      await nodes(active.page, 'grant').check(); await nodes(active.page, 'start').click()
    } else {
      await startAgent(); await selectAnchor()
      if (stage === 'before_draft') await arm({ kind: 'source-complete', phase: 'drafting', label: 'freshness' })
      if (stage === 'before_review') await active.page.evaluate(() => {
        globalThis.__writerAgentProbe.afterEof = { ordinal: 2, arm: { kind: 'source-complete', phase: 'drafting', label: 'freshness' } }
      })
      await nodes(active.page, 'approve').click()
      if (stage === 'before_apply') {
        await phase('awaiting_author'); await arm({ kind: 'source-complete', phase: 'applying', label: 'freshness' }); await nodes(active.page, 'apply').click()
      }
    }
    await waitHold('freshness')
    if (stage === 'before_review') equal((await currentProbe()).eof, 2, 'Postresponse race is after actual second HTTP reader EOF')
    const before = await currentProbe(), calls = scenarioRequests().length
    await externalSourceChange(actor, variant); await release('freshness')
    await terminal(['stale', 'cancelled', 'failed'])
    equal(scenarioRequests().length, calls, 'Source change prevents any next model request')
    equal((await currentProbe()).editorAppends, 0, 'Source/raw-format change prevents first editor append')
    equal((await currentProbe()).metadataCommits, before.metadataCommits, 'First page did not save after source revocation')
    scenario.otherActor = { ...await currentProbe(actor.page), events: undefined }
    await counters({ http: stage === 'before_plan' ? 0 : stage === 'before_draft' ? 1 : 2, tools: stage === 'before_plan' ? 0 : 1,
      sync: stage === 'before_plan' ? 0 : 1, search: stage === 'before_plan' ? 0 : 1 })
    check(['stale', 'cancelled'].includes(scenario.audit.errorCode), 'Source mutation, not an unrelated timeout, revoked the run')
  })
}
register('B11', 'B11.a', 'legacy_persistent_extensions', async () => {
  const settings = await active.page.evaluate(() => JSON.parse(localStorage.getItem('extensions')))
  equal(settings.enabled, true, 'Real legacy Assistant extension setting survives app load')
  equal(settings.writingToolIds, ['writing_search', 'writing_read_chapter'], 'Real legacy tool allowlist is enabled only for Assistant')
  await previewAgent(); await counters({ http: 0, tools: 0, sync: 0, search: 0 })
  await expect(nodes(active.page, 'grant')).not.toBeChecked(); await expect(nodes(active.page, 'start')).toBeDisabled()
  await active.page.reload(); await dismiss(active.page)
  await active.page.locator('.chapter-item').filter({ has: active.page.locator('.chapter-info > p', { hasText: active.profile.target.title }) }).first().click()
  await openAgent(); await absent(['evidence', 'draft', 'apply'])
}, { legacy: true })
for (const variant of ['brief', 'cutoff', 'provider_model', 'headers_identity', 'grant_false']) register('B11', 'B11.b', variant, async () => {
  let actor
  if (variant === 'provider_model' || variant === 'headers_identity') actor = await otherPage()
  await previewAgent()
  if (variant === 'grant_false') {
    await nodes(active.page, 'grant').check(); await nodes(active.page, 'grant').uncheck(); await expect(nodes(active.page, 'start')).toBeDisabled()
    await nodes(active.page, 'start').evaluate(button => button.click())
    await counters({ http: 0, tools: 0, sync: 0, search: 0 })
    scenario.pairedNodeBoundary = 'Grant checkbox is unmounted after Start. Active granted-ref revocation is covered by UI Node real-ref tests, not claimed as a clickable browser control.'
    return
  }
  await startAgent(); const before = scenarioRequests().length
  if (variant === 'brief' || variant === 'cutoff') {
    await expect(nodes(active.page, variant)).toBeDisabled()
    await forceDomEvent(variant, variant === 'brief' ? '已经更改的方向' : fixture.novelA.chapters[1].id, variant === 'brief' ? 'input' : 'change')
  } else {
    await actor.page.evaluate(variant => {
      const config = JSON.parse(localStorage.getItem('apiConfig'))
      if (variant === 'provider_model') config.selectedModel = 'another-synthetic-model'
      else config.customHeaders = { 'X-Synthetic-Identity': 'changed' }
      localStorage.setItem('apiConfig', JSON.stringify(config))
    }, variant)
    scenario.pairedNodeBoundary = 'Browser proves real cross-tab settings/storage revocation; same-document deep activeConfig/header identity is covered by UI Node real-ref tests.'
  }
  await terminal(['stale', 'cancelled']); equal(scenarioRequests().length, before, 'Changed input/settings cannot automatically obtain a new grant')
  await counters({ http: 1, tools: 1, sync: 1, search: 1 })
})
for (const variant of ['decoded_bytes', 'draft2001', 'empty', 'length', 'timeout']) register('B12', 'B12.a', variant, async () => {
  active.draftMode = variant; await previewAgent(); await startAgent(); await selectAnchor(); await nodes(active.page, 'approve').click()
  if (variant === 'timeout') {
    await expect.poll(() => scenarioRequests().length).toBe(2); await assertPhaseNodes('drafting')
    await advanceClock(31_000)
  }
  await terminal(['failed']); await counters({ http: 2, tools: 1, sync: 1, search: 1 })
  check(['limits', 'output_incomplete', 'model_deadline', 'transport'].includes(scenario.audit.errorCode), 'Failure has a sanitized bounded error code')
  equal(scenario.audit.usage[0].totalTokens, 110, 'Completed planning usage survives later draft failure')
}, { clock: true })
register('B12', 'B12.b', 'absolute_review_expiry', async () => {
  await happyToDraft(); await advanceClock(1_200_001)
  await terminal(['expired']); await counters({ http: 2, tools: 1, sync: 1, search: 1 }); equal(scenario.audit.errorCode, 'expired', 'Author review does not reset absolute expiry')
}, { clock: true })
register('B13', 'B13.a', 'real_reader_eof_postguard_copy_discard', async () => {
  await previewAgent(); await startAgent(); await selectAnchor()
  await active.page.evaluate(() => { globalThis.__writerAgentProbe.afterEof = { ordinal: 2, arm: { kind: 'source-complete', phase: 'drafting', label: 'post-response' } } })
  await nodes(active.page, 'approve').click(); await waitHold('post-response'); await assertPhaseNodes('drafting')
  equal((await currentProbe()).eof, 2, 'Both real HTTP bodies have been consumed before final source guard')
  await release('post-response'); await assertPhaseNodes('awaiting_author')
  equal(await copyThroughUi('copy'), active.draft, 'Explicit Copy writes exact complete draft to actual clipboard')
  await nodes(active.page, 'discard').click(); await terminal(['cancelled']); await counters({ http: 2, tools: 1, sync: 1, search: 1 })
  await sameDocumentZeroWindow(() => close('footer'))
})
register('B14', 'B14.a', 'double_apply_escape_reload', async () => {
  await happyToDraft(); const originalOther = (await committed()).find(novel => novel.id === Number(fixture.novelB.id))
  await nodes(active.page, 'apply').evaluate(button => { button.click(); button.click() })
  await assertPhaseNodes('applied'); await active.page.waitForTimeout(2200)
  await counters({ http: 2, tools: 1, sync: 1, search: 1, append: 1, savingTransitions: 1, commits: 1 })
  const saved = await committed(), target = saved.find(novel => novel.id === active.profile.novelId).chapterList.find(chapter => chapter.id === Number(active.profile.targetId))
  check(target.content.includes('&lt;木门&gt;') && target.content.includes('&amp;'), 'Dangerous-looking draft prose is escaped in durable HTML')
  equal(saved.find(novel => novel.id === Number(fixture.novelB.id)), originalOther, 'Other novel remains byte-equivalent after ordinary save')
  const timeOrigin = await active.page.evaluate(() => performance.timeOrigin)
  await active.page.reload(); await dismiss(active.page)
  check(await active.page.evaluate(() => performance.timeOrigin) !== timeOrigin, 'Durability test actually loaded a new document')
  await active.page.locator('.chapter-item').filter({ has: active.page.locator('.chapter-info > p', { hasText: active.profile.target.title }) }).first().click()
  await expect(editor(active.page)).toContainText(active.draft)
  equal((await editor(active.page).textContent()).split(active.draft).length - 1, 1, 'Reload preserves exactly one appended draft')
  equal(await editor(active.page).locator('木门, script').count(), 0, 'Escaped prose never becomes executable editor markup')
  await absent(['panel', 'draft', 'apply']); await openAgent(); await absent(['grant', 'evidence', 'draft', 'apply'])
}, { draft: fixture.escapedDraftText })

async function attemptGenericRetries() {
  // The real header/global buttons only mount on a known failure. Their absence
  // while pending is asserted rather than pretending there is a hidden button.
  const header = active.page.getByRole('button', { name: '保存失败，点击重试', exact: true })
  const global = active.page.locator('.persistence-error').getByRole('button', { name: '重试保存', exact: true })
  for (const button of [header, global]) if (await button.count()) await button.evaluate(element => element.click())
}
async function appendWithHeldSave(boundary) {
  await arm({ kind: boundary === 'hold_ack_after_durable_commit' ? 'commit-ack' : 'source-complete', phase: 'commit_pending', label: 'save' })
  await nodes(active.page, 'apply').click(); await waitHold('save'); await assertPhaseNodes('commit_pending')
  await expect(editor(active.page)).toContainText(active.draft)
}
register('B15', 'B15.a', 'known_failure_save_only_retry', async () => {
  await happyToDraft(); await active.page.evaluate(() => { globalThis.__writerAgentProbe.failMetadata = 1 })
  await nodes(active.page, 'apply').click(); await assertPhaseNodes('applied_unsaved')
  await counters({ http: 2, tools: 1, sync: 1, search: 1, append: 1, savingTransitions: 1, commits: 0 })
  await attemptGenericRetries(); await active.page.waitForTimeout(2200)
  equal((await currentProbe()).metadataAttempts, 1, 'Header/global retry and autosave do not retry Agent recovery')
  const before = await currentProbe()
  equal(scenario.audit.application.initialCommit, 'not_committed', 'Known failure is distinguished from unknown commit knowledge')
  await nodes(active.page, 'retry-save').click(); await assertPhaseNodes('applied')
  await counters({ http: 2, tools: 1, sync: 1, search: 1, append: 1, savingTransitions: 2, commits: 1 })
  equal((await currentProbe()).workerSync, before.workerSync, 'Known-failure retry does not reprepare old evidence')
})
for (const variant of ['hold_before_durable_commit', 'hold_ack_after_durable_commit']) register('B15', 'B15.b', variant, async () => {
  await happyToDraft(); await appendWithHeldSave(variant)
  const expectedCommitted = variant === 'hold_ack_after_durable_commit' ? 1 : 0
  equal((await currentProbe()).metadataCommits, expectedCommitted, 'Independent oracle distinguishes before-commit from held-ACK boundary')
  await advanceClock(180_001)
  const waitingPhase = expectedCommitted ? 'commit_pending' : 'commit_unknown'
  await assertPhaseNodes(waitingPhase)
  await attemptGenericRetries(); await nodes(active.page, 'open').evaluate(button => button.click())
  await phase(waitingPhase); await absent(['apply', 'retry-save'])
  const observed = await counters({ http: 2, tools: 1, sync: 1, search: 1, append: 1, savingTransitions: 1, commits: expectedCommitted })
  equal(scenario.audit.application.initialCommit, expectedCommitted ? 'committed' : 'unknown', 'Controller commit knowledge comes from real request-local receipt, not independent oracle')
  scenario.intermediate = { controller: waitingPhase, initialCommitKnowledge: expectedCommitted ? 'committed' : 'unknown', independentDurableCommits: expectedCommitted, metadataAttempts: observed.persistenceMetadataAttempts,
    waitedMs: 180001, meaning: 'Local ACK indication only; no cancellation, retry, rollback or commitment deadline.' }
  await release('save'); await assertPhaseNodes('applied')
  await advanceClock(2201)
  await counters({ http: 2, tools: 1, sync: 1, search: 1, append: 1, savingTransitions: 1, commits: 1 })
}, { clock: true })
register('B15', 'B15.extra', 'initial_commit_then_author_catchup_failure', async () => {
  await happyToDraft(); await appendWithHeldSave('hold_ack_after_durable_commit')
  const edited = `${active.profile.target.text}\n${active.draft}\n作者在等待期间新写的句子。`
  await active.page.evaluate(() => { globalThis.__writerAgentProbe.actor = 'author-edit' })
  await editor(active.page).fill(edited)
  await active.page.evaluate(async () => { await Promise.resolve(); globalThis.__writerAgentProbe.actor = 'agent'; globalThis.__writerAgentProbe.failMetadata = 1 })
  await release('save'); await assertPhaseNodes('applied_unsaved')
  await expect(nodes(active.page, 'save-failure')).toContainText('追加已保存')
  const saved = await committed(), chapter = saved.find(novel => novel.id === active.profile.novelId).chapterList.find(chapter => chapter.id === Number(active.profile.targetId))
  check(chapter.content.includes(active.draft) && !chapter.content.includes('作者在等待期间新写的句子'), 'Initial durable append remains saved while newer author text stays unsaved')
  await expect(editor(active.page)).toContainText('作者在等待期间新写的句子')
  await counters({ http: 2, tools: 1, sync: 1, search: 1, append: 1, savingTransitions: 1, commits: 1 })
  equal((await currentProbe()).metadataAttempts, 2, 'Same save handle drains actual new author edit once, then exposes known catch-up failure')
  scenario.authorEditMethod = 'Playwright contenteditable fill enters real editor change handler while dialog overlays editor; not a claim of pointer access through the modal.'
})
for (const otherNovel of [false, true]) register('B16', otherNovel ? 'B16.b' : 'B16.a', otherNovel ? 'unrelated_project_merge' : 'same_project_CAS', async () => {
  const actor = await otherPage({ otherNovel }); await happyToDraft()
  await appendWithHeldSave('hold_before_durable_commit')
  const actorText = `${actor.chapter.text}第二个真正的Writer页面先保存。`
  await ordinaryEdit(actor, actorText)
  const otherCounters = await currentProbe(actor.page)
  equal(otherCounters.metadataCommits, 1, 'Other actor committed through genuine Writer ordinary persistence')
  await release('save')
  await assertPhaseNodes(otherNovel ? 'applied' : 'applied_unsaved')
  const saved = await committed(), actorChapter = saved.find(novel => novel.id === Number(actor.novel.id)).chapterList.find(chapter => chapter.id === Number(actor.chapter.id))
  check(actorChapter.content.includes(actorText), 'Second-page durable text is not overwritten')
  await counters({ http: 2, tools: 1, sync: 1, search: 1, append: 1, savingTransitions: 1, commits: otherNovel ? 1 : 0 })
  scenario.otherActor = { durableCommits: otherCounters.metadataCommits, savingIndicatorTransitions: otherCounters.savingIndicatorTransitions }
  if (!otherNovel) {
    const before = await currentProbe(); await attemptGenericRetries(); await active.page.waitForTimeout(2200)
    equal((await currentProbe()).metadataCommits, before.metadataCommits, 'Conflict is not permission to refresh CAS baseline or overwrite')
  }
})
register('B17', 'B17.a', 'real_generation_arbiter_claim', async () => {
  await happyToDraft(); await counters({ http: 2, tools: 1, sync: 1, search: 1 })
  // Real ordinary chapter generation launcher reaches the shared arbiter. The
  // fixed target is shorter than old Continue's 50-character precondition.
  await active.page.getByRole('button', { name: '根据大纲生成', exact: true }).evaluate(button => button.click())
  await expect(panel(active.page)).toHaveCount(0)
  await expect(active.page.getByRole('dialog', { name: 'AI生成章节内容', exact: true })).toBeVisible()
  equal(scenarioRequests().length, 2, 'Ordinary generation claim revokes Agent without a third Agent request')
  equal((await currentProbe()).metadataCommits, 0, 'Arbiter claim does not append or save Agent draft')
  scenario.ordinaryProviderHttpDispatches = requests.filter(request => request.scenario === scenario.key && request.kind === 'ordinary').length
})
for (const variant of ['x', 'back', 'forward', 'chapter_switch']) register('B17', 'B17.b', variant, async () => {
  if (variant === 'back' || variant === 'forward') {
    // Construct genuine same-document router history before the run. hash goto
    // is not called a fresh document; the timeOrigin is explicitly preserved.
    const timeOrigin = await active.page.evaluate(() => performance.timeOrigin)
    await active.page.goto(`${origin}/#/novels`)
    await openWriter(active.page)
    if (variant === 'forward') {
      await active.page.goto(`${origin}/#/novels`); await active.page.goBack()
      await active.page.locator('.chapter-item').filter({ has: active.page.locator('.chapter-info > p', { hasText: active.profile.target.title }) }).first().click()
    }
    equal(await active.page.evaluate(() => performance.timeOrigin), timeOrigin, 'Navigation setup remains the same real document')
    await restageCommittedBaseline(active.page)
    await active.page.evaluate(draft => globalThis.__writerAgentProbe.reset(draft), active.draft)
  }
  await happyToDraft(); await appendWithHeldSave('hold_before_durable_commit')
  const savedAudit = await copyAudit(), timeOrigin = await active.page.evaluate(() => performance.timeOrigin)
  if (variant === 'x') await dialogs(active.page).locator('.el-dialog__headerbtn').click()
  else if (variant === 'chapter_switch') await active.page.locator('.chapter-item').filter({ has: active.page.locator('.chapter-info > p', { hasText: fixture.novelA.chapters[0].title }) }).first().evaluate(item => item.click())
  else await active.page.evaluate(variant => { if (variant === 'back') history.back(); else history.forward() }, variant)
  await active.page.waitForTimeout(150)
  await phase('commit_pending'); await expect(editor(active.page)).toContainText(active.draft)
  equal((await currentProbe()).metadataCommits, 0, 'Close/navigation cannot finalize or restart pending save')
  await release('save')
  await expect.poll(async () => (await currentProbe()).metadataCommits).toBe(1)
  await expect(active.page.locator('.saving-indicator')).toHaveCount(0)
  equal(await active.page.evaluate(() => performance.timeOrigin), timeOrigin, 'Blocked then resumed navigation did not replace the document')
  const after = await currentProbe()
  equal(after.editorAppends, 1, 'Navigation retains exactly one original append')
  equal(after.savingIndicatorTransitions, 1, 'Navigation exposes one saving-indicator rising edge (UI proxy, not exact save entries)')
  equal(after.metadataAttempts, 1, 'Navigation makes exactly one native metadata write attempt')
  equal(scenarioRequests().length, 2, 'Navigation does not resurrect an Agent request')
  scenario.audit = savedAudit; scenario.counters = { providerHttpDispatches: scenarioRequests().length,
    modelReservations: savedAudit.budget.modelReservations, toolReservations: savedAudit.budget.toolReservations,
    toolExecutorEntries: savedAudit.events.filter(event => event.kind === 'tool_started').length, memoryPrepareStarts: null,
    editorAppendOperations: after.editorAppends, novelSaveAttempts: null, savingIndicatorTransitions: after.savingIndicatorTransitions, novelDurableCommits: after.metadataCommits,
    persistenceMetadataAttempts: after.metadataAttempts, persistenceCommitGates: after.commitGates,
    memoryWorkerSync: after.workerSync, memoryWorkerSearch: after.workerSearch, graphWrites: after.graphWrites, hiddenDocumentWrites: after.hiddenWrites,
    externalSemanticRequests: boundaryRequests.filter(request => request.scenario === scenario.key && ['embeddings', 'rerank'].includes(request.kind)).length }
  if (variant === 'x') await expect(panel(active.page)).toHaveCount(0)
  if (variant === 'back' || variant === 'forward') await expect(active.page).toHaveURL(/#\/novels/)
  if (variant === 'chapter_switch') await expect(editor(active.page)).toHaveText(fixture.novelA.chapters[0].text, { useInnerText: true })
})
register('B17', 'B17.c', 'known_failure_recovery_blocks_new_owners', async () => {
  await happyToDraft(); await active.page.evaluate(() => { globalThis.__writerAgentProbe.failMetadata = 1 })
  await nodes(active.page, 'apply').click(); await assertPhaseNodes('applied_unsaved')
  for (const action of [
    () => nodes(active.page, 'close').click(),
    () => nodes(active.page, 'open').evaluate(button => button.click()),
    () => active.page.getByRole('button', { name: '根据大纲生成', exact: true }).evaluate(button => button.click()),
    () => active.page.locator('.chapter-item').first().evaluate(item => item.click()),
    () => active.page.getByRole('button', { name: '返回列表', exact: true }).evaluate(button => button.click()),
  ]) { await action(); await phase('applied_unsaved') }
  await expect(editor(active.page)).toContainText(active.draft)
  await counters({ http: 2, tools: 1, sync: 1, search: 1, append: 1, savingTransitions: 1, commits: 0 })
  await expect(active.page).toHaveURL(/#\/writer/)
  await absent(['start', 'apply']); await expect(nodes(active.page, 'retry-save')).toBeVisible()
})
for (const kind of ['chapter', 'material']) register('B17', 'B17.extra', `held_${kind}_delete_confirmation`, async () => {
  await happyToDraft()
  if (kind === 'chapter') {
    const row = active.page.locator('.chapter-item').first()
    await row.locator('.el-dropdown').locator('button').first().dispatchEvent('mouseenter')
  } else {
    await active.page.getByRole('tab', { name: '👥 人物', exact: true }).evaluate(tab => tab.click())
    await active.page.locator('.character-item').first().locator('.character-actions button').evaluate(button => button.click())
  }
  const menu = active.page.getByRole('menuitem', { name: '删除', exact: true }).filter({ visible: true })
  await menu.evaluate(item => item.click())
  const confirm = active.page.locator('.el-message-box').filter({ hasText: '删除' })
  await expect(confirm).toBeVisible()
  await arm({ kind: 'source-complete', phase: 'applying', label: 'apply-with-delete-intent' })
  await nodes(active.page, 'apply').evaluate(button => button.click()); await waitHold('apply-with-delete-intent')
  const before = await committed()
  await confirm.getByRole('button', { name: '确定', exact: true }).click()
  await active.page.waitForTimeout(100)
  equal((await committed()).map(novel => [novel.id, novel.chapterList.length, novel.characters.length]), before.map(novel => [novel.id, novel.chapterList.length, novel.characters.length]), 'Delayed delete intent cannot mutate after Agent Apply lease acquisition')
  await release('apply-with-delete-intent'); await assertPhaseNodes('applied')
  await counters({ http: 2, tools: 1, sync: 1, search: 1, append: 1, savingTransitions: 1, commits: 1 })
  scenario.authorInteraction = 'Actual template/menu/confirmation handlers, with programmatic DOM clicks to schedule overlapping modal intents; no Vue state or production hook.'
})
for (const width of [1280, 390]) register('B18', 'B18.a', width === 390 ? 'mobile390' : 'desktop1280', async () => {
  const started = Date.now(); await previewAgent(); scenario.timings = { previewMs: Date.now() - started }
  const retrieval = Date.now(); await startAgent(); scenario.timings.retrievalMs = Date.now() - retrieval
  const draft = Date.now(); await draftReady(); scenario.timings.draftMs = Date.now() - draft
  const bounds = await dialogs(active.page).boundingBox()
  check(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'Actual review dialog fits the tested viewport without horizontal clipping')
  if (width === 390) await screenshot('mobile-reviewed-draft.png')
  await nodes(active.page, 'apply').scrollIntoViewIfNeeded(); await nodes(active.page, 'apply').click(); await assertPhaseNodes('applied')
  await active.page.waitForTimeout(2200)
  await counters({ http: 2, tools: 1, sync: 1, search: 1, append: 1, savingTransitions: 1, commits: 1 })
  equal(active.profile.chapters.length, 600, 'Capacity profile contains 600 full chapters')
  equal(active.profile.totalChars, 1_320_000, 'Capacity profile has exactly 1,320,000 UTF-16 units')
  const worker = (await currentProbe()).events.find(event => event.kind === 'worker-sync')
  equal(worker.chapters, 400, 'Real Worker receives disclosed prefix through target/cutoff 400')
  equal(scenario.selectedSources[0].chapterId, active.profile.anchorId, 'Selected early source is chapter two, not current tail')
  check(scenarioRequests().every(request => !JSON.stringify(request.body).includes(fixture.largeBrowserRecipe.overrides['600'])), 'Chapter-600 future canary never enters actual model wire')
  const saved = await committed(), chapter = saved.find(novel => novel.id === active.profile.novelId).chapterList.find(chapter => chapter.id === Number(active.profile.targetId))
  check(chapter.content.includes(active.draft), 'Long profile ordinary save produced actual durable appended body')
}, { profile: 'large', width })

// Verify the frozen denominator and every named row before any browser launch.
assert.equal(cases.length, 90, 'All 90 registered variants remain inside the frozen 18-group denominator')
for (const group of frozen.browserGroups) {
  for (const row of group.rows) {
    const registered = cases.filter(test => test.groupId === group.id && test.id === row.id)
    assert.ok(registered.length, `Frozen row has no implementation: ${row.id}`)
    for (const variant of row.variants ?? []) assert.ok(registered.some(test => test.variant === variant), `Frozen named variant omitted: ${row.id}/${variant}`)
  }
}
report.gaps.push(
  { boundary: 'Exact novelSaveAttempts at save-function entry', coverage: 'MutationObserver observes only rendered saving-indicator rising edges, which Vue may coalesce. Exact browser counter remains null; savingIndicatorTransitions is a UI proxy. Node exact-entry ownership/ordinary-save tests are required separately. Actual metadata attempts, commit gates and durable commits remain independently observed.' },
  { boundary: 'Exact memoryPrepareStarts before the first source read', coverage: 'No browser production instrumentation hook exists. Actual Worker sync/search are counted. Runtime exact-entry/continuation tests must pass separately; this counter remains null, never a fabricated one.' },
  { boundary: 'Same-page raw HTML/deep active-config/grant refs while modal controls are disabled or unmounted', coverage: 'Browser reports disabled/template-handler and real cross-tab storage boundaries. UI real-ref Node races are required separately; no programmatic Vue internals are read or changed.' },
)
report.registeredScenarios = cases.map(({ groupId, id, variant }) => ({ groupId, id, variant }))
function finalize() {
  for (const group of report.groups) {
    const expected = cases.filter(test => test.groupId === group.id)
    group.expectedScenarios = expected.length
    group.attempted = group.scenarios.filter(test => test.status !== 'not_run').length
    group.passed = group.scenarios.filter(test => test.status === 'passed').length
    group.failed = group.scenarios.filter(test => test.status === 'failed').length
    group.notRun = expected.length - group.attempted
    group.status = group.failed ? 'failed' : group.notRun ? 'not_run' : group.passed === expected.length ? 'passed' : 'not_run'
  }
  report.summary = { denominator: 18, attempted: report.groups.filter(group => group.attempted > 0).length,
    passed: report.groups.filter(group => group.status === 'passed').length, failed: report.groups.filter(group => group.status === 'failed').length,
    notRun: report.groups.filter(group => group.status === 'not_run').length,
    scenarios: { expected: cases.length, attempted: report.groups.reduce((sum, group) => sum + group.attempted, 0),
      passed: report.groups.reduce((sum, group) => sum + group.passed, 0), failed: report.groups.reduce((sum, group) => sum + group.failed, 0),
      notRun: report.groups.reduce((sum, group) => sum + group.notRun, 0) } }
  report.finishedAt = new Date().toISOString()
  report.httpBoundaries = boundaryRequests
  report.provider = requests.map(request => ({ scenario: request.scenario, kind: request.kind, inputBytes: request.bytes, responseBytes: request.responseBytes, status: request.status }))
}
async function runCase(test) {
  const group = report.groups.find(group => group.id === test.groupId)
  scenario = { id: test.id, variant: test.variant, frozenRow: frozen.browserGroups.find(group => group.id === test.groupId).rows.some(row => row.id === test.id) ? test.id : null, key: `${test.id}/${test.variant}`, status: 'running', assertions: [], startedAt: new Date().toISOString() }
  group.scenarios.push(scenario)
  const started = Date.now(), fixtureErrorsBefore = report.fixtureErrors.length, browserErrorsBefore = report.browserErrors.length
  console.log(`START ${scenario.key}`)
  let timer
  try {
    await Promise.race([(async () => {
      await fresh(test.options)
      await test.run()
      assert.equal(report.fixtureErrors.length, fixtureErrorsBefore, 'Synthetic provider rejected a real request')
      assert.equal(report.browserErrors.length, browserErrorsBefore, 'Production browser raised an uncaught error')
      const frozenRow = frozen.browserGroups.find(group => group.id === test.groupId).rows.find(row => row.id === test.id)
      if (frozenRow && scenario.counters) {
        scenario.frozenCounterComparison = { asserted: [], unavailable: [] }
        for (const [key, expected] of Object.entries(frozenRow.expectedCounters ?? {})) {
          if (key === 'memoryPrepareStarts' || key === 'novelSaveAttempts' || scenario.counters[key] === undefined || scenario.counters[key] === null) { scenario.frozenCounterComparison.unavailable.push(key); continue }
          if (test.id === 'B11.b' && test.variant === 'grant_false') { scenario.frozenCounterComparison.unavailable.push(`${key}: active grant control unmounted; preview behavior and Node companion only`); continue }
          equal(scenario.counters[key], expected, `Frozen ${test.id} exact ${key}`)
          scenario.frozenCounterComparison.asserted.push(key)
        }
      }
      const remaining = await active.page.evaluate(() => globalThis.__writerAgentProbe.holds.map(hold => hold.label))
      assert.deepEqual(remaining, [], 'A scenario leaked held native API callbacks')
      assert.equal(report.blockedRequests.filter(request => request.scenario === scenario.key).length, 0, 'Attempted unapproved outbound request')
    })(), new Promise((_, reject) => { timer = setTimeout(() => reject(codeError('scenario_timeout', 'Scenario exceeded its 180-second CI observation window')), 180_000) })])
    scenario.status = 'passed'; console.log(`PASS  ${scenario.key}`)
  } catch (error) {
    scenario.status = 'failed'; scenario.failure = { code: error.code ?? error.name ?? 'assertion', message: String(error.message).slice(0, 900) }
    if (error.code === 'scenario_timeout') report.stoppedAfterTimeout = scenario.key
    console.error(`FAIL  ${scenario.key}: ${scenario.failure.message}`)
    if (active?.page && !active.page.isClosed()) {
      const observed = await currentProbe().catch(() => null)
      if (observed) scenario.failureObserved = { phase: observed.lastPhase, sourceReads: observed.sourceReads, workerSync: observed.workerSync,
        workerSearch: observed.workerSearch, metadataAttempts: observed.metadataAttempts, metadataCommits: observed.metadataCommits, editorAppends: observed.editorAppends,
        clipboardAvailable: observed.clipboardAvailable, clipboardRequests: observed.clipboardRequests, clipboardCompletion: observed.clipboardCompletion,
        statusText: (await nodes(active.page, 'status').textContent({ timeout: 500 }).catch(() => ''))?.slice(0, 200) }
      if (!report.screenshots.some(item => item.filename === 'failure.png')) {
        await active.page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: false }).then(() => report.screenshots.push({ filename: 'failure.png', scenario: scenario.key })).catch(() => {})
      }
    }
  } finally {
    clearTimeout(timer)
    scenario.durationMs = Date.now() - started
    // Close the context BEFORE releasing server handles: no stale browser can
    // consume an old response or carry settings/leases into the next scenario.
    await currentContext?.close().catch(() => {})
    for (const send of [...heldHttp]) if (send.scenario === scenario.key) { send(); heldHttp.delete(send) }
    active = null; currentContext = null
    // Do not save raw wire bodies, source payloads, browser traces or a backup.
    if (scenario.audit) scenario.audit = { phase: scenario.audit.phase, budget: scenario.audit.budget,
      usage: scenario.audit.usage, errorCode: scenario.audit.errorCode, events: scenario.audit.events, application: scenario.audit.application,
      receipt: scenario.audit.receipt }
    finalize(); await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  }
}

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Writer Agent browser acceptance may run only in authorized GitHub CI. Local browser execution/installation is prohibited; use node --check only.')
await mkdir(artifacts, { recursive: true })
try {
  preview = await startPreviewServer({ port: 0, sha: process.env.GITHUB_SHA ?? 'unspecified', ttlMs: 45 * 60_000 })
  origin = `http://127.0.0.1:${preview.address().port}`
  await startProvider(); browser = await chromium.launch({ headless: true })
  for (const test of cases) {
    await runCase(test)
    // An unresolved timed-out continuation still references scenario globals.
    // Do not give it another scenario to mutate. Keep the frozen denominator
    // and report every remaining scenario as not_run, rather than reusing it.
    if (report.stoppedAfterTimeout) break
  }
} catch (error) {
  report.startupFailure = { code: error.code ?? error.name, message: String(error.message).slice(0, 900) }
} finally {
  await currentContext?.close().catch(() => {})
  await browser?.close().catch(() => {})
  for (const send of [...heldHttp]) send()
  provider?.closeAllConnections?.(); preview?.closeAllConnections?.()
  if (provider) await new Promise(resolve => provider.close(resolve))
  if (preview) await new Promise(resolve => preview.close(resolve))
  finalize(); await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
}
console.log(JSON.stringify({ fixtureHash, ...report.summary, screenshots: report.screenshots.map(item => item.filename) }))
if (report.summary.passed !== 18 || report.fixtureErrors.length || report.browserErrors.length || report.blockedRequests.length || report.startupFailure) process.exitCode = 1
