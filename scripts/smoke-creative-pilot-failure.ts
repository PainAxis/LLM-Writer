/** Failed-run evidence: zero-dispatch intent cut, then six actual SDK setup/failure controls; no positive credit. */
import { mkdir, mkdtemp, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { creativePilotBriefs } from './lib/creative-pilot-briefs'
import { creativeSchemaSource } from './lib/creative-pilot-report-fixtures'
import { emptyCreativeReport } from './lib/creative-pilot-report'
import { runCreativePositiveCampaign } from './lib/creative-pilot-runner'
import { runCreativeSecondSeedFailureControls, runCreativeDurabilitySetupAccountingControl } from './lib/creative-pilot-regression-controls'
import { controlAssert, rowMapOracle } from './lib/creative-pilot-oracles'
const old = process.env.CREATIVE_PILOT_PRIVATE_DIR, parentRoot = path.resolve(old ?? 'artifacts/creative-pilot-private')
await mkdir(parentRoot, { recursive: true, mode: 0o700 })
const privateRoot = await mkdtemp(path.join(parentRoot, 'creative-failed-map-'))
process.env.CREATIVE_PILOT_PRIVATE_DIR = privateRoot
try {
  const report = emptyCreativeReport(creativeSchemaSource, 'node'), row = report.positiveNode[0]!, fixture = creativePilotBriefs()[0]!
  let cut = false
  const result = await runCreativePositiveCampaign({ id: 'forced-failure', brief: fixture.brief, row, coldProcess: false, onProgress: async () => { if (!cut && row.tasks[0]!.phase === 'dispatch_intent') { cut = true; throw new Error('controlled_after_intent_failure') } } })
  controlAssert(cut && row.status === 'failed' && result.http.attempts === 0 && row.obligations.length === 1 && row.obligations[0]!.status === 'outcome_unknown' && row.obligations[0]!.outstandingBytes > 0)
  const files = await readdir(privateRoot); controlAssert(files.length === 1)
  const file = path.join(privateRoot, files[0]!), saved = JSON.parse(await readFile(file, 'utf8'))
  controlAssert(((await stat(file)).mode & 0o777) === 0o600 && await rowMapOracle(new Map(saved.rows)) === await rowMapOracle(result.rows))
  const secondSeed = await runCreativeSecondSeedFailureControls(privateRoot)
  const setupAccounting = await runCreativeDurabilitySetupAccountingControl()
  console.log(JSON.stringify({ status: 'pass', secondSeed, setupAccounting, scope: 'failure_evidence_only', sdkCalls: result.http.attempts + secondSeed.sdkCalls + setupAccounting.sdkCalls, intentCutSdkCalls: result.http.attempts, exactPrivateMap: true, outstandingBytes: row.obligations[0]!.outstandingBytes, phase: row.obligations[0]!.status }))
} finally { if (old === undefined) delete process.env.CREATIVE_PILOT_PRIVATE_DIR; else process.env.CREATIVE_PILOT_PRIVATE_DIR = old }
