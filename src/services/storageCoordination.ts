import { idbRunSync, isBlobStoreAvailable } from './blobStore'

let nodeQueue: Promise<void> = Promise.resolve()

function runSync<T>(callback: () => T): T {
  const result = callback()
  if (result !== null && (typeof result === 'object' || typeof result === 'function')
    && typeof (result as { then?: unknown }).then === 'function') {
    void Promise.resolve(result).catch(() => undefined)
    throw new TypeError('存储提交回调必须同步，不能返回 Promise')
  }
  return result
}

/**
 * Run only a synchronous read/check/write commit under a same-origin gate.
 * Read/hydrate/stage async work must finish beforehand; the callback rechecks
 * its original raw value before committing. IndexedDB also supports HTTP LAN
 * deployments, where Web Locks may be unavailable. An IDB failure is surfaced
 * rather than switching to a different gate while another tab could be active.
 */
export async function withStorageCommit<T>(callback: () => T): Promise<T> {
  if (typeof window === 'undefined') {
    // Test/SSR contexts have no browser tabs. Preserve ordered injected writes.
    const result = nodeQueue.then(() => runSync(callback))
    nodeQueue = result.then(() => undefined, () => undefined)
    return result
  }
  if (isBlobStoreAvailable()) return idbRunSync(callback)
  if (typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function') {
    return navigator.locks.request('llm-writer:storage-commit', { mode: 'exclusive' }, () => runSync(callback))
  }
  throw new Error('浏览器缺少安全的存储协调能力，请使用支持 IndexedDB 的浏览器或 HTTPS 部署后重试')
}
