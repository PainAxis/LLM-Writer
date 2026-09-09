import { computed, ref, watch } from 'vue'
import type { PromptTemplate, WriterPromptVariables } from '@/types/writer'

export const PROMPT_PICKER_TARGET = Object.freeze({
  CHARACTER_EDIT: 'character-edit',
  CHARACTER_BATCH: 'character-batch',
  WORLD_BATCH: 'world-batch',
  CHAPTER_SINGLE: 'chapter-single',
  CHAPTER_BATCH: 'chapter-batch',
} as const)

export type PromptPickerTarget = typeof PROMPT_PICKER_TARGET[keyof typeof PROMPT_PICKER_TARGET]

const PROMPT_CATEGORY_BY_TARGET: Readonly<Record<PromptPickerTarget, string>> = Object.freeze({
  [PROMPT_PICKER_TARGET.CHARACTER_EDIT]: 'character',
  [PROMPT_PICKER_TARGET.CHARACTER_BATCH]: 'character',
  [PROMPT_PICKER_TARGET.WORLD_BATCH]: 'worldview',
  [PROMPT_PICKER_TARGET.CHAPTER_SINGLE]: 'outline',
  [PROMPT_PICKER_TARGET.CHAPTER_BATCH]: 'outline',
})

export function extractPromptVariables(content: string): WriterPromptVariables {
  const variables: WriterPromptVariables = {}
  content.match(/\{([^}]+)\}/g)?.forEach(match => {
    variables[match.slice(1, -1)] = ''
  })
  return variables
}

export function renderPromptTemplate(content: string, variables: WriterPromptVariables): string {
  return Object.entries(variables).reduce((result, [variable, variableValue]) => {
    const value = variableValue || `{${variable}}`
    return result.split(`{${variable}}`).join(value)
  }, content)
}

/** Owns the reusable picker draft; destination-specific actions remain in Writer. */
export function usePromptPicker() {
  const visible = ref(false)
  const target = ref<PromptPickerTarget | null>(null)
  const selectedPrompt = ref<PromptTemplate | null>(null)
  const variables = ref<WriterPromptVariables>({})
  const finalPrompt = ref('')
  const category = computed(() => target.value ? PROMPT_CATEGORY_BY_TARGET[target.value] : '')

  const render = () => {
    finalPrompt.value = selectedPrompt.value
      ? renderPromptTemplate(selectedPrompt.value.content, variables.value)
      : ''
  }

  const open = (nextTarget: PromptPickerTarget) => {
    target.value = nextTarget
    selectedPrompt.value = null
    variables.value = {}
    finalPrompt.value = ''
    visible.value = true
  }

  const select = (prompt: PromptTemplate) => {
    selectedPrompt.value = prompt
    variables.value = extractPromptVariables(prompt.content)
    render()
  }

  const reset = () => {
    selectedPrompt.value = null
    variables.value = {}
    finalPrompt.value = ''
    target.value = null
  }

  watch(variables, render, { deep: true })

  return {
    visible,
    target,
    category,
    selectedPrompt,
    variables,
    finalPrompt,
    open,
    select,
    render,
    reset,
  }
}
