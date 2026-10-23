/** Actual novel-scan adapter + SDK at intercepted HTTP boundary. Never opens a network socket. */
import assert from 'node:assert/strict'
import type { NovelScanGenerationRequest } from '../src/types/memoryNovelScan'
import { BoundedGenerationError } from '../src/services/aiRequestLimits'
import { buildNovelPrompt, parseNovelCandidateResponse, parseNovelCueResponse } from '../src/services/memory/novelScanProtocol'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)), removeItem: (key: string) => storage.delete(key),
} })
const { useApiConfig } = await import('../src/services/apiConfig')
useApiConfig().updateConfig({ provider: 'custom', baseURL: 'https://novel-transport.invalid/v1', apiKey: 'synthetic-placeholder-not-a-secret',
  selectedModel: 'novel-transport-fixture', unlimitedTokens: true, maxTokens: null, temperature: 0.9, customHeaders: {}, thinkingMode: 'default' })
const { generateNovelScan } = await import('../src/services/memory/novelScan')
const billing = (await import('../src/services/billing')).default
const quote = '沈砚把铜铃递给阿宁。原文\u0000\u0001\t\n"\\𠮷🙂不可被改写。'
const anchors = [{ chapterId: 'one', sourceRevision: 'a'.repeat(64), start: 0, end: quote.length, quote }]
const replies = {
  collect: JSON.stringify({ version: 1, cues: [{ kind: 'relation', keys: ['沈砚', '阿宁'], references: [1] }], saturated: false }),
  connect: JSON.stringify({ version: 1, candidates: [{ kind: 'relationship', source: { type: 'person', label: '沈砚' }, target: { type: 'person', label: '阿宁' }, predicate: '交付铜铃', origin: 'explicit', premises: [{ role: 'support', references: [1] }] }], saturated: false }),
}
let requests = 0, guards = 0, expectedRequest: NovelScanGenerationRequest
const calls: Array<{ phase: string; inputChars: number; inputBytes: number; responseBytes: number }> = []
const secret = 'raw-provider-diagnostic-must-not-escape'
function envelope(content: string, finishReason = 'stop') {
  return { id: 'novel-fixture', object: 'chat.completion', created: 1, model: 'novel-transport-fixture',
    choices: [{ index: 0, finish_reason: finishReason, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 } }
}
const response = (content: string, finish = 'stop') => new Response(JSON.stringify(envelope(content, finish)), { headers: { 'content-type': 'application/json' } })
let mock: (init: RequestInit) => Promise<Response> = async () => response(replies[expectedRequest.phase])
globalThis.fetch = async (input, init) => {
  assert.equal(String(input), 'https://novel-transport.invalid/v1/chat/completions', 'No fallback, discovery, proxy, tool or external destination')
  assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error')
  assert.ok(init?.signal instanceof AbortSignal)
  assert.equal(guards, requests + 1, 'Fresh guard runs immediately before each actual dispatch')
  requests++
  const body = JSON.parse(String(init.body))
  assert.equal(body.model, 'novel-transport-fixture'); assert.equal(body.max_tokens, 1200)
  assert.equal(body.temperature, 0.1); assert.equal(body.tools, undefined); assert.equal(body.stream, undefined)
  assert.deepEqual(body.messages, [{ role: 'system', content: expectedRequest.system }, { role: 'user', content: expectedRequest.prompt }])
  assert.equal(JSON.parse(body.messages[1].content).sources[0].quote, quote, 'Exact escaped original survives SDK adapter')
  const output = await mock(init)
  calls.push({ phase: expectedRequest.phase, inputChars: expectedRequest.system.length + expectedRequest.prompt.length,
    inputBytes: Buffer.byteLength(expectedRequest.system + expectedRequest.prompt), responseBytes: Number(output.headers.get('content-length')) || 0 })
  return output
}
function request(phase: 'collect' | 'connect' = 'collect', patch: Partial<NovelScanGenerationRequest> = {}) {
  const prompt = buildNovelPrompt(phase, anchors, phase === 'collect' ? [1] : [])
  expectedRequest = { phase, system: prompt.system, prompt: prompt.prompt, signal: new AbortController().signal,
    maxOutputTokens: 1200, timeoutMs: 30_000, beforeRequest: async () => { guards++ }, ...patch }
  return expectedRequest
}
async function fails(code: string, patch: Partial<NovelScanGenerationRequest> = {}, expectedCalls = 1) {
  const before = requests
  await assert.rejects(generateNovelScan(request('collect', patch)), error => {
    assert.ok(error instanceof BoundedGenerationError)
    assert.equal(error.code, code)
    assert.ok(!JSON.stringify(error).includes(secret) && !error.stack?.includes(secret))
    return true
  })
  assert.equal(requests - before, expectedCalls, 'Exactly zero/one attempts, never a repair or retry')
  guards = requests
}
for (const phase of ['collect', 'connect'] as const) {
  const raw = await generateNovelScan(request(phase))
  assert.equal(raw, replies[phase])
  if (phase === 'collect') assert.equal(parseNovelCueResponse(raw, anchors, [1]).cues.length, 1)
  else assert.equal(parseNovelCandidateResponse(raw, anchors).candidates.length, 1)
  const record = billing.getBillingRecords()[0]!
  assert.equal(record.content, ''); assert.equal(record.response, '')
  assert.equal(record.inputTokens, 17); assert.equal(record.outputTokens, 9)
}
mock = async () => new Response(JSON.stringify({ error: { message: secret } }), { status: 503, headers: { 'content-type': 'application/json' } })
await fails('transport')
mock = async () => new Response('', { status: 307, headers: { location: 'https://never-contact.invalid/' } })
await fails('redirect')
for (const status of [200, 429]) {
  mock = async () => new Response('中'.repeat(22_000), { status, headers: { 'content-length': '1' } })
  await fails('response_too_large')
}
mock = async () => response(replies.collect, 'length')
await fails('output_incomplete')
mock = async () => response(replies.collect)
await fails('transport', { beforeRequest: async () => { throw new Error(secret) } }, 0)
await fails('timeout', { timeoutMs: 20, beforeRequest: () => new Promise(() => {}) }, 0)
mock = () => new Promise(() => {})
await fails('timeout', { timeoutMs: 20 })
const controller = new AbortController()
let release!: (response: Response) => void, started!: () => void
const dispatched = new Promise<void>(resolve => { started = resolve })
mock = async () => { started(); return new Promise(resolve => { release = resolve }) }
const late = generateNovelScan(request('collect', { signal: controller.signal }))
await dispatched; controller.abort()
await assert.rejects(late, error => error instanceof BoundedGenerationError && error.code === 'cancelled')
let cancelledBody = false
release(new Response(new ReadableStream({ cancel() { cancelledBody = true } })))
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(cancelledBody, true, 'Late ignored-abort HTTP response is discarded and closed')
assert.equal(requests, 9)
assert.equal(calls.length, 8) // The intentionally never-settling fetch has no response record.
assert.ok(![...storage.values()].some(value => value.includes(quote) || value.includes(secret)), 'No manuscript/provider diagnostics in usage storage')
console.log(JSON.stringify({ adapter: 'production generateNovelScan → api bounded branch → actual SDK', httpMockCalls: requests,
  liveNetworkRequests: 0, phasesPassed: ['collect', 'connect'], cases: ['exact escaped prose', 'no tools/history/stream/retries', '1200 output cap', 'fresh dispatch guard', '503', 'redirect', 'oversized success/error', 'incomplete output', 'failed/stalled guard', 'stalled provider', 'late cancelled result'], usageContent: 'omitted' }, null, 2))
console.log('PASS novel-scan production HTTP adapter with zero live traffic')
