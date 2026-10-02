/** Commit-gate regression: queued contexts, callback failures and IDB recovery. */
import assert from 'node:assert/strict'

const { withStorageCommit } = await import('../src/services/storageCoordination')
let value = 0
const nodeFailure = new Error('node callback rejected')
const nodeResults = await Promise.allSettled([
  withStorageCommit(() => ++value),
  withStorageCommit(() => { throw nodeFailure }),
  withStorageCommit(() => ++value),
])
assert.deepEqual(nodeResults, [
  { status: 'fulfilled', value: 1 },
  { status: 'rejected', reason: nodeFailure },
  { status: 'fulfilled', value: 2 },
])
await assert.rejects(withStorageCommit(() => Promise.reject(new Error('invalid async callback'))), /必须同步/)
assert.equal(await withStorageCommit(() => ++value), 3)
console.log('✓ Node commits retain FIFO order and recover after thrown/async callbacks')

type Request = {
  result?: unknown
  error?: Error
  onsuccess?: () => void
  onerror?: () => void
}
let failOpen = true
let failGet = false
let abortAfterCallback = false
let openCount = 0
let nativeRequests = 0
const transactions: Array<() => void> = []
let active = false
function scheduleNext() {
  if (active || transactions.length === 0) return
  active = true
  const start = transactions.shift()!
  queueMicrotask(start)
}
function transaction(_store: string, mode: string) {
  assert.equal(mode, 'readwrite', 'The gate must participate in exclusive transaction scheduling')
  let aborted = false
  const request: Request = {}
  const tx = {
    error: null as Error | null,
    oncomplete: undefined as (() => void) | undefined,
    onerror: undefined as (() => void) | undefined,
    onabort: undefined as (() => void) | undefined,
    objectStore: () => ({
      get: (key: string) => {
        assert.equal(key, '__llm_writer_commit_gate__')
        return request
      },
    }),
    abort: () => { aborted = true },
  }
  transactions.push(() => {
    if (failGet) {
      failGet = false
      request.error = new Error('IDB gate read failed')
      request.onerror?.()
      aborted = true
    } else request.onsuccess?.()
    if (abortAfterCallback) {
      abortAfterCallback = false
      aborted = true
    }
    if (aborted) tx.onabort?.()
    else tx.oncomplete?.()
    active = false
    scheduleNext()
  })
  scheduleNext()
  return tx
}
Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  locks: { request: async (_name: string, _options: unknown, callback: () => unknown) => {
    nativeRequests++
    return callback()
  } },
} })
Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
  open: () => {
    openCount++
    const request: Request = {}
    queueMicrotask(() => {
      if (failOpen) {
        failOpen = false
        request.error = new Error('IDB open failed')
        request.onerror?.()
      } else {
        request.result = { transaction, objectStoreNames: { contains: () => true }, close() {} }
        request.onsuccess?.()
      }
    })
    return request
  },
} })
await assert.rejects(withStorageCommit(() => ++value), /IDB open failed/)
assert.equal(value, 3, 'Failed IDB opening must not run the commit')
assert.equal(nativeRequests, 0, 'An IDB failure must not silently use a different coordination gate')
assert.equal(await withStorageCommit(() => ++value), 4)
assert.equal(openCount, 2, 'An unsuccessful opening must be retryable')
console.log('✓ Browser IDB has priority; open failure surfaces and later retries reopen')

const order: number[] = []
const callbackFailure = new Error('callback failed')
const results = await Promise.allSettled([
  withStorageCommit(() => { order.push(1); return ++value }),
  withStorageCommit(() => { order.push(2); throw callbackFailure }),
  withStorageCommit(() => { order.push(3); return ++value }),
])
assert.deepEqual(order, [1, 2, 3])
assert.equal(results[0].status, 'fulfilled')
assert.equal(results[1].status, 'rejected')
if (results[1].status === 'rejected') assert.equal(results[1].reason, callbackFailure)
assert.equal(results[2].status, 'fulfilled')
assert.equal(value, 6)
failGet = true
await assert.rejects(withStorageCommit(() => ++value), /IDB gate read failed/)
assert.equal(value, 6)
await assert.rejects(withStorageCommit(() => Promise.resolve('invalid')), /必须同步/)
assert.equal(await withStorageCommit(() => ++value), 7)
console.log('✓ Independent queued IDB commits exclude one another and release after failures')

abortAfterCallback = true
assert.equal(await withStorageCommit(() => ++value), 8)
assert.equal(value, 8, 'Gate-only abort cannot undo a completed localStorage-style commit')
assert.equal(await withStorageCommit(() => ++value), 9)
assert.equal(nativeRequests, 0)
console.log('✓ Abort after completed synchronous callback reports committed result, and gate remains usable')

Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined })
assert.equal(await withStorageCommit(() => ++value), 10)
assert.equal(nativeRequests, 1)
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
await assert.rejects(withStorageCommit(() => ++value), /缺少安全的存储协调能力/)
assert.equal(value, 10)
console.log('✓ Without IDB, native Web Locks are used; unsupported browser fails before mutation')
