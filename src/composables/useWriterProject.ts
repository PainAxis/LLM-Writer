import { computed, ref, shallowReactive, watch } from 'vue'
import type {
  WriterChapter,
  WriterCharacter,
  WriterCorpusItem,
  WriterEvent,
  WriterNovel,
  WriterWorldSetting,
} from '@/types/writer'
import { countWriterWords } from '@/utils/writerContent'
import { migrateEventChapters } from '@/utils/eventLine'
import { StorageKeys, storageGet, storageSet, type StorageSetOptions } from '@/utils/storage'
import { createWriterPersistenceGate, type WriterApplyLease, type WriterSaveHandle, type WriterSaveOutcome, type WriterSaveState, type WriterCommitKnowledge } from './writerPersistenceGate'
import { registerNovelPersistenceRetryHandler } from '@/services/novelPersistence'

export type { WriterChapter, WriterNovel } from '@/types/writer'

interface BeforeUnloadTarget {
  addEventListener(type: 'beforeunload', handler: (event: BeforeUnloadEvent) => void): void
  removeEventListener(type: 'beforeunload', handler: (event: BeforeUnloadEvent) => void): void
}

interface WriterProjectOptions {
  novelStore: { worldSettings: WriterWorldSetting[] }
  notifyError: (message: string) => void
  /** 可注入事件目标；Node 下默认不注册浏览器事件。 */
  beforeUnloadTarget?: BeforeUnloadTarget | null
  persistence?: {
    load: () => WriterNovel[]
    /** Test/custom adapters may guarantee that any rejection happens BEFORE
     * committing. Without this explicit guarantee a receipt-free rejection is unknown. */
    rejectsBeforeCommit?: true
    save: (novels: WriterNovel[], options?: StorageSetOptions) => void | Promise<void>
  }
}

export interface WriterChapterSelectionOptions {
  /** Rechecked after persistence and before the target chapter is committed. */
  isCurrent?: () => boolean
  /** Reports the non-cancellable save separately from a later stale-intent rejection. */
  onPersisted?: (saved: boolean) => void
}

// Stored project data is JSON. Cloning on both boundaries keeps mutable editor
// objects separate from the last persisted snapshot, including nested materials.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Project loading, chapter edits and persistence, independent of Writer's UI. */
export function useWriterProject(options: WriterProjectOptions) {
  const persistence = options.persistence ?? {
    load: () => storageGet<WriterNovel[]>(StorageKeys.novels, []),
    save: (novels: WriterNovel[], saveOptions?: StorageSetOptions) => storageSet(StorageKeys.novels, novels, saveOptions),
  }
  const hasCommitReceiptGuarantee = !options.persistence || options.persistence.rejectsBeforeCommit === true
  const currentNovel = ref<WriterNovel | null>(null)
  const chapters = ref<WriterChapter[]>([])
  const currentChapter = ref<WriterChapter | null>(null)
  const content = ref('')
  const characters = ref<WriterCharacter[]>([])
  const corpusData = ref<WriterCorpusItem[]>([])
  const events = ref<WriterEvent[]>([])
  const worldSettings = computed(() => options.novelStore.worldSettings)
  const contentWordCount = computed(() => countWriterWords(content.value))
  const hasUnsavedChanges = ref(false)
  const isSaving = ref(false)
  const saveError = ref<string | null>(null)
  let autoSaveTimer: ReturnType<typeof setTimeout> | undefined
  let pendingSaves = 0
  let editVersion = 0
  let initializationVersion = 0
  let selectionVersion = 0
  let disposed = false
  const persistenceGate = createWriterPersistenceGate({
    target: () => ({ projectId: currentNovel.value?.id ?? null, chapterId: currentChapter.value?.id ?? null }),
    canAcquire: () => !disposed && !isSaving.value && !hasUnsavedChanges.value && !saveError.value,
    canRelease: () => !isSaving.value && !hasUnsavedChanges.value
      && (!ownedSave || workspaceFingerprint() === ownedSave.savedFingerprint),
  })
  watch([() => currentNovel.value, () => currentChapter.value?.id], () => persistenceGate.advanceWorkspace(), { flush: 'sync' })
  let nextOperationId = 0
  let nextSnapshotId = 0
  type OwnedSave = {
    handle: WriterSaveHandle
    lease: WriterApplyLease
    running: boolean
    initialAttempt: boolean
    hasCommittedSnapshot: boolean
    savedFingerprint: string
    novel: WriterNovel | null
    mutable: { state: WriterSaveState; initialCommit: WriterCommitKnowledge; lastSnapshotCommit: WriterCommitKnowledge; settled: Promise<WriterSaveOutcome> }
  }
  let ownedSave: OwnedSave | null = null
  const unloadTarget = options.beforeUnloadTarget === undefined
    ? (typeof window === 'undefined' ? null : window)
    : options.beforeUnloadTarget
  const warnBeforeUnload = (event: BeforeUnloadEvent) => {
    // 防抖计时尚未结束时，持久化后端还看不到这批编辑。
    if (hasUnsavedChanges.value || isSaving.value || saveError.value) {
      event.preventDefault()
      event.returnValue = ''
    }
  }
  unloadTarget?.addEventListener('beforeunload', warnBeforeUnload)
  const unregisterRetry = options.persistence ? () => undefined : registerNovelPersistenceRetryHandler(async () => {
    if (ownedSave && !ownedSave.running && ownedSave.mutable.state !== 'clean') {
      throw new Error(ownedSave.mutable.state === 'unknown'
        ? '追加保存结果尚未确认，请勿重复提交；可以在连续性草稿面板复制保留。'
        : '追加内容仍保留，请在连续性草稿面板点击“重试保存”，不要重新追加。')
    }
    if (!(await saveCurrentChapter())) throw new Error(saveError.value ?? '小说保存失败')
  })

  function cancelAutoSave() {
    if (autoSaveTimer !== undefined) clearTimeout(autoSaveTimer)
    autoSaveTimer = undefined
  }

  function reportSaveError(error: unknown, unknown = false) {
    const detail = error instanceof Error ? error.message : String(error)
    const message = unknown ? `保存结果尚未确认，请勿重复提交，当前编辑仍保留：${detail}`
      : `保存失败，编辑内容仍保留在当前页面，请重试：${detail}`
    if (saveError.value !== message) {
      try { options.notifyError(message) } catch { /* Notification is not persistence. */ }
    }
    saveError.value = message
    hasUnsavedChanges.value = true
  }

  function copyEditorContent() {
    if (!currentChapter.value) return
    currentChapter.value.content = content.value
    currentChapter.value.wordCount = contentWordCount.value
    currentChapter.value.updatedAt = new Date()
  }

  // Compare the effective full project, not just current-chapter keystrokes.
  // CRUD/generation callers also save title/status/material/non-current chapters.
  function workspaceFingerprint(): string {
    return JSON.stringify({ ...currentNovel.value, chapterList: chapters.value,
      characters: characters.value, worldSettings: options.novelStore.worldSettings,
      corpusData: corpusData.value, events: events.value, editorContent: content.value })
  }

  function ownsWorkspace(owner: OwnedSave): boolean {
    return currentNovel.value === owner.novel
      && (currentNovel.value?.id ?? null) === owner.handle.projectId
      && (currentChapter.value?.id ?? null) === owner.handle.chapterId
      && persistenceGate.workspaceEpoch === owner.handle.epoch
  }

  function outcome(owner: OwnedSave, status: WriterSaveOutcome['status']): WriterSaveOutcome {
    return Object.freeze({
      status, initialCommit: owner.mutable.initialCommit,
      lastSnapshotCommit: owner.mutable.lastSnapshotCommit,
      catchUpFailed: owner.hasCommittedSnapshot && status === 'failed',
      hasUnsavedChanges: status !== 'clean' || (ownsWorkspace(owner) && hasUnsavedChanges.value),
    })
  }

  function startOwnedSave(owner: OwnedSave): void {
    cancelAutoSave()
    owner.running = true
    owner.mutable.state = 'saving'
    owner.mutable.lastSnapshotCommit = 'unknown'
    isSaving.value = true
    // Publish the promise and owner BEFORE any callback or persistence invocation.
    let resolve!: (value: WriterSaveOutcome) => void
    owner.mutable.settled = new Promise(done => { resolve = done })
    const run = async (): Promise<WriterSaveOutcome> => {
      do {
        const initialSnapshot = owner.initialAttempt
        owner.initialAttempt = false
        const savedEditVersion = editVersion
        const savedContent = content.value
        owner.mutable.lastSnapshotCommit = 'unknown'
        try {
          if (!ownsWorkspace(owner)) {
            owner.mutable.state = 'unknown'
            return outcome(owner, 'unknown')
          }
          if (!currentNovel.value) {
            owner.mutable.state = 'clean'
            return outcome(owner, 'clean')
          }
          copyEditorContent()
          const totalWordCount = chapters.value.reduce((sum, chapter) => {
            if (typeof chapter.content === 'string') chapter.wordCount = countWriterWords(chapter.content)
            return sum + (chapter.wordCount || 0)
          }, 0)
          const novelData: WriterNovel = clone({
            ...currentNovel.value, chapterList: chapters.value, characters: characters.value,
            worldSettings: options.novelStore.worldSettings, corpusData: corpusData.value,
            events: events.value, updatedAt: new Date(), wordCount: totalWordCount,
            chapters: chapters.value.length, totalWords: totalWordCount,
          })
          owner.savedFingerprint = workspaceFingerprint()
          const novels = [...persistence.load()]
          const index = novels.findIndex(novel => novel.id === owner.handle.projectId)
          if (index > -1) novels[index] = novelData
          else novels.push(novelData)
          const onCommit = () => {
            // Lock the original snapshot's knowledge before later acknowledgement
            // or cleanup awaits. This callback never clears another workspace.
            owner.hasCommittedSnapshot = true
            owner.mutable.lastSnapshotCommit = 'committed'
            if (initialSnapshot && owner.mutable.initialCommit === 'unknown') owner.mutable.initialCommit = 'committed'
          }
          try {
            await persistence.save(novels, { onCommit, retryPolicy: 'explicit' })
            // Existing injected/legacy backends need not implement the optional
            // observer; their successful acknowledgement still proves commit.
            onCommit()
          } catch (error) {
            if ((owner.mutable.lastSnapshotCommit as WriterCommitKnowledge) !== 'committed') throw error
            // An acknowledgement failure cannot contradict an actual receipt.
          }
          if (ownsWorkspace(owner) && editVersion === savedEditVersion && content.value === savedContent
            && workspaceFingerprint() === owner.savedFingerprint) {
            hasUnsavedChanges.value = false
            saveError.value = null
          }
        } catch (error) {
          const knowledge = hasCommitReceiptGuarantee ? 'not_committed' : 'unknown'
          owner.mutable.lastSnapshotCommit = knowledge
          if (initialSnapshot && owner.mutable.initialCommit === 'unknown') owner.mutable.initialCommit = knowledge
          if (ownsWorkspace(owner)) reportSaveError(error, knowledge === 'unknown')
          owner.mutable.state = knowledge === 'unknown' ? 'unknown' : 'failed'
          return outcome(owner, owner.mutable.state)
        }
        // Never follow an old save into a new target or recapture its baseline.
        if (!ownsWorkspace(owner)) {
          owner.mutable.state = 'clean'
          return outcome(owner, 'clean')
        }
        if (editVersion === savedEditVersion && content.value === savedContent
          && workspaceFingerprint() === owner.savedFingerprint) break
        nextSnapshotId += 1
      } while (true)
      owner.mutable.state = 'clean'
      if (owner.lease && ownsWorkspace(owner) && !hasUnsavedChanges.value) persistenceGate.markClean(owner.lease)
      return outcome(owner, 'clean')
    }
    const complete = (result: WriterSaveOutcome) => {
      owner.running = false
      if (ownedSave === owner) {
        isSaving.value = pendingSaves > 0
      }
      resolve(result)
    }
    void run().then(complete, () => {
      // Unexpected acknowledgement/observer failures are not proof of rollback.
      owner.mutable.state = 'unknown'
      complete(outcome(owner, 'unknown'))
    })
  }

  function beginSave(options: { applyLease: WriterApplyLease; retry?: boolean }): WriterSaveHandle {
    if (ownedSave?.running) {
      if (ownedSave.lease !== options.applyLease) throw new Error('已有其他保存操作正在进行')
      return ownedSave.handle
    }
    if (ownedSave?.mutable.state === 'unknown') return ownedSave.handle
    if (ownedSave && ownedSave.mutable.state !== 'clean') {
      // Header/global retry, autosave, disposal and navigation cannot invent a
      // new Agent token or silently retry its retained recovery snapshot.
      if (options.retry && options.applyLease === ownedSave.lease
        && ownedSave.mutable.state === 'failed' && ownedSave.lease.valid && ownsWorkspace(ownedSave)) {
        startOwnedSave(ownedSave)
      }
      return ownedSave.handle
    }
    if (ownedSave?.lease === options.applyLease) {
      // A real author edit can arrive between the clean acknowledgement and
      // presentation releasing its lease. Continue that SAME token, never append
      // or retry a failed/unknown operation, and never write for an unchanged join.
      if (ownedSave.mutable.state === 'clean' && options.applyLease.valid && ownsWorkspace(ownedSave)) {
        if (workspaceFingerprint() !== ownedSave.savedFingerprint) {
          hasUnsavedChanges.value = true
          startOwnedSave(ownedSave)
        } else {
          // Edit then exact Undo can dirty/revoke the clean marker after commit.
          // Reconcile only this exact already-committed snapshot, with no write
          // and no storage reread or CAS-baseline refresh.
          const needsReconciliation = hasUnsavedChanges.value || saveError.value !== null
          cancelAutoSave()
          hasUnsavedChanges.value = false
          saveError.value = null
          persistenceGate.markClean(ownedSave.lease)
          if (needsReconciliation) ownedSave.mutable.settled = Promise.resolve(outcome(ownedSave, 'clean'))
        }
      }
      return ownedSave.handle
    }
    if (!options.applyLease.valid || !options.applyLease.applied
      || !persistenceGate.owns(options.applyLease)) throw new Error('追加保存许可已失效')
    const mutable = shallowReactive({
      state: 'saving' as WriterSaveState, initialCommit: 'unknown' as WriterCommitKnowledge,
      lastSnapshotCommit: 'unknown' as WriterCommitKnowledge,
      settled: Promise.resolve(null as unknown as WriterSaveOutcome),
    })
    const handle: WriterSaveHandle = Object.freeze({
      operationId: ++nextOperationId, projectId: currentNovel.value?.id ?? null,
      chapterId: currentChapter.value?.id ?? null, epoch: persistenceGate.workspaceEpoch,
      initialSnapshotId: ++nextSnapshotId,
      get state() { return mutable.state },
      get initialCommit() { return mutable.initialCommit },
      get lastSnapshotCommit() { return mutable.lastSnapshotCommit },
      get settled() { return mutable.settled },
      markUnknown() { if (owner.running) mutable.state = 'unknown' },
    })
    const owner: OwnedSave = {
      handle, lease: options.applyLease, running: false,
      initialAttempt: true, hasCommittedSnapshot: false, savedFingerprint: '', novel: currentNovel.value, mutable,
    }
    ownedSave = owner
    startOwnedSave(owner)
    return handle
  }

  function beginSaveCurrentChapter(options: { applyLease: WriterApplyLease; retry?: boolean }): WriterSaveHandle {
    return beginSave(options)
  }

  // Ordinary CRUD callers need the result of THEIR snapshot, not a later
  // catch-up operation: rolling back an already-committed mutation loses data.
  // Keep their established save semantics; only an Agent lease joins callers.
  async function saveOrdinaryNovelData(): Promise<boolean> {
    if (!currentNovel.value) return true
    cancelAutoSave()
    const novelId = currentNovel.value.id
    const savedEditVersion = editVersion
    const savedContent = content.value
    pendingSaves += 1
    isSaving.value = true
    try {
      copyEditorContent()
      const totalWordCount = chapters.value.reduce((sum, chapter) => {
        if (typeof chapter.content === 'string') chapter.wordCount = countWriterWords(chapter.content)
        return sum + (chapter.wordCount || 0)
      }, 0)
      const novelData: WriterNovel = clone({
        ...currentNovel.value,
        chapterList: chapters.value,
        characters: characters.value,
        worldSettings: options.novelStore.worldSettings,
        corpusData: corpusData.value,
        events: events.value,
        updatedAt: new Date(),
        wordCount: totalWordCount,
        chapters: chapters.value.length,
        totalWords: totalWordCount,
      })
      const novels = [...persistence.load()]
      const index = novels.findIndex(novel => novel.id === novelId)
      if (index > -1) novels[index] = novelData
      else novels.push(novelData)
      await persistence.save(novels)
      if (currentNovel.value?.id === novelId && editVersion === savedEditVersion && content.value === savedContent) {
        hasUnsavedChanges.value = false
        saveError.value = null
      }
      return true
    } catch (error) {
      reportSaveError(error)
      return false
    } finally {
      pendingSaves -= 1
      isSaving.value = pendingSaves > 0 || Boolean(ownedSave?.running)
    }
  }

  async function saveOrdinaryCurrentChapter(): Promise<boolean> {
    // A route/chapter change waits for this method. Include keystrokes received
    // while an earlier snapshot was being committed before allowing navigation.
    let savedVersion: number
    let savedContent: string
    do {
      savedVersion = editVersion
      savedContent = content.value
      if (!(await saveOrdinaryNovelData())) return false
    } while (editVersion !== savedVersion || content.value !== savedContent)
    return true
  }

  function hasUnchangedCommittedAgentSnapshot(): boolean {
    // A navigation/dispose waiter resumes AFTER the Agent UI releases its lease.
    // Reuse that exact committed snapshot rather than writing it again merely
    // because ownership ended. Ordinary edits/CRUD still keep their own saves.
    return Boolean(ownedSave && !ownedSave.running && ownedSave.mutable.state === 'clean'
      && ownedSave.hasCommittedSnapshot && ownedSave.mutable.lastSnapshotCommit === 'committed'
      && ownsWorkspace(ownedSave) && pendingSaves === 0 && !isSaving.value
      && !hasUnsavedChanges.value && !saveError.value
      && workspaceFingerprint() === ownedSave.savedFingerprint)
  }

  function saveNovelData(): Promise<boolean> {
    if (ownedSave && (ownedSave.running || ownedSave.mutable.state !== 'clean' || persistenceGate.owns(ownedSave.lease))) {
      const handle = beginSave({ applyLease: ownedSave.lease })
      return handle.settled.then(result => result.status === 'clean' && !result.hasUnsavedChanges)
    }
    if (persistenceGate.isMutationBlocked.value) return Promise.resolve(false)
    if (hasUnchangedCommittedAgentSnapshot()) return Promise.resolve(true)
    return saveOrdinaryNovelData()
  }
  function saveCurrentChapter(): Promise<boolean> {
    if (ownedSave && (ownedSave.running || ownedSave.mutable.state !== 'clean' || persistenceGate.owns(ownedSave.lease))) {
      const handle = beginSave({ applyLease: ownedSave.lease })
      return handle.settled.then(result => result.status === 'clean' && !result.hasUnsavedChanges)
    }
    if (persistenceGate.isMutationBlocked.value) return Promise.resolve(false)
    if (hasUnchangedCommittedAgentSnapshot()) return Promise.resolve(true)
    return saveOrdinaryCurrentChapter()
  }

  function loadChapterUnchecked(chapter: WriterChapter) {
    cancelAutoSave()
    if (!chapter.status || chapter.status === 'outline') chapter.status = 'draft'
    currentChapter.value = chapter
    content.value = chapter.content || ''
  }

  function loadChapter(chapter: WriterChapter): boolean {
    if (disposed || !persistenceGate.allowMutation()) return false
    loadChapterUnchecked(chapter)
    return true
  }

  async function selectChapter(
    chapter: WriterChapter,
    selection: WriterChapterSelectionOptions = {},
  ): Promise<boolean> {
    const targetChapterId = chapter.id
    const intent = persistenceGate.captureWorkspaceIntent()
    const requestedVersion = ++selectionVersion
    const saved = await saveCurrentChapter()
    selection.onPersisted?.(saved)
    if (!saved) return false
    if (requestedVersion !== selectionVersion || disposed || selection.isCurrent?.() === false) {
      return false
    }

    // The list item may have been replaced while persistence was pending.
    // Resolve by ID at commit time so the editor never points at a detached object.
    const canonicalChapter = chapters.value.find(item => item.id === targetChapterId)
    if (!canonicalChapter || !persistenceGate.allowWorkspaceChange(intent)) return false
    loadChapterUnchecked(canonicalChapter)
    return true
  }

  async function initNovel(id: unknown): Promise<boolean> {
    const novelId = Number(typeof id === 'string' ? id : NaN)
    if (!Number.isSafeInteger(novelId) || novelId <= 0) {
      options.notifyError('缺少或无效的小说ID参数')
      return false
    }
    const intent = persistenceGate.captureWorkspaceIntent()
    const requestedVersion = ++initializationVersion
    // Flush the old project before replacing any refs. On failure all editor
    // data stays available, allowing the route guard/caller to keep this page.
    if (currentNovel.value && !(await saveCurrentChapter())) return false
    if (requestedVersion !== initializationVersion || disposed) return false
    const storedNovel = persistence.load().find(novel => novel.id === novelId)
    if (!storedNovel) {
      options.notifyError('小说不存在')
      return false
    }
    const novel = clone(storedNovel)
    if (!persistenceGate.allowWorkspaceChange(intent)) return false
    selectionVersion += 1
    cancelAutoSave()
    currentNovel.value = novel
    currentChapter.value = null
    content.value = ''
    characters.value = novel.characters || []
    options.novelStore.worldSettings = novel.worldSettings || []
    corpusData.value = novel.corpusData || []
    events.value = novel.events || []
    let migrated = false
    chapters.value = (novel.chapterList || []).map(chapter => {
      const status = !chapter.status || chapter.status === 'outline' ? 'draft' : chapter.status
      if (status !== chapter.status) migrated = true
      return {
        ...chapter,
        createdAt: chapter.createdAt ? new Date(chapter.createdAt) : undefined,
        updatedAt: chapter.updatedAt ? new Date(chapter.updatedAt) : undefined,
        status,
      }
    })
    if (chapters.value.length) loadChapterUnchecked(chapters.value[0])
    hasUnsavedChanges.value = false
    saveError.value = null
    // All material categories and chapter refs are ready before migration writes.
    migrated = migrateEventChapters(events.value, chapters.value) || migrated
    if (migrated) return saveNovelData()
    return true
  }

  function onContentChange() {
    if (disposed || !currentChapter.value || content.value === (currentChapter.value.content || '')) return
    editVersion += 1
    persistenceGate.noteAuthorEdit()
    hasUnsavedChanges.value = true
    cancelAutoSave()
    autoSaveTimer = setTimeout(() => { void autoSave() }, 2000)
  }

  function autoSave(): Promise<boolean> {
    return saveNovelData()
  }

  function dispose(): Promise<boolean> {
    disposed = true
    unregisterRetry() // The backend retains request-bound explicit-only replay protection.
    unloadTarget?.removeEventListener('beforeunload', warnBeforeUnload)
    initializationVersion += 1
    cancelAutoSave()
    // Capture synchronously before Vue tears down the editor; saveNovelData
    // reaches its first await only after copying refs into a detached snapshot.
    return saveCurrentChapter()
  }

  return {
    currentNovel, chapters, currentChapter, content, characters, worldSettings,
    corpusData, events, contentWordCount, hasUnsavedChanges, isSaving, saveError,
    saveNovelData, saveCurrentChapter, loadChapter, selectChapter, initNovel,
    onContentChange, autoSave, dispose, beginSaveCurrentChapter,
    acquireApplyLease: persistenceGate.acquireApplyLease,
    captureMutationIntent: persistenceGate.captureMutationIntent,
    allowMutation: persistenceGate.allowMutation,
    noteAuthorEdit: persistenceGate.noteAuthorEdit,
    isMutationBlocked: persistenceGate.isMutationBlocked,
  }
}
