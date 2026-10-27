/** Synthetic schema-validator witnesses only. NEVER execution evidence or production input. */
import { CREATIVE_TASK_IDS } from './creative-pilot-registry'
import { emptyCreativeReport, type CreativeReadinessReport, type CreativeSourceIdentity } from './creative-pilot-report'
export const creativeSchemaSource: CreativeSourceIdentity = { commit: 'a'.repeat(40), tree: 'b'.repeat(40), coreSha256: '1'.repeat(64), transportSha256: '2'.repeat(64), compilerSha256: '3'.repeat(64), uiSha256: '4'.repeat(64), fixtureSha256: '5'.repeat(64), harnessSha256: '6'.repeat(64), launchSha256: '7'.repeat(64), archiveSha256: '8'.repeat(64) }
export function syntheticCreativePassReport(execution: 'node' | 'browser'): CreativeReadinessReport {
  const r = emptyCreativeReport(creativeSchemaSource, execution)
  r.sourceStable = 'verified'; r.teardown = 'pass'
  const positives = execution === 'node' ? r.positiveNode : r.positiveApp
  if (execution === 'browser') r.builds = { normalApp: '9'.repeat(64), controlledApp: 'a'.repeat(64), nativeDriver: 'b'.repeat(64) }
  for (const row of positives) {
    row.status = 'pass'; row.activeCheck = row.checks.at(-1)!.id; row.checks.forEach(c => { c.status = 'pass' }); row.observation = 'last_verified'; row.finalCheckpointHash = 'c'.repeat(64); row.beforeOrdinaryHash = row.afterOrdinaryHash = 'd'.repeat(64); row.coldReopen = 'pass'
    Object.assign(row.metrics, { attempts: 9, acceptedTasks: 9, acceptedBodies: 3, httpAttempts: 9, operations: 37, activeReservationMs: 550000, writtenBytes: 100000, allocatedBytes: 17104896, consumedBytes: 90000, releasedBytes: 17014896, recoveryBytes: 524288, readCalls: 100, readBytes: 200000, casCalls: 37, successfulCas: 37, maxReadBatchKeys: 33, maxReadBatchBytes: 10000, finalFenceExpectedKeys: 142, finalFenceObservedKeys: 142, maxCapturedKeys: 142, maxCapturedBytes: 90000, maxRepositoryActionMs: 10, maxVerifiedReadMs: 10, maxRawIoMs: 1, maxCasMs: 1, maxStageMs: 100, maxSdkMs: 10, runWallMs: 900 })
    row.tasks.forEach((t, i) => {
      const h = (i + 1).toString(16).repeat(64)
      Object.assign(t, { phase: 'resolved', outcome: 'accepted', requestHash: h, intentHash: h, responseHash: h, artifactHash: h, receiptHash: h, sourceRoot: h, inputDigest: h, wireDigest: h, textJsonHash: h, catalogRoot: h, wireBytes: 1000, wireUtf16: 1000, rawBytes: 512, rawUtf16: 512, rawScalars: 512, derivedBytes: 512, derivedUtf16: 512, derivedScalars: 512, canonicalScalars: 512, finishReason: 'stop', reportedModelStatus: 'matched', reportedModelHash: h, usageStatus: 'partial', usageProvenance: 'synthetic_control', inputTokens: 37, outputTokens: 29, reasoningTokens: null, stepCount: 1 })
      row.obligations.push({ requestHash: h, phaseHash: h, status: 'resolved', responseHash: h, outcome: 'accepted', resolutionReason: null, unknownReason: null, outstandingBytes: 0 })
    })
  }
  const controls = execution === 'node' ? [r.compiler, r.metamorphic, r.durability, r.engine, r.reportControls] : [r.appInterruptions]
  for (const rows of controls) for (const row of rows) { row.status = 'pass'; row.activeCheck = row.id; row.assertions = 1; if (/^[AL]:/.test(row.id)) row.successfulCas = 1; if (row.id === 'B:D01') { row.setupHttpAttempts = 2; row.setupSuccessfulCas = 11 } }
  if (r.positiveNode[0]!.tasks.map(t => t.id).join(',') !== CREATIVE_TASK_IDS.join(',')) throw new Error('creative_schema_fixture_invalid')
  return r
}
