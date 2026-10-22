import type { GenerationRequestLimits } from '@/types/api'

export type BoundedGenerationErrorCode = 'invalid_limits' | 'cancelled' | 'timeout'
  | 'response_too_large' | 'request_limit' | 'redirect' | 'transport' | 'output_incomplete' | 'settings'

/** Deliberately carries no provider message, response body, URL, credentials or cause. */
export class BoundedGenerationError extends Error {
  constructor(readonly code: BoundedGenerationErrorCode) {
    super({
      invalid_limits: '请求限制无效', cancelled: '请求已取消', timeout: '请求已超时',
      response_too_large: '服务商响应超过大小限制', request_limit: '已达到单次请求限制',
      redirect: '受限请求不允许重定向', transport: '服务商请求未能完成',
      output_incomplete: '服务商未返回完整结果', settings: '当前模型或思考设置不符合受限输出预算',
    }[code])
    this.name = 'BoundedGenerationError'
  }
}

export function validateRequestLimits(limits: GenerationRequestLimits): Readonly<GenerationRequestLimits> {
  if (!limits || limits.maxAttempts !== 1 || limits.omitUsageContent !== true
    || !Number.isInteger(limits.maxResponseBytes) || limits.maxResponseBytes < 1 || limits.maxResponseBytes > 65_536
    || !Number.isInteger(limits.timeoutMs) || limits.timeoutMs < 1 || limits.timeoutMs > 30_000) {
    throw new BoundedGenerationError('invalid_limits')
  }
  return Object.freeze({ maxAttempts: 1, maxResponseBytes: limits.maxResponseBytes, timeoutMs: limits.timeoutMs, omitUsageContent: true })
}

/** One non-streaming generation owns its deadline, cancellation and HTTP dispatch ledger. */
export function createBoundedRequestScope(input: GenerationRequestLimits, externalSignal?: AbortSignal) {
  const limits = validateRequestLimits(input)
  const controller = new AbortController()
  const deadline = performance.now() + limits.timeoutMs
  let closed = false
  let attempts = 0
  let failure: BoundedGenerationError | undefined
  const fail = (code: BoundedGenerationErrorCode): BoundedGenerationError => {
    failure ??= new BoundedGenerationError(code)
    controller.abort(failure)
    return failure
  }
  const abort = () => { fail('cancelled') }
  if (externalSignal?.aborted) abort()
  else externalSignal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => fail('timeout'), limits.timeoutMs)

  const assertActive = () => {
    if (failure) throw failure
    if (performance.now() >= deadline) throw fail('timeout')
    if (closed || controller.signal.aborted) throw fail('cancelled')
  }

  /** Observe late rejections, but never wait for a provider/guard which ignores abort. */
  const run = async <T>(operation: () => PromiseLike<T>): Promise<T> => {
    assertActive()
    let onAbort!: () => void
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(failure ?? new BoundedGenerationError('cancelled'))
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      const value = await Promise.race([Promise.resolve().then(() => { assertActive(); return operation() }), aborted])
      assertActive()
      return value
    } finally { controller.signal.removeEventListener('abort', onAbort) }
  }

  const createFetch = (beforeRequest?: () => Promise<void>): typeof fetch => async (input, init) => {
    assertActive()
    // Consume the reservation before awaiting a guard, so even concurrent SDK calls
    // cannot pass the ledger. Only the guarded path below can dispatch HTTP.
    if (attempts >= limits.maxAttempts) throw fail('request_limit')
    attempts++
    if (beforeRequest) await run(beforeRequest)
    assertActive()
    const response = await run(() => globalThis.fetch(input, {
      ...init, signal: controller.signal, redirect: 'error',
    }).then(response => {
      try { assertActive(); return response } catch (error) {
        void response.body?.cancel().catch(() => {})
        throw error
      }
    }))
    if (response.redirected || (response.status >= 300 && response.status < 400) || response.type === 'opaqueredirect') {
      void response.body?.cancel().catch(() => {})
      throw fail('redirect')
    }
    const declared = response.headers.get('content-length')
    if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > limits.maxResponseBytes) {
      void response.body?.cancel().catch(() => {})
      throw fail('response_too_large')
    }
    const reader = response.body?.getReader()
    if (!reader) { assertActive(); return response }
    const cancelReader = () => { void reader.cancel().catch(() => {}) }
    controller.signal.addEventListener('abort', cancelReader, { once: true })
    // A fixed buffer also bounds overhead for adversarial tiny/empty chunks.
    const body = new Uint8Array(limits.maxResponseBytes)
    let total = 0
    try {
      for (;;) {
        const part = await run(() => reader.read())
        if (part.done) break
        if (part.value.byteLength > limits.maxResponseBytes - total) throw fail('response_too_large')
        body.set(part.value, total)
        total += part.value.byteLength
      }
      assertActive()
      // Fetch exposes decoded bytes, even for compressed HTTP responses. Fully
      // bound success AND error bodies before any SDK JSON/text parser sees them.
      const headers = new Headers(response.headers)
      headers.delete('content-encoding')
      headers.set('content-length', String(total))
      return new Response(body.subarray(0, total), { status: response.status, statusText: response.statusText, headers })
    } catch (error) {
      cancelReader()
      throw error
    } finally {
      controller.signal.removeEventListener('abort', cancelReader)
      // A cancellation-ignoring reader may still have a pending read.
      try { reader.releaseLock() } catch { /* already canceled or still pending */ }
    }
  }

  const close = () => {
    closed = true
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', abort)
  }
  return { controller, signal: controller.signal, assertActive, run, createFetch, close }
}

export type BoundedRequestScope = ReturnType<typeof createBoundedRequestScope>
