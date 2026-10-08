/** Read committed source bodies through the real storage/persistence/IDB stack.
 * The fake schedules request success separately from transaction completion so
 * partial reads cannot accidentally count as a committed source snapshot. */
import assert from 'node:assert/strict'

interface Chapter {
  id: number
  title: string
  content?: string
  contentRef?: string
  [key: string]: unknown
}
interface Novel {
  id: number
  title: string
  chapterList: Chapter[]
  [key: string]: unknown
}
type FakeRequest = { result?: unknown; error?: Error; onsuccess?: () => void; onerror?: () => void }
type ReadPlan = {
  before?: () => void | Promise<void>
  afterRequest?: (count: number) => void
  beforeCommit?: () => void | Promise<void>
  abortAfterRequests?: number
}
const metadata = new Map<string, string>()
const bodies = new Map<string, string>()
const transactions: Array<{ mode: string; keys: string[]; delivered: Array<{ key: string; content: string | undefined }> }> = []
let nextReadPlan: ReadPlan | null = null
let eachReadPlan: (() => ReadPlan) | null = null
let nextWriteGate: Promise<void> | null = null
let failNextMetadata = false
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve))

Object.assign(globalThis, {
  localStorage: {
    get length() { return metadata.size },
    key: (index: number) => [...metadata.keys()][index] ?? null,
    getItem: (key: string) => metadata.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === 'novels' && failNextMetadata) {
        failNextMetadata = false
        throw new Error('Injected committed-source metadata failure')
      }
      metadata.set(key, value)
    },
    removeItem: (key: string) => { metadata.delete(key) },
    clear: () => { metadata.clear() },
  },
  indexedDB: {
    open: () => {
      const request: FakeRequest = {}
      queueMicrotask(() => {
        request.result = { transaction, objectStoreNames: { contains: () => true }, close: () => undefined }
        request.onsuccess?.()
      })
      return request
    },
  },
})

function transaction(_store: string, mode: string) {
  const record = { mode, keys: [] as string[], delivered: [] as Array<{ key: string; content: string | undefined }> }
  transactions.push(record)
  const plan = mode === 'readonly' ? nextReadPlan ?? eachReadPlan?.() ?? {} : {}
  if (mode === 'readonly') nextReadPlan = null
  const writeGate = mode === 'readwrite' ? nextWriteGate : null
  if (mode === 'readwrite') nextWriteGate = null
  const reads: Array<() => void> = []
  const writes: Array<() => void> = []
  let aborted = false
  const tx = {
    error: null as Error | null,
    oncomplete: undefined as (() => void) | undefined,
    onerror: undefined as (() => void) | undefined,
    onabort: undefined as (() => void) | undefined,
    abort: () => {
      aborted = true
      tx.error = new Error('Injected source-read transaction abort')
      tx.onabort?.()
    },
    objectStore: () => ({
      get: (key: string) => {
        const request: FakeRequest = {}
        record.keys.push(key)
        reads.push(() => {
          const content = bodies.get(key)
          record.delivered.push({ key, content })
          request.result = content
          request.onsuccess?.()
        })
        return request
      },
      put: (content: string, key: string) => { writes.push(() => { bodies.set(key, content) }); return {} },
      delete: (key: string) => { writes.push(() => { bodies.delete(key) }); return {} },
      clear: () => { writes.push(() => bodies.clear()); return {} },
    }),
  }
  queueMicrotask(() => {
    void (async () => {
      await plan.before?.()
      if (writeGate) await writeGate
      for (const [index, read] of reads.entries()) {
        if (aborted) return
        read()
        plan.afterRequest?.(index + 1)
        if (plan.abortAfterRequests === index + 1) { tx.abort(); return }
      }
      await plan.beforeCommit?.()
      if (aborted) return
      for (const write of writes) write()
      tx.oncomplete?.()
    })().catch(error => {
      tx.error = error instanceof Error ? error : new Error(String(error))
      tx.onabort?.()
    })
  })
  return tx
}

const fixture = (prefix: string, count = 2): Novel[] => [{
  id: 1, title: 'Committed source fixture',
  chapterList: Array.from({ length: count }, (_, index) => ({
    id: index + 1, title: `Chapter ${index + 1}`, contentRef: `${prefix}:${index + 1}`,
  })),
}]
const seed = (prefix: string, count = 2) => {
  const novels = fixture(prefix, count)
  for (const chapter of novels[0].chapterList) bodies.set(chapter.contentRef!, `${prefix} body ${chapter.id} 铜铃 FS00001`)
  metadata.set('novels', JSON.stringify(novels))
  return novels
}
const expectedBodies = (novels: Novel[]) => novels.map(novel => ({
  ...novel,
  chapterList: novel.chapterList.map(({ contentRef, ...chapter }) => ({
    ...chapter, content: typeof chapter.content === 'string' ? chapter.content : bodies.get(contentRef!)!,
  })),
}))
const readsSince = (start: number) => transactions.slice(start).filter(row => row.mode === 'readonly')
let passed = 0
const check = (label: string) => console.log(`✓ ${++passed}. ${label}`)

async function main() {
  const { hydrateContents, initNovelPersistence, getNovelPersistenceStatus, retryNovelPersistence } = await import('../src/services/novelPersistence')
  const { StorageKeys, storageReadCommitted, storageSet, storageGet } = await import('../src/utils/storage')
  const committed = () => storageReadCommitted(StorageKeys.novels) as Promise<Novel[]>

  {
    const start = transactions.length
    await hydrateContents([])
    const inline: Novel[] = [{ id: 1, title: 'Inline', chapterList: [{ id: 1, title: 'One', content: 'authoritative inline', contentRef: 'stale' }] }]
    bodies.set('stale', 'must not overwrite inline')
    await hydrateContents(inline)
    assert.deepEqual(inline[0].chapterList, [{ id: 1, title: 'One', content: 'authoritative inline' }])
    assert.equal(transactions.length, start, 'Empty/fully inline sources require no IDB transaction')
    check('Empty sources avoid IDB and inline content wins over a stale reference')
  }
  {
    const novels = seed('atomic-success', 3)
    const original = clone(novels)
    const expected = expectedBodies(novels)
    const gate = deferred()
    const requestsSucceeded = deferred()
    const start = transactions.length
    nextReadPlan = {
      afterRequest: () => assert.deepEqual(novels, original, 'Request success alone must not mutate the caller'),
      beforeCommit: () => { requestsSucceeded.resolve(); return gate.promise },
    }
    const loading = hydrateContents(novels)
    await requestsSucceeded.promise
    assert.deepEqual(novels, original, 'All requests can succeed while the transaction remains uncommitted')
    gate.resolve()
    await loading
    assert.deepEqual(novels, expected)
    const reads = readsSince(start)
    assert.equal(reads.length, 1, 'One committed snapshot should hydrate all three bodies')
    assert.deepEqual(reads[0].delivered, original[0].chapterList.map(chapter => ({ key: chapter.contentRef, content: bodies.get(chapter.contentRef!) })))
    check('All bodies are read in one transaction and published only after its completion')
  }
  {
    const novels = seed('missing-second')
    bodies.delete(novels[0].chapterList[1].contentRef!)
    const original = clone(novels)
    const start = transactions.length
    await assert.rejects(hydrateContents(novels), /分片缺失/)
    assert.deepEqual(novels, original, 'A later missing body must preserve all references and all original fields')
    const delivered = readsSince(start).flatMap(row => row.delivered)
    assert.equal(delivered.length, 2)
    assert.equal(delivered[0].content, 'missing-second body 1 铜铃 FS00001')
    assert.equal(delivered[1].content, undefined)
    check('A missing second body rejects the whole read without partial fill or deleted references')
  }
  {
    const novels = seed('partial-abort', 3)
    const original = clone(novels)
    const start = transactions.length
    nextReadPlan = { abortAfterRequests: 1 }
    await assert.rejects(hydrateContents(novels), /transaction abort/)
    assert.deepEqual(novels, original)
    const delivered = readsSince(start).flatMap(row => row.delivered)
    assert.equal(delivered.length, 1, 'The first successful read must not make an aborted transaction usable')
    assert.equal(delivered[0].content, 'partial-abort body 1 铜铃 FS00001')
    check('A transaction abort after request success rejects without publishing any body')
  }
  {
    const novels = seed('duplicate-ref')
    novels[0].chapterList[1].contentRef = novels[0].chapterList[0].contentRef
    const expected = expectedBodies(novels)
    const start = transactions.length
    await hydrateContents(novels)
    assert.deepEqual(novels, expected)
    const reads = readsSince(start)
    assert.equal(reads.length, 1)
    assert.ok(reads[0].delivered.length >= 1 && reads[0].delivered.length <= 2)
    assert.ok(reads[0].delivered.every(row => row.key === 'duplicate-ref:1' && row.content === expected[0].chapterList[0].content))
    check('Repeated references restore each chapter from the same committed body')
  }
  {
    const novels = seed('captured-ref')
    const expected = expectedBodies(novels)
    const start = transactions.length
    nextReadPlan = { before: () => {
      novels[0].chapterList[0].contentRef = novels[0].chapterList[1].contentRef
    } }
    await hydrateContents(novels)
    assert.deepEqual(novels, expected, 'Mutating the caller reference during an await cannot rebind chapter A to chapter B')
    assert.deepEqual(readsSince(start).flatMap(row => row.delivered), [
      { key: 'captured-ref:1', content: expected[0].chapterList[0].content },
      { key: 'captured-ref:2', content: expected[0].chapterList[1].content },
    ])
    check('Each chapter retains the body key captured before the asynchronous read')
  }
  {
    const original = seed('committed-missing')
    await initNovelPersistence()
    const removed = original[0].chapterList[1].contentRef!
    bodies.delete(removed)
    const raw = metadata.get('novels')
    const start = transactions.length
    await assert.rejects(committed(), /分片缺失/)
    assert.equal(metadata.get('novels'), raw)
    assert.equal(readsSince(start).length, 1, 'A stable broken snapshot fails instead of retrying stale cached content')
    assert.equal(storageGet<Novel[]>(StorageKeys.novels, [])[0].chapterList[1].content, 'committed-missing body 2 铜铃 FS00001', 'The editor cache exists but is not accepted as committed evidence')
    bodies.set(removed, 'same reference changed after initialization')
    const recovered = await committed()
    assert.equal(recovered[0].chapterList[1].content, 'same reference changed after initialization', 'Read current body data even if the raw metadata token is unchanged')
    check('Stable metadata plus missing bodies rejects; committed reads never reuse the editor cache')
  }
  {
    seed('retired-source')
    await initNovelPersistence()
    const start = transactions.length
    let expected!: Novel[]
    nextReadPlan = { before: () => {
      const next = seed('replacement-source')
      expected = expectedBodies(next)
      bodies.delete('retired-source:1')
      bodies.delete('retired-source:2')
    } }
    assert.deepEqual(await committed(), expected)
    const reads = readsSince(start)
    assert.equal(reads.length, 2, 'Metadata changed while the retired source was read, so retry the new commit')
    assert.ok(reads[0].delivered.every(row => row.content === undefined))
    assert.ok(reads[1].delivered.every(row => row.content?.startsWith('replacement-source body')))
    check('Concurrent metadata replacement and old-body collection retry the new committed source')
  }
  {
    seed('hot-writer-0')
    await initNovelPersistence()
    let changed = 0
    const start = transactions.length
    eachReadPlan = () => ({ before: () => { seed(`hot-writer-${++changed}`) } })
    try { await assert.rejects(committed(), /频繁保存/) }
    finally { eachReadPlan = null }
    assert.equal(changed, 8)
    assert.equal(readsSince(start).length, 8)
    assert.equal(metadata.get('novels'), JSON.stringify(fixture('hot-writer-8')))
    assert.deepEqual(await committed(), expectedBodies(fixture('hot-writer-8')))
    check('Continuous concurrent changes stop after eight attempts and recover once the source stabilizes')
  }
  {
    seed('local-change-during-read')
    await initNovelPersistence()
    const gate = deferred()
    const readStarted = deferred()
    nextReadPlan = { beforeCommit: () => { readStarted.resolve(); return gate.promise } }
    const reading = committed()
    const rejected = assert.rejects(reading, /读取期间发生变化/)
    await readStarted.promise
    const draft = storageGet<Novel[]>(StorageKeys.novels, [])
    draft[0].chapterList[0].content = 'local edit while source verification is pending'
    const saving = Promise.resolve(storageSet(StorageKeys.novels, draft))
    gate.resolve()
    await Promise.all([saving, rejected])
    assert.deepEqual(await committed(), draft)
    check('A local save begun during source verification invalidates that read instead of approving its replacement')
  }
  {
    seed('pending-local')
    await initNovelPersistence()
    const previousRaw = metadata.get('novels')!
    const gate = deferred()
    nextWriteGate = gate.promise
    const draft: Novel[] = [{ id: 1, title: 'Committed source fixture', chapterList: [
      { id: 1, title: 'Chapter 1', content: 'new saved body'.repeat(125_000) },
    ] }]
    const saving = Promise.resolve(storageSet(StorageKeys.novels, draft))
    const duringSave = committed()
    let settled = false
    void duringSave.then(() => { settled = true }, () => { settled = true })
    await tick()
    assert.equal(getNovelPersistenceStatus().pending, 1)
    assert.equal(settled, false, 'A pending save cannot publish its unsaved draft as committed evidence')
    assert.equal(metadata.get('novels'), previousRaw)
    gate.resolve()
    await saving
    assert.deepEqual(await duringSave, draft)
    assert.equal(getNovelPersistenceStatus().phase, 'saved')
    check('Committed reads wait for the local save and return only the successfully committed body')
  }
  {
    const before = await committed()
    const previousRaw = metadata.get('novels')!
    const draft = clone(before)
    draft[0].chapterList[0].content = 'unsaved replacement must not become source evidence'
    failNextMetadata = true
    await assert.rejects(Promise.resolve(storageSet(StorageKeys.novels, draft)), /metadata failure/)
    const start = transactions.length
    await assert.rejects(committed(), /未保存/)
    assert.equal(transactions.length, start, 'A failed local save is rejected before reading any source bodies')
    assert.equal(metadata.get('novels'), previousRaw)
    assert.equal(storageGet<Novel[]>(StorageKeys.novels, [])[0].chapterList[0].content, draft[0].chapterList[0].content)
    await retryNovelPersistence()
    assert.deepEqual(await committed(), draft)
    check('A failed save blocks evidence reads despite a readable old commit; explicit retry restores access')
  }
  console.log(`\n=== ALL ${passed} SOURCE-HYDRATION TESTS PASSED ===`)
}

const timeout = setTimeout(() => {
  console.error('SOURCE-HYDRATION SMOKE timed out before completing all cases')
  process.exitCode = 1
}, 15_000)
main().catch(error => {
  console.error('\n=== SOURCE-HYDRATION SMOKE FAILED ===', error)
  process.exitCode = 1
}).finally(() => clearTimeout(timeout))
