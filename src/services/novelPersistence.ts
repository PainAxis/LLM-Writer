/**
 * 小说数据分层持久化：
 * - 小数据量：整体 JSON 直接写 localStorage（快路径，与历史行为一致）
 * - 数据量超过阈值：章节正文（>INLINE_CONTENT_MAX_CHARS）写入 IndexedDB，
 *   localStorage 只保留元数据 + contentRef 指针
 * - 启动时 hydrate 到内存缓存，视图层经 storageGet/storageSet 零改动读写
 *
 * 注意：正文分片落 IDB 为异步写（元数据写 LS 前先完成 IDB 写），
 * 极端情况下（写 IDB 后、元数据落 LS 前崩溃）回退为上次已持久化状态。
 */

import { StorageKeys, registerChunkedKey, writeSerializedWithRetry, type ChunkedKeyBackend } from '@/utils/storage'
import { idbClear, idbDelete, idbGet, idbSet, isBlobStoreAvailable } from './blobStore'

/** 整体 JSON 超过该字符数（约 3MB UTF-16）时启用分片写入 */
const SPLIT_THRESHOLD_CHARS = 1_500_000

/** 分片模式下，章节正文超过该字符数才移入 IDB（短内容仍内联在元数据里） */
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

function contentBlobKey(novelId: unknown, chapterId: unknown): string {
  return `novel:${String(novelId)}:chapter:${String(chapterId)}:content`
}

function hasContentRefs(novels: NovelLike[]): boolean {
  return novels.some((novel) =>
    (novel.chapterList ?? []).some((chapter) => typeof chapter.contentRef === 'string'),
  )
}

let cache: NovelLike[] = []
let ready = false
let idbEnabled = true

/** 已写入 IDB 的分片键集合（用于清理与快路径降级判断） */
const writtenBlobKeys = new Set<string>()

/** 把长正文从内存数组中剥离，返回 { 元数据数组, 待写 IDB 分片 } */
/** 把长正文从内存数组中剥离，返回 { 元数据数组, 待写 IDB 分片 }（导出供冒烟演练） */
export function splitContents(novels: NovelLike[]): { metadata: NovelLike[]; blobs: Array<{ key: string; content: string }> } {
  const blobs: Array<{ key: string; content: string }> = []
  const metadata = novels.map((novel) => {
    if (!Array.isArray(novel.chapterList)) return novel
    const chapters = novel.chapterList.map((chapter) => {
      if (typeof chapter.content !== 'string' || chapter.content.length <= INLINE_CONTENT_MAX_CHARS) {
        return chapter
      }
      const key = contentBlobKey(novel.id, chapter.id)
      blobs.push({ key, content: chapter.content })
      const { content: _content, ...rest } = chapter
      return { ...rest, contentRef: key }
    })
    return { ...novel, chapterList: chapters }
  })
  return { metadata, blobs }
}

/** 从 IDB 把 contentRef 指回内存数组 */
/** 从 IDB 把 contentRef 指回内存数组（导出供冒烟演练） */
export async function hydrateContents(novels: NovelLike[]): Promise<void> {
  const jobs: Array<Promise<void>> = []
  for (const novel of novels) {
    if (!Array.isArray(novel.chapterList)) continue
    for (const chapter of novel.chapterList) {
      if (typeof chapter.contentRef !== 'string') continue
      const ref = chapter.contentRef
      jobs.push(
        idbGet(ref)
          .then((content) => {
            if (content === null) {
              console.warn(`[novelPersistence] 分片缺失: ${ref}，正文置空`)
              chapter.content = ''
            } else {
              chapter.content = content
            }
          })
          .catch((error) => {
            console.warn(`[novelPersistence] 分片读取失败: ${ref}`, error)
            chapter.content = ''
          }),
      )
    }
  }
  await Promise.all(jobs)
}

/** 分片路径持久化：先写 IDB 分片，再写元数据到 localStorage */
async function persistSplit(novels: NovelLike[]): Promise<void> {
  const { metadata, blobs } = splitContents(novels)

  await Promise.all(blobs.map(({ key, content }) => idbSet(key, content)))
  for (const { key } of blobs) writtenBlobKeys.add(key)

  // 清理已不在当前数据中的陈旧分片
  const currentKeys = new Set(blobs.map(({ key }) => key))
  const staleKeys = [...writtenBlobKeys].filter((key) => !currentKeys.has(key))
  await Promise.all(staleKeys.map((key) => idbDelete(key).catch(() => undefined)))
  for (const key of staleKeys) writtenBlobKeys.delete(key)

  const metadataJson = JSON.stringify(metadata)
  try {
    localStorage.setItem(StorageKeys.novels, metadataJson)
  } catch (error) {
    console.error('[novelPersistence] 元数据写入 localStorage 失败:', error)
  }
}

const backend: ChunkedKeyBackend = {
  get(): unknown {
    return cache
  },
  set(value: unknown): void {
    if (!Array.isArray(value)) {
      cache = []
      return
    }
    cache = value as NovelLike[]

    let fullJson = ''
    try {
      fullJson = JSON.stringify(cache)
    } catch (error) {
      console.error('[novelPersistence] 序列化小说数据失败:', error)
      return
    }

    if (!idbEnabled || fullJson.length <= SPLIT_THRESHOLD_CHARS) {
      // 快路径：整体直写 localStorage（复用集中层配额清理重试；配额错误同步抛出）
      writeSerializedWithRetry(StorageKeys.novels, fullJson)
      return
    }

    void persistSplit(cache).catch((error) => {
      console.error('[novelPersistence] 分片持久化失败:', error)
    })
  },
  remove(): void {
    cache = []
    try {
      localStorage.removeItem(StorageKeys.novels)
    } catch (error) {
      console.error('[novelPersistence] localStorage 键删除失败:', error)
    }
    if (idbEnabled) {
      void idbClear()
        .then(() => writtenBlobKeys.clear())
        .catch((error) => console.warn('[novelPersistence] IDB 清空失败:', error))
    }
  },
  isReady(): boolean {
    return ready
  },
}

/**
 * 初始化小说数据分层持久化（应用挂载前调用一次）：
 * 注册分片后端 → 读取 localStorage 数据 → 含分片指针时从 IDB hydrate 正文。
 */
export async function initNovelPersistence(): Promise<void> {
  registerChunkedKey(StorageKeys.novels, backend)

  if (!isBlobStoreAvailable()) {
    idbEnabled = false
    console.warn('[novelPersistence] IndexedDB 不可用，全部数据保留在 localStorage')
  }

  try {
    const raw = localStorage.getItem(StorageKeys.novels)
    if (raw !== null) {
      const data = JSON.parse(raw)
      if (Array.isArray(data)) {
        cache = data as NovelLike[]
        if (hasContentRefs(cache)) {
          if (idbEnabled) {
            await hydrateContents(cache)
          } else {
            console.warn('[novelPersistence] IndexedDB 不可用且数据含分片指针，部分正文无法加载')
          }
        }
      }
    }
  } catch (error) {
    console.error('[novelPersistence] 启动加载小说数据失败:', error)
    cache = []
  }

  ready = true
}

/** 供调试/诊断：当前是否处于分片写入模式 */
export function isNovelPersistenceSplitMode(): boolean {
  return idbEnabled
}
