/** Pure Node regression for the actual browser probe. Native browser APIs are
 * strict-receiver simulations; this is NOT browser acceptance. No Playwright,
 * browser process, Worker, HTTP socket, real model or credential discovery. */
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { installWriterAgentProbe } from './fixtures/writer-agent-browser-probe.mjs'
import { classifyWriterAgentPhase } from './fixtures/writer-agent-browser-observation.mjs'

// Any SDK fallback outside the supplied simulated native fetch must fail closed.
globalThis.fetch = () => { throw new Error('Real network is forbidden in the probe smoke') }
const origin = 'http://127.0.0.1:18231'
class UnusedObjectStore { get() { throw new Error('Unexpected IDB') } put() { throw new Error('Unexpected IDB') } }
class UnusedDatabase { transaction() { throw new Error('Unexpected IDB') } }
class UnusedTransaction { set oncomplete(callback) { this.callback = callback } get oncomplete() { return this.callback } }
class UnusedStorage { setItem() { throw new Error('Unexpected storage') } getItem() { return null } }
class UnusedWorker { constructor() { throw new Error('Unexpected Worker') } }
class ObserverShell { observe() {} }
function install(source = installWriterAgentProbe.toString()) {
  const context = vm.createContext({
    IDBObjectStore: UnusedObjectStore, IDBDatabase: UnusedDatabase, IDBTransaction: UnusedTransaction,
    Storage: UnusedStorage, localStorage: new UnusedStorage(), Worker: UnusedWorker, MutationObserver: ObserverShell,
    document: { querySelector() { return null } }, navigator: { clipboard: {} },
    URL, Response, ReadableStream, TextEncoder, nativeFetchCalls: [], nativeClipboardRequests: [],
    nextResponse: () => Promise.resolve(new Response('{}')),
  })
  // Node's own fetch accepts an arbitrary receiver. Model Window's stricter
  // receiver rule explicitly, so losing bind/call cannot silently pass again.
  vm.runInContext(`globalThis.fetch = function (input, init) {
    'use strict';
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    nativeFetchCalls.push({ input, init });
    return nextResponse();
  };
  navigator.clipboard.writeText = function (value) {
    'use strict';
    if (this !== navigator.clipboard) throw new TypeError('Invalid clipboard receiver');
    return new Promise((resolve, reject) => nativeClipboardRequests.push({ value, resolve, reject }));
  };`, context)
  vm.runInContext(`(${source})({ providerOrigin: ${JSON.stringify(origin)} })`, context)
  context.__writerAgentProbe.reset('synthetic-draft')
  return context
}
const results = []
const pass = name => results.push(name)
const context = install(), probe = context.__writerAgentProbe, observedFetch = context.fetch

// A targeted old-bug mutation must fail before dispatch, not pass this fixture.
const oldReceiverSource = installWriterAgentProbe.toString().replace('fetch: globalThis.fetch.bind(globalThis)', 'fetch: globalThis.fetch')
assert.notEqual(oldReceiverSource, installWriterAgentProbe.toString())
const old = install(oldReceiverSource)
await assert.rejects(old.fetch(`${origin}/v1/chat/completions`, { method: 'POST' }), error => error.name === 'TypeError' && error.message === 'Illegal invocation')
assert.equal(old.nativeFetchCalls.length, 0)
pass('regression sensitivity: original unbound fetch fails before native dispatch')

const bytes = new TextEncoder().encode('{"reply":"铜铃"}')
const signal = new AbortController().signal
const init = { method: 'POST', body: 'synthetic-request', signal, redirect: 'error', headers: { 'Content-Type': 'application/json' } }
const nativeResponse = new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 5)); controller.enqueue(bytes.slice(5)); controller.close() } }), { status: 200 })
context.nextResponse = () => Promise.resolve(nativeResponse)
probe.afterEof = { ordinal: 1, arm: { kind: 'source-complete', label: 'actual-eof' } }
const response = await observedFetch(`${origin}/v1/chat/completions`, init)
assert.equal(context.nativeFetchCalls.length, 1)
assert.equal(context.nativeFetchCalls[0].input, `${origin}/v1/chat/completions`)
assert.equal(context.nativeFetchCalls[0].init, init)
assert.equal(context.nativeFetchCalls[0].init.signal, signal)
assert.equal(response, nativeResponse)
assert.equal(probe.eof, 0)
pass('fetch retains native receiver and exact input/init/signal/response identity')
const reader = response.body.getReader()
const firstChunk = await reader.read(), secondChunk = await reader.read()
assert.equal(firstChunk.done, false); assert.equal(secondChunk.done, false)
assert.equal(probe.eof, 0); assert.equal(probe.rules.length, 0)
const lastChunk = await reader.read()
assert.equal(lastChunk.done, true); assert.equal(probe.eof, 1)
assert.equal(probe.rules[0].label, 'actual-eof')
assert.equal(probe.events.find(event => event.kind === 'http-reader-eof').bytes, bytes.byteLength)
await reader.read(); assert.equal(probe.eof, 1)
pass('real stream chunks forward unchanged; EOF hook fires once after complete consumption')
const unrelatedResponse = new Response('unrelated')
context.nextResponse = () => Promise.resolve(unrelatedResponse)
const unrelated = await observedFetch(new URL('http://127.0.0.1:18232/asset'), { method: 'GET' })
assert.equal(unrelated, unrelatedResponse)
assert.equal(await unrelated.text(), 'unrelated'); assert.equal(probe.eof, 1)
pass('non-provider fetch preserves response without false model EOF')
const rejection = new TypeError('Synthetic network failure')
context.nextResponse = () => Promise.reject(rejection)
await assert.rejects(observedFetch(`${origin}/v1/chat/completions`, init), error => error === rejection)
assert.equal(probe.eof, 1)
pass('native rejection propagates the original error without invented HTTP success')

// The installed SDK exercises the same compatible wire serializer and response
// parser as production; its fetch remains a strict simulated native function.
const { generateText } = await import('ai')
const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
const answer = '{"version":1,"outcome":"needs_author_input"}'
const envelope = { id: 'synthetic-probe', object: 'chat.completion', created: 1, model: 'writer-agent-browser-fixture', choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }], usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 } }
context.nextResponse = () => Promise.resolve(new Response(JSON.stringify(envelope), { headers: { 'Content-Type': 'application/json' } }))
const model = createOpenAICompatible({ name: 'custom', baseURL: `${origin}/v1`, apiKey: 'synthetic-placeholder-not-a-credential', fetch: observedFetch }).chatModel('writer-agent-browser-fixture')
const payload = { brief: '合成方向', tail: '合成结尾' }, beforeSdk = context.nativeFetchCalls.length
const result = await generateText({ model, system: 'Synthetic protocol-only test.', prompt: JSON.stringify(payload), maxOutputTokens: 1200, maxRetries: 0 })
assert.equal(context.nativeFetchCalls.length, beforeSdk + 1)
assert.equal(result.text, answer); assert.equal(result.finishReason, 'stop')
const wire = JSON.parse(context.nativeFetchCalls.at(-1).init.body)
assert.deepEqual(JSON.parse(wire.messages.find(message => message.role === 'user').content), payload)
assert.equal(wire.max_tokens, 1200); assert.equal(wire.tools, undefined); assert.notEqual(wire.stream, true)
assert.equal(result.usage.totalTokens, 110); assert.equal(probe.eof, 2)
pass('installed SDK wire/response/usage traverses actual probe with one dispatch and EOF')

assert.equal(probe.clipboardAvailable, true)
const firstText = '原生成功：铜铃 <木门> &。'
let firstSettled = false
const first = context.navigator.clipboard.writeText(firstText)
void first.then(() => { firstSettled = true })
await Promise.resolve()
assert.equal(context.nativeClipboardRequests.length, 1)
assert.equal(probe.clipboardRequests, 1); assert.equal(probe.clipboardCompletion, null)
assert.equal(probe.clipboard, ''); assert.equal(firstSettled, false)
assert.equal(probe.events.filter(event => event.kind === 'clipboard-write').length, 0)
pass('deferred clipboard stays pending with no fabricated text or completion')
context.nativeClipboardRequests[0].resolve()
await first
assert.equal(firstSettled, true); assert.equal(probe.clipboard, firstText)
assert.equal(probe.clipboardCompletion.requestId, 1); assert.equal(probe.clipboardCompletion.status, 'fulfilled')
await first
assert.equal(context.nativeClipboardRequests.length, 1)
assert.equal(probe.events.filter(event => event.kind === 'clipboard-write').length, 1)
pass('clipboard success preserves exact text and records completion once')
const secondText = '第二次原生文本'
const second = context.navigator.clipboard.writeText(secondText)
await Promise.resolve()
assert.equal(probe.clipboardRequests, 2); assert.equal(probe.clipboardCompletion.requestId, 1)
assert.notEqual(probe.clipboardCompletion.requestId, probe.clipboardRequests); assert.equal(probe.clipboard, firstText)
context.nativeClipboardRequests[1].resolve(); await second
assert.equal(probe.clipboardCompletion.requestId, 2); assert.equal(probe.clipboardCompletion.status, 'fulfilled')
assert.equal(probe.clipboard, secondText)
pass('consecutive copy waits for its own request instead of consuming old completion')
const rejectedText = '这个失败入参不得伪装已复制'
const third = context.navigator.clipboard.writeText(rejectedText)
const rejectedWrite = assert.rejects(third, error => error.name === 'NotAllowedError')
assert.equal(probe.clipboardRequests, 3); assert.equal(probe.clipboardCompletion.requestId, 2)
context.nativeClipboardRequests[2].reject(Object.assign(new Error('Synthetic native denial'), { name: 'NotAllowedError' }))
await rejectedWrite
assert.equal(probe.clipboardCompletion.requestId, 3); assert.equal(probe.clipboardCompletion.status, 'rejected')
assert.equal(probe.clipboardCompletion.errorName, 'NotAllowedError'); assert.equal(probe.clipboard, secondText)
assert.notEqual(probe.clipboard, rejectedText)
assert.equal(probe.events.filter(event => event.kind === 'clipboard-write').length, 2)
assert.equal(probe.events.filter(event => event.kind === 'clipboard-write-failed').length, 1)
pass('clipboard rejection propagates and records failure without fabricating copied text')
const fourthText = '拒绝之后的新复制仍须等待'
const fourth = context.navigator.clipboard.writeText(fourthText)
await Promise.resolve()
assert.equal(probe.clipboardRequests, 4); assert.equal(probe.clipboardCompletion.requestId, 3)
assert.notEqual(probe.clipboardCompletion.requestId, probe.clipboardRequests); assert.equal(probe.clipboard, secondText)
context.nativeClipboardRequests[3].resolve(); await fourth
assert.equal(probe.clipboardCompletion.requestId, 4); assert.equal(probe.clipboardCompletion.status, 'fulfilled')
assert.equal(probe.clipboard, fourthText)
assert.deepEqual(Array.from(context.nativeClipboardRequests, request => request.value), [firstText, secondText, rejectedText, fourthText])
assert.deepEqual(Array.from(probe.events.filter(event => event.kind.startsWith('clipboard-write')), event => event.requestId), [1, 2, 3, 4])
pass('copy after rejection retains monotonic IDs and cannot reuse rejected completion')

for (const phase of [null, 'idle', 'previewed', 'planning', 'executing_retrieval_tool']) assert.equal(classifyWriterAgentPhase('awaiting_evidence', phase), 'pending')
assert.equal(classifyWriterAgentPhase('awaiting_evidence', 'awaiting_evidence'), 'ready')
for (const phase of ['failed', 'stale', 'cancelled', 'expired', 'needs_author_input']) {
  assert.equal(classifyWriterAgentPhase('awaiting_evidence', phase), 'terminal_mismatch')
  assert.equal(classifyWriterAgentPhase(phase, phase), 'ready')
}
pass('phase observer keeps legitimate planning/tool waits but immediately distinguishes terminal failure')
const sourceSha256 = createHash('sha256').update(await readFile(new URL('./fixtures/writer-agent-browser-probe.mjs', import.meta.url))).digest('hex')
console.log(JSON.stringify({ mode: 'Node VM/native simulations, not browser acceptance; zero network or Worker execution', sourceSha256, passed: results.length, results }, null, 2))
