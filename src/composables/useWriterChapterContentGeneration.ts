import { computed, ref, watch, type Ref } from 'vue'
import type { GenerateOptions } from '@/types/api'
import type {
  PromptTemplate,
  WriterChapter,
  WriterCharacter,
  WriterCorpusItem,
  WriterEvent,
  WriterNovel,
  WriterWorldSetting,
} from '@/types/writer'
import {
  useChapterContentWorkspace,
  type ChapterContentGenerationSnapshot,
  type ChapterContentMaterial,
  type ChapterContentMaterialType,
} from '@/composables/useChapterContentWorkspace'
import {
  buildChapterContentPrompt,
  type ChapterContentPromptResult,
} from '@/utils/writer/chapterContentPrompt'
import { recommendCorpus, type CorpusRecommendation } from '@/utils/corpusRetrieval'
import { isAIRequestCancelled } from '@/utils/aiRequestScope'
import { formatGeneratedContent } from '@/utils/writerContent'

export interface WriterChapterContentStream {
  streamingContent: Ref<string>
  isStreaming: Readonly<Ref<boolean>>
  generate(prompt: string, options?: GenerateOptions): Promise<string>
  reset(): void
}

export interface WriterChapterContentInfoNotice {
  message: string
  duration?: number
}

export interface WriterChapterContentNotifications {
  success(message: string): unknown
  info(message: string | WriterChapterContentInfoNotice): unknown
  warning(message: string): unknown
  error(message: string): unknown
}

export interface WriterChapterContentSelectionOptions {
  isCurrent?: () => boolean
  onPersisted?: (saved: boolean) => void
}

export type WriterChapterContentWorkspace = ReturnType<typeof useChapterContentWorkspace>

export interface UseWriterChapterContentGenerationOptions {
  currentNovel: Readonly<Ref<WriterNovel | null | undefined>>
  chapters: Readonly<Ref<WriterChapter[]>>
  currentChapter: Ref<WriterChapter | null>
  content: Ref<string>
  hasUnsavedChanges: Ref<boolean>
  characters: Readonly<Ref<WriterCharacter[]>>
  worldSettings: Readonly<Ref<WriterWorldSetting[]>>
  corpusData: Readonly<Ref<WriterCorpusItem[]>>
  events: Readonly<Ref<WriterEvent[]>>
  /** Optional for focused tests. Production normally lets this composable create it. */
  workspace?: WriterChapterContentWorkspace
  /** API/balance validation plus owner-aware arbitration with other AI controllers. */
  prepare(): boolean
  selectChapter(
    chapter: WriterChapter,
    options?: WriterChapterContentSelectionOptions,
  ): Promise<boolean>
  /** Persist the editor's current chapter. A false result must leave editor state intact. */
  persist(): Promise<boolean>
  notify: WriterChapterContentNotifications
  stream: WriterChapterContentStream
  buildPrompt?(snapshot: ChapterContentGenerationSnapshot): ChapterContentPromptResult
  formatContent?(response: string, chapterTitle: string): string
  recommend?(
    items: WriterCorpusItem[],
    contextText: string,
    options?: { topK?: number; minScore?: number },
  ): Array<CorpusRecommendation<WriterCorpusItem>>
  isCancellation?(error: unknown): boolean
  generateOptions?: GenerateOptions
}

interface ChapterContentLaunchSource {
  operation: number
  novel: WriterNovel
  novelId: number
  novelIdentity: string
  chapters: WriterChapter[]
  target: WriterChapter
  targetIdentity: string
  snapshot: ChapterContentGenerationSnapshot
}

interface ChapterContentRequestSource extends ChapterContentLaunchSource {
  contentBaseline: string
  contentRevision: number
}

interface PendingChapterSelection {
  operation: number
  novel: WriterNovel
  chapters: WriterChapter[]
  target: WriterChapter
}

const materialTypeLabels: Readonly<Record<ChapterContentMaterialType, string>> = Object.freeze({
  characters: '人物',
  worldSettings: '世界观',
  corpus: '语料',
  events: '事件线',
})

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const defaultCancellationCheck = (error: unknown): boolean =>
  isAIRequestCancelled(error) || (error instanceof Error && error.name === 'AbortError')

const targetIdentity = (chapter: Readonly<WriterChapter>): string => JSON.stringify({
  id: chapter.id,
  title: chapter.title,
  description: chapter.description,
})

const novelIdentity = (novel: Readonly<WriterNovel>): string => JSON.stringify({
  id: novel.id,
  title: novel.title,
  genre: novel.genre,
  description: novel.description,
})

/**
 * Owns the chapter-content dialog workspace and its asynchronous launch lifecycle.
 *
 * The workspace creates an immutable prompt snapshot before any chapter switch.
 * Only a complete response may reach the editor, and persistence is an explicit,
 * non-cancellable phase which route/chapter/AI arbitration can await.
 */
export function useWriterChapterContentGeneration(
  options: UseWriterChapterContentGenerationOptions,
) {
  const workspace = options.workspace ?? useChapterContentWorkspace({
    currentNovel: options.currentNovel,
    chapters: options.chapters,
    characters: options.characters,
    worldSettings: options.worldSettings,
    corpusData: options.corpusData,
    events: options.events,
  })
  const isSelectingChapter = ref(false)
  const isGenerating = ref(false)
  const isCommitting = ref(false)
  const isBusy = computed(
    () => isSelectingChapter.value || isGenerating.value || isCommitting.value,
  )
  const buildPrompt = options.buildPrompt ?? buildChapterContentPrompt
  const formatContent = options.formatContent ?? formatGeneratedContent
  const findRecommendations = options.recommend ?? recommendCorpus
  const isCancellation = options.isCancellation ?? defaultCancellationCheck
  const requestOptions: GenerateOptions = options.generateOptions ?? {
    maxTokens: null,
    temperature: 0.8,
    type: 'generation',
  }

  let lifecycle = 0
  let contentRevision = 0
  let pendingSelection: PendingChapterSelection | null = null
  let activeAction: Promise<boolean> | null = null
  let activeSelection: Promise<boolean> | null = null
  let selectionBarrier: Promise<boolean> | null = null
  let activeCommit: Promise<boolean> | null = null
  let commitAction: Promise<boolean> | null = null
  let activeRequest: ChapterContentRequestSource | null = null
  let suppressDialogClose = false
  let applyingGeneratedContent = false
  let resetAfterCommit = false
  let disposed = false

  const canonicalTarget = (source: ChapterContentLaunchSource): WriterChapter | undefined =>
    source.chapters.find(chapter => chapter.id === source.target.id)

  const launchIsCurrent = (source: ChapterContentLaunchSource): boolean => {
    const canonical = canonicalTarget(source)
    return !disposed
      && source.operation === lifecycle
      && options.currentNovel.value === source.novel
      && options.currentNovel.value?.id === source.novelId
      && novelIdentity(source.novel) === source.novelIdentity
      && options.chapters.value === source.chapters
      && canonical === source.target
      && targetIdentity(source.target) === source.targetIdentity
  }

  const requestIsCurrent = (source: ChapterContentRequestSource): boolean => {
    const canonical = canonicalTarget(source)
    return launchIsCurrent(source)
      && canonical !== undefined
      && options.currentChapter.value === canonical
  }

  /** Lets the page's legacy chapter watcher preserve this controller's own switch. */
  const isExpectedChapterSelection = (chapter: WriterChapter | null | undefined): boolean => {
    const pending = pendingSelection
    return Boolean(
      chapter
      && pending
      && pending.operation === lifecycle
      && pending.novel === options.currentNovel.value
      && pending.chapters === options.chapters.value
      && chapter === pending.target,
    )
  }

  const stopTransport = (): void => {
    try {
      options.stream.reset()
    } catch {
      // Lifecycle revocation still prevents late chunks/finals from being applied.
    }
  }

  const revoke = (stopStream = true): void => {
    lifecycle += 1
    activeRequest = null
    // selectChapter may currently be persisting the old chapter. Revoke its
    // intent via lifecycle, but keep the non-cancellable selection barrier busy.
    if (!activeSelection) {
      pendingSelection = null
      isSelectingChapter.value = false
    }
    isGenerating.value = false
    if (stopStream) stopTransport()
  }

  /** Cancel selection/transport. A persistence commit is never aborted. */
  const cancel = (): boolean => {
    if (isCommitting.value) return false
    revoke()
    return true
  }

  const resetWorkspace = (): boolean => {
    if (isCommitting.value) {
      resetAfterCommit = true
      return false
    }
    revoke()
    workspace.reset()
    return true
  }

  const closeWorkspace = (): void => {
    suppressDialogClose = true
    try {
      workspace.close()
    } finally {
      suppressDialogClose = false
    }
  }

  const open = (chapter: WriterChapter): boolean => {
    if (isCommitting.value || isSelectingChapter.value) return false
    revoke()
    workspace.open(chapter)
    return true
  }

  const openFromOutline = (): boolean => {
    const chapter = options.currentChapter.value
    if (!chapter?.description) {
      options.notify.warning('请先为章节添加大纲描述')
      return false
    }
    return open(chapter)
  }

  const clearAllSelections = (): void => {
    workspace.clearAllSelections()
    options.notify.success('已清空所有选择')
  }

  const selectAllMaterials = (type: ChapterContentMaterialType): void => {
    workspace.selectAllMaterials(type)
    options.notify.success(`已选择所有${materialTypeLabels[type]}`)
  }

  const clearContextSelection = (): void => {
    workspace.clearContextSelection()
    options.notify.success('已清空前文概要选择')
  }

  const selectAllContextChapters = (): void => {
    workspace.selectAllContextChapters()
    options.notify.success(`已选择所有${workspace.availableContextChapters.value.length}个章节`)
  }

  const recommendCorpusForContext = (): { recommended: number; added: number } => {
    const chapter = workspace.targetChapter.value ?? options.currentChapter.value
    const contextText = [
      options.currentNovel.value?.title || '',
      chapter?.title || '',
      chapter?.description || '',
      chapter?.content || '',
    ].join('\n')
    const recommendations = findRecommendations(options.corpusData.value, contextText, { topK: 5 })

    if (recommendations.length === 0) {
      options.notify.info('未找到与当前章节上下文重合的语料，可尝试手动选择或先完善章节大纲')
      return { recommended: 0, added: 0 }
    }

    const selectedIds = new Set(workspace.selectedMaterials.value.corpus.map(item => item.id))
    let added = 0
    for (const recommendation of recommendations) {
      if (selectedIds.has(recommendation.item.id)) continue
      workspace.selectedMaterials.value.corpus.push(recommendation.item)
      selectedIds.add(recommendation.item.id)
      added += 1
    }
    options.notify.success(
      `已按上下文推荐 ${recommendations.length} 篇语料（新选中 ${added} 篇），可在「参考语料」变量中确认`,
    )
    return { recommended: recommendations.length, added }
  }

  const createLaunchSource = (
    operation: number,
    snapshot: ChapterContentGenerationSnapshot,
  ): ChapterContentLaunchSource | null => {
    const novel = options.currentNovel.value
    const chapters = options.chapters.value
    const target = chapters.find(chapter => chapter.id === snapshot.targetChapter.id)
    if (!novel
      || snapshot.novelId !== novel.id
      || novelIdentity(snapshot.novel) !== novelIdentity(novel)
      || target !== snapshot.targetChapter
      || targetIdentity(target) !== targetIdentity(snapshot.chapter)) {
      return null
    }
    return {
      operation,
      novel,
      novelId: novel.id,
      novelIdentity: novelIdentity(novel),
      chapters,
      target,
      targetIdentity: targetIdentity(target),
      snapshot,
    }
  }

  const commitEditorContent = async (
    source: ChapterContentRequestSource,
    response: string,
  ): Promise<boolean> => {
    if (!requestIsCurrent(source)
      || contentRevision !== source.contentRevision
      || options.content.value !== source.contentBaseline) {
      return false
    }

    const formatted = formatContent(response, source.snapshot.chapter.title)
    applyingGeneratedContent = true
    try {
      options.content.value = formatted
      options.hasUnsavedChanges.value = true
      options.currentChapter.value!.status = 'draft'
    } finally {
      applyingGeneratedContent = false
    }
    const appliedRevision = contentRevision

    isGenerating.value = false
    isCommitting.value = true
    commitAction = activeAction
    let commitError: unknown
    const commit = Promise.resolve()
      .then(() => options.persist())
      .catch((error: unknown) => {
        commitError = error
        return false
      })
    activeCommit = commit
    let saved = false
    try {
      saved = await commit
    } finally {
      if (activeCommit === commit) activeCommit = null
      isCommitting.value = false
    }

    if (!saved) {
      if (commitError !== undefined) {
        options.notify.error(`正文生成失败: ${errorMessage(commitError)}`)
      }
      return false
    }
    if (!requestIsCurrent(source)
      || contentRevision !== appliedRevision
      || options.content.value !== formatted) {
      return false
    }
    options.notify.success('正文生成成功')
    return true
  }

  const requestContent = async (
    launch: ChapterContentLaunchSource,
  ): Promise<boolean> => {
    if (!launchIsCurrent(launch)) return false
    const source: ChapterContentRequestSource = {
      ...launch,
      contentBaseline: options.content.value,
      contentRevision,
    }
    activeRequest = source
    isGenerating.value = true
    stopTransport()

    try {
      const built = buildPrompt(source.snapshot)
      if (built.contextLabels.length > 0) {
        options.notify.info({
          message: `使用上下文：${built.contextLabels.join('、')}`,
          duration: 3000,
        })
      }
      const response = await options.stream.generate(built.prompt, requestOptions)
      if (!response.trim()) throw new Error('AI返回内容为空')
      if (!requestIsCurrent(source)) return false
      if (contentRevision !== source.contentRevision
        || options.content.value !== source.contentBaseline) {
        options.notify.warning('正文已在生成期间发生修改，已保留当前编辑内容')
        return false
      }
      return commitEditorContent(source, response)
    } catch (error) {
      if (isCancellation(error) || source.operation !== lifecycle) return false
      console.error('AI生成正文失败:', error)
      options.notify.error(`正文生成失败: ${errorMessage(error)}`)
      return false
    } finally {
      if (activeRequest === source) activeRequest = null
      if (source.operation === lifecycle && !isCommitting.value) isGenerating.value = false
    }
  }

  const runLaunch = async (
    launch: ChapterContentLaunchSource,
    switchChapter: boolean,
  ): Promise<boolean> => {
    try {
      if (switchChapter) {
        isSelectingChapter.value = true
        const selection: PendingChapterSelection = {
          operation: launch.operation,
          novel: launch.novel,
          chapters: launch.chapters,
          target: launch.target,
        }
        pendingSelection = selection
        let selected = false
        let persistenceReported = false
        let resolveSelectionBarrier!: (saved: boolean) => void
        const barrier = new Promise<boolean>(resolve => {
          resolveSelectionBarrier = resolve
        })
        const reportPersistence = (saved: boolean) => {
          if (persistenceReported) return
          persistenceReported = true
          resolveSelectionBarrier(saved)
        }
        const selectionTask = Promise.resolve().then(() => options.selectChapter(launch.target, {
          isCurrent: () => pendingSelection === selection && launchIsCurrent(launch),
          onPersisted: reportPersistence,
        }))
        activeSelection = selectionTask
        void selectionTask.then(
          result => reportPersistence(result),
          () => reportPersistence(false),
        )
        selectionBarrier = barrier
        try {
          selected = await selectionTask
        } finally {
          if (activeSelection === selectionTask) activeSelection = null
          if (selectionBarrier === barrier) selectionBarrier = null
          if (pendingSelection === selection) pendingSelection = null
          if (launch.operation === lifecycle) isSelectingChapter.value = false
          else if (!activeSelection) isSelectingChapter.value = false
        }
        if (!selected || !launchIsCurrent(launch)) return false
      }

      if (!launchIsCurrent(launch)
        || options.currentChapter.value !== canonicalTarget(launch)) return false
      closeWorkspace()
      return await requestContent(launch)
    } catch (error) {
      if (isCancellation(error) || launch.operation !== lifecycle) return false
      console.error('AI正文生成启动失败:', error)
      options.notify.error(`正文生成失败: ${errorMessage(error)}`)
      return false
    } finally {
      if (resetAfterCommit && !isCommitting.value) {
        resetAfterCommit = false
        workspace.reset()
      }
    }
  }

  const start = (
    snapshot: ChapterContentGenerationSnapshot | null,
  ): Promise<boolean> => {
    // A cancelled transport may ignore abort forever. Its lifecycle is revoked,
    // so it must not prevent a fresh action from replacing the tracked promise.
    if (isBusy.value) return Promise.resolve(false)
    if (!snapshot) {
      options.notify.warning('请先选择提示词模板')
      return Promise.resolve(false)
    }
    if (!options.prepare()) return Promise.resolve(false)

    const operation = ++lifecycle
    const launch = createLaunchSource(operation, snapshot)
    if (!launch) {
      options.notify.warning('章节生成上下文已失效，请重新打开生成对话框')
      return Promise.resolve(false)
    }
    const switchChapter = options.currentChapter.value !== launch.target
    // Lock synchronously before the first async selection/persistence boundary.
    if (switchChapter) isSelectingChapter.value = true

    const action = runLaunch(launch, switchChapter)
    activeAction = action
    void action.then(
      () => {
        if (activeAction === action) activeAction = null
        if (commitAction === action) commitAction = null
      },
      () => {
        if (activeAction === action) activeAction = null
        if (commitAction === action) commitAction = null
      },
    )
    return action
  }

  const generateContentWithPrompt = (
    snapshot: ChapterContentGenerationSnapshot,
  ): Promise<boolean> => start(snapshot)

  const generateChapterContentWithDialog = (): Promise<boolean> =>
    start(workspace.createSnapshot())

  // During commit, wait for the whole action so callers observe final guards,
  // notifications and any deferred workspace reset—not only the storage write.
  const waitForCommit = (): Promise<boolean> =>
    commitAction
      ?? selectionBarrier
      ?? (isCommitting.value ? activeCommit : null)
      ?? Promise.resolve(true)
  const waitForSelection = (): Promise<boolean> => selectionBarrier ?? Promise.resolve(true)
  const waitForIdle = (): Promise<boolean> => {
    if (commitAction) return commitAction
    if (selectionBarrier) {
      // A live intent may continue from selection into AI generation; a revoked
      // intent only needs its non-cancellable selection persistence to settle.
      return pendingSelection?.operation === lifecycle
        ? (activeAction ?? selectionBarrier)
        : selectionBarrier
    }
    return isBusy.value
      ? (activeAction ?? activeCommit ?? Promise.resolve(false))
      : Promise.resolve(true)
  }

  const stopVisibleWatch = watch(workspace.visible, (opened) => {
    if (!opened && !suppressDialogClose && pendingSelection) revoke()
  }, { flush: 'sync' })

  const stopCurrentChapterWatch = watch(options.currentChapter, (chapter, previousChapter) => {
    if (chapter === previousChapter || (!isSelectingChapter.value && !isGenerating.value)) return
    if (!isExpectedChapterSelection(chapter)) revoke()
  }, { flush: 'sync' })

  const stopContentWatch = watch(options.content, (value, previousValue) => {
    if (value === previousValue || applyingGeneratedContent) return
    if (pendingSelection && isSelectingChapter.value) return
    contentRevision += 1
    if (!isGenerating.value || !activeRequest) return
    const source = activeRequest
    revoke()
    options.notify.warning('正文已在生成期间发生修改，已保留当前编辑内容')
    // Keep the captured source unreachable even if a transport ignores abort.
    if (activeRequest === source) activeRequest = null
  }, { flush: 'sync' })

  const stopNovelWatch = watch(options.currentNovel, (novel, previousNovel) => {
    if (previousNovel !== undefined && novel !== previousNovel) resetWorkspace()
  }, { flush: 'sync' })

  const stopNovelIdentityWatch = watch(
    () => options.currentNovel.value ? novelIdentity(options.currentNovel.value) : '',
    (identity, previousIdentity) => {
      if (identity !== previousIdentity && isBusy.value) revoke()
    },
    { flush: 'sync' },
  )

  const stopChapterCollectionWatch = watch(options.chapters, (chapters, previousChapters) => {
    if (chapters !== previousChapters) resetWorkspace()
  }, { flush: 'sync' })

  const stopTargetIdentityWatch = watch(
    () => options.currentChapter.value ? targetIdentity(options.currentChapter.value) : '',
    (identity, previousIdentity) => {
      if (identity === previousIdentity || applyingGeneratedContent || isCommitting.value) return
      if (isSelectingChapter.value && pendingSelection) return
      if (isGenerating.value) revoke()
    },
    { flush: 'sync' },
  )

  const dispose = (): void => {
    disposed = true
    resetAfterCommit = false
    revoke()
    stopVisibleWatch()
    stopCurrentChapterWatch()
    stopContentWatch()
    stopNovelWatch()
    stopNovelIdentityWatch()
    stopChapterCollectionWatch()
    stopTargetIdentityWatch()
    workspace.reset()
  }

  return {
    workspace,
    visible: workspace.visible,
    targetChapter: workspace.targetChapter,
    selectedContentCategory: workspace.selectedContentCategory,
    generateConfig: workspace.generateConfig,
    selectedMaterials: workspace.selectedMaterials,
    selectedContextChapterIds: workspace.selectedContextChapterIds,
    selectedContextChapters: workspace.selectedContextChapterIds,
    selectedContextChapterRecords: workspace.selectedContextChapterRecords,
    availableContextChapters: workspace.availableContextChapters,
    selectedPrompt: workspace.selectedPrompt,
    promptVariables: workspace.promptVariables,
    finalPrompt: workspace.finalPrompt,
    streamingContent: options.stream.streamingContent,
    isStreaming: options.stream.isStreaming,
    isSelectingChapter,
    isGenerating,
    isCommitting,
    isBusy,
    open,
    openFromOutline,
    close: workspace.close,
    reset: resetWorkspace,
    cancel,
    createSnapshot: workspace.createSnapshot,
    selectPrompt: (prompt: PromptTemplate) => workspace.selectPrompt(prompt),
    clearPrompt: workspace.clearPrompt,
    autoFillVariables: workspace.autoFillVariables,
    toggleMaterial: (
      type: ChapterContentMaterialType,
      material: ChapterContentMaterial,
    ) => workspace.toggleMaterial(type, material),
    clearAllSelections,
    clearAllMaterials: clearAllSelections,
    selectAllMaterials,
    toggleContextChapter: workspace.toggleContextChapter,
    clearContextSelection,
    selectAllContextChapters,
    recommendCorpusForContext,
    generateContentWithPrompt,
    generateChapterContentWithDialog,
    waitForCommit,
    waitForSelection,
    waitForIdle,
    isExpectedChapterSelection,
    dispose,
  }
}
