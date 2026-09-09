import { computed, ref, watch, type Ref } from 'vue'
import type {
  PromptTemplate,
  WriterBatchCharacterGenerationConfig,
  WriterCharacter,
  WriterNovel,
} from '@/types/writer'
import { isAIRequestCancelled } from '@/utils/aiRequestScope'
import { parseGeneratedCharacters } from '@/utils/writer/characterGeneration'
import {
  buildBatchCharacterPrompt,
  getBatchCharacterTypes,
} from '@/utils/writer/materialGenerationPrompts'
import type {
  WriterBatchGenerationNotifications,
  WriterBatchGenerationStream,
} from './writerBatchGenerationTypes'

export interface WriterBatchCharacterGenerationOptions {
  currentNovel: Readonly<Ref<WriterNovel | null>>
  ensureApiReady: () => boolean
  saveGeneratedCharacters: (characters: readonly WriterCharacter[]) => Promise<boolean>
  notify: WriterBatchGenerationNotifications
  stream: WriterBatchGenerationStream
  parseCharacters?: typeof parseGeneratedCharacters
}

export const createDefaultBatchCharacterGenerationConfig = (
): WriterBatchCharacterGenerationConfig => ({
  count: 5,
  includeMainCharacters: true,
  includeSupportingCharacters: true,
  includeMinorCharacters: true,
  customPrompt: '',
  autoAssignRoles: true,
})

/** Owns the batch-character dialog draft, request lifecycle and import action. */
export function useWriterBatchCharacterGeneration(
  options: WriterBatchCharacterGenerationOptions,
) {
  const visible = ref(false)
  const config = ref<WriterBatchCharacterGenerationConfig>(
    createDefaultBatchCharacterGenerationConfig(),
  )
  const results = ref<WriterCharacter[]>([])
  const selectedPrompt = ref<PromptTemplate | null>(null)
  const selectedTemplatePrompt = ref('')
  const isGenerating = ref(false)
  const isImporting = ref(false)
  const canGenerate = computed(
    () => getBatchCharacterTypes(config.value).length > 0
      && !isGenerating.value
      && !isImporting.value,
  )

  const stream = options.stream
  const parse = options.parseCharacters ?? parseGeneratedCharacters
  let lifecycle = 0
  let sourceNovel: WriterNovel | null = null
  let promptConfigFingerprint = ''
  let resetAfterImport = false
  let pendingImport: Promise<boolean> | null = null

  const sourceNovelIsCurrent = () => (
    sourceNovel !== null
      && options.currentNovel.value === sourceNovel
      && options.currentNovel.value.id === sourceNovel.id
  )

  const cancel = () => {
    if (isImporting.value) return false
    lifecycle += 1
    stream.reset()
    isGenerating.value = false
    isImporting.value = false
    resetAfterImport = false
    return true
  }

  const clearPrompt = () => {
    selectedPrompt.value = null
    selectedTemplatePrompt.value = ''
    promptConfigFingerprint = ''
  }

  const open = () => {
    if (isImporting.value) return false
    cancel()
    sourceNovel = options.currentNovel.value
    config.value = createDefaultBatchCharacterGenerationConfig()
    results.value = []
    clearPrompt()
    visible.value = true
    return true
  }

  const reset = () => {
    if (isImporting.value) {
      resetAfterImport = true
      return false
    }
    lifecycle += 1
    stream.reset()
    isGenerating.value = false
    isImporting.value = false
    visible.value = false
    config.value = createDefaultBatchCharacterGenerationConfig()
    results.value = []
    clearPrompt()
    sourceNovel = null
    resetAfterImport = false
    return true
  }

  const usePrompt = (prompt: PromptTemplate, renderedPrompt: string) => {
    const rendered = renderedPrompt.trim()
    if (!rendered) {
      options.notify.warning('提示词内容为空，请重新选择')
      return false
    }
    selectedPrompt.value = prompt
    selectedTemplatePrompt.value = rendered
    promptConfigFingerprint = JSON.stringify(config.value)
    return true
  }

  const generate = async () => {
    if (isGenerating.value || isImporting.value) return false
    if (!options.ensureApiReady()) return false

    const novel = options.currentNovel.value
    if (!novel) {
      options.notify.warning('当前小说不存在，无法生成角色')
      return false
    }
    if (getBatchCharacterTypes(config.value).length === 0) {
      options.notify.warning('请至少选择一种角色类型')
      return false
    }

    sourceNovel = novel
    const operation = ++lifecycle
    const novelSnapshot = {
      title: novel.title,
      genre: novel.genre,
      description: novel.description,
    }
    const configSnapshot = { ...config.value }
    const selectedTemplateSnapshot = selectedTemplatePrompt.value
    const prompt = buildBatchCharacterPrompt({
      novel: novelSnapshot,
      config: configSnapshot,
      selectedTemplatePrompt: selectedTemplateSnapshot,
    })

    stream.reset()
    results.value = []
    isGenerating.value = true
    try {
      const response = await stream.generate(prompt, {
        maxTokens: null,
        temperature: 0.8,
        type: 'character',
      })
      if (operation !== lifecycle || !sourceNovelIsCurrent() || !visible.value) return false
      if (!response.trim()) throw new Error('AI返回内容为空')

      // Parsing is intentionally deferred until the full response arrives.
      const parsed = parse(response)
      if (operation !== lifecycle || !sourceNovelIsCurrent() || !visible.value) return false
      if (parsed.length === 0) throw new Error('AI返回内容无法解析为角色')

      results.value = parsed
      if (parsed.length !== configSnapshot.count) {
        options.notify.warning(`期望生成${configSnapshot.count}个角色，实际解析出${parsed.length}个`)
      }
      options.notify.success(`成功生成 ${parsed.length} 个角色`)
      return true
    } catch (error) {
      if (isAIRequestCancelled(error) || operation !== lifecycle) return false
      console.error('批量生成角色失败:', error)
      options.notify.error(`批量生成失败: ${(error as Error).message}`)
      return false
    } finally {
      if (operation === lifecycle) isGenerating.value = false
    }
  }

  const performImportSelected = async () => {
    if (isImporting.value) return false
    const selected = results.value.filter(character => character.selected !== false)
    if (selected.length === 0) {
      options.notify.warning('请选择要添加的角色')
      return false
    }
    if (!sourceNovelIsCurrent()) {
      options.notify.warning('小说已切换，不能导入旧小说的生成结果')
      return false
    }

    const operation = lifecycle
    let imported = false
    isImporting.value = true
    try {
      const saved = await options.saveGeneratedCharacters(selected)
      if (operation !== lifecycle || !sourceNovelIsCurrent()) return false
      if (!saved) {
        options.notify.error('角色尚未保存，请重试')
        return false
      }

      options.notify.success(`成功添加 ${selected.length} 个角色`)
      imported = true
      return true
    } catch (error) {
      if (operation !== lifecycle) return false
      console.error('导入生成角色失败:', error)
      options.notify.error(`角色尚未保存，请重试: ${(error as Error).message}`)
      return false
    } finally {
      if (operation === lifecycle) isImporting.value = false
      if ((resetAfterImport || imported) && !isImporting.value) {
        resetAfterImport = false
        reset()
      }
    }
  }

  const importSelected = () => {
    if (pendingImport) return pendingImport
    const request = performImportSelected()
    pendingImport = request
    void request.then(
      () => { if (pendingImport === request) pendingImport = null },
      () => { if (pendingImport === request) pendingImport = null },
    )
    return request
  }

  const waitForImport = () => pendingImport ?? Promise.resolve(true)

  watch(visible, opened => {
    if (!opened && isImporting.value) {
      visible.value = true
    } else if (!opened) {
      cancel()
    }
  }, { flush: 'sync' })

  watch(config, () => {
    if (selectedPrompt.value && JSON.stringify(config.value) !== promptConfigFingerprint) {
      clearPrompt()
    }
  }, { deep: true, flush: 'sync' })

  watch(() => options.currentNovel.value, (novel, previousNovel) => {
    if (previousNovel !== undefined && novel !== previousNovel) reset()
  }, { flush: 'sync' })

  return {
    visible,
    config,
    results,
    selectedPrompt,
    selectedTemplatePrompt,
    canGenerate,
    isGenerating,
    isImporting,
    streamingContent: stream.streamingContent,
    isStreaming: stream.isStreaming,
    open,
    reset,
    cancel,
    usePrompt,
    clearPrompt,
    generate,
    importSelected,
    waitForImport,
  }
}
