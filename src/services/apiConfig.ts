import { computed, ref } from 'vue'
import { StorageKeys, storageGet, storageSet } from '@/utils/storage'
import type { ApiConfig, CustomModelOption } from '@/types/api'
import { buildModelsProbe } from './aiProviders'
import { DEFAULT_OUTPUT_TOKENS, validateGenerationBudget } from '@/utils/generationBudget'

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

const DEFAULT_CONFIG: ApiConfig = {
  apiKey: '',
  baseURL: DEFAULT_BASE_URL,
  provider: 'custom',
  selectedModel: 'gpt-5.4-mini',
  maxTokens: DEFAULT_OUTPUT_TOKENS,
  thinkingProtocol: 'auto',
  thinkingMode: 'default',
  thinkingBudget: 4096,
  thinkingEffort: 'medium',
  unlimitedTokens: false,
  temperature: 0.7,
  customHeaders: {},
}

// ---------- 响应式状态（模块级单例，全应用共享同一份） ----------
const apiConfig = ref<ApiConfig>(structuredClone(DEFAULT_CONFIG))
const customModels = ref<CustomModelOption[]>([])
/** Cache scopes include provider, endpoint and proxy; legacy provider-only keys remain readable by backups. */
const providerModels = ref<Record<string, string[]>>({})
const transientProviderModels = ref<Record<string, string[]>>({})

const activeConfig = computed<ApiConfig>(() => apiConfig.value)

const isApiConfigured = computed(() => Boolean(apiConfig.value.apiKey?.trim()))

// ---------- 初始化与迁移 ----------
function loadFromStorage(): void {
  // 新键缺失时，尝试从旧版项目遗留的键中迁移一次
  try {
    let saved = storageGet<Partial<ApiConfig> | null>(StorageKeys.apiConfig, null)
    if (!saved) {
      const legacy =
        storageGet<Partial<ApiConfig> | null>(StorageKeys.customApiConfig, null) ??
        storageGet<Partial<ApiConfig> | null>(StorageKeys.officialApiConfig, null)
      if (legacy) {
        saved = legacy
      }
    }
    if (saved) {
      // 旧版配置无 provider 字段，回落到 custom（用户自填地址）
      apiConfig.value = {
        ...apiConfig.value,
        ...saved,
        provider: saved.provider ?? 'custom',
      }
    }
  } catch (error) {
    console.error('加载API配置失败:', error)
  }

  const savedModels = storageGet<CustomModelOption[] | null>(StorageKeys.customModels, null)
  if (savedModels) {
    customModels.value = savedModels
  }

  const savedProviderModels = storageGet<Record<string, string[]> | null>(StorageKeys.providerModels, null)
  if (savedProviderModels) {
    providerModels.value = savedProviderModels
  }
}

// ---------- 对外操作 ----------
function updateConfig(partial: Partial<ApiConfig>): void {
  const next = { ...apiConfig.value, ...partial }
  next.customHeaders = { ...next.customHeaders }
  const budgetError = validateGenerationBudget(next)
  if (budgetError) throw new Error(budgetError)
  storageSet(StorageKeys.apiConfig, next)
  apiConfig.value = next
}

function setCustomModels(models: CustomModelOption[]): void {
  const next = models.map(model => ({ ...model }))
  storageSet(StorageKeys.customModels, next)
  customModels.value = next
}

function modelsCacheScope(config: ApiConfig): { key: string; persistent: boolean } {
  const url = buildModelsProbe(config).url
  // User-supplied URLs may contain credentials in userinfo or query parameters.
  // Keep those entire scopes in memory rather than duplicating secrets on disk.
  const persistent = [config.baseURL, config.proxyUrl, url].filter(Boolean).every(value => {
    try {
      const parsed = new URL(value!)
      return !parsed.username && !parsed.password && !parsed.search && !parsed.hash
        && !(config.apiKey && value!.includes(config.apiKey))
    } catch { return false }
  })
  return { key: JSON.stringify([config.provider, url]), persistent }
}

function getProviderModels(config: ApiConfig = apiConfig.value): string[] {
  // Legacy provider-only caches have no known endpoint and must be re-fetched.
  const { key, persistent } = modelsCacheScope(config)
  return (persistent ? providerModels : transientProviderModels).value[key] ?? []
}

function setProviderModels(config: ApiConfig | string, models: string[]): void {
  const { key, persistent } = typeof config === 'string' ? { key: config, persistent: true } : modelsCacheScope(config)
  if (!persistent) {
    transientProviderModels.value = { ...transientProviderModels.value, [key]: [...models] }
    return
  }
  const next = { ...providerModels.value, [key]: [...models] }
  storageSet(StorageKeys.providerModels, next)
  providerModels.value = next
}

function resetConfig(): void {
  const next = structuredClone(DEFAULT_CONFIG)
  storageSet(StorageKeys.apiConfig, next)
  apiConfig.value = next
}

loadFromStorage()

export function useApiConfig() {
  return {
    apiConfig,
    customModels,
    providerModels,
    activeConfig,
    isApiConfigured,
    updateConfig,
    setCustomModels,
    setProviderModels,
    getProviderModels,
    resetConfig,
  }
}
