import assert from 'node:assert/strict'
import { MemoryIndex } from '../src/services/memory/engine'
import { memoryIdentifiers } from '../src/services/memory/identifiers'
import { chapterRevision } from '../src/services/memory/revision'
import type { MemoryChapterInput, MemoryClue, MemoryProjectInput, MemorySearchResult } from '../src/types/memory'
import { createStressNovel } from './fixtures/memory-stress-corpus'

const chapter = (id: string, text: string, title = '封存记录'): MemoryChapterInput => ({ id, title, text })
const project = (chapters: MemoryChapterInput[], clues: MemoryClue[] = [], id = 'mixed-query'): MemoryProjectInput => ({
  id, title: '混合查询验收', chapters, clues,
})
const exact = (result: MemorySearchResult) => result.hits.filter(hit => hit.reason.includes('完整编号匹配'))
const query = (text: string, throughChapterId: string, limit = 6) => ({ text, throughChapterId, limit })
async function clue(source: MemoryChapterInput, quote: string, id: string, aliases: string[] = []): Promise<MemoryClue> {
  const start = source.text.indexOf(quote)
  assert.ok(start >= 0)
  return { id, chapterId: source.id, sourceRevision: await chapterRevision(source), start, end: start + quote.length,
    quote, label: '作者约定', aliases }
}
async function check(result: MemorySearchResult, source: MemoryProjectInput, cutoff: string) {
  const maximum = source.chapters.findIndex(item => item.id === cutoff)
  for (const hit of result.hits) {
    const position = source.chapters.findIndex(item => item.id === hit.chapterId)
    assert.ok(position >= 0 && position <= maximum)
    const sourceChapter = source.chapters[position]!
    assert.equal(hit.projectId, source.id)
    assert.equal(hit.ordinal, position + 1)
    assert.equal(hit.revision, await chapterRevision(sourceChapter))
    assert.equal(hit.quote, sourceChapter.text.slice(hit.start, hit.end))
  }
}

// This is the actual previously failing fixture, including the lexical background
// that makes short wrong-code matches outrank a 1,199-character exact source.
const fixture = await createStressNovel({ chapters: 600, charsPerChapter: 2_400 })
const index = new MemoryIndex()
await index.sync({ ...fixture.project, clues: [] })
const probe = fixture.facts[0]!
const rescued = await index.search(query(probe.query, probe.throughChapterId))
assert.equal(rescued.hits[0]!.chapterId, probe.chapterId, 'mixed query must rescue the old rank-42 source before local top-k')
assert.equal(rescued.hits[0]!.quote.length, 1_199)
assert.ok(rescued.hits[0]!.quote.includes(probe.quote))
assert.match(rescued.hits[0]!.reason, /完整编号匹配（原文）/)
await check(rescued, fixture.project, probe.throughChapterId)
console.log('✓ 原 600 章失败语料：中文＋编号找回 1,199 字原文，真实引用与披露范围一致')

assert.deepEqual(memoryIdentifiers('铜符AB-12，ab-12，档案ZX_45，FS00001，A1，1B，2026，ordinary'), ['ab-12', 'zx_45', 'fs00001', 'a1', '1b'])
assert.deepEqual(memoryIdentifiers(`A${'1'.repeat(63)} A${'1'.repeat(64)} __A1 A1_ A--1 K1 ſ2`), [`a${'1'.repeat(63)}`])
const codes = ['FS00001', 'FS000010', 'XFS00001', 'FS00001X', 'AB-12', 'AB-120', 'ZX_45', 'ZX_450']
const coded = project(codes.map((code, position) => chapter(`code-${position}`, `铜符${code}交给慕容烬。`)))
await index.sync(coded)
for (const [position, code] of codes.entries()) {
  const result = await index.search(query(`铜符${code.toLowerCase()}`, 'code-7', 50))
  assert.equal(result.hits[0]!.chapterId, `code-${position}`)
  assert.deepEqual(exact(result).map(hit => hit.chapterId), [`code-${position}`], 'prefix or suffix near-matches stay keyword fallback')
}
const absent = await index.search(query('铜符AB-999', 'code-7'))
assert.ok(absent.hits.length > 0, 'unknown codes may retain explicitly labelled keyword fallback')
assert.equal(exact(absent).length, 0)
for (const text of ['2026', 'ordinary', '慕容烬']) {
  assert.equal(exact(await index.search(query(text, 'code-7'))).length, 0)
}
console.log('✓ 非固定格式编号、大小写、汉字边界、前后缀碰撞、连字符／下划线及无编号回退')

const multi = project([
  chapter('both', '铜符AB-12与匣子ZX_45由同一人看守。'),
  chapter('first', '铜符AB-12仍在旧仓。'), chapter('second', '匣子ZX_45送到东门。'),
])
await index.sync(multi)
const multiResult = await index.search(query('铜符AB-12 匣子ZX_45', 'second', 10))
assert.equal(multiResult.hits[0]!.chapterId, 'both', 'all-ID coverage must precede partial coverage locally')
assert.deepEqual(new Set(exact(multiResult).map(hit => hit.chapterId)), new Set(['both', 'first', 'second']))
assert.deepEqual((await index.search(query('铜符AB-12 AB-12 匣子ZX_45', 'second', 10))).hits.map(hit => hit.id), multiResult.hits.map(hit => hit.id))
assert.ok(exact(await index.search(query('AB-12 MISSING9', 'second', 10))).some(hit => hit.chapterId === 'first'), 'an absent second ID must not turn multi-ID search into hard AND')
const denseMulti = project([
  ...Array.from({ length: 40 }, (_, n) => chapter(`partial-${n}`, n % 2 ? '铜符AB-12仍在旧仓。' : '匣子ZX_45送到东门。')),
  chapter('late-complete', `铜符AB-12与匣子ZX_45由同一人看守。${fixture.project.chapters[0]!.text}`.slice(0, 1_199)),
])
await index.sync(denseMulti)
assert.equal((await index.search(query('铜符AB-12 匣子ZX_45', 'late-complete', 1))).hits[0]!.chapterId,
  'late-complete', 'coverage ranking must run before the candidate cap, even for a late long source behind many partial matches')
console.log('✓ 多编号完整覆盖优先，分散依据保留，重复与不存在的编号不会伪造完整覆盖')

const bodyOnly = chapter('body', '铜符BODY7仍在旧仓。')
const titleOnly = chapter('title', '渡口的灯尚未熄灭。', '档案TITLE8')
const aliasOnly = chapter('alias', '第三声更鼓后到桥边接应。')
const marked = await clue(aliasOnly, aliasOnly.text, 'alias-clue', ['接应ALIAS9'])
const origins = project([bodyOnly, titleOnly, aliasOnly], [marked])
await index.sync(origins)
assert.match(exact(await index.search(query('BODY7', 'alias')))[0]!.reason, /完整编号匹配（原文）/)
const titleHit = exact(await index.search(query('TITLE8', 'alias')))[0]!
assert.match(titleHit.reason, /完整编号匹配（章节标题）/)
assert.ok(!titleHit.quote.includes('TITLE8'))
const aliasHit = exact(await index.search(query('ALIAS9', 'alias')))[0]!
assert.match(aliasHit.reason, /完整编号匹配（作者标签／别名）/)
assert.ok(!aliasHit.quote.includes('ALIAS9'))
console.log('✓ 原文、章节标题、作者标签／别名分别说明来源，不把标注冒充为引文内容')

// Crossing a chunk or selected-clue edge must not invent a shorter code. The
// overlong whole token is deliberately excluded even if a fragment fits 64 chars.
const cross = chapter('cross', `${'甲'.repeat(1_193)}FS000010${'乙'.repeat(1_300)}`)
const splitSuffix = chapter('split-suffix', `${'甲'.repeat(1_079)}XFS00001${'乙'.repeat(1_300)}`)
const suffix = chapter('suffix', 'XFS00001仍在箱底。')
const oversized = chapter('oversized', `${'丙'.repeat(1_060)}${'A'.repeat(75)}1${'丁'.repeat(1_400)}`)
const boundaries = project([cross, splitSuffix, suffix, oversized], [await clue(cross, 'FS00001', 'prefix'), await clue(suffix, 'FS00001', 'suffix')])
await index.sync(boundaries)
assert.equal(exact(await index.search(query('FS00001', 'oversized', 50))).length, 0)
assert.ok(exact(await index.search(query('FS000010', 'oversized', 50))).some(hit => hit.chapterId === 'cross'))
assert.equal(exact(await index.search(query(`${'A'.repeat(55)}1`, 'oversized', 50))).length, 0)
console.log('✓ 分块／伏笔引用边缘及超长完整编号均不会制造较短的精确匹配')

// The selected quote, title and author annotation stay byte-for-byte identical;
// only the source character immediately outside the selected span changes.
const edgeSource = chapter('edge-only', 'XFS00001留在原处。')
const edgeProject = project([edgeSource], [await clue(edgeSource, 'FS00001', 'edge-only-clue')])
await index.sync(edgeProject)
assert.ok(!exact(await index.search(query('FS00001', 'edge-only'))).some(hit => hit.kind === 'clue'))
for (const adjacent of ['，', 'X']) {
  edgeProject.chapters[0]!.text = `${adjacent}FS00001留在原处。`
  edgeProject.clues[0]!.sourceRevision = await chapterRevision(edgeProject.chapters[0]!)
  const stats = await index.sync(edgeProject)
  assert.equal(stats.sync.mode, 'incremental')
  const result = await index.search(query('FS00001', 'edge-only'))
  assert.equal(exact(result).some(hit => hit.kind === 'clue'), adjacent === '，',
    'identifier membership must change when the unchanged selected quote gains or loses a real token boundary')
  const coldEdge = new MemoryIndex()
  await coldEdge.sync(edgeProject)
  assert.deepEqual(result.hits, (await coldEdge.search(query('FS00001', 'edge-only'))).hits)
}
console.log('✓ 引文自身不变而相邻原文字符变化时，增量更新仍撤销／恢复完整编号资格')

const crowded = project([
  chapter('early', '铜符AB-12放在桥边。'),
  ...Array.from({ length: 130 }, (_, n) => chapter(`future-${n}`, `铜符AB-12。未来秘密FUTURE${n}。`)),
])
await index.sync(crowded)
assert.deepEqual((await index.search(query('铜符AB-12', 'early', 1))).hits.map(hit => hit.chapterId), ['early'])
// Preserve insertion order from the old index, then move the previously-last
// source before every high-scoring future occurrence in narrative order.
crowded.chapters.unshift(crowded.chapters.pop()!)
await index.sync(crowded)
const front = await index.search(query('铜符AB-12', 'future-129', 1))
assert.deepEqual(front.hits.map(hit => hit.chapterId), ['future-129'])
await check(front, crowded, 'future-129')
await index.sync(project([chapter('other', '铜符AB-120属于另一部小说。')], [], 'other-project'))
assert.equal(exact(await index.search(query('AB-12', 'other'))).length, 0)
console.log('✓ 披露截止先于编号候选上限，重排旧插入顺序与跨项目切换不会混入后文／他书')

const edited = structuredClone(origins)
await index.sync(origins)
edited.chapters[0]!.text = edited.chapters[0]!.text.replace('BODY7', 'BODY6')
edited.chapters[1]!.title = '档案TITLE6'
edited.clues[0]!.aliases = ['接应ALIAS6']
await index.sync(edited)
for (const code of ['BODY7', 'TITLE8', 'ALIAS9']) assert.equal(exact(await index.search(query(code, 'alias'))).length, 0)
for (const code of ['BODY6', 'TITLE6', 'ALIAS6']) assert.ok(exact(await index.search(query(code, 'alias'))).length > 0)
edited.chapters.shift()
edited.chapters.reverse()
await index.sync(edited)
assert.equal(exact(await index.search(query('BODY6', 'title'))).length, 0)
const fresh = new MemoryIndex()
await fresh.sync(edited)
for (const code of ['BODY6', 'TITLE6', 'ALIAS6']) {
  assert.deepEqual((await index.search(query(code, 'title'))).hits, (await fresh.search(query(code, 'title'))).hits)
}
index.invalidateSource()
await assert.rejects(index.search(query('ALIAS6', 'title')), /尚未就绪/)
await index.sync(edited)
const invalid = structuredClone(edited)
invalid.chapters.push(invalid.chapters[0]!)
await assert.rejects(index.sync(invalid), /ID 重复/)
await assert.rejects(index.search(query('ALIAS6', 'title')), /尚未就绪/)
const cancelled = index.sync(fixture.project)
const cancelledFailure = assert.rejects(cancelled, /较新的项目快照/)
index.invalidateSource()
await cancelledFailure
await index.sync(edited)
assert.deepEqual((await index.search(query('ALIAS6', 'title'))).hits, (await fresh.search(query('ALIAS6', 'title'))).hits)
console.log('✓ 同长改稿、标题／别名修改、删除、失效与失败／取消构建后，增量和全量结果一致')

const originalFetch = globalThis.fetch
let requests = 0
let remoteQuotes: string[] = []
let expectedRemoteQuote = 'AB-12'
const hybridProject = project([
  chapter('exact', '铜符AB-12藏在桥下。'), chapter('semantic', '铜符旁放着旅人的旧伞。'),
  chapter('hidden', '铜符AB-12揭示未来身份FUTURE8。'),
])
try {
  globalThis.fetch = async (_url, init) => {
    requests++
    const body = JSON.parse(String(init?.body)) as { input?: string[]; task?: string; documents?: string[] }
    if (body.input) {
      if (body.task === 'retrieval.passage') assert.ok(body.input.every(text => !text.includes('FUTURE8')))
      return Response.json({ data: body.input.map((text, position) => ({ index: position,
        embedding: body.task === 'retrieval.query' || text.includes('旧伞') ? [1, 0] : [0, 1],
      })) })
    }
    remoteQuotes = body.documents!
    assert.ok(remoteQuotes.some(text => text.includes(expectedRemoteQuote)), 'rescued exact candidate reaches reranker')
    assert.ok(remoteQuotes.every(text => !text.includes('FUTURE8')))
    return Response.json({ results: remoteQuotes.map((text, position) => ({ index: position, relevance_score: text.includes('旧伞') ? 1 : 0 })) })
  }
  await index.sync(hybridProject)
  const local = await index.search(query('铜符AB-12', 'semantic'))
  assert.equal(local.hits[0]!.chapterId, 'exact')
  assert.equal(requests, 0, 'local identifier retrieval must not call any service')
  const semantic = await index.search(query('铜符AB-12', 'semantic'), {
    embedding: { endpoint: 'https://memory-test.example/embeddings', protocol: 'jina', model: 'mock', apiKey: 'test', dimensions: 2 },
  })
  assert.equal(semantic.diagnostics.semantic, 'used')
  assert.equal(semantic.hits[0]!.chapterId, 'semantic', 'explicit semantic ranking keeps authority over local code priority')
  const reranked = await index.search(query('铜符AB-12', 'semantic'), {
    rerank: { endpoint: 'https://memory-test.example/rerank', model: 'mock', apiKey: 'test' },
  })
  assert.equal(reranked.diagnostics.rerank, 'used')
  assert.equal(reranked.hits[0]!.chapterId, 'semantic', 'explicit remote reranking keeps final authority')
  await check(reranked, hybridProject, 'semantic')

  const fallbackProject = structuredClone(hybridProject)
  fallbackProject.clues.push(await clue(fallbackProject.chapters[0]!, fallbackProject.chapters[0]!.text, 'fallback-clue'))
  await index.sync(fallbackProject)
  const embedding = { endpoint: 'https://memory-test.example/embeddings', protocol: 'jina' as const,
    model: 'mock', apiKey: 'test', dimensions: 2 }
  const legacyFallback = await index.search(query('铜符 MISSING', 'semantic'), { embedding })
  for (const identifier of ['MISSING9', 'FUTURE8']) {
    const fallback = await index.search(query(`铜符 ${identifier}`, 'semantic'), { embedding })
    assert.deepEqual(fallback.hits, legacyFallback.hits,
      'absent or undisclosed IDs must preserve legacy keyword/clue/semantic balance when exact rescue contributes nothing')
    assert.equal(exact(fallback).length, 0)
  }

  // Rescued long exact evidence is admitted to the real rerank payload, even
  // when the old ordinary lexical channel had dropped it far below top-k.
  await index.sync({ ...fixture.project, clues: [] })
  expectedRemoteQuote = probe.quote
  const longReranked = await index.search(query(probe.query, probe.throughChapterId), {
    rerank: { endpoint: 'https://memory-test.example/rerank', model: 'mock', apiKey: 'test' },
  })
  assert.equal(longReranked.diagnostics.rerank, 'used')
  assert.ok(remoteQuotes.some(text => text.includes(probe.quote)))
} finally {
  globalThis.fetch = originalFetch
}
console.log('✓ 默认零网络请求；显式语义／重排保留排序权并收到已补回的当前披露证据')
console.log('=== ALL MIXED QUERY RETRIEVAL TESTS PASSED ===')
