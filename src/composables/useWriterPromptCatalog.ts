import { ref } from 'vue'
import { DEFAULT_PROMPTS, PROMPTS_VERSION, mergeDefaultPrompts } from '@/config/defaultPrompts'
import type { PromptTemplate } from '@/types/writer'
import { StorageKeys, storageGet, storageSet } from '@/utils/storage'

export interface WriterPromptCatalogNotifications {
  success(message: string): unknown
  info(message: string): unknown
  warning(message: string): unknown
}

export interface WriterPromptCatalogOptions {
  notify: WriterPromptCatalogNotifications
  navigateToPromptLibrary(): unknown
}

type PromptRecord = Pick<PromptTemplate, 'id' | 'title' | 'category' | 'content'>
  & Partial<Pick<PromptTemplate, 'description' | 'tags' | 'isDefault'>>

const clonePrompt = (prompt: PromptRecord): PromptTemplate => ({
  ...prompt,
  tags: prompt.tags ? [...prompt.tags] : undefined,
})

const cloneDefaultPrompts = (): PromptTemplate[] => DEFAULT_PROMPTS.map(clonePrompt)

/** Owns the Writer view of the shared prompt catalog and its storage migration. */
export function useWriterPromptCatalog(options: WriterPromptCatalogOptions) {
  const availablePrompts = ref<PromptTemplate[]>([])

  const savePrompts = () => {
    try {
      void storageSet(StorageKeys.prompts, availablePrompts.value)
    } catch (error) {
      console.error('保存提示词失败:', error)
    }
  }

  const loadPrompts = () => {
    const parsed = storageGet<PromptTemplate[] | null>(StorageKeys.prompts, null)
    if (parsed && Array.isArray(parsed)) {
      try {
        const version = storageGet<number>(StorageKeys.promptsVersion, 0)
        if (version !== PROMPTS_VERSION) {
          availablePrompts.value = mergeDefaultPrompts(
            parsed as Parameters<typeof mergeDefaultPrompts>[0],
          ).map(clonePrompt)
          savePrompts()
          void storageSet(StorageKeys.promptsVersion, PROMPTS_VERSION)
        } else {
          availablePrompts.value = parsed
        }
      } catch (error) {
        console.error('加载提示词失败:', error)
        availablePrompts.value = cloneDefaultPrompts()
        savePrompts()
      }
      return availablePrompts.value
    }

    availablePrompts.value = cloneDefaultPrompts()
    savePrompts()
    void storageSet(StorageKeys.promptsVersion, PROMPTS_VERSION)
    return availablePrompts.value
  }

  const findDefaultPrompt = (category: string): PromptTemplate | null => {
    const candidates = availablePrompts.value.filter(prompt => prompt.category === category)
    return candidates.find(prompt => prompt.isDefault) ?? candidates[0] ?? null
  }

  const useDefaultPrompt = (
    category: string,
    selectPrompt: (prompt: PromptTemplate) => unknown,
  ) => {
    const prompt = findDefaultPrompt(category)
    if (!prompt) {
      options.notify.warning('当前正文类型暂无可用的默认提示词')
      return false
    }
    selectPrompt(prompt)
    options.notify.info('已切换到默认提示词')
    return true
  }

  const refreshPrompts = () => {
    loadPrompts()
    options.notify.success('提示词列表已刷新')
  }

  const goToPromptLibrary = () => options.navigateToPromptLibrary()
  const createPromptForCategory = () => options.navigateToPromptLibrary()

  return {
    availablePrompts,
    loadPrompts,
    savePrompts,
    findDefaultPrompt,
    useDefaultPrompt,
    refreshPrompts,
    goToPromptLibrary,
    createPromptForCategory,
  }
}
