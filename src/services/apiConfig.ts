import { computed, ref } from 'vue'
import { StorageKeys, storageGet, storageSet } from '@/utils/storage'
import type { ApiConfig, CustomModelOption } from '@/types/api'

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

const DEFAULT_CONFIG: ApiConfig = {
  apiKey: '',
  baseURL: DEFAULT_BASE_URL,
  provider: 'custom',
  selectedModel: 'gpt-5.4-mini',
  maxTokens: 2000000,
  unlimitedTokens: false,
  temperature: 0.7,
  customHeaders: {},
}

// ---------- 响应式状态（模块级单例，全应用共享同一份） ----------
const apiConfig = ref<ApiConfig>(structuredClone(DEFAULT_CONFIG))
const customModels = ref<CustomModelOption[]>([])
/** 从服务商拉取的模型列表缓存：{ [providerId]: string[] } */
const providerModels = ref<Record<string, string[]>>({})

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
  storageSet(StorageKeys.apiConfig, next)
  apiConfig.value = next
}

function setCustomModels(models: CustomModelOption[]): void {
  const next = models.map(model => ({ ...model }))
  storageSet(StorageKeys.customModels, next)
  customModels.value = next
}

function setProviderModels(providerId: string, models: string[]): void {
  const next = { ...providerModels.value, [providerId]: [...models] }
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
    resetConfig,
  }
}
