/* global process, Buffer */
/** Separate actual native-IDB profile. Never saves packets, traces or source-bearing errors. */
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import { installCampaignStorageMeter } from './fixtures/writer-campaign-storage-meter.mjs'
import { installPlanningAuthorityGuard } from './fixtures/writer-campaign-planning-authority.mjs'
import { planningEvidenceIdentity, planningEvidenceIdentityMatches } from './fixtures/writer-campaign-planning-identity.mjs'
import { emptyPlanningReport, planningReportExitCode, validatePlanningReport } from './fixtures/writer-campaign-planning-report.ts'
const root = fileURLToPath(new URL('../', import.meta.url)), hash = value => createHash('sha256').update(value).digest('hex')
async function main() {
  const privateRoot = await mkdtemp(path.join(tmpdir(), 'campaign-planning-idb-')), provenance = await planningEvidenceIdentity(root)
  const report = emptyPlanningReport(provenance.source, 'browser-native-idb'), target = path.join(root, 'artifacts/writer-campaign-planning/native-summary.json')
  let context, server, driver, active = null
  const persist = async () => { validatePlanningReport(report); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, `${JSON.stringify(report, null, 2)}\n`) }
  const failActive = () => { if (active) { active.row.status = 'failed'; if ('refusalCode' in active.row) active.row.refusalCode = 'profile_failure' } }
  async function launch(profile, origin) {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 950 }, ...(executablePath ? { executablePath } : {}) })
    await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); report.blockedExternalRequests++; failActive(); return route.abort() })
    const watched = new WeakSet(), watch = page => { if (!watched.has(page)) { watched.add(page); page.on('pageerror', () => { report.browserErrors++; failActive() }) } }
    context.on('page', watch); context.pages().forEach(watch)
    await context.exposeBinding('__planningProgress', async (_source, row) => {
      if (!active || active.kind !== 'profile' || row.language !== active.row.language || row.profile !== active.row.profile) throw new Error('planning_progress_identity')
      active.row = row; report.profiles[active.index] = row; await persist()
    })
    await context.addInitScript(installCampaignStorageMeter)
    await context.addInitScript(installPlanningAuthorityGuard)
    const page = context.pages()[0] ?? await context.newPage(); await page.goto(origin); return page
  }
  try {
    const out = path.join(privateRoot, 'driver-dist'), entry = path.join(root, 'scripts/fixtures/writer-campaign-planning-browser.ts')
    await build({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'silent', plugins: [{ name: 'planning-driver-entry', generateBundle(_options, bundle) {
      for (const value of Object.values(bundle)) if (value.type === 'chunk' && value.facadeModuleId === entry) driver = value.fileName
    } }], build: { outDir: out, emptyOutDir: true, rolldownOptions: { preserveEntrySignatures: 'exports-only', input: { 'campaign-planning-driver': entry } } } })
    if (!driver) throw new Error('planning_driver_missing')
    const assets = new Map([['/', Buffer.from('<!doctype html><meta charset="utf-8"><title>Planning Contract native engineering harness</title>')]])
    async function collect(dir, prefix = '') {
      for (const row of await readdir(dir, { withFileTypes: true })) { if (row.isSymbolicLink() || row.name.startsWith('.')) continue; const name = `${prefix}/${row.name}`, actual = path.join(dir, row.name); if (row.isDirectory()) await collect(actual, name); else assets.set(name, await readFile(actual)) }
    }
    await collect(out); report.source.buildSha256 = hash(JSON.stringify([...assets].map(([name, bytes]) => [name, hash(bytes)]).sort(([a], [b]) => a.localeCompare(b))))
    server = createServer((request, response) => { const key = request.url?.split('?')[0], bytes = assets.get(key); if (!bytes || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404).end(); return }; response.writeHead(200, { 'Content-Type': key.endsWith('.js') ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' }).end(request.method === 'HEAD' ? undefined : bytes) })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`, url = `${origin}/${driver}`
    await persist()
    for (const [index, seed] of report.profiles.entries()) {
      active = { kind: 'profile', index, row: seed }
      const errorsBefore = report.browserErrors, externalBefore = report.blockedExternalRequests
      try {
        const profile = await mkdtemp(path.join(privateRoot, `${seed.profile}-${seed.language}-`)), page = await launch(profile, origin)
        const result = await page.evaluate(async ({ url, profile, language }) => (await import(url)).runNativePlanningProfile(profile, language), { url, profile: seed.profile, language: seed.language })
        report.profiles[index] = result; active.row = result; await persist()
        await context.close(); context = null
        if (result.status === 'pass') {
          const reopened = await launch(profile, origin), cold = await reopened.evaluate(async ({ url, expected }) => (await import(url)).inspectPlanningAfterRestart(expected), { url, expected: result })
          Object.assign(result, cold)
        }
      } catch { failActive(); active.row.coldProcessRestart = 'failed'; process.stderr.write(`Planning native ${seed.profile}/${seed.language}: profile_failed\n`) }
      finally {
        if (context) await context.close().catch(failActive); context = null
        if (report.browserErrors !== errorsBefore || report.blockedExternalRequests !== externalBefore) failActive()
        await persist(); console.log(`Planning native ${seed.profile}/${seed.language}: ${active.row.status}; tasks=${active.row.committedTasks}; semanticConsistency=NOT_RUN.`); active = null
      }
    }
    for (const [index, seed] of report.boundaries.entries()) {
      active = { kind: 'boundary', index, row: seed }; const errorsBefore = report.browserErrors, externalBefore = report.blockedExternalRequests
      try {
        const profile = await mkdtemp(path.join(privateRoot, `${seed.id}-${seed.language}-`)), page = await launch(profile, origin)
        const result = await page.evaluate(async ({ url, id, language }) => (await import(url)).runNativePlanningBoundary(id, language), { url, id: seed.id, language: seed.language })
        report.boundaries[index] = result; active.row = result; await persist(); await context.close(); context = null
        const reopened = await launch(profile, origin), cold = await reopened.evaluate(async ({ url, expected }) => (await import(url)).inspectPlanningAfterRestart(expected), { url, expected: result })
        result.coldProcessRestart = cold.coldProcessRestart
      } catch { failActive(); active.row.coldProcessRestart = 'failed'; process.stderr.write(`Planning native ${seed.id}/${seed.language}: boundary_failed\n`) }
      finally {
        if (context) await context.close().catch(failActive); context = null
        if (report.browserErrors !== errorsBefore || report.blockedExternalRequests !== externalBefore) failActive()
        await persist(); active = null
      }
    }
  } catch { failActive(); process.stderr.write('Planning native: setup_failed\n'); process.exitCode = 1 }
  finally {
    if (context) await context.close().catch(failActive)
    if (server) await new Promise(resolve => server.close(resolve))
    if (!await planningEvidenceIdentityMatches(root, report.source)) {
      for (const row of report.profiles) if (row.status === 'pass' || row.status === 'running') { row.status = 'failed'; row.refusalCode = 'source_changed' }
      for (const row of report.boundaries) if (row.status === 'pass') row.status = 'failed'
      console.error('planning_source_identity_changed')
    }
    await persist() // Native profiles remain local; no screenshot, trace, backup or payload upload.
  }
  if (planningReportExitCode(report)) process.exitCode = 1
}
await main().catch(() => { process.stderr.write('Planning native: unhandled_setup_failure\n'); process.exitCode = 1 })
