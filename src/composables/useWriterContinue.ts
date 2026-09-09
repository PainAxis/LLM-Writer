import { computed, ref, watch, type Ref } from 'vue'
import type { WriterChapter, WriterCharacter, WriterContinueForm, WriterNovel } from '@/types/writer'
import type { GenerateOptions, StreamCallback } from '@/types/api'
import { isAIRequestCancelled } from '@/utils/aiRequestScope'
import { formatGeneratedBody, stripWriterHtml } from '@/utils/writerContent'

interface ContinueStream {
  isStreaming: Ref<boolean>
  streamingContent: Ref<string>
  generate(prompt: string, options?: GenerateOptions, onChunk?: StreamCallback | null): Promise<string>
  stop(message?: string): void
  reset(): void
}

interface ContinueNotifications {
  success(message: string): unknown
  warning(message: string): unknown
  error(message: string): unknown
}

interface WriterContinueOptions {
  currentNovel: Readonly<Ref<WriterNovel | null>>
  currentChapter: Readonly<Ref<WriterChapter | null>>
  content: Ref<string>
  characters: Readonly<Ref<WriterCharacter[]>>
  hasUnsavedChanges: Ref<boolean>
  ensureApiReady: () => boolean
  saveCurrentChapter: () => Promise<boolean>
  describeGenre: (genre: string | undefined) => string
  notify: ContinueNotifications
  writeText: (text: string) => Promise<void>
  stream: ContinueStream
}

const createContinueForm = (): WriterContinueForm => ({
  direction: '',
  wordCount: 500,
  isStreaming: false,
})

/** Continuation dialog state and its independent AI request lifecycle. */
export function useWriterContinue(options: WriterContinueOptions) {
  const stream = options.stream
  const visible = ref(false)
  const form = ref<WriterContinueForm>(createContinueForm())
  const currentText = computed(() => stripWriterHtml(options.content.value))
  const canStart = computed(() => Boolean(options.currentChapter.value) && currentText.value.length >= 50)
  const isAppending = ref(false)
  const isCommitting = isAppending
  let sourceChapterId: number | null = null
  let lifecycle = 0
  let contentApplied = false
  let activeCommit: Promise<boolean> | null = null
  let resetAfterCommit = false
  let closeAfterCommit = false

  const sourceIsCurrent = () => sourceChapterId !== null && options.currentChapter.value?.id === sourceChapterId

  const clearState = () => {
    lifecycle += 1
    stream.reset()
    form.value = createContinueForm()
    sourceChapterId = null
    contentApplied = false
    isAppending.value = false
  }

  const reset = () => {
    if (activeCommit) {
      resetAfterCommit = true
      return false
    }
    clearState()
    return true
  }

  const finishCommit = (commit: Promise<boolean>, succeeded: boolean) => {
    if (activeCommit !== commit) return
    activeCommit = null
    isAppending.value = false

    // A failed save keeps the applied draft and generated result available for retry.
    const shouldReset = succeeded && resetAfterCommit
    const shouldClose = succeeded && closeAfterCommit
    resetAfterCommit = false
    closeAfterCommit = false
    try {
      if (shouldReset) clearState()
      if (shouldClose) visible.value = false
    } catch (error) {
      console.error('清理续写提交状态失败:', error)
    }
  }

  const trackCommit = (operation: () => Promise<boolean>): Promise<boolean> => {
    isAppending.value = true
    const normalized = Promise.resolve()
      .then(operation)
      .then(result => Boolean(result), error => {
        console.error('追加续写失败:', error)
        try {
          options.notify.error(`追加失败: ${(error as Error).message}`)
        } catch {
          // Notification failures must not turn a persistence result into a rejection.
        }
        return false
      })

    const commit = normalized.then(
      result => {
        finishCommit(commit, result)
        return result
      },
      () => {
        finishCommit(commit, false)
        return false
      },
    )
    activeCommit = commit
    return commit
  }

  const open = () => {
    if (activeCommit) return false
    if (!options.ensureApiReady()) return
    if (!options.currentChapter.value) {
      options.notify.warning('请先选择一个章节')
      return
    }
    if (currentText.value.length < 50) {
      options.notify.warning('请先写一些内容，AI将基于现有内容进行续写')
      return
    }

    clearState()
    sourceChapterId = options.currentChapter.value.id
    visible.value = true
    return true
  }

  const start = async () => {
    if (activeCommit) return false
    if (!canStart.value || !sourceIsCurrent()) {
      options.notify.warning('内容太少或章节已切换，无法进行续写')
      return false
    }

    const operation = lifecycle
    const novel = options.currentNovel.value
    const chapter = options.currentChapter.value
    if (!chapter) return false

    let prompt = `=== 小说基本信息 ===
小说标题：${novel?.title || '未命名小说'}
小说类型：${options.describeGenre(novel?.genre)}
小说简介：${novel?.description || '暂无简介'}

=== 当前章节信息 ===
章节标题：${chapter.title}
章节大纲：${chapter.description || '暂无大纲'}

=== 续写任务 ===
请为上述小说的当前章节续写内容。

=== 已有内容（必须保持连贯） ===
${currentText.value}

${options.characters.value.length > 0 ? `=== 主要人物设定 ===
${options.characters.value.map(character => `- ${character.name}：${character.personality || '暂无描述'}`).join('\n')}

` : ''}=== 续写要求 ===
1. 基于已有内容的风格和语调继续创作
2. 保持情节的连贯性和逻辑性
3. 符合章节大纲的发展方向
4. 续写长度约${form.value.wordCount}字`

    if (form.value.direction.trim()) {
      prompt += `
5. 续写方向：${form.value.direction.trim()}`
    }

    prompt += `

=== 核心约束（必须严格遵守） ===
1. 【连贯性】必须与已有内容在语言风格、情节发展、人物行为上完全连贯
2. 【一致性】人物性格、世界观设定、时间线必须与前文保持一致
3. 【逻辑性】情节发展必须符合逻辑，不能出现突兀的转折
4. 【主题控制】不得偏离章节大纲的主要情节线

请直接输出续写内容，无需额外说明：`

    try {
      const result = await stream.generate(prompt, {
        maxTokens: null,
        temperature: 0.8,
        type: 'continue',
      })
      if (operation !== lifecycle || !sourceIsCurrent()) return false
      if (!result.trim()) throw new Error('AI返回内容为空')
      stream.streamingContent.value = result.trim()
      contentApplied = false
      options.notify.success('续写完成')
      return true
    } catch (error) {
      if (isAIRequestCancelled(error)) return false
      console.error('AI续写失败:', error)
      options.notify.error(`续写失败: ${(error as Error).message}`)
      return false
    }
  }

  const stop = () => {
    if (activeCommit) return false
    stream.stop('已停止续写')
    return true
  }

  const copy = async () => {
    if (!stream.streamingContent.value) {
      options.notify.warning('没有可复制的内容')
      return
    }
    try {
      await options.writeText(stream.streamingContent.value)
      options.notify.success('续写内容已复制到剪贴板')
    } catch (error) {
      console.error('复制失败:', error)
      options.notify.error('复制失败，请手动复制')
    }
  }

  const append = (): Promise<boolean> => {
    if (activeCommit) return activeCommit
    if (!stream.streamingContent.value) {
      options.notify.warning('没有可追加的内容')
      return Promise.resolve(false)
    }
    if (!sourceIsCurrent()) {
      options.notify.warning('章节已切换，不能追加旧章节的续写内容')
      return Promise.resolve(false)
    }

    const operation = lifecycle
    if (!contentApplied) {
      options.content.value += `\n${formatGeneratedBody(stream.streamingContent.value)}`
      options.hasUnsavedChanges.value = true
      contentApplied = true
    }

    return trackCommit(async () => {
      if (!(await options.saveCurrentChapter())) return false
      if (operation !== lifecycle || !sourceIsCurrent()) return false
      options.notify.success('续写内容已追加到文章')
      closeAfterCommit = true
      return true
    })
  }

  const cancelAndClose = () => {
    if (activeCommit) {
      resetAfterCommit = true
      closeAfterCommit = true
      return false
    }
    visible.value = false
    clearState()
    return true
  }

  const waitForCommit = (): Promise<boolean> => activeCommit ?? Promise.resolve(true)

  watch(visible, opened => {
    if (!opened && activeCommit) {
      resetAfterCommit = true
      closeAfterCommit = true
      visible.value = true
    }
  }, { flush: 'sync' })

  return {
    visible,
    form,
    currentText,
    canStart,
    streamingContent: stream.streamingContent,
    isStreaming: stream.isStreaming,
    isAppending,
    isCommitting,
    stream,
    open,
    reset,
    start,
    stop,
    copy,
    append,
    cancelAndClose,
    waitForCommit,
  }
}
