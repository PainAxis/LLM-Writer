/**
 * Writer 项目冒烟测试：直接执行 composable，验证加载、切换和保存失败。
 * 使用真实 Vue 响应性与小说持久化缓存；仅 localStorage 和界面提示使用 stub。
 * 运行：npm run smoke:writer-init
 */
import assert from 'node:assert/strict'
import { reactive } from 'vue'
import { useWriterProject, type WriterNovel } from '../src/composables/useWriterProject'
import { StorageKeys, storageGet, storageSet } from '../src/utils/storage'
import { initNovelPersistence } from '../src/services/novelPersistence'

type Novel = { id: number; chapterList?: any[]; [key: string]: any }
const materialKeys = ['characters', 'worldSettings', 'corpusData', 'events'] as const
const lsStore = new Map<string, string>()
const writes: Novel[][] = []
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => lsStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      lsStore.set(key, value)
      if (key === StorageKeys.novels) writes.push(JSON.parse(value))
    },
    removeItem: (key: string) => void lsStore.delete(key),
    clear: () => lsStore.clear(),
  },
})

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

function createWriter() {
  const novelStore = reactive({ worldSettings: [] as any[] })
  const errors: string[] = []
  const project = useWriterProject({ novelStore, notifyError: message => errors.push(message) })
  return {
    ...project, novelStore, errors,
    async open(id: number) {
      assert.equal(await project.initNovel(String(id)), true, `应打开小说 ${id}`)
      assert.deepEqual(errors, [])
    },
  }
}

function makeNovel(id: number): Novel {
  return {
    id, title: `小说${id}`,
    chapterList: [{
      id: id * 100, title: `小说${id}首章`, content: `<p>小说${id}正文</p>`,
      wordCount: 6, status: 'draft',
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    }],
    characters: [{ id: id * 100 + 1, name: `人物${id}`, background: `背景${id}` }],
    worldSettings: [{ id: id * 100 + 2, title: `世界${id}`, description: `设定${id}` }],
    corpusData: [{ id: id * 100 + 3, title: `语料${id}`, content: `素材${id}` }],
    events: [{ id: id * 100 + 4, title: `事件${id}`, chapter: '1' }],
  }
}

async function seed(novels: Novel[]) {
  await storageSet(StorageKeys.novels, clone(novels))
  writes.length = 0
}

function persisted(): Novel[] {
  return JSON.parse(lsStore.get(StorageKeys.novels) ?? '[]')
}

function assertMaterials(actual: Novel | undefined, expected: Novel, label: string) {
  assert.ok(actual, `${label}：小说应存在`)
  for (const key of materialKeys) {
    assert.deepEqual(clone(actual[key] ?? []), expected[key] ?? [], `${label}：${key} 应完整保留`)
  }
}

function assertEveryWrite(expected: Novel[], label: string) {
  for (const [index, snapshot] of writes.entries()) {
    for (const novel of expected) {
      assertMaterials(snapshot.find(item => item.id === novel.id), novel, `${label} 写入${index + 1}`)
    }
  }
}

async function main() {
  await initNovelPersistence()

  // 现代事件不会触发迁移补写，能暴露首次初始化就丢失素材的原始故障。
  const first = makeNovel(1)
  await seed([first])
  const writer = createWriter()
  await writer.open(first.id)
  assertMaterials(persisted()[0], first, '首次打开后的磁盘数据')
  assertMaterials(storageGet<Novel[]>(StorageKeys.novels, [])[0], first, '首次打开后的缓存')
  assertEveryWrite([first], '首次打开')
  await writer.initNovel(String(first.id))
  assertMaterials(persisted()[0], first, '重复初始化')
  await initNovelPersistence()
  const reopened = createWriter()
  await reopened.open(first.id)
  assertMaterials(reopened.currentNovel.value ?? undefined, first, '重新加载持久化数据')
  assertEveryWrite([first], '重新打开')
  console.log('✓ 测试1 通过：首次打开、重复初始化和重新打开保留四类素材')

  const legacy = makeNovel(2)
  legacy.chapterList![0].status = 'outline'
  legacy.chapterList!.push({
    id: 201, title: '旧数据无状态章节', content: '另一个正文',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  })
  legacy.events[0].chapter = legacy.chapterList![0].title
  const migrated = clone(legacy)
  migrated.events[0].chapter = '1'
  await seed([legacy])
  const legacyWriter = createWriter()
  await legacyWriter.open(legacy.id)
  assert.deepEqual(persisted()[0].chapterList!.map(chapter => chapter.status), ['draft', 'draft'])
  assertMaterials(persisted()[0], migrated, '旧状态与事件迁移')
  for (const snapshot of writes) {
    const expected = clone(legacy)
    expected.events[0].chapter = snapshot[0].events[0].chapter
    assert.ok([legacy.events[0].chapter, '1'].includes(expected.events[0].chapter))
    assertMaterials(snapshot[0], expected, '迁移期间写入')
  }
  console.log('✓ 测试2 通过：章节状态和事件引用迁移保留素材')

  const a = makeNovel(3)
  const b = makeNovel(4)
  await seed([a, b])
  const switching = createWriter()
  await switching.open(a.id)
  await switching.open(b.id)
  assertMaterials(storageGet<Novel[]>(StorageKeys.novels, []).find(n => n.id === a.id), a, '切换后 A 缓存')
  assertMaterials(persisted().find(n => n.id === b.id), b, '切换后 B 磁盘')
  assert.deepEqual(clone(switching.novelStore.worldSettings), b.worldSettings, '应加载 B 世界观')
  await switching.open(a.id)
  assert.deepEqual(clone(switching.novelStore.worldSettings), a.worldSettings, '返回 A 应保留 A 世界观')
  assert.equal(switching.currentChapter.value.id, a.chapterList![0].id)
  assertEveryWrite([a, b], 'A→B→A')
  console.log('✓ 测试3 通过：A→B→A 不串素材或污染缓存中的世界观')

  for (const hasChapterList of [true, false]) {
    const empty = makeNovel(hasChapterList ? 5 : 6)
    if (hasChapterList) empty.chapterList = []
    else delete empty.chapterList
    empty.events[0].chapter = a.chapterList![0].title
    await seed([a, empty])
    const emptyWriter = createWriter()
    await emptyWriter.open(a.id)
    await emptyWriter.open(empty.id)
    assert.deepEqual(emptyWriter.chapters.value, [], '无章节小说不能继承上一小说章节')
    assert.equal(emptyWriter.currentChapter.value, null, '应清空当前章节')
    assert.equal(emptyWriter.content.value, '', '应清空编辑器正文')
    assert.equal(emptyWriter.events.value[0].chapter, empty.events[0].chapter, '事件不能匹配上一小说的章节')
    await emptyWriter.saveNovelData()
    const saved = persisted().find(novel => novel.id === empty.id)!
    assert.deepEqual(saved.chapterList, [], '保存不能带入上一小说的章节')
    assertMaterials(saved, empty, '无章节小说保存')
    assertEveryWrite([a, empty], '切换到无章节小说')
  }
  console.log('✓ 测试4 通过：空章节列表和缺失章节列表均清空旧章节及正文')

  const bare = makeNovel(7)
  for (const key of materialKeys) delete bare[key]
  await seed([a, bare])
  const bareWriter = createWriter()
  await bareWriter.open(a.id)
  await bareWriter.open(bare.id)
  for (const value of [bareWriter.characters.value, bareWriter.novelStore.worldSettings,
    bareWriter.corpusData.value, bareWriter.events.value]) assert.deepEqual(value, [])
  assertMaterials(persisted().find(novel => novel.id === bare.id), bare, '缺省素材')
  assertEveryWrite([a, bare], '缺省素材')
  console.log('✓ 测试5 通过：缺省素材不继承上一小说数据')

  // Saving failures must preserve both the editor and last durable snapshot.
  let durable = [makeNovel(8), makeNovel(9)] as WriterNovel[]
  let failWrites = false
  const errors: string[] = []
  const failing = useWriterProject({
    novelStore: reactive({ worldSettings: [] as any[] }),
    notifyError: message => errors.push(message),
    persistence: {
      load: () => clone(durable),
      save: async novels => {
        if (failWrites) throw new Error('模拟异步分片提交失败')
        durable = clone(novels)
      },
    },
  })
  assert.equal(await failing.initNovel('8'), true)
  const oldContent = durable[0].chapterList![0].content
  failing.content.value = '<p>尚未落盘的新正文</p>'
  failing.onContentChange()
  failWrites = true
  assert.equal(await failing.saveCurrentChapter(), false)
  assert.equal(failing.hasUnsavedChanges.value, true)
  assert.equal(failing.isSaving.value, false)
  assert.match(failing.saveError.value!, /模拟异步分片提交失败/)
  assert.equal(durable[0].chapterList![0].content, oldContent)
  assert.equal(failing.content.value, '<p>尚未落盘的新正文</p>')
  assert.equal(await failing.selectChapter({ id: 801, title: '不能切换', content: '其他章节' }), false)
  assert.equal(failing.currentChapter.value!.id, 800)
  assert.equal(await failing.initNovel('9'), false)
  assert.equal(failing.currentNovel.value!.id, 8)
  assert.equal(errors.length, 1, '相同保存失败不重复刷提示')
  failWrites = false
  assert.equal(await failing.saveCurrentChapter(), true)
  assert.equal(durable[0].chapterList![0].content, '<p>尚未落盘的新正文</p>')
  assert.equal(failing.hasUnsavedChanges.value, false)
  assert.equal(failing.saveError.value, null)
  assert.equal(await failing.initNovel('9'), true)
  console.log('✓ 测试6 通过：异步保存失败保留编辑、阻止切章和切小说，重试成功恢复')

  let completeSave: (() => void) | undefined
  const pending = useWriterProject({
    novelStore: reactive({ worldSettings: [] as any[] }),
    notifyError: message => assert.fail(message),
    persistence: {
      load: () => [makeNovel(10)],
      save: () => new Promise<void>(resolve => { completeSave = resolve }),
    },
  })
  assert.equal(await pending.initNovel('10'), true)
  assert.equal(pending.hasUnsavedChanges.value, false)
  pending.onContentChange()
  assert.equal(pending.hasUnsavedChanges.value, false, '加载引起的编辑器回调不标记更改')
  pending.content.value = '第一版'
  pending.onContentChange()
  const inFlight = pending.saveNovelData()
  assert.equal(pending.isSaving.value, true, '真实提交完成前一直显示保存中')
  pending.content.value = '保存期间继续输入的第二版'
  pending.onContentChange()
  completeSave!()
  assert.equal(await inFlight, true)
  assert.equal(pending.isSaving.value, false)
  assert.equal(pending.hasUnsavedChanges.value, true, '旧保存完成不能清除新输入的待保存状态')
  const disposing = pending.dispose()
  assert.equal(pending.currentChapter.value!.content, '保存期间继续输入的第二版')
  completeSave!()
  assert.equal(await disposing, true)
  assert.equal(pending.hasUnsavedChanges.value, false)
  console.log('✓ 测试7 通过：加载回调不误保存、异步保存状态真实，卸载捕获最新输入')

  const switchEdits = createWriter()
  await seed([makeNovel(11), makeNovel(12)])
  await switchEdits.open(11)
  switchEdits.content.value = '切换前的新编辑'
  switchEdits.onContentChange()
  await switchEdits.open(12)
  assert.equal(persisted().find(novel => novel.id === 11)!.chapterList![0].content, '切换前的新编辑')
  assert.equal(switchEdits.currentChapter.value!.id, 1200)
  console.log('✓ 测试8 通过：切换小说前保存防抖期间的最新正文')

  const commits: Array<() => void> = []
  let navigationDisk = [makeNovel(13)] as WriterNovel[]
  const navigating = useWriterProject({
    novelStore: reactive({ worldSettings: [] as any[] }),
    notifyError: message => assert.fail(message),
    persistence: {
      load: () => clone(navigationDisk),
      save: novels => new Promise<void>(resolve => {
        commits.push(() => { navigationDisk = clone(novels); resolve() })
      }),
    },
  })
  assert.equal(await navigating.initNovel('13'), true)
  navigating.content.value = '切章开始时的正文'
  const targetChapter = { id: 1301, title: '下一章', content: '目标正文' }
  navigating.chapters.value.push(targetChapter)
  const selecting = navigating.selectChapter(targetChapter)
  navigating.content.value = '等待提交时继续写下的正文'
  navigating.onContentChange()
  commits[0]()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(commits.length, 2, '切章前应继续提交等待期间的新输入')
  assert.equal(navigating.currentChapter.value!.id, 1300, '最新正文提交前不能切章')
  commits[1]()
  assert.equal(await selecting, true)
  assert.equal(navigationDisk[0].chapterList![0].content, '等待提交时继续写下的正文')
  assert.equal(navigating.currentChapter.value!.id, 1301)
  console.log('✓ 测试9 通过：切章等待保存期间的新输入也完成落盘后才切换')

  let releaseSelection: (() => void) | undefined
  const guarded = useWriterProject({
    novelStore: reactive({ worldSettings: [] as any[] }),
    notifyError: message => assert.fail(message),
    persistence: {
      load: () => [makeNovel(14)],
      save: () => new Promise<void>(resolve => { releaseSelection = resolve }),
    },
  })
  assert.equal(await guarded.initNovel('14'), true)
  const originalTarget = { id: 1401, title: '旧目标', content: '旧内容' }
  guarded.chapters.value.push(originalTarget)
  let currentIntent = true
  const staleSelection = guarded.selectChapter(originalTarget, {
    isCurrent: () => currentIntent,
  })
  currentIntent = false
  releaseSelection!()
  assert.equal(await staleSelection, false)
  assert.equal(guarded.currentChapter.value!.id, 1400)

  const canonicalSelection = guarded.selectChapter(originalTarget)
  const replacementTarget = { id: 1401, title: '新目标', content: '新内容' }
  guarded.chapters.value.splice(1, 1, replacementTarget)
  const canonicalReplacement = guarded.chapters.value[1]
  releaseSelection!()
  assert.equal(await canonicalSelection, true)
  assert.equal(guarded.currentChapter.value, canonicalReplacement)

  guarded.loadChapter(guarded.chapters.value[0])
  const deletedSelection = guarded.selectChapter(canonicalReplacement)
  guarded.chapters.value.splice(1, 1)
  releaseSelection!()
  assert.equal(await deletedSelection, false)
  assert.equal(guarded.currentChapter.value!.id, 1400)
  console.log('✓ 测试10 通过：失效 intent 不切章，并在提交时重新解析 canonical 章节')

  console.log('\n=== ALL WRITER-INIT TESTS PASSED ===')
}

main().catch((error) => {
  console.error('\n=== WRITER-INIT SMOKE FAILED ===')
  console.error(error)
  process.exit(1)
})
