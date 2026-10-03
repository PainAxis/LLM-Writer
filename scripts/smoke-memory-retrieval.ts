import assert from 'node:assert/strict'
import { MemoryIndex } from '../src/services/memory/engine'
import { chapterRevision } from '../src/services/memory/revision'
import type { MemoryChapterInput, MemoryClue, MemoryProjectInput, MemorySearchResult } from '../src/types/memory'

const chapter = (id: string, text: string): MemoryChapterInput => ({ id, title: `章节 ${id}`, text })
const project = (chapters: MemoryChapterInput[], clues: MemoryClue[] = [], id = 'novel-A'): MemoryProjectInput => ({
  id, title: '可验证的小说素材', chapters, clues,
})

async function clue(chapter: MemoryChapterInput, quote: string, overrides: Partial<MemoryClue> = {}): Promise<MemoryClue> {
  const start = chapter.text.indexOf(quote)
  assert.ok(start >= 0)
  return {
    id: 'clue-coin', chapterId: chapter.id, sourceRevision: await chapterRevision(chapter),
    start, end: start + quote.length, quote, label: '缺角铜钱', aliases: ['旧朝信物'], ...overrides,
  }
}

function validateEvidence(result: MemorySearchResult, input: MemoryProjectInput, cutoff: string) {
  const end = input.chapters.findIndex(item => item.id === cutoff)
  for (const hit of result.hits) {
    assert.equal(hit.projectId, input.id)
    const position = input.chapters.findIndex(item => item.id === hit.chapterId)
    assert.ok(position >= 0 && position <= end, 'every result must be disclosed')
    assert.equal(hit.ordinal, position + 1)
    assert.equal(hit.quote, input.chapters[position]!.text.slice(hit.start, hit.end), 'evidence must be exact original text')
    assert.match(hit.revision, /^[a-f0-9]{64}$/)
  }
}

const source = chapter('c1', '姜暝珩打开木盒。盒底压着一枚缺角铜钱，内侧刻着双燕。她把铜钱交给沈澈。')
const marked = await clue(source, '盒底压着一枚缺角铜钱，内侧刻着双燕。')
const middle = Array.from({ length: 78 }, (_, index) => chapter(`c${index + 2}`, '雨停之后，商队继续沿着官道赶路。'))
const secret = chapter('c80', '宁玄璟才是鸦面使者。缺角铜钱就是旧朝遗宝的凭证。')
const input = project([source, ...middle, secret], [marked])
const index = new MemoryIndex()
const initialStats = await index.sync(input)
assert.equal(initialStats.clues, 1)
assert.equal(initialStats.staleClues, 0)
assert.equal(initialStats.chapters.length, 80)

const distant = await index.search({ text: '旧朝信物', throughChapterId: 'c79' })
assert.ok(distant.hits.some(hit => hit.kind === 'clue' && hit.chapterId === 'c1'), 'author alias recovers a distant clue absent from source wording')
validateEvidence(distant, input, 'c79')
assert.ok(!JSON.stringify(distant.hits).includes('鸦面使者'))
assert.equal((await index.search({ text: '鸦面使者', throughChapterId: 'c79' })).hits.length, 0)
assert.ok((await index.search({ text: '鸦面使者', throughChapterId: 'c80' })).hits.some(hit => hit.chapterId === 'c80'))
assert.ok((await index.search({ text: '姜暝珩', throughChapterId: 'c1' })).hits.some(hit => hit.quote.includes('姜暝珩')), 'unfamiliar Chinese name remains searchable')
console.log('✓ 伏笔别名跨 79 章找回，中文专名命中，后文身份受披露截止限制')

// Large numbers of high-scoring later matches must not crowd the earlier evidence out of top-k.
const crowdedInput = project([
  chapter('early', '石桥边的铜钱落入草丛。'),
  ...Array.from({ length: 120 }, (_, i) => chapter(`later-${i}`, `铜钱。铜钱。铜钱。未来专属暗号${i}。`)),
])
await index.sync(crowdedInput)
const crowded = await index.search({ text: '铜钱', throughChapterId: 'early', limit: 1 })
assert.equal(crowded.hits.length, 1)
assert.equal(crowded.hits[0]!.chapterId, 'early')
assert.ok(!JSON.stringify(crowded.hits).includes('未来专属暗号'))
validateEvidence(crowded, crowdedInput, 'early')
console.log('✓ 截止过滤发生在 top-k 之前，120 个未来章节不能挤走早期依据')

// Both the source revision and stale author annotations disappear after an edit, even on same chapter ID.
const edited = structuredClone(input)
edited.chapters[0]!.text = '姜暝珩打开木盒，里面只有一张白纸。她把白纸交给顾宁。'
const rebuilding = index.sync(edited)
await assert.rejects(index.search({ text: '铜钱', throughChapterId: 'c79' }), /尚未就绪/)
const editedStats = await rebuilding
assert.equal(editedStats.staleClues, 1)
assert.equal(editedStats.clues, 0)
assert.notEqual(editedStats.chapters[0]!.revision, initialStats.chapters[0]!.revision)
assert.equal((await index.search({ text: '旧朝信物', throughChapterId: 'c79' })).hits.length, 0)
const changed = await index.search({ text: '姜暝珩', throughChapterId: 'c79' })
assert.ok(changed.hits.some(hit => hit.quote.includes('顾宁')))
assert.ok(!JSON.stringify(changed.hits).includes('沈澈'))
validateEvidence(changed, edited, 'c79')
console.log('✓ 旧章修订立即阻止旧索引读取，旧事实及旧版本伏笔不再返回')

const changedTitle = structuredClone(input)
changedTitle.chapters[0]!.title = '改名后的雨夜'
assert.equal((await index.sync(changedTitle)).staleClues, 1, 'chapter title participates in revisions')
const invalidClues = project([source], [
  { ...marked, quote: '不存在的引用' },
  { ...marked, id: 'bad-span', start: -1 },
  { ...marked, id: 'fraction', end: 1.5 },
  { ...marked, id: 'deleted', chapterId: 'deleted' },
  { ...marked, id: 'wrong-revision', sourceRevision: '0'.repeat(64) },
])
const invalidStats = await index.sync(invalidClues)
assert.equal(invalidStats.staleClues, 5)
assert.equal(invalidStats.clues, 0)
console.log('✓ 错误引用、非法偏移、已删章节和旧修订伏笔均被排除')

const reordered = project([secret, ...middle, source], [marked])
await index.sync(reordered)
assert.ok((await index.search({ text: '旧朝信物', throughChapterId: 'c2' })).hits.every(hit => hit.chapterId !== 'c1'))
assert.ok((await index.search({ text: '旧朝信物', throughChapterId: 'c1' })).hits.some(hit => hit.kind === 'clue'))
const deleted = project([...middle], [marked])
assert.equal((await index.sync(deleted)).staleClues, 1)
await assert.rejects(index.search({ text: '铜钱', throughChapterId: 'c1' }), /截止章节不存在/)
await assert.rejects(index.search({ text: '铜钱', throughChapterId: '', limit: 2 }), /检索条件无效/)
await assert.rejects(index.search({ text: '铜钱', throughChapterId: 'c2', limit: 0 }), /检索条件无效/)
assert.equal((await index.search({ text: '铜钱', throughChapterId: 'c79' })).hits.length, 0)
console.log('✓ 章节重排按当前披露顺序生效，删除与非法截止都不会扩大可见范围')

const other = project([chapter('c1', '铜钱被另一部小说里的许棠收藏。')], [], 'novel-B')
await index.sync(other)
const isolated = await index.search({ text: '铜钱', throughChapterId: 'c1' })
assert.equal(isolated.projectId, 'novel-B')
assert.ok(isolated.hits.length > 0)
assert.ok(isolated.hits.every(hit => hit.projectId === 'novel-B' && !hit.quote.includes('沈澈')))
validateEvidence(isolated, other, 'c1')

const immutable = project([chapter('c1', '铜钱藏在井底。')])
const syncingSnapshot = index.sync(immutable)
immutable.chapters[0]!.text = '调用者稍后改写的文本不应修改已经捕获的快照。'
const snapshotStats = await syncingSnapshot
snapshotStats.chapters[0]!.revision = 'caller tampered with returned stats'
snapshotStats.chapters[0]!.ordinal = 999
assert.equal((await index.search({ text: '铜钱', throughChapterId: 'c1' })).hits[0]!.quote, '铜钱藏在井底。')
console.log('✓ 项目隔离，输入和返回统计的外部修改不能污染索引快照')

const invalidProject = project([chapter('duplicate', '旧版本'), chapter('duplicate', '新版本')])
await assert.rejects(index.sync(invalidProject), /ID 重复/)
await assert.rejects(index.search({ text: '铜钱', throughChapterId: 'c1' }), /尚未就绪/)
await assert.rejects(index.sync(project([chapter('huge', '字'.repeat(2_000_001))])), /单章超过/)
await assert.rejects(index.search({ text: '铜钱', throughChapterId: 'c1' }), /尚未就绪/)

const older = index.sync(project(Array.from({ length: 300 }, (_, i) => chapter(`slow-${i}`, '铜钱属于旧项目。')), [], 'older'))
const olderFailure = assert.rejects(older, /较新的项目快照/)
await index.sync(other)
await olderFailure
assert.equal((await index.search({ text: '铜钱', throughChapterId: 'c1' })).projectId, 'novel-B')
const inFlightSearch = index.search({ text: '铜钱', throughChapterId: 'c1' })
const staleSearchFailure = assert.rejects(inFlightSearch, /快照已变化/)
await index.sync(input)
await staleSearchFailure
console.log('✓ 构建失败后保持阻止检索；较旧构建和检索无法覆盖新快照')

// Long paragraph splitting must preserve UTF-16 evidence spans without cutting emoji surrogate pairs.
const longText = `${'🌧姜暝珩夜行。'.repeat(800)}\n\n结尾是一张折好的车票。`
const longProject = project([chapter('long', longText)])
const longStats = await index.sync(longProject)
assert.ok(longStats.chunks > 1)
const longResults = await index.search({ text: '姜暝珩', throughChapterId: 'long', limit: 50 })
validateEvidence(longResults, longProject, 'long')
assert.ok(longResults.hits.length > 1)
for (const hit of longResults.hits) {
  assert.ok(hit.quote.length <= 1_200)
  assert.ok(!/^[\udc00-\udfff]/u.test(hit.quote))
  assert.ok(!/[\ud800-\udbff]$/u.test(hit.quote))
}
const damagedTexts = ['\ud83c', '\udf27', '钥匙\ud83c', '\udf27钥匙', `${'甲'.repeat(1_199)}\ud83c`, `${'甲'.repeat(1_199)}🌧钥匙`]
const damagedProject = project(damagedTexts.map((text, i) => ({ id: `damaged-${i}`, title: '断码样本', text })))
const damagedStats = await index.sync(damagedProject)
assert.equal(damagedStats.chunks, 7, 'lone surrogates must make forward progress without duplicate or empty chunks')
const damagedHits = await index.search({ text: '断码样本', throughChapterId: 'damaged-5', limit: 50 })
validateEvidence(damagedHits, damagedProject, 'damaged-5')
assert.equal(damagedHits.hits.find(hit => hit.chapterId === 'damaged-0')!.quote, '\ud83c')
assert.equal(damagedHits.hits.find(hit => hit.chapterId === 'damaged-1')!.quote, '\udf27')
assert.equal(damagedHits.hits.find(hit => hit.chapterId === 'damaged-4')!.quote, damagedTexts[4])
const characterQuery = await index.search({ text: '钥', throughChapterId: 'damaged-5' })
assert.ok(characterQuery.hits.length > 0 && characterQuery.hits.every(hit => hit.quote.includes('钥匙')), 'single Han query must match inside a segmented word')
const empty = project([])
assert.equal((await index.sync(empty)).chunks, 0)
await assert.rejects(index.search({ text: '铜钱', throughChapterId: 'missing' }), /截止章节不存在/)
console.log('✓ UTF-16 分块完整保留孤立代理项并持续前进，单字查询可命中词内部，空项目安全关闭检索')

// A reproducible size check, not a production benchmark or a recall-quality claim.
const repeated = '山风吹过林梢，旅人收好地图，继续向北走。'.repeat(60).slice(0, 1_000)
const millionChapters = Array.from({ length: 1_000 }, (_, i) => chapter(`million-${i}`, repeated))
const rareQuote = '匣底嵌着一颗紫琥珀，背面刻有断翼鸢纹。'
millionChapters[3]!.text += rareQuote
millionChapters[999]!.text += '紫琥珀证明燕霁初就是夜鸦首领。'
const rareClue = await clue(millionChapters[3]!, rareQuote, { id: 'rare', label: '断翼鸢纹', aliases: ['琥珀旧盟约'] })
const millionProject = project(millionChapters, [rareClue])
const millionStats = await index.sync(millionProject)
assert.ok(millionStats.chars >= 1_000_000)
const millionHits = await index.search({ text: '琥珀旧盟约', throughChapterId: 'million-998', limit: 5 })
assert.ok(millionHits.hits.some(hit => hit.kind === 'clue' && hit.chapterId === 'million-3' && hit.quote === rareQuote))
validateEvidence(millionHits, millionProject, 'million-998')
assert.ok(!JSON.stringify(millionHits.hits).includes('夜鸦首领'))
const millionSecret = await index.search({ text: '夜鸦首领', throughChapterId: 'million-998' })
assert.ok(!JSON.stringify(millionSecret.hits).includes('夜鸦首领'))
console.log(`✓ 合成百万字 / 1,000 章容量检查：${JSON.stringify({ chars: millionStats.chars, chunks: millionStats.chunks, buildMs: Math.round(millionStats.buildMs), searchMs: Number(millionHits.searchMs.toFixed(1)), processRssMiB: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)) })}（单次 Node 合成检查，非生产基准）`)
console.log('=== ALL MEMORY RETRIEVAL TESTS PASSED ===')
