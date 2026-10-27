/** Exact-tree Node readiness. Each population is separately counted; no literary acceptance. */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { creativeIdentity, creativeIdentityMatches } from './lib/creative-pilot-identity.mjs'
import { creativePilotBriefs } from './lib/creative-pilot-briefs'
import { emptyCreativeReport, creativeReportPassed, validateCreativeReport } from './lib/creative-pilot-report'
import { runCreativePositiveCampaign } from './lib/creative-pilot-runner'
import { runCreativeCompilerControls } from './lib/creative-pilot-compiler-controls'
import { runCreativeMetamorphicControls } from './lib/creative-pilot-metamorphic'
import { runCreativeDurabilityControls, type CreativeFaultSeed } from './lib/creative-pilot-faults'
import { runCreativeTransportControls } from './lib/creative-pilot-transport-controls'
import { runCreativeOwnerControls } from './lib/creative-pilot-owner-controls'
import { runCreativeEngineBoundaries } from './lib/creative-pilot-engine-boundaries'
import { runCreativeReportControls } from './lib/creative-pilot-report-controls'
import { controlAssert } from './lib/creative-pilot-oracles'
const root = process.cwd(), source = await creativeIdentity(root), report = emptyCreativeReport(source.source, 'node')
const target = path.join(root, 'artifacts/creative-pilot/node-summary.json')
const persist = async () => { validateCreativeReport(report); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, JSON.stringify(report, null, 2) + '\n') }
let baseline: CreativeFaultSeed | null = null
try {
  await persist()
  for (const [index, fixture] of creativePilotBriefs().entries()) {
    const result = await runCreativePositiveCampaign({ id: fixture.id, brief: fixture.brief, row: report.positiveNode[index]!, identity: source.identity, capturePrefixes: index === 0, coldProcess: true, onProgress: persist })
    await persist(); controlAssert(result.row.status === 'pass' && result.snapshot)
    if (index === 0) baseline = { snapshot: result.snapshot, prefixes: result.prefixes, rows: result.rows, http: result.http, errorCode: result.row.errorCode, io: result.io }
  }
  controlAssert(baseline)
  await runCreativeCompilerControls(report.compiler); await persist()
  await runCreativeMetamorphicControls(report.metamorphic, baseline); await persist()
  await runCreativeDurabilityControls(report.durability, undefined, () => {}); await persist()
  await runCreativeTransportControls(report.engine); await persist()
  await runCreativeOwnerControls(report.engine); await persist()
  await runCreativeEngineBoundaries(report.engine, baseline); await persist()
  await runCreativeReportControls(report.reportControls); await persist()
  report.teardown = 'pass'
} catch { report.teardown = 'fail' }
finally { report.sourceStable = await creativeIdentityMatches(root, source.source) ? 'verified' : 'changed'; await persist() }
process.stdout.write(JSON.stringify({ scope: report.scope, status: creativeReportPassed(report) ? 'pass' : 'not_passed', positiveTasks: report.positiveNode.reduce((n, r) => n + r.metrics.acceptedTasks, 0), positiveHttp: report.positiveNode.reduce((n, r) => n + r.metrics.httpAttempts, 0), app: 'NOT_RUN', literaryQuality: 'NOT_RUN' }) + '\n')
if (!creativeReportPassed(report)) process.exitCode = 1
