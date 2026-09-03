/**
 * IndexedDB 薄封装：键值对形式存取大文本（章节正文等）。
 * - 单对象存储（kv），值为字符串
 * - 打开失败 / 环境不支持时 available=false，调用方自行降级回 localStorage
 */

const DB_NAME = 'llm-writer'
const DB_VERSION = 1
const STORE_NAME = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null
let available = typeof indexedDB !== 'undefined' && indexedDB !== null

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (!available) {
        reject(new Error('IndexedDB 不可用'))
        return
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'))
      request.onblocked = () => reject(new Error('IndexedDB 被其他标签页阻塞'))
    })
    dbPromise.catch(() => {
      available = false
    })
  }
  return dbPromise
}

/** IndexedDB 是否可用（打开失败后为 false，调用方应降级） */
export function isBlobStoreAvailable(): boolean {
  return available
}

export async function idbGet(key: string): Promise<string | null> {
  const db = await openDB()
  return new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve((request.result as string | undefined) ?? null)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 读取失败'))
  })
}

export async function idbSet(key: string, value: string): Promise<void> {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 写入失败'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 写入中止'))
  })
}

export async function idbDelete(key: string): Promise<void> {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 删除失败'))
  })
}

/** 清空整个对象存储（当前仅存放小说正文分片） */
export async function idbClear(): Promise<void> {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 清空失败'))
  })
}
