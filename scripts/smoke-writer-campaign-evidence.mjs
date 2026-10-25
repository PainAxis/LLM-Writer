/* global process, Buffer */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { campaignBuildIdentity, CAMPAIGN_CORE_PATHS } from './campaign-build-identity.mjs'
import { CAMPAIGN_REPORT_PATH, projectCampaignReport } from './campaign-evidence.mjs'
import { campaignEvidenceCase } from './fixtures/campaign-evidence-case.mjs'
import { prepareEvidence, summarizeReport } from './prepare-ci-evidence.mjs'
import { getCampaignBuildIdentity } from '../src/services/writerCampaign/buildIdentity.ts'

let root, checks = 0
try {
  assert.throws(() => getCampaignBuildIdentity(), /unavailable/); checks++
  globalThis.__WRITER_CAMPAIGN_BUILD_IDENTITY__ = {
    runtimeIdentity: `campaign-core-sha256:${'a'.repeat(64)}`, source: { commit: null, tree: null },
  }
  const injected = getCampaignBuildIdentity()
  injected.source.commit = 'b'.repeat(40)
  assert.equal(getCampaignBuildIdentity().source.commit, null, 'Returned identity cannot mutate build constant')
  delete globalThis.__WRITER_CAMPAIGN_BUILD_IDENTITY__; checks++
  const valid = campaignEvidenceCase()
  assert.deepEqual(projectCampaignReport(valid), valid); checks++
  for (const mutate of [
    value => { value.fullBackup = { content: 'PRIVATE_FULL_SOURCE_CANARY' } },
    value => { value.cases[0].rawRequest = 'PRIVATE_FULL_SOURCE_CANARY' },
    value => { value.cases[0].id = 'PRIVATE_FULL_SOURCE_CANARY' },
    value => { value.commit = ['1'.repeat(40)] },
    value => { value.fixtureSha256 = ['3'.repeat(64)] },
    value => { value.cases.pop() },
    value => { value.cases[1].id = value.cases[0].id },
    value => { value.cases[0].fixtureDispatchEntries = 0 },
    value => { value.cases[3].fixtureDispatchEntries = null },
    value => { value.cases[3].fixtureDispatchEntries = -1 },
    value => { value.cases[3].buildMode = 'production' },
    value => { value.passed = 12 },
    value => { value.realModelRequests = 1 },
    value => { value.longformAcceptance = 'PASS' },
    value => { value.browserErrors = 'PRIVATE_FULL_SOURCE_CANARY' },
    value => { value.cases[0].failureStage = 'PRIVATE_FULL_SOURCE_CANARY' },
    value => { value.cases[0].failureStage = 'restore_confirm' },
    value => { value.cases[1].failureStage = 'case_start' },
    value => { value.pageErrorDiagnostics = [{ caseId: 'C01', category: 'type', sha256: 'a'.repeat(64), raw: 'PRIVATE_FULL_SOURCE_CANARY' }] },
    value => { value.pageErrorOverflow = 1 },
    value => { value.cases[0].browserErrors = 1 },
    value => { value.schemaVersion = 1 },
  ]) {
    const bad = structuredClone(valid); mutate(bad)
    assert.throws(() => projectCampaignReport(bad), { message: 'Invalid closed Campaign evidence schema' }); checks++
  }
  const bytes = Buffer.from(JSON.stringify(valid)), derived = summarizeReport(bytes, CAMPAIGN_REPORT_PATH)
  assert.equal(derived.transformation.closedSchema, 'campaign-browser-foundation-v2')
  assert.deepEqual(derived.report, valid); checks++
  const errors = structuredClone(valid)
  errors.browserErrors = 2; errors.cases[0].browserErrors = 1; errors.pageErrorOverflow = 0
  errors.pageErrorDiagnostics = [{ caseId: 'C01', category: 'invalid_state', sha256: 'a'.repeat(64) }, { caseId: null, category: 'other', sha256: 'b'.repeat(64) }]
  assert.deepEqual(projectCampaignReport(errors), errors); checks++
  const overflow = structuredClone(valid)
  overflow.browserErrors = 33; overflow.cases[0].browserErrors = 33; overflow.pageErrorOverflow = 1
  overflow.pageErrorDiagnostics = Array.from({ length: 32 }, () => ({ caseId: 'C01', category: 'other', sha256: 'a'.repeat(64) }))
  assert.deepEqual(projectCampaignReport(overflow), overflow); checks++
  const earlyOverflow = structuredClone(valid)
  earlyOverflow.browserErrors = 1; earlyOverflow.cases[0].browserErrors = 1; earlyOverflow.pageErrorOverflow = 1
  assert.throws(() => projectCampaignReport(earlyOverflow)); checks++
  for (const mutate of [
    value => { value.pageErrorDiagnostics[0].category = 'PRIVATE_FULL_SOURCE_CANARY' },
    value => { value.pageErrorDiagnostics[0].caseId = 'C02' },
    value => { value.pageErrorDiagnostics[0].sha256 = ['a'.repeat(64)] },
    value => { value.pageErrorDiagnostics.push(...Array.from({ length: 32 }, () => value.pageErrorDiagnostics[0])) },
    value => { value.pageErrorDiagnostics[1].caseId = 'C01' },
  ]) { const bad = structuredClone(errors); mutate(bad); assert.throws(() => projectCampaignReport(bad)); checks++ }
  root = await mkdtemp(path.join(tmpdir(), 'campaign-evidence-'))
  await mkdir(path.join(root, path.dirname(CAMPAIGN_REPORT_PATH)), { recursive: true })
  await writeFile(path.join(root, CAMPAIGN_REPORT_PATH), bytes)
  await writeFile(path.join(root, path.dirname(CAMPAIGN_REPORT_PATH), 'backup.json'), 'PRIVATE_FULL_SOURCE_CANARY')
  await prepareEvidence({ root, group: 'writer-campaign' })
  const summary = path.join(root, 'artifacts/ci-evidence/writer-campaign/browser-writer-campaign/report.summary.json')
  assert.equal((await readFile(summary, 'utf8')).includes('PRIVATE_FULL_SOURCE_CANARY'), false)
  await writeFile(path.join(root, CAMPAIGN_REPORT_PATH), JSON.stringify({ ...valid, payload: 'PRIVATE_FULL_SOURCE_CANARY' }))
  await assert.rejects(prepareEvidence({ root, group: 'writer-campaign' }), { message: 'Invalid closed Campaign evidence schema' })
  await assert.rejects(readFile(summary), { code: 'ENOENT' }); checks++
  const gitRoot = path.join(root, 'source'); await mkdir(gitRoot)
  for (const file of CAMPAIGN_CORE_PATHS) {
    await mkdir(path.dirname(path.join(gitRoot, file)), { recursive: true })
    await writeFile(path.join(gitRoot, file), `// controlled source ${file}\n`)
  }
  const archive = campaignBuildIdentity(gitRoot)
  assert.deepEqual(archive.source, { commit: null, tree: null })
  assert.match(archive.runtimeIdentity, /^campaign-core-sha256:[a-f0-9]{64}$/); checks++
  const git = args => execFileSync('git', args, { cwd: gitRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['add', '.'])
  git(['-c', 'user.name=Controlled Test', '-c', 'user.email=controlled@example.invalid', 'commit', '-qm', 'controlled source'])
  const clean = campaignBuildIdentity(gitRoot)
  assert.deepEqual(clean.source, { commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']) })
  assert.equal(clean.runtimeIdentity, archive.runtimeIdentity); checks++
  await writeFile(path.join(gitRoot, 'untracked.txt'), 'uncommitted')
  assert.deepEqual(campaignBuildIdentity(gitRoot).source, { commit: null, tree: null }); checks++
  await rm(path.join(gitRoot, 'untracked.txt'))
  await writeFile(path.join(gitRoot, CAMPAIGN_CORE_PATHS[0]), '// modified controlled source')
  const dirty = campaignBuildIdentity(gitRoot)
  assert.deepEqual(dirty.source, { commit: null, tree: null }); assert.notEqual(dirty.runtimeIdentity, clean.runtimeIdentity); checks++
  console.log(`Campaign identity/evidence: ${checks} controlled checks passed; no browser or provider calls.`)
} catch {
  // Assertions may carry private actual/expected payloads. Never emit them in CI.
  process.stderr.write(`Campaign identity/evidence failed after ${checks} controlled checks.\n`)
  process.exitCode = 1
} finally {
  delete globalThis.__WRITER_CAMPAIGN_BUILD_IDENTITY__
  if (root) await rm(root, { recursive: true, force: true })
}
