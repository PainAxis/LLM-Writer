import { computed, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import { extractPromptVariables, renderPromptTemplate } from '@/composables/usePromptPicker'
import type {
  PromptTemplate,
  WriterChapter,
  WriterChapterGenerationConfig,
  WriterCharacter,
  WriterCorpusItem,
  WriterEvent,
  WriterNovel,
  WriterPromptVariables,
  WriterSelectedMaterials,
  WriterWorldSetting,
} from '@/types/writer'
import { RECENT_CHAPTERS_FOR_CONTEXT, takeLastItems } from '@/utils/tokenBudget'

export type ChapterContentMaterialType = 'characters' | 'worldSettings' | 'corpus' | 'events'
export type ChapterContentMaterial =
  | WriterCharacter
  | WriterWorldSetting
  | WriterCorpusItem
  | WriterEvent

export interface WriterContextChapter extends WriterChapter {
  chapterIndex: number
  wordCount: number
}

export interface ChapterContentGenerationSnapshot {
  readonly novelId: number | null
  /** Live list item used only for the persistence-aware chapter selection step. */
  readonly targetChapter: WriterChapter
  readonly novel: Readonly<Pick<WriterNovel, 'id' | 'title' | 'genre' | 'description'>>
  readonly chapter: Readonly<WriterChapter>
  readonly prompt: string
  readonly config: Readonly<WriterChapterGenerationConfig>
  readonly materials: {
    readonly characters: readonly WriterCharacter[]
    readonly worldSettings: readonly WriterWorldSetting[]
    readonly corpus: readonly WriterCorpusItem[]
    readonly events: readonly WriterEvent[]
  }
  readonly contextChapters: readonly WriterContextChapter[]
  readonly characterNamesById: Readonly<Record<number, string>>
}

export interface UseChapterContentWorkspaceOptions {
  currentNovel: Readonly<Ref<WriterNovel | null | undefined>>
  chapters: Readonly<Ref<WriterChapter[]>>
  characters: Readonly<Ref<WriterCharacter[]>>
  worldSettings: Readonly<Ref<WriterWorldSetting[]>>
  corpusData: Readonly<Ref<WriterCorpusItem[]>>
  events: Readonly<Ref<WriterEvent[]>>
}

const DEFAULT_CONFIG: Readonly<WriterChapterGenerationConfig> = Object.freeze({
  wordCount: 2000,
  style: 'third-person',
  focus: '',
})

const emptyMaterials = (): WriterSelectedMaterials => ({
  characters: [],
  worldSettings: [],
  corpus: [],
  events: [],
})

const viewpointDescriptions: Readonly<Record<string, string>> = Object.freeze({
  'first-person': '第一人称',
  'third-person': '第三人称',
  omniscient: '全知视角',
})

function arraysEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function cleanChapterContentPreview(content: string | undefined, maxLength = 80): string {
  if (!content) return ''

  const plainText = content
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

  return plainText.length > maxLength ? plainText.slice(0, maxLength) : plainText
}

/**
 * Owns the synchronous state of the chapter-content generation dialog.
 * AI requests, persistence, routing and UI notifications deliberately stay outside.
 */
export function useChapterContentWorkspace(options: UseChapterContentWorkspaceOptions) {
  const visible = ref(false)
  const targetChapter = shallowRef<WriterChapter | null>(null)
  const selectedContentCategory = ref('content')
  const generateConfig = ref<WriterChapterGenerationConfig>({ ...DEFAULT_CONFIG })
  // Keep the nested arrays reactive: the current corpus recommender merges results with
  // `selectedMaterials.value.corpus.push(...)` and can migrate without an adapter.
  const selectedMaterials = ref<WriterSelectedMaterials>(emptyMaterials())
  const selectedContextChapterIds = ref<number[]>([])
  const selectedPrompt = shallowRef<PromptTemplate | null>(null)
  const promptVariables = ref<WriterPromptVariables>({})

  const targetChapterId = computed(() => targetChapter.value?.id ?? null)

  const availableContextChapters = computed<WriterContextChapter[]>(() => {
    const targetIndex = options.chapters.value.findIndex(
      chapter => chapter.id === targetChapter.value?.id,
    )
    if (targetIndex <= 0) return []

    return options.chapters.value
      .slice(0, targetIndex)
      .map((chapter, index) => ({
        ...chapter,
        chapterIndex: index + 1,
        wordCount: chapter.wordCount ?? 0,
      }))
      .filter(chapter => Boolean(chapter.description || chapter.content?.trim()))
  })

  const selectedContextChapterRecords = computed(() => {
    const selectedIds = new Set(selectedContextChapterIds.value)
    return availableContextChapters.value.filter(chapter => selectedIds.has(chapter.id))
  })

  const finalPrompt = computed(() =>
    selectedPrompt.value
      ? renderPromptTemplate(selectedPrompt.value.content, promptVariables.value)
      : '',
  )

  const formatCharacters = () => selectedMaterials.value.characters
    .map(character =>
      `${character.name}（${character.role || '未设定角色'}）：${character.personality || '暂无描述'}`,
    )
    .join('\n')

  const formatWorldSettings = () => selectedMaterials.value.worldSettings
    .map(setting => `${setting.title}：${setting.description || '暂无描述'}`)
    .join('\n')

  const formatCorpus = () => selectedMaterials.value.corpus
    .map(item => `【${item.title || '未命名语料'}】${item.content}`)
    .join('\n\n')

  const formatEvents = () => selectedMaterials.value.events
    .map(event => {
      const chapter = event.chapter ? `（第${event.chapter}章）` : ''
      const time = event.time ? `，时间：${event.time}` : ''
      return `${event.title}${chapter}：${event.description || '暂无描述'}${time}`
    })
    .join('\n')

  const formatContext = () => selectedContextChapterRecords.value
    .map(chapter => {
      const lines = [`第${chapter.chapterIndex}章《${chapter.title}》`]
      if (chapter.description) lines.push(`章节大纲：${chapter.description}`)

      const content = cleanChapterContentPreview(chapter.content, 500)
      if (content) {
        const rawText = cleanChapterContentPreview(chapter.content, Number.POSITIVE_INFINITY)
        lines.push(`章节内容：${content}${rawText.length > 500 ? '...' : ''}`)
      }
      return lines.join('\n')
    })
    .join('\n\n')

  const automaticVariables = (): WriterPromptVariables => ({
    小说标题: options.currentNovel.value?.title || '未命名小说',
    章节标题: targetChapter.value?.title || '',
    章节大纲: targetChapter.value?.description || '暂无大纲',
    目标字数: generateConfig.value.wordCount.toString(),
    写作视角: viewpointDescriptions[generateConfig.value.style] || '第三人称',
    重点内容: generateConfig.value.focus || '按大纲发展',
    主要人物: formatCharacters(),
    世界观设定: formatWorldSettings(),
    参考语料: formatCorpus(),
    前文概要: formatContext(),
    事件线: formatEvents(),
    相关事件: formatEvents(),
    重要事件: formatEvents(),
  })

  const autoFillVariables = () => {
    if (!selectedPrompt.value || !targetChapter.value) return

    const automatic = automaticVariables()
    const next = { ...promptVariables.value }
    let changed = false
    Object.keys(next).forEach(variable => {
      if (!(variable in automatic) || next[variable] === automatic[variable]) return
      next[variable] = automatic[variable]
      changed = true
    })
    if (changed) promptVariables.value = next
  }

  const sanitizeContextChapterIds = (): boolean => {
    const allowedIds = new Set(availableContextChapters.value.map(chapter => chapter.id))
    const seen = new Set<number>()
    const validIds = selectedContextChapterIds.value.filter(id => {
      if (!allowedIds.has(id) || seen.has(id)) return false
      seen.add(id)
      return true
    })

    if (arraysEqual(validIds, selectedContextChapterIds.value)) return false
    selectedContextChapterIds.value = validIds
    return true
  }

  const initializeRecentContext = () => {
    selectedContextChapterIds.value = takeLastItems(
      availableContextChapters.value,
      RECENT_CHAPTERS_FOR_CONTEXT,
    ).map(chapter => chapter.id)
  }

  const open = (chapter: WriterChapter) => {
    targetChapter.value = chapter
    selectedContentCategory.value = 'content'
    generateConfig.value = { ...DEFAULT_CONFIG }
    selectedMaterials.value = emptyMaterials()
    selectedPrompt.value = null
    promptVariables.value = {}
    initializeRecentContext()
    visible.value = true
  }

  const close = () => {
    visible.value = false
  }

  const reset = () => {
    visible.value = false
    targetChapter.value = null
    selectedContentCategory.value = 'content'
    generateConfig.value = { ...DEFAULT_CONFIG }
    selectedMaterials.value = emptyMaterials()
    selectedContextChapterIds.value = []
    selectedPrompt.value = null
    promptVariables.value = {}
  }

  const createSnapshot = (): ChapterContentGenerationSnapshot | null => {
    if (!targetChapter.value || !selectedPrompt.value) return null

    const novel = options.currentNovel.value

    return Object.freeze({
      novelId: novel?.id ?? null,
      targetChapter: targetChapter.value,
      novel: Object.freeze({
        id: novel?.id ?? 0,
        title: novel?.title,
        genre: novel?.genre,
        description: novel?.description,
      }),
      chapter: Object.freeze({ ...targetChapter.value }),
      prompt: finalPrompt.value,
      config: Object.freeze({ ...generateConfig.value }),
      materials: Object.freeze({
        characters: Object.freeze(selectedMaterials.value.characters.map(character => ({
          ...character,
          tags: character.tags ? [...character.tags] : undefined,
        }))),
        worldSettings: Object.freeze(selectedMaterials.value.worldSettings.map(setting => ({ ...setting }))),
        corpus: Object.freeze(selectedMaterials.value.corpus.map(item => ({
          ...item,
          tags: item.tags ? [...item.tags] : undefined,
        }))),
        events: Object.freeze(selectedMaterials.value.events.map(event => ({
          ...event,
          characterIds: event.characterIds ? [...event.characterIds] : undefined,
        }))),
      }),
      contextChapters: Object.freeze(selectedContextChapterRecords.value.map(chapter => ({ ...chapter }))),
      characterNamesById: Object.freeze(Object.fromEntries(
        options.characters.value.map(character => [character.id, character.name]),
      )),
    })
  }

  const selectPrompt = (prompt: PromptTemplate) => {
    selectedPrompt.value = prompt
    promptVariables.value = extractPromptVariables(prompt.content)
    autoFillVariables()
  }

  const clearPrompt = () => {
    selectedPrompt.value = null
    promptVariables.value = {}
  }

  const toggleMaterial = (type: ChapterContentMaterialType, material: ChapterContentMaterial) => {
    const current = selectedMaterials.value[type] as ChapterContentMaterial[]
    const next = current.some(item => item.id === material.id)
      ? current.filter(item => item.id !== material.id)
      : [...current, material]
    selectedMaterials.value = { ...selectedMaterials.value, [type]: next }
  }

  const allMaterials = (type: ChapterContentMaterialType): ChapterContentMaterial[] => {
    switch (type) {
      case 'characters': return options.characters.value
      case 'worldSettings': return options.worldSettings.value
      case 'corpus': return options.corpusData.value
      case 'events': return options.events.value
    }
  }

  const selectAllMaterials = (type: ChapterContentMaterialType) => {
    selectedMaterials.value = {
      ...selectedMaterials.value,
      [type]: [...allMaterials(type)],
    }
  }

  const clearMaterials = () => {
    selectedMaterials.value = emptyMaterials()
  }

  const clearAllSelections = () => {
    clearMaterials()
    selectedContextChapterIds.value = []
  }

  const toggleContextChapter = (chapterId: number) => {
    if (!availableContextChapters.value.some(chapter => chapter.id === chapterId)) return

    selectedContextChapterIds.value = selectedContextChapterIds.value.includes(chapterId)
      ? selectedContextChapterIds.value.filter(id => id !== chapterId)
      : [...selectedContextChapterIds.value, chapterId]
  }

  const selectAllContextChapters = () => {
    selectedContextChapterIds.value = availableContextChapters.value.map(chapter => chapter.id)
  }

  const clearContextSelection = () => {
    selectedContextChapterIds.value = []
  }

  watch(
    [availableContextChapters, selectedContextChapterIds],
    () => {
      if (!sanitizeContextChapterIds()) autoFillVariables()
    },
    { deep: true, flush: 'sync' },
  )
  watch(
    [generateConfig, selectedMaterials, targetChapter, options.currentNovel, options.chapters,
      options.characters, options.worldSettings, options.corpusData, options.events],
    autoFillVariables,
    { deep: true, flush: 'sync' },
  )
  watch(selectedContentCategory, (category) => {
    if (selectedPrompt.value?.category !== category) clearPrompt()
  }, { flush: 'sync' })

  return {
    visible,
    targetChapter,
    targetChapterId,
    selectedContentCategory,
    generateConfig,
    selectedMaterials,
    selectedContextChapterIds,
    selectedContextChapterRecords,
    availableContextChapters,
    selectedPrompt,
    promptVariables,
    finalPrompt,
    open,
    close,
    reset,
    createSnapshot,
    selectPrompt,
    clearPrompt,
    autoFillVariables,
    toggleMaterial,
    selectAllMaterials,
    clearMaterials,
    clearAllSelections,
    toggleContextChapter,
    selectAllContextChapters,
    clearContextSelection,
  }
}
