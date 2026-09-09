import { ref, watch, type Ref } from 'vue'
import type { GenerateOptions, StreamCallback } from '@/types/api'
import type {
  WriterChapter,
  WriterChapterForm,
  WriterCharacter,
  WriterNovel,
  WriterWorldSetting,
} from '@/types/writer'
import { isAIRequestCancelled } from '@/utils/aiRequestScope'
import {
  buildChapterOutlinePrompt,
  createChapterOutlinePromptSnapshot,
  type ChapterOutlinePromptSnapshot,
} from '@/utils/writer/chapterOutlinePrompts'

export interface WriterChapterEditOutlineStream {
  generate(
    prompt: string,
    options?: GenerateOptions,
    onChunk?: StreamCallback | null,
  ): Promise<string>
  stop?(message?: string): void
}

export interface WriterChapterEditOutlineNotifications {
  success(message: string): unknown
  warning(message: string): unknown
  error(message: string): unknown
}

export interface UseWriterChapterEditOutlineGenerationOptions {
  currentNovel: Readonly<Ref<WriterNovel | null | undefined>>
  chapters: Readonly<Ref<WriterChapter[]>>
  characters: Readonly<Ref<WriterCharacter[]>>
  worldSettings: Readonly<Ref<WriterWorldSetting[]>>
  form: Ref<WriterChapterForm>
  editingChapter: Readonly<Ref<WriterChapter | null>>
  visible: Readonly<Ref<boolean>>
  ensureApiReady(): boolean
  stream: WriterChapterEditOutlineStream
  notify: WriterChapterEditOutlineNotifications
  buildPrompt?(snapshot: ChapterOutlinePromptSnapshot): string
  generateOptions?: GenerateOptions
  isCancellation?(error: unknown): boolean
}

interface ChapterEditOutlineSource {
  operation: number
  novel: WriterNovel
  novelId: number
  form: WriterChapterForm
  editingChapter: WriterChapter | null
  chapters: WriterChapter[]
  characters: WriterCharacter[]
  worldSettings: WriterWorldSetting[]
  observedIdentity: string
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const defaultCancellationCheck = (error: unknown): boolean =>
  isAIRequestCancelled(error) || (error instanceof Error && error.name === 'AbortError')

const formIdentity = (form: Readonly<WriterChapterForm>): string => JSON.stringify({
  title: form.title,
  description: form.description,
  status: form.status,
})

const editingChapterIdentity = (chapter: Readonly<WriterChapter> | null): string =>
  JSON.stringify(chapter
    ? {
        id: chapter.id,
        title: chapter.title,
        description: chapter.description,
        content: chapter.content,
        wordCount: chapter.wordCount,
        status: chapter.status,
        updatedAt: chapter.updatedAt,
      }
    : null)

/**
 * An existing chapter must only see chapters that precede it. A new chapter is
 * appended conceptually, so every existing chapter is valid continuity input.
 */
function chaptersBeforeDraft(
  chapters: readonly WriterChapter[],
  editingChapter: Readonly<WriterChapter> | null,
): readonly WriterChapter[] {
  if (!editingChapter) return chapters

  const index = chapters.findIndex(chapter =>
    chapter === editingChapter || chapter.id === editingChapter.id,
  )
  return index >= 0
    ? chapters.slice(0, index)
    : chapters.filter(chapter => chapter.id !== editingChapter.id)
}

/**
 * Owns AI outline generation for the chapter metadata edit dialog.
 *
 * Streaming output is isolated in `preview`. The form is replaced exactly once
 * after a complete response, and only if every source object and every prompt
 * input still belongs to the request that produced it.
 */
export function useWriterChapterEditOutlineGeneration(
  options: UseWriterChapterEditOutlineGenerationOptions,
) {
  const preview = ref('')
  const isGenerating = ref(false)
  const buildPrompt = options.buildPrompt ?? buildChapterOutlinePrompt
  const isCancellation = options.isCancellation ?? defaultCancellationCheck
  let lifecycle = 0
  let applyingResult = false

  const capturePromptSnapshot = (): ChapterOutlinePromptSnapshot =>
    createChapterOutlinePromptSnapshot({
      novel: options.currentNovel.value ?? null,
      form: options.form.value,
      chapters: chaptersBeforeDraft(
        options.chapters.value,
        options.editingChapter.value,
      ),
      characters: options.characters.value,
      worldSettings: options.worldSettings.value,
    })

  const observedIdentity = (): string => JSON.stringify({
    novel: options.currentNovel.value
      ? {
          id: options.currentNovel.value.id,
          title: options.currentNovel.value.title,
          genre: options.currentNovel.value.genre,
          description: options.currentNovel.value.description,
        }
      : null,
    form: formIdentity(options.form.value),
    editingChapter: editingChapterIdentity(options.editingChapter.value),
    prompt: capturePromptSnapshot(),
  })

  const sourceIsCurrent = (source: ChapterEditOutlineSource): boolean => {
    const novel = options.currentNovel.value
    return source.operation === lifecycle
      && options.visible.value
      && novel === source.novel
      && novel?.id === source.novelId
      && options.form.value === source.form
      && options.editingChapter.value === source.editingChapter
      && options.chapters.value === source.chapters
      && options.characters.value === source.characters
      && options.worldSettings.value === source.worldSettings
      && observedIdentity() === source.observedIdentity
  }

  const stopOwnedRequest = (): void => {
    if (!isGenerating.value) return
    try {
      options.stream.stop?.('')
    } catch {
      // Revoking the lifecycle is enough to prevent a late transport result
      // from reaching the form, even if the adapter itself cannot stop.
    }
  }

  const cancel = (clearPreview = true): void => {
    lifecycle += 1
    stopOwnedRequest()
    isGenerating.value = false
    if (clearPreview) preview.value = ''
  }

  // Invalidate on the event, not only by comparing final values. This prevents
  // an edit-then-revert sequence or a close-then-reopen sequence from making a
  // stale request look current again.
  const stopSourceWatch = watch(
    () => [
      options.visible.value,
      options.currentNovel.value,
      options.form.value,
      options.editingChapter.value,
      options.chapters.value,
      options.characters.value,
      options.worldSettings.value,
      observedIdentity(),
    ] as const,
    () => {
      if (!options.visible.value) {
        cancel()
        return
      }
      if (isGenerating.value && !applyingResult) cancel()
    },
    { flush: 'sync' },
  )

  const generate = async (): Promise<boolean> => {
    if (!options.ensureApiReady()) return false
    if (!options.visible.value) {
      options.notify.warning('章节编辑对话框已关闭，请重新打开后再生成')
      return false
    }

    const novel = options.currentNovel.value
    if (!novel) {
      options.notify.warning('小说上下文已失效，请重新打开编辑对话框')
      return false
    }

    const sourceForm = options.form.value
    const sourceEditingChapter = options.editingChapter.value
    const sourceChapters = options.chapters.value
    const sourceCharacters = options.characters.value
    const sourceWorldSettings = options.worldSettings.value

    let prompt: string
    let identity: string
    try {
      prompt = buildPrompt(capturePromptSnapshot())
      identity = observedIdentity()
    } catch (error) {
      options.notify.error(`大纲生成失败: ${errorMessage(error)}`)
      return false
    }

    if (!prompt.trim()) {
      options.notify.warning('生成提示词不能为空')
      return false
    }

    const operation = ++lifecycle
    stopOwnedRequest()
    const source: ChapterEditOutlineSource = {
      operation,
      novel,
      novelId: novel.id,
      form: sourceForm,
      editingChapter: sourceEditingChapter,
      chapters: sourceChapters,
      characters: sourceCharacters,
      worldSettings: sourceWorldSettings,
      observedIdentity: identity,
    }

    preview.value = ''
    isGenerating.value = true

    try {
      const response = await options.stream.generate(
        prompt,
        {
          maxTokens: null,
          temperature: 0.8,
          type: 'outline',
          ...options.generateOptions,
        },
        (_chunk, fullContent) => {
          if (sourceIsCurrent(source)) preview.value = fullContent
        },
      )

      if (!sourceIsCurrent(source)) return false
      if (!response.trim()) throw new Error('AI返回内容为空')

      preview.value = response
      applyingResult = true
      try {
        options.form.value = { ...sourceForm, description: response }
      } finally {
        applyingResult = false
      }
      options.notify.success('章节大纲生成成功')
      return true
    } catch (error) {
      if (isCancellation(error) || !sourceIsCurrent(source)) return false
      options.notify.error(`大纲生成失败: ${errorMessage(error)}`)
      return false
    } finally {
      if (operation === lifecycle) isGenerating.value = false
    }
  }

  const reset = (): void => cancel(true)

  const dispose = (): void => {
    stopSourceWatch()
    cancel(true)
  }

  return {
    preview,
    streamingContent: preview,
    isGenerating,
    isStreaming: isGenerating,
    generate,
    cancel,
    stop: cancel,
    reset,
    dispose,
  }
}
