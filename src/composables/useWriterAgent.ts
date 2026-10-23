import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import { createWriterAgent } from '@/services/writerAgent'
import { formatGeneratedBody } from '@/utils/writerContent'
import type { WriterChapter, WriterNovel } from '@/types/writer'
import type { WriterAgentController, WriterAgentOptions, WriterAgentPhase, WriterAgentSnapshot } from '@/types/writerAgent'
import type { WriterApplyLease, WriterSaveHandle, WriterSaveOutcome } from './writerPersistenceGate'

export const WRITER_AGENT_SAVE_ACK_MS = 30_000

export type WriterAgentUiPhase = WriterAgentPhase | 'applying' | 'commit_pending' | 'commit_unknown' | 'applied_unsaved' | 'applied'
interface WriterAgentUiOptions {
  currentNovel: Readonly<Ref<WriterNovel | null>>
  currentChapter: Readonly<Ref<WriterChapter | null>>
  chapters: Readonly<Ref<WriterChapter[]>>
  content: Ref<string>
  hasUnsavedChanges: Ref<boolean>
  isSaving: Readonly<Ref<boolean>>
  saveError: Readonly<Ref<string | null>>
  /** Compared only in memory. Never serialize config, credentials or headers. */
  config: Readonly<Ref<unknown>>
  prepare(): boolean
  acquireApplyLease(): WriterApplyLease | null
  beginSaveCurrentChapter(options: { applyLease: WriterApplyLease; retry?: boolean }): WriterSaveHandle
  writeText(text: string): Promise<void>
  notify(message: string): unknown
  createRuntime?: (options: WriterAgentOptions) => WriterAgentController
  runtimePorts?: WriterAgentOptions['ports']
  eventTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null
}

/** Explicit source-free projection: never spread a presentation object into an export. */
export interface WriterAgentApplicationAudit {
  applied: boolean
  operationId: number | null
  saveState: WriterSaveHandle['state'] | null
  initialCommit: WriterSaveHandle['initialCommit'] | null
  lastSnapshotCommit: WriterSaveHandle['lastSnapshotCommit'] | null
  catchUpFailed: boolean
  hasUnsavedChanges: boolean
}
export function writerAgentAuditText(snapshot: WriterAgentSnapshot, phase: WriterAgentUiPhase, application?: WriterAgentApplicationAudit): string {
  return JSON.stringify({ version: 1, runId: snapshot.runId, phase,
    budget: { modelReservations: snapshot.budget.modelReservations, outputTokensReserved: snapshot.budget.outputTokensReserved,
      toolReservations: snapshot.budget.toolReservations, activeMs: snapshot.budget.activeMs, expiresAt: snapshot.budget.expiresAt },
    usage: snapshot.usage.map(item => ({ requestId: item.requestId, phase: item.phase, status: item.status,
      inputTokens: item.inputTokens, outputTokens: item.outputTokens, totalTokens: item.totalTokens, usageSource: item.usageSource })),
    events: snapshot.audit.map(event => ({ sequence: event.sequence, kind: event.kind, elapsedMs: event.elapsedMs,
      phase: event.phase, requestId: event.requestId, callId: event.callId, digest: event.digest,
      queryLength: event.queryLength, candidateCount: event.candidateCount, code: event.code })),
    receipt: snapshot.receipt ? { callId: snapshot.receipt.callId, status: snapshot.receipt.status,
      planDigest: snapshot.receipt.planDigest, queryDigest: snapshot.receipt.queryDigest,
      queryLength: snapshot.receipt.queryLength, candidateCount: snapshot.receipt.candidateCount } : null,
    errorCode: snapshot.error?.code ?? null,
    application: application ? { applied: application.applied, operationId: application.operationId,
      saveState: application.saveState, initialCommit: application.initialCommit, lastSnapshotCommit: application.lastSnapshotCommit,
      catchUpFailed: application.catchUpFailed, hasUnsavedChanges: application.hasUnsavedChanges } : null,
  }, null, 2)
}

/** Writer owns the lifecycle; mounting a panel never starts, saves or authorizes work. */
export function useWriterAgent(options: WriterAgentUiOptions) {
  const visible = ref(false)
  const brief = ref('')
  const cutoffId = ref('')
  const granted = ref(false)
  const selectedHitIds = ref<string[]>([])
  const applying = ref(false)
  const appliedDraft = ref('')
  const appliedTargetTitle = ref('')
  const saveHandle = shallowRef<WriterSaveHandle | null>(null)
  const saveOutcome = shallowRef<WriterSaveOutcome | null>(null)
  const savedClean = ref(false)
  const saveStartUnknown = ref(false)
  const localError = ref('')
  let generation = 0
  let lifecycle = 0
  let disposed = false
  let invalidating = false
  let applied = false
  let closeAfterSave = false
  let applyLease: WriterApplyLease | null = null
  let applyAttempt: Promise<boolean> | null = null
  let saveAttempt: Promise<boolean> | null = null
  let saveSettlement: Promise<WriterSaveOutcome> | null = null
  let stopSaveAcknowledgement: (() => void) | null = null
  let runtime: WriterAgentController
  const snapshot = shallowRef<WriterAgentSnapshot>()
  const ready = computed(() => Boolean(options.currentNovel.value && options.currentChapter.value)
    && !options.hasUnsavedChanges.value && !options.isSaving.value && !options.saveError.value)
  const choices = computed(() => options.chapters.value.map((chapter, index) => ({
    id: String(chapter.id), title: chapter.title, ordinal: index + 1,
  })))
  const targetTitle = computed(() => appliedDraft.value ? appliedTargetTitle.value : options.currentChapter.value?.title ?? '')
  const phase = computed<WriterAgentUiPhase>(() => {
    if (appliedDraft.value) {
      if (savedClean.value) return 'applied'
      if (saveHandle.value?.state === 'failed') return 'applied_unsaved'
      if (saveStartUnknown.value || saveHandle.value?.state === 'unknown') return 'commit_unknown'
      return 'commit_pending'
    }
    return applying.value ? 'applying' : snapshot.value!.phase
  })
  const isBarrierPending = computed(() => applying.value || (Boolean(appliedDraft.value) && !savedClean.value))
  const busy = computed(() => ['previewing', 'planning', 'executing_retrieval_tool', 'selecting_evidence', 'drafting', 'applying',
    'commit_pending', 'commit_unknown', 'applied_unsaved'].includes(phase.value))
  const canPreview = computed(() => visible.value && ready.value && !busy.value && !applied
    && cutoffId.value === String(options.currentChapter.value?.id) && brief.value.trim().length > 0 && brief.value.length <= 1_000)
  const blocker = computed(() => {
    if (!ready.value && !applied) return '请先保存当前章节并解决保存错误；此面板不会自动保存以开始运行。'
    if (cutoffId.value !== String(options.currentChapter.value?.id)) return '本次续写需要当前章的已保存结尾。请明确选择当前章作为披露截止；不会自动扩大范围。'
    if (!brief.value.trim()) return '请填写本次创作方向。'
    return ''
  })
  const draftText = computed(() => appliedDraft.value || (['awaiting_author', 'applying'].includes(phase.value) ? snapshot.value!.proposal?.text ?? '' : ''))
  const currentLeaseTarget = (lease: WriterApplyLease) => lease.valid
    && options.currentNovel.value?.id === lease.projectId && options.currentChapter.value?.id === lease.chapterId

  const replaceRuntime = () => {
    generation += 1
    const ownGeneration = generation
    runtime?.dispose()
    runtime = (options.createRuntime ?? createWriterAgent)({
      ports: options.runtimePorts,
      getOwner: () => ownGeneration === generation && visible.value && !disposed ? {
        ownershipKey: lifecycle, projectId: `novel:${options.currentNovel.value?.id}`,
        targetChapterId: String(options.currentChapter.value?.id ?? ''), throughChapterId: cutoffId.value,
        editorHtml: options.content.value, brief: brief.value, ready: ready.value,
      } : null,
      onChange: value => { if (ownGeneration === generation && !disposed) snapshot.value = value },
    })
    snapshot.value = runtime.snapshot()
  }
  replaceRuntime()

  const invalidate = (reason: 'cancelled' | 'stale' = 'stale') => {
    if (applied) return false // The commit/recovery capability is no longer owned by the runtime.
    if (invalidating) return true
    invalidating = true
    try {
      lifecycle += 1
      runtime.cancel(reason)
      granted.value = false
      selectedHitIds.value = []
      applyLease?.releaseBeforeMutation()
      applyLease = null
      return true
    } finally { invalidating = false }
  }
  const close = () => {
    if (applied && !savedClean.value) {
      closeAfterSave = true
      options.notify('追加正文已保留，须等待保存结果或在此重试保存；现在可以复制草稿。')
      return false
    }
    invalidate('cancelled')
    visible.value = false
    return true
  }
  // Also protects programmatic v-model, X, Escape, overlay, and close/reopen in one turn.
  const stopVisibility = watch(visible, (value, previous) => {
    if (value === previous) return
    if (!value && applied && !savedClean.value) {
      closeAfterSave = true
      visible.value = true
      return
    }
    if (!value) invalidate('cancelled')
  }, { flush: 'sync' })
  const stopInputs = watch([brief, cutoffId], () => { if (visible.value) invalidate() }, { flush: 'sync' })
  const stopGrant = watch(granted, (value, previous) => {
    if (!value && previous && snapshot.value!.phase !== 'previewed' && !applied) invalidate('cancelled')
  }, { flush: 'sync' })
  const stopSelection = watch(selectedHitIds, () => {
    if (['selecting_evidence', 'drafting', 'awaiting_author'].includes(snapshot.value!.phase) && !applied) invalidate()
  }, { flush: 'sync', deep: true })
  // Invalidate only. Never capture a new owner from the transient chapter/content pair.
  const stopSource = watch([options.currentNovel, options.currentChapter, options.chapters, options.content,
    options.hasUnsavedChanges, options.isSaving, options.saveError, options.config], () => {
    if (visible.value && !applied) invalidate()
  }, { flush: 'sync', deep: true })
  const eventTarget = options.eventTarget === undefined ? (typeof window === 'undefined' ? null : window) : options.eventTarget
  const sourceWarning = () => { if (visible.value && !applied) invalidate() }
  eventTarget?.addEventListener('storage', sourceWarning)
  eventTarget?.addEventListener('focus', sourceWarning)

  const open = () => {
    if (disposed || isBarrierPending.value || !options.currentChapter.value || !options.prepare()) return false
    lifecycle += 1
    applied = false
    appliedDraft.value = ''
    appliedTargetTitle.value = ''
    savedClean.value = false
    saveStartUnknown.value = false
    saveHandle.value = null
    saveOutcome.value = null
    saveAttempt = null
    saveSettlement = null
    closeAfterSave = false
    localError.value = ''
    brief.value = ''
    cutoffId.value = '' // An earlier choice is never silently advanced to a new target.
    granted.value = false
    selectedHitIds.value = []
    visible.value = true
    replaceRuntime()
    return true
  }
  const preview = async () => {
    if (!canPreview.value) return false
    localError.value = ''
    granted.value = false
    selectedHitIds.value = []
    lifecycle += 1
    replaceRuntime()
    const controller = runtime
    await controller.preview()
    return controller === runtime && snapshot.value!.phase === 'previewed'
  }
  const start = async () => {
    if (!visible.value || !granted.value || phase.value !== 'previewed' || !snapshot.value!.preview || !ready.value) return false
    const controller = runtime
    await controller.start({ previewId: snapshot.value!.preview.previewId, authorizeTool: true })
    return controller === runtime && snapshot.value!.phase === 'awaiting_evidence'
  }
  const select = (ids: readonly string[]) => {
    if (phase.value !== 'awaiting_evidence') {
      if (!applied) invalidate()
      return false
    }
    const available = new Set(snapshot.value!.evidence.map(hit => hit.id))
    selectedHitIds.value = [...new Set(ids)].filter(id => available.has(id))
    return true
  }
  const approve = async () => {
    if (!visible.value || phase.value !== 'awaiting_evidence' || !selectedHitIds.value.length) return false
    const controller = runtime
    await controller.approveEvidence([...selectedHitIds.value])
    return controller === runtime && snapshot.value!.phase === 'awaiting_author'
  }
  const clearSaveAcknowledgement = () => {
    stopSaveAcknowledgement?.()
    stopSaveAcknowledgement = null
  }
  const observeSaveAcknowledgement = (handle: WriterSaveHandle, settlement: Promise<WriterSaveOutcome>, lease: WriterApplyLease) => {
    clearSaveAcknowledgement()
    const deadline = performance.now() + WRITER_AGENT_SAVE_ACK_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
    const ownsAttempt = () => !disposed && applied && applyLease === lease && currentLeaseTarget(lease)
      && saveHandle.value === handle && saveSettlement === settlement
    const sync = () => {
      // A real receipt or settled state cancels the indicator. A catch-up snapshot
      // can become unknown again but retains this attempt's original deadline.
      if (!ownsAttempt() || handle.state !== 'saving' || handle.lastSnapshotCommit === 'committed') { clearTimer(); return }
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        if (ownsAttempt() && handle.state === 'saving' && handle.lastSnapshotCommit !== 'committed') handle.markUnknown()
      }, Math.max(0, deadline - performance.now()))
    }
    const stop = watch(() => [handle.state, handle.lastSnapshotCommit], sync, { flush: 'sync' })
    stopSaveAcknowledgement = () => { clearTimer(); stop() }
    sync()
  }
  const finishSave = (handle: WriterSaveHandle, settlement: Promise<WriterSaveOutcome>, outcome: WriterSaveOutcome): boolean | Promise<boolean> => {
    if (saveHandle.value !== handle || saveSettlement !== settlement || !applyLease || !currentLeaseTarget(applyLease)) return false
    if (handle.settled !== settlement) return beginSave(applyLease, false, settlement)
    clearSaveAcknowledgement()
    saveOutcome.value = outcome
    // A real author edit can land after the save loop selects clean but before
    // this continuation. Follow the retained owner's newer drain, not a fresh
    // append, a false clean release, or a permanently stranded clean handle.
    if (saveSettlement !== settlement) return false
    if (handle.settled !== settlement || (outcome.status === 'clean'
      && (options.hasUnsavedChanges.value || options.isSaving.value))) return beginSave(applyLease, false, settlement)
    if (outcome.status !== 'clean' || outcome.hasUnsavedChanges) return false
    // The editor's raw model can change before its separate change event marks
    // dirty. Let the project's exact-snapshot gate detect and drain that case.
    if (!applyLease.releaseIfClean()) return currentLeaseTarget(applyLease) ? beginSave(applyLease, false, settlement) : false
    savedClean.value = true
    applyLease = null
    if (closeAfterSave) visible.value = false
    return true
  }
  const beginSave = (lease: WriterApplyLease, retry = false, previousSettlement?: Promise<WriterSaveOutcome>): Promise<boolean> => {
    try {
      const handle = options.beginSaveCurrentChapter({ applyLease: lease, retry })
      saveHandle.value = handle
      const settlement = handle.settled // A retry can reuse the handle, never its previous attempt promise.
      if (settlement === previousSettlement) return Promise.resolve(false) // Never loop a settled snapshot into itself.
      saveSettlement = settlement
      observeSaveAcknowledgement(handle, settlement, lease)
      const pending = settlement.then(outcome => finishSave(handle, settlement, outcome), () => {
        // An unexpected rejection is not evidence of rollback or permission to retry.
        if (saveHandle.value === handle && saveSettlement === settlement) { clearSaveAcknowledgement(); handle.markUnknown() }
        return false
      })
      saveAttempt = pending
      return pending
    } catch {
      saveStartUnknown.value = true
      localError.value = '保存结果尚不明确。正文已保留，请勿重复追加；可以复制草稿。'
      saveHandle.value?.markUnknown()
      return Promise.resolve(false)
    }
  }
  const append = (): Promise<boolean> => {
    if (applyAttempt) return applyAttempt
    if (!visible.value || phase.value !== 'awaiting_author' || applied || !ready.value) return Promise.resolve(false)
    const lease = options.acquireApplyLease()
    if (!lease) { localError.value = '当前有保存或修改操作，请稍候再追加。'; return Promise.resolve(false) }
    applyLease = lease
    const controller = runtime
    const ticket = lifecycle
    const originalHtml = options.content.value
    const originalTitle = options.currentChapter.value?.title ?? ''
    let consumedDraft = ''
    applying.value = true // Barrier is installed before the first asynchronous guard.
    localError.value = ''
    const stillCurrent = () => !disposed && visible.value && ticket === lifecycle && runtime === controller
      && !applied && currentLeaseTarget(lease) && options.content.value === originalHtml && ready.value
    const operation = (async () => {
      try {
        const capability = await controller.assertBeforeApply()
        if (!stillCurrent()) return false
        const originalDraft = capability.consume()
        consumedDraft = originalDraft
        // consume may notify presentation observers. Recheck, then no await separates the latch and write.
        if (!stillCurrent() || !lease.markApplied()) return false
        applied = true
        options.content.value = `${originalHtml}\n${formatGeneratedBody(originalDraft)}`
        appliedTargetTitle.value = originalTitle
        appliedDraft.value = originalDraft
        snapshot.value = controller.snapshot()
        options.hasUnsavedChanges.value = true
        return await beginSave(lease)
      } catch {
        // A synchronous editor observer can throw after its ref has changed.
        // Never let that turn a consumed application into fresh Append authority.
        if (applied && !appliedDraft.value) {
          appliedTargetTitle.value = originalTitle
          appliedDraft.value = consumedDraft
          saveStartUnknown.value = true
          localError.value = '追加后的保存状态尚未明确，正文与草稿已保留；请勿重复追加。'
        }
        if (!applied && ticket === lifecycle) {
          localError.value = '追加前校验未通过；正文未修改，请重新预览。'
          controller.cancel('stale')
        }
        return false
      } finally {
        if (!applied) {
          lease.releaseBeforeMutation()
          if (applyLease === lease) applyLease = null
        }
        applying.value = false
      }
    })()
    applyAttempt = operation
    void operation.finally(() => { if (applyAttempt === operation) applyAttempt = null })
    return operation
  }
  const retrySave = (): Promise<boolean> => {
    if (!applied || !applyLease || !currentLeaseTarget(applyLease) || saveHandle.value?.state !== 'failed') return Promise.resolve(false)
    return beginSave(applyLease, true)
  }
  const waitForCommit = async () => {
    if (!applied) {
      await applyAttempt
      return !applied || savedClean.value
    }
    if (savedClean.value) return true
    if (saveHandle.value?.state === 'failed') return false
    return saveAttempt ? await saveAttempt : false
  }
  const copy = async () => {
    const text = draftText.value
    if (!text) return false
    try { await options.writeText(text); return true } catch { localError.value = '复制失败，请手动复制草稿。'; return false }
  }
  const copyAudit = async () => {
    try {
      const handle = saveHandle.value
      await options.writeText(writerAgentAuditText(runtime.snapshot(), phase.value, {
        applied, operationId: handle?.operationId ?? null, saveState: handle?.state ?? null,
        initialCommit: handle?.initialCommit ?? null, lastSnapshotCommit: handle?.lastSnapshotCommit ?? null,
        catchUpFailed: saveOutcome.value?.catchUpFailed ?? false, hasUnsavedChanges: options.hasUnsavedChanges.value,
      }))
      return true
    }
    catch { localError.value = '复制运行记录失败。'; return false }
  }
  const dispose = () => {
    disposed = true
    if (!applied) invalidate('cancelled')
    runtime.dispose()
    clearSaveAcknowledgement()
    for (const stop of [stopVisibility, stopInputs, stopGrant, stopSelection, stopSource]) stop()
    eventTarget?.removeEventListener('storage', sourceWarning)
    eventTarget?.removeEventListener('focus', sourceWarning)
  }
  return { visible, brief, cutoffId, granted, selectedHitIds, snapshot: snapshot as Ref<WriterAgentSnapshot>, phase,
    choices, targetTitle, ready, busy, canPreview, blocker, draftText, saveHandle, saveOutcome, localError, isBarrierPending,
    open, close, preview, start, select, approve, append, retrySave, waitForCommit,
    cancel: () => invalidate('cancelled'), reset: close, copy, copyAudit, dispose }
}
