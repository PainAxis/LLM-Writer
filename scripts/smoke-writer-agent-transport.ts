/** Production APIService + real SDK against a loopback HTTP server. Synthetic transport checks only. */
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ApiConfig, GenerateOptions, GenerationRequestUsage } from '../src/types/api'
import { BoundedGenerationError } from '../src/services/aiRequestLimits'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, String(value)) },
  removeItem: (key: string) => { storage.delete(key) },
} })
const { useApiConfig } = await import('../src/services/apiConfig')
const api = (await import('../src/services/api')).default
const billing = (await import('../src/services/billing')).default
const { loadAISDK } = await import('../src/services/aiProviders')
const limits = { maxAttempts: 1 as const, maxResponseBytes: 65_536, timeoutMs: 30_000, omitUsageContent: true as const }
const options: GenerateOptions = { maxTokens: 1200, temperature: 0.1, requestLimits: limits, type: 'writer-agent-transport' }
const privateText = 'synthetic-manuscript-never-in-metadata'
const providerDiagnostic = 'synthetic-provider-error-never-in-metadata'
const answer = 'synthetic model answer'
type Scenario = { status?: number; finish?: string; usage?: Record<string, unknown> | null; raw?: string; hold?: boolean }
const scenarios = new Map<string, Scenario>()
const bodies: Array<{ id: string; body: any; path: string }> = []
const held = new Map<string, () => void>()
const arrived = new Map<string, () => void>()
let attempts = 0
const server = http.createServer(async (req, res) => {
  try {
    assert.equal(req.method, 'POST')
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    const id = raw.match(/case:([a-z0-9-]+)/)?.[1]
    assert.ok(id, 'Every synthetic request has a local test identity')
    const scenario = scenarios.get(id) ?? {}
    bodies.push({ id, body, path: req.url! })
    assert.equal(body.stream, undefined, 'Only non-streaming SDK requests')
    assert.equal(body.tools, undefined, 'No tools or extra calls')
    assert.equal(body.tool_choice, undefined)
    const write = () => {
      const status = scenario.status ?? 200
      res.writeHead(status, { 'content-type': 'application/json', ...(status === 307 ? { location: '/unreachable-redirect' } : {}) })
      if (scenario.raw !== undefined) { res.end(scenario.raw); return }
      if (status !== 200) {
        res.end(JSON.stringify({ error: { message: providerDiagnostic }, usage: { prompt_tokens: 888, completion_tokens: 888 } }))
        return
      }
      let value: unknown
      if (req.url!.endsWith('/messages')) {
        value = { id: 'synthetic', type: 'message', role: 'assistant', model: body.model,
          content: [{ type: 'text', text: answer }], stop_reason: scenario.finish ?? 'end_turn', stop_sequence: null,
          usage: scenario.usage === null ? undefined : scenario.usage ?? { input_tokens: 17, output_tokens: 9 } }
      } else if (req.url!.endsWith(':generateContent')) {
        value = { candidates: [{ content: { role: 'model', parts: [{ text: answer }] }, finishReason: scenario.finish ?? 'STOP' }],
          usageMetadata: scenario.usage === null ? undefined : scenario.usage ?? { promptTokenCount: 17, candidatesTokenCount: 6, thoughtsTokenCount: 3, totalTokenCount: 26 } }
      } else {
        value = { id: 'synthetic', object: 'chat.completion', created: 1, model: body.model,
          choices: [{ index: 0, finish_reason: scenario.finish ?? 'stop', message: { role: 'assistant', content: answer } }],
          usage: scenario.usage === null ? undefined : scenario.usage ?? { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 } }
      }
      res.end(JSON.stringify(value))
    }
    if (scenario.hold) held.set(id, write)
    else write()
    arrived.get(id)?.()
  } catch (error) { res.destroy(error instanceof Error ? error : new Error('local fixture failure')) }
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const base: ApiConfig = { provider: 'custom', baseURL: `${origin}/v1`, apiKey: 'synthetic-placeholder-not-a-secret',
  selectedModel: 'synthetic-agent', temperature: 0.9, maxTokens: null, unlimitedTokens: true,
  customHeaders: {}, proxyUrl: '', thinkingProtocol: 'auto', thinkingMode: 'default', thinkingBudget: 4096, thinkingEffort: 'high' }
const oldFetch = globalThis.fetch
const unhandled: unknown[] = []
const onUnhandled = (error: unknown) => { unhandled.push(error) }
process.on('unhandledRejection', onUnhandled)
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  assert.equal(url.origin, origin, 'No external provider, discovery, fallback, or tool network traffic')
  assert.equal(init?.redirect, 'error')
  attempts++
  return oldFetch(input, init)
}
function setConfig(patch: Partial<ApiConfig> = {}) { useApiConfig().updateConfig({ ...base, ...patch }) }
function assertMetadata(event: GenerationRequestUsage) {
  assert.equal(Object.isFrozen(event), true)
  for (const key of Object.keys(event)) assert.ok(['status', 'usageSource', 'inputTokens', 'outputTokens', 'totalTokens'].includes(key))
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
    if (event[key] !== undefined) assert.ok(Number.isSafeInteger(event[key]) && event[key]! >= 0)
  }
  if (event.usageSource === 'unavailable') assert.deepEqual(Object.keys(event).sort(), ['status', 'usageSource'])
  assert.ok(!JSON.stringify(event).includes(privateText) && !JSON.stringify(event).includes(providerDiagnostic))
}
function reported(status: 'success' | 'failed' = 'success', inputTokens = 17, outputTokens = 9): GenerationRequestUsage {
  return { status, usageSource: 'reported', inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
}
async function call(id: string, patch: GenerateOptions = {}, failure?: string, expectedDispatches = 1) {
  const events: GenerationRequestUsage[] = []
  const before = attempts
  const pending = api.generateText(`case:${id} ${privateText}`, { ...options, ...patch, onRequestUsage: event => { assertMetadata(event); events.push(event) } })
  if (failure) await assert.rejects(pending, error => {
    assert.ok(error instanceof BoundedGenerationError)
    assert.equal(error.code, failure)
    assert.ok(!error.stack?.includes(providerDiagnostic))
    return true
  })
  else assert.equal(await pending, answer)
  assert.equal(attempts - before, expectedDispatches, 'Exactly the configured zero/one attempts')
  assert.equal(events.length, 1, 'One callback for the whole invocation')
  return events[0]!
}
function waitArrival(id: string) { return new Promise<void>(resolve => { arrived.set(id, resolve) }) }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

try {
  await loadAISDK()
  for (const provider of ['custom', 'anthropic', 'google'] as const) {
    setConfig(provider === 'anthropic' ? { provider, selectedModel: 'claude-sonnet-4-5', thinkingMode: 'budget', thinkingBudget: 1024 }
      : provider === 'google' ? { provider, selectedModel: 'gemini-2.5-flash', proxyUrl: `${origin}/proxy/`, thinkingMode: 'budget', thinkingBudget: 1024 } : {})
    assert.deepEqual(await call(`normal-${provider}`), reported())
    const body = bodies.at(-1)!.body
    assert.equal(provider === 'google' ? body.generationConfig.maxOutputTokens : body.max_tokens, 1200)
    if (provider === 'anthropic') assert.deepEqual(body.thinking, { type: 'enabled', budget_tokens: 1024 })
    if (provider === 'google') assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 1024)
  }
  setConfig()
  const plan = await call('completed-plan')
  scenarios.set('failed-draft', { status: 503 })
  const draft = await call('failed-draft', {}, 'transport')
  assert.deepEqual(plan, reported())
  assert.deepEqual(draft, { status: 'failed', usageSource: 'unavailable' }, 'No SDK usage event means unknown, even if an error body has numbers')
  assert.deepEqual(plan, reported(), 'Later phase failure never overwrites completed-plan evidence')
  scenarios.set('bad-finish', { finish: 'length' })
  assert.deepEqual(await call('bad-finish', {}, 'output_incomplete'), reported('failed'))
  for (const finish of ['content_filter', 'tool_calls', 'unknown_finish']) {
    scenarios.set('wrong-finish', { finish })
    assert.deepEqual(await call('wrong-finish', {}, 'output_incomplete'), reported('failed'))
  }

  // Neither global billing nor caller mutation can change an in-flight callback's owner.
  scenarios.set('concurrent-plan', { hold: true, usage: { prompt_tokens: 31, completion_tokens: 7 } })
  const concurrentArrived = waitArrival('concurrent-plan')
  const owned: GenerationRequestUsage[] = []
  let replacementCalls = 0
  const mutable: GenerateOptions = { ...options, onRequestUsage: event => { assertMetadata(event); owned.push(event) } }
  const concurrentPlan = api.generateText(`case:concurrent-plan ${privateText}`, mutable)
  await concurrentArrived
  mutable.onRequestUsage = () => { replacementCalls++ }
  scenarios.set('unrelated-call', { usage: { prompt_tokens: 999, completion_tokens: 111 } })
  assert.deepEqual(await call('unrelated-call'), reported('success', 999, 111))
  assert.equal(billing.getBillingRecords()[0]!.inputTokens, 999)
  held.get('concurrent-plan')!()
  assert.equal(await concurrentPlan, answer)
  assert.deepEqual(owned, [reported('success', 31, 7)])
  assert.equal(replacementCalls, 0, 'Callback is snapshotted before the first await')

  for (const asyncThrow of [false, true]) {
    const beforeCalls = attempts, beforeBills = billing.getBillingRecords().length
    let callbacks = 0
    assert.equal(await api.generateText(`case:observer-throw ${privateText}`, { ...options, onRequestUsage: () => {
      callbacks++
      if (asyncThrow) return Promise.reject(new Error(providerDiagnostic))
      throw new Error(providerDiagnostic)
    } }), answer)
    await tick()
    assert.equal(callbacks, 1); assert.equal(attempts - beforeCalls, 1)
    assert.equal(billing.getBillingRecords().length - beforeBills, 1, 'Observer failure cannot duplicate billing')
    assert.equal(billing.getBillingRecords()[0]!.status, 'success')
  }
  const beforeRejectedCalls = attempts, beforeRejectedBills = billing.getBillingRecords().length
  let rejectedCallbacks = 0
  await assert.rejects(api.generateText(`case:failed-draft ${privateText}`, { ...options, onRequestUsage: () => {
    rejectedCallbacks++
    throw new Error(providerDiagnostic)
  } }), error => error instanceof BoundedGenerationError && error.code === 'transport')
  assert.equal(rejectedCallbacks, 1); assert.equal(attempts - beforeRejectedCalls, 1)
  assert.equal(billing.getBillingRecords().length - beforeRejectedBills, 1)

  // The new port is bounded-only: ordinary SDK defaults must never pretend
  // missing output counts are provider-reported zeros. All three reject before HTTP.
  for (const patch of [{}, { provider: 'google', selectedModel: 'gemini-2.5-flash', proxyUrl: `${origin}/proxy/` },
    { provider: 'anthropic', selectedModel: 'claude-sonnet-4-5' }]) {
    setConfig(patch)
    scenarios.set('ordinary-partial', { usage: { prompt_tokens: 17 } })
    assert.deepEqual(await call('ordinary-partial', { requestLimits: undefined }, 'invalid_limits', 0),
      { status: 'failed', usageSource: 'unavailable' })
  }
  const beforeStreaming = attempts
  await assert.rejects(api.generateTextStream('bounded-only callback', {
    maxTokens: 1200, onRequestUsage: () => { throw new Error('stream callback must not be admitted') },
  }), error => error instanceof BoundedGenerationError && error.code === 'invalid_limits')
  assert.equal(attempts, beforeStreaming)
  setConfig()

  scenarios.set('missing-usage', { usage: null })
  assert.equal((await call('missing-usage')).usageSource, 'estimated')
  scenarios.set('partial-usage', { usage: { prompt_tokens: 17 } })
  assert.deepEqual(await call('partial-usage'), { status: 'success', usageSource: 'reported', inputTokens: 17 }, 'Absent output is not the SDK zero default')
  setConfig({ provider: 'google', selectedModel: 'gemini-2.5-flash', proxyUrl: `${origin}/proxy/` })
  scenarios.set('google-partial-usage', { usage: { promptTokenCount: 17 } })
  assert.deepEqual(await call('google-partial-usage'), { status: 'success', usageSource: 'reported', inputTokens: 17 })
  setConfig({ provider: 'anthropic', selectedModel: 'claude-sonnet-4-5' })
  scenarios.set('anthropic-cache-usage', { usage: { input_tokens: 12, cache_read_input_tokens: 5, output_tokens: 9 } })
  assert.deepEqual(await call('anthropic-cache-usage'), reported(), 'SDK normalized input includes cached tokens')
  setConfig()
  scenarios.set('negative-usage', { usage: { prompt_tokens: -2, completion_tokens: -1 } })
  assert.equal((await call('negative-usage')).usageSource, 'estimated')
  scenarios.set('unsafe-usage', { usage: { prompt_tokens: Number.MAX_SAFE_INTEGER + 1, completion_tokens: -1 } })
  assert.equal((await call('unsafe-usage')).usageSource, 'estimated')
  scenarios.set('overflow-total', { usage: { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1 } })
  assert.deepEqual(await call('overflow-total'), { status: 'success', usageSource: 'reported', inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 })
  // NaN/Infinity are not valid provider JSON numbers. Invalid bodies never become zero-cost evidence.
  for (const value of ['NaN', '1e309']) {
    scenarios.set('invalid-number', { raw: `{"usage":{"prompt_tokens":${value}},"choices":[]}` })
    assert.deepEqual(await call('invalid-number', {}, 'transport'), { status: 'failed', usageSource: 'unavailable' })
  }

  for (const patch of [
    { requestLimits: { ...limits, maxAttempts: 2 } }, { requestLimits: { ...limits, timeoutMs: 30_001 } },
    { requestLimits: { ...limits, maxResponseBytes: 65_537 } }, { requestLimits: { ...limits, omitUsageContent: false } },
  ]) assert.deepEqual(await call('invalid-limits', patch as GenerateOptions, 'invalid_limits', 0), { status: 'failed', usageSource: 'unavailable' })
  for (const maxTokens of [undefined, 0, 1201]) assert.deepEqual(await call('invalid-output', { maxTokens }, 'settings', 0), { status: 'failed', usageSource: 'unavailable' })
  setConfig({ apiKey: '' })
  assert.deepEqual(await call('missing-config', {}, 'settings', 0), { status: 'failed', usageSource: 'unavailable' })
  setConfig()
  let guards = 0
  assert.deepEqual(await call('guarded', { beforeRequest: async () => { guards++; assert.equal(bodies.some(item => item.id === 'guarded'), false) } }), reported())
  assert.equal(guards, 1)
  assert.deepEqual(await call('failed-guard', { beforeRequest: async () => { throw new Error(providerDiagnostic) } }, 'transport', 0), { status: 'failed', usageSource: 'unavailable' })
  assert.deepEqual(await call('stalled-guard', { requestLimits: { ...limits, timeoutMs: 20 }, beforeRequest: () => new Promise(() => {}) }, 'timeout', 0), { status: 'failed', usageSource: 'unavailable' })

  scenarios.set('huge-response', { raw: '中'.repeat(22_000) })
  assert.equal((await call('huge-response', {}, 'response_too_large')).usageSource, 'unavailable')
  scenarios.set('redirect', { status: 307 })
  assert.equal((await call('redirect', {}, 'transport')).usageSource, 'unavailable')
  const controller = new AbortController()
  scenarios.set('held-abort', { hold: true })
  const abortArrived = waitArrival('held-abort')
  const abortEvents: GenerationRequestUsage[] = []
  const pendingAbort = api.generateText(`case:held-abort ${privateText}`, { ...options, signal: controller.signal, onRequestUsage: event => { assertMetadata(event); abortEvents.push(event) } })
  await abortArrived; controller.abort()
  await assert.rejects(pendingAbort, error => error instanceof BoundedGenerationError && error.code === 'cancelled')
  held.get('held-abort')!()
  await tick()
  assert.deepEqual(abortEvents, [{ status: 'failed', usageSource: 'unavailable' }])

  setConfig({ selectedModel: 'gpt-5.4', thinkingMode: 'effort', thinkingEffort: 'high' })
  await call('openai-thinking')
  assert.equal(bodies.at(-1)!.body.max_completion_tokens, 1200)
  assert.equal(bodies.at(-1)!.body.max_tokens, undefined)
  setConfig({ provider: 'qwen', selectedModel: 'qwen3.6-plus', thinkingMode: 'budget', thinkingBudget: 1199, proxyUrl: `${origin}/proxy/` })
  await call('qwen-thinking')
  assert.equal(bodies.at(-1)!.body.max_tokens + bodies.at(-1)!.body.thinking_budget, 1200)
  setConfig({ provider: 'qwen', selectedModel: 'qwen3.6-plus', thinkingMode: 'budget', thinkingBudget: 1200, proxyUrl: `${origin}/proxy/` })
  assert.equal((await call('qwen-invalid', {}, 'settings', 0)).usageSource, 'unavailable')

  for (const record of billing.getBillingRecords()) { assert.equal(record.content, ''); assert.equal(record.response, '') }
  assert.ok(![...storage.values()].some(value => value.includes(privateText) || value.includes(providerDiagnostic)))
  await tick()
  assert.deepEqual(unhandled, [])
  console.log(JSON.stringify({ adapter: 'production APIService → actual SDK → loopback HTTP server', loopbackRequests: bodies.length,
    externalRequests: 0, providers: ['OpenAI compatible', 'Anthropic', 'Google'],
    metadata: ['request-correlated', 'callback once', 'immutable and content-free', 'success/failed', 'reported/estimated/unavailable', 'safe counts', 'partial counts stay unknown'],
    bounds: ['one attempt', '1200 output+thinking', '30 second maximum', '64 KiB maximum', 'no stream/tools', 'fresh guard', 'redirect rejected', 'held abort'],
    qualityClaims: 'none; synthetic transport tests, not model-quality evidence' }, null, 2))
  console.log('PASS writer-agent request-correlated transport usage')
} finally {
  globalThis.fetch = oldFetch
  process.removeListener('unhandledRejection', onUnhandled)
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
}
