/** Closed, source-free engineering evidence. Unknown keys are an error, not a projection. */
import { PLANNING_REFUSAL_CODES, PLANNING_STAGE_LIMITS } from '../../src/services/writerCampaign/planningProtocol'
import { planningFixtureBodyTarget } from '../../src/services/writerCampaign/planningProfile'
export const PLANNING_REPORT_STAGES = ['outline', 'character_bible', 'detailed_outline', 'chapter_outline', 'chapter_body'] as const
export const PLANNING_REPORT_PHASES = ['read', 'receipt', 'commit', 'prepare', 'dispatch', 'reconcile', 'save', 'recovery_read', 'recovery_receipt', 'recovery_commit'] as const
export const PLANNING_BOUNDARIES = ['replacement', 'cancel_accept', 'accept_ack_loss'] as const
export const PLANNING_SAFE_CODES = [...PLANNING_REFUSAL_CODES, 'budget', 'budget_exhausted', 'storage_budget_exhausted', 'active_budget_exhausted', 'operation_timeout', 'storage_unknown', 'integrity', 'conflict', 'local_stopped', 'dispatch_outcome_unknown', 'deadline', 'clock_rollback', 'profile_failure'] as const
export type PlanningSafeCode = typeof PLANNING_SAFE_CODES[number]
export function safePlanningCode(error: unknown): PlanningSafeCode {
  try {
    const code = typeof error === 'string' ? error : error && typeof error === 'object' && 'code' in error ? error.code : null
    return typeof code === 'string' && (PLANNING_SAFE_CODES as readonly string[]).includes(code) ? code as PlanningSafeCode : 'profile_failure'
  } catch { return 'profile_failure' }
}
export interface PlanningStageMeasurement { stage: typeof PLANNING_REPORT_STAGES[number]; dispatches: number; maxInputBytes: number; maxInputUtf16: number; maxResponseBytes: number; maxResponseReservationBytes: number }
export interface PlanningOperationMeasurement { phase: typeof PLANNING_REPORT_PHASES[number]; count: number; success: number; error: number; abort: number; timeout: number; minMs: number | null; maxMs: number | null }
export interface PlanningAuthority { networkEntries: number; credentialEntries: number; configurationReads: number; ordinaryWriterMutations: number; externalToolEntries: number }
export const emptyPlanningAuthority = (): PlanningAuthority => ({ networkEntries: 0, credentialEntries: 0, configurationReads: 0, ordinaryWriterMutations: 0, externalToolEntries: 0 })
export interface PlanningProfileMeasurement {
  language: 'zh' | 'en'; profile: 'three-chapter' | 'compact-60'; fixtureVersion: string; status: 'not_run' | 'running' | 'pass' | 'refused' | 'timeout' | 'failed'; refusalCode: PlanningSafeCode | null
  plannedChapters: number; plannedTasks: number; committedTasks: number; actualFixtureInvocations: number; reservedAttempts: number; committedOperations: number; committedBodyScalars: number
  checkpointHash: string | null; canonBaseRoot: string | null; fullPlanRoot: string | null; artifactSetHash: string | null
  cumulativeWrittenBytes: number; cumulativeAllocatedBytes: number; allocationConsumedBytes: number; outstandingBytes: number; peakOutstandingBytes: number; releasedBytes: number; recoveryRemainingBytes: number; openAllocations: number
  liveRecordCount: number; liveSerializedMapBytes: number; committedTransactions: number; totalReadBytes: number; totalReadCalls: number; maxReadBatchKeys: number; maxReadBatchBytes: number; accountingMismatches: number
  executionMs: number; maxStepMs: number; timeoutEvents: number; cumulativeActiveReservationMs: number
  planningTextBytes: number; maxBodyScalars: number; globalCanonBytes: number; expectedPreviewRefusals: number
  fullPlanFreeze: 'not_run' | 'verified'; previewReadOnly: 'not_run' | 'verified'; previewDispatchSeparation: 'not_run' | 'verified'
  coldRepositoryRead: 'not_run' | 'verified'; coldRepositoryReadMs: number; coldRepositoryReadBytes: number; coldRepositoryReadCalls: number
  coldProcessRestart: 'not_run' | 'not_applicable' | 'verified' | 'failed'; coldProcessReadMs: number; coldProcessInitialReadMs: number; coldProcessReadBytes: number; coldProcessReadCalls: number
  stages: PlanningStageMeasurement[]; operations: PlanningOperationMeasurement[]; authority: PlanningAuthority
}
export interface PlanningBoundaryMeasurement { id: typeof PLANNING_BOUNDARIES[number]; language: 'zh' | 'en'; status: 'not_run' | 'pass' | 'failed'; dispatches: number; committedTransactions: number; checkpointHash: string | null; coldProcessRestart: 'not_run' | 'verified' | 'failed'; accountingMismatches: number; authority: PlanningAuthority }
export interface PlanningReport {
  schemaVersion: 1; reportKind: 'campaign-planning-v1'; contractVersion: 'campaign-plan-v1'; contextVersion: 'campaign-context-v1'
  source: { commit: string | null; tree: string | null; coreSha256: string; harnessSha256: string; buildSha256: string }
  environment: 'node-injected-atomic-io-not-browser-idb' | 'browser-native-idb'; readAccounting: 'repository_getMany_only' | 'native_idb_get_transactions_including_cas_and_aborts'
  profiles: PlanningProfileMeasurement[]; boundaries: PlanningBoundaryMeasurement[]; browserErrors: number; blockedExternalRequests: number
  semanticConsistency: 'NOT_RUN'; autonomousGeneration: 'NOT_RUN'; wholeWorkAudit: 'NOT_RUN'; liveModelCalls: 0
}
const profileOrder = [['three-chapter', 'zh'], ['three-chapter', 'en'], ['compact-60', 'zh'], ['compact-60', 'en']] as const
export function emptyPlanningProfile(profile: 'three-chapter' | 'compact-60', language: 'zh' | 'en'): PlanningProfileMeasurement {
  const n = profile === 'three-chapter' ? 3 : 60
  return { language, profile, fixtureVersion: `planning-contract-v1-${profile}`, status: 'not_run', refusalCode: null,
    plannedChapters: n, plannedTasks: 3 + 2 * n, committedTasks: 0, actualFixtureInvocations: 0, reservedAttempts: 0, committedOperations: 0, committedBodyScalars: 0,
    checkpointHash: null, canonBaseRoot: null, fullPlanRoot: null, artifactSetHash: null,
    cumulativeWrittenBytes: 0, cumulativeAllocatedBytes: 0, allocationConsumedBytes: 0, outstandingBytes: 0, peakOutstandingBytes: 0, releasedBytes: 0, recoveryRemainingBytes: 0, openAllocations: 0,
    liveRecordCount: 0, liveSerializedMapBytes: 0, committedTransactions: 0, totalReadBytes: 0, totalReadCalls: 0, maxReadBatchKeys: 0, maxReadBatchBytes: 0, accountingMismatches: 0,
    executionMs: 0, maxStepMs: 0, timeoutEvents: 0, cumulativeActiveReservationMs: 0, planningTextBytes: 0, maxBodyScalars: 0, globalCanonBytes: 0, expectedPreviewRefusals: 0,
    fullPlanFreeze: 'not_run', previewReadOnly: 'not_run', previewDispatchSeparation: 'not_run', coldRepositoryRead: 'not_run', coldRepositoryReadMs: 0, coldRepositoryReadBytes: 0, coldRepositoryReadCalls: 0,
    coldProcessRestart: 'not_run', coldProcessReadMs: 0, coldProcessInitialReadMs: 0, coldProcessReadBytes: 0, coldProcessReadCalls: 0,
    stages: PLANNING_REPORT_STAGES.map(stage => ({ stage, dispatches: 0, maxInputBytes: 0, maxInputUtf16: 0, maxResponseBytes: 0, maxResponseReservationBytes: 0 })),
    operations: PLANNING_REPORT_PHASES.map(phase => ({ phase, count: 0, success: 0, error: 0, abort: 0, timeout: 0, minMs: null, maxMs: null })), authority: emptyPlanningAuthority() }
}
export function emptyPlanningReport(source: PlanningReport['source'], environment: PlanningReport['environment']): PlanningReport {
  return { schemaVersion: 1, reportKind: 'campaign-planning-v1', contractVersion: 'campaign-plan-v1', contextVersion: 'campaign-context-v1', source,
    environment, readAccounting: environment === 'browser-native-idb' ? 'native_idb_get_transactions_including_cas_and_aborts' : 'repository_getMany_only',
    profiles: profileOrder.map(([profile, language]) => emptyPlanningProfile(profile, language)),
    boundaries: environment === 'browser-native-idb' ? PLANNING_BOUNDARIES.flatMap(id => (['zh', 'en'] as const).map(language => ({ id, language, status: 'not_run' as const, dispatches: 0, committedTransactions: 0, checkpointHash: null, coldProcessRestart: 'not_run' as const, accountingMismatches: 0, authority: emptyPlanningAuthority() }))) : [],
    browserErrors: 0, blockedExternalRequests: 0, semanticConsistency: 'NOT_RUN', autonomousGeneration: 'NOT_RUN', wholeWorkAudit: 'NOT_RUN', liveModelCalls: 0 }
}
const fail = (): never => { throw new Error('invalid_planning_report') }
const keys = (value: unknown, expected: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return fail()
  const actual = Object.keys(value)
  if (actual.length !== expected.length || actual.some(k => !expected.includes(k))) return fail()
  return value as Record<string, unknown>
}
const number = (value: unknown, integral = true) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER || (integral && !Number.isSafeInteger(value))) fail() }
const enumeration = (value: unknown, values: readonly unknown[]) => { if (!values.includes(value)) fail() }
const digest = (value: unknown, size: number, nullable = false) => { if (!(nullable && value === null) && !(typeof value === 'string' && new RegExp(`^[a-f0-9]{${size}}$`).test(value))) fail() }
function authority(value: unknown) { const row = keys(value, Object.keys(emptyPlanningAuthority())); Object.values(row).forEach(v => number(v)) }
function profile(value: unknown, expectedProfile: 'three-chapter' | 'compact-60', language: 'zh' | 'en') {
  const defaults = emptyPlanningProfile(expectedProfile, language), row = keys(value, Object.keys(defaults))
  for (const [key, initial] of Object.entries(defaults)) if (typeof initial === 'number') number(row[key])
  enumeration(row.language, [language]); enumeration(row.profile, [expectedProfile]); enumeration(row.fixtureVersion, [defaults.fixtureVersion]); enumeration(row.plannedChapters, [defaults.plannedChapters]); enumeration(row.plannedTasks, [defaults.plannedTasks])
  enumeration(row.status, ['not_run', 'running', 'pass', 'refused', 'timeout', 'failed']); enumeration(row.refusalCode, [null, ...PLANNING_SAFE_CODES])
  for (const key of ['checkpointHash', 'canonBaseRoot', 'fullPlanRoot', 'artifactSetHash']) digest(row[key], 64, true)
  for (const key of ['fullPlanFreeze', 'previewReadOnly', 'previewDispatchSeparation', 'coldRepositoryRead']) enumeration(row[key], ['not_run', 'verified'])
  enumeration(row.coldProcessRestart, ['not_run', 'not_applicable', 'verified', 'failed'])
  if (!Array.isArray(row.stages) || row.stages.length !== PLANNING_REPORT_STAGES.length) fail()
  ;(row.stages as unknown[]).forEach((item, i) => { const stage = keys(item, Object.keys(defaults.stages[i]!)); enumeration(stage.stage, [PLANNING_REPORT_STAGES[i]]); Object.entries(stage).filter(([k]) => k !== 'stage').forEach(([, v]) => number(v)) })
  if (!Array.isArray(row.operations) || row.operations.length !== PLANNING_REPORT_PHASES.length) fail()
  ;(row.operations as unknown[]).forEach((item, i) => { const operation = keys(item, Object.keys(defaults.operations[i]!)); enumeration(operation.phase, [PLANNING_REPORT_PHASES[i]]); for (const key of ['count', 'success', 'error', 'abort', 'timeout']) number(operation[key]); for (const key of ['minMs', 'maxMs']) if (operation[key] !== null) number(operation[key], false); if (operation.count !== (operation.success as number) + (operation.error as number) + (operation.abort as number) + (operation.timeout as number)) fail() })
  authority(row.authority)
  if (row.status === 'pass') {
    if (row.refusalCode !== null || row.committedTasks !== defaults.plannedTasks || row.actualFixtureInvocations !== defaults.plannedTasks || row.reservedAttempts !== defaults.plannedTasks || row.outstandingBytes !== 0 || row.openAllocations !== 0 || row.accountingMismatches !== 0 || row.timeoutEvents !== 0 || (row.maxStepMs as number) >= 10_000 || (row.coldRepositoryReadMs as number) >= 3000) fail()
    for (const key of ['checkpointHash', 'canonBaseRoot', 'fullPlanRoot', 'artifactSetHash']) digest(row[key], 64)
    const tasks = defaults.plannedTasks, chapters = defaults.plannedChapters
    if (row.committedBodyScalars !== planningFixtureBodyTarget(language, chapters as 3 | 60) || row.committedOperations !== 4 * tasks + 2 || row.committedTransactions !== 4 * tasks + 2 || row.cumulativeActiveReservationMs !== (tasks + 2) * 10000 || row.expectedPreviewRefusals !== 1) fail()
    for (const key of ['cumulativeWrittenBytes', 'cumulativeAllocatedBytes', 'allocationConsumedBytes', 'releasedBytes', 'recoveryRemainingBytes', 'liveRecordCount', 'liveSerializedMapBytes', 'totalReadBytes', 'totalReadCalls', 'maxReadBatchKeys', 'maxReadBatchBytes', 'executionMs', 'maxStepMs', 'planningTextBytes', 'maxBodyScalars', 'globalCanonBytes', 'coldRepositoryReadBytes', 'coldRepositoryReadCalls']) if (!(typeof row[key] === 'number' && (row[key] as number) > 0)) fail()
    if ((row.liveSerializedMapBytes as number) > (row.cumulativeWrittenBytes as number)) fail()
    for (const [i, item] of (row.stages as PlanningStageMeasurement[]).entries()) {
      const cap = PLANNING_STAGE_LIMITS[item.stage]
      if (item.dispatches !== (i < 3 ? 1 : chapters) || item.maxResponseReservationBytes !== cap.responseBytes || item.maxInputBytes < 1 || item.maxInputBytes > cap.inputBytes || item.maxInputUtf16 < 1 || item.maxInputUtf16 > item.maxInputBytes || item.maxResponseBytes < 1 || item.maxResponseBytes > cap.responseBytes) fail()
    }
    for (const key of ['fullPlanFreeze', 'previewReadOnly', 'previewDispatchSeparation', 'coldRepositoryRead']) enumeration(row[key], ['verified'])
    if (Object.values(row.authority as object).some(v => v !== 0)) fail()
    if ((row.planningTextBytes as number) > 524_288 || (row.globalCanonBytes as number) > 32_768 || (row.maxBodyScalars as number) > 256 || (row.maxBodyScalars as number) < Math.ceil((row.committedBodyScalars as number) / chapters)) fail()
    if ((row.cumulativeWrittenBytes as number) + (row.outstandingBytes as number) + (row.recoveryRemainingBytes as number) > 67_108_864) fail()
    if ((row.cumulativeAllocatedBytes as number) - (row.allocationConsumedBytes as number) - (row.releasedBytes as number) !== row.outstandingBytes) fail()
    for (const item of row.operations as PlanningOperationMeasurement[]) { if (item.abort || item.timeout) fail(); if (item.maxMs !== null && item.maxMs >= (item.phase === 'dispatch' ? 5000 : 3000)) fail() }
    const dispatch = (row.operations as PlanningOperationMeasurement[]).find(item => item.phase === 'dispatch')!
    if (dispatch.count !== tasks || dispatch.success !== tasks) fail()
    if ((row.operations as PlanningOperationMeasurement[]).reduce((sum, item) => sum + item.error, 0) > (row.expectedPreviewRefusals as number)) fail()
  }
}
export function validatePlanningReport(value: unknown): asserts value is PlanningReport {
  const dummy = emptyPlanningReport({ commit: null, tree: null, coreSha256: '0'.repeat(64), harnessSha256: '0'.repeat(64), buildSha256: '0'.repeat(64) }, 'node-injected-atomic-io-not-browser-idb')
  const report = keys(value, Object.keys(dummy)); enumeration(report.schemaVersion, [1]); enumeration(report.reportKind, [dummy.reportKind]); enumeration(report.contractVersion, [dummy.contractVersion]); enumeration(report.contextVersion, [dummy.contextVersion])
  const source = keys(report.source, Object.keys(dummy.source)); for (const key of ['commit', 'tree']) digest(source[key], 40, true); if ((source.commit === null) !== (source.tree === null)) fail(); for (const key of ['coreSha256', 'harnessSha256', 'buildSha256']) digest(source[key], 64)
  enumeration(report.environment, ['node-injected-atomic-io-not-browser-idb', 'browser-native-idb']); enumeration(report.readAccounting, [report.environment === 'browser-native-idb' ? 'native_idb_get_transactions_including_cas_and_aborts' : 'repository_getMany_only'])
  if (!Array.isArray(report.profiles) || report.profiles.length !== 4) fail(); (report.profiles as unknown[]).forEach((row, i) => profile(row, profileOrder[i]![0], profileOrder[i]![1]))
  const expected = report.environment === 'browser-native-idb' ? PLANNING_BOUNDARIES.flatMap(id => (['zh', 'en'] as const).map(language => [id, language] as const)) : []
  if (!Array.isArray(report.boundaries) || report.boundaries.length !== expected.length) fail()
  ;(report.boundaries as unknown[]).forEach((item, i) => { const row = keys(item, ['id', 'language', 'status', 'dispatches', 'committedTransactions', 'checkpointHash', 'coldProcessRestart', 'accountingMismatches', 'authority']); enumeration(row.id, [expected[i]![0]]); enumeration(row.language, [expected[i]![1]]); enumeration(row.status, ['not_run', 'pass', 'failed']); enumeration(row.coldProcessRestart, ['not_run', 'verified', 'failed']); digest(row.checkpointHash, 64, true); for (const key of ['dispatches', 'committedTransactions', 'accountingMismatches']) number(row[key]); authority(row.authority); if (row.status === 'pass') { digest(row.checkpointHash, 64); if (row.accountingMismatches !== 0 || Object.values(row.authority as object).some(v => v !== 0) || row.dispatches !== (row.id === 'replacement' ? 6 : 1) || row.committedTransactions !== (row.id === 'replacement' ? 27 : 6)) fail() } })
  if (report.environment === 'browser-native-idb') for (const row of report.profiles as PlanningProfileMeasurement[]) if (row.coldProcessRestart === 'verified' && (row.coldProcessReadBytes < 1 || row.coldProcessReadCalls < 1 || row.coldProcessInitialReadMs >= 3000 || row.coldProcessReadMs < row.coldProcessInitialReadMs)) fail()
  number(report.browserErrors); number(report.blockedExternalRequests); enumeration(report.liveModelCalls, [0]); for (const key of ['semanticConsistency', 'autonomousGeneration', 'wholeWorkAudit']) enumeration(report[key], ['NOT_RUN'])
}
export function planningReportExitCode(value: unknown): number {
  validatePlanningReport(value)
  const native = value.environment === 'browser-native-idb'
  return value.browserErrors || value.blockedExternalRequests || value.profiles.some(row => row.status !== 'pass' || row.coldProcessRestart !== (native ? 'verified' : 'not_applicable')) || value.boundaries.some(row => row.status !== 'pass' || row.coldProcessRestart !== 'verified') ? 1 : 0
}

export function parsePlanningReport(text: string): PlanningReport {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 1024 * 1024) fail()
  let value: unknown
  try { value = JSON.parse(text) } catch { return fail() }
  validatePlanningReport(value)
  // All writers use this spelling. Duplicate keys, wrappers and ignored bytes fail.
  if (`${JSON.stringify(value, null, 2)}\n` !== text) fail()
  return value
}
