import { computed, ref, type Ref } from 'vue'
import { bookAnalysisLibrary, type createBookAnalysisLibrary } from '@/services/bookAnalysisLibrary'
import type { BookAnalysisLibraryRecord } from '@/types/bookAnalysis'

interface BookAnalysisLibraryWorkspaceOptions {
  content: Ref<string | null>
  sourceFileName(): string
  isBusy(): boolean
  onOpen(record: BookAnalysisLibraryRecord): void
  confirmDelete(record: BookAnalysisLibraryRecord): Promise<unknown>
  notify: { success(message: string): unknown; warning(message: string): unknown; error(message: string): unknown }
  library?: ReturnType<typeof createBookAnalysisLibrary>
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Own report identity and dialog drafts separately from the committed reference library. */
export function useBookAnalysisLibraryWorkspace(options: BookAnalysisLibraryWorkspaceOptions) {
  const library = options.library ?? bookAnalysisLibrary
  const showAnalysisLibrary = ref(false)
  const showSaveAnalysisReport = ref(false)
  const analysisReportTitle = ref('')
  const savingLibraryReport = ref(false)
  const deletingLibraryReportId = ref<string | null>(null)
  const libraryError = ref('')
  const saveLibraryError = ref('')
  const currentLibraryReportId = ref<string | null>(null)
  const currentLibraryReportTitle = ref('')
  const currentLibrarySourceFile = ref<string | null>(null)
  const libraryRecords = library.records
  const libraryPending = library.pending
  const libraryReportBusy = computed(() => options.isBusy() || savingLibraryReport.value || libraryPending.value)

  const loadAnalysisLibrary = async () => {
    try {
      await library.load()
      libraryError.value = ''
    } catch (error) {
      libraryError.value = `读取参考库失败：${errorText(error)}`
      options.notify.error(libraryError.value)
    }
  }

  const openAnalysisLibrary = async () => {
    showAnalysisLibrary.value = true
    await loadAnalysisLibrary()
  }

  const resetLibraryReport = () => {
    currentLibraryReportId.value = null
    currentLibraryReportTitle.value = ''
    currentLibrarySourceFile.value = null
  }

  const openLibraryReport = (record: BookAnalysisLibraryRecord) => {
    if (libraryReportBusy.value) {
      options.notify.warning('请等待当前操作完成后再打开报告')
      return
    }
    options.onOpen(record)
    currentLibraryReportId.value = record.id
    currentLibraryReportTitle.value = record.title
    currentLibrarySourceFile.value = record.sourceFileName
    showAnalysisLibrary.value = false
    saveLibraryError.value = ''
  }

  const saveToLibrary = () => {
    if (libraryReportBusy.value) return
    if (!options.content.value?.trim()) {
      options.notify.warning('没有可保存的分析结果')
      return
    }
    if (showSaveAnalysisReport.value) return
    const source = currentLibrarySourceFile.value ?? options.sourceFileName()
    analysisReportTitle.value = currentLibraryReportTitle.value || (source
      ? `${source.replace(/\.[^/.]+$/, '')} · 拆书报告`
      : options.content.value.split('\n').find(line => line.trim())?.trim().slice(0, 120) || '拆书分析报告')
    saveLibraryError.value = ''
    showSaveAnalysisReport.value = true
  }

  const confirmSaveLibraryReport = async () => {
    if (savingLibraryReport.value || libraryPending.value || options.isBusy()) return
    if (!analysisReportTitle.value.trim() || !options.content.value?.trim()) {
      saveLibraryError.value = '请填写报告标题，并保留非空的分析结果'
      options.notify.warning(saveLibraryError.value)
      return
    }
    savingLibraryReport.value = true
    const draft = {
      id: currentLibraryReportId.value ?? undefined,
      title: analysisReportTitle.value,
      content: options.content.value,
      sourceFileName: currentLibrarySourceFile.value ?? options.sourceFileName(),
    }
    try {
      const saved = await library.save(draft)
      currentLibraryReportId.value = saved.id
      currentLibraryReportTitle.value = saved.title
      currentLibrarySourceFile.value = saved.sourceFileName
      saveLibraryError.value = ''
      showSaveAnalysisReport.value = false
      options.notify.success('已保存到拆书参考库！')
    } catch (error) {
      saveLibraryError.value = `保存报告失败：${errorText(error)}，请重试`
      options.notify.error(saveLibraryError.value)
    } finally {
      savingLibraryReport.value = false
    }
  }

  const deleteLibraryReport = async (record: BookAnalysisLibraryRecord) => {
    if (libraryPending.value || deletingLibraryReportId.value !== null) return
    deletingLibraryReportId.value = record.id
    try {
      try {
        await options.confirmDelete(record)
      } catch {
        return
      }
      await library.remove(record.id)
      if (currentLibraryReportId.value === record.id) currentLibraryReportId.value = null
      libraryError.value = ''
      options.notify.success('报告已从参考库删除')
    } catch (error) {
      libraryError.value = `删除报告失败：${errorText(error)}，请重试`
      options.notify.error(libraryError.value)
    } finally {
      deletingLibraryReportId.value = null
    }
  }

  return {
    showAnalysisLibrary, showSaveAnalysisReport, analysisReportTitle, savingLibraryReport,
    deletingLibraryReportId, libraryError, saveLibraryError, currentLibraryReportTitle,
    libraryRecords, libraryPending, libraryReportBusy,
    loadAnalysisLibrary, openAnalysisLibrary, openLibraryReport, resetLibraryReport,
    saveToLibrary, confirmSaveLibraryReport, deleteLibraryReport,
  }
}
