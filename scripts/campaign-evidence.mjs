// Dedicated closed schema. Never recursively visit Campaign artifacts, request
// bodies, responses, backup data, error prose or unknown report fields.
import { CAMPAIGN_BROWSER_CASE_IDS, CAMPAIGN_PAGE_ERROR_CATEGORIES, CAMPAIGN_PAGE_ERROR_DIAGNOSTIC_LIMIT,
  isCampaignBrowserFailureStage } from './lib/writer-campaign-browser-diagnostics.mjs'
export const CAMPAIGN_REPORT_PATH = 'artifacts/browser-writer-campaign/report.json'
const ROOT_KEYS = ['schemaVersion', 'reportKind', 'commit', 'sourceTreeSha256', 'fixtureSha256',
  'instrumentationSha256', 'instrumentationDelta', 'denominator', 'cases', 'passed', 'failed',
  'notRun', 'realModelRequests', 'browserErrors', 'blockedExternalRequests', 'longformAcceptance',
  'pageErrorDiagnostics', 'pageErrorOverflow'].sort()
const ROW_KEYS = ['id', 'status', 'buildMode', 'fixtureDispatchEntries', 'failureStage', 'browserErrors'].sort()
const DIAGNOSTIC_KEYS = ['caseId', 'category', 'sha256'].sort()
const invalid = () => { throw new Error('Invalid closed Campaign evidence schema') }
const integer = value => Number.isSafeInteger(value) && value >= 0
const hex = (value, count) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${count}}$`).test(value)
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys)) invalid()
}

export function projectCampaignReport(input) {
  exact(input, ROOT_KEYS)
  if (input.schemaVersion !== 2 || input.reportKind !== 'campaign-browser-foundation'
    || input.denominator !== 12 || input.realModelRequests !== 0 || input.longformAcceptance !== 'NOT_RUN'
    || input.instrumentationDelta !== 'offline-host-observation-only-v1'
    || !hex(input.commit, 40)
    || !['sourceTreeSha256', 'fixtureSha256', 'instrumentationSha256'].every(key => hex(input[key], 64))
    || !['passed', 'failed', 'notRun', 'browserErrors', 'blockedExternalRequests', 'pageErrorOverflow'].every(key => integer(input[key]))
    || !Array.isArray(input.pageErrorDiagnostics) || input.pageErrorDiagnostics.length > CAMPAIGN_PAGE_ERROR_DIAGNOSTIC_LIMIT
    || !Array.isArray(input.cases) || input.cases.length !== 12) invalid()
  const cases = input.cases.map((row, index) => {
    exact(row, ROW_KEYS)
    const production = index < 3
    if (row.id !== `C${String(index + 1).padStart(2, '0')}` || !['pass', 'fail', 'not_run'].includes(row.status)
      || row.buildMode !== (production ? 'production' : 'test_instrumented_offline_host')
      || (production ? row.fixtureDispatchEntries !== null : !integer(row.fixtureDispatchEntries))
      || !integer(row.browserErrors)
      || (row.status === 'fail' ? !isCampaignBrowserFailureStage(row.id, row.failureStage) : row.failureStage !== null)
      || (row.status === 'pass' && row.browserErrors !== 0)) invalid()
    return { id: row.id, status: row.status, buildMode: row.buildMode, fixtureDispatchEntries: row.fixtureDispatchEntries,
      failureStage: row.failureStage, browserErrors: row.browserErrors }
  })
  for (const [field, status] of [['passed', 'pass'], ['failed', 'fail'], ['notRun', 'not_run']]) {
    if (input[field] !== cases.filter(row => row.status === status).length) invalid()
  }
  if (input.passed === 12 && (input.browserErrors || input.blockedExternalRequests)) invalid()
  const pageErrorDiagnostics = input.pageErrorDiagnostics.map(row => {
    exact(row, DIAGNOSTIC_KEYS)
    if (!(row.caseId === null || CAMPAIGN_BROWSER_CASE_IDS.includes(row.caseId))
      || !CAMPAIGN_PAGE_ERROR_CATEGORIES.includes(row.category) || !hex(row.sha256, 64)) invalid()
    return { caseId: row.caseId, category: row.category, sha256: row.sha256 }
  })
  if (pageErrorDiagnostics.length + input.pageErrorOverflow !== input.browserErrors) invalid()
  if (input.pageErrorOverflow > 0 && pageErrorDiagnostics.length !== CAMPAIGN_PAGE_ERROR_DIAGNOSTIC_LIMIT) invalid()
  const attributed = cases.reduce((total, row) => total + row.browserErrors, 0)
  if (attributed > input.browserErrors) invalid()
  for (const row of cases) {
    if (pageErrorDiagnostics.filter(error => error.caseId === row.id).length > row.browserErrors) invalid()
  }
  if (pageErrorDiagnostics.filter(error => error.caseId === null).length > input.browserErrors - attributed) invalid()
  return {
    schemaVersion: 2, reportKind: 'campaign-browser-foundation', commit: input.commit,
    sourceTreeSha256: input.sourceTreeSha256, fixtureSha256: input.fixtureSha256,
    instrumentationSha256: input.instrumentationSha256, instrumentationDelta: input.instrumentationDelta,
    denominator: 12, cases, passed: input.passed, failed: input.failed, notRun: input.notRun,
    realModelRequests: 0, browserErrors: input.browserErrors, blockedExternalRequests: input.blockedExternalRequests,
    pageErrorDiagnostics, pageErrorOverflow: input.pageErrorOverflow,
    longformAcceptance: 'NOT_RUN',
  }
}

// Separate storage evidence schema. Nothing is widened in the frozen C01–C12 schema above.
export const CAMPAIGN_STORAGE_REPORT_PATH = 'artifacts/browser-writer-campaign-storage/report.json'
export const CAMPAIGN_CAPACITY_NODE_REPORT_PATH = 'artifacts/campaign-capacity-node/report.json'
export const CAMPAIGN_STORAGE_BOUNDARIES = Object.freeze(['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08'])
export const CAMPAIGN_PROOF_BOUNDARIES = Object.freeze(['P01', 'P02', 'P03', 'P04', 'P05', 'P06'])
export const CAMPAIGN_STORAGE_FAILURE_STAGES = Object.freeze(['setup', 'prepare', 'exercise', 'restart', 'accounting', 'replay', 'complete', 'page_errors', 'external_requests', 'teardown'])
const LEGACY_STORAGE_ROOT_KEYS = ['schemaVersion', 'reportKind', 'commit', 'sourceTreeSha256', 'harnessSha256', 'buildSha256', 'environment', 'buildMode', 'readAccounting', 'baselineReadAccounting', 'geometry', 'baselineV1', 'boundaries', 'profiles', 'browserErrors', 'blockedExternalRequests', 'realModelRequests', 'longformAcceptance'].sort()
const STORAGE_ROOT_KEYS = [...LEGACY_STORAGE_ROOT_KEYS, 'sourceSchemaVersion', 'proofBoundaries'].sort()
const GEOMETRY = { version: 'synthetic-storage-geometry-60x16667-v1', plannedTasks: 123, plannedBodyTasks: 60, targetBodyScalars: 1_000_000, storageCeilingBytes: 67_108_864, recoveryReserveBytes: 524_288 }
const BASELINE = { zh: { committedBodyScalars: 200_004, completedTasks: 28, cumulativeWrittenBytes: 6_346_657, permanentStorageReservationBytes: 66_456_411, totalReadBytes: 570_635_858, totalReadCalls: 10_577 }, en: { committedBodyScalars: 350_007, completedTasks: 46, cumulativeWrittenBytes: 6_618_786, permanentStorageReservationBytes: 65_625_495, totalReadBytes: 997_803_343, totalReadCalls: 26_957 } }
const PROFILE_NUMBERS = ['committedBodyScalars', 'committedTasks', 'actualFixtureInvocations', 'reservedAttempts', 'committedOperations', 'cumulativeWrittenBytes', 'cumulativeAllocatedBytes', 'allocationConsumedBytes', 'outstandingBytes', 'peakOutstandingBytes', 'releasedBytes', 'recoveryRemainingBytes', 'openAllocations', 'liveRecordCount', 'liveSerializedMapBytes', 'cumulativeActiveReservationMs', 'totalReadBytes', 'totalReadCalls', 'maxReadBatchKeys', 'maxReadBatchBytes', 'coldRepositoryReadMs', 'coldRepositoryReadBytes', 'coldRepositoryReadCalls', 'coldProcessReadMs', 'coldProcessReadBytes', 'coldProcessReadCalls', 'executionMs', 'maxStepMs', 'accountingMismatches', 'committedTransactions']
const LEGACY_PROFILE_KEYS = ['language', 'status', 'blockerCode', 'execution', 'coldProcessRestart', 'liveBytesByRecordKind', ...PROFILE_NUMBERS].sort()
const V2_PROFILE_KEYS = [...LEGACY_PROFILE_KEYS, 'timeoutDiagnostics'].sort()
const PROFILE_KEYS = [...V2_PROFILE_KEYS, 'actionProof', 'memoryObservation', 'actionTiming', 'operationTiming'].sort()
const RECORD_KINDS = ['catalog', 'manifest', 'head', 'checkpoint', 'receipt', 'request', 'artifact'].sort()
const STORAGE_CODES = ['budget', 'storage_budget_exhausted', 'budget_exhausted', 'active_budget_exhausted', 'operation_timeout', 'storage_unknown', 'integrity', 'conflict', 'local_stopped', 'profile_failure', 'dispatch_outcome_unknown', 'deadline', 'clock_rollback']
const BOUNDARY_KEYS = ['id', 'status', 'failureStage', 'fixtureDispatchEntries', 'committedTransactions', 'cumulativeWrittenBytes', 'outstandingBytes', 'releasedBytes', 'accountingMismatches'].sort()
const PROOF_BOUNDARY_COUNTERS = ['faultTriggered', 'proofObserved', 'coldReplayCount', 'exactObservationCount', 'exactObservedRecords', 'proofInvalidations', 'coldFallbacks', 'coldProcessReadBytes', 'coldProcessReadCalls']
const PROOF_BOUNDARY_KEYS = [...BOUNDARY_KEYS, ...PROOF_BOUNDARY_COUNTERS, 'restartOutcome', 'coldProcessReadMs'].sort()
function storageExact(value, keys) {
  exact(value, keys)
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Reflect.ownKeys(value).length !== keys.length
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !('value' in descriptor))) invalid()
}
function storageArray(value, length) {
  return Array.isArray(value) && (length === undefined || value.length === length)
    && Object.getPrototypeOf(value) === Array.prototype && Reflect.ownKeys(value).length === value.length + 1
    && Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index)))
      .every(descriptor => descriptor && 'value' in descriptor)
}
function fixedObject(input, expected) {
  storageExact(input, Object.keys(expected).sort())
  for (const key of Object.keys(expected)) {
    if (expected[key] && typeof expected[key] === 'object') fixedObject(input[key], expected[key])
    else if (input[key] !== expected[key]) invalid()
  }
  return structuredClone(expected)
}
// These closed diagnostic fields are observations only, never Campaign payloads.
export const CAMPAIGN_STORAGE_TIMEOUT_PHASES = Object.freeze(['read', 'receipt', 'commit', 'prepare', 'dispatch', 'reconcile', 'save', 'recovery_read', 'recovery_receipt', 'recovery_commit'])
const TIMEOUT_KEYS = ['status', 'events', 'overflow'].sort()
const TIMEOUT_EVENT_KEYS = ['phase', 'trigger', 'selectedBudget', 'operationTimeoutMs', 'actionTimeoutMs', 'actionRemainingMs', 'scheduledTimeoutMs', 'operationElapsedMs', 'actionElapsedMs'].sort()
const duration = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
const uncollectedTimeoutDiagnostics = () => ({ status: 'not_collected', events: [], overflow: 0 })
function projectTimeoutDiagnostics(input) {
  storageExact(input, TIMEOUT_KEYS)
  if (!['not_collected', 'not_observed', 'observed'].includes(input.status)
    || !storageArray(input.events) || input.events.length > 8 || !integer(input.overflow)
    || (input.status === 'observed' ? input.events.length === 0 : input.events.length !== 0 || input.overflow !== 0)
    || (input.overflow > 0 && input.events.length !== 8)) invalid()
  const events = input.events.map(event => {
    storageExact(event, TIMEOUT_EVENT_KEYS)
    if (!CAMPAIGN_STORAGE_TIMEOUT_PHASES.includes(event.phase)
      || !['timer', 'action_deadline_check'].includes(event.trigger)
      || !['operation', 'action', 'tie'].includes(event.selectedBudget)) invalid()
    if (event.trigger === 'action_deadline_check') {
      if (event.selectedBudget !== 'action' || event.operationTimeoutMs !== null || event.actionTimeoutMs !== 10_000
        || event.actionRemainingMs !== null || event.scheduledTimeoutMs !== null || event.operationElapsedMs !== null
        || !duration(event.actionElapsedMs) || event.actionElapsedMs < 10_000) invalid()
    } else {
      // Profile producers use the unchanged production limits, not virtual or
      // raised deadlines. Keep elapsed values exact rather than rounding them.
      if (event.operationTimeoutMs !== (event.phase === 'dispatch' ? 5_000 : 3_000)
        || !duration(event.scheduledTimeoutMs) || !duration(event.operationElapsedMs)) invalid()
      if (event.actionTimeoutMs === null) {
        if (event.actionRemainingMs !== null || event.actionElapsedMs !== null
          || event.selectedBudget !== 'operation' || event.scheduledTimeoutMs !== event.operationTimeoutMs) invalid()
      } else {
        if (event.actionTimeoutMs !== 10_000 || !duration(event.actionRemainingMs) || event.actionRemainingMs > 10_000
          || !duration(event.actionElapsedMs) || event.operationElapsedMs > event.actionElapsedMs
          || event.actionElapsedMs < 10_000 - event.actionRemainingMs
          || event.scheduledTimeoutMs !== Math.min(event.operationTimeoutMs, event.actionRemainingMs)
          || event.selectedBudget !== (event.operationTimeoutMs < event.actionRemainingMs ? 'operation' : event.operationTimeoutMs > event.actionRemainingMs ? 'action' : 'tie')) invalid()
      }
    }
    return Object.fromEntries(TIMEOUT_EVENT_KEYS.map(key => [key, event[key]]))
  })
  return { status: input.status, events, overflow: input.overflow }
}
const ACTION_PROOF_KEYS = ['status', 'stats'].sort()
const PROOF_COUNTERS = ['admittedScopes', 'fallbackScopes', 'disposedScopes', 'coldReplays', 'coldReplaysCompleted', 'exactPasses', 'exactRecords', 'exactBytes', 'transitions', 'retainedBytes', 'retainedEntries', 'peakRetainedBytes', 'peakRetainedEntries', 'activeRecords', 'peakActiveRecords']
const PROOF_DURATIONS = ['coldMs', 'coldMaxMs', 'exactMs', 'exactMaxMs']
const PROOF_REASONS = ['completed', 'capacity', 'admission', 'concurrent', 'mismatch', 'conflict', 'error', 'replay'].sort()
const PROOF_STATS_KEYS = [...PROOF_COUNTERS, ...PROOF_DURATIONS, 'disposalReasons'].sort()
const MEMORY_KEYS = ['status', 'method', 'samples', 'baselineHeapUsedBytes', 'sampledPeakHeapUsedBytes', 'finalHeapUsedBytes'].sort()
const ACTION_TIMING_KEYS = ['status', 'samples', 'minMs', 'p50Ms', 'p95Ms', 'maxMs'].sort()
const ACTION_TIMING_DURATIONS = ['minMs', 'p50Ms', 'p95Ms', 'maxMs']
const OPERATION_TIMING_KEYS = ['status', 'phases'].sort()
const OPERATION_PHASE_KEYS = ['phase', 'count', 'success', 'error', 'abort', 'timeout', 'minMs', 'maxMs', 'histogram'].sort()
const OPERATION_OUTCOMES = ['success', 'error', 'abort', 'timeout']
const OPERATION_UPPER_BOUNDS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 3000, 5000, 10000, Infinity]
const MEMORY_BYTES = ['baselineHeapUsedBytes', 'sampledPeakHeapUsedBytes', 'finalHeapUsedBytes']
export const emptyCampaignActionProof = () => ({ status: 'not_collected', stats: null })
export const emptyCampaignMemoryObservation = () => ({ status: 'not_collected', method: null, samples: 0, baselineHeapUsedBytes: null, sampledPeakHeapUsedBytes: null, finalHeapUsedBytes: null })
export const emptyCampaignActionTiming = () => ({ status: 'not_collected', samples: 0, minMs: null, p50Ms: null, p95Ms: null, maxMs: null })
export const emptyCampaignOperationTiming = () => ({ status: 'not_collected', phases: CAMPAIGN_STORAGE_TIMEOUT_PHASES.map(phase => ({
  phase, count: 0, success: 0, error: 0, abort: 0, timeout: 0, minMs: null, maxMs: null, histogram: Array(OPERATION_UPPER_BOUNDS.length).fill(0),
})) })
function projectOperationTiming(input) {
  storageExact(input, OPERATION_TIMING_KEYS)
  if (!['collected', 'not_collected'].includes(input.status) || !storageArray(input.phases, CAMPAIGN_STORAGE_TIMEOUT_PHASES.length)) invalid()
  const phases = input.phases.map((row, index) => {
    storageExact(row, OPERATION_PHASE_KEYS)
    if (row.phase !== CAMPAIGN_STORAGE_TIMEOUT_PHASES[index] || !integer(row.count)
      || !OPERATION_OUTCOMES.every(key => integer(row[key])) || OPERATION_OUTCOMES.reduce((sum, key) => sum + row[key], 0) !== row.count
      || !storageArray(row.histogram, OPERATION_UPPER_BOUNDS.length) || !row.histogram.every(integer)
      || row.histogram.reduce((sum, count) => sum + count, 0) !== row.count
      || (input.status === 'not_collected' && row.count !== 0)) invalid()
    if (row.count === 0) {
      if (row.minMs !== null || row.maxMs !== null) invalid()
    } else if (!duration(row.minMs) || !duration(row.maxMs) || row.minMs > row.maxMs
      || row.histogram.findIndex(count => count > 0) !== OPERATION_UPPER_BOUNDS.findIndex(bound => row.minMs < bound)
      || row.histogram.findLastIndex(count => count > 0) !== OPERATION_UPPER_BOUNDS.findIndex(bound => row.maxMs < bound)) invalid()
    return { ...Object.fromEntries(OPERATION_PHASE_KEYS.filter(key => key !== 'histogram').map(key => [key, row[key]])), histogram: [...row.histogram] }
  })
  return { status: input.status, phases }
}
function projectActionTiming(input) {
  storageExact(input, ACTION_TIMING_KEYS)
  if (!['collected', 'not_collected'].includes(input.status) || !integer(input.samples)) invalid()
  if (input.status === 'not_collected') {
    if (input.samples !== 0 || ACTION_TIMING_DURATIONS.some(key => input[key] !== null)) invalid()
    return emptyCampaignActionTiming()
  }
  if (input.samples === 0 || !ACTION_TIMING_DURATIONS.every(key => integer(input[key]))
    || input.minMs > input.p50Ms || input.p50Ms > input.p95Ms || input.p95Ms > input.maxMs) invalid()
  return Object.fromEntries(ACTION_TIMING_KEYS.map(key => [key, input[key]]))
}
function projectActionProof(input) {
  storageExact(input, ACTION_PROOF_KEYS)
  if (!['collected', 'not_collected'].includes(input.status)) invalid()
  if (input.status === 'not_collected') {
    if (input.stats !== null) invalid()
    return emptyCampaignActionProof()
  }
  const stats = input.stats
  storageExact(stats, PROOF_STATS_KEYS); storageExact(stats.disposalReasons, PROOF_REASONS)
  if (!PROOF_COUNTERS.every(key => integer(stats[key])) || !PROOF_DURATIONS.every(key => duration(stats[key]))
    || !PROOF_REASONS.every(key => integer(stats.disposalReasons[key]))
    || stats.coldReplaysCompleted > stats.coldReplays || stats.exactPasses > stats.exactRecords
    || stats.exactRecords > stats.exactBytes || stats.coldMaxMs > stats.coldMs || stats.exactMaxMs > stats.exactMs
    || stats.retainedBytes > stats.peakRetainedBytes || stats.peakRetainedBytes > GEOMETRY.storageCeilingBytes
    || stats.retainedEntries > stats.peakRetainedEntries || stats.peakRetainedEntries > 8193
    || stats.activeRecords > stats.peakActiveRecords || stats.peakActiveRecords > 512
    || stats.disposedScopes !== Math.min(Number.MAX_SAFE_INTEGER, PROOF_REASONS.reduce((sum, key) => sum + stats.disposalReasons[key], 0))) invalid()
  return { status: 'collected', stats: { ...Object.fromEntries(PROOF_STATS_KEYS.filter(key => key !== 'disposalReasons').map(key => [key, stats[key]])), disposalReasons: Object.fromEntries(PROOF_REASONS.map(key => [key, stats.disposalReasons[key]])) } }
}
function projectMemoryObservation(input, environment) {
  storageExact(input, MEMORY_KEYS)
  if (!['collected', 'unavailable', 'not_collected'].includes(input.status) || !integer(input.samples)) invalid()
  if (input.status === 'not_collected') {
    if (input.method !== null || input.samples !== 0 || MEMORY_BYTES.some(key => input[key] !== null)) invalid()
    return emptyCampaignMemoryObservation()
  }
  if (input.method !== (environment === 'browser-native-idb' ? 'chromium_performance_memory_samples' : 'node_process_samples')) invalid()
  if (input.status === 'unavailable') {
    if (input.samples !== 0 || MEMORY_BYTES.some(key => input[key] !== null)) invalid()
  } else if (input.samples < 2 || !MEMORY_BYTES.every(key => integer(input[key]))
    || input.sampledPeakHeapUsedBytes < input.baselineHeapUsedBytes || input.sampledPeakHeapUsedBytes < input.finalHeapUsedBytes) invalid()
  return Object.fromEntries(MEMORY_KEYS.map(key => [key, input[key]]))
}
export function emptyCampaignProofBoundary(id) {
  return { id, status: 'not_run', failureStage: null, fixtureDispatchEntries: 0, committedTransactions: 0, cumulativeWrittenBytes: 0, outstandingBytes: 0, releasedBytes: 0, accountingMismatches: 0,
    ...Object.fromEntries(PROOF_BOUNDARY_COUNTERS.map(key => [key, 0])), restartOutcome: 'not_run', coldProcessReadMs: 0 }
}
function projectProofBoundary(row, index) {
  storageExact(row, PROOF_BOUNDARY_KEYS)
  if (row.id !== CAMPAIGN_PROOF_BOUNDARIES[index] || !['pass', 'fail', 'not_run'].includes(row.status)
    || (row.status === 'fail' ? !CAMPAIGN_STORAGE_FAILURE_STAGES.includes(row.failureStage) : row.failureStage !== null)
    || ![...BOUNDARY_KEYS.filter(key => !['id', 'status', 'failureStage'].includes(key)), ...PROOF_BOUNDARY_COUNTERS].every(key => integer(row[key]))
    || ![0, 1].includes(row.faultTriggered) || ![0, 1].includes(row.proofObserved) || !duration(row.coldProcessReadMs)
    || !['not_run', 'readable', 'integrity_refused'].includes(row.restartOutcome)
    || (row.restartOutcome === 'not_run' && (row.coldProcessReadMs || row.coldProcessReadBytes || row.coldProcessReadCalls))
    || (row.status === 'not_run' && (row.restartOutcome !== 'not_run' || [...BOUNDARY_KEYS.filter(key => !['id', 'status', 'failureStage'].includes(key)), ...PROOF_BOUNDARY_COUNTERS].some(key => row[key] !== 0)))
    || (row.status === 'pass' && (row.faultTriggered !== 1 || row.proofObserved !== 1 || row.coldReplayCount === 0
      || row.exactObservationCount === 0 || row.exactObservedRecords === 0 || (index === 5 && row.coldFallbacks === 0) || row.proofInvalidations === 0 || row.coldProcessReadCalls === 0
      || row.restartOutcome !== (index < 3 ? 'integrity_refused' : 'readable') || row.accountingMismatches !== 0))) invalid()
  return Object.fromEntries(PROOF_BOUNDARY_KEYS.map(key => [key, row[key]]))
}
export function emptyCampaignStorageProfile(language) {
  return { language, status: 'not_run', blockerCode: null, execution: 'not_run', coldProcessRestart: 'not_run', timeoutDiagnostics: uncollectedTimeoutDiagnostics(), actionProof: emptyCampaignActionProof(), memoryObservation: emptyCampaignMemoryObservation(), actionTiming: emptyCampaignActionTiming(), operationTiming: emptyCampaignOperationTiming(), ...Object.fromEntries(PROFILE_NUMBERS.map(key => [key, 0])), liveBytesByRecordKind: Object.fromEntries(RECORD_KINDS.map(key => [key, 0])) }
}
export function projectCampaignStorageReport(input) {
  storageExact(input, input?.schemaVersion === 3 ? STORAGE_ROOT_KEYS : LEGACY_STORAGE_ROOT_KEYS)
  if (![1, 2, 3].includes(input.schemaVersion) || input.reportKind !== 'campaign-storage-v2' || !hex(input.commit, 40)
    || !['sourceTreeSha256', 'harnessSha256', 'buildSha256'].every(key => hex(input[key], 64))
    || !['node-injected-atomic-io-not-browser-idb', 'browser-native-idb'].includes(input.environment)
    || input.buildMode !== (input.environment === 'browser-native-idb' ? 'test_driver_production_modules' : 'node_typescript_production_modules')
    || input.readAccounting !== (input.environment === 'browser-native-idb' ? 'native_idb_get_transactions_including_cas_and_aborts' : 'repository_getMany_only')
    || input.baselineReadAccounting !== 'historical_node_repository_getMany_only'
    || input.realModelRequests !== 0 || input.longformAcceptance !== 'NOT_RUN'
    || !integer(input.browserErrors) || !integer(input.blockedExternalRequests)) invalid()
  const sourceSchemaVersion = input.schemaVersion === 3 ? input.sourceSchemaVersion : input.schemaVersion
  if (![1, 2, 3].includes(sourceSchemaVersion)) invalid()
  const geometry = fixedObject(input.geometry, GEOMETRY), baselineV1 = fixedObject(input.baselineV1, BASELINE)
  if (!storageArray(input.boundaries, input.environment === 'browser-native-idb' ? 8 : 0)
    || !storageArray(input.profiles, 2)) invalid()
  const boundaries = input.boundaries.map((row, index) => {
    storageExact(row, BOUNDARY_KEYS)
    if (row.id !== CAMPAIGN_STORAGE_BOUNDARIES[index] || !['pass', 'fail', 'not_run'].includes(row.status)
      || (row.status === 'fail' ? !CAMPAIGN_STORAGE_FAILURE_STAGES.includes(row.failureStage) : row.failureStage !== null)
      || !BOUNDARY_KEYS.filter(key => !['id', 'status', 'failureStage'].includes(key)).every(key => integer(row[key]))
      || (row.status === 'pass' && row.accountingMismatches !== 0)) invalid()
    return Object.fromEntries(BOUNDARY_KEYS.map(key => [key, row[key]]))
  })
  const proofInput = input.schemaVersion < 3 ? (input.environment === 'browser-native-idb' ? CAMPAIGN_PROOF_BOUNDARIES.map(emptyCampaignProofBoundary) : []) : input.proofBoundaries
  if (!storageArray(proofInput, input.environment === 'browser-native-idb' ? 6 : 0)) invalid()
  const proofBoundaries = proofInput.map(projectProofBoundary)
  if (sourceSchemaVersion < 3 && proofBoundaries.some(row => row.status !== 'not_run')) invalid()
  const profiles = input.profiles.map((row, index) => {
    storageExact(row, input.schemaVersion === 1 ? LEGACY_PROFILE_KEYS : input.schemaVersion === 2 ? V2_PROFILE_KEYS : PROFILE_KEYS); storageExact(row.liveBytesByRecordKind, RECORD_KINDS)
    // Legacy projection is a derived upgrade, not a newly collected observation.
    const timeoutDiagnostics = input.schemaVersion === 1 ? uncollectedTimeoutDiagnostics() : projectTimeoutDiagnostics(row.timeoutDiagnostics)
    const actionProof = input.schemaVersion < 3 ? emptyCampaignActionProof() : projectActionProof(row.actionProof)
    const memoryObservation = input.schemaVersion < 3 ? emptyCampaignMemoryObservation() : projectMemoryObservation(row.memoryObservation, input.environment)
    const actionTiming = input.schemaVersion < 3 ? emptyCampaignActionTiming() : projectActionTiming(row.actionTiming)
    const operationTiming = input.schemaVersion < 3 ? emptyCampaignOperationTiming() : projectOperationTiming(row.operationTiming)
    if ((sourceSchemaVersion === 1 && timeoutDiagnostics.status !== 'not_collected')
      || (sourceSchemaVersion < 3 && (actionProof.status !== 'not_collected' || memoryObservation.status !== 'not_collected' || actionTiming.status !== 'not_collected' || operationTiming.status !== 'not_collected'))) invalid()
    if (row.language !== ['zh', 'en'][index] || !['pass', 'refused', 'timeout', 'fail', 'not_run', 'running'].includes(row.status)
      || !(row.blockerCode === null || STORAGE_CODES.includes(row.blockerCode))
      || !['not_applicable', 'not_run', 'verified', 'failed'].includes(row.coldProcessRestart)
      || (input.environment === 'node-injected-atomic-io-not-browser-idb' && !['not_applicable', 'not_run'].includes(row.coldProcessRestart))
      || !['prepared', 'running', 'paused', 'blocked', 'cancelled', 'completed', 'not_run'].includes(row.execution)
      || !PROFILE_NUMBERS.every(key => integer(row[key])) || !RECORD_KINDS.every(key => integer(row.liveBytesByRecordKind[key]))
      || row.liveSerializedMapBytes !== Object.values(row.liveBytesByRecordKind).reduce((sum, n) => sum + n, 0)
      || row.cumulativeAllocatedBytes - row.allocationConsumedBytes - row.releasedBytes !== row.outstandingBytes
      || row.allocationConsumedBytes > row.cumulativeWrittenBytes || row.liveSerializedMapBytes > row.cumulativeWrittenBytes
      || (['not_applicable', 'not_run'].includes(row.coldProcessRestart) && (row.coldProcessReadMs || row.coldProcessReadBytes || row.coldProcessReadCalls))
      || row.peakOutstandingBytes < row.outstandingBytes
      || row.cumulativeWrittenBytes + row.outstandingBytes + row.recoveryRemainingBytes > GEOMETRY.storageCeilingBytes
      || row.openAllocations > 128 || row.committedTasks > 123 || row.committedBodyScalars > 1_000_000
      || row.maxReadBatchKeys > 33 || row.recoveryRemainingBytes > GEOMETRY.recoveryReserveBytes) invalid()
    if (row.status === 'pass' && (row.execution !== 'completed' || row.blockerCode !== null || row.committedBodyScalars !== 1_000_000
      || row.committedTasks !== 123 || row.actualFixtureInvocations !== 123 || row.reservedAttempts !== 123 || row.committedOperations !== 494
      || row.committedTransactions !== 494 || row.cumulativeWrittenBytes === 0 || row.liveRecordCount === 0 || row.totalReadCalls === 0 || row.coldRepositoryReadCalls === 0
      || row.outstandingBytes !== 0 || row.openAllocations !== 0 || row.accountingMismatches !== 0
      || row.coldProcessRestart !== (input.environment === 'browser-native-idb' ? 'verified' : 'not_applicable')
      || (input.environment === 'browser-native-idb' && row.coldProcessReadCalls === 0))) invalid()
    if (actionTiming.status === 'collected' && (actionTiming.maxMs !== row.maxStepMs || (row.status === 'pass' && actionTiming.samples !== 123))) invalid()
    if (sourceSchemaVersion === 3 && row.status === 'pass' && (actionProof.status !== 'collected' || actionProof.stats.admittedScopes === 0
      || actionProof.stats.exactPasses === 0 || actionProof.stats.retainedBytes !== 0 || actionProof.stats.retainedEntries !== 0 || actionProof.stats.activeRecords !== 0)) invalid()
    if (row.status === 'not_run' && (row.execution !== 'not_run' || row.blockerCode !== null || PROFILE_NUMBERS.some(key => row[key] !== 0) || timeoutDiagnostics.status !== 'not_collected' || actionProof.status !== 'not_collected' || memoryObservation.status !== 'not_collected' || actionTiming.status !== 'not_collected' || operationTiming.status !== 'not_collected')) invalid()
    return { ...Object.fromEntries(LEGACY_PROFILE_KEYS.filter(key => key !== 'liveBytesByRecordKind').map(key => [key, row[key]])), timeoutDiagnostics, actionProof, memoryObservation, actionTiming, operationTiming, liveBytesByRecordKind: Object.fromEntries(RECORD_KINDS.map(key => [key, row.liveBytesByRecordKind[key]])) }
  })
  if (input.buildSha256 === '0'.repeat(64) && (profiles.some(row => row.status === 'pass') || boundaries.some(row => row.status === 'pass') || proofBoundaries.some(row => row.status === 'pass'))) invalid()
  if (profiles.every(row => row.status === 'pass') && boundaries.every(row => row.status === 'pass')
    && (sourceSchemaVersion < 3 || proofBoundaries.every(row => row.status === 'pass')) && (input.browserErrors || input.blockedExternalRequests)) invalid()
  return { ...Object.fromEntries(LEGACY_STORAGE_ROOT_KEYS.filter(key => !['geometry', 'baselineV1', 'boundaries', 'profiles'].includes(key)).map(key => [key, input[key]])), schemaVersion: 3, sourceSchemaVersion, geometry, baselineV1, boundaries, proofBoundaries, profiles }
}

/** Both CLI producers use this engineering gate. A completed structural profile
 * may retain unavailable observations, but cannot pass the measured acceptance
 * gate without collected heap/action/operation timing observations and collected, empty timeout diagnostics. */
export function campaignStorageReportExitCode(input) {
  const report = projectCampaignStorageReport(input)
  return report.sourceSchemaVersion === 3 && report.profiles.every(row => row.status === 'pass'
    && row.memoryObservation.status === 'collected' && row.actionTiming.status === 'collected'
    && row.operationTiming.status === 'collected' && row.operationTiming.phases.some(phase => phase.count > 0)
    && row.operationTiming.phases.every(phase => phase.timeout === 0 && phase.error === 0 && phase.abort === 0)
    && row.actionTiming.samples === 123 && row.actionTiming.maxMs === row.maxStepMs && row.timeoutDiagnostics.status === 'not_observed'
    && row.timeoutDiagnostics.events.length === 0 && row.timeoutDiagnostics.overflow === 0)
    && report.boundaries.every(row => row.status === 'pass') && report.proofBoundaries.every(row => row.status === 'pass')
    && report.browserErrors === 0 && report.blockedExternalRequests === 0 ? 0 : 1
}
