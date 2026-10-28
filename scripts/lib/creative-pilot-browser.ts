/** Real built-App driver; never launches a browser or inserts an artifact. Private
 * native snapshots cross automation only for independent checks, never reports. */
import type { Page } from '@playwright/test'
import type { CreativeSnapshot } from '../../src/types/creativePilot'
import type { ControlBrief } from './creative-pilot-briefs'
import type { CreativeControlMode, CreativeHttpObservation } from './creative-pilot-control'
import type { CreativeControlRow, CreativeMetrics, CreativePositiveRow } from './creative-pilot-report'
import type { CreativeAppSnapshot } from './creative-pilot-app'
import { safeCreativeCode } from './creative-pilot-report'
import { CREATIVE_TASK_IDS } from './creative-pilot-registry'
import { canonicalOracle, controlAssert, storageCounterOracle } from './creative-pilot-oracles'
import { fillCreativePositive, verifyCreativeFinalFence } from './creative-pilot-runner'

type Helper = typeof import('./creative-pilot-app')
interface Common {
  page: Page; brief: ControlBrief; controlModuleUrl: string
  readHttp(): Promise<CreativeHttpObservation>; setMode(mode: CreativeControlMode): Promise<void>
  releaseHttp(): Promise<void>; reopen(): Promise<Page>; persist(): Promise<void>
  captureFailure(value: { caseId: string; campaignId: string | null; rows: Array<[string, string]> | null; observation: 'unconfirmed' }): Promise<void>
}
const by = (page: Page, id: string) => page.getByTestId(`creative-pilot-${id}`)
const failureCode = (error: unknown) => error instanceof Error && error.name === 'TimeoutError' ? 'operation_timeout' : safeCreativeCode(error)
export function recordCreativeAppFailure(row: CreativePositiveRow | null, error: unknown): void {
  if (!row || row.status === 'pass' || row.errorCode !== null) return
  row.errorCode = failureCode(error)
  row.status = ['deadline_exceeded', 'operation_timeout'].includes(row.errorCode) ? 'timeout' : 'failed'
}
const campaignRoute = (page: Page) => { const url = new URL(page.url()); url.hash = '/campaigns'; return url.href }
function decode(value: CreativeAppSnapshot): CreativeSnapshot { return { ...value, artifacts: new Map(value.artifacts), requests: new Map(value.requests), phases: new Map(value.phases), responses: new Map(value.responses) } }
function delta(http: CreativeHttpObservation, before: CreativeHttpObservation): CreativeHttpObservation {
  return { activeRequests: http.activeRequests, maxActiveRequests: http.maxActiveRequests,
    attempts: http.attempts - before.attempts, errors: http.errors - before.errors, blockedExternalRequests: http.blockedExternalRequests - before.blockedExternalRequests, records: http.records.slice(before.records.length) }
}
async function helperMetrics(page: Page, url: string) { return page.evaluate(async url => (await import(url) as Helper).observeCreativeAppMetrics(), url) }
export async function navigateCreativeHostProbe(page: Page) {
  const markerUrl = new URL(page.url()); markerUrl.searchParams.set('creativePilotOffline', '1')
  // The normal page is reused across languages. Navigating to its identical
  // hash URL can stay in-document; host separation requires a fresh App mount.
  if (markerUrl.href === page.url()) await page.reload()
  else await page.goto(markerUrl.href)
}
export async function waitForCreativeIoState(page: Page, url: string, state: 'held' | 'drained') {
  // waitForFunction polls truthiness synchronously: an async predicate is a
  // truthy Promise even when it resolves false. Import first, then poll values.
  const helper = await page.evaluateHandle(async url => await import(url) as Helper, url)
  try {
    await page.waitForFunction(({ helper, state }) => {
      const s = helper.observeCreativeIoHold()
      return state === 'held' ? s.held : !s.held && s.activeRepositoryOperations === 0 && s.activeIoOperations === 0 && s.pendingRequestOutcomes === 0
    }, { helper, state }, { timeout: 65000 })
  } finally { await helper.dispose() }
}
async function drain(page: Page, url: string) {
  await waitForCreativeIoState(page, url, 'drained')
  await page.waitForFunction(() => document.querySelector('[data-testid="creative-pilot-panel"]')?.getAttribute('aria-busy') !== 'true', undefined, { timeout: 65000 })
}
async function evidence(page: Page, url: string, id: string) {
  await drain(page, url)
  const found = await page.evaluate(async ({ url, id }) => (await import(url) as Helper).readCreativeAppEvidence(id), { url, id })
  const snapshot = decode(found.snapshot), rows = new Map(found.rows), trace = found.trace.map(batch => ({ keys: batch.keys, rows: new Map(batch.rows) }))
  const fence = verifyCreativeFinalFence(rows, id, trace)
  controlAssert(fence && !found.traceOverlap)
  return { ...found, snapshot, rows, fence }
}
async function selectedId(page: Page): Promise<string> {
  const marker = await page.locator('[data-testid^="campaign-select-"][aria-pressed="true"]').getAttribute('data-testid')
  controlAssert(marker && marker.startsWith('campaign-select-')); return marker.slice('campaign-select-'.length)
}
async function prepare(page: Page, brief: ControlBrief, helperUrl?: string): Promise<string> {
  await by(page, 'new-draft').click(); await by(page, 'language').selectOption(brief.language)
  await by(page, 'premise').fill(brief.premise); await by(page, 'constraints').fill(JSON.stringify(brief.constraints))
  await by(page, 'prepare').click()
  await page.waitForFunction(() => {
    const selected = document.querySelector('[data-testid^="campaign-select-"][aria-pressed="true"]')?.getAttribute('data-testid')?.slice('campaign-select-'.length)
    const identity = document.querySelector('[data-testid="creative-pilot-identity"]')
    return selected && identity?.textContent?.includes(selected) && document.querySelector('[data-testid="creative-pilot-panel"]')?.getAttribute('aria-busy') !== 'true'
  }, undefined, { timeout: 14000 })
  if (helperUrl) await drain(page, helperUrl)
  return selectedId(page)
}
async function select(page: Page, id: string, url: string) {
  await page.getByTestId(`campaign-select-${id}`).click(); await by(page, 'identity').waitFor(); await drain(page, url)
  controlAssert(await selectedId(page) === id)
}
async function grant(page: Page) {
  await by(page, 'dry-prepare').click(); await by(page, 'preview').waitFor()
  controlAssert(await by(page, 'start').isDisabled() && await by(page, 'resume').isDisabled())
  await by(page, 'consent').locator('input').check()
}
async function forceDuplicate(page: Page) {
  for (const name of ['start', 'resume']) await by(page, name).evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}
async function waitHttp(input: Common, before: number, amount = 1) {
  const end = Date.now() + 10000
  while (Date.now() < end) { const value = await input.readHttp(); if (value.attempts >= before + amount) { controlAssert(value.attempts === before + amount); return }; await new Promise(resolve => setTimeout(resolve, 10)) }
  throw Object.assign(new Error('operation_timeout'), { code: 'operation_timeout' })
}
async function ordinary(page: Page, url: string) { return page.evaluate(async url => (await import(url) as Helper).readCreativeOrdinaryDigest(), url) }
async function captureFailure(input: Common, page: Page, caseId: string, campaignId: string | null) {
  let rows: Array<[string, string]> | null = null
  try { rows = await page.evaluate(async ({ url, id }) => (await import(url) as Helper).readCreativeFailureRows(id), { url: input.controlModuleUrl, id: campaignId }) } catch { /* The private marker records an unavailable map, not a fabricated snapshot. */ }
  await input.captureFailure({ caseId, campaignId, rows, observation: 'unconfirmed' })
}
function mergeMetrics(row: CreativePositiveRow, value: CreativeMetrics, previous: CreativeMetrics | null) {
  for (const key of ['readCalls', 'readBytes', 'casCalls', 'successfulCas', 'accountingMismatches'] as const) {
    controlAssert(value[key] >= (previous?.[key] ?? 0)); row.metrics[key] += value[key] - (previous?.[key] ?? 0)
  }
  for (const key of ['maxReadBatchKeys', 'maxReadBatchBytes', 'maxRawIoMs', 'maxCasMs', 'maxRepositoryActionMs', 'maxVerifiedReadMs', 'maxStageMs', 'maxSdkMs'] as const) row.metrics[key] = Math.max(row.metrics[key], value[key])
  row.metrics.activeOwners = value.activeOwners; row.metrics.activeCalls = value.activeCalls
}
async function verifyReadout(page: Page, snapshot: CreativeSnapshot) {
  controlAssert(await by(page, 'artifact').count() === 9 && await by(page, 'response').count() === 9)
  for (const artifact of snapshot.artifacts.values()) {
    const item = page.locator(`[data-testid="creative-pilot-artifact"][data-task="${artifact.taskId}"]`)
    controlAssert(await item.locator('pre').textContent() === artifact.text)
    controlAssert((await item.textContent())?.includes(artifact.hash) && (await item.textContent())?.includes(artifact.responseHash))
    controlAssert(await item.locator('input,textarea,[contenteditable="true"],pre script,pre img').count() === 0)
    const metrics = await item.getByTestId('creative-pilot-artifact-metrics').textContent()
    controlAssert(metrics?.includes(`${artifact.raw.utf8Bytes} UTF-8`) && metrics.includes(`${artifact.canonical.scalars} scalars`))
  }
  for (const response of snapshot.responses.values()) {
    const item = page.locator(`[data-testid="creative-pilot-response"][data-request-hash="${response.requestHash}"]`)
    controlAssert(await item.locator('pre').last().textContent() === response.textJson)
  }
}
export async function runCreativeAppJourney(input: Common & { row: CreativePositiveRow; normalPage: Page }): Promise<{ page: Page; campaignId: string }> {
  let page = input.page, id = '', normalId = '', last: Awaited<ReturnType<typeof evidence>> | null = null
  let sampledMetrics: CreativeMetrics | null = null
  let failureCaptured = false
  const row = input.row, before = await input.readHttp(), started = performance.now()
  const begin = async (id: string) => { row.activeCheck = id; await input.persist() }, pass = async (id: string) => { row.checks.find(c => c.id === id)!.status = 'pass'; await input.persist() }
  row.status = 'running'
  try {
    await begin('real_app_route'); await page.getByTestId('campaign-lab').waitFor(); await by(page, 'panel').waitFor()
    controlAssert(new URL(page.url()).hash === '#/campaigns'); row.beforeOrdinaryHash = await ordinary(page, input.controlModuleUrl); await pass('real_app_route')
    await begin('brief_persisted'); id = await prepare(page, input.brief, input.controlModuleUrl); last = await evidence(page, input.controlModuleUrl, id)
    controlAssert(canonicalOracle(last.snapshot.candidate.brief) === canonicalOracle(input.brief)); controlAssert(await by(page, 'premise').inputValue() === input.brief.premise); await pass('brief_persisted')
    await begin('explicit_disclosure'); await by(page, 'dry-prepare').click(); await by(page, 'preview').waitFor()
    controlAssert(await by(page, 'start').isDisabled()); controlAssert((await by(page, 'consent').textContent())?.includes('九任务'))
    const shown = await by(page, 'exact-input').locator('pre').allTextContents(); controlAssert(shown.length === 2 && JSON.parse(shown[1]!).brief.premise === input.brief.premise)
    controlAssert((await by(page, 'budgets').textContent())?.includes('36,864')); await pass('explicit_disclosure')
    await begin('unconfigured_grant'); normalId = await prepare(input.normalPage, input.brief); await by(input.normalPage, 'dry-prepare').click(); await by(input.normalPage, 'preview').waitFor()
    controlAssert((await by(input.normalPage, 'readiness').textContent())?.includes('unconfigured')); await by(input.normalPage, 'consent').locator('input').check()
    controlAssert(await by(input.normalPage, 'start').isDisabled()); controlAssert((await input.readHttp()).attempts === before.attempts)
    await by(page, 'consent').locator('input').check(); controlAssert(await by(page, 'start').isEnabled()); await pass('unconfigured_grant')
    await begin('actual_sdk_wire'); await input.setMode('normal'); await by(page, 'start').click(); await forceDuplicate(page)
    await page.locator('[data-testid="creative-pilot-status"][data-status="completed"]').waitFor({ timeout: 610000 })
    last = await evidence(page, input.controlModuleUrl, id); const http = delta(await input.readHttp(), before)
    controlAssert(http.attempts === 9 && http.errors === 0 && http.blockedExternalRequests === 0 && http.activeRequests === 0 && http.maxActiveRequests === 1)
    await fillCreativePositive(row, last.snapshot, http, last.rows); await pass('actual_sdk_wire')
    await begin('six_plan_barrier'); controlAssert(canonicalOracle(http.records.map(r => r.taskId)) === canonicalOracle([...CREATIVE_TASK_IDS]))
    const firstBody = [...last.snapshot.requests.values()].find(r => r.taskId === 'b-1')!
    controlAssert(firstBody.dependencies.length === 6 && firstBody.dependencies.every(r => !r.taskId.startsWith('b-'))); await pass('six_plan_barrier')
    await begin('raw_compiled_binding'); await verifyReadout(page, last.snapshot); await pass('raw_compiled_binding')
    await begin('complete_body_prefix'); for (const n of [2, 3]) { const request = [...last.snapshot.requests.values()].find(r => r.taskId === `b-${n}`)!
      controlAssert(request.prepared.previousBodies.length === n - 1)
      for (const [index, prior] of request.prepared.previousBodies.entries()) { const artifact = [...last.snapshot.artifacts.values()].find(a => a.taskId === `b-${index + 1}`)!; controlAssert(prior.text === artifact.text && prior.source.hash === artifact.hash) }
    }; await pass('complete_body_prefix')
    await begin('honest_body_counts'); controlAssert((await by(page, 'counts').textContent())?.includes(`${last.snapshot.checkpoint.bodyCharacters} canonical body scalars`)); controlAssert((await by(page, 'panel').textContent())?.includes('512 canonical')); await pass('honest_body_counts')
    await begin('durable_states'); for (const task of CREATIVE_TASK_IDS) controlAssert(await by(page, `task-${task}`).getAttribute('data-status') === 'accepted')
    controlAssert(row.obligations.length === 9 && row.obligations.every(o => o.status === 'resolved' && o.outstandingBytes === 0)); await pass('durable_states')
    await begin('duplicate_authority'); await forceDuplicate(page); await drain(page, input.controlModuleUrl); controlAssert((await input.readHttp()).attempts === before.attempts + 9)
    controlAssert(await by(page, 'start').isDisabled() && await by(page, 'resume').isDisabled()); await pass('duplicate_authority')
    mergeMetrics(row, last.metrics, sampledMetrics); sampledMetrics = last.metrics; const oldHash = last.snapshot.head.checkpointHash
    await begin('cold_reopen'); page = await input.reopen(); sampledMetrics = null; await page.getByTestId('campaign-lab').waitFor(); await select(page, id, input.controlModuleUrl)
    last = await evidence(page, input.controlModuleUrl, id); controlAssert(last.snapshot.head.checkpointHash === oldHash && (await input.readHttp()).attempts === before.attempts + 9)
    row.coldReopen = 'pass'; await pass('cold_reopen')
    await begin('readonly_provenance'); await verifyReadout(page, last.snapshot); await pass('readonly_provenance')
    await begin('route_no_replay'); const route = campaignRoute(page); await page.locator('.campaign-lab > .back-link').click(); await page.getByTestId('campaign-lab').waitFor({ state: 'detached' })
    await page.goBack(); controlAssert(page.url() === route); await page.getByTestId('campaign-lab').waitFor(); await select(page, id, input.controlModuleUrl)
    controlAssert((await input.readHttp()).attempts === before.attempts + 9); row.afterOrdinaryHash = await ordinary(page, input.controlModuleUrl)
    controlAssert(row.afterOrdinaryHash === row.beforeOrdinaryHash); await pass('route_no_replay')
    await begin('default_host_separation'); controlAssert(await by(input.normalPage, 'start').isDisabled())
    await input.normalPage.evaluate(() => localStorage.setItem('creative-pilot-offline-host', JSON.stringify({ mode: 'offline_control', configurationRevision: 'creative-control-v1' })))
    await navigateCreativeHostProbe(input.normalPage); await input.normalPage.getByTestId(`campaign-select-${normalId}`).click()
    await by(input.normalPage, 'identity').waitFor(); await by(input.normalPage, 'dry-prepare').click(); await by(input.normalPage, 'preview').waitFor()
    controlAssert((await by(input.normalPage, 'readiness').textContent())?.includes('unconfigured'))
    await by(input.normalPage, 'consent').locator('input').check(); controlAssert(await by(input.normalPage, 'start').isDisabled())
    await input.normalPage.evaluate(() => localStorage.removeItem('creative-pilot-offline-host'))
    controlAssert((await input.readHttp()).attempts === before.attempts + 9)
    controlAssert((await by(input.normalPage, 'default-host').textContent())?.includes('默认 App')); const m = await helperMetrics(page, input.controlModuleUrl)
    controlAssert(m.metrics.activeOwners === 0 && m.metrics.activeCalls === 0); await pass('default_host_separation')
    await begin('honest_scope'); const scope = await by(page, 'boundary').textContent(); controlAssert(scope?.includes('NOT_RUN') && scope.includes('Structural acceptance only'))
    controlAssert((await by(page, 'budgets').textContent())?.includes('Not a bill')); await pass('honest_scope')
    last = await evidence(page, input.controlModuleUrl, id); await fillCreativePositive(row, last.snapshot, delta(await input.readHttp(), before), last.rows)
    mergeMetrics(row, last.metrics, sampledMetrics); sampledMetrics = last.metrics
    Object.assign(row.metrics, { finalFenceExpectedKeys: last.fence.keys, finalFenceObservedKeys: last.fence.keys, maxCapturedKeys: last.fence.keys, maxCapturedBytes: last.fence.bytes })
    controlAssert(row.metrics.accountingMismatches === 0 && row.errorCode === null); row.status = 'pass'; row.activeCheck = null
  } catch (error) {
    row.errorCode = failureCode(error); row.status = ['deadline_exceeded', 'operation_timeout'].includes(row.errorCode) ? 'timeout' : 'failed'
    if (row.activeCheck) row.checks.find(c => c.id === row.activeCheck)!.status = 'fail'
    failureCaptured = true; await captureFailure(input, page, row.id, id || null)
    try {
      if (await by(page, 'stop').count()) await by(page, 'stop').click()
      await input.releaseHttp(); await releaseIo(page, input.controlModuleUrl)
      if (id) last = await evidence(page, input.controlModuleUrl, id)
    } catch { /* Preserve the last verified read if the failed owner cannot drain. */ }
    if (last) try { await fillCreativePositive(row, last.snapshot, delta(await input.readHttp(), before), last.rows, false) } catch { /* Preserve existing bounded obligations. */ }
    row.observation = 'unconfirmed'
  } finally {
    // Sampling does not depend on verified evidence succeeding. An observed
    // HTTP attempt or native CAS must survive a failed provenance assertion.
    const http = await input.readHttp(); row.metrics.httpAttempts = http.attempts - before.attempts; row.metrics.activeCalls = http.activeRequests
    try { const observed = await helperMetrics(page, input.controlModuleUrl); mergeMetrics(row, observed.metrics, sampledMetrics); row.metrics.activeCalls = http.activeRequests } catch {
      row.observation = 'unconfirmed'
      if (row.status === 'pass') { row.status = 'failed'; row.errorCode = 'integrity'; row.activeCheck = 'durable_states'; row.checks.find(c => c.id === 'durable_states')!.status = 'fail' }
      if (!failureCaptured) { failureCaptured = true; await captureFailure(input, page, row.id, id || null) }
    }
    row.metrics.runWallMs = performance.now() - started; await input.persist()
  }
  return { page, campaignId: id }
}

function fillControl(row: CreativeControlRow, snapshot: CreativeSnapshot) {
  row.snapshotHash = snapshot.checkpoint.hash; row.receiptHash = snapshot.receipt.hash; row.observation = 'last_verified'
  row.obligations = snapshot.checkpoint.requests.map(index => {
    const request = snapshot.requests.get(index.requestHash)!, phase = snapshot.phases.get(index.phaseHash)!
    return { requestHash: request.hash, phaseHash: phase.hash, status: phase.status, responseHash: phase.responseHash,
      outcome: phase.resolution?.outcome ?? null, resolutionReason: phase.resolution?.reason ?? null, unknownReason: phase.reason,
      outstandingBytes: storageCounterOracle(snapshot.checkpoint.storage.openAllocations.find(a => a.request.id === request.id)?.remainingBytes ?? '0000000000000000') }
  })
  row.unknownReason = row.obligations.find(o => o.unknownReason)?.unknownReason ?? null
  row.resolutionReason = row.obligations.find(o => o.resolutionReason)?.resolutionReason ?? null
}
async function arm(page: Page, url: string, mode: 'before_read' | 'after_read', reads: number) {
  await page.evaluate(async ({ url, mode, reads }) => (await import(url) as Helper).armCreativeIoHold(mode, reads), { url, mode, reads })
}
async function armAck(page: Page, url: string, kind: 'dispatch_intent' | 'retain_response') {
  await page.evaluate(async ({ url, kind }) => (await import(url) as Helper).armCreativeCommitAckHold(kind), { url, kind })
}
async function held(page: Page, url: string) {
  await waitForCreativeIoState(page, url, 'held')
}
async function releaseIo(page: Page, url: string) { await page.evaluate(async url => (await import(url) as Helper).releaseCreativeIoHold(), url) }
async function inspect(page: Page, id: string, url: string) {
  await drain(page, url); await by(page, 'refresh').click(); await drain(page, url); return evidence(page, url, id)
}
export async function runCreativeAppInterruptions(input: Common & { rows: CreativeControlRow[] }): Promise<{ page: Page }> {
  let page = input.page
  const completedId = await selectedId(page)
  controlAssert(input.rows.length === 8 && input.rows.every((row, index) => row.id === `${input.brief.language}:I${String(index + 1).padStart(2, '0')}`))
  for (const row of input.rows) {
    let id = completedId, last: Awaited<ReturnType<typeof evidence>> | null = null, exerciseAt = await input.readHttp(), recoveryAt: CreativeHttpObservation | null = null
    const before = exerciseAt, initialCas = (await page.evaluate(async url => (await import(url) as Helper).observeCreativeIoHold(), input.controlModuleUrl)).successfulCas
    let previousProcessCas = 0, processBaselineCas = initialCas
    const check = (condition: unknown) => { controlAssert(condition); row.assertions++ }
    const reopen = async () => {
      previousProcessCas += (await page.evaluate(async url => (await import(url) as Helper).observeCreativeIoHold(), input.controlModuleUrl)).successfulCas - processBaselineCas
      page = await input.reopen(); processBaselineCas = 0; await page.getByTestId('campaign-lab').waitFor(); await select(page, id, input.controlModuleUrl)
    }
    row.status = 'running'; row.activeCheck = row.id; await input.persist()
    try {
      const n = Number(row.id.slice(-2)); await input.setMode('normal')
      if (n <= 2) {
        await select(page, completedId, input.controlModuleUrl); last = await evidence(page, input.controlModuleUrl, completedId)
        check(last.snapshot.checkpoint.status === 'completed'); const oldHash = last.snapshot.checkpoint.hash
        const readsBefore = (await page.evaluate(async url => (await import(url) as Helper).observeCreativeIoHold(), input.controlModuleUrl)).readCalls
        await arm(page, input.controlModuleUrl, n === 1 ? 'before_read' : 'after_read', n === 1 ? 4 : 1)
        await by(page, 'refresh').click(); await held(page, input.controlModuleUrl)
        const waiting = await page.evaluate(async url => (await import(url) as Helper).observeCreativeIoHold(), input.controlModuleUrl)
        check(waiting.activeIoOperations > 0 && waiting.activeRepositoryOperations > 0)
        check(waiting.readCalls - readsBefore >= (n === 1 ? 3 : 1))
        await by(page, 'stop').click(); check((await by(page, 'notice').textContent())?.includes('权限已撤销'))
        await releaseIo(page, input.controlModuleUrl); await drain(page, input.controlModuleUrl)
        check(await by(page, 'start').isDisabled()); check(await by(page, 'preview').count() === 0)
        last = await inspect(page, completedId, input.controlModuleUrl); check(last.snapshot.checkpoint.hash === oldHash)
        check((await input.readHttp()).attempts === before.attempts)
      } else {
        id = await prepare(page, input.brief, input.controlModuleUrl)
        if (n === 8) {
          // Exercise the genuine one-time author replacement through the App,
          // before testing that a spent grant cannot be reset again.
          const replacement = input.brief.language === 'zh' ? '新的作者要求：改变这次抉择。' : 'A revised author brief: change this decision.'
          await by(page, 'premise').fill(replacement); await by(page, 'constraints').fill('[]')
          await by(page, 'replace-preview').click(); await by(page, 'replace-commit').click(); await drain(page, input.controlModuleUrl)
          last = await evidence(page, input.controlModuleUrl, id)
          check(last.snapshot.candidate.brief.premise === replacement && last.snapshot.candidate.brief.constraints.length === 0)
          check(last.snapshot.checkpoint.metadata.replacementUsed && last.snapshot.checkpoint.budget.attempts === 0)
        }
        await grant(page)
        exerciseAt = await input.readHttp(); row.setupHttpAttempts = exerciseAt.attempts - before.attempts
        if (n === 3 || n === 6) {
          await armAck(page, input.controlModuleUrl, n === 3 ? 'dispatch_intent' : 'retain_response')
          await by(page, 'start').click(); await held(page, input.controlModuleUrl)
          check((await input.readHttp()).attempts - exerciseAt.attempts === (n === 3 ? 0 : 1))
          // A process close discards the pending JS acknowledgement without changing
          // committed bytes. This is not a fabricated prefix or open transaction.
          await reopen(); last = await evidence(page, input.controlModuleUrl, id)
          const only = last.snapshot.checkpoint.requests[0]!, phase = last.snapshot.phases.get(only.phaseHash)!
          check(last.snapshot.checkpoint.budget.attempts === 1 && last.snapshot.artifacts.size === 0)
          if (n === 3) {
            check(['dispatch_intent', 'outcome_unknown'].includes(phase.status)); check(await by(page, 'unknown').count() === 1)
            await forceDuplicate(page); check((await input.readHttp()).attempts === exerciseAt.attempts)
            check(await by(page, 'start').isDisabled() && await by(page, 'resume').isDisabled())
          } else {
            check(phase.status === 'response_retained' && last.snapshot.responses.size === 1)
            recoveryAt = await input.readHttp(); await by(page, 'resolve-retained').click(); await drain(page, input.controlModuleUrl)
            last = await evidence(page, input.controlModuleUrl, id)
            check(last.snapshot.artifacts.size === 1 && last.snapshot.checkpoint.tasks.filter(t => t.status === 'accepted').length === 1)
            check((await input.readHttp()).attempts === recoveryAt.attempts)
            check(await by(page, 'resume').isDisabled() && await by(page, 'preview').count() === 0)
          }
        } else {
          await input.setMode('hold'); await by(page, 'start').click(); await waitHttp(input, exerciseAt.attempts)
          if (n === 5) {
            await page.locator('.campaign-lab > .back-link').click(); await page.getByTestId('campaign-lab').waitFor({ state: 'detached' })
            await input.releaseHttp(); await drain(page, input.controlModuleUrl)
            await page.goBack(); await page.getByTestId('campaign-lab').waitFor(); await select(page, id, input.controlModuleUrl)
          } else if (n === 7) {
            await page.evaluate(async url => (await import(url) as Helper).revokeCreativeControlHost(), input.controlModuleUrl)
            await input.releaseHttp(); await drain(page, input.controlModuleUrl)
          } else {
            if (n === 8) await forceDuplicate(page)
            await by(page, 'stop').click(); await input.releaseHttp(); await drain(page, input.controlModuleUrl)
          }
          last = await inspect(page, id, input.controlModuleUrl)
          check(last.snapshot.checkpoint.budget.attempts === 1 && last.snapshot.artifacts.size === 0)
          check((await input.readHttp()).attempts === exerciseAt.attempts + 1)
          check(await by(page, 'preview').count() === 0 && await by(page, 'start').isDisabled())
          if (n === 7 || n === 8) check(await by(page, 'replace-preview').isDisabled())
          if (n === 8) {
            const candidate = last.snapshot.candidate.hash, old = await by(page, 'premise').inputValue()
            await by(page, 'premise').evaluate(field => { (field as HTMLTextAreaElement).value = 'Forbidden fresh graph'; field.dispatchEvent(new Event('input', { bubbles: true })) })
            check(await by(page, 'premise').inputValue() === old)
            await by(page, 'replace-preview').evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
            await forceDuplicate(page); last = await evidence(page, input.controlModuleUrl, id)
            check(last.snapshot.candidate.hash === candidate && last.snapshot.checkpoint.budget.attempts === 1)
            check((await input.readHttp()).attempts === exerciseAt.attempts + 1)
            check((await by(page, 'replacement-refused').textContent())?.includes('replacement_after_reservation'))
          }
          if (n === 7) await reopen() // A fresh process restores only the explicit test configuration, never a stored execution grant.
        }
      }
      check(last !== null); fillControl(row, last!.snapshot)
      const http = await input.readHttp()
      row.exerciseHttpAttempts = (recoveryAt ?? http).attempts - exerciseAt.attempts; row.recoveryHttpAttempts = recoveryAt ? http.attempts - recoveryAt.attempts : 0
      check(row.setupHttpAttempts === 0 && row.recoveryHttpAttempts === 0 && row.exerciseHttpAttempts <= 1)
      check(http.activeRequests === 0 && http.maxActiveRequests <= 1)
      const state = await page.evaluate(async url => (await import(url) as Helper).observeCreativeIoHold(), input.controlModuleUrl)
      check(state.activeRepositoryOperations === 0 && state.activeIoOperations === 0 && !state.held && state.pendingRequestOutcomes === 0)
      row.successfulCas = previousProcessCas + state.successfulCas - processBaselineCas
      check(row.errorCode === null); row.status = 'pass'; await input.persist()
    } catch (error) {
      row.errorCode = failureCode(error); row.status = ['deadline_exceeded', 'operation_timeout'].includes(row.errorCode) ? 'timeout' : 'failed'
      await captureFailure(input, page, row.id, id || null)
      try {
        if (await by(page, 'stop').count()) await by(page, 'stop').click()
        await input.releaseHttp(); await releaseIo(page, input.controlModuleUrl); last = await evidence(page, input.controlModuleUrl, id)
      } catch { /* Preserve the last verified observation, never replay invocation. */ }
      if (last) fillControl(row, last.snapshot); row.observation = 'unconfirmed'
      const http = await input.readHttp(); row.exerciseHttpAttempts = Math.max(0, (recoveryAt ?? http).attempts - exerciseAt.attempts); row.recoveryHttpAttempts = recoveryAt ? http.attempts - recoveryAt.attempts : 0
      await input.persist()
      // Preserve this exact failed row and stop: no same-profile rerun masks it.
      try { await input.releaseHttp(); await releaseIo(page, input.controlModuleUrl) } catch { /* Closed process remains an observed interruption. */ }
      return { page }
    } finally {
      const http = await input.readHttp()
      row.exerciseHttpAttempts = Math.max(0, (recoveryAt ?? http).attempts - exerciseAt.attempts)
      row.recoveryHttpAttempts = recoveryAt ? http.attempts - recoveryAt.attempts : 0
      try {
        const state = await page.evaluate(async url => (await import(url) as Helper).observeCreativeIoHold(), input.controlModuleUrl)
        row.successfulCas = previousProcessCas + state.successfulCas - processBaselineCas
      } catch { row.successfulCas = Math.max(row.successfulCas, previousProcessCas); row.observation = 'unconfirmed' }
      await input.persist()
    }
  }
  return { page }
}
