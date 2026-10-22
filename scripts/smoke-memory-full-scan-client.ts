/** No browser or network: actual client, controlled Worker and timers. */
import assert from 'node:assert/strict'
import { MemoryClient } from '../src/services/memory/client'
import type {
  MemoryFullScanDecision, MemoryFullScanHandle, MemoryFullScanPage, MemoryFullScanProgress,
  MemorySearchControls, MemorySearchResult, MemoryWorkerRequest, MemoryWorkerResponse,
} from '../src/types/memory'

class ControlledWorker {
  static instances: ControlledWorker[] = []
  onmessage: ((event: MessageEvent<MemoryWorkerResponse>) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  messages: MemoryWorkerRequest[] = []
  terminated = false
  constructor() { ControlledWorker.instances.push(this) }
  postMessage(message: MemoryWorkerRequest) {
    assert.equal(this.terminated, false)
    this.messages.push(structuredClone(message))
  }
  terminate() { this.terminated = true }
  deliver(message: MemoryWorkerResponse) { this.onmessage?.({ data: message } as MessageEvent<MemoryWorkerResponse>) }
  last() { return this.messages.at(-1)! }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
async function flush() { for (let step = 0; step < 30; step++) await Promise.resolve() }
const query = { text: '铜铃', throughChapterId: 'c1' }
const options = { fullScan: { maxCalls: 8, maxActiveMs: 65_000 }, embedding: {
  protocol: 'jina' as const, endpoint: 'https://synthetic.test/embed', apiKey: 'not-a-real-key', model: 'synthetic', dimensions: 2,
} }
const result: MemorySearchResult = {
  projectId: 'p1', fingerprint: 'fixture', query: query.text, throughChapterId: query.throughChapterId,
  hits: [], searchMs: 10, method: 'bm25+clues', diagnostics: {
    semantic: 'fallback', rerank: 'skipped', eligiblePassages: 10, embeddedPassages: 0,
    cachedPassages: 0, rerankedCandidates: 0, warnings: [],
  },
}
function progress(handle: MemoryFullScanHandle, overrides: Partial<MemoryFullScanProgress> = {}): MemoryFullScanProgress {
  return { ...handle, eligiblePassages: 10, cachedPassages: 0, missingPassages: 10, scoredPassages: 0,
    embeddedPassages: 0, scoredCachedPassages: 0, sourceChars: 100, attemptedSourceChars: 0,
    queryCalls: 0, passageCalls: 0, rerankCalls: 0, callsAttempted: 0, callsApproved: 8,
    activeMsUsed: 0, activeMsApproved: 65_000, coldEstimatedCalls: 2, currentEstimatedCalls: 2,
    expiresAt: Date.now() + 3_500_000, ...overrides,
  }
}
function continuation(p: MemoryFullScanProgress, grantId = 'author-start'): MemoryFullScanDecision {
  return { type: 'continue', sessionId: p.sessionId, generation: p.generation, grantId, addCalls: 0, addActiveMs: 0 }
}

const oldWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
const oldSetTimeout = globalThis.setTimeout
const oldClearTimeout = globalThis.clearTimeout
const timers = new Map<number, { delay: number; callback: () => void }>()
let timerSequence = 0
Object.defineProperty(globalThis, 'Worker', { configurable: true, value: ControlledWorker })
globalThis.setTimeout = ((callback: () => void, delay: number) => {
  const id = ++timerSequence; timers.set(id, { delay, callback }); return id
}) as unknown as typeof setTimeout
globalThis.clearTimeout = ((id: number) => { timers.delete(id) }) as unknown as typeof clearTimeout
const clients: MemoryClient[] = []
function setup(controls: MemorySearchControls = {}, beforeRemote?: () => Promise<void>) {
  const client = new MemoryClient(); clients.push(client)
  const search = client.search(query, options, beforeRemote, controls)
  const worker = ControlledWorker.instances.at(-1)!
  const start = worker.last()
  assert.equal(start.type, 'full-scan-start')
  if (start.type !== 'full-scan-start') throw new Error('No start')
  const p = progress(start.handle)
  const deliver = (state: MemoryFullScanPage['state'], overrides: Partial<MemoryFullScanProgress> = {}) => {
    const page = state === 'complete' ? { state, progress: { ...p, ...overrides }, result } : { state, progress: { ...p, ...overrides } }
    worker.deliver({ id: worker.last().id, ok: true, type: 'full-scan', page })
  }
  return { client, search, worker, start, p, deliver }
}
function rpcTimers() { return [...timers.values()].filter(timer => timer.delay === 90_000) }

try {
  {
    const decision = deferred<MemoryFullScanDecision>()
    const seen: MemoryFullScanProgress[] = []
    const t = setup({ onProgress: p => { seen.push(p) }, onPause: () => decision.promise })
    let settled = 0
    void t.search.then(() => { settled++ })
    assert.equal(t.worker.messages.length, 1, 'Planning must not request any provider authorization')
    assert.equal('controls' in t.start, false)
    assert.equal(JSON.stringify(t.start).includes('onPause'), false)
    t.deliver('ready'); await flush()
    assert.equal(rpcTimers().length, 0, 'Paused ready has no RPC timeout or pending provider request')
    assert.equal(settled, 0)
    assert.equal(seen.length, 1)
    decision.resolve(continuation(t.p)); await flush()
    const resume = t.worker.last()
    assert.equal(resume.type, 'full-scan-resume')
    if (resume.type !== 'full-scan-resume') throw new Error('No resume')
    assert.deepEqual(resume.grant, { ...t.start.handle, grantId: 'author-start', addCalls: 0, addActiveMs: 0 })
    t.deliver('page-complete', { callsAttempted: 1, scoredPassages: 8 }); await flush()
    assert.equal(t.worker.last().type, 'full-scan-advance')
    t.worker.deliver({ id: resume.id, ok: true, type: 'full-scan', page: { state: 'complete', progress: t.p, result } })
    await flush(); assert.equal(settled, 0, 'Late duplicate RPC cannot finalize a later page')
    t.deliver('complete', { callsAttempted: 2, scoredPassages: 10 }); await flush()
    assert.deepEqual(await t.search, result)
    assert.equal(settled, 1)
    t.deliver('complete'); await flush(); assert.equal(settled, 1)
    assert.equal(timers.size, 0)
    t.client.dispose()
    console.log('✓ One search Promise survives ready/paging, zero-add start, stale messages, and resolves exactly once')
  }
  {
    const t = setup()
    t.deliver('ready'); await flush()
    assert.equal(t.worker.last().type, 'full-scan-local', 'Missing callback must stop immediately, not auto-start or orphan a checkpoint')
    t.worker.deliver({ id: t.worker.last().id, ok: true, type: 'full-scan-local', handle: t.start.handle, result })
    assert.deepEqual(await t.search, result)
    assert.equal(t.worker.messages.some(m => m.type === 'full-scan-resume' || m.type === 'full-scan-advance'), false)
    t.client.dispose()
    const failure = setup({ onPause: () => { throw new Error('author callback failed') } })
    const rejection = assert.rejects(failure.search, /author callback failed/)
    failure.deliver('ready'); await rejection
    assert.equal(failure.worker.last().type, 'full-scan-cancel')
    failure.client.dispose()
    console.log('✓ Missing callback chooses local; throwing callback cancels without granting work')
  }
  for (const action of ['abort', 'new-search', 'sync', 'invalidate', 'dispose', 'expiry'] as const) {
    const gate = deferred<MemoryFullScanDecision>()
    const controller = new AbortController()
    const t = setup({ signal: controller.signal, onPause: () => gate.promise })
    const rejection = assert.rejects(t.search, /取消|替代|关闭|改变|过期/)
    t.deliver('ready'); await flush()
    assert.equal(rpcTimers().length, 0)
    let replacement: Promise<unknown> | undefined
    if (action === 'abort') controller.abort()
    if (action === 'new-search') replacement = t.client.search({ ...query, text: '另一查询' })
    if (action === 'sync') replacement = t.client.sync({ id: 'p2', title: 'changed', chapters: [], clues: [] })
    if (action === 'invalidate') t.client.invalidateSource()
    if (action === 'dispose') t.client.dispose()
    if (action === 'expiry') {
      const expiry = [...timers.values()].find(timer => timer.delay > 90_000)!
      assert.ok(expiry); expiry.callback()
    }
    const replacementRejection = replacement ? assert.rejects(replacement, /关闭/) : undefined
    await rejection
    const messageCount = t.worker.messages.length
    gate.resolve(continuation(t.p, 'late-author-answer')); await flush()
    assert.equal(t.worker.messages.length, messageCount, `${action}: late decision cannot revive or grant a session`)
    t.client.dispose(); await replacementRejection
    assert.equal(timers.size, 0)
  }
  console.log('✓ Every idle decision wait races abort/new query/sync/invalidate/dispose/absolute expiry')
  {
    const gate = deferred<void>()
    const controller = new AbortController()
    const t = setup({ signal: controller.signal, onProgress: async () => { await gate.promise }, onPause: p => continuation(p.progress) })
    const rejection = assert.rejects(t.search, /取消/)
    t.deliver('ready'); await flush()
    controller.abort(); await rejection
    const count = t.worker.messages.length
    gate.resolve(); await flush()
    assert.equal(t.worker.messages.length, count, 'A held progress callback cannot auto-resume after cancellation')
    t.client.dispose()
    const pendingStart = setup({ signal: new AbortController().signal })
    const pendingRejection = assert.rejects(pendingStart.search, /关闭/)
    pendingStart.client.dispose(); await pendingRejection
    pendingStart.worker.deliver({ id: pendingStart.start.id, ok: true, type: 'full-scan', page: { state: 'ready', progress: pendingStart.p } })
    await flush(); assert.equal(timers.size, 0)
    console.log('✓ Async progress and a late start response cannot outlive the logical search')
  }
  {
    const t = setup({ onPause: p => ({ ...continuation(p.progress), generation: p.progress.generation + 1 }) })
    const rejection = assert.rejects(t.search, /不属于当前会话/)
    t.deliver('ready'); await rejection
    assert.equal(t.worker.messages.some(message => message.type === 'full-scan-resume'), false)
    t.client.dispose()
  }
  {
    let guardCalls = 0
    const gate = deferred<void>()
    const t = setup({ onPause: p => continuation(p.progress) }, async () => { guardCalls++; await gate.promise })
    t.deliver('ready'); await flush()
    const requestId = t.worker.last().id
    const rpcTimer = rpcTimers()[0]
    const wrong = { ...t.start.handle, generation: t.start.handle.generation + 1 }
    t.worker.deliver({ id: requestId, ok: true, type: 'remote-check', guardId: 41, handle: wrong })
    assert.equal(guardCalls, 0)
    t.worker.deliver({ id: requestId, ok: true, type: 'remote-check', guardId: 41, handle: t.start.handle })
    t.worker.deliver({ id: requestId, ok: true, type: 'remote-check', guardId: 41, handle: t.start.handle })
    assert.equal(guardCalls, 1, 'A duplicate remote-check must not run a second guard')
    assert.equal(rpcTimers()[0], rpcTimer, 'Guard/progress activity never restarts the 90s RPC deadline')
    gate.resolve(); await flush()
    assert.deepEqual(t.worker.last(), { id: requestId, type: 'remote-ack', guardId: 41, ok: true, handle: t.start.handle })
    t.worker.deliver({ id: requestId, ok: true, type: 'full-scan', page: { state: 'complete', progress: { ...t.p, ...wrong }, result } })
    await flush(); assert.equal(rpcTimers().length, 1, 'Wrong-session final result cannot settle the active RPC')
    t.worker.deliver({ id: requestId, ok: true, type: 'full-scan', page: { state: 'complete', progress: t.p, result } })
    await t.search; t.client.dispose()
    const denied = setup({ onPause: p => continuation(p.progress) }, async () => { throw new Error('PRIVATE_SOURCE') })
    denied.deliver('ready'); await flush()
    const deniedId = denied.worker.last().id
    denied.worker.deliver({ id: deniedId, ok: true, type: 'remote-check', guardId: 42, handle: denied.start.handle })
    await flush()
    assert.deepEqual(denied.worker.last(), { id: deniedId, type: 'remote-ack', guardId: 42, ok: false, handle: denied.start.handle })
    assert.equal(JSON.stringify(denied.worker.messages).includes('PRIVATE_SOURCE'), false)
    const rejection = assert.rejects(denied.search, /source guard fatal/)
    denied.worker.deliver({ id: deniedId, ok: false, handle: denied.start.handle, error: 'source guard fatal' })
    await rejection
    assert.equal(denied.worker.messages.some(message => message.type === 'full-scan-local'), false)
    denied.client.dispose()
    console.log('✓ Guards, final results, and grants are request/session/generation-bound; source denial is fatal')
  }
  for (const failure of ['closed-running', 'closed-paused', 'message-error', 'timeout'] as const) {
    const gate = deferred<MemoryFullScanDecision>()
    const t = setup({ onPause: () => gate.promise })
    const rejection = assert.rejects(t.search, /进度已丢失/)
    if (failure === 'closed-paused') { t.deliver('ready'); await flush() }
    if (failure === 'timeout') rpcTimers()[0]!.callback()
    else if (failure === 'message-error') t.worker.onmessageerror?.()
    else t.worker.onerror?.()
    await rejection
    assert.equal(t.worker.terminated, true)
    const count = ControlledWorker.instances.length
    gate.resolve(continuation(t.p)); await flush()
    assert.equal(ControlledWorker.instances.length, count, 'Lost checkpoint must not silently restart')
    assert.equal(timers.size, 0)
    t.client.dispose()
  }
  console.log('✓ Worker death/undecodable messages/90s timeout reject active and paused searches, explicitly losing the checkpoint')
  {
    const client = new MemoryClient(); clients.push(client)
    for (let turn = 0; turn < 20; turn++) {
      const controller = new AbortController()
      const gate = deferred<MemoryFullScanDecision>()
      const promise = client.search({ ...query, text: `第${turn}次` }, options, undefined, { signal: controller.signal, onPause: () => gate.promise })
      const rejection = assert.rejects(promise, /取消/)
      const worker = ControlledWorker.instances.at(-1)!
      const request = worker.last()
      assert.equal(request.type, 'full-scan-start')
      if (request.type !== 'full-scan-start') throw new Error('No start')
      const p = progress(request.handle)
      worker.deliver({ id: request.id, ok: true, type: 'full-scan', page: { state: 'ready', progress: p } })
      await flush(); controller.abort(); await rejection
      const count = worker.messages.length
      gate.resolve(continuation(p)); await flush()
      assert.equal(worker.messages.length, count)
      assert.equal(timers.size, 0)
    }
    client.dispose()
    console.log('✓ Repeated scan/cancel/query changes leave no pending RPCs, callbacks, or revived grants')
  }
} finally {
  for (const client of clients) client.dispose()
  globalThis.setTimeout = oldSetTimeout
  globalThis.clearTimeout = oldClearTimeout
  if (oldWorker) Object.defineProperty(globalThis, 'Worker', oldWorker)
  else Reflect.deleteProperty(globalThis, 'Worker')
}

/** Exercise real worker cleanup/source ACKs with the actual engine and synthetic adapter. */
{
  let receive!: (event: MessageEvent<MemoryWorkerRequest>) => Promise<void>
  const messages: MemoryWorkerResponse[] = []
  const changes = new Set<() => void>()
  const host = {
    get onmessage() { return receive }, set onmessage(value: typeof receive) { receive = value },
    postMessage(message: MemoryWorkerResponse) { messages.push(message); for (const change of changes) change() },
  }
  Object.setPrototypeOf(host, globalThis)
  const oldSelf = Object.getOwnPropertyDescriptor(globalThis, 'self')
  const oldFetch = globalThis.fetch
  const originalTimeout = globalThis.setTimeout
  const originalClear = globalThis.clearTimeout
  const guardTimers = new Set<ReturnType<typeof setTimeout>>()
  Object.defineProperty(globalThis, 'self', { configurable: true, value: host })
  globalThis.setTimeout = ((callback: () => void, ms: number, ...args: unknown[]) => {
    const timer = originalTimeout(callback, ms, ...args)
    if (ms === 30_000) guardTimers.add(timer)
    return timer
  }) as typeof setTimeout
  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => { guardTimers.delete(timer); originalClear(timer) }) as typeof clearTimeout
  let attempts = 0
  globalThis.fetch = async (_url, init) => {
    attempts++
    const body = JSON.parse(String(init?.body)) as { input: string[] }
    return Response.json({ data: body.input.map((_, index) => ({ index, embedding: [1, 0] })) })
  }
  const send = (request: MemoryWorkerRequest) => receive({ data: request } as MessageEvent<MemoryWorkerRequest>)
  async function message(predicate: (message: MemoryWorkerResponse) => boolean) {
    for (let tries = 0; tries < 100; tries++) {
      const found = messages.find(predicate)
      if (found) return found
      await new Promise<void>(resolve => {
        const timer = originalTimeout(done, 10)
        function done() { originalClear(timer); changes.delete(done); resolve() }
        changes.add(done)
      })
    }
    throw new Error('Expected worker boundary was not reached')
  }
  const project = { id: 'worker-full-scan', title: 'Actual worker', chapters: [{ id: 'c1', title: '一', text: '铜铃藏在窗边。' }], clues: [] }
  const h1 = { sessionId: 'source-guard-fatal', generation: 1 }
  const h2 = { sessionId: 'held-source-guard', generation: 2 }
  try {
    await import('../src/services/memory/memory.worker')
    await send({ id: 1000, type: 'sync', project })
    await send({ id: 1001, type: 'full-scan-start', handle: h1, query, options, guardRemote: true })
    const ready = messages.find(m => m.id === 1001)
    assert.ok(ready?.ok && ready.type === 'full-scan' && ready.page.state === 'ready')
    assert.equal(attempts, 0)
    const running = send({ id: 1002, type: 'full-scan-resume', grant: { ...h1, grantId: 'start', addCalls: 0, addActiveMs: 0 } })
    const first = await message(m => m.id === 1002 && m.ok && m.type === 'remote-check')
    assert.ok(first.ok && first.type === 'remote-check')
    await send({ id: 1002, type: 'remote-ack', guardId: first.guardId, handle: { ...h1, generation: 99 }, ok: true })
    await flush(); assert.equal(attempts, 0, 'Wrong generation cannot approve source transport')
    await send({ id: 1002, type: 'remote-ack', guardId: first.guardId, handle: h1, ok: false })
    await running
    assert.ok(messages.some(m => m.id === 1002 && !m.ok && /校验失败/.test(m.error)))
    assert.equal(attempts, 0)
    assert.equal(guardTimers.size, 0)

    // A short approved active-time budget expires while its source guard is held.
    await send({ id: 1003, type: 'full-scan-start', handle: h2, query, options: { ...options, fullScan: { maxCalls: 8, maxActiveMs: 60 } }, guardRemote: true })
    const timed = send({ id: 1004, type: 'full-scan-resume', grant: { ...h2, grantId: 'timed-start', addCalls: 0, addActiveMs: 0 } })
    const held = await message(m => m.id === 1004 && m.ok && m.type === 'remote-check')
    assert.ok(held.ok && held.type === 'remote-check')
    await timed
    const paused = messages.find(m => m.id === 1004 && m.ok && m.type === 'full-scan')
    assert.ok(paused?.ok && paused.type === 'full-scan' && ['paused-budget', 'page-complete'].includes(paused.page.state))
    assert.equal(guardTimers.size, 0, 'A page deadline must release its detached guard and 30s timer')
    await send({ id: 1004, type: 'remote-ack', guardId: held.guardId, handle: h2, ok: true })
    assert.equal(attempts, 0, 'A held ACK after a page deadline cannot start an adapter')

    const resumed = send({ id: 1005, type: 'full-scan-resume', grant: { ...h2, grantId: 'grant-after-pause', addCalls: 0, addActiveMs: 65_000 } })
    const current = await message(m => m.id === 1005 && m.ok && m.type === 'remote-check')
    assert.ok(current.ok && current.type === 'remote-check')
    await send({ id: 1004, type: 'remote-ack', guardId: held.guardId, handle: h2, ok: true })
    await send({ id: 1006, type: 'full-scan-cancel', handle: h1 })
    assert.equal(attempts, 0)
    assert.ok(guardTimers.size > 0, 'Old cancellation/cleanup cannot clear a newer page guard')
    await send({ id: 1005, type: 'remote-ack', guardId: current.guardId, handle: h2, ok: true })
    const passage = await message(m => m.id === 1005 && m.ok && m.type === 'remote-check' && m.guardId !== current.guardId)
    assert.ok(passage.ok && passage.type === 'remote-check')
    assert.equal(attempts, 1)
    await send({ id: 1005, type: 'remote-ack', guardId: passage.guardId, handle: h2, ok: true })
    await resumed
    assert.ok(messages.some(m => m.id === 1005 && m.ok && m.type === 'full-scan' && m.page.state === 'complete'))
    assert.equal(attempts, 2)
    assert.equal(guardTimers.size, 0)
    await send({ id: 1010, type: 'full-scan-resume', grant: { ...h2, grantId: 'grant-after-pause', addCalls: 0, addActiveMs: 65_000 } })
    const replay = messages.find(m => m.id === 1010)
    assert.ok(replay?.ok && replay.type === 'full-scan' && replay.page.state === 'complete')
    assert.equal(replay.page.progress.callsApproved, 8, 'A time-only grant cannot reset or increase call approval')
    assert.equal(replay.page.progress.activeMsApproved, 65_060, 'Page transitions preserve additive cumulative time')
    assert.equal(attempts, 2, 'Duplicate identical grant must not issue another adapter call')

    const localHandle = { sessionId: 'local-without-rerank', generation: 3 }
    await send({ id: 1007, type: 'full-scan-start', handle: localHandle, query, options: {
      ...options, rerank: { endpoint: 'https://synthetic.test/rerank', apiKey: 'never-sent', model: 'synthetic' },
    }, guardRemote: true })
    const local = send({ id: 1008, type: 'full-scan-local', handle: localHandle })
    const localGuard = await message(m => m.id === 1008 && m.ok && m.type === 'remote-check')
    assert.ok(localGuard.ok && localGuard.type === 'remote-check')
    await send({ id: 1008, type: 'remote-ack', guardId: localGuard.guardId, handle: localHandle, ok: true })
    await local
    assert.equal(attempts, 2, 'Use-local source validation must not embed or rerank')
    const localResult = messages.find(m => m.id === 1008 && m.ok && m.type === 'full-scan-local')
    assert.ok(localResult?.ok && localResult.type === 'full-scan-local' && localResult.result.diagnostics.fullScan?.status === 'stopped-local')
    await send({ id: 1011, type: 'full-scan-start', handle: { sessionId: '', generation: 0 }, query, options })
    assert.ok(messages.some(m => m.id === 1011 && !m.ok), 'Malformed handle failure must not throw again during cleanup and leave an RPC hung')
    assert.equal(attempts, 2)
    console.log('✓ Actual Worker page timeout cleans guards; stale ACK/cancel cannot affect a newer page, duplicate grants are idempotent, and use-local never reranks')
  } finally {
    await send({ id: 1099, type: 'invalidate' })
    for (const timer of guardTimers) originalClear(timer)
    globalThis.fetch = oldFetch
    globalThis.setTimeout = originalTimeout
    globalThis.clearTimeout = originalClear
    if (oldSelf) Object.defineProperty(globalThis, 'self', oldSelf)
    else Reflect.deleteProperty(globalThis, 'self')
  }
}

/** Writer keeps a single prepare/sync/search, with UI controls outside snapshots. */
{
  const { MemoryIndex } = await import('../src/services/memory/engine')
  const { prepareWriterMemoryContext } = await import('../src/services/memory/writerContext')
  const index = new MemoryIndex()
  const project = { id: 'writer-control-test', title: 'Writer', chapters: [{ id: 'c1', title: '一', text: '铜铃藏在窗边。' }], clues: [] }
  let syncs = 0, searches = 0, guards = 0
  const gate = deferred<MemoryFullScanDecision>()
  const controller = new AbortController()
  const handle = { sessionId: 'writer-prepare', generation: 1 }
  const controls: MemorySearchControls = { onPause: () => gate.promise }
  const preparing = prepareWriterMemoryContext({ projectId: project.id, query: query.text, throughChapterId: 'c1', includeGraph: false, remote: options }, {
    readProject: async () => structuredClone(project), signal: controller.signal, searchControls: controls,
    client: {
      sync: source => { syncs++; return index.sync(source) },
      async search(q, remote, guard, passedControls) {
        searches++
        assert.equal(passedControls?.signal, controller.signal)
        assert.equal(passedControls?.onPause, controls.onPause)
        assert.equal('onPause' in remote!, false)
        const decision = await passedControls!.onPause!({ reason: 'ready', progress: progress(handle) })
        assert.equal(decision.type, 'continue')
        await guard!(); guards++
        // Synthetic integration returns normal local evidence after the held scan.
        return index.search(q)
      },
      invalidateSource: () => index.invalidateSource(),
    },
  })
  let completed = false
  void preparing.then(() => { completed = true })
  for (let turn = 0; turn < 100 && searches === 0; turn++) await new Promise(resolve => setTimeout(resolve, 1))
  assert.equal(searches, 1); assert.equal(completed, false)
  gate.resolve(continuation(progress(handle)))
  const prepared = await preparing
  assert.equal(syncs, 1); assert.equal(searches, 1); assert.equal(guards, 1)
  assert.ok(prepared.hits.length)
  assert.equal(prepared.prompt.includes('onPause'), false)
  assert.equal(prepared.prompt.includes('not-a-real-key'), false)
  assert.equal(prepared.prompt.includes('writer-prepare'), false)
  await prepared.assertFresh()
  console.log('✓ Writer controls propagate through its existing prepare once, without leaking callbacks, session state, or provider keys into generation')
}
