import { ref, watch } from 'vue'
import type { GenerateOptions, StreamCallback } from '@/types/api'
import { isAIRequestCancelled } from '@/utils/aiRequestScope'

export interface GenerationTransport {
  generate(prompt: string, options?: GenerateOptions, callback?: StreamCallback | null): Promise<string>
  stop(message?: string): void
}

export interface GenerationTaskRequest {
  prompt: string
  options?: GenerateOptions
  onText?: (text: string, isCurrent: () => boolean) => void
  onSuccess?: (text: string, isCurrent: () => boolean) => void
  onError?: (error: Error, isCurrent: () => boolean) => void | Promise<void>
}

/** Owns an operation and its source, including queued UI work and error recovery. */
export function useGenerationTask(options: {
  source: () => unknown
  stream: GenerationTransport
}) {
  const running = ref(false)
  let active: { completed: boolean } | null = null
  let disposed = false

  function stop() {
    active = null
    options.stream.stop('')
    running.value = false
  }

  const unwatch = watch(options.source, stop, { flush: 'sync', deep: true })

  async function start(request: GenerationTaskRequest): Promise<boolean> {
    if (disposed) return false
    stop()
    const operation = { completed: false }
    active = operation
    running.value = true
    const isCurrent = () => !disposed && active === operation
    try {
      const text = await options.stream.generate(request.prompt, request.options, (_chunk, full) => {
        if (isCurrent() && !operation.completed) request.onText?.(full, isCurrent)
      })
      if (!isCurrent()) return false
      if (!text.trim()) throw new Error('AI返回内容为空')
      request.onText?.(text, isCurrent)
      if (!isCurrent()) return false
      operation.completed = true
      request.onSuccess?.(text, isCurrent)
      return isCurrent()
    } catch (error) {
      if (isCurrent() && !isAIRequestCancelled(error)) {
        operation.completed = true
        await request.onError?.(error instanceof Error ? error : new Error(String(error)), isCurrent)
      }
      return false
    } finally {
      if (isCurrent()) running.value = false
    }
  }

  function dispose() {
    disposed = true
    unwatch()
    stop()
  }

  return { running, start, stop, dispose }
}
