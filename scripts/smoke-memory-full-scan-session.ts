import assert from 'node:assert/strict'
import { FullSemanticScan, validateFullScanOptions } from '../src/services/memory/fullSemanticScan'
import { MemoryIndex } from '../src/services/memory/engine'
import type { FullScanRecord, FullScanScore } from '../src/services/memory/fullSemanticScan'
import type { MemoryFullScanPage, MemoryFullScanOptions, MemorySearchResult, MemoryRemoteOptions } from '../src/types/memory'

// Synthetic adapters only. These tests establish protocol/streaming behavior, not model quality.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const result = (top: readonly FullScanScore[]): MemorySearchResult => ({
  projectId: 'test', fingerprint: 'test', query: 'question', throughChapterId: 'last', searchMs: 0,
  method: 'bm25+clues+semantic', hits: top.map(item => ({
    id: item.id, score: item.score, projectId: 'test', chapterId: item.id, chapterTitle: 'test', ordinal: 1,
    revision: 'test', start: 0, end: 1, quote: 'x', kind: 'passage', label: '', reason: 'synthetic',
  })), diagnostics: {
    semantic: 'used', rerank: 'disabled', eligiblePassages: 0, embeddedPassages: 0,
    cachedPassages: 0, rerankedCandidates: 0, warnings: [],
  },
})
let identity = 0
function fixture(count: number, options: Partial<MemoryFullScanOptions> = {}, cache = new Map<string, Float32Array>()) {
  const handle = { sessionId: `session-${++identity}`, generation: identity }
  const records = Array.from({ length: count }, (_, i) => ({ id: `id-${String(i).padStart(5, '0')}`, quote: `passage-${i}` }))
  const calls: { task: string; texts: string[] }[] = []
  let current = true
  let now: (() => number) | undefined
  let wall = Date.now()
  let before: ((task: string, texts: string[]) => Promise<void>) | undefined
  let malformed = false
  let sourceChecks = 0
  let checkSources: ((count: number, records: readonly FullScanRecord[]) => void) | undefined
  let top: readonly FullScanScore[] = []
  const vector = (text: string) => text === 'question' ? [1, 0, 0]
    : [1, Number(text.slice('passage-'.length)) % 17, 1]
  const scan = new FullSemanticScan({
    handle, options: { maxCalls: 160, maxActiveMs: 65_000, ...options }, records, query: 'question',
    dimensions: 3, topK: 32, rerank: false, preparedMs: 0, createdAt: wall,
    now: () => now ? now() : performance.now(), wallNow: () => wall,
    assertCurrent: () => { if (!current) throw new Error('stale-source') },
    assertSources: values => {
      if (!current || !values.every(record => records.includes(record))) throw new Error('invalid-source')
      checkSources?.(++sourceChecks, values)
    },
    cached: record => cache.get(record.id),
    cache: (record, value) => {
      if (cache.has(record.id)) cache.delete(record.id)
      while (cache.size >= 2_000) cache.delete(cache.keys().next().value!)
      cache.set(record.id, value)
    },
    embed: async (texts, task) => {
      calls.push({ task, texts: [...texts] })
      await before?.(task, texts)
      const values = texts.map(vector)
      if (malformed) values[values.length - 1]![0] = NaN
      return values
    },
    finish: async values => { top = [...values]; return result(values) },
  })
  return {
    handle, records, calls, cache, scan, vector, top: () => top,
    invalidate: () => { current = false }, expire: () => { wall += 3_600_001 },
    setClock: (clock: () => number) => { now = clock },
    setSourceCheck: (check: typeof checkSources) => { sourceChecks = 0; checkSources = check },
    setBefore: (hook?: typeof before) => { before = hook }, setMalformed: (value: boolean) => { malformed = value },
  }
}
const grant = (f: ReturnType<typeof fixture>, id: string, addCalls = 0, addActiveMs = 0) => ({
  ...f.handle, grantId: id, addCalls, addActiveMs,
})
async function finish(f: ReturnType<typeof fixture>, page: MemoryFullScanPage) {
  while (page.state === 'page-complete') page = await f.scan.advance(f.handle)
  return page
}

for (const invalid of [undefined, { maxCalls: 0, maxActiveMs: 1 }, { maxCalls: 1.5, maxActiveMs: 1 },
  { maxCalls: 4097, maxActiveMs: 1 }, { maxCalls: 1, maxActiveMs: NaN }, { maxCalls: 1, maxActiveMs: Infinity },
  { maxCalls: 1, maxActiveMs: 3_600_001 }]) {
  assert.throws(() => validateFullScanOptions(invalid))
}
{
  const f = fixture(4_096)
  const plan = f.scan.plan()
  assert.equal(plan.state, 'ready')
  assert.equal(f.calls.length, 0)
  assert.deepEqual([plan.progress.eligiblePassages, plan.progress.cachedPassages, plan.progress.missingPassages,
    plan.progress.coldEstimatedCalls, plan.progress.currentEstimatedCalls], [4096, 0, 4096, 129, 129])
  await assert.rejects(f.scan.advance(f.handle), /授权/)
  let page = await f.scan.resume(grant(f, 'start'))
  assert.equal(page.state, 'page-complete')
  assert.equal(page.progress.callsAttempted, 8)
  const duplicate = await f.scan.resume(grant(f, 'start'))
  assert.equal(duplicate.progress.callsAttempted, 8, 'duplicate grant cannot issue a second page')
  page = await finish(f, page)
  assert.equal(page.state, 'complete')
  assert.equal(page.progress.callsAttempted, 129)
  assert.equal(page.progress.scoredPassages, 4096)
  assert.equal(page.progress.embeddedPassages, 4096)
  assert.equal(f.calls[0]!.task, 'retrieval.query')
  assert.ok(f.calls.slice(1).every(call => call.texts.length <= 32))
  assert.equal(new Set(f.calls.slice(1).flatMap(call => call.texts)).size, 4096)
  const oracle = f.records.map(record => {
    const v = f.vector(record.quote)
    return { id: record.id, score: 1 / Math.sqrt(v.reduce((sum, item) => sum + item * item, 0)) }
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 32)
  assert.deepEqual(f.top(), oracle)
  assert.equal(f.cache.size, 2000)
  const warm = fixture(4096, {}, f.cache)
  assert.equal(warm.scan.plan().progress.currentEstimatedCalls, 67)
  page = await finish(warm, await warm.scan.resume(grant(warm, 'start')))
  assert.equal(page.state, 'complete')
  assert.equal(page.progress.callsAttempted, 67)
  assert.equal(page.progress.scoredCachedPassages, 2000)
  assert.equal(page.progress.embeddedPassages, 2096)
  assert.deepEqual(warm.top(), oracle)
  console.log('✓ plan sends no requests; 4096-source cold/warm scans use 129/67 attempts and exactly match materialized top-K')
}
{
  const f = fixture(96, { maxCalls: 2 })
  let page = await f.scan.resume(grant(f, 'start'))
  assert.equal(page.state, 'paused-budget')
  assert.deepEqual([page.progress.scoredPassages, page.progress.callsAttempted], [32, 2])
  assert.ok(!('result' in page), 'partial semantics are never evidence')
  const original = f.scan.progress()
  for (const invalid of [grant(f, 'bad', 1, NaN), grant(f, 'bad', -1, 3), grant(f, 'bad', 4096, 0),
    { ...grant(f, 'bad'), generation: f.handle.generation + 1 }]) await assert.rejects(f.scan.resume(invalid))
  assert.deepEqual(f.scan.progress(), original)
  await assert.rejects(f.scan.resume(grant(f, 'start', 1)), /授权编号/)
  await assert.rejects(f.scan.resume(grant(f, 'more')), /预算已耗尽/)
  assert.deepEqual(f.scan.progress(), original, 'exhausted zero grant cannot alter totals or ledger')
  page = await f.scan.resume(grant(f, 'more', 2))
  assert.equal(page.state, 'complete')
  assert.equal(page.progress.callsAttempted, 4)
  assert.equal(page.progress.queryCalls, 1)
  console.log('✓ small-corpus explicit budgets, atomic invalid grants, stale handles, and duplicate grant idempotency')
}
{
  const f = fixture(96)
  f.setBefore(async task => { if (task === 'retrieval.passage' && f.calls.length === 3) f.setMalformed(true) })
  let page = await f.scan.resume(grant(f, 'start'))
  assert.equal(page.state, 'paused-provider')
  assert.deepEqual([page.progress.scoredPassages, f.cache.size, page.progress.callsAttempted], [32, 32, 3])
  f.setBefore()
  f.setMalformed(false)
  page = await f.scan.resume(grant(f, 'retry'))
  assert.equal(page.state, 'complete')
  assert.equal(page.progress.callsAttempted, 5)
  assert.equal(page.progress.scoredPassages, 96)
  assert.deepEqual(f.calls[2]!.texts, f.calls[3]!.texts)
  console.log('✓ malformed middle batch commits nothing; explicit retry consumes a new attempt and never duplicates accepted coverage')
}
{
  const f = fixture(64, { maxActiveMs: 30 })
  const held = deferred<void>()
  const entered = deferred<void>()
  f.setBefore(async task => { if (task === 'retrieval.passage') { entered.resolve(); await held.promise } })
  const running = f.scan.resume(grant(f, 'start'))
  await entered.promise
  const page = await running
  assert.equal(page.state, 'paused-budget')
  assert.equal(page.progress.callsAttempted, 2)
  assert.equal(page.progress.scoredPassages, 0)
  held.resolve()
  await sleep(5)
  assert.equal(f.cache.size, 0, 'late response cannot populate cache')
  f.setBefore()
  const resumed = await f.scan.resume(grant(f, 'more-time', 0, 1000))
  assert.equal(resumed.state, 'complete')
  assert.equal(resumed.progress.queryCalls, 1)
  assert.equal(resumed.progress.callsAttempted, 4)
  console.log('✓ active deadline detaches a held response, preserves cumulative accounting, and retries only uncovered sources')
}
{
  const f = fixture(32)
  const held = deferred<void>()
  const entered = deferred<void>()
  f.setBefore(async task => { if (task === 'retrieval.passage') { entered.resolve(); await held.promise } })
  const running = f.scan.resume(grant(f, 'start'))
  await entered.promise
  f.scan.cancel()
  await assert.rejects(running, /取消|失效/)
  held.resolve()
  await sleep(5)
  assert.equal(f.cache.size, 0)
  await assert.rejects(f.scan.resume(grant(f, 'late')))
  const stale = fixture(32)
  stale.setBefore(async () => { stale.invalidate() })
  await assert.rejects(stale.scan.resume(grant(stale, 'start')), /stale-source/)
  assert.equal(stale.cache.size, 0)
  const rejected = fixture(32)
  await assert.rejects(rejected.scan.resume(grant(rejected, 'start'), async () => { throw new Error('secret provider body') }), /依据校验失败/)
  assert.equal(rejected.calls.length, 0)
  await assert.rejects(rejected.scan.validateLocal(rejected.handle))
  const expired = fixture(32)
  expired.expire()
  await assert.rejects(expired.scan.resume(grant(expired, 'start')), /过期/)
  console.log('✓ cancellation, source changes, guard rejection, and idle expiry are fatal and cannot revive late results')
}
{
  const sourceExhausted = fixture(32, { maxActiveMs: 10 })
  let sourceTime = 0
  sourceExhausted.setClock(() => sourceTime)
  sourceExhausted.setSourceCheck(() => { sourceTime += 10 })
  const exhaustedPage = await sourceExhausted.scan.resume(grant(sourceExhausted, 'start'))
  assert.equal(exhaustedPage.state, 'paused-budget')
  assert.equal(exhaustedPage.progress.callsAttempted, 0)
  assert.equal(sourceExhausted.calls.length, 0, 'source validation cannot authorize a call after consuming the remaining budget')
  const f = fixture(32, { maxActiveMs: 50 })
  let time = 0
  f.setClock(() => time)
  const page = await f.scan.resume(grant(f, 'start'), async () => { time += 60 })
  assert.equal(page.state, 'paused-budget')
  assert.equal(page.progress.callsAttempted, 0)
  assert.ok(page.progress.activeMsUsed >= 60, 'guard waits count as active processing')
  assert.equal(page.progress.activeMsApproved, 50)
  await assert.rejects(f.scan.validateLocal(f.handle), /预算已耗尽/)
  const stopped = fixture(32, { maxActiveMs: 50 })
  let localTime = 0
  stopped.setClock(() => localTime)
  await assert.rejects(stopped.scan.validateLocal(stopped.handle, async () => { localTime += 60 }), /预算已耗尽/)
  assert.equal(stopped.calls.length, 0)
  const finalizing = fixture(32, { maxActiveMs: 50 })
  let finalTime = 0
  finalizing.setClock(() => finalTime)
  await assert.rejects(finalizing.scan.validateLocal(finalizing.handle, async () => { finalTime += 45 },
    () => { finalTime += 6; return 'must not escape' }), /预算已耗尽/)
  assert.ok(finalizing.scan.progress().activeMsUsed >= 51)
  const checking = fixture(32)
  const held = deferred<void>()
  const validation = checking.scan.validateLocal(checking.handle, () => held.promise)
  await assert.rejects(checking.scan.resume(grant(checking, 'late')), /并发/)
  held.resolve()
  await validation
  console.log('✓ guards and local-stop validation obey cumulative active authorization; local validation excludes concurrent resume')
}


{
  // Deterministic timers exercise the real timer/race code without waiting 65 seconds.
  const f = fixture(96, { maxActiveMs: 65_000 })
  let time = 0
  const delays: number[] = []
  f.setClock(() => time)
  let hold = true
  f.setBefore(async () => {
    if (f.calls.length <= 3) time += 15_000
    else if (hold) await new Promise<void>(() => undefined)
  })
  const realTimer = globalThis.setTimeout
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms = 0, ...args: unknown[]) => {
    delays.push(ms)
    return realTimer(() => { time += ms; callback(...args) }, 0)
  }) as typeof setTimeout
  try {
    let page = await f.scan.resume(grant(f, 'start'), async () => { if (f.calls.length === 3) time += 3_000 })
    assert.equal(page.state, 'page-complete')
    assert.equal(page.progress.callsAttempted, 4)
    assert.equal(page.progress.scoredPassages, 64)
    assert.ok(delays.some(ms => ms > 1_990 && ms <= 2_000), '5s page headroom minus 3s guard leaves <=2s for provider')
    assert.ok(page.progress.activeMsUsed >= 50_000 && page.progress.activeMsUsed < 50_001)
    page = await f.scan.advance(f.handle)
    assert.equal(page.state, 'paused-budget')
    assert.equal(page.progress.callsAttempted, 5)
    assert.ok(page.progress.activeMsUsed >= 65_000 && page.progress.activeMsUsed < 65_001)
    assert.equal(page.progress.activeMsApproved, 65_000)
    hold = false
    page = await f.scan.resume(grant(f, 'more', 0, 20_000))
    assert.equal(page.state, 'complete')
    assert.equal(page.progress.callsAttempted, 6)
    assert.equal(page.progress.queryCalls, 1)
  } finally { globalThis.setTimeout = realTimer }
  console.log('✓ guard+provider share remaining page time; automatic pages preserve the cumulative 65s ceiling')
}

const originalFetch = globalThis.fetch
let requests = 0
let reranks = 0
const inputs: string[] = []
const options: MemoryRemoteOptions = {
  embedding: { protocol: 'jina', endpoint: 'https://synthetic.invalid/embeddings', model: 'mock', apiKey: 'private-test-key', dimensions: 3 },
  rerank: { endpoint: 'https://synthetic.invalid/rerank', model: 'mock-rerank', apiKey: 'private-rerank-key' },
  fullScan: { maxCalls: 1, maxActiveMs: 65_000 },
}
globalThis.fetch = async (_url, init) => {
  requests++
  const body = JSON.parse(String(init?.body)) as { input?: string[]; documents?: string[] }
  if (body.input) {
    inputs.push(...body.input)
    return Response.json({ data: body.input.map((_, index) => ({ index, embedding: [1, 0, 0] })) })
  }
  reranks++
  return Response.json({ results: body.documents!.map((_, index) => ({ index, relevance_score: 1 })) })
}
try {
  const index = new MemoryIndex()
  await index.sync({ id: 'engine', title: '', clues: [], chapters: [
    { id: 'old', title: '已披露', text: '铜铃托付给了阿宁。' }, { id: 'future', title: '后文', text: '未来禁止泄露。' },
  ] })
  const query = { text: '铜铃', throughChapterId: 'old' }
  const plan = await index.startFullScan(query, options)
  assert.equal(requests, 0)
  assert.equal(plan.progress.eligiblePassages, 1)
  let page = await index.resumeFullScan({ ...plan.progress, grantId: 'start', addCalls: 0, addActiveMs: 0 })
  assert.equal(page.state, 'paused-budget')
  assert.equal(requests, 1)
  let guards = 0
  const local = await index.useLocalFullScan(plan.progress, async () => { guards++ })
  assert.equal(local.method, 'bm25+clues')
  assert.equal(local.diagnostics.fullScan?.coverage, 'incomplete')
  assert.ok(local.hits.every(hit => !hit.reason.includes('语义')))
  assert.equal(reranks, 0)
  assert.equal(guards, 1)
  await assert.rejects(index.resumeFullScan({ ...plan.progress, grantId: 'late', addCalls: 1, addActiveMs: 0 }))
  const direct = await index.search(query, options)
  assert.equal(direct.method, 'bm25+clues')
  assert.equal(requests, 1, 'direct no-callback usage cannot silently grant work')
  const rerankPlan = await index.startFullScan(query, { ...options, fullScan: { maxCalls: 2, maxActiveMs: 65_000 } })
  page = await index.resumeFullScan({ ...rerankPlan.progress, grantId: 'start', addCalls: 0, addActiveMs: 0 })
  assert.equal(page.state, 'paused-budget')
  assert.equal(page.progress.scoredPassages, 1)
  assert.equal(reranks, 0)
  page = await index.resumeFullScan({ ...rerankPlan.progress, grantId: 'rerank', addCalls: 1, addActiveMs: 0 })
  assert.equal(page.state, 'complete')
  if (page.state === 'complete') {
    assert.equal(page.result.diagnostics.fullScan?.coverage, 'complete')
    assert.equal(page.result.hits[0]!.quote, '铜铃托付给了阿宁。')
    assert.equal(page.result.assessment?.answerability, 'unverified')
  }
  assert.equal(reranks, 1)
  assert.ok(!inputs.some(text => text.includes('未来')))
  assert.ok(!JSON.stringify(page).includes('private-test-key'))
  const fatal = await index.startFullScan(query, options)
  await assert.rejects(index.useLocalFullScan(fatal.progress, async () => { throw new Error('source changed') }), /依据校验失败/)
  console.log('✓ production engine: fullScan budgets apply below 2000, local stop forbids rerank, rerank pauses for allocation, source guards remain fatal')
} finally { globalThis.fetch = originalFetch }
console.log('=== FULL SCAN SESSION TESTS PASSED ===')
