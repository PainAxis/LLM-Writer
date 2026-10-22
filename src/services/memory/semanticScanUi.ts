import { reactive } from 'vue'
import type { MemoryFullScanDecision, MemoryFullScanPause, MemoryFullScanProgress, MemoryProjectInput, MemorySearchControls } from '@/types/memory'

export const FULL_SCAN_MAX_CALLS = 4096
export const FULL_SCAN_MAX_ACTIVE_MS = 3_600_000
export const FULL_SCAN_TIME_CHOICES = [
  { value: 65_000, label: '65 秒（默认）' },
  { value: 300_000, label: '5 分钟' },
  { value: 600_000, label: '10 分钟' },
] as const

export interface SemanticScanUiState {
  progress: MemoryFullScanProgress | null
  pauseReason: MemoryFullScanPause['reason'] | null
  addCalls: number
  addActiveMs: number
  error: string
  setAddCalls(value: number): void
  setAddActiveMs(value: number): void
  start(): boolean
  retry(): boolean
  extend(): boolean
  useLocal(): boolean
}

/** Private route-only decision gate. Never put it in watched provider settings. */
export function createSemanticScanUi() {
  let epoch = 0
  let grant = 0
  let pending: { pause: MemoryFullScanPause; resolve: (decision: MemoryFullScanDecision) => void } | null = null
  let removeAbort: (() => void) | undefined
  const state: SemanticScanUiState = reactive<SemanticScanUiState>({
    progress: null, pauseReason: null, addCalls: 0, addActiveMs: 0, error: '',
    setAddCalls: value => { state.addCalls = value },
    setAddActiveMs: value => { state.addActiveMs = value },
    start: () => state.pauseReason === 'ready' && resume(0, 0),
    retry: () => state.pauseReason !== 'ready' && resume(0, 0),
    extend: () => state.pauseReason !== 'ready' && resume(state.addCalls, state.addActiveMs),
    useLocal: () => {
      if (pending && scanTimeExhausted(pending.pause.progress)) {
        state.error = '处理时间预算已用完，无法在本次授权内继续校验本地来源。请取消扫描，关闭嵌入与重排后重新本地检索。'
        return false
      }
      return settle('use-local')
    },
  })
  function settle(type: 'use-local' | 'cancel') {
    if (!pending) return false
    const current = pending
    pending = null
    state.pauseReason = null
    state.error = ''
    const { sessionId, generation } = current.pause.progress
    current.resolve({ type, sessionId, generation })
    return true
  }
  function resume(addCalls: number, addActiveMs: number) {
    if (!pending) return false
    const current = pending
    const progress = current.pause.progress
    if (!Number.isInteger(addCalls) || addCalls < 0 || !Number.isInteger(addActiveMs) || addActiveMs < 0
      || progress.callsApproved + addCalls > FULL_SCAN_MAX_CALLS
      || progress.activeMsApproved + addActiveMs > FULL_SCAN_MAX_ACTIVE_MS) {
      state.error = '追加预算须为非负整数；本次累计最多 4,096 次尝试、60 分钟处理时间。'
      return false
    }
    if (progress.callsApproved + addCalls <= progress.callsAttempted || progress.activeMsApproved + addActiveMs <= progress.activeMsUsed) {
      state.error = '剩余预算不足，请明确追加已耗尽的调用次数或处理时间。若只需本地结果，请按下方提示停止远程处理。'
      return false
    }
    pending = null
    state.pauseReason = null
    state.error = ''
    current.resolve({ type: 'continue', sessionId: progress.sessionId, generation: progress.generation,
      grantId: `ui-${epoch}-${++grant}`, addCalls, addActiveMs })
    return true
  }
  function reset(clearProgress = true) {
    epoch += 1
    settle('cancel')
    removeAbort?.()
    removeAbort = undefined
    state.pauseReason = null
    state.error = ''
    state.addCalls = 0
    state.addActiveMs = 0
    if (clearProgress) state.progress = null
  }
  function controls(signal: AbortSignal): MemorySearchControls {
    reset()
    const currentEpoch = epoch
    const active = () => currentEpoch === epoch && !signal.aborted
    const abort = () => { if (currentEpoch === epoch) reset() }
    signal.addEventListener('abort', abort, { once: true })
    removeAbort = () => signal.removeEventListener('abort', abort)
    if (signal.aborted) abort()
    return {
      signal,
      onProgress(progress) { if (active()) state.progress = { ...progress } },
      onPause(pause) {
        if (!active()) return { type: 'cancel', sessionId: pause.progress.sessionId, generation: pause.progress.generation }
        // The client serializes pauses. Fail closed if an adapter violates that contract.
        settle('cancel')
        const snapshot = { reason: pause.reason, progress: { ...pause.progress } }
        state.progress = { ...snapshot.progress }
        state.pauseReason = snapshot.reason
        state.addCalls = 0
        state.addActiveMs = 0
        state.error = ''
        return new Promise<MemoryFullScanDecision>(resolve => { pending = { pause: snapshot, resolve } })
      },
    }
  }
  return { state, controls, reset, finish: () => reset(false) }
}

/** Settle the owning UI operation even if a stale dependency ignores its signal. */
export function withMemoryAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('检索已取消或失效，请重新检索。', 'AbortError'))
    if (signal.aborted) { void operation.catch(() => undefined); abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export function scanPauseText(reason: MemoryFullScanPause['reason'] | null): string {
  if (reason === 'ready') return '计划已就绪，尚未发送查询或正文。请核对范围与预算后开始。'
  if (reason === 'budget') return '授权预算不足，已暂停远程处理。追加预算不会重新保存、同步或检索已接受的片段。'
  if (reason === 'provider') return '服务请求失败或超时，已暂停。失败与重试均计入尝试次数；可在剩余预算内明确重试。'
  return '正在处理已披露范围；未完成全范围扫描前不提供可选语义结果。'
}

export function scanTimeExhausted(progress: MemoryFullScanProgress): boolean {
  return progress.activeMsUsed >= progress.activeMsApproved
}

export function scanSummary(progress: MemoryFullScanProgress) {
  return `已评分 ${progress.scoredPassages} / ${progress.eligiblePassages} 个原文块；调用尝试 ${progress.callsAttempted} / ${progress.callsApproved} 次；处理时间 ${(progress.activeMsUsed / 1000).toFixed(1)} / ${(progress.activeMsApproved / 1000).toFixed(0)} 秒。`
}

/** Stable committed-source identity, private to this route. Never persist or log it. */
export function memorySourceSignature(project: MemoryProjectInput): string {
  return JSON.stringify([project.id, project.title,
    project.chapters.map(chapter => [chapter.id, chapter.title, chapter.text]),
    project.clues.map(clue => [clue.id, clue.chapterId, clue.sourceRevision, clue.start, clue.end,
      clue.quote, clue.label, clue.aliases]),
  ])
}

/** Reread persisted storage at every outbound/final-local/publication boundary. */
export function createCommittedMemorySourceGuard(
  snapshot: MemoryProjectInput,
  read: () => Promise<MemoryProjectInput>,
  assertOwner: () => void,
  signal: AbortSignal,
): () => Promise<void> {
  const signature = memorySourceSignature(snapshot)
  return async () => {
    assertOwner()
    const current = await withMemoryAbort(read(), signal)
    assertOwner()
    if (memorySourceSignature(current) !== signature) throw new Error('已保存原文已改变，请重新读取并检索。')
  }
}
