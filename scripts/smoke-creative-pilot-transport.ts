import { runCreativeDispatchControls } from './lib/creative-pilot-dispatch-controls'
import { emptyCreativeReport } from './lib/creative-pilot-report'
import { creativeSchemaSource } from './lib/creative-pilot-report-fixtures'
import { runCreativeTransportControls } from './lib/creative-pilot-transport-controls'
const report = emptyCreativeReport(creativeSchemaSource, 'node')
let dispatchCompleted = false
try {
  const dispatch = await runCreativeDispatchControls(); dispatchCompleted = true
  process.stdout.write(JSON.stringify({ scope: 'pure_dispatch_admission_and_actual_sdk_pre_intent_overflow', ...dispatch }) + '\n')
  await runCreativeTransportControls(report.engine, row => process.stdout.write(JSON.stringify(row) + '\n'))
  process.stdout.write(JSON.stringify({ status: 'pass', scope: 'actual_sdk_transport_anomalies', rows: report.engine.filter(r => r.status !== 'not_run') }) + '\n')
} catch (error) {
  const evidence = (error as { creativeControlEvidence?: { http: { attempts: number } } })?.creativeControlEvidence
  process.stdout.write(JSON.stringify({ status: 'failed', scope: 'actual_sdk_transport_anomalies', dispatchFailureHttpAttempts: dispatchCompleted ? null : evidence?.http.attempts ?? null, rows: report.engine.filter(r => r.status !== 'not_run') }) + '\n')
  process.exitCode = 1
}
