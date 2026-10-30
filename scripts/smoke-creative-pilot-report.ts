import { runCreativeReportControls } from './lib/creative-pilot-report-controls'
/** Closed report validation, not production execution acceptance. */
import { creativeSchemaSource, syntheticCreativePassReport } from './lib/creative-pilot-report-fixtures'
import { creativeReportPassed, emptyCreativeReport, validateCreativeReport } from './lib/creative-pilot-report'
import { controlAssert } from './lib/creative-pilot-oracles'
let groups = 0
function rejects(mutate: (value: any) => void, execution: 'node' | 'browser' = 'node') { const value = syntheticCreativePassReport(execution); mutate(value); let rejected = false; try { validateCreativeReport(value) } catch { rejected = true }; controlAssert(rejected); groups++ }
try {
  controlAssert(creativeReportPassed(syntheticCreativePassReport('node')) && creativeReportPassed(syntheticCreativePassReport('browser'))); groups++
  const empty = emptyCreativeReport(creativeSchemaSource, 'node'); validateCreativeReport(empty); controlAssert(!creativeReportPassed(empty)); groups++
  rejects(r => { r.rawBody = 'untrusted' })
  rejects(r => { r.positiveNode[0].tasks[0].body = 'untrusted' })
  rejects(r => { r.positiveNode[0].tasks[0].rawResponse = 'untrusted' })
  rejects(r => { r.source.endpoint = 'http://example.invalid' })
  rejects(r => { r.positiveNode[0].obligations.push(r.positiveNode[0].obligations[0]) })
  rejects(r => { r.positiveNode[0].metrics.maxCasMs = Infinity })
  rejects(r => { r.source.coreSha256 = 'bad' })
  rejects(r => { r.contract.attempts = 10 })
  rejects(r => { r.positiveApp = syntheticCreativePassReport('browser').positiveApp })
  rejects(r => { r.positiveNode = syntheticCreativePassReport('node').positiveNode }, 'browser')
  rejects(r => { r.positiveNode[0].metrics.httpAttempts = 8 })
  rejects(r => { r.positiveNode[0].metrics.finalFenceObservedKeys-- })
  rejects(r => { r.compiler.pop() })
  rejects(r => { r.positiveNode[0].obligations[0].status = 'outcome_unknown' })
  const partial = emptyCreativeReport(creativeSchemaSource, 'node'); partial.positiveNode[0]!.status = 'failed'; partial.positiveNode[0]!.activeCheck = 'raw_to_compiled'; partial.positiveNode[0]!.errorCode = 'storage_unknown'; partial.positiveNode[0]!.observation = 'unconfirmed'; validateCreativeReport(partial); controlAssert(!creativeReportPassed(partial)); groups++
  rejects(r => { r.engine[0].errorCode = 'raw provider error' })
  rejects(r => { r.positiveNode[0].tasks[0].reportedModelStatus = 'absent' })
  rejects(r => { r.positiveNode[0].tasks[0].anomalies = ['reasoning_present'] })
  rejects(r => { r.positiveNode[0].tasks[0].derivedBytes = 8193 })
  const named = emptyCreativeReport(creativeSchemaSource, 'node'); await runCreativeReportControls(named.reportControls); controlAssert(named.reportControls.every(row => row.status === 'pass')); groups += named.reportControls.length
  process.stdout.write(JSON.stringify({ status: 'pass', scope: 'synthetic_report_schema_only', groups, positiveGenerationTasksAwarded: 0 }) + '\n')
} catch { process.stdout.write(JSON.stringify({ status: 'failed', scope: 'synthetic_report_schema_only', groups, positiveGenerationTasksAwarded: 0 }) + '\n'); process.exitCode = 1 }
