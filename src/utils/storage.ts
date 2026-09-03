/**
 * 集中式 localStorage 存储层。
 * 全应用对 localStorage 的访问都必须经由本模块，
 * 键名在此统一登记，避免散落在各视图中的魔法字符串。
 */

export const StorageKeys = {
  /** 小说项目集合 */
  novels: 'novels',
  /** 提示词库 */
  prompts: 'prompts',
  /** 小说类型（题材）集合 */
  novelGenres: 'novelGenres',
  /** 写作目标 */
  writingGoals: 'writingGoals',
  /** API 配置（单一配置） */
  apiConfig: 'apiConfig',
  /** 自定义模型列表 */
  customModels: 'customModels',
  /** 从服务商拉取的模型列表缓存：{ [providerId]: string[] } */
  providerModels: 'providerModels',
  /** 短文创作配置 */
  shortStoryConfig: 'shortStoryConfig',
  /** 拆书分析章节摘要提示词模板 */
  chapterSummaryPromptTemplate: 'chapterSummaryPromptTemplate',
  /** 账户余额（本地模拟记账） */
  accountBalance: 'account_balance',
  /** 计费记录 */
  billingRecords: 'billing_records',
  /** Token 使用统计 */
  tokenUsageStats: 'token_usage_stats',
  /** 最近已读公告版本 */
  lastReadAnnouncementVersion: 'lastReadAnnouncementVersion',
  /** 最近已读公告日期 */
  lastReadAnnouncementDate: 'lastReadAnnouncementDate',
  /** 主题模式：light | dark | system */
  theme: 'app_theme',
  /** AI 助手集合 */
  assistants: 'assistants',
  /** AI 助手会话：{ [assistantId]: AssistantChatEntry[] } */
  assistantConversations: 'assistantConversations',
  /** AI 助手滚动摘要：{ [assistantId]: string } */
  assistantSummaries: 'assistantSummaries',
  /** 全局上下文容量策略 */
  contextPolicy: 'contextPolicy',
  // ---- 旧版项目遗留键（仅用于一次性数据迁移读取，不再写入） ----
  /** @deprecated 旧版官方 API 配置 */
  officialApiConfig: 'officialApiConfig',
  /** @deprecated 旧版自定义 API 配置 */
  customApiConfig: 'customApiConfig',
  // ---- Settings 导入/导出使用的旧版设置键（保持兼容，仅 Settings 读写） ----
  /** 旧版系统设置导出键：API 配置 */
  legacySettingsApiConfig: 'api-config',
  /** 旧版系统设置导出键：Token 用量 */
  legacySettingsTokenUsage: 'token-usage',
} as const

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys]

/** 已废弃的旧键 → 替代键映射（读取时自动迁移，写入只用新键） */
export const LegacyKeyMap: Record<string, StorageKey> = {}

function resolveKey(key: StorageKey | string): string {
  return LegacyKeyMap[key] ?? key
}

// ---- 大载荷分片后端注册（如 novels：正文走 IndexedDB，元数据留 localStorage） ----

/** 分片键后端：get/set 均操作内存缓存，持久化由后端自行分层 */
export interface ChunkedKeyBackend {
  /** 同步读取（启动时已 hydrate 到内存） */
  get(): unknown
  /** 写入：内存立即生效，持久化异步完成；快路径下配额错误同步抛出 */
  set(value: unknown): void
  /** 清除：内存缓存 + LS 键 + IDB 分片 */
  remove(): void
  /** 启动 hydrate 是否已完成 */
  isReady(): boolean
}

const chunkedBackends = new Map<string, ChunkedKeyBackend>()

/** 为指定键注册分片后端（应用启动时由持久化模块调用，早于任何组件挂载） */
export function registerChunkedKey(key: StorageKey | string, backend: ChunkedKeyBackend): void {
  chunkedBackends.set(resolveKey(key), backend)
}

/** 读取并反序列化，失败或缺失时返回 fallback；已注册分片后端的键优先走内存缓存 */
export function storageGet<T>(key: StorageKey | string, fallback: T): T {
  const resolved = resolveKey(key)
  const backend = chunkedBackends.get(resolved)
  if (backend && backend.isReady()) {
    return backend.get() as T
  }
  try {
    const raw = localStorage.getItem(resolved)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch (error) {
    console.warn(`[storage] 读取 ${String(key)} 失败，返回默认值:`, error)
    return fallback
  }
}

/** 序列化写入（含配额清理重试）；供分片后端快路径复用，非公开 API */
export function writeSerializedWithRetry(target: string, serialized: string): void {
  try {
    localStorage.setItem(target, serialized)
  } catch (error) {
    if (!isQuotaError(error)) {
      console.error(`[storage] 写入 ${target} 失败:`, error)
      throw error
    }

    // 配额不足：清除可再生缓存后重试一次
    console.warn(`[storage] 写入 ${target} 触发配额限制，尝试清理可再生缓存`)
    for (const evictable of EVICTABLE_KEYS) {
      const evictableKey = resolveKey(evictable)
      if (evictableKey !== target && !chunkedBackends.has(evictableKey)) {
        try {
          localStorage.removeItem(evictableKey)
        } catch {
          // 清理失败不阻塞重试
        }
      }
    }

    try {
      localStorage.setItem(target, serialized)
      console.warn(`[storage] 清理缓存后写入 ${target} 成功`)
    } catch (retryError) {
      console.error(`[storage] 写入 ${target} 失败（存储配额不足）:`, retryError)
      throw retryError
    }
  }
}

/** 删除键；已注册分片后端的键连同 IDB 分片一并清除 */
export function storageRemove(key: StorageKey | string): void {
  const resolved = resolveKey(key)
  const backend = chunkedBackends.get(resolved)
  if (backend && backend.isReady()) {
    backend.remove()
    return
  }
  try {
    localStorage.removeItem(resolved)
  } catch (error) {
    console.error(`[storage] 删除 ${String(key)} 失败:`, error)
  }
}

/** 清空全部本地存储（含各分片后端的 IDB 数据） */
export function storageClear(): void {
  try {
    for (const backend of chunkedBackends.values()) {
      if (backend.isReady()) backend.remove()
    }
    localStorage.clear()
  } catch (error) {
    console.error('[storage] 清空失败:', error)
  }
}

/** 可再生的缓存键（配额紧张时优先清除，需要时会自动重建） */
const EVICTABLE_KEYS: StorageKey[] = ['providerModels']

function isQuotaError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error.code === 22
  )
}

/** 序列化并写入；配额不足时先清除可再生缓存重试，仍失败则显式抛出。
 *  已注册分片后端的键整键转交后端处理。 */
export function storageSet(key: StorageKey | string, value: unknown): void {
  const resolved = resolveKey(key)
  const backend = chunkedBackends.get(resolved)
  if (backend && backend.isReady()) {
    backend.set(value)
    return
  }

  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch (error) {
    console.error(`[storage] 序列化 ${String(key)} 失败:`, error)
    throw error
  }
  writeSerializedWithRetry(resolved, serialized)
}

/**
 * 创建一个带默认值的持久化键助手，
 * 供各 service / store 用一行代码完成 load/save。
 */
export function createPersistentState<T>(key: StorageKey | string, defaultValue: T) {
  return {
    key,
    load(): T {
      const value = storageGet<T | null>(key, null)
      return value === null ? structuredClone(defaultValue) : value
    },
    save(value: T): void {
      storageSet(key, value)
    },
    reset(): void {
      storageSet(key, defaultValue)
    },
  }
}

/** 原始字符串读取（未序列化场景） */
export function storageGetRaw(key: StorageKey | string): string | null {
  return localStorage.getItem(resolveKey(key))
}

/** 原始字符串写入 */
export function storageSetRaw(key: StorageKey | string, value: string): void {
  localStorage.setItem(resolveKey(key), value)
}
