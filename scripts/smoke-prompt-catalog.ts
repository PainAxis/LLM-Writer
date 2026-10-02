import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { ref } from 'vue'
import { DEFAULT_PROMPTS, PROMPTS_VERSION, type PromptTemplate } from '../src/config/defaultPrompts'
import { createPromptCatalog, promptCatalog } from '../src/services/promptCatalog'

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const custom = (id: number | string = 'portable-user'): PromptTemplate => ({
  id, title: 'User template', category: 'book-analysis', description: 'User description',
  content: 'User content', tags: ['user'], isDefault: false, extension: { keep: true },
})
function fixture(data: unknown = null, initialVersion: unknown = 0) {
  let disk = copy(data)
  let version = initialVersion
  let writeCount = 0
  let fail: 'none' | 'sync' | 'async' = 'none'
  let failVersion = false
  let block: (() => Promise<void>) | undefined
  const catalog = createPromptCatalog({
    read: () => copy(disk), readVersion: () => version,
    write: next => {
      writeCount++
      if (fail === 'sync') throw new Error('Synchronous storage failure')
      if (fail === 'async') return Promise.reject(new Error('Asynchronous storage failure'))
      if (block) return block().then(() => { disk = copy(next) })
      disk = copy(next)
    },
    writeVersion: next => {
      if (failVersion) return Promise.reject(new Error('Version storage failure'))
      version = next
    },
  })
  return {
    catalog, disk: () => copy(disk), version: () => version, writes: () => writeCount,
    fail: (mode: typeof fail) => { fail = mode }, failVersion: (value: boolean) => { failVersion = value },
    block: (value?: () => Promise<void>) => { block = value },
  }
}

const fresh = fixture()
await fresh.catalog.load()
assert.equal(fresh.catalog.prompts.value.length, DEFAULT_PROMPTS.length)
assert.ok(fresh.catalog.prompts.value.some(prompt => prompt.category === 'book-analysis'), 'A direct first visit to BookAnalysis has templates')
assert.equal(fresh.version(), PROMPTS_VERSION)
fresh.catalog.prompts.value[0].tags.push('Only in this runtime')
assert.ok(!DEFAULT_PROMPTS[0].tags.includes('Only in this runtime'))

const legacy = { ...custom(10001), title: '通用短篇小说模板', category: 'short-story', isDefault: true }
const sameTitleUser = { ...legacy, id: 'keep-my-template', isDefault: false }
const sparse = { id: 'legacy-string', title: 'Sparse portable template', content: 'Portable content', extension: { preserved: true } }
const upgrade = fixture([{ ...DEFAULT_PROMPTS[0], content: 'Stale built-in' }, legacy, sameTitleUser, sparse], 0)
await upgrade.catalog.load()
assert.equal(upgrade.catalog.prompts.value.find(prompt => prompt.id === DEFAULT_PROMPTS[0].id)?.content, DEFAULT_PROMPTS[0].content)
assert.ok(!upgrade.catalog.prompts.value.some(prompt => prompt.id === legacy.id))
assert.deepEqual(upgrade.catalog.prompts.value.find(prompt => prompt.id === sameTitleUser.id), sameTitleUser)
assert.deepEqual(upgrade.catalog.prompts.value.find(prompt => prompt.id === sparse.id)?.extension, sparse.extension)
assert.deepEqual(upgrade.catalog.prompts.value.find(prompt => prompt.id === sparse.id)?.tags, [])
assert.equal(upgrade.version(), PROMPTS_VERSION)
const upgraded = copy(upgrade.catalog.prompts.value)
await upgrade.catalog.load()
assert.deepEqual(upgrade.catalog.prompts.value, upgraded, 'Loading from another feature is an idempotent migration')

const alreadyUpgraded = fixture([...DEFAULT_PROMPTS, legacy, sameTitleUser], PROMPTS_VERSION)
await alreadyUpgraded.catalog.load()
assert.ok(!alreadyUpgraded.catalog.prompts.value.some(prompt => prompt.id === legacy.id), 'Repair legacy defaults regardless of prior entry-point order')
for (const id of [28, 29, 33]) assert.ok(alreadyUpgraded.catalog.prompts.value.some(prompt => prompt.id === id), 'Same-title current defaults survive cleanup')
assert.ok(alreadyUpgraded.catalog.prompts.value.some(prompt => prompt.id === sameTitleUser.id))

const empty = fixture([], PROMPTS_VERSION)
await empty.catalog.load()
assert.deepEqual(empty.catalog.prompts.value, [], 'Current-version user deletions must not resurrect templates')
assert.equal(empty.writes(), 0)
const oldEmpty = fixture([], 0)
await oldEmpty.catalog.load()
assert.equal(oldEmpty.catalog.prompts.value.length, DEFAULT_PROMPTS.length)
const editedDefault = { ...DEFAULT_PROMPTS[0], content: 'Locally edited default' }
const current = fixture([editedDefault, custom()], PROMPTS_VERSION)
await current.catalog.load()
assert.deepEqual(current.catalog.prompts.value, [editedDefault, custom()], 'Current-version edits and missing categories are intentional')
const collision = fixture([custom(DEFAULT_PROMPTS[0].id)], 0)
await collision.catalog.load()
assert.deepEqual(collision.catalog.prompts.value.find(prompt => prompt.id === DEFAULT_PROMPTS[0].id), custom(DEFAULT_PROMPTS[0].id), 'Custom content survives a built-in ID collision')

for (const malformed of [{ prompts: [custom()] }, 'Wrong-shaped stored data', [null]]) {
  const invalid = fixture(malformed, PROMPTS_VERSION)
  await assert.rejects(invalid.catalog.load(), /提示词库/)
  assert.deepEqual(invalid.disk(), malformed, 'Malformed stored content is preserved for recovery')
  assert.equal(invalid.writes(), 0)
  assert.deepEqual(invalid.catalog.prompts.value, [])
}
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const raw = new Map([['prompts', '{broken JSON'], ['promptsVersion', JSON.stringify(PROMPTS_VERSION)]])
let rawWrites = 0
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => raw.get(key) ?? null,
  setItem: (key: string, value: string) => { rawWrites++; raw.set(key, value) },
} })
try {
  await assert.rejects(promptCatalog.load(), SyntaxError)
  assert.equal(raw.get('prompts'), '{broken JSON')
  assert.equal(rawWrites, 0, 'The production adapter must not treat malformed JSON as a fresh profile')
} finally {
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
}

for (const mode of ['sync', 'async'] as const) {
  const failed = fixture()
  failed.fail(mode)
  await assert.rejects(failed.catalog.load(), /storage failure/)
  assert.deepEqual(failed.catalog.prompts.value, [])
  assert.equal(failed.disk(), null)
  assert.equal(failed.version(), 0, 'Failed content writes cannot advance the catalog version')
  assert.equal(failed.catalog.pending.value, false)
  failed.fail('none')
  await failed.catalog.load()
  assert.equal(failed.catalog.prompts.value.length, DEFAULT_PROMPTS.length)
}
const partial = fixture()
partial.failVersion(true)
await assert.rejects(partial.catalog.load(), /Version storage failure/)
assert.equal((partial.disk() as PromptTemplate[]).length, DEFAULT_PROMPTS.length)
assert.equal(partial.version(), 0)
partial.failVersion(false)
await partial.catalog.load()
assert.equal(partial.catalog.prompts.value.length, DEFAULT_PROMPTS.length, 'Retrying a partial migration must not duplicate defaults')
assert.equal(partial.version(), PROMPTS_VERSION)

const concurrent = fixture([custom()], PROMPTS_VERSION)
await concurrent.catalog.load()
let release!: () => void
let entered!: () => void
const writing = new Promise<void>(resolve => { entered = resolve })
const gate = new Promise<void>(resolve => { release = resolve })
concurrent.block(() => { entered(); return gate })
const first = concurrent.catalog.update(prompts => [...prompts, custom('first')])
await writing
const second = concurrent.catalog.update(prompts => [...prompts, custom('second')])
assert.equal(concurrent.catalog.prompts.value.length, 1, 'Pending changes remain unpublished')
release()
await Promise.all([first, second])
assert.deepEqual(concurrent.catalog.prompts.value.map(prompt => prompt.id), ['portable-user', 'first', 'second'])
assert.equal(concurrent.catalog.pending.value, false)
const overlap = fixture()
let unblockLoad!: () => void
let unblockUpdate!: () => void
let loadBegan!: () => void
let updateBegan!: () => void
const loadStarted = new Promise<void>(resolve => { loadBegan = resolve })
const updateStarted = new Promise<void>(resolve => { updateBegan = resolve })
let blockedWrites = 0
overlap.block(() => ++blockedWrites === 1
  ? new Promise<void>(resolve => { unblockLoad = resolve; loadBegan() })
  : new Promise<void>(resolve => { unblockUpdate = resolve; updateBegan() }))
const loading = overlap.catalog.load()
await loadStarted
const updating = overlap.catalog.update(prompts => [...prompts, custom('during-load')])
assert.equal(overlap.catalog.pending.value, true)
assert.deepEqual(overlap.catalog.prompts.value, [])
unblockLoad()
await loading
await updateStarted
assert.equal(overlap.catalog.pending.value, true, 'Finishing a load does not clear the busy state of its queued save')
assert.equal(overlap.catalog.prompts.value.length, DEFAULT_PROMPTS.length)
unblockUpdate()
await updating
assert.equal(overlap.catalog.prompts.value.length, DEFAULT_PROMPTS.length + 1)
assert.equal(overlap.catalog.pending.value, false)
console.log('✓ Shared catalog: fresh entry, legacy and string-ID migrations, intentional deletion, failed writes, partial retry and serialized edits')

/** Execute the actual page handlers with the real catalog and controlled storage. */
function pageHandlers(catalog: ReturnType<typeof createPromptCatalog>) {
  const sourceText = readFileSync(new URL('../src/views/PromptsLibrary.vue', import.meta.url), 'utf8')
    .match(/<script\b[^>]*>([\s\S]*?)<\/script>/)![1]
  const source = ts.createSourceFile('PromptsLibrary.vue', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names = ['savePrompt', 'deletePrompt', 'confirmImport', 'resetForm', 'cancelImport']
  const declarations = source.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
    .filter(declaration => ts.isIdentifier(declaration.name) && names.includes(declaration.name.text))
  assert.equal(declarations.length, names.length)
  const success: string[] = []
  const errors: string[] = []
  let cancelled = false
  const state = {
    promptCatalog: catalog, catalogSaving: catalog.pending,
    formRef: ref({ validate: async () => true }), savingPrompt: ref(false), importingPrompts: ref(false),
    editingPrompt: ref<PromptTemplate | null>(null), showAddDialog: ref(true), tagInput: ref('Draft tag'),
    promptForm: ref({ title: 'Draft title', category: 'content', description: 'Draft description', content: 'Draft content', tags: ['draft'] }),
    previewPrompts: ref([custom('import-preview')]), showImportDialog: ref(true), importJsonText: ref('Keep this input'), importMethod: ref('text'),
    ElMessage: { success: (message: string) => success.push(message), error: (message: string) => errors.push(message), warning() {} },
    ElMessageBox: { confirm: async () => { if (cancelled) throw 'cancel' } },
  }
  const code = ts.transpileModule(`${declarations.map(declaration => `const ${declaration.getText(source)}`).join('\n')};return {${names.join(',')}}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const handlers = new Function(...Object.keys(state), code)(...Object.values(state)) as {
    savePrompt(): Promise<void>; deletePrompt(prompt: PromptTemplate): Promise<void>; confirmImport(): Promise<void>
  }
  return { ...state, ...handlers, success, errors, cancel: () => { cancelled = true } }
}

for (const operation of ['create', 'edit', 'delete', 'import'] as const) {
  for (const mode of ['sync', 'async'] as const) {
    const stored = fixture([custom()], PROMPTS_VERSION)
    await stored.catalog.load()
    const page = pageHandlers(stored.catalog)
    if (operation === 'edit') page.editingPrompt.value = custom()
    const invoke = () => operation === 'delete' ? page.deletePrompt(custom()) : operation === 'import' ? page.confirmImport() : page.savePrompt()
    stored.fail(mode)
    await invoke()
    assert.deepEqual(stored.catalog.prompts.value, [custom()], `${operation}: retain the last committed list after ${mode} failure`)
    assert.deepEqual(stored.disk(), [custom()])
    assert.equal(page.success.length, 0)
    assert.equal(page.errors.length, 1)
    assert.equal(page.showAddDialog.value, true)
    assert.equal(page.promptForm.value.content, 'Draft content')
    assert.equal(page.showImportDialog.value, true)
    assert.equal(page.importJsonText.value, 'Keep this input')
    assert.equal(page.previewPrompts.value.length, 1)
    stored.fail('none')
    await invoke()
    assert.equal(page.success.length, 1)
    assert.deepEqual(stored.disk(), copy(stored.catalog.prompts.value))
    if (operation === 'create') {
      assert.equal(stored.catalog.prompts.value.length, 2)
      assert.equal(page.showAddDialog.value, false)
    } else if (operation === 'edit') {
      assert.equal(stored.catalog.prompts.value[0].content, 'Draft content')
      assert.deepEqual(stored.catalog.prompts.value[0].extension, { keep: true })
      assert.equal(page.showAddDialog.value, false)
    } else if (operation === 'delete') assert.deepEqual(stored.catalog.prompts.value, [])
    else {
      assert.equal(stored.catalog.prompts.value.length, 2)
      assert.equal(page.showImportDialog.value, false)
      assert.deepEqual(page.previewPrompts.value, [])
    }
  }
}

const delayed = fixture([custom()], PROMPTS_VERSION)
await delayed.catalog.load()
const page = pageHandlers(delayed.catalog)
let finish!: () => void
let began!: () => void
const started = new Promise<void>(resolve => { began = resolve })
delayed.block(() => { began(); return new Promise<void>(resolve => { finish = resolve }) })
const saving = page.savePrompt()
await started
assert.equal(page.savingPrompt.value, true)
assert.equal(page.showAddDialog.value, true)
assert.equal(page.success.length, 0)
assert.equal(delayed.catalog.prompts.value.length, 1)
await page.savePrompt()
assert.equal(delayed.writes(), 1, 'Repeated clicks cannot enqueue duplicate creates')
finish()
await saving
assert.equal(page.showAddDialog.value, false)
assert.equal(page.success.length, 1)
assert.equal(delayed.catalog.prompts.value.length, 2)
const cancelled = pageHandlers(delayed.catalog)
cancelled.cancel()
const writesBefore = delayed.writes()
await cancelled.deletePrompt(custom())
assert.equal(delayed.writes(), writesBefore)
assert.deepEqual(cancelled.errors, [], 'Confirmation cancellation is separate from a save failure')
console.log('✓ Actual prompt management handlers: create/edit/delete/import rollback, retry, metadata preservation, pending UX and cancellation')
