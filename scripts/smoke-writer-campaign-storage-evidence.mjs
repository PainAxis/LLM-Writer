/* global process, Buffer */
/** Closed-projection/geometry regression only. Not browser/IDB/capacity evidence. */
import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CAPACITY_GEOMETRY, CAPACITY_V1_BASELINE, capacityTasks, capacityAtomCount } from './fixtures/writer-campaign-capacity-profile.ts'
import { CAMPAIGN_STORAGE_REPORT_PATH, CAMPAIGN_CAPACITY_NODE_REPORT_PATH, emptyCampaignStorageProfile, projectCampaignStorageReport, campaignStorageReportExitCode } from './campaign-evidence.mjs'
import { campaignStorageEvidenceCase as fixture } from './fixtures/campaign-storage-evidence-case.mjs'
import { beginStorageObservation, failStorageObservation, finalizeStorageObservation, recordStorageBrowserEvent } from './lib/writer-campaign-storage-reporting.mjs'
import { summarizeReport, prepareEvidence } from './prepare-ci-evidence.mjs'
let checks = 0

try {
  assert.deepEqual(fixture().geometry, CAPACITY_GEOMETRY); assert.deepEqual(fixture().baselineV1, CAPACITY_V1_BASELINE); checks++
  const tasks = capacityTasks()
  assert.equal(tasks.length, 123); assert.equal(tasks.filter(task => task.kind === 'chapter_body').length, 60)
  assert.equal(tasks.filter(task => task.kind === 'chapter_body').reduce((sum, task) => sum + capacityAtomCount(task.chapterOrdinal), 0), 1_000_000)
  assert.deepEqual(tasks[4].dependsOn, ['outline-1']); assert.deepEqual(tasks[122].dependsOn, ['outline-60', 'body-59']); checks++
  for (const environment of ['browser-native-idb', 'node-injected-atomic-io-not-browser-idb']) {
    const input = fixture(environment)
    assert.deepEqual(projectCampaignStorageReport(input), input); checks++
  }
  const valid = fixture()
  for (const mutate of [
    value => { value.rawBackup = 'PRIVATE_SOURCE_CANARY' },
    value => { value.restartExpected = { checkpointHash: 'a'.repeat(64) } },
    value => { value.profiles[0].request = 'PRIVATE_SOURCE_CANARY' },
    value => { value.profiles[0].liveBytesByRecordKind.raw = 'PRIVATE_SOURCE_CANARY' },
    value => { value.boundaries[0].raw = 'PRIVATE_SOURCE_CANARY' },
    value => { value.geometry.raw = 'PRIVATE_SOURCE_CANARY' },
    value => { value.baselineV1.zh.raw = 'PRIVATE_SOURCE_CANARY' },
    value => { value.buildSha256 = ['a'.repeat(64)] },
    value => { value.environment = 'production' },
    value => { value.readAccounting = 'repository_getMany_only' },
    value => { value.baselineReadAccounting = 'browser_idb' },
    value => { value.longformAcceptance = 'PASS' },
    value => { value.realModelRequests = 1 },
    value => { value.profiles[0].blockerCode = 'PRIVATE_SOURCE_CANARY' },
    value => { value.profiles[0].language = 'PRIVATE_SOURCE_CANARY' },
    value => { value.profiles[0].execution = 'PRIVATE_SOURCE_CANARY' },
    value => { value.profiles[0].coldProcessRestart = 'PRIVATE_SOURCE_CANARY' },
    value => { value.boundaries[0].failureStage = 'PRIVATE_SOURCE_CANARY'; value.boundaries[0].status = 'fail' },
    value => { value.profiles[0].cumulativeWrittenBytes = -1 },
    value => { value.profiles[0].cumulativeWrittenBytes = Number.MAX_SAFE_INTEGER + 1 },
    value => { value.profiles[0].cumulativeWrittenBytes = NaN },
    value => { value.profiles[0].maxStepMs = -1 },
    value => { value.profiles[0].maxStepMs = 'PRIVATE_SOURCE_CANARY' },
    value => { value.profiles[0].maxStepMs = Infinity },
    value => { value.profiles[0].cumulativeWrittenBytes = '0000000000000000' },
    value => { value.profiles[0].status = 'pass' },
    value => { value.boundaries.pop() },
    value => { value.boundaries[1].id = 'S01' },
    value => { value.profiles.reverse() },
    value => { value.geometry.storageCeilingBytes++ },
    value => { value.baselineV1.zh.totalReadBytes++ },
    value => { value.profiles[0].maxReadBatchKeys = 34; value.profiles[0].status = 'running'; value.profiles[0].execution = 'running' },
    value => { value.profiles[0].status = 'running'; value.profiles[0].execution = 'running'; value.profiles[0].outstandingBytes = 1 },
  ]) { const bad = structuredClone(valid); mutate(bad); assert.throws(() => projectCampaignStorageReport(bad), { message: 'Invalid closed Campaign evidence schema' }); checks++ }
  const running = fixture(); running.profiles[0].status = 'running'; running.profiles[0].execution = 'running'
  assert.deepEqual(projectCampaignStorageReport(running), running); checks++
  const failed = fixture(); failed.profiles[0].status = 'fail'; failed.profiles[0].blockerCode = 'profile_failure'
  assert.deepEqual(projectCampaignStorageReport(failed), failed); checks++
  for (const [environment, target] of [['browser-native-idb', CAMPAIGN_STORAGE_REPORT_PATH], ['node-injected-atomic-io-not-browser-idb', CAMPAIGN_CAPACITY_NODE_REPORT_PATH]]) {
    const source = fixture(environment), bytes = Buffer.from(JSON.stringify(source))
    assert.deepEqual(summarizeReport(bytes, target).report, source)
    assert.throws(() => summarizeReport(bytes, target === CAMPAIGN_STORAGE_REPORT_PATH ? CAMPAIGN_CAPACITY_NODE_REPORT_PATH : CAMPAIGN_STORAGE_REPORT_PATH))
    checks++
  }
  // Schema 1 remains strictly closed before a derived schema-2 projection.
  // Missing historic diagnostics must never become a newly measured zero.
  {
    const legacy = fixture(); legacy.schemaVersion = 1
    for (const row of legacy.profiles) delete row.timeoutDiagnostics
    const before = structuredClone(legacy), projected = projectCampaignStorageReport(legacy)
    assert.deepEqual(legacy, before); assert.equal(projected.schemaVersion, 2)
    assert.ok(projected.profiles.every(row => row.timeoutDiagnostics.status === 'not_collected'))
    assert.deepEqual(projectCampaignStorageReport(projected), projected)
    legacy.profiles[0].timeoutDiagnostics = { status: 'not_observed', events: [], overflow: 0 }
    assert.throws(() => projectCampaignStorageReport(legacy)); checks++
  }
  const diagnosticReport = () => {
    const input = fixture(), row = input.profiles[0]
    row.status = 'timeout'; row.execution = 'blocked'; row.blockerCode = 'operation_timeout'
    row.timeoutDiagnostics = { status: 'observed', overflow: 0, events: [{
      phase: 'commit', trigger: 'timer', selectedBudget: 'action', operationTimeoutMs: 3000,
      actionTimeoutMs: 10000, actionRemainingMs: 2345.25, scheduledTimeoutMs: 2345.25,
      operationElapsedMs: 2345.375, actionElapsedMs: 10000.125,
    }] }
    return input
  }
  {
    const input = diagnosticReport(), projected = projectCampaignStorageReport(input)
    assert.deepEqual(projected, input)
    projected.profiles[0].timeoutDiagnostics.events[0].phase = 'save'
    assert.equal(input.profiles[0].timeoutDiagnostics.events[0].phase, 'commit')
    const row = input.profiles[0]
    row.timeoutDiagnostics = { status: 'not_observed', events: [], overflow: 0 }
    assert.deepEqual(projectCampaignStorageReport(input), input, 'No recorded event is not proof that a timeout never occurred')
    row.timeoutDiagnostics = { status: 'not_collected', events: [], overflow: 0 }
    assert.deepEqual(projectCampaignStorageReport(input), input); checks++
  }
  for (const mutate of [
    event => { event.selectedBudget = 'operation' },
    event => { event.selectedBudget = 'tie' },
    event => { event.scheduledTimeoutMs++ },
    event => { event.operationTimeoutMs = 3001 },
    event => { event.actionTimeoutMs = 10001 },
    event => { event.operationElapsedMs = Infinity },
    event => { event.operationElapsedMs = -1 },
    event => { event.operationElapsedMs = NaN },
    event => { event.operationElapsedMs = Number.MAX_SAFE_INTEGER + 1 },
    event => { event.operationElapsedMs = event.actionElapsedMs + 1 },
    event => { event.actionElapsedMs = 0 },
    event => { event.actionRemainingMs = 10001 },
    event => { event.actionRemainingMs = -1 },
    event => { event.phase = 'PRIVATE_SOURCE_CANARY' },
    event => { event.trigger = 'PRIVATE_SOURCE_CANARY' },
    event => { event.payload = 'PRIVATE_SOURCE_CANARY' },
    event => { event.operationElapsedMs = 'PRIVATE_SOURCE_CANARY' },
    event => { event.campaignId = 'PRIVATE_SOURCE_CANARY' },
    event => { event.error = 'PRIVATE_SOURCE_CANARY' },
    event => { event.stack = 'PRIVATE_SOURCE_CANARY' },
    event => { event.actionTimeoutMs = null },
  ]) {
    const bad = diagnosticReport(); mutate(bad.profiles[0].timeoutDiagnostics.events[0])
    assert.throws(() => projectCampaignStorageReport(bad), { message: 'Invalid closed Campaign evidence schema' }); checks++
  }
  for (const mutate of [
    diagnostic => { diagnostic.raw = 'PRIVATE_SOURCE_CANARY' },
    diagnostic => { diagnostic.status = 'not_collected' },
    diagnostic => { diagnostic.status = 'not_observed' },
    diagnostic => { diagnostic.events = [] },
    diagnostic => { diagnostic.overflow = -1 },
    diagnostic => { diagnostic.overflow = Number.MAX_SAFE_INTEGER + 1 },
    diagnostic => { diagnostic.overflow = 1 },
    diagnostic => { diagnostic.events = Array(9).fill(diagnostic.events[0]) },
  ]) {
    const bad = diagnosticReport(); mutate(bad.profiles[0].timeoutDiagnostics)
    assert.throws(() => projectCampaignStorageReport(bad), { message: 'Invalid closed Campaign evidence schema' }); checks++
  }
  {
    const input = diagnosticReport(), event = input.profiles[0].timeoutDiagnostics.events[0]
    for (const phase of ['read', 'receipt', 'commit', 'prepare', 'dispatch', 'reconcile', 'save', 'recovery_read', 'recovery_receipt', 'recovery_commit']) {
      Object.assign(event, { phase, operationTimeoutMs: phase === 'dispatch' ? 5000 : 3000 })
      assert.deepEqual(projectCampaignStorageReport(input), input)
    }
    Object.assign(event, { phase: 'dispatch', operationTimeoutMs: 5000, actionRemainingMs: 5000, scheduledTimeoutMs: 5000, selectedBudget: 'tie', operationElapsedMs: 5000.25, actionElapsedMs: 10000.25 })
    assert.deepEqual(projectCampaignStorageReport(input), input)
    Object.assign(event, { phase: 'read', operationTimeoutMs: 3000, actionRemainingMs: 9000, scheduledTimeoutMs: 3000, selectedBudget: 'operation', operationElapsedMs: 3000.25, actionElapsedMs: 4000.25 })
    assert.deepEqual(projectCampaignStorageReport(input), input)
    Object.assign(event, { phase: 'recovery_read', actionTimeoutMs: null, actionRemainingMs: null, actionElapsedMs: null })
    assert.deepEqual(projectCampaignStorageReport(input), input)
    Object.assign(event, { phase: 'commit', trigger: 'action_deadline_check', selectedBudget: 'action', operationTimeoutMs: null, actionTimeoutMs: 10000, scheduledTimeoutMs: null, operationElapsedMs: null, actionElapsedMs: 10000.5 })
    assert.deepEqual(projectCampaignStorageReport(input), input)
    event.actionElapsedMs = 9999.9; assert.throws(() => projectCampaignStorageReport(input)); event.actionElapsedMs = 10000
    event.operationElapsedMs = 0; assert.throws(() => projectCampaignStorageReport(input)); event.operationElapsedMs = null
    input.profiles[0].timeoutDiagnostics.events = Array.from({ length: 8 }, () => ({ ...event }))
    input.profiles[0].timeoutDiagnostics.overflow = Number.MAX_SAFE_INTEGER
    assert.deepEqual(projectCampaignStorageReport(input), input)
    checks++
  }
  const temporary = await mkdtemp(path.join(tmpdir(), 'campaign-storage-evidence-test-'))
  for (const [environment, target] of [['browser-native-idb', CAMPAIGN_STORAGE_REPORT_PATH], ['node-injected-atomic-io-not-browser-idb', CAMPAIGN_CAPACITY_NODE_REPORT_PATH]]) {
    await mkdir(path.dirname(path.join(temporary, target)), { recursive: true })
    await writeFile(path.join(temporary, target), JSON.stringify(fixture(environment)))
  }
  await writeFile(path.join(temporary, path.dirname(CAMPAIGN_STORAGE_REPORT_PATH), 'private-backup.json'), 'PRIVATE_SOURCE_CANARY')
  const archive = await prepareEvidence({ root: temporary, group: 'writer-campaign-storage' })
  assert.equal(archive.files.length, 2)
  const summary = path.join(temporary, 'artifacts/ci-evidence/writer-campaign-storage/browser-writer-campaign-storage/report.summary.json')
  assert.equal((await readFile(summary, 'utf8')).includes('PRIVATE_SOURCE_CANARY'), false)
  await writeFile(path.join(temporary, CAMPAIGN_STORAGE_REPORT_PATH), JSON.stringify({ ...fixture(), payload: 'PRIVATE_SOURCE_CANARY' }))
  await assert.rejects(prepareEvidence({ root: temporary, group: 'writer-campaign-storage' }), { message: 'Invalid closed Campaign evidence schema' })
  await assert.rejects(readFile(summary), { code: 'ENOENT' }); checks++
  // Minimal source-free synthetic pass proves the CLI gate, not an executed profile.
  const passing = fixture('node-injected-atomic-io-not-browser-idb')
  for (const row of passing.profiles) Object.assign(row, { status: 'pass', execution: 'completed', coldProcessRestart: 'not_applicable', committedBodyScalars: 1_000_000, committedTasks: 123, actualFixtureInvocations: 123, reservedAttempts: 123, committedOperations: 494, committedTransactions: 494, cumulativeWrittenBytes: 1000, liveRecordCount: 1, totalReadCalls: 1, coldRepositoryReadCalls: 1 })
  assert.equal(campaignStorageReportExitCode(passing), 0); checks++
  for (const status of ['running', 'timeout', 'refused', 'fail', 'not_run']) {
    const incomplete = structuredClone(passing)
    incomplete.profiles[0] = { ...emptyCampaignStorageProfile('zh'), status, execution: status === 'not_run' ? 'not_run' : 'running', blockerCode: status === 'timeout' ? 'operation_timeout' : null }
    assert.equal(campaignStorageReportExitCode(incomplete), 1); checks++
  }
  function browserPassing() {
    const report = fixture()
    for (const row of report.boundaries) row.status = 'pass'
    for (const row of report.profiles) Object.assign(row, { status: 'pass', execution: 'completed', coldProcessRestart: 'verified', committedBodyScalars: 1_000_000, committedTasks: 123, actualFixtureInvocations: 123, reservedAttempts: 123, committedOperations: 494, committedTransactions: 494, cumulativeWrittenBytes: 1000, liveRecordCount: 1, totalReadCalls: 1, coldRepositoryReadCalls: 1, coldProcessReadCalls: 1 })
    return report
  }
  {
    const unavailable = fixture(); unavailable.buildSha256 = '0'.repeat(64)
    assert.deepEqual(projectCampaignStorageReport(unavailable), unavailable, 'Unavailable setup identity is not a build measurement')
    unavailable.boundaries[0].status = 'pass'
    assert.throws(() => projectCampaignStorageReport(unavailable))
    const successful = browserPassing(); successful.buildSha256 = '0'.repeat(64)
    assert.throws(() => projectCampaignStorageReport(successful)); checks++
  }
  // Bootstrap errors are owned before launch, even when the driver subsequently
  // overwrites its row. A late teardown event must not leave stale all-pass JSON.
  {
    const report = browserPassing(), observation = beginStorageObservation(report, 'boundary', 0)
    assert.equal(observation.baseline.browserErrors, 0)
    recordStorageBrowserEvent(report, observation, 'page_error')
    report.boundaries[0] = { ...report.boundaries[0], status: 'pass', failureStage: null }
    finalizeStorageObservation(report, observation)
    assert.equal(report.boundaries[0].failureStage, 'page_errors')
    assert.equal(projectCampaignStorageReport(report).browserErrors, 1)
    assert.equal(campaignStorageReportExitCode(report), 1); checks++
  }
  {
    const report = browserPassing(), observation = beginStorageObservation(report, 'profile', 1)
    recordStorageBrowserEvent(report, observation, 'external_request')
    assert.equal(report.profiles[1].status, 'fail'); assert.equal(report.profiles[1].coldProcessRestart, 'verified')
    assert.equal(projectCampaignStorageReport(report).blockedExternalRequests, 1)
    assert.equal(campaignStorageReportExitCode(report), 1); checks++
  }
  {
    const report = browserPassing(), boundary = beginStorageObservation(report, 'boundary', 0), profile = beginStorageObservation(report, 'profile', 0)
    failStorageObservation(report, boundary, 'exercise')
    report.profiles[0].status = 'timeout'; report.profiles[0].blockerCode = 'operation_timeout'
    recordStorageBrowserEvent(report, boundary, 'page_error'); recordStorageBrowserEvent(report, profile, 'external_request')
    assert.equal(report.boundaries[0].failureStage, 'exercise')
    assert.equal(report.profiles[0].status, 'timeout'); assert.equal(report.profiles[0].blockerCode, 'operation_timeout')
    assert.equal(projectCampaignStorageReport(report).browserErrors, 1); checks++
  }
  {
    const report = browserPassing(), previous = beginStorageObservation(report, 'boundary', 0)
    recordStorageBrowserEvent(report, previous, 'page_error')
    const current = beginStorageObservation(report, 'boundary', 1)
    assert.equal(current.baseline.browserErrors, 1)
    recordStorageBrowserEvent(report, previous, 'page_error')
    finalizeStorageObservation(report, current)
    assert.equal(report.boundaries[1].status, 'pass', 'A late old-context event remains attributed to its owner')
    assert.equal(projectCampaignStorageReport(report).browserErrors, 2); checks++
  }
  {
    const report = browserPassing(), observation = beginStorageObservation(report, 'profile', 0)
    recordStorageBrowserEvent(report, observation, 'page_error')
    report.profiles[0] = { ...report.profiles[0], status: 'running', blockerCode: null }
    finalizeStorageObservation(report, observation)
    assert.equal(report.profiles[0].status, 'fail'); assert.equal(report.browserErrors, 1); checks++
  }
  {
    const report = browserPassing(), observation = beginStorageObservation(report, 'boundary', 0)
    failStorageObservation(report, observation, 'setup')
    recordStorageBrowserEvent(report, observation, 'page_error')
    assert.equal(report.boundaries[0].failureStage, 'setup')
    assert.equal(projectCampaignStorageReport(report).browserErrors, 1); checks++
  }
  const driver = await readFile(new URL('./fixtures/writer-campaign-storage-browser.ts', import.meta.url), 'utf8')
  const profile = await readFile(new URL('./fixtures/writer-campaign-capacity-profile.ts', import.meta.url), 'utf8')
  assert.ok(driver.includes('runCampaignCapacityProfile(language, getCampaignBuildIdentity(), meter, undefined'))
  assert.ok(profile.includes('const repository = createCampaignRepository(io)'))
  assert.equal(/ioTimeoutMs|dispatchTimeoutMs|clock:/.test(driver + profile), false, 'No raised/virtual deadline overrides')
  assert.ok(profile.includes('try { return await engine.step(manifest.campaignId, commandId) }\n    finally { maxStepMs = Math.max(maxStepMs, Math.round(performance.now() - stepStarted)) }'), 'Step timer includes rejected steps and ends before subsequent inspection/progress persistence')
  assert.equal(/new Map/.test(driver), false, 'Browser driver cannot inject Map IO')
  assert.ok(driver.includes("if (caseId === 'S02') verify(fired)"))
  assert.ok(driver.includes('probeSnapshot().aborted === abortedBefore + 1'))
  assert.ok(driver.includes("await restarted.resume(id, 'head-resume')"))
  assert.ok(driver.includes('same(next.storage.openAllocations, prior.storage.openAllocations)'))
  assert.ok(driver.includes('snapshot.head.checkpointHash === restartExpected.checkpointHash'))
  assert.ok(driver.includes('snapshot.checkpoint.hash === restartExpected.checkpointHash')); checks++
  const nodeCli = await readFile(new URL('./profile-writer-campaign-capacity.ts', import.meta.url), 'utf8'), browserCli = await readFile(new URL('./browser-writer-campaign-storage.mjs', import.meta.url), 'utf8')
  assert.ok(nodeCli.includes('process.exitCode = campaignStorageReportExitCode(report)') && browserCli.includes('if (campaignStorageReportExitCode(report)) process.exitCode = 1')); checks++
  process.stdout.write(`Campaign storage evidence: ${checks} closed/geometry checks passed; no browser, capacity run, or provider calls.\n`)
} catch {
  process.stderr.write(`Campaign storage evidence failed after ${checks} checks.\n`); process.exitCode = 1
}
