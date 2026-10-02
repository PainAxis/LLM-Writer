import assert from 'node:assert/strict'
import { parseCorpus, mergeCorpus, createCorpusExport } from '../src/utils/corpusTransfer'
import { applyMindMapEdits, buildEditableMindMapData, mindMapGroupId } from '../src/utils/mindmapEditing'

const legacy = [{ id: 1, content: '旧版语料', createdAt: '2020-01-01', extension: { nested: ['keep'] } }]
const parsed = parseCorpus(legacy)
assert.equal(parsed[0].title, '旧版语料')
assert.equal(parsed[0].createdAt, '2020-01-01')
assert.deepEqual(parsed[0].extension, legacy[0].extension)
const existing = [{ id: 1, title: 'Existing', content: '已有语料', tags: ['keep'] }]
const merged = mergeCorpus(existing, [...parsed, ...parsed])
assert.equal(new Set(merged.map(item => item.id)).size, 3)
assert.equal(merged[0], existing[0], 'Existing records and references survive append')
assert.equal(merged[1].content, '旧版语料')
assert.deepEqual(legacy, [{ id: 1, content: '旧版语料', createdAt: '2020-01-01', extension: { nested: ['keep'] } }])
assert.deepEqual(parseCorpus(createCorpusExport(merged)), merged)
const drafts = [
  { id: 21, title: '稍后完善', content: '', tags: ['草稿'], extension: { retained: true } },
  { id: 22, title: '空白内容草稿', content: ' \n ' },
]
assert.deepEqual(parseCorpus(JSON.parse(JSON.stringify(createCorpusExport(drafts)))), drafts, '命名草稿必须可以原样导出和导入')
const novel = { id: 1, title: '导图草稿' }
const map = buildEditableMindMapData(novel)
map.nodeData.children!.find(node => node.id === mindMapGroupId('corpusData'))!.children!.push({ id: 'new-corpus', topic: '待补充语料' })
const mapDrafts = applyMindMapEdits(novel, map, { createId: () => 23 }).novel.corpusData!
assert.deepEqual(parseCorpus(JSON.parse(JSON.stringify(createCorpusExport(mapDrafts)))), mapDrafts, '导图新建的空语料也须支持往返')
for (const input of [null, {}, [null], [{ id: 1, content: 7 }], [{ id: 1, content: 'x', tags: [7] }], [...legacy, { id: 2, content: ' ' }]]) {
  assert.throws(() => parseCorpus(input))
}
assert.deepEqual(parseCorpus([]), [])
console.log('Corpus legacy import, collision preservation and portable roundtrip smoke passed')
