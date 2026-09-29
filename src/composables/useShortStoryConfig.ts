import { reactive, toRaw } from 'vue'
import { createDefaultShortStoryConfig } from '@/config/shortStory'
import type { ShortStoryConfig, ShortStoryOption } from '@/types/shortStory'
import { storageGet, storageSet, StorageKeys } from '@/utils/storage'

interface ConfigStorage {
  read(): unknown
  write(value: ShortStoryConfig): void | Promise<void>
}

function isOption(value: unknown): value is ShortStoryOption {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.value === 'string' && typeof item.label === 'string'
    && (item.description === undefined || typeof item.description === 'string')
    && (item.prompt === undefined || typeof item.prompt === 'string')
}

export function useShortStoryConfig(storage: ConfigStorage = {
  read: () => storageGet(StorageKeys.shortStoryConfig, null),
  write: value => storageSet(StorageKeys.shortStoryConfig, value),
}) {
  const data = reactive<ShortStoryConfig>(createDefaultShortStoryConfig())
  const reset = () => Object.assign(data, createDefaultShortStoryConfig())
  const load = () => {
    reset()
    let saved: unknown
    try { saved = storage.read() } catch { return }
    if (!saved || typeof saved !== 'object') return
    for (const key of Object.keys(data) as Array<keyof ShortStoryConfig>) {
      const value = (saved as Record<string, unknown>)[key]
      if (!Array.isArray(value)) continue
      const items = value.filter(isOption)
      if (items.length) data[key] = structuredClone(items)
    }
  }
  const save = async () => storage.write(structuredClone(toRaw(data)))
  return { data, load, save, reset }
}
