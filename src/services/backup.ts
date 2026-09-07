import {
  StorageKeys, storageGet, storageGetRaw, storageSet, storageSetRaw, storageRemove,
  type StorageKey,
} from '../utils/storage'

export const BACKUP_GROUPS = {
  novels: [StorageKeys.novels],
  prompts: [StorageKeys.prompts, StorageKeys.promptsVersion],
  novelGenres: [StorageKeys.novelGenres],
  writingGoals: [StorageKeys.writingGoals],
  assistants: [StorageKeys.assistants, StorageKeys.assistantConversations, StorageKeys.assistantSummaries],
  settings: [
    StorageKeys.apiConfig, StorageKeys.customModels, StorageKeys.providerModels,
    StorageKeys.shortStoryConfig, StorageKeys.chapterSummaryPromptTemplate,
    StorageKeys.accountBalance, StorageKeys.billingRecords, StorageKeys.tokenUsageStats,
    StorageKeys.lastReadAnnouncementVersion, StorageKeys.lastReadAnnouncementDate,
    StorageKeys.theme, StorageKeys.contextPolicy,
  ],
} as const

export type BackupGroup = keyof typeof BACKUP_GROUPS
export const ALL_BACKUP_GROUPS = Object.keys(BACKUP_GROUPS) as BackupGroup[]
const ALL_KEYS: StorageKey[] = Object.values(BACKUP_GROUPS).flat()
const RAW_KEYS: StorageKey[] = [
  StorageKeys.chapterSummaryPromptTemplate,
  StorageKeys.lastReadAnnouncementVersion, StorageKeys.lastReadAnnouncementDate,
]
type Data = Partial<Record<StorageKey, unknown>>
type JsonObject = Record<string, unknown>

export interface BackupFile {
  format: 'llm-writer-backup'
  version: 2
  exportTime: string
  data: Data
}

export class BackupValidationError extends Error {}

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function check(condition: unknown, path: string): asserts condition {
  if (!condition) throw new BackupValidationError(`备份数据格式错误：${path}`)
}
const string = (value: unknown) => typeof value === 'string'
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
const identifier = (value: unknown) => number(value) || (string(value) && value !== '')
const strings = (value: unknown) => Array.isArray(value) && value.every(string)
function fields(value: JsonObject, names: string[], valid: (value: unknown) => boolean, path: string) {
  for (const name of names) if (name in value) check(valid(value[name]), `${path}.${name}`)
}
function records(value: unknown, path: string, validate: (item: JsonObject, path: string) => void) {
  check(Array.isArray(value), path)
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`
    check(object(item), itemPath)
    validate(item, itemPath)
  })
}
function idAndTitle(item: JsonObject, path: string) {
  check(identifier(item.id) && string(item.title), path)
}
function policy(value: unknown, path: string) {
  check(object(value), path)
  fields(value, ['maxTokens', 'maxTurns', 'retainTurns'], v => number(v) && (v as number) >= 0, path)
  fields(value, ['summaryThreshold'], v => number(v) && (v as number) > 0 && (v as number) <= 100, path)
  fields(value, ['strategy'], v => v === 'summary' || v === 'truncation', path)
}

/** 校验应用会直接读取的容器和字段；可选历史字段与扩展字段保留原样。 */
function validateValue(key: StorageKey, value: unknown): void {
  const path = key
  switch (key) {
    case StorageKeys.novels:
      records(value, path, (novel, p) => {
        idAndTitle(novel, p)
        if ('chapterList' in novel) records(novel.chapterList, `${p}.chapterList`, (chapter, cp) => {
          idAndTitle(chapter, cp)
          fields(chapter, ['content', 'outline', 'summary', 'status'], string, cp)
        })
        for (const field of ['characters', 'worldSettings', 'corpusData', 'events']) {
          if (field in novel) records(novel[field], `${p}.${field}`, (item, ip) => {
            check(identifier(item.id), `${ip}.id`)
            fields(item, ['name', 'title', 'description', 'content', 'background'], string, ip)
          })
        }
        fields(novel, ['tags'], strings, p)
      })
      break
    case StorageKeys.prompts:
      records(value, path, (item, p) => {
        idAndTitle(item, p)
        check(string(item.content), `${p}.content`)
        fields(item, ['category', 'description'], string, p)
        fields(item, ['tags'], strings, p)
      })
      break
    case StorageKeys.novelGenres:
      records(value, path, (item, p) => {
        check(string(item.code) && string(item.name), p)
        fields(item, ['tags'], strings, p)
      })
      break
    case StorageKeys.writingGoals:
      records(value, path, (item, p) => {
        idAndTitle(item, p)
        fields(item, ['type', 'status', 'startDate', 'endDate'], string, p)
        fields(item, ['targetValue', 'currentValue'], number, p)
        if ('progressHistory' in item) records(item.progressHistory, `${p}.progressHistory`, () => {})
      })
      break
    case StorageKeys.assistants:
      records(value, path, (item, p) => {
        check(number(item.id) && string(item.name) && string(item.persona), p)
        fields(item, ['defaultModel', 'createdAt', 'updatedAt'], string, p)
        if ('contextPolicy' in item) policy(item.contextPolicy, `${p}.contextPolicy`)
      })
      break
    case StorageKeys.assistantConversations:
      check(object(value), path)
      for (const [id, entries] of Object.entries(value)) records(entries, `${path}.${id}`, (entry, p) => {
        check(string(entry.id) && string(entry.content) && typeof entry.isUser === 'boolean' && string(entry.timestamp), p)
      })
      break
    case StorageKeys.assistantSummaries:
      check(object(value) && Object.values(value).every(string), path)
      break
    case StorageKeys.apiConfig:
      check(object(value), path)
      fields(value, ['apiKey', 'baseURL', 'provider', 'selectedModel', 'proxyUrl'], string, path)
      fields(value, ['maxTokens'], v => v === null || (number(v) && (v as number) >= 0), path)
      fields(value, ['temperature'], number, path)
      fields(value, ['unlimitedTokens'], v => typeof v === 'boolean', path)
      fields(value, ['customHeaders'], v => object(v) && Object.values(v).every(string), path)
      break
    case StorageKeys.customModels:
      records(value, path, (item, p) => check(string(item.id) && string(item.name), p))
      break
    case StorageKeys.providerModels:
      check(object(value) && Object.values(value).every(strings), path)
      break
    case StorageKeys.shortStoryConfig:
      check(object(value), path)
      for (const [field, items] of Object.entries(value)) records(items, `${path}.${field}`, (item, p) => {
        check(string(item.label) && string(item.value), p)
      })
      break
    case StorageKeys.billingRecords:
      records(value, path, (item, p) => {
        check(number(item.id) && string(item.timestamp), p)
        fields(item, ['inputTokens', 'outputTokens', 'totalTokens', 'cost'], number, p)
        fields(item, ['type', 'model', 'content', 'response', 'status'], string, p)
      })
      break
    case StorageKeys.tokenUsageStats:
      check(object(value), path)
      check(['totalInputTokens', 'totalOutputTokens', 'totalCost'].every(field => number(value[field])), path)
      fields(value, ['lastResetDate', 'lastUpdateDate'], string, path)
      break
    case StorageKeys.contextPolicy:
      policy(value, path)
      break
    case StorageKeys.accountBalance:
      check((string(value) || number(value)) && String(value).trim() !== '' && Number.isFinite(Number(value)), path)
      break
    case StorageKeys.promptsVersion:
      check(number(value) && Number.isInteger(value) && (value as number) >= 0, path)
      break
    case StorageKeys.theme:
      check(value === 'light' || value === 'dark' || value === 'system', path)
      break
    default:
      check(string(value), path)
  }
}

function readValue(key: StorageKey): unknown {
  return RAW_KEYS.includes(key) ? storageGetRaw(key) : storageGet(key, null)
}

export function createBackup(groups: readonly BackupGroup[] = ALL_BACKUP_GROUPS): BackupFile {
  const data: Data = {}
  for (const group of groups) for (const key of BACKUP_GROUPS[group]) {
    let value = readValue(key)
    if (key === StorageKeys.apiConfig && value === null) {
      value = storageGet(StorageKeys.customApiConfig, null) ?? storageGet(StorageKeys.officialApiConfig, null)
    }
    if (value !== null) data[key] = value
  }
  return { format: 'llm-writer-backup', version: 2, exportTime: new Date().toISOString(), data }
}

/** 兼容旧版完整备份、分类备份和 settings 顶层单项导出。 */
export function parseBackup(input: unknown): Data {
  check(object(input), '文件根节点')
  let data: Data
  if ('format' in input || typeof input.version === 'number') {
    check(input.format === 'llm-writer-backup' && input.version === 2, '不支持的备份版本')
    check(object(input.data), 'data')
    data = {}
    for (const [key, value] of Object.entries(input.data)) {
      check(ALL_KEYS.includes(key as StorageKey), `未知数据键 ${key}`)
      data[key as StorageKey] = value
    }
  } else {
    data = {}
    for (const key of [StorageKeys.novels, StorageKeys.prompts, StorageKeys.novelGenres, StorageKeys.writingGoals]) {
      if (key in input) data[key] = input[key]
    }
    if (!('writingGoals' in input) && 'goals' in input) data.writingGoals = input.goals
    if ('prompts' in data) data.promptsVersion = 0
    if ('settings' in input) check(object(input.settings), 'settings')
    const settings = object(input.settings) ? input.settings : input
    if ('apiConfig' in settings) {
      // 旧 Settings 从不存在的键导出 {}，它不代表一份可恢复的 API 配置。
      const config = settings.apiConfig
      check(object(config), 'settings.apiConfig')
      if (Object.keys(config).length > 0) data.apiConfig = config
    }
    if ('tokenUsage' in settings) {
      const usage = settings.tokenUsage
      check(object(usage), 'settings.tokenUsage')
      if (Object.keys(usage).length > 0) data[StorageKeys.tokenUsageStats] = usage
    }
  }
  check(Object.keys(data).length > 0, '没有可恢复的数据')
  for (const [key, value] of Object.entries(data)) validateValue(key as StorageKey, value)
  return data
}

export function matchingBackupGroups(data: Data, groups: readonly BackupGroup[]): BackupGroup[] {
  return groups.filter(group => BACKUP_GROUPS[group].some(key => key in data))
}

async function writeValue(key: StorageKey, value: unknown): Promise<void> {
  if (value === null) await storageRemove(key)
  else if (RAW_KEYS.includes(key)) storageSetRaw(key, value as string)
  else await storageSet(key, value)
}

/** 全量验证后才开始覆盖；等待正文分片落盘，并在失败时尝试恢复已经写入的键。 */
export async function restoreBackup(input: unknown, groups: readonly BackupGroup[] = ALL_BACKUP_GROUPS): Promise<number> {
  const data = parseBackup(input)
  const selected = matchingBackupGroups(data, groups)
  const keys = ALL_KEYS.filter(key => selected.some(group => (BACKUP_GROUPS[group] as readonly StorageKey[]).includes(key)) && key in data)
  // 深复制，隔离小说后端/响应式状态在写入期间的引用变化。
  const previous = new Map(keys.map(key => [key, JSON.parse(JSON.stringify(readValue(key))) as unknown]))
  const attempted: StorageKey[] = []
  try {
    for (const key of keys) {
      attempted.push(key)
      await writeValue(key, data[key])
    }
  } catch {
    let rollbackFailed = false
    for (const key of attempted.reverse()) {
      try { await writeValue(key, previous.get(key)) } catch { rollbackFailed = true }
    }
    throw new Error(rollbackFailed
      ? '导入失败，部分数据未能恢复原状。请保留备份文件并检查可用存储空间。'
      : '导入失败，已恢复导入前的数据。请检查可用存储空间后重试。')
  }
  return selected.length
}
