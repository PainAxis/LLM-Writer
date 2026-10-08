import assert from 'node:assert/strict'
import { MemoryIndex } from '../src/services/memory/engine'
import { identifierEdges } from '../src/services/memory/identifiers'
import { buildMemoryMatch, summarizeMemoryMatches } from '../src/services/memory/matchSignals'
import { chapterRevision } from '../src/services/memory/revision'
import type { MemoryChapterInput, MemoryMatchSignals, MemoryProjectInput } from '../src/types/memory'

const source = (quote: string, chapterTitle = '', annotations: string[] = [], quoteEdges = 0) => ({ quote, chapterTitle, annotations, quoteEdges })
const summary = (query: string, ...matches: MemoryMatchSignals[]) => summarizeMemoryMatches(query, matches)
const chapter = (id: string, text: string, title = '夜行'): MemoryChapterInput => ({ id, title, text })
const project = (chapters: MemoryChapterInput[]): MemoryProjectInput => ({ id: 'match-signals', title: '待核对的候选', chapters, clues: [] })

assert.deepEqual(summary('铜铃'), { answerability: 'unverified', state: 'none', requestedIdentifiers: [], missingIdentifiers: [] })
const partial = buildMemoryMatch('铜铃何时送达', source('铜铃挂在窗边。'))
assert.deepEqual(partial.literal, { quote: false, title: false, annotation: false })
assert.equal(summary('铜铃何时送达', partial).state, 'candidates')
const phrase = buildMemoryMatch('铜铃的来历', source('他问起铜铃的来历，可惜谁也没有回答。'))
assert.equal(phrase.literal.quote, true)
assert.equal(summary('铜铃的来历', phrase).state, 'matched')
assert.equal(phrase.answerability, 'unverified', 'a whole query in an unanswered question does not establish an answer')
assert.equal(summary('铜铃的来历', phrase).answerability, 'unverified')
assert.equal(buildMemoryMatch('king', source('The kingdom was silent.')).literal.quote, false)
assert.equal(buildMemoryMatch('King', source('The king was silent.')).literal.quote, true)
assert.equal(buildMemoryMatch('', source('任意原文。')).literal.quote, false)
console.log('✓ 空结果、部分词面和完整查询分开；完整词面、否定／未回答语句均不等于答案')

const full = buildMemoryMatch('铜符ab-12', source('铜符AB-12由顾宁保管。'))
assert.equal(full.literal.quote, true)
assert.deepEqual(full.identifiers.quote, ['ab-12'])
for (const quote of ['铜符AB-120归甲。', 'XAB-12归甲。', 'AB-12X归甲。']) {
  const match = buildMemoryMatch('AB-12', source(quote))
  assert.equal(match.literal.quote, false)
  assert.deepEqual(match.identifiers.quote, [])
  assert.equal(summary('AB-12', match).state, 'candidates')
}
const elsewhere = buildMemoryMatch('铜符AB-12', source('铜符AB-120归甲。AB-12归乙。'))
assert.equal(elsewhere.literal.quote, false, 'a valid code elsewhere cannot bless a prefix occurrence of the complete query')
assert.deepEqual(elsewhere.identifiers.quote, ['ab-12'])
assert.equal(buildMemoryMatch('AB1 AB1', source('XAB1 AB1')).literal.quote, false, 'repeated valid code cannot bless a clipped first occurrence')
assert.equal(buildMemoryMatch('铜符AB-12', source('铜符AB-120。后来铜符AB-12归还。')).literal.quote, true, 'later valid complete occurrence survives an earlier prefix collision')
for (const query of [`A${'1'.repeat(64)}`, 'AB--12', '_AB12', 'AB12_']) {
  const match = buildMemoryMatch(query, source(query))
  assert.equal(match.literal.quote, false, 'unsupported code-shaped query must remain an unverified candidate')
  assert.equal(summary(query, match).state, 'candidates')
}
console.log('✓ 完整编号与混合查询逐次检查词边界，近似码、重复码及异常／超长码不能绕过')

const whole = 'XFS000010'
for (const [start, end] of [[1, 8], [0, 8], [1, 9]] as const) {
  const quote = whole.slice(start, end)
  const match = buildMemoryMatch(quote, source(quote, '', [], identifierEdges(whole, start, end)))
  assert.equal(match.literal.quote, false)
  assert.deepEqual(match.identifiers.quote, [])
}
const edgeField = buildMemoryMatch('FS00001', source('FS00001', 'FS00001', ['FS00001'], 3))
assert.deepEqual(edgeField.literal, { quote: false, title: true, annotation: true })
assert.deepEqual(edgeField.identifiers, { quote: [], title: ['fs00001'], annotation: ['fs00001'] })
console.log('✓ 引用外的源文邻字符阻止截断编号；标题与单项标注保留独立边界')

const metadata = buildMemoryMatch('铜符AB-12', source('窗边挂着铜铃。', '铜符AB-12', ['铜符AB-12', '未来身份SECRET99']))
assert.deepEqual(metadata.literal, { quote: false, title: true, annotation: true })
assert.deepEqual(metadata.identifiers, { quote: [], title: ['ab-12'], annotation: ['ab-12'] })
assert.ok(!JSON.stringify(metadata).includes('SECRET99'), 'signals cannot reveal arbitrary annotation contents')
const splitAnnotations = buildMemoryMatch('铜铃\n接应', source('雨落在石桥边。', '', ['铜铃', '接应']))
assert.equal(splitAnnotations.literal.annotation, false, 'separate labels and aliases must not be concatenated into a false phrase')
const splitCodes = buildMemoryMatch('AB1 CD2', source('雨落在石桥边。', '', ['AB1', 'CD2']))
assert.equal(splitCodes.literal.annotation, false)
assert.deepEqual(splitCodes.identifiers.annotation, ['ab1', 'cd2'])
const query = 'AB1 CD2 AB1 MISSING9'
const one = buildMemoryMatch(query, source('AB1由顾宁保管。'))
const two = buildMemoryMatch(query, source('CD2仍在旧仓。'))
assert.deepEqual(summary(query, one, two), {
  answerability: 'unverified', state: 'matched', requestedIdentifiers: ['ab1', 'cd2', 'missing9'], missingIdentifiers: ['missing9'],
})
assert.deepEqual(summary(query, one).missingIdentifiers, ['cd2', 'missing9'], 'summary changes with the supplied subset, not unseen candidates')
console.log('✓ 原文／标题／单项标注来源独立，不输出标签秘密；多编号跨所选依据聚合且缺失只限当前集合')

const index = new MemoryIndex()
const input = project([chapter('early', '铜铃挂在窗边。铜符AB-120仍在旧仓。'), chapter('future', '铜符AB-12来自未来身份SECRET8。')])
await index.sync(input)
const weak = await index.search({ text: '铜符AB-12', throughChapterId: 'early' })
assert.ok(weak.hits.length > 0)
assert.ok(weak.hits.every(hit => hit.match?.answerability === 'unverified'))
assert.equal(weak.assessment?.state, 'candidates')
assert.deepEqual(weak.assessment?.missingIdentifiers, ['ab-12'])
assert.ok(!JSON.stringify(weak.hits).includes('SECRET8'))
const disclosed = await index.search({ text: '铜符AB-12', throughChapterId: 'future' })
assert.equal(disclosed.assessment?.state, 'matched')
assert.deepEqual(disclosed.assessment?.missingIdentifiers, [])
disclosed.hits[0]!.match!.identifiers.quote.push('forged')
disclosed.assessment!.missingIdentifiers.push('forged')
assert.ok(!JSON.stringify(await index.search({ text: '铜符AB-12', throughChapterId: 'future' })).includes('forged'))
input.chapters[1]!.text = '铜符AB-13来自未来身份SECRET8。'
await index.sync(input)
assert.deepEqual((await index.search({ text: '铜符AB-12', throughChapterId: 'future' })).assessment?.missingIdentifiers, ['ab-12'])
assert.equal((await index.search({ text: '完全无关的量子引擎', throughChapterId: 'early' })).assessment?.state, 'none')
console.log('✓ engine生产结果包含结构化signals；旧修订、未披露编号与返回对象篡改不污染当前集合')

const annotated = project([chapter('clue', '雨落在石桥边。')])
annotated.clues = [{ id: 'clue', chapterId: 'clue', sourceRevision: await chapterRevision(annotated.chapters[0]!),
  start: 0, end: annotated.chapters[0]!.text.length, quote: annotated.chapters[0]!.text, label: '铜铃', aliases: ['接应'] }]
await index.sync(annotated)
const before = await index.search({ text: '铜铃\n接应', throughChapterId: 'clue' })
assert.equal(before.assessment?.state, 'candidates')
annotated.clues[0]!.label = '铜铃\n接应'
annotated.clues[0]!.aliases = []
assert.equal((await index.sync(annotated)).sync.insertedDocuments, 1, 'same joined string with changed field boundaries must refresh per-field signals')
const after = await index.search({ text: '铜铃\n接应', throughChapterId: 'clue' })
assert.equal(after.assessment?.state, 'matched')
assert.equal(after.hits[0]!.match!.literal.annotation, true)
const cold = new MemoryIndex()
await cold.sync(annotated)
assert.deepEqual(after.hits, (await cold.search({ text: '铜铃\n接应', throughChapterId: 'clue' })).hits)
console.log('✓ 相同拼接文本但不同标签／别名边界的增量更新与冷构建一致')

const originalFetch = globalThis.fetch
let requests = 0
try {
  globalThis.fetch = async (_url, init) => {
    requests++
    const body = JSON.parse(String(init?.body)) as { input?: string[]; task?: string; documents?: string[] }
    if (body.input) return Response.json({ data: body.input.map((_, index) => ({ index, embedding: [1, 0] })) })
    return Response.json({ results: body.documents!.map((_, index) => ({ index, relevance_score: 1e12 })) })
  }
  await index.sync(project([chapter('only', '旅人买了糕点，随后返回客栈。')]))
  const onlySemantic = await index.search({ text: '古塔下的暗号', throughChapterId: 'only' }, {
    embedding: { endpoint: 'https://memory-test.example/embed', protocol: 'jina', model: 'synthetic', apiKey: 'test', dimensions: 2 },
    rerank: { endpoint: 'https://memory-test.example/rerank', model: 'synthetic', apiKey: 'test' },
  })
  assert.equal(onlySemantic.diagnostics.semantic, 'used')
  assert.equal(onlySemantic.diagnostics.rerank, 'used')
  assert.equal(requests, 3)
  assert.equal(onlySemantic.hits[0]!.score, 1e12)
  assert.equal(onlySemantic.assessment?.state, 'candidates')
  assert.equal(onlySemantic.assessment?.answerability, 'unverified')
  assert.equal(onlySemantic.hits[0]!.match?.answerability, 'unverified')
} finally {
  globalThis.fetch = originalFetch
}
console.log('✓ 语义完全相似与极高重排分数均不能把间接候选升级为答案；仅使用本地mock')
console.log('=== ALL MEMORY MATCH SIGNALS TESTS PASSED ===')
