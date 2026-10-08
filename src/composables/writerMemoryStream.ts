import { computed, ref, type Ref } from 'vue'
import type { GenerateOptions, StreamCallback } from '@/types/api'
import { AIRequestCancelledError } from '@/utils/aiRequestScope'
import type { WriterMemoryLease } from './useWriterMemoryContext'

interface StreamPort {
  isStreaming: Ref<boolean>
  streamingContent: Ref<string>
  generate(prompt: string, options?: GenerateOptions, callback?: StreamCallback | null): Promise<string>
  stop(message?: string): void
  reset(): void
}
interface MemoryPort {
  acquire(): Promise<WriterMemoryLease> | null
  onInvalidate(callback: () => void): () => void
}

/** Covers preflight and final validation with the same cancelable stream owner. */
export function createWriterMemoryStream(base: StreamPort, memory: MemoryPort) {
  const preparing = ref(false)
  let operation = 0
  let active: AbortController | null = null
  let applicationLease: WriterMemoryLease | null = null
  let hadMemory = false
  let invalidated = false
  let applicationGranted = false
  const invalidate = () => {
    if (!hadMemory) return
    operation += 1
    invalidated = true
    active?.abort()
    active = null
    preparing.value = false
    applicationLease = null
    // A first application changes the source itself. If its persistence fails,
    // controllers retain that already-applied draft and retry saving it once.
    // Keep the output for that retry, but revoke the lease for any first apply.
    if (!applicationGranted) base.reset()
  }
  const unsubscribe = memory.onInvalidate(invalidate)

  async function generate(prompt: string, options?: GenerateOptions, callback?: StreamCallback | null) {
    active?.abort()
    const id = ++operation
    const controller = new AbortController()
    active = controller
    applicationLease = null
    invalidated = false
    applicationGranted = false
    const preparation = memory.acquire()
    const usedMemory = preparation !== null
    hadMemory = usedMemory
    const ensureCurrent = () => {
      if (id !== operation || controller.signal.aborted) throw new AIRequestCancelledError()
    }
    const abortFromCaller = () => {
      controller.abort(options?.signal?.reason)
      if (id === operation) preparing.value = false
    }
    if (options?.signal?.aborted) abortFromCaller()
    else options?.signal?.addEventListener('abort', abortFromCaller, { once: true })
    try {
      if (!preparation) return await base.generate(prompt, options, callback)
      preparing.value = !controller.signal.aborted
      const lease = await preparation
      ensureCurrent()
      applicationLease = lease
      const beforeRequest = async () => {
        ensureCurrent()
        await options?.beforeRequest?.()
        ensureCurrent()
        await lease.assertFresh()
        ensureCurrent()
      }
      const result = await base.generate(`${prompt}\n\n${lease.prompt}`, { ...options, signal: controller.signal, beforeRequest }, callback)
      ensureCurrent()
      await lease.assertFresh()
      ensureCurrent()
      return result
    } catch (error) {
      if (id === operation && usedMemory && !controller.signal.aborted) {
        invalidated = true
        applicationLease = null
        base.reset()
      }
      throw error
    } finally {
      options?.signal?.removeEventListener('abort', abortFromCaller)
      if (id === operation) { active = null; preparing.value = false }
    }
  }
  const reset = () => {
    operation += 1
    active?.abort()
    active = null
    preparing.value = false
    applicationLease = null
    hadMemory = false
    invalidated = false
    applicationGranted = false
    base.reset()
  }
  const stop = (message?: string) => {
    operation += 1
    active?.abort()
    active = null
    preparing.value = false
    base.stop(message)
  }
  async function assertApplicationFresh(): Promise<void> {
    if (!hadMemory) return
    if (invalidated || !applicationLease) throw new Error('生成所用依据已失效，请重新检索并生成后再应用。')
    const lease = applicationLease
    await lease.assertFresh()
    if (invalidated || applicationLease !== lease) throw new Error('生成所用依据已失效，请重新生成后再应用。')
    applicationGranted = true
  }
  return {
    generate, reset, stop, assertApplicationFresh,
    isStreaming: computed(() => preparing.value || base.isStreaming.value),
    streamingContent: base.streamingContent,
    dispose() { reset(); unsubscribe() },
  }
}
