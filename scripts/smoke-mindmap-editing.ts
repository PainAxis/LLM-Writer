import assert from 'node:assert/strict'
import {
  applyMindMapEdits,
  buildEditableMindMapData,
  mindMapGroupId,
  type MindMapSection,
} from '../src/utils/mindmapEditing'
import { useMindMapDraft } from '../src/composables/useMindMapDraft'
import type { WriterNovel } from '../src/types/writer'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const source: WriterNovel = {
  id: 1,
  title: '作品',
  genre: 'fantasy',
  chapters: 2,
  customMetadata: { untouched: true },
  chapterList: [
    {
      id: 11,
      title: '甲章',
      content: '<p>甲章完整正文</p>',
      description: '大纲甲',
      wordCount: 6,
      contentRef: 'large-body-ref',
      custom: 1,
    },
    { id: 12, title: '乙章', content: '<p>乙章完整正文</p>', wordCount: 6 },
  ],
  characters: [
    { id: 21, name: '阿宁', personality: '坚定', tags: ['旅人'] },
    { id: 22, name: '阿青' },
  ],
  worldSettings: [{ id: 31, title: '城市', description: '完整设定', details: '其他字段' }],
  events: [
    {
      id: 41,
      title: '出发',
      description: '完整事件',
      chapter: '1',
      characterIds: [21, 22, '阿宁', '未知旧名字'],
    },
  ],
  corpusData: [{ id: 51, title: '雨声', content: '完整语料', category: '环境' }],
}
function group(data: ReturnType<typeof buildEditableMindMapData>, section: MindMapSection) {
  return data.nodeData.children!.find((node) => node.id === mindMapGroupId(section))!
}
{
  const snapshot = JSON.stringify(source)
  const data = buildEditableMindMapData(source)
  assert.deepEqual(applyMindMapEdits(source, data).novel, source)
  data.nodeData.topic = '新作品'
  const chapters = group(data, 'chapterList').children!
  chapters.reverse()
  chapters[1]!.topic = '新甲章'
  group(data, 'characters').children![0]!.topic = '阿宁新名'
  group(data, 'worldSettings').children![0]!.topic = '新城市'
  group(data, 'corpusData').children![0]!.topic = '新雨声'
  const { novel, changes } = applyMindMapEdits(source, data, { now: '2026-09-30' })
  assert.equal(novel.title, '新作品')
  assert.equal(novel.chapterList![1]!.id, 11)
  assert.equal(novel.chapterList![1]!.content, source.chapterList![0]!.content)
  assert.equal(novel.chapterList![1]!.contentRef, 'large-body-ref')
  assert.equal(novel.chapterList![1]!.custom, 1)
  assert.equal(novel.events![0]!.chapter, '2')
  assert.deepEqual(novel.events![0]!.characterIds, [21, 22, '阿宁新名', '未知旧名字'])
  assert.equal(novel.worldSettings![0]!.details, '其他字段')
  assert.equal(novel.corpusData![0]!.content, '完整语料')
  assert.deepEqual(novel.customMetadata, source.customMetadata)
  assert.equal(changes.reordered, true)
  assert.equal(changes.renamed, 5)
  assert.equal(JSON.stringify(source), snapshot)
}
{
  const data = buildEditableMindMapData(source)
  group(data, 'chapterList').children!.shift()
  group(data, 'characters').children!.pop()
  group(data, 'events').children!.push({ id: 'new-event', topic: '归来' })
  const { novel, changes } = applyMindMapEdits(source, data, { createId: () => 99 })
  assert.equal(changes.removedChapters, 1)
  assert.equal(changes.removed, 2)
  assert.equal(changes.added, 1)
  assert.equal(novel.events![0]!.chapter, '')
  assert.deepEqual(novel.events![0]!.characterIds, [21, '阿宁', '未知旧名字'])
  assert.equal(novel.events![1]!.id, 99)
  assert.equal(novel.wordCount, 6)
  assert.equal(novel.totalWords, 6)
}
for (const invalidate of [
  (data: ReturnType<typeof buildEditableMindMapData>) => {
    data.nodeData.topic = ' '
  },
  (data) => {
    data.nodeData.children!.pop()
  },
  (data) => {
    group(data, 'characters').topic = '错误分类'
  },
  (data) => {
    group(data, 'chapterList').children!.push(clone(group(data, 'chapterList').children![0]!))
  },
  (data) => {
    group(data, 'characters').children!.push(group(data, 'chapterList').children!.pop()!)
  },
  (data) => {
    group(data, 'characters').children![0]!.children = [{ id: 'nested', topic: '不允许嵌套' }]
  },
]) {
  const data = buildEditableMindMapData(source)
  invalidate(data)
  assert.throws(() => applyMindMapEdits(source, data))
}
{
  let cached = [clone(source)]
  let fail = true
  let finish!: () => void
  const saved: WriterNovel[][] = []
  const draft = useMindMapDraft({
    load: () => cached,
    save: async (novels) => {
      cached = clone(novels)
      saved.push(clone(novels))
      if (fail) throw new Error('disk failure')
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    },
  })
  draft.begin(source)
  draft.markDirty()
  const data = buildEditableMindMapData(source)
  group(data, 'chapterList').children!.push({ id: 'new-chapter', topic: '新章' })
  await assert.rejects(draft.save(data), /disk failure/)
  assert.equal(draft.editing.value, true)
  assert.equal(draft.dirty.value, true)
  const id = saved[0]![0]!.chapterList!.at(-1)!.id
  fail = false
  const retry = draft.save(data)
  assert.equal(draft.saving.value, true)
  draft.cancel()
  assert.equal(
    draft.editing.value,
    true,
    'An in-flight persistence transaction cannot be discarded'
  )
  finish()
  const result = await retry
  assert.equal(result.chapterList!.at(-1)!.id, id, 'Retry preserves new entity identity')
  draft.cancel()
  assert.equal(draft.editing.value, false)
  draft.begin(result)
  cached[0]!.description = '其他位置的新修改'
  await assert.rejects(draft.save(buildEditableMindMapData(result)), /其他位置修改/)
  assert.equal(cached[0]!.description, '其他位置的新修改')
}
console.log(
  '✓ Editable maps preserve bodies/metadata, validate structure, repair links, reject conflicts and await/retry persistence without duplicate identities'
)
