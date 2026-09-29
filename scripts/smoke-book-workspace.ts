import assert from 'node:assert/strict'
import { useBookAnalysisFile } from '../src/composables/useBookAnalysisFile'
import { detectBookChapters, readBookChapter, prepareBookAnalysis, buildBookAnalysisPrompt } from '../src/utils/bookAnalysisContext'
import { splitBookLocally, type ImportedBook } from '../src/utils/bookImport'

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
