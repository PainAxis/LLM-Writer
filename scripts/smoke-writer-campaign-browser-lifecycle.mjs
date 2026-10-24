/** Pure Node regressions for browser-runner helpers. No browser launch or app mutation. */
import assert from 'node:assert/strict'
import process from 'node:process'
import { readFile } from 'node:fs/promises'
import { CAMPAIGN_BROWSER_CASE_IDS, CAMPAIGN_PAGE_ERROR_CATEGORIES, isCampaignBrowserFailureStage, classifyCampaignPageError, recordCampaignPageError } from './lib/writer-campaign-browser-diagnostics.mjs'
import { ordinaryStorageProjection, waitForFreshCampaignReload } from './fixtures/writer-campaign-browser-lifecycle.mjs'

async function checkReload(nextIdentity, shouldPass) {
  const calls = [], original = { timeOrigin: 10, documentId: 'old-document' }
  let identity = original, deliver
  const page = {
    async evaluate() { calls.push('identity'); return { ...identity } },
    waitForEvent(event) {
      assert.equal(event, 'load'); calls.push('listener')
      return new Promise(resolve => { deliver = resolve })
    },
  }
  const click = async () => {
    calls.push('click')
    assert.equal(typeof deliver, 'function', 'Listener must be armed before the click')
    identity = nextIdentity
    queueMicrotask(() => deliver())
  }
  if (shouldPass) await waitForFreshCampaignReload(page, click)
  else await assert.rejects(waitForFreshCampaignReload(page, click), /reload_document_unchanged/)
  assert.deepEqual(calls, ['identity', 'listener', 'click', 'identity'])
}

try {
  await checkReload({ timeOrigin: 20, documentId: 'new-document' }, true)
  await checkReload({ timeOrigin: 10, documentId: 'old-document' }, false)
  await checkReload({ timeOrigin: 20, documentId: 'old-document' }, false)
  await checkReload({ timeOrigin: 10, documentId: 'new-document' }, false)
  const input = { idb: { 'writer-campaign:catalog': 'excluded', 'writer-campaign:one:head': 'excluded',
    'novel:one': 'novel', 'memory-fact-graph:one': 'graph', 'unregistered-manual-key': 'preserve-me' },
  local: { novels: 'novels', apiConfig: 'config', prompts: 'prompts', customModels: 'models',
    assistantConversations: 'conversations', billing_records: 'billing', 'unregistered-local-key': 'also-preserve',
    'writer-campaign:unexpected-local': 'must-be-detected' } }
  const projected = ordinaryStorageProjection(input)
  assert.deepEqual(projected.idb, { 'novel:one': 'novel', 'memory-fact-graph:one': 'graph', 'unregistered-manual-key': 'preserve-me' })
  assert.deepEqual(projected.local, input.local)
  assert.notEqual(projected.local, input.local)
  assert.equal(Object.keys(input.idb).length, 5)
  for (const [name, category] of [['InvalidStateError', 'invalid_state'], ['AbortError', 'abort'], ['TransactionInactiveError', 'transaction_inactive'], ['ReferenceError', 'reference'], ['TypeError', 'type'], ['SyntaxError', 'syntax'], ['Error', 'other']]) {
    const result = classifyCampaignPageError({ name, message: 'private-source-canary', stack: 'private-stack-canary' })
    assert.deepEqual(Object.keys(result).sort(), ['category', 'sha256']); assert.equal(result.category, category)
    assert.ok(CAMPAIGN_PAGE_ERROR_CATEGORIES.includes(result.category)); assert.match(result.sha256, /^[a-f0-9]{64}$/)
    assert.ok(!JSON.stringify(result).includes('private'))
  }
  assert.deepEqual(classifyCampaignPageError({ name: 'Error', message: 'a'.repeat(8192) + 'secret-tail-1' }),
    classifyCampaignPageError({ name: 'Error', message: 'a'.repeat(8192) + 'secret-tail-2' }))
  const report = { browserErrors: 0, pageErrorDiagnostics: [], pageErrorOverflow: 0 }
  const owner = { id: 'C08', status: 'pass', failureStage: null, browserErrors: 0 }
  for (let n = 0; n < 40; n++) recordCampaignPageError(report, owner, { name: 'InvalidStateError', message: 'synthetic-only' })
  assert.equal(owner.status, 'fail'); assert.equal(owner.failureStage, 'page_errors'); assert.equal(owner.browserErrors, 40)
  assert.equal(report.browserErrors, 40); assert.equal(report.pageErrorDiagnostics.length, 32); assert.equal(report.pageErrorOverflow, 8)
  assert.ok(report.pageErrorDiagnostics.every(item => item.caseId === 'C08' && item.category === 'invalid_state'))
  recordCampaignPageError(report, null, { name: 'Error', message: 'unattributed' })
  assert.equal(report.browserErrors, 41); assert.equal(report.pageErrorDiagnostics.length + report.pageErrorOverflow, report.browserErrors)
  assert.equal(owner.browserErrors, 40)
  const harness = await readFile(new URL('./browser-writer-campaign.mjs', import.meta.url), 'utf8')
  for (const id of CAMPAIGN_BROWSER_CASE_IDS) {
    const start = harness.indexOf(`test('${id}', async () => {`), end = harness.indexOf('\n})', start)
    assert.ok(start >= 0 && end > start)
    for (const match of harness.slice(start, end).matchAll(/stage\('([^']+)'\)/g)) assert.ok(isCampaignBrowserFailureStage(id, match[1]))
  }
  process.stdout.write('Campaign browser helpers: reload ordering, full ordinary projection and closed source-free diagnostic stages passed.\n')
} catch {
  process.stderr.write('Campaign browser helpers: 1 suite failed (lifecycle_projection_assertion_failed).\n')
  process.exitCode = 1
}
