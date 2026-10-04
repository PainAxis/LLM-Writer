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

/** Compare and replace in one readwrite transaction; success means committed. */
export async function idbCompareAndSwap(key: string, expectedValue: string | null, value: string): Promise<boolean> {
  const db = await openDB()
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(key)
    let matched = false
    tx.oncomplete = () => resolve(matched)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 条件写入失败'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 条件写入中止'))
    request.onsuccess = () => {
      if (((request.result as string | undefined) ?? null) !== expectedValue) return
      try {
        store.put(value, key)
        matched = true
      } catch (cause) {
        tx.abort()
        reject(cause)
      }
    }
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 条件读取失败'))
  })
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

/**
 * Serialize a synchronous commit across contexts without a stored lease.
 * A readwrite transaction excludes other transactions over this store until
 * its sentinel request and callback finish. No IndexedDB data is changed here.
 */
export async function idbRunSync<T>(callback: () => T): Promise<T> {
  const db = await openDB()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const request = tx.objectStore(STORE_NAME).get('__llm_writer_commit_gate__')
    let completed = false
    let result: T
    let callbackError: unknown
    let callbackFailed = false
    const finish = (error?: unknown) => {
      // The gate only reads IDB. A later abort cannot roll back the synchronous
      // localStorage commit, so report its known result instead of a false failure.
      if (completed) resolve(result)
      else if (callbackFailed) reject(callbackError)
      else reject(error ?? new Error('存储提交协调事务中止'))
    }
    tx.oncomplete = () => finish()
    tx.onerror = () => finish(tx.error ?? new Error('存储提交协调事务失败'))
    tx.onabort = () => finish(tx.error ?? new Error('存储提交协调事务中止'))
    request.onerror = () => finish(request.error ?? new Error('存储提交协调读取失败'))
    request.onsuccess = () => {
      try {
        result = callback()
        if (result !== null && (typeof result === 'object' || typeof result === 'function')
          && typeof (result as { then?: unknown }).then === 'function') {
          void Promise.resolve(result).catch(() => undefined)
          throw new TypeError('存储提交回调必须同步，不能返回 Promise')
        }
        completed = true
      } catch (error) {
        callbackError = error
        callbackFailed = true
        try { tx.abort() } catch { /* Preserve the callback's original failure. */ }
        finish()
      }
    }
  })
}

export async function idbClear(): Promise<void> {
  await writeTransaction((store) => { store.clear() })
}
