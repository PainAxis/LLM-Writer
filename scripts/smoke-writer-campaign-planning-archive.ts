import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile, readdir, readFile, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { emptyPlanningReport } from './fixtures/writer-campaign-planning-report'
import { readPlanningEvidenceFile, preparePlanningEvidence, PLANNING_ARCHIVE_FILES } from './prepare-planning-evidence'
import { CAMPAIGN_CORE_PATHS } from './campaign-build-identity.mjs'
import { PLANNING_UI_SOURCE_PATHS, planningUiEvidenceIdentity } from './browser-writer-campaign-planning-ui.mjs'
import { PLANNING_HARNESS_PATHS, planningEvidenceIdentity } from './fixtures/writer-campaign-planning-identity.mjs'
const root = await mkdtemp(path.join(tmpdir(), 'planning-archive-'))
const source = { commit: null, tree: null, coreSha256: 'a'.repeat(64), harnessSha256: 'b'.repeat(64), buildSha256: 'c'.repeat(64) }
try {
  const folder = path.join(root, 'artifacts/writer-campaign-planning'); await mkdir(folder, { recursive: true })
  const filename = path.join(folder, 'node-summary.json'), report = emptyPlanningReport(source, 'node-injected-atomic-io-not-browser-idb')
  const save = (value: unknown) => writeFile(filename, `${JSON.stringify(value, null, 2)}\n`)
  await save(report); assert.deepEqual((await readPlanningEvidenceFile(root, 'node-summary.json')).value, report)
  for (const altered of [{ ...report, packets: [] }, { ...report, source: { ...source, text: 'fixture' } }, { ...report, profiles: report.profiles.map((row, index) => index ? row : { ...row, rawResponse: 'fixture' }) }]) {
    await save(altered); await assert.rejects(readPlanningEvidenceFile(root, 'node-summary.json'), /invalid_planning_report/)
  }
  await writeFile(filename, ' '.repeat(1024 * 1024 + 1)); await assert.rejects(readPlanningEvidenceFile(root, 'node-summary.json'), /size/)
  await save(report); await assert.rejects(readPlanningEvidenceFile(root, '../packet.json' as 'node-summary.json'), /unsupported/)
  await rm(filename); const target = path.join(root, 'raw.json'); await writeFile(target, JSON.stringify(report)); await symlink(target, filename)
  await assert.rejects(readPlanningEvidenceFile(root, 'node-summary.json'), /unsafe/)
  assert.deepEqual(PLANNING_ARCHIVE_FILES, ['node-summary.json', 'native-summary.json', 'ui-summary.json'])
  await rm(filename)
  for (const file of new Set([...CAMPAIGN_CORE_PATHS, ...PLANNING_HARNESS_PATHS, ...PLANNING_UI_SOURCE_PATHS, 'scripts/browser-writer-campaign-planning-ui.mjs'])) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), 'identity fixture')
  }
  const identity = await planningEvidenceIdentity(root)
  await save(emptyPlanningReport(identity.source, 'node-injected-atomic-io-not-browser-idb'))
  await writeFile(path.join(folder, 'native-summary.json'), `${JSON.stringify(emptyPlanningReport(identity.source, 'browser-native-idb'), null, 2)}\n`)
  const uiIdentity = await planningUiEvidenceIdentity(root)
  const checks = ['create_refusal', 'plans_freeze', 'later_preview_readonly', 'chapter_reselection', 'newer_chapter_race', 'refresh_race', 'reload', 'process_reopen', 'campaign_selection_race', 'navigation_race', 'cancel_race', 'cross_tab_change']
  const uiReport = { schemaVersion: 1, reportKind: 'campaign-planning-ui-v1', source: { ...uiIdentity, buildSha256: 'd'.repeat(64) },
    buildMode: 'production_ui_native_idb', raceInjection: 'native_read_completion_only', privacyScope: 'campaign_actions_before_dashboard_navigation', denominator: 24,
    cases: ['zh', 'en'].map(language => ({ language, setup: 'not_run', failureStage: null, checks: checks.map(id => ({ id, status: 'not_run' })), planningArtifacts: 0, bodyArtifacts: 0, bodyScalars: 0,
      requestOrigins: 0, dispatchIntents: 0, attempts: 0, readOnlyChecks: 0, reloads: 0, processReopens: 0, heldReadRaces: 0, configurationReads: 0 })),
    browserErrors: 0, blockedExternalRequests: 0, liveModelCalls: 0, actualFixtureInvocations: null, teardown: 'not_run', sourceStable: 'not_checked', semanticConsistency: 'NOT_RUN', autonomousGeneration: 'NOT_RUN', wholeWorkAudit: 'NOT_RUN' }
  await writeFile(path.join(folder, 'ui-summary.json'), `${JSON.stringify(uiReport, null, 2)}\n`)
  await writeFile(path.join(folder, 'private-packets.json'), JSON.stringify({ text: 'must not escape' }))
  await preparePlanningEvidence(root)
  const archive = path.join(root, 'artifacts/ci-evidence/writer-campaign-planning')
  assert.deepEqual((await readdir(archive)).sort(), ['manifest.json', 'native-summary.json', 'node-summary.json', 'ui-summary.json'])
  const manifest = JSON.parse(await readFile(path.join(archive, 'manifest.json'), 'utf8'))
  assert.deepEqual(manifest.files.map((row: { path: string }) => row.path), [...PLANNING_ARCHIVE_FILES])
  await save({ ...report, raw: 'unapproved' })
  await assert.rejects(preparePlanningEvidence(root), /invalid_planning_report/)
  await assert.rejects(lstat(archive), { code: 'ENOENT' })
  console.log(JSON.stringify({ suite: 'writer-campaign-planning-archive', passed: 12, sourcePayloadUploads: 0 }))
} finally { await rm(root, { recursive: true, force: true }) }
