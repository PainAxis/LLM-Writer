import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
/** Focused independent boundary population; one explicitly counted real-SDK nine-task setup. */
import { emptyCreativeReport } from './lib/creative-pilot-report'
import { creativeSchemaSource } from './lib/creative-pilot-report-fixtures'
import { creativePilotBriefs } from './lib/creative-pilot-briefs'
import { runCreativeFaultSeed } from './lib/creative-pilot-engine-controls'
import { runCreativeEngineBoundaries } from './lib/creative-pilot-engine-boundaries'
const report = emptyCreativeReport(creativeSchemaSource, 'node')
try { const baseline = await runCreativeFaultSeed('boundary-baseline', creativePilotBriefs()[0]!.brief, 'normal'); const privateRoot = path.resolve(process.env.CREATIVE_PILOT_PRIVATE_DIR ?? 'artifacts/creative-pilot-private'); await mkdir(privateRoot, { recursive: true, mode: 0o700 }); await writeFile(path.join(privateRoot, `boundaries-baseline-${crypto.randomUUID()}.json`), JSON.stringify({ rows: [...baseline.rows], prefixes: baseline.prefixes.map(p => ({ ...p, rows: [...p.rows] })), http: baseline.http, io: baseline.io }), { mode: 0o600, flag: 'wx' }); await runCreativeEngineBoundaries(report.engine, baseline); console.log(JSON.stringify({ status: 'pass', setupHttpAttempts: baseline.http.attempts, rows: report.engine.filter(r => r.status !== 'not_run') })) }
catch { console.log(JSON.stringify({ status: 'failed', rows: report.engine })); process.exitCode = 1 }
