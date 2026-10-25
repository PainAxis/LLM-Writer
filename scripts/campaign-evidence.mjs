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

// Separate v2 report. Nothing is widened in the frozen C01–C12 schema above.
export const CAMPAIGN_STORAGE_REPORT_PATH = 'artifacts/browser-writer-campaign-storage/report.json'
export const CAMPAIGN_CAPACITY_NODE_REPORT_PATH = 'artifacts/campaign-capacity-node/report.json'
export const CAMPAIGN_STORAGE_BOUNDARIES = Object.freeze(['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08'])
export const CAMPAIGN_STORAGE_FAILURE_STAGES = Object.freeze(['setup', 'prepare', 'exercise', 'restart', 'accounting', 'replay', 'complete', 'page_errors', 'external_requests', 'teardown'])
const STORAGE_ROOT_KEYS = ['schemaVersion', 'reportKind', 'commit', 'sourceTreeSha256', 'harnessSha256', 'buildSha256', 'environment', 'buildMode', 'readAccounting', 'baselineReadAccounting', 'geometry', 'baselineV1', 'boundaries', 'profiles', 'browserErrors', 'blockedExternalRequests', 'realModelRequests', 'longformAcceptance'].sort()
const GEOMETRY = { version: 'synthetic-storage-geometry-60x16667-v1', plannedTasks: 123, plannedBodyTasks: 60, targetBodyScalars: 1_000_000, storageCeilingBytes: 67_108_864, recoveryReserveBytes: 524_288 }
const BASELINE = { zh: { committedBodyScalars: 200_004, completedTasks: 28, cumulativeWrittenBytes: 6_346_657, permanentStorageReservationBytes: 66_456_411, totalReadBytes: 570_635_858, totalReadCalls: 10_577 }, en: { committedBodyScalars: 350_007, completedTasks: 46, cumulativeWrittenBytes: 6_618_786, permanentStorageReservationBytes: 65_625_495, totalReadBytes: 997_803_343, totalReadCalls: 26_957 } }
const PROFILE_NUMBERS = ['committedBodyScalars', 'committedTasks', 'actualFixtureInvocations', 'reservedAttempts', 'committedOperations', 'cumulativeWrittenBytes', 'cumulativeAllocatedBytes', 'allocationConsumedBytes', 'outstandingBytes', 'peakOutstandingBytes', 'releasedBytes', 'recoveryRemainingBytes', 'openAllocations', 'liveRecordCount', 'liveSerializedMapBytes', 'cumulativeActiveReservationMs', 'totalReadBytes', 'totalReadCalls', 'maxReadBatchKeys', 'maxReadBatchBytes', 'coldRepositoryReadMs', 'coldRepositoryReadBytes', 'coldRepositoryReadCalls', 'coldProcessReadMs', 'coldProcessReadBytes', 'coldProcessReadCalls', 'executionMs', 'maxStepMs', 'accountingMismatches', 'committedTransactions']
const PROFILE_KEYS = ['language', 'status', 'blockerCode', 'execution', 'coldProcessRestart', 'liveBytesByRecordKind', ...PROFILE_NUMBERS].sort()
const RECORD_KINDS = ['catalog', 'manifest', 'head', 'checkpoint', 'receipt', 'request', 'artifact'].sort()
const STORAGE_CODES = ['budget', 'storage_budget_exhausted', 'budget_exhausted', 'active_budget_exhausted', 'operation_timeout', 'storage_unknown', 'integrity', 'conflict', 'local_stopped', 'profile_failure', 'dispatch_outcome_unknown', 'deadline', 'clock_rollback']
const BOUNDARY_KEYS = ['id', 'status', 'failureStage', 'fixtureDispatchEntries', 'committedTransactions', 'cumulativeWrittenBytes', 'outstandingBytes', 'releasedBytes', 'accountingMismatches'].sort()
function fixedObject(input, expected) {
  exact(input, Object.keys(expected).sort())
  for (const key of Object.keys(expected)) {
    if (expected[key] && typeof expected[key] === 'object') fixedObject(input[key], expected[key])
    else if (input[key] !== expected[key]) invalid()
  }
  return structuredClone(expected)
}
export function emptyCampaignStorageProfile(language) {
  return { language, status: 'not_run', blockerCode: null, execution: 'not_run', coldProcessRestart: 'not_run', ...Object.fromEntries(PROFILE_NUMBERS.map(key => [key, 0])), liveBytesByRecordKind: Object.fromEntries(RECORD_KINDS.map(key => [key, 0])) }
}
export function projectCampaignStorageReport(input) {
  exact(input, STORAGE_ROOT_KEYS)
  if (input.schemaVersion !== 1 || input.reportKind !== 'campaign-storage-v2' || !hex(input.commit, 40)
    || !['sourceTreeSha256', 'harnessSha256', 'buildSha256'].every(key => hex(input[key], 64))
    || !['node-injected-atomic-io-not-browser-idb', 'browser-native-idb'].includes(input.environment)
    || input.buildMode !== (input.environment === 'browser-native-idb' ? 'test_driver_production_modules' : 'node_typescript_production_modules')
    || input.readAccounting !== (input.environment === 'browser-native-idb' ? 'native_idb_get_transactions_including_cas_and_aborts' : 'repository_getMany_only')
    || input.baselineReadAccounting !== 'historical_node_repository_getMany_only'
    || input.realModelRequests !== 0 || input.longformAcceptance !== 'NOT_RUN'
    || !integer(input.browserErrors) || !integer(input.blockedExternalRequests)) invalid()
  const geometry = fixedObject(input.geometry, GEOMETRY), baselineV1 = fixedObject(input.baselineV1, BASELINE)
  if (!Array.isArray(input.boundaries) || input.boundaries.length !== (input.environment === 'browser-native-idb' ? 8 : 0)
    || !Array.isArray(input.profiles) || input.profiles.length !== 2) invalid()
  const boundaries = input.boundaries.map((row, index) => {
    exact(row, BOUNDARY_KEYS)
    if (row.id !== CAMPAIGN_STORAGE_BOUNDARIES[index] || !['pass', 'fail', 'not_run'].includes(row.status)
      || (row.status === 'fail' ? !CAMPAIGN_STORAGE_FAILURE_STAGES.includes(row.failureStage) : row.failureStage !== null)
      || !BOUNDARY_KEYS.filter(key => !['id', 'status', 'failureStage'].includes(key)).every(key => integer(row[key]))
      || (row.status === 'pass' && row.accountingMismatches !== 0)) invalid()
    return Object.fromEntries(BOUNDARY_KEYS.map(key => [key, row[key]]))
  })
  const profiles = input.profiles.map((row, index) => {
    exact(row, PROFILE_KEYS); exact(row.liveBytesByRecordKind, RECORD_KINDS)
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
    if (row.status === 'not_run' && (row.execution !== 'not_run' || row.blockerCode !== null || PROFILE_NUMBERS.some(key => row[key] !== 0))) invalid()
    return { ...Object.fromEntries(PROFILE_KEYS.filter(key => key !== 'liveBytesByRecordKind').map(key => [key, row[key]])), liveBytesByRecordKind: Object.fromEntries(RECORD_KINDS.map(key => [key, row.liveBytesByRecordKind[key]])) }
  })
  if (input.buildSha256 === '0'.repeat(64) && (profiles.some(row => row.status === 'pass') || boundaries.some(row => row.status === 'pass'))) invalid()
  if (profiles.every(row => row.status === 'pass') && boundaries.every(row => row.status === 'pass') && (input.browserErrors || input.blockedExternalRequests)) invalid()
  return { ...Object.fromEntries(STORAGE_ROOT_KEYS.filter(key => !['geometry', 'baselineV1', 'boundaries', 'profiles'].includes(key)).map(key => [key, input[key]])), geometry, baselineV1, boundaries, profiles }
}

/** Both CLI producers use this gate. Partial/running evidence is never exit 0. */
export function campaignStorageReportExitCode(input) {
  const report = projectCampaignStorageReport(input)
  return report.profiles.every(row => row.status === 'pass') && report.boundaries.every(row => row.status === 'pass')
    && report.browserErrors === 0 && report.blockedExternalRequests === 0 ? 0 : 1
}
