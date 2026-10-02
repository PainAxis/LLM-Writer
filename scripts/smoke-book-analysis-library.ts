import assert from 'node:assert/strict'
import { bookAnalysisLibrary, createBookAnalysisLibrary, normalizeBookAnalysisLibrary } from '../src/services/bookAnalysisLibrary'
import type { BookAnalysisLibraryRecord } from '../src/types/bookAnalysis'
import { StorageKeys } from '../src/utils/storage'

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const initialTime = '2026-10-02T08:00:00.000Z'
const updatedTime = '2026-10-02T09:00:00.000Z'
const record = (id = 'existing'): BookAnalysisLibraryRecord => ({
  id, title: 'Saved analysis', content: '# Analysis\n\nOriginal text', sourceFileName: 'source.txt',
  createdAt: initialTime, updatedAt: initialTime, extension: { retained: ['custom metadata'] },
})
const draft = (title = 'New analysis') => ({ title, content: '  # Result\n\nKeep whitespace.  ', sourceFileName: '' })

function fixture(initial: unknown = null) {
  let disk = copy(initial)
  let sequence = 0
  let writes = 0
  let fail: 'none' | 'sync' | 'async' = 'none'
  let failRead = false
  let timestamp = initialTime
  let block: (() => Promise<void>) | undefined
  const library = createBookAnalysisLibrary({
    read: () => { if (failRead) throw new Error('Storage read failure'); return copy(disk) },
    id: () => `generated-${++sequence}`,
    now: () => timestamp,
    write: next => {
      writes++
      if (fail === 'sync') throw new Error('Synchronous storage failure')
      if (fail === 'async') return Promise.reject(new Error('Asynchronous storage failure'))
      if (block) return block().then(() => { disk = copy(next) })
      disk = copy(next)
    },
  })
  return {
    library, disk: () => copy(disk), replaceDisk: (next: unknown) => { disk = copy(next) }, writes: () => writes,
    fail: (mode: typeof fail) => { fail = mode }, failRead: (value: boolean) => { failRead = value },
    now: (value: string) => { timestamp = value }, block: (value?: () => Promise<void>) => { block = value },
  }
}

const fresh = fixture()
assert.deepEqual(await fresh.library.load(), [])
assert.equal(fresh.writes(), 0, 'Opening a missing library does not write an empty placeholder')
const saved = await fresh.library.save(draft('   Trim this title   '))
assert.equal(saved.title, 'Trim this title')
assert.equal(saved.content, draft().content, 'Analysis content is stored exactly as supplied')
assert.equal(saved.sourceFileName, '')
assert.equal(saved.id, 'generated-1')
assert.equal(saved.createdAt, initialTime)
assert.deepEqual(fresh.disk(), [saved])
saved.content = 'Mutated return value'
assert.equal(fresh.library.records.value[0].content, draft().content, 'A returned record is a detached draft')
const opened = await fresh.library.load()
opened[0].content = 'Opened editable draft'
assert.equal(fresh.library.records.value[0].content, draft().content)
assert.equal((fresh.disk() as BookAnalysisLibraryRecord[])[0].content, draft().content, 'Opening/editing a returned snapshot does not save it')

const editing = fixture([record()])
await editing.library.load()
editing.now(updatedTime)
const edited = await editing.library.save({ ...draft(' Updated '), id: 'existing' })
assert.equal(editing.library.records.value.length, 1, 'Updating an opened record does not duplicate it')
assert.equal(edited.id, 'existing')
assert.equal(edited.createdAt, initialTime)
assert.equal(edited.updatedAt, updatedTime)
assert.deepEqual(edited.extension, record().extension)
assert.equal(edited.title, 'Updated')
await assert.rejects(editing.library.save({ ...draft(), id: 'deleted-id' }), /已删除/)
assert.equal(editing.library.records.value.length, 1, 'Stale open records are not recreated under their deleted identity')
await editing.library.remove('existing')
assert.deepEqual(editing.disk(), [])
const writesAfterDelete = editing.writes()
await editing.library.remove('existing')
assert.equal(editing.writes(), writesAfterDelete, 'Repeated deletion is idempotent')

const newest = fixture([record()])
await newest.library.load()
newest.replaceDisk([record(), record('added-elsewhere')])
await newest.library.save({ ...draft('Existing edited'), id: 'existing' })
assert.deepEqual(newest.library.records.value.map(item => item.id), ['existing', 'added-elsewhere'], 'A mutation merges into the latest disk collection')
newest.replaceDisk([...newest.library.records.value, record('third')])
await newest.library.remove('existing')
assert.deepEqual(newest.library.records.value.map(item => item.id), ['added-elsewhere', 'third'])

for (const mode of ['sync', 'async'] as const) {
  const failed = fixture([record()])
  await failed.library.load()
  const committed = copy(failed.library.records.value)
  failed.fail(mode)
  await assert.rejects(failed.library.save({ ...draft('Unsaved update'), id: 'existing' }), /storage failure/)
  assert.deepEqual(failed.library.records.value, committed)
  assert.deepEqual(failed.disk(), committed)
  assert.equal(failed.library.pending.value, false)
  await assert.rejects(failed.library.save(draft()), /storage failure/)
  await assert.rejects(failed.library.remove('existing'), /storage failure/)
  assert.deepEqual(failed.library.records.value, committed, 'Failed saves and deletion leave the last committed list visible')
  failed.fail('none')
  await failed.library.save({ ...draft('Retry succeeds'), id: 'existing' })
  assert.equal(failed.library.records.value[0].title, 'Retry succeeds')
  await failed.library.remove('existing')
  assert.deepEqual(failed.disk(), [])
}

const readFailure = fixture([record()])
await readFailure.library.load()
readFailure.failRead(true)
await assert.rejects(readFailure.library.load(), /Storage read failure/)
await assert.rejects(readFailure.library.save(draft()), /Storage read failure/)
await assert.rejects(readFailure.library.remove('existing'), /Storage read failure/)
assert.deepEqual(readFailure.library.records.value, [record()])
assert.equal(readFailure.writes(), 0)
readFailure.failRead(false)
await readFailure.library.save(draft())
assert.equal(readFailure.library.records.value.length, 2, 'A failed read does not poison the operation queue')

const corruptValues: unknown[] = [
  {}, 'not an array', [null], [record(), record()],
  [{ ...record(), id: 12 }], [{ ...record(), title: ' ' }], [{ ...record(), content: '\n\t' }],
  [{ ...record(), sourceFileName: null }], [{ ...record(), createdAt: '1' }],
  [{ ...record(), createdAt: '2026-02-30T08:00:00.000Z' }],
  [{ ...record(), createdAt: '2026-10-02T24:00:00.000Z' }],
  [{ ...record(), updatedAt: '2026-10-02' }],
]
for (const corrupt of corruptValues) {
  const invalid = fixture([record()])
  await invalid.library.load()
  invalid.replaceDisk(corrupt)
  await assert.rejects(invalid.library.load(), /拆书分析作品库/)
  await assert.rejects(invalid.library.save(draft()), /拆书分析作品库/)
  await assert.rejects(invalid.library.remove('existing'), /拆书分析作品库/)
  assert.deepEqual(invalid.disk(), corrupt, 'Malformed data is preserved for recovery')
  assert.deepEqual(invalid.library.records.value, [record()])
  assert.equal(invalid.writes(), 0)
  assert.equal(invalid.library.pending.value, false)
}
assert.equal(normalizeBookAnalysisLibrary([{ ...record(), createdAt: '2024-02-29T20:00:00+08:00' }]).length, 1)
assert.throws(() => normalizeBookAnalysisLibrary([{ ...record(), createdAt: '2026-02-29T20:00:00+08:00' }]), /拆书分析作品库/)

const invalidInputs = fixture()
for (const input of [{ ...draft(), title: ' ' }, { ...draft(), content: '\n' }, { ...draft(), id: '' }]) {
  await assert.rejects(invalidInputs.library.save(input), /有效/)
}
await assert.rejects(invalidInputs.library.remove(' '), /身份无效/)
invalidInputs.now('not ISO')
await assert.rejects(invalidInputs.library.save(draft()), /时间无效/)
assert.equal(invalidInputs.writes(), 0)
const collision = createBookAnalysisLibrary({ read: () => [record()], write: () => assert.fail('ID collision must not write'), id: () => 'existing' })
await assert.rejects(collision.save(draft()), /身份无效或已存在/)
const nodeDefault = createBookAnalysisLibrary({ read: () => null, write() {} })
assert.ok((await nodeDefault.save(draft())).id, 'The default ID and time factories also work in Node')

const queued = fixture([record()])
await queued.library.load()
let releaseFirst!: () => void
let enteredFirst!: () => void
let releaseSecond!: () => void
let enteredSecond!: () => void
const firstEntered = new Promise<void>(resolve => { enteredFirst = resolve })
const secondEntered = new Promise<void>(resolve => { enteredSecond = resolve })
let blockedWrites = 0
queued.block(() => ++blockedWrites === 1
  ? new Promise<void>(resolve => { releaseFirst = resolve; enteredFirst() })
  : new Promise<void>(resolve => { releaseSecond = resolve; enteredSecond() }))
const requested = { ...draft('First queued edit'), id: 'existing' }
const firstSave = queued.library.save(requested)
requested.title = 'Changed after requesting save'
await firstEntered
assert.deepEqual(queued.library.records.value, [record()], 'Pending writes do not publish drafts')
const loading = queued.library.load()
const secondSave = queued.library.save(draft('Second queued save'))
assert.equal(queued.library.pending.value, true)
releaseFirst()
await firstSave
const loadedAfterFirstSave = await loading
await secondEntered
assert.equal(loadedAfterFirstSave[0].title, 'First queued edit', 'An overlapping load sees the preceding committed save')
assert.equal(queued.library.pending.value, true, 'Completing a load or earlier save cannot clear a later save pending state')
assert.equal(queued.library.records.value.length, 1)
releaseSecond()
await secondSave
assert.equal(queued.library.pending.value, false)
assert.deepEqual(queued.library.records.value.map(item => item.title), ['First queued edit', 'Second queued save'])
queued.block()
const firstDelete = queued.library.remove('existing')
const secondDelete = queued.library.remove('generated-1')
const finalLoad = queued.library.load()
assert.equal(queued.library.pending.value, true)
await Promise.all([firstDelete, secondDelete, finalLoad])
assert.deepEqual(queued.library.records.value, [])
assert.equal(queued.library.pending.value, false)

const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
let raw = '{broken JSON'
let rawWrites = 0
let throwRead = false
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => {
    assert.equal(key, StorageKeys.bookAnalysisLibrary)
    if (throwRead) throw new Error('Raw storage read failed')
    return raw
  },
  setItem: (key: string, value: string) => { assert.equal(key, StorageKeys.bookAnalysisLibrary); rawWrites++; raw = value },
} })
try {
  await assert.rejects(bookAnalysisLibrary.load(), SyntaxError)
  await assert.rejects(bookAnalysisLibrary.save(draft()), SyntaxError)
  assert.equal(raw, '{broken JSON')
  assert.equal(rawWrites, 0, 'The production adapter keeps corrupt JSON instead of overwriting it')
  raw = JSON.stringify([record()])
  await bookAnalysisLibrary.load()
  throwRead = true
  await assert.rejects(bookAnalysisLibrary.load(), /Raw storage read failed/)
  assert.equal(bookAnalysisLibrary.records.value[0].id, 'existing')
  throwRead = false
  await bookAnalysisLibrary.save({ ...draft('Production adapter update'), id: 'existing' })
  assert.equal(JSON.parse(raw)[0].title, 'Production adapter update')
  assert.equal(rawWrites, 1)
} finally {
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
}

console.log('Book analysis library: reopen/update/delete, latest disk merge, strict recovery, metadata, failed saves/retry and queued pending smoke passed')
