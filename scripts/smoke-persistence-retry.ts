/** 实际持久化与页面状态的交界：全局重试、回滚、快照隔离及防抖期间关闭保护。 */
import assert from 'node:assert/strict'

const disk = new Map<string, string>()
let fail = false
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => disk.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (fail && key === 'novels') throw new Error('故障注入：保存失败')
    disk.set(key, value)
  },
  removeItem: (key: string) => { disk.delete(key) },
}

const novel = (id: number, title: string) => ({
  id, title,
  chapterList: [{ id: 1, title: '第一章', content: '原正文', status: 'draft' }],
  characters: [{ id: 1, name: 'Alice' }],
  worldSettings: [{ id: 1, title: '世界', description: '设定' }],
  corpusData: [{ id: 1, title: '素材', content: '原素材' }],
  events: [{ id: 1, title: '事件', chapterId: 1 }],
})

async function main() {
  const { StorageKeys, storageGet, storageSet } = await import('../src/utils/storage')
  const { initNovelPersistence, retryNovelPersistence, subscribeNovelPersistenceStatus,
    getNovelPersistenceStatus, registerNovelPersistenceRetryHandler } = await import('../src/services/novelPersistence')
  const { useWriterProject } = await import('../src/composables/useWriterProject')
  const read = () => JSON.parse(disk.get('novels') ?? '[]') as ReturnType<typeof novel>[]
  const save = (value: unknown) => storageSet(StorageKeys.novels, value)
  await initNovelPersistence()

  const input = [novel(1, 'A')]
  const pending = save(input)
  input[0].characters[0].name = '调用后的修改'
  await pending
  assert.equal(read()[0].characters[0].name, 'Alice')
  const mutableRead = storageGet<typeof input>(StorageKeys.novels, [])
  mutableRead[0].characters[0].name = '读取后的修改'
  assert.equal(storageGet<typeof input>(StorageKeys.novels, [])[0].characters[0].name, 'Alice')
  await retryNovelPersistence()
  assert.equal(read()[0].characters[0].name, 'Alice')
  console.log('✓ 传入对象、读出对象与排队/重试快照相互隔离')

  // 管理页的订阅仅同步列表；进行中的表单、ID 等独立状态不会被重置。
  let list = storageGet<ReturnType<typeof novel>[]>(StorageKeys.novels, [])
  const form = { title: 'X' }
  const unsubscribe = subscribeNovelPersistenceStatus(status => {
    if (status.phase === 'saved' && status.pending === 0) list = storageGet(StorageKeys.novels, [])
  })
  fail = true
  await assert.rejects(save([...list, novel(2, form.title)]))
  assert.deepEqual(list.map(item => item.title), ['A'])
  fail = false
  await retryNovelPersistence()
  assert.deepEqual(list.map(item => item.title), ['A', 'X'])
  assert.equal(form.title, 'X')
  await save([...list, novel(3, 'Y')])
  assert.deepEqual(read().map(item => item.title), ['A', 'X', 'Y'])
  fail = true
  await assert.rejects(save(list.filter(item => item.id !== 2)))
  fail = false
  await retryNovelPersistence()
  await save([...list, novel(4, 'Z')])
  assert.deepEqual(read().map(item => item.title), ['A', 'Y', 'Z'])
  unsubscribe()
  console.log('✓ 失败创建/删除经全局重试同步列表；后续保存不丢项目、不复活删除项')

  await save([novel(1, 'A')])
  const handlers = new Set<(event: BeforeUnloadEvent) => void>()
  const target = {
    addEventListener: (_type: 'beforeunload', handler: (event: BeforeUnloadEvent) => void) => { handlers.add(handler) },
    removeEventListener: (_type: 'beforeunload', handler: (event: BeforeUnloadEvent) => void) => { handlers.delete(handler) },
  }
  const unloadPrevented = () => {
    let prevented = false
    const event = { preventDefault: () => { prevented = true }, returnValue: undefined } as unknown as BeforeUnloadEvent
    for (const handler of handlers) handler(event)
    return prevented
  }
  const worldStore = { worldSettings: [] as any[] }
  const writer = useWriterProject({ novelStore: worldStore, notifyError: () => undefined, beforeUnloadTarget: target })
  await writer.initNovel('1')
  assert.equal(unloadPrevented(), false)
  for (const key of ['characters', 'worldSettings', 'corpusData', 'events'] as const) {
    const items = writer[key].value
    const [removed] = items.splice(0, 1)
    fail = true
    assert.equal(await writer.saveNovelData(), false)
    items.splice(0, 0, removed) // 与 Writer.vue 的失败删除回滚一致
    fail = false
    await retryNovelPersistence()
    assert.equal(read()[0][key].length, 1, `${key} 已回滚删除不能被全局重试重新执行`)
    assert.equal(writer.saveError.value, null)
  }
  const selected = writer.currentChapter.value
  const previousContent = writer.content.value
  const [chapter] = writer.chapters.value.splice(0, 1)
  writer.currentChapter.value = null
  writer.content.value = ''
  fail = true
  assert.equal(await writer.saveNovelData(), false)
  writer.chapters.value.splice(0, 0, chapter)
  writer.currentChapter.value = selected
  writer.content.value = previousContent
  fail = false
  await retryNovelPersistence()
  assert.equal(read()[0].chapterList[0].content, previousContent)
  console.log('✓ Writer 章节和四类素材删除回滚后，全局重试保存当前状态，不重放撤回的删除')

  writer.content.value = '首次失败的输入'
  writer.onContentChange()
  fail = true
  assert.equal(await writer.saveNovelData(), false)
  writer.content.value = '失败以后继续输入的最新正文'
  writer.onContentChange()
  fail = false
  await retryNovelPersistence()
  assert.equal(read()[0].chapterList[0].content, '失败以后继续输入的最新正文')
  assert.equal(writer.hasUnsavedChanges.value, false)
  assert.equal(writer.saveError.value, null)
  console.log('✓ 全局重试捕获失败后的新输入，并同步清除 Writer 未保存/错误状态')

  writer.content.value = '还在两秒防抖窗口里的输入'
  writer.onContentChange()
  assert.equal(getNovelPersistenceStatus().phase, 'saved')
  assert.equal(getNovelPersistenceStatus().pending, 0)
  assert.equal(unloadPrevented(), true, '后端尚未接到保存请求时也必须保护 dirty 页面')
  await writer.saveCurrentChapter()
  assert.equal(unloadPrevented(), false)
  await writer.dispose()
  assert.equal(handlers.size, 0)
  console.log('✓ 防抖尚未提交时关闭保护生效，保存完成后解除，dispose 释放事件')

  const calls: string[] = []
  const unregisterFirst = registerNovelPersistenceRetryHandler(async () => { calls.push('first') })
  const unregisterSecond = registerNovelPersistenceRetryHandler(async () => { calls.push('second') })
  unregisterFirst()
  await retryNovelPersistence()
  assert.deepEqual(calls, ['second'])
  unregisterSecond()
  await retryNovelPersistence()
  assert.deepEqual(calls, ['second'])
  console.log('✓ 多个页面处理器分别清理，旧实例不会注销新实例或被意外复活')

  let activeCalls = 0
  const unregisterActive = registerNovelPersistenceRetryHandler(async () => { activeCalls++ })
  const injected = useWriterProject({
    novelStore: { worldSettings: [] }, notifyError: () => undefined, beforeUnloadTarget: null,
    persistence: { load: () => [], save: () => { throw new Error('不应触发注入存储') } },
  })
  await retryNovelPersistence()
  await injected.dispose()
  await retryNovelPersistence()
  assert.equal(activeCalls, 2)
  unregisterActive()
  console.log('✓ 注入独立存储的实例不注册全局重试，也不会注销实际页面的处理器')

  console.log('\n=== ALL 7 PERSISTENCE-RETRY TESTS PASSED ===')
}

main().catch(error => {
  console.error('\n=== PERSISTENCE-RETRY SMOKE FAILED ===', error)
  process.exitCode = 1
})
