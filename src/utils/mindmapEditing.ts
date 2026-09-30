import type {
  WriterNovel,
  WriterChapter,
  WriterCharacter,
  WriterWorldSetting,
  WriterEvent,
  WriterCorpusItem,
} from '@/types/writer'
import type { MindMapNode } from './mindmapData'
import { generateUniqueId } from './id'

export const MIND_MAP_SECTIONS = {
  chapterList: '章节',
  characters: '人物',
  worldSettings: '世界观',
  events: '事件',
  corpusData: '语料',
} as const
export type MindMapSection = keyof typeof MIND_MAP_SECTIONS
type Entity = WriterChapter | WriterCharacter | WriterWorldSetting | WriterEvent | WriterCorpusItem
const sections = Object.keys(MIND_MAP_SECTIONS) as MindMapSection[]
export const mindMapGroupId = (section: MindMapSection) => `mm-edit-group-${section}`
const entityId = (section: MindMapSection, index: number) => `mm-edit-${section}-${index}`
const titleField = (section: MindMapSection) => (section === 'characters' ? 'name' : 'title')
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/** Edit titles without decorated/truncated display labels; ids bind back to the source snapshot. */
export function buildEditableMindMapData(novel: WriterNovel): { nodeData: MindMapNode } {
  return {
    nodeData: {
      id: 'mm-edit-root',
      topic: novel.title || '未命名小说',
      root: true,
      expanded: true,
      children: sections.map((section) => ({
        id: mindMapGroupId(section),
        topic: MIND_MAP_SECTIONS[section],
        expanded: true,
        children: (novel[section] ?? []).map((entity, index) => ({
          id: entityId(section, index),
          topic: String(entity[titleField(section)] || '未命名'),
        })),
      })),
    },
  }
}

export interface MindMapChanges {
  added: number
  removed: number
  renamed: number
  reordered: boolean
  removedChapters: number
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('导图节点格式无效')
  return value as Record<string, unknown>
}
function topic(node: Record<string, unknown>): string {
  if (typeof node.topic !== 'string' || !node.topic.trim() || node.topic.trim().length > 500) {
    throw new Error('标题和名称须为 1–500 个字符')
  }
  return node.topic.trim()
}
function children(node: Record<string, unknown>): unknown[] {
  if (node.children === undefined) return []
  if (!Array.isArray(node.children)) throw new Error('导图子节点格式无效')
  return node.children
}

/**
 * Five fixed categories, one entity level, unique node/source identities. Existing entities
 * keep every field, including bodies and contentRef. New entities receive stable caller ids.
 * Chapter reorder/delete remaps numeric event links; character rename/delete repairs legacy
 * name links and removes deleted identities. Unknown legacy links are preserved.
 */
export function applyMindMapEdits(
  source: WriterNovel,
  data: unknown,
  options: { createId?: (nodeId: string) => number; now?: string } = {}
): { novel: WriterNovel; changes: MindMapChanges } {
  const exported = record(data)
  if (
    (Array.isArray(exported.arrows) && exported.arrows.length) ||
    (Array.isArray(exported.summaries) && exported.summaries.length)
  ) {
    throw new Error('导图编辑仅保存条目，不能添加连线或归纳节点')
  }
  const root = record(exported.nodeData)
  if (root.id !== 'mm-edit-root') throw new Error('小说根节点不能替换')
  const groups = children(root)
  if (groups.length !== sections.length)
    throw new Error('请保留章节、人物、世界观、事件和语料五个分类')
  const ids = new Set<string>()
  function nodeId(node: Record<string, unknown>): string {
    if (typeof node.id !== 'string' || !node.id || node.id.length > 200 || ids.has(node.id)) {
      throw new Error('导图节点身份重复或无效')
    }
    ids.add(node.id)
    if (ids.size > 10_000) throw new Error('导图最多支持 10000 个节点')
    return node.id
  }
  nodeId(root)
  const result = clone(source)
  const changes: MindMapChanges = {
    added: 0,
    removed: 0,
    renamed: 0,
    reordered: false,
    removedChapters: 0,
  }
  const now = options.now ?? new Date().toISOString()
  const createId = options.createId ?? generateUniqueId
  const next = {} as Record<MindMapSection, Entity[]>
  const retained = {} as Record<MindMapSection, Set<number>>
  const oldToNewChapter = new Map<number, number>()
  const characterNames = new Map<string, string>()
  const renamedTitle = topic(root)
  if (renamedTitle !== (source.title || '未命名小说')) changes.renamed++
  result.title = renamedTitle

  for (const section of sections) {
    const group = groups.map(record).find((group) => group.id === mindMapGroupId(section))
    if (!group || topic(group) !== MIND_MAP_SECTIONS[section])
      throw new Error('分类名称和层级不能修改')
    nodeId(group)
    const originals: Entity[] = source[section] ?? []
    const kept = new Set<number>()
    retained[section] = kept
    next[section] = children(group).map((value, index) => {
      const node = record(value)
      const id = nodeId(node)
      const name = topic(node)
      if (children(node).length) throw new Error('条目须直接放在分类下，不能嵌套其他条目')
      const match = /^mm-edit-(chapterList|characters|worldSettings|events|corpusData)-(\d+)$/.exec(
        id
      )
      let entity: Entity
      if (id.startsWith('mm-edit-')) {
        if (!match || match[1] !== section) throw new Error('条目只能在原分类内调整顺序')
        const sourceIndex = Number(match[2])
        const original = originals[sourceIndex]
        if (!original || entityId(section, sourceIndex) !== id || kept.has(sourceIndex))
          throw new Error('条目来源已失效或重复')
        kept.add(sourceIndex)
        entity = clone(original)
        if (sourceIndex !== index) changes.reordered = true
        if (String(original[titleField(section)] || '未命名') !== name) {
          changes.renamed++
          entity.updatedAt = now
        }
        if (section === 'chapterList') oldToNewChapter.set(sourceIndex + 1, index + 1)
        if (section === 'characters' && typeof original.name === 'string')
          characterNames.set(original.name, name)
      } else {
        const freshId = createId(id)
        if (!Number.isSafeInteger(freshId)) throw new Error('新条目的身份无效')
        const base = { id: freshId, createdAt: now, updatedAt: now }
        switch (section) {
          case 'chapterList':
            entity = {
              ...base,
              title: name,
              content: '',
              description: '',
              status: 'draft',
              wordCount: 0,
            }
            break
          case 'characters':
            entity = { ...base, name, role: 'supporting', tags: [] }
            break
          case 'worldSettings':
            entity = { ...base, title: name, category: 'setting', description: '' }
            break
          case 'events':
            entity = { ...base, title: name, description: '', chapter: '', characterIds: [] }
            break
          case 'corpusData':
            entity = { ...base, title: name, content: '', category: '未分类', tags: [] }
            break
        }
        changes.added++
      }
      entity[titleField(section)] = name
      return entity
    })
    const removed = originals.length - kept.size
    changes.removed += removed
    if (section === 'chapterList') changes.removedChapters = removed
    const entityIds = next[section].map((entity) => entity.id).filter((id) => id !== undefined)
    if (new Set(entityIds).size !== entityIds.length)
      throw new Error('条目身份重复，请重新添加新节点')
  }

  result.chapterList = next.chapterList as WriterChapter[]
  result.characters = next.characters as WriterCharacter[]
  result.worldSettings = next.worldSettings as WriterWorldSetting[]
  result.events = next.events as WriterEvent[]
  result.corpusData = next.corpusData as WriterCorpusItem[]
  const deletedCharacters = (source.characters ?? []).filter(
    (_entity, index) => !retained.characters.has(index)
  )
  const deletedCharacterIds = new Set<number | string>(
    deletedCharacters.flatMap((character) =>
      characterNames.has(character.name) ? [character.id] : [character.id, character.name]
    )
  )
  for (const event of result.events) {
    const number = Number(event.chapter)
    if (
      event.chapter !== '' &&
      event.chapter !== undefined &&
      Number.isInteger(number) &&
      number > 0 &&
      number <= (source.chapterList?.length ?? 0)
    ) {
      const remapped = oldToNewChapter.get(number)
      event.chapter =
        remapped === undefined
          ? ''
          : typeof event.chapter === 'string'
            ? String(remapped)
            : remapped
    }
    if (event.characterIds) {
      event.characterIds = event.characterIds
        .filter((id) => !deletedCharacterIds.has(id))
        .map((id) => (typeof id === 'string' ? (characterNames.get(id) ?? id) : id))
    }
  }
  if (changes.removedChapters || result.chapterList.length !== (source.chapterList?.length ?? 0)) {
    const total = result.chapterList.reduce(
      (sum, chapter) =>
        sum + (chapter.wordCount ?? chapter.content?.replace(/<[^>]*>/g, '').length ?? 0),
      0
    )
    result.wordCount = total
    result.totalWords = total
    result.avgWordsPerChapter = result.chapterList.length
      ? Math.round(total / result.chapterList.length)
      : 0
  }
  result.chapters = result.chapterList.length
  if (changes.added || changes.removed || changes.renamed || changes.reordered)
    result.updatedAt = now
  return { novel: result, changes }
}
