/** Report schema and failure semantics only; this suite launches no browser or profile. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { emptyProducerReport, producerBudgetRefusal, producerProfileChecks, producerReportExitCode, safeProducerCode, safeProducerReason, validateProducerReport, type ProducerReport } from './fixtures/writer-body-producer-report'
import { producerAppBuildOptions } from './fixtures/writer-body-producer-build.mjs'
import { forwardProducerProofCapabilities } from './fixtures/writer-body-producer-profile'
const source = { commit: null, tree: null, coreSha256: 'a'.repeat(64), harnessSha256: 'b'.repeat(64), uiSha256: 'c'.repeat(64), fixtureSha256: 'd'.repeat(64), buildSha256: 'e'.repeat(64) }
let checks = 0
const test = (name: string, action: () => void) => { action(); checks++; console.log(`PASS ${name}`) }
function pass(execution: 'node' | 'browser'): ProducerReport {
  const report = emptyProducerReport(source, execution); report.sourceStable = 'verified'; report.teardown = 'pass'
  for (const row of report.profiles.filter(row => row.platform === (execution === 'node' ? 'node' : 'native'))) {
    row.status = 'pass'; row.checks.forEach(check => { check.status = 'pass' }); row.checkpointHash = '1'.repeat(64); row.inputDigest = '2'.repeat(64); row.sourceHash = '3'.repeat(64); row.packetDigest = '4'.repeat(64); row.admissionStop = 'budget_exhausted'
    Object.assign(row.metrics, { committedTasks: 123, legacyAttempts: 123, producerRequests: 3, httpAttempts: 3, sharedAttempts: 126, sharedOperations: 508, sourceEpoch: 1, writtenBytes: 20_000_000, outstandingBytes: 0, recoveryBytes: 524_288, maxVerifiedReadMs: 2500, maxRepositoryActionMs: 2700, maxLegacyPreviewMs: 5100, initialProducerReadMs: 2500, adoptionMs: 2500, maxInvokeMs: 25_000, coldReadMs: 2600, setupMs: 400_000, readCalls: 50_000, readBytes: 100_000_000, writeTransactions: 508, accountingMismatches: 0 })
    Object.assign(row.observations.proof, { status: 'collected', v3Mode: 'session_full_raw_fence_then_warm_full_v3_tail_exact_origin', legacyAdmittedScopes: 123, legacyDisposedScopes: 123, legacyColdReplays: 123, legacyExactPasses: 400, legacyPeakRetainedBytes: 10_000_000, legacyPeakRetainedEntries: 1000, v3VerifiedReads: 10 })
    Object.assign(row.observations.producerOriginProof, { status: 'collected', admittedScopes: 10, disposedScopes: 10, coldReplays: 10, exactPasses: 50, peakRetainedBytes: 10_000_000, peakRetainedEntries: 1000, coldMaxMs: 2500, exactMaxMs: 100 })
    Object.assign(row.metrics, { maxVerifiedReadMs: 4300, maxRepositoryActionMs: 4600, initialProducerReadMs: 4200, adoptionMs: 4600, coldReadMs: 4300, maxWarmVerifiedReadMs: 300, maxWarmRepositoryActionMs: 500, maxRawIoWaitMs: 30, maxCasWaitMs: 20, maxLegacyVerifiedReadMs: 2500 })
    row.observations.verification.status = 'collected'
    Object.assign(row.observations.verification.stats, { sessionsStarted: 8, sessionsCompleted: 8, sessionsDisposed: 8, sessionMaxMs: 4200, rawIoCalls: 500, rawIoMaxMs: 40, casCalls: 10, casMaxMs: 20, advances: 1000, maxOperationsPerAdvance: 8, hostYields: 100, synchronousSegmentMaxMs: 100, finalFencePasses: 8, finalFenceMaxMs: 50, finalFenceExpectedRecords: 12_000, finalFenceObservedRecords: 12_000, peakRetainedBytes: 32_000_000, peakRetainedEntries: 1642, peakActivePayloadRecords: 270 })
    Object.assign(row.observations.verification.owners, { metadataOwnersStarted: 7, invocationOwnersStarted: 1, ownersCompleted: 7, ownersRefused: 1, peakActiveOwners: 1, maxMetadataOwnerMs: 5000, maxInvocationOwnerMs: 25_000 })
    row.observations.verification.last = { status: 'completed', progress: { purpose: 'current_v3', stage: 'final_fence', verifiedOperations: 503, verifiedRecords: 1642, capturedBytes: 32_000_000, capturedEntries: 1642, totalOperations: 503 } }
    row.requestObservation = 'last_verified'; row.requests = Array.from({ length: row.metrics.producerRequests }, (_, index) => ({ requestHash: String(index + 1).repeat(64), phaseHash: String(index + 4).repeat(64), status: 'resolved', responseHash: String(index + 7).repeat(64), resolutionOutcome: 'review_ready', resolutionReason: null, phaseReason: null, outstandingBytes: 0 }))
    Object.assign(row.observations.retention, { status: 'collected', maxReadBatchBytes: 800_000, maxReadBatchKeys: 33, liveRecordCount: 2000, liveSerializedBytes: 19_000_000, activePayloadRecords: 270, activeSerializedPayloadBytes: 700_000 })
    row.observations.heap = { status: 'collected', method: execution === 'node' ? 'node_process_samples' : 'chromium_performance_memory_samples', samples: 3, baselineHeapUsedBytes: 100_000, sampledPeakHeapUsedBytes: 250_000, finalHeapUsedBytes: 150_000 }
    if (execution === 'browser') row.restart = 'pass'
  }
  if (execution === 'browser') { report.builds.native = '5'.repeat(64); report.builds.ui = '6'.repeat(64); report.builds.app = '7'.repeat(64); report.app.forEach(row => { row.status = 'pass'; row.checks.forEach(check => { check.status = 'pass' }); row.httpAttempts = 2; row.unknownRequests = 1; row.verificationProgressEvents = 3; row.cancelledBeforeIo = 1; row.cancelledPendingIoAcknowledgment = 1; row.verificationReloads = 1; row.inputDigest = '8'.repeat(64); row.sourceHash = '9'.repeat(64) }); report.ui.forEach(row => { row.status = 'pass'; row.checks.forEach(check => { check.status = 'pass' }); row.httpAttempts = 3; row.unknownRequests = 2 }) }
  return report
}
test('not_run_is_not_acceptance', () => { const report = emptyProducerReport(source, 'node'); validateProducerReport(report); assert.equal(producerReportExitCode(report), 1) })
test('independent_node_and_browser_denominators', () => { for (const execution of ['node', 'browser'] as const) { const report = pass(execution); validateProducerReport(report); assert.equal(producerReportExitCode(report), 0); assert.ok(report.profiles.filter(row => row.platform !== (execution === 'node' ? 'node' : 'native')).every(row => row.status === 'not_run')) } })
test('runners_cannot_award_other_platform_evidence', () => {
  for (const execution of ['node', 'browser'] as const) {
    const foreignIndex = execution === 'node' ? 2 : 0
    for (const mutate of [(r: ProducerReport) => { r.profiles[foreignIndex]!.status = 'running' }, (r: ProducerReport) => { r.profiles[foreignIndex]!.checks[0]!.status = 'pass' }, (r: ProducerReport) => { r.profiles[foreignIndex]!.metrics.httpAttempts = 1 }, (r: ProducerReport) => { r.profiles[foreignIndex]!.checkpointHash = '1'.repeat(64) }, (r: ProducerReport) => { r.profiles[foreignIndex]!.refusalCode = 'profile_failed' }, (r: ProducerReport) => { r.profiles[foreignIndex]!.restart = 'pass' }, (r: ProducerReport) => { r.profiles[foreignIndex] = structuredClone(pass(execution === 'node' ? 'browser' : 'node').profiles[foreignIndex]!) }]) {
      const report = pass(execution); mutate(report); assert.throws(() => validateProducerReport(report))
    }
  }
  for (const mutate of [(r: ProducerReport) => { r.builds.native = '5'.repeat(64) }, (r: ProducerReport) => { r.builds.ui = '6'.repeat(64) }, (r: ProducerReport) => { r.ui[0]!.status = 'running' }, (r: ProducerReport) => { r.ui[0]!.checks[0]!.status = 'pass' }, (r: ProducerReport) => { r.ui[0]!.httpAttempts = 1 }, (r: ProducerReport) => { r.ui[0]!.unknownRequests = 1 }, (r: ProducerReport) => { r.ui[0]!.browserErrors = 1 }, (r: ProducerReport) => { r.ui[0]!.refusalCode = 'profile_failed' }, (r: ProducerReport) => { r.ui = structuredClone(pass('browser').ui) }, (r: ProducerReport) => { r.builds.app = '7'.repeat(64) }, (r: ProducerReport) => { r.app[0]!.checks[0]!.status = 'pass' }, (r: ProducerReport) => { r.app = structuredClone(pass('browser').app) }]) {
    const report = pass('node'); mutate(report); assert.throws(() => validateProducerReport(report))
  }
})
test('every_unknown_object_key_is_rejected', () => {
  const base = pass('browser'), paths: Array<Array<string | number>> = []
  const collect = (value: unknown, path: Array<string | number>) => { if (value && typeof value === 'object') { if (!Array.isArray(value)) paths.push(path); for (const [key, child] of Object.entries(value)) collect(child, [...path, Array.isArray(value) ? Number(key) : key]) } }
  collect(base, [])
  for (const path of paths) { const poisoned = structuredClone(base) as any; let target = poisoned; for (const key of path) target = target[key]; target.privateSource = 'must-never-publish'; assert.throws(() => validateProducerReport(poisoned)) }
  assert.ok(paths.length > 50)
})
test('pass_cannot_hide_timeout_unknown_or_missing_http', () => {
  for (const [key, value] of [['maxLegacyVerifiedReadMs', 3000], ['maxWarmVerifiedReadMs', 3000], ['maxWarmRepositoryActionMs', 3000], ['maxRawIoWaitMs', 3000], ['maxCasWaitMs', 3000], ['maxLegacyPreviewMs', 10_000], ['initialProducerReadMs', 10_000], ['maxInvokeMs', 60_000], ['coldReadMs', 10_000], ['outstandingBytes', 1], ['accountingMismatches', 1], ['httpAttempts', 2], ['sharedAttempts', 125]] as const) { const report = pass('node'); report.profiles[0]!.metrics[key] = value; assert.throws(() => validateProducerReport(report)) }
})
test('v2_is_explicitly_new_contract_not_a_renamed_v1_pass', () => {
  const report = pass('node'); validateProducerReport(report)
  assert.ok(report.profiles[0]!.metrics.maxRepositoryActionMs > 3000 && report.profiles[0]!.metrics.maxVerifiedReadMs > 3000)
  assert.equal(report.verificationContract.oldMonolithicThreeSecondGate, 'not_awarded')
  for (const mutate of [(r: any) => { r.protocol = 'body-producer-readiness-report-v1' }, (r: any) => { r.verificationContract.actualIoLimitMs = 10_000 }, (r: any) => { r.verificationContract.oldMonolithicThreeSecondGate = 'pass' }, (r: any) => { r.profiles[0].metrics.maxRepositoryActionMs = 1000 }]) { const bad = pass('node'); mutate(bad); assert.throws(() => validateProducerReport(bad)) }
})
test('every_new_session_owner_quantum_fence_and_retention_gate_is_required', () => {
  for (const patch of [{ sessionMaxMs: 10_000 }, { rawIoMaxMs: 3000 }, { casMaxMs: 3000 }, { hostYields: 0 }, { maxOperationsPerAdvance: 9 }, { synchronousSegmentMaxMs: 251 }, { finalFencePasses: 0 }, { finalFencePasses: 1 }, { finalFenceObservedRecords: 11_999 }, { retainedBytes: 1 }, { peakRetainedBytes: 67_108_865 }, { peakRetainedEntries: 8194 }, { peakActivePayloadRecords: 513 }]) { const bad = pass('node'); Object.assign(bad.profiles[0]!.observations.verification.stats, patch); assert.throws(() => validateProducerReport(bad)) }
  for (const patch of [{ maxMetadataOwnerMs: 10_000 }, { maxInvocationOwnerMs: 60_000 }, { activeOwners: 1 }, { ownersExpired: 1 }, { deadlineRefusals: 1 }, { lateResultRefusals: 1 }]) { const bad = pass('node'); Object.assign(bad.profiles[0]!.observations.verification.owners, patch); assert.throws(() => validateProducerReport(bad)) }
  const partial = pass('node'); partial.profiles[0]!.status = 'timeout'; partial.profiles[0]!.refusalCode = 'deadline_exceeded'
  Object.assign(partial.profiles[0]!.observations.verification.stats, { sessionsCompleted: 7, sessionsFailed: 1, finalFencePasses: 7, finalFenceObservedRecords: 11_999, sessionMaxMs: 10_001 })
  validateProducerReport(partial); assert.equal(producerReportExitCode(partial), 1)
})
test('source_identity_and_failure_codes_are_closed', () => {
  const report = pass('node') as any; report.source.coreSha256 = 'source text'; assert.throws(() => validateProducerReport(report))
  const failed = emptyProducerReport(source, 'node') as any; failed.profiles[0].refusalCode = 'raw_provider_message'; assert.throws(() => validateProducerReport(failed))
})
test('session_refusals_keep_closed_diagnostic_codes', () => {
  for (const code of ['verification_capacity', 'verification_quantum_exceeded', 'verification_unavailable', 'deadline_exceeded', 'cancelled']) {
    assert.equal(safeProducerCode({ code }), code); assert.equal(safeProducerReason(code), code)
    const report = emptyProducerReport(source, 'node'); report.profiles[0]!.status = 'failed'; report.profiles[0]!.refusalCode = code
    validateProducerReport(report); assert.equal(producerReportExitCode(report), 1)
  }
  assert.equal(safeProducerCode({ code: 'private raw body' }), 'profile_failed')
})
test('capacity_and_cumulative_accounting_cannot_reset', () => {
  for (const patch of [{ writtenBytes: 67_108_864 }, { recoveryBytes: 524_289 }, { producerRequests: 8, httpAttempts: 8, sharedAttempts: 131 }, { legacyAttempts: 0 }, { sharedOperations: 2049 }]) { const report = pass('node'); Object.assign(report.profiles[0]!.metrics, patch); assert.throws(() => validateProducerReport(report)) }
})
test('failed_check_cannot_be_counted_as_pass', () => { const report = pass('node'); report.profiles[0]!.checks[0]!.status = 'fail'; assert.throws(() => validateProducerReport(report)) })
test('observations_are_closed_and_do_not_invent_heap_or_proof', () => {
  for (const mutate of [(r: ProducerReport) => { r.profiles[0]!.observations.proof.v3Mode = 'not_run' }, (r: ProducerReport) => { r.profiles[0]!.observations.proof.legacyRetainedBytes = 1 }, (r: ProducerReport) => { r.profiles[0]!.observations.retention.activePayloadRecords = 513 }, (r: ProducerReport) => { r.profiles[0]!.observations.retention.maxReadBatchKeys = 34 }, (r: ProducerReport) => { r.profiles[0]!.observations.heap.sampledPeakHeapUsedBytes = 0 }, (r: ProducerReport) => { r.profiles[2]!.observations.heap = structuredClone(r.profiles[0]!.observations.heap) }]) { const report = pass('node'); mutate(report); assert.throws(() => validateProducerReport(report)) }
  const unavailable = pass('node'); unavailable.profiles[0]!.observations.heap = { status: 'unavailable', method: 'node_process_samples', samples: 0, baselineHeapUsedBytes: null, sampledPeakHeapUsedBytes: null, finalHeapUsedBytes: null }; validateProducerReport(unavailable)
})
test('request_failures_retain_closed_exact_obligations', () => {
  for (const mutate of [(r: ProducerReport) => { r.profiles[0]!.requests.pop() }, (r: ProducerReport) => { r.profiles[0]!.requests[0]!.resolutionReason = 'private_body' }, (r: ProducerReport) => { r.profiles[0]!.requestObservation = 'unconfirmed' }, (r: ProducerReport) => { r.profiles[0]!.requests[1]!.requestHash = r.profiles[0]!.requests[0]!.requestHash }, (r: ProducerReport) => { r.profiles[0]!.observations.producerOriginProof.exactPasses = 0 }, (r: ProducerReport) => { r.profiles[0]!.observations.producerOriginProof.retainedBytes = 1 }]) { const report = pass('node'); mutate(report); assert.throws(() => validateProducerReport(report)) }
  const failed = pass('node'), row = failed.profiles[0]!; row.status = 'failed'; row.requestObservation = 'unconfirmed'; row.metrics.outstandingBytes = 1_343_309
  row.requests[0] = { ...row.requests[0]!, status: 'response_retained', resolutionOutcome: null, resolutionReason: null, phaseReason: 'operation_timeout', outstandingBytes: 1_343_309 }
  validateProducerReport(failed); assert.equal(producerReportExitCode(failed), 1); assert.equal(row.requests[0]!.responseHash, '7'.repeat(64))
  assert.equal(safeProducerReason('private free text'), 'not_allowlisted'); assert.equal(safeProducerReason('operation_timeout'), 'operation_timeout')
})
test('later_failure_does_not_relabel_completed_sdk_check', () => {
  const row = emptyProducerReport(source, 'node').profiles[0]!, checks = producerProfileChecks(row)
  checks.begin('sdk_one_call'); checks.pass('sdk_one_call'); checks.begin('retained_outcome'); checks.fail()
  assert.equal(row.checks.find(check => check.id === 'sdk_one_call')!.status, 'pass'); assert.equal(row.checks.find(check => check.id === 'retained_outcome')!.status, 'fail')
})
test('prepare_timeout_or_storage_failure_preserves_code_and_stage', () => {
  for (const code of ['deadline_exceeded', 'operation_timeout', 'storage_unknown']) {
    const row = emptyProducerReport(source, 'node').profiles[0]!, checks = producerProfileChecks(row), error = { code }
    checks.begin('input_source_sensitive'); assert.throws(() => producerBudgetRefusal(error, checks), value => value === error); checks.fail()
    assert.equal(safeProducerCode(error), code); assert.equal(row.checks.find(check => check.id === 'input_source_sensitive')!.status, 'fail'); assert.equal(row.checks.find(check => check.id === 'budget_refusal_no_dispatch')!.status, 'not_run')
  }
  const row = emptyProducerReport(source, 'node').profiles[0]!, checks = producerProfileChecks(row)
  assert.equal(producerBudgetRefusal({ code: 'budget_exhausted' }, checks), 'budget_exhausted'); checks.fail(); assert.equal(row.checks.find(check => check.id === 'budget_refusal_no_dispatch')!.status, 'fail')
})
test('measured_repository_preserves_optional_scope_capabilities', () => {
  const token = Object.freeze({}), proof = Object.freeze({ diagnosticMarker: true }), calls: string[] = []
  const source: any = { createActionScope(id: string) { assert.equal(this, source); assert.equal(id, 'profile-id'); calls.push('create'); return token }, disposeActionScope(value: unknown) { assert.equal(this, source); assert.equal(value, token); calls.push('dispose') }, getActionProofStats() { assert.equal(this, source); calls.push('stats'); return proof } }
  const target: any = {}; forwardProducerProofCapabilities(source, target)
  assert.equal(target.createActionScope('profile-id'), token); assert.equal(target.getActionProofStats(), proof); target.disposeActionScope(token); assert.deepEqual(calls, ['create', 'stats', 'dispose'])
  const absent: any = {}; forwardProducerProofCapabilities({} as any, absent); assert.deepEqual(absent, {})
})
test('measured_repository_forwards_session_context_without_replacing_wrappers', () => {
  const scope = Object.freeze({}), context = Object.freeze({ marker: true }), statistics = Object.freeze({ protocol: 'producer-verification-session-v1' }), calls: string[] = []
  const source: any = { getVerificationStats() { assert.equal(this, source); calls.push('stats'); return statistics }, verifyCurrent(id: string, given: unknown, token: unknown) { assert.equal(this, source); assert.equal(id, 'id'); assert.equal(given, context); assert.equal(token, scope); calls.push('verify'); return 'verified' }, adoptVerified(id: string, operation: string, identity: unknown, given: unknown, token: unknown) { assert.equal(this, source); assert.equal(id, 'id'); assert.equal(operation, 'operation'); assert.equal(identity, statistics); assert.equal(given, context); assert.equal(token, scope); calls.push('adopt'); return 'adopted' } }
  const target: any = {}; forwardProducerProofCapabilities(source, target)
  assert.equal(target.getVerificationStats(), statistics); assert.equal(target.verifyCurrent('id', context, scope), 'verified'); assert.equal(target.adoptVerified('id', 'operation', statistics, context, scope), 'adopted')
  const instrumented = () => 'measured', existing: any = { verifyCurrent: instrumented, adoptVerified: instrumented }; forwardProducerProofCapabilities(source, existing)
  assert.equal(existing.verifyCurrent, instrumented); assert.equal(existing.adoptVerified, instrumented); assert.deepEqual(calls, ['stats', 'verify', 'adopt'])
})
test('missing_build_restart_or_ui_is_not_browser_success', () => { for (const mutate of [(r: ProducerReport) => { r.builds.ui = null }, (r: ProducerReport) => { r.profiles[2]!.restart = 'not_run' }, (r: ProducerReport) => { r.ui[0]!.status = 'not_run' }, (r: ProducerReport) => { r.app[0]!.status = 'not_run' }, (r: ProducerReport) => { r.builds.app = null }]) { const report = pass('browser'); mutate(report); assert.equal(producerReportExitCode(report), 1) } })
test('real_app_rows_have_separate_closed_evidence', () => { for (const mutate of [(r: ProducerReport) => { r.app[0]!.httpAttempts = 0 }, (r: ProducerReport) => { r.app[0]!.inputDigest = null }, (r: ProducerReport) => { r.app[0]!.browserErrors = 1 }, (r: ProducerReport) => { r.app[0]!.checks[0]!.status = 'not_run' }]) { const report = pass('browser'); mutate(report); assert.throws(() => validateProducerReport(report)) } })
test('actual_app_verification_rows_require_observed_progress_cancellation_and_reload', () => {
  for (const key of ['verificationProgressEvents', 'cancelledBeforeIo', 'cancelledPendingIoAcknowledgment', 'verificationReloads'] as const) { const bad = pass('browser'); bad.app[0]![key] = 0; assert.throws(() => validateProducerReport(bad)) }
  const foreign = pass('node'); foreign.app[0]!.verificationProgressEvents = 1; assert.throws(() => validateProducerReport(foreign))
})
test('external_requests_browser_errors_or_source_changes_fail', () => { for (const mutate of [(r: ProducerReport) => { r.blockedExternalRequests = 1 }, (r: ProducerReport) => { r.browserErrors = 1 }, (r: ProducerReport) => { r.sourceStable = 'changed' }, (r: ProducerReport) => { r.teardown = 'fail' }]) { const report = pass('browser'); mutate(report); assert.equal(producerReportExitCode(report), 1) } })
const browser = await readFile(new URL('./browser-writer-body-producer.mjs', import.meta.url), 'utf8')
test('browser_entry_is_explicitly_ci_only_and_has_no_retry', () => { assert.ok(browser.indexOf("process.env.BODY_PRODUCER_CI_APPROVED !== '1'") < browser.indexOf('chromium.launchPersistentContext')); assert.equal(browser.match(/chromium\.launchPersistentContext/g)?.length, 1); assert.ok(!browser.includes('screenshot(') && !browser.includes('tracing.start') && !browser.includes('--no-sandbox')) })
const root = fileURLToPath(new URL('../', import.meta.url)), main = await readFile(path.join(root, 'src/main.ts'), 'utf8'), normalVite = await readFile(path.join(root, 'vite.config.ts'), 'utf8')
test('controlled_app_build_uses_real_composition_root_only', () => {
  const options = producerAppBuildOptions(root, '/tmp/body-producer-build-schema-only', 'http://127.0.0.1:17321/v1'), plugin = options.plugins.find((row: { name?: string }) => row.name === 'body-producer-controlled-app-host')
  assert.equal(options.build.rolldownOptions.input.app, path.join(root, 'index.html')); assert.equal(options.build.rolldownOptions.input['body-producer-app-control'], path.join(root, 'scripts/fixtures/writer-body-producer-app.ts'))
  const changed = plugin.transform(main, path.join(root, 'src/main.ts'))
  assert.ok(changed.code.includes('await installBodyProducerApp(app, "http://127.0.0.1:17321/v1")') && changed.code.includes('app.use(router)') && changed.code.includes('void bootstrap()'))
  assert.equal(plugin.transform(main, path.join(root, 'src/App.vue')), null)
  assert.throws(() => plugin.transform(`${main}\nconst app = createApp(App)`, path.join(root, 'src/main.ts')))
  for (const endpoint of ['https://127.0.0.1:17321/v1', 'http://example.com:17321/v1', 'http://127.0.0.1:17321/v1?grant=1']) assert.throws(() => producerAppBuildOptions(root, '/tmp/body-producer-build-schema-only', endpoint))
  assert.ok(!main.includes('installBodyProducerApp') && !normalVite.includes('body-producer-app') && !normalVite.includes('producerAppBuildOptions'))
})
console.log(JSON.stringify({ suite: 'body-producer-report', checks, nativeUiExecuted: false, semanticAcceptance: 'NOT_RUN' }))
