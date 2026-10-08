/** Execute independent real persistence modules against one shared origin. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createWritingGoalsState } from '../src/stores/writingGoals'
import { withStorageCommit } from '../src/services/storageCoordination'
import { createNovelChangeTracker } from '../src/utils/novelConcurrency'
import { normalizeWritingGoals } from '../src/utils/writingGoals'
import { StorageKeys } from '../src/utils/storage'
import type { WritingGoal } from '../src/types/management'

interface TestNovel {
  id: number
  title: string
  chapterList: Array<{ id: number; title: string; content: string }>
}
type Backend = { get(): TestNovel[]; set(value: unknown): Promise<void>; remove(): Promise<void> }
interface StorageModule {
  registerChunkedKey(key: string, backend: Backend): void
  writeSerializedWithRetry(key: string, value: string): void
  storageClear(): Promise<void>
}
interface PersistenceModule {
  initNovelPersistence(): Promise<void>
  retryNovelPersistence(): Promise<void>
  replaceNovelPersistence(value: unknown): Promise<void>
  getNovelPersistenceStatus(): { phase: string; error: string | null; pending: number }
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const fixture = (): TestNovel[] => [1, 2].map(id => ({
  id, title: `Novel ${id}`, chapterList: [{ id, title: `Chapter ${id}`, content: `Original ${id}` }],
}))
const source = readFileSync(new URL('../src/services/novelPersistence.ts', import.meta.url), 'utf8')
const executable = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const storageExecutable = ts.transpileModule(readFileSync(new URL('../src/utils/storage.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

function origin(initial = fixture()) {
  const disk = new Map<string, string>([[StorageKeys.novels, JSON.stringify(initial)]])
  const blobs = new Map<string, string>()
  let failNextWrite = false
  const localStorage = {
    get length() { return disk.size },
    key: (index: number) => [...disk.keys()][index] ?? null,
    getItem: (key: string) => disk.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === StorageKeys.novels && failNextWrite) {
        failNextWrite = false
        throw new Error('Injected metadata failure')
      }
      disk.set(key, value)
    },
    removeItem: (key: string) => { disk.delete(key) },
  }
  function tab() {
    let backend!: Backend
    const storageExports: Record<string, unknown> = {}
    new Function('require', 'exports', 'localStorage', 'console', storageExecutable)(
      (specifier: string) => {
        assert.equal(specifier, '@/services/storageCoordination')
        return { withStorageCommit }
      }, storageExports, localStorage, {
        ...console,
        error: (...args: unknown[]) => {
          // Expected fault injection should not print test payloads or a noisy stack.
          if (args.some(value => value instanceof Error && value.message === 'Injected metadata failure')) return
          console.error(...args)
        },
      },
    )
    const storage = storageExports as unknown as StorageModule
    const register = storage.registerChunkedKey
    storage.registerChunkedKey = (key, value) => { backend = value; register(key, value) }
    const dependencies: Record<string, unknown> = {
      '@/utils/storage': storage,
      './blobStore': {
        isBlobStoreAvailable: () => true,
        idbGet: async (key: string) => blobs.get(key) ?? null,
        idbGetMany: async (keys: readonly string[]) => new Map(keys.map(key => [key, blobs.get(key) ?? null])),
        idbSetMany: async (entries: Array<{ key: string; content: string }>) => {
          for (const entry of entries) blobs.set(entry.key, entry.content)
        },
        idbDeleteMany: async (keys: string[]) => { for (const key of keys) blobs.delete(key) },
      },
      './storageCoordination': { withStorageCommit },
      '@/utils/novelConcurrency': { createNovelChangeTracker },
    }
    const exports: Record<string, unknown> = {}
    new Function('require', 'exports', 'localStorage', executable)(
      (specifier: string) => {
        assert.ok(specifier in dependencies, `Unexpected dependency ${specifier}`)
        return dependencies[specifier]
      }, exports, localStorage,
    )
    const module = exports as unknown as PersistenceModule
    return {
      ...module,
      get: () => backend.get(),
      save: (value: TestNovel[]) => backend.set(value),
      remove: () => backend.remove(),
      clear: () => storage.storageClear(),
    }
  }
  return {
    tab, disk, blobs,
    read: () => JSON.parse(disk.get(StorageKeys.novels) ?? '[]') as TestNovel[],
    failNextWrite: () => { failNextWrite = true },
  }
}
async function twoTabs(initial = fixture()) {
  const shared = origin(initial)
  const a = shared.tab()
  const b = shared.tab()
  await Promise.all([a.initNovelPersistence(), b.initNovelPersistence()])
  return { shared, a, b }
}
let passed = 0
const check = (label: string) => { console.log(`✓ ${++passed}. ${label}`) }

{
  const { shared, a, b } = await twoTabs()
  const first = a.get()
  first[0].chapterList[0].content = 'A edit'
  const second = b.get()
  second[1].chapterList[0].content = 'B edit'
  await Promise.all([a.save(first), b.save(second)])
  assert.equal(shared.read()[0].chapterList[0].content, 'A edit')
  assert.equal(shared.read()[1].chapterList[0].content, 'B edit')
  assert.equal(a.getNovelPersistenceStatus().phase, 'saved')
  assert.equal(b.getNovelPersistenceStatus().phase, 'saved')
  check('Separate works merge through the shared commit gate despite concurrent stale snapshots')
}
{
  const { shared, a, b } = await twoTabs()
  const first = a.get()
  first[0].chapterList[0].content = 'Committed A'
  await a.save(first)
  const second = b.get()
  second[0].chapterList[0].content = 'Local draft B'
  await assert.rejects(b.save(second), /其他标签页修改/)
  await assert.rejects(b.retryNovelPersistence(), /其他标签页修改/)
  assert.equal(shared.read()[0].chapterList[0].content, 'Committed A')
  assert.equal(b.get()[0].chapterList[0].content, 'Local draft B')
  assert.equal(b.getNovelPersistenceStatus().phase, 'error')
  await b.initNovelPersistence()
  const reopened = b.get()
  reopened[0].chapterList[0].content += ' + explicit merged draft'
  await b.save(reopened)
  assert.match(shared.read()[0].chapterList[0].content, /explicit merged draft/)
  check('Same-work conflict and retry retain the local draft without forcing an overwrite')
}
{
  const { shared, a, b } = await twoTabs()
  const external = b.get()
  external.push({ id: 3, title: 'External new work', chapterList: [] })
  const adding = b.save(external)
  const first = a.get()
  first[0].chapterList[0].content = 'Queued first'
  const savingFirst = a.save(first)
  const second = a.get()
  second[0].chapterList[0].content = 'Queued second'
  const savingSecond = a.save(second)
  await Promise.all([adding, savingFirst, savingSecond])
  assert.ok(shared.read().some(novel => novel.id === 3))
  assert.equal(shared.read()[0].chapterList[0].content, 'Queued second')
  check('Older queued full snapshots cannot delete an unrelated externally created work')
}
{
  const { shared, a } = await twoTabs()
  const original = a.get()
  const edited = clone(original)
  edited[0].chapterList[0].content = 'Temporary queued edit'
  const edit = a.save(edited)
  const revert = a.save(original)
  await Promise.all([edit, revert])
  assert.deepEqual(shared.read(), original)
  check('A queued edit followed by a revert remains an intentional successful revert')
}
{
  const { shared, a } = await twoTabs()
  shared.failNextWrite()
  const first = a.get()
  first[0].chapterList[0].content = 'Unsaved first change'
  const firstSave = a.save(first)
  const second = a.get()
  second[1].chapterList[0].content = 'Later second change'
  const secondSave = a.save(second)
  await assert.rejects(firstSave, /Injected metadata failure/)
  await secondSave
  assert.equal(shared.read()[0].chapterList[0].content, 'Unsaved first change')
  assert.equal(shared.read()[1].chapterList[0].content, 'Later second change')
  assert.equal(a.getNovelPersistenceStatus().phase, 'saved')
  check('A failed queued first save does not discard its changes from a later full snapshot')
}
for (const operation of ['clear', 'replace'] as const) {
  const { shared, a, b } = await twoTabs()
  const initial = a.get()
  const external = b.get()
  external.push({ id: 3, title: 'New data since import page opened', chapterList: [] })
  await b.save(external)
  const before = clone(shared.read())
  if (operation === 'clear') await assert.rejects(a.remove(), /其他标签页修改/)
  else await assert.rejects(a.replaceNovelPersistence([{ ...initial[0], title: 'Failed imported snapshot' }]), /其他标签页修改/)
  await assert.rejects(a.retryNovelPersistence(), /其他标签页修改/)
  assert.deepEqual(shared.read(), before)
  assert.deepEqual(a.get(), initial, 'A failed destructive request must leave the prior visible collection intact')
  const later = a.get()
  later[1].chapterList[0].content = `Normal save after failed ${operation}`
  await a.save(later)
  assert.deepEqual(new Set(shared.read().map(novel => novel.id)), new Set([1, 2, 3]))
  assert.equal(shared.read().find(novel => novel.id === 1)?.title, initial[0].title)
  assert.equal(shared.read().find(novel => novel.id === 2)?.chapterList[0].content, `Normal save after failed ${operation}`)
  check(`${operation} refuses to erase unseen external data, including on retry`)
}
for (const operation of ['clear', 'replace'] as const) {
  const { shared, a } = await twoTabs()
  const original = a.get()
  const destructive = operation === 'clear'
    ? a.remove()
    : a.replaceNovelPersistence([{ ...original[0], title: 'Queued replacement' }])
  const next = a.get()
  next[1].chapterList[0].content = `Later queued edit after ${operation}`
  const laterSave = a.save(next)
  await destructive
  assert.deepEqual(a.get(), next, 'An older successful destructive request must not publish over a newer queued draft')
  await laterSave
  assert.deepEqual(shared.read().toSorted((left, right) => left.id - right.id), next.toSorted((left, right) => left.id - right.id))
  assert.deepEqual(a.get(), next)
  check(`A successful queued ${operation} cannot replace the cache of a later normal save`)
}
for (const operation of ['clear', 'replace'] as const) {
  const { shared, a, b } = await twoTabs()
  const external = b.get()
  external.push({ id: 3, title: 'Externally added before destructive queue', chapterList: [] })
  await b.save(external)
  const initial = a.get()
  const destructive = operation === 'clear'
    ? a.remove()
    : a.replaceNovelPersistence([{ ...initial[0], title: 'Rejected queued replacement' }])
  const next = a.get()
  next[1].chapterList[0].content = `Later queued edit survives failed ${operation}`
  const laterSave = a.save(next)
  await assert.rejects(destructive, /其他标签页修改/)
  await laterSave
  assert.deepEqual(a.get(), next)
  assert.deepEqual(new Set(shared.read().map(novel => novel.id)), new Set([1, 2, 3]))
  assert.equal(shared.read().find(novel => novel.id === 1)?.title, initial[0].title)
  assert.equal(shared.read().find(novel => novel.id === 2)?.chapterList[0].content, next[1].chapterList[0].content)
  check(`A failed queued ${operation} retains a later normal edit without deleting original works`)
}
{
  const { shared, a, b } = await twoTabs()
  const ordinary = new Map([
    [StorageKeys.writingGoals, '[{"id":8,"title":"Preserved goal"}]'],
    [StorageKeys.prompts, '[{"id":9,"title":"Preserved prompt","content":"Draft"}]'],
    [StorageKeys.apiConfig, '{"baseURL":"https://example.invalid/v1"}'],
  ])
  for (const [key, value] of ordinary) shared.disk.set(key, value)
  const external = b.get()
  external.push({ id: 3, title: 'New external work blocks whole-data clear', chapterList: [] })
  await b.save(external)
  const novelsBefore = clone(shared.read())
  await assert.rejects(a.clear(), /其他标签页修改/)
  assert.deepEqual(shared.read(), novelsBefore)
  for (const [key, value] of ordinary) assert.equal(shared.disk.get(key), value, `${key} must survive a rejected novel clear`)
  check('Actual storageClear preserves ordinary keys when the novel deletion conflicts')
}
{
  const duplicate = [{ ...fixture()[0], title: 'First duplicate' }, { ...fixture()[0], title: 'Second duplicate' }]
  const shared = origin(duplicate)
  const unopened = shared.tab()
  await assert.rejects(unopened.initNovelPersistence(), /ID 重复/)
  assert.deepEqual(shared.read(), duplicate)
  const { shared: valid, a } = await twoTabs()
  const before = clone(valid.read())
  await assert.rejects(a.save(duplicate), /ID 重复/)
  await assert.rejects(a.replaceNovelPersistence(duplicate), /ID 重复/)
  assert.deepEqual(valid.read(), before)
  assert.deepEqual(a.get(), before)
  check('Repeated novel IDs are rejected on load, save and replacement without dropping either work')
}
{
  const { shared, a, b } = await twoTabs()
  await b.save(b.get().filter(novel => novel.id !== 1))
  const stale = a.get()
  stale[0].chapterList[0].content = 'Must not resurrect'
  await assert.rejects(a.save(stale), /其他标签页修改/)
  assert.ok(!shared.read().some(novel => novel.id === 1))
  check('Editing a work deleted by another tab cannot silently resurrect it')
}
{
  const big = fixture()
  for (const novel of big) novel.chapterList[0].content = String(novel.id).repeat(800_000)
  const { shared, a, b } = await twoTabs(big)
  const first = a.get()
  first[0].chapterList[0].content += 'A'
  const second = b.get()
  second[1].chapterList[0].content += 'B'
  await Promise.all([a.save(first), b.save(second)])
  const reopened = shared.tab()
  await reopened.initNovelPersistence()
  assert.equal(reopened.get()[0].chapterList[0].content, first[0].chapterList[0].content)
  assert.equal(reopened.get()[1].chapterList[0].content, second[1].chapterList[0].content)
  check('Split正文 concurrent rebase/garbage cleanup still hydrates both committed works on restart')
}
{
  let goals: WritingGoal[] = normalizeWritingGoals([{
    id: 1, title: 'Shared goal', type: 'daily', unit: '字', targetValue: 1000,
    currentValue: 0, status: 'active', startDate: '2026-10-01', endDate: '2026-10-31', progressHistory: [],
  }])
  let failNext = false
  let sequence = 100
  const storage = {
    read: () => clone(goals),
    write: (next: WritingGoal[]) => { goals = clone(next) },
    update: (change: (current: WritingGoal[]) => WritingGoal[]) => withStorageCommit(() => {
      const next = change(clone(goals))
      if (failNext) { failNext = false; throw new Error('Goal commit failed') }
      goals = clone(next)
      return next
    }),
    now: () => new Date('2026-10-02T00:00:00Z'),
    id: () => sequence++,
  }
  const a = createWritingGoalsState(storage)
  const b = createWritingGoalsState(storage)
  await Promise.all([a.recordProgress(1, 100, 'increment', 'Tab A'), b.recordProgress(1, 50, 'increment', 'Tab B')])
  assert.equal(goals[0].currentValue, 150)
  assert.equal(goals[0].progressHistory.length, 2)
  assert.deepEqual(new Set(goals[0].progressHistory.map(item => item.note)), new Set(['Tab A', 'Tab B']))
  await Promise.all([a.reload(), b.reload()])
  const before = clone(a.goals.value)
  failNext = true
  await assert.rejects(a.recordProgress(1, 25, 'increment', 'Failed draft'), /Goal commit failed/)
  assert.deepEqual(a.goals.value, before)
  assert.deepEqual(goals, before)
  await a.recordProgress(1, 25, 'increment', 'Retried draft')
  assert.equal(goals[0].currentValue, 175)
  assert.equal(goals[0].progressHistory.length, 3)
  check('Real goal states commit both increments through one gate and publish nothing on failure')
}
console.log(`Passed ${passed} storage conflict checks`)
