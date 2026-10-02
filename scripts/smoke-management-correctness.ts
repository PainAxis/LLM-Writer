import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSSRApp, ref } from 'vue'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import { getChapterWordCount, getNovelWordStats } from '../src/utils/novelStats'
import { stripWriterHtml } from '../src/utils/writerContent'
import type { WriterNovel } from '../src/types/writer'

const fixture: WriterNovel = {
  id: 1, title: '统计旧数据', wordCount: 200, totalWords: 999, chapters: 20, avgWordsPerChapter: 1,
  chapterList: [
    { id: 11, title: '甲章', content: '<p>甲&nbsp;乙</p><p>&#x1F600;&amp;</p>', wordCount: 100 },
    { id: 12, title: '乙章', content: '尾声', wordCount: 100 },
  ],
}
assert.deepEqual(getNovelWordStats(fixture), { wordCount: 6, totalWords: 6, chapters: 2, avgWordsPerChapter: 3 })
assert.equal(getChapterWordCount({ wordCount: 7 }), 7, '缺失正文时保留已知章节计数')
assert.equal(getNovelWordStats({ wordCount: 12, totalWords: 900 }).wordCount, 12, '无章节明细的旧记录优先使用wordCount')
assert.equal(getNovelWordStats({ totalWords: 17 }).wordCount, 17)
assert.equal(getNovelWordStats({ chapterList: [], wordCount: 12, totalWords: 900 }).wordCount, 0, '已清空章节不能回落到旧总字数')

// Execute the actual list loader and both export actions against synthetic storage.
const text = readFileSync(new URL('../src/composables/useNovelManagementWorkspace.ts', import.meta.url), 'utf8')
const source = ts.createSourceFile('workspace.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const factory = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'useNovelManagementWorkspace') as ts.FunctionDeclaration
const names = ['loadNovels', 'exportNovel', 'exportAllNovels']
const declarations = factory.body!.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations])
  .filter(declaration => ts.isIdentifier(declaration.name) && names.includes(declaration.name.text))
assert.equal(declarations.length, names.length)
const novels = ref<WriterNovel[]>([])
const filteredNovels = ref<WriterNovel[]>([])
const downloads: Blob[] = []
const warnings: string[] = []
const dependencies = {
  novels, filteredNovels, getChapterWordCount, getNovelWordStats, stripWriterHtml,
  statusFilter: ref('all'), genreFilter: ref('all'), genrePresets: ref({}),
  toDate: (value?: string | number | Date) => new Date(value ?? 0),
  storageGet: () => [fixture, { id: 2, title: '仅有历史汇总', wordCount: 12, chapters: 3 }],
  StorageKeys: { novels: 'novels' }, Blob,
  URL: { createObjectURL: (blob: Blob) => { downloads.push(blob); return 'blob:synthetic' }, revokeObjectURL() {} },
  document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
  getGenreDisplayName: () => '', getStatusText: () => '', formatDate: () => '', formatNumber: (value: number) => String(value),
  ElMessage: { success() {}, warning: (message: string) => warnings.push(message), error: (message: string) => { throw new Error(message) } },
  console,
}
const code = ts.transpileModule(declarations.map(declaration => `const ${declaration.getText(source)}`).join('\n') + `\nreturn { ${names.join(', ')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText
const actions = new Function(...Object.keys(dependencies), code)(...Object.values(dependencies))
actions.loadNovels()
assert.equal(novels.value[0].wordCount, 6)
assert.equal(novels.value[0].totalWords, 6)
assert.deepEqual(novels.value[0].chapterList!.map(chapter => chapter.wordCount), [4, 2])
assert.equal(novels.value[1].chapterList, undefined, '展示默认值不能把无章节明细误变为已清空')
for (const novel of [fixture, ...novels.value]) actions.exportNovel(novel)
filteredNovels.value = novels.value
actions.exportAllNovels()
const [direct, displayed, legacy, combined] = await Promise.all(downloads.map(blob => blob.text()))
for (const output of [direct, displayed, combined]) {
  assert.match(output, /字数：6字/)
  assert.match(output, /总字数：6字/)
  assert.match(output, /平均章节字数：3字/)
  assert.match(output, /章节：2章/)
  assert.ok(!output.includes('999字'))
}
assert.match(direct, /甲[ \u00a0]乙\n\n😀&/)
assert.match(direct, /字数：4字/)
assert.match(legacy, /总字数：12字/)
assert.match(combined, /总字数：12字/)
assert.deepEqual(warnings, [])
assert.equal(fixture.totalWords, 999, '显示与导出计算不偷偷改写存储来源')

// Render the actual preview template: decoded markup stays text, with separate paragraphs.
const view = readFileSync(new URL('../src/views/ChapterManagement.vue', import.meta.url), 'utf8')
const previewTemplate = view.match(/<div class="preview-content">[\s\S]*?<\/div>/)![0]
const preview = await renderToString(createSSRApp({
  template: previewTemplate,
  data: () => ({ previewChapter: { content: '<p>甲&nbsp;乙</p><p>&lt;script&gt;仅文字&lt;/script&gt;</p>' } }),
  methods: { stripWriterHtml },
}))
assert.equal((preview.match(/<p>/g) ?? []).length, 2)
assert.match(preview, /甲[ \u00a0]乙/)
assert.ok(preview.includes('&lt;script&gt;仅文字&lt;/script&gt;'))
assert.ok(!preview.includes('<script>'))
console.log('Management totals, legacy exports and safe paragraph previews smoke passed')
