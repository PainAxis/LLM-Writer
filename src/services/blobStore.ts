/** IndexedDB 字符串存储；只在事务提交后报告写入成功，打开失败后允许重试。 */
const DB_NAME = 'llm-writer'
const DB_VERSION = 1
const STORE_NAME = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      if (!isBlobStoreAvailable()) {
        reject(new Error('IndexedDB 不可用'))
        return
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      let failed = false
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME)
        }
      }
      request.onsuccess = () => {
        if (failed) {
          request.result.close()
          return
        }
        const forgetConnection = () => {
          if (dbPromise === attempt) dbPromise = null
        }
        request.result.onversionchange = () => {
          request.result.close()
          forgetConnection()
        }
        // 浏览器回收/关闭连接后，重试必须重新打开，不能永久复用已关闭连接。
        request.result.onclose = forgetConnection
        resolve(request.result)
      }
      request.onerror = () => {
        failed = true
        reject(request.error ?? new Error('IndexedDB 打开失败'))
      }
      request.onblocked = () => {
        failed = true
        reject(new Error('IndexedDB 被其他标签页阻塞，请关闭其他标签页后重试'))
      }
    })
    dbPromise = attempt
    void attempt.catch(() => {
      if (dbPromise === attempt) dbPromise = null
    })
  }
  return dbPromise
}

/** 只探测环境支持；实际打开/事务失败交由调用方报告，不静默降级。 */
export function isBlobStoreAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null
}

export async function idbGet(key: string): Promise<string | null> {
  const db = await openDB()
  return new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(key)
    let value: string | null = null
    request.onsuccess = () => { value = (request.result as string | undefined) ?? null }
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 读取失败'))
    tx.oncomplete = () => resolve(value)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 读取失败'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 读取中止'))
  })
}

async function writeTransaction(write: (store: IDBObjectStore) => void): Promise<void> {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 写入失败'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 写入中止'))
    try {
      write(tx.objectStore(STORE_NAME))
    } catch (error) {
      tx.abort()
      reject(error)
    }
  })
}

/** 同一快照的分片在单个事务中全部提交或全部回滚。 */
export async function idbSetMany(entries: Array<{ key: string; content: string }>): Promise<void> {
  if (entries.length === 0) return
  await writeTransaction((store) => {
    for (const { key, content } of entries) store.put(content, key)
  })
}

export async function idbSet(key: string, value: string): Promise<void> {
  await idbSetMany([{ key, content: value }])
}

export async function idbDeleteMany(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  await writeTransaction((store) => {
    for (const key of keys) store.delete(key)
  })
}

export async function idbDelete(key: string): Promise<void> {
  await idbDeleteMany([key])
}

export async function idbClear(): Promise<void> {
  await writeTransaction((store) => { store.clear() })
}
