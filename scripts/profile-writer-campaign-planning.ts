/** Separate compact structured-plan profiles. Never substitutes for legacy 1M geometry. */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { planningEvidenceIdentity, planningEvidenceIdentityMatches } from './fixtures/writer-campaign-planning-identity.mjs'
import { installNodePlanningAuthorityGuard } from './fixtures/writer-campaign-planning-authority.mjs'
import { createPlanningMemoryIO } from './fixtures/writer-campaign-planning-io'
import { runPlanningProfile } from './fixtures/writer-campaign-planning-profile'
import { emptyPlanningReport, planningReportExitCode, safePlanningCode, validatePlanningReport } from './fixtures/writer-campaign-planning-report'
const root = fileURLToPath(new URL('../', import.meta.url)), target = path.join(root, 'artifacts/writer-campaign-planning/node-summary.json')
const authority = installNodePlanningAuthorityGuard()
try {
  const provenance = await planningEvidenceIdentity(root), report = emptyPlanningReport(provenance.source, 'node-injected-atomic-io-not-browser-idb')
  const persist = async () => { validatePlanningReport(report); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, `${JSON.stringify(report, null, 2)}\n`) }
  await persist()
  for (const [i, row] of report.profiles.entries()) {
    const storage = createPlanningMemoryIO()
    report.profiles[i] = await runPlanningProfile(row.profile, row.language, provenance.identity, storage.observe, authority.snapshot, storage.io, async progress => { report.profiles[i] = progress; await persist() })
    await persist()
    console.log(`Planning ${row.profile}/${row.language}: ${report.profiles[i]!.status}; tasks=${report.profiles[i]!.committedTasks}; semanticConsistency=NOT_RUN.`)
  }
  if (!await planningEvidenceIdentityMatches(root, report.source)) {
    for (const row of report.profiles) if (row.status === 'pass' || row.status === 'running') { row.status = 'failed'; row.refusalCode = 'source_changed' }
    await persist(); console.error('planning_source_identity_changed')
  }
  process.exitCode = planningReportExitCode(report)
} catch (error) { console.error(JSON.stringify({ suite: 'writer-campaign-planning-node', code: safePlanningCode(error), semanticConsistency: 'NOT_RUN' })); process.exitCode = 1 }
finally { authority.restore() }
