/** Synthetic report controls, never production/performance evidence. */
import assert from 'node:assert/strict'
import { PLANNING_COMPACT_BODY, planningFixtureBodyTarget } from '../src/services/writerCampaign/planningProfile'
import { emptyBodyEvidenceReport, emptyBodyEvidenceAuthority, validateBodyEvidenceReport, parseBodyEvidenceReport, bodyEvidenceReportExitCode, mergeBodyEvidenceReports, safeBodyEvidenceCode, type BodyEvidenceReport } from './fixtures/writer-campaign-body-evidence-report'
const H = 'a'.repeat(64), source = { commit: null, tree: null, coreSha256: H, harnessSha256: H, fixtureSha256: H, uiSha256: H, buildSha256: H }
let assertions = 0
const check = (fn: () => void) => { fn(); assertions++ }
function synthetic(environment: 'node' | 'native' | 'ui'): BodyEvidenceReport {
  const report = emptyBodyEvidenceReport(source, environment); report.sourceStable = 'verified'; report.teardown = 'pass'
  if (environment === 'native') report.buildArtifacts.native = H
  if (environment === 'ui') report.buildArtifacts.ui = H
  for (const row of report.profiles.filter(row => row.runtime === environment)) {
    Object.assign(row, { status: 'pass', committedTasks: 123, committedBodyScalars: 600, actualFixtureInvocations: 123, reservedAttempts: 123, committedOperations: 494, committedTransactions: 494,
      checkpointHash: H, artifactSetHash: H, canonBaseRoot: H, fullPlanRoot: H, bodyPrefixRoot: H, packetDigest: H, namespaceHashBefore: H, namespaceHashAfter: H,
      cumulativeWrittenBytes: 1000, recoveryRemainingBytes: 524288, liveRecordCount: 10, liveSerializedMapBytes: 500, setupMs: 100, maxStepMs: 1, maxBodyScalars: 10, operationTimingsCollected: true, maxIoOperationMs: 1, maxDispatchOperationMs: 1,
      previewInvocations: 3, previewMs: 3, maxPreviewMs: 1, previewRepositoryReadCalls: 6, previewRepositoryReadMs: 1, maxPreviewRepositoryReadMs: 1, previewIoReadCalls: 12, previewIoReadRecords: 20, previewIoReadBytes: 100,
      compileMs: 1, proposalBytes: 10, proposalUtf16: 10, packetBytes: 20, packetUtf16: 20, sourceCount: 60, spanCount: 60, claimCount: 60, sourceUtf16: 600, suppliedUtf16: 600, declaredExaminedUtf16: 600,
      coldRepositoryRead: 'verified', coldRepositoryReadMs: 1, coldRepositoryReadBytes: 100, coldRepositoryReadCalls: 1, authority: { ...emptyBodyEvidenceAuthority(), observed: true } })
    Object.assign(row, { committedBodyScalars: planningFixtureBodyTarget(row.language, 60), maxBodyScalars: [...PLANNING_COMPACT_BODY[row.language]].length, sourceUtf16: PLANNING_COMPACT_BODY[row.language].length * 60, suppliedUtf16: PLANNING_COMPACT_BODY[row.language].length * 60, declaredExaminedUtf16: PLANNING_COMPACT_BODY[row.language].length * 60 }); row.checks.forEach(item => { item.status = 'pass' })
    if (environment === 'native') Object.assign(row, { coldProcessRestart: 'verified', coldProcessReadMs: 3, coldProcessInitialReadMs: 1, coldProcessReadBytes: 200, coldProcessReadCalls: 2 })
  }
  if (environment === 'native') for (const row of report.nativeBoundaries) {
    Object.assign(row,{status:'pass',setupFixtureInvocations:9,rebuildFixtureInvocations:3,explicitCommittedTransactions:14,finalCommittedTransactions:52,finalOperations:52,finalAttempts:12,rebuiltBodyTasks:3,previewInvocations:5,oldBodyPrefixRoot:H,newBodyPrefixRoot:'b'.repeat(64),oldFullPlanRoot:H,newFullPlanRoot:'b'.repeat(64),checkpointHash:H,namespaceHashAfter:H,sourceChangeRefusal:'source_changed',invalidatedPrefixRefusal:'no_accepted_body',staleProposalRefusal:'source_identity_mismatch',historicalPlanningAncestorsVerified:true,historicalPlanningAncestorCount:5,maxActionMs:1,maxPreviewMs:1,coldProcessRestart:'verified',coldProcessInitialReadMs:1,coldProcessReadMs:2,coldProcessReadBytes:100,coldProcessReadCalls:1,authority:{...emptyBodyEvidenceAuthority(),observed:true}});row.checks.forEach(item=>{item.status='pass'})
  }
  if (environment === 'ui') for (const row of report.uiCases) { Object.assign(row, { status: 'pass', planningArtifacts: 6, bodyArtifacts: 3, bodyScalars: 300, requestOrigins: 9, dispatchIntents: 9, attempts: 9, readOnlyChecks: 1, reloads: 1, processReopens: 1, heldReadRaces: 1, heldDraftRaces: 1, namespaceHashBefore: H, namespaceHashAfter: H, authority: { ...emptyBodyEvidenceAuthority(), observed: true } }); row.checks.forEach(item => { item.status = 'pass' }) }
  return report
}
for (const environment of ['node', 'native', 'ui'] as const) { check(() => assert.equal(bodyEvidenceReportExitCode(emptyBodyEvidenceReport(source, environment)), 1)); check(() => assert.equal(bodyEvidenceReportExitCode(synthetic(environment)), 0)) }
const combined = () => mergeBodyEvidenceReports([synthetic('node'), synthetic('native'), synthetic('ui')])
check(() => assert.equal(bodyEvidenceReportExitCode(combined()), 0))
const bad = (mutate: (report: any) => void) => check(() => { const value = combined(); mutate(value); assert.throws(() => validateBodyEvidenceReport(value), /^Error: invalid_body_evidence_report$/) })
for (const route of [[], ['source'], ['buildArtifacts'], ['expectedCapabilities'], ['profiles', 0], ['profiles', 0, 'authority'], ['profiles', 0, 'checks', 0], ['uiCases', 0], ['uiCases', 0, 'checks', 0], ['uiCases', 0, 'authority'], ['nativeBoundaries',0], ['nativeBoundaries',0,'checks',0], ['nativeBoundaries',0,'authority'], ['regressions', 0]]) bad(report => { let row = report; for (const key of route) row = row[key]; row.rawBody = 'source-bearing sentinel' })
for (const key of ['committedTasks', 'actualFixtureInvocations', 'reservedAttempts', 'committedOperations', 'committedTransactions', 'previewInvocations', 'previewRepositoryReadCalls', 'sourceCount', 'spanCount', 'claimCount']) bad(report => { report.profiles[0][key]++ })
for (const key of ['outstandingBytes', 'openAllocations', 'accountingMismatches', 'timeoutEvents', 'operationTimeouts', 'operationAborts', 'operationErrors', 'previewOperationTimeouts', 'previewOperationAborts', 'previewOperationErrors', 'previewCampaignCommitAttempts', 'previewCampaignTransactions', 'previewWrittenBytes', 'previewFixtureInvocations', 'semanticallyReviewedUtf16']) bad(report => { report.profiles[0][key] = 1 })
for (const key of ['checkpointHash', 'artifactSetHash', 'canonBaseRoot', 'fullPlanRoot', 'bodyPrefixRoot', 'packetDigest', 'namespaceHashBefore', 'namespaceHashAfter']) bad(report => { report.profiles[0][key] = null })
bad(report => { report.profiles[0].namespaceHashAfter = 'b'.repeat(64) }); bad(report => { report.profiles[0].authority.observed = false }); bad(report => { report.profiles[0].authority.networkEntries = 1 }); bad(report => { report.uiCases[0].authority.observed = false }); bad(report => { report.uiCases[0].previewCampaignWriteEntries = 1 })
for (const key of ['compileMs', 'maxPreviewRepositoryReadMs', 'coldRepositoryReadMs']) bad(report => { report.profiles[0][key] = 3000 })
for (const key of ['maxStepMs', 'maxPreviewMs']) bad(report => { report.profiles[0][key] = 10000 })
for (const key of ['proposalBytes', 'proposalUtf16', 'packetBytes', 'packetUtf16']) bad(report => { report.profiles[0][key] = 65537 })
for (const value of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null]) bad(report => { report.profiles[0].previewIoReadBytes = value })
bad(report => { report.profiles[0].checks.reverse() }); bad(report => { report.profiles.push(report.profiles[0]) }); bad(report => { report.uiCases[0].checks.pop() }); bad(report => { report.uiCases[0].actualFixtureInvocations = 0 }); bad(report => { report.semanticAdjudication = 'PASS' }); bad(report => { report.source.commit = 'b'.repeat(40) }); bad(report => { report.source.buildSha256 = 'b'.repeat(64) }); bad(report => { report.profiles[0].refusalCode = 'private exception' })
for(const key of ['setupFixtureInvocations','rebuildFixtureInvocations','explicitCommittedTransactions','finalCommittedTransactions','finalOperations','finalAttempts','rebuiltBodyTasks','previewInvocations','previewCommitAttempts','previewFixtureInvocations','operationTimeouts','operationAborts','unexpectedOperationErrors'])bad(report=>{report.nativeBoundaries[0][key]++})
for(const key of ['sourceChangeRefusal','invalidatedPrefixRefusal','staleProposalRefusal'])bad(report=>{report.nativeBoundaries[0][key]='preview_unavailable'})
bad(report=>{report.nativeBoundaries[0].historicalPlanningAncestorsVerified=false});bad(report=>{report.nativeBoundaries[0].newBodyPrefixRoot=report.nativeBoundaries[0].oldBodyPrefixRoot});bad(report=>{report.nativeBoundaries[0].newFullPlanRoot=report.nativeBoundaries[0].oldFullPlanRoot});bad(report=>{report.nativeBoundaries[0].checks.pop()});bad(report=>{report.nativeBoundaries[0].authority.observed=false})
check(() => assert.equal(safeBodyEvidenceCode(new Error('private exception')), 'profile_failure'))
check(() => assert.equal(safeBodyEvidenceCode({ code: 'invalid_anchor', text: 'private' }), 'invalid_anchor'))
check(() => { const value = combined(); value.profiles[0]!.status = 'failed'; value.profiles[0]!.authority.networkEntries = 1; validateBodyEvidenceReport(value); assert.equal(bodyEvidenceReportExitCode(value), 1) })
check(() => { const value = combined(); value.sourceStable = 'changed'; assert.equal(bodyEvidenceReportExitCode(value), 1) })
check(() => { const value = synthetic('node'); value.profiles[2]!.status = 'running'; assert.throws(() => validateBodyEvidenceReport(value)) })
check(() => assert.throws(() => mergeBodyEvidenceReports([synthetic('native'), synthetic('node'), synthetic('ui')])))
check(() => { const value = synthetic('ui'); value.source.harnessSha256 = 'b'.repeat(64); assert.throws(() => mergeBodyEvidenceReports([synthetic('node'), synthetic('native'), value])) })
check(() => assert.deepEqual(parseBodyEvidenceReport(`${JSON.stringify(combined(), null, 2)}\n`), combined()))
check(() => assert.throws(() => parseBodyEvidenceReport(JSON.stringify(combined()))))
check(() => assert.throws(() => parseBodyEvidenceReport(' '.repeat(1024 * 1024 + 1))))
check(() => assert.throws(() => parseBodyEvidenceReport(`${JSON.stringify(combined(), null, 2).replace('"protocol":', '"protocol":"wrong",\n"protocol":')}\n`)))
// Every shard's own failure must survive merging, including counters that a
// particular runtime normally leaves at zero. No failed shard can become pass.
for (const environment of ['node', 'native', 'ui'] as const) {
  for (const field of ['browserErrors', 'blockedExternalRequests'] as const) check(() => {
    const shards = [synthetic('node'), synthetic('native'), synthetic('ui')]
    const failed = shards.find(row => row.environment === environment)!
    failed[field] = 1
    assert.equal(bodyEvidenceReportExitCode(failed), 1)
    const merged = mergeBodyEvidenceReports(shards)
    assert.equal(merged[field], 1)
    assert.equal(bodyEvidenceReportExitCode(merged), 1)
  })
  for (const [field, status] of [['sourceStable', 'changed'], ['sourceStable', 'not_checked'], ['teardown', 'failed'], ['teardown', 'not_run']] as const) check(() => {
    const shards = [synthetic('node'), synthetic('native'), synthetic('ui')]
    const failed = shards.find(row => row.environment === environment)!
    Object.assign(failed, { [field]: status })
    assert.equal(bodyEvidenceReportExitCode(failed), 1)
    const merged = mergeBodyEvidenceReports(shards)
    assert.equal(merged[field], status)
    assert.equal(bodyEvidenceReportExitCode(merged), 1)
  })
  for (const status of ['pass', 'fail'] as const) check(() => {
    const shards = [synthetic('node'), synthetic('native'), synthetic('ui')]
    const invalid = shards.find(row => row.environment === environment)!
    Object.assign(invalid.regressions[0]!, { status })
    assert.throws(() => validateBodyEvidenceReport(invalid), /^Error: invalid_body_evidence_report$/)
    assert.throws(() => mergeBodyEvidenceReports(shards), /^Error: invalid_body_evidence_report$/)
  })
}
for (const status of ['pass', 'fail']) bad(report => { report.regressions[0].status = status })
check(() => {
  const shards = [synthetic('node'), synthetic('native'), synthetic('ui')]
  shards.forEach((row, i) => { row.browserErrors = i + 1; row.blockedExternalRequests = i + 2 })
  const merged = mergeBodyEvidenceReports(shards)
  assert.equal(merged.browserErrors, 6); assert.equal(merged.blockedExternalRequests, 9)
  assert.equal(bodyEvidenceReportExitCode(merged), 1)
})
console.log(`Body Evidence closed reports: ${assertions} assertions; synthetic controls only.`)
