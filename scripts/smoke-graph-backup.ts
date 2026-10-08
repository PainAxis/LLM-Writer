/** Paired source/graph backups against a commit-aware, exclusive IndexedDB double. */
import assert from 'node:assert/strict'
import { MemoryIndex } from '../src/services/memory/engine'
import { createMemoryDemo } from '../src/services/memory/labData'
import { createDemoFactGraph, selectFactGraph } from '../src/services/memory/factGraph'
import { readFactGraph, saveFactGraph } from '../src/services/memory/factGraphStore'
import { createBackup, parseBackup, restoreBackup } from '../src/services/backup'
import { StorageKeys, storageReadCommitted, storageSet } from '../src/utils/storage'
import { createFactGraphCorpus } from './fixtures/memory-fact-graph-corpus'
import type { FactGraphDocument } from '../src/types/factGraph'

interface Request { result?: unknown; onsuccess?: () => void; onerror?: () => void }
const disk = new Map<string, string>()
const local = new Map<string, string>()
let transactionQueue = Promise.resolve()
let failWrite = false
let failGraphTransaction = false
let beforeGraphWrite: (() => void) | undefined
let beforeGraphRead: (() => void) | undefined
let beforeLocalWrite: ((key: string) => void) | undefined
let afterLocalWrite: ((key: string) => void) | undefined
let afterLocalRead: ((key: string) => void) | undefined
function transaction(_name: string, mode: string) {
  const reads: Array<{ key: string; request: Request }> = []
  const writes: Array<{ key: string; value: string | null }> = []
  let aborted = false
  const tx = {
    error: null as Error | null,
    oncomplete: undefined as (() => void) | undefined,
    onabort: undefined as (() => void) | undefined,
    onerror: undefined as (() => void) | undefined,
    abort() { aborted = true },
    objectStore() { return {
      get(key: string) { const request: Request = {}; reads.push({ key, request }); return request },
      put(value: string, key: string) { assert.equal(mode, 'readwrite'); writes.push({ key, value }) },
      delete(key: string) { assert.equal(mode, 'readwrite'); writes.push({ key, value: null }) },
    } },
  }
  transactionQueue = transactionQueue.then(() => {
    const hook = mode === 'readwrite' ? beforeGraphWrite : beforeGraphRead
    if (mode === 'readwrite') beforeGraphWrite = undefined
    else beforeGraphRead = undefined
    hook?.()
    for (const { key, request } of reads) { request.result = disk.get(key); request.onsuccess?.() }
    const graphFailure = failGraphTransaction && writes.some(row => row.key.startsWith('memory-fact-graph:'))
    if (aborted || (mode === 'readwrite' && failWrite) || graphFailure) {
      failWrite = false
      if (graphFailure) failGraphTransaction = false
      tx.error = new Error('Injected graph transaction abort')
      tx.onabort?.()
    } else {
      for (const { key, value } of writes) {
        if (value === null) disk.delete(key)
        else disk.set(key, value)
      }
      tx.oncomplete?.()
    }
  })
  return tx
}
Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() {
  const request: Request = {}
  queueMicrotask(() => {
    request.result = { transaction, objectStoreNames: { contains: () => true }, close() {} }
    request.onsuccess?.()
  })
  return request
} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem(key: string) { const value = local.get(key) ?? null; afterLocalRead?.(key); return value },
  setItem(key: string, value: string) { beforeLocalWrite?.(key); local.set(key, value); afterLocalWrite?.(key) },
  removeItem: (key: string) => void local.delete(key),
} })
const graphKey = (projectId: string) => `memory-fact-graph:v1:${projectId}`
const relationData = (document: FactGraphDocument) => ({ ...document, revision: '' })
const demo = await createMemoryDemo()
const project = { ...demo, id: 'novel:1', clues: [] }
const seeded = await createDemoFactGraph(demo)
seeded.projectId = project.id
seeded.relations.forEach(relation => { relation.projectId = project.id })
seeded.relations.find(relation => relation.origin === 'inferred')!.authorConfirmed = true
const novel = { id: 1, title: project.title, chapterList: project.chapters.map(chapter => ({
  id: chapter.id, title: chapter.title, content: chapter.text,
})) }
await storageSet(StorageKeys.novels, [novel])
const original = await saveFactGraph(seeded, null)
const demoGraph = { ...seeded, projectId: 'memory-demo', revision: '', relations: [] }
await saveFactGraph(demoGraph, null)
const backup = await createBackup(['novels'])
assert.deepEqual(Object.keys(backup.data).sort(), ['factGraphs', 'novels'])
assert.deepEqual(backup.data.factGraphs, [original], 'Export all retained relations without disclosure filtering')
assert.ok(!(await createBackup(['settings'])).data.factGraphs)
local.clear()
disk.clear()
assert.equal(await restoreBackup(backup, ['novels']), 1)
const restored = await readFactGraph(project.id)
assert.notEqual(restored.revision, original.revision, 'Never resurrect an old CAS token')
assert.deepEqual(relationData(restored), relationData(original))
assert.deepEqual(JSON.parse(local.get(StorageKeys.novels)!), [novel])
await assert.rejects(saveFactGraph(original, original.revision), /其他窗口修改/)
const index = new MemoryIndex()
const stats = await index.sync(project)
assert.ok(selectFactGraph(project, stats, restored, 'c40', '铜铃').relations.length > 0)
assert.equal(selectFactGraph(project, stats, restored, 'c40', '玄衣客').relations.length, 0)
assert.equal(selectFactGraph(project, stats, restored, 'c80', '玄衣客').relations.length, 1)
assert.equal(selectFactGraph(project, stats, restored, 'c2').relations.some(row => row.origin === 'inferred'), false)
assert.equal(selectFactGraph(project, stats, restored, 'c40').relations.find(row => row.origin === 'inferred')!.authorConfirmed, true)
console.log('✓ Clean restore preserves exact sources, all provenance, distant clues and every inference premise; future facts stay hidden')

const changed = structuredClone(project)
changed.chapters[0]!.text = '顾行将银钥匙交给阿宁，旧有托付已经改写。'
const editedNovel = structuredClone(novel)
editedNovel.chapterList[0]!.content = changed.chapters[0]!.text
await storageSet(StorageKeys.novels, [editedNovel])
const staleBackup = await createBackup(['novels'])
assert.deepEqual(staleBackup.data.factGraphs![0]!.relations, original.relations, 'Stale annotations remain recoverable, not silently discarded')
await restoreBackup(staleBackup)
const changedStats = await index.sync(changed)
assert.equal(selectFactGraph(changed, changedStats, await readFactGraph(project.id), 'c80', '银钥匙').relations.length, 0)
assert.ok(selectFactGraph(changed, changedStats, await readFactGraph(project.id), 'c40', '铜铃').relations.length > 0)
assert.equal(selectFactGraph(changed, changedStats, await readFactGraph(project.id), 'c40', '玄衣客').relations.length, 0)
console.log('✓ Backup and restore never rebase old anchors onto edited prose, including author-confirmed facts')

const current = await readFactGraph(project.id)
await restoreBackup({ novels: [novel] })
assert.deepEqual(await readFactGraph(project.id), current, 'Legacy missing sidecar preserves current graph document')
await restoreBackup({ ...backup, data: { novels: [novel], factGraphs: [] } })
const empty = await readFactGraph(project.id)
assert.deepEqual(empty.relations, [])
assert.ok(empty.revision && empty.revision !== current.revision)
await assert.rejects(saveFactGraph(current, current.revision), /其他窗口修改/)
await restoreBackup(backup)
console.log('✓ Legacy absence preserves annotations; explicit empty sidecar clears paired graphs and invalidates open-tab tokens')

const invalid: unknown[] = [
  { factGraphs: backup.data.factGraphs },
  { novels: [novel], factGraphs: {} },
  { novels: [novel], factGraphs: [original, original] },
  { novels: [novel, { ...novel, id: '1' }], factGraphs: [] },
  { novels: [{ ...novel, chapterList: [{ id: 1, title: 'A' }, { id: '1', title: 'B' }] }], factGraphs: [] },
  { novels: [novel], factGraphs: [{ ...original, projectId: 'novel:foreign' }] },
  { novels: [novel], factGraphs: [{ ...original, revision: '' }] },
]
for (const change of [
  { sourceRevision: 'invalid' }, { end: 999 }, { quote: 'forged' }, { start: -1 },
]) {
  const malformed = structuredClone(original)
  Object.assign(malformed.relations[0]!.evidence[0]!, change)
  invalid.push({ novels: [novel], factGraphs: [malformed] })
}
const originalLocal = new Map(local)
const originalDisk = new Map(disk)
for (const data of invalid) await assert.rejects(restoreBackup({ ...backup, data }), /备份数据格式错误/)
assert.deepEqual(local, originalLocal)
assert.deepEqual(disk, originalDisk)
await restoreBackup({ ...backup, data: { ...backup.data, prompts: [] } }, ['prompts'])
assert.deepEqual(disk, originalDisk, 'Unselected novels never import graphs')
disk.set(graphKey(project.id), '{corrupt')
await assert.rejects(createBackup(['novels']), /损坏/)
assert.equal(disk.get(graphKey(project.id)), '{corrupt')
await restoreBackup(backup)
assert.deepEqual(relationData(await readFactGraph(project.id)), relationData(original), 'Valid backup repairs corrupt graph storage')
console.log('✓ Malformed, mismatched and ambiguous bundles fail before writes; valid backup can repair corrupt storage')

const otherId = 'novel:2'
const second = { ...original, projectId: otherId, revision: '', relations: original.relations.map(row => ({ ...row, projectId: otherId })) }
const secondStored = await saveFactGraph(second, null)
await storageSet(StorageKeys.novels, [novel, { ...novel, id: 2 }])
const multiple = await createBackup(['novels'])
const beforeFailedLocal = new Map(local)
const beforeFailedDisk = new Map(disk)
failWrite = true
await assert.rejects(restoreBackup(multiple), /已恢复导入前的数据.*transaction abort/)
assert.deepEqual(local, beforeFailedLocal)
assert.deepEqual(disk, beforeFailedDisk, 'Failed multi-document graph commit is atomic')

const concurrentDocument = { ...secondStored, revision: 'another-tab-committed', relations: [] }
beforeGraphWrite = () => { disk.set(graphKey(otherId), JSON.stringify(concurrentDocument)) }
await assert.rejects(restoreBackup(multiple), /已恢复导入前的数据.*其他窗口修改/)
assert.deepEqual(await readFactGraph(otherId), concurrentDocument)
assert.equal(disk.get(graphKey(project.id)), beforeFailedDisk.get(graphKey(project.id)), 'A conflict in the second graph cannot partially overwrite the first')
assert.deepEqual(local, beforeFailedLocal)
console.log('✓ Multi-project graph failures roll back novel writes; concurrent graph annotations win without partial graph replacement')

const sourceBeforeConflict = structuredClone(novel)
sourceBeforeConflict.title = 'Another tab saved this title'
beforeGraphWrite = () => { local.set(StorageKeys.novels, JSON.stringify([sourceBeforeConflict])) }
await assert.rejects(restoreBackup(backup), /部分数据未能恢复原状.*其他窗口修改/)
assert.deepEqual(JSON.parse(local.get(StorageKeys.novels)!), [sourceBeforeConflict], 'Rollback must not overwrite a concurrent source edit')

const mutable = structuredClone(backup)
const captured = restoreBackup(mutable)
mutable.data.factGraphs![0]!.relations[0]!.predicate = 'mutated pending caller'
;(mutable.data.novels as Array<typeof novel>)[0]!.title = 'mutated pending source'
await captured
assert.deepEqual(relationData(await readFactGraph(project.id)), relationData(original))
assert.equal(JSON.parse(local.get(StorageKeys.novels)!)[0].title, novel.title)
console.log('✓ Concurrent novel edits are retained on failed rollback, and queued restore inputs are isolated from caller mutation')

// Force one source change precisely between the source read and graph snapshot.
beforeGraphRead = () => {
  local.set(StorageKeys.novels, JSON.stringify([editedNovel]))
  const updated = { ...original, revision: 'export-race', relations: original.relations.slice(2) }
  disk.set(graphKey(project.id), JSON.stringify(updated))
}
const raced = await createBackup(['novels'])
assert.deepEqual(raced.data.novels, [editedNovel])
assert.equal(raced.data.factGraphs![0]!.revision, 'export-race')
let failOnce = true
beforeLocalWrite = key => {
  if (key === StorageKeys.prompts && failOnce) { failOnce = false; throw new Error('Injected later settings failure') }
}
const beforeLate = new Map(disk)
const reportError = console.error
console.error = () => {} // Expected injected failure; never print a backup payload.
try {
  await assert.rejects(restoreBackup({ ...backup, data: { ...backup.data, prompts: [] } }), /已恢复导入前的数据/)
} finally { console.error = reportError }
beforeLocalWrite = undefined
assert.deepEqual(disk, beforeLate, 'Graph replacement is last, so later settings failure cannot leave imported graphs')
console.log('✓ Export retries source/graph races; failures in another selected category leave graph storage unchanged')

const corpus = await createFactGraphCorpus()
corpus.project.id = 'novel:large'
corpus.document.projectId = corpus.project.id
corpus.document.relations.forEach(row => { row.projectId = corpus.project.id })
const largeNovel = { id: 'large', title: corpus.project.title, chapterList: corpus.project.chapters.map(chapter => ({
  id: chapter.id, title: chapter.title, content: chapter.text,
})) }
await storageSet(StorageKeys.novels, [largeNovel])
await saveFactGraph(corpus.document, null)
const largeBackup = await createBackup(['novels'])
const serialized = JSON.stringify(largeBackup)
assert.equal(parseBackup(JSON.parse(serialized)).factGraphs![0]!.relations.length, 5_400)
await restoreBackup(JSON.parse(serialized))
assert.deepEqual((await readFactGraph(corpus.project.id)).relations, corpus.document.relations)
assert.deepEqual(JSON.parse(local.get(StorageKeys.novels)!), [largeNovel])
console.log(`✓ ${corpus.manifest.chapters} chapters, ${corpus.manifest.chars} source characters, 5,400 relations round-trip exactly (${serialized.length} backup characters)`)

// Exercise the real >1.5M-character chunk backend, not only the small-value mock.
const { initNovelPersistence, subscribeNovelPersistenceStatus } = await import('../src/services/novelPersistence')
Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
const previousLarge = structuredClone(largeNovel)
previousLarge.chapterList[0]!.content += '分片正文。'.repeat(50_000)
local.set(StorageKeys.novels, JSON.stringify([previousLarge]))
await initNovelPersistence()
const changedLarge = structuredClone(previousLarge)
changedLarge.title = '准备导入的新作品标题'
// Intentionally vary field insertion order: receipts must identify persisted
// metadata, not compare incoming JSON to hydrated object serialization.
changedLarge.chapterList = changedLarge.chapterList.map(chapter => ({ content: chapter.content, id: chapter.id, title: chapter.title }))
const splitBackup = { ...largeBackup, data: { novels: [changedLarge], factGraphs: largeBackup.data.factGraphs } }
const graphBeforeSplit = await readFactGraph(corpus.project.id)
failGraphTransaction = true
await assert.rejects(restoreBackup(splitBackup), /已恢复导入前的数据.*transaction abort/)
assert.deepEqual(await storageReadCommitted(StorageKeys.novels), [previousLarge])
const splitMetadata = JSON.parse(local.get(StorageKeys.novels)!) as Array<typeof previousLarge>
assert.ok('contentRef' in splitMetadata[0]!.chapterList[0]!)
assert.equal(splitMetadata[0]!.chapterList[0]!.content, undefined)
assert.deepEqual(await readFactGraph(corpus.project.id), graphBeforeSplit)
console.log('✓ Real split-content backend rolls back a failed graph restore with different input/hydrated field order and fresh blob references')

const competingLarge = structuredClone(previousLarge)
competingLarge.title = 'Concurrent source wins after the import commit'
afterLocalWrite = key => {
  if (key !== StorageKeys.novels) return
  afterLocalWrite = undefined
  queueMicrotask(() => { local.set(StorageKeys.novels, JSON.stringify([competingLarge])) })
}
await assert.rejects(restoreBackup(splitBackup), /部分数据未能恢复原状.*其他窗口修改/)
assert.deepEqual(JSON.parse(local.get(StorageKeys.novels)!), [competingLarge])
assert.deepEqual(await readFactGraph(corpus.project.id), graphBeforeSplit)
console.log('✓ Real metadata commit receipt detects an edit before async save returns, preserving the concurrent source and original graph')

await initNovelPersistence()
let throwSavedNotification = false
const unsubscribe = subscribeNovelPersistenceStatus(status => {
  if (throwSavedNotification && status.phase === 'saved' && status.pending === 0) {
    throwSavedNotification = false
    throw new Error('Injected postcommit notification failure')
  }
})
throwSavedNotification = true
await assert.rejects(restoreBackup(splitBackup), /已恢复导入前的数据.*postcommit notification/)
unsubscribe()
assert.deepEqual(await storageReadCommitted(StorageKeys.novels), [competingLarge])
assert.deepEqual(await readFactGraph(corpus.project.id), graphBeforeSplit)
console.log('✓ Postcommit notification rejection still rolls back the actual committed source via its captured receipt')

// A microtask between an async rollback read and write used to lose this edit.
// The conditional rollback must compare and replace synchronously in the gate.
const oldPrompts = [{ id: 1, title: '原提示词', content: '原内容' }]
const newPrompts = [{ id: 1, title: '导入提示词', content: '导入内容' }]
const concurrentPrompts = [{ id: 1, title: '并发提示词', content: '并发内容' }]
local.set(StorageKeys.prompts, JSON.stringify(oldPrompts))
let rollbackStarted = false
let promptRaceInjected = false
beforeLocalWrite = key => {
  if (key === StorageKeys.novelGenres && !rollbackStarted) {
    rollbackStarted = true
    throw new Error('Injected later category failure')
  }
}
afterLocalRead = key => {
  if (rollbackStarted && key === StorageKeys.prompts && !promptRaceInjected) {
    promptRaceInjected = true
    queueMicrotask(() => local.set(StorageKeys.prompts, JSON.stringify(concurrentPrompts)))
  }
}
console.error = () => {} // Expected storage failure; never print backup contents.
try {
  await assert.rejects(restoreBackup({
    format: 'llm-writer-backup', version: 2, data: { prompts: newPrompts, novelGenres: [] },
  }, ['prompts', 'novelGenres']), /Injected later category failure/)
} finally { afterLocalRead = undefined; beforeLocalWrite = undefined; console.error = reportError }
assert.ok(promptRaceInjected)
assert.deepEqual(JSON.parse(local.get(StorageKeys.prompts)!), concurrentPrompts,
  'Rollback must not await between its expected-value check and synchronous replacement')
console.log('✓ Generic rollback compare and replacement preserve a queued concurrent winner without an async read/write gap')
console.log('\n=== ALL GRAPH BACKUP TESTS PASSED ===')
