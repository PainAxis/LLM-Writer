/** Closed creative-pilot archive. Only identified derived reports cross the publication boundary. */
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { creativeIdentity } from './lib/creative-pilot-identity.mjs'
import { creativeReportPassed, creativePopulationCounts, validateCreativeReport, type CreativeReadinessReport, type CreativeSourceIdentity } from './lib/creative-pilot-report'

export const CREATIVE_INPUT_FILES = Object.freeze(['node-summary.json', 'browser-summary.json'] as const)
export const CREATIVE_ARCHIVE_FILES = Object.freeze([...CREATIVE_INPUT_FILES, 'manifest.json'] as const)
export const CREATIVE_ARCHIVE_MANIFEST_KEYS = Object.freeze(['protocol', 'evidenceKind', 'group', 'scope', 'contract', 'source', 'sliceStatus', 'reports', 'files', 'builds', 'excluded', 'semanticAcceptance', 'externalRegressionPolicy'] as const)
const MAX_BYTES = 524_288
const SOURCE_KEYS = ['commit', 'tree', 'coreSha256', 'transportSha256', 'compilerSha256', 'uiSha256', 'fixtureSha256', 'harnessSha256', 'launchSha256', 'archiveSha256'] as const
const INPUT_DIRECTORY = 'artifacts/creative-pilot'
const DESTINATION = 'artifacts/ci-evidence/creative-pilot'
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const pretty = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)

async function inspect(root: string, relative: string, finalDirectory = false): Promise<void> {
  let current = root
  const parts = relative.split('/')
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part)
    try {
      const entry = await lstat(current)
      if (entry.isSymbolicLink() || (index < parts.length - 1 || finalDirectory) && !entry.isDirectory()) throw new Error('unsafe_creative_evidence_path')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
}

/** Never follow an unsafe parent. A destination symlink itself may be removed safely. */
async function removeDestination(root: string): Promise<void> {
  await inspect(root, path.posix.dirname(DESTINATION), true)
  await rm(path.join(root, DESTINATION), { recursive: true, force: true })
}

export function parseCreativeReportBytes(bytes: Uint8Array): CreativeReadinessReport {
  if (bytes.byteLength > MAX_BYTES) throw new Error('creative_evidence_size')
  let value: unknown
  try { value = JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { throw new Error('creative_report_invalid') }
  validateCreativeReport(value)
  // Exact byte equality also rejects duplicate keys, alternate formatting,
  // malformed UTF-8, a BOM, trailing data and noncanonical number spellings.
  if (!pretty(value).equals(Buffer.from(bytes))) throw new Error('creative_report_noncanonical')
  return value
}

export async function readCreativeEvidenceFile(root: string, name: typeof CREATIVE_INPUT_FILES[number]): Promise<{ bytes: Buffer; value: CreativeReadinessReport }> {
  if (!(CREATIVE_INPUT_FILES as readonly string[]).includes(name)) throw new Error('unsupported_creative_evidence_file')
  const relative = `${INPUT_DIRECTORY}/${name}`
  await inspect(root, relative)
  const filename = path.join(root, relative), before = await lstat(filename)
  if (!before.isFile() || before.size > MAX_BYTES) throw new Error('creative_evidence_size')
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > MAX_BYTES || opened.ino !== before.ino || opened.dev !== before.dev) throw new Error('creative_evidence_changed')
    // A growth race cannot cause an unbounded readFile allocation or a read
    // beyond the ceiling. Final descriptor/path stats prove the admitted size.
    const buffer = Buffer.alloc(MAX_BYTES)
    let length = 0
    while (length < MAX_BYTES) {
      const { bytesRead } = await handle.read(buffer, length, Math.min(65_536, buffer.length - length), length)
      length += bytesRead
      if (bytesRead === 0) break
    }
    const after = await handle.stat()
    await inspect(root, relative)
    const located = await lstat(filename)
    if (length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
      || located.isSymbolicLink() || !located.isFile() || located.dev !== opened.dev || located.ino !== opened.ino
      || located.size !== opened.size || located.mtimeMs !== opened.mtimeMs || located.ctimeMs !== opened.ctimeMs) throw new Error('creative_evidence_changed')
    const bytes = Buffer.from(buffer.subarray(0, length)), value = parseCreativeReportBytes(bytes)
    if (value.execution !== (name === 'node-summary.json' ? 'node' : 'browser')) throw new Error('creative_evidence_execution')
    return { bytes, value }
  } finally { await handle.close() }
}

function sameIdentity(actual: CreativeSourceIdentity, expected: CreativeSourceIdentity): boolean {
  return SOURCE_KEYS.every(key => actual[key] === expected[key])
}

/** Valid failed reports remain archivable as not_passed, never as successful tests. */
export async function prepareCreativePilotEvidence(root: string): Promise<void> {
  root = await realpath(root)
  const destination = path.join(root, DESTINATION)
  let temporary: string | null = null
  // Remove previously selectable output before doing any new validation.
  await removeDestination(root)
  try {
    const identity = await creativeIdentity(root)
    const captured: Array<{ name: typeof CREATIVE_INPUT_FILES[number]; bytes: Buffer; value: CreativeReadinessReport }> = []
    for (const name of CREATIVE_INPUT_FILES) {
      const report = await readCreativeEvidenceFile(root, name)
      if (!sameIdentity(report.value.source, identity.source)) throw new Error('creative_evidence_identity_mismatch')
      captured.push({ name, ...report })
    }
    const reports = captured.map(({ name, value }) => ({ path: name, execution: value.execution, exitCode: creativeReportPassed(value) ? 0 : 1,
      populations: creativePopulationCounts(value),
      positiveTasks: value.execution === 'node' ? 54 : 18,
      passedPositiveTasks: (value.execution === 'node' ? value.positiveNode : value.positiveApp).reduce((n, row) => n + row.tasks.filter(t => t.phase === 'resolved' && t.outcome === 'accepted').length, 0),
      positiveChecks: value.execution === 'node' ? 72 : 32,
      passedPositiveChecks: (value.execution === 'node' ? value.positiveNode : value.positiveApp).reduce((n, row) => n + row.checks.filter(c => c.status === 'pass').length, 0),
    }))
    const manifest = {
      protocol: 'creative-pilot-readiness-archive-v1', evidenceKind: 'closed-derived-not-raw', group: 'creative-pilot', scope: 'offline_controlled_sdk_readiness',
      contract: captured[0]!.value.contract, source: identity.source, sliceStatus: reports.every(report => report.exitCode === 0) ? 'pass' : 'not_passed', reports,
      files: captured.map(({ name, bytes }) => ({ path: name, bytes: bytes.byteLength, sha256: hash(bytes) })), builds: captured[1]!.value.builds,
      excluded: ['briefs', 'generated_plans', 'generated_bodies', 'raw_requests', 'raw_responses', 'packets', 'stores', 'backups', 'screenshots', 'traces', 'credentials'],
      semanticAcceptance: 'NOT_RUN', externalRegressionPolicy: 'required_separate_exact_ci_not_awarded_by_this_archive',
    }
    const manifestBytes = pretty(manifest)
    if (manifestBytes.byteLength > 32768) throw new Error('creative_archive_manifest_size')
    await inspect(root, path.posix.dirname(DESTINATION), true)
    const parent = path.dirname(destination)
    await mkdir(parent, { recursive: true })
    await inspect(root, path.posix.dirname(DESTINATION), true)
    temporary = await mkdtemp(path.join(parent, '.creative-pilot-'))
    for (const report of captured) await writeFile(path.join(temporary, report.name), report.bytes, { flag: 'wx', mode: 0o600 })
    await writeFile(path.join(temporary, 'manifest.json'), manifestBytes, { flag: 'wx', mode: 0o600 })
    if (!sameIdentity((await creativeIdentity(root)).source, identity.source)) throw new Error('creative_evidence_identity_changed')
    await inspect(root, DESTINATION, true)
    await rename(temporary, destination)
    temporary = null
  } catch (error) {
    await removeDestination(root)
    throw error
  } finally {
    if (temporary !== null) await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareCreativePilotEvidence(fileURLToPath(new URL('../', import.meta.url))).catch(() => {
    console.error('creative_evidence_archive_refused')
    process.exitCode = 1
  })
}
