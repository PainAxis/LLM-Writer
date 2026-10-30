/** Disposable archive/schema witnesses. No profile, SDK, browser or source upload. */
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { creativeIdentity, CREATIVE_CORE_PATHS, CREATIVE_TRANSPORT_PATHS, CREATIVE_COMPILER_PATHS, CREATIVE_UI_PATHS, CREATIVE_FIXTURE_PATHS, CREATIVE_HARNESS_PATHS, CREATIVE_LAUNCH_PATHS, CREATIVE_ARCHIVE_PATHS } from './lib/creative-pilot-identity.mjs'
import { emptyCreativeReport } from './lib/creative-pilot-report'
import { syntheticCreativePassReport } from './lib/creative-pilot-report-fixtures'
import { CREATIVE_ARCHIVE_FILES, CREATIVE_ARCHIVE_MANIFEST_KEYS, parseCreativeReportBytes, prepareCreativePilotEvidence, readCreativeEvidenceFile } from './prepare-creative-pilot-evidence'
import { controlAssert } from './lib/creative-pilot-oracles'
const root = await mkdtemp(path.join(tmpdir(), 'creative-pilot-archive-'))
const input = path.join(root, 'artifacts/creative-pilot'), output = path.join(root, 'artifacts/ci-evidence/creative-pilot')
const pretty = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
let groups = 0
async function rejected(action: () => unknown | Promise<unknown>) { let refusal = false; try { await action() } catch { refusal = true }; controlAssert(refusal) }
try {
  for (const filename of new Set([...CREATIVE_CORE_PATHS, ...CREATIVE_TRANSPORT_PATHS, ...CREATIVE_COMPILER_PATHS, ...CREATIVE_UI_PATHS, ...CREATIVE_FIXTURE_PATHS, ...CREATIVE_HARNESS_PATHS, ...CREATIVE_LAUNCH_PATHS, ...CREATIVE_ARCHIVE_PATHS])) { const full = path.join(root, filename); await mkdir(path.dirname(full), { recursive: true }); await writeFile(full, 'disposable identity bytes only\n') }
  await mkdir(input, { recursive: true })
  const { source } = await creativeIdentity(root)
  const save = (name: 'node-summary.json' | 'browser-summary.json', value: unknown) => writeFile(path.join(input, name), pretty(value))
  const restore = async () => { await save('node-summary.json', emptyCreativeReport(source, 'node')); await save('browser-summary.json', emptyCreativeReport(source, 'browser')) }
  await restore(); await prepareCreativePilotEvidence(root)
  controlAssert(JSON.stringify((await readdir(output)).sort()) === JSON.stringify([...CREATIVE_ARCHIVE_FILES].sort())); groups++
  let manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'))
  controlAssert(JSON.stringify(Object.keys(manifest).sort()) === JSON.stringify([...CREATIVE_ARCHIVE_MANIFEST_KEYS].sort()) && manifest.sliceStatus === 'not_passed'); groups++
  for (const record of manifest.files) { const bytes = await readFile(path.join(output, record.path)); controlAssert(bytes.byteLength === record.bytes && createHash('sha256').update(bytes).digest('hex') === record.sha256) }; groups++
  await writeFile(path.join(input, 'private-raw-response.json'), '{"body":"NEVER_ARCHIVE"}')
  await prepareCreativePilotEvidence(root); controlAssert(!(await readdir(output)).includes('private-raw-response.json')); groups++
  const invalid = { ...emptyCreativeReport(source, 'node'), rawResponse: 'NEVER_ARCHIVE' }; await save('node-summary.json', invalid)
  await rejected(() => prepareCreativePilotEvidence(root)); await rejected(() => lstat(output)); groups++
  await restore(); const raw = pretty(emptyCreativeReport(source, 'node'))
  for (const value of [JSON.stringify(emptyCreativeReport(source, 'node')), '\ufeff' + raw, raw + ' ', raw.replace('  "scope":', '  "protocol":"creative-pilot-readiness-report-v1",\n  "scope":')]) await rejected(() => parseCreativeReportBytes(Buffer.from(value)))
  groups++
  await writeFile(path.join(input, 'node-summary.json'), ' '.repeat(524289)); await rejected(() => readCreativeEvidenceFile(root, 'node-summary.json')); groups++
  await rejected(() => readCreativeEvidenceFile(root, '../private.json' as 'node-summary.json')); groups++
  await restore(); await save('node-summary.json', emptyCreativeReport(source, 'browser')); await rejected(() => prepareCreativePilotEvidence(root)); groups++
  await restore(); const sourceMismatch = emptyCreativeReport(source, 'node'); sourceMismatch.source.fixtureSha256 = 'e'.repeat(64); await save('node-summary.json', sourceMismatch); await rejected(() => prepareCreativePilotEvidence(root)); groups++
  await restore(); const rawTarget = path.join(root, 'private.json'); await writeFile(rawTarget, raw); await rm(path.join(input, 'node-summary.json')); await symlink(rawTarget, path.join(input, 'node-summary.json')); await rejected(() => readCreativeEvidenceFile(root, 'node-summary.json')); controlAssert(await readFile(rawTarget, 'utf8') === raw); await rm(path.join(input, 'node-summary.json')); groups++
  await restore(); const partial = emptyCreativeReport(source, 'node'); partial.positiveNode[0]!.status = 'failed'; partial.positiveNode[0]!.activeCheck = 'raw_to_compiled'; partial.positiveNode[0]!.errorCode = 'storage_unknown'; partial.positiveNode[0]!.observation = 'unconfirmed'; partial.positiveNode[0]!.obligations = [{ requestHash: 'a'.repeat(64), phaseHash: 'b'.repeat(64), status: 'response_retained', responseHash: 'c'.repeat(64), outcome: null, resolutionReason: null, unknownReason: null, outstandingBytes: 1200000 }]; await save('node-summary.json', partial); await prepareCreativePilotEvidence(root); const archived = JSON.parse(await readFile(path.join(output, 'node-summary.json'), 'utf8')); controlAssert(archived.positiveNode[0].obligations[0].outstandingBytes === 1200000); groups++
  for (const execution of ['node', 'browser'] as const) { const witness = syntheticCreativePassReport(execution); witness.source = { ...source }; await save(execution === 'node' ? 'node-summary.json' : 'browser-summary.json', witness) }
  await prepareCreativePilotEvidence(root); manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')); controlAssert(manifest.sliceStatus === 'pass' && manifest.reports[0].positiveTasks === 54 && manifest.reports[1].positiveTasks === 18 && manifest.reports[0].populations.durability.rows === 63); groups++
  const setupFailure = emptyCreativeReport(source, 'node'), failedSetup = setupFailure.durability[0]!
  Object.assign(failedSetup, { status: 'failed', activeCheck: failedSetup.id, errorCode: 'integrity', setupHttpAttempts: 2, setupSuccessfulCas: 9, observation: 'unconfirmed' })
  await save('node-summary.json', setupFailure); await prepareCreativePilotEvidence(root)
  controlAssert(JSON.parse(await readFile(path.join(output, 'node-summary.json'), 'utf8')).durability[0].setupSuccessfulCas === 9); groups++
  for (const count of [-1, 0.5, { raw: 'NEVER_ARCHIVE' }]) { const invalid = structuredClone(setupFailure); (invalid.durability[0] as any).setupSuccessfulCas = count; await rejected(() => parseCreativeReportBytes(Buffer.from(pretty(invalid)))) }; groups++
  const missingSetup = structuredClone(setupFailure); delete (missingSetup.durability[0] as any).setupSuccessfulCas; await rejected(() => parseCreativeReportBytes(Buffer.from(pretty(missingSetup)))); groups++
  const hiddenSetup = syntheticCreativePassReport('node'); hiddenSetup.durability[0]!.setupSuccessfulCas = 0; await rejected(() => parseCreativeReportBytes(Buffer.from(pretty(hiddenSetup)))); groups++
  const foreign = syntheticCreativePassReport('node'); foreign.source = { ...source }; foreign.positiveApp = syntheticCreativePassReport('browser').positiveApp; await save('node-summary.json', foreign); await rejected(() => prepareCreativePilotEvidence(root)); groups++
  await restore(); await writeFile(path.join(root, CREATIVE_FIXTURE_PATHS[0]!), 'changed identity bytes\n'); await rejected(() => prepareCreativePilotEvidence(root)); groups++
  await rm(input, { recursive: true }); await symlink(path.dirname(output), input); await rejected(() => readCreativeEvidenceFile(root, 'node-summary.json')); groups++
  process.stdout.write(JSON.stringify({ status: 'pass', scope: 'disposable_closed_archive_controls', groups, archivedExecutionEvidence: false }) + '\n')
} catch { process.stdout.write(JSON.stringify({ status: 'failed', scope: 'disposable_closed_archive_controls', groups, archivedExecutionEvidence: false }) + '\n'); process.exitCode = 1 }
finally { await rm(root, { recursive: true, force: true }) }
