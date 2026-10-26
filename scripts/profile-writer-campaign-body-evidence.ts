/** Each workload executes once, serially, under unchanged production limits. */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { hashCampaignValue } from '../src/services/writerCampaign/protocol'
import { bodyEvidenceIdentity, bodyEvidenceIdentityMatches } from './fixtures/writer-campaign-body-evidence-identity.mjs'
import { installNodeBodyEvidenceAuthorityGuard } from './fixtures/writer-campaign-body-evidence-authority.mjs'
import { createBodyEvidenceMemoryIO } from './fixtures/writer-campaign-body-evidence-io'
import { runBodyEvidenceProfile } from './fixtures/writer-campaign-body-evidence-profile'
import { emptyBodyEvidenceReport, bodyEvidenceReportExitCode, safeBodyEvidenceCode, validateBodyEvidenceReport } from './fixtures/writer-campaign-body-evidence-report'
const root = fileURLToPath(new URL('../', import.meta.url)), target = path.join(root, 'artifacts/writer-campaign-body-evidence/node-summary.json'), guard = installNodeBodyEvidenceAuthorityGuard()
try {
  const provenance = await bodyEvidenceIdentity(root), report = emptyBodyEvidenceReport(provenance.source, 'node')
  const persist = async () => { validateBodyEvidenceReport(report); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, `${JSON.stringify(report, null, 2)}\n`) }
  await persist()
  for (const [index, language] of (['zh', 'en'] as const).entries()) {
    const storage = createBodyEvidenceMemoryIO(), digest = () => hashCampaignValue('body-evidence-namespace-v1', [...storage.rows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    report.profiles[index] = await runBodyEvidenceProfile(language, provenance.identity, storage.observe, guard.snapshot, storage.io, async row => { report.profiles[index] = row; await persist() }, digest)
    await persist(); console.log(`Body evidence node-${language}: ${report.profiles[index]!.status}; tasks=${report.profiles[index]!.committedTasks}; semantics=NOT_RUN.`)
    // Do not retry or continue to another workload after a failed capacity gate.
    if (report.profiles[index]!.status !== 'pass') break
  }
  report.sourceStable = await bodyEvidenceIdentityMatches(root, report.source) ? 'verified' : 'changed'; report.teardown = 'pass'; await persist(); process.exitCode = bodyEvidenceReportExitCode(report)
} catch (error) { console.error(JSON.stringify({ suite: 'writer-campaign-body-evidence-node', code: safeBodyEvidenceCode(error), semanticExtraction: 'NOT_RUN' })); process.exitCode = 1 }
finally { guard.restore() }
