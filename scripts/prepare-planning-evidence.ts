/** Exact allowlist: no glob, screenshot, trace, store, request or response upload. */
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { planningEvidenceIdentity } from './fixtures/writer-campaign-planning-identity.mjs'
import { parsePlanningReport } from './fixtures/writer-campaign-planning-report'
import { planningUiEvidenceIdentity, validatePlanningUiReport } from './browser-writer-campaign-planning-ui.mjs'
const MAX_BYTES = 1024 * 1024
export const PLANNING_ARCHIVE_FILES = Object.freeze(['node-summary.json', 'native-summary.json', 'ui-summary.json'] as const)
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function inspect(root: string, relative: string): Promise<void> {
  let current = root
  const parts = relative.split('/')
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]!)
    try {
      const value = await lstat(current)
      if (value.isSymbolicLink() || (i < parts.length - 1 && !value.isDirectory())) throw new Error('unsafe_planning_evidence_path')
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  }
}
export async function readPlanningEvidenceFile(root: string, name: typeof PLANNING_ARCHIVE_FILES[number]) {
  if (!(PLANNING_ARCHIVE_FILES as readonly string[]).includes(name)) throw new Error('unsupported_planning_evidence_file')
  const relative = `artifacts/writer-campaign-planning/${name}`
  await inspect(root, relative)
  const filename = path.join(root, relative), before = await lstat(filename)
  if (!before.isFile() || before.size > MAX_BYTES) throw new Error('invalid_planning_evidence_size')
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > MAX_BYTES || opened.ino !== before.ino || opened.dev !== before.dev) throw new Error('planning_evidence_changed')
    const bytes = await handle.readFile()
    if (bytes.byteLength > MAX_BYTES) throw new Error('invalid_planning_evidence_size')
    const text = bytes.toString('utf8')
    const value = name === 'ui-summary.json' ? JSON.parse(text) : parsePlanningReport(text)
    if (name === 'ui-summary.json') {
      validatePlanningUiReport(value)
      if (`${JSON.stringify(value, null, 2)}\n` !== text) throw new Error('noncanonical_planning_ui_report')
    }
    if (name !== 'ui-summary.json' && value.environment !== (name === 'node-summary.json' ? 'node-injected-atomic-io-not-browser-idb' : 'browser-native-idb')) throw new Error('planning_evidence_environment')
    return { bytes, value }
  } finally { await handle.close() }
}
export async function preparePlanningEvidence(root: string): Promise<void> {
  root = await realpath(root)
  // A failed validation must never leave an older successful archive selectable.
  await inspect(root, 'artifacts/ci-evidence/writer-campaign-planning')
  const destination = path.join(root, 'artifacts/ci-evidence/writer-campaign-planning')
  await rm(destination, { recursive: true, force: true })
  const identity = await planningEvidenceIdentity(root), uiIdentity = await planningUiEvidenceIdentity(root)
  const rows = []
  for (const name of PLANNING_ARCHIVE_FILES) {
    const result = await readPlanningEvidenceFile(root, name)
    const expected = name === 'ui-summary.json' ? uiIdentity : identity.source
    for (const key of ['commit', 'tree', 'coreSha256', 'harnessSha256'] as const) if (result.value.source[key] !== expected[key]) throw new Error('planning_evidence_identity_mismatch')
    if (name === 'ui-summary.json' && result.value.source.sourceSha256 !== uiIdentity.sourceSha256) throw new Error('planning_ui_source_identity_mismatch')
    rows.push({ name, ...result })
  }
  await inspect(root, 'artifacts/ci-evidence/writer-campaign-planning')
  const parent = path.join(root, 'artifacts/ci-evidence')
  await mkdir(parent, { recursive: true })
  const temporary = await mkdtemp(path.join(parent, '.planning-'))
  try {
    for (const row of rows) await writeFile(path.join(temporary, row.name), row.bytes, { flag: 'wx' })
    const manifest = { schemaVersion: 1, evidenceKind: 'derived-not-raw', group: 'writer-campaign-planning',
      source: { commit: identity.source.commit, tree: identity.source.tree, coreSha256: identity.source.coreSha256, harnessSha256: identity.source.harnessSha256 },
      uiSource: uiIdentity,
      files: rows.map(row => ({ path: row.name, bytes: row.bytes.byteLength, sha256: hash(row.bytes) })),
      excluded: ['packets', 'responses', 'stores', 'backups', 'screenshots', 'traces'], semanticConsistency: 'NOT_RUN', autonomousGeneration: 'NOT_RUN', wholeWorkAudit: 'NOT_RUN', liveModelCalls: 0 }
    await writeFile(path.join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
    await rename(temporary, destination)
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await preparePlanningEvidence(fileURLToPath(new URL('../', import.meta.url))).catch(() => { console.error('planning_evidence_archive_refused'); process.exitCode = 1 })
}
