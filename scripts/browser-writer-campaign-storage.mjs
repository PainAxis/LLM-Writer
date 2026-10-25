/* global process, Buffer */
/** CI ONLY. Do not launch/install locally. Separate v2 engineering evidence;
 * real native IDB, production modules, synthetic branded fixture, real deadlines.
 * No screenshot/trace/backup/request collection or raw exception is emitted. */
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import { beginStorageObservation, failStorageObservation, finalizeStorageObservation, recordStorageBrowserEvent } from './lib/writer-campaign-storage-reporting.mjs'
import { installCampaignStorageMeter } from './fixtures/writer-campaign-storage-meter.mjs'
import { installCampaignProbe } from './fixtures/writer-campaign-browser-probe.mjs'
import { storageEvidenceIdentity } from './fixtures/writer-campaign-storage-identity.mjs'
import { CAMPAIGN_STORAGE_REPORT_PATH, CAMPAIGN_STORAGE_BOUNDARIES, CAMPAIGN_PROOF_BOUNDARIES, CAMPAIGN_STORAGE_FAILURE_STAGES, emptyCampaignProofBoundary, emptyCampaignStorageProfile, projectCampaignStorageReport, campaignStorageReportExitCode } from './campaign-evidence.mjs'
async function main() {
const root = fileURLToPath(new URL('../', import.meta.url)), hash = value => createHash('sha256').update(value).digest('hex')
const privateRoot = await mkdtemp(path.join(tmpdir(), 'campaign-storage-idb-'))
const provenance = await storageEvidenceIdentity(root)
const report = { schemaVersion: 3, sourceSchemaVersion: 3, reportKind: 'campaign-storage-v2', commit: provenance.commit, sourceTreeSha256: provenance.sourceTreeSha256,
  harnessSha256: provenance.harnessSha256, buildSha256: '0'.repeat(64), environment: 'browser-native-idb', buildMode: 'test_driver_production_modules', readAccounting: 'native_idb_get_transactions_including_cas_and_aborts', baselineReadAccounting: 'historical_node_repository_getMany_only',
  geometry: { version: 'synthetic-storage-geometry-60x16667-v1', plannedTasks: 123, plannedBodyTasks: 60, targetBodyScalars: 1_000_000, storageCeilingBytes: 67_108_864, recoveryReserveBytes: 524_288 },
  baselineV1: { zh: { committedBodyScalars: 200_004, completedTasks: 28, cumulativeWrittenBytes: 6_346_657, permanentStorageReservationBytes: 66_456_411, totalReadBytes: 570_635_858, totalReadCalls: 10_577 }, en: { committedBodyScalars: 350_007, completedTasks: 46, cumulativeWrittenBytes: 6_618_786, permanentStorageReservationBytes: 65_625_495, totalReadBytes: 997_803_343, totalReadCalls: 26_957 } },
  boundaries: CAMPAIGN_STORAGE_BOUNDARIES.map(id => ({ id, status: 'not_run', failureStage: null, fixtureDispatchEntries: 0, committedTransactions: 0, cumulativeWrittenBytes: 0, outstandingBytes: 0, releasedBytes: 0, accountingMismatches: 0 })),
  proofBoundaries: CAMPAIGN_PROOF_BOUNDARIES.map(emptyCampaignProofBoundary),
  profiles: ['zh', 'en'].map(emptyCampaignStorageProfile), browserErrors: 0, blockedExternalRequests: 0, realModelRequests: 0, longformAcceptance: 'NOT_RUN' }
let context, server, driver, activeObservation
const observations = []
const begin = (kind, index) => { const observation = beginStorageObservation(report, kind, index); observations.push(observation); activeObservation = observation; return observation }
async function persist() {
  observations.forEach(observation => finalizeStorageObservation(report, observation))
  const closed = projectCampaignStorageReport(report), target = path.join(root, CAMPAIGN_STORAGE_REPORT_PATH)
  await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, `${JSON.stringify(closed, null, 2)}\n`)
}
async function launch(profile, origin, observation) {
  context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 950 } })
  await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); recordStorageBrowserEvent(report, observation, 'external_request'); return route.abort() })
  const watched = new WeakSet(), watch = page => { if (!watched.has(page)) { watched.add(page); page.on('pageerror', () => recordStorageBrowserEvent(report, observation, 'page_error')) } }
  context.on('page', watch); context.pages().forEach(watch)
  await context.exposeBinding('__campaignStorageProgress', async (_source, row) => {
    const index = ['zh', 'en'].indexOf(row.language)
    if (index < 0) throw new Error('progress_language_invalid')
    report.profiles[index] = row; await persist()
  })
  await context.addInitScript(installCampaignStorageMeter)
  await context.addInitScript(installCampaignProbe)
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(origin)
  return page
}
try {
  const out = path.join(privateRoot, 'driver-dist'), entry = path.join(root, 'scripts/fixtures/writer-campaign-storage-browser.ts')
  await build({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'silent', plugins: [{ name: 'storage-driver-entry', generateBundle(_options, bundle) {
    for (const value of Object.values(bundle)) if (value.type === 'chunk' && value.facadeModuleId === entry) driver = value.fileName
  } }], build: { outDir: out, emptyOutDir: true, rolldownOptions: { preserveEntrySignatures: 'exports-only', input: { 'campaign-storage-driver': entry } } } })
  if (!driver) throw new Error('driver_missing')
  const assets = new Map([['/', Buffer.from('<!doctype html><meta charset="utf-8"><title>Campaign IDB engineering harness</title>')]])
  async function collect(dir, prefix = '') {
    for (const row of await readdir(dir, { withFileTypes: true })) {
      if (row.isSymbolicLink() || row.name.startsWith('.')) continue
      const name = `${prefix}/${row.name}`, actual = path.join(dir, row.name)
      if (row.isDirectory()) await collect(actual, name); else assets.set(name, await readFile(actual))
    }
  }
  await collect(out)
  report.buildSha256 = hash(JSON.stringify([...assets].map(([name, bytes]) => [name, hash(bytes)]).sort(([a], [b]) => a.localeCompare(b))))
  server = createServer((request, response) => {
    const key = request.url?.split('?')[0], bytes = assets.get(key)
    if (!bytes || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404).end(); return }
    response.writeHead(200, { 'Content-Type': key.endsWith('.js') ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' }).end(request.method === 'HEAD' ? undefined : bytes)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`, url = `${origin}/${driver}`
  await persist()
  for (const [index, id] of CAMPAIGN_STORAGE_BOUNDARIES.entries()) {
    // Ownership and error baselines exist before launching or navigating a page.
    const observation = begin('boundary', index)
    let page, lifecycleStage = 'setup'
    try {
      const profile = await mkdtemp(path.join(privateRoot, `${id}-`))
      page = await launch(profile, origin, observation)
      lifecycleStage = 'exercise'
      const { report: result, restartExpected } = await page.evaluate(async ({ url, id }) => (await import(url)).runStorageBoundary(id), { url, id })
      report.boundaries[index] = result
      // A real browser process restart establishes cold durable state without any raw snapshot transfer.
      lifecycleStage = 'restart'
      await context.close(); context = null
      const reopened = await launch(profile, origin, observation)
      await reopened.evaluate(async ({ url, id, expected, restartExpected }) => (await import(url)).inspectAfterBrowserRestart(`storage-${id}`, expected, restartExpected), { url, id, expected: result, restartExpected })
    } catch {
      let failureStage = lifecycleStage
      if (page && context?.pages().includes(page)) failureStage = await page.evaluate(() => globalThis.__campaignStorageStage ?? 'setup').catch(() => lifecycleStage)
      failStorageObservation(report, observation, CAMPAIGN_STORAGE_FAILURE_STAGES.includes(failureStage) ? failureStage : 'setup')
      process.stderr.write(`Campaign storage ${id}: boundary_failed\n`)
    } finally {
      if (context) await context.close().catch(() => failStorageObservation(report, observation, 'teardown'))
      context = null
      finalizeStorageObservation(report, observation)
      await persist(); activeObservation = null
    }
  }
  for (const [index, id] of CAMPAIGN_PROOF_BOUNDARIES.entries()) {
    const observation = begin('proofBoundary', index)
    let page, lifecycleStage = 'setup'
    try {
      const profile = await mkdtemp(path.join(privateRoot, `${id}-`))
      page = await launch(profile, origin, observation)
      lifecycleStage = 'exercise'
      const { report: result, restartExpected } = await page.evaluate(async ({ url, id }) => (await import(url)).runActionProofBoundary(id), { url, id })
      report.proofBoundaries[index] = { ...result, restartOutcome: 'not_run' }
      lifecycleStage = 'restart'
      await context.close(); context = null
      const reopened = await launch(profile, origin, observation)
      const cold = await reopened.evaluate(async ({ url, id, expected, restartExpected }) => (await import(url)).inspectActionProofAfterRestart(id, expected, restartExpected), { url, id, expected: result, restartExpected })
      report.proofBoundaries[index] = { ...result, ...cold }
    } catch {
      let failureStage = lifecycleStage
      if (page && context?.pages().includes(page)) failureStage = await page.evaluate(() => globalThis.__campaignStorageStage ?? 'setup').catch(() => lifecycleStage)
      failStorageObservation(report, observation, CAMPAIGN_STORAGE_FAILURE_STAGES.includes(failureStage) ? failureStage : 'setup')
      process.stderr.write(`Campaign action proof ${id}: boundary_failed\n`)
    } finally {
      if (context) await context.close().catch(() => failStorageObservation(report, observation, 'teardown'))
      context = null
      finalizeStorageObservation(report, observation)
      await persist(); activeObservation = null
    }
  }
  for (const [index, language] of ['zh', 'en'].entries()) {
    const observation = begin('profile', index)
    try {
      const profile = await mkdtemp(path.join(privateRoot, `capacity-${language}-`)), page = await launch(profile, origin, observation)
      const { report: result, restartExpected } = await page.evaluate(async ({ url, language }) => (await import(url)).runStorageCapacity(language), { url, language })
      report.profiles[index] = { ...result, status: result.status === 'pass' ? 'running' : result.status }
      await persist() // A measured refusal/timeout is preserved before any cold-process check.
      await context.close(); context = null
      const reopened = await launch(profile, origin, observation)
      const cold = await reopened.evaluate(async ({ url, language, expected, restartExpected }) => (await import(url)).inspectAfterBrowserRestart(`capacity-${language}`, expected, restartExpected), { url, language, expected: result, restartExpected })
      report.profiles[index] = { ...result, ...cold, coldProcessRestart: 'verified' }
    } catch {
      failStorageObservation(report, observation, 'exercise')
      report.profiles[index] = { ...report.profiles[index], coldProcessRestart: 'failed' }
      process.stderr.write(`Campaign IDB capacity ${language}: profile_failed\n`)
    } finally {
      if (context) await context.close().catch(() => failStorageObservation(report, observation, 'teardown'))
      context = null
      finalizeStorageObservation(report, observation)
      await persist(); activeObservation = null
      const result = report.profiles[index]
      process.stdout.write(`Campaign IDB capacity ${language}: ${result.status}; bodyScalars=${result.committedBodyScalars}; tasks=${result.committedTasks}; longformAcceptance=NOT_RUN.\n`)
    }
  }
} catch { process.stderr.write('Campaign storage browser: setup_failed\n'); process.exitCode = 1 }
finally {
  if (context) await context.close().catch(() => { if (activeObservation) failStorageObservation(report, activeObservation, 'teardown') })
  if (server) await new Promise(resolve => server.close(resolve))
  await persist()
  // No cleanup of generated profiles/backups before all testing and explicit parent review.
}
if (campaignStorageReportExitCode(report)) process.exitCode = 1
}
await main().catch(() => { process.stderr.write('Campaign storage browser: unhandled_setup_failure\n'); process.exitCode = 1 })
