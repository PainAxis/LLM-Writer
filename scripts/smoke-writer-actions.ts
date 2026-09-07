/** Exercise actual Writer action handlers against the project composable. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reactive, ref } from 'vue'
import ts from 'typescript'
import { useWriterProject, type WriterNovel } from '../src/composables/useWriterProject'

const script = readFileSync(new URL('../src/views/Writer.vue', import.meta.url), 'utf8')
  .match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1]
assert.ok(script)
const source = ts.createSourceFile('Writer.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const actionNames = new Set([
  'saveChapter', 'saveCharacter', 'saveEvent', 'saveWorldSetting', 'saveCorpus',
  'deleteChapter', 'deleteCharacter', 'deleteEvent', 'deleteWorldSetting', 'deleteCorpus',
  'confirmAddGeneratedCharacters', 'confirmAddGeneratedWorldSettings',
  '_generateChapterContent', 'replaceSelectedContent',
])
const declarations: string[] = []
for (const statement of source.statements) {
  if (!ts.isVariableStatement(statement)) continue
  for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name) && actionNames.has(declaration.name.text)) {
      declarations.push(`const ${declaration.getText(source)}`)
    }
  }
}
assert.equal(declarations.length, actionNames.size)
const executable = ts.transpileModule(`${declarations.join('\n')}\nreturn {${[...actionNames].join(',')}}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

async function fixture() {
  let disk: WriterNovel[] = [{ id: 1, title: '测试小说', chapterList: [{
    id: 100, title: '第一章', content: '<p>原始正文</p>', status: 'draft', wordCount: 4,
  }] }]
  let failSave = false
  let pendingSave: (() => void) | undefined
  let delaySave = false
  const messages: string[] = []
  const novelStore = reactive({
    worldSettings: [] as any[],
    addWorldSetting(setting: any) { this.worldSettings.push({ ...setting }) },
    updateWorldSetting(id: number, setting: any) {
      const index = this.worldSettings.findIndex(item => item.id === id)
      this.worldSettings[index] = { ...setting }
    },
    removeWorldSetting(id: number) { this.worldSettings = this.worldSettings.filter(item => item.id !== id) },
  })
  const project = useWriterProject({
    novelStore,
    notifyError: () => {},
    persistence: {
      load: () => clone(disk),
      save: async novels => {
        if (failSave) throw new Error('模拟保存失败')
        if (delaySave) await new Promise<void>(resolve => { pendingSave = resolve })
        disk = clone(novels)
      },
    },
  })
  await project.initNovel('1')
  const dependencies = {
    ...project, novelStore,
    ElMessage: { success: (message: string) => messages.push(message), warning: () => {}, error: () => {} },
    ElMessageBox: { confirm: () => Promise.resolve() },
    editingChapter: ref<any>(null), chapterForm: ref<any>({ title: '新章节', description: '', status: 'draft' }),
    characterForm: ref<any>({ id: null, name: '测试人物', tags: [] }),
    eventForm: ref<any>({ id: null, title: '测试事件' }),
    worldForm: ref<any>({ title: '测试世界', description: '' }),
    corpusForm: ref<any>({ id: null, title: '测试语料', content: '内容' }),
    showChapterDialog: ref(true), showCharacterDialog: ref(true), showEventDialog: ref(true),
    showWorldDialog: ref(true), showCorpusDialog: ref(true),
    generatedCharacters: ref([{ id: 501, name: '生成人物' }]),
    generatedWorldSettings: ref([{ id: 601, title: '生成世界', description: '' }]),
    showBatchGenerateCharacterDialog: ref(true), showWorldGenerateDialog: ref(true),
    showNewOptimizeDialog: ref(true), optimizeForm: ref({ mode: 'selection', optimizedContent: '优化片段' }),
    editorRef: ref({
      getSelectionText: () => '选中的内容', insertText: () => {}, getHtml: () => '<p>优化后的编辑器正文</p>',
    }),
    generateContent: async () => { messages.push(`generate:${project.currentChapter.value?.id}`) },
  }
  const methods = new Function(...Object.keys(dependencies), executable)(...Object.values(dependencies)) as Record<string, (...args: any[]) => Promise<void>>
  return {
    ...dependencies, methods, messages,
    disk: () => disk,
    fail: (value: boolean) => { failSave = value },
    delay: (value: boolean) => { delaySave = value },
    release: () => { assert.ok(pendingSave); pendingSave(); pendingSave = undefined },
  }
}

async function main() {
  for (const [action, list, dialog] of [
    ['saveChapter', 'chapters', 'showChapterDialog'],
    ['saveCharacter', 'characters', 'showCharacterDialog'],
    ['saveEvent', 'events', 'showEventDialog'],
    ['saveWorldSetting', 'worldSettings', 'showWorldDialog'],
    ['saveCorpus', 'corpusData', 'showCorpusDialog'],
    ['confirmAddGeneratedCharacters', 'characters', 'showBatchGenerateCharacterDialog'],
    ['confirmAddGeneratedWorldSettings', 'worldSettings', 'showWorldGenerateDialog'],
  ] as const) {
    const f = await fixture()
    const before = f[list].value.length
    f.fail(true)
    await f.methods[action]()
    assert.deepEqual(f.messages, [], `${action}: 失败不能提示成功`)
    assert.equal(f[dialog].value, true, `${action}: 失败保留编辑对话框`)
    assert.equal(f[list].value.length, before + 1, `${action}: 草稿仍在内存中`)
    f.fail(false)
    await f.methods[action]()
    assert.equal(f[list].value.length, before + 1, `${action}: 重试不能重复创建`)
    assert.equal(f[dialog].value, false)
    assert.equal(f.messages.length, 1)
  }
  console.log('✓ 动作测试1：五类创建与生成素材导入失败不报成功/不关对话框，重试不重复')

  for (const [create, remove, list] of [
    ['saveChapter', 'deleteChapter', 'chapters'],
    ['saveCharacter', 'deleteCharacter', 'characters'],
    ['saveEvent', 'deleteEvent', 'events'],
    ['saveWorldSetting', 'deleteWorldSetting', 'worldSettings'],
    ['saveCorpus', 'deleteCorpus', 'corpusData'],
  ] as const) {
    const f = await fixture()
    await f.methods[create]()
    const item = f[list].value.at(-1)!
    const before = f[list].value.length
    f.messages.length = 0
    f.fail(true)
    await f.methods[remove](item)
    assert.equal(f[list].value.length, before, `${remove}: 失败恢复可见条目`)
    assert.deepEqual(f.messages, [])
    f.fail(false)
    await f.methods[remove](item)
    assert.equal(f[list].value.length, before - 1)
    assert.equal(f.messages.length, 1)
    const storedKey = list === 'chapters' ? 'chapterList' : list
    assert.equal((f.disk()[0][storedKey] as unknown[]).length, before - 1, `${remove}: 删除必须落盘`)
  }
  console.log('✓ 动作测试2：五类删除失败恢复条目、不报成功，重试落盘（含语料删除）')

  const generation = await fixture()
  const nextChapter = { id: 101, title: '第二章', content: '下一章正文' }
  generation.chapters.value.push(nextChapter)
  generation.delay(true)
  const generating = generation.methods._generateChapterContent(nextChapter)
  assert.deepEqual(generation.messages, [], '切章提交前不能开始生成')
  assert.equal(generation.currentChapter.value?.id, 100)
  generation.release()
  await generating
  assert.deepEqual(generation.messages, ['generate:101'])
  generation.fail(true)
  generation.messages.length = 0
  await generation.methods._generateChapterContent({ id: 102, title: '第三章' })
  assert.deepEqual(generation.messages, [], '保存失败不能开始生成')
  console.log('✓ 动作测试3：异步章节选择完成后才开始生成，失败时停止')

  const replacing = await fixture()
  replacing.fail(true)
  await replacing.methods.replaceSelectedContent()
  assert.equal(replacing.content.value, '<p>优化后的编辑器正文</p>', '直接捕获编辑器最新HTML')
  assert.deepEqual(replacing.messages, [])
  assert.equal(replacing.showNewOptimizeDialog.value, true)
  replacing.fail(false)
  await replacing.methods.replaceSelectedContent()
  assert.equal(replacing.disk()[0].chapterList![0].content, '<p>优化后的编辑器正文</p>')
  assert.equal(replacing.showNewOptimizeDialog.value, false)
  assert.equal(replacing.messages.length, 1)
  console.log('✓ 动作测试4：局部替换等待最新HTML保存成功后才关闭对话框并提示')
  console.log('\n=== ALL WRITER-ACTIONS TESTS PASSED ===')
}
main().catch(error => { console.error(error); process.exit(1) })
