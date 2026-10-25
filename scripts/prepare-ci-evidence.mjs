/* global process, Buffer */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CI_EVIDENCE_GROUPS, REQUEST_PROJECTIONS } from './ci-evidence-files.mjs'
import {
  CAMPAIGN_REPORT_PATH, projectCampaignReport,
  CAMPAIGN_STORAGE_REPORT_PATH, CAMPAIGN_CAPACITY_NODE_REPORT_PATH, projectCampaignStorageReport,
} from './campaign-evidence.mjs'

export const TEXT_LIMIT = 6000
const MAX_SOURCE_BYTES = 128 * 1024 * 1024
const MAX_SUMMARY_BYTES = 16 * 1024 * 1024
const MAX_PNG_BYTES = 16 * 1024 * 1024
const MAX_GROUP_BYTES = 128 * 1024 * 1024
const MAX_NODES = 500_000
const MAX_DEPTH = 64
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const sha256 = value => createHash('sha256').update(value).digest('hex')
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const has = (value, key) => Object.hasOwn(value, key)
const policy = Object.freeze({
  version: 'ci-evidence-v1',
  classification: 'derived-not-raw',
  sourceSelection: 'Exact audited report JSON and named UI PNG allowlists; no directory or glob discovery.',
  requests: 'Five raw-request report schemas use closed scalar projections and serialized body hashes/bytes/counts. Raw bodies and responses are never copied.',
  text: 'Diagnostic/error/console/DOM strings are replaced by length/hash metadata with no retained prose. Other strings are capped at 6000 UTF-16 code units; every transformation records original lengths and SHA-256.',
  evidence: 'Finite synthetic quote/citation evidence and original test fields/counts remain, subject to text and total-size limits. No backup, trace, text export or exported mindmap image.',
  missing: 'Missing files are reported, never synthesized as passed tests. Preparation success is not test success.',
})

function validateRelative(relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || /[*?\[\]{}\0]/.test(relative)
    || path.posix.isAbsolute(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Unsafe evidence path')
  }
}

// Inspect every component, including output ancestors. Never follow an artifact
// symlink, even when it points to another file inside the checkout.
async function inspect(root, relative) {
  validateRelative(relative)
  let current = root
  const parts = relative.split('/')
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index])
    let info
    try { info = await lstat(current) } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
    if (info.isSymbolicLink()) throw new Error(`Refusing symlink: ${relative}`)
    if (index < parts.length - 1 && !info.isDirectory()) throw new Error(`Non-directory evidence ancestor: ${relative}`)
    if (index === parts.length - 1) return info
  }
}

async function sourceBytes(root, relative) {
  const info = await inspect(root, relative)
  if (!info) return null
  if (!info.isFile()) throw new Error(`Evidence source is not a regular file: ${relative}`)
  const maximum = relative.endsWith('.png') ? MAX_PNG_BYTES : MAX_SOURCE_BYTES
  if (info.size > maximum) throw new Error(`Evidence source exceeds size limit: ${relative}`)
  const handle = await open(path.join(root, relative), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > maximum || opened.ino !== info.ino || opened.dev !== info.dev) {
      throw new Error(`Evidence source changed during preparation: ${relative}`)
    }
    const bytes = await handle.readFile()
    if (bytes.length > maximum) throw new Error(`Evidence source exceeds size limit: ${relative}`)
    return bytes
  } finally { await handle.close() }
}

const REQUEST_STRINGS = ['kind', 'profile', 'scenario', 'caseId', 'mode']
const REQUEST_NUMBERS = ['cutoff', 'novelId', 'startedAt', 'durationMs', 'sourceChars', 'inputChars', 'inputBytes', 'sourceCount', 'candidateCount', 'responseBytes']
const BODY_STRINGS = ['model', 'task']
const BODY_NUMBERS = ['max_tokens', 'max_completion_tokens', 'temperature', 'dimensions', 'top_n']

function retainScalars(input, strings, numbers, output) {
  for (const key of strings) {
    // Long or wrongly typed metadata is dropped, not recursively traversed.
    if (typeof input[key] === 'string' && input[key].length <= 256) output[key] = input[key]
  }
  for (const key of numbers) if (typeof input[key] === 'number' && Number.isFinite(input[key])) output[key] = input[key]
}

function summarizeRequest(entry, mode) {
  if (!object(entry)) throw new Error('Invalid request row; expected an object')
  const body = mode === 'body' ? entry : entry.body
  if (!object(body)) throw new Error('Invalid request row; expected a body object')
  const serialized = JSON.stringify(body)
  const projected = {}
  if (mode === 'wrapped') {
    retainScalars(entry, REQUEST_STRINGS, REQUEST_NUMBERS, projected)
    if ((typeof entry.status === 'string' && entry.status.length <= 64)
      || (typeof entry.status === 'number' && Number.isFinite(entry.status))) projected.status = entry.status
  }
  const bodySummary = { serialization: 'JSON.stringify(parsed body)', bytes: Buffer.byteLength(serialized), sha256: sha256(serialized) }
  retainScalars(body, BODY_STRINGS, BODY_NUMBERS, bodySummary)
  if (typeof body.stream === 'boolean') bodySummary.stream = body.stream
  for (const [field, count] of [['messages', 'messageCount'], ['input', 'inputCount'], ['documents', 'documentCount'], ['tools', 'toolCount']]) {
    if (Array.isArray(body[field])) bodySummary[count] = body[field].length
    else if (field === 'input' && typeof body.input === 'string') bodySummary.inputCount = 1
  }
  projected.bodySummary = bodySummary
  // Writer-memory records raw model text separately from the body.
  if (mode === 'wrapped' && has(entry, 'response')) {
    const response = JSON.stringify(entry.response)
    projected.responseSummary = { serialization: 'JSON.stringify(parsed response)', bytes: Buffer.byteLength(response), sha256: sha256(response) }
  }
  return projected
}

function jsonPointer(parts) { return '/' + parts.map(part => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/') }
function isDiagnostic(parts) {
  return parts.includes('diagnostics') || parts.some(part => ['error', 'errors', 'errorMessage', 'failure', 'startupFailure', 'failureObserved', 'browserErrors', 'pageErrors', 'fixtureErrors', 'consoleMessages'].includes(part))
}

export function summarizeReport(bytes, sourcePath) {
  let report
  try { report = JSON.parse(bytes.toString('utf8')) } catch { throw new Error(`Invalid JSON report: ${sourcePath}`) }
  if (!object(report)) throw new Error(`Invalid report root: ${sourcePath}`)
  if (sourcePath === CAMPAIGN_REPORT_PATH) {
    return {
      schemaVersion: 1, evidenceKind: 'derived-not-raw',
      source: { path: sourcePath, bytes: bytes.length, sha256: sha256(bytes) },
      transformation: { policy, closedSchema: 'campaign-browser-foundation-v2', requestProjections: [], textFields: [] },
      report: projectCampaignReport(report),
    }
  }
  if ([CAMPAIGN_STORAGE_REPORT_PATH, CAMPAIGN_CAPACITY_NODE_REPORT_PATH].includes(sourcePath)) {
    const projected = projectCampaignStorageReport(report)
    const expectedEnvironment = sourcePath === CAMPAIGN_STORAGE_REPORT_PATH ? 'browser-native-idb' : 'node-injected-atomic-io-not-browser-idb'
    if (projected.environment !== expectedEnvironment) throw new Error('Campaign storage report environment does not match its allowlisted path')
    return {
      schemaVersion: 1, evidenceKind: 'derived-not-raw',
      source: { path: sourcePath, bytes: bytes.length, sha256: sha256(bytes) },
      transformation: { policy, closedSchema: 'campaign-storage-v2', requestProjections: [], textFields: [] },
      report: projected,
    }
  }
  const projections = REQUEST_PROJECTIONS[sourcePath] || {}
  const transformed = []
  const requestProjections = []
  let nodes = 0
  function walk(value, parts = []) {
    if (++nodes > MAX_NODES || parts.length > MAX_DEPTH) throw new Error(`Report exceeds structural limit: ${sourcePath}`)
    if (typeof value === 'string') {
      // Preserve the producer's bounded machine error category, never its prose.
      const errorCode = parts.at(-1) === 'code' && parts.some(part => ['failure', 'startupFailure'].includes(part))
        && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)
      const withheld = isDiagnostic(parts) && !errorCode
      const metadata = { originalChars: value.length, originalBytes: Buffer.byteLength(value), sha256: sha256(value) }
      const retained = withheld ? '' : value.slice(0, TEXT_LIMIT)
      if (value.length > TEXT_LIMIT || withheld) transformed.push({
        path: jsonPointer(parts), ...metadata, retainedChars: retained.length,
        action: withheld ? 'withheld-diagnostic-text' : 'bounded-text-prefix',
      })
      return withheld ? { kind: 'withheld-diagnostic-text', ...metadata } : retained
    }
    if (Array.isArray(value)) return value.map((item, index) => walk(item, [...parts, index]))
    if (object(value)) {
      // fromEntries preserves JSON keys such as __proto__ as inert own properties.
      return Object.fromEntries(Object.entries(value).map(([key, item]) => {
        if (key.length > 256) throw new Error(`Oversized report field name: ${sourcePath}`)
        if (parts.length === 0 && has(projections, key)) {
          if (!Array.isArray(item)) throw new Error(`Invalid request collection: ${sourcePath}`)
          if (item.length > MAX_NODES - nodes) throw new Error(`Report exceeds structural limit: ${sourcePath}`)
          nodes += item.length
          const rows = item.map(entry => summarizeRequest(entry, projections[key]))
          requestProjections.push({ path: jsonPointer([key]), originalCount: item.length, retainedCount: rows.length, mode: projections[key] })
          return [key, rows]
        }
        return [key, walk(item, [...parts, key])]
      }))
    }
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Non-finite report value: ${sourcePath}`)
    return value
  }
  return {
    schemaVersion: 1, evidenceKind: 'derived-not-raw',
    source: { path: sourcePath, bytes: bytes.length, sha256: sha256(bytes) },
    transformation: { policy, requestProjections, textFields: transformed },
    report: walk(report),
  }
}

export function destinationFor(sourcePath) {
  validateRelative(sourcePath)
  if (!sourcePath.startsWith('artifacts/') || !/\.(json|png)$/.test(sourcePath)) throw new Error('Unaudited evidence file type')
  return sourcePath.slice('artifacts/'.length).replace(/\.json$/, '.summary.json')
}

export async function prepareEvidence({ root = process.cwd(), group }) {
  if (!has(CI_EVIDENCE_GROUPS, group)) throw new Error('Unknown CI evidence group')
  root = path.resolve(root)
  if ((await realpath(root)) !== root || !(await lstat(root)).isDirectory()) throw new Error('Evidence root must be a real directory without symlinks')
  const parentRelative = 'artifacts/ci-evidence'
  const groupRelative = `${parentRelative}/${group}`
  await inspect(root, groupRelative)
  await mkdir(path.join(root, parentRelative), { recursive: true })
  // Clear yesterday's successful result before inspecting today's inputs. Build
  // privately and publish atomically only when every present file is valid.
  await rm(path.join(root, groupRelative), { recursive: true, force: true })
  const staging = await mkdtemp(path.join(root, parentRelative, `.${group}-`))
  const manifest = { schemaVersion: 1, evidenceKind: 'derived-not-raw', group, policy,
    preparation: 'complete', reportAvailability: 'all-present', files: [], missing: [] }
  let totalBytes = 0
  try {
    for (const sourcePath of CI_EVIDENCE_GROUPS[group]) {
      const bytes = await sourceBytes(root, sourcePath)
      if (bytes === null) {
        const kind = sourcePath.endsWith('.json') ? 'report' : 'optional-ui-screenshot'
        manifest.missing.push({ path: sourcePath, kind, reason: 'Not produced or unavailable; the test may have failed, been cancelled or not run. No outcome is inferred.' })
        if (kind === 'report') manifest.reportAvailability = 'missing-reports'
        continue
      }
      const destination = destinationFor(sourcePath)
      let output
      if (sourcePath.endsWith('.json')) {
        output = Buffer.from(JSON.stringify(summarizeReport(bytes, sourcePath), null, 2) + '\n')
        if (output.length > MAX_SUMMARY_BYTES) throw new Error(`Derived report exceeds size limit: ${sourcePath}`)
      } else {
        if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`Invalid UI PNG: ${sourcePath}`)
        output = bytes
      }
      totalBytes += output.length
      if (totalBytes > MAX_GROUP_BYTES) throw new Error('Derived evidence exceeds group size limit')
      await mkdir(path.dirname(path.join(staging, destination)), { recursive: true })
      await writeFile(path.join(staging, destination), output, { flag: 'wx' })
      manifest.files.push({
        source: { path: sourcePath, bytes: bytes.length, sha256: sha256(bytes) },
        destination: { path: `${groupRelative}/${destination}`, bytes: output.length, sha256: sha256(output) },
        transformation: sourcePath.endsWith('.json') ? 'derived-report-summary' : 'audited-ui-png-byte-copy',
      })
    }
    await writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
    await rename(staging, path.join(root, groupRelative))
    return manifest
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {}
    for (const arg of process.argv.slice(2)) {
      const match = /^--(group|root)=(.+)$/.exec(arg)
      if (!match || has(options, match[1])) throw new Error('Usage: node scripts/prepare-ci-evidence.mjs --group=<group> [--root=<checkout>]')
      options[match[1]] = match[2]
    }
    const result = await prepareEvidence(options)
    console.log(`Prepared ${result.files.length} derived evidence files in artifacts/ci-evidence/${result.group}; ${result.missing.length} missing allowlisted files (${result.reportAvailability}). This is not a test result.`)
  } catch (error) {
    console.error(`CI evidence preparation failed: ${error.message}`)
    process.exitCode = 1
  }
}
