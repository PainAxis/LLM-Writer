/* global process, Buffer */
/** CI-only real native-IDB and shipped-panel acceptance. Never launch locally or retry a browser. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect as playwrightExpect } from '@playwright/test'
import { build } from 'vite'
import { producerAppBuildOptions, producerDriverBuildOptions } from './fixtures/writer-body-producer-build.mjs'
import { producerIdentity, producerIdentityMatches } from './fixtures/writer-body-producer-identity.mjs'
import { arbitraryProducerBody, CONTROL_MODEL, producerControlOutput } from './fixtures/writer-body-producer-control.ts'
import { emptyProducerReport, producerReportExitCode, safeProducerCode, validateProducerReport } from './fixtures/writer-body-producer-report.ts'
const root = fileURLToPath(new URL('../', import.meta.url)), hash = value => createHash('sha256').update(value).digest('hex'), expect = playwrightExpect.configure({ timeout: 20_000 })
const verify = value => { if (!value) throw new Error('producer_browser_verification_failed') }
const node = (page, id) => page.getByTestId(`body-producer-${id}`)
async function main() {
  // This explicit guard is not a browser permission bypass. It prevents accidental
  // local execution; approved CI still uses the ordinary sandboxed launch.
  if (process.env.CI !== 'true' || process.env.BODY_PRODUCER_CI_APPROVED !== '1') throw new Error('producer_browser_ci_only')
  const provenance = await producerIdentity(root), report = emptyProducerReport(provenance.source, 'browser')
  const target = path.join(root, 'artifacts/writer-body-producer/browser-summary.json'), privateRoot = await mkdtemp(path.join(tmpdir(), 'body-producer-native-'))
  let context, server, driver, appControl, active = null, held = null, holdNext = false
  let observation = { attempts: 0, inputDigests: [], windowDigests: [], errors: 0 }
  const persist = async () => { validateProducerReport(report); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, `${JSON.stringify(report, null, 2)}\n`) }
  const resetHttp = () => { verify(held === null); observation = { attempts: 0, inputDigests: [], windowDigests: [], errors: 0 }; holdNext = false }
  const failActive = () => { if (active) { active.status = 'failed'; active.refusalCode = 'profile_failed' } }
  try {
    await persist()
    const out = path.join(privateRoot, 'driver-dist'), entry = path.join(root, 'scripts/fixtures/writer-body-producer-browser.ts')
    await build(producerDriverBuildOptions(root, out, entry, filename => { driver = filename }))
    verify(driver)
    const assets = new Map()
    async function collect(dir, prefix = '') { for (const row of await readdir(dir, { withFileTypes: true })) { if (row.isSymbolicLink() || row.name.startsWith('.')) continue; const name = `${prefix}/${row.name}`, actual = path.join(dir, row.name); if (row.isDirectory()) await collect(actual, name); else assets.set(name, await readFile(actual)) } }
    await collect(out)
    const css = [...assets.keys()].filter(name => name.endsWith('.css')).map(name => `<link rel="stylesheet" href="${name}">`).join('')
    assets.set('/', Buffer.from(`<!doctype html><meta charset="utf-8"><title>Campaign Lab producer acceptance host</title>${css}<div id="app"></div>`))
    const buildHash = hash(JSON.stringify([...assets].map(([name, bytes]) => [name, hash(bytes)]).sort(([a], [b]) => a.localeCompare(b))))
    report.builds.native = buildHash; report.builds.ui = buildHash
    server = createServer(async (request, response) => {
      try {
        const key = request.url?.split('?')[0]
        if (request.method === 'POST' && key === '/v1/chat/completions') {
          observation.attempts++
          let raw = ''
          for await (const chunk of request) { raw += chunk; if (Buffer.byteLength(raw) > 131_072) throw new Error('producer_control_oversize') }
          const body = JSON.parse(raw)
          verify(body.model === CONTROL_MODEL && body.max_tokens === 1200 && body.temperature === 0.1 && body.thinking?.type === 'disabled')
          verify(Array.isArray(body.messages) && body.messages.length === 2 && body.messages[0].role === 'system' && body.messages[1].role === 'user')
          for (const key of ['tools', 'tool_choice', 'functions', 'stream']) verify(body[key] === undefined)
          const wire = { prompt: body.messages[1].content, system: body.messages[0].content }, input = JSON.parse(wire.prompt), window = input.window?.text
          verify(typeof window === 'string' && window.length && observation.inputDigests.length < 16)
          observation.inputDigests.push(hash(JSON.stringify(wire))); observation.windowDigests.push(hash(window))
          const answer = producerControlOutput(window)
          const send = () => { if (!response.destroyed) response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ id: 'offline-control', object: 'chat.completion', created: 1, model: 'synthetic-reported-model', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: answer } }], usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 } })) }
          if (holdNext) { verify(held === null); holdNext = false; held = send } else send()
          return
        }
        const bytes = assets.get(key)
        if (!bytes || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404).end(); return }
        response.writeHead(200, { 'content-type': key.endsWith('.js') ? 'application/javascript' : key.endsWith('.css') ? 'text/css' : 'text/html', 'cache-control': 'no-store' }).end(request.method === 'HEAD' ? undefined : bytes)
      } catch { observation.errors++; failActive(); response.destroy() }
    })
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const origin = `http://127.0.0.1:${server.address().port}`, endpoint = `${origin}/v1`, moduleUrl = `${origin}/${driver}`
    const appOut = path.join(privateRoot, 'app-dist')
    await build(producerAppBuildOptions(root, appOut, endpoint, filename => { appControl = filename }))
    verify(appControl)
    const appControlUrl = `${origin}/app/${appControl}`
    await collect(appOut, '/app')
    verify(assets.has('/app/index.html')); assets.set('/app/', assets.get('/app/index.html'))
    report.builds.app = hash(JSON.stringify([...assets].filter(([name]) => name.startsWith('/app/')).map(([name, bytes]) => [name, hash(bytes)]).sort(([a], [b]) => a.localeCompare(b))))
    async function launch(profile, route = '/') {
      const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 1000 }, ...(executablePath ? { executablePath } : {}) })
      await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); report.blockedExternalRequests++; failActive(); return route.abort() })
      const watch = page => page.on('pageerror', () => { report.browserErrors++; if (active && 'browserErrors' in active) active.browserErrors++; failActive() })
      context.on('page', watch); context.pages().forEach(watch)
      await context.exposeBinding('__producerReadHttp', () => structuredClone(observation))
      await context.exposeBinding('__producerProgress', async (_source, row) => { verify(active && active.id === row.id && active.language === row.language); const index = report.profiles.findIndex(current => current.id === row.id); verify(index >= 0); report.profiles[index] = row; active = row; await persist() })
      const page = context.pages()[0] ?? await context.newPage(); await page.goto(`${origin}${route}`); return page
    }
    for (const [index, language] of ['zh', 'en'].entries()) {
      resetHttp(); active = report.profiles[index + 2]
      const profile = path.join(privateRoot, `native-${language}`), page = await launch(profile)
      report.profiles[index + 2] = await page.evaluate(async ({ moduleUrl, endpoint, language }) => (await import(moduleUrl)).runNativeProfile(language, endpoint), { moduleUrl, endpoint, language })
      active = report.profiles[index + 2]; await persist(); await context.close(); context = null
      if (active.status !== 'pass') break
      const before = observation.attempts, restarted = await launch(profile)
      report.profiles[index + 2] = await restarted.evaluate(async ({ moduleUrl, expected }) => (await import(moduleUrl)).restartNative(expected), { moduleUrl, expected: active })
      active = report.profiles[index + 2]; verify(observation.attempts === before); await persist(); await context.close(); context = null
      if (active.status !== 'pass' || active.restart !== 'pass') break
    }
    if (report.profiles.filter(row => row.platform === 'native').every(row => row.status === 'pass' && row.restart === 'pass')) {
      for (const [index, language] of ['zh', 'en'].entries()) {
        resetHttp(); const row = report.ui[index]; active = row; row.status = 'running'; await persist()
        const mark = id => { row.checks.find(check => check.id === id).status = 'pass' }
        const profile = path.join(privateRoot, `ui-${language}`); let page = await launch(profile)
        const mount = existing => page.evaluate(async ({ moduleUrl, endpoint, language, existing }) => (await import(moduleUrl)).mountProducerUi(language, endpoint, existing), { moduleUrl, endpoint, language, existing })
        const observed = () => page.evaluate(async moduleUrl => (await import(moduleUrl)).producerUiObservation(), moduleUrl)
        try {
          await mount(false); await expect(node(page, 'panel')).toBeVisible(); mark('actual_panel')
          await expect(node(page, 'adopt')).toBeEnabled(); await node(page, 'adopt').click(); await expect(node(page, 'identity')).toBeVisible(); verify((await observed()).adopted && observation.attempts === 0); mark('explicit_adoption')
          await node(page, 'chapter').selectOption('3')
          await node(page, 'revision-section').locator('summary').click(); await node(page, 'revision-text').fill(arbitraryProducerBody(language, 1))
          const body = await node(page, 'revision-text').inputValue()
          await node(page, 'revision-preview').click(); await expect(node(page, 'revision-ready')).toBeVisible(); await node(page, 'revision-commit').click()
          await expect.poll(async () => (await observed()).sourceEpoch).toBe(1); verify(await node(page, 'source-text').inputValue() === body); mark('manual_revision')
          await node(page, 'prepare').click(); await expect(node(page, 'prepared')).toBeVisible(); verify(observation.attempts === 0); mark('zero_dispatch_prepare')
          const prepared = JSON.parse(await node(page, 'exact-input').textContent()), firstDigest = prepared.inputDigest
          verify(prepared.window.text === body && prepared.catalog.length === 0)
          await node(page, 'invoke').evaluate(button => { button.click(); button.click() })
          await expect(node(page, 'review')).toBeVisible(); verify(observation.attempts === 1 && (await observed()).requests === 1); mark('explicit_sdk_invocation'); mark('duplicate_no_replay')
          verify(observation.inputDigests[0] === firstDigest && observation.windowDigests[0] === hash(body)); mark('exact_source_input')
          verify((await node(page, 'unresolved').textContent()).includes('unmapped_topic') && await node(page, 'claims').locator('li').count() === 1); mark('readonly_inventory')
          verify((await node(page, 'semantic-boundary').textContent()).includes('not_reviewed')); mark('semantic_boundary')
          await context.close(); context = null; page = await launch(profile); await mount(true)
          await expect(node(page, 'identity')).toBeVisible(); verify(observation.attempts === 1 && (await observed()).requests === 1)
          const latest = (await observed()).latestRequestId; await node(page, `recover-${latest}`).click(); await expect(node(page, 'review')).toBeVisible(); verify(observation.attempts === 1); mark('reload_no_dispatch')
          await node(page, 'chapter').selectOption('3'); await node(page, 'revision-section').locator('summary').click(); await node(page, 'revision-text').fill(arbitraryProducerBody(language, 2))
          await node(page, 'revision-preview').click(); await expect(node(page, 'revision-ready')).toBeVisible(); await node(page, 'revision-commit').click()
          await expect.poll(async () => (await observed()).sourceEpoch).toBe(2); await expect(node(page, 'review')).toHaveCount(0)
          await node(page, 'prepare').click(); await expect(node(page, 'prepared')).toBeVisible(); verify(JSON.parse(await node(page, 'exact-input').textContent()).inputDigest !== firstDigest); mark('source_edit_invalidates')
          holdNext = true; await node(page, 'invoke').click(); await expect.poll(() => observation.attempts).toBe(2); verify(held !== null)
          await node(page, 'stop-local').click(); const release = held; held = null; release()
          await expect.poll(async () => (await observed()).latestStatus).toBe('outcome_unknown'); await node(page, 'refresh').click(); await expect(node(page, 'identity')).toBeVisible()
          let unknown = await observed(); verify(unknown.unknown === 1 && unknown.outstandingBytes > 0 && unknown.latestStatus === 'outcome_unknown')
          await context.close(); context = null; page = await launch(profile); await mount(true); await expect(node(page, 'identity')).toBeVisible(); unknown = await observed()
          verify(unknown.unknown === 1 && unknown.outstandingBytes > 0 && observation.attempts === 2); mark('cancel_unknown_retained')
          await node(page, 'chapter').selectOption('3'); await node(page, 'prepare').click(); await expect(node(page, 'prepared')).toBeVisible()
          holdNext = true; await node(page, 'invoke').click(); await expect.poll(() => observation.attempts).toBe(3); verify(held !== null)
          await node(page, 'host-away').click(); await expect(node(page, 'identity')).toHaveCount(0); await expect(node(page, 'review')).toHaveCount(0)
          const lateNavigationReply = held; held = null; lateNavigationReply()
          await expect.poll(async () => (await observed()).latestStatus).toBe('outcome_unknown')
          await expect(node(page, 'review')).toHaveCount(0); await expect(node(page, 'source-text')).toHaveCount(0)
          await node(page, 'host-home').click(); await expect(node(page, 'identity')).toBeVisible(); await expect(node(page, 'review')).toHaveCount(0)
          unknown = await observed(); verify(unknown.requests === 3 && unknown.unknown === 2 && unknown.outstandingBytes > 0 && observation.attempts === 3)
          await context.close(); context = null; page = await launch(profile); await mount(true); await expect(node(page, 'identity')).toBeVisible(); await expect(node(page, 'review')).toHaveCount(0)
          unknown = await observed(); verify(unknown.requests === 3 && unknown.unknown === 2 && unknown.outstandingBytes > 0 && observation.attempts === 3); row.unknownRequests = unknown.unknown; mark('pending_navigation_fenced')
          row.httpAttempts = observation.attempts; verify(observation.errors === 0 && row.browserErrors === 0); row.status = 'pass'
        } catch (error) { row.status = 'failed'; row.refusalCode = safeProducerCode(error); const unfinished = row.checks.find(check => check.status !== 'pass'); if (unfinished) unfinished.status = 'fail'; row.httpAttempts = observation.attempts }
        finally { if (held) { const release = held; held = null; release() }; if (context) { await context.close(); context = null }; await persist() }
        if (row.status !== 'pass') break
      }
    }
    if (report.ui.every(row => row.status === 'pass')) {
      for (const [index, language] of ['zh', 'en'].entries()) {
        resetHttp(); const row = report.app[index]; active = row; row.status = 'running'; await persist()
        const mark = id => { row.checks.find(check => check.id === id).status = 'pass' }
        const profile = path.join(privateRoot, `app-${language}`); let page = await launch(profile, '/app/#/')
        const campaign = id => page.getByTestId(`campaign-${id}`)
        const verificationControl = (action, mode = null) => page.evaluate(async ({ url, action, mode }) => {
          const controls = await import(url)
          if (action === 'arm') controls.armBodyProducerVerificationHold(mode, 8)
          else if (action === 'release') controls.releaseBodyProducerVerificationHold()
          return controls.observeBodyProducerVerificationHold()
        }, { url: appControlUrl, action, mode })
        try {
          // The real App's first-run announcement is dismissed through its UI.
          await expect(page.getByRole('button', { name: '我知道了', exact: true })).toBeVisible()
          await page.getByRole('button', { name: '我知道了', exact: true }).click()
          await expect(campaign('navigation')).toBeVisible(); await campaign('navigation').click(); await expect(campaign('lab')).toBeVisible(); mark('real_app_router')
          await campaign(`create-planning-${language}`).click(); await expect(campaign('id')).toBeVisible()
          const campaignId = await campaign('id').textContent(); verify(campaignId && observation.attempts === 0)
          for (let step = 1; step <= 9; step++) { await expect(campaign('step')).toBeEnabled(); await campaign('step').click(); await expect(campaign('task-progress')).toContainText(`${step} / 9`) }
          await expect(campaign('status')).toHaveAttribute('data-status', 'completed'); verify(observation.attempts === 0); mark('planning_created_and_completed')
          // Actual session progress grants no partial snapshot or dispatch. The
          // two controls delay real native IO boundaries, never substitute rows.
          for (const [mode, checkId, metric] of [['before_io', 'verification_cancel_between_advances', 'cancelledBeforeIo'], ['after_io', 'verification_cancel_pending_io', 'cancelledPendingIoAcknowledgment']]) {
            await verificationControl('arm', mode)
            await expect(node(page, 'adopt')).toBeEnabled(); await node(page, 'adopt').click()
            await expect.poll(async () => (await verificationControl('observe')).entered).toBe(true)
            const pending = await verificationControl('observe')
            verify(pending.progressEvents > 0 && pending.maxVerifiedOperations >= 8 && pending.rawReadCalls > 0 && observation.attempts === 0)
            row.verificationProgressEvents += pending.progressEvents
            await expect(node(page, 'verification')).toBeVisible(); await expect(node(page, 'verification-boundary')).toBeVisible()
            await expect(node(page, 'identity')).toHaveCount(0); await expect(node(page, 'prepared')).toHaveCount(0); await expect(node(page, 'review')).toHaveCount(0); mark('verification_progress')
            await node(page, 'stop-local').click(); await verificationControl('release')
            await expect.poll(async () => (await verificationControl('observe')).activeOwners).toBe(0)
            await expect(node(page, 'verification')).toHaveCount(0); await expect(node(page, 'adopt')).toBeEnabled()
            await expect(node(page, 'identity')).toHaveCount(0); verify(observation.attempts === 0)
            const unchanged = await page.evaluate(async ({ moduleUrl, campaignId }) => (await import(moduleUrl)).producerCampaignObservation(campaignId), { moduleUrl, campaignId })
            verify(unchanged.adopted === false && unchanged.requests === 0 && unchanged.outstandingBytes === 0)
            // after_io means a real IDB result awaits acknowledgment, not that
            // an IndexedDB transaction itself is still open.
            row[metric]++; mark(checkId)
          }
          await verificationControl('arm', 'before_io'); await node(page, 'adopt').click()
          await expect.poll(async () => (await verificationControl('observe')).entered).toBe(true)
          const beforeReload = await verificationControl('observe'); verify(beforeReload.maxVerifiedOperations >= 8); row.verificationProgressEvents += beforeReload.progressEvents
          await expect(node(page, 'verification')).toBeVisible(); await context.close(); context = null
          page = await launch(profile, '/app/#/campaigns'); await expect(campaign(`select-${campaignId}`)).toBeVisible(); await campaign(`select-${campaignId}`).click()
          await expect(node(page, 'adopt')).toBeEnabled(); await expect(node(page, 'verification')).toHaveCount(0); await expect(node(page, 'identity')).toHaveCount(0)
          const afterReload = await verificationControl('observe'); verify(!afterReload.armed && afterReload.progressEvents === 0 && observation.attempts === 0)
          const unchangedAfterReload = await page.evaluate(async ({ moduleUrl, campaignId }) => (await import(moduleUrl)).producerCampaignObservation(campaignId), { moduleUrl, campaignId }); verify(unchangedAfterReload.adopted === false)
          row.verificationReloads++; mark('verification_reload_ephemeral')
          await node(page, 'adopt').click(); await expect(node(page, 'identity')).toBeVisible()
          await expect(campaign('inspection')).toHaveCount(0); await expect(campaign('step')).toHaveCount(0); mark('v3_embedding_transition')
          await node(page, 'chapter').selectOption('3'); await node(page, 'revision-section').locator('summary').click(); await node(page, 'revision-text').fill(arbitraryProducerBody(language, 3))
          const body = await node(page, 'revision-text').inputValue(); row.sourceHash = hash(body)
          await node(page, 'revision-preview').click(); await expect(node(page, 'revision-ready')).toBeVisible(); await node(page, 'revision-commit').click(); await expect(node(page, 'source-text')).toHaveValue(body); mark('manual_revision')
          await node(page, 'prepare').click(); await expect(node(page, 'prepared')).toBeVisible(); verify(observation.attempts === 0)
          const prepared = JSON.parse(await node(page, 'exact-input').textContent()); row.inputDigest = prepared.inputDigest
          verify(prepared.window.text === body && prepared.catalog.length === 0)
          await node(page, 'invoke').click(); await expect(node(page, 'review')).toBeVisible()
          verify(observation.attempts === 1 && observation.inputDigests[0] === row.inputDigest && observation.windowDigests[0] === row.sourceHash); mark('exact_sdk_invocation')
          verify(await node(page, 'claims').locator('li').count() === 1 && (await node(page, 'unresolved').textContent()).includes('unmapped_topic') && (await node(page, 'semantic-boundary').textContent()).includes('not_reviewed')); mark('readonly_unresolved')
          await context.close(); context = null; page = await launch(profile, '/app/#/campaigns')
          await expect(campaign(`select-${campaignId}`)).toBeVisible(); await campaign(`select-${campaignId}`).click(); await expect(node(page, 'identity')).toBeVisible()
          await expect(campaign('inspection')).toHaveCount(0); await expect(node(page, 'requests').locator('[data-testid^="body-producer-request-"]')).toHaveCount(1)
          await node(page, 'requests').locator('[data-testid^="body-producer-recover-"]').click(); await expect(node(page, 'review')).toBeVisible(); verify(observation.attempts === 1); mark('cold_reload_no_dispatch')
          await node(page, 'chapter').selectOption('3'); await node(page, 'prepare').click(); await expect(node(page, 'prepared')).toBeVisible()
          holdNext = true; await node(page, 'invoke').click(); await expect.poll(() => observation.attempts).toBe(2); verify(held !== null)
          await page.getByRole('link', { name: '← 返回 LLM-Writer', exact: true }).click(); await expect(campaign('lab')).toHaveCount(0); await expect(campaign('navigation')).toBeVisible(); await expect(node(page, 'review')).toHaveCount(0)
          const lateAppReply = held; held = null; lateAppReply()
          await expect.poll(() => page.evaluate(async ({ moduleUrl, campaignId }) => {
            try { const value = await (await import(moduleUrl)).producerCampaignObservation(campaignId); return value.latestStatus }
            catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'conflict') return 'read_conflict'; throw error }
          }, { moduleUrl, campaignId })).toBe('outcome_unknown')
          await campaign('navigation').click(); await expect(campaign(`select-${campaignId}`)).toBeVisible(); await campaign(`select-${campaignId}`).click(); await expect(node(page, 'identity')).toBeVisible()
          await expect(node(page, 'requests').locator('[data-testid^="body-producer-request-"]')).toHaveCount(2); await expect(node(page, 'review')).toHaveCount(0)
          await node(page, 'requests').locator('[data-testid^="body-producer-recover-"]').last().click()
          await expect(node(page, 'requests').locator('[data-testid^="body-producer-request-"]').last()).toContainText('outcome_unknown'); await expect(node(page, 'unknown-count')).toContainText('1'); await expect(node(page, 'review')).toHaveCount(0)
          await context.close(); context = null; page = await launch(profile, '/app/#/campaigns'); await expect(campaign(`select-${campaignId}`)).toBeVisible(); await campaign(`select-${campaignId}`).click(); await expect(node(page, 'identity')).toBeVisible()
          await expect(node(page, 'requests').locator('[data-testid^="body-producer-request-"]')).toHaveCount(2); await expect(node(page, 'unknown-count')).toContainText('1'); await expect(node(page, 'review')).toHaveCount(0)
          verify(observation.attempts === 2); row.unknownRequests = 1; mark('navigation_no_replay')
          row.httpAttempts = observation.attempts; verify(observation.errors === 0 && row.browserErrors === 0); row.status = 'pass'
        } catch (error) { row.status = 'failed'; row.refusalCode = safeProducerCode(error); const unfinished = row.checks.find(check => check.status !== 'pass'); if (unfinished) unfinished.status = 'fail'; row.httpAttempts = observation.attempts }
        finally { if (context) { try { await verificationControl('release') } catch { /* Closing the context discards only ephemeral test control. */ } }; if (held) { const release = held; held = null; release() }; if (context) { await context.close(); context = null }; await persist() }
        if (row.status !== 'pass') break
      }
    }
    report.teardown = 'pass'
  } catch (error) { failActive(); report.teardown = 'fail'; console.error(JSON.stringify({ suite: 'body-producer-browser', code: safeProducerCode(error) })) }
  finally {
    if (held) { const release = held; held = null; release() }
    if (context) await context.close().catch(() => { report.teardown = 'fail' })
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    report.sourceStable = await producerIdentityMatches(root, report.source) ? 'verified' : 'changed'; await persist(); process.exitCode = producerReportExitCode(report)
  }
}
main().catch(() => { console.error(JSON.stringify({ suite: 'body-producer-browser', code: 'setup_failed' })); process.exitCode = 1 })
