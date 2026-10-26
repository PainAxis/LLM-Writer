/* global process, Buffer */
/** Native-IDB measurement is executed only by the separately approved CI job.
 * This file does not retry a browser launch, weaken sandboxing, or emit source-bearing evidence. */
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import { installCampaignStorageMeter } from './fixtures/writer-campaign-storage-meter.mjs'
import { installPlanningAuthorityGuard } from './fixtures/writer-campaign-body-evidence-authority.mjs'
import { bodyEvidenceIdentity, bodyEvidenceIdentityMatches } from './fixtures/writer-campaign-body-evidence-identity.mjs'
import { emptyBodyEvidenceReport, bodyEvidenceReportExitCode, validateBodyEvidenceReport } from './fixtures/writer-campaign-body-evidence-report.ts'

const root = fileURLToPath(new URL('../', import.meta.url)), hash = value => createHash('sha256').update(value).digest('hex')

/** Read-only independent oracle captures native cursor before authority sentinels.
 * Raw rows stay inside the page, and oracle reads are excluded from measured production reads. */
export function installBodyEvidenceNamespaceOracle() {
  const openCursor = IDBObjectStore.prototype.openCursor
  globalThis.__bodyEvidenceNamespace = {
    async digest() {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('llm-writer', 1)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(new Error('body_evidence_oracle_open'))
      })
      try {
        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction('kv', 'readonly'); tx.__campaignOracle = true
          const rows = [], cursor = openCursor.call(tx.objectStore('kv'))
          cursor.onsuccess = () => {
            const entry = cursor.result
            if (!entry) return
            const key = String(entry.key)
            if (key.startsWith('writer-campaign:')) {
              if (typeof entry.value !== 'string') { tx.abort(); return }
              rows.push([key, entry.value])
            }
            entry.continue()
          }
          tx.oncomplete = () => resolve(rows)
          tx.onerror = tx.onabort = () => reject(new Error('body_evidence_oracle_read'))
        })
        rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows)))
        return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
      } finally { db.close() }
    },
  }
}

async function main() {
  const privateRoot = await mkdtemp(path.join(tmpdir(), 'body-evidence-native-')), provenance = await bodyEvidenceIdentity(root)
  const report = emptyBodyEvidenceReport(provenance.source, 'native'), target = path.join(root, 'artifacts/writer-campaign-body-evidence/native-summary.json')
  let context, server, driver, active = null
  const persist = async () => { validateBodyEvidenceReport(report); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, `${JSON.stringify(report, null, 2)}\n`) }
  const failActive = () => { if (active) { active.row.status = 'failed'; active.row.refusalCode = 'profile_failure' } }
  async function launch(profile, origin) {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 950 }, ...(executablePath ? { executablePath } : {}) })
    await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); report.blockedExternalRequests++; failActive(); return route.abort() })
    const watched = new WeakSet(), watch = page => { if (!watched.has(page)) { watched.add(page); page.on('pageerror', () => { report.browserErrors++; failActive() }) } }
    context.on('page', watch); context.pages().forEach(watch)
    await context.exposeBinding('__bodyEvidenceProgress', async (_source, row) => {
      if (!active || active.kind !== 'profile' || row.id !== active.row.id || row.language !== active.row.language) throw new Error('body_evidence_progress_identity')
      report.profiles[active.index] = row; active.row = row; await persist()
    })
    // One init script makes capture/instrumentation order explicit; separate init-script order is not a contract.
    await context.addInitScript({ content: `(${installCampaignStorageMeter.toString()})();(${installBodyEvidenceNamespaceOracle.toString()})();(${installPlanningAuthorityGuard.toString()})();` })
    const page = context.pages()[0] ?? await context.newPage(); await page.goto(origin); return page
  }
  try {
    const out = path.join(privateRoot, 'driver-dist'), entry = path.join(root, 'scripts/fixtures/writer-campaign-body-evidence-browser.ts')
    await build({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'silent', plugins: [{ name: 'body-evidence-native-entry', generateBundle(_options, bundle) {
      for (const value of Object.values(bundle)) if (value.type === 'chunk' && value.facadeModuleId === entry) driver = value.fileName
    } }], build: { outDir: out, emptyOutDir: true, rolldownOptions: { preserveEntrySignatures: 'exports-only', input: { 'body-evidence-native-driver': entry } } } })
    if (!driver) throw new Error('body_evidence_driver_missing')
    const assets = new Map([['/', Buffer.from('<!doctype html><meta charset="utf-8"><title>Body Evidence native engineering harness</title>')]])
    async function collect(dir, prefix = '') {
      for (const row of await readdir(dir, { withFileTypes: true })) {
        if (row.isSymbolicLink() || row.name.startsWith('.')) continue
        const name = `${prefix}/${row.name}`, actual = path.join(dir, row.name)
        if (row.isDirectory()) await collect(actual, name); else assets.set(name, await readFile(actual))
      }
    }
    await collect(out)
    report.buildArtifacts.native = hash(JSON.stringify([...assets].map(([name, bytes]) => [name, hash(bytes)]).sort(([a], [b]) => a.localeCompare(b))))
    server = createServer((request, response) => {
      const key = request.url?.split('?')[0], bytes = assets.get(key)
      if (!bytes || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404).end(); return }
      response.writeHead(200, { 'Content-Type': key.endsWith('.js') ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' }).end(request.method === 'HEAD' ? undefined : bytes)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`, url = `${origin}/${driver}`
    await persist()
    for (const [index, seed] of report.profiles.entries()) {
      if (!seed.id.startsWith('native-')) continue
      active = { kind: 'profile', index, row: seed }
      const errorsBefore = report.browserErrors, externalBefore = report.blockedExternalRequests
      try {
        const profile = await mkdtemp(path.join(privateRoot, `${seed.id}-`)), page = await launch(profile, origin)
        const result = await page.evaluate(async ({ url, language }) => (await import(url)).runNativeBodyEvidenceProfile(language), { url, language: seed.language })
        report.profiles[index] = result; active.row = result; await persist()
        await context.close(); context = null
        if (result.status === 'pass') {
          const reopened = await launch(profile, origin)
          const cold = await reopened.evaluate(async ({ url, expected }) => (await import(url)).inspectBodyEvidenceAfterProcessRestart(expected), { url, expected: result })
          Object.assign(result, cold)
        }
      } catch { failActive(); active.row.coldProcessRestart = 'failed'; process.stderr.write(`Body Evidence ${seed.id}: native_profile_failed\n`) }
      finally {
        if (context) await context.close().catch(() => { failActive(); report.teardown = 'failed' }); context = null
        if (report.browserErrors !== errorsBefore || report.blockedExternalRequests !== externalBefore) failActive()
        await persist(); console.log(`Body Evidence ${seed.id}: ${active.row.status}; semanticReview=NOT_RUN.`); active = null
      }
      if (report.profiles[index].status !== 'pass' || report.profiles[index].coldProcessRestart !== 'verified') break
    }
    // Separate fresh persistent contexts keep replacement writes and rich fixtures
    // entirely outside both N60 namespaces, timing profiles, and accounting meters.
    if (report.profiles.filter(row => row.runtime === 'native').every(row => row.status === 'pass' && row.coldProcessRestart === 'verified')) {
      for (const [index, seed] of report.nativeBoundaries.entries()) {
        active = { kind: 'boundary', index, row: seed }; seed.status = 'running'; await persist()
        const errorsBefore = report.browserErrors, externalBefore = report.blockedExternalRequests
        try {
          const profile = await mkdtemp(path.join(privateRoot, `replacement-${seed.language}-`)), page = await launch(profile, origin)
          const result = await page.evaluate(async ({ url, language }) => (await import(url)).runNativeBodyEvidenceReplacement(language), { url, language: seed.language })
          report.nativeBoundaries[index] = result; active.row = result; await persist()
          await context.close(); context = null
          if (result.status === 'pass') {
            const reopened = await launch(profile, origin)
            const cold = await reopened.evaluate(async ({ url, expected }) => (await import(url)).inspectBodyEvidenceReplacementAfterProcessRestart(expected), { url, expected: result })
            Object.assign(result, cold); result.checks.find(row => row.id === 'cold_process_reopen').status = 'pass'
          }
        } catch {
          failActive(); active.row.coldProcessRestart = 'failed'; active.row.checks.find(row => row.id === 'cold_process_reopen').status = 'fail'
          process.stderr.write(`Body Evidence replacement ${seed.language}: native_boundary_failed\n`)
        } finally {
          if (context) await context.close().catch(() => { failActive(); report.teardown = 'failed' }); context = null
          if (report.browserErrors !== errorsBefore || report.blockedExternalRequests !== externalBefore) failActive()
          await persist(); console.log(`Body Evidence replacement ${seed.language}: ${active.row.status}; semanticReview=NOT_RUN.`); active = null
        }
        if (report.nativeBoundaries[index].status !== 'pass' || report.nativeBoundaries[index].coldProcessRestart !== 'verified') break
      }
    }
  } catch { failActive(); process.stderr.write('Body Evidence native: setup_failed\n'); process.exitCode = 1 }
  finally {
    if (context) await context.close().catch(() => { failActive(); report.teardown = 'failed' })
    if (server) await new Promise(resolve => server.close(resolve)).catch(() => { report.teardown = 'failed' })
    if (report.teardown !== 'failed') report.teardown = 'pass'
    report.sourceStable = await bodyEvidenceIdentityMatches(root, report.source) ? 'verified' : 'changed'
    if (report.sourceStable !== 'verified') {
      for (const row of report.profiles) if (row.id.startsWith('native-') && row.status === 'pass') { row.status = 'failed'; row.refusalCode = 'source_changed' }
      for (const row of report.nativeBoundaries) if (row.status === 'pass') { row.status = 'failed'; row.refusalCode = 'source_changed' }
    }
    await persist()
  }
  if (bodyEvidenceReportExitCode(report)) process.exitCode = 1
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(() => { process.stderr.write('Body Evidence native: report_or_setup_failed\n'); process.exitCode = 1 })
}
