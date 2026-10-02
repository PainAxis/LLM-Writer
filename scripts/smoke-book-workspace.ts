import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useBookAnalysisFile } from '../src/composables/useBookAnalysisFile'
import { detectBookChapters, readBookChapter, prepareBookAnalysis, buildBookAnalysisPrompt } from '../src/utils/bookAnalysisContext'
import { splitBookLocally, type ImportedBook } from '../src/utils/bookImport'
import { createBookAnalysisLibrary } from '../src/services/bookAnalysisLibrary'
import { useBookAnalysisLibraryWorkspace } from '../src/composables/useBookAnalysisLibraryWorkspace'
import type { BookAnalysisLibraryRecord } from '../src/types/bookAnalysis'

const requests: Array<{ resolve(value: ImportedBook | null): void; reject(error: Error): void }> = []
const messages: string[] = []
const imports: string[] = []
let cancelled = 0
let busy = false
const workspace = useBookAnalysisFile({
  isBusy: () => busy,
  onImported: content => imports.push(content),
  onRemoved: () => imports.push('removed'),
  notify: { success: message => messages.push(message), error: message => messages.push(`error:${message}`) },
  importer: {
    cancel: () => { cancelled++ },
    read: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
  },
})
const source = { name: 'test.txt', raw: { name: 'test.txt', arrayBuffer: async () => new ArrayBuffer(0) } }
const first = workspace.handleFileChange(source)
const second = workspace.handleFileChange({ ...source, name: 'second.txt' })
requests[0]!.resolve({ content: '过期文件', format: 'txt', encoding: 'utf-8' })
await first
assert.equal(workspace.importingFile.value, true)
assert.equal(workspace.bookContent.value, '')
requests[1]!.resolve({ content: '当前书籍', format: 'txt', encoding: 'utf-8' })
await second
assert.equal(workspace.uploadedFile.value?.name, 'second.txt')
assert.deepEqual(imports, ['当前书籍'])
workspace.selectedEncoding.value = 'gbk'
const invalid = workspace.rereadWithEncoding()
requests[2]!.reject(new Error('编码错误'))
await invalid
assert.equal(workspace.bookContent.value, '当前书籍')
assert.equal(workspace.selectedEncoding.value, 'utf-8')
assert.equal(workspace.importingFile.value, false)
assert.match(messages.at(-1)!, /编码错误/)
busy = true
await workspace.handleFileChange(source)
assert.equal(requests.length, 3, 'Import must remain blocked during analysis')
busy = false
const removed = workspace.handleFileChange(source)
workspace.removeFile()
requests[3]!.resolve({ content: '已移除文件的迟到结果', format: 'txt', encoding: 'utf-8' })
await removed
assert.equal(workspace.bookContent.value, '')
assert.equal(workspace.uploadedFile.value, null)
assert.equal(cancelled, 1)
const unmounted = workspace.handleFileChange(source)
const messageCount = messages.length
workspace.dispose()
requests[4]!.reject(new Error('卸载后的失败'))
await unmounted
assert.equal(messages.length, messageCount)
assert.equal(workspace.importingFile.value, false)
assert.equal(cancelled, 2)
console.log('✓ Import ownership survives replacement, decode failure, remove and unmount without stale commits or loading-state races')

const content = '前言\n第一章 雨夜\n阿宁走过码头。\n第二章 黎明\n失物找到了。'
const chapters = detectBookChapters(content)
assert.equal(chapters.length, 2)
assert.equal(chapters[0]!.wordCount, '阿宁走过码头。'.length)
assert.equal(readBookChapter(content, chapters, chapters[0]!), '第一章 雨夜\n阿宁走过码头。')
assert.equal(readBookChapter(content, chapters, chapters[1]!), '第二章 黎明\n失物找到了。')
const longContent = '没有章节标题的正文。'.repeat(900)
const local = splitBookLocally(longContent)
assert.equal(local.map(chapter => readBookChapter(longContent, local, chapter)).join(''), longContent)
const input = {
  content, chapters, selectedChapters: [1], start: 1, end: 4,
  templates: [{ id: 12, name: '结构', description: '结构分析', content: '解释转折' }],
  templateId: '12', fileName: 'sample.txt', encoding: 'utf-8',
}
const selected = prepareBookAnalysis(input)
assert.equal(selected.textToAnalyze, '第二章 黎明\n失物找到了。\n\n')
assert.equal(selected.chapterInfos[0]!.summary, '暂无简读')
const ranged = prepareBookAnalysis({ ...input, selectedChapters: [], start: 2, end: 5 })
assert.equal(ranged.textToAnalyze, content.slice(1, 5), 'Word ranges retain one-based inclusive UI boundaries')
assert.throws(() => prepareBookAnalysis({ ...input, templateId: 'missing' }), /未找到分析模板/)
const prompt = buildBookAnalysisPrompt(selected)
for (const value of ['sample.txt', 'UTF-8', '第二章 黎明', '失物找到了。', '解释转折', '结构分析']) assert.ok(prompt.includes(value), value)
console.log('✓ Detected and local chapters share consistent boundaries for preview, analysis and export; prompt context remains complete')

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
function libraryFixture() {
  let disk: BookAnalysisLibraryRecord[] = []
  let failure: 'none' | 'sync' | 'async' = 'none'
  let block: (() => Promise<void>) | undefined
  let writeCount = 0
  let id = 0
  let busy = false
  let cancelDelete = false
  const content = ref<string | null>('《完整分析报告》\n\n人物与结构分析。\n保留所有换行和原始内容。')
  const successes: string[] = []
  const errors: string[] = []
  const warnings: string[] = []
  const library = createBookAnalysisLibrary({
    read: () => clone(disk), id: () => `report-${++id}`, now: () => '2026-10-02T08:00:00.000Z',
    write: next => {
      writeCount++
      if (failure === 'sync') throw new Error('Disk failure')
      if (failure === 'async') return Promise.reject(new Error('Disk failure'))
      if (block) return block().then(() => { disk = clone(next) })
      disk = clone(next)
    },
  })
  const ui = useBookAnalysisLibraryWorkspace({
    library, content, sourceFileName: () => 'source-novel.txt', isBusy: () => busy,
    onOpen: report => { content.value = report.content },
    confirmDelete: async () => { if (cancelDelete) throw 'cancel' },
    notify: { success: message => successes.push(message), error: message => errors.push(message), warning: message => warnings.push(message) },
  })
  return {
    library, ui, content, successes, errors, warnings, disk: () => clone(disk), writes: () => writeCount,
    fail: (value: typeof failure) => { failure = value }, block: (value?: typeof block) => { block = value },
    busy: (value: boolean) => { busy = value }, cancelDelete: (value: boolean) => { cancelDelete = value },
  }
}

for (const failure of ['sync', 'async'] as const) {
  const state = libraryFixture()
  await state.ui.loadAnalysisLibrary()
  state.ui.saveToLibrary()
  state.ui.analysisReportTitle.value = 'My saved report'
  const body = state.content.value
  state.fail(failure)
  await state.ui.confirmSaveLibraryReport()
  assert.equal(state.ui.showSaveAnalysisReport.value, true, 'A failed save keeps its title dialog available for retry')
  assert.equal(state.ui.analysisReportTitle.value, 'My saved report')
  assert.equal(state.content.value, body)
  assert.deepEqual(state.library.records.value, [])
  assert.deepEqual(state.disk(), [])
  assert.equal(state.successes.length, 0)
  assert.match(state.ui.saveLibraryError.value, /Disk failure/)
  state.fail('none')
  await state.ui.confirmSaveLibraryReport()
  assert.equal(state.ui.showSaveAnalysisReport.value, false)
  assert.equal(state.library.records.value.length, 1)
  assert.equal(state.disk()[0].content, body)
  const savedId = state.disk()[0].id
  state.content.value = ''
  state.ui.saveToLibrary()
  assert.equal(state.ui.showSaveAnalysisReport.value, false)
  assert.equal(state.warnings.length, 1, 'Empty edited reports are retained but cannot be saved')
  state.content.value = 'Rewritten report after clearing'
  state.ui.saveToLibrary()
  await state.ui.confirmSaveLibraryReport()
  assert.equal(state.disk().length, 1, 'Saving the active report again updates its committed identity')
  assert.equal(state.disk()[0].id, savedId)
  assert.equal(state.disk()[0].content, 'Rewritten report after clearing')

  await state.ui.openAnalysisLibrary()
  state.cancelDelete(true)
  const writes = state.writes()
  await state.ui.deleteLibraryReport(state.library.records.value[0])
  assert.equal(state.writes(), writes)
  assert.equal(state.ui.showAnalysisLibrary.value, true)
  state.cancelDelete(false)
  state.fail(failure)
  const successesBeforeDelete = state.successes.length
  await state.ui.deleteLibraryReport(state.library.records.value[0])
  assert.equal(state.ui.showAnalysisLibrary.value, true)
  assert.equal(state.library.records.value.length, 1)
  assert.equal(state.successes.length, successesBeforeDelete)
  assert.equal(state.content.value, 'Rewritten report after clearing')
  assert.match(state.ui.libraryError.value, /Disk failure/)
  state.fail('none')
  await state.ui.deleteLibraryReport(state.library.records.value[0])
  assert.deepEqual(state.disk(), [])
  assert.equal(state.content.value, 'Rewritten report after clearing', 'Deleting the saved copy leaves the current editor draft intact')
}

const pendingSave = libraryFixture()
await pendingSave.ui.loadAnalysisLibrary()
pendingSave.ui.saveToLibrary()
let began!: () => void
let complete!: () => void
const started = new Promise<void>(resolve => { began = resolve })
pendingSave.block(() => { began(); return new Promise<void>(resolve => { complete = resolve }) })
const saving = pendingSave.ui.confirmSaveLibraryReport()
await started
await pendingSave.ui.confirmSaveLibraryReport()
assert.equal(pendingSave.writes(), 1, 'Repeated clicks during a save do not create another record')
assert.equal(pendingSave.ui.savingLibraryReport.value, true)
assert.equal(pendingSave.ui.showSaveAnalysisReport.value, true)
assert.equal(pendingSave.successes.length, 0)
complete()
await saving
assert.equal(pendingSave.ui.savingLibraryReport.value, false)
assert.equal(pendingSave.disk().length, 1)

// A new workspace can read and open the report without an uploaded book.
const reopenedContent = ref<string | null>(null)
const reopenedLibrary = createBookAnalysisLibrary({ read: pendingSave.disk, write() {} })
const reopened = useBookAnalysisLibraryWorkspace({
  library: reopenedLibrary, content: reopenedContent, sourceFileName: () => '', isBusy: () => false,
  onOpen: report => { reopenedContent.value = report.content }, confirmDelete: async () => undefined,
  notify: { success() {}, warning() {}, error(message) { throw new Error(message) } },
})
await reopened.openAnalysisLibrary()
assert.equal(reopened.showAnalysisLibrary.value, true)
reopened.openLibraryReport(reopened.libraryRecords.value[0])
assert.equal(reopenedContent.value, pendingSave.disk()[0].content)
assert.equal(reopened.showAnalysisLibrary.value, false)
assert.equal(reopened.currentLibraryReportTitle.value, pendingSave.disk()[0].title)
console.log('✓ Reference-library workflow: durable report opening, identity-preserving saves, retained failure drafts, confirmation, awaited delete and repeated-click guards')
