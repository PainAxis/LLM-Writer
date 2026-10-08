/** Execute the actual worker module and its engine against a controlled host. */
import assert from 'node:assert/strict'
import type { MemoryWorkerRequest, MemoryWorkerResponse } from '../src/types/memory'

let receive!: (event: MessageEvent<MemoryWorkerRequest>) => Promise<void>
const messages: MemoryWorkerResponse[] = []
let changed!: () => void
const host = {
  get onmessage() { return receive },
  set onmessage(value: typeof receive) { receive = value },
  postMessage(value: MemoryWorkerResponse) { messages.push(value); changed?.() },
}
// tsx/esbuild may consult the worker global while compiling an uncached import.
// Preserve standard JS constructors as a real WorkerGlobalScope does.
Object.setPrototypeOf(host, globalThis)
const oldSelf = Object.getOwnPropertyDescriptor(globalThis, 'self')
Object.defineProperty(globalThis, 'self', { configurable: true, value: host })
const oldFetch = globalThis.fetch
let requests = 0
globalThis.fetch = async (_input, init) => {
  requests++
  const body = JSON.parse(String(init?.body)) as { input: string[] }
  return Response.json({ data: body.input.map((_, index) => ({ index, embedding: [1, 0] })) })
}
const send = (data: MemoryWorkerRequest) => receive({ data } as MessageEvent<MemoryWorkerRequest>)
async function message(predicate: (value: MemoryWorkerResponse) => boolean): Promise<MemoryWorkerResponse> {
  for (;;) {
    const found = messages.find(predicate)
    if (found) return found
    await new Promise<void>(resolve => { changed = resolve })
  }
}
const project = { id: 'guard-fixture', title: '来源门控', chapters: [{ id: 'c1', title: '首章', text: '阿宁将铜铃系在窗边。' }], clues: [] }
const query = { text: '铜铃', throughChapterId: 'c1' }
const options = { embedding: { protocol: 'jina' as const, endpoint: 'https://guard.test/embeddings', model: 'synthetic', apiKey: 'test', dimensions: 2 } }

try {
  await import('../src/services/memory/memory.worker')
  await send({ id: 1, type: 'sync', project })
  const pending = send({ id: 2, type: 'search', query, options, guardRemote: true })
  const first = await message(value => value.id === 2 && value.ok && value.type === 'remote-check')
  assert.ok(first.ok && first.type === 'remote-check')
  assert.equal(requests, 0, 'No provider transport occurs until the host verifies saved sources')
  await send({ id: 999, type: 'remote-ack', guardId: first.guardId, ok: true })
  assert.equal(requests, 0, 'A correct guard number under a wrong request cannot grant permission')
  await send({ id: 2, type: 'remote-ack', guardId: first.guardId, ok: true })
  const second = await message(value => value.id === 2 && value.ok && value.type === 'remote-check' && value.guardId !== first.guardId)
  assert.ok(second.ok && second.type === 'remote-check')
  assert.equal(requests, 1, 'Query embedding needs another freshness check after passage embedding')
  await send({ id: 2, type: 'remote-ack', guardId: second.guardId, ok: false })
  await pending
  const failed = messages.find(value => value.id === 2 && !value.ok)
  assert.ok(failed && !failed.ok)
  assert.match(failed.error, /校验失败/)
  assert.equal(requests, 1, 'Guard failure is fatal, not a provider fallback that can launch more requests')
  console.log('✓ Actual worker requests independent source approvals for passage/query transport and ignores forged request IDs')

  await send({ id: 3, type: 'sync', project })
  const before = requests
  const cancelled = send({ id: 4, type: 'search', query, options, guardRemote: true })
  const held = await message(value => value.id === 4 && value.ok && value.type === 'remote-check')
  assert.ok(held.ok && held.type === 'remote-check')
  await send({ id: 5, type: 'invalidate' })
  await cancelled
  await send({ id: 4, type: 'remote-ack', guardId: held.guardId, ok: true })
  assert.equal(requests, before)
  assert.ok(messages.some(value => value.id === 4 && !value.ok))
  console.log('✓ Source invalidation rejects a waiting worker guard and late approval cannot resurrect provider traffic')
} finally {
  globalThis.fetch = oldFetch
  if (oldSelf) Object.defineProperty(globalThis, 'self', oldSelf)
  else Reflect.deleteProperty(globalThis, 'self')
}
