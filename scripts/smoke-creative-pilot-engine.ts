/** Focused actual SDK integration; final exact-tree populations remain separate. */
import { creativePilotBriefs } from './lib/creative-pilot-briefs'
import { creativeSchemaSource } from './lib/creative-pilot-report-fixtures'
import { emptyCreativeReport, validateCreativeReport } from './lib/creative-pilot-report'
import { runCreativePositiveCampaign } from './lib/creative-pilot-runner'
import { runCreativeReceiptProjectionControls, runCreativeBoundaryFailureControls } from './lib/creative-pilot-regression-controls'
const fixture = creativePilotBriefs()[0]!, report = emptyCreativeReport(creativeSchemaSource, 'node')
const result = await runCreativePositiveCampaign({ id: fixture.id, brief: fixture.brief, row: report.positiveNode[0]!, capturePrefixes: true })

if (result.row.status === 'pass' && result.snapshot) { const receipts = await runCreativeReceiptProjectionControls(result.snapshot, result.rows, result.http); if (receipts.acceptedTasks !== 9 || receipts.distinctTerminalReceipts !== 9) throw new Error('creative_receipt_projection_failed') }

if (result.row.status === 'pass' && result.snapshot) await runCreativeBoundaryFailureControls({ snapshot: result.snapshot, rows: result.rows, prefixes: result.prefixes, http: result.http, io: result.io, errorCode: result.row.errorCode })

validateCreativeReport(report)
process.stdout.write(JSON.stringify({ status: result.row.status, scope: 'focused_mutable_tree_sdk_integration', activeCheck: result.row.activeCheck, errorCode: result.row.errorCode, httpAttempts: result.http.attempts, endpointErrors: result.http.errors, acceptedTasks: result.row.metrics.acceptedTasks, obligations: result.row.obligations, capturedPrefixes: result.prefixes.length, accountingMismatches: result.row.metrics.accountingMismatches }) + '\n')
if (result.row.status !== 'pass') process.exitCode = 1
