import { computed, markRaw, reactive, watch, type Ref } from 'vue'
import type { WriterChapter, WriterNovel } from '@/types/writer'
import type { MemoryChapterInput } from '@/types/memory'
import { MemoryClient } from '@/services/memory/client'
import { prepareWriterMemoryContext, type PreparedWriterMemoryContext, type WriterMemoryClient, type WriterMemorySelection } from '@/services/memory/writerContext'
import { stripWriterHtml } from '@/utils/writerContent'
import { StorageKeys } from '@/utils/storage'
import { createWriterMemoryProviders, writerMemoryRemoteOptions, type WriterMemoryPreview } from './writerMemoryUi'

interface WriterMemoryOptions {
  currentNovel: Readonly<Ref<WriterNovel | null>>
  chapters: Readonly<Ref<WriterChapter[]>>
  currentChapter: Readonly<Ref<WriterChapter | null>>
  targetChapter: Readonly<Ref<WriterChapter | null>>
  content: Ref<string>
  saveCurrentChapter(): Promise<boolean>
  client?: WriterMemoryClient & { dispose?(): void }
  prepare?: typeof prepareWriterMemoryContext
}

export interface WriterMemoryLease {
  prompt: string
  assertFresh(): Promise<void>
}

/** Route-session approval of a bounded, committed-source attachment. */
export function useWriterMemoryContext(options: WriterMemoryOptions) {
  const client = options.client ?? new MemoryClient()
  const prepare = options.prepare ?? prepareWriterMemoryContext
  const state = reactive({
    enabled: false, query: '', cutoffId: '', busy: false, error: '', notice: '', approved: false,
    selection: { hitIds: [], relationIds: [] } as WriterMemorySelection,
    providers: createWriterMemoryProviders(), result: null as WriterMemoryPreview | null,
  })
  let revision = 0
  let acquisition = 0
  let disposed = false
  let prepared: PreparedWriterMemoryContext | null = null
  let approvedSelection: PreparedWriterMemoryContext | null = null
  let selectionRevision = 0
  let approvalAttempt = 0
  let approvalBusy = false
  let previewAbort: AbortController | null = null
  let preparedTarget = ''
  const invalidators = new Set<() => void>()
  const targetInput = (): MemoryChapterInput | null => {
    const target = options.targetChapter.value
    if (!target) return null
    return {
      id: String(target.id), title: target.title || '未命名章节',
      text: stripWriterHtml(options.currentChapter.value?.id === target.id ? options.content.value : target.content || ''),
    }
  }
  const targetIdentity = () => JSON.stringify([options.currentNovel.value?.id, targetInput()])
  const chapters = computed(() => {
    const target = options.chapters.value.findIndex(chapter => chapter.id === options.targetChapter.value?.id)
    return options.chapters.value.slice(0, target + 1).map((chapter, index) => ({
      id: String(chapter.id), title: chapter.title, ordinal: index + 1,
    }))
  })

  const revoke = (notice = '') => {
    revision += 1
    approvalAttempt += 1
    approvalBusy = false
    previewAbort?.abort()
    previewAbort = null
    client.invalidateSource()
    prepared = null
    approvedSelection = null
    state.selection = { hitIds: [], relationIds: [] }
    state.result = null
    state.approved = false
    state.busy = false
    state.error = ''
    state.notice = notice
    for (const invalidate of invalidators) invalidate()
  }
  const changed = () => {
    if (state.enabled || prepared || state.busy) revoke('稿件、目标章节或检索设置已改变，请重新检索并核对依据。')
  }
  const cancel = () => revoke('已取消检索。')
  const selectionChanged = () => {
    selectionRevision += 1
    approvalAttempt += 1
    if (approvalBusy) { approvalBusy = false; state.busy = false }
    approvedSelection = null
    state.approved = false
    state.error = ''
    if (prepared) state.notice = '依据选择已改变，请核对所选原文后重新确认；未选项不会发送。'
    for (const invalidate of invalidators) invalidate()
  }
  const select = (selection: WriterMemorySelection) => {
    if (!prepared || disposed) return
    state.selection = { hitIds: [...selection.hitIds], relationIds: [...selection.relationIds] }
  }
  const ensureCurrent = (operation: number, identity: string) => {
    if (disposed || operation !== revision || !state.enabled || identity !== targetIdentity()) {
      throw new Error('写作记忆准备已失效，请重新检索并核对依据。')
    }
  }

  async function search(): Promise<boolean> {
    revoke()
    if (!state.enabled) return false
    const operation = revision
    const identity = targetIdentity()
    const editorIdentity = JSON.stringify([options.currentChapter.value?.id, options.content.value])
    const controller = new AbortController()
    previewAbort = controller
    state.busy = true
    try {
      const saved = await options.saveCurrentChapter()
      ensureCurrent(operation, identity)
      if (!saved) throw new Error('当前正文尚未保存成功，请先解决保存问题，再检索写作依据。')
      if (editorIdentity !== JSON.stringify([options.currentChapter.value?.id, options.content.value])) {
        throw new Error('正文在保存期间改变，请重新检索。')
      }
      const target = targetInput()
      const novel = options.currentNovel.value
      if (!target || !novel || !chapters.value.some(chapter => chapter.id === state.cutoffId)) {
        throw new Error('请选择有效的目标章节和剧情披露截止章节。')
      }
      const result = await prepare({
        projectId: `novel:${novel.id}`, query: state.query, throughChapterId: state.cutoffId,
        targetChapterId: target.id, expectedTarget: target, remote: writerMemoryRemoteOptions(state.providers),
      }, { client, signal: controller.signal })
      ensureCurrent(operation, identity)
      prepared = result
      preparedTarget = identity
      // Do not expose the private preparation methods to the presentation layer.
      state.result = markRaw({ hits: result.hits, relations: result.relations, diagnostics: result.diagnostics,
        assessment: result.assessment, relationMatches: result.relationMatches, prompt: result.prompt })
      state.notice = result.prompt
        ? (result.truncated ? '已按上下文预算保留完整候选；部分结果未纳入。请逐项选择并核对。' : '候选默认未选。请逐项核对原文、章节版本与推断标识，选择有帮助的参考后确认。')
        : '本次检索未找到可纳入的候选依据，不代表原文没有答案。可调整查询或关闭记忆依据后继续写作。'
      return true
    } catch (error) {
      if (operation === revision && !disposed) state.error = error instanceof Error ? error.message : '写作记忆检索失败，请重试。'
      return false
    } finally {
      if (operation === revision) state.busy = false
    }
  }

  async function assertPrepared(candidate: PreparedWriterMemoryContext, operation: number): Promise<void> {
    ensureCurrent(operation, preparedTarget)
    if (candidate !== prepared) throw new Error('检索依据已失效，请重新检索并核对。')
    await candidate.assertFresh()
    ensureCurrent(operation, preparedTarget)
    if (candidate !== prepared) throw new Error('检索依据已失效，请重新检索并核对。')
  }

  async function approve(): Promise<boolean> {
    const candidate = prepared
    if (!candidate?.prompt || state.busy || !state.selection.hitIds.length && !state.selection.relationIds.length) return false
    const operation = revision
    const chosenRevision = selectionRevision
    const attempt = ++approvalAttempt
    const selection = { hitIds: [...state.selection.hitIds], relationIds: [...state.selection.relationIds] }
    approvalBusy = true
    state.busy = true
    try {
      await assertPrepared(candidate, operation)
      const chosen = await candidate.selectEvidence(selection)
      ensureCurrent(operation, preparedTarget)
      if (candidate !== prepared || chosenRevision !== selectionRevision || attempt !== approvalAttempt) throw new Error('依据选择已改变，请重新核对所选原文。')
      if (!chosen.prompt) throw new Error('请至少选择一项完整依据，再确认用于生成。')
      approvedSelection = chosen
      state.approved = true
      state.error = ''
      state.notice = '已核对。本次仅发送勾选的完整依据，答案仍须核对；发送前会重新检查修订和披露范围。'
      return true
    } catch (error) {
      if (operation === revision && chosenRevision === selectionRevision && attempt === approvalAttempt) {
        revoke()
        state.error = error instanceof Error ? error.message : '依据已失效，请重新检索。'
      }
      return false
    } finally {
      if (operation === revision && attempt === approvalAttempt) { approvalBusy = false; state.busy = false }
    }
  }

  /** Null keeps the existing no-memory generation path synchronous. */
  function acquire(): Promise<WriterMemoryLease> | null {
    if (!state.enabled) return null
    const candidate = approvedSelection
    const operation = revision
    const chosenRevision = selectionRevision
    const request = ++acquisition
    if (!candidate?.prompt || !state.approved) {
      return Promise.reject(new Error('请先检索并核对写作记忆依据，或关闭记忆依据后生成。'))
    }
    const assertFresh = async () => {
      const ensureSelection = () => {
        ensureCurrent(operation, preparedTarget)
        if (candidate !== approvedSelection || chosenRevision !== selectionRevision || !state.approved) {
          throw new Error('依据选择已改变，请重新核对所选原文。')
        }
      }
      try {
        ensureSelection()
        await candidate.assertFresh()
        ensureSelection()
      }
      catch (error) {
        if (operation === revision && request === acquisition && chosenRevision === selectionRevision) {
          revoke()
          state.error = error instanceof Error ? error.message : '依据已失效，请重新检索。'
        }
        throw error
      }
    }
    return assertFresh().then(() => ({ prompt: candidate.prompt, assertFresh }))
  }

  const stops = [
    watch(() => state.selection, selectionChanged, { deep: true, flush: 'sync' }),
    watch(() => [state.enabled, state.query, state.cutoffId, state.providers], changed, { deep: true, flush: 'sync' }),
    watch(targetIdentity, changed),
    // Reading the live editor for its chapter prevents the save operation's own
    // copyEditorContent from revoking a preview. Other source edits, including
    // edits arriving while save is pending, must still revoke. Batch Vue's
    // currentChapter/content assignments so an ordinary chapter switch never
    // validates the new chapter against the previous chapter's editor text.
    watch(() => options.chapters.value.flatMap(chapter => [chapter.id, chapter.title,
      chapter.id === options.currentChapter.value?.id ? options.content.value : chapter.content,
    ]), (value, previous) => {
      if (value.length !== previous.length || value.some((entry, index) => entry !== previous[index])) changed()
    }),
    watch(() => options.targetChapter.value?.id, () => {
      // Never move a user's chosen cutoff forward when chapters are reordered/deleted.
      if (!state.cutoffId && options.targetChapter.value) state.cutoffId = String(options.targetChapter.value.id)
    }, { immediate: true }),
  ]
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === StorageKeys.novels) changed()
  }
  const revalidate = () => {
    const candidate = prepared
    const operation = revision
    if (!candidate || disposed) return
    void assertPrepared(candidate, operation).catch(() => { if (operation === revision) changed() })
  }
  const onVisibility = () => { if (document.visibilityState === 'visible') revalidate() }
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', revalidate)
    document.addEventListener('visibilitychange', onVisibility)
  }
  function dispose() {
    disposed = true
    revoke()
    for (const stop of stops) stop()
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', revalidate)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    client.dispose?.()
    state.providers = createWriterMemoryProviders()
    invalidators.clear()
  }
  return {
    state, chapters, search, select, approve, cancel, acquire, revoke, dispose,
    onInvalidate(callback: () => void) { invalidators.add(callback); return () => invalidators.delete(callback) },
  }
}
