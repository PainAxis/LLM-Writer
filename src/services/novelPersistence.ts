/**
 * 小说持久化：串行提交快照，长正文使用不可变、带版本的 IndexedDB 分片。
 * localStorage 元数据是提交点；它写入成功前，上一版引用的正文绝不修改或删除。
 */
import { StorageKeys, registerChunkedKey, writeSerializedWithRetry, type ChunkedKeyBackend } from '@/utils/storage'
import { idbDeleteMany, idbGet, idbSetMany, isBlobStoreAvailable } from './blobStore'
import { withStorageCommit } from './storageCoordination'
import { createNovelChangeTracker, type NovelChange } from '@/utils/novelConcurrency'

const SPLIT_THRESHOLD_CHARS = 1_500_000
const INLINE_CONTENT_MAX_CHARS = 2_000

interface ChapterLike {
  id: unknown
  content?: unknown
  contentRef?: string
  [key: string]: unknown
}
interface NovelLike {
  id: unknown
  chapterList?: ChapterLike[]
  [key: string]: unknown
}

export interface NovelPersistenceStatus {
  phase: 'loading' | 'saved' | 'saving' | 'error'
  /** 加载未成功时不能让视图读取残缺数据并自动保存。 */
  blocked: boolean
  error: string | null
  pending: number
}
type SaveRequest = { kind: 'save' | 'remove'; change: NovelChange<NovelLike>; publishOnSuccess?: boolean }
let cache: NovelLike[] = []
let changes = createNovelChangeTracker<NovelLike>([])
let ready = false
let loadError: Error | null = null
const garbageKeys = new Set<string>()
let queue: Promise<void> = Promise.resolve()
let latestResult: Promise<void> = queue
let latestRequest: SaveRequest | null = null
let revision = 0
let status: NovelPersistenceStatus = { phase: 'loading', blocked: true, error: null, pending: 0 }
const listeners = new Set<(value: NovelPersistenceStatus) => void>()
const retryHandlers = new Set<() => Promise<void>>()

/** 活跃编辑页可重试当前可见状态，避免重新执行页面已经回滚的失败操作。 */
export function registerNovelPersistenceRetryHandler(handler: () => Promise<void>): () => void {
  retryHandlers.add(handler)
  return () => { retryHandlers.delete(handler) }
}

export function getNovelPersistenceStatus(): NovelPersistenceStatus {
  return { ...status }
}
export function subscribeNovelPersistenceStatus(listener: (value: NovelPersistenceStatus) => void): () => void {
  listeners.add(listener)
  listener(getNovelPersistenceStatus())
  return () => { listeners.delete(listener) }
}
function updateStatus(value: Partial<NovelPersistenceStatus>): void {
  status = { ...status, ...value }
  for (const listener of listeners) listener(getNovelPersistenceStatus())
}
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
function observed(promise: Promise<void>): Promise<void> {
  // 保持原 Promise 的拒绝语义供 await 使用，同时兼容仍忽略返回值的旧调用方。
  void promise.catch(() => undefined)
  return promise
}
function referencedKeys(novels: NovelLike[]): Set<string> {
  return new Set(novels.flatMap((novel) => (novel.chapterList ?? [])
    .flatMap((chapter) => typeof chapter.contentRef === 'string' ? [chapter.contentRef] : [])))
}
function snapshot(value: unknown): NovelLike[] {
  if (!Array.isArray(value)) throw new Error('小说数据必须是数组')
  const result = JSON.parse(JSON.stringify(value)) as NovelLike[]
  for (const novel of result) {
    for (const chapter of novel.chapterList ?? []) {
      if (typeof chapter.contentRef === 'string' && typeof chapter.content !== 'string') {
        throw new Error(`章节「${String(chapter.title ?? chapter.id)}」正文尚未加载，已阻止覆盖保存`)
      }
      // 内存中正文始终为权威值；不能携带能在重启时覆盖新正文的旧指针。
      delete chapter.contentRef
    }
  }
  return result
}

/** 导出供回归检查；每次生成独立版本，兼容旧版固定键的读取。 */
export function splitContents(novels: NovelLike[]): { metadata: NovelLike[]; blobs: Array<{ key: string; content: string }> } {
  const version = globalThis.crypto?.randomUUID() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const blobs: Array<{ key: string; content: string }> = []
  const metadata = snapshot(novels).map((novel, novelIndex) => ({
    ...novel,
    ...(Array.isArray(novel.chapterList) ? {
      chapterList: novel.chapterList.map((chapter, chapterIndex) => {
        if (typeof chapter.content !== 'string' || chapter.content.length <= INLINE_CONTENT_MAX_CHARS) return chapter
        const key = `novel:${String(novel.id)}:chapter:${String(chapter.id)}:content:${version}:${novelIndex}:${chapterIndex}`
        blobs.push({ key, content: chapter.content })
        const { content: _content, ...rest } = chapter
        return { ...rest, contentRef: key }
      }),
    } : {}),
  }))
  return { metadata, blobs }
}

/** 全部分片成功读取后才回填；失败保留原始指针，不以空正文冒充成功。 */
export async function hydrateContents(novels: NovelLike[]): Promise<void> {
  const chapters = novels.flatMap((novel) => novel.chapterList ?? [])
  const loaded = await Promise.all(chapters.map(async (chapter) => {
    if (typeof chapter.contentRef !== 'string' || typeof chapter.content === 'string') return null
    const content = await idbGet(chapter.contentRef)
    if (content === null) throw new Error(`章节「${String(chapter.title ?? chapter.id)}」正文分片缺失（${chapter.contentRef}）`)
    return { chapter, content }
  }))
  for (const item of loaded) {
    if (item) item.chapter.content = item.content
  }
  for (const chapter of chapters) delete chapter.contentRef
}

async function collectGarbage(): Promise<void> {
  try {
    // Every save stages unique immutable keys. A retired key is never reused;
    // readers retry hydration if another tab changed the metadata meanwhile.
    const raw = localStorage.getItem(StorageKeys.novels)
    const current: unknown = raw === null ? [] : JSON.parse(raw)
    if (!Array.isArray(current)) return
    const referenced = referencedKeys(current)
    const keys = [...garbageKeys].filter(key => !referenced.has(key))
    await idbDeleteMany(keys)
    for (const key of keys) garbageKeys.delete(key)
  } catch (error) {
    // 提交已完成；清理失败只遗留无引用分片，下次提交时重试，不报告正文保存失败。
    console.warn('[novelPersistence] 陈旧分片清理失败，将在下次保存重试:', error)
  }
}

async function readCommitted() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const raw = localStorage.getItem(StorageKeys.novels)
    try {
      const value: unknown = raw === null ? [] : JSON.parse(raw)
      if (!Array.isArray(value)) throw new Error('已保存的小说数据格式无效')
      const novels = value as NovelLike[]
      const keys = referencedKeys(novels)
      await hydrateContents(novels)
      if (localStorage.getItem(StorageKeys.novels) === raw) return { raw, novels, keys }
    } catch (error) {
      if (localStorage.getItem(StorageKeys.novels) === raw) throw error
    }
  }
  throw new Error('其他标签页正在频繁保存，请稍后重试；当前草稿仍保留')
}

async function persist(request: SaveRequest): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const previous = await readCommitted()
    const novels = changes.merge(request.change, previous.novels)
    let serialized = JSON.stringify(novels)
    let blobs: Array<{ key: string; content: string }> = []
    if (request.kind !== 'remove' && isBlobStoreAvailable() && serialized.length > SPLIT_THRESHOLD_CHARS) {
      const split = splitContents(novels)
      blobs = split.blobs
      serialized = JSON.stringify(split.metadata)
    }
    let staged = false
    try {
      await idbSetMany(blobs)
      staged = true
      const committed = await withStorageCommit(() => {
        if (localStorage.getItem(StorageKeys.novels) !== previous.raw) return false
        if (request.kind === 'remove') localStorage.removeItem(StorageKeys.novels)
        else writeSerializedWithRetry(StorageKeys.novels, serialized)
        return true
      })
      if (committed) {
        changes.commit(request.change)
        for (const key of previous.keys) garbageKeys.add(key)
        await collectGarbage()
        return
      }
    } catch (error) {
      if (staged) {
        for (const { key } of blobs) garbageKeys.add(key)
        await collectGarbage()
      }
      throw error
    }
    for (const { key } of blobs) garbageKeys.add(key)
    await collectGarbage()
  }
  throw new Error('其他标签页正在频繁保存，请稍后重试；当前草稿仍保留')
}
function enqueue(request: SaveRequest): Promise<void> {
  changes.begin(request.change)
  latestRequest = request
  const currentRevision = ++revision
  updateStatus({ phase: 'saving', error: null, pending: status.pending + 1 })
  const result = queue.then(() => persist(request)).then(() => {
    if (request.publishOnSuccess && currentRevision === revision) cache = snapshot(request.change.value)
    updateStatus({ pending: status.pending - 1, ...(currentRevision === revision ? { phase: 'saved', error: null } : {}) })
  }, (error: unknown) => {
    updateStatus({ pending: status.pending - 1, phase: 'error', error: asError(error).message })
    throw error
  }).finally(() => { changes.finish(request.change) })
  latestResult = observed(result)
  queue = result.catch(() => undefined)
  return result
}

const backend: ChunkedKeyBackend = {
  async readCommitted(): Promise<unknown> {
    if (!ready || loadError) throw loadError ?? new Error('小说数据仍在加载')
    const sourceRevision = revision
    try { await latestResult } catch {
      throw new Error('仍有未保存的小说修改，请先保存或复制保留草稿后再备份或导入')
    }
    const committed = await readCommitted()
    if (sourceRevision !== revision || status.pending > 0 || status.phase === 'error') {
      throw new Error('小说内容在读取期间发生变化，请等待保存完成后重试')
    }
    return committed.novels
  },
  get(): unknown {
    if (!ready) throw new Error('小说数据仍在加载')
    if (loadError) throw loadError
    // 调用方可以自由编辑读取结果，但不能悄悄改动排队/重试中的快照。
    return snapshot(cache)
  },
  set(value: unknown): Promise<void> {
    try {
      if (!ready) throw new Error('小说数据仍在加载')
      if (loadError) throw loadError
      const next = snapshot(value)
      const change = changes.capture(next, cache)
      cache = next
      return enqueue({ kind: 'save', change })
    } catch (error) {
      latestRequest = null
      revision++
      updateStatus({ phase: 'error', error: asError(error).message })
      latestResult = observed(Promise.reject(error))
      return latestResult
    }
  },
  replace: value => replaceNovelPersistence(value),
  remove(): Promise<void> {
    if (!ready || loadError) return observed(Promise.reject(loadError ?? new Error('小说数据仍在加载')))
    const change = changes.capture([], cache, true)
    return enqueue({ kind: 'remove', change, publishOnSuccess: true })
  },
  isReady: () => ready,
}

/** Explicit backup replacement checks the whole collection, including projects
 * created by another tab since this page was opened. */
export function replaceNovelPersistence(value: unknown): Promise<void> {
  if (!ready || loadError) return observed(Promise.reject(loadError ?? new Error('小说数据仍在加载')))
  try {
    const next = snapshot(value)
    const change = changes.capture(next, cache, true)
    return enqueue({ kind: 'save', change, publishOnSuccess: true })
  } catch (error) {
    return observed(Promise.reject(error))
  }
}

/** 等待调用前的最新操作完成；最新保存失败时拒绝，供关闭/导出等操作使用。 */
export function flushNovelPersistence(): Promise<void> {
  return latestResult
}
/** 加载失败时重新读取已提交数据；保存失败时重试最近一次请求的完整快照。 */
export function retryNovelPersistence(): Promise<void> {
  if (loadError) return observed(initNovelPersistence())
  const handlers = [...retryHandlers]
  const handler = handlers[handlers.length - 1]
  if (handler) return observed(Promise.resolve().then(handler))
  if (latestRequest) return enqueue(latestRequest)
  return latestResult
}

/** 启动前完成读取；发生错误时 App 阻止业务视图挂载，避免残缺数据被自动保存。 */
export async function initNovelPersistence(): Promise<void> {
  await queue
  ready = false
  loadError = null
  updateStatus({ phase: 'loading', blocked: true, error: null, pending: 0 })
  registerChunkedKey(StorageKeys.novels, backend)
  try {
    const { novels: restored } = await readCommitted()
    cache = restored
    changes = createNovelChangeTracker(restored)
    latestRequest = null
    latestResult = Promise.resolve()
    ready = true
    updateStatus({ phase: 'saved', blocked: false, error: null })
  } catch (error) {
    loadError = asError(error)
    latestResult = observed(Promise.reject(loadError))
    updateStatus({ phase: 'error', blocked: true, error: loadError.message })
    throw loadError
  } finally {
    // 错误状态也交给后端处理，禁止 storageGet 回退读取未 hydrate 的原始元数据。
    ready = true
  }
}

/** 当前环境是否支持分片存储。实际事务结果由保存状态报告。 */
export function isNovelPersistenceSplitMode(): boolean {
  return isBlobStoreAvailable()
}
