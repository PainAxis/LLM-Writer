import type { GenerateOptions, StreamCallback } from '@/types/api'

/** 取消必须与成功返回区分，防止调用方把未完成的内容自动应用到正文。 */
export class AIRequestCancelledError extends Error {
  readonly partialContent: string

  constructor(partialContent = '') {
    super('AI生成已取消')
    this.name = 'AbortError'
    this.partialContent = partialContent
  }
}

export function isAIRequestCancelled(error: unknown): error is AIRequestCancelledError {
  return error instanceof AIRequestCancelledError
}

export interface AIRequestState {
  isStreaming: boolean
  streamingContent: string
  streamingType: string
}

type GenerateStream = (
  prompt: string,
  options: GenerateOptions,
  onChunk: StreamCallback | null,
) => Promise<string>

/** 每个视图/操作独立拥有请求；旧请求的增量和 finally 不能修改新请求。 */
export function createAIRequestScope(
  generateStream: GenerateStream,
  onStateChange: (state: AIRequestState) => void,
) {
  let active: { controller: AbortController; content: string } | null = null
  let state: AIRequestState = { isStreaming: false, streamingContent: '', streamingType: '' }

  function update(patch: Partial<AIRequestState>): void {
    state = { ...state, ...patch }
    onStateChange(state)
  }

  function stop(): void {
    active?.controller.abort()
    active = null
    update({ isStreaming: false })
  }

  async function generate(
    prompt: string,
    options: GenerateOptions = {},
    onChunk: StreamCallback | null = null,
  ): Promise<string> {
    active?.controller.abort()
    const request = { controller: new AbortController(), content: '' }
    active = request
    update({ isStreaming: true, streamingContent: '', streamingType: options.type ?? '' })

    const abortFromCaller = () => {
      request.controller.abort(options.signal?.reason)
      if (active === request) update({ isStreaming: false })
    }
    if (options.signal?.aborted) abortFromCaller()
    else options.signal?.addEventListener('abort', abortFromCaller, { once: true })

    try {
      if (request.controller.signal.aborted) throw new AIRequestCancelledError()
      const result = await generateStream(
        prompt,
        { ...options, signal: request.controller.signal },
        (chunk, fullContent) => {
          if (active !== request || request.controller.signal.aborted) return
          request.content = fullContent
          update({ streamingContent: fullContent })
          onChunk?.(chunk, fullContent)
        },
      )
      if (request.controller.signal.aborted || active !== request) {
        throw new AIRequestCancelledError(request.content)
      }
      update({ streamingContent: result })
      return result
    } catch (error) {
      const reason = request.controller.signal.reason
      if (request.controller.signal.aborted && reason instanceof Error && reason.name === 'TimeoutError') {
        throw reason
      }
      if (request.controller.signal.aborted || isAIRequestCancelled(error)) {
        throw new AIRequestCancelledError(request.content || (isAIRequestCancelled(error) ? error.partialContent : ''))
      }
      throw error
    } finally {
      options.signal?.removeEventListener('abort', abortFromCaller)
      if (active === request) {
        active = null
        update({ isStreaming: false })
      }
    }
  }

  function reset(): void {
    stop()
    update({ streamingContent: '', streamingType: '' })
  }

  return { generate, stop, reset, dispose: stop }
}
