/** Exact closed source-free archive. Raw packets, stores, screenshots and traces never enter it. */
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bodyEvidenceIdentity } from './fixtures/writer-campaign-body-evidence-identity.mjs'
import { parseBodyEvidenceReport, mergeBodyEvidenceReports, bodyEvidenceReportExitCode, type BodyEvidenceReport } from './fixtures/writer-campaign-body-evidence-report'
export const BODY_EVIDENCE_INPUT_FILES = Object.freeze(['node-summary.json', 'native-summary.json', 'ui-summary.json'] as const)
export const BODY_EVIDENCE_ARCHIVE_FILES = Object.freeze(['summary.json', 'manifest.json'] as const)
const MAX_BYTES = 1024 * 1024, hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
async function inspect(root: string, relative: string): Promise<void> {
  let current = root; const parts = relative.split('/')
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part)
    try { const entry = await lstat(current); if (entry.isSymbolicLink() || index < parts.length - 1 && !entry.isDirectory()) throw new Error('unsafe_body_evidence_path') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  }
}
export async function readBodyEvidenceFile(root: string, name: typeof BODY_EVIDENCE_INPUT_FILES[number]) {
  if (!(BODY_EVIDENCE_INPUT_FILES as readonly string[]).includes(name)) throw new Error('unsupported_body_evidence_file')
  const relative = `artifacts/writer-campaign-body-evidence/${name}`; await inspect(root, relative)
  const filename = path.join(root, relative), before = await lstat(filename)
  if (!before.isFile() || before.size > MAX_BYTES) throw new Error('invalid_body_evidence_size')
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = await handle.stat(); if (!opened.isFile() || opened.size > MAX_BYTES || opened.ino !== before.ino || opened.dev !== before.dev) throw new Error('body_evidence_changed')
    const bytes = await handle.readFile(), after = await handle.stat(); if (bytes.byteLength > MAX_BYTES || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error('body_evidence_changed')
    const value = parseBodyEvidenceReport(bytes.toString('utf8')), environment = name === 'node-summary.json' ? 'node' : name === 'native-summary.json' ? 'native' : 'ui'
    if (value.environment !== environment) throw new Error('body_evidence_environment')
    return { bytes, value }
  } finally { await handle.close() }
}
export async function prepareBodyEvidenceEvidence(root: string): Promise<void> {
  root = await realpath(root)
  const relative = 'artifacts/ci-evidence/writer-campaign-body-evidence', destination = path.join(root, relative)
  // A failed new validation must not leave old accepted-looking evidence selectable.
  await inspect(root, relative); await rm(destination, { recursive: true, force: true })
  const identity = await bodyEvidenceIdentity(root), reports: BodyEvidenceReport[] = [], inputHashes: Array<{ path: typeof BODY_EVIDENCE_INPUT_FILES[number]; bytes: number; sha256: string }> = []
  for (const name of BODY_EVIDENCE_INPUT_FILES) {
    const { bytes, value } = await readBodyEvidenceFile(root, name)
    for (const key of ['commit', 'tree', 'coreSha256', 'harnessSha256', 'fixtureSha256', 'uiSha256', 'buildSha256'] as const) if (value.source[key] !== identity.source[key]) throw new Error('body_evidence_identity_mismatch')
    reports.push(value); inputHashes.push({ path: name, bytes: bytes.byteLength, sha256: hash(bytes) })
  }
  const report = mergeBodyEvidenceReports(reports), summary = Buffer.from(`${JSON.stringify(report, null, 2)}\n`)
  const manifest = { protocol: 'body-evidence-archive-v1', evidenceKind: 'closed-derived-not-raw', group: 'writer-campaign-body-evidence', source: identity.source, buildArtifacts: report.buildArtifacts,
    scope: 'body_source_proposal_preview_engineering_only', externalRegressionPolicy: 'required_separate_exact_ci_not_awarded_by_this_report', sliceStatus: bodyEvidenceReportExitCode(report) === 0 ? 'pass' : 'not_passed', inputReports: inputHashes,
    files: [{ path: 'summary.json', bytes: summary.byteLength, sha256: hash(summary) }], excluded: ['packets', 'proposals', 'bodies', 'stores', 'backups', 'screenshots', 'traces'], semanticExtraction: 'NOT_RUN', semanticAdjudication: 'NOT_RUN', autonomousGeneration: 'NOT_RUN', wholeWorkAudit: 'NOT_RUN' }
  await inspect(root, relative); const parent = path.dirname(destination); await mkdir(parent, { recursive: true }); const temporary = await mkdtemp(path.join(parent, '.body-evidence-'))
  try { await writeFile(path.join(temporary, 'summary.json'), summary, { flag: 'wx' }); await writeFile(path.join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' }); await rename(temporary, destination) }
  finally { await rm(temporary, { recursive: true, force: true }) }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareBodyEvidenceEvidence(fileURLToPath(new URL('../', import.meta.url))).catch(() => { console.error('body_evidence_archive_refused'); process.exitCode = 1 })
