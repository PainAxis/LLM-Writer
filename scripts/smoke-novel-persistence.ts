/** 故障注入回归：提交点、不可变分片、事务失败、并发、清除、重启与失败重试。 */
import assert from 'node:assert/strict'

const lsStore = new Map<string, string>()
let failMetadata = false
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  get length() { return lsStore.size },
  key: (index: number) => [...lsStore.keys()][index] ?? null,
  getItem: (key: string) => lsStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (key === 'novels' && failMetadata) throw new DOMException('故障注入：元数据配额不足', 'QuotaExceededError')
    lsStore.set(key, value)
  },
  removeItem: (key: string) => { lsStore.delete(key) },
  clear: () => lsStore.clear(),
}

// 事务结束时才将暂存写入应用到 IDB，模拟 abort 不得留下部分新正文。
const idbStore = new Map<string, string>()
let failOpen = false
let failWrite = false
let nextWriteGate: Promise<void> | null = null
let openCount = 0
let closeConnection: (() => void) | null = null
type FakeRequest = { result?: unknown; error?: unknown; onsuccess?: () => void; onerror?: () => void }
function transaction(_name: string, mode: string) {
  let aborted = false
  const failThisWrite = mode === 'readwrite' && failWrite
  if (failThisWrite) failWrite = false
  const gate = mode === 'readwrite' ? nextWriteGate : null
  if (mode === 'readwrite') nextWriteGate = null
  const writes: Array<() => void> = []
  const reads: Array<() => void> = []
  const tx = {
    error: null as Error | null,
    oncomplete: undefined as (() => void) | undefined,
    onerror: undefined as (() => void) | undefined,
    onabort: undefined as (() => void) | undefined,
    abort: () => { aborted = true; tx.onabort?.() },
    objectStore: () => ({
      get: (key: string) => {
        const request: FakeRequest = {}
        reads.push(() => { request.result = idbStore.get(key); request.onsuccess?.() })
        return request
      },
      put: (value: string, key: string) => { writes.push(() => { idbStore.set(key, value) }); return {} },
      delete: (key: string) => { writes.push(() => { idbStore.delete(key) }); return {} },
      clear: () => { writes.push(() => { idbStore.clear() }); return {} },
    }),
  }
  queueMicrotask(() => {
    void (async () => {
      if (gate) await gate
      if (aborted) return
      if (failThisWrite) {
        tx.error = new Error('故障注入：IDB 事务中止')
        tx.onabort?.()
        return
      }
      for (const read of reads) read()
      for (const write of writes) write()
      tx.oncomplete?.()
    })()
  })
  return tx
}
;(globalThis as unknown as { indexedDB: unknown }).indexedDB = {
  open: () => {
    openCount++
    const request: FakeRequest = {}
    queueMicrotask(() => {
      if (failOpen) {
        request.error = new Error('故障注入：IDB 打开失败')
        request.onerror?.()
      } else {
        let closed = false
        const db = {
          transaction: (name: string, mode: string) => {
            if (closed) throw new DOMException('数据库连接已关闭', 'InvalidStateError')
            return transaction(name, mode)
          },
          close: () => { closed = true },
          onclose: undefined as (() => void) | undefined,
          objectStoreNames: { contains: () => true },
        }
        closeConnection = () => { db.close(); db.onclose?.() }
        request.result = db
        request.onsuccess?.()
      }
    })
    return request
  },
}
function makeNovels(chars: number, char = '正', chapterCount = 2) {
  return [{
    id: 1,
    title: '测试小说',
    chapterList: Array.from({ length: chapterCount }, (_, index) => ({
      id: index + 1,
      title: `第${index + 1}章`,
      content: char.repeat(chars),
      wordCount: chars,
    })),
  }]
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
const big = (char = '正') => makeNovels(800_000, char)

async function main() {
  const { StorageKeys, storageGet, storageSet, storageRemove, storageClear } = await import('../src/utils/storage')
  const { initNovelPersistence, hydrateContents, getNovelPersistenceStatus, subscribeNovelPersistenceStatus,
    retryNovelPersistence, flushNovelPersistence } = await import('../src/services/novelPersistence')
  const save = (value: unknown) => Promise.resolve(storageSet(StorageKeys.novels, value))
  const readDisk = () => JSON.parse(lsStore.get('novels') ?? '[]') as ReturnType<typeof makeNovels>
  const hydratedDisk = async () => { const value = readDisk(); await hydrateContents(value); return value }
  const statuses: string[] = []
  const unsubscribe = subscribeNovelPersistenceStatus((value) => { statuses.push(value.phase) })
  let passed = 0
  const check = (label: string) => { passed++; console.log(`✓ ${passed}. ${label}`) }

  await initNovelPersistence()
  assert.deepEqual(storageGet(StorageKeys.novels, []), [])
  await save(makeNovels(500))
  assert.deepEqual(readDisk(), makeNovels(500))
  check('小正文完整保存，调用方可以等待提交完成')

  const beforeOpenFailure = lsStore.get('novels')
  failOpen = true
  await assert.rejects(save(big()), /打开失败/)
  assert.equal(lsStore.get('novels'), beforeOpenFailure)
  assert.equal(getNovelPersistenceStatus().phase, 'error')
  failOpen = false
  await retryNovelPersistence()
  assert.equal(openCount, 2, '打开失败不能永久缓存失败 Promise')
  assert.equal(getNovelPersistenceStatus().phase, 'saved')
  assert.equal((await hydratedDisk())[0].chapterList[0].content, '正'.repeat(800_000))
  check('IDB 打开失败可见且不损坏旧版，重试可恢复')

  const oldMetadata = lsStore.get('novels')!
  const oldBlobs = new Map(idbStore)
  const changed = big('新')
  changed[0].chapterList.splice(1, 1)
  changed[0].chapterList[0].content = '新'.repeat(1_600_000)
  failMetadata = true
  await assert.rejects(save(changed), /元数据配额不足/)
  await assert.rejects(flushNovelPersistence(), /元数据配额不足/)
  assert.equal(lsStore.get('novels'), oldMetadata)
  assert.deepEqual(idbStore, oldBlobs, '失败不能改写正文或提前删除已移除章节的旧分片')
  assert.equal((await hydratedDisk())[0].chapterList.length, 2)
  failMetadata = false
  await retryNovelPersistence()
  assert.equal((await hydratedDisk())[0].chapterList.length, 1)
  for (const key of oldBlobs.keys()) assert.equal(idbStore.has(key), false, '只在成功提交之后回收旧分片')
  check('元数据失败保留完整上一版；成功重试后才删除旧分片')

  const beforeTransactionFailure = lsStore.get('novels')!
  const transactionBlobs = new Map(idbStore)
  failWrite = true
  await assert.rejects(save(big('错')), /事务中止/)
  assert.equal(lsStore.get('novels'), beforeTransactionFailure)
  assert.deepEqual(idbStore, transactionBlobs)
  await retryNovelPersistence()
  check('IDB 写入事务失败不会发布新元数据，也不会损坏旧分片')

  const openedBeforeClose = openCount
  closeConnection!()
  await save(big('重连'))
  assert.equal(openCount, openedBeforeClose + 1)
  assert.equal((await hydratedDisk())[0].chapterList[0].content, '重连'.repeat(800_000))
  check('数据库意外关闭后重新建连，保存重试不会永久复用无效连接')

  const unhandled: unknown[] = []
  const onUnhandled = (error: unknown) => { unhandled.push(error) }
  process.on('unhandledRejection', onUnhandled)
  failMetadata = true
  storageSet(StorageKeys.novels, makeNovels(100, '失败')) // 旧调用方故意不 await
  await assert.rejects(flushNovelPersistence())
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(unhandled, [])
  assert.equal(getNovelPersistenceStatus().phase, 'error')
  process.off('unhandledRejection', onUnhandled)
  failMetadata = false
  await retryNovelPersistence()
  check('旧调用方忽略保存返回值不会产生未处理拒绝；全局仍能获知失败')

  const slowGate = deferred()
  nextWriteGate = slowGate.promise
  const slow = save(big('慢'))
  const fastValue = makeNovels(300, '快')
  const fast = save(fastValue)
  slowGate.resolve()
  await Promise.all([slow, fast])
  assert.deepEqual(readDisk(), fastValue)
  assert.equal(idbStore.size, 0)
  check('慢分片保存与快速内联保存按请求顺序提交，旧写入不会覆盖新数据')

  const firstGate = deferred()
  nextWriteGate = firstGate.promise
  const first = save(big('甲'))
  const secondValue = big('乙')
  const second = save(secondValue)
  secondValue[0].chapterList[0].content = '尚未保存的后续编辑'
  firstGate.resolve()
  await Promise.all([first, second])
  assert.equal((await hydratedDisk())[0].chapterList[0].content, '乙'.repeat(800_000))
  check('并发长正文保存串行提交；调用后的对象修改不会污染已排队快照')

  const removeGate = deferred()
  nextWriteGate = removeGate.promise
  const pendingSave = save(big('将删除'))
  const removing = storageRemove(StorageKeys.novels)
  removeGate.resolve()
  await Promise.all([pendingSave, removing])
  assert.equal(lsStore.has('novels'), false)
  assert.equal(idbStore.size, 0)
  await initNovelPersistence()
  assert.deepEqual(storageGet(StorageKeys.novels, []), [])
  check('删除等待更早的保存后执行，重启不会让已删除小说复活')

  const clearGate = deferred()
  nextWriteGate = clearGate.promise
  lsStore.set('apiConfig', '{"provider":"local"}')
  const beforeClear = save(big('清除前'))
  const clearing = storageClear()
  const afterClearValue = makeNovels(50, '清除后新建')
  const afterClear = save(afterClearValue)
  clearGate.resolve()
  await Promise.all([beforeClear, clearing, afterClear])
  assert.equal(lsStore.has('apiConfig'), false)
  assert.deepEqual(readDisk(), afterClearValue)
  check('清空与前后保存有序：旧数据删除，清空后新建的数据保留')

  await save(big('重启'))
  const restartMetadata = lsStore.get('novels')!
  await initNovelPersistence()
  const restored = storageGet<ReturnType<typeof makeNovels>>(StorageKeys.novels, [])
  assert.equal(restored[0].chapterList[0].content, '重启'.repeat(800_000))
  assert.equal('contentRef' in restored[0].chapterList[0], false)
  await save(makeNovels(10, '缩短'))
  assert.equal(idbStore.size, 0, '重启后也应记录旧分片并正确清理')
  await initNovelPersistence()
  assert.deepEqual(storageGet(StorageKeys.novels, []), makeNovels(10, '缩短'))
  check('重启恢复正文并去掉旧指针，长转短内联后仍能正确恢复及清理')

  // 兼容历史版本把 content 与 contentRef 一起写入元数据的情况，内联新正文优先。
  const legacy = makeNovels(20, '内联')
  Object.assign(legacy[0].chapterList[0], { contentRef: 'legacy-stale' })
  idbStore.set('legacy-stale', '旧的长正文')
  lsStore.set('novels', JSON.stringify(legacy))
  await initNovelPersistence()
  assert.equal(storageGet<typeof legacy>(StorageKeys.novels, [])[0].chapterList[0].content, '内联'.repeat(20))
  await save(storageGet(StorageKeys.novels, []))
  assert.equal(lsStore.get('novels')!.includes('contentRef'), false)
  assert.equal(idbStore.has('legacy-stale'), false)
  check('历史残留指针不能覆盖已缩短的正文，下一次保存会移除指针')

  await save(big('完整'))
  const committed = lsStore.get('novels')!
  const lostKey = [...idbStore.keys()][0]
  const lostContent = idbStore.get(lostKey)!
  idbStore.delete(lostKey)
  const incomplete = readDisk()
  await assert.rejects(hydrateContents(incomplete), /分片缺失/)
  assert.equal(JSON.stringify(incomplete), committed, 'hydrate 失败不得部分回填/置空')
  await assert.rejects(initNovelPersistence(), /分片缺失/)
  assert.equal(getNovelPersistenceStatus().blocked, true)
  assert.throws(() => storageGet(StorageKeys.novels, []), /分片缺失/)
  await assert.rejects(save(makeNovels(1)), /分片缺失/)
  assert.equal(lsStore.get('novels'), committed)
  idbStore.set(lostKey, lostContent)
  await retryNovelPersistence()
  assert.equal(getNovelPersistenceStatus().blocked, false)
  assert.equal(storageGet<typeof legacy>(StorageKeys.novels, [])[0].chapterList[0].content, '完整'.repeat(800_000))
  check('缺失分片阻止加载与覆盖保存；恢复分片后可以重试加载')

  // 旧版无版本固定键也可以恢复，并迁移到本次写入的不可变版本。
  const oldFormat = JSON.parse(restartMetadata)
  oldFormat[0].chapterList = [{ id: 1, title: '旧格式', contentRef: 'novel:1:chapter:1:content' }]
  idbStore.set('novel:1:chapter:1:content', '旧格式正文')
  lsStore.set('novels', JSON.stringify(oldFormat))
  await initNovelPersistence()
  assert.equal(storageGet<typeof legacy>(StorageKeys.novels, [])[0].chapterList[0].content, '旧格式正文')
  await save(storageGet(StorageKeys.novels, []))
  assert.equal(idbStore.has('novel:1:chapter:1:content'), false)
  check('旧版固定分片键保持读取兼容，提交后安全迁移')

  assert.ok(statuses.includes('saving') && statuses.includes('error') && statuses.includes('saved'))
  unsubscribe()
  console.log(`\n=== ALL ${passed} NOVEL-PERSISTENCE TESTS PASSED ===`)
}

main().catch((error) => {
  console.error('\n=== NOVEL-PERSISTENCE SMOKE FAILED ===', error)
  process.exitCode = 1
})
