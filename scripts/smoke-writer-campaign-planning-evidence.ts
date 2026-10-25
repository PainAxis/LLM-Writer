/** Adversarial closed-report tests. Synthetic numbers here are validator controls, never execution evidence. */
import assert from 'node:assert/strict'
import { emptyPlanningReport, emptyPlanningProfile, planningReportExitCode, validatePlanningReport, parsePlanningReport, safePlanningCode, type PlanningReport } from './fixtures/writer-campaign-planning-report'
import { planningFixtureBodyTarget } from '../src/services/writerCampaign/planningProfile'
import { PLANNING_STAGE_LIMITS } from '../src/services/writerCampaign/planningProtocol'
let assertions = 0
const check = (fn: () => void) => { fn(); assertions++ }
const source = { commit: null, tree: null, coreSha256: '1'.repeat(64), harnessSha256: '2'.repeat(64), buildSha256: '3'.repeat(64) }
function syntheticValidReport(): PlanningReport {
  const report = emptyPlanningReport(source, 'node-injected-atomic-io-not-browser-idb')
  for (const row of report.profiles) {
    const tasks = row.plannedTasks, n = row.plannedChapters
    Object.assign(row, { status: 'pass', committedTasks: tasks, actualFixtureInvocations: tasks, reservedAttempts: tasks, committedOperations: tasks * 4 + 2, committedTransactions: tasks * 4 + 2,
      cumulativeActiveReservationMs: (tasks + 2) * 10000, committedBodyScalars: planningFixtureBodyTarget(row.language, n as 3 | 60),
      checkpointHash: '4'.repeat(64), canonBaseRoot: '5'.repeat(64), fullPlanRoot: '6'.repeat(64), artifactSetHash: '7'.repeat(64),
      cumulativeWrittenBytes: 1000, cumulativeAllocatedBytes: 1000, allocationConsumedBytes: 500, releasedBytes: 500, recoveryRemainingBytes: 524288,
      liveRecordCount: 10, liveSerializedMapBytes: 500, totalReadBytes: 1000, totalReadCalls: 1, maxReadBatchKeys: 1, maxReadBatchBytes: 1000,
      executionMs: 1000, maxStepMs: 1, planningTextBytes: 100, maxBodyScalars: 256, globalCanonBytes: 50, expectedPreviewRefusals: 1,
      fullPlanFreeze: 'verified', previewReadOnly: 'verified', previewDispatchSeparation: 'verified', coldRepositoryRead: 'verified', coldRepositoryReadBytes: 500, coldRepositoryReadCalls: 1, coldProcessRestart: 'not_applicable' })
    row.stages.forEach((stage, i) => Object.assign(stage, { dispatches: i < 3 ? 1 : n, maxInputBytes: 1, maxInputUtf16: 1, maxResponseBytes: 1, maxResponseReservationBytes: PLANNING_STAGE_LIMITS[stage.stage].responseBytes }))
    Object.assign(row.operations.find(phase => phase.phase === 'dispatch')!, { count: tasks, success: tasks, minMs: 1, maxMs: 1 })
  }
  return report
}
check(() => assert.equal(planningReportExitCode(emptyPlanningReport(source, 'node-injected-atomic-io-not-browser-idb')), 1))
check(() => assert.equal(planningReportExitCode(syntheticValidReport()), 0))
const bad = (mutate: (value: any) => void) => check(() => { const report = structuredClone(syntheticValidReport()); mutate(report); assert.throws(() => validatePlanningReport(report), /^Error: invalid_planning_report$/) })
for (const path of [[], ['source'], ['profiles', 0], ['profiles', 0, 'stages', 0], ['profiles', 0, 'operations', 0], ['profiles', 0, 'authority']] as const) {
  bad(report => { let target: any = report; for (const key of path) target = target[key]; target.rawSource = 'source-bearing sentinel' })
}
for (const key of ['committedTasks', 'actualFixtureInvocations', 'reservedAttempts', 'committedOperations', 'committedTransactions', 'cumulativeActiveReservationMs', 'committedBodyScalars', 'expectedPreviewRefusals']) bad(report => { report.profiles[0][key]++ })
for (const key of ['outstandingBytes', 'openAllocations', 'accountingMismatches', 'timeoutEvents']) bad(report => { report.profiles[0][key] = 1 })
for (const key of ['fullPlanFreeze', 'previewReadOnly', 'previewDispatchSeparation', 'coldRepositoryRead']) bad(report => { report.profiles[0][key] = 'not_run' })
for (const key of ['checkpointHash', 'canonBaseRoot', 'fullPlanRoot', 'artifactSetHash']) bad(report => { report.profiles[0][key] = null })
for (const key of ['networkEntries', 'credentialEntries', 'configurationReads', 'ordinaryWriterMutations', 'externalToolEntries']) bad(report => { report.profiles[0].authority[key] = 1 })
for (const key of ['dispatches', 'maxResponseReservationBytes']) bad(report => { report.profiles[0].stages[1][key]++ })
bad(report => { report.profiles[0].stages[0].maxInputBytes = 12289 })
bad(report => { report.profiles[0].stages[0].maxResponseBytes = 8193 })
bad(report => { report.profiles[0].stages[0].maxInputUtf16 = 2 })
bad(report => { report.profiles[0].planningTextBytes = 524289 })
bad(report => { report.profiles[0].globalCanonBytes = 32769 })
bad(report => { report.profiles[0].maxBodyScalars = 257 })
bad(report => { report.profiles[0].maxStepMs = 10000 })
bad(report => { report.profiles[0].coldRepositoryReadMs = 3000 })
bad(report => { report.profiles[0].maxBodyScalars = 1 })
bad(report => { report.profiles[0].liveSerializedMapBytes = 1001 })
bad(report => { report.profiles[0].cumulativeWrittenBytes = 67108864 })
bad(report => { report.profiles[0].cumulativeAllocatedBytes++ })
bad(report => { report.profiles[0].operations[0].maxMs = 3000 })
bad(report => { report.profiles[0].operations[0].count = 1 })
bad(report => { Object.assign(report.profiles[0].operations[0], { count: 1, timeout: 1 }) })
bad(report => { report.profiles[0].refusalCode = 'invented_error_with_private_path' })
bad(report => { report.profiles[0].language = 'private-language-id' })
bad(report => { report.profiles[0].fixtureVersion = 'planning-contract-v2' })
bad(report => { report.liveModelCalls = 1 })
bad(report => { report.autonomousGeneration = 'PASS' })
bad(report => { report.source.commit = 'a'.repeat(40) })
bad(report => { report.source.harnessSha256 = 'source text' })
bad(report => { report.profiles.push(emptyPlanningProfile('three-chapter', 'en')) })
bad(report => { report.profiles.reverse() })
bad(report => { report.boundaries.push({ id: 'arbitrary-source-id' }) })
for (const value of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '100', null]) bad(report => { report.profiles[0].totalReadBytes = value })
check(() => assert.equal(safePlanningCode(new Error('secret raw error')), 'profile_failure'))
check(() => assert.equal(safePlanningCode({ code: 'invalid_planning_payload', message: 'secret' }), 'invalid_planning_payload'))
check(() => { const report = syntheticValidReport(); report.browserErrors = 1; assert.equal(planningReportExitCode(report), 1) })
check(() => { const report = syntheticValidReport(); report.blockedExternalRequests = 1; assert.equal(planningReportExitCode(report), 1) })
const native = emptyPlanningReport(source, 'browser-native-idb')
check(() => { validatePlanningReport(native); assert.equal(planningReportExitCode(native), 1) })
check(() => { (native.boundaries[0] as any).text = 'forbidden'; assert.throws(() => validatePlanningReport(native)) })
for (const key of ['checkpointHash', 'dispatches', 'committedTransactions']) check(() => {
  const value = emptyPlanningReport(source, 'browser-native-idb'), row = value.boundaries[0]!
  Object.assign(row, { status: 'pass', checkpointHash: '4'.repeat(64), dispatches: 6, committedTransactions: 27, coldProcessRestart: 'verified' })
  ;(row as any)[key] = key === 'checkpointHash' ? null : 0
  assert.throws(() => validatePlanningReport(value))
})
check(() => assert.equal(planningReportExitCode(parsePlanningReport(`${JSON.stringify(syntheticValidReport(), null, 2)}\n`)), 0))
check(() => assert.throws(() => parsePlanningReport(' '.repeat(1024 * 1024 + 1))))
check(() => assert.throws(() => parsePlanningReport(JSON.stringify(syntheticValidReport()))))
check(() => assert.throws(() => parsePlanningReport(`${JSON.stringify(syntheticValidReport(), null, 2).replace('\"schemaVersion\": 1,', '\"schemaVersion\": 0,\n  \"schemaVersion\": 1,')}\n`)))
console.log(`Planning closed evidence: ${assertions} assertions passed; semanticConsistency=NOT_RUN.`)
