import { ref, type Ref } from 'vue'
import type { GenerateOptions, StreamCallback } from '@/types/api'
import type {
  WriterCharacterForm,
  WriterNovel,
  WriterWorldSettingForm,
} from '@/types/writer'
import { isAIRequestCancelled } from '@/utils/aiRequestScope'

export interface WriterFormGenerationStream {
  generate(
    prompt: string,
    options?: GenerateOptions,
    onChunk?: StreamCallback | null,
  ): Promise<string>
  stop?(message?: string): void
}

export interface WriterFormGenerationNotifications {
  success(message: string): unknown
  warning(message: string): unknown
  error(message: string): unknown
}

export interface WriterFormGenerationPromptContext<Form> {
  novel: Readonly<WriterNovel>
  form: Readonly<Form>
  customPrompt?: string
}

export interface WriterCharacterGenerationResult {
  appearance: string
  personality: string
  background: string
  tags: string[]
}

export interface WriterWorldSettingGenerationResult {
  description: string
}

interface SharedFormGenerationOptions<Form, Result> {
  currentNovel: Readonly<Ref<WriterNovel | null | undefined>>
  form: Ref<Form>
  ensureApiReady: () => boolean
  stream: WriterFormGenerationStream
  notify: WriterFormGenerationNotifications
  buildPrompt(context: WriterFormGenerationPromptContext<Form>): string
  parseResponse(response: string): Result
  generateOptions?: GenerateOptions
  identifyForm?: (form: Readonly<Form>) => string | number | null | undefined
  isCancellation?: (error: unknown) => boolean
}

export type WriterCharacterFormGenerationOptions = SharedFormGenerationOptions<
  WriterCharacterForm,
  WriterCharacterGenerationResult
>

export type WriterWorldSettingFormGenerationOptions = SharedFormGenerationOptions<
  WriterWorldSettingForm,
  WriterWorldSettingGenerationResult
>

interface GuardedFormGenerationOptions<Form extends object, Result>
  extends SharedFormGenerationOptions<Form, Result> {
  validate(form: Readonly<Form>): string | null
  cloneForm(form: Readonly<Form>): Form
  commit(form: Readonly<Form>, result: Readonly<Result>): Form
  requestType: string
  successMessage: string
  errorPrefix: string
}

interface GenerationSource<Form> {
  operation: number
  novel: WriterNovel
  novelId: number
  form: Form
  formIdentity: string | number | null | undefined
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const defaultCancellationCheck = (error: unknown): boolean =>
  isAIRequestCancelled(error) || (error instanceof Error && error.name === 'AbortError')

/**
 * Runs an AI request against a form snapshot without exposing partial output to
 * the form itself. Only a complete, parsed response may replace the form, and
 * only while the originating novel and form are still current.
 */
function useGuardedFormGeneration<Form extends object, Result>(
  options: GuardedFormGenerationOptions<Form, Result>,
) {
  const preview = ref('')
  const isGenerating = ref(false)
  let lifecycle = 0

  const identifyForm = options.identifyForm ?? ((form: Readonly<Form>) => JSON.stringify(form))
  const isCancellation = options.isCancellation ?? defaultCancellationCheck

  const sourceIsCurrent = (source: GenerationSource<Form>): boolean => {
    const novel = options.currentNovel.value
    const form = options.form.value
    return source.operation === lifecycle
      && novel === source.novel
      && novel?.id === source.novelId
      && form === source.form
      && Object.is(identifyForm(form), source.formIdentity)
  }

  const stopOwnedRequest = (): void => {
    if (!isGenerating.value) return
    try {
      options.stream.stop?.('')
    } catch {
      // A transport-specific stop failure must not let a stale completion
      // regain permission to update the preview or form.
    }
  }

  const generate = async (customPrompt?: string): Promise<boolean> => {
    if (!options.ensureApiReady()) return false

    const novel = options.currentNovel.value
    if (!novel) {
      options.notify.warning('小说上下文已失效，请重新打开编辑对话框')
      return false
    }

    const sourceForm = options.form.value
    const validationMessage = options.validate(sourceForm)
    if (validationMessage) {
      options.notify.warning(validationMessage)
      return false
    }

    const formSnapshot = options.cloneForm(sourceForm)
    let prompt: string
    let formIdentity: string | number | null | undefined
    try {
      prompt = options.buildPrompt({
        novel: { ...novel },
        form: formSnapshot,
        customPrompt,
      })
      formIdentity = identifyForm(sourceForm)
    } catch (error) {
      options.notify.error(`${options.errorPrefix}: ${errorMessage(error)}`)
      return false
    }

    if (!prompt.trim()) {
      options.notify.warning('生成提示词不能为空')
      return false
    }

    const operation = ++lifecycle
    // Revoke the previous operation before touching its transport. Some
    // adapters synchronously flush callbacks while stopping.
    stopOwnedRequest()
    const source: GenerationSource<Form> = {
      operation,
      novel,
      novelId: novel.id,
      form: sourceForm,
      formIdentity,
    }

    preview.value = ''
    isGenerating.value = true

    try {
      const response = await options.stream.generate(
        prompt,
        {
          maxTokens: null,
          temperature: 0.8,
          type: options.requestType,
          ...options.generateOptions,
        },
        (_chunk, fullContent) => {
          if (sourceIsCurrent(source)) preview.value = fullContent
        },
      )

      if (!sourceIsCurrent(source)) return false
      if (!response.trim()) throw new Error('AI返回内容为空')

      const result = options.parseResponse(response)
      if (!sourceIsCurrent(source)) return false

      preview.value = response
      options.form.value = options.commit(sourceForm, result)
      options.notify.success(options.successMessage)
      return true
    } catch (error) {
      if (isCancellation(error) || !sourceIsCurrent(source)) return false
      options.notify.error(`${options.errorPrefix}: ${errorMessage(error)}`)
      return false
    } finally {
      if (operation === lifecycle) isGenerating.value = false
    }
  }

  const cancel = (clearPreview = true): void => {
    lifecycle += 1
    stopOwnedRequest()
    isGenerating.value = false
    if (clearPreview) preview.value = ''
  }

  const reset = (): void => cancel(true)

  return {
    preview,
    streamingContent: preview,
    isGenerating,
    generate,
    cancel,
    stop: cancel,
    reset,
  }
}

const characterIdentity = (form: Readonly<WriterCharacterForm>): string => JSON.stringify({
  id: form.id,
  name: form.name,
  role: form.role,
  gender: form.gender,
  age: form.age,
  appearance: form.appearance,
  personality: form.personality,
  background: form.background,
  tags: form.tags,
  avatar: form.avatar,
  createdAt: form.createdAt,
})

const worldSettingIdentity = (form: Readonly<WriterWorldSettingForm>): string => JSON.stringify({
  id: form.id,
  title: form.title,
  description: form.description,
  category: form.category,
  details: form.details,
  createdAt: form.createdAt,
})

/** Guarded generation for the character edit draft. */
export function useWriterCharacterFormGeneration(
  options: WriterCharacterFormGenerationOptions,
) {
  return useGuardedFormGeneration({
    ...options,
    identifyForm: options.identifyForm ?? characterIdentity,
    validate: form => form.name.trim() ? null : '请先输入角色姓名',
    cloneForm: form => ({ ...form, tags: [...form.tags] }),
    commit: (form, result) => ({
      ...form,
      appearance: result.appearance,
      personality: result.personality,
      background: result.background,
      tags: [...result.tags],
    }),
    requestType: 'character',
    successMessage: 'AI角色生成完成',
    errorPrefix: '角色生成失败',
  })
}

/** Guarded generation for the world-setting edit draft. */
export function useWriterWorldSettingFormGeneration(
  options: WriterWorldSettingFormGenerationOptions,
) {
  return useGuardedFormGeneration({
    ...options,
    identifyForm: options.identifyForm ?? worldSettingIdentity,
    validate: form => form.title.trim() ? null : '请先输入设定标题',
    cloneForm: form => ({ ...form }),
    commit: (form, result) => ({ ...form, description: result.description }),
    requestType: 'worldview',
    successMessage: 'AI世界观设定生成完成',
    errorPrefix: '设定生成失败',
  })
}
