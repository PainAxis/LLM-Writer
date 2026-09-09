import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PROMPT_PICKER_TARGET,
  extractPromptVariables,
  renderPromptTemplate,
  usePromptPicker,
} from '../src/composables/usePromptPicker'

const expectedCategories = new Map([
  [PROMPT_PICKER_TARGET.CHARACTER_EDIT, 'character'],
  [PROMPT_PICKER_TARGET.CHARACTER_BATCH, 'character'],
  [PROMPT_PICKER_TARGET.WORLD_BATCH, 'worldview'],
  [PROMPT_PICKER_TARGET.CHAPTER_SINGLE, 'outline'],
  [PROMPT_PICKER_TARGET.CHAPTER_BATCH, 'outline'],
])

const picker = usePromptPicker()
for (const [target, category] of expectedCategories) {
  picker.open(target)
  assert.equal(picker.target.value, target)
  assert.equal(picker.category.value, category)
  assert.equal(picker.visible.value, true)
  assert.equal(picker.selectedPrompt.value, null)
}

const variables = extractPromptVariables('甲{姓名}，乙{姓名}，符号{a+b}')
assert.deepEqual(variables, { 姓名: '', 'a+b': '' })
assert.equal(
  renderPromptTemplate('甲{姓名}，乙{姓名}，符号{a+b}', { 姓名: '阿宁', 'a+b': '安全' }),
  '甲阿宁，乙阿宁，符号安全',
)

picker.select({ id: 1, title: '测试模板', category: 'character', content: '{姓名}/{身份}' })
picker.variables.value.姓名 = '阿宁'
picker.render()
assert.equal(picker.finalPrompt.value, '阿宁/{身份}')
picker.reset()
assert.equal(picker.target.value, null)
assert.equal(picker.finalPrompt.value, '')
console.log('✓ 通用提示词选择器：目标分类、变量提取、插值与重置')

const writerSource = readFileSync(new URL('../src/views/Writer.vue', import.meta.url), 'utf8')
const writerScript = writerSource.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1]
assert.ok(writerScript)

assert.match(writerScript, /useWriterPromptOrchestration\(\{/)
for (const handler of [
  'openCharacterPromptSelector',
  'openBatchCharacterPromptSelector',
  'openWorldSettingPromptSelector',
  'selectPromptForSingleChapter',
  'selectPromptForBatchChapter',
  'selectPrompt',
  'useSelectedPrompt',
]) {
  assert.match(writerScript, new RegExp(`\\b${handler}\\b`), `${handler} 必须由提示词编排器接管`)
}

assert.match(writerSource, /<PromptPickerDialog[\s\S]*?v-model:selected-prompt="pickerSelectedPrompt"[\s\S]*?v-model:variables="pickerPromptVariables"[\s\S]*?v-model:final-prompt="pickerFinalPrompt"/)
assert.match(writerSource, /<ChapterGenerateDialog[\s\S]*?v-model:prompt-variables="promptVariables"[\s\S]*?:selected-prompt="selectedPrompt"[\s\S]*?:final-prompt="finalPrompt"/)
assert.doesNotMatch(writerScript, /PROMPT_PICKER_TARGET\./)
console.log('✓ Writer 提示词路由：5 个入口由独立编排器接管，通用选择器与章节工作区状态隔离')

console.log('\n=== WRITER PROMPT TESTS PASSED ===')
