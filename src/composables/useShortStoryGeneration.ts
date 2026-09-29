import { reactive, watch, type Ref } from 'vue'
import type { GenerateOptions, StreamCallback } from '@/types/api'
import { isAIRequestCancelled } from '@/utils/aiRequestScope'

export type ShortStoryOperation = 'article' | 'story' | 'continue' | 'optimize'

interface GenerationStream {
  generate(prompt: string, options?: GenerateOptions, onChunk?: StreamCallback | null): Promise<string>
  stop(message?: string): void
}

interface GenerationRequest {
  prompt: string
  sourceContent?: string
  onText?: (text: string, isCurrent: () => boolean) => void
  successMessage: string
  errorPrefix: string
}

interface GenerationOptions {
  storyContent: Ref<string>
  streams: Record<ShortStoryOperation, GenerationStream>
  notify: {
    success(message: string): unknown
    error(message: string): unknown
    warning(message: string): unknown
  }
}

interface Operation {
  sourceContent?: string
  completed: boolean
}

const kinds: ShortStoryOperation[] = ['article', 'story', 'continue', 'optimize']
const derived: ShortStoryOperation[] = ['continue', 'optimize']

/** Owns each operation through cancellation, queued UI updates and completion. */
export function useShortStoryGeneration(options: GenerationOptions) {
  const states = reactive({
    article: { running: false, text: '' },
    story: { running: false, text: '' },
    continue: { running: false, text: '' },
    optimize: { running: false, text: '' },
  })
  const operations: Partial<Record<ShortStoryOperation, Operation>> = {}
  let disposed = false

  function stop(kind: ShortStoryOperation, clear = false) {
    delete operations[kind]
    options.streams[kind].stop('')
    states[kind].running = false
    if (clear) states[kind].text = ''
  }

  const stopWatching = watch(options.storyContent, content => {
    for (const kind of derived) {
      const operation = operations[kind]
      if (operation && operation.sourceContent !== content) stop(kind)
    }
  }, { flush: 'sync' })

  function canUseResult(kind: ShortStoryOperation) {
    const operation = operations[kind]
    return !disposed && Boolean(operation?.completed) && !states[kind].running && Boolean(states[kind].text.trim())
      && (operation?.sourceContent === undefined || operation.sourceContent === options.storyContent.value)
      && (!derived.includes(kind) || !states.story.running)
  }

  async function start(kind: ShortStoryOperation, request: GenerationRequest): Promise<boolean> {
    if (disposed) return false
    const sourceContent = derived.includes(kind)
      ? request.sourceContent ?? options.storyContent.value
      : undefined
    if (derived.includes(kind) && (states.story.running || sourceContent !== options.storyContent.value)) {
      options.notify.warning('正文已改变或仍在生成，请重新打开对话框后再试')
      return false
    }

    stop(kind, true)
    if (kind === 'story') {
      for (const other of derived) stop(other, true)
    }
    const operation: Operation = { sourceContent, completed: false }
    operations[kind] = operation
    states[kind].running = true
    const isCurrent = () => !disposed && operations[kind] === operation
      && (sourceContent === undefined || options.storyContent.value === sourceContent)
    const update = (text: string) => {
      if (!isCurrent() || operation.completed) return
      states[kind].text = text
      request.onText?.(text, isCurrent)
    }

    try {
      const result = await options.streams[kind].generate(request.prompt, {
        type: 'content_generation',
      }, (_chunk, fullContent) => update(fullContent))
      if (!isCurrent()) return false
      if (!result.trim()) throw new Error('AI返回内容为空')
      update(result)
      if (!isCurrent()) return false
      operation.completed = true
      options.notify.success(request.successMessage)
      return true
    } catch (error) {
      if (isCurrent() && !isAIRequestCancelled(error)) {
        options.notify.error(`${request.errorPrefix}: ${error instanceof Error ? error.message : String(error)}`)
      }
      return false
    } finally {
      if (operations[kind] === operation) states[kind].running = false
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    stopWatching()
    for (const kind of kinds) stop(kind)
  }

  return { states, start, stop, canUseResult, dispose }
}
