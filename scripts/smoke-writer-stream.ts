/** Actual Writer handlers + project state + request scopes; no API key required. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, ref, watch } from 'vue'
import ts from 'typescript'
import { createAIRequestScope, isAIRequestCancelled } from '../src/utils/aiRequestScope'
import { useWriterProject, type WriterNovel } from '../src/composables/useWriterProject'
import type { StreamCallback } from '../src/types/api'

const script = readFileSync(new URL('../src/views/Writer.vue', import.meta.url), 'utf8')
  .match(/<script\b[^>]*>([\s\S]*?)<\/script>/)![1]
const source = ts.createSourceFile('Writer.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const names = new Set([
  'generateContent', 'generateSingleChapter', 'openAISingleChapterDialog', 'selectChapter',
  'stopStreaming', 'stopWriterStreams', 'resetWriterGenerationFlags', 'cancelWriterStream',
  'beginWriterOperation', 'cancelWriterDialog', 'resetContinueDialog', 'resetOptimizeDialog',
])
const declarations: string[] = []
const subscriptions: string[] = []
for (const statement of source.statements) {
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && names.has(declaration.name.text)) {
        declarations.push(`const ${declaration.getText(source)}`)
      }
    }
  } else if (ts.isForOfStatement(statement) && statement.getText(source).includes('cancelWriterDialog(owner)')) {
    subscriptions.push(statement.getText(source))
  } else if (ts.isExpressionStatement(statement) && statement.getText(source).startsWith('watch(() => currentChapter.value?.id')) {
    subscriptions.push(statement.getText(source))
  }
}
assert.equal(declarations.length, names.size)
assert.equal(subscriptions.length, 2, 'Both dialog ownership and chapter changes must cancel stale requests')
const executable = ts.transpileModule(`let writerOperation = 0; let writerDialogOwner = '';
${declarations.join('\n')}
${subscriptions.join('\n')}
return {${[...names].join(',')}}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

function streamFixture() {
  const pending: Array<{ signal: AbortSignal; callback: StreamCallback | null; resolve: (text: string) => void }> = []
  const isStreaming = ref(false)
  const streamingContent = ref('')
  const scope = createAIRequestScope((_prompt, options, callback) => {
    const result = deferred<string>()
    pending.push({ signal: options.signal!, callback, resolve: result.resolve })
    return result.promise
  }, state => {
    isStreaming.value = state.isStreaming
    streamingContent.value = state.streamingContent
  })
  return { ...scope, pending, isStreaming, streamingContent }
}

async function fixture() {
  const vueScope = effectScope()
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  let disk: WriterNovel[] = [{ id: 1, title: '小说', chapterList: [
    { id: 1, title: 'A', content: '<p>A原文</p>', status: 'draft' },
    { id: 2, title: 'B', content: '<p>B原文</p>', status: 'draft' },
  ] }]
  let saveGate: ReturnType<typeof deferred> | undefined
  const saving = deferred()
  const project = useWriterProject({
    novelStore: { worldSettings: [], addWorldSetting: () => {}, updateWorldSetting: () => {}, removeWorldSetting: () => {} },
    notifyError: () => {},
    persistence: {
      load: () => clone(disk),
      save: async novels => {
        if (saveGate) { saving.resolve(); await saveGate.promise }
        disk = clone(novels)
      },
    },
  })
  await project.initNovel('1')
  const { selectChapter: selectProjectChapter, ...projectState } = project
  const writerStream = streamFixture()
  const continueStream = streamFixture()
  const optimizeStream = streamFixture()
  const messages: string[] = []
  const flags = Object.fromEntries([
    'isGeneratingContent', 'isGeneratingChapters', 'isOptimizing', 'isGeneratingOutline',
    'batchGenerating', 'worldGenerating', 'isGeneratingWorldSetting',
  ].map(name => [name, ref(false)]))
  const dialogs = Object.fromEntries([
    'showNewContinueDialog', 'showNewOptimizeDialog', 'showAIOptimizeDialog', 'showOptimizePromptDialog',
    'showChapterGenerateDialog', 'showPromptDialog', 'showAISingleChapterDialog', 'showAIBatchChapterDialog',
    'showBatchGenerateCharacterDialog', 'showWorldGenerateDialog', 'showWorldDialog', 'showCharacterDialog', 'showChapterDialog',
  ].map(name => [name, ref(false)]))
  const dependencies = {
    ...projectState, ...flags, ...dialogs, writerStream, continueStream, optimizeStream,
    selectProjectChapter,
    streamingContent: writerStream.streamingContent, isStreaming: writerStream.isStreaming,
    continueStreamingContent: continueStream.streamingContent, optimizeStreamingContent: optimizeStream.streamingContent,
    streamingType: ref(''), streamingChapter: ref<any>(null), targetChapter: ref<any>({ id: 1 }),
    continueForm: ref({ direction: '', wordCount: 500 }),
    optimizeForm: ref({ optimizedContent: '', customPrompt: '', selectedPrompt: null }),
    aiOptimizeForm: ref({ optimizedContent: '旧润色' }),
    aiSingleChapterForm: ref({ title: '新章节', plotRequirement: '', template: 'general' }),
    singleChapterSelectedPrompt: ref(null), singleChapterFinalPrompt: ref(''),
    generatedCharacters: ref([]), generatedWorldSettings: ref([]), batchGenerateResults: ref([]),
    checkApiAndBalance: () => true, buildGenerationContext: () => ({}),
    buildContentPrompt: () => '生成正文', formatGeneratedContent: (text: string, title: string) => `<p>${title}:${text}</p>`,
    getTemplateDescription: () => '默认模板', getChineseGenre: () => '通用小说', isAIRequestCancelled, watch,
    ElMessage: { success: (message: string) => messages.push(message), warning: () => {}, error: (message: string) => messages.push(`ERROR:${message}`) },
  }
  const methods = vueScope.run(() => new Function(...Object.keys(dependencies), executable)(...Object.values(dependencies)))
  return {
    ...dependencies, methods, messages, disk: () => disk,
    delaySave: () => { saveGate = deferred(); return saving.promise },
    releaseSave: () => { saveGate?.resolve(); saveGate = undefined },
    close: () => vueScope.stop(),
  }
}

async function main() {
  const switcher = await fixture()
  switcher.showNewContinueDialog.value = true
  switcher.showNewOptimizeDialog.value = true
  const old = switcher.methods.generateContent()
  switcher.writerStream.pending[0].callback?.('A部分', 'A部分')
  const continuation = switcher.continueStream.generate('续写').catch(isAIRequestCancelled)
  const optimization = switcher.optimizeStream.generate('润色').catch(isAIRequestCancelled)
  await switcher.methods.selectChapter(switcher.chapters.value[1])
  assert.equal(switcher.currentChapter.value?.id, 2)
  assert.equal(switcher.content.value, '<p>B原文</p>')
  assert.equal(switcher.targetChapter.value, null)
  assert.equal(switcher.showNewContinueDialog.value, false)
  assert.equal(switcher.showNewOptimizeDialog.value, false)
  for (const scope of [switcher.writerStream, switcher.continueStream, switcher.optimizeStream]) {
    assert.equal(scope.pending[0].signal.aborted, true)
    scope.pending[0].callback?.('迟到', 'A残缺迟到')
    scope.pending[0].resolve('A残缺迟到')
  }
  await Promise.all([old, continuation, optimization])
  assert.equal(switcher.content.value, '<p>B原文</p>')
  assert.equal(switcher.disk()[0].chapterList![1].content, '<p>B原文</p>')
  assert.deepEqual(switcher.messages, [])
  switcher.close()
  console.log('✓ 切章同步取消3作用域，迟到正文不会写入新章节、旧对话框结果不可应用')

  const dialog = await fixture()
  dialog.showAISingleChapterDialog.value = true
  const chapter = dialog.methods.generateSingleChapter()
  const other = dialog.continueStream.generate('独立续写')
  dialog.showAISingleChapterDialog.value = false
  assert.equal(dialog.writerStream.pending[0].signal.aborted, true)
  assert.equal(dialog.continueStream.pending[0].signal.aborted, false)
  dialog.writerStream.pending[0].resolve('大纲：关闭后迟到')
  await chapter
  assert.equal(dialog.chapters.value.length, 2)
  assert.equal(dialog.isGeneratingChapters.value, false)
  assert.deepEqual(dialog.messages, [])
  dialog.continueStream.pending[0].resolve('续写仍成功')
  assert.equal(await other, '续写仍成功')
  dialog.close()
  console.log('✓ 关闭生成对话框取消所属请求，不创建迟到章节，也不误杀独立续写')

  const reopening = await fixture()
  reopening.showAISingleChapterDialog.value = true
  const first = reopening.methods.generateSingleChapter()
  reopening.methods.openAISingleChapterDialog()
  assert.equal(reopening.writerStream.pending[0].signal.aborted, true)
  reopening.writerStream.pending[0].resolve('大纲：旧请求')
  await first
  assert.equal(reopening.chapters.value.length, 2)
  reopening.methods.beginWriterOperation(reopening.batchGenerating, 'characters')
  const current = reopening.methods.generateContent()
  assert.equal(reopening.batchGenerating.value, false)
  assert.equal(reopening.isGeneratingContent.value, true)
  reopening.methods.stopStreaming()
  reopening.writerStream.pending[1].resolve('已取消正文')
  await current
  assert.equal(reopening.isGeneratingContent.value, false)
  reopening.close()
  console.log('✓ 重开对话框先取消旧请求，通用请求抢占/停止清除所有业务加载标记')

  const pendingSave = await fixture()
  const saveStarted = pendingSave.delaySave()
  const completing = pendingSave.methods.generateContent()
  pendingSave.writerStream.pending[0].resolve('完整正文')
  await saveStarted
  pendingSave.methods.stopStreaming()
  pendingSave.releaseSave()
  await completing
  assert.deepEqual(pendingSave.messages, [], '保存等待期间已停止，返回后不能弹旧成功提示')
  pendingSave.close()
  console.log('✓ 网络完成后保存仍在等待时，停止操作抑制晚成功提示')

  const deleted = await fixture()
  const deletedRequest = deleted.methods.generateContent()
  deleted.currentChapter.value = null
  assert.equal(deleted.writerStream.pending[0].signal.aborted, true)
  deleted.content.value = ''
  deleted.writerStream.pending[0].callback?.('迟到', '已删除章节的文本')
  deleted.writerStream.pending[0].resolve('已删除章节的文本')
  await deletedRequest
  assert.equal(deleted.content.value, '')
  assert.deepEqual(deleted.messages, [])
  deleted.close()
  console.log('✓ 删除当前章节等直接引用变更也会同步取消流式写入')
  console.log('\n=== WRITER STREAM TESTS PASSED ===')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
