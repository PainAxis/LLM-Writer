import assert from 'node:assert/strict'
import { StorageKeys, storageGet, storageSet, storageReadCommitted } from '../src/utils/storage'
import { initNovelPersistence, retryNovelPersistence, getNovelPersistenceStatus, subscribeNovelPersistenceStatus } from '../src/services/novelPersistence'
import { useWriterProject } from '../src/composables/useWriterProject'

const disk = new Map<string, string>()
let writes = 0
let fail = false
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => disk.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (fail && key === 'novels') throw new Error('写入失败')
    disk.set(key, value)
    if (key === 'novels') writes++
  }, removeItem: (key: string) => disk.delete(key),
} })
Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
let atGate: (() => void) | undefined
let holdBeforeCommit: Promise<void> | undefined
let holdAcknowledgement: Promise<void> | undefined
let rejectAcknowledgement = false
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
  request: async (_name: string, _options: unknown, callback: () => unknown) => {
    const before = holdBeforeCommit; holdBeforeCommit = undefined
    if (before) await before
    const hook = atGate; atGate = undefined; hook?.()
    const result = callback()
    const hold = holdAcknowledgement; holdAcknowledgement = undefined
    if (hold) await hold
    if (rejectAcknowledgement) { rejectAcknowledgement = false; throw new Error('lock acknowledgement failed after callback') }
    return result
  },
} } })
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const novels = () => [1, 2].map(id => ({ id, title: `作品${id}`, chapterList: [{ id: id * 10, title: '章', content: '旧', status: 'draft' }] }))
const read = () => JSON.parse(disk.get('novels')!) as ReturnType<typeof novels>
const seed = async () => { disk.set('novels', JSON.stringify(novels())); await initNovelPersistence(); writes = 0 }

await seed()
let receipts = 0
const changed = storageGet<ReturnType<typeof novels>>(StorageKeys.novels, [])
changed[0].chapterList[0].content = '本页新'
atGate = () => {
  const remote = read(); remote[0].chapterList[0].content = '其他窗口新'
  disk.set('novels', JSON.stringify(remote))
}
await assert.rejects(Promise.resolve(storageSet(StorageKeys.novels, changed, { onCommit: () => { receipts++ } })), /其他标签页修改/)
assert.equal(receipts, 0)
assert.equal(writes, 0)
assert.equal(read()[0].chapterList[0].content, '其他窗口新')
console.log('✓ ordinary save rejects same-project commit-point CAS race without a receipt or overwrite')

await seed()
const independent = storageGet<ReturnType<typeof novels>>(StorageKeys.novels, [])
independent[0].chapterList[0].content = '本页新'
atGate = () => { const remote = read(); remote[1].chapterList[0].content = '另一作品新'; disk.set('novels', JSON.stringify(remote)) }
await storageSet(StorageKeys.novels, independent, { onCommit: receipt => {
  receipts++
  assert.deepEqual(receipt, { committed: true })
  assert.equal(Object.isFrozen(receipt), true)
  assert.equal(read()[0].chapterList[0].content, '本页新')
  assert.equal(read()[1].chapterList[0].content, '另一作品新')
  throw new Error('observer cannot undo commit')
} })
assert.equal(receipts, 1)
assert.equal(writes, 1)
console.log('✓ ordinary merge preserves another project; metadata-only observer sees actual commit and cannot change outcome')

await seed()
const ack = deferred()
holdAcknowledgement = ack.promise
const held = storageGet<ReturnType<typeof novels>>(StorageKeys.novels, [])
held[0].chapterList[0].content = '已落盘待确认'
let receiptSeen = false
let finished = false
const pending = Promise.resolve(storageSet(StorageKeys.novels, held, { onCommit: () => { receiptSeen = true } })).then(() => { finished = true })
await tick()
assert.equal(receiptSeen, true)
assert.equal(read()[0].chapterList[0].content, '已落盘待确认')
assert.equal(finished, false)
ack.resolve()
await pending
console.log('✓ receipt is synchronous at actual ordinary commit, before the lock acknowledgement await')

await seed()
const acknowledgedLate = storageGet<ReturnType<typeof novels>>(StorageKeys.novels, [])
acknowledgedLate[0].chapterList[0].content = '提交后确认失败'
rejectAcknowledgement = true
await storageSet(StorageKeys.novels, acknowledgedLate)
assert.equal(getNovelPersistenceStatus().phase, 'saved', 'post-commit gate acknowledgement failure is not a global save error')
const subsequent = storageGet<ReturnType<typeof novels>>(StorageKeys.novels, [])
subsequent[0].chapterList[0].content = '下一次真实编辑'
await storageSet(StorageKeys.novels, subsequent)
assert.equal(read()[0].chapterList[0].content, '下一次真实编辑')
assert.equal(writes, 2)
console.log('✓ gate acknowledgement rejection after actual commit preserves tracker baseline and permits the next edit')

await seed()
let rejectSavingNotification = true
const stopRejectingSaving = subscribeNovelPersistenceStatus(status => {
  if (rejectSavingNotification && status.phase === 'saving') {
    rejectSavingNotification = false
    throw new Error('pre-dispatch saving notification failed')
  }
})
const undispatched = storageGet<ReturnType<typeof novels>>(StorageKeys.novels, [])
undispatched[0].chapterList[0].content = '尚未调度的追加'
let undispatchedReceipts = 0
await assert.rejects(Promise.resolve(storageSet(StorageKeys.novels, undispatched, {
  retryPolicy: 'explicit', onCommit: () => { undispatchedReceipts++ },
})), /pre-dispatch saving notification failed/)
stopRejectingSaving()
assert.equal(undispatchedReceipts, 0)
assert.equal(writes, 0)
assert.equal(getNovelPersistenceStatus().pending, 0)
assert.equal(getNovelPersistenceStatus().phase, 'error')
await assert.rejects(storageReadCommitted(StorageKeys.novels), /未保存/)
assert.equal(storageGet<ReturnType<typeof novels>>(StorageKeys.novels, [])[0].chapterList[0].content, '旧')
const concurrentAfterNotification = read()
concurrentAfterNotification[0].chapterList[0].content = '通知失败后其他窗口更新'
disk.set(StorageKeys.novels, JSON.stringify(concurrentAfterNotification))
const ordinaryAfterNotification = storageGet<ReturnType<typeof novels>>(StorageKeys.novels, [])
ordinaryAfterNotification[1].chapterList[0].content = '通知失败后普通编辑'
await storageSet(StorageKeys.novels, ordinaryAfterNotification)
assert.equal(writes, 1, 'pre-dispatch rejection releases the explicit-only pending gate')
assert.equal(read()[0].chapterList[0].content, '通知失败后其他窗口更新', 'abandoned tracker change cannot contaminate the next ordinary request')
assert.equal(read()[1].chapterList[0].content, '通知失败后普通编辑')
assert.equal(getNovelPersistenceStatus().pending, 0)
assert.equal(getNovelPersistenceStatus().phase, 'saved')
console.log('✓ pre-dispatch status rejection propagates while releasing explicit ownership, tracker changes and pending status')

await seed()
let rejectSavedNotification = false
const stopRejectingSaved = subscribeNovelPersistenceStatus(status => {
  if (rejectSavedNotification && status.phase === 'saved' && status.pending === 0) {
    rejectSavedNotification = false
    throw new Error('explicit postcommit saved notification failed')
  }
})
rejectSavedNotification = true
const savedDespiteNotification = storageGet<ReturnType<typeof novels>>(StorageKeys.novels, [])
savedDespiteNotification[0].chapterList[0].content = '已提交但通知失败'
let notificationReceipt = false
await assert.rejects(Promise.resolve(storageSet(StorageKeys.novels, savedDespiteNotification, {
  retryPolicy: 'explicit', onCommit: () => { notificationReceipt = true },
})), /explicit postcommit saved notification failed/)
stopRejectingSaved()
assert.equal(notificationReceipt, true)
assert.equal(writes, 1)
assert.equal(getNovelPersistenceStatus().phase, 'saved')
assert.equal(getNovelPersistenceStatus().pending, 0)
assert.deepEqual(await storageReadCommitted(StorageKeys.novels), savedDespiteNotification,
  'the next preview/backup committed-source read accepts only this safely published explicit commit')
assert.equal(writes, 1, 'restoring the internal read barrier needs no duplicate write')

const nextReadAck = deferred()
holdAcknowledgement = nextReadAck.promise
const nextReadSnapshot = storageGet<ReturnType<typeof novels>>(StorageKeys.novels, [])
nextReadSnapshot[0].chapterList[0].content += '下一请求'
const nextReadSave = Promise.resolve(storageSet(StorageKeys.novels, nextReadSnapshot, { retryPolicy: 'explicit' }))
await tick()
let readReturnedDuringPending = false
const readDuringPending = storageReadCommitted(StorageKeys.novels).then(value => { readReturnedDuringPending = true; return value })
await tick()
assert.equal(readReturnedDuringPending, false, 'previous commit evidence never lets reads bypass a newer pending request')
nextReadAck.resolve()
await nextReadSave
assert.deepEqual(await readDuringPending, nextReadSnapshot)
const rejectedNextSnapshot = storageGet<ReturnType<typeof novels>>(StorageKeys.novels, [])
rejectedNextSnapshot[0].chapterList[0].content += '未提交失败'
fail = true
await assert.rejects(Promise.resolve(storageSet(StorageKeys.novels, rejectedNextSnapshot, { retryPolicy: 'explicit' })), /写入失败/)
fail = false
await assert.rejects(storageReadCommitted(StorageKeys.novels), /未保存/)
assert.equal(read()[0].chapterList[0].content, nextReadSnapshot[0].chapterList[0].content)
console.log('✓ explicit postcommit status rejection reaches its caller without poisoning committed-source reads or later pending/failed request boundaries')


await seed()
const project = useWriterProject({ novelStore: { worldSettings: [] }, notifyError() {}, beforeUnloadTarget: null })
await project.initNovel('1')
const lease = project.acquireApplyLease()!
lease.markApplied()
project.content.value += '追加'
project.onContentChange()
const ack2 = deferred()
holdAcknowledgement = ack2.promise
const handle = project.beginSaveCurrentChapter({ applyLease: lease })
const globalPending = retryNovelPersistence()
await tick()
assert.equal(writes, 1)
assert.equal(handle.initialCommit, 'committed')
assert.equal(project.isSaving.value, true)
ack2.resolve()
await globalPending
assert.equal((await handle.settled).status, 'clean')
assert.equal(writes, 1, 'global retry joins owned pending commit')
lease.releaseIfClean()
const lease2 = project.acquireApplyLease()!
lease2.markApplied()
project.content.value += '再追加'
project.onContentChange()
fail = true
const failed = project.beginSaveCurrentChapter({ applyLease: lease2 })
assert.equal((await failed.settled).status, 'failed')
fail = false
assert.equal(await project.dispose(), false)
await assert.rejects(retryNovelPersistence(), /重试保存/)
assert.equal(writes, 1, 'global retry cannot create a second Agent token after failure')
const retry = project.beginSaveCurrentChapter({ applyLease: lease2, retry: true })
assert.equal(retry, failed)
assert.equal((await retry.settled).status, 'clean')
assert.equal(writes, 2)
lease2.releaseIfClean()
// Dispose unregisters the global handler; this known-clean ordinary write is not an Agent retry.
await project.dispose()
console.log('✓ real Writer/global retry joins pending and rejects Agent recovery until explicit retained-lease retry')

await seed()
const oldOwner = useWriterProject({ novelStore: { worldSettings: [] }, notifyError() {}, beforeUnloadTarget: null })
await oldOwner.initNovel('1')
const oldLease = oldOwner.acquireApplyLease()!
oldLease.markApplied()
oldOwner.content.value += '旧Agent追加'
oldOwner.onContentChange()
fail = true
const oldFailure = oldOwner.beginSaveCurrentChapter({ applyLease: oldLease })
assert.equal((await oldFailure.settled).status, 'failed')
assert.equal(await oldOwner.dispose(), false)
fail = false
await assert.rejects(retryNovelPersistence(), /显式重试保存/)
assert.equal(writes, 0)
const nextOwner = useWriterProject({ novelStore: { worldSettings: [] }, notifyError() {}, beforeUnloadTarget: null })
await nextOwner.initNovel('2')
nextOwner.content.value = '新项目普通编辑'
nextOwner.onContentChange()
fail = true
assert.equal(await nextOwner.saveCurrentChapter(), false)
assert.equal(await nextOwner.dispose(), false)
fail = false
await retryNovelPersistence()
assert.equal(read()[1].chapterList[0].content, '新项目普通编辑')
assert.equal(writes, 1, 'an old disposed Agent handler cannot hijack the later ordinary request')
assert.equal(read()[0].chapterList[0].content, '旧', 'failed explicit-only draft never leaks into the new ordinary request')
console.log('✓ disposed Agent replay protection belongs only to its request; a later ordinary failed request remains retryable')

await seed()
const cacheOwner = useWriterProject({ novelStore: { worldSettings: [] }, notifyError() {}, beforeUnloadTarget: null })
await cacheOwner.initNovel('1')
const cacheLease = cacheOwner.acquireApplyLease()!
cacheLease.markApplied()
cacheOwner.content.value += '已提交追加'
cacheOwner.onContentChange()
const cacheAck = deferred()
holdAcknowledgement = cacheAck.promise
const cacheHandle = cacheOwner.beginSaveCurrentChapter({ applyLease: cacheLease })
await tick()
assert.equal(cacheHandle.initialCommit, 'committed')
assert.equal(storageGet<ReturnType<typeof novels>>(StorageKeys.novels, [])[0].chapterList[0].content, '旧')
cacheOwner.content.value += '未存后续编辑'
cacheOwner.onContentChange()
fail = true
cacheAck.resolve()
const cacheOutcome = await cacheHandle.settled
assert.equal(cacheOutcome.initialCommit, 'committed')
assert.equal(cacheOutcome.catchUpFailed, true)
assert.equal(storageGet<ReturnType<typeof novels>>(StorageKeys.novels, [])[0].chapterList[0].content, '旧已提交追加')
assert.equal(read()[0].chapterList[0].content, '旧已提交追加')
assert.equal(cacheOwner.content.value, '旧已提交追加未存后续编辑')
fail = false
rejectAcknowledgement = true
const cacheRetry = cacheOwner.beginSaveCurrentChapter({ applyLease: cacheLease, retry: true })
assert.equal((await cacheRetry.settled).status, 'clean')
assert.equal(storageGet<ReturnType<typeof novels>>(StorageKeys.novels, [])[0].chapterList[0].content, '旧已提交追加未存后续编辑')
assert.equal(getNovelPersistenceStatus().phase, 'saved')
cacheLease.releaseIfClean()
await cacheOwner.dispose()
console.log('✓ explicit drafts publish cache only after success; catch-up failure and lost acknowledgement preserve committed cache')

for (const moment of ['before_commit', 'after_commit_before_ack']) {
  await seed()
  const originalOwner = useWriterProject({ novelStore: { worldSettings: [] }, notifyError() {}, beforeUnloadTarget: null })
  await originalOwner.initNovel('1')
  const originalLease = originalOwner.acquireApplyLease()!
  originalLease.markApplied()
  originalOwner.content.value += '独立追加'
  originalOwner.onContentChange()
  const heldGate = deferred()
  if (moment === 'before_commit') holdBeforeCommit = heldGate.promise
  else holdAcknowledgement = heldGate.promise
  const originalHandle = originalOwner.beginSaveCurrentChapter({ applyLease: originalLease })
  await tick()
  const forcedDisposal = originalOwner.dispose()
  const otherOwner = useWriterProject({ novelStore: { worldSettings: [] }, notifyError() {}, beforeUnloadTarget: null })
  await otherOwner.initNovel('2')
  otherOwner.content.value = '另一作品新编辑'
  otherOwner.onContentChange()
  assert.equal(await otherOwner.saveCurrentChapter(), false)
  assert.equal(getNovelPersistenceStatus().phase, 'saving', 'refusal cannot overwrite original pending global status')
  assert.equal(getNovelPersistenceStatus().pending, 1)
  assert.equal(storageGet<ReturnType<typeof novels>>(StorageKeys.novels, [])[1].chapterList[0].content, '旧')
  heldGate.resolve()
  assert.equal((await originalHandle.settled).status, 'clean')
  assert.equal(await forcedDisposal, true)
  assert.equal(getNovelPersistenceStatus().phase, 'saved')
  assert.equal(await otherOwner.saveCurrentChapter(), true)
  assert.equal(read()[0].chapterList[0].content, '旧独立追加')
  assert.equal(read()[1].chapterList[0].content, '另一作品新编辑')
  await otherOwner.dispose()
}
console.log('✓ forced concurrent ordinary writes are refused before and after actual Agent commit without disturbing its owner; later saves preserve both works')




let direct = false
storageSet(StorageKeys.theme, 'dark', { onCommit: receipt => { direct = true; assert.deepEqual(receipt, { committed: true }); throw new Error('observer') } })
assert.equal(direct, true)
assert.equal(disk.get(StorageKeys.theme), '"dark"')
console.log('✓ unchunked ordinary callback is also metadata-only, post-write and isolated')

const unhandled: unknown[] = []
const recordUnhandled = (error: unknown) => { unhandled.push(error) }
process.on('unhandledRejection', recordUnhandled)
storageSet(StorageKeys.theme, 'light', { onCommit: async () => { throw new Error('async observer') } })
await new Promise<void>(resolve => setImmediate(resolve))
process.off('unhandledRejection', recordUnhandled)
assert.deepEqual(unhandled, [])
assert.equal(disk.get(StorageKeys.theme), '"light"')
console.log('✓ an async rejecting receipt observer cannot alter success or cause an unhandled rejection')
