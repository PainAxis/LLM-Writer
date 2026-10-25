/* global process, Buffer */
/** Native event MODEL only: validates the observer without launching a browser. */
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { installCampaignStorageMeter } from './fixtures/writer-campaign-storage-meter.mjs'
let checks = 0
try {
  class Store {
    constructor(transaction) { this.transaction = transaction }
    put() { return new EventTarget() }
    get() { return new EventTarget() }
  }
  class Transaction extends EventTarget {
    constructor(mode) { super(); this.mode = mode }
    objectStore() { return new Store(this) }
  }
  class Database {
    constructor() { this.name = 'llm-writer' }
    transaction(_name, mode) { return new Transaction(mode) }
  }
  const context = vm.createContext({ IDBDatabase: Database, IDBObjectStore: Store, TextEncoder, structuredClone })
  vm.runInContext(`(${installCampaignStorageMeter.toString()})()`, context)
  const meter = context.__campaignStorageMeter, db = new Database(), bytes = value => Buffer.byteLength(value)
  const entry = (key, value) => ({ key, value: JSON.stringify(value) })
  const encode = n => String(n).padStart(16, '0')
  function write(previous, outstanding = 100) {
    const entries = [entry('writer-campaign:test:checkpoint:0', { hash: 'a'.repeat(64), storage: { writtenBytes: encode(0), outstandingBytes: encode(outstanding) } }), entry('writer-campaign:test:receipt:0', { serializedBytes: encode(0) }), entry('writer-campaign:test:head', { sequence: 0, checkpointHash: 'a'.repeat(64) })]
    const charge = entries.reduce((sum, item) => sum + bytes(item.key) + bytes(item.value), 0)
    entries[0].value = JSON.stringify({ hash: 'a'.repeat(64), storage: { writtenBytes: encode(previous + charge), outstandingBytes: encode(outstanding) } })
    entries[1].value = JSON.stringify({ serializedBytes: encode(charge) })
    const tx = db.transaction('kv', 'readwrite'), store = tx.objectStore('kv')
    entries.forEach(item => store.put(item.value, item.key))
    return { tx, charge, entries }
  }
  let first = write(0)
  assert.equal(meter.snapshot().cumulativeWrittenBytes, 0, 'put calls are not committed writes')
  first.tx.dispatchEvent(new Event('abort'))
  assert.equal(meter.snapshot().cumulativeWrittenBytes, 0, 'aborted transaction is not committed')
  assert.throws(() => meter.restartIdentity()); checks++
  first = write(0); first.tx.dispatchEvent(new Event('complete'))
  assert.equal(meter.snapshot().cumulativeWrittenBytes, first.charge)
  assert.equal(meter.snapshot().accountingMismatches, 0); assert.equal(meter.snapshot().peakOutstandingBytes, 100)
  assert.equal(meter.restartIdentity().checkpointHash, 'a'.repeat(64))
  assert.equal(Object.hasOwn(meter.snapshot(), 'checkpointHash'), false); checks++
  const abortedAfterValid = write(first.charge)
  abortedAfterValid.tx.dispatchEvent(new Event('abort'))
  assert.equal(meter.restartIdentity().checkpointHash, 'a'.repeat(64), 'Abort preserves the prior completed identity'); checks++
  const second = write(first.charge, 0); second.tx.dispatchEvent(new Event('complete'))
  assert.equal(meter.snapshot().cumulativeWrittenBytes, first.charge + second.charge)
  assert.equal(Object.values(meter.snapshot().liveBytesByRecordKind).reduce((a, b) => a + b, 0), second.charge)
  assert.equal(meter.snapshot().liveRecordCount, 3); assert.equal(meter.snapshot().peakOutstandingBytes, 100); checks++
  const readTx = db.transaction('kv', 'readonly'), key = 'writer-campaign:test:head', request = readTx.objectStore('kv').get(key)
  request.result = '文😀'; request.dispatchEvent(new Event('success')); readTx.dispatchEvent(new Event('complete'))
  assert.equal(meter.snapshot().totalReadBytes, bytes(key) + bytes('文😀')); assert.equal(meter.snapshot().maxReadBatchKeys, 1); checks++
  const abortedRead = db.transaction('kv', 'readwrite'), read = abortedRead.objectStore('kv').get(key)
  read.result = 'x'; read.dispatchEvent(new Event('success')); abortedRead.dispatchEvent(new Event('abort'))
  assert.equal(meter.snapshot().totalReadCalls, 2)
  assert.equal(meter.snapshot().totalReadBytes, 2 * bytes(key) + bytes('文😀x')); checks++
  const oracle = write(first.charge + second.charge); oracle.tx.__campaignOracle = true; oracle.tx.dispatchEvent(new Event('complete'))
  assert.equal(meter.snapshot().committedTransactions, 2); checks++
  const bad = write(first.charge + second.charge); bad.tx.objectStore('kv').put('RAW_PRIVATE_CANARY', 'writer-campaign:test:artifact:0'); bad.tx.dispatchEvent(new Event('complete'))
  assert.equal(meter.snapshot().accountingMismatches, 2)
  assert.equal(JSON.stringify(meter.snapshot()).includes('RAW_PRIVATE_CANARY'), false); checks++
  assert.equal(meter.restartIdentity().checkpointHash, 'a'.repeat(64))
  const missing = db.transaction('kv', 'readwrite')
  missing.objectStore('kv').put(JSON.stringify({ checkpointHash: 'a'.repeat(64) }), 'writer-campaign:test:head')
  missing.dispatchEvent(new Event('complete'))
  assert.throws(() => meter.restartIdentity(), 'Completed write without a checkpoint invalidates the old identity'); checks++
  const divergent = write(meter.snapshot().cumulativeWrittenBytes)
  divergent.tx.objectStore('kv').put(JSON.stringify({ sequence: 0, checkpointHash: 'b'.repeat(64) }), 'writer-campaign:test:head')
  divergent.tx.dispatchEvent(new Event('complete'))
  assert.throws(() => meter.restartIdentity(), 'Mismatched committed head/checkpoint cannot provide a restart identity'); checks++
  meter.reset(); assert.equal(meter.snapshot().cumulativeWrittenBytes, 0); assert.equal(meter.snapshot().liveRecordCount, 0); assert.throws(() => meter.restartIdentity()); checks++
  process.stdout.write(`Campaign storage native meter model: ${checks} checks passed; not real IndexedDB evidence.\n`)
} catch { process.stderr.write(`Campaign storage meter model failed after ${checks} checks.\n`); process.exitCode = 1 }
