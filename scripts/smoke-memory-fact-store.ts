/** Real graph-store code against an exclusive, commit/abort-aware IndexedDB double. */
import assert from 'node:assert/strict'
import type { FactGraphDocument } from '../src/types/factGraph'

interface Request {
  result?: unknown
  error?: Error
  onsuccess?: () => void
  onerror?: () => void
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

const disk = new Map<string, string>()
const queue: Array<() => Promise<void>> = []
const modes: string[] = []
let active = false
let failNextWrite = false
let nextCommitGate: Promise<void> | undefined

function schedule() {
  if (active || queue.length === 0) return
  active = true
  const run = queue.shift()!
  queueMicrotask(() => { void run().finally(() => { active = false; schedule() }) })
}

function transaction(name: string, mode: string) {
  assert.equal(name, 'kv')
  assert.ok(mode === 'readonly' || mode === 'readwrite')
  modes.push(mode)
  const reads: Array<{ key: string; request: Request }> = []
  const writes: Array<{ key: string; value: string }> = []
  const fail = mode === 'readwrite' && failNextWrite
  const gate = mode === 'readwrite' ? nextCommitGate : undefined
  if (mode === 'readwrite') { failNextWrite = false; nextCommitGate = undefined }
  let aborted = false
  const tx = {
    error: null as Error | null,
    oncomplete: undefined as (() => void) | undefined,
    onabort: undefined as (() => void) | undefined,
    onerror: undefined as (() => void) | undefined,
    abort() { aborted = true },
    objectStore() {
      return {
        get(key: string) {
          const request: Request = {}
          reads.push({ key, request })
          return request
        },
        put(value: string, key: string) {
          assert.equal(mode, 'readwrite', 'Writes must participate in an exclusive transaction')
          writes.push({ key, value })
          return {}
        },
      }
    },
  }
  queue.push(async () => {
    // Read only when this transaction obtains the store lock, not at construction.
    for (const { key, request } of reads) {
      request.result = disk.get(key)
      request.onsuccess?.()
    }
    if (gate) await gate
    if (aborted || fail) {
      tx.error = new Error('Injected transaction abort after staged put')
      tx.onabort?.()
    } else {
      for (const { key, value } of writes) disk.set(key, value)
      tx.oncomplete?.()
    }
  })
  schedule()
  return tx
}

Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
  open() {
    const request: Request = {}
    queueMicrotask(() => {
      request.result = { transaction, objectStoreNames: { contains: () => true }, close() {} }
      request.onsuccess?.()
    })
    return request
  },
} })

const { idbCompareAndSwap } = await import('../src/services/blobStore')
const { readFactGraph, saveFactGraph } = await import('../src/services/memory/factGraphStore')
const { FACT_GRAPH_MAX_DOCUMENT_CHARS } = await import('../src/services/memory/factGraph')
const key = (projectId: string) => `memory-fact-graph:v1:${projectId}`
const document = (projectId = 'graph-novel'): FactGraphDocument => ({
  version: 1, projectId, revision: '', relations: [{
    id: 'edge-1', projectId, source: { type: 'person', label: '阿宁' },
    target: { type: 'object', label: '铜铃' }, predicate: '可能借铜铃接应',
    origin: 'inferred', createdBy: 'model', authorConfirmed: true,
    evidence: [{ chapterId: 'chapter-1', sourceRevision: 'a'.repeat(64), start: 0, end: 6, quote: '阿宁摇响铜铃' }],
  }],
})

assert.deepEqual(await readFactGraph('graph-novel'), {
  version: 1, projectId: 'graph-novel', revision: '', relations: [],
})
assert.equal(disk.size, 0, 'Reading absent annotations must not create or seed them')
const first = await saveFactGraph(document(), null)
assert.match(first.revision, /^[0-9a-f-]{36}$/)
assert.deepEqual(await readFactGraph('graph-novel'), first)
assert.equal(first.relations[0]!.origin, 'inferred')
assert.equal(first.relations[0]!.createdBy, 'model')
assert.equal(first.relations[0]!.authorConfirmed, true)
console.log('✓ Empty reads do not write; committed graph revision and independent provenance survive reload')

const left = structuredClone(first)
const right = structuredClone(first)
left.relations[0]!.predicate = 'left tab change'
right.relations[0]!.predicate = 'right tab change'
const concurrent = await Promise.allSettled([
  saveFactGraph(left, first.revision), saveFactGraph(right, first.revision),
])
assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1)
assert.equal(concurrent.filter(result => result.status === 'rejected').length, 1)
const winner = concurrent.find(result => result.status === 'fulfilled')
assert.ok(winner?.status === 'fulfilled')
assert.deepEqual(await readFactGraph('graph-novel'), winner.value)
const rejected = concurrent.find(result => result.status === 'rejected')
assert.ok(rejected?.status === 'rejected')
assert.match(String(rejected.reason), /其他窗口修改/)
const committed = disk.get(key('graph-novel'))
await assert.rejects(saveFactGraph(left, first.revision), /其他窗口修改/)
assert.equal(disk.get(key('graph-novel')), committed)
console.log('✓ Two independent tabs reading one revision produce exactly one winner; stale revisions preserve the winner')

const caller = structuredClone(winner.value)
const callerOriginal = structuredClone(caller)
const saving = saveFactGraph(caller, caller.revision)
caller.relations[0]!.predicate = 'changed after invocation'
caller.relations[0]!.evidence[0]!.quote = 'corrupt caller mutation'
const saved = await saving
assert.equal(saved.relations[0]!.predicate, callerOriginal.relations[0]!.predicate)
assert.equal(saved.relations[0]!.evidence[0]!.quote, callerOriginal.relations[0]!.evidence[0]!.quote)
saved.relations[0]!.predicate = 'mutated returned snapshot'
assert.equal((await readFactGraph('graph-novel')).relations[0]!.predicate, callerOriginal.relations[0]!.predicate)
console.log('✓ Mutating a queued input or returned document cannot modify the committed annotation snapshot')

const rawKey = 'cas-primitive'
disk.set(rawKey, 'base')
const beforeModes = modes.length
assert.equal(await idbCompareAndSwap(rawKey, 'wrong', 'bad'), false)
assert.deepEqual(modes.slice(beforeModes), ['readwrite'], 'Read and conditional put share one exclusive transaction')
assert.equal(disk.get(rawKey), 'base')
const casResults = await Promise.all([
  idbCompareAndSwap(rawKey, 'base', 'first'), idbCompareAndSwap(rawKey, 'base', 'second'),
])
assert.deepEqual(casResults, [true, false])
assert.equal(disk.get(rawKey), 'first')
console.log('✓ Conditional compare and write occur in one exclusive transaction and reject a competing writer')

const commitGate = deferred()
nextCommitGate = commitGate.promise
let completed = false
const held = idbCompareAndSwap(rawKey, 'first', 'committed').then(value => { completed = true; return value })
await new Promise<void>(resolve => setImmediate(resolve))
assert.equal(completed, false, 'A successful put must not resolve before the transaction commits')
assert.equal(disk.get(rawKey), 'first')
commitGate.resolve()
assert.equal(await held, true)
assert.equal(disk.get(rawKey), 'committed')
failNextWrite = true
await assert.rejects(idbCompareAndSwap(rawKey, 'committed', 'aborted'), /transaction abort/)
assert.equal(disk.get(rawKey), 'committed')
const beforeAbort = await readFactGraph('graph-novel')
failNextWrite = true
await assert.rejects(saveFactGraph(beforeAbort, beforeAbort.revision), /transaction abort/)
assert.deepEqual(await readFactGraph('graph-novel'), beforeAbort)
console.log('✓ Held and aborted writes never report an uncommitted revision or leave partial graph data')

for (const [projectId, raw] of [
  ['broken-json', '{malformed'],
  ['missing-revision', JSON.stringify(document('missing-revision'))],
  ['cross-project', JSON.stringify({ ...document('someone-else'), revision: 'stored' })],
] as const) {
  disk.set(key(projectId), raw)
  await assert.rejects(readFactGraph(projectId))
  await assert.rejects(saveFactGraph(document(projectId), null))
  assert.equal(disk.get(key(projectId)), raw, 'Corrupt source must not be silently replaced')
}
disk.set(key('over-budget'), ' '.repeat(FACT_GRAPH_MAX_DOCUMENT_CHARS + 1))
await assert.rejects(readFactGraph('over-budget'), /2,400 万字符上限/)
await assert.rejects(saveFactGraph(document('over-budget'), null), /2,400 万字符上限/)
assert.equal(disk.get(key('over-budget'))!.length, FACT_GRAPH_MAX_DOCUMENT_CHARS + 1)
console.log('✓ Invalid JSON, missing revision, project mismatch, and oversized stored JSON stay untouched')

const isolated = await saveFactGraph(document('other-project'), null)
assert.deepEqual(await readFactGraph('other-project'), isolated)
assert.deepEqual(await readFactGraph('graph-novel'), beforeAbort)
await assert.rejects(saveFactGraph(document('bad-expectation'), ''), /有效的已读取版本/)
assert.equal(disk.has(key('bad-expectation')), false)
console.log('✓ Project keys and expected revisions remain isolated; invalid saves create no storage')
