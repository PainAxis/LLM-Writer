/* global process, Buffer */
/** Closed-projection/geometry regression only. Not browser/IDB/capacity evidence. */
import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CAMPAIGN_TIMEOUT_PHASES, CAMPAIGN_OPERATION_TIMING_UPPER_MS } from '../src/services/writerCampaign/engine.ts'
import { CAPACITY_GEOMETRY, CAPACITY_V1_BASELINE, capacityTasks, capacityAtomCount } from './fixtures/writer-campaign-capacity-profile.ts'
import { CAMPAIGN_STORAGE_REPORT_PATH, CAMPAIGN_CAPACITY_NODE_REPORT_PATH, emptyCampaignOperationTiming, emptyCampaignStorageProfile, projectCampaignStorageReport, campaignStorageReportExitCode } from './campaign-evidence.mjs'
import { campaignStorageEvidenceCase as fixture } from './fixtures/campaign-storage-evidence-case.mjs'
import { beginStorageObservation, failStorageObservation, finalizeStorageObservation, recordStorageBrowserEvent } from './lib/writer-campaign-storage-reporting.mjs'
import { summarizeReport, prepareEvidence } from './prepare-ci-evidence.mjs'
let checks = 0
// Deliberately synthetic observations exercise the closed schema, not performance.
const proofStats = () => ({ admittedScopes: 1, fallbackScopes: 0, disposedScopes: 1, coldReplays: 2, coldReplaysCompleted: 2,
  exactPasses: 4, exactRecords: 4, exactBytes: 8, transitions: 4, retainedBytes: 0, retainedEntries: 0, peakRetainedBytes: 10,
  peakRetainedEntries: 1, activeRecords: 0, peakActiveRecords: 1, coldMs: 2.75, coldMaxMs: 2.25, exactMs: 1.5, exactMaxMs: 0.75,
  disposalReasons: { completed: 1, capacity: 0, admission: 0, concurrent: 0, mismatch: 0, conflict: 0, error: 0, replay: 0 } })
const actionTiming = () => ({ status: 'collected', samples: 123, minMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 })
function operationTiming() {
  const timing = emptyCampaignOperationTiming(); timing.status = 'collected'
  Object.assign(timing.phases[0], { count: 1, success: 1, minMs: 0.25, maxMs: 0.25 })
  timing.phases[0].histogram[0] = 1
  return timing
}
const memorySample = environment => ({ status: 'collected', method: environment === 'browser-native-idb' ? 'chromium_performance_memory_samples' : 'node_process_samples',
  samples: 2, baselineHeapUsedBytes: 100, sampledPeakHeapUsedBytes: 140, finalHeapUsedBytes: 120 })
function legacyReport(input, version) {
  const report = structuredClone(input)
  report.schemaVersion = version; delete report.sourceSchemaVersion; delete report.proofBoundaries
  for (const row of report.profiles) {
    delete row.actionProof; delete row.memoryObservation; delete row.actionTiming; delete row.operationTiming
    if (version === 1) delete row.timeoutDiagnostics
  }
  return report
}


try {
  assert.deepEqual(emptyCampaignOperationTiming().phases.map(row => row.phase), CAMPAIGN_TIMEOUT_PHASES); checks++
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
    value => { value.sourceSchemaVersion = 4 },
    value => { value.sourceSchemaVersion = '3' },
    value => { value.schemaVersion = 4 },
    value => { value.proofBoundaries.pop() },
    value => { value.proofBoundaries.push(structuredClone(value.proofBoundaries[0])) },
    value => { value.proofBoundaries.reverse() },
    value => { value.proofBoundaries[0].id = 'P07' },
    value => { value.proofBoundaries[0].id = 'S01' },
    value => { value.proofBoundaries[0].raw = 'PRIVATE_SOURCE_CANARY' },
    value => { value.proofBoundaries[0].failureStage = 'PRIVATE_SOURCE_CANARY'; value.proofBoundaries[0].status = 'fail' },
    value => { value.proofBoundaries[0].restartOutcome = 'PRIVATE_SOURCE_CANARY' },
    value => { value.proofBoundaries[0].coldReplayCount = 1 },
    value => { value.proofBoundaries[0].fixtureDispatchEntries = 1 },
    value => { value.profiles[0].actionProof.raw = 'PRIVATE_SOURCE_CANARY' },
    value => { value.profiles[0].actionProof.stats = {} },
    value => { value.profiles[0].actionProof.status = 'PRIVATE_SOURCE_CANARY' },
    value => { value.profiles[0].operationTiming.raw = 'PRIVATE_SOURCE_CANARY' },
    value => { value.profiles[0].operationTiming.status = 'PRIVATE_SOURCE_CANARY' },
    value => { value.profiles[0].operationTiming.phases[0].minMs = 0 },
    value => { value.profiles[0].operationTiming.phases[0].histogram[0] = 1 },
    value => { value.profiles[0].actionTiming.raw = 'PRIVATE_SOURCE_CANARY' },
    value => { value.profiles[0].actionTiming.status = 'PRIVATE_SOURCE_CANARY' },
    value => { value.profiles[0].actionTiming.samples = 1 },
    value => { value.profiles[0].actionTiming.maxMs = 0 },
    value => { value.profiles[0].memoryObservation.raw = 'PRIVATE_SOURCE_CANARY' },
    value => { value.profiles[0].memoryObservation.status = 'PRIVATE_SOURCE_CANARY' },
    value => { value.profiles[0].memoryObservation.baselineHeapUsedBytes = 0 },
    value => { value.profiles[0].memoryObservation.samples = 1 },
    value => { Object.setPrototypeOf(value, { raw: 'PRIVATE_SOURCE_CANARY' }) },
    value => { Object.setPrototypeOf(value.profiles[0].actionProof, { raw: 'PRIVATE_SOURCE_CANARY' }) },
    value => { Object.defineProperty(value.profiles[0].actionProof, '__proto__', { value: 'PRIVATE_SOURCE_CANARY' }) },
    value => { value.profiles[0].actionProof[Symbol('PRIVATE_SOURCE_CANARY')] = 1 },
    value => { Object.defineProperty(value.profiles[0].memoryObservation, 'status', { enumerable: true, get() { return 'not_collected' } }) },
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
  // Schema 1/2 remain strictly closed before an idempotent derived schema-3
  // projection. Missing historical observations are never measured zeroes.
  for (const version of [1, 2]) {
    const legacy = legacyReport(fixture(), version)
    const before = structuredClone(legacy), projected = projectCampaignStorageReport(legacy)
    assert.deepEqual(legacy, before); assert.equal(projected.schemaVersion, 3); assert.equal(projected.sourceSchemaVersion, version)
    assert.ok(projected.profiles.every(row => row.actionProof.status === 'not_collected' && row.actionProof.stats === null
      && row.memoryObservation.status === 'not_collected' && row.memoryObservation.baselineHeapUsedBytes === null
      && row.actionTiming.status === 'not_collected' && row.actionTiming.maxMs === null
      && row.operationTiming.status === 'not_collected' && row.operationTiming.phases.every(phase => phase.count === 0 && phase.maxMs === null)))
    assert.ok(projected.proofBoundaries.every(row => row.status === 'not_run'))
    assert.deepEqual(projectCampaignStorageReport(projected), projected)
    assert.equal(campaignStorageReportExitCode(projected), 1)
    for (const mutate of [
      value => { value.sourceSchemaVersion = version },
      value => { value.proofBoundaries = [] },
      value => { value.profiles[0].actionProof = { status: 'not_collected', stats: null } },
      value => { value.profiles[0].memoryObservation = memorySample(value.environment) },
      value => { value.profiles[0].actionTiming = actionTiming() },
      value => { value.profiles[0].operationTiming = operationTiming() },
      value => { value.profiles[0].raw = 'PRIVATE_SOURCE_CANARY' },
    ]) { const bad = structuredClone(legacy); mutate(bad); assert.throws(() => projectCampaignStorageReport(bad)); checks++ }
    if (version === 1) {
      legacy.profiles[0].timeoutDiagnostics = { status: 'not_observed', events: [], overflow: 0 }
      assert.throws(() => projectCampaignStorageReport(legacy))
    }
    checks++
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
  for (const row of passing.profiles) Object.assign(row, { status: 'pass', execution: 'completed', coldProcessRestart: 'not_applicable', committedBodyScalars: 1_000_000, committedTasks: 123, actualFixtureInvocations: 123, reservedAttempts: 123, committedOperations: 494, committedTransactions: 494, cumulativeWrittenBytes: 1000, liveRecordCount: 1, totalReadCalls: 1, coldRepositoryReadCalls: 1, actionProof: { status: 'collected', stats: proofStats() }, memoryObservation: memorySample(passing.environment), actionTiming: actionTiming(), operationTiming: operationTiming(), timeoutDiagnostics: { status: 'not_observed', events: [], overflow: 0 } })
  assert.equal(campaignStorageReportExitCode(passing), 0); checks++
  for (const status of ['running', 'timeout', 'refused', 'fail', 'not_run']) {
    const incomplete = structuredClone(passing)
    incomplete.profiles[0] = { ...emptyCampaignStorageProfile('zh'), status, execution: status === 'not_run' ? 'not_run' : 'running', blockerCode: status === 'timeout' ? 'operation_timeout' : null }
    assert.equal(campaignStorageReportExitCode(incomplete), 1); checks++
  }
  function browserPassing() {
    const report = fixture()
    for (const row of report.boundaries) row.status = 'pass'
    for (const [index, row] of report.proofBoundaries.entries()) Object.assign(row, { status: 'pass', faultTriggered: 1, proofObserved: 1, coldReplayCount: 1, exactObservationCount: 1, exactObservedRecords: 1, proofInvalidations: 1, coldFallbacks: index === 5 ? 1 : 0, restartOutcome: index < 3 ? 'integrity_refused' : 'readable', coldProcessReadMs: 0.5, coldProcessReadBytes: 1, coldProcessReadCalls: 1 })
    for (const row of report.profiles) Object.assign(row, { status: 'pass', execution: 'completed', coldProcessRestart: 'verified', committedBodyScalars: 1_000_000, committedTasks: 123, actualFixtureInvocations: 123, reservedAttempts: 123, committedOperations: 494, committedTransactions: 494, cumulativeWrittenBytes: 1000, liveRecordCount: 1, totalReadCalls: 1, coldRepositoryReadCalls: 1, coldProcessReadCalls: 1, actionProof: { status: 'collected', stats: proofStats() }, memoryObservation: memorySample(report.environment), actionTiming: actionTiming(), operationTiming: operationTiming(), timeoutDiagnostics: { status: 'not_observed', events: [], overflow: 0 } })
    return report
  }
  assert.equal(campaignStorageReportExitCode(browserPassing()), 0); checks++
  for (const source of [passing, browserPassing()]) {
    for (const version of [1, 2]) {
      const legacy = legacyReport(source, version), projected = projectCampaignStorageReport(legacy)
      assert.ok(projected.profiles.every(row => row.status === 'pass' && row.actionProof.stats === null))
      assert.equal(projected.sourceSchemaVersion, version)
      assert.deepEqual(projectCampaignStorageReport(projected), projected)
      assert.equal(campaignStorageReportExitCode(legacy), 1)
      assert.equal(campaignStorageReportExitCode(projected), 1); checks++
    }
  }
  for (const mutate of [
    stats => { stats.raw = 'PRIVATE_SOURCE_CANARY' },
    stats => { stats.disposalReasons.raw = 'PRIVATE_SOURCE_CANARY' },
    stats => { delete stats.coldReplaysCompleted },
    stats => { stats.coldReplaysCompleted = stats.coldReplays + 1 },
    stats => { stats.peakRetainedBytes = 67_108_865 },
    stats => { stats.peakRetainedEntries = 8194 },
    stats => { stats.peakActiveRecords = 513 },
    stats => { stats.retainedBytes = stats.peakRetainedBytes + 1 },
    stats => { stats.retainedEntries = stats.peakRetainedEntries + 1 },
    stats => { stats.activeRecords = stats.peakActiveRecords + 1 },
    stats => { stats.coldMaxMs = stats.coldMs + 1 },
    stats => { stats.exactMaxMs = stats.exactMs + 1 },
    stats => { stats.exactPasses = stats.exactRecords + 1 },
    stats => { stats.exactBytes = stats.exactRecords - 1 },
    stats => { stats.disposedScopes++ },
    stats => { stats.disposalReasons.completed++ },
    stats => { Object.setPrototypeOf(stats, { raw: 'PRIVATE_SOURCE_CANARY' }) },
    stats => { Object.setPrototypeOf(stats.disposalReasons, { error: 99 }) },
  ]) {
    const bad = structuredClone(passing); mutate(bad.profiles[0].actionProof.stats)
    assert.throws(() => projectCampaignStorageReport(bad)); checks++
  }
  for (const field of Object.keys(proofStats()).filter(key => key !== 'disposalReasons')) {
    const time = ['coldMs', 'coldMaxMs', 'exactMs', 'exactMaxMs'].includes(field)
    for (const value of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 'PRIVATE_SOURCE_CANARY', ...(time ? [] : [0.5])]) {
      const bad = structuredClone(passing); bad.profiles[0].actionProof.stats[field] = value
      assert.throws(() => projectCampaignStorageReport(bad)); checks++
    }
  }
  for (const field of Object.keys(proofStats().disposalReasons)) {
    const bad = structuredClone(passing); bad.profiles[0].actionProof.stats.disposalReasons[field] = 'PRIVATE_SOURCE_CANARY'
    assert.throws(() => projectCampaignStorageReport(bad)); checks++
  }
  for (const mutate of [
    row => { row.actionProof = { status: 'not_collected', stats: null } },
    row => { row.actionProof.stats.admittedScopes = 0 },
    row => { row.actionProof.stats.exactPasses = 0 },
    row => { row.actionProof.stats.retainedBytes = 1 },
    row => { row.actionProof.stats.retainedEntries = 1 },
    row => { row.actionProof.stats.activeRecords = 1 },
  ]) {
    const bad = structuredClone(passing); mutate(bad.profiles[0])
    assert.throws(() => campaignStorageReportExitCode(bad)); checks++
  }
  {
    const observed = structuredClone(passing), stats = observed.profiles[0].actionProof.stats
    stats.fallbackScopes = 1; stats.disposedScopes = 2; stats.disposalReasons.admission = 1
    stats.peakRetainedBytes = 67_108_864; stats.peakRetainedEntries = 8193; stats.peakActiveRecords = 512
    // Samples are optional, are not exact peaks, and are not constrained by the raw-string cap.
    observed.profiles[0].memoryObservation.sampledPeakHeapUsedBytes = 200_000_000
    const projected = projectCampaignStorageReport(observed)
    assert.equal(campaignStorageReportExitCode(projected), 0)
    assert.equal(projected.profiles[0].actionProof.stats.coldMs, 2.75)
    assert.equal(projected.profiles[0].actionProof.stats.exactMaxMs, 0.75)
    projected.profiles[0].actionProof.stats.disposalReasons.admission = 99
    assert.equal(observed.profiles[0].actionProof.stats.disposalReasons.admission, 1)
    projected.profiles[0].memoryObservation.samples = 99
    assert.equal(observed.profiles[0].memoryObservation.samples, 2); checks++
  }
  for (const mutate of [
    memory => { memory.raw = 'PRIVATE_SOURCE_CANARY' },
    memory => { memory.method = 'heap_dump' },
    memory => { memory.method = 'chromium_performance_memory_samples' },
    memory => { memory.status = 'not_collected' },
    memory => { memory.status = 'unavailable' },
    memory => { memory.samples = 1 },
    memory => { memory.samples = 2.5 },
    memory => { memory.baselineHeapUsedBytes = null },
    memory => { memory.finalHeapUsedBytes = null },
    memory => { memory.sampledPeakHeapUsedBytes = 99 },
    memory => { memory.finalHeapUsedBytes = 141 },
    memory => { memory.sampledPeakHeapUsedBytes = Infinity },
    memory => { memory.baselineHeapUsedBytes = -1 },
    memory => { memory.baselineHeapUsedBytes = 'PRIVATE_SOURCE_CANARY' },
    memory => { Object.setPrototypeOf(memory, { raw: 'PRIVATE_SOURCE_CANARY' }) },
  ]) {
    const bad = structuredClone(passing); mutate(bad.profiles[0].memoryObservation)
    assert.throws(() => projectCampaignStorageReport(bad)); checks++
  }
  for (const source of [passing, browserPassing()]) {
    const unavailable = structuredClone(source), memory = unavailable.profiles[0].memoryObservation
    Object.assign(memory, { status: 'unavailable', samples: 0, baselineHeapUsedBytes: null, sampledPeakHeapUsedBytes: null, finalHeapUsedBytes: null })
    assert.deepEqual(projectCampaignStorageReport(unavailable), unavailable)
    assert.equal(campaignStorageReportExitCode(unavailable), 1)
    memory.method = null; assert.throws(() => projectCampaignStorageReport(unavailable)); checks++
  }
  for (const mutate of [
    timing => { timing.raw = 'PRIVATE_SOURCE_CANARY' },
    timing => { timing.samples = 0 },
    timing => { timing.samples = 122 },
    timing => { timing.samples = 124 },
    timing => { timing.samples = 123.5 },
    timing => { timing.minMs = 1 },
    timing => { timing.p50Ms = 1 },
    timing => { timing.p95Ms = 1 },
    timing => { timing.maxMs = 1 },
    timing => { timing.status = 'not_collected' },
    timing => { Object.setPrototypeOf(timing, { raw: 'PRIVATE_SOURCE_CANARY' }) },
  ]) {
    const report = structuredClone(passing); mutate(report.profiles[0].actionTiming)
    assert.throws(() => projectCampaignStorageReport(report)); checks++
  }
  for (const field of ['samples', 'minMs', 'p50Ms', 'p95Ms', 'maxMs']) {
    for (const value of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 0.5, 'PRIVATE_SOURCE_CANARY', null]) {
      const report = structuredClone(passing); report.profiles[0].actionTiming[field] = value
      assert.throws(() => projectCampaignStorageReport(report)); checks++
    }
  }
  {
    const report = structuredClone(passing), row = report.profiles[0]
    Object.assign(row.actionTiming, { minMs: 10, p50Ms: 20, p95Ms: 30, maxMs: 40 }); row.maxStepMs = 40
    const projected = projectCampaignStorageReport(report)
    assert.deepEqual(projected, report); assert.equal(campaignStorageReportExitCode(projected), 0)
    projected.profiles[0].actionTiming.p50Ms = 25
    assert.equal(row.actionTiming.p50Ms, 20)
    row.status = 'running'; row.execution = 'running'; row.actionTiming.samples = 2
    assert.deepEqual(projectCampaignStorageReport(report), report)
    assert.equal(campaignStorageReportExitCode(report), 1); checks++
  }
  for (const mutate of [
    timing => { timing.raw = 'PRIVATE_SOURCE_CANARY' },
    timing => { timing.status = 'not_collected' },
    timing => { timing.phases.pop() },
    timing => { timing.phases.reverse() },
    timing => { timing.phases[0].phase = 'PRIVATE_SOURCE_CANARY' },
    timing => { timing.phases[1].phase = timing.phases[0].phase },
    timing => { timing.phases[0].raw = 'PRIVATE_SOURCE_CANARY' },
    timing => { timing.phases[0].message = 'PRIVATE_SOURCE_CANARY' },
    timing => { timing.phases[0].stack = 'PRIVATE_SOURCE_CANARY' },
    timing => { timing.phases[0].error = 'PRIVATE_SOURCE_CANARY' },
    timing => { timing.phases[0].count++ },
    timing => { timing.phases[0].success++ },
    timing => { timing.phases[0].abort++ },
    timing => { timing.phases[0].timeout++ },
    timing => { timing.phases[0].histogram[0]++ },
    timing => { timing.phases[0].histogram.pop() },
    timing => { timing.phases[0].histogram.push(0) },
    timing => { timing.phases[0].histogram.reverse() },
    timing => { timing.phases[0].minMs = 1 },
    timing => { timing.phases[0].maxMs = 1 },
    timing => { timing.phases[0].minMs = null },
    timing => { timing.phases[0].maxMs = null },
    timing => { timing.phases[1].minMs = 0 },
    timing => { timing.phases[1].maxMs = 0 },
    timing => { delete timing.phases[0] },
    timing => { delete timing.phases[0].histogram[0] },
    timing => { timing.phases[0].histogram.raw = 'PRIVATE_SOURCE_CANARY' },
    timing => { Object.setPrototypeOf(timing, { raw: 'PRIVATE_SOURCE_CANARY' }) },
    timing => { Object.setPrototypeOf(timing.phases[0], { raw: 'PRIVATE_SOURCE_CANARY' }) },
  ]) {
    const report = structuredClone(passing); mutate(report.profiles[0].operationTiming)
    assert.throws(() => projectCampaignStorageReport(report)); checks++
  }
  for (const field of ['count', 'success', 'error', 'abort', 'timeout']) {
    for (const value of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 0.5, 'PRIVATE_SOURCE_CANARY', null]) {
      const report = structuredClone(passing); report.profiles[0].operationTiming.phases[0][field] = value
      assert.throws(() => projectCampaignStorageReport(report)); checks++
    }
  }
  for (const field of ['minMs', 'maxMs']) {
    for (const value of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 'PRIVATE_SOURCE_CANARY']) {
      const report = structuredClone(passing); report.profiles[0].operationTiming.phases[0][field] = value
      assert.throws(() => projectCampaignStorageReport(report)); checks++
    }
  }
  for (const value of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 0.5, 'PRIVATE_SOURCE_CANARY', null]) {
    const report = structuredClone(passing); report.profiles[0].operationTiming.phases[0].histogram[0] = value
    assert.throws(() => projectCampaignStorageReport(report)); checks++
  }
  {
    const bounds = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 3000, 5000, 10000, Infinity]
    assert.deepEqual(bounds, CAMPAIGN_OPERATION_TIMING_UPPER_MS); checks++
    // Exact upper boundaries move into the next bin; fractional observations are preserved.
    for (const elapsed of [0, 0.125, ...bounds.filter(Number.isFinite), 10000.5]) {
      const report = structuredClone(passing), phase = report.profiles[0].operationTiming.phases[0]
      phase.minMs = phase.maxMs = elapsed; phase.histogram.fill(0); phase.histogram[bounds.findIndex(bound => elapsed < bound)] = 1
      const projected = projectCampaignStorageReport(report)
      assert.deepEqual(projected, report); assert.equal(campaignStorageReportExitCode(projected), 0)
      projected.profiles[0].operationTiming.phases[0].histogram[0]++
      assert.equal(phase.histogram[0], elapsed < 1 ? 1 : 0); checks++
    }
    const report = structuredClone(passing), phase = report.profiles[0].operationTiming.phases[0]
    Object.assign(phase, { count: 4, success: 1, error: 1, abort: 1, timeout: 1, minMs: 0.25, maxMs: 3000 })
    phase.histogram.fill(0); phase.histogram[0] = 1; phase.histogram[1] = 2; phase.histogram[11] = 1
    assert.deepEqual(projectCampaignStorageReport(report), report); checks++
  }
  // Direct operation outcomes independently disqualify clean acceptance, even
  // when best-effort timeout diagnostics contain no event. Keep evidence intact.
  for (const source of [passing, browserPassing()]) {
    for (const index of [0, 1]) for (const phaseIndex of CAMPAIGN_TIMEOUT_PHASES.keys()) {
      for (const outcome of ['timeout', 'error', 'abort']) {
        const report = structuredClone(source), row = report.profiles[index], phase = row.operationTiming.phases[phaseIndex]
        Object.assign(phase, { count: 1, success: 0, error: 0, abort: 0, timeout: 0, minMs: 0.25, maxMs: 0.25, [outcome]: 1 })
        phase.histogram.fill(0); phase.histogram[0] = 1
        const projected = projectCampaignStorageReport(report)
        assert.deepEqual(projected, report)
        assert.equal(projected.profiles[index].status, 'pass')
        assert.equal(projected.profiles[index].timeoutDiagnostics.status, 'not_observed')
        assert.equal(campaignStorageReportExitCode(projected), 1); checks++
      }
    }
  }
  // Structural completion remains honest even when engineering observations
  // are missing or disqualifying. Neither condition may produce CLI exit zero.
  for (const source of [passing, browserPassing()]) {
    for (const index of [0, 1]) {
      for (const status of ['unavailable', 'not_collected']) {
        const report = structuredClone(source), row = report.profiles[index]
        row.memoryObservation = { status, method: status === 'unavailable' ? row.memoryObservation.method : null,
          samples: 0, baselineHeapUsedBytes: null, sampledPeakHeapUsedBytes: null, finalHeapUsedBytes: null }
        const projected = projectCampaignStorageReport(report)
        assert.deepEqual(projected, report)
        assert.equal(projected.profiles[index].status, 'pass')
        assert.equal(campaignStorageReportExitCode(projected), 1); checks++
      }
      for (const status of ['not_collected', 'collected']) {
        const missingOperations = structuredClone(source)
        missingOperations.profiles[index].operationTiming = emptyCampaignOperationTiming()
        missingOperations.profiles[index].operationTiming.status = status
        assert.deepEqual(projectCampaignStorageReport(missingOperations), missingOperations)
        assert.equal(campaignStorageReportExitCode(missingOperations), 1); checks++
      }
      const missingTiming = structuredClone(source)
      missingTiming.profiles[index].actionTiming = { status: 'not_collected', samples: 0, minMs: null, p50Ms: null, p95Ms: null, maxMs: null }
      assert.deepEqual(projectCampaignStorageReport(missingTiming), missingTiming)
      assert.equal(campaignStorageReportExitCode(missingTiming), 1); checks++
      for (const diagnostics of [
        { status: 'not_collected', events: [], overflow: 0 },
        diagnosticReport().profiles[0].timeoutDiagnostics,
        { status: 'observed', events: Array.from({ length: 8 }, () => structuredClone(diagnosticReport().profiles[0].timeoutDiagnostics.events[0])), overflow: 1 },
      ]) {
        const report = structuredClone(source)
        report.profiles[index].timeoutDiagnostics = diagnostics
        const projected = projectCampaignStorageReport(report)
        assert.deepEqual(projected, report)
        assert.equal(projected.profiles[index].status, 'pass')
        assert.equal(campaignStorageReportExitCode(projected), 1); checks++
      }
    }
    assert.equal(campaignStorageReportExitCode(source), 0); checks++
  }
  for (const mutate of [
    report => { report.proofBoundaries.pop() },
    report => { report.proofBoundaries[0].id = 'P07' },
    report => { report.proofBoundaries[1].id = 'P01' },
    report => { report.proofBoundaries.reverse() },
    report => { report.proofBoundaries[0].faultTriggered = 0 },
    report => { report.proofBoundaries[0].proofObserved = 0 },
    report => { report.proofBoundaries[0].coldReplayCount = 0 },
    report => { report.proofBoundaries[0].exactObservationCount = 0 },
    report => { report.proofBoundaries[0].exactObservedRecords = 0 },
    report => { report.proofBoundaries[0].proofInvalidations = 0 },
    report => { report.proofBoundaries[5].coldFallbacks = 0 },
    report => { report.proofBoundaries[0].restartOutcome = 'readable' },
    report => { report.proofBoundaries[3].restartOutcome = 'integrity_refused' },
    report => { report.proofBoundaries[3].restartOutcome = 'not_run' },
    report => { report.proofBoundaries[0].coldProcessReadCalls = 0 },
    report => { report.proofBoundaries[0].coldProcessReadMs = NaN },
    report => { report.proofBoundaries[0].coldProcessReadMs = -1 },
    report => { report.proofBoundaries[0].coldProcessReadBytes = 'PRIVATE_SOURCE_CANARY' },
    report => { report.proofBoundaries[0].status = 'not_run' },
    report => { report.proofBoundaries[0].faultTriggered = 2 },
    report => { report.proofBoundaries[0].proofObserved = 2 },
    report => { report.proofBoundaries[0].accountingMismatches = 1 },
    report => { report.proofBoundaries[0].raw = 'PRIVATE_SOURCE_CANARY' },
    report => { report.proofBoundaries[0].restartExpected = { raw: 'PRIVATE_SOURCE_CANARY' } },
    report => { report.proofBoundaries[0].error = 'PRIVATE_SOURCE_CANARY' },
    report => { report.proofBoundaries[0].stack = 'PRIVATE_SOURCE_CANARY' },
    report => { report.proofBoundaries[0].proofInvalidations = -1 },
    report => { report.proofBoundaries[0].coldFallbacks = 0.5 },
    report => { report.proofBoundaries[0].exactObservedRecords = Number.MAX_SAFE_INTEGER + 1 },
    report => { Object.setPrototypeOf(report.proofBoundaries[0], { raw: 'PRIVATE_SOURCE_CANARY' }) },
    report => { delete report.proofBoundaries[0] },
    report => { delete report.boundaries[0] },
    report => { delete report.profiles[0] },
    report => { report.proofBoundaries.raw = 'PRIVATE_SOURCE_CANARY' },
    report => { report.sourceSchemaVersion = 2 },
    report => { report.browserErrors = 1 },
    report => { report.blockedExternalRequests = 1 },
  ]) {
    const bad = browserPassing(); mutate(bad)
    assert.throws(() => campaignStorageReportExitCode(bad)); checks++
  }
  {
    const missing = browserPassing()
    missing.proofBoundaries[2] = structuredClone(fixture().proofBoundaries[2])
    assert.equal(campaignStorageReportExitCode(missing), 1)
    const invalidNode = structuredClone(passing); invalidNode.proofBoundaries = fixture().proofBoundaries
    assert.throws(() => projectCampaignStorageReport(invalidNode))
    const missingOldBoundary = browserPassing(); missingOldBoundary.boundaries[2].status = 'not_run'
    assert.equal(campaignStorageReportExitCode(missingOldBoundary), 1); checks++
  }
  // New proof rows retain lifecycle ownership, including late errors after result replacement.
  for (const kind of ['page_error', 'external_request']) {
    const report = browserPassing(), observation = beginStorageObservation(report, 'proofBoundary', 2)
    recordStorageBrowserEvent(report, observation, kind)
    report.proofBoundaries[2] = { ...report.proofBoundaries[2], status: 'pass', failureStage: null }
    finalizeStorageObservation(report, observation)
    assert.equal(report.proofBoundaries[2].status, 'fail')
    assert.equal(report.proofBoundaries[2].failureStage, kind === 'page_error' ? 'page_errors' : 'external_requests')
    assert.equal(campaignStorageReportExitCode(report), 1)
    assert.equal(projectCampaignStorageReport(report).proofBoundaries.length, 6); checks++
  }
  {
    const report = browserPassing(), old = beginStorageObservation(report, 'proofBoundary', 0), current = beginStorageObservation(report, 'proofBoundary', 1)
    recordStorageBrowserEvent(report, old, 'page_error'); finalizeStorageObservation(report, current)
    assert.equal(report.proofBoundaries[0].status, 'fail'); assert.equal(report.proofBoundaries[1].status, 'pass')
    assert.equal(campaignStorageReportExitCode(report), 1)
    failStorageObservation(report, old, 'teardown')
    assert.equal(report.proofBoundaries[0].failureStage, 'page_errors'); checks++
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
  assert.ok(profile.includes('try { return await engine.step(manifest.campaignId, commandId) }\n    finally {\n      const elapsed = Math.round(performance.now() - stepStarted)\n      maxStepMs = Math.max(maxStepMs, elapsed); actionTiming.record(elapsed)\n    }'), 'Step timer includes rejected steps and ends before subsequent inspection/progress persistence')
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
