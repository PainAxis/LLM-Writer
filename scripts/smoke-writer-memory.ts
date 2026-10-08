import assert from 'node:assert/strict'
import { MemoryIndex } from '../src/services/memory/engine'
import { createMemoryDemo } from '../src/services/memory/labData'
import { createDemoFactGraph } from '../src/services/memory/factGraph'
import { chapterRevision } from '../src/services/memory/revision'
import { prepareWriterMemoryContext, WRITER_MEMORY_MARKER, type WriterMemoryDependencies, type WriterMemoryRequest } from '../src/services/memory/writerContext'
import type { MemoryProjectInput } from '../src/types/memory'
import type { FactGraphDocument } from '../src/types/factGraph'

const originalFetch = globalThis.fetch
let requests: Array<{ endpoint: string; body: Record<string, unknown> }> = []
let mutateAfterRequest: (() => void) | undefined
globalThis.fetch = async (input, init) => {
  const endpoint = String(input)
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>
  requests.push({ endpoint, body })
  assert.ok(!JSON.stringify(body).includes('玄衣客'), 'Future chapter names must never enter provider requests')
  mutateAfterRequest?.()
  mutateAfterRequest = undefined
  if (endpoint.includes('rerank')) {
    return Response.json({ results: (body.documents as string[]).map((_, index) => ({ index, relevance_score: 1 / (index + 1) })) })
  }
  return Response.json({ data: (body.input as string[]).map((_, index) => ({ index, embedding: [1, 0] })) })
}
const initial = await createMemoryDemo()
initial.id = 'novel:writer-fixture'
const initialGraph = await createDemoFactGraph({ ...initial, id: 'memory-demo' })
initialGraph.projectId = initial.id
initialGraph.revision = 'graph-original'
initialGraph.relations.forEach(row => { row.projectId = initial.id })
initialGraph.relations.find(row => row.origin === 'inferred')!.authorConfirmed = true
let project: MemoryProjectInput
let graph: FactGraphDocument
let client: MemoryIndex
let disclosedInputs: MemoryProjectInput[]
let dependencies: WriterMemoryDependencies
const request: WriterMemoryRequest = {
  projectId: initial.id, query: '铜铃', throughChapterId: 'c40', targetChapterId: 'c40', maxChars: 10_000,
}
function reset() {
  project = structuredClone(initial)
  graph = structuredClone(initialGraph)
  client = new MemoryIndex()
  disclosedInputs = []
  requests = []
  dependencies = {
    client: {
      sync(value) { disclosedInputs.push(structuredClone(value)); return client.sync(value) },
      search: (query, options, guard) => client.search(query, options, guard),
      invalidateSource: () => client.invalidateSource(),
    },
    readProject: async () => structuredClone(project),
    readGraph: async () => structuredClone(graph),
  }
}
const remote = {
  embedding: { protocol: 'jina' as const, endpoint: 'https://writer.test/embeddings', model: 'synthetic', apiKey: 'session-test-only', dimensions: 2 },
  rerank: { endpoint: 'https://writer.test/rerank', model: 'synthetic', apiKey: 'session-test-only' },
}

try {
  reset()
  const prepared = await prepareWriterMemoryContext(request, dependencies)
  assert.equal(requests.length, 0)
  assert.equal(disclosedInputs[0]!.chapters.length, 40)
  assert.ok(prepared.hits.some(hit => hit.chapterId === 'c2' && hit.quote.includes('铜铃')))
  assert.ok(prepared.relations.some(row => row.origin === 'inferred' && row.authorConfirmed))
  assert.ok(!prepared.prompt.includes('玄衣客'))
  assert.ok(!prepared.prompt.includes('session-test-only'))
  assert.ok(prepared.prompt.length <= 10_000)
  const envelope = JSON.parse(prepared.prompt.split(`${WRITER_MEMORY_MARKER}\n`)[1]!) as { sources: Array<{ revision: string; quote: string }>; relations: Array<{ origin: string; authorConfirmed: boolean }> }
  assert.ok(envelope.sources.length && envelope.relations.some(row => row.origin === 'inferred' && row.authorConfirmed))
  for (const hit of prepared.hits) {
    const chapter = project!.chapters.find(row => row.id === hit.chapterId)!
    assert.equal(hit.revision, await chapterRevision(chapter))
    assert.equal(chapter.text.slice(hit.start, hit.end), hit.quote)
  }
  await prepared.assertFresh()
  project!.chapters[79]!.text += '未来章节的改稿不会改变已披露前缀。'
  await prepared.assertFresh()
  project!.chapters[1]!.text = '铜铃的约定已经改为红色烟火。'
  await assert.rejects(prepared.assertFresh(), /已改变/)
  const updated = await prepareWriterMemoryContext(request, dependencies)
  assert.ok(!updated.prompt.includes('听见三声铃响就去西渡口'))
  assert.ok(!updated.relations.some(row => row.id === 'demo-reunion-inference'))
  console.log('✓ Default local-only bundle exposes exact current evidence, distant clues and independent inference/confirmation provenance; edited old facts expire')

  reset()
  const early = await prepareWriterMemoryContext({ ...request, throughChapterId: 'c2' }, dependencies)
  assert.ok(!early.relations.some(row => row.origin === 'inferred'), 'All inference premises must be disclosed')
  await assert.rejects(prepareWriterMemoryContext({ ...request, throughChapterId: 'c80' }, dependencies), /已改变/)
  await assert.rejects(prepareWriterMemoryContext({ ...request, expectedTarget: { ...project!.chapters[39]!, text: 'unsaved editor text' } }, dependencies), /已改变/)
  const matchingTarget = await prepareWriterMemoryContext({ ...request, expectedTarget: project!.chapters[39]! }, dependencies)
  project!.chapters[39]!.text += '同一章被另一个窗口修改。'
  await assert.rejects(matchingTarget.assertFresh(), /已改变/)
  reset()
  const changedGraph = await prepareWriterMemoryContext(request, dependencies)
  graph!.relations[0]!.authorConfirmed = !graph!.relations[0]!.authorConfirmed
  await assert.rejects(changedGraph.assertFresh(), /已改变/, 'Graph content changes cannot hide behind a reused revision token')
  project!.chapters.reverse()
  await assert.rejects(changedGraph.assertFresh(), /已改变/)
  console.log('✓ Target/cutoff, saved-editor equality, every graph premise and graph modifications are checked independently of timestamps')

  reset()
  const bounded = await prepareWriterMemoryContext({ ...request, maxChars: 1_000 }, dependencies)
  assert.ok(bounded.prompt.length <= 1_000)
  assert.ok(bounded.truncated)
  for (const relation of bounded.relations) {
    assert.deepEqual(relation.evidence.map(({ chapterTitle: _title, ordinal: _ordinal, ...anchor }) => anchor), graph!.relations.find(row => row.id === relation.id)!.evidence)
  }
  const absent = await prepareWriterMemoryContext({ ...request, query: 'ZZZUNMATCHED0123456789' }, dependencies)
  assert.equal(absent.prompt, '')
  assert.deepEqual(absent.hits, [])
  assert.deepEqual(absent.relations, [])
  for (const options of [{ maxChars: 999 }, { maxChars: 16_001 }, { limit: 13 }, { query: ' ' }]) {
    await assert.rejects(prepareWriterMemoryContext({ ...request, ...options }, dependencies), /需要/)
  }
  console.log('✓ Budgets include framing and full provenance; whole oversized items are omitted, and no-answer retrieval produces no injected memory')

  reset()
  // Author labels can leak later identities despite having a valid early anchor.
  project!.clues[0]!.label = '玄衣客未来身份不应出现在生成上下文'
  graph!.relations.find(row => row.id === 'demo-bell-signal')!.predicate = '玄衣客的未来身份泄漏不能成为写作事实'
  const safeLabel = await prepareWriterMemoryContext(request, dependencies)
  assert.ok(!safeLabel.prompt.includes('玄衣客'))
  assert.equal(safeLabel.relations.find(row => row.id === 'demo-bell-signal')!.predicate, '原文关联')
  const realSearch = dependencies!.client.search
  dependencies!.client.search = async (...args) => {
    const value = await realSearch(...args)
    for (const hit of value.hits) hit.revision = '0'.repeat(64)
    return value
  }
  const tampered = await prepareWriterMemoryContext({ ...request, includeGraph: false }, dependencies)
  assert.equal(tampered.prompt, '', 'Independently hash current source instead of trusting returned hit revisions')
  console.log('✓ Ungrounded clue labels and graph predicates cannot leak later identities; hit revisions are independently verified before serialization')

  reset()
  const semantic = await prepareWriterMemoryContext({ ...request, remote }, dependencies)
  assert.equal(semantic.diagnostics.semantic, 'used')
  assert.equal(semantic.diagnostics.rerank, 'used')
  assert.ok(requests.length >= 3)
  assert.ok(!JSON.stringify(semantic).includes('session-test-only'))
  assert.ok(!JSON.stringify(semantic).includes('writer.test'))
  const currentQuotes = new Set(disclosedInputs[0]!.chapters.flatMap(chapter => [chapter.text]))
  for (const { body } of requests) {
    for (const text of (body.documents ?? (body.task === 'retrieval.passage' ? body.input : [])) as string[]) {
      assert.ok([...currentQuotes].some(chapter => chapter.includes(text)))
    }
  }
  console.log('✓ Explicit semantic/rerank settings dispatch only disclosed source text, with credentials absent from the approved bundle')

  reset()
  mutateAfterRequest = () => { project!.chapters[0]!.text = '第一批请求后旧章已经重写。' }
  await assert.rejects(prepareWriterMemoryContext({ ...request, remote }, dependencies), /校验失败|已改变/)
  assert.equal(requests.length, 1, 'Each provider batch checks committed freshness, rather than only checking after all remote work')
  reset()
  mutateAfterRequest = () => { graph!.revision = 'changed-during-rerank' }
  await assert.rejects(prepareWriterMemoryContext({ ...request, remote: { rerank: remote.rerank } }, dependencies), /已改变/)
  assert.equal(requests.length, 1)
  console.log('✓ Edits between embedding batches block further requests; graph edits during the final rerank reject the preview')

  reset()
  const aborter = new AbortController()
  aborter.abort()
  await assert.rejects(prepareWriterMemoryContext(request, { ...dependencies!, signal: aborter.signal }), /取消/)
  assert.equal(disclosedInputs!.length, 0)
  const active = new AbortController()
  const search = dependencies!.client.search
  dependencies!.client.search = async (...args) => {
    const value = await search(...args)
    active.abort()
    return value
  }
  await assert.rejects(prepareWriterMemoryContext(request, { ...dependencies!, signal: active.signal }), /取消/)
  assert.equal(requests.length, 0)
  console.log('✓ Already-cancelled and mid-retrieval operations never publish a bundle or start unrequested external work')

  reset()
  let releaseOld!: () => void
  let oldRead = true
  const concurrentDependencies = {
    ...dependencies!,
    readProject: async () => {
      if (oldRead) {
        oldRead = false
        await new Promise<void>(resolve => { releaseOld = resolve })
      }
      return structuredClone(project!)
    },
  }
  const obsolete = prepareWriterMemoryContext(request, concurrentDependencies)
  const latest = await prepareWriterMemoryContext(request, concurrentDependencies)
  releaseOld()
  await assert.rejects(obsolete, /替代/)
  await latest.assertFresh()
  assert.ok((await client!.search({ text: '铜铃', throughChapterId: 'c40' })).hits.length > 0,
    'Late failure of the obsolete prepare must not invalidate a newer preview index')
  console.log('✓ A delayed obsolete preview cannot invalidate its successor or acknowledge another operation’s provider guard')
  console.log('\n=== ALL WRITER MEMORY TESTS PASSED ===')
} finally { globalThis.fetch = originalFetch }
