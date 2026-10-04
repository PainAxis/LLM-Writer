import assert from 'node:assert/strict'
import {
  MEMORY_PROVIDER_DEFAULTS, embedMemoryTexts, normalizeEmbeddingConfig, normalizeRerankConfig, rerankMemoryTexts,
} from '../src/services/memory/providers'
import type { MemoryEmbeddingConfig } from '../src/types/memory'

// No external calls or paid credentials: fixtures exercise the real HTTP adapter.
const key = 'test-only-memory-provider-key'
const embedding = { ...MEMORY_PROVIDER_DEFAULTS.embedding, apiKey: key, dimensions: 3 }
const rerank = { ...MEMORY_PROVIDER_DEFAULTS.rerank, apiKey: key }
const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout
let requests = 0

const json = (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data), {
  ...init, headers: { 'Content-Type': 'application/json', ...init?.headers },
})
const vectorData = () => ({ data: [{ index: 1, embedding: [0, 2, 0] }, { index: 0, embedding: [1, 0, 0] }] })
function mockFetch(run: (url: string, init: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = async (url, init) => { requests++; return run(String(url), init!) }
}
function safeMessage(error: unknown): boolean {
  assert.ok(error instanceof Error)
  assert.ok(!error.message.includes(key), 'public errors must omit the API key')
  assert.ok(!error.message.includes('SECRET_PROVIDER_BODY'), 'public errors must omit response content')
  assert.ok(!error.message.includes('https://'), 'public errors must omit request and provider URLs')
  return true
}

try {
  assert.equal(MEMORY_PROVIDER_DEFAULTS.embedding.apiKey, '')
  assert.equal(MEMORY_PROVIDER_DEFAULTS.rerank.apiKey, '')
  assert.deepEqual(normalizeEmbeddingConfig({ ...embedding, extra: 'discard' }), embedding)
  assert.deepEqual(normalizeRerankConfig({ ...rerank, extra: 'discard' }), rerank)
  for (const endpoint of ['http://localhost:8341/v1/embeddings', 'http://127.0.0.2:8341/embeddings', 'http://[::1]:8341/embeddings']) {
    assert.equal(normalizeEmbeddingConfig({ ...embedding, endpoint }).endpoint, endpoint)
  }
  assert.equal(normalizeEmbeddingConfig({ ...embedding, endpoint: 'http://127.1/embeddings' }).endpoint, 'http://127.0.0.1/embeddings')
  for (const endpoint of [
    'http://example.com/embeddings', 'http://127.evil.example/embeddings', 'javascript:alert(1)', '/v1/embeddings',
    'https://name:password@example.com/embeddings', 'https://example.com/embeddings?key=secret',
    'https://example.com/embeddings?', 'https://example.com/embeddings#', 'https://example.com/\nembeddings',
  ]) assert.throws(() => normalizeEmbeddingConfig({ ...embedding, endpoint }), safeMessage)
  for (const invalidKey of ['', ' ', 'bad\nkey', `${key}\r`, 'bad\tkey', 'bad key', '中文', 'x'.repeat(8_193)]) {
    assert.throws(() => normalizeRerankConfig({ ...rerank, apiKey: invalidKey }), safeMessage)
  }
  for (const dimensions of [0, -1, 1.5, 4_097, NaN, Infinity, '3']) {
    assert.throws(() => normalizeEmbeddingConfig({ ...embedding, dimensions }), safeMessage)
  }
  for (const model of ['', ' ', 'x'.repeat(201), 'model\nname']) {
    assert.throws(() => normalizeRerankConfig({ ...rerank, model }), safeMessage)
  }
  assert.throws(() => normalizeEmbeddingConfig({ ...embedding, protocol: 'unknown' }), safeMessage)
  assert.throws(() => normalizeEmbeddingConfig(null), safeMessage)
  console.log('✓ 配置限制完整 HTTPS/本机接口、会话密钥、模型和维度，拒绝 URL 凭据与查询参数')

  mockFetch((url, init) => {
    assert.equal(url, embedding.endpoint)
    assert.equal(init.method, 'POST')
    assert.equal(init.credentials, 'omit')
    assert.equal(init.redirect, 'error')
    assert.equal(init.cache, 'no-store')
    assert.equal(init.referrerPolicy, 'no-referrer')
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${key}`)
    assert.deepEqual(JSON.parse(String(init.body)), {
      model: embedding.model, input: ['旧章原文。', '另一段文字。'], dimensions: 3,
      task: 'retrieval.passage', embedding_type: 'float', late_chunking: false,
    })
    assert.ok(init.signal instanceof AbortSignal)
    return json(vectorData())
  })
  assert.deepEqual(await embedMemoryTexts(embedding, ['旧章原文。', '另一段文字。'], 'retrieval.passage'), [[1, 0, 0], [0, 2, 0]])
  mockFetch((_url, init) => {
    assert.deepEqual(JSON.parse(String(init.body)), {
      model: embedding.model, input: ['接应信号'], dimensions: 3,
      task: 'retrieval.query', embedding_type: 'float', late_chunking: false,
    })
    return json({ data: [{ index: 0, embedding: [0.25, -0.5, 0.75] }] })
  })
  assert.deepEqual(await embedMemoryTexts(embedding, ['接应信号'], 'retrieval.query'), [[0.25, -0.5, 0.75]])
  mockFetch((_url, init) => {
    assert.deepEqual(JSON.parse(String(init.body)), {
      model: 'custom-model', input: ['接应信号'], dimensions: 3, encoding_format: 'float',
    })
    return json({ data: [{ index: 0, embedding: [1, 2, 3] }] })
  })
  const compatible: MemoryEmbeddingConfig = { ...embedding, protocol: 'openai-compatible', model: 'custom-model' }
  assert.deepEqual(await embedMemoryTexts(compatible, ['接应信号'], 'retrieval.query'), [[1, 2, 3]])
  console.log('✓ Jina 查询/原文任务与 OpenAI 兼容载荷区分，禁止跨分块 late chunking，按索引恢复向量顺序')

  const malformedVectors: unknown[] = [
    null, [], {}, { data: [] }, { data: [vectorData().data[0]] },
    { data: [{ index: 0, embedding: [1, 0, 0] }, { index: 0, embedding: [0, 1, 0] }] },
    { data: [{ index: -1, embedding: [1, 0, 0] }, { index: 1, embedding: [0, 1, 0] }] },
    { data: [{ index: 0, embedding: [1, 0, 0] }, { index: 2, embedding: [0, 1, 0] }] },
    { data: [{ index: 0, embedding: [1, 0, 0] }, { index: 0.5, embedding: [0, 1, 0] }] },
    { data: [{ index: '0', embedding: [1, 0, 0] }, { index: 1, embedding: [0, 1, 0] }] },
    { data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [0, 1, 0] }] },
    ...[[0, 0, 0], [null, 1, 0], ['1', 0, 0], [1e100, 0, 0], [1e-100, 0, 0], [NaN, 1, 0], [Infinity, 0, 1]].map(vector => (
      { data: [{ index: 0, embedding: vector }, { index: 1, embedding: [0, 1, 0] }] }
    )),
    { data: [{ index: 0, embedding: 'AAAA' }, { index: 1, embedding: [0, 1, 0] }] },
  ]
  for (const response of malformedVectors) {
    mockFetch(() => json(response))
    await assert.rejects(embedMemoryTexts(embedding, ['甲', '乙'], 'retrieval.passage'), safeMessage)
  }
  mockFetch(() => new Response('{"data":[{"index":0,"embedding":[1e999,0,0]}]}'))
  await assert.rejects(embedMemoryTexts(embedding, ['甲'], 'retrieval.query'), safeMessage)
  console.log('✓ 不完整、重复索引、错维、零向量及非有限/Float32 无法表示的向量全部拒绝')

  mockFetch((url, init) => {
    assert.equal(url, rerank.endpoint)
    assert.deepEqual(JSON.parse(String(init.body)), {
      model: rerank.model, query: '接应暗号', documents: ['铜铃响三声。', '下雨了。'], top_n: 2, return_documents: false,
    })
    return json({ results: [
      { index: 1, relevance_score: 0.1, document: { text: 'SECRET_PROVIDER_BODY: fabricated future plot' } },
      { index: 0, relevance_score: 0.9, document: 'SECRET_PROVIDER_BODY' },
    ] })
  })
  assert.deepEqual(await rerankMemoryTexts(rerank, '接应暗号', ['铜铃响三声。', '下雨了。']), [{ index: 0, score: 0.9 }, { index: 1, score: 0.1 }])
  const badRankings = [
    null, {}, { results: [] }, { results: [{ index: 0, relevance_score: 0.1 }] },
    ...[
      [{ index: 0, relevance_score: 0.1 }, { index: 0, relevance_score: 0.9 }],
      [{ index: -1, relevance_score: 0.1 }, { index: 1, relevance_score: 0.9 }],
      [{ index: 0, relevance_score: 0.1 }, { index: 2, relevance_score: 0.9 }],
      [{ index: 0.5, relevance_score: 0.1 }, { index: 1, relevance_score: 0.9 }],
      [{ index: 0, relevance_score: null }, { index: 1, relevance_score: 0.9 }],
      [{ index: 0, relevance_score: '0.1' }, { index: 1, relevance_score: 0.9 }],
    ].map(results => ({ results })),
  ]
  for (const response of badRankings) {
    mockFetch(() => json(response))
    await assert.rejects(rerankMemoryTexts(rerank, '暗号', ['甲', '乙']), safeMessage)
  }
  mockFetch(() => new Response('{"results":[{"index":0,"relevance_score":1e999}]}'))
  await assert.rejects(rerankMemoryTexts(rerank, '暗号', ['甲']), safeMessage)
  console.log('✓ 重排完整覆盖候选、按有限分数排序，服务返回的文档与伪造原文全部丢弃')

  const beforeInvalid = requests
  for (const texts of [[], new Array<string>(2), [''], [' '], ['字'.repeat(8_193)], Array.from({ length: 65 }, () => '章')]) {
    await assert.rejects(embedMemoryTexts(embedding, texts, 'retrieval.passage'), safeMessage)
  }
  await assert.rejects(embedMemoryTexts(embedding, Array.from({ length: 17 }, () => '字'.repeat(8_000)), 'retrieval.passage'), safeMessage)
  await assert.rejects(rerankMemoryTexts(rerank, 'query', Array.from({ length: 61 }, () => '章')), safeMessage)
  await assert.rejects(rerankMemoryTexts(rerank, '字'.repeat(4_001), ['章']), safeMessage)
  assert.equal(requests, beforeInvalid, 'invalid requests must fail before any network call')

  for (const status of [302, 400, 401, 403, 429, 500]) {
    mockFetch(() => new Response(`SECRET_PROVIDER_BODY ${key} https://secret.example`, {
      status, headers: { location: 'https://unexpected.example' },
    }))
    await assert.rejects(embedMemoryTexts(embedding, ['甲'], 'retrieval.query'), safeMessage)
  }
  mockFetch(() => {
    const response = json({ data: [{ index: 0, embedding: [1, 0, 0] }] })
    Object.defineProperty(response, 'redirected', { value: true })
    return response
  })
  await assert.rejects(embedMemoryTexts(embedding, ['甲'], 'retrieval.query'), safeMessage)
  for (const invalid of ['<html>SECRET_PROVIDER_BODY</html>', `{"SECRET_PROVIDER_BODY":"${key}"`]) {
    mockFetch(() => new Response(invalid))
    await assert.rejects(embedMemoryTexts(embedding, ['甲'], 'retrieval.query'), safeMessage)
  }
  mockFetch(() => { throw new Error(`SECRET_PROVIDER_BODY ${key} https://secret.example`) })
  await assert.rejects(embedMemoryTexts(embedding, ['甲'], 'retrieval.query'), safeMessage)
  console.log('✓ 输入预算在联网前生效，HTTP/重定向/JSON/网络异常不会泄漏远程错误或密钥')

  mockFetch(() => json(vectorData(), { headers: { 'content-length': String(8 * 1024 * 1024 + 1) } }))
  await assert.rejects(embedMemoryTexts(embedding, ['甲', '乙'], 'retrieval.passage'), /大小限制/)
  let oversizedCancelled = false
  mockFetch(() => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)) },
    cancel() { oversizedCancelled = true },
  })))
  await assert.rejects(embedMemoryTexts(embedding, ['甲'], 'retrieval.query'), /大小限制/)
  assert.equal(oversizedCancelled, true)
  mockFetch(() => new Response(new Uint8Array([0xff])))
  await assert.rejects(embedMemoryTexts(embedding, ['甲'], 'retrieval.query'), safeMessage)

  const alreadyAborted = new AbortController()
  alreadyAborted.abort(`SECRET_PROVIDER_BODY ${key}`)
  const beforeAbort = requests
  await assert.rejects(embedMemoryTexts(embedding, ['甲'], 'retrieval.query', alreadyAborted.signal), { name: 'AbortError' })
  await assert.rejects(rerankMemoryTexts(rerank, '甲', ['乙'], alreadyAborted.signal), { name: 'AbortError' })
  assert.equal(requests, beforeAbort)

  // A misbehaving transport ignores the signal: the outer promise must still abort.
  mockFetch(() => new Promise<Response>(() => undefined))
  const active = new AbortController()
  const pending = embedMemoryTexts(embedding, ['甲'], 'retrieval.query', active.signal)
  active.abort(`SECRET_PROVIDER_BODY ${key}`)
  await assert.rejects(pending, error => safeMessage(error) && (error as Error).name === 'AbortError')

  let bodyCancelled = false
  mockFetch(() => new Response(new ReadableStream({ cancel() { bodyCancelled = true } })))
  const streaming = new AbortController()
  const waitingBody = embedMemoryTexts(embedding, ['甲'], 'retrieval.query', streaming.signal)
  await new Promise<void>(resolve => originalSetTimeout(resolve, 0))
  streaming.abort()
  await assert.rejects(waitingBody, { name: 'AbortError' })
  assert.equal(bodyCancelled, true)

  // Accelerate only this adapter's 15s deadline; no paid API or long test delay.
  globalThis.setTimeout = ((callback, ms, ...args) => originalSetTimeout(callback, ms === 15_000 ? 5 : ms, ...args)) as typeof setTimeout
  mockFetch(() => new Promise<Response>(() => undefined))
  await assert.rejects(embedMemoryTexts(embedding, ['甲'], 'retrieval.query'), { name: 'TimeoutError' })
  bodyCancelled = false
  mockFetch(() => new Response(new ReadableStream({ cancel() { bodyCancelled = true } })))
  await assert.rejects(rerankMemoryTexts(rerank, '甲', ['乙']), { name: 'TimeoutError' })
  assert.equal(bodyCancelled, true)
  console.log('✓ 响应长度与流量上限、非法编码、预先取消、进行中取消及超时均受控并释放响应流')
} finally {
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
}

console.log('Memory provider adapter smoke checks passed (offline fixtures).')
