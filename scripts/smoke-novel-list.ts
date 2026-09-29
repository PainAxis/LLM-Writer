import assert from 'node:assert/strict'
import { filterNovelList } from '../src/utils/novelList'

const novels = [
  {
    title: 'Beta',
    description: '古城迷案',
    genre: 'mystery',
    status: 'writing',
    wordCount: 20,
    chapters: 99,
    chapterList: [{}],
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-03-01'),
  },
  {
    title: 'Alpha',
    description: '成长故事',
    genre: 'urban',
    status: 'completed',
    wordCount: 100,
    chapters: 0,
    chapterList: [{}, {}],
    createdAt: new Date('2025-02-01'),
    updatedAt: new Date('2025-02-01'),
  },
  {
    title: 'Gamma',
    description: '另一座古城',
    genre: 'mystery',
    status: 'completed',
    wordCount: 50,
    chapters: 3,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
]
const query = { status: 'all', genre: 'all', sort: 'updated', keyword: '' }
assert.deepEqual(
  filterNovelList(novels, query).map((novel) => novel.title),
  ['Beta', 'Alpha', 'Gamma']
)
assert.deepEqual(
  filterNovelList(novels, { ...query, sort: 'wordCount' }).map((novel) => novel.title),
  ['Alpha', 'Gamma', 'Beta']
)
assert.deepEqual(
  filterNovelList(novels, { ...query, sort: 'chapters' }).map((novel) => novel.title),
  ['Gamma', 'Alpha', 'Beta']
)
assert.deepEqual(
  filterNovelList(novels, { ...query, sort: 'created' }).map((novel) => novel.title),
  ['Alpha', 'Beta', 'Gamma']
)
assert.deepEqual(
  filterNovelList(novels, { ...query, status: 'completed', genre: 'mystery', keyword: '古城' }).map(
    (novel) => novel.title
  ),
  ['Gamma']
)
assert.equal(filterNovelList(novels, { ...query, keyword: 'ALPHA' })[0], novels[1])
assert.deepEqual(
  novels.map((novel) => novel.title),
  ['Beta', 'Alpha', 'Gamma'],
  'Filtering must not mutate collection order'
)
assert.equal(
  filterNovelList([{ title: 'Untitled' }], query).length,
  1,
  'Sparse legacy metadata remains searchable'
)
console.log(
  '✓ Novel list filters compose, actual chapter counts drive sorting and source order remains intact'
)
