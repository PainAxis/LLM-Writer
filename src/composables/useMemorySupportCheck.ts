import { reactive, watch, type WatchSource } from 'vue'
import { useApiConfig } from '@/services/apiConfig'
import { SupportCheckError, supportCheckFailureReason } from '@/services/memory/supportCheck'
import { withMemoryAbort } from '@/services/memory/semanticScanUi'
import { SUPPORT_CHECK_LIMITS } from '@/types/memorySupport'
import type { PreparedSupportCheck, SupportCheckPreview, AssessedSupportCheck, SupportUnverifiedReason } from '@/types/memorySupport'

export type SupportUiReason = SupportUnverifiedReason | 'disabled' | 'not_run' | 'unavailable' | 'stale'
export type MemorySupportUiResult = AssessedSupportCheck | { state: 'unverified'; reason: SupportUiReason }

export interface MemorySupportUiState {
  enabled: boolean
  question: string
  setQuestion(value: string): void
  phase: 'idle' | 'preparing' | 'ready' | 'running' | 'settled'
  preview: SupportCheckPreview | null
  result: MemorySupportUiResult
  setEnabled(value: boolean): void
  prepare(): Promise<boolean>
  run(): Promise<boolean>
  cancel(): void
}

interface MemorySupportUiOptions {
  canPrepare(): boolean
  prepare(signal: AbortSignal, assertOwner: () => void): Promise<PreparedSupportCheck>
  onStart?(): void
  onInvalidSource?(reason: SupportUiReason): void
  /** Injection for synthetic tests; production uses the current shared chat configuration. */
  configuration?: WatchSource<unknown>
}

/** One private, one-use plan per route owner. No prompt or model result is persisted. */
export function useMemorySupportCheck(options: MemorySupportUiOptions) {
  let epoch = 0
  let disposed = false
  let abort: AbortController | null = null
  let plan: PreparedSupportCheck | null = null
  let expiration: ReturnType<typeof setTimeout> | undefined
  const state: MemorySupportUiState = reactive<MemorySupportUiState>({
    enabled: false, question: '',
    setQuestion(value) { if (!disposed && state.question !== value) { state.question = value; invalidate() } },
    phase: 'idle', preview: null, result: { state: 'unverified', reason: 'disabled' },
    setEnabled(value) {
      if (disposed || state.enabled === value) return
      state.enabled = value
      invalidate(value ? 'not_run' : 'disabled')
    },
    prepare, run, cancel: () => invalidate('cancelled'),
  })
  function invalidate(reason: SupportUiReason = 'stale') {
    epoch++
    clearTimeout(expiration)
    expiration = undefined
    abort?.abort()
    abort = null
    plan?.cancel()
    plan = null
    state.preview = null
    state.phase = 'idle'
    state.result = { state: 'unverified', reason: state.enabled ? reason : 'disabled' }
  }
  function owner(current: number, signal: AbortSignal) {
    if (disposed || current !== epoch || signal.aborted || !state.enabled || !options.canPrepare()) {
      throw new DOMException('支持检查已取消或失效。', 'AbortError')
    }
  }
  async function prepare() {
    if (disposed || !state.enabled || !state.question.trim() || !options.canPrepare() || state.phase === 'preparing' || state.phase === 'running') return false
    invalidate('not_run')
    options.onStart?.()
    const current = epoch
    const controller = new AbortController()
    abort = controller
    state.phase = 'preparing'
    let timedOut = false
    const deadline = performance.now() + SUPPORT_CHECK_LIMITS.guardMs
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, SUPPORT_CHECK_LIMITS.guardMs)
    const assertOwner = () => {
      owner(current, controller.signal)
      if (state.phase === 'preparing' && performance.now() >= deadline) {
        timedOut = true
        throw new SupportCheckError('timeout')
      }
    }
    try {
      assertOwner()
      const pending = options.prepare(controller.signal, assertOwner)
      // An adapter that ignores cancellation must not leave a usable late plan.
      void pending.then(candidate => { if (disposed || current !== epoch || controller.signal.aborted) candidate.cancel() }, () => undefined)
      const candidate = await withMemoryAbort(pending, controller.signal)
      assertOwner()
      plan = candidate
      state.preview = structuredClone(candidate.preview)
      state.phase = 'ready'
      expiration = setTimeout(() => { if (current === epoch && state.phase === 'ready') invalidate('expired') }, Math.max(0, candidate.preview.expiresAt - Date.now()))
      return true
    } catch (error) {
      if (current === epoch && !disposed) {
        state.phase = 'settled'
        const reason = timedOut ? 'timeout' : supportCheckFailureReason(error)
        state.result = { state: 'unverified', reason }
        if (reason === 'source_changed' || reason === 'timeout') options.onInvalidSource?.(reason)
      }
      return false
    } finally { clearTimeout(timer) }
  }
  async function run() {
    const candidate = plan
    const controller = abort
    if (disposed || !state.enabled || !options.canPrepare() || state.phase !== 'ready' || !candidate || !controller) return false
    // Claim synchronously before awaiting so a double click cannot dispatch twice.
    clearTimeout(expiration)
    expiration = undefined
    state.phase = 'running'
    state.result = { state: 'unverified', reason: 'not_run' }
    options.onStart?.()
    const current = epoch
    try {
      owner(current, controller.signal)
      const result = await withMemoryAbort(candidate.run(), controller.signal)
      owner(current, controller.signal)
      state.result = result
      if (result.state === 'unverified') state.preview = null
      candidate.cancel()
      state.phase = 'settled'
      plan = null
      if (result.state === 'unverified' && (result.reason === 'source_changed' || result.sourceValidationFailed)) options.onInvalidSource?.(result.reason)
      return result.state === 'assessed'
    } catch (error) {
      if (current === epoch && !disposed) {
        const reason = supportCheckFailureReason(error)
        state.result = { state: 'unverified', reason }
        state.preview = null
        state.phase = 'settled'
        candidate.cancel()
        plan = null
        if (reason === 'source_changed') options.onInvalidSource?.(reason)
      }
      return false
    }
  }
  // The configuration never enters UI state or a serialized identity. This also
  // observes nested proxy/header/key changes while a plan or result is displayed.
  const stop = watch(options.configuration ?? useApiConfig().activeConfig,
    () => invalidate('stale'), { deep: true, flush: 'sync' })
  const onStorage = () => invalidate('stale')
  const onFocus = () => invalidate('stale')
  const onVisibility = () => { if (document.visibilityState === 'visible') invalidate('stale') }
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
  }
  return {
    state, invalidate,
    get busy() { return state.phase === 'preparing' || state.phase === 'running' },
    dispose() {
      disposed = true
      invalidate('cancelled')
      stop()
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', onStorage)
        window.removeEventListener('focus', onFocus)
        document.removeEventListener('visibilitychange', onVisibility)
      }
    },
  }
}
