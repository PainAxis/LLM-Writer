import { computed, ref, watch, type Ref } from 'vue'
import type { GenerateOptions, StreamCallback } from '@/types/api'
import type { PromptTemplate, WriterChapter, WriterOptimizeForm } from '@/types/writer'
import { isAIRequestCancelled } from '@/utils/aiRequestScope'
import { formatGeneratedContent, stripWriterHtml } from '@/utils/writerContent'

interface OptimizeStream {
  isStreaming: Ref<boolean>
  streamingContent: Ref<string>
  generate(prompt: string, options?: GenerateOptions, onChunk?: StreamCallback | null): Promise<string>
  stop(message?: string): void
  reset(): void
}

interface OptimizeNotifications {
  success(message: string): unknown
  info(message: string): unknown
  warning(message: string): unknown
  error(message: string): unknown
}

interface OptimizeEditorPort {
  readSelection(): string
  insertText(text: string): void
  getHtml(): string
}

interface WriterOptimizeOptions {
  currentChapter: Readonly<Ref<WriterChapter | null>>
  content: Ref<string>
  hasUnsavedChanges: Ref<boolean>
  availablePrompts: Readonly<Ref<PromptTemplate[]>>
  ensureApiReady: () => boolean
  saveCurrentChapter: () => Promise<boolean>
  confirmFullReplace: () => Promise<unknown>
  notify: OptimizeNotifications
  writeText: (text: string) => Promise<void>
  editor: OptimizeEditorPort
  stream: OptimizeStream
}

const createOptimizeForm = (): WriterOptimizeForm => ({
  originalContent: '',
  optimizedContent: '',
  customPrompt: '',
  selectedPrompt: null,
  mode: 'full',
  isOptimizing: false,
})

/** Text optimization dialog state, stream and guarded editor application. */
export function useWriterOptimize(options: WriterOptimizeOptions) {
  const stream = options.stream
  const visible = ref(false)
  const form = ref<WriterOptimizeForm>(createOptimizeForm())
  const prompts = computed(() => options.availablePrompts.value.filter(prompt => prompt.category === 'polish'))
  const canStart = computed(() => Boolean(
    form.value.originalContent.trim()
    && (form.value.selectedPrompt || form.value.customPrompt.trim()),
  ))
  const isApplying = ref(false)
  const isCommitting = isApplying
  let sourceChapterId: number | null = null
  let lifecycle = 0
  let contentApplied = false
  let fullReplaceConfirmed = false
  let activeCommit: Promise<boolean> | null = null
  let resetAfterCommit = false
  let closeAfterCommit = false

  const sourceIsCurrent = () => sourceChapterId !== null && options.currentChapter.value?.id === sourceChapterId

  const clearState = () => {
    lifecycle += 1
    stream.reset()
    form.value = createOptimizeForm()
    sourceChapterId = null
    contentApplied = false
    fullReplaceConfirmed = false
    isApplying.value = false
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
    isApplying.value = false

    // A failed save keeps the applied draft and generated result available for retry.
    const shouldReset = succeeded && resetAfterCommit
    const shouldClose = succeeded && closeAfterCommit
    resetAfterCommit = false
    closeAfterCommit = false
    try {
      if (shouldReset) clearState()
      if (shouldClose) visible.value = false
    } catch (error) {
      console.error('清理润色提交状态失败:', error)
    }
  }

  const trackCommit = (operation: () => Promise<boolean>): Promise<boolean> => {
    isApplying.value = true
    const normalized = Promise.resolve()
      .then(operation)
      .then(result => Boolean(result), error => {
        console.error('应用润色结果失败:', error)
        try {
          options.notify.error('替换失败')
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

  const openFromEditor = () => {
    if (activeCommit) return false
    if (!options.ensureApiReady()) return
    const chapter = options.currentChapter.value
    if (!chapter) {
      options.notify.warning('请先选择一个章节')
      return
    }

    let selectedText = ''
    try {
      selectedText = options.editor.readSelection()
    } catch (error) {
      console.warn('获取选择文本失败:', error)
    }

    clearState()
    sourceChapterId = chapter.id
    if (selectedText.trim()) {
      form.value.originalContent = selectedText.trim()
      form.value.mode = 'selection'
      options.notify.info('检测到选择内容，将优化选择的文本')
    } else {
      const fullText = stripWriterHtml(options.content.value)
      if (!fullText) {
        options.notify.warning('当前章节没有内容可以优化')
        return
      }
      form.value.originalContent = fullText
      form.value.mode = 'full'
      options.notify.info('未检测到选择内容，将优化整篇文章')
    }
    visible.value = true
    return true
  }

  const selectPrompt = (prompt: PromptTemplate) => {
    form.value.selectedPrompt = prompt
    form.value.customPrompt = ''
  }

  watch(() => form.value.customPrompt, customPrompt => {
    if (customPrompt.trim()) form.value.selectedPrompt = null
  })

  const start = async () => {
    if (activeCommit) return false
    if (!canStart.value) {
      options.notify.warning('请选择润色类型或输入自定义要求')
      return false
    }
    if (!sourceIsCurrent()) {
      options.notify.warning('章节已切换，无法继续润色')
      return false
    }

    const operation = lifecycle
    const promptContent = form.value.selectedPrompt?.content || form.value.customPrompt.trim()
    const fullPrompt = `${promptContent}

原始内容：
${form.value.originalContent}

请直接输出优化后的内容，无需额外说明：`

    stream.reset()
    form.value.optimizedContent = ''
    contentApplied = false
    fullReplaceConfirmed = false
    try {
      const result = await stream.generate(fullPrompt, {
        maxTokens: null,
        temperature: 0.7,
        type: 'optimize',
      })
      if (operation !== lifecycle || !sourceIsCurrent()) return false
      if (!result.trim()) throw new Error('AI返回内容为空')
      stream.streamingContent.value = result.trim()
      form.value.optimizedContent = result.trim()
      options.notify.success('内容润色完成')
      return true
    } catch (error) {
      if (isAIRequestCancelled(error)) return false
      console.error('AI润色失败:', error)
      options.notify.error(`润色失败: ${(error as Error).message}`)
      return false
    }
  }

  const stop = () => {
    if (activeCommit) return false
    form.value.optimizedContent = stream.streamingContent.value
    contentApplied = false
    fullReplaceConfirmed = false
    stream.stop('已停止润色')
    return true
  }

  const copy = async () => {
    if (!form.value.optimizedContent) {
      options.notify.warning('没有可复制的内容')
      return
    }
    try {
      await options.writeText(form.value.optimizedContent)
      options.notify.success('内容已复制到剪贴板')
    } catch (error) {
      console.error('复制失败:', error)
      options.notify.error('复制失败，请手动复制')
    }
  }

  const applySelection = (): Promise<boolean> => {
    if (activeCommit) return activeCommit
    if (!form.value.optimizedContent) {
      options.notify.warning('没有可替换的内容')
      return Promise.resolve(false)
    }
    if (form.value.mode !== 'selection' || !sourceIsCurrent()) {
      options.notify.warning('选择已失效，请回到原章节重新选择文本')
      return Promise.resolve(false)
    }

    const operation = lifecycle
    return trackCommit(async () => {
      try {
        if (!contentApplied) {
          const currentSelection = options.editor.readSelection().trim()
          if (!currentSelection || currentSelection !== form.value.originalContent.trim()) {
            options.notify.warning('原选择内容已变化，请重新选择要替换的文本')
            return false
          }
          options.editor.insertText(form.value.optimizedContent)
          options.content.value = options.editor.getHtml()
          options.hasUnsavedChanges.value = true
          contentApplied = true
        }
        if (!(await options.saveCurrentChapter())) return false
        if (operation !== lifecycle || !sourceIsCurrent()) return false
        options.notify.success('选择内容已替换为润色结果')
        closeAfterCommit = true
        return true
      } catch (error) {
        console.error('替换失败:', error)
        options.notify.error('替换失败')
        return false
      }
    })
  }

  const applyFull = (): Promise<boolean> => {
    if (activeCommit) return activeCommit
    if (!form.value.optimizedContent) {
      options.notify.warning('没有可替换的内容')
      return Promise.resolve(false)
    }
    if (form.value.mode !== 'full' || !sourceIsCurrent()) {
      options.notify.warning('章节已切换，不能应用旧章节的润色结果')
      return Promise.resolve(false)
    }

    const operation = lifecycle
    return trackCommit(async () => {
      try {
        if (!fullReplaceConfirmed) {
          await options.confirmFullReplace()
          if (operation !== lifecycle || !sourceIsCurrent()) return false
          fullReplaceConfirmed = true
        }
        if (!contentApplied) {
          const chapter = options.currentChapter.value
          if (!chapter) return false
          options.content.value = formatGeneratedContent(form.value.optimizedContent, chapter.title)
          options.hasUnsavedChanges.value = true
          contentApplied = true
        }
        if (!(await options.saveCurrentChapter())) return false
        if (operation !== lifecycle || !sourceIsCurrent()) return false
        options.notify.success('全文内容已替换为润色结果')
        closeAfterCommit = true
        return true
      } catch (error) {
        if (operation === lifecycle && sourceIsCurrent() && fullReplaceConfirmed) {
          console.error('替换失败:', error)
          options.notify.error('替换失败')
        }
        // Element Plus rejects the promise when the user cancels; cancellation is silent.
        return false
      }
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
    prompts,
    canStart,
    streamingContent: stream.streamingContent,
    isStreaming: stream.isStreaming,
    isApplying,
    isCommitting,
    openFromEditor,
    selectPrompt,
    reset,
    start,
    stop,
    copy,
    applySelection,
    applyFull,
    cancelAndClose,
    waitForCommit,
  }
}
