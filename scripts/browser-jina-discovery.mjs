/** Opt-in public Jina discovery in real Chromium; never executes a remote tool. */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const endpoint = 'https://mcp.jina.ai/v1?include_tools=search_web,read_url&max_tokens=3500'
// Deliberately invalid. Discovery is public; this exercises Authorization CORS
// without loading, transmitting, or retaining a production credential.
const syntheticToken = 'synthetic-jina-browser-discovery-not-a-real-api-key'
const report = {
  status: 'running',
  phase: 'vite-start',
  credentialMode: 'synthetic-only',
  toolsCalled: 0,
  blockedRequests: 0,
  authorizationRequests: 0,
  successfulAuthorizedDiscoveryRequests: 0,
  modernDiscoveryAttempts: 0,
  modernDiscoveryTransportFailures: 0,
  modernDiscoveryHttpErrors: 0,
  corsConsoleErrors: 0,
  fatalTransportFailures: 0,
  eventStreamCloseFailures: 0,
  pageErrors: 0,
}
const started = Date.now()
let server
let browser

function rpcMethod(request) {
  if (request.method() !== 'POST') return undefined
  try { return request.postDataJSON()?.method } catch { return undefined }
}

try {
  // A minimal page imports the actual application service through Vite. No
  // mocks, proxy, CORS override, or application bootstrap is involved.
  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { include: ['@ai-sdk/mcp', 'ai'] },
    resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
    server: { host: '127.0.0.1', port: 0, open: false },
    plugins: [{
      name: 'jina-discovery-page',
      configureServer(vite) {
        vite.middlewares.use('/__jina_discovery', (_request, response) => {
          response.setHeader('Content-Type', 'text/html; charset=utf-8')
          response.setHeader('Content-Security-Policy', "connect-src 'self' https://mcp.jina.ai")
          response.end('<!doctype html><html><head><title>Jina discovery validation</title></head><body>Public MCP discovery validation</body></html>')
        })
      },
    }],
  })
  await server.listen()
  const address = server.httpServer.address()
  assert.ok(address && typeof address === 'object', 'Vite must listen on a local TCP port')
  const origin = `http://127.0.0.1:${address.port}`

  report.phase = 'browser-launch'
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const page = await context.newPage()
  // Do not use page/context.route: Playwright fulfills intercepted OPTIONS
  // preflights itself, which would hide the server's actual CORS policy.
  // Request events below only observe native browser network activity.
  page.on('request', request => {
    if (request.url() !== endpoint) return
    if (request.headers().authorization === `Bearer ${syntheticToken}`) report.authorizationRequests++
    if (rpcMethod(request) === 'server/discover') report.modernDiscoveryAttempts++
    if (rpcMethod(request) === 'tools/call') report.toolsCalled++
  })
  page.on('pageerror', () => { report.pageErrors++ })
  page.on('console', message => {
    if (message.type() === 'error' && /CORS/i.test(message.text()) && message.text().includes('mcp.jina.ai')) {
      report.corsConsoleErrors++
    }
  })
  page.on('requestfailed', request => {
    if (request.url() !== endpoint) return
    if (rpcMethod(request) === 'server/discover') report.modernDiscoveryTransportFailures++
    else if (['GET', 'DELETE'].includes(request.method())) report.eventStreamCloseFailures++
    else report.fatalTransportFailures++
  })
  page.on('response', response => {
    const request = response.request()
    if (request.url() !== endpoint) return
    if (rpcMethod(request) === 'server/discover' && response.status() >= 400) report.modernDiscoveryHttpErrors++
    if (rpcMethod(request) === 'tools/list' && response.ok() && request.headers().authorization === `Bearer ${syntheticToken}`) {
      report.successfulAuthorizedDiscoveryRequests++
    }
  })
  report.phase = 'browser-discovery'
  await page.goto(`${origin}/__jina_discovery`)
  const result = await page.evaluate(async ({ url, bearerToken }) => {
    const { connectRemoteMcp, namespacedMcpToolName } = await import('/src/services/mcp.ts')
    const originalFetch = globalThis.fetch
    const allowedMethods = new Set([
      'server/discover', 'initialize', 'notifications/initialized', 'tools/list',
      'resources/list', 'prompts/list',
    ])
    const guard = { blockedRequests: 0, toolCallAttempts: 0 }
    globalThis.fetch = async (input, init) => {
      const target = new URL(input instanceof Request ? input.url : String(input), location.href)
      const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      let allowed = target.href === url && ['POST', 'GET', 'DELETE', 'OPTIONS'].includes(method)
      if (method === 'POST') {
        let body
        try { body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined } catch { /* blocked below */ }
        if (body?.method === 'tools/call') guard.toolCallAttempts++
        allowed = allowed && body && !Array.isArray(body) && allowedMethods.has(body.method)
      }
      if (!allowed) {
        guard.blockedRequests++
        throw new Error('Public discovery guard blocked an unexpected request')
      }
      // No header/body rewriting, synthetic response, or transport proxy:
      // Chromium must execute the real preflight against Jina's own policy.
      return originalFetch(input, init)
    }
    let connection
    try {
      connection = await connectRemoteMcp({
        id: 'jina-browser', name: 'Jina browser validation', url,
        enabled: true, allowedTools: ['search_web', 'read_url'],
      }, { bearerToken, signal: AbortSignal.timeout(45_000) })
      return {
        protocolVersion: connection.discovery.protocolVersion,
        discoveredTools: connection.discovery.tools.map(tool => tool.name).sort(),
        authorizedTools: Object.keys(connection.tools).sort(),
        expectedAuthorizedTools: ['search_web', 'read_url'].map(name => namespacedMcpToolName('jina-browser', name)).sort(),
        truncated: connection.discovery.truncated,
        guard,
      }
    } finally {
      await connection?.close()
      globalThis.fetch = originalFetch
    }
  }, { url: endpoint, bearerToken: syntheticToken })

  report.phase = 'assertions'
  report.blockedRequests = result.guard.blockedRequests
  report.toolCallAttempts = result.guard.toolCallAttempts
  assert.deepEqual(result.discoveredTools, ['read_url', 'search_web'], 'Discover exactly the two requested public tools')
  assert.deepEqual(result.authorizedTools, result.expectedAuthorizedTools, 'Expose exactly the explicitly authorized tools')
  assert.match(result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/, 'Negotiate an explicit MCP protocol version')
  assert.equal(result.truncated, false, 'Filtered discovery must fit the application budget')
  assert.equal(report.toolsCalled, 0, 'Do not attempt any remote tool execution')
  assert.equal(report.toolCallAttempts, 0, 'Do not request any remote tool execution')
  assert.equal(report.blockedRequests, 0, 'Do not attempt unexpected network operations')
  assert.ok(report.authorizationRequests > 0, 'Exercise the Authorization request header')
  assert.ok(report.successfulAuthorizedDiscoveryRequests > 0, 'Read tool discovery successfully with Authorization present')
  assert.equal(report.fatalTransportFailures, 0, 'Legacy discovery must complete without transport failures')
  assert.equal(report.pageErrors, 0, 'The browser page must have no uncaught errors')
  report.protocolVersion = result.protocolVersion
  report.discoveredTools = result.discoveredTools
  report.authorizedToolCount = result.authorizedTools.length
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  // Browser/network exceptions can carry response details. Emit only our own
  // assertion descriptions and the phase, never raw errors, headers or bodies.
  report.failure = error instanceof assert.AssertionError ? error.message : `Failed during ${report.phase}`
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => undefined)
  await server?.close().catch(() => undefined)
  report.durationMs = Date.now() - started
  console.log(JSON.stringify(report, null, 2))
}
