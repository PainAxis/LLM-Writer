/** Actual production App + native IndexedDB; all provider replies intercepted.
 * This is synthetic browser integration evidence, never real-model acceptance. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { startPreviewServer } from './browser-preview.mjs'
import { creativeControlText } from './lib/creative-pilot-control.ts'

if (process.env.CI !== 'true' || process.env.CREATIVE_PILOT_CI_APPROVED !== '1') throw new Error('creative_browser_ci_only')
const report = { protocol: 'creative-live-browser-v1', evidence: 'synthetic_provider_interception', fixtureClock: '2026-11-02T12:00:00.000Z', status: 'running', stage: 'setup', failureKind: null, panels: [], requests: 0,
  acceptedTasks: 0, acceptedBodies: 0, zeroCallPreparation: false, zeroCallRestoration: false, credentialNotStored: false,
  sessionRevocation: false, unknownNotReplayed: false, externalRequestsBlocked: 0, browserErrors: 0 }
let server, browser, context, page, hold = false, held = null, observeHeld = () => {}
const key = 'synthetic-live-browser-credential'
const target = 'https://api.openai.com/v1/chat/completions'
try {
  server = await startPreviewServer({ port: 0, sha: process.env.GITHUB_SHA || 'local' })
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) })
  context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  await context.route('**/*', async route => {
    const request = route.request()
    if (new URL(request.url()).origin === origin) return route.continue()
    if (request.url() === target && request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'authorization,content-type' } })
    if (request.url() !== target || request.method() !== 'POST') { report.externalRequestsBlocked++; return route.abort() }
    report.requests++
    assert.equal(request.headers().authorization, `Bearer ${key}`)
    const body = request.postDataJSON()
    assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.reasoning_effort, 'none'); assert.equal(body.service_tier, 'default')
    assert.equal(body.store, false); assert.equal(body.stream, false); assert.equal(body.max_completion_tokens, 4096)
    const packet = JSON.parse(body.messages[1].content)
    const text = await creativeControlText(packet)
    if (hold) { held = route; observeHeld(); return }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': origin }, body: JSON.stringify({ id: 'synthetic-live-response', object: 'chat.completion', created: 1,
      model: 'gpt-6-luna', service_tier: 'default', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }],
      usage: { prompt_tokens: 100, completion_tokens: 200, completion_tokens_details: { reasoning_tokens: 0 } } }) })
  })
  page = await context.newPage()
  await page.clock.setFixedTime(new Date(report.fixtureClock))
  page.on('pageerror', () => { report.browserErrors++ })
  const open = async () => {
    await page.goto(`${origin}/#/creative-live-pilot`)
    await page.getByTestId('creative-live-pilot').waitFor()
    const welcome = page.getByRole('button', { name: '我知道了', exact: true })
    if (await welcome.isVisible()) await welcome.click()
  }
  const readyPanels = async () => {
    const panels = page.getByTestId('creative-pilot-panel')
    await panels.nth(1).waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="creative-pilot-panel"]')].length === 2
      && [...document.querySelectorAll('[data-testid="creative-pilot-panel"]')].every(el => el.getAttribute('aria-busy') === 'false'))
    return panels
  }
  const prepare = async () => {
    await page.getByTestId('live-brief-zh').fill('一位馆员在雨停前寻找被遗忘的钟声。')
    await page.getByTestId('live-brief-en').fill('An archivist searches for a forgotten bell before the rain ends.')
    await page.getByTestId('live-pair-consent').check()
    await page.getByTestId('live-prepare').click()
    await readyPanels()
    const text = await page.getByTestId('live-grant').innerText()
    return { zh: text.match(/live-zh-[a-f0-9-]+/)[0], en: text.match(/live-en-[a-f0-9-]+/)[0] }
  }
  const authorize = async () => {
    await page.getByTestId('live-key').fill(key)
    await page.getByTestId('live-session-consent').check()
    await page.getByTestId('live-authorize').click()
    await page.getByTestId('live-authority').filter({ hasText: '会话连接已启用' }).waitFor()
    return readyPanels()
  }
  const preview = async (panel, language = 'interrupted') => {
    report.stage = `${language}_preview_click`
    await panel.getByTestId('creative-pilot-dry-prepare').click()
    report.stage = `${language}_readiness_wait`
    await panel.getByTestId('creative-pilot-readiness').filter({ hasText: 'live_provider_ready' }).waitFor()
    report.stage = `${language}_consent_check`
    await panel.getByTestId('creative-pilot-consent').locator('input').check()
  }
  const storageSafe = async () => page.evaluate(async needle => {
    if (JSON.stringify(localStorage).includes(needle) || JSON.stringify(sessionStorage).includes(needle)) return false
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('llm-writer'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('idb_open')) })
    try { return await new Promise((resolve, reject) => { const transaction = db.transaction('kv', 'readonly'), request = transaction.objectStore('kv').getAll();
      request.onsuccess = () => resolve(!JSON.stringify(request.result).includes(needle)); request.onerror = () => reject(new Error('idb_read')) }) } finally { db.close() }
  }, key)
  report.stage = 'open'
  await open()
  report.stage = 'prepare'
  const ids = await prepare()
  assert.equal(report.requests, 0); report.zeroCallPreparation = true
  report.stage = 'authorize'
  let panels = await authorize()
  assert.equal(report.requests, 0)
  for (let i = 0; i < 2; i++) {
    const panel = panels.nth(i)
    const language = ['zh', 'en'][i]
    await preview(panel, language); report.stage = `${language}_start_click`; await panel.getByTestId('creative-pilot-start').click()
    report.stage = `${language}_completion_wait`
    await panel.getByTestId('creative-pilot-status').filter({ hasText: 'completed' }).waitFor({ timeout: 180_000 })
    report.stage = `${language}_artifacts_verify`
    assert.equal(await panel.getByTestId('creative-pilot-artifact').count(), 9)
    assert.equal(await panel.locator('[data-testid="creative-pilot-artifact"][data-task^="b-"]').count(), 3)
    report.acceptedTasks += 9; report.acceptedBodies += 3
  }
  report.stage = 'pair_storage_verify'
  assert.equal(report.requests, 18); assert.equal(await storageSafe(), true)
  report.credentialNotStored = true
  report.stage = 'pair_reload_restore'
  await page.reload(); await page.getByTestId('creative-live-pilot').waitFor()
  assert.equal(await page.getByTestId('creative-pilot-panel').count(), 0)
  await page.getByTestId('live-restore-id').fill(ids.zh); await page.getByTestId('live-restore').click(); panels = await readyPanels()
  assert.equal(report.requests, 18)
  assert.match(await page.getByTestId('live-authority').innerText(), /未启用/)
  assert.equal(await page.getByTestId('live-key').inputValue(), '')
  assert.equal(await panels.nth(0).getByTestId('creative-pilot-artifact').count(), 9)
  report.zeroCallRestoration = true

  // A new explicitly created synthetic pair exercises an in-flight revocation.
  report.stage = 'interrupted_pair_prepare'
  await page.reload(); const interrupted = await prepare(); panels = await authorize()
  const heldRequest = new Promise(resolve => { observeHeld = resolve })
  hold = true; await preview(panels.nth(0)); await panels.nth(0).getByTestId('creative-pilot-start').click()
  let heldTimer
  try { await Promise.race([heldRequest, new Promise((_, reject) => { heldTimer = setTimeout(() => reject(new Error('held_request_deadline')), 30_000) })]) }
  finally { clearTimeout(heldTimer) }
  report.stage = 'interrupted_revoke'
  await page.getByTestId('live-revoke').click()
  assert.match(await page.getByTestId('live-authority').innerText(), /未启用/)
  assert.equal(await page.getByTestId('live-key').inputValue(), '')
  if (held) { await held.abort().catch(() => {}); held = null }
  hold = false; report.sessionRevocation = true
  report.stage = 'interrupted_restore'
  await page.reload(); await page.getByTestId('live-restore-id').fill(interrupted.zh); await page.getByTestId('live-restore').click(); panels = await readyPanels()
  const requests = report.requests
  await panels.nth(0).getByTestId('creative-pilot-unknown').waitFor()
  assert.equal(await panels.nth(0).getByTestId('creative-pilot-start').isDisabled(), true)
  assert.equal(await panels.nth(0).getByTestId('creative-pilot-resume').isDisabled(), true)
  assert.equal(report.requests, requests); assert.equal(requests, 19)
  report.unknownNotReplayed = true
  assert.equal(await storageSafe(), true); assert.equal(report.externalRequestsBlocked, 0); assert.equal(report.browserErrors, 0)
  report.status = 'pass'; report.stage = 'completed'
} catch (error) {
  report.status = 'fail'; process.exitCode = 1
  report.failureKind = ['TimeoutError', 'AssertionError'].includes(error?.name) ? error.name : 'other'
  if (page && !page.isClosed()) report.panels = await page.evaluate(() => {
    const statuses = ['prepared', 'running', 'blocked', 'completed', 'cancelled', 'expired', 'stopped', 'unconfirmed', 'draft']
    const errors = ['unsupported_schema', 'integrity', 'conflict', 'operation_conflict', 'budget', 'storage_unknown', 'cancelled', 'deadline_exceeded', 'operation_timeout', 'unconfigured', 'configuration_changed', 'authority_revoked', 'expired', 'clock_rollback', 'context_capacity', 'source_changed', 'input_invalid', 'transport_wire_invalid', 'retention_capacity', 'unknown_outcome', 'attempt_spent', 'replacement_after_reservation', 'already_terminal', 'metadata_capacity']
    return [...document.querySelectorAll('[data-testid="creative-pilot-panel"]')].slice(0, 2).map(panel => {
      const field = name => panel.querySelector(`[data-testid="creative-pilot-${name}"]`)
      const status = field('status')?.getAttribute('data-status')
      const code = field('error')?.textContent?.trim().split(/\s/)[0]
      const readiness = field('readiness')?.textContent?.trim().split(/\s/)[0]
      return { busy: panel.getAttribute('aria-busy') === 'true', status: statuses.includes(status) ? status : 'absent',
        error: !code ? 'none' : errors.includes(code) ? code : 'unclassified',
        readiness: ['unconfigured', 'offline_control_ready', 'live_provider_ready'].includes(readiness) ? readiness : 'absent',
        dryDisabled: field('dry-prepare')?.disabled ?? null, startDisabled: field('start')?.disabled ?? null,
        resumeDisabled: field('resume')?.disabled ?? null, consentChecked: field('consent')?.querySelector('input')?.checked ?? null }
    })
  }).catch(() => [])
}
finally {
  if (held) await held.abort().catch(() => {})
  await context?.close(); await browser?.close()
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await mkdir('artifacts/creative-live-pilot', { recursive: true })
  await writeFile('artifacts/creative-live-pilot/browser-summary.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
}
