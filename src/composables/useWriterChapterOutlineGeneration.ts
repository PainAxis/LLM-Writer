import { ref, watch, type Ref } from 'vue'
import type { GenerateOptions } from '@/types/api'
import type {
  PromptTemplate,
  WriterBatchChapterGenerationForm,
  WriterChapter,
  WriterNovel,
  WriterSingleChapterGenerationForm,
} from '@/types/writer'
import type { ParsedChapter } from '@/utils/chapterParser'
import { isAIRequestCancelled } from '@/utils/aiRequestScope'

export type WriterChapterOutlineMode = 'single' | 'batch'

export interface WriterChapterOutlinePromptInput<Form> {
  novel: Readonly<Pick<WriterNovel, 'title' | 'genre' | 'description'>>
  chapters: ReadonlyArray<Readonly<Pick<WriterChapter, 'id' | 'title' | 'description' | 'wordCount'>>>
  form: Readonly<Form>
  customPrompt?: string
}

export interface WriterChapterOutlineStream {
  streamingContent: Ref<string>
  isStreaming: Readonly<Ref<boolean>>
  generate(prompt: string, options?: GenerateOptions): Promise<string>
  reset(): void
}

export interface WriterChapterOutlineNotifications {
  success(message: string): unknown
  warning(message: string): unknown
  error(message: string): unknown
}

export interface WriterChapterOutlineGenerationOptions {
  currentNovel: Readonly<Ref<WriterNovel | null>>
  chapters: Ref<WriterChapter[]>
  ensureApiReady(): boolean
  persist(): Promise<boolean>
  buildSinglePrompt(
    input: WriterChapterOutlinePromptInput<WriterSingleChapterGenerationForm>,
  ): string
  buildBatchPrompt(
    input: WriterChapterOutlinePromptInput<WriterBatchChapterGenerationForm>,
  ): string
  parseBatchResponse(response: string): ParsedChapter[]
  notify: WriterChapterOutlineNotifications
  stream: WriterChapterOutlineStream
  createId?: () => number
  now?: () => Date
}

interface GenerationSource {
  operation: number
  mode: WriterChapterOutlineMode
  novel: WriterNovel
  novelFingerprint: string
  chapters: WriterChapter[]
  chapterFingerprint: string
  formFingerprint: string
}

export const createSingleChapterGenerationForm = (): WriterSingleChapterGenerationForm => ({
  title: '',
  plotRequirement: '',
  template: 'general',
})

export const createBatchChapterGenerationForm = (): WriterBatchChapterGenerationForm => ({
  count: 3,
  plotRequirement: '',
  template: 'general',
})

const formFingerprint = (form: object) => JSON.stringify(form)
const novelFingerprint = (novel: WriterNovel | null) => JSON.stringify(novel && {
  id: novel.id,
  title: novel.title,
  genre: novel.genre,
  description: novel.description,
})
const chapterFingerprint = (chapters: readonly WriterChapter[]) => JSON.stringify(
  chapters.map(chapter => ({
    id: chapter.id,
    title: chapter.title,
    description: chapter.description,
    wordCount: chapter.wordCount,
  })),
)
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Owns both new-chapter outline dialogs, request state and persistence transaction. */
export function useWriterChapterOutlineGeneration(
  options: WriterChapterOutlineGenerationOptions,
) {
  const singleVisible = ref(false)
  const batchVisible = ref(false)
  const singleForm = ref(createSingleChapterGenerationForm())
  const batchForm = ref(createBatchChapterGenerationForm())
  const singleSelectedPrompt = ref<PromptTemplate | null>(null)
  const batchSelectedPrompt = ref<PromptTemplate | null>(null)
  const singleTemplatePrompt = ref('')
  const batchTemplatePrompt = ref('')
  const activeMode = ref<WriterChapterOutlineMode | null>(null)
  const isGenerating = ref(false)
  const isCommitting = ref(false)

  const stream = options.stream
  const createId = options.createId ?? (() => Date.now())
  const now = options.now ?? (() => new Date())
  let lifecycle = 0
  let resetAfterCommit = false
  let activeGeneration: Promise<boolean> | null = null
  let singlePromptFingerprint = ''
  let batchPromptFingerprint = ''
  let mutatingChapters = false

  const promptContextFingerprint = (mode: WriterChapterOutlineMode) => JSON.stringify({
    novel: novelFingerprint(options.currentNovel.value),
    form: mode === 'single' ? singleForm.value : batchForm.value,
    chapters: chapterFingerprint(options.chapters.value),
  })

  const clearSinglePrompt = () => {
    singleSelectedPrompt.value = null
    singleTemplatePrompt.value = ''
    singlePromptFingerprint = ''
  }

  const clearBatchPrompt = () => {
    batchSelectedPrompt.value = null
    batchTemplatePrompt.value = ''
    batchPromptFingerprint = ''
  }

  const projectIsCurrent = (source: GenerationSource) => (
    source.operation === lifecycle
    && options.currentNovel.value === source.novel
    && options.currentNovel.value?.id === source.novel.id
    && novelFingerprint(options.currentNovel.value) === source.novelFingerprint
    && options.chapters.value === source.chapters
  )

  const draftIsCurrent = (source: GenerationSource) => {
    const form = source.mode === 'single' ? singleForm.value : batchForm.value
    const visible = source.mode === 'single' ? singleVisible.value : batchVisible.value
    return projectIsCurrent(source)
      && visible
      && formFingerprint(form) === source.formFingerprint
      && chapterFingerprint(source.chapters) === source.chapterFingerprint
  }

  const cancel = () => {
    if (isCommitting.value) {
      resetAfterCommit = true
      return false
    }
    lifecycle += 1
    stream.reset()
    activeMode.value = null
    isGenerating.value = false
    resetAfterCommit = false
    return true
  }

  const clearSingleState = () => {
    singleVisible.value = false
    singleForm.value = createSingleChapterGenerationForm()
    clearSinglePrompt()
  }

  const clearBatchState = () => {
    batchVisible.value = false
    batchForm.value = createBatchChapterGenerationForm()
    clearBatchPrompt()
  }

  const resetSingle = () => {
    if (isCommitting.value && activeMode.value === 'single') {
      resetAfterCommit = true
      return false
    }
    if (activeMode.value === 'single') cancel()
    clearSingleState()
    stream.streamingContent.value = ''
    return true
  }

  const resetBatch = () => {
    if (isCommitting.value && activeMode.value === 'batch') {
      resetAfterCommit = true
      return false
    }
    if (activeMode.value === 'batch') cancel()
    clearBatchState()
    stream.streamingContent.value = ''
    return true
  }

  const reset = () => {
    if (isCommitting.value) {
      resetAfterCommit = true
      return false
    }
    cancel()
    clearSingleState()
    clearBatchState()
    return true
  }

  const openSingle = () => {
    if (isCommitting.value) return false
    reset()
    singleVisible.value = true
    return true
  }

  const openBatch = () => {
    if (isCommitting.value) return false
    reset()
    batchVisible.value = true
    return true
  }

  const useSinglePrompt = (prompt: PromptTemplate, renderedPrompt: string) => {
    if (!renderedPrompt.trim()) {
      options.notify.warning('提示词内容为空，请重新选择')
      return false
    }
    singleSelectedPrompt.value = prompt
    singleTemplatePrompt.value = renderedPrompt
    singlePromptFingerprint = promptContextFingerprint('single')
    return true
  }

  const useBatchPrompt = (prompt: PromptTemplate, renderedPrompt: string) => {
    if (!renderedPrompt.trim()) {
      options.notify.warning('提示词内容为空，请重新选择')
      return false
    }
    batchSelectedPrompt.value = prompt
    batchTemplatePrompt.value = renderedPrompt
    batchPromptFingerprint = promptContextFingerprint('batch')
    return true
  }

  const allocateId = (reserved: Set<number>) => {
    let id = createId()
    while (reserved.has(id)) id += 1
    reserved.add(id)
    return id
  }

  const rollbackInserted = (collection: WriterChapter[], inserted: Set<WriterChapter>) => {
    for (let index = collection.length - 1; index >= 0; index -= 1) {
      if (inserted.has(collection[index])) collection.splice(index, 1)
    }
  }

  const commitChapters = async (
    source: GenerationSource,
    candidates: WriterChapter[],
  ) => {
    const collection = source.chapters
    isCommitting.value = true
    let inserted = new Set<WriterChapter>()
    try {
      mutatingChapters = true
      try {
        collection.push(...candidates)
        inserted = new Set(collection.slice(-candidates.length))
      } finally {
        mutatingChapters = false
      }

      let saved = false
      try {
        saved = await options.persist()
      } catch {
        saved = false
      }

      if (!saved) {
        mutatingChapters = true
        try {
          rollbackInserted(collection, inserted)
        } finally {
          mutatingChapters = false
        }
        options.notify.error('生成的章节尚未保存，请重试')
        return false
      }
      return projectIsCurrent(source)
    } finally {
      isCommitting.value = false
    }
  }

  const generate = async (mode: WriterChapterOutlineMode) => {
    if (isGenerating.value || isCommitting.value) return false
    if (!options.ensureApiReady()) return false

    const novel = options.currentNovel.value
    if (!novel) {
      options.notify.warning('当前小说不存在，无法生成章节')
      return false
    }
    const form = mode === 'single' ? singleForm.value : batchForm.value
    if (mode === 'single' && !singleForm.value.title.trim()) {
      options.notify.warning('请输入章节标题')
      return false
    }
    if (mode === 'batch'
      && (!Number.isInteger(batchForm.value.count)
        || batchForm.value.count < 1
        || batchForm.value.count > 10)) {
      options.notify.warning('生成数量必须是 1 到 10 之间的整数')
      return false
    }

    const chapterCollection = options.chapters.value
    const chaptersSnapshot = chapterCollection.map(chapter => ({
      id: chapter.id,
      title: chapter.title,
      description: chapter.description,
      wordCount: chapter.wordCount,
    }))
    const formSnapshot = { ...form }
    const customPrompt = mode === 'single'
      ? (singleSelectedPrompt.value ? singleTemplatePrompt.value : undefined)
      : (batchSelectedPrompt.value ? batchTemplatePrompt.value : undefined)
    let prompt: string
    try {
      const input = {
        novel: {
          title: novel.title,
          genre: novel.genre,
          description: novel.description,
        },
        chapters: chaptersSnapshot,
        form: formSnapshot,
        customPrompt,
      }
      prompt = mode === 'single'
        ? options.buildSinglePrompt(input as WriterChapterOutlinePromptInput<WriterSingleChapterGenerationForm>)
        : options.buildBatchPrompt(input as WriterChapterOutlinePromptInput<WriterBatchChapterGenerationForm>)
    } catch (error) {
      options.notify.error(`章节提示词构建失败: ${errorMessage(error)}`)
      return false
    }
    if (!prompt.trim()) {
      options.notify.warning('生成提示词不能为空')
      return false
    }

    const operation = ++lifecycle
    const source: GenerationSource = {
      operation,
      mode,
      novel,
      novelFingerprint: novelFingerprint(novel),
      chapters: chapterCollection,
      chapterFingerprint: chapterFingerprint(chapterCollection),
      formFingerprint: formFingerprint(form),
    }
    activeMode.value = mode
    stream.reset()
    isGenerating.value = true

    try {
      const response = await stream.generate(prompt, {
        maxTokens: null,
        temperature: 0.8,
        type: 'outline',
      })
      if (!draftIsCurrent(source)) return false
      if (!response.trim()) throw new Error('AI返回内容为空')

      const timestamp = now()
      const reservedIds = new Set(chapterCollection.map(chapter => chapter.id))
      let candidates: WriterChapter[]
      if (mode === 'single') {
        const singleSnapshot = formSnapshot as WriterSingleChapterGenerationForm
        candidates = [{
          id: allocateId(reservedIds),
          title: singleSnapshot.title,
          description: response.replace(/^大纲：/, '').trim(),
          content: '',
          wordCount: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
          status: 'draft',
        }]
      } else {
        const batchSnapshot = formSnapshot as WriterBatchChapterGenerationForm
        const parsed = options.parseBatchResponse(response)
        if (parsed.length === 0) throw new Error('AI返回内容无法解析为章节大纲')
        if (parsed.length !== batchSnapshot.count) {
          options.notify.warning(
            `期望生成${batchSnapshot.count}个章节，实际解析出${parsed.length}个章节`,
          )
        }
        const firstChapterNumber = chapterCollection.length + 1
        candidates = parsed.map((chapter, index) => ({
          id: allocateId(reservedIds),
          title: chapter.title || `AI生成章节 ${firstChapterNumber + index}`,
          description: chapter.description || '暂无描述',
          content: '',
          wordCount: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
          status: 'draft',
        }))
      }

      if (!draftIsCurrent(source)) return false
      const saved = await commitChapters(source, candidates)
      if (!saved) return false

      const usedCustomPrompt = customPrompt !== undefined
      if (mode === 'single') {
        options.notify.success(usedCustomPrompt ? '使用自定义提示词生成单章成功' : '单章大纲生成成功')
        resetSingle()
      } else {
        options.notify.success(
          `${usedCustomPrompt ? '成功使用自定义提示词生成' : '成功生成'}${candidates.length}个章节大纲`,
        )
        resetBatch()
      }
      return true
    } catch (error) {
      if (isAIRequestCancelled(error) || operation !== lifecycle) return false
      console.error(`${mode === 'single' ? '单章' : '批量章节'}生成失败:`, error)
      options.notify.error(`${mode === 'single' ? '单章生成' : '批量生成'}失败: ${errorMessage(error)}`)
      return false
    } finally {
      if (operation === lifecycle && !isCommitting.value) {
        isGenerating.value = false
        activeMode.value = null
      }
      if (resetAfterCommit && !isCommitting.value) {
        resetAfterCommit = false
        reset()
      }
    }
  }

  const startGeneration = (mode: WriterChapterOutlineMode) => {
    if (isGenerating.value || isCommitting.value) return Promise.resolve(false)
    const request = generate(mode)
    activeGeneration = request
    void request.then(
      () => { if (activeGeneration === request) activeGeneration = null },
      () => { if (activeGeneration === request) activeGeneration = null },
    )
    return request
  }

  const generateSingle = () => startGeneration('single')
  const generateBatch = () => startGeneration('batch')
  const waitForCommit = () => isCommitting.value && activeGeneration
    ? activeGeneration
    : Promise.resolve(true)

  watch(singleVisible, opened => {
    if (!opened && isCommitting.value && activeMode.value === 'single') {
      resetAfterCommit = true
      singleVisible.value = true
    } else if (!opened && activeMode.value === 'single') {
      cancel()
    }
  }, { flush: 'sync' })

  watch(batchVisible, opened => {
    if (!opened && isCommitting.value && activeMode.value === 'batch') {
      resetAfterCommit = true
      batchVisible.value = true
    } else if (!opened && activeMode.value === 'batch') {
      cancel()
    }
  }, { flush: 'sync' })

  watch(singleForm, () => {
    if (singleSelectedPrompt.value
      && promptContextFingerprint('single') !== singlePromptFingerprint) clearSinglePrompt()
  }, { deep: true, flush: 'sync' })

  watch(batchForm, () => {
    if (batchSelectedPrompt.value
      && promptContextFingerprint('batch') !== batchPromptFingerprint) clearBatchPrompt()
  }, { deep: true, flush: 'sync' })

  watch(options.chapters, () => {
    if (mutatingChapters) return
    if (singleSelectedPrompt.value
      && promptContextFingerprint('single') !== singlePromptFingerprint) clearSinglePrompt()
    if (batchSelectedPrompt.value
      && promptContextFingerprint('batch') !== batchPromptFingerprint) clearBatchPrompt()
  }, { deep: true, flush: 'sync' })

  watch(options.currentNovel, (novel, previousNovel) => {
    if (previousNovel !== undefined && novel !== previousNovel) reset()
  }, { flush: 'sync' })

  watch(() => novelFingerprint(options.currentNovel.value), () => {
    if (singleSelectedPrompt.value
      && promptContextFingerprint('single') !== singlePromptFingerprint) clearSinglePrompt()
    if (batchSelectedPrompt.value
      && promptContextFingerprint('batch') !== batchPromptFingerprint) clearBatchPrompt()
  }, { flush: 'sync' })

  return {
    singleVisible,
    batchVisible,
    singleForm,
    batchForm,
    singleSelectedPrompt,
    batchSelectedPrompt,
    singleTemplatePrompt,
    batchTemplatePrompt,
    activeMode,
    isGenerating,
    isCommitting,
    streamingContent: stream.streamingContent,
    isStreaming: stream.isStreaming,
    openSingle,
    openBatch,
    resetSingle,
    resetBatch,
    reset,
    cancel,
    useSinglePrompt,
    useBatchPrompt,
    clearSinglePrompt,
    clearBatchPrompt,
    generateSingle,
    generateBatch,
    waitForCommit,
  }
}
