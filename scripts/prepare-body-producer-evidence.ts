/** Closed producer archive. Only identified derived reports cross the publication boundary. */
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { producerIdentity } from './fixtures/writer-body-producer-identity.mjs'
import { producerReportExitCode, validateProducerReport, type ProducerReport, type ProducerSourceIdentity } from './fixtures/writer-body-producer-report'

export const PRODUCER_INPUT_FILES = Object.freeze(['node-summary.json', 'browser-summary.json'] as const)
export const PRODUCER_ARCHIVE_FILES = Object.freeze([...PRODUCER_INPUT_FILES, 'manifest.json'] as const)
export const PRODUCER_ARCHIVE_MANIFEST_KEYS = Object.freeze(['protocol', 'evidenceKind', 'group', 'scope', 'verificationContract', 'source', 'sliceStatus', 'reports', 'files', 'builds', 'excluded', 'semanticAcceptance', 'externalRegressionPolicy'] as const)
const MAX_BYTES = 1_048_576
const SOURCE_KEYS = ['commit', 'tree', 'coreSha256', 'harnessSha256', 'uiSha256', 'fixtureSha256', 'buildSha256'] as const
const INPUT_DIRECTORY = 'artifacts/writer-body-producer'
const DESTINATION = 'artifacts/ci-evidence/writer-body-producer'
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const pretty = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)

async function inspect(root: string, relative: string, finalDirectory = false): Promise<void> {
  let current = root
  const parts = relative.split('/')
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part)
    try {
      const entry = await lstat(current)
      if (entry.isSymbolicLink() || (index < parts.length - 1 || finalDirectory) && !entry.isDirectory()) throw new Error('unsafe_producer_evidence_path')
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

export function parseProducerReportBytes(bytes: Uint8Array): ProducerReport {
  if (bytes.byteLength > MAX_BYTES) throw new Error('producer_evidence_size')
  let value: unknown
  try { value = JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { throw new Error('producer_report_invalid') }
  validateProducerReport(value)
  // Exact byte equality also rejects duplicate keys, alternate formatting,
  // malformed UTF-8, a BOM, trailing data and noncanonical number spellings.
  if (!pretty(value).equals(Buffer.from(bytes))) throw new Error('producer_report_noncanonical')
  return value
}

export async function readProducerEvidenceFile(root: string, name: typeof PRODUCER_INPUT_FILES[number]): Promise<{ bytes: Buffer; value: ProducerReport }> {
  if (!(PRODUCER_INPUT_FILES as readonly string[]).includes(name)) throw new Error('unsupported_producer_evidence_file')
  const relative = `${INPUT_DIRECTORY}/${name}`
  await inspect(root, relative)
  const filename = path.join(root, relative), before = await lstat(filename)
  if (!before.isFile() || before.size > MAX_BYTES) throw new Error('producer_evidence_size')
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > MAX_BYTES || opened.ino !== before.ino || opened.dev !== before.dev) throw new Error('producer_evidence_changed')
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
      || located.size !== opened.size || located.mtimeMs !== opened.mtimeMs || located.ctimeMs !== opened.ctimeMs) throw new Error('producer_evidence_changed')
    const bytes = Buffer.from(buffer.subarray(0, length)), value = parseProducerReportBytes(bytes)
    if (value.execution !== (name === 'node-summary.json' ? 'node' : 'browser')) throw new Error('producer_evidence_execution')
    return { bytes, value }
  } finally { await handle.close() }
}

function sameIdentity(actual: ProducerSourceIdentity, expected: ProducerSourceIdentity): boolean {
  return SOURCE_KEYS.every(key => actual[key] === expected[key])
}

/** Valid failed reports remain archivable as not_passed, never as successful tests. */
export async function prepareBodyProducerEvidence(root: string): Promise<void> {
  root = await realpath(root)
  const destination = path.join(root, DESTINATION)
  let temporary: string | null = null
  // Remove previously selectable output before doing any new validation.
  await removeDestination(root)
  try {
    const identity = await producerIdentity(root)
    const captured: Array<{ name: typeof PRODUCER_INPUT_FILES[number]; bytes: Buffer; value: ProducerReport }> = []
    for (const name of PRODUCER_INPUT_FILES) {
      const report = await readProducerEvidenceFile(root, name)
      if (!sameIdentity(report.value.source, identity.source)) throw new Error('producer_evidence_identity_mismatch')
      captured.push({ name, ...report })
    }
    const reports = captured.map(({ name, value }) => {
      const profiles = value.profiles.filter(row => row.platform === (value.execution === 'node' ? 'node' : 'native'))
      const ui = value.execution === 'browser' ? value.ui : []
      const app = value.execution === 'browser' ? value.app : []
      return { path: name, execution: value.execution, exitCode: producerReportExitCode(value),
        profileRows: profiles.length, passedProfiles: profiles.filter(row => row.status === 'pass').length,
        profileChecks: profiles.reduce((count, row) => count + row.checks.length, 0), passedProfileChecks: profiles.reduce((count, row) => count + row.checks.filter(check => check.status === 'pass').length, 0),
        uiRows: ui.length, passedUiRows: ui.filter(row => row.status === 'pass').length,
        uiChecks: ui.reduce((count, row) => count + row.checks.length, 0), passedUiChecks: ui.reduce((count, row) => count + row.checks.filter(check => check.status === 'pass').length, 0),
        appRows: app.length, passedAppRows: app.filter(row => row.status === 'pass').length,
        appChecks: app.reduce((count, row) => count + row.checks.length, 0), passedAppChecks: app.reduce((count, row) => count + row.checks.filter(check => check.status === 'pass').length, 0) }
    })
    const manifest = {
      protocol: 'body-producer-archive-v2', evidenceKind: 'closed-derived-not-raw', group: 'writer-body-producer', scope: 'offline_adapter_readiness',
      verificationContract: captured[0]!.value.verificationContract, source: identity.source, sliceStatus: reports.every(report => report.exitCode === 0) ? 'pass' : 'not_passed', reports,
      files: captured.map(({ name, bytes }) => ({ path: name, bytes: bytes.byteLength, sha256: hash(bytes) })), builds: captured[1]!.value.builds,
      excluded: ['body_windows', 'raw_requests', 'raw_responses', 'packets', 'stores', 'backups', 'screenshots', 'traces', 'credentials'],
      semanticAcceptance: 'NOT_RUN', externalRegressionPolicy: 'required_separate_exact_ci_not_awarded_by_this_archive',
    }
    const manifestBytes = pretty(manifest)
    if (manifestBytes.byteLength > MAX_BYTES) throw new Error('producer_archive_manifest_size')
    await inspect(root, path.posix.dirname(DESTINATION), true)
    const parent = path.dirname(destination)
    await mkdir(parent, { recursive: true })
    await inspect(root, path.posix.dirname(DESTINATION), true)
    temporary = await mkdtemp(path.join(parent, '.body-producer-'))
    for (const report of captured) await writeFile(path.join(temporary, report.name), report.bytes, { flag: 'wx', mode: 0o600 })
    await writeFile(path.join(temporary, 'manifest.json'), manifestBytes, { flag: 'wx', mode: 0o600 })
    if (!sameIdentity((await producerIdentity(root)).source, identity.source)) throw new Error('producer_evidence_identity_changed')
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
  await prepareBodyProducerEvidence(fileURLToPath(new URL('../', import.meta.url))).catch(() => {
    console.error('producer_evidence_archive_refused')
    process.exitCode = 1
  })
}
