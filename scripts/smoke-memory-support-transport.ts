/** Actual SDK/adapter checks. Every HTTP destination is explicitly mocked; no keys or live calls. */
import assert from 'node:assert/strict'
import type { ApiConfig, GenerateOptions } from '../src/types/api'
import { BoundedGenerationError, createBoundedRequestScope, type BoundedGenerationErrorCode } from '../src/services/aiRequestLimits'

const disk = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => disk.get(key) ?? null,
  setItem: (key: string, value: string) => void disk.set(key, value),
  removeItem: (key: string) => void disk.delete(key), clear: () => disk.clear(),
} })
const { useApiConfig } = await import('../src/services/apiConfig')
const api = (await import('../src/services/api')).default
const billing = (await import('../src/services/billing')).default
const { loadAISDK, resolveLanguageModel } = await import('../src/services/aiProviders')
const limits = { maxAttempts: 1 as const, maxResponseBytes: 65_536, timeoutMs: 30_000, omitUsageContent: true as const }
const options: GenerateOptions = { maxTokens: 1200, temperature: 0.1, requestLimits: limits, type: 'memory-support-transport-test' }
const secret = 'synthetic-private-key-and-raw-manuscript'
const prompt = 'synthetic-private-question-and-selected-excerpts'
const reply = 'synthetic-model-assessment'
const encoder = new TextEncoder()
const base: ApiConfig = {
  provider: 'custom', baseURL: 'https://bounded-provider.invalid/v1', apiKey: 'mock-key-not-a-real-key',
  selectedModel: 'mock-chat', temperature: 0.7, maxTokens: null, unlimitedTokens: true,
  thinkingMode: 'default', thinkingProtocol: 'auto', thinkingBudget: 4096, thinkingEffort: 'high',
  customHeaders: {}, proxyUrl: '',
}
let expectedUrl = `${base.baseURL}/chat/completions`
let calls = 0
let lastInit: RequestInit | undefined
let lastBody: any
let mock: (init?: RequestInit) => Promise<Response> = async () => compatible()
const oldFetch = globalThis.fetch
const unhandled: unknown[] = []
const onUnhandled = (error: unknown) => { unhandled.push(error) }
process.on('unhandledRejection', onUnhandled)
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  assert.equal(url, expectedUrl, 'Reject every unmocked destination, including redirects, tools and model probes')
  assert.equal(init?.method, 'POST')
  calls++
  lastInit = init
  lastBody = JSON.parse(String(init?.body))
  return mock(init)
}
function setConfig(patch: Partial<ApiConfig> = {}, url = `${base.baseURL}/chat/completions`) {
  useApiConfig().updateConfig({ ...base, ...patch })
  expectedUrl = url
}
function compatible(reasoning = '', finishReason = 'stop'): Response {
  return json({ id: 'mock', object: 'chat.completion', created: 1, model: 'mock-chat',
    choices: [{ index: 0, finish_reason: finishReason, message: { role: 'assistant', content: reply, reasoning_content: reasoning } }],
    usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26, completion_tokens_details: { reasoning_tokens: 3 } },
  })
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}
function stream(bytes: Uint8Array, headers: Record<string, string> = {}, status = 200): Response {
  let offset = 0
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset >= bytes.length) controller.close()
    else { controller.enqueue(bytes.slice(offset, offset + 97)); offset += 97 }
  } }), { status, headers: { 'content-type': 'application/json', ...headers } })
}
function verifySafe(error: unknown, code?: BoundedGenerationErrorCode): boolean {
  assert.ok(error instanceof BoundedGenerationError)
  if (code) assert.equal(error.code, code)
  assert.ok(!JSON.stringify(error).includes(secret))
  assert.ok(!error.stack?.includes(secret))
  assert.equal('cause' in error, false)
  return true
}
async function fails(code: BoundedGenerationErrorCode, patch: GenerateOptions = {}, dispatched = 1) {
  const before = calls
  await assert.rejects(api.generateText(prompt, { ...options, ...patch }), error => verifySafe(error, code))
  assert.equal(calls - before, dispatched, 'Failure cannot cause a retry, repair, fallback or model-list probe')
}
function assertUsage(status = 'success') {
  const record = billing.getBillingRecords()[0]!
  assert.equal(record.content, '')
  assert.equal(record.response, '')
  assert.equal(record.inputTokens, 17)
  assert.equal(record.outputTokens, 9)
  assert.equal(record.usageSource, 'reported')
  assert.equal(record.status, status)
  assert.ok(!JSON.stringify(record).includes('private'))
  assert.ok(!JSON.stringify(record).includes('reasoning-only-canary'))
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

try {
  setConfig()
  // This is the first actual SDK import; cancellation cannot dispatch after lazy setup.
  const lazyAbort = new AbortController()
  const lazy = api.generateText(prompt, { ...options, signal: lazyAbort.signal })
  lazyAbort.abort(new Error(secret))
  await assert.rejects(lazy, error => verifySafe(error, 'cancelled'))
  assert.equal(calls, 0)
  await loadAISDK()

  let guards = 0
  mock = async init => {
    assert.equal(guards, 1, 'guard completed immediately before HTTP')
    assert.equal(init?.redirect, 'error')
    assert.equal(lastBody.max_tokens, 1200, 'explicit bound overrides global unlimited defaults')
    assert.equal(lastBody.tools, undefined)
    assert.equal(lastBody.stream, undefined)
    return compatible('reasoning-only-canary')
  }
  assert.equal(await api.generateText(prompt, { ...options, beforeRequest: async () => { guards++ } }), reply)
  assertUsage()
  assert.equal(calls, 1)
  const exactQuote = '原文\u0000\u0008\u007f\u0085\u009f\n𠮷'
  const exactPrompt = JSON.stringify({ version: 1, question: '问题', sources: [{ reference: 1, quote: exactQuote }] })
  mock = async () => compatible()
  await api.generateText(exactPrompt, { ...options, system: 'fixed-system\u0085' })
  const wireMessages = lastBody.messages as Array<{ role: string; content: string }>
  assert.equal(wireMessages.find(message => message.role === 'system')!.content, 'fixed-system\u0085')
  assert.equal(JSON.parse(wireMessages.find(message => message.role === 'user')!.content).sources[0].quote, exactQuote,
    'bounded transport must not sanitize or silently alter the exact selected source payload')
  console.log('✓ Actual SDK uses one guarded dispatch, no tools, explicit output cap and content-free reported usage')

  mock = async () => compatible()
  await fails('transport', { beforeRequest: async () => { throw new Error(secret) } }, 0)
  await fails('timeout', { requestLimits: { ...limits, timeoutMs: 20 }, beforeRequest: () => new Promise(() => {}) }, 0)
  const guardAbort = new AbortController()
  const guarded = api.generateText(prompt, { ...options, signal: guardAbort.signal, beforeRequest: async () => {
    guardAbort.abort(new Error(secret))
    throw new Error(secret)
  } })
  await assert.rejects(guarded, error => verifySafe(error, 'cancelled'))
  assert.equal(calls, 2)

  for (const status of [401, 403, 429, 500, 503]) {
    mock = async () => json({ error: { message: secret, type: 'server_error' } }, status)
    await fails('transport')
  }
  mock = async () => new Response(`{"bad": ${secret}`, { headers: { 'content-type': 'application/json' } })
  await fails('transport')
  mock = async () => { throw new Error(secret) }
  await fails('transport')
  for (const status of [301, 302, 307, 308]) {
    mock = async () => new Response('', { status, headers: { location: 'https://unmocked.invalid/stolen' } })
    await fails('redirect')
    assert.equal(lastInit?.redirect, 'error')
  }
  console.log('✓ Failed guards make zero calls; authentication/rate-limit/server/JSON/network/redirect failures never retry or expose diagnostics')

  const skeleton = await compatible('').text()
  const exact = await compatible('x'.repeat(limits.maxResponseBytes - encoder.encode(skeleton).byteLength)).text()
  assert.equal(encoder.encode(exact).byteLength, limits.maxResponseBytes)
  mock = async () => stream(encoder.encode(exact))
  assert.equal(await api.generateText(prompt, options), reply)
  assertUsage()
  for (const headers of [{}, { 'content-length': '1' }, { 'content-length': '65536' }]) {
    mock = async () => stream(encoder.encode(exact + ' '), headers)
    await fails('response_too_large')
  }
  // Multi-byte decoded data, not character count or compressed Content-Length.
  mock = async () => stream(encoder.encode('中'.repeat(22_000)), { 'content-length': '10', 'content-encoding': 'gzip' })
  await fails('response_too_large')
  for (const status of [401, 429, 503]) {
    mock = async () => stream(encoder.encode('x'.repeat(65_537)), {}, status)
    await fails('response_too_large')
  }
  let cancelledDeclared = false
  mock = async () => new Response(new ReadableStream({ cancel() { cancelledDeclared = true } }), { headers: { 'content-length': '65537' } })
  await fails('response_too_large')
  assert.ok(cancelledDeclared, 'oversized declaration cancels without waiting on an unresponsive body')
  let pulls = 0
  mock = async () => new Response(new ReadableStream({ pull(controller) {
    if (++pulls === 1) controller.enqueue(encoder.encode('{"partial":'))
    else controller.error(new Error(secret))
  } }))
  await fails('transport')
  console.log('✓ Exact decoded-byte limit passes; one-over, lying/missing lengths, compressed/multibyte bodies, oversized error bodies and broken streams fail before SDK parsing')

  let bodyCancelled = false
  mock = async () => new Response(new ReadableStream({
    pull: () => new Promise(() => {}),
    cancel() { bodyCancelled = true; return new Promise(() => {}) },
  }))
  await fails('timeout', { requestLimits: { ...limits, timeoutMs: 20 } })
  assert.ok(bodyCancelled, 'stalled body reader is cancelled without awaiting its ignored cancellation')
  mock = () => new Promise(() => {})
  await fails('timeout', { requestLimits: { ...limits, timeoutMs: 20 } })

  let releaseFetch!: (response: Response) => void
  const abortFetch = new AbortController()
  let fetchStarted!: () => void
  const started = new Promise<void>(resolve => { fetchStarted = resolve })
  mock = () => { fetchStarted(); return new Promise(resolve => { releaseFetch = resolve }) }
  const late = api.generateText(prompt, { ...options, signal: abortFetch.signal })
  await started
  abortFetch.abort(new Error(secret))
  await assert.rejects(late, error => verifySafe(error, 'cancelled'))
  let lateBodyCancelled = false
  releaseFetch(new Response(new ReadableStream({ cancel() { lateBodyCancelled = true } })))
  await tick()
  assert.ok(lateBodyCancelled, 'late ignored-abort response is discarded and its body canceled')

  const syncAbort = new AbortController()
  mock = async () => { syncAbort.abort(new Error(secret)); throw new Error(secret) }
  await fails('cancelled', { signal: syncAbort.signal })
  await tick()
  assert.deepEqual(unhandled, [], 'synchronous fetch abort plus rejection is still observed')

  const oldNow = performance.now.bind(performance)
  let clockOffset = 0
  Object.defineProperty(performance, 'now', { configurable: true, value: () => oldNow() + clockOffset })
  try {
    mock = async () => compatible()
    await fails('timeout', { beforeRequest: async () => { clockOffset = 31_000 } }, 0)
  } finally { Reflect.deleteProperty(performance, 'now') }
  console.log('✓ Timeouts and aborts settle despite ignored signals/stalled fetch/read/cancel; monotonic boundary checks reject delayed dispatch')

  mock = async () => compatible('reasoning-only-canary', 'length')
  await fails('output_incomplete')
  assertUsage('failed')
  for (const finish of ['content_filter', 'tool_calls', 'unknown_finish']) {
    mock = async () => compatible('', finish)
    await fails('output_incomplete')
  }
  for (const invalid of [
    { ...limits, maxAttempts: 2 }, { ...limits, maxResponseBytes: 0 }, { ...limits, maxResponseBytes: 65_537 },
    { ...limits, maxResponseBytes: 2.5 }, { ...limits, maxResponseBytes: NaN },
    { ...limits, timeoutMs: 0 }, { ...limits, timeoutMs: 30_001 }, { ...limits, omitUsageContent: false },
  ]) await fails('invalid_limits', { requestLimits: invalid as any }, 0)
  for (const maxTokens of [undefined, null, 0, 1201, Infinity, 1.5]) await fails('settings', { maxTokens }, 0)
  await fails('settings', { extensions: {} as any }, 0)
  await fails('settings', { preparedExtensions: {} as any }, 0)
  await fails('settings', { messages: [] }, 0)
  const beforeStream = calls
  await assert.rejects(api.generateTextStream(prompt, options), error => verifySafe(error, 'invalid_limits'))
  assert.equal(calls, beforeStream)
  console.log('✓ Truncated/filtered/tool/incomplete output stays failed with usage preserved; invalid limits/extensions/streaming fail closed before dispatch')

  mock = async () => compatible()
  const scope = createBoundedRequestScope(limits)
  try {
    const model = await resolveLanguageModel(useApiConfig().activeConfig.value, undefined, scope)
    const sdk = await loadAISDK()
    await sdk.generateText({ model, prompt, maxRetries: 0, maxOutputTokens: 1200 })
    const beforeSecond = calls
    await assert.rejects(sdk.generateText({ model, prompt, maxRetries: 0, maxOutputTokens: 1200 }))
    assert.equal(calls, beforeSecond, 'per-model transport ledger independently prevents a second SDK dispatch')
  } finally { scope.close() }

  setConfig({ selectedModel: 'gpt-5.4', thinkingMode: 'effort', thinkingEffort: 'high' })
  assert.equal(await api.generateText(prompt, options), reply)
  assert.equal(lastBody.max_completion_tokens, 1200)
  assert.equal(lastBody.max_tokens, undefined)
  assert.equal(lastBody.reasoning_effort, 'high')
  assert.equal(lastBody.temperature, undefined)
  setConfig({ provider: 'anthropic', baseURL: 'https://native-anthropic.invalid/v1', selectedModel: 'claude-sonnet-4-5', thinkingMode: 'budget', thinkingBudget: 1024 }, 'https://native-anthropic.invalid/v1/messages')
  mock = async () => json({ id: 'mock', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5',
    content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 17, output_tokens: 9 } })
  assert.equal(await api.generateText(prompt, options), reply)
  assert.equal(lastBody.max_tokens, 1200, 'native SDK adds thinking within, not above, total ceiling')
  assert.deepEqual(lastBody.thinking, { type: 'enabled', budget_tokens: 1024 })
  setConfig({ provider: 'anthropic', selectedModel: 'claude-sonnet-4-5', thinkingMode: 'budget', thinkingBudget: 1200 }, 'https://bounded-provider.invalid/v1/messages')
  await fails('settings', {}, 0)

  setConfig({ provider: 'google', selectedModel: 'gemini-2.5-flash', thinkingMode: 'budget', thinkingBudget: 1024, proxyUrl: 'https://fixture-proxy.invalid/' }, 'https://fixture-proxy.invalid/https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
  mock = async () => json({ candidates: [{ content: { role: 'model', parts: [{ text: reply }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 17, candidatesTokenCount: 9, totalTokenCount: 26 } })
  assert.equal(await api.generateText(prompt, options), reply)
  assert.equal(lastBody.generationConfig.maxOutputTokens, 1200)
  assert.equal(lastBody.generationConfig.thinkingConfig.thinkingBudget, 1024)
  assertUsage()

  const qwenUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
  setConfig({ provider: 'qwen', selectedModel: 'qwen3.6-plus', thinkingMode: 'budget', thinkingBudget: 1199 }, qwenUrl)
  mock = async () => compatible()
  assert.equal(await api.generateText(prompt, options), reply)
  assert.equal(lastBody.thinking_budget, 1199)
  assert.equal(lastBody.max_tokens, 1)
  assert.equal(lastBody.thinking_budget + lastBody.max_tokens, 1200)
  for (const thinkingBudget of [1200, 1201]) {
    setConfig({ provider: 'qwen', selectedModel: 'qwen3.6-plus', thinkingMode: 'budget', thinkingBudget }, qwenUrl)
    await fails('settings', {}, 0)
  }
  for (const thinkingMode of ['default', 'enabled'] as const) {
    setConfig({ provider: 'qwen', selectedModel: 'qwen3.6-plus', thinkingMode }, qwenUrl)
    await fails('settings', {}, 0)
  }
  setConfig({ provider: 'qwen', selectedModel: 'qwen3.6-plus', thinkingMode: 'disabled' }, qwenUrl)
  assert.equal(await api.generateText(prompt, options), reply)
  assert.equal(lastBody.max_tokens, 1200)
  assert.equal(lastBody.enable_thinking, false)
  setConfig({ provider: 'qwen', selectedModel: 'qwen3.6-plus', thinkingMode: 'budget', thinkingBudget: 4096 }, qwenUrl)
  assert.equal(await api.generateText(prompt, { maxTokens: 2048 }), reply)
  assert.equal(lastBody.thinking_budget, 4096, 'ordinary Qwen separate budget is unchanged')
  assert.equal(lastBody.max_tokens, 2048)
  assert.equal(lastInit?.redirect, undefined)
  assert.equal(billing.getBillingRecords()[0]!.content, prompt, 'ordinary usage logging is unchanged')
  console.log('✓ Compatible, native Anthropic/Google and proxied routes keep model-specific ceilings; bounded Qwen combines budgets or blocks while ordinary behavior is unchanged')

  setConfig()
  let remainingFailures = 1
  mock = async () => remainingFailures-- > 0 ? new Response(JSON.stringify({ error: { message: 'retry fixture' } }), {
    status: 503, headers: { 'content-type': 'application/json', 'retry-after': '0' },
  }) : compatible()
  const beforeOrdinary = calls
  assert.equal(await api.generateText(prompt, { maxTokens: 1200 }), reply)
  assert.equal(calls - beforeOrdinary, 2, 'ordinary SDK retry defaults remain in place')
  await tick()
  assert.deepEqual(unhandled, [], 'late ignored operations and body failures must have rejection handlers')
  console.log('Memory support transport bounds passed (real SDK, mocked HTTP only; zero paid/model/provider calls)')
} finally {
  globalThis.fetch = oldFetch
  process.removeListener('unhandledRejection', onUnhandled)
}
