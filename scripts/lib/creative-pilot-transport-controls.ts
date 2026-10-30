/** Actual SDK anomaly controls. No production-adapter output substitution. */
import type { CreativeControlRow } from './creative-pilot-report'
import { creativePilotBriefs } from './creative-pilot-briefs'
import { runCreativeFaultSeed, collectCreativeFaultFailure } from './creative-pilot-engine-controls'
import type { CreativeControlMode } from './creative-pilot-control'
import { controlAssert, rowMapOracle, storageCounterOracle } from './creative-pilot-oracles'
import { safeCreativeCode } from './creative-pilot-report'
export async function runCreativeTransportControls(rows: CreativeControlRow[], onCase?: (value: { id: string; mode: CreativeControlMode; status: string; httpAttempts: number; reason: string | null }) => void) {
  const definitions: Array<{ id: 'E12' | 'E13' | 'E14' | 'E15'; mode: CreativeControlMode; outcome: string; reason: string | null; calls?: number }> = [
    { id: 'E12', mode: 'invalid_json', outcome: 'refused', reason: 'invalid_json' },
    { id: 'E12', mode: 'unknown_reference', outcome: 'refused', reason: 'invalid_reference' },
    { id: 'E12', mode: 'body_short', outcome: 'refused', reason: 'body_length', calls: 7 },
    { id: 'E12', mode: 'body_long', outcome: 'refused', reason: 'body_length', calls: 7 },
    { id: 'E13', mode: 'finish_length', outcome: 'refused', reason: 'finish_incomplete' },
    { id: 'E13', mode: 'finish_missing', outcome: 'refused', reason: 'finish_incomplete' },
    { id: 'E14', mode: 'model_absent', outcome: 'refused', reason: 'reported_model_absent' },
    { id: 'E14', mode: 'model_mismatch', outcome: 'refused', reason: 'reported_model_mismatch' },
    { id: 'E14', mode: 'model_invalid', outcome: 'refused', reason: 'reported_model_invalid' },
    { id: 'E14', mode: 'usage_absent', outcome: 'accepted', reason: null },
    { id: 'E14', mode: 'usage_partial', outcome: 'accepted', reason: null },
    { id: 'E14', mode: 'usage_complete', outcome: 'accepted', reason: null },
    { id: 'E14', mode: 'usage_invalid', outcome: 'refused', reason: 'usage_invalid' },
    { id: 'E14', mode: 'usage_fractional', outcome: 'refused', reason: 'usage_invalid' },
    { id: 'E14', mode: 'usage_unsafe', outcome: 'refused', reason: 'usage_invalid' },
    { id: 'E14', mode: 'reasoning_usage', outcome: 'refused', reason: 'reasoning_disallowed' },
    { id: 'E14', mode: 'reasoning', outcome: 'refused', reason: 'reasoning_disallowed' },
    { id: 'E14', mode: 'tool', outcome: 'refused', reason: 'finish_incomplete' },
    { id: 'E14', mode: 'lone_surrogate', outcome: 'refused', reason: 'invalid_scalar' },
    { id: 'E15', mode: 'http_invalid_utf8', outcome: 'unknown', reason: null },
    { id: 'E15', mode: 'http_invalid_json', outcome: 'unknown', reason: null },
    { id: 'E15', mode: 'http_duplicate_key', outcome: 'unknown', reason: null },
    { id: 'E15', mode: 'http_overflow', outcome: 'unknown', reason: null },
    { id: 'E15', mode: 'http_redirect', outcome: 'unknown', reason: null },
    { id: 'E15', mode: 'lost_response', outcome: 'unknown', reason: null },
  ]
  const brief = creativePilotBriefs()[3]!.brief
  for (const definition of definitions) {
    const row = rows.find(r => r.id === definition.id)!
    row.status = 'running'; row.activeCheck = row.id
    try {
      const seed = await runCreativeFaultSeed('transport-' + definition.mode, brief, definition.mode, definition.outcome === 'accepted')
      row.exerciseHttpAttempts += seed.http.attempts; row.successfulCas += seed.io.successfulCas; row.snapshotHash = await rowMapOracle(seed.rows); row.receiptHash = seed.snapshot.receipt.hash; row.observation = 'last_verified'
      const index = seed.snapshot.checkpoint.requests.at(-1)!, phase = seed.snapshot.phases.get(index.phaseHash)!, request = seed.snapshot.requests.get(index.requestHash)!
      const unresolved = row.obligations.filter(item => item.status !== 'resolved')
      row.obligations = seed.snapshot.checkpoint.requests.map(index => { const phase = seed.snapshot.phases.get(index.phaseHash)!, request = seed.snapshot.requests.get(index.requestHash)!; return { requestHash: index.requestHash, phaseHash: index.phaseHash, status: phase.status, responseHash: phase.responseHash, outcome: phase.resolution?.outcome ?? null, resolutionReason: phase.resolution?.reason ?? null, unknownReason: phase.reason, outstandingBytes: storageCounterOracle(seed.snapshot.checkpoint.storage.openAllocations.find(x => x.request.id === request.id)?.remainingBytes ?? '0000000000000000') } })
      row.obligations = [...unresolved.filter(prior => !row.obligations.some(current => current.requestHash === prior.requestHash)), ...row.obligations]
      controlAssert(row.obligations.length <= 9)
      row.resolutionReason = phase.resolution?.reason ?? null; row.unknownReason = phase.reason
      controlAssert(seed.http.attempts === (definition.calls ?? 1) && seed.http.errors === 0 && seed.http.blockedExternalRequests === 0 && seed.io.accountingMismatches === 0); row.assertions++
      if (definition.outcome === 'unknown') { controlAssert(phase.status === 'outcome_unknown' && phase.responseHash === null && storageCounterOracle(seed.snapshot.checkpoint.storage.outstandingBytes) > 0); row.assertions++ }
      else {
        controlAssert(phase.status === 'resolved' && phase.resolution?.outcome === definition.outcome && phase.resolution?.reason === definition.reason && phase.responseHash !== null); row.assertions++
        const response = seed.snapshot.responses.get(phase.responseHash!)!
        controlAssert(response.requestHash === request.hash && response.intentHash !== null); row.assertions++
        if (definition.mode === 'usage_absent') { controlAssert(response.usage.inputTokens === null && response.usage.outputTokens === null && response.usage.reasoningTokens === null); row.assertions++ }
        if (definition.mode === 'usage_partial') { controlAssert(response.usage.inputTokens === 37 && response.usage.outputTokens === null && response.usage.reasoningTokens === null); row.assertions++ }
        if (definition.mode === 'usage_complete') { controlAssert(response.usage.status === 'complete' && response.usage.reasoningTokens === 0); row.assertions++ }
        if (definition.mode === 'model_absent') { controlAssert(response.reportedModel.status === 'absent' && response.reportedModel.value === null); row.assertions++ }
        if (definition.mode === 'reasoning') { controlAssert(response.contentEvidence.anomalies.includes('reasoning_present') && response.usage.reasoningTokens === null); row.assertions++ }
        if (definition.mode === 'lone_surrogate') { controlAssert(response.textJson === '"\\ud800"' && response.scalarMetrics === null && response.textUtf16 === 1); row.assertions++ }
      }
      onCase?.({ id: row.id, mode: definition.mode, status: 'pass', httpAttempts: seed.http.attempts, reason: row.resolutionReason })
    } catch (error) { collectCreativeFaultFailure(row, error); row.status = 'failed'; row.errorCode = safeCreativeCode(error); onCase?.({ id: row.id, mode: definition.mode, status: 'failed', httpAttempts: row.exerciseHttpAttempts, reason: row.resolutionReason }); throw error }
  }
  for (const id of ['E12', 'E13', 'E14', 'E15']) rows.find(row => row.id === id)!.status = 'pass'
}
