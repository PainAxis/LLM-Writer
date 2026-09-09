import { CHAPTER_EXCERPT_MAX_CHARS, trimTextFromEnd, trimTextFromStart } from '../tokenBudget'

export interface ChapterContentPromptNovel {
  id?: number
  title?: string
  genre?: string
  description?: string
}

export interface ChapterContentPromptChapter {
  id: number
  title: string
  description?: string
}

export interface ChapterContentPromptConfig {
  wordCount: number
  style: string
  focus?: string
}

export interface ChapterContentPromptCharacter {
  id: number
  name: string
  role?: string
  personality?: string
}

export interface ChapterContentPromptWorldSetting {
  title: string
  description?: string
}

export interface ChapterContentPromptCorpusItem {
  title?: string
  content: string
}

export interface ChapterContentPromptEvent {
  chapter?: string | number
  title: string
  description?: string
  characterIds?: readonly (number | string)[]
}

export interface ChapterContentPromptContextChapter {
  id: number
  chapterIndex: number
  title: string
  description?: string
  content?: string
}

export interface ChapterContentPromptInput {
  novel: Readonly<ChapterContentPromptNovel>
  chapter: Readonly<ChapterContentPromptChapter>
  config: Readonly<ChapterContentPromptConfig>
  materials: Readonly<{
    characters: readonly ChapterContentPromptCharacter[]
    worldSettings: readonly ChapterContentPromptWorldSetting[]
    corpus: readonly ChapterContentPromptCorpusItem[]
    events: readonly ChapterContentPromptEvent[]
  }>
  contextChapters: readonly ChapterContentPromptContextChapter[]
  characterNamesById: Readonly<Record<number, string>>
  /** The already-rendered template selected in the chapter-content workspace. */
  prompt: string
}

export interface ChapterContentPromptResult {
  prompt: string
  contextLabels: string[]
}

const GENRE_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  fantasy: '玄幻小说',
  xianxia: '玄幻小说',
  cultivation: '玄幻小说',
  urban: '都市言情',
  modern: '都市言情',
  history: '历史架空',
  historical: '历史架空',
  martial: '武侠修仙',
  'martial-arts': '武侠修仙',
  wuxia: '武侠修仙',
  science: '科幻未来',
  scifi: '科幻未来',
  'sci-fi': '科幻未来',
  'science-fiction': '科幻未来',
  romance: '现代言情',
  mystery: '悬疑推理',
  suspense: '悬疑推理',
  adventure: '冒险奇幻',
  horror: '恐怖惊悚',
  'western-fantasy': '西方奇幻',
  apocalypse: '末世灾难',
  military: '军事战争',
  game: '游戏竞技',
  business: '商战职场',
  general: '通用小说',
})

const VIEWPOINT_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  'first-person': '第一人称',
  'third-person': '第三人称',
  omniscient: '全知视角',
})

export function describeWriterGenre(genre?: string | null): string {
  const normalized = genre?.trim().toLowerCase().replace(/[_\s]+/g, '-') ?? ''
  return GENRE_DESCRIPTIONS[normalized] ?? '通用小说'
}

export function describeNarrativeStyle(style: string): string {
  return VIEWPOINT_DESCRIPTIONS[style] ?? '第三人称'
}

function stripChapterHtml(content: string): string {
  return content.replace(/<[^>]*>/g, '').trim()
}

function resolveEventCharacterNames(
  event: ChapterContentPromptEvent,
  characterNamesById: Readonly<Record<number, string>>,
): string[] {
  return (event.characterIds ?? [])
    .map((id) => {
      const numericId = typeof id === 'number' ? id : Number(id)
      if (Number.isFinite(numericId) && characterNamesById[numericId]) {
        return characterNamesById[numericId]
      }
      return typeof id === 'string' && id.trim() ? id.trim() : null
    })
    .filter((name): name is string => Boolean(name))
}

function formatContextChapterContent(chapter: ChapterContentPromptContextChapter): string {
  if (!chapter.content?.trim()) return ''

  const content = stripChapterHtml(chapter.content)
  if (!content) return ''

  if (content.length <= CHAPTER_EXCERPT_MAX_CHARS * 2) {
    return `\n【第${chapter.chapterIndex}章内容】\n${content}\n`
  }

  return `\n【第${chapter.chapterIndex}章开头部分】\n${trimTextFromStart(content, CHAPTER_EXCERPT_MAX_CHARS)}\n\n【第${chapter.chapterIndex}章结尾部分】\n${trimTextFromEnd(content, CHAPTER_EXCERPT_MAX_CHARS)}\n`
}

/** Build the exact AI request body from an immutable chapter-workspace snapshot. */
export function buildChapterContentPrompt(
  input: ChapterContentPromptInput,
): ChapterContentPromptResult {
  const viewpoint = describeNarrativeStyle(input.config.style)
  const focus = input.config.focus || '按大纲发展'
  const contextLabels = input.contextChapters.map(
    chapter => `第${chapter.chapterIndex}章：${chapter.title}`,
  )

  let result = `=== 小说基本信息 ===
小说标题：${input.novel.title || '未命名小说'}
小说类型：${describeWriterGenre(input.novel.genre)}
小说简介：${input.novel.description || '暂无简介'}

=== 当前章节信息 ===
章节标题：${input.chapter.title}
章节大纲：${input.chapter.description || '暂无大纲'}

=== 生成配置（用户最新设置） ===
目标字数：约${input.config.wordCount}字
写作视角：${viewpoint}
重点内容：${focus}

`

  if (input.materials.characters.length > 0) {
    result += `=== 主要人物设定 ===
${input.materials.characters
  .map(character => `- ${character.name}（${character.role || '未设定角色'}）：${character.personality || '暂无描述'}`)
  .join('\n')}

`
  }

  if (input.materials.worldSettings.length > 0) {
    result += `=== 世界观设定 ===
${input.materials.worldSettings
  .map(setting => `- ${setting.title}：${setting.description || '暂无描述'}`)
  .join('\n')}

`
  }

  if (input.materials.corpus.length > 0) {
    result += `=== 参考语料 ===
${input.materials.corpus
  .map(item => `【${item.title || '未命名语料'}】${item.content}`)
  .join('\n\n')}

`
  }

  if (input.materials.events.length > 0) {
    result += `=== 相关事件线 ===
${input.materials.events.map((event) => {
  const characterNames = resolveEventCharacterNames(event, input.characterNamesById)
  const participants = characterNames.length > 0
    ? `（参与角色：${characterNames.join('、')}）`
    : ''
  return `- 第${event.chapter ?? '未指定'}章：${event.title} - ${event.description || '暂无描述'}${participants}`
}).join('\n')}

【事件线要求】本章内容需要考虑以上事件的影响和发展，确保情节的连贯性和合理性。

`
  }

  if (input.contextChapters.length > 0) {
    result += `=== 前文概要（必须保持连贯） ===
${input.contextChapters
  .map(chapter => `第${chapter.chapterIndex}章《${chapter.title}》：${chapter.description || '暂无概要'}`)
  .join('\n')}

=== 前文详细内容（保持文风和情节连贯） ===`

    input.contextChapters.forEach((chapter) => {
      if (chapter.description) {
        result += `
【第${chapter.chapterIndex}章大纲】
${chapter.description}
`
      }
      result += formatContextChapterContent(chapter)
    })

    result += `
【重要】必须确保本章内容与选定的前文章节在以下方面保持连贯：
- 人物性格和行为逻辑一致
- 时间线和事件发展合理
- 情节推进自然流畅
- 世界观设定保持统一
- 文风和叙述风格保持一致
- 与前文情节自然衔接，特别是与最后章节的结尾部分

`
  }

  result += `=== 核心生成要求 ===
${input.prompt}

=== 写作要求（必须严格遵守） ===
1. 保持${viewpoint}的叙述方式
2. 字数控制在${input.config.wordCount}字左右
3. 重点突出：${input.config.focus || '按大纲推进剧情'}
4. 严格按照章节大纲发展情节，不得偏离主线剧情
5. 与前文内容保持逻辑连贯，人物行为符合已建立的性格
6. 世界观、人物设定、时间线必须与前文保持一致
7. 确保本章有明确的开始、发展、高潮、结尾

=== 质量标准 ===
1. 情节发展必须合理，不出现逻辑漏洞
2. 人物对话符合各自的性格特点
3. 环境描写与已建立的世界观一致
4. 节奏控制得当，张弛有度
5. 语言风格与整部小说保持统一

【警告】绝对不能：
- 偏离章节大纲的主要情节
- 改变已确定的人物性格
- 违背已建立的世界观设定
- 出现与前文矛盾的内容

请确保生成的正文符合小说的整体风格、类型和世界观设定，与章节大纲保持一致。`

  return { prompt: result, contextLabels }
}
