/** Focused 63 real-storage ACK variants; copied historical rows originate from two actual SDK calls. */
import { emptyCreativeReport } from './lib/creative-pilot-report'
import { creativeSchemaSource } from './lib/creative-pilot-report-fixtures'
import { runCreativeDurabilityControls } from './lib/creative-pilot-faults'
import { runCreativeStoreDeadlineControls } from './lib/creative-pilot-store-deadline-controls'
const report = emptyCreativeReport(creativeSchemaSource, 'node')
try { console.log(JSON.stringify(await runCreativeStoreDeadlineControls())); const counts = await runCreativeDurabilityControls(report.durability, undefined, row => console.log(JSON.stringify({ id: row.id, status: row.status, assertions: row.assertions, successfulCas: row.successfulCas, errorCode: row.errorCode }))); console.log(JSON.stringify({ status: 'pass', scope: 'durable_ack_controls', rows: report.durability.length, ...counts })) }
catch { console.log(JSON.stringify({ status: 'failed', scope: 'durable_ack_controls', rows: report.durability })); process.exitCode = 1 }
