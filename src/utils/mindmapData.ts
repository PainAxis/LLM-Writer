/**
 * 思维导图数据派生纯函数：小说对象 → mind-elixir 节点树。
 * 只读导图的数据源（小说 → 章节 → 事件 / 人物 / 世界观 / 语料），
 * 无副作用、无库依赖，可独立单测。
 */

import { trimTextFromStart } from './tokenBudget'

export interface MindMapNode {
  id: string
  topic: string
  root?: boolean
  children?: MindMapNode[]
  /** mind-elixir 展开状态（默认展开根层，深层折叠防爆炸） */
  expanded?: boolean
}

export interface ChapterLike {
  id?: unknown
  title?: string
  description?: string
}

export interface CharacterLike {
  id?: unknown
  name?: string
  role?: string
  personality?: string
}

export interface WorldSettingLike {
  title?: string
  description?: string
}

export interface EventLike {
  title?: string
  description?: string
  /** 关联章号（字符串，历史数据可能存标题） */
  chapter?: string | number
  /** 关联角色 id 列表（数字/字符串，兼容直接存名字） */
  characterIds?: Array<number | string>
}

export interface CorpusLike {
  id?: unknown
  title?: string
  category?: string
}

export interface NovelLike {
  title?: string
  genre?: string
  chapterList?: ChapterLike[]
  characters?: CharacterLike[]
  worldSettings?: WorldSettingLike[]
  events?: EventLike[]
  corpusData?: CorpusLike[]
}

const ROLE_TEXT: Record<string, string> = {
  protagonist: '主角',
  antagonist: '反派',
  supporting: '配角',
  minor: '龙套',
}

const SECTION_LIMIT = 80
const LEAF_LIMIT = 60

let nodeSeq = 0
function node(topic: string, children?: MindMapNode[], expanded?: boolean): MindMapNode {
  nodeSeq += 1
  const result: MindMapNode = { id: `mm${nodeSeq}`, topic }
  if (children && children.length > 0) {
    result.children = children
    result.expanded = expanded ?? false
  }
  return result
}

/** 重置节点 id 序列（测试隔离用；正常使用无需调用） */
export function resetMindMapIdSeq(): void {
  nodeSeq = 0
}

/** 组装导图根结构：章节（含挂载事件）/ 人物 / 世界观 / 语料四大分支 */
export function buildMindMapData(novel: NovelLike): { nodeData: MindMapNode } {
  nodeSeq = 0

  const chapters = novel.chapterList ?? []
  const events = novel.events ?? []
  const characters = novel.characters ?? []
  const worldSettings = novel.worldSettings ?? []
  const corpusData = novel.corpusData ?? []

  // ---- 章节分支：每章下挂该章事件 ----
  const chapterChildren = chapters.map((chapter, index) => {
    const chapterEvents = events.filter(
      (event) => event.chapter !== undefined && parseInt(String(event.chapter), 10) === index + 1,
    )
    const characterNames = novel.characters ?? []
    const eventNodes = chapterEvents.map((event) => {
      const participants = (event.characterIds ?? [])
        .map((id) => characterNames.find((character) => character.id === id)?.name ?? (typeof id === 'string' ? id : null))
        .filter(Boolean)
      const participantsSuffix = participants.length > 0 ? `（参与：${participants.join('、')}）` : ''
      return node(
        `📅 ${trimTextFromStart(event.title ?? '未命名事件', LEAF_LIMIT)}${event.description ? `：${trimTextFromStart(event.description, LEAF_LIMIT)}` : ''}${participantsSuffix}`,
      )
    })
    const summary = chapter.description ? `：${trimTextFromStart(chapter.description, SECTION_LIMIT)}` : ''
    return node(`第${index + 1}章 ${trimTextFromStart(chapter.title ?? '未命名章节', LEAF_LIMIT)}${summary}`, eventNodes)
  })

  // 未关联到具体章节的事件单独归组
  const orphanEvents = events.filter((event) => {
    const chapterNum = parseInt(String(event.chapter ?? ''), 10)
    return !Number.isFinite(chapterNum) || chapterNum < 1 || chapterNum > chapters.length
  })
  if (orphanEvents.length > 0) {
    chapterChildren.push(
      node('📅 未关联章节的事件', orphanEvents.map((event) => node(`📅 ${trimTextFromStart(event.title ?? '未命名事件', LEAF_LIMIT)}`))),
    )
  }

  const branches: MindMapNode[] = []
  if (chapters.length > 0) {
    branches.push(node(`📖 章节大纲（${chapters.length} 章）`, chapterChildren))
  }

  if (characters.length > 0) {
    branches.push(
      node(
        `👥 人物（${characters.length}）`,
        characters.map((character) => {
          const roleText = character.role ? ROLE_TEXT[character.role] ?? character.role : ''
          const rolePrefix = roleText ? `（${roleText}）` : ''
          const personality = character.personality ? `：${trimTextFromStart(character.personality, LEAF_LIMIT)}` : ''
          return node(`${trimTextFromStart(character.name ?? '未命名', LEAF_LIMIT)}${rolePrefix}${personality}`)
        }),
      ),
    )
  }

  if (worldSettings.length > 0) {
    branches.push(
      node(
        `🌍 世界观（${worldSettings.length}）`,
        worldSettings.map((setting) =>
          node(
            `${trimTextFromStart(setting.title ?? '未命名设定', LEAF_LIMIT)}${setting.description ? `：${trimTextFromStart(setting.description, LEAF_LIMIT)}` : ''}`,
          ),
        ),
      ),
    )
  }

  if (corpusData.length > 0) {
    // 语料按分类分组，分类内列条目标题
    const byCategory = new Map<string, string[]>()
    for (const item of corpusData) {
      const category = (item.category ?? '').trim() || '未分类'
      const list = byCategory.get(category) ?? []
      list.push(trimTextFromStart(item.title ?? '未命名语料', LEAF_LIMIT))
      byCategory.set(category, list)
    }
    branches.push(
      node(
        `📚 语料（${corpusData.length}）`,
        [...byCategory.entries()].map(([category, titles]) => node(`${category}（${titles.length}）`, titles.map((title) => node(title)))),
      ),
    )
  }

  const genreSuffix = novel.genre ? `（${novel.genre}）` : ''
  return {
    nodeData: {
      id: 'mm-root',
      topic: `${novel.title ?? '未命名小说'}${genreSuffix}`,
      root: true,
      children: branches,
      expanded: true,
    },
  }
}
