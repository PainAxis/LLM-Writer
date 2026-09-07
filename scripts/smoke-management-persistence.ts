/** 执行实际页面处理函数，验证小说/章节管理等待持久化、保留失败输入及安全重试。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import ts from 'typescript'
import { registerChunkedKey, StorageKeys, storageGet, storageSet } from '../src/utils/storage'
import { initNovelPersistence, retryNovelPersistence, subscribeNovelPersistenceStatus } from '../src/services/novelPersistence'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const fixture = () => [{
  id: 1, title: '小说甲', genre: 'fantasy', createdAt: '2026-09-01', updatedAt: '2026-09-01', tags: [],
  chapterList: [
    { id: 11, title: '第一章', content: '甲', wordCount: 1, tags: [] },
    { id: 12, title: '第二章', content: '乙', wordCount: 1, tags: [] },
  ],
}, { id: 2, title: '小说乙', chapterList: [{ id: 21, title: '独立章节', content: '不变' }] }]
let cached: any[] = []
let disk: any[] = []
let settle: ((error?: Error) => void) | undefined
let writes = 0
registerChunkedKey(StorageKeys.novels, {
  isReady: () => true,
  get: () => cached,
  async set(value) {
    writes++
    cached = clone(value as any[])
    await new Promise<void>((resolve, reject) => { settle = error => error ? reject(error) : resolve() })
    disk = clone(value as any[])
  },
  remove() { cached = []; disk = [] },
})

function functionsFromFile(file: string, names: string[], dependencies: Record<string, unknown>) {
  const text = readFileSync(new URL(`../src/views/${file}`, import.meta.url), 'utf8')
  const script = text.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)![1]
  const source = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declarations: string[] = []
  for (const statement of source.statements) if (ts.isVariableStatement(statement)) {
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && names.includes(decl.name.text)) declarations.push(`const ${decl.getText(source)}`)
    }
  }
  assert.equal(declarations.length, names.length, `${file} 应包含全部被测真实函数`)
  const executable = ts.transpileModule(`${declarations.join('\n')}\nreturn { ${names.join(', ')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  return new Function(...Object.keys(dependencies), executable)(...Object.values(dependencies))
}

function setup(kind: 'novels' | 'chapters') {
  cached = fixture()
  disk = clone(cached)
  writes = 0
  settle = undefined
  const success: string[] = []
  const errors: string[] = []
  let cancel = false
  const shared: Record<string, any> = {
    ref, StorageKeys, storageGet, storageSet,
    novels: ref(clone(cached)),
    ElMessage: { success: (s: string) => success.push(s), error: (s: string) => errors.push(s) },
    ElMessageBox: { confirm: async () => { if (cancel) throw 'cancel' } },
    router: { push: () => {} }, setTimeout: (fn: () => void) => fn(),
    console: { error: () => {} },
    showCreateDialog: ref(true), tagInput: ref(''),
  }
  if (kind === 'novels') Object.assign(shared, {
    isSavingNovels: ref(false), createDraft: ref(null), isSavingEdit: ref(false), showEditDialog: ref(true),
    selectedNovel: ref(cached[0]), editingNovel: ref(cached[0]),
    createForm: ref({ title: '新小说', genre: 'fantasy', description: '保留简介', tags: [] }),
    editForm: ref({ title: '修改标题', genre: 'fantasy', tags: [] }),
    createFormRef: ref({ validate: async () => true }), editFormRef: ref({ validate: async () => true, clearValidate() {} }),
    editTagInput: ref(''), genrePresets: ref({ fantasy: { prompt: '题材提示' } }),
    updateGenreUsageCount: () => {},
  })
  else Object.assign(shared, {
    selectedNovelId: ref(1), chapterDraft: ref(null), chapters: ref(clone(cached[0].chapterList)), isSavingChapters: ref(false),
    chapterForm: ref({ title: '新章节', content: '保留章节正文', status: 'draft', tags: [] }),
    chapterFormRef: ref({ validate: async () => true }), editingChapter: ref(null),
  })
  const names = kind === 'novels'
    ? ['loadNovels', 'handlePersistenceStatus', 'saveNovels', 'duplicateNovel', 'deleteNovel', 'createNovel', 'updateNovelInfo', 'resetCreateForm', 'resetEditForm']
    : ['loadNovels', 'loadChapters', 'handlePersistenceStatus', 'saveChaptersToNovel', 'duplicateChapter', 'moveChapter', 'deleteChapter', 'saveChapter', 'resetForm']
  const methods = functionsFromFile(kind === 'novels' ? 'NovelManagement.vue' : 'ChapterManagement.vue', names, shared)
  return { ...shared, ...methods, success, errors, cancelConfirm: () => { cancel = true } }
}

async function verifyFailureThenRetry(kind: 'novels' | 'chapters', label: string, invoke: (state: any) => Promise<void>, prepare?: (state: any) => void) {
  const state = setup(kind)
  prepare?.(state)
  const initial = clone(disk)
  const list = kind === 'novels' ? state.novels : state.chapters
  const visible = clone(list.value)
  const form = kind === 'novels' ? state.createForm : state.chapterForm
  const input = clone(form.value)
  const editInput = clone(kind === 'novels' ? state.editForm.value : state.chapterForm.value)
  const pending = invoke(state)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(settle, `${label} 应提交异步写入`)
  assert.deepEqual(state.success, [], `${label} 落盘前不能报成功`)
  assert.deepEqual(disk, initial)
  assert.deepEqual(clone(list.value), visible, `${label} 落盘前不提交可见列表`)
  settle(new Error('simulated IndexedDB rejection'))
  await pending
  assert.equal(state.errors.length, 1, `${label} 应提示失败`)
  assert.deepEqual(state.success, [])
  assert.deepEqual(clone(list.value), visible, `${label} 失败应保留可重试列表`)
  assert.deepEqual(clone(form.value), input, `${label} 失败保留创建输入`)
  assert.deepEqual(clone(kind === 'novels' ? state.editForm.value : state.chapterForm.value), editInput)
  assert.equal(state.showCreateDialog.value, true)
  const retry = invoke(state)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(state.success, [], `${label} 重试同样等待落盘`)
  settle!()
  await retry
  assert.equal(state.success.length, 1, `${label} 重试成功只提示一次`)
  assert.equal(writes, 2)
  assert.deepEqual(disk.find(novel => novel.id === 2), initial[1], '不能污染另一本小说')
  console.log(`✓ ${label}：失败保留输入，重试成功，无提前成功提示`)
  return { state, initial }
}

async function verifyGlobalRetry() {
  const local = new Map<string, string>()
  let failWrite = false
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === StorageKeys.novels && failWrite) {
          failWrite = false
          throw new Error('simulated storage failure')
        }
        local.set(key, value)
      },
      removeItem: (key: string) => local.delete(key),
    },
  })
  const originalError = console.error
  console.error = () => {} // 存储层预期故障，不输出用户载荷。
  try {
    for (const kind of ['novels', 'chapters'] as const) {
      for (const rename of [false, true]) {
        const state = setup(kind)
        local.set(StorageKeys.novels, JSON.stringify(fixture()))
        await initNovelPersistence()
        const unsubscribe = subscribeNovelPersistenceStatus(state.handlePersistenceStatus)
        try {
          const form = kind === 'novels' ? state.createForm : state.chapterForm
          form.value.title = '保留创建身份'
          const draftRef = kind === 'novels' ? state.createDraft : state.chapterDraft
          failWrite = true
          if (kind === 'novels') await state.createNovel()
          else await state.saveChapter()
          const originalDraft = clone(draftRef.value)
          assert.ok(originalDraft?.id)
          await retryNovelPersistence()
          // 在全局重试后补入非表单数据，再次提交不能用创建默认值清空它们。
          const restored = clone(storageGet<any[]>(StorageKeys.novels, []))
          const target = kind === 'novels'
            ? restored.find(novel => novel.id === originalDraft.id)
            : restored[0].chapterList.find((chapter: any) => chapter.id === originalDraft.id)
          if (kind === 'novels') {
            target.chapterList = [{ id: 99, title: '恢复后的章节', content: '不能清空的正文', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }]
            target.characters = [{ id: 98, name: '不能清空的人物' }]
          } else target.notes = '不能清空的扩展字段'
          await storageSet(StorageKeys.novels, restored)
          if (rename) form.value.title = '同一草稿改名'
          if (kind === 'novels') await state.createNovel()
          else await state.saveChapter()
          const persisted = JSON.parse(local.get(StorageKeys.novels)!)
          const items = kind === 'novels' ? persisted : persisted[0].chapterList
          assert.equal(items.length, 3, '同一表单重提不能重复创建')
          const actual = items.find((item: any) => item.id === originalDraft.id)
          assert.equal(actual.title, rename ? '同一草稿改名' : '保留创建身份')
          assert.equal(actual.createdAt, originalDraft.createdAt, '重试不能重置原创建时间')
          if (kind === 'novels') {
            assert.deepEqual(actual.chapterList, target.chapterList)
            assert.deepEqual(actual.characters, target.characters)
          } else assert.equal(actual.notes, target.notes)
          assert.equal(draftRef.value, null, '成功关闭表单后应清除草稿身份')
          console.log(`✓ ${kind}/${rename ? 'rename' : 'resubmit'}：全局重试后同表单保存保持身份、创建时间与已有内部数据`)
        } finally { unsubscribe() }
      }
      for (const operation of ['create', 'delete'] as const) {
        const state = setup(kind)
        local.set(StorageKeys.novels, JSON.stringify(fixture()))
        await initNovelPersistence()
        const unsubscribe = subscribeNovelPersistenceStatus(state.handlePersistenceStatus)
        try {
          const form = kind === 'novels' ? state.createForm : state.chapterForm
          const list = kind === 'novels' ? state.novels : state.chapters
          form.value.title = '全局重试 X'
          const input = clone(form.value)
          failWrite = true
          if (operation === 'create') {
            if (kind === 'novels') await state.createNovel()
            else await state.saveChapter()
          } else {
            if (kind === 'novels') await state.deleteNovel(state.novels.value[0])
            else await state.deleteChapter(state.chapters.value[0])
          }
          assert.equal(state.errors.length, 1)
          assert.equal(state.success.length, 0)
          const stale = clone(list.value)
          await retryNovelPersistence()
          assert.notDeepEqual(clone(list.value), stale, `${kind}/${operation} 全局重试后列表应自动同步`)
          assert.deepEqual(clone(form.value), input, '全局刷新列表不能清掉尚未关闭的编辑输入')
          if (operation === 'create') assert.ok(list.value.some((item: any) => item.title === '全局重试 X'))
          else assert.ok(!list.value.some((item: any) => item.id === (kind === 'novels' ? 1 : 11)))
          // 关闭原表单后再开启独立创建，必须保留全局重试提交的 X。
          if (kind === 'novels') state.resetCreateForm()
          else state.resetForm()
          form.value.title = '后续创建 Y'
          await new Promise(resolve => setTimeout(resolve, 2))
          if (kind === 'novels') await state.createNovel()
          else await state.saveChapter()
          const persisted = JSON.parse(local.get(StorageKeys.novels)!)
          const items = kind === 'novels' ? persisted : persisted[0].chapterList
          assert.ok(items.some((item: any) => item.title === '后续创建 Y'))
          if (operation === 'create') assert.ok(items.some((item: any) => item.title === '全局重试 X'))
          else assert.ok(!items.some((item: any) => item.id === (kind === 'novels' ? 1 : 11)))
          console.log(`✓ ${kind}/${operation}：实际持久化服务重试同步页面，后续保存不丢失或复活数据`)
        } finally {
          unsubscribe()
        }
      }
    }
  } finally {
    console.error = originalError
  }
}

async function main() {
  let result = await verifyFailureThenRetry('novels', '小说创建', state => state.createNovel())
  assert.equal(disk.length, 3, '创建重试不能重复插入')
  assert.equal(result.state.createForm.value.title, '')
  result = await verifyFailureThenRetry('novels', '小说编辑', state => state.updateNovelInfo())
  assert.equal(result.state.selectedNovel.value.title, '修改标题')
  assert.equal(result.state.editingNovel.value, null)
  await verifyFailureThenRetry('novels', '小说复制', state => state.duplicateNovel(state.novels.value[0]))
  assert.equal(disk.length, 3)
  await verifyFailureThenRetry('novels', '小说删除', state => state.deleteNovel(state.novels.value[0]))
  assert.equal(disk.length, 1)
  await verifyFailureThenRetry('chapters', '章节创建', state => state.saveChapter())
  assert.equal(disk[0].chapterList.length, 3)
  await verifyFailureThenRetry('chapters', '章节编辑', state => state.saveChapter(), state => {
    state.editingChapter.value = state.chapters.value[0]
  })
  assert.equal(disk[0].chapterList[0].content, '保留章节正文')
  await verifyFailureThenRetry('chapters', '章节复制', state => state.duplicateChapter(state.chapters.value[0]))
  assert.equal(disk[0].chapterList.length, 3)
  await verifyFailureThenRetry('chapters', '章节上移', state => state.moveChapter(state.chapters.value[1], 'up'))
  assert.deepEqual(disk[0].chapterList.map((c: any) => c.id), [12, 11])
  await verifyFailureThenRetry('chapters', '章节下移', state => state.moveChapter(state.chapters.value[0], 'down'))
  assert.deepEqual(disk[0].chapterList.map((c: any) => c.id), [12, 11])
  await verifyFailureThenRetry('chapters', '章节删除', state => state.deleteChapter(state.chapters.value[0]))
  assert.equal(disk[0].chapterList.length, 1)
  for (const kind of ['novels', 'chapters'] as const) {
    const state = setup(kind)
    state.cancelConfirm()
    if (kind === 'novels') await state.deleteNovel(state.novels.value[0])
    else await state.deleteChapter(state.chapters.value[0])
    assert.equal(writes, 0)
    assert.deepEqual(state.success, [])
    assert.deepEqual(state.errors, [])
  }
  console.log('✓ 取消两类删除确认不写入，也不误报存储失败')
  await verifyGlobalRetry()
  console.log('\n=== ALL MANAGEMENT-PERSISTENCE TESTS PASSED ===')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
