/**
 * 小说数据分层持久化冒烟演练（无需浏览器）：
 * 内存版 fake IndexedDB + localStorage，验证 快路径直写 / 超阈值分片 / 元数据指针 / 读回完整数据 / 分片回填 / 清除。
 * 运行：npx tsx scripts/smoke-novel-persistence.ts
 */
import assert from 'node:assert'

// ---- localStorage stub ----
const lsStore = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => void lsStore.set(k, v),
  removeItem: (k: string) => void lsStore.delete(k),
  clear: () => lsStore.clear(),
}

// ---- 内存版 IndexedDB stub（事件驱动接口的最小实现） ----
const idbStore = new Map<string, string>()
type FakeRequest = { result?: unknown; error?: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null }
function fakeRequest<T>(execute: () => T): FakeRequest & { result: T } {
  const request = {
    result: undefined as unknown as T,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
  } as FakeRequest & { result: T }
  queueMicrotask(() => {
    try {
      request.result = execute()
      request.onsuccess?.()
    } catch (error) {
      ;(request as unknown as { error: unknown }).error = error
      request.onerror?.()
    }
  })
  return request
}
;(globalThis as unknown as { indexedDB: unknown }).indexedDB = {
  open: () =>
    fakeRequest(() => ({
      objectStoreNames: { contains: () => true },
      createObjectStore: () => undefined,
      transaction: () => {
        const tx = {
          oncomplete: null as (() => void) | null,
          onerror: null as (() => void) | null,
          onabort: null as (() => void) | null,
          objectStore: () => store,
        }
        const complete = () => queueMicrotask(() => tx.oncomplete?.())
        const store = {
          get: (key: string) => fakeRequest(() => idbStore.get(key) ?? null),
          put: (value: string, key: string) => {
            idbStore.set(key, value)
            complete()
            return fakeRequest(undefined)
          },
          delete: (key: string) => {
            idbStore.delete(key)
            complete()
            return fakeRequest(undefined)
          },
          clear: () => {
            idbStore.clear()
            complete()
            return fakeRequest(undefined)
          },
        }
        return tx
      },
    })),
}

const flush = (ms = 250) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function makeNovels(chapterCount: number, chapterChars: number) {
  return [
    {
      id: 1,
      title: '演练小说',
      chapterList: Array.from({ length: chapterCount }, (_, index) => ({
        id: index + 1,
        title: `第${index + 1}章`,
        description: '大纲',
        content: '正'.repeat(chapterChars),
        wordCount: chapterChars,
      })),
    },
  ]
}

async function main() {
  // stub 就绪后再加载被测模块（保证 blobStore 探测到 indexedDB）
  const { StorageKeys, storageGet, storageRemove, storageSet } = await import('../src/utils/storage')
  const { idbGet } = await import('../src/services/blobStore')
  const { hydrateContents, initNovelPersistence, splitContents } = await import('../src/services/novelPersistence')

  // ---- 演练 1：初始化（空数据） ----
  await initNovelPersistence()
  assert.deepStrictEqual(storageGet(StorageKeys.novels, []), [], '空数据应返回空数组')
  console.log('✓ 演练1 通过：初始化与空数据')

  // ---- 演练 2：小数据快路径（整体直写 localStorage，无分片） ----
  const small = makeNovels(3, 500)
  storageSet(StorageKeys.novels, small)
  const raw = lsStore.get('novels') ?? ''
  assert.ok(raw.includes('正'.repeat(500)), '快路径应把正文整体写入 localStorage')
  assert.ok(!raw.includes('contentRef'), '快路径不应产生分片指针')
  assert.deepStrictEqual(storageGet(StorageKeys.novels, []), small, '读回应返回完整数据')
  console.log('✓ 演练2 通过：小数据快路径直写')

  // ---- 演练 3：超阈值分片（长正文进 IDB，元数据留指针） ----
  const big = makeNovels(400, 4000) // 400 章 × 4000 字 ≈ 1.6M 字符 > 1.5M 阈值
  storageSet(StorageKeys.novels, big)
  await flush()
  const metadataRaw = lsStore.get('novels') ?? ''
  assert.ok(metadataRaw.length < 500_000, '分片后元数据应远小于整体数据')
  assert.ok(metadataRaw.includes('contentRef'), '元数据应包含分片指针')
  assert.ok(!metadataRaw.includes('正'.repeat(4000)), '元数据不应再包含长正文')
  const blob = await idbGet('novel:1:chapter:1:content')
  assert.strictEqual(blob, '正'.repeat(4000), '分片应写入 IndexedDB')
  const hydrated = storageGet(StorageKeys.novels, []) as typeof big
  assert.strictEqual(hydrated[0].chapterList[0].content, '正'.repeat(4000), '读回应从内存缓存拿到完整正文')
  assert.strictEqual(hydrated[0].chapterList.length, 400, '章节数应完整')
  console.log('✓ 演练3 通过：超阈值分片与完整读回')

  // ---- 演练 4：hydrate 回填（模拟重启时从指针恢复正文） ----
  const { metadata } = splitContents(big)
  const restored = JSON.parse(JSON.stringify(metadata)) as typeof big
  await hydrateContents(restored)
  assert.strictEqual(restored[0].chapterList[0].content, '正'.repeat(4000), 'hydrate 应按指针回填正文')
  console.log('✓ 演练4 通过：分片指针回填')

  // ---- 演练 5：回滚路径（清除 → LS 键删除 + IDB 清空） ----
  storageRemove(StorageKeys.novels)
  await flush()
  assert.strictEqual(lsStore.has('novels'), false, '清除应删除 localStorage 键')
  assert.strictEqual(await idbGet('novel:1:chapter:1:content'), null, '清除应删除 IDB 分片')
  console.log('✓ 演练5 通过：清除与回滚')

  console.log('\n=== ALL NOVEL-PERSISTENCE TESTS PASSED ===')
}

main().catch((error) => {
  console.error('\n=== NOVEL-PERSISTENCE SMOKE FAILED ===')
  console.error(error)
  process.exit(1)
})
