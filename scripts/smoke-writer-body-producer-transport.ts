/** Actual production adapter → APIService → installed SDK → loopback HTTP.
 * Synthetic control only. No browser, external endpoint or real credential is used. */
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { ApiConfig } from '../src/types/api'
import type { BodyProducerIdentity } from '../src/types/bodyProducer'
import { BoundedGenerationError } from '../src/services/aiRequestLimits'
import { canonicalStringify } from '../src/services/writerCampaign/protocol'
import { BODY_PRODUCER_TRANSPORT_LIMITS, BodyProducerTransportError, createOfflineSdkBodyProducer } from '../src/services/writerCampaign/bodyProducerTransport'

const localStorage = new Map<string, string>(), storageReads: string[] = []
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => { storageReads.push(key); return localStorage.get(key) ?? null },
  setItem: (key: string, value: string) => { localStorage.set(key, String(value)) },
  removeItem: (key: string) => { localStorage.delete(key) },
} })
const defaultReply = JSON.stringify({ protocol: 'body-producer-output-v1', items: [], saturated: false, examination: { status: 'not_declared', intervals: [] } })
const privateDiagnostic = 'provider-diagnostic-must-not-escape-body-producer'
const privateBody = '原文保持不变。A\u030A\r\n𠮷🙂\u0085\u0000\u0001\t"\\ exact original.'
type Scenario = { status?: number; finish?: string; text?: string; raw?: string; usage?: Record<string, unknown> | null; hold?: boolean }
const scenarios = new Map<string, Scenario>(), pendingReplies = new Map<string, () => void>(), arrivals = new Map<string, () => void>()
const bodies: Array<{ id: string; body: any; path: string }> = []
let failureCount = 0
const unhandled: unknown[] = []
const digest = (value: unknown) => createHash('sha256').update(canonicalStringify(value)).digest('hex')
let attempts = 0, guards = 0
const server = http.createServer(async (req, res) => {
  try {
    assert.equal(req.method, 'POST')
    assert.equal(req.url, '/v1/chat/completions')
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw), content = JSON.parse(body.messages[1].content), id = content.caseId as string
    assert.ok(typeof id === 'string' && id.length)
    bodies.push({ id, body, path: req.url! })
    assert.equal(body.model, 'synthetic-body-producer')
    assert.equal(body.max_tokens, 1200)
    assert.equal(body.temperature, 0.1)
    assert.deepEqual(body.thinking, { type: 'disabled' })
    for (const forbidden of ['stream', 'tools', 'tool_choice', 'functions']) assert.equal(body[forbidden], undefined)
    assert.equal(body.messages.length, 2)
    assert.equal(body.messages[0].role, 'system'); assert.equal(body.messages[1].role, 'user')
    const scenario = scenarios.get(id) ?? {}
    const finish = () => {
      const status = scenario.status ?? 200
      res.writeHead(status, { 'content-type': 'application/json', ...(status === 307 ? { location: '/must-not-follow' } : {}) })
      if (scenario.raw !== undefined) { res.end(scenario.raw); return }
      if (status !== 200) { res.end(JSON.stringify({ error: { message: privateDiagnostic } })); return }
      res.end(JSON.stringify({ id: 'synthetic-control-response', object: 'chat.completion', created: 1,
        model: 'provider-reported-name-is-not-verified', choices: [{ index: 0, finish_reason: scenario.finish ?? 'stop', message: { role: 'assistant', content: scenario.text ?? defaultReply } }],
        usage: scenario.usage === null ? undefined : scenario.usage ?? { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 } }))
    }
    if (scenario.hold) pendingReplies.set(id, finish)
    else finish()
    arrivals.get(id)?.()
  } catch { failureCount++; res.destroy(new Error('local synthetic fixture failure')) }
})
await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, endpoint = `${origin}/v1`
let revision = 1
const makeIdentity = (patch: Partial<BodyProducerIdentity> = {}): BodyProducerIdentity => ({
  adapterId: 'bounded-sdk-v1', adapterVersion: 'body-producer-sdk-v1', mode: 'offline_control', requestedModelId: 'synthetic-body-producer',
  effectiveModelId: 'synthetic-body-producer', configurationRevision: `control-${revision}`, endpointIdentity: endpoint, ...patch,
})
const adapter = (timeoutMs = 30_000, identity = makeIdentity()) => createOfflineSdkBodyProducer({ identity, currentConfigurationRevision: () => `control-${revision}`, timeoutMs })
const constructionReads = storageReads.length
const constructedBeforeConfiguration = adapter()
assert.equal(storageReads.length, constructionReads, 'Adapter construction does not load settings or credentials')
assert.equal(Object.isFrozen(constructedBeforeConfiguration.identity), true)
const { useApiConfig } = await import('../src/services/apiConfig')
const billing = (await import('../src/services/billing')).default
const base: ApiConfig = { provider: 'custom', baseURL: endpoint, selectedModel: 'synthetic-body-producer',
  apiKey: 'synthetic-placeholder-not-a-secret', maxTokens: null, unlimitedTokens: true, temperature: 0.9,
  customHeaders: {}, proxyUrl: '', thinkingMode: 'disabled', thinkingProtocol: 'deepseek' }
function setConfig(patch: Partial<ApiConfig> = {}) { revision++; useApiConfig().updateConfig({ ...base, ...patch }) }
const originalFetch = globalThis.fetch
const onUnhandled = (error: unknown) => { unhandled.push(error) }
process.on('unhandledRejection', onUnhandled)
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  assert.equal(url.origin, origin, 'No external, discovery, proxy, fallback, tool or redirected request')
  assert.equal(url.pathname, '/v1/chat/completions')
  assert.equal(init?.redirect, 'error'); attempts++
  return originalFetch(input, init)
}
const wire = (id: string, text = privateBody) => ({ system: 'Read exact story data only. No tools or outside facts.', prompt: JSON.stringify({ caseId: id, window: text }) })
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function waitArrival(id: string) { return new Promise<void>(resolve => { arrivals.set(id, resolve) }) }
const cases: string[] = []
async function test(id: string, action: () => unknown | Promise<unknown>) { await action(); cases.push(id); console.log(`PASS ${id}`) }
async function succeeds(id: string, producer = adapter(), expectedText = defaultReply) {
  const before = attempts, guardBefore = guards, selectedWire = wire(id)
  const result = await producer.invoke({ wire: selectedWire, signal: new AbortController().signal, beforeRequest: async () => {
    guards++; assert.equal(bodies.some(row => row.id === id), false, 'Durable gate precedes actual HTTP')
  } })
  assert.equal(attempts - before, 1); assert.equal(guards - guardBefore, 1)
  assert.equal(digest(result.text), digest(expectedText))
  assert.equal(result.reportedModelId, null, 'API exposes no attributable returned model identity')
  assert.match(result.evidenceId, /^invocation-[a-f0-9-]{36}$/)
  assert.equal(digest(bodies.at(-1)!.body.messages), digest([{ role: 'system', content: selectedWire.system }, { role: 'user', content: selectedWire.prompt }]))
  return result
}
async function fails(id: string, expectedCode: string, options: { producer?: ReturnType<typeof adapter>; guard?: () => Promise<void>; signal?: AbortSignal; wire?: { system: string; prompt: string }; calls?: number } = {}) {
  const before = attempts
  await assert.rejects((options.producer ?? adapter()).invoke({ wire: options.wire ?? wire(id), signal: options.signal ?? new AbortController().signal,
    beforeRequest: options.guard ?? (async () => { guards++ }) }), error => {
    assert.ok(error instanceof BoundedGenerationError || error instanceof BodyProducerTransportError)
    assert.equal(error.code, expectedCode)
    assert.ok(!String(error.stack).includes(privateDiagnostic) && !JSON.stringify(error).includes(privateBody))
    return true
  })
  assert.equal(attempts - before, options.calls ?? 1, 'A failure never retries or repairs')
}
try {
  setConfig()
  await test('bilingual_exact_sdk_payload_and_synthetic_usage', async () => {
    const result = await succeeds('exact-source')
    assert.deepEqual(result.usage, { provenance: 'synthetic_control', inputTokens: 17, outputTokens: 9, reasoningTokens: null })
    assert.equal(digest(JSON.parse(bodies.at(-1)!.body.messages[1].content).window), digest(privateBody))
    assert.equal(billing.getBillingRecords()[0]!.content, ''); assert.equal(billing.getBillingRecords()[0]!.response, '')
  })
  await test('input_is_snapshotted_before_lazy_sdk_setup', async () => {
    const selected = wire('snapshot'), exact = { ...selected }, producer = adapter()
    const pending = producer.invoke({ wire: selected, signal: new AbortController().signal, beforeRequest: async () => { guards++ } })
    selected.prompt = 'mutated-after-invocation'
    await pending
    assert.equal(digest(bodies.at(-1)!.body.messages), digest([{ role: 'system', content: exact.system }, { role: 'user', content: exact.prompt }]))
  })
  await test('unknown_and_partial_usage_are_not_zero', async () => {
    scenarios.set('no-usage', { usage: null })
    assert.deepEqual((await succeeds('no-usage')).usage, { provenance: 'synthetic_control', inputTokens: null, outputTokens: null, reasoningTokens: null })
    scenarios.set('partial-usage', { usage: { prompt_tokens: 17 } })
    assert.deepEqual((await succeeds('partial-usage')).usage, { provenance: 'synthetic_control', inputTokens: 17, outputTokens: null, reasoningTokens: null })
  })
  await test('malformed_and_empty_output_remain_exact_untrusted_data', async () => {
    for (const [id, text] of [['malformed-output', '{bad-json'], ['empty-output', '']] as const) {
      scenarios.set(id, { text }); assert.equal(digest((await succeeds(id, adapter(), text)).text), digest(text))
    }
  })
  await test('one_attempt_on_http_failure_redirect_and_incomplete_output', async () => {
    scenarios.set('http-error', { status: 503 }); await fails('http-error', 'transport')
    scenarios.set('redirect', { status: 307 }); await fails('redirect', 'transport')
    scenarios.set('incomplete', { finish: 'length' }); await fails('incomplete', 'output_incomplete')
  })
  await test('decoded_http_and_returned_text_caps_are_independent', async () => {
    scenarios.set('huge-http', { raw: '中'.repeat(22_000) }); await fails('huge-http', 'response_too_large')
    scenarios.set('huge-text', { text: 'a'.repeat(16_385) }); await fails('huge-text', 'response_capacity')
    scenarios.set('huge-utf8-text', { text: '中'.repeat(5_462) }); await fails('huge-utf8-text', 'response_capacity')
    scenarios.set('unpaired-surrogate', { text: '\ud800' }); await fails('unpaired-surrogate', 'response_capacity')
    scenarios.set('exact-text-cap', { text: 'a'.repeat(16_384) }); await succeeds('exact-text-cap', adapter(), 'a'.repeat(16_384))
  })
  await test('wire_size_and_shape_refuse_before_http', async () => {
    for (const bad of [{ system: '', prompt: 'x' }, { system: 'x', prompt: 'a'.repeat(16_384) },
      { system: 'x', prompt: '中'.repeat(11_000) }, { ...wire('extra-key'), extra: 'not-allowed' }]) {
      await fails('invalid-input', 'invalid_input', { wire: bad, calls: 0 })
    }
  })
  await test('failed_guard_and_deadline_have_zero_dispatch', async () => {
    await fails('failed-guard', 'transport', { guard: async () => { throw new Error(privateDiagnostic) }, calls: 0 })
    await fails('stalled-guard', 'timeout', { producer: adapter(20), guard: () => new Promise(() => {}), calls: 0 })
  })
  await test('configuration_change_before_or_during_intent_blocks_dispatch', async () => {
    const stale = adapter(); setConfig()
    await fails('stale-configuration', 'configuration_changed', { producer: stale, calls: 0 })
    const during = adapter()
    await fails('changed-during-intent', 'transport', { producer: during, calls: 0, guard: async () => { guards++; setConfig() } })
  })
  await test('external_or_secret_bearing_endpoint_and_proxy_are_rejected', async () => {
    for (const patch of [
      { mode: 'live' as const }, { endpointIdentity: 'https://example.com/v1' },
      { endpointIdentity: `${origin}/v1?api_key=not-a-secret` }, { endpointIdentity: `${origin}/v1#fragment` },
      { endpointIdentity: endpoint.replace('http://', 'http://user:password@') },
    ]) assert.throws(() => adapter(30_000, makeIdentity(patch)), error => error instanceof BodyProducerTransportError && error.code === 'offline_only')
    for (const patch of [{ baseURL: 'https://example.com/v1' }, { proxyUrl: `${origin}/proxy/` }, { customHeaders: { 'x-any-header': 'not-allowed' } }]) {
      setConfig(patch)
      await assert.rejects(adapter().invoke({ wire: wire('blocked-config'), signal: new AbortController().signal, beforeRequest: async () => { throw new Error('must-not-intend') } }),
        error => error instanceof BodyProducerTransportError && ['offline_only', 'configuration_changed'].includes(error.code))
    }
    setConfig()
  })
  await test('reasoning_must_be_explicitly_disabled', async () => {
    setConfig({ thinkingMode: 'default' })
    await fails('default-thinking', 'configuration_changed', { calls: 0 })
    setConfig()
  })
  await test('cancel_before_http_and_late_response_cannot_escape', async () => {
    const cancelled = new AbortController(); cancelled.abort()
    await fails('already-cancelled', 'cancelled', { signal: cancelled.signal, calls: 0 })
    scenarios.set('late-after-cancel', { hold: true })
    const arrival = waitArrival('late-after-cancel'), controller = new AbortController(), producer = adapter()
    const before = attempts
    const pending = producer.invoke({ wire: wire('late-after-cancel'), signal: controller.signal, beforeRequest: async () => { guards++ } })
    await arrival; controller.abort()
    await assert.rejects(pending, error => error instanceof BoundedGenerationError && error.code === 'cancelled')
    pendingReplies.get('late-after-cancel')!(); await tick()
    assert.equal(attempts - before, 1)
  })
  await test('provider_timeout_never_retries', async () => {
    scenarios.set('held-timeout', { hold: true })
    await fails('held-timeout', 'timeout', { producer: adapter(30) })
    pendingReplies.get('held-timeout')?.(); await tick()
  })
  await test('deadline_ceiling_and_descriptor_ownership', async () => {
    assert.throws(() => adapter(30_001), error => error instanceof BoundedGenerationError && error.code === 'invalid_limits')
    const identity = makeIdentity(), producer = adapter(30_000, identity)
    identity.effectiveModelId = 'changed-caller-object'
    assert.equal(producer.identity.effectiveModelId, 'synthetic-body-producer')
    assert.deepEqual(BODY_PRODUCER_TRANSPORT_LIMITS, { inputBytes: 32_768, inputUtf16: 16_384, textBytes: 16_384, textUtf16: 16_384,
      httpBytes: 65_536, outputTokens: 1_200, timeoutMs: 30_000 })
  })
  await tick()
  assert.equal(failureCount, 0); assert.equal(unhandled.length, 0)
  for (const record of billing.getBillingRecords()) { assert.equal(record.content, ''); assert.equal(record.response, '') }
  assert.ok(![...localStorage.values()].some(value => value.includes(privateBody) || value.includes(privateDiagnostic)), 'No source or raw diagnostic in usage/settings storage')
  console.log(JSON.stringify({ protocol: 'body-producer-transport-controls-v1', adapter: 'production adapter → APIService → actual installed SDK → loopback HTTP',
    passed: cases.length, cases, loopbackRequests: bodies.length, attempts, externalRequests: 0,
    quality: 'offline synthetic controls; model quality and live readiness not established' }, null, 2))
} finally {
  globalThis.fetch = originalFetch; process.removeListener('unhandledRejection', onUnhandled)
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
}
