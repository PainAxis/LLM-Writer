/**
 * Bounded synthetic code/document integration, NOT a novel/model quality benchmark.
 * Default: mock all seven responses at the HTTP boundary, using production preparation,
 * API, SDK adapter, JSON parser and current-source citation validation. No network/key.
 *   node --import tsx scripts/eval-memory-support-code.mjs
 *   node --import tsx scripts/eval-memory-support-code.mjs --mock-failure=transport
 * Live is NOT authorized by this file. Obtain separate exact transmission approval.
 *   node --import tsx scripts/eval-memory-support-code.mjs --live
 * Live stdin: one printable ASCII key line followed by EOF, through a non-TTY pipe;
 * no CLI/environment/file credential input, echo, saved config, or raw diagnostics.
 * --continue-after-go01 additionally needs approval for the remaining six calls.
 * The approved model is reasoning-only: default thinking, unchanged total output caps.
 * No retry, fallback, proxy, redirect, model-list probe, or browser-compatibility claim.
 */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, relative } from 'node:path'
import net from 'node:net'
import tls from 'node:tls'
import http from 'node:http'
import https from 'node:https'
import dgram from 'node:dgram'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const FIXTURE = resolve(ROOT, 'scripts/fixtures/support-check-go-code-fixture-v1.json')
const FIXTURE_SHA = '6012bdccee930f3e8a260c430043d8b13fd08e44ae8cf1fc939b478878de9f1e'
const SYSTEM_SHA = '184c45fe87111a52e139ee3b53ceb2ff8a28f2ca33a5dfcc73bda1b3bc50fa3a'
const FROZEN = [
  ['GO01', 2454, 2490, '68a3549414ef20e9938ff551d8f9119120c7a612e2ee56a5fd526c69b32f51ef'],
  ['GO02', 2407, 2427, '189c8de0c649ff223e3b2d190e633120e2191adb236fb45e4d15002b5a4d02c2'],
  ['GO03', 2477, 2517, '6c0887dd557499a3b007e0e98f3129136c3db5c0de9111a9a339c50d633f9b95'],
  ['GO04', 2474, 2510, 'b6cbc6d752f6babaccc11f50e51451941f6530705dbf9ce99f646c0cb5814868'],
  ['GO05', 2597, 2627, 'ade3d764efc1f6edd1bdbe299241b29aba672ad9af52cf66c62799bf4b0b1774'],
  ['GO06', 2547, 2589, 'e4067a8a405cc780c943ce62f2d23c94120fd5ef4625220f7fd9927f4f9a183d'],
  ['GO07', 2644, 2696, 'f057c2942d927cb12824a62e90972718560a1c8babef73680fcbad4ea0c6525e'],
]
const TARGET = 'https://opencode.ai/inference/go/v1/chat/completions'
const MODEL = 'glm-5.3-flash'
const USER_AGENT = 'llm-writer-support-eval/1.0'
const RESPONSE_CAP = 32_768
const CALL_MS = 30_000
const TOTAL_MS = 210_000
const sdkVersion = name => JSON.parse(readFileSync(resolve(ROOT, `node_modules/${name}/package.json`), 'utf8')).version
const SDK_USER_AGENT = `ai/${sdkVersion('ai')} ai-sdk/provider-utils/${sdkVersion('@ai-sdk/provider-utils')} runtime/${globalThis.navigator?.userAgent?.toLowerCase() ?? `node.js/${process.version}`}`
const MOCK_KEY = 'synthetic-placeholder-not-an-authentication-credential'
const sha = value => createHash('sha256').update(value).digest('hex')
const bytes = value => Buffer.byteLength(value, 'utf8')
const copy = value => JSON.parse(JSON.stringify(value))
class SafeError extends Error { constructor(category) { super(category); this.category = category } }
const requireSafe = (condition, category) => { if (!condition) throw new SafeError(category) }
const categories = new Set(['transport', 'timeout', 'cancelled', 'settings', 'invalid_input', 'invalid_response',
  'source_changed', 'configuration_changed', 'owner_changed', 'expired', 'input_budget', 'response_too_large',
  'output_incomplete', 'request_limit', 'redirect', 'invalid_limits', 'fixture_mismatch', 'prompt_mismatch',
  'wire_allowlist', 'storage_forbidden', 'credential_input', 'source_snapshot_changed', 'argument_error',
  'network_forbidden', 'unexpected_error', 'protocol_refusal', 'unsupported_encoding', 'fixture_gate_mismatch'])
const categoryOf = error => {
  for (const value of [error?.category, error?.reason, error?.code]) if (categories.has(value)) return value
  return 'unexpected_error'
}
let key = ''
const redact = value => {
  if (typeof value === 'string') return (key ? value.split(key).join('[REDACTED]') : value)
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item)]))
  return value
}

// Install BEFORE importing any application module. This map never reaches disk.
const memory = new Map()
const usageKeys = new Set(['account_balance', 'billing_records', 'token_usage_stats'])
let forbiddenStorageWrites = 0
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  get length() { return memory.size }, key: index => [...memory.keys()][index] ?? null,
  getItem: name => memory.get(name) ?? null,
  setItem(name, value) {
    if (!usageKeys.has(name) || (key && String(value).includes(key))) {
      forbiddenStorageWrites++; throw new SafeError('storage_forbidden')
    }
    if (name === 'billing_records') {
      const records = JSON.parse(String(value))
      if (!Array.isArray(records) || records.some(record => record.content || record.response)) {
        forbiddenStorageWrites++; throw new SafeError('storage_forbidden')
      }
    }
    memory.set(name, String(value))
  },
  removeItem: name => memory.delete(name), clear: () => memory.clear(),
} })
// Never allow SDK/provider warnings or errors (which can contain headers/body) to print.
let suppressedLogs = 0
for (const name of ['log', 'info', 'warn', 'error', 'debug', 'trace']) console[name] = () => { suppressedLogs++ }
globalThis.AI_SDK_LOG_WARNINGS = false
process.emitWarning = () => { suppressedLogs++ }
let unhandledFailures = 0
process.on('unhandledRejection', () => { unhandledFailures++ })

const args = process.argv.slice(2)
const live = args.includes('--live')
const continueAfterFirst = args.includes('--continue-after-go01')
const failures = ['transport', 'invalid', 'refusal', 'truncated', 'oversized', 'redirect', 'credential-echo', 'semantic-mismatch']
const failureArg = args.find(value => value.startsWith('--mock-failure='))
const mockFailure = failureArg?.split('=')[1] ?? null
let activeTrial = null
let attempts = 0
let externalRequests = 0
let deniedNetworkAttempts = 0
let requestedTokens = 0
let firstValid = false
let runStarted = 0
let continuationStarted = 0
let baseline = null
let apiConfig = null
let fixture = null
const session = randomUUID()
const report = {
  evaluation: 'small synthetic code/document integration observation',
  mode: live ? 'live' : 'mock-only', liveSuccessClaim: false,
  purpose: 'Protocol/adapter/current-source integration, not novel quality, model truth, or stage-three acceptance.',
  target: TARGET, model: MODEL, thinkingMode: 'default',
  routeCaveat: 'User-supplied /go/v1 route retained; documented /go/openai/v1 route is different and is not probed.',
  identification: USER_AGENT, browserCompatibilityTested: false,
  scope: live && !continueAfterFirst ? 'GO01 only' : 'GO01 then GO02–GO07 only if valid',
  limits: { attempts: 7, requestedOutputTokens: 5400, firstOutputTokens: 600, otherOutputTokens: 800,
    outputBudgetIncludesReasoning: true, responseDecodedBytes: RESPONSE_CAP, perCaseMs: CALL_MS, totalMs: TOTAL_MS, continuationMs: 180_000,
    retries: 0, redirects: false, tools: false, proxies: false },
  mockFailure, trials: [], fatalCategory: null,
}

function sourceSnapshot() {
  const paths = [SELF, FIXTURE, resolve(ROOT, 'package.json'), resolve(ROOT, 'package-lock.json')]
  for (const name of ['ai', '@ai-sdk/openai-compatible', '@ai-sdk/provider-utils']) {
    paths.push(resolve(ROOT, `node_modules/${name}/package.json`), resolve(ROOT, `node_modules/${name}/dist/index.js`))
  }
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && /\.(ts|vue|js|json)$/.test(entry.name)) paths.push(path)
    }
  }
  visit(resolve(ROOT, 'src'))
  const manifest = paths.sort().map(path => [relative(ROOT, path), sha(readFileSync(path))])
  return { sourceTreeSha256: sha(JSON.stringify(manifest)), fileCount: manifest.length,
    harnessSha256: sha(readFileSync(SELF)), fixtureSha256: sha(readFileSync(FIXTURE)) }
}
function assertSources() {
  const current = sourceSnapshot()
  requireSafe(current.sourceTreeSha256 === baseline.sourceTreeSha256, 'source_snapshot_changed')
  return current
}
function assertStorage() {
  requireSafe(forbiddenStorageWrites === 0 && [...memory.keys()].every(name => usageKeys.has(name))
    && (!key || [...memory.values()].every(value => !value.includes(key))), 'storage_forbidden')
}
function assertTime() {
  requireSafe(runStarted > 0 && performance.now() - runStarted < TOTAL_MS, 'timeout')
  requireSafe(activeTrial && performance.now() - activeTrial.started < CALL_MS, 'timeout')
  requireSafe(!continuationStarted || performance.now() - continuationStarted < 180_000, 'timeout')
}
function checkPrompt(test, payload) {
  const frozen = FROZEN.find(row => row[0] === test.id)
  const wire = JSON.stringify({ version: 1, question: test.question,
    sources: test.sourceExcerpts.map((source, index) => ({ reference: index + 1, quote: source.quote })) })
  requireSafe(payload.prompt === wire && sha(payload.prompt) === frozen[3] && sha(payload.system) === SYSTEM_SHA, 'prompt_mismatch')
  requireSafe(payload.inputChars === frozen[1] && payload.inputBytes === frozen[2], 'prompt_mismatch')
  requireSafe(payload.inputChars <= (test.id === 'GO01' ? 3000 : 4000)
    && payload.inputBytes <= (test.id === 'GO01' ? 12000 : 16000), 'input_budget')
}
function validateDispatch(input, init) {
  requireSafe(activeTrial && (typeof input === 'string' || input instanceof URL), 'wire_allowlist')
  requireSafe(String(input) === TARGET && init?.method === 'POST' && init.redirect === 'error'
    && init.signal instanceof AbortSignal && typeof init.body === 'string', 'wire_allowlist')
  const headers = new Headers(init.headers)
  const allowed = new Set(['authorization', 'content-type', 'user-agent', 'x-opencode-session'])
  requireSafe([...headers.keys()].every(name => allowed.has(name)), 'wire_allowlist')
  requireSafe(headers.get('authorization') === `Bearer ${key}` && headers.get('content-type') === 'application/json'
    && headers.get('user-agent') === SDK_USER_AGENT && headers.get('x-opencode-session') === session, 'wire_allowlist')
  const body = JSON.parse(init.body)
  const expected = { model: MODEL, max_tokens: activeTrial.outputCap, temperature: 0.1,
    messages: [{ role: 'system', content: activeTrial.payload.system }, { role: 'user', content: activeTrial.payload.prompt }] }
  // Exact object shape, fixed synthetic strings, no tools/extra body/model overrides.
  requireSafe(Object.keys(body).length === Object.keys(expected).length
    && Object.keys(expected).every(name => JSON.stringify(body[name]) === JSON.stringify(expected[name])), 'wire_allowlist')
  requireSafe(!init.body.includes(key) && bytes(init.body) <= 20_000, 'wire_allowlist')
  requireSafe(attempts < 7 && activeTrial.attemptedRequestCount === 0
    && requestedTokens + activeTrial.outputCap <= 5400
    && (activeTrial.id === 'GO01' || firstValid), 'request_limit')
  assertSources(); assertStorage(); assertTime()
  activeTrial.requestBytes = bytes(init.body)
  activeTrial.dispatchAllowlistPassed = true
  // SDK replaces provider custom User-Agent; normalize only this approved non-secret header.
  headers.set('user-agent', USER_AGENT)
  return headers
}

const trustedHttpsRequest = https.request.bind(https)
// No original fetch is retained: the SDK can only use the dispatcher below.
function mockNetworkGuard() { deniedNetworkAttempts++; throw new SafeError('network_forbidden') }
if (!live) {
  net.Socket.prototype.connect = mockNetworkGuard
  tls.connect = mockNetworkGuard
  http.request = http.get = https.request = https.get = mockNetworkGuard
  dgram.createSocket = mockNetworkGuard
}
function envelope(content, finish = 'stop', refusal = null) {
  return { id: 'synthetic-response', object: 'chat.completion', created: 1, model: MODEL,
    choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content, ...(refusal ? { refusal } : {}) } }],
    usage: { prompt_tokens: 80, completion_tokens: 50, total_tokens: 130 } }
}
function mockedResponse() {
  if (activeTrial.id === 'GO01') {
    if (mockFailure === 'transport') throw new SafeError('transport')
    if (mockFailure === 'redirect') { activeTrial.transportFailureCategory = 'redirect'; return new Response('', { status: 307, headers: { location: 'https://never-contact.invalid/' } }) }
    if (mockFailure === 'oversized') return new Response('x'.repeat(RESPONSE_CAP + 1))
  }
  const firstFailure = activeTrial.id === 'GO01' && mockFailure
  let content = JSON.stringify(activeTrial.test.controlledResponse)
  if (firstFailure === 'invalid') content = '{invalid JSON'
  if (firstFailure === 'refusal') { content = null; activeTrial.mockObservation = 'provider-refusal-fixture' }
  if (firstFailure === 'semantic-mismatch') {
    content = JSON.stringify({ version: 1, verdict: 'insufficient', reason: 'missing_premise', answer: null,
      explanation: 'Synthetic wrong-verdict response for the continuation gate test, not a model observation.',
      premises: [], missing: ['Synthetic deliberately missing premise.'] })
  }
  if (firstFailure === 'credential-echo') {
    const parsed = copy(activeTrial.test.controlledResponse)
    parsed.explanation = `Synthetic redaction canary ${key}`
    content = JSON.stringify(parsed)
  }
  return new Response(JSON.stringify(envelope(content, firstFailure === 'truncated' ? 'length' : 'stop',
    firstFailure === 'refusal' ? 'Synthetic refusal' : null)), { headers: { 'content-type': 'application/json' } })
}

// Explicit HTTPS transport ignores proxy environment variables and never follows redirects.
// Accept only identity coding; unsupported compression fails without parsing provider text.
function liveResponse(body, headers, signal) {
  return new Promise((resolveResponse, reject) => {
    let settled = false
    let request
    let response
    let timer
    const fail = category => {
      if (settled) return
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort)
      response?.destroy(); request?.destroy(); reject(new SafeError(category))
    }
    const abort = () => fail('cancelled')
    if (signal.aborted) { fail('cancelled'); return }
    signal.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => fail('timeout'), Math.max(1, Math.min(CALL_MS - (performance.now() - activeTrial.started), TOTAL_MS - (performance.now() - runStarted))))
    try {
      externalRequests++
      request = trustedHttpsRequest({ protocol: 'https:', hostname: 'opencode.ai', port: 443,
        path: '/inference/go/v1/chat/completions', method: 'POST', agent: false, rejectUnauthorized: true,
        headers: { ...Object.fromEntries(headers), 'accept-encoding': 'identity', 'content-length': String(bytes(body)) } }, incoming => {
        response = incoming
        const encoding = incoming.headers['content-encoding']
        if (encoding && encoding !== 'identity') { fail('unsupported_encoding'); return }
        if (incoming.statusCode >= 300 && incoming.statusCode < 400) { fail('redirect'); return }
        if (Number(incoming.headers['content-length'] ?? 0) > RESPONSE_CAP) { fail('response_too_large'); return }
        const chunks = []
        let length = 0
        incoming.on('data', chunk => {
          length += chunk.length
          activeTrial.responseBytes = length
          if (length > RESPONSE_CAP) { fail('response_too_large'); return }
          chunks.push(chunk)
        })
        incoming.on('aborted', () => fail('transport'))
        incoming.on('error', () => fail('transport'))
        incoming.on('end', () => {
          if (settled) return
          if (!incoming.complete) { fail('transport'); return }
          const responseHeaders = { 'content-type': String(incoming.headers['content-type'] ?? ''), 'content-length': String(length) }
          try {
            const completed = new Response(Buffer.concat(chunks), { status: incoming.statusCode, headers: responseHeaders })
            settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort)
            resolveResponse(completed)
          } catch { fail('transport') }
        })
      })
      request.on('error', () => fail('transport'))
      request.end(body)
    } catch { fail('transport') }
  })
}

globalThis.fetch = async (input, init) => {
  try {
    const headers = validateDispatch(input, init)
    attempts++; requestedTokens += activeTrial.outputCap; activeTrial.attemptedRequestCount++
    const response = live ? await liveResponse(init.body, headers, init.signal) : mockedResponse()
    activeTrial.httpStatus = response.status
    // Mock responses are bounded fixtures; count bytes without consuming the production reader.
    if (!live) activeTrial.responseBytes = bytes(await response.clone().text())
    return response
  } catch (error) { if (activeTrial) activeTrial.transportFailureCategory = categoryOf(error); throw new SafeError(categoryOf(error)) }
}

async function readStdinKey() {
  requireSafe(!process.stdin.isTTY, 'credential_input')
  const chunks = []
  let length = 0
  for await (const chunk of process.stdin) {
    length += chunk.length
    requireSafe(length <= 514, 'credential_input')
    chunks.push(Buffer.from(chunk))
  }
  const data = Buffer.concat(chunks)
  try {
    const value = data.toString('utf8')
    requireSafe(/^[\x21-\x7e]{8,512}\r?\n?$/.test(value), 'credential_input')
    return value.replace(/\r?\n$/, '')
  } finally { data.fill(0); for (const chunk of chunks) chunk.fill(0) }
}
function resultEvidence(test, result, project, anchors) {
  if (result.state !== 'assessed') return { actualVerdict: null, verdictAgreement: null, reasonAllowed: null,
    requiredCitationsPresent: null, exactCurrentSources: null }
  const cited = result.premises.flatMap(premise => premise.citations)
  const citedIds = fixture.corpus.filter(source => cited.some(citation => citation.chapterId === source.chapterId && citation.quote === source.quote)).map(source => source.sourceId)
  return { actualVerdict: result.verdict, verdictAgreement: result.verdict === test.expected.verdict,
    reasonAllowed: test.expected.allowedReasons.includes(result.reason), citedSourceIds: citedIds,
    requiredCitationsPresent: test.expected.requiredPremiseIds.every(id => citedIds.includes(id)),
    exactCurrentSources: cited.every(citation => {
      const chapter = project.chapters.find(item => item.id === citation.chapterId)
      return chapter && chapter.text.slice(citation.start, citation.end) === citation.quote
        && test.sourceExcerpts.some(source => JSON.stringify(anchors.get(source.sourceId)) === JSON.stringify({
          chapterId: citation.chapterId, sourceRevision: citation.sourceRevision, start: citation.start, end: citation.end, quote: citation.quote }))
    }) }
}

try {
  requireSafe(new Set(args).size === args.length && args.every(value => value === '--live' || value === '--continue-after-go01' || value === failureArg)
    && (!mockFailure || failures.includes(mockFailure)) && !(live && mockFailure) && (!continueAfterFirst || live), 'argument_error')
  const raw = readFileSync(FIXTURE)
  requireSafe(sha(raw) === FIXTURE_SHA, 'fixture_mismatch')
  fixture = JSON.parse(raw.toString('utf8'))
  baseline = sourceSnapshot(); report.before = baseline
  const { useApiConfig } = await import('../src/services/apiConfig.ts')
  const { buildSupportPrompt, prepareSupportCheck } = await import('../src/services/memory/supportCheck.ts')
  const { chapterRevision } = await import('../src/services/memory/revision.ts')
  const { MemoryIndex } = await import('../src/services/memory/engine.ts')
  const { validateGenerationBudget } = await import('../src/utils/generationBudget.ts')
  const api = (await import('../src/services/api.ts')).default
  const billing = (await import('../src/services/billing.ts')).default
  const project = { id: 'support-go-synthetic-code', title: 'Synthetic engineering integration only', clues: [],
    chapters: fixture.corpus.map(source => ({ id: source.chapterId, title: source.chapterTitle, text: source.quote })) }
  const projectSignature = JSON.stringify(project)
  const stats = await new MemoryIndex().sync(project)
  const anchors = new Map()
  for (const source of fixture.corpus) {
    const chapter = project.chapters.find(item => item.id === source.chapterId)
    anchors.set(source.sourceId, { chapterId: chapter.id, sourceRevision: await chapterRevision(chapter), start: 0, end: source.quote.length, quote: source.quote })
  }
  const config = { provider: 'custom', baseURL: 'https://opencode.ai/inference/go/v1', apiKey: '', selectedModel: MODEL,
    temperature: 0.1, maxTokens: 600, unlimitedTokens: false, thinkingProtocol: 'auto', thinkingMode: 'default',
    thinkingBudget: 4096, thinkingEffort: 'low', proxyUrl: '',
    customHeaders: { 'User-Agent': USER_AGENT, 'x-opencode-session': session } }
  // Preflight every frozen prompt and the exact live configuration BEFORE reading stdin.
  requireSafe(validateGenerationBudget(config) === null, 'settings')
  for (const test of fixture.cases) checkPrompt(test, buildSupportPrompt(test.question, test.sourceExcerpts.map(source => anchors.get(source.sourceId))))
  report.exactSettingsPreflight = 'passed'
  key = live ? await readStdinKey() : MOCK_KEY
  apiConfig = useApiConfig().apiConfig
  apiConfig.value = { ...config, apiKey: key } // Never updateConfig/resetConfig: both persist.
  runStarted = performance.now()
  let stopReason = null
  for (const test of fixture.cases) {
    const trial = { id: test.id, category: test.category, expectedVerdict: test.expected.verdict,
      requiredSourceIds: [...test.expected.requiredPremiseIds],
      requiredCitationReferences: test.sourceExcerpts.filter(source => test.expected.requiredPremiseIds.includes(source.sourceId)).map(source => source.reference),
      verdictAgreement: null, reasonAllowed: null, requiredCitationsPresent: null, exactCurrentSources: null,
      requiredAnswerFactsForManualReview: [...test.expected.requiredAnswerFacts],
      forbiddenConclusionsForManualReview: [...test.expected.forbiddenConclusions], actualVerdict: null,
      status: 'not-run', failureCategory: null, attemptedRequestCount: 0, elapsedMs: 0, requestBytes: 0,
      responseBytes: 0, usage: null, maxRequestedOutputTokens: test.id === 'GO01' ? 600 : 800 }
    report.trials.push(trial)
    if (stopReason || (live && test.id !== 'GO01' && !continueAfterFirst)) {
      trial.notRunReason = stopReason ?? 'continuation-not-authorized-in-this-invocation'; continue
    }
    const controller = new AbortController()
    const started = performance.now()
    const usageCountBefore = billing.getBillingRecords().length
    if (test.id === 'GO02') continuationStarted = started
    const timer = setTimeout(() => controller.abort(), Math.min(CALL_MS, TOTAL_MS - (started - runStarted),
      continuationStarted ? 180_000 - (started - continuationStarted) : Infinity))
    activeTrial = { ...trial, test, started, outputCap: trial.maxRequestedOutputTokens, payload: null }
    let prepared
    try {
      assertSources(); assertStorage(); assertTime()
      prepared = await prepareSupportCheck({ question: test.question, project: copy(project), stats: copy(stats),
        throughChapterId: test.throughChapterId, evidence: test.sourceExcerpts.map(source => copy(anchors.get(source.sourceId))),
        selectionFingerprint: `frozen-code-${test.id}-${FIXTURE_SHA}`, signal: controller.signal,
        assertOwner() { assertSources(); assertTime() },
        async assertFresh() { assertSources(); requireSafe(JSON.stringify(project) === projectSignature, 'source_changed') },
      })
      const result = await prepared.run(async request => {
        const payload = { system: request.system, prompt: request.prompt,
          inputChars: request.system.length + request.prompt.length, inputBytes: bytes(request.system) + bytes(request.prompt) }
        checkPrompt(test, payload); activeTrial.payload = payload
        activeTrial.inputChars = payload.inputChars; activeTrial.inputBytes = payload.inputBytes
        activeTrial.systemSha256 = sha(payload.system); activeTrial.promptSha256 = sha(payload.prompt)
        return api.generateText(request.prompt, { system: request.system, signal: request.signal,
          beforeRequest: request.beforeRequest, maxTokens: activeTrial.outputCap, temperature: 0.1,
          type: 'memory-support-code-eval', requestLimits: { maxAttempts: 1, maxResponseBytes: RESPONSE_CAP,
            timeoutMs: Math.max(1, Math.floor(CALL_MS - (performance.now() - started))), omitUsageContent: true } })
      })
      assertSources(); assertStorage(); assertTime()
      Object.assign(trial, resultEvidence(test, result, project, anchors))
      trial.parsedResult = redact(result)
      trial.status = result.state === 'assessed' ? 'assessed' : 'unverified'
      if (result.state !== 'assessed') trial.failureCategory = activeTrial.transportFailureCategory ?? categoryOf({ reason: result.reason })
      if (test.id === 'GO01') {
        firstValid = result.state === 'assessed' && trial.exactCurrentSources === true
          && trial.verdictAgreement === true && trial.reasonAllowed === true && trial.requiredCitationsPresent === true
        trial.continuationGatePassed = firstValid
        if (result.state === 'assessed' && !firstValid) {
          // A valid schema is not enough to authorize continuing the bounded fixture batch.
          // Preserve the assessed result for review instead of calling it a protocol failure.
          trial.failureCategory = 'fixture_gate_mismatch'
          stopReason = 'stopped-after-GO01-fixture_gate_mismatch'
        }
      }
      if (result.state !== 'assessed') stopReason = `stopped-after-${test.id}-${trial.failureCategory}`
    } catch (error) {
      trial.status = 'unverified'; trial.failureCategory = activeTrial.transportFailureCategory ?? categoryOf(error)
      stopReason = `stopped-after-${test.id}-${trial.failureCategory}`
    } finally {
      clearTimeout(timer); prepared?.cancel(); controller.abort()
      for (const name of ['attemptedRequestCount', 'requestBytes', 'responseBytes', 'httpStatus', 'dispatchAllowlistPassed', 'inputChars', 'inputBytes', 'systemSha256', 'promptSha256', 'mockObservation']) {
        if (activeTrial[name] !== undefined) trial[name] = activeTrial[name]
      }
      trial.elapsedMs = Math.round(performance.now() - started)
      const records = billing.getBillingRecords()
      const usage = records.length > usageCountBefore ? records[0] : null
      if (usage) trial.usage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        source: usage.usageSource, status: usage.status, realCost: null,
        costNote: 'Reported tokens if available; local pricing estimates are not provider charges.' }
      activeTrial = null
    }
  }
  report.after = sourceSnapshot()
  report.sourceUnchanged = report.after.sourceTreeSha256 === baseline.sourceTreeSha256
  assertStorage()
  requireSafe(report.sourceUnchanged, 'source_snapshot_changed')
} catch (error) { report.fatalCategory = categoryOf(error) }
finally {
  if (baseline) {
    try {
      report.after = sourceSnapshot()
      report.sourceUnchanged = report.after.sourceTreeSha256 === baseline.sourceTreeSha256
      if (!report.sourceUnchanged) report.fatalCategory = 'source_snapshot_changed'
    } catch { report.fatalCategory = 'source_snapshot_changed'; report.sourceUnchanged = false }
  }
  if (apiConfig) apiConfig.value = { ...apiConfig.value, apiKey: '', customHeaders: {} }
  report.summary = { attemptedRequests: attempts, externalRequests, deniedNetworkAttempts, requestedOutputTokens: requestedTokens,
    assessed: report.trials.filter(trial => trial.status === 'assessed').length,
    unverified: report.trials.filter(trial => trial.status === 'unverified').length,
    notRun: report.trials.filter(trial => trial.status === 'not-run').length,
    elapsedMs: runStarted ? Math.round(performance.now() - runStarted) : 0,
    forbiddenStorageWrites, persistentStorageWrites: 0, credentialStored: false, usageStorage: 'memory-only',
    suppressedLogs, unhandledFailures }
  report.interpretation = 'Verdict agreement and required-citation coverage are fixture comparisons only. Review answer/explanation/premise entailment manually; no string-equality semantic scoring. All invalid, refused, failed and skipped cases remain in the report.'
  const safeOutput = JSON.stringify(redact(report), null, 2)
  memory.clear(); key = ''
  // Keep untrusted diagnostics suppressed until process exit, including late callbacks.
    process.stdout.write(`${safeOutput}\n`)
  const expectedFailure = !live && mockFailure && mockFailure !== 'credential-echo'
  const semanticMismatch = mockFailure === 'semantic-mismatch'
  const expectedFailurePassed = expectedFailure && attempts === 1 && report.summary.notRun === 6
    && (semanticMismatch ? report.summary.assessed === 1 && report.summary.unverified === 0
      && report.trials[0]?.continuationGatePassed === false && report.trials[0]?.failureCategory === 'fixture_gate_mismatch'
      : report.summary.unverified === 1)
  const ordinaryPassed = !expectedFailure && firstValid && report.summary.unverified === 0 && report.summary.assessed === (live && !continueAfterFirst ? 1 : 7)
  process.exitCode = !report.fatalCategory && !unhandledFailures && !forbiddenStorageWrites && (live || externalRequests === 0)
    && deniedNetworkAttempts === 0 && (expectedFailurePassed || ordinaryPassed) ? 0 : 1
}
