/** Strict native-state MODEL, not browser acceptance. Executes the actual probe and
 * production blobStore CAS callback. No browser, network, real IndexedDB or secrets. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import vm from 'node:vm'
import ts from 'typescript'
import { installCampaignProbe } from './fixtures/writer-campaign-browser-probe.mjs'

async function exercise(source, operation) {
  const disk = new Map([['writer-campaign:test:head', 'previous-head']])
  const transactions = [], uncaught = []
  class NativeTransaction {
    constructor(mode) { this.mode = mode; this.state = 'active'; this.pending = 0; this.writes = new Map(); this.abortCalls = 0; this.error = null }
    get oncomplete() { return this.completeCallback }
    set oncomplete(callback) { this.completeCallback = callback }
    objectStore() { return new NativeStore(this) }
    abort() {
      this.abortCalls++
      if (this.state === 'finished') throw new DOMException('Transaction already finished', 'InvalidStateError')
      this.state = 'finished'; this.writes.clear()
      queueMicrotask(() => this.onabort?.({ target: this }))
    }
    schedule(callback) {
      this.pending++
      queueMicrotask(() => {
        if (this.state === 'active') {
          try { callback() } catch (error) { uncaught.push(error) }
        }
        this.pending--
        queueMicrotask(() => {
          if (this.pending || this.state !== 'active') return
          this.state = 'finished'
          for (const [key, value] of this.writes) disk.set(key, value)
          this.completeCallback?.({ target: this })
        })
      })
    }
  }
  class NativeStore {
    constructor(transaction) { this.transaction = transaction }
    get(key) {
      const request = {}
      this.transaction.schedule(() => { request.result = disk.get(key); request.onsuccess?.({ target: request }) })
      return request
    }
    put(value, key) {
      if (this.transaction.state !== 'active') throw new DOMException('Inactive transaction', 'TransactionInactiveError')
      this.transaction.writes.set(key, value)
      const request = {}
      this.transaction.schedule(() => request.onsuccess?.({ target: request }))
      return request
    }
  }
  class NativeDatabase {
    constructor() { this.name = 'llm-writer'; this.objectStoreNames = { contains: () => true } }
    transaction(_name, mode) { const tx = new NativeTransaction(mode); transactions.push(tx); return tx }
    close() {}
  }
  const db = new NativeDatabase()
  const context = vm.createContext({ IDBDatabase: NativeDatabase, IDBTransaction: NativeTransaction, IDBObjectStore: NativeStore,
    DOMException, queueMicrotask, console: { log() {}, error() {} },
    indexedDB: { open() { const request = { result: db }; queueMicrotask(() => request.onsuccess?.()); return request } },
    exports: {}, __campaignObserve: async () => {}, document: { querySelector: () => null } })
  vm.runInContext(`(${source})()`, context)
  context.__campaignProbe.arm({ kind: 'write', operation, abort: true })
  const actual = await readFile(new URL('../src/services/blobStore.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(actual, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInContext(compiled, context)
  const entries = [
    { key: 'writer-campaign:test:artifact:outline:0', expectedValue: null, value: '{"text":"synthetic only"}' },
    { key: 'writer-campaign:test:receipt:operation', expectedValue: null, value: JSON.stringify({ kind: operation }) },
    { key: 'writer-campaign:test:head', expectedValue: 'previous-head', value: 'new-head' },
  ]
  await assert.rejects(context.exports.idbCompareAndSwapMany(entries))
  for (let n = 0; n < 10; n++) await Promise.resolve()
  assert.deepEqual([...disk], [['writer-campaign:test:head', 'previous-head']], 'No artifact, receipt, or new head survives rollback')
  assert.equal(context.__campaignProbe.snapshot().aborted, 1)
  return { abortCalls: transactions[0].abortCalls, uncaught }
}

try {
  const current = installCampaignProbe.toString()
  const old = current.replace("state.aborted++; throw new DOMException", "state.aborted++; this.transaction.abort(); throw new DOMException")
  assert.notEqual(current, old, 'Mutation must reinstate the historical double-abort path')
  for (const operation of ['accept_artifact', 'cancel']) {
    const broken = await exercise(old, operation)
    assert.equal(broken.abortCalls, 2)
    assert.deepEqual(broken.uncaught.map(error => error.name), ['InvalidStateError'])
    const corrected = await exercise(current, operation)
    assert.equal(corrected.abortCalls, 1)
    assert.equal(corrected.uncaught.length, 0)
  }
  process.stdout.write('Campaign probe native-state model: historical double-abort reproduced; actual production catch owns one rollback with no uncaught error. Browser proof remains separate.\n')
} catch {
  process.stderr.write('Campaign probe native-state model: 1 suite failed (probe_abort_model_failed).\n')
  process.exitCode = 1
}
