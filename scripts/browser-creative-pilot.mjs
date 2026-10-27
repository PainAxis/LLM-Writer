/** CI-only actual shipped App/native-IDB acceptance. No local browser permission. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import { creativeAppBuildOptions, assertCreativeIndexAssets } from './lib/creative-pilot-build.mjs'
import { creativeIdentity, creativeIdentityMatches } from './lib/creative-pilot-identity.mjs'
import { createCreativeControlServer } from './lib/creative-pilot-node-server.ts'
import { creativePilotBriefs } from './lib/creative-pilot-briefs.ts'
import { emptyCreativeReport, validateCreativeReport, creativeReportPassed, safeCreativeCode } from './lib/creative-pilot-report.ts'
import { runCreativeAppJourney, runCreativeAppInterruptions } from './lib/creative-pilot-browser.ts'
const root = fileURLToPath(new URL('../', import.meta.url)), hash = value => createHash('sha256').update(value).digest('hex')
const verify = value => { if (!value) throw Object.assign(new Error('integrity'), { code: 'integrity' }) }
async function main() {
  if (process.env.CI !== 'true' || process.env.CREATIVE_PILOT_CI_APPROVED !== '1') throw new Error('creative_browser_ci_only')
  const provenance = await creativeIdentity(root), report = emptyCreativeReport(provenance.source, 'browser')
  const target = path.join(root, 'artifacts/creative-pilot/browser-summary.json'), privateRoot = await mkdtemp(path.join(tmpdir(), 'creative-app-'))
  const assets = new Map(), contexts = new Set(), launchedProfiles = new Set()
  let server, active = null, controlEntry = null
  const persist = async () => { validateCreativeReport(report); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, JSON.stringify(report, null, 2) + '\n') }
  const captureFailure = async ({ caseId, campaignId, rows, observation }) => {
    verify(observation === 'unconfirmed' && (rows === null || Array.isArray(rows)))
    const directory = path.join(root, 'artifacts/creative-pilot-private'); await mkdir(directory, { recursive: true, mode: 0o700 })
    const payload = JSON.stringify({ source: provenance.source, caseId, campaignId, observation, rows, mapHash: rows === null ? null : hash(JSON.stringify([...rows].sort(([a], [b]) => a.localeCompare(b)))) })
    verify(Buffer.byteLength(payload) <= 70 * 1024 * 1024)
    await writeFile(path.join(directory, `${caseId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${crypto.randomUUID()}.json`), payload, { mode: 0o600, flag: 'wx' })
  }
  const collect = async (dir, prefix = '') => { for (const entry of await readdir(dir, { withFileTypes: true })) { verify(!entry.isSymbolicLink()); const file = path.join(dir, entry.name), key = `${prefix}/${entry.name}`; if (entry.isDirectory()) await collect(file, key); else { const bytes = await readFile(file); verify(bytes.length < 20 * 1024 * 1024); assets.set(key, bytes) } } }
  const digestAssets = prefix => hash(JSON.stringify([...assets].filter(([key]) => key.startsWith(prefix)).map(([key, bytes]) => [key, hash(bytes)]).sort(([a], [b]) => a.localeCompare(b))))
  try {
    await persist()
    // `npm run build` supplies the ordinary production build, never this helper.
    await collect(path.join(root, 'dist'))
    const normalIndex = assets.get('/index.html'); verify(normalIndex)
    for (const [name, bytes] of assets) if (name.endsWith('.js')) verify(!bytes.includes(Buffer.from('synthetic-loopback-control-only')) && !bytes.includes(Buffer.from('installCreativePilotApp')))
    report.builds.normalApp = digestAssets('/')
    for (const [name, bytes] of [...assets]) assets.set('/normal' + name, bytes)
    assets.set('/normal/', normalIndex); assertCreativeIndexAssets(assets, '/normal/')
    server = await createCreativeControlServer({ maxAttempts: 256, guardNodeFetch: false, serve: async (req, res) => {
      const key = new URL(req.url, 'http://127.0.0.1').pathname, bytes = assets.get(key)
      if (!bytes) { res.writeHead(404).end(); return }
      res.writeHead(200, { 'content-type': key.endsWith('.js') ? 'application/javascript' : key.endsWith('.css') ? 'text/css' : key.endsWith('.svg') ? 'image/svg+xml' : 'text/html', 'cache-control': 'no-store' }).end(bytes)
    } })
    const out = path.join(privateRoot, 'controlled')
    await build(creativeAppBuildOptions(root, out, server.endpoint, filename => { controlEntry = filename }))
    verify(controlEntry)
    await collect(out, '/controlled'); assets.set('/controlled/', assets.get('/controlled/index.html'))
    assertCreativeIndexAssets(assets, '/controlled/')
    report.builds.controlledApp = digestAssets('/controlled/'); report.builds.nativeDriver = hash(assets.get(`/controlled/${controlEntry}`))
    const controlModuleUrl = `${server.origin}/controlled/${controlEntry}`
    async function launch(profile, ordinary = false) {
      const firstLaunch = !launchedProfiles.has(profile); launchedProfiles.add(profile)
      const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      const context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 1000 }, ...(executablePath ? { executablePath } : {}) }); contexts.add(context)
      await context.route('**/*', route => { if (new URL(route.request().url()).origin === server.origin) return route.continue(); report.blockedExternalRequests++; return route.abort() })
      const watch = page => page.on('pageerror', () => { report.browserErrors++; const current = report.appInterruptions.find(row => row.status === 'running') ?? active; if (current) { current.status = 'failed'; current.errorCode = 'integrity' } })
      context.on('page', watch); context.pages().forEach(watch)
      const page = context.pages()[0] ?? await context.newPage(); await page.goto(`${server.origin}/${ordinary ? 'normal' : 'controlled'}/#/`)
      await page.getByTestId('campaign-navigation').waitFor()
      const welcome = page.getByRole('button', { name: '我知道了', exact: true })
      if (firstLaunch) { await welcome.waitFor(); await welcome.click() } else if (await welcome.isVisible()) await welcome.click()
      await page.getByTestId('campaign-navigation').click(); await page.getByTestId('campaign-lab').waitFor()
      return { context, page }
    }
    const normal = await launch(path.join(privateRoot, 'normal-profile'), true)
    for (const [index, language] of ['zh', 'en'].entries()) {
      const profile = path.join(privateRoot, `app-${language}`); let current = await launch(profile)
      const reopen = async () => { await current.context.close(); contexts.delete(current.context); current = await launch(profile); return current.page }
      const common = { controlModuleUrl, captureFailure, readHttp: async () => server.observe(), setMode: async mode => server.setMode(mode), releaseHttp: async () => server.release(), reopen, persist, normalPage: normal.page, brief: creativePilotBriefs()[index === 0 ? 0 : 3].brief }
      active = report.positiveApp[index]
      const completed = await runCreativeAppJourney({ ...common, page: current.page, row: active }); current.page = completed.page
      await persist(); verify(active.status === 'pass')
      const rows = report.appInterruptions.filter(row => row.id.startsWith(language + ':'))
      await runCreativeAppInterruptions({ ...common, page: current.page, rows })
      await persist(); verify(rows.every(row => row.status === 'pass'))
      await current.context.close(); contexts.delete(current.context)
    }
    active = null
    for (const context of contexts) await context.close(); contexts.clear()
    const observed = server.observe(); report.blockedExternalRequests += observed.blockedExternalRequests; verify(observed.errors === 0)
    report.teardown = 'pass'; report.sourceStable = await creativeIdentityMatches(root, provenance.source) ? 'verified' : 'changed'
    verify(report.sourceStable === 'verified' && report.blockedExternalRequests === 0 && report.browserErrors === 0)
  } catch (error) { if (active && active.status !== 'pass') { active.status = 'failed'; active.errorCode = safeCreativeCode(error) }; report.teardown = 'fail' }
  finally { for (const context of contexts) await context.close().catch(() => {}); server?.release(); await server?.close(); if (report.sourceStable === 'not_checked') report.sourceStable = await creativeIdentityMatches(root, provenance.source) ? 'verified' : 'changed'; await persist() }
  if (!creativeReportPassed(report)) process.exitCode = 1
}
await main()
