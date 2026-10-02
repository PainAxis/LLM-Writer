import { ref } from 'vue'
import { DEFAULT_PROMPTS, PROMPTS_VERSION, mergeDefaultPrompts, type PromptTemplate } from '../config/defaultPrompts'
import { StorageKeys, storageGetRaw, storageSet, type StorageKey } from '../utils/storage'

export interface PromptCatalogStorage {
  read(): unknown
  readVersion(): unknown
  write(prompts: PromptTemplate[]): void | Promise<void>
  writeVersion(version: number): void | Promise<void>
}

const clone = (prompts: PromptTemplate[]): PromptTemplate[] => JSON.parse(JSON.stringify(prompts))
const legacyTitles = new Set(['都市短篇小说生成器', '通用短篇小说模板', '玄幻短篇小说生成器'])
const defaultIds = new Set(DEFAULT_PROMPTS.map(prompt => prompt.id))

/** Legacy backups may omit UI fields and use string IDs. Keep their metadata intact. */
export function normalizePromptCatalog(value: unknown): PromptTemplate[] {
  if (!Array.isArray(value)) throw new Error('提示词库必须是数组')
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`提示词库第 ${index + 1} 项无效`)
    const record = entry as Record<string, unknown>
    if (!((typeof record.id === 'number' && Number.isFinite(record.id)) || (typeof record.id === 'string' && record.id.trim()))
      || typeof record.title !== 'string' || typeof record.content !== 'string') throw new Error(`提示词库第 ${index + 1} 项缺少有效身份或内容`)
    return {
      ...record,
      id: record.id,
      title: record.title,
      category: typeof record.category === 'string' ? record.category : '',
      description: typeof record.description === 'string' ? record.description : '',
      content: record.content,
      tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      isDefault: record.isDefault === true,
    }
  })
}

/** One serialized owner for migrations and edits, shared by every prompt entry point. */
export function createPromptCatalog(storage: PromptCatalogStorage) {
  const prompts = ref<PromptTemplate[]>([])
  const pending = ref(false)
  let tail = Promise.resolve()
  let queued = 0

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    queued++
    pending.value = true
    const result = tail.then(operation)
    tail = result.then(() => undefined, () => undefined)
    return result.finally(() => { pending.value = --queued > 0 })
  }

  const loadSnapshot = async () => {
    const stored = storage.read()
    const version = storage.readVersion()
    const fresh = stored === null || stored === undefined
    const previous = fresh ? [] : normalizePromptCatalog(stored)
    // Clean random-ID defaults even if another old entry point already raised the version.
    const cleaned = previous.filter(prompt => !(prompt.isDefault && prompt.category === 'short-story'
      && legacyTitles.has(prompt.title) && !defaultIds.has(prompt.id)))
    const next = fresh || version !== PROMPTS_VERSION ? mergeDefaultPrompts(cleaned) : cleaned
    const changed = fresh || JSON.stringify(stored) !== JSON.stringify(next)
    if (changed) await storage.write(clone(next))
    // Content is committed before publishing or recording its migration version.
    prompts.value = clone(next)
    if (version !== PROMPTS_VERSION) await storage.writeVersion(PROMPTS_VERSION)
    return prompts.value
  }

  const load = () => enqueue(loadSnapshot)
  const update = (mutate: (current: PromptTemplate[]) => PromptTemplate[]) => enqueue(async () => {
    await loadSnapshot()
    const next = normalizePromptCatalog(mutate(clone(prompts.value)))
    await storage.write(clone(next))
    prompts.value = clone(next)
    return prompts.value
  })

  return { prompts, pending, load, update }
}

function readStoredJson(key: StorageKey, fallback: unknown): unknown {
  const raw = storageGetRaw(key)
  return raw === null ? fallback : JSON.parse(raw)
}

export const promptCatalog = createPromptCatalog({
  read: () => readStoredJson(StorageKeys.prompts, null),
  readVersion: () => readStoredJson(StorageKeys.promptsVersion, 0),
  write: prompts => storageSet(StorageKeys.prompts, prompts),
  writeVersion: version => storageSet(StorageKeys.promptsVersion, version),
})
