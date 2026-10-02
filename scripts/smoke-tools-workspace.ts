/** Run actual Tools workspace handlers with shared prompt generation and controlled transport. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { computed, effectScope, nextTick, reactive, ref } from 'vue'
import { TOOL_DEFINITIONS } from '../src/config/tools'
import { DEFAULT_PROMPTS, type PromptTemplate } from '../src/config/defaultPrompts'
import { buildToolPrompt, getToolPrompts } from '../src/utils/toolPrompts'
import { isToolFormComplete } from '../src/utils/toolForms'
import { useGenerationTask } from '../src/composables/useGenerationTask'
import { createAIRequestScope } from '../src/utils/aiRequestScope'
import { StorageKeys } from '../src/utils/storage'
import type { ToolForm, ToolType } from '../src/types/tools'

const source = readFileSync(new URL('../src/composables/useToolsLibraryWorkspace.ts', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('ToolsWorkspace.ts', source, ts.ScriptTarget.Latest, true)
const body = parsed.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getText(parsed)).join('\n')
  .replace('export function useToolsLibraryWorkspace', 'function useToolsLibraryWorkspace')
const executable = ts.transpileModule(`${body}\nreturn useToolsLibraryWorkspace()`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
const novels = [
  { id: 1, title: '同名作品', description: '第一本龙王', chapterList: [{ id: 10, title: '龙王章', content: '龙王正文' }] },
  { id: 2, title: '同名作品', description: '第二本星舰', chapterList: [{ id: 20, title: '星舰章', content: '<p>星舰&amp;舰长</p><p>第二段</p>' }] },
  { id: 0, title: '零号作品', description: '零号简介', chapterList: [{ id: 0, title: '零号章', content: '零号正文' }] },
  { title: '无稳定身份旧记录', chapterList: [] },
]
const user: PromptTemplate = { id: 'user-character', title: '用户角色模板', category: 'character', content: '{count}个{gender}角色：{personality}', description: '', tags: [], isDefault: false }
const prompts = ref([...DEFAULT_PROMPTS, user])
const mounted: Array<() => void> = []
const unmounted: Array<() => void> = []
const notices: Array<{ type: string; text: string }> = []
const requests: string[] = []
const stream = createAIRequestScope(async prompt => { requests.push(prompt); return '生成结果' }, () => {})
const dependencies = {
  ref, reactive, computed, nextTick, onMounted: (callback: () => void) => mounted.push(callback),
  onBeforeUnmount: (callback: () => void) => unmounted.push(callback),
  useNovelStore: () => ({ isApiConfigured: true }), useAIStream: () => stream, useGenerationTask,
  toolsConfig: TOOL_DEFINITIONS, buildToolPrompt, getToolPrompts, isToolFormComplete, StorageKeys,
  storageGet: (key: string, fallback: unknown) => key === StorageKeys.novels ? structuredClone(novels) : fallback,
  promptCatalog: { prompts, load: async () => prompts.value },
  ElMessage: Object.fromEntries(['success', 'warning', 'error'].map(type => [type, (text: string) => notices.push({ type, text })])),
}
const scope = effectScope()
const workspace = scope.run(() => new Function(...Object.keys(dependencies), executable)(...Object.values(dependencies)))
mounted.forEach(callback => callback())
try {
  assert.deepEqual(workspace.novelList.value.map((novel: { value: unknown }) => novel.value), [1, 2, 0], 'No randomly generated IDs for records that cannot be matched back to storage')
  workspace.openTool('synopsis')
  Object.assign(workspace.toolForm, { selectedNovel: 2, style: 'emotional' })
  workspace.onNovelChange(2)
  assert.equal(workspace.selectedNovelChapters.value[0].value, 20)
  workspace.toolForm.selectedChapters = [20]
  const synopsisTemplates = workspace.getPromptsByCategory('synopsis') as PromptTemplate[]
  assert.equal(synopsisTemplates.some(template => template.id === 2 || template.id === 6), false)
  workspace.toolForm.selectedPrompt = synopsisTemplates[0].id
  workspace.onPromptChange(synopsisTemplates[0].id)
  await workspace.generateContent()
  assert.ok(requests[0].includes('第二本星舰') && requests[0].includes('星舰&舰长\n\n第二段'))
  assert.ok(!requests[0].includes('龙王') && !requests[0].includes('Write the full prose'))
  assert.ok(requests[0].includes('100-200字') && requests[0].includes('简介风格：情感共鸣'))

  workspace.onNovelChange(0)
  workspace.toolForm.selectedNovel = 0
  workspace.toolForm.selectedChapters = [0]
  assert.equal(workspace.canGenerate.value, true)
  await workspace.generateContent()
  assert.ok(requests.at(-1)!.includes('零号正文'))

  for (const type of Object.keys(TOOL_DEFINITIONS) as ToolType[]) {
    workspace.openTool(type)
    const form: ToolForm = {}
    for (const field of TOOL_DEFINITIONS[type].fields) {
      if (field.type === 'novel-select') form[field.key] = 2
      else if (field.type !== 'prompt-select' && field.type !== 'chapter-select') form[field.key] = field.options?.[0]?.value
        ?? (['count', 'chapters'].includes(field.key) ? '5' : '输入 $& {count}')
    }
    Object.assign(workspace.toolForm, form)
    if (TOOL_DEFINITIONS[type].hasNovelSelector) workspace.onNovelChange(2)
    const category = TOOL_DEFINITIONS[type].fields.find(field => field.type === 'prompt-select')!.category!
    const compatible = workspace.getPromptsByCategory(category) as PromptTemplate[]
    workspace.onPromptChange(compatible[0].id)
    const before = requests.length
    await workspace.generateContent()
    assert.equal(requests.length, before + 1, `${type} actual generation uses a compatible template`)
    assert.ok(requests.at(-1)!.includes(TOOL_DEFINITIONS[type].title))
  }

  workspace.openTool('character')
  Object.assign(workspace.toolForm, { count: '5', role: 'protagonist', gender: 'female', personality: '内向善伪装 $& {count}', selectedPrompt: user.id })
  workspace.onPromptChange(user.id)
  await workspace.generateContent()
  assert.ok(requests.at(-1)!.includes('5个女性角色：内向善伪装 $& {count}'))
  assert.ok(requests.at(-1)!.includes('角色定位：主角'))
  const beforeFailure = requests.length
  const selected = prompts.value.find(prompt => prompt.id === user.id)!
  selected.content = '{当前工具无法提供的变量}'
  const existingResult = workspace.generatedContent.value
  await workspace.generateContent()
  assert.equal(requests.length, beforeFailure, 'An edited incompatible template cannot reach the transport')
  assert.equal(workspace.generatedContent.value, existingResult, 'Prompt validation failure keeps the prior result and all form fields')
  assert.ok(notices.at(-1)!.text.includes('{当前工具无法提供的变量}'))
  assert.equal(workspace.toolForm.personality, '内向善伪装 $& {count}')
  workspace.onPromptChange(5)
  assert.equal(workspace.toolForm.selectedPrompt, undefined, 'An incompatible built-in cannot be selected by a stale event')
  workspace.openTool('synopsis')
  workspace.toolForm.selectedNovel = 'deleted'
  assert.equal(workspace.canGenerate.value, false)
} finally {
  unmounted.forEach(callback => callback())
  scope.stop()
}
console.log('PASS actual Tools handlers: stable IDs, HTML references, dedicated/compatible templates, all tool generation and invalid-template draft retention')
