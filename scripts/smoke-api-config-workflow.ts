/** Exercise the actual configuration component, service probes and endpoint-scoped caches. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { computed, effectScope, reactive, ref, watch } from 'vue'
import type { ApiConfig } from '../src/types/api'
import { FALLBACK_MODELS, getPreset, PROVIDER_PRESETS, fetchProviderModels } from '../src/services/aiProviders'
import { DEFAULT_OUTPUT_TOKENS, THINKING_PROTOCOL_OPTIONS, getThinkingCapability, validateGenerationBudget } from '../src/utils/generationBudget'

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
const { useApiConfig } = await import('../src/services/apiConfig')
const apiService = (await import('../src/services/api')).default
const state = useApiConfig()
assert.equal(state.activeConfig.value.maxTokens, DEFAULT_OUTPUT_TOKENS)
assert.equal(state.activeConfig.value.thinkingMode, 'default')
state.updateConfig({ provider: 'custom', apiKey: 'committed-key', baseURL: 'https://committed.test/v1', selectedModel: 'committed-model' })
const committed = clone(state.activeConfig.value)
const committedDisk = disk.get('apiConfig')

const source = readFileSync(new URL('../src/components/ApiConfig.vue', import.meta.url), 'utf8')
const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)![1]
const parsed = ts.createSourceFile('ApiConfig.vue', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const statements = parsed.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getText(parsed)).join('\n')
const exposed = 'form, headerRows, currentPreset, currentServerModels, fetchingModels, validating, testConnection, fetchModels, saveConfig, resetForm, onProviderChange, snapshotForm, thinkingCapability, showThinkingProtocol, thinkingProtocolOptions, onThinkingModeChange, handleUnlimitedTokensChange'
const executable = ts.transpileModule(`${statements}\nreturn { ${exposed} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

interface Request {
  kind: string
  config: ApiConfig
  signal: AbortSignal
  resolve(value: unknown): void
  reject(error: Error): void
}
function setup() {
  const requests: Request[] = []
  const notifications: Array<{ type: string; text: string }> = []
  const unmount: Array<() => void> = []
  let exposed: { cancelRequests(): void }
  // Deliberately ignore cancellation here: stale results must remain harmless even
  // if a transport settles after it has received its abort signal.
  const request = (kind: string, config: ApiConfig, { signal }: { signal: AbortSignal }) => new Promise((resolve, reject) => {
    requests.push({ kind, config: clone(config), signal, resolve, reject })
  })
  const dependencies = {
    computed, reactive, ref, watch, onBeforeUnmount: (callback: () => void) => unmount.push(callback),
    defineExpose: (value: { cancelRequests(): void }) => { exposed = value },
    useApiConfig, PROVIDER_PRESETS, FALLBACK_MODELS, getPreset,
    DEFAULT_OUTPUT_TOKENS, THINKING_PROTOCOL_OPTIONS, getThinkingCapability, validateGenerationBudget,
    apiService: { validateAPIKey: (config: ApiConfig, options: { signal: AbortSignal }) => request('connection', config, options) },
    fetchProviderModels: (config: ApiConfig, options: { signal: AbortSignal }) => request('models', config, options),
    ElMessage: Object.fromEntries(['success', 'warning', 'error'].map(type => [type, (text: string) => notifications.push({ type, text })])),
  }
  const scope = effectScope()
  const component = scope.run(() => new Function(...Object.keys(dependencies), executable)(...Object.values(dependencies)))
  return { ...component, requests, notifications, closeDialog: () => exposed.cancelRequests(), dispose: () => { unmount.forEach(callback => callback()); scope.stop() } }
}

const form = setup()
try {
  Object.assign(form.form, { baseURL: 'https://draft.test/v1/', apiKey: 'draft-key', proxyUrl: 'https://proxy.test/' })
  form.headerRows.value = [{ key: 'X-Workspace', value: 'draft-header' }]
  const test = form.testConnection()
  assert.deepEqual(form.requests[0].config, { ...clone(form.form), customHeaders: { 'X-Workspace': 'draft-header' } })
  form.requests[0].resolve(false)
  await test
  assert.equal(form.notifications.at(-1).text, '连接测试失败')
  assert.deepEqual(clone(state.activeConfig.value), committed)
  assert.equal(disk.get('apiConfig'), committedDisk, 'testing an unsaved draft must not persist it')

  const sync = form.fetchModels()
  assert.equal(form.requests[1].config.proxyUrl, 'https://proxy.test/')
  assert.deepEqual(form.requests[1].config.customHeaders, { 'X-Workspace': 'draft-header' })
  form.requests[1].resolve(['draft-model'])
  await sync
  assert.equal(form.form.selectedModel, 'draft-model')
  assert.deepEqual(form.currentServerModels.value, ['draft-model'])
  assert.deepEqual(state.getProviderModels(committed), [], 'a draft endpoint must not change the saved endpoint cache')
  assert.deepEqual(clone(state.activeConfig.value), committed)
  assert.equal(disk.get('apiConfig'), committedDisk)
  const cacheKeys = Object.keys(JSON.parse(disk.get('providerModels')!))
  assert.ok(cacheKeys.every(key => !key.includes('draft-key') && !key.includes('draft-header')))
  form.form.baseURL = 'https://another.test/v1'
  assert.deepEqual(form.currentServerModels.value, [])
  form.form.baseURL = 'https://draft.test/v1'
  assert.deepEqual(form.currentServerModels.value, ['draft-model'], 'trailing slash normalization retains the endpoint cache')
  form.form.proxyUrl = 'https://different-proxy.test/'
  assert.deepEqual(form.currentServerModels.value, [])

  state.setProviderModels('custom', ['legacy-unknown-endpoint'])
  assert.deepEqual(form.currentServerModels.value, [], 'legacy caches must not be assigned to an unknown endpoint')
  for (const connection of [
    { baseURL: 'https://user:secret-password@endpoint.test/v1' },
    { proxyUrl: 'https://user:proxy-secret@proxy.test/' },
    { proxyUrl: 'https://proxy.test/?token=secret-query' },
  ]) {
    const sensitive = { ...committed, ...connection }
    const persisted = disk.get('providerModels')
    state.setProviderModels(sensitive, ['in-memory-only'])
    assert.equal(disk.get('providerModels'), persisted, 'URL credentials must not be copied into persistent model-cache keys')
    assert.deepEqual(state.getProviderModels(sensitive), ['in-memory-only'])
  }

  const changes = [
    (view: any) => { view.form.provider = 'google'; view.onProviderChange('google') },
    (view: any) => { view.form.baseURL += '/changed' },
    (view: any) => { view.form.apiKey = 'changed-key' },
    (view: any) => { view.headerRows.value[0].value = 'changed-header' },
    (view: any) => { view.form.proxyUrl = 'https://changed-proxy.test/' },
  ]
  for (const [index, change] of changes.entries()) {
    const view = setup()
    try {
      view.form.baseURL = `https://stale-${index}.test/v1`
      view.headerRows.value = [{ key: 'X-Test', value: 'original' }]
      const oldDraft = view.snapshotForm()
      const old = view.fetchModels()
      change(view)
      assert.equal(view.requests[0].signal.aborted, true)
      assert.equal(view.fetchingModels.value, false)
      const latest = view.fetchModels()
      view.requests[0].resolve(['stale-model'])
      await old
      assert.equal(view.fetchingModels.value, true, 'a stale finally must not clear the newer request')
      assert.deepEqual(state.getProviderModels(oldDraft), [])
      assert.equal(view.notifications.length, 0)
      view.requests[1].resolve([`fresh-model-${index}`])
      await latest
      assert.equal(view.form.selectedModel, `fresh-model-${index}`)
      assert.deepEqual(view.currentServerModels.value, [`fresh-model-${index}`])
    } finally { view.dispose() }
  }

  const selected = setup()
  try {
    selected.form.baseURL = 'https://selection.test/v1'
    const first = selected.fetchModels()
    await selected.fetchModels()
    assert.equal(selected.requests.length, 1, 'repeated sync clicks must not start overlapping requests')
    selected.form.selectedModel = 'manually-selected-model'
    selected.requests[0].resolve(['server-model'])
    await first
    assert.equal(selected.form.selectedModel, 'manually-selected-model', 'a model chosen during sync must be retained')

    const checking = selected.testConnection()
    await selected.testConnection()
    assert.equal(selected.requests.length, 2)
    selected.form.apiKey = 'changed-during-test'
    assert.equal(selected.requests[1].signal.aborted, true)
    const count = selected.notifications.length
    selected.requests[1].resolve(true)
    await checking
    assert.equal(selected.notifications.length, count, 'a stale connection result must not report success')
  } finally { selected.dispose() }

  const removed = setup()
  const pendingModels = removed.fetchModels()
  const pendingTest = removed.testConnection()
  removed.dispose()
  assert.ok(removed.requests.every((request: Request) => request.signal.aborted))
  removed.requests[0].resolve(['unmounted-model'])
  removed.requests[1].resolve(true)
  await Promise.all([pendingModels, pendingTest])
  assert.equal(removed.notifications.length, 0)
  assert.equal(removed.fetchingModels.value, false)
  assert.equal(removed.validating.value, false)

  const closed = setup()
  const hiddenRequest = closed.fetchModels()
  closed.closeDialog() // Dashboard's close event cancels before its leave transition unmounts the child.
  assert.equal(closed.requests[0].signal.aborted, true)
  closed.requests[0].resolve(['hidden-dialog-model'])
  await hiddenRequest
  assert.equal(closed.notifications.length, 0)
  assert.equal(closed.fetchingModels.value, false)
  closed.dispose()

  const timeout = form.fetchModels()
  form.requests.at(-1).reject(new DOMException('连接请求超时，请重试', 'TimeoutError'))
  await timeout
  assert.equal(form.fetchingModels.value, false)
  assert.equal(form.notifications.at(-1).text, '连接请求超时，请重试')
  const save = form.saveConfig()
  assert.equal(state.activeConfig.value.apiKey, 'draft-key', 'only explicit save publishes the draft')
  assert.equal(form.notifications.at(-1).text, '配置保存成功')
  form.requests.at(-1).resolve(false)
  await save
  assert.equal(form.notifications.at(-1).type, 'warning')
  assert.match(form.notifications.at(-1).text, /配置已保存/)
  assert.equal(JSON.parse(disk.get('apiConfig')!).proxyUrl, 'https://different-proxy.test/')
} finally { form.dispose() }

const savedFetch = globalThis.fetch
try {
  const captured: Array<{ url: string; headers: unknown }> = []
  globalThis.fetch = async (input, init) => {
    captured.push({ url: String(input), headers: init?.headers })
    return new Response(JSON.stringify({ data: [{ id: 'proxy-model' }] }), { status: 200 })
  }
  const draft: ApiConfig = { ...committed, apiKey: 'probe-draft', baseURL: 'https://probe.test/v1/', proxyUrl: 'https://proxy.test/', customHeaders: { 'X-Draft': 'yes' } }
  const savedConfig = clone(state.activeConfig.value)
  assert.equal(await apiService.validateAPIKey(draft), true)
  assert.deepEqual(await fetchProviderModels(draft), ['proxy-model'])
  assert.equal(captured[0].url, 'https://proxy.test/https://probe.test/v1/models')
  assert.deepEqual(captured[0].headers, { Authorization: 'Bearer probe-draft', 'X-Draft': 'yes' })
  assert.deepEqual(captured[1], captured[0], 'sync and validation must probe the same full draft')
  assert.deepEqual(clone(state.activeConfig.value), savedConfig)
  // Match the SDK's existing rule: explicit custom headers override default authentication.
  for (const [provider, header, value] of [
    ['custom', 'Authorization', 'Bearer explicit-custom-key'],
    ['anthropic', 'x-api-key', 'explicit-anthropic-key'],
    ['google', 'x-goog-api-key', 'explicit-google-key'],
    ['custom', 'authorization', 'Bearer lowercase-custom-key'],
    ['anthropic', 'X-API-Key', 'mixedcase-anthropic-key'],
    ['google', 'X-Goog-API-Key', 'mixedcase-google-key'],
  ]) {
    const authDraft = { ...draft, provider, customHeaders: { [header]: value } }
    assert.equal(await apiService.validateAPIKey(authDraft), true)
    await fetchProviderModels(authDraft)
    for (const request of captured.slice(-2)) assert.equal(new Headers(request.headers as Record<string, string>).get(header), value)
  }

  globalThis.fetch = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
  })
  await assert.rejects(fetchProviderModels(draft, { timeoutMs: 5 }), { name: 'TimeoutError' })
  await assert.rejects(apiService.validateAPIKey(draft, { timeoutMs: 5 }), { name: 'TimeoutError' })
  const abort = new AbortController()
  const cancelled = fetchProviderModels(draft, { signal: abort.signal })
  abort.abort()
  await assert.rejects(cancelled, { name: 'AbortError' })
  await assert.rejects(fetchProviderModels(draft, { signal: abort.signal }), { name: 'AbortError' })

  // Receiving response headers does not end the timeout while the model body is pending.
  globalThis.fetch = async (_input, init) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })),
  }) as Response
  await assert.rejects(fetchProviderModels(draft, { timeoutMs: 5 }), { name: 'TimeoutError' })
} finally { globalThis.fetch = savedFetch }

const budgets = setup()
try {
  const beforeDraft = clone(state.activeConfig.value)
  const beforeDisk = disk.get('apiConfig')
  Object.assign(budgets.form, {
    provider: 'anthropic', selectedModel: 'claude-sonnet-4-5', apiKey: 'budget-key',
    maxTokens: 16384, unlimitedTokens: false, thinkingBudget: 4096,
  })
  budgets.form.thinkingMode = 'budget'
  assert.ok(budgets.thinkingCapability.value.modes.some((mode: { value: string }) => mode.value === 'budget'))
  assert.equal(budgets.showThinkingProtocol.value, true)
  assert.equal(budgets.currentPreset.value.editableBaseURL, true)
  assert.deepEqual(budgets.thinkingProtocolOptions.value.map((option: { value: string }) => option.value), ['auto', 'anthropic'])
  assert.deepEqual(clone(state.activeConfig.value), beforeDraft)

  budgets.form.thinkingBudget = -1
  await budgets.saveConfig()
  assert.equal(budgets.requests.length, 0, 'invalid budget must prevent a save before any connection probe')
  assert.equal(budgets.notifications.at(-1).type, 'warning')
  assert.deepEqual(clone(state.activeConfig.value), beforeDraft)
  assert.equal(disk.get('apiConfig'), beforeDisk)
  const probe = budgets.testConnection()
  assert.equal(budgets.requests.length, 1, 'invalid generation budget must not block an endpoint/authentication test')
  budgets.requests[0].resolve(true)
  await probe
  const models = budgets.fetchModels()
  assert.equal(budgets.requests.length, 2, 'invalid generation budget must not block model discovery')
  budgets.requests[1].resolve(['claude-sonnet-4-5'])
  await models
  assert.deepEqual(clone(state.activeConfig.value), beforeDraft, 'read operations must not publish the budget draft')
  assert.equal(disk.get('apiConfig'), beforeDisk)

  budgets.form.thinkingBudget = 6144
  const saveBudget = budgets.saveConfig()
  assert.equal(state.activeConfig.value.thinkingBudget, 6144)
  assert.equal(state.activeConfig.value.thinkingMode, 'budget')
  budgets.requests.at(-1).resolve(true)
  await saveBudget
  const reloaded = setup()
  try {
    assert.equal(reloaded.form.thinkingMode, 'budget', 'loading a saved model must retain its saved thinking mode')
    assert.equal(reloaded.form.thinkingBudget, 6144)
    assert.equal(reloaded.form.maxTokens, 16384)
    reloaded.form.thinkingBudget = 8192
    assert.equal(state.activeConfig.value.thinkingBudget, 6144, 'editing budget remains local to the reopened dialog')
  } finally { reloaded.dispose() }

  budgets.form.baseURL = 'https://native-gateway.test/v1/'
  budgets.form.selectedModel = 'qwen3.8-flash'
  assert.equal(budgets.form.thinkingMode, 'default')
  assert.deepEqual(budgets.thinkingCapability.value.modes.map((mode: { value: string }) => mode.value), ['default'])
  budgets.form.thinkingProtocol = 'anthropic'
  assert.deepEqual(budgets.thinkingCapability.value.modes.map((mode: { value: string }) => mode.value), ['default', 'disabled', 'budget'])
  budgets.form.thinkingMode = 'budget'
  budgets.form.thinkingBudget = 1024
  budgets.form.maxTokens = 4096
  const saveNative = budgets.saveConfig()
  const nativeRequest = budgets.requests.at(-1)
  assert.equal(nativeRequest.config.baseURL, 'https://native-gateway.test/v1/')
  assert.equal(nativeRequest.config.provider, 'anthropic')
  nativeRequest.resolve(true)
  await saveNative
  const nativeReload = setup()
  try {
    assert.equal(nativeReload.form.baseURL, 'https://native-gateway.test/v1/')
    assert.equal(nativeReload.form.selectedModel, 'qwen3.8-flash')
    assert.equal(nativeReload.form.thinkingProtocol, 'anthropic')
    assert.equal(nativeReload.form.thinkingMode, 'budget')
    assert.equal(nativeReload.form.thinkingBudget, 1024)
    assert.equal(nativeReload.form.maxTokens, 4096)
    assert.equal(nativeReload.currentPreset.value.editableBaseURL, true)
    // Choosing a known Claude still restores that model's specific capabilities.
    nativeReload.form.selectedModel = 'claude-sonnet-4-7'
    assert.equal(nativeReload.form.thinkingMode, 'default')
    assert.equal(nativeReload.thinkingCapability.value.modes.some((mode: { value: string }) => mode.value === 'budget'), false)
    nativeReload.form.provider = 'custom'
    nativeReload.onProviderChange('custom')
    assert.equal(nativeReload.form.thinkingProtocol, 'auto')
    assert.equal(nativeReload.thinkingProtocolOptions.value.some((option: { value: string }) => option.value === 'anthropic'), false)
  } finally { nativeReload.dispose() }

  budgets.form.maxTokens = 24576
  budgets.form.unlimitedTokens = true
  budgets.handleUnlimitedTokensChange()
  budgets.form.unlimitedTokens = false
  budgets.handleUnlimitedTokensChange()
  assert.equal(budgets.form.maxTokens, 24576, 'provider-default toggle must retain the previous numeric output budget')
  budgets.form.unlimitedTokens = true
  budgets.handleUnlimitedTokensChange()
  budgets.form.thinkingMode = 'default'
  const saveDefault = budgets.saveConfig()
  budgets.requests.at(-1).resolve(true)
  await saveDefault
  const defaults = setup()
  try {
    assert.equal(defaults.form.unlimitedTokens, true)
    assert.equal(defaults.form.thinkingMode, 'default')
    defaults.form.unlimitedTokens = false
    defaults.handleUnlimitedTokensChange()
    assert.equal(defaults.form.maxTokens, 24576, 'remembered output budget must survive save and reload')
  } finally { defaults.dispose() }

  budgets.form.provider = 'custom'
  budgets.onProviderChange('custom')
  budgets.form.selectedModel = 'gpt-5.4-mini'
  budgets.form.thinkingProtocol = 'openai'
  budgets.form.thinkingMode = 'effort'
  budgets.onThinkingModeChange()
  assert.ok(budgets.thinkingCapability.value.efforts.some((effort: { value: string }) => effort.value === budgets.form.thinkingEffort))
  const saveEffort = budgets.saveConfig()
  budgets.requests.at(-1).resolve(true)
  await saveEffort
  const savedEffort = setup()
  try {
    assert.equal(savedEffort.form.thinkingProtocol, 'openai')
    assert.equal(savedEffort.form.thinkingMode, 'effort')
    assert.equal(savedEffort.form.thinkingEffort, budgets.form.thinkingEffort)
    assert.equal(savedEffort.showThinkingProtocol.value, true)
  } finally { savedEffort.dispose() }
  budgets.form.selectedModel = 'unrecognized-model-alias'
  assert.equal(budgets.form.thinkingMode, 'default', 'changing models clears a potentially unsupported thinking mode')
  budgets.form.thinkingMode = 'effort'
  budgets.form.provider = 'google'
  budgets.onProviderChange('google')
  assert.equal(budgets.form.thinkingProtocol, 'auto')
  assert.equal(budgets.form.thinkingMode, 'default')
  assert.equal(budgets.showThinkingProtocol.value, false)

  const savedState = clone(state.activeConfig.value)
  const savedDisk = disk.get('apiConfig')
  const draft = clone(budgets.snapshotForm())
  const requestCount = budgets.requests.length
  const originalConsoleError = console.error
  console.error = () => {}
  rejectedKey = 'apiConfig'
  try {
    await budgets.saveConfig()
    assert.match(budgets.notifications.at(-1).text, /配置保存失败/)
    assert.equal(budgets.requests.length, requestCount, 'failed persistence must not start a connection probe')
    assert.deepEqual(clone(state.activeConfig.value), savedState)
    assert.equal(disk.get('apiConfig'), savedDisk)
    assert.deepEqual(clone(budgets.snapshotForm()), draft, 'failed save retains the complete budget draft')
    budgets.resetForm()
    assert.match(budgets.notifications.at(-1).text, /重置失败/)
    assert.deepEqual(clone(budgets.snapshotForm()), draft, 'failed reset retains the complete budget draft')
  } finally {
    rejectedKey = ''
    console.error = originalConsoleError
  }
  state.updateConfig({ maxTokens: null, unlimitedTokens: false, thinkingMode: 'default' })
  const legacy = setup()
  try {
    assert.equal(legacy.form.unlimitedTokens, true, 'legacy null output limit must continue using provider defaults')
    const saveLegacy = legacy.saveConfig()
    legacy.requests.at(-1).resolve(true)
    await saveLegacy
    assert.equal(state.activeConfig.value.unlimitedTokens, true, 'saving a legacy default must not introduce an output limit')
  } finally { legacy.dispose() }
  budgets.resetForm()
  assert.equal(budgets.form.maxTokens, DEFAULT_OUTPUT_TOKENS)
  assert.equal(budgets.form.unlimitedTokens, false)
  assert.equal(budgets.form.thinkingProtocol, 'auto')
  assert.equal(budgets.form.thinkingMode, 'default')
  assert.equal(budgets.form.thinkingBudget, 4096)
  assert.equal(budgets.form.thinkingEffort, 'medium')
} finally { budgets.dispose() }

console.log('API config workflow smoke passed: draft probes, budgets, saved defaults, scoped caches, stale-result isolation, cancellation and timeouts')
