import assert from 'node:assert/strict'
import { MemoryClient } from '../src/services/memory/client'
import type { MemoryIndexStats, MemoryProjectInput, MemorySearchResult, MemoryWorkerRequest, MemoryWorkerResponse } from '../src/types/memory'

/** Exercise real client cancellation and transport boundaries without browser timing. */
class ControlledWorker {
  static instances: ControlledWorker[] = []
  onmessage: ((event: MessageEvent<MemoryWorkerResponse>) => void) | null = null
  onerror: (() => void) | null = null
  messages: MemoryWorkerRequest[] = []
  terminated = false
  failNextPost = false

  constructor() { ControlledWorker.instances.push(this) }
  postMessage(message: MemoryWorkerRequest) {
    if (this.failNextPost) { this.failNextPost = false; throw new Error('Simulated transport failure') }
    assert.equal(this.terminated, false, 'terminated workers must not receive new requests')
    this.messages.push(structuredClone(message))
  }
  terminate() { this.terminated = true }
  deliver(response: MemoryWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<MemoryWorkerResponse>)
  }
  last() { return this.messages.at(-1)! }
}

const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
Object.defineProperty(globalThis, 'Worker', { configurable: true, value: ControlledWorker })
const client = new MemoryClient()
const project: MemoryProjectInput = {
  id: 'client-fixture', title: 'Client transport fixture',
  chapters: [{ id: 'c1', title: '第一章', text: '银钥匙藏在窗边。' }], clues: [],
}
const stats: MemoryIndexStats = {
  projectId: project.id, fingerprint: 'fixture', chapters: [], chunks: 1, clues: 0,
  staleClues: 0, chars: project.chapters[0]!.text.length, buildMs: 0,
  sync: { mode: 'full', rebuiltChapters: 1, reusedChapters: 0, insertedDocuments: 1, removedDocuments: 0, reusedDocuments: 0 },
}
const result: MemorySearchResult = {
  projectId: project.id, fingerprint: 'fixture', query: '钥匙', throughChapterId: 'c1',
  hits: [], searchMs: 0, method: 'bm25+clues',
  diagnostics: { semantic: 'disabled', rerank: 'disabled', eligiblePassages: 1, embeddedPassages: 0, cachedPassages: 0, rerankedCandidates: 0, warnings: [] },
}
const query = { text: '钥匙', throughChapterId: 'c1' }

try {
  client.invalidateSource()
  assert.equal(ControlledWorker.instances.length, 0, 'invalidation must not create an idle worker')
  const initialSync = client.sync(project)
  const original = ControlledWorker.instances[0]!
  assert.equal(original.last().type, 'sync')
  original.deliver({ id: original.last().id, ok: true, type: 'sync', result: stats })
  assert.deepEqual(await initialSync, stats)

  const interrupted = client.search(query)
  const interruptedId = original.last().id
  const rejection = assert.rejects(interrupted, /来源已改变/)
  client.invalidateSource()
  client.invalidateSource()
  await rejection
  assert.equal(original.terminated, false, 'source invalidation must retain the existing worker')
  assert.equal(ControlledWorker.instances.length, 1)
  assert.deepEqual(original.messages.slice(-2).map(message => message.type), ['invalidate', 'invalidate'])
  original.deliver({ id: interruptedId, ok: true, type: 'search', result })

  const resumedSync = client.sync(structuredClone(project))
  assert.deepEqual(original.messages.slice(-2).map(message => message.type), ['invalidate', 'sync'], 'invalidate must reach the worker before replacement source')
  original.deliver({ id: original.last().id, ok: true, type: 'sync', result: stats })
  assert.deepEqual(await resumedSync, stats)
  const resumed = client.search(query)
  original.deliver({ id: interruptedId, ok: false, error: 'late obsolete response' })
  original.deliver({ id: original.last().id, ok: true, type: 'search', result })
  assert.deepEqual(await resumed, result)
  console.log('✓ Source invalidation rejects pending work, retains its worker, and ignores late results before fresh sync')

  const interruptedSync = client.sync(project)
  const interruptedSyncId = original.last().id
  const syncRejection = assert.rejects(interruptedSync, /来源已改变/)
  client.invalidateSource()
  await syncRejection
  const latestSync = client.sync(project)
  original.deliver({ id: interruptedSyncId, ok: true, type: 'sync', result: { ...stats, fingerprint: 'obsolete-build' } })
  original.deliver({ id: original.last().id, ok: true, type: 'sync', result: stats })
  assert.equal((await latestSync).fingerprint, stats.fingerprint, 'an invalidated build response cannot finish the new sync')

  const invalidSource = { ...project, extra: {} }
  invalidSource.extra = invalidSource
  const beforeInvalid = original.messages.length
  await assert.rejects(client.sync(invalidSource), /circular/i)
  assert.deepEqual(original.messages.slice(beforeInvalid).map(message => message.type), ['invalidate'], 'serialization failure must still invalidate the old worker source')
  assert.equal(original.terminated, false)
  console.log('✓ An uncloneable replacement source invalidates old readiness before serialization fails')

  original.failNextPost = true
  client.invalidateSource()
  assert.equal(original.terminated, true, 'failed invalidation must terminate an unsafe worker')
  const replacementSync = client.sync(project)
  const replacement = ControlledWorker.instances[1]!
  original.onerror?.()
  original.deliver({ id: replacement.last().id, ok: false, error: 'old worker forged replacement ID' })
  replacement.deliver({ id: replacement.last().id, ok: true, type: 'sync', result: stats })
  assert.deepEqual(await replacementSync, stats, 'late error events from disposed workers must not reject the replacement request')
  assert.equal(replacement.terminated, false)

  let releaseGuard!: () => void
  let guardCalls = 0
  const guarded = client.search(query, undefined, async () => {
    guardCalls++
    await new Promise<void>(resolve => { releaseGuard = resolve })
  })
  const guardedId = replacement.last().id
  assert.equal((replacement.last() as { guardRemote?: boolean }).guardRemote, true)
  replacement.deliver({ id: guardedId, ok: true, type: 'remote-check', guardId: 101 })
  assert.equal(guardCalls, 1)
  assert.equal(replacement.last().type, 'search', 'Provider approval waits for committed-source verification')
  releaseGuard()
  await new Promise<void>(resolve => queueMicrotask(resolve))
  assert.deepEqual(replacement.last(), { id: guardedId, type: 'remote-ack', guardId: 101, ok: true })
  replacement.deliver({ id: guardedId, ok: true, type: 'search', result })
  await guarded

  const denied = client.search(query, undefined, async () => { throw new Error('PRIVATE_SOURCE_OR_CREDENTIAL') })
  const deniedId = replacement.last().id
  replacement.deliver({ id: deniedId, ok: true, type: 'remote-check', guardId: 102 })
  await new Promise<void>(resolve => queueMicrotask(resolve))
  assert.deepEqual(replacement.last(), { id: deniedId, type: 'remote-ack', guardId: 102, ok: false })
  assert.ok(!JSON.stringify(replacement.messages).includes('PRIVATE_SOURCE_OR_CREDENTIAL'))
  replacement.deliver({ id: deniedId, ok: false, error: 'source guard denied' })
  await assert.rejects(denied, /source guard denied/)

  const superseded = client.search(query, undefined, async () => { await new Promise<void>(resolve => { releaseGuard = resolve }) })
  const supersededId = replacement.last().id
  replacement.deliver({ id: supersededId, ok: true, type: 'remote-check', guardId: 103 })
  const supersededRejection = assert.rejects(superseded, /来源已改变/)
  client.invalidateSource()
  const messageCount = replacement.messages.length
  releaseGuard()
  await new Promise<void>(resolve => queueMicrotask(resolve))
  await supersededRejection
  assert.equal(replacement.messages.length, messageCount, 'A stale approval cannot acknowledge an invalidated request')
  console.log('✓ Every remote dispatch awaits a live source guard; denials carry no private payload and superseded approvals are discarded')

  const pendingAtDispose = client.search(query)
  const disposalRejection = assert.rejects(pendingAtDispose, /已关闭/)
  client.dispose()
  await disposalRejection
  assert.equal(replacement.terminated, true)
  client.invalidateSource()
  assert.equal(ControlledWorker.instances.length, 2, 'disposal and invalidation must not spawn an unrequested replacement')
  console.log('✓ Failed transport and explicit disposal purge workers; late old-worker events cannot affect replacements')
} finally {
  client.dispose()
  if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker)
  else Reflect.deleteProperty(globalThis, 'Worker')
}
