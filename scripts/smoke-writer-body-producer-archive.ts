/** Archive schema/path controls only. These synthetic records are not execution results. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PRODUCER_SOURCE_PATHS, PRODUCER_HARNESS_PATHS, PRODUCER_FIXTURE_PATHS, PRODUCER_UI_PATHS, producerIdentity } from './fixtures/writer-body-producer-identity.mjs'
import { emptyProducerReport, type ProducerReport, type ProducerSourceIdentity } from './fixtures/writer-body-producer-report'
import { parseProducerReportBytes, prepareBodyProducerEvidence, readProducerEvidenceFile, PRODUCER_INPUT_FILES, PRODUCER_ARCHIVE_FILES, PRODUCER_ARCHIVE_MANIFEST_KEYS } from './prepare-body-producer-evidence'

const root = await mkdtemp(path.join(tmpdir(), 'body-producer-archive-'))
const folder = path.join(root, 'artifacts/writer-body-producer'), archive = path.join(root, 'artifacts/ci-evidence/writer-body-producer')
const H = 'a'.repeat(64)
const fakeSource: ProducerSourceIdentity = { commit: null, tree: null, coreSha256: H, harnessSha256: H, uiSha256: H, fixtureSha256: H, buildSha256: H }
const pretty = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
let checks = 0
async function test(action: () => Promise<void>) { await action(); checks++ }
async function save(name: typeof PRODUCER_INPUT_FILES[number], value: unknown) { await writeFile(path.join(folder, name), pretty(value)) }
async function stale() { await mkdir(archive, { recursive: true }); await writeFile(path.join(archive, 'manifest.json'), '{"sliceStatus":"pass"}\n') }
async function gone() { await assert.rejects(lstat(archive), { code: 'ENOENT' }) }

/** Deliberately synthetic pass-shaped data, confined to this disposable schema test. */
function passShape(source: ProducerSourceIdentity, execution: 'node' | 'browser'): ProducerReport {
  const report = emptyProducerReport(source, execution)
  report.sourceStable = 'verified'; report.teardown = 'pass'
  for (const row of report.profiles.filter(row => row.platform === (execution === 'node' ? 'node' : 'native'))) {
    row.status = 'pass'; row.checks.forEach(check => { check.status = 'pass' })
    row.checkpointHash = H; row.inputDigest = H; row.sourceHash = H; row.packetDigest = H; row.admissionStop = 'budget_exhausted'
    Object.assign(row.metrics, { committedTasks: 123, legacyAttempts: 123, producerRequests: 1, httpAttempts: 1, sharedAttempts: 124, sharedOperations: 500,
      sourceEpoch: 1, writtenBytes: 1_000_000, outstandingBytes: 0, recoveryBytes: 524_288, maxVerifiedReadMs: 1, maxRepositoryActionMs: 1,
      maxLegacyPreviewMs: 1, initialProducerReadMs: 1, adoptionMs: 1, maxInvokeMs: 1, coldReadMs: 1, setupMs: 1, readCalls: 1, readBytes: 1, writeTransactions: 500, accountingMismatches: 0 })
    Object.assign(row.observations.proof, { status: 'collected', v3Mode: 'session_full_raw_fence_then_warm_full_v3_tail_exact_origin', legacyAdmittedScopes: 123, legacyDisposedScopes: 123,
      legacyColdReplays: 123, legacyExactPasses: 400, legacyPeakRetainedBytes: 1_000_000, legacyPeakRetainedEntries: 1000, v3VerifiedReads: 10 })
    Object.assign(row.observations.producerOriginProof, { status: 'collected', admittedScopes: 3, disposedScopes: 3, coldReplays: 3, exactPasses: 8,
      peakRetainedBytes: 1_000_000, peakRetainedEntries: 1000, coldMaxMs: 1, exactMaxMs: 1 })
    Object.assign(row.metrics, { maxVerifiedReadMs: 4300, maxRepositoryActionMs: 4600, initialProducerReadMs: 4200, adoptionMs: 4600, coldReadMs: 4300, maxWarmVerifiedReadMs: 300, maxWarmRepositoryActionMs: 500, maxRawIoWaitMs: 30, maxCasWaitMs: 20, maxLegacyVerifiedReadMs: 2500 })
    row.observations.verification.status = 'collected'
    Object.assign(row.observations.verification.stats, { sessionsStarted: 8, sessionsCompleted: 8, sessionsDisposed: 8, sessionMaxMs: 4200, rawIoCalls: 500, rawIoMaxMs: 40, casCalls: 10, casMaxMs: 20, advances: 1000, maxOperationsPerAdvance: 8, hostYields: 100, synchronousSegmentMaxMs: 100, finalFencePasses: 8, finalFenceMaxMs: 50, finalFenceExpectedRecords: 12_000, finalFenceObservedRecords: 12_000, peakRetainedBytes: 32_000_000, peakRetainedEntries: 1642, peakActivePayloadRecords: 270 })
    Object.assign(row.observations.verification.owners, { metadataOwnersStarted: 7, invocationOwnersStarted: 1, ownersCompleted: 7, ownersRefused: 1, peakActiveOwners: 1, maxMetadataOwnerMs: 5000, maxInvocationOwnerMs: 25_000 })
    row.observations.verification.last = { status: 'completed', progress: { purpose: 'current_v3', stage: 'final_fence', verifiedOperations: 503, verifiedRecords: 1642, capturedBytes: 32_000_000, capturedEntries: 1642, totalOperations: 503 } }
    row.requestObservation = 'last_verified'
    row.requests = [{ requestHash: H, phaseHash: H, status: 'resolved', responseHash: H, resolutionOutcome: 'review_ready', resolutionReason: null, phaseReason: null, outstandingBytes: 0 }]
    Object.assign(row.observations.retention, { status: 'collected', maxReadBatchBytes: 10_000, maxReadBatchKeys: 33, liveRecordCount: 2000,
      liveSerializedBytes: 900_000, activePayloadRecords: 270, activeSerializedPayloadBytes: 100_000 })
    row.observations.heap = { status: 'collected', method: execution === 'node' ? 'node_process_samples' : 'chromium_performance_memory_samples',
      samples: 3, baselineHeapUsedBytes: 100_000, sampledPeakHeapUsedBytes: 250_000, finalHeapUsedBytes: 150_000 }
    if (execution === 'browser') row.restart = 'pass'
  }
  if (execution === 'browser') {
    report.builds.native = H; report.builds.ui = H; report.builds.app = H
    for (const row of report.ui) { row.status = 'pass'; row.checks.forEach(check => { check.status = 'pass' }); row.httpAttempts = 3; row.unknownRequests = 2 }
    for (const row of report.app) { row.status = 'pass'; row.checks.forEach(check => { check.status = 'pass' }); row.httpAttempts = 2; row.unknownRequests = 1; row.verificationProgressEvents = 3; row.cancelledBeforeIo = 1; row.cancelledPendingIoAcknowledgment = 1; row.verificationReloads = 1; row.inputDigest = H; row.sourceHash = H }
  }
  return report
}

try {
  await mkdir(folder, { recursive: true })
  const initial = emptyProducerReport(fakeSource, 'node')
  await test(async () => { await save('node-summary.json', initial); assert.deepEqual((await readProducerEvidenceFile(root, 'node-summary.json')).value, initial) })
  await test(async () => {
    for (const poisoned of [{ ...initial, rawRequest: 'private' }, { ...initial, source: { ...fakeSource, quote: 'private' } },
      { ...initial, profiles: initial.profiles.map((row, index) => index ? row : { ...row, packet: 'private' }) },
      { ...initial, app: initial.app.map((row, index) => index ? row : { ...row, rawBody: 'private' }) }]) {
      await save('node-summary.json', poisoned)
      await assert.rejects(readProducerEvidenceFile(root, 'node-summary.json'), /producer_report_invalid/)
    }
  })
  await test(async () => {
    const canonical = pretty(initial)
    for (const text of [canonical.replace('  "scope":', '  "protocol": "body-producer-readiness-report-v2",\n  "scope":'), JSON.stringify(initial), `\ufeff${canonical}`, `${canonical} `]) {
      await writeFile(path.join(folder, 'node-summary.json'), text)
      await assert.rejects(readProducerEvidenceFile(root, 'node-summary.json'), /producer_report_/)
    }
    assert.throws(() => parseProducerReportBytes(Buffer.from(canonical.replace('"blockedExternalRequests": 0', '"blockedExternalRequests": 0.0'))), /noncanonical/)
  })
  await test(async () => { await writeFile(path.join(folder, 'node-summary.json'), ' '.repeat(1_048_577)); await assert.rejects(readProducerEvidenceFile(root, 'node-summary.json'), /size/) })
  await test(async () => { await assert.rejects(readProducerEvidenceFile(root, '../private.json' as 'node-summary.json'), /unsupported/) })
  await test(async () => {
    await save('node-summary.json', emptyProducerReport(fakeSource, 'browser'))
    await assert.rejects(readProducerEvidenceFile(root, 'node-summary.json'), /execution/)
    const foreign = structuredClone(initial); foreign.profiles[2]!.metrics.httpAttempts = 1
    await save('node-summary.json', foreign)
    await assert.rejects(readProducerEvidenceFile(root, 'node-summary.json'), /producer_report_invalid/)
    const foreignApp = structuredClone(initial); foreignApp.app[0]!.httpAttempts = 1
    await save('node-summary.json', foreignApp)
    await assert.rejects(readProducerEvidenceFile(root, 'node-summary.json'), /producer_report_invalid/)
  })
  await test(async () => {
    const target = path.join(root, 'private-source.json')
    await writeFile(target, pretty(initial)); await rm(path.join(folder, 'node-summary.json')); await symlink(target, path.join(folder, 'node-summary.json'))
    await assert.rejects(readProducerEvidenceFile(root, 'node-summary.json'), /unsafe/)
    assert.equal(await readFile(target, 'utf8'), pretty(initial))
    await rm(path.join(folder, 'node-summary.json'))
  })
  await test(async () => {
    const outside = path.join(root, 'other-reports'); await mkdir(outside); await writeFile(path.join(outside, 'node-summary.json'), pretty(initial))
    await rm(folder, { recursive: true }); await symlink(outside, folder)
    await assert.rejects(readProducerEvidenceFile(root, 'node-summary.json'), /unsafe/)
    await rm(folder); await mkdir(folder)
  })
  await test(async () => {
    await mkdir(path.join(folder, 'node-summary.json'))
    await assert.rejects(readProducerEvidenceFile(root, 'node-summary.json'), /size/)
    await rm(path.join(folder, 'node-summary.json'), { recursive: true })
  })

  // Identity functions read named bytes only. No fixture program is executed.
  for (const name of new Set([...PRODUCER_SOURCE_PATHS, ...PRODUCER_HARNESS_PATHS, ...PRODUCER_FIXTURE_PATHS, ...PRODUCER_UI_PATHS])) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true })
    await writeFile(path.join(root, name), 'disposable archive identity fixture\n')
  }
  const identity = await producerIdentity(root)
  const restore = async () => {
    await save('node-summary.json', emptyProducerReport(identity.source, 'node'))
    await save('browser-summary.json', emptyProducerReport(identity.source, 'browser'))
  }
  await restore()
  await test(async () => {
    await writeFile(path.join(folder, 'private-requests.json'), '{"rawResponse":"DO_NOT_ARCHIVE_THIS_SOURCE"}\n')
    await prepareBodyProducerEvidence(root)
    assert.deepEqual((await readdir(archive)).sort(), [...PRODUCER_ARCHIVE_FILES].sort())
    const manifest = JSON.parse(await readFile(path.join(archive, 'manifest.json'), 'utf8'))
    assert.deepEqual(Object.keys(manifest).sort(), [...PRODUCER_ARCHIVE_MANIFEST_KEYS].sort())
    assert.equal(manifest.sliceStatus, 'not_passed'); assert.equal(manifest.semanticAcceptance, 'NOT_RUN')
    assert.deepEqual(manifest.files.map((row: { path: string }) => row.path), [...PRODUCER_INPUT_FILES])
    assert.deepEqual(manifest.reports.map((row: { execution: string; exitCode: number }) => [row.execution, row.exitCode]), [['node', 1], ['browser', 1]])
    for (const row of manifest.files as Array<{ path: string; bytes: number; sha256: string }>) {
      const bytes = await readFile(path.join(archive, row.path))
      assert.equal(bytes.byteLength, row.bytes); assert.equal(sha(bytes), row.sha256)
      assert.deepEqual(bytes, await readFile(path.join(folder, row.path)))
      assert.ok(!bytes.includes('DO_NOT_ARCHIVE_THIS_SOURCE'))
    }
  })
  await test(async () => {
    const failed = emptyProducerReport(identity.source, 'node'); failed.sourceStable = 'verified'; failed.teardown = 'pass'
    failed.profiles[0]!.status = 'failed'; failed.profiles[0]!.refusalCode = 'profile_failed'
    await save('node-summary.json', failed); await prepareBodyProducerEvidence(root)
    assert.equal(JSON.parse(await readFile(path.join(archive, 'manifest.json'), 'utf8')).sliceStatus, 'not_passed')
    await restore()
  })
  await test(async () => {
    const failed = passShape(identity.source, 'node'), row = failed.profiles[0]!
    row.status = 'failed'; row.refusalCode = 'operation_timeout'; row.requestObservation = 'unconfirmed'; row.metrics.outstandingBytes = 1_343_309
    row.requests[0] = { ...row.requests[0]!, status: 'response_retained', resolutionOutcome: null, phaseReason: 'operation_timeout', outstandingBytes: 1_343_309 }
    await save('node-summary.json', failed); await prepareBodyProducerEvidence(root)
    assert.equal(JSON.parse(await readFile(path.join(archive, 'manifest.json'), 'utf8')).sliceStatus, 'not_passed')
    const archived = JSON.parse(await readFile(path.join(archive, 'node-summary.json'), 'utf8'))
    assert.deepEqual(archived.profiles[0].requests, row.requests, 'Failed reports preserve source-free response identity and unresolved allowance')
    const poisoned = structuredClone(failed) as ProducerReport & { profiles: Array<{ requests: Array<Record<string, unknown>> }> }
    poisoned.profiles[0]!.requests[0]!.rawResponse = 'private response'
    await save('node-summary.json', poisoned); await assert.rejects(prepareBodyProducerEvidence(root), /producer_report_invalid/); await gone(); await restore()
  })
  await test(async () => {
    for (const key of ['commit', 'tree', 'coreSha256', 'harnessSha256', 'uiSha256', 'fixtureSha256', 'buildSha256'] as const) {
      const changed = emptyProducerReport(identity.source, 'node')
      changed.source[key] = key === 'commit' || key === 'tree' ? '1'.repeat(40) : '1'.repeat(64)
      await save('node-summary.json', changed); await stale()
      await assert.rejects(prepareBodyProducerEvidence(root), /identity_mismatch/); await gone()
      await restore()
    }
  })
  await test(async () => {
    await stale(); await rm(path.join(folder, 'browser-summary.json'))
    await assert.rejects(prepareBodyProducerEvidence(root), { code: 'ENOENT' }); await gone(); await restore()
  })
  await test(async () => {
    await stale(); await save('node-summary.json', { ...emptyProducerReport(identity.source, 'node'), rawBody: 'private' })
    await assert.rejects(prepareBodyProducerEvidence(root), /producer_report_invalid/); await gone(); await restore()
  })
  await test(async () => {
    await stale(); await save('node-summary.json', emptyProducerReport(identity.source, 'browser'))
    await assert.rejects(prepareBodyProducerEvidence(root), /execution/); await gone(); await restore()
  })
  await test(async () => {
    const name = PRODUCER_SOURCE_PATHS[0]!, original = await readFile(path.join(root, name))
    await stale(); await writeFile(path.join(root, name), 'different source bytes\n')
    await assert.rejects(prepareBodyProducerEvidence(root), /identity_mismatch/); await gone()
    await writeFile(path.join(root, name), original); await restore()
  })
  await test(async () => {
    const protectedTarget = path.join(root, 'protected-archive-target'); await mkdir(protectedTarget)
    await writeFile(path.join(protectedTarget, 'private.txt'), 'untouched')
    await mkdir(path.dirname(archive), { recursive: true }); await symlink(protectedTarget, archive)
    await prepareBodyProducerEvidence(root)
    assert.equal(await readFile(path.join(protectedTarget, 'private.txt'), 'utf8'), 'untouched')
    assert.equal((await lstat(archive)).isSymbolicLink(), false)
    assert.deepEqual((await readdir(archive)).sort(), [...PRODUCER_ARCHIVE_FILES].sort())
  })
  await test(async () => {
    await save('node-summary.json', passShape(identity.source, 'node'))
    await save('browser-summary.json', passShape(identity.source, 'browser'))
    await prepareBodyProducerEvidence(root)
    let manifest = JSON.parse(await readFile(path.join(archive, 'manifest.json'), 'utf8'))
    assert.equal(manifest.sliceStatus, 'pass'); assert.deepEqual(manifest.reports.map((row: { exitCode: number }) => row.exitCode), [0, 0])
    assert.equal(manifest.reports[0].uiRows, 0); assert.equal(manifest.reports[1].uiRows, 2)
    assert.equal(manifest.reports[1].uiChecks, 26); assert.equal(manifest.reports[1].passedUiChecks, 26)
    assert.deepEqual(manifest.reports.map((row: { appRows: number; passedAppRows: number; appChecks: number; passedAppChecks: number }) => [row.appRows, row.passedAppRows, row.appChecks, row.passedAppChecks]), [[0, 0, 0, 0], [2, 2, 24, 24]])
    assert.deepEqual(manifest.builds, { native: H, ui: H, app: H })
    const noApp = passShape(identity.source, 'browser'); noApp.app = emptyProducerReport(identity.source, 'browser').app
    await save('browser-summary.json', noApp); await prepareBodyProducerEvidence(root)
    manifest = JSON.parse(await readFile(path.join(archive, 'manifest.json'), 'utf8'))
    assert.equal(manifest.sliceStatus, 'not_passed', 'passing panel cannot substitute for the actual App journey')
    assert.equal(manifest.reports[1].passedUiChecks, 26); assert.equal(manifest.reports[1].passedAppChecks, 0)
    await save('browser-summary.json', emptyProducerReport(identity.source, 'browser')); await prepareBodyProducerEvidence(root)
    manifest = JSON.parse(await readFile(path.join(archive, 'manifest.json'), 'utf8'))
    assert.equal(manifest.sliceStatus, 'not_passed', 'one passing runner cannot award the other platform')
    await restore()
  })
  await test(async () => {
    await stale(); await writeFile(path.join(folder, 'node-summary.json'), pretty(emptyProducerReport(identity.source, 'node')).replace('  "scope":', '  "protocol": "body-producer-readiness-report-v2",\n  "scope":'))
    await assert.rejects(prepareBodyProducerEvidence(root), /noncanonical/); await gone(); await restore()
    const parent = path.dirname(archive)
    assert.ok((await readdir(parent)).every(name => !name.startsWith('.body-producer-')), 'failed preparation leaves no temporary selectable archive')
  })
  console.log(JSON.stringify({ suite: 'body-producer-archive', checks, selectableFiles: PRODUCER_ARCHIVE_FILES.length, sourceBearingFiles: 0, profilesExecuted: false, browserExecuted: false }))
} finally { await rm(root, { recursive: true, force: true }) }
