import type { PromptTemplate } from '@/types/writer'
import { promptCatalog } from '@/services/promptCatalog'

export interface WriterPromptCatalogNotifications {
  success(message: string): unknown
  info(message: string): unknown
  warning(message: string): unknown
}

export interface WriterPromptCatalogOptions {
  notify: WriterPromptCatalogNotifications
  navigateToPromptLibrary(): unknown
}

/** Writer-specific selection and navigation over the application's shared catalog. */
export function useWriterPromptCatalog(options: WriterPromptCatalogOptions) {
  const availablePrompts = promptCatalog.prompts

  const savePrompts = () => {
    const next = availablePrompts.value.map(prompt => ({ ...prompt, tags: [...prompt.tags] }))
    return promptCatalog.update(() => next)
  }

  const loadPrompts = async () => {
    try {
      return await promptCatalog.load()
    } catch (error) {
      options.notify.warning(`加载提示词失败：${error instanceof Error ? error.message : String(error)}，请重试`)
      return null
    }
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

  const refreshPrompts = async () => {
    if (await loadPrompts()) options.notify.success('提示词列表已刷新')
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
