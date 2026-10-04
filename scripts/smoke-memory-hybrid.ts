import assert from 'node:assert/strict'
import { MemoryIndex } from '../src/services/memory/engine'
import { chapterRevision } from '../src/services/memory/revision'
import type { MemoryEmbeddingConfig, MemoryProjectInput, MemoryRemoteOptions } from '../src/types/memory'

// Synthetic vectors deliberately make the synonym query orthogonal to every unrelated passage.
// These tests exercise application/provider boundaries, not the quality of a paid model.
const embedding: MemoryEmbeddingConfig = {
  protocol: 'jina', endpoint: 'https://memory-test.example/v1/embeddings',
  model: 'test-embedding', apiKey: 'session-secret-never-returned', dimensions: 3,
}
const options: MemoryRemoteOptions = {
  embedding,
  rerank: { endpoint: 'https://memory-test.example/v1/rerank', model: 'test-rerank', apiKey: 'rerank-session-secret' },
}
const bell = '阿宁在窗边系着铜铃，听见三声便去渡口。'
const bread = '旅人买了麦饼，随后回到客栈。'
const future = '玄衣客的真名是顾行，这是后来的最终揭晓。'
const input: MemoryProjectInput = {
  id: 'hybrid-A', title: '混合检索验收',
  chapters: [
    { id: 'c1', title: '托付', text: bell },
    { id: 'c2', title: '途中', text: bread },
    { id: 'c3', title: '揭晓', text: future },
  ],
  clues: [{
    id: 'bell', chapterId: 'c1', sourceRevision: '', start: 0, end: bell.length,
    quote: bell, label: '铜铃', aliases: ['渡船约定'],
  }],
}
input.clues[0]!.sourceRevision = await chapterRevision(input.chapters[0]!)
interface RequestBody { input?: string[]; task?: string; dimensions?: number; documents?: string[]; query?: string; model?: string }
interface RequestRecord { endpoint: string; body: RequestBody; signal: AbortSignal | null | undefined }
const requests: RequestRecord[] = []
const originalFetch = globalThis.fetch
let mode: 'normal' | 'fail-embedding' | 'bad-rerank' | 'reverse-rerank' = 'normal'
let holdNextDocumentRequest: ((record: RequestRecord) => Promise<void>) | undefined
function vector(text: string, dimensions: number): number[] {
  const values = text.includes('撤离暗号') || text.includes('铜铃') || text.includes('木哨')
    ? [1, 0, 0] : text.includes('玄衣客') || text.includes('身份谜底') ? [0, 1, 0] : [0, 0, 1]
  return Array.from({ length: dimensions }, (_, i) => values[i] ?? 0)
}
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(String(init?.body)) as RequestBody
  const record: RequestRecord = { endpoint: String(url), body, signal: init?.signal }
  requests.push(record)
  if (body.input) {
    if (body.task === 'retrieval.passage' && holdNextDocumentRequest) {
      const hold = holdNextDocumentRequest
      holdNextDocumentRequest = undefined
      await hold(record)
    }
    if (mode === 'fail-embedding') return new Response('provider error with confidential diagnostics', { status: 500 })
    return Response.json({ data: body.input.map((text, index) => ({ index, embedding: vector(text, body.dimensions ?? 3) })).reverse() })
  }
  const documents = body.documents!
  if (mode === 'bad-rerank') return Response.json({ results: [{ index: documents.length, relevance_score: 1 }] })
  return Response.json({ results: documents.map((_, index) => ({
    index, relevance_score: mode === 'reverse-rerank' ? index + 1 : documents.length - index,
  })).reverse() })
}
const passages = () => requests.filter(request => request.body.task === 'retrieval.passage')
const payloads = () => JSON.stringify(requests.map(request => request.body))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
try {
  const index = new MemoryIndex()
  await index.sync(input)
  const query = { text: '撤离暗号', throughChapterId: 'c2' }
  assert.equal((await index.search(query)).hits.length, 0, 'synonym query must have no accidental lexical match')
  const semantic = await index.search(query, options)
  assert.equal(semantic.method, 'bm25+clues+semantic')
  assert.equal(semantic.hits[0]!.chapterId, 'c1')
  assert.equal(semantic.hits[0]!.quote, bell)
  assert.match(semantic.hits[0]!.reason, /语义.*重排/)
  assert.deepEqual([semantic.diagnostics.eligiblePassages, semantic.diagnostics.embeddedPassages, semantic.diagnostics.cachedPassages], [2, 2, 0])
  assert.equal(semantic.diagnostics.rerank, 'used')
  assert.ok(!payloads().includes(future), 'future text must not reach embeddings or reranker')
  assert.ok(!JSON.stringify(semantic).includes('session-secret'))
  console.log('✓ 无关键词重合的同义请求通过语义召回得到原文依据；未来章节未进入远程请求')

  requests.length = 0
  await index.sync(structuredClone(input))
  const repeated = await index.search(query, options)
  assert.equal(repeated.diagnostics.cachedPassages, 2)
  assert.equal(repeated.diagnostics.embeddedPassages, 0)
  assert.equal(passages().length, 0, 'rebuilding an unchanged snapshot must reuse vectors')
  const clue = await index.search({ text: '渡船约定', throughChapterId: 'c2' }, options)
  assert.ok(clue.hits.some(hit => hit.kind === 'clue' && hit.chapterId === 'c1'))
  assert.ok(clue.hits.some(hit => hit.reason.includes('作者伏笔标记')))
  console.log('✓ 相同修订重复检索复用片段向量，手工伏笔别名通道继续参与融合')

  const wide = await index.search({ text: '身份谜底', throughChapterId: 'c3' }, options)
  assert.ok(wide.hits.some(hit => hit.chapterId === 'c3'))
  requests.length = 0
  const narrow = await index.search({ text: '身份谜底', throughChapterId: 'c2' }, options)
  assert.equal(narrow.hits.length, 0)
  assert.equal(narrow.diagnostics.eligiblePassages, 2)
  assert.ok(!payloads().includes(future), 'a warm future vector cannot leak after narrowing cutoff')
  assert.equal(requests.filter(request => request.body.documents).length, 0, 'no evidence means reranking is skipped')
  console.log('✓ 扩大再缩小披露范围后，已缓存未来向量不会参与召回或远程重排')

  const edited = structuredClone(input)
  edited.chapters[0]!.text = '阿宁在窗边挂起木哨，听见短音便去渡口。'
  requests.length = 0
  const stats = await index.sync(edited)
  assert.equal(stats.staleClues, 1)
  const revised = await index.search(query, options)
  assert.equal(revised.hits[0]!.quote, edited.chapters[0]!.text)
  assert.notEqual(revised.hits[0]!.revision, semantic.hits[0]!.revision)
  assert.equal(revised.diagnostics.embeddedPassages, 1)
  assert.equal(revised.diagnostics.cachedPassages, 1)
  assert.deepEqual(passages().flatMap(request => request.body.input!), [edited.chapters[0]!.text])
  assert.ok(!payloads().includes(bell) && !JSON.stringify(revised.hits).includes(bell))
  console.log('✓ 修改旧章后只重新嵌入改动片段，旧事实、旧向量和旧伏笔不再返回')

  // Reordering cannot reuse an old ordinal. Deleted chapters are purged from the vector cache.
  const reordered = { ...edited, chapters: [edited.chapters[2]!, edited.chapters[1]!, edited.chapters[0]!] }
  await index.sync(reordered)
  requests.length = 0
  const reorderResult = await index.search(query, options)
  assert.ok(reorderResult.hits.every(hit => hit.chapterId !== 'c1'))
  assert.ok(!payloads().includes(edited.chapters[0]!.text))
  await index.sync({ ...edited, chapters: edited.chapters.slice(0, 2) })
  await assert.rejects(index.search({ text: '身份谜底', throughChapterId: 'c3' }, options), /截止章节不存在/)

  for (const change of [
    { model: 'another-model' }, { dimensions: 4 }, { apiKey: 'another-session-key' },
    { endpoint: 'https://other-memory.example/v1/embeddings' }, { protocol: 'openai-compatible' as const },
  ]) {
    requests.length = 0
    const settings = { embedding: { ...embedding, ...change } }
    const changed = await index.search(query, settings)
    assert.equal(changed.diagnostics.semantic, 'used')
    assert.equal(changed.diagnostics.embeddedPassages, 2, 'model/dimension/account/endpoint/protocol changes must isolate cache')
    assert.equal(changed.diagnostics.cachedPassages, 0)
  }
  await index.sync({ ...edited, id: 'hybrid-B', chapters: edited.chapters.slice(0, 2) })
  const otherProject = await index.search(query, options)
  assert.equal(otherProject.diagnostics.cachedPassages, 0)
  assert.equal(otherProject.diagnostics.embeddedPassages, 2)
  assert.ok(otherProject.hits.every(hit => hit.projectId === 'hybrid-B'))
  console.log('✓ 章节重排／删除、项目切换、模型、维度、凭据、端点与协议变化均保持隔离')

  requests.length = 0
  mode = 'bad-rerank'
  const invalidRerank = await index.search({ text: '木哨', throughChapterId: 'c2' }, options)
  assert.equal(invalidRerank.diagnostics.rerank, 'fallback')
  assert.ok(invalidRerank.hits.some(hit => hit.quote.includes('木哨')))
  assert.ok(invalidRerank.hits.every(hit => !hit.reason.includes('远程重排')))
  mode = 'fail-embedding'
  const failed = await index.search({ text: '木哨', throughChapterId: 'c2' }, { embedding: { ...embedding, model: 'fail-model' } })
  assert.equal(failed.diagnostics.semantic, 'fallback')
  assert.equal(failed.method, 'bm25+clues')
  assert.ok(failed.hits.some(hit => hit.quote.includes('木哨')))
  assert.ok(!JSON.stringify(failed).includes('confidential'))
  mode = 'normal'
  const invalidConfig = await index.search(query, { embedding: { ...embedding, dimensions: 0 } })
  assert.equal(invalidConfig.diagnostics.semantic, 'fallback')
  assert.equal((await index.search(query, options)).diagnostics.embeddedPassages, 2, 'invalid config clears the previous configuration cache')
  console.log('✓ 重排非法索引、服务失败及无效设置均明确回退，本地证据和安全提示保持可用')

  // A validated rerank permutation can change order but never introduce a foreign quote or source.
  mode = 'reverse-rerank'
  const beforeRerank = await index.search({ text: '木哨 麦饼', throughChapterId: 'c2' })
  const afterRerank = await index.search({ text: '木哨 麦饼', throughChapterId: 'c2' }, { rerank: options.rerank })
  assert.ok(beforeRerank.hits.length >= 2)
  assert.deepEqual(afterRerank.hits.map(hit => hit.id), beforeRerank.hits.map(hit => hit.id).reverse())
  assert.ok(afterRerank.hits.every(hit => edited.chapters.some(chapter => chapter.id === hit.chapterId && chapter.text.slice(hit.start, hit.end) === hit.quote)))
  mode = 'normal'

  const staleIndex = new MemoryIndex()
  await staleIndex.sync(input)
  const entered = deferred<RequestRecord>()
  const release = deferred<void>()
  holdNextDocumentRequest = async record => { entered.resolve(record); await release.promise }
  requests.length = 0
  const staleSearch = staleIndex.search(query, options)
  const staleFailure = assert.rejects(staleSearch, /快照已变化|新的请求/)
  const staleRequest = await entered.promise
  await staleIndex.sync(edited)
  assert.equal(staleRequest.signal?.aborted, true, 'editing source must abort the transport')
  release.resolve()
  await staleFailure
  assert.equal(requests.length, 1, 'a stale document result must not start a query embedding or rerank request')
  requests.length = 0
  const afterStale = await staleIndex.search(query, options)
  assert.equal(afterStale.diagnostics.embeddedPassages, 2, 'stale response must not populate the new cache')
  assert.equal(afterStale.diagnostics.cachedPassages, 0)
  assert.ok(!payloads().includes(bell))

  const newQueryEntered = deferred<RequestRecord>()
  const newQueryRelease = deferred<void>()
  holdNextDocumentRequest = async record => { newQueryEntered.resolve(record); await newQueryRelease.promise }
  const oldQuery = staleIndex.search(query, { embedding: { ...embedding, model: 'uncached-model' } })
  const oldQueryFailure = assert.rejects(oldQuery, /新的请求/)
  const oldQueryRequest = await newQueryEntered.promise
  const latest = await staleIndex.search({ text: '木哨', throughChapterId: 'c2' })
  assert.equal(oldQueryRequest.signal?.aborted, true, 'a newer query must abort the earlier transport')
  newQueryRelease.resolve()
  await oldQueryFailure
  assert.ok(latest.hits.some(hit => hit.quote.includes('木哨')))
  console.log('✓ 编辑和新查询会中止旧远程请求；迟到结果不能写入向量缓存或触发后续请求')

  // UI settings and query may mutate while transport is pending; the request owns its initial scope.
  const mutableIndex = new MemoryIndex()
  await mutableIndex.sync(input)
  const mutableEntered = deferred<RequestRecord>()
  const mutableRelease = deferred<void>()
  holdNextDocumentRequest = async record => { mutableEntered.resolve(record); await mutableRelease.promise }
  const mutableOptions = structuredClone(options)
  const mutableQuery = { ...query }
  requests.length = 0
  const stableRequest = mutableIndex.search(mutableQuery, mutableOptions)
  await mutableEntered.promise
  mutableOptions.embedding!.model = 'mutated-model'
  mutableOptions.embedding!.apiKey = 'mutated-key'
  mutableOptions.rerank!.model = 'mutated-reranker'
  mutableQuery.throughChapterId = 'c3'
  mutableQuery.text = '身份谜底'
  mutableRelease.resolve()
  const stableResult = await stableRequest
  assert.equal(stableResult.throughChapterId, 'c2')
  assert.equal(stableResult.query, '撤离暗号')
  assert.ok(requests.every(request => !request.body.model?.includes('mutated')))
  assert.ok(!payloads().includes(future))

  // Accelerate only the overall budget timer; request timeout behavior is covered in adapter tests.
  const budgetIndex = new MemoryIndex()
  await budgetIndex.sync(input)
  holdNextDocumentRequest = async record => {
    await new Promise<void>(resolve => record.signal!.addEventListener('abort', () => resolve(), { once: true }))
  }
  const originalSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = new Proxy(originalSetTimeout, {
    apply(target, thisArgument, argumentsList) {
      if (argumentsList[1] === 65_000) argumentsList[1] = 10
      return Reflect.apply(target, thisArgument, argumentsList)
    },
  })
  requests.length = 0
  try {
    const budgetResult = await budgetIndex.search({ text: '铜铃', throughChapterId: 'c2' }, options)
    assert.equal(budgetResult.diagnostics.semantic, 'fallback')
    assert.equal(budgetResult.diagnostics.rerank, 'fallback')
    assert.ok(budgetResult.hits.some(hit => hit.quote === bell))
    assert.equal(requests.length, 1, 'exhausted total budget cannot start another embedding or rerank request')
    assert.equal(budgetResult.diagnostics.embeddedPassages, 0)
  } finally {
    globalThis.setTimeout = originalSetTimeout
  }
  console.log('✓ 查询设置采用初始快照；总时间预算耗尽后保留本地证据，不再发起后续请求')

  const manyIndex = new MemoryIndex()
  await manyIndex.sync({ id: 'large', title: '容量门槛', clues: [], chapters: Array.from({ length: 2_001 }, (_, i) => ({ id: `c${i}`, title: '途中', text: bread })) })
  requests.length = 0
  const overLimit = await manyIndex.search({ text: '麦饼', throughChapterId: 'c2000' }, options)
  assert.equal(overLimit.diagnostics.semantic, 'fallback')
  assert.equal(passages().length, 0, 'capacity fallback must not create a partial semantic index')
  assert.ok(overLimit.diagnostics.warnings.some(warning => warning.includes('2,000')))
  assert.ok(requests.every(request => !request.body.documents || request.body.documents.length <= 60))
  assert.ok(overLimit.hits.length > 0)
  console.log('✓ 超过语义片段上限时完整回退，重排候选始终不超过 60 条')
  console.log('=== ALL MEMORY HYBRID TESTS PASSED ===')
} finally {
  globalThis.fetch = originalFetch
}
