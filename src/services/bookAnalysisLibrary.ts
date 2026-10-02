import { ref } from 'vue'
import type { BookAnalysisLibraryRecord } from '../types/bookAnalysis'
import { StorageKeys, storageGetRaw, storageSet } from '../utils/storage'

export interface BookAnalysisLibraryStorage {
  read(): unknown
  write(records: BookAnalysisLibraryRecord[]): void | Promise<void>
  id?(): string
  now?(): string
}

export interface BookAnalysisLibraryDraft {
  id?: string
  title: string
  content: string
  sourceFileName: string
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/** Accept ISO timestamps with a timezone, but reject invalid calendar dates. */
function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/)
  if (!match || !Number.isFinite(Date.parse(value))) return false
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match
  const lastDay = new Date(0)
  lastDay.setUTCFullYear(Number(year), Number(month), 0)
  return Number(month) >= 1 && Number(month) <= 12
    && Number(day) >= 1 && Number(day) <= lastDay.getUTCDate()
    && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60
    && (offsetHour === undefined || (Number(offsetHour) < 24 && Number(offsetMinute) < 60))
}

/** Corrupt records must remain on disk for recovery rather than becoming an empty library. */
export function normalizeBookAnalysisLibrary(value: unknown): BookAnalysisLibraryRecord[] {
  if (!Array.isArray(value)) throw new Error('拆书分析作品库必须是数组')
  const ids = new Set<string>()
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`拆书分析作品库第 ${index + 1} 项无效`)
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id.trim() || ids.has(record.id)
      || typeof record.title !== 'string' || !record.title.trim()
      || typeof record.content !== 'string' || !record.content.trim()
      || typeof record.sourceFileName !== 'string'
      || !isIsoDate(record.createdAt) || !isIsoDate(record.updatedAt)) {
      throw new Error(`拆书分析作品库第 ${index + 1} 项缺少有效身份、正文或日期`)
    }
    ids.add(record.id)
    return { ...record } as BookAnalysisLibraryRecord
  })
}

function newRecordId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `book-analysis-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Serialize this runtime's operations and publish only successfully committed records. */
export function createBookAnalysisLibrary(storage: BookAnalysisLibraryStorage) {
  const records = ref<BookAnalysisLibraryRecord[]>([])
  const pending = ref(false)
  let tail = Promise.resolve()
  let queued = 0

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    queued++
    pending.value = true
    const result = tail.then(operation)
    tail = result.then(() => undefined, () => undefined)
    return result.finally(() => { pending.value = --queued > 0 })
  }

  const readSnapshot = (): BookAnalysisLibraryRecord[] => {
    const stored = storage.read()
    return clone(stored === null || stored === undefined ? [] : normalizeBookAnalysisLibrary(stored))
  }

  const load = () => enqueue(async () => {
    const snapshot = readSnapshot()
    records.value = clone(snapshot)
    // A caller opening an item receives a detached snapshot, not the shared list's draft.
    return clone(snapshot)
  })

  const save = (draft: BookAnalysisLibraryDraft) => {
    // Keep the requested content stable while earlier operations finish.
    const input = { ...draft }
    return enqueue(async () => {
      if (typeof input.title !== 'string' || !input.title.trim()
        || typeof input.content !== 'string' || !input.content.trim()
        || typeof input.sourceFileName !== 'string'
        || (input.id !== undefined && (typeof input.id !== 'string' || !input.id.trim()))) {
        throw new Error('请填写有效的作品标题和分析正文')
      }
      // Re-read before every mutation so a newer disk collection is not replaced by a stale UI list.
      // This is deliberately not a cross-tab lock; simultaneous writers remain a separate concern.
      const current = readSnapshot()
      const existing = input.id === undefined ? undefined : current.find(record => record.id === input.id)
      if (input.id !== undefined && !existing) throw new Error('该分析作品已删除，请重新载入作品库')
      const timestamp = storage.now?.() ?? new Date().toISOString()
      if (!isIsoDate(timestamp)) throw new Error('分析作品保存时间无效')
      const id = existing?.id ?? storage.id?.() ?? newRecordId()
      if (typeof id !== 'string' || !id.trim() || (!existing && current.some(record => record.id === id))) {
        throw new Error('分析作品身份无效或已存在，请重试')
      }
      const saved: BookAnalysisLibraryRecord = {
        ...existing,
        id,
        title: input.title.trim(),
        content: input.content,
        sourceFileName: input.sourceFileName,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      const next = existing
        ? current.map(record => record.id === id ? saved : record)
        : [...current, saved]
      await storage.write(clone(next))
      records.value = clone(next)
      return clone(saved)
    })
  }

  const remove = (id: string) => enqueue(async () => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('分析作品身份无效')
    const current = readSnapshot()
    const next = current.filter(record => record.id !== id)
    if (next.length !== current.length) await storage.write(clone(next))
    records.value = clone(next)
  })

  return { records, pending, load, save, remove }
}

export const bookAnalysisLibrary = createBookAnalysisLibrary({
  read: () => {
    const raw = storageGetRaw(StorageKeys.bookAnalysisLibrary)
    return raw === null ? null : JSON.parse(raw)
  },
  write: records => storageSet(StorageKeys.bookAnalysisLibrary, records),
})
