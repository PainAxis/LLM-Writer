import assert from 'node:assert/strict'
import { createSSRApp, ref } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { useBookAnalysisFile } from '../src/composables/useBookAnalysisFile'
import { detectBookChapters, readBookChapter, prepareBookAnalysisSelection, prepareBookAnalysis, buildBookAnalysisPrompt } from '../src/utils/bookAnalysisContext'
import { splitBookLocally, type ImportedBook } from '../src/utils/bookImport'
import { createBookAnalysisLibrary } from '../src/services/bookAnalysisLibrary'
import { useBookAnalysisLibraryWorkspace } from '../src/composables/useBookAnalysisLibraryWorkspace'
import type { BookAnalysisLibraryRecord } from '../src/types/bookAnalysis'
import { useBookChapterViewer } from '../src/composables/useBookChapterViewer'

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
assert.throws(() => prepareBookAnalysis({ ...input, selectedChapters: [] }), /请至少选择一个章节/)
const ranged = prepareBookAnalysis({ ...input, chapters: [], selectedChapters: [], start: 2, end: 5 })
assert.equal(ranged.textToAnalyze, content.slice(1, 5), 'Word ranges retain one-based inclusive UI boundaries')
assert.throws(() => prepareBookAnalysis({ ...input, templateId: 'missing' }), /未找到分析模板/)
const prompt = buildBookAnalysisPrompt(selected)
for (const value of ['sample.txt', 'UTF-8', '第二章 黎明', '失物找到了。', '解释转折', '结构分析']) assert.ok(prompt.includes(value), value)
console.log('✓ Detected and local chapters share consistent boundaries for preview, analysis and export; prompt context remains complete')

{
  const book = '第一章 开始\n' + '甲'.repeat(6000) + '\n第二章 结局\n最终凶手是乙。'
  const detected = detectBookChapters(book)
  const source = { ...input, content: book, chapters: detected, selectedChapters: [], start: 1, end: 5000 }
  assert.throws(() => prepareBookAnalysisSelection(source), /请至少选择一个章节/, 'The UI scope preview must not silently fall back to the hidden 5000-character range')
  assert.throws(() => prepareBookAnalysis(source), /请至少选择一个章节/, 'Direct submission enforces the same chapter requirement')
  assert.throws(() => prepareBookAnalysis({ ...source, selectedChapters: [999] }), /章节选择已失效/)
  const ending = prepareBookAnalysis({ ...source, selectedChapters: [1] })
  assert.equal(ending.textToAnalyze, '第二章 结局\n最终凶手是乙。\n\n')
  assert.ok(buildBookAnalysisPrompt(ending).includes('最终凶手是乙。'))
  assert.equal(buildBookAnalysisPrompt(ending).includes('甲甲甲'), false, 'Only the explicitly selected chapter is sent')
  assert.deepEqual(prepareBookAnalysisSelection({ ...source, selectedChapters: [1] }), {
    textToAnalyze: ending.textToAnalyze, analysisInfo: ending.analysisInfo, chapterInfos: ending.chapterInfos,
  }, 'Scope preview and generated prompt use exactly the same selection')
  assert.throws(() => prepareBookAnalysis({ ...source, selectedChapters: [] }), /请至少选择一个章节/, 'Clearing a selection disables submission again')

  const unsplit = '没有章节标题的正文。'.repeat(900)
  const rangeSource = { ...source, content: unsplit, chapters: [], start: 5001, end: 6000 }
  assert.equal(prepareBookAnalysis(rangeSource).textToAnalyze, unsplit.slice(5000, 6000))
  assert.throws(() => prepareBookAnalysis({ ...rangeSource, start: 6001 }), /有效的分析字数范围/)
  const manuallySplit = splitBookLocally(unsplit)
  assert.throws(() => prepareBookAnalysis({ ...rangeSource, chapters: manuallySplit }), /请至少选择一个章节/)
  const localChapter = prepareBookAnalysis({ ...rangeSource, chapters: manuallySplit, selectedChapters: [1] })
  assert.equal(localChapter.textToAnalyze, readBookChapter(unsplit, manuallySplit, manuallySplit[1]!) + '\n\n')
}
console.log('✓ Chaptered books require an explicit valid selection; unchaptered word ranges and local split boundaries remain intact')

{
  const headings = ['第一章 雨夜', '第2节：回声', '第零章序', '  Chapter 3: Dawn  ', 'CHAPTER4', 'Chapter5 - Ending']
  const prose = ['他说：“第十章的线索还没解开。”', 'They discussed Chapter 99 without opening it.', 'Chapter2nd is not a heading.']
  for (const newline of ['\n', '\r\n']) {
    const text = ['前言', ...headings.flatMap(title => [title, ...prose])].join(newline)
    const detected = detectBookChapters(text)
    assert.deepEqual(detected.map(chapter => chapter.title), headings.map(title => title.trim()))
    assert.ok(detected.every(chapter => chapter.wordCount === prose.reduce((sum, line) => sum + line.length, 0)))
    for (const [index, chapter] of detected.entries()) {
      const expected = [headings[index]!, ...prose].join('\n')
      assert.equal(readBookChapter(text, detected, chapter), expected)
      assert.equal(prepareBookAnalysis({ ...input, content: text, chapters: detected, selectedChapters: [index] }).textToAnalyze, expected + '\n\n')
    }
  }

  const text = '第一章 归来\r\n他说：“第十章的线索还没解开。”\r\n她没有回答。\r\n第二章 雨夜\r\n门外有人。'
  const detected = detectBookChapters(text)
  assert.equal(detected.length, 2)
  const viewer = useBookChapterViewer({ bookContent: ref(text), detectedChapters: ref(detected), autoDetectedChapters: ref([]) })
  viewer.openChapterViewer()
  const viewed = viewer.currentChapterContent.value
  assert.equal(viewed, '第一章 归来\n他说：“第十章的线索还没解开。”\n她没有回答。')
  assert.equal(prepareBookAnalysis({ ...input, content: text, chapters: detected, selectedChapters: [0] }).textToAnalyze, viewed + '\n\n')

  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  let exported: Blob | undefined
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ click() {} }) } })
    URL.createObjectURL = blob => { exported = blob; return 'blob:chapter-test' }
    URL.revokeObjectURL = () => {}
    viewer.exportChapterContent()
    assert.equal(await exported?.text(), `${detected[0]!.title}\n\n${viewed}`, 'Export contains precisely the same chapter boundary as viewer and AI input')
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else Reflect.deleteProperty(globalThis, 'document')
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
}
console.log('✓ Whole-line Chinese and English headings reject inline references, with identical LF/CRLF preview, AI and export boundaries')

{
  // Instantiate the real page setup without mounting DOM or running onMounted
  // persistence. All service initialization uses an isolated in-memory store.
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const memory = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
  } })
  try {
    const { useBookAnalysisWorkspace } = await import('../src/composables/useBookAnalysisWorkspace')
    const { default: api } = await import('../src/services/api')
    const { promptCatalog } = await import('../src/services/promptCatalog')
    const { ElMessage } = await import('element-plus')
    const originalGenerate = api.generateTextStream
    const originalPrompts = promptCatalog.prompts.value
    const originalMessages = { success: ElMessage.success, warning: ElMessage.warning, error: ElMessage.error }
    for (const kind of ['success', 'warning', 'error'] as const) ElMessage[kind] = () => ({ close() {} })
    const prompts: string[] = []
    api.generateTextStream = async prompt => { prompts.push(prompt); return '合成分析结果' }
    promptCatalog.prompts.value = [{ id: 12, title: '结构', category: 'book-analysis', description: '', content: '分析结局', tags: [], isDefault: false }]
    let page: ReturnType<typeof useBookAnalysisWorkspace> | undefined
    try {
      await renderToString(createSSRApp({ setup() { page = useBookAnalysisWorkspace(); return () => null } }))
      assert.ok(page)
      const text = '第一章 开始\n' + '甲'.repeat(6000) + '\n第二章 结局\n最终凶手是乙。'
      const bytes = new TextEncoder().encode(text)
      await page.handleFileChange({ name: 'long-book.txt', raw: { name: 'long-book.txt', arrayBuffer: async () => bytes.buffer } })
      page.selectedTemplate.value = 12
      page.analysisResult.value = '保留此前的编辑结果'
      assert.match(page.analysisScopeError.value, /请至少选择一个章节/)
      await page.startAnalysis()
      assert.equal(prompts.length, 0, 'The real handler rejects an empty chapter selection before calling AI')
      assert.equal(page.analysisResult.value, '保留此前的编辑结果')
      page.selectedChapters.value = [1]
      assert.equal(page.analysisScopeError.value, '')
      assert.match(page.analysisScopeDescription.value, /所选的 1 个章节/)
      await page.startAnalysis()
      assert.equal(prompts.length, 1)
      assert.ok(prompts[0]!.includes('最终凶手是乙。'))
      assert.equal(prompts[0]!.includes('甲甲甲'), false)
      const previousReport = page.analysisResult.value
      page.clearChapterSelection()
      await page.startAnalysis()
      assert.equal(prompts.length, 1)
      assert.equal(page.analysisResult.value, previousReport)
      page.removeFile()
    } finally {
      api.generateTextStream = originalGenerate
      promptCatalog.prompts.value = originalPrompts
      Object.assign(ElMessage, originalMessages)
    }
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
}
console.log('✓ The real import/start/clear workflow never calls AI or overwrites prior results without an explicit chapter selection')

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
