import assert from 'node:assert/strict'
import { parseCorpus, mergeCorpus, createCorpusExport } from '../src/utils/corpusTransfer'

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
for (const input of [null, {}, [null], [{ id: 1, content: 7 }], [{ id: 1, content: 'x', tags: [7] }], [...legacy, { id: 2, content: ' ' }]]) {
  assert.throws(() => parseCorpus(input))
}
assert.deepEqual(parseCorpus([]), [])
console.log('Corpus legacy import, collision preservation and portable roundtrip smoke passed')
