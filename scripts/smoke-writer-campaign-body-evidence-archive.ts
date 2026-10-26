/** Archive path/shape/sentinel controls; no production execution result is invented. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile, readdir, readFile, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { emptyBodyEvidenceReport, parseBodyEvidenceReport } from './fixtures/writer-campaign-body-evidence-report'
import { readBodyEvidenceFile, prepareBodyEvidenceEvidence, BODY_EVIDENCE_INPUT_FILES, BODY_EVIDENCE_ARCHIVE_FILES } from './prepare-body-evidence-evidence'
import { CAMPAIGN_CORE_PATHS } from './campaign-build-identity.mjs'
import { BODY_EVIDENCE_HARNESS_PATHS, BODY_EVIDENCE_FIXTURE_PATHS, BODY_EVIDENCE_UI_PATHS, bodyEvidenceIdentity } from './fixtures/writer-campaign-body-evidence-identity.mjs'
const root = await mkdtemp(path.join(tmpdir(), 'body-evidence-archive-')), H = 'a'.repeat(64), source = { commit: null, tree: null, coreSha256: H, harnessSha256: H, fixtureSha256: H, uiSha256: H, buildSha256: H }
let assertions = 0
try {
  const folder = path.join(root, 'artifacts/writer-campaign-body-evidence'); await mkdir(folder, { recursive: true })
  const filename = path.join(folder, 'node-summary.json'), report = emptyBodyEvidenceReport(source, 'node'), save = (value: unknown) => writeFile(filename, `${JSON.stringify(value, null, 2)}\n`)
  await save(report); assert.deepEqual((await readBodyEvidenceFile(root, 'node-summary.json')).value, report); assertions++
  for (const altered of [{ ...report, packet: 'private' }, { ...report, source: { ...source, body: 'private' } }, { ...report, profiles: report.profiles.map((row, index) => index ? row : { ...row, quote: 'private' }) }]) { await save(altered); await assert.rejects(readBodyEvidenceFile(root, 'node-summary.json'), /invalid_body_evidence_report/); assertions++ }
  await writeFile(filename, ' '.repeat(1024 * 1024 + 1)); await assert.rejects(readBodyEvidenceFile(root, 'node-summary.json'), /size/); assertions++
  await save(report); await assert.rejects(readBodyEvidenceFile(root, '../packet.json' as 'node-summary.json'), /unsupported/); assertions++
  await rm(filename); const target = path.join(root, 'raw.json'); await writeFile(target, JSON.stringify(report)); await symlink(target, filename); await assert.rejects(readBodyEvidenceFile(root, 'node-summary.json'), /unsafe/); assertions++
  await rm(filename)
  for (const file of new Set([...CAMPAIGN_CORE_PATHS, ...BODY_EVIDENCE_HARNESS_PATHS, ...BODY_EVIDENCE_FIXTURE_PATHS, ...BODY_EVIDENCE_UI_PATHS])) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), 'identity fixture') }
  const identity = await bodyEvidenceIdentity(root)
  for (const [i, name] of BODY_EVIDENCE_INPUT_FILES.entries()) await writeFile(path.join(folder, name), `${JSON.stringify(emptyBodyEvidenceReport(identity.source, (['node', 'native', 'ui'] as const)[i]!), null, 2)}\n`)
  await writeFile(path.join(folder, 'private-packets.json'), JSON.stringify({ text: 'must not escape' }))
  await prepareBodyEvidenceEvidence(root)
  const archive = path.join(root, 'artifacts/ci-evidence/writer-campaign-body-evidence')
  assert.deepEqual((await readdir(archive)).sort(), [...BODY_EVIDENCE_ARCHIVE_FILES].sort()); assertions++
  const summary = parseBodyEvidenceReport(await readFile(path.join(archive, 'summary.json'), 'utf8')), manifest = JSON.parse(await readFile(path.join(archive, 'manifest.json'), 'utf8'))
  assert.equal(summary.environment, 'combined'); assert.equal(manifest.sliceStatus, 'not_passed'); assert.deepEqual(manifest.files.map((row: { path: string }) => row.path), ['summary.json']); assert.deepEqual(manifest.inputReports.map((row: { path: string }) => row.path), BODY_EVIDENCE_INPUT_FILES); assertions++
  await save({ ...report, raw: 'private' }); await assert.rejects(prepareBodyEvidenceEvidence(root), /invalid_body_evidence_report/); await assert.rejects(lstat(archive), { code: 'ENOENT' }); assertions++
  console.log(`Body Evidence archive: ${assertions} adversarial controls; only closed derived reports selectable.`)
} finally { await rm(root, { recursive: true, force: true }) }
