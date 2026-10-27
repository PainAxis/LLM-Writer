/** Closed source-free report. A registry row is NOT_RUN until its actual runner awards it. */
import { CREATIVE_ACTION_CODES, CREATIVE_APP_CHECKS, CREATIVE_APP_IDS, CREATIVE_COMPILER_IDS, CREATIVE_CONTRACT, CREATIVE_DURABLE_IDS, CREATIVE_ENGINE_IDS, CREATIVE_INTERRUPTION_IDS, CREATIVE_METAMORPHIC_IDS, CREATIVE_NODE_IDS, CREATIVE_POSITIVE_CHECKS, CREATIVE_REPORT_IDS, CREATIVE_RESOLUTION_REASONS, CREATIVE_TASK_IDS, CREATIVE_UNKNOWN_REASONS } from './creative-pilot-registry'
import { byteOracle, controlAssert, controlKeys } from './creative-pilot-oracles'
export type CreativeRowStatus = 'not_run' | 'running' | 'pass' | 'failed' | 'timeout' | 'refused'
export interface CreativeSourceIdentity { commit: string | null; tree: string | null; coreSha256: string; transportSha256: string; compilerSha256: string; uiSha256: string; fixtureSha256: string; harnessSha256: string; launchSha256: string; archiveSha256: string }
export interface CreativeCheckRow { id: string; status: 'not_run' | 'pass' | 'fail' }
export const CREATIVE_METRIC_KEYS = ['attempts', 'acceptedTasks', 'acceptedBodies', 'httpAttempts', 'operations', 'activeReservationMs', 'writtenBytes', 'allocatedBytes', 'consumedBytes', 'releasedBytes', 'outstandingBytes', 'recoveryBytes', 'readCalls', 'readBytes', 'casCalls', 'successfulCas', 'accountingMismatches', 'maxReadBatchKeys', 'maxReadBatchBytes', 'finalFenceExpectedKeys', 'finalFenceObservedKeys', 'maxCapturedKeys', 'maxCapturedBytes', 'activeOwners', 'activeCalls', 'maxRepositoryActionMs', 'maxVerifiedReadMs', 'maxRawIoMs', 'maxCasMs', 'maxStageMs', 'maxSdkMs', 'runWallMs'] as const
export type CreativeMetrics = Record<typeof CREATIVE_METRIC_KEYS[number], number>
export interface CreativeTaskReport {
  id: typeof CREATIVE_TASK_IDS[number]; phase: 'pending' | 'reserved' | 'dispatch_intent' | 'outcome_unknown' | 'response_retained' | 'resolved'
  outcome: null | 'accepted' | 'refused' | 'not_dispatched' | 'authority_revoked'
  resolutionReason: string | null; unknownReason: string | null
  requestHash: string | null; intentHash: string | null; responseHash: string | null; artifactHash: string | null; receiptHash: string | null
  sourceRoot: string | null; inputDigest: string | null; wireDigest: string | null; textJsonHash: string | null; catalogRoot: string | null
  wireBytes: number; wireUtf16: number; rawBytes: number | null; rawUtf16: number; rawScalars: number | null; derivedBytes: number | null; derivedUtf16: number | null; derivedScalars: number | null; canonicalScalars: number | null
  finishReason: null | 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'error' | 'other' | 'unknown'
  reportedModelStatus: null | 'absent' | 'matched' | 'mismatch' | 'invalid'; reportedModelHash: string | null
  usageStatus: null | 'complete' | 'partial' | 'unavailable' | 'invalid'; usageProvenance: null | 'synthetic_control'
  inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; stepCount: number | null
  anomalies: string[]
}
export interface CreativeObligation { requestHash: string; phaseHash: string; status: 'reserved' | 'dispatch_intent' | 'outcome_unknown' | 'response_retained' | 'resolved'; responseHash: string | null; outcome: CreativeTaskReport['outcome']; resolutionReason: string | null; unknownReason: string | null; outstandingBytes: number }
export interface CreativePositiveRow { id: string; language: 'zh' | 'en'; status: CreativeRowStatus; activeCheck: string | null; errorCode: string | null; checks: CreativeCheckRow[]; metrics: CreativeMetrics; tasks: CreativeTaskReport[]; obligations: CreativeObligation[]; observation: 'not_run' | 'last_verified' | 'unconfirmed'; finalCheckpointHash: string | null; beforeOrdinaryHash: string | null; afterOrdinaryHash: string | null; coldReopen: 'not_run' | 'pass' | 'fail' }
export interface CreativeControlRow { id: string; status: CreativeRowStatus; activeCheck: string | null; errorCode: string | null; resolutionReason: string | null; unknownReason: string | null; assertions: number; setupHttpAttempts: number; exerciseHttpAttempts: number; recoveryHttpAttempts: number; setupSuccessfulCas: number; successfulCas: number; snapshotHash: string | null; receiptHash: string | null; obligations: CreativeObligation[]; observation: 'not_run' | 'last_verified' | 'unconfirmed' }
export interface CreativeReadinessReport {
  protocol: 'creative-pilot-readiness-report-v1'; scope: 'offline_controlled_sdk_readiness'; contractVersion: 'creative-pilot-policy-v1'; execution: 'node' | 'browser'; contract: typeof CREATIVE_CONTRACT
  source: CreativeSourceIdentity; sourceStable: 'not_checked' | 'verified' | 'changed'; builds: { normalApp: string | null; controlledApp: string | null; nativeDriver: string | null }
  positiveNode: CreativePositiveRow[]; positiveApp: CreativePositiveRow[]; compiler: CreativeControlRow[]; metamorphic: CreativeControlRow[]; durability: CreativeControlRow[]; engine: CreativeControlRow[]; appInterruptions: CreativeControlRow[]; reportControls: CreativeControlRow[]
  blockedExternalRequests: number; browserErrors: number; teardown: 'not_run' | 'pass' | 'fail'; liveCreativeQuality: 'NOT_RUN'; semanticConsistency: 'NOT_RUN'; wholeWorkAudit: 'NOT_RUN'; millionCharacterAcceptance: 'NOT_RUN'
}
const HASH_KEYS = ['requestHash', 'intentHash', 'responseHash', 'artifactHash', 'receiptHash', 'sourceRoot', 'inputDigest', 'wireDigest', 'textJsonHash', 'catalogRoot', 'reportedModelHash'] as const
const TASK_KEYS = ['id', 'phase', 'outcome', 'resolutionReason', 'unknownReason', ...HASH_KEYS, 'wireBytes', 'wireUtf16', 'rawBytes', 'rawUtf16', 'rawScalars', 'derivedBytes', 'derivedUtf16', 'derivedScalars', 'canonicalScalars', 'finishReason', 'reportedModelStatus', 'usageStatus', 'usageProvenance', 'inputTokens', 'outputTokens', 'reasoningTokens', 'stepCount', 'anomalies']
const OBLIGATION_KEYS = ['requestHash', 'phaseHash', 'status', 'responseHash', 'outcome', 'resolutionReason', 'unknownReason', 'outstandingBytes']
const CONTROL_KEYS = ['id', 'status', 'activeCheck', 'errorCode', 'resolutionReason', 'unknownReason', 'assertions', 'setupHttpAttempts', 'exerciseHttpAttempts', 'recoveryHttpAttempts', 'setupSuccessfulCas', 'successfulCas', 'snapshotHash', 'receiptHash', 'obligations', 'observation']
const POSITIVE_KEYS = ['id', 'language', 'status', 'activeCheck', 'errorCode', 'checks', 'metrics', 'tasks', 'obligations', 'observation', 'finalCheckpointHash', 'beforeOrdinaryHash', 'afterOrdinaryHash', 'coldReopen']
const SOURCE_KEYS = ['commit', 'tree', 'coreSha256', 'transportSha256', 'compilerSha256', 'uiSha256', 'fixtureSha256', 'harnessSha256', 'launchSha256', 'archiveSha256'] as const
const ANOMALIES = ['reasoning_present', 'tool_calls_present', 'unexpected_content', 'invalid_step_count', 'invalid_content_metadata']
const STATUSES: CreativeRowStatus[] = ['not_run', 'running', 'pass', 'failed', 'timeout', 'refused']
const verify: (v: unknown) => asserts v = v => controlAssert(v, 'creative_report_invalid')
function keys(v: unknown, names: readonly string[]): asserts v is Record<string, any> { try { controlKeys(v, names) } catch { throw new Error('creative_report_invalid') } }
function count(v: unknown, max = Number.MAX_SAFE_INTEGER): void { verify(typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max) }
function hash(v: unknown, nullable = true): void { verify(nullable && v === null || typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)) }
function enumOrNull(v: unknown, values: readonly string[]): void { verify(v === null || typeof v === 'string' && values.includes(v)) }
export function safeCreativeCode(error: unknown): string { const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''; return (CREATIVE_ACTION_CODES as readonly string[]).includes(code) ? code : 'integrity' }
export function emptyCreativeMetrics(): CreativeMetrics { return Object.fromEntries(CREATIVE_METRIC_KEYS.map(k => [k, 0])) as CreativeMetrics }
export function emptyCreativeTask(id: typeof CREATIVE_TASK_IDS[number]): CreativeTaskReport { return { id, phase: 'pending', outcome: null, resolutionReason: null, unknownReason: null, requestHash: null, intentHash: null, responseHash: null, artifactHash: null, receiptHash: null, sourceRoot: null, inputDigest: null, wireDigest: null, textJsonHash: null, catalogRoot: null, reportedModelHash: null, wireBytes: 0, wireUtf16: 0, rawBytes: null, rawUtf16: 0, rawScalars: null, derivedBytes: null, derivedUtf16: null, derivedScalars: null, canonicalScalars: null, finishReason: null, reportedModelStatus: null, usageStatus: null, usageProvenance: null, inputTokens: null, outputTokens: null, reasoningTokens: null, stepCount: null, anomalies: [] } as CreativeTaskReport }
function emptyPositive(id: string, language: 'zh' | 'en', checks: readonly string[]): CreativePositiveRow { return { id, language, status: 'not_run', activeCheck: null, errorCode: null, checks: checks.map(id => ({ id, status: 'not_run' })), metrics: emptyCreativeMetrics(), tasks: CREATIVE_TASK_IDS.map(emptyCreativeTask), obligations: [], observation: 'not_run', finalCheckpointHash: null, beforeOrdinaryHash: null, afterOrdinaryHash: null, coldReopen: 'not_run' } }
export function emptyCreativeControl(id: string): CreativeControlRow { return { id, status: 'not_run', activeCheck: null, errorCode: null, resolutionReason: null, unknownReason: null, assertions: 0, setupHttpAttempts: 0, exerciseHttpAttempts: 0, recoveryHttpAttempts: 0, setupSuccessfulCas: 0, successfulCas: 0, snapshotHash: null, receiptHash: null, obligations: [], observation: 'not_run' } }
export function emptyCreativeReport(source: CreativeSourceIdentity, execution: 'node' | 'browser'): CreativeReadinessReport { return { protocol: 'creative-pilot-readiness-report-v1', scope: 'offline_controlled_sdk_readiness', contractVersion: 'creative-pilot-policy-v1', execution, contract: { ...CREATIVE_CONTRACT }, source: { ...source }, sourceStable: 'not_checked', builds: { normalApp: null, controlledApp: null, nativeDriver: null }, positiveNode: CREATIVE_NODE_IDS.map(id => emptyPositive(id, id.startsWith('zh') ? 'zh' : 'en', CREATIVE_POSITIVE_CHECKS)), positiveApp: CREATIVE_APP_IDS.map(id => emptyPositive(id, id === 'app-zh' ? 'zh' : 'en', CREATIVE_APP_CHECKS)), compiler: CREATIVE_COMPILER_IDS.map(emptyCreativeControl), metamorphic: CREATIVE_METAMORPHIC_IDS.map(emptyCreativeControl), durability: CREATIVE_DURABLE_IDS.map(emptyCreativeControl), engine: CREATIVE_ENGINE_IDS.map(emptyCreativeControl), appInterruptions: CREATIVE_INTERRUPTION_IDS.map(emptyCreativeControl), reportControls: CREATIVE_REPORT_IDS.map(emptyCreativeControl), blockedExternalRequests: 0, browserErrors: 0, teardown: 'not_run', liveCreativeQuality: 'NOT_RUN', semanticConsistency: 'NOT_RUN', wholeWorkAudit: 'NOT_RUN', millionCharacterAcceptance: 'NOT_RUN' } }
function reasons(outcome: unknown, reason: unknown, artifact: unknown): void {
  enumOrNull(outcome, ['accepted', 'refused', 'not_dispatched', 'authority_revoked']); enumOrNull(reason, CREATIVE_RESOLUTION_REASONS)
  if (outcome === null) verify(reason === null)
  if (outcome === 'accepted') verify(reason === null && artifact !== null)
  if (outcome === 'authority_revoked') verify(reason === 'authority_revoked' && artifact === null)
  if (outcome === 'not_dispatched') verify(['cancelled', 'stage_expired_before_intent', 'closed_before_intent'].includes(String(reason)) && artifact === null)
  if (outcome === 'refused') verify(reason !== null && !['authority_revoked', 'stage_expired_before_intent', 'closed_before_intent'].includes(String(reason)) && artifact === null)
}
function obligations(value: unknown): void {
  verify(Array.isArray(value) && value.length <= 9)
  const hashes = new Set<string>()
  for (const row of value) {
    keys(row, OBLIGATION_KEYS); hash(row.requestHash, false); hash(row.phaseHash, false); hash(row.responseHash); count(row.outstandingBytes, 1900544)
    verify(!hashes.has(row.requestHash)); hashes.add(row.requestHash)
    verify(['reserved', 'dispatch_intent', 'outcome_unknown', 'response_retained', 'resolved'].includes(row.status))
    enumOrNull(row.resolutionReason, CREATIVE_RESOLUTION_REASONS); enumOrNull(row.unknownReason, CREATIVE_UNKNOWN_REASONS)
    if (row.status === 'resolved') { verify(row.outcome !== null && row.outstandingBytes === 0); reasons(row.outcome, row.resolutionReason, row.outcome === 'accepted' ? 'derived' : null) }
    else verify(row.outcome === null && row.resolutionReason === null && row.outstandingBytes > 0)
    if (row.status === 'response_retained' || row.outcome === 'accepted' || row.outcome === 'authority_revoked') verify(row.responseHash !== null)
    if (['reserved', 'dispatch_intent', 'outcome_unknown'].includes(row.status)) verify(row.responseHash === null)
    verify(row.status === 'outcome_unknown' ? row.unknownReason !== null : row.unknownReason === null)
  }
}
function task(value: unknown, id: string, passed: boolean): void {
  keys(value, TASK_KEYS); verify(value.id === id && ['pending', 'reserved', 'dispatch_intent', 'outcome_unknown', 'response_retained', 'resolved'].includes(value.phase)); HASH_KEYS.forEach(key => hash(value[key])); enumOrNull(value.unknownReason, CREATIVE_UNKNOWN_REASONS); reasons(value.outcome, value.resolutionReason, value.artifactHash)
  for (const k of ['wireBytes', 'wireUtf16', 'rawUtf16']) count(value[k], 65536)
  for (const k of ['rawBytes', 'rawScalars', 'derivedBytes', 'derivedUtf16', 'derivedScalars', 'canonicalScalars', 'inputTokens', 'outputTokens', 'reasoningTokens', 'stepCount']) if (value[k] !== null) count(value[k])
  enumOrNull(value.finishReason, ['stop', 'length', 'content_filter', 'tool_calls', 'error', 'other', 'unknown']); enumOrNull(value.reportedModelStatus, ['absent', 'matched', 'mismatch', 'invalid']); enumOrNull(value.usageStatus, ['complete', 'partial', 'unavailable', 'invalid']); enumOrNull(value.usageProvenance, ['synthetic_control'])
  verify(Array.isArray(value.anomalies) && value.anomalies.length <= 5 && JSON.stringify(value.anomalies) === JSON.stringify(ANOMALIES.filter(a => value.anomalies.includes(a))))
  if (passed) {
    verify(value.phase === 'resolved' && value.outcome === 'accepted' && value.unknownReason === null && HASH_KEYS.every(k => k === 'reportedModelHash' || value[k] !== null))
    verify(value.finishReason === 'stop' && value.reportedModelStatus === 'matched' && value.reportedModelHash !== null && ['complete', 'partial', 'unavailable'].includes(value.usageStatus) && value.usageProvenance === 'synthetic_control' && value.stepCount === 1 && value.anomalies.length === 0 && value.outputTokens <= 4096 && (value.reasoningTokens === null || value.reasoningTokens === 0))
    verify(value.wireBytes > 0 && value.rawBytes !== null && value.rawScalars !== null && value.canonicalScalars !== null)
    const cap = id === 'outline' ? 8192 : id === 'characters' ? 16384 : id === 'details' ? 32768 : id.startsWith('o-') ? 6144 : 8192
    verify(value.derivedBytes !== null && value.derivedUtf16 !== null && value.derivedScalars !== null && value.rawBytes <= cap && value.derivedBytes <= cap)
    if (id.startsWith('b-')) verify(value.rawUtf16 <= 2048 && value.rawBytes <= 8192 && value.canonicalScalars >= 256 && value.canonicalScalars <= 1024 && value.derivedBytes === value.rawBytes && value.derivedUtf16 === value.rawUtf16 && value.derivedScalars === value.rawScalars)
  }
}
function positive(value: unknown, id: string, language: string, checkIds: readonly string[], notOwned: boolean): void {
  keys(value, POSITIVE_KEYS); verify(value.id === id && value.language === language && STATUSES.includes(value.status)); enumOrNull(value.errorCode, CREATIVE_ACTION_CODES); enumOrNull(value.activeCheck, checkIds)
  verify(Array.isArray(value.checks) && value.checks.length === checkIds.length)
  value.checks.forEach((row: unknown, i: number) => { keys(row, ['id', 'status']); verify(row.id === checkIds[i] && ['not_run', 'pass', 'fail'].includes(row.status)) })
  keys(value.metrics, CREATIVE_METRIC_KEYS)
  for (const k of CREATIVE_METRIC_KEYS) { const n = value.metrics[k]; if (k.endsWith('Ms') && k !== 'activeReservationMs') verify(typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER); else count(n) }
  verify(Array.isArray(value.tasks) && value.tasks.length === 9); value.tasks.forEach((row: unknown, i: number) => task(row, CREATIVE_TASK_IDS[i]!, value.status === 'pass'))
  obligations(value.obligations); verify(['not_run', 'last_verified', 'unconfirmed'].includes(value.observation)); for (const k of ['finalCheckpointHash', 'beforeOrdinaryHash', 'afterOrdinaryHash']) hash(value[k]); verify(['not_run', 'pass', 'fail'].includes(value.coldReopen))
  if (value.observation === 'last_verified') verify(value.obligations.reduce((sum: number, r: CreativeObligation) => sum + r.outstandingBytes, 0) === value.metrics.outstandingBytes)
  if (value.status === 'pass') {
    const m = value.metrics
    verify(value.checks.every((r: CreativeCheckRow) => r.status === 'pass') && value.errorCode === null && value.observation === 'last_verified' && value.finalCheckpointHash !== null && value.beforeOrdinaryHash !== null && value.beforeOrdinaryHash === value.afterOrdinaryHash && value.coldReopen === 'pass')
    verify(m.attempts === 9 && m.acceptedTasks === 9 && m.acceptedBodies === 3 && m.httpAttempts === 9 && m.operations === 37 && m.activeReservationMs === 550000 && m.outstandingBytes === 0 && m.writtenBytes > 0 && m.writtenBytes + m.recoveryBytes <= 67108864 && m.recoveryBytes === 524288 && m.allocatedBytes - m.consumedBytes - m.releasedBytes === 0 && m.consumedBytes <= m.writtenBytes && m.accountingMismatches === 0)
    verify(m.readCalls > 0 && m.maxReadBatchKeys > 0 && m.maxReadBatchKeys <= 33 && m.finalFenceExpectedKeys > 0 && m.finalFenceExpectedKeys <= 174 && m.maxCapturedKeys >= m.finalFenceExpectedKeys && m.finalFenceObservedKeys === m.finalFenceExpectedKeys && m.maxCapturedKeys <= 174 && m.maxCapturedBytes <= 67108864 && m.activeOwners === 0 && m.activeCalls === 0)
    verify(m.maxRepositoryActionMs > 0 && m.maxRepositoryActionMs < 10000 && m.maxVerifiedReadMs > 0 && m.maxVerifiedReadMs < 10000 && m.maxRawIoMs < 3000 && m.maxCasMs < 3000 && m.maxStageMs > 0 && m.maxStageMs < 60000 && m.maxSdkMs > 0 && m.maxSdkMs < 30000 && m.runWallMs > 0 && m.runWallMs < 900000)
    verify(value.obligations.length === 9 && value.obligations.every((r: CreativeObligation) => r.status === 'resolved' && r.outcome === 'accepted' && value.tasks.some((t: CreativeTaskReport) => t.requestHash === r.requestHash && t.responseHash === r.responseHash)))
    verify(new Set(value.tasks.map((r: CreativeTaskReport) => r.requestHash)).size === 9 && new Set(value.tasks.map((r: CreativeTaskReport) => r.intentHash)).size === 9)
  }
  if (notOwned || value.status === 'not_run') verify(JSON.stringify(value) === JSON.stringify(emptyPositive(id, language as 'zh' | 'en', checkIds)))
}
function controls(value: unknown, ids: readonly string[], notOwned: boolean, kind: string): void {
  verify(Array.isArray(value) && value.length === ids.length)
  value.forEach((row, i) => {
    keys(row, CONTROL_KEYS); verify(row.id === ids[i] && STATUSES.includes(row.status)); enumOrNull(row.activeCheck, ids); enumOrNull(row.errorCode, CREATIVE_ACTION_CODES); enumOrNull(row.unknownReason, CREATIVE_UNKNOWN_REASONS); enumOrNull(row.resolutionReason, CREATIVE_RESOLUTION_REASONS)
    for (const k of ['assertions', 'setupHttpAttempts', 'exerciseHttpAttempts', 'recoveryHttpAttempts', 'setupSuccessfulCas', 'successfulCas']) count(row[k], 100000)
    verify(row.setupHttpAttempts + row.exerciseHttpAttempts + row.recoveryHttpAttempts <= 256)
    hash(row.snapshotHash); hash(row.receiptHash); obligations(row.obligations); verify(['not_run', 'last_verified', 'unconfirmed'].includes(row.observation))
    if (row.status === 'pass') {
      verify(row.assertions > 0 && row.activeCheck === row.id)
      if (kind === 'durability') verify(row.exerciseHttpAttempts === 0 && row.recoveryHttpAttempts === 0 && row.successfulCas === (row.id.startsWith('B:') ? 0 : 1))
      if (kind === 'durability') verify(row.setupHttpAttempts === (row.id === 'B:D01' ? 2 : 0) && row.setupSuccessfulCas === (row.id === 'B:D01' ? 11 : 0))
      if (kind === 'reportControls' || kind === 'compiler') verify(row.setupHttpAttempts + row.exerciseHttpAttempts + row.recoveryHttpAttempts === 0)
    }
    if (notOwned || row.status === 'not_run') verify(JSON.stringify(row) === JSON.stringify(emptyCreativeControl(ids[i]!)))
  })
}
export function validateCreativeReport(value: unknown): asserts value is CreativeReadinessReport {
  keys(value, ['protocol', 'scope', 'contractVersion', 'execution', 'contract', 'source', 'sourceStable', 'builds', 'positiveNode', 'positiveApp', 'compiler', 'metamorphic', 'durability', 'engine', 'appInterruptions', 'reportControls', 'blockedExternalRequests', 'browserErrors', 'teardown', 'liveCreativeQuality', 'semanticConsistency', 'wholeWorkAudit', 'millionCharacterAcceptance'])
  verify(value.protocol === 'creative-pilot-readiness-report-v1' && value.scope === 'offline_controlled_sdk_readiness' && value.contractVersion === 'creative-pilot-policy-v1' && ['node', 'browser'].includes(value.execution))
  keys(value.contract, Object.keys(CREATIVE_CONTRACT)); for (const [k, expected] of Object.entries(CREATIVE_CONTRACT)) verify(value.contract[k] === expected)
  keys(value.source, SOURCE_KEYS); for (const k of ['commit', 'tree']) verify(value.source[k] === null || typeof value.source[k] === 'string' && /^[a-f0-9]{40}$/.test(value.source[k])); for (const k of SOURCE_KEYS.slice(2)) hash(value.source[k], false)
  verify(['not_checked', 'verified', 'changed'].includes(value.sourceStable)); keys(value.builds, ['normalApp', 'controlledApp', 'nativeDriver']); Object.values(value.builds).forEach(v => hash(v))
  verify(Array.isArray(value.positiveNode) && value.positiveNode.length === 6 && Array.isArray(value.positiveApp) && value.positiveApp.length === 2)
  value.positiveNode.forEach((row: unknown, i: number) => positive(row, CREATIVE_NODE_IDS[i]!, i < 3 ? 'zh' : 'en', CREATIVE_POSITIVE_CHECKS, value.execution !== 'node'))
  value.positiveApp.forEach((row: unknown, i: number) => positive(row, CREATIVE_APP_IDS[i]!, i === 0 ? 'zh' : 'en', CREATIVE_APP_CHECKS, value.execution !== 'browser'))
  for (const [name, ids] of [['compiler', CREATIVE_COMPILER_IDS], ['metamorphic', CREATIVE_METAMORPHIC_IDS], ['durability', CREATIVE_DURABLE_IDS], ['engine', CREATIVE_ENGINE_IDS], ['reportControls', CREATIVE_REPORT_IDS]] as const) controls(value[name], ids, value.execution !== 'node', name)
  controls(value.appInterruptions, CREATIVE_INTERRUPTION_IDS, value.execution !== 'browser', 'appInterruptions')
  count(value.blockedExternalRequests); count(value.browserErrors); verify(['not_run', 'pass', 'fail'].includes(value.teardown))
  for (const k of ['liveCreativeQuality', 'semanticConsistency', 'wholeWorkAudit', 'millionCharacterAcceptance']) verify(value[k] === 'NOT_RUN')
  if (value.execution === 'node') verify(Object.values(value.builds).every(v => v === null) && value.browserErrors === 0)
  verify(byteOracle(JSON.stringify(value)) <= CREATIVE_CONTRACT.reportBytes)
}
export function creativeReportPassed(report: CreativeReadinessReport): boolean {
  validateCreativeReport(report)
  const owned = report.execution === 'node' ? [report.positiveNode, report.compiler, report.metamorphic, report.durability, report.engine, report.reportControls] : [report.positiveApp, report.appInterruptions]
  return report.sourceStable === 'verified' && report.teardown === 'pass' && report.blockedExternalRequests === 0 && report.browserErrors === 0 && owned.every(rows => rows.every(row => row.status === 'pass')) && (report.execution === 'node' || report.builds.normalApp !== null && report.builds.controlledApp !== null && report.builds.nativeDriver !== null)
}
export function creativePopulationCounts(report: CreativeReadinessReport) { validateCreativeReport(report); return Object.fromEntries((['positiveNode', 'positiveApp', 'compiler', 'metamorphic', 'durability', 'engine', 'appInterruptions', 'reportControls'] as const).map(k => [k, { rows: report[k].length, passed: report[k].filter(r => r.status === 'pass').length }])) }
