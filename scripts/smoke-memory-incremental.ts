import assert from 'node:assert/strict'
import { MemoryIndex } from '../src/services/memory/engine'
import { chapterRevision } from '../src/services/memory/revision'
import type { MemoryClue, MemoryProjectInput, MemorySearchResult } from '../src/types/memory'

const chapter = (id: string, text: string) => ({ id, title: `卷宗${id}`, text })
const source = (chapters = [
  chapter('one', '雨夜来客留下苍玉印，林青接过信物。'),
  chapter('two', '祠堂的赤金锁由顾宁保管。'),
  chapter('three', '司南最终藏进石塔。'),
]): MemoryProjectInput => ({ id: 'incremental-book', title: '增量稿件', chapters, clues: [] })
const index = new MemoryIndex()
let project = source()
const anchored = project.chapters[0]!
const clue: MemoryClue = {
  id: 'oath', chapterId: anchored.id, sourceRevision: await chapterRevision(anchored),
  start: 0, end: anchored.text.length, quote: anchored.text, label: '苍玉旧约', aliases: ['夜访誓言'],
}
project.clues.push(clue)
let stats = await index.sync(project)
assert.deepEqual(stats.sync, {
  mode: 'full', rebuiltChapters: 3, reusedChapters: 0,
  insertedDocuments: 4, removedDocuments: 0, reusedDocuments: 0,
})

async function grounded(result: MemorySearchResult, current: MemoryProjectInput, through: string) {
  const cutoff = current.chapters.findIndex(item => item.id === through)
  assert.ok(cutoff >= 0)
  for (const hit of result.hits) {
    const position = current.chapters.findIndex(item => item.id === hit.chapterId)
    assert.ok(position >= 0 && position <= cutoff)
    const chapter = current.chapters[position]!
    assert.equal(hit.ordinal, position + 1)
    assert.equal(hit.revision, await chapterRevision(chapter))
    assert.equal(hit.quote, chapter.text.slice(hit.start, hit.end))
  }
}

// Invalidating external sources must block search even if a finished baseline is retained.
index.invalidateSource()
index.invalidateSource()
await assert.rejects(index.search({ text: '苍玉印', throughChapterId: 'three' }), /尚未就绪/)
stats = await index.sync(structuredClone(project))
assert.equal(stats.sync.mode, 'unchanged')
assert.equal(stats.sync.insertedDocuments, 0)
stats.sync.mode = 'full'
stats.sync.reusedDocuments = -1
assert.equal((await index.sync(project)).sync.reusedDocuments, 4, 'returned work statistics are defensive copies')
console.log('✓ 来源失效立即阻止检索；重复失效后可验证复用完整索引，统计不可被调用者污染')

// Same-length body changes invalidate revision-bound clues and just the changed document.
project = structuredClone(project)
project.chapters[0]!.text = project.chapters[0]!.text.replace('林青', '韩楚')
stats = await index.sync(project)
assert.deepEqual(stats.sync, {
  mode: 'incremental', rebuiltChapters: 1, reusedChapters: 2,
  insertedDocuments: 1, removedDocuments: 2, reusedDocuments: 2,
})
assert.equal(stats.staleClues, 1)
assert.equal((await index.search({ text: '夜访誓言', throughChapterId: 'three' })).hits.length, 0)
assert.equal((await index.search({ text: '林青', throughChapterId: 'three' })).hits.length, 0)
const newFact = await index.search({ text: '苍玉印', throughChapterId: 'three' })
assert.ok(newFact.hits.some(hit => hit.quote.includes('韩楚')))
await grounded(newFact, project, 'three')
console.log('✓ 等长旧章改稿只替换变化正文和失效伏笔；旧人物与旧别名均消失')

project.clues = [{ ...clue, sourceRevision: await chapterRevision(project.chapters[0]!), quote: project.chapters[0]!.text,
  label: '新誓言', aliases: ['晓雾约定'] }]
stats = await index.sync(project)
assert.equal(stats.sync.rebuiltChapters, 0)
assert.equal(stats.sync.insertedDocuments, 1)
assert.equal(stats.sync.reusedDocuments, 3)
assert.equal((await index.search({ text: '晓雾约定', throughChapterId: 'three' })).hits[0]!.kind, 'clue')
project.clues[0]!.aliases = ['晚照约定']
stats = await index.sync(project)
assert.equal(stats.sync.removedDocuments, 1)
assert.equal(stats.sync.insertedDocuments, 1)
assert.equal((await index.search({ text: '晓雾', throughChapterId: 'three' })).hits.length, 0)
assert.equal((await index.search({ text: '晚照', throughChapterId: 'three' })).hits[0]!.kind, 'clue')
project.chapters.reverse()
stats = await index.sync(project)
assert.deepEqual(stats.sync, {
  mode: 'incremental', rebuiltChapters: 0, reusedChapters: 3,
  insertedDocuments: 0, removedDocuments: 0, reusedDocuments: 4,
})
assert.equal((await index.search({ text: '苍玉印', throughChapterId: 'two' })).hits.length, 0)
await grounded(await index.search({ text: '晚照', throughChapterId: 'one' }), project, 'one')
project.chapters = project.chapters.filter(item => item.id !== 'one')
stats = await index.sync(project)
assert.equal(stats.sync.removedDocuments, 2)
assert.equal(stats.sync.insertedDocuments, 0)
assert.equal((await index.search({ text: '晚照', throughChapterId: 'two' })).hits.length, 0)
console.log('✓ 仅伏笔修改不重建正文；重排无需重新分词，删除与披露截止实时生效')

// Repeated remove/reinsert must maintain BM25 document statistics and purge retired terms.
project = source(Array.from({ length: 16 }, (_, i) => chapter(`cycle-${i}`, `青石桥旧令 OLD${i}。`)))
await index.sync(project)
let compacted = false
for (let generation = 1; generation <= 66; generation++) {
  for (const [position, item] of project.chapters.entries()) item.text = `朱雀门新令 GEN${generation}MARK${position}。`
  stats = await index.sync(project)
  if (stats.sync.mode === 'full') {
    compacted = true
    assert.equal(stats.sync.insertedDocuments, 16)
    assert.equal(stats.sync.reusedDocuments, 0)
  }
  const exact = await index.search({ text: `GEN${generation}MARK7`, throughChapterId: 'cycle-15' })
  assert.equal(exact.hits[0]!.chapterId, 'cycle-7')
  assert.equal((await index.search({ text: '青石桥', throughChapterId: 'cycle-15' })).hits.length, 0)
}
assert.ok(compacted, 'sustained edits must eventually compact retired terms and IDs')
const cold = new MemoryIndex()
await cold.sync(project)
const warmResult = await index.search({ text: 'GEN66MARK7', throughChapterId: 'cycle-15' })
const coldResult = await cold.search({ text: 'GEN66MARK7', throughChapterId: 'cycle-15' })
assert.deepEqual(warmResult.hits, coldResult.hits, 'repeated replacement and compaction preserve the same current evidence and ranking as a fresh build')
console.log('✓ 66 轮连续改稿保持检索与冷构建一致，超过删除阈值后压实退休词项')

// Inject a real index failure after one property has already been removed.
// The next sync must never reuse the partially mutated database.
type TestInternals = { ready?: { database: { index: { remove: (...args: unknown[]) => unknown } } } }
const internals = index as unknown as TestInternals
const database = internals.ready!.database
const originalRemove = database.index.remove
let calls = 0
database.index.remove = (...args) => {
  if (++calls === 2) throw new Error('Injected partial remove failure')
  return originalRemove(...args)
}
const failed = structuredClone(project)
failed.chapters[0]!.text = '白鹭洲新版本。'
await assert.rejects(index.sync(failed), /Injected partial remove failure/)
assert.ok(calls >= 2)
index.invalidateSource()
await assert.rejects(index.search({ text: '朱雀门', throughChapterId: 'cycle-15' }), /尚未就绪/)
stats = await index.sync(project)
assert.equal(stats.sync.mode, 'full')
assert.equal((await index.search({ text: 'GEN66MARK7', throughChapterId: 'cycle-15' })).hits[0]!.chapterId, 'cycle-7')
console.log('✓ 真正执行部分移除后抛错，失败索引不会再发布或复用，后续冷构建可恢复')

// Invalidate while a database is mid-removal; a competing sync must own a fresh DB.
const racingInternals = index as unknown as TestInternals
const racingDatabase = racingInternals.ready!.database
const racingRemove = racingDatabase.index.remove
let invalidated = false
racingDatabase.index.remove = (...args) => {
  const result = racingRemove(...args)
  if (!invalidated) {
    invalidated = true
    index.invalidateSource()
  }
  return result
}
const cancelled = index.sync(failed)
await assert.rejects(cancelled, /较新的项目快照/)
assert.equal(invalidated, true)
await assert.rejects(index.search({ text: '朱雀门', throughChapterId: 'cycle-15' }), /尚未就绪/)
stats = await index.sync(project)
assert.equal(stats.sync.mode, 'full')
const older = index.sync(failed)
const olderFailure = assert.rejects(older, /较新的项目快照/)
const latest = source([chapter('latest', '此刻唯一版本是玄武门。')])
await index.sync(latest)
await olderFailure
assert.equal((await index.search({ text: '玄武门', throughChapterId: 'latest' })).hits[0]!.quote, latest.chapters[0]!.text)
console.log('✓ 增量更新途中失效及相互覆盖的构建均无法发布部分索引或旧快照')

// Max chapter count exercises the enum visibility gate, not just a tiny reorder.
const large = source(Array.from({ length: 10_000 }, (_, i) => chapter(`boundary-${i}`, i === 9_999 ? '未来独占密令。' : '小镇守夜。')))
await index.sync(large)
assert.equal((await index.search({ text: '未来独占密令', throughChapterId: 'boundary-9998' })).hits.length, 0)
assert.equal((await index.search({ text: '未来独占密令', throughChapterId: 'boundary-9999' })).hits[0]!.chapterId, 'boundary-9999')
large.chapters.reverse()
stats = await index.sync(large)
assert.equal(stats.sync.rebuiltChapters, 0)
assert.equal(stats.sync.insertedDocuments, 0)
const newlyDisclosed = await index.search({ text: '未来独占密令', throughChapterId: 'boundary-9999' })
assert.equal(newlyDisclosed.hits[0]!.ordinal, 1)
await grounded(newlyDisclosed, large, 'boundary-9999')
console.log('✓ 10,000 章披露过滤与整书反转保持正确，重排零正文分词')
console.log('memory incremental smoke: 7 scenario groups passed')
