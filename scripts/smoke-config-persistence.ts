/** Real service and UI handlers: failed writes retain committed data and retryable drafts. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { computed, ref } from 'vue'
import { StorageKeys, storageSet } from '../src/utils/storage'
import { validateGenerationBudget } from '../src/utils/generationBudget'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const disk = new Map<string, string>()
let rejectedKey = ''
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => disk.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === rejectedKey) throw new DOMException('Simulated storage quota', 'QuotaExceededError')
      disk.set(key, value)
    },
    removeItem: (key: string) => disk.delete(key),
  },
})

function handlers(file: string, names: string[], dependencies: Record<string, unknown>) {
  const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
  const script = text.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)![1]
  const source = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declarations = source.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .filter(declaration => ts.isIdentifier(declaration.name) && names.includes(declaration.name.text))
    .map(declaration => `const ${declaration.getText(source)}`)
  assert.equal(declarations.length, names.length, `${file}: actual handlers must exist`)
  const executable = ts.transpileModule(`${declarations.join('\n')}\nreturn { ${names.join(', ')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  return new Function(...Object.keys(dependencies), executable)(...Object.values(dependencies))
}

const success: string[] = []
const errors: string[] = []
const messages = {
  success: (value: string) => success.push(value),
  error: (value: string) => errors.push(value),
  warning: (value: string) => errors.push(value),
}
const quietConsole = { error() {} }
const originalConsoleError = console.error
const originalConsoleWarn = console.warn
console.error = () => {}
console.warn = () => {}

try {
  const { useApiConfig } = await import('../src/services/apiConfig')
  const config = useApiConfig()
  config.updateConfig({ apiKey: 'old-key', selectedModel: 'old-model', customHeaders: { 'X-Old': 'yes' } })
  config.setCustomModels([{ id: 'old-model', name: 'Old model' }])
  config.setProviderModels('custom', ['old-model'])

  for (const [key, read, change] of [
    [StorageKeys.apiConfig, () => config.activeConfig.value, () => config.updateConfig({ apiKey: 'new-key' })],
    [StorageKeys.apiConfig, () => config.activeConfig.value, () => config.resetConfig()],
    [StorageKeys.customModels, () => config.customModels.value, () => config.setCustomModels([{ id: 'new-model', name: 'New model' }])],
    [StorageKeys.providerModels, () => config.providerModels.value, () => config.setProviderModels('custom', ['new-model'])],
  ] as const) {
    const committed = clone(read())
    const persisted = disk.get(key)
    rejectedKey = key
    assert.throws(change, /Simulated storage quota/)
    assert.deepEqual(clone(read()), committed, `${key}: failed write must not publish state`)
    assert.equal(disk.get(key), persisted, `${key}: failed write must retain saved data`)
    rejectedKey = ''
    change()
    assert.deepEqual(JSON.parse(disk.get(key)!), clone(read()), `${key}: retry publishes the saved snapshot`)
  }

  const headerDraft = { 'X-Draft': 'saved' }
  config.updateConfig({ customHeaders: headerDraft })
  headerDraft['X-Draft'] = 'unsaved'
  assert.equal(config.activeConfig.value.customHeaders?.['X-Draft'], 'saved', 'published config must not share nested draft headers')

  config.setCustomModels([])
  const customModelInput = ref('draft-model')
  const apiForm = { ...clone(config.activeConfig.value), selectedModel: 'draft-model', apiKey: 'draft-key', customHeaders: {} }
  let configLoads = 0
  const apiHandlers = handlers('components/ApiConfig.vue', ['addCustomModel', 'removeCustomModel', 'resetForm', 'saveConfig'], {
    ...config,
    customModelInput, form: apiForm, validating: ref(false),
    disposed: false, snapshotForm: () => ({ ...apiForm, customHeaders: {} }),
    beginRequest: () => ({ controller: new AbortController() }), isCurrentRequest: () => true,
    finishRequest() {}, cancelRequests() {},
    availableModels: computed(() => config.customModels.value),
    validateForm: () => true, validateGenerationBudget, collectHeaders: () => ({}),
    apiService: { validateAPIKey: async () => true },
    loadSavedConfig: () => { configLoads++ }, ElMessage: messages,
  })
  rejectedKey = StorageKeys.customModels
  success.length = errors.length = 0
  apiHandlers.addCustomModel()
  assert.equal(customModelInput.value, 'draft-model')
  assert.equal(config.customModels.value.length, 0)
  assert.equal(success.length, 0)
  assert.equal(errors.length, 1)
  rejectedKey = ''
  apiHandlers.addCustomModel()
  assert.equal(config.customModels.value.length, 1, 'retry must add only one custom model')
  assert.equal(customModelInput.value, '')

  rejectedKey = StorageKeys.customModels
  success.length = errors.length = 0
  apiHandlers.removeCustomModel('draft-model')
  assert.equal(config.customModels.value.length, 1)
  assert.equal(apiForm.selectedModel, 'draft-model', 'failed model deletion must retain current draft selection')
  assert.equal(success.length, 0)
  assert.equal(errors.length, 1)
  rejectedKey = ''
  apiHandlers.removeCustomModel('draft-model')
  assert.equal(config.customModels.value.length, 0)
  assert.equal(apiForm.selectedModel, 'gpt-5.4-mini')

  rejectedKey = StorageKeys.apiConfig
  success.length = errors.length = 0
  const committedApi = clone(config.activeConfig.value)
  await apiHandlers.saveConfig()
  assert.deepEqual(clone(config.activeConfig.value), committedApi)
  assert.equal(apiForm.apiKey, 'draft-key')
  assert.equal(success.length, 0)
  assert.equal(errors.length, 1)
  apiHandlers.resetForm()
  assert.equal(configLoads, 0, 'failed reset must not replace unsaved form input')
  assert.deepEqual(clone(config.activeConfig.value), committedApi)
  rejectedKey = ''
  await apiHandlers.saveConfig()
  assert.equal(config.activeConfig.value.apiKey, 'draft-key')
  assert.equal(success.length, 1)

  const initialGenre = {
    code: 'original', name: '原题材', prompt: '原提示词', tags: ['保留标签'], examples: '示例',
    createdAt: '2026-09-01', usageCount: 4, isDefault: false, extension: 'legacy-metadata',
  }
  const genres = ref([clone(initialGenre)])
  const genreForm = ref({ code: 'new', name: '新题材', prompt: '保留草稿', tags: ['新标签'], examples: '示例' })
  const editingGenre = ref<null | typeof initialGenre>(null)
  const dialog = ref(true)
  let cancelled = false
  const genreHandlers = handlers('views/GenreManagement.vue', ['saveGenres', 'saveGenre', 'deleteGenre', 'editGenre', 'resetForm'], {
    genres, genreForm, editingGenre,
    formRef: ref({ validate: async () => true, clearValidate() {} }),
    tagInput: ref(''), showCreateDialog: dialog, isSaving: ref(false),
    storageSet, StorageKeys, ElMessage: messages, console: quietConsole,
    ElMessageBox: { confirm: async () => { if (cancelled) throw 'cancel' } },
  })
  storageSet(StorageKeys.novelGenres, genres.value)
  const genreDraft = clone(genreForm.value)
  rejectedKey = StorageKeys.novelGenres
  success.length = errors.length = 0
  await genreHandlers.saveGenre()
  assert.deepEqual(clone(genres.value), [initialGenre])
  assert.deepEqual(clone(genreForm.value), genreDraft)
  assert.equal(dialog.value, true)
  assert.equal(success.length, 0)
  assert.equal(errors.length, 1)
  rejectedKey = ''
  await Promise.all([genreHandlers.saveGenre(), genreHandlers.saveGenre()])
  assert.equal(genres.value.length, 2, 'retry and overlapping clicks must add one genre')
  assert.equal(dialog.value, false)
  assert.equal(success.length, 1)

  genreHandlers.editGenre(genres.value[0])
  genreForm.value.name = '编辑后的题材'
  rejectedKey = StorageKeys.novelGenres
  success.length = errors.length = 0
  await genreHandlers.saveGenre()
  assert.deepEqual(clone(genres.value[0]), initialGenre)
  assert.equal(genreForm.value.name, '编辑后的题材')
  assert.equal(dialog.value, true)
  assert.equal(success.length, 0)
  rejectedKey = ''
  await genreHandlers.saveGenre()
  assert.equal(genres.value[0].name, '编辑后的题材')
  assert.equal(genres.value[0].extension, 'legacy-metadata')
  assert.equal(genres.value[0].usageCount, 4)

  rejectedKey = StorageKeys.novelGenres
  success.length = errors.length = 0
  await genreHandlers.deleteGenre(genres.value[0])
  assert.equal(genres.value.length, 2)
  assert.equal(success.length, 0)
  assert.equal(errors.length, 1)
  rejectedKey = ''
  cancelled = true
  await genreHandlers.deleteGenre(genres.value[0])
  assert.equal(genres.value.length, 2)
  assert.equal(errors.length, 1, 'cancelling deletion must not report a save failure')
  cancelled = false
  await genreHandlers.deleteGenre(genres.value[0])
  assert.equal(genres.value.length, 1)
  assert.equal(success.length, 1)

  const savedContextPolicy = ref({ maxTokens: 4000 })
  let failPolicy = false
  const policyHandlers = handlers('views/Settings.vue', ['contextPolicy', 'saveContextPolicy', 'resetContextPolicy'], {
    ref, savedContextPolicy,
    persistContextPolicy: (value: { maxTokens: number }) => {
      if (failPolicy) throw new Error('Policy save rejected')
      savedContextPolicy.value = value
    },
    resetPolicy: () => {
      if (failPolicy) throw new Error('Policy reset rejected')
      savedContextPolicy.value = { maxTokens: 4000 }
    }, ElMessage: messages, console: quietConsole,
  })
  policyHandlers.contextPolicy.value.maxTokens = 8000
  assert.equal(savedContextPolicy.value.maxTokens, 4000, 'editing the form must not change committed global policy')
  failPolicy = true
  success.length = errors.length = 0
  policyHandlers.saveContextPolicy()
  policyHandlers.resetContextPolicy()
  assert.equal(policyHandlers.contextPolicy.value.maxTokens, 8000)
  assert.equal(savedContextPolicy.value.maxTokens, 4000)
  assert.equal(success.length, 0)
  assert.equal(errors.length, 2)
  failPolicy = false
  policyHandlers.saveContextPolicy()
  assert.equal(savedContextPolicy.value.maxTokens, 8000)
  assert.equal(success.length, 1)
} finally {
  console.error = originalConsoleError
  console.warn = originalConsoleWarn
}

console.log('Config and genre persistence smoke passed: failed saves retain state and drafts; retries commit once')
