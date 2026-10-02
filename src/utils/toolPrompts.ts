import { TOOL_DEFINITIONS, TOOL_OUTPUT_REQUIREMENTS } from '@/config/tools'
import { DEFAULT_PROMPTS, type PromptTemplate } from '@/config/defaultPrompts'
import type { ToolField, ToolPromptSource, ToolType } from '@/types/tools'
import { stripWriterHtml } from '@/utils/writerContent'

const variables = /\{([\p{L}\p{N}_ -]+)\}/gu
const scalarFields = (type: ToolType) => TOOL_DEFINITIONS[type].fields.filter(field =>
  !['novel-select', 'chapter-select', 'prompt-select'].includes(field.type))
const hasValue = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== ''
const fieldValue = (field: ToolField, value: unknown): string => {
  if (!hasValue(value)) return '未指定'
  return field.options?.find(option => option.value === String(value))?.label ?? String(value)
}
const sameId = (left: unknown, right: unknown) => left !== undefined && left !== null
  && right !== undefined && right !== null && String(left) === String(right)

function contextValues(source: ToolPromptSource): Record<string, string> {
  const tool = TOOL_DEFINITIONS[source.type]
  const selected = tool.hasNovelSelector && hasValue(source.form.selectedNovel)
    ? source.novels.find(novel => sameId(novel.value, source.form.selectedNovel)) : undefined
  const novel = selected ? source.originals.find(record => sameId(record.id, selected.value)) : undefined
  if (tool.hasNovelSelector && (!selected || !novel)) throw new Error('所选小说已不存在，请重新选择小说')
  const characters = novel?.characters?.map(character =>
    `${character.name || '未命名角色'}：${stripWriterHtml(character.description || character.personality || '主要角色')}`).join('\n')
    || '暂无详细人物设定'
  const world = novel?.worldSettings?.map(setting =>
    `${setting.name || setting.title || '未命名设定'}：${stripWriterHtml(setting.description || setting.content || '')}`).join('\n')
    || '暂无详细世界观设定'
  const selectedChapters = (source.form.selectedChapters ?? []).map(id => {
    const chapter = source.chapters.find(record => sameId(record.value, id))
    if (!chapter) throw new Error('所选参考章节已不存在，请重新选择章节')
    const text = stripWriterHtml(chapter.content)
    const content = text.length > 500 ? `${text.slice(0, 500)}...` : text
    return `【${chapter.label}】\n${chapter.description ? `大纲：${stripWriterHtml(chapter.description)}\n` : ''}${content ? `内容：${content}` : ''}`
  }).join('\n\n') || '暂无参考章节'
  const genre = novel?.genre || '未指定类型'
  const description = stripWriterHtml(novel?.description || '') || '无简介'
  return {
    小说标题: novel?.title || selected?.label || '未命名小说', 小说类型: genre, 类型: genre,
    小说简介: description, 主题: description, 标签: novel?.tags?.join('、') || '无标签',
    主要人物: characters, 主角设定: characters, 世界观设定: world,
    参考章节内容: selectedChapters, 已有章节: selectedChapters,
  }
}

function promptValues(source: ToolPromptSource): Record<string, string> {
  const values = contextValues(source)
  const form = source.form
  for (const field of scalarFields(source.type)) {
    values[field.key] = values[field.label] = fieldValue(field, form[field.key])
  }
  const count = String(form.count || (source.type === 'title' ? 10 : ['genre', 'brainstorm'].includes(source.type) ? 5 : 1))
  const chapters = String(form.chapters || 10)
  const parameters = scalarFields(source.type).map(field => `${field.label}：${fieldValue(field, form[field.key])}`).join('\n')
  return {
    ...values, 类型: values.genre || values.小说类型, 工具参数: parameters, 生成要求: TOOL_OUTPUT_REQUIREMENTS[source.type],
    生成数量: count, count, 生成章节数量: chapters, 章节数量: chapters, chapters,
    角色类型: values.role || '未指定', 角色定位: values.role || '未指定',
    性别: values.gender || '不限', 性格特点: values.personality || '未指定',
    特殊要求: values.personality || values.description || values.elements || values.background || parameters,
    设定类型: values.type || '综合世界观', 情节要求: parameters,
    模板类型: '章节细纲',
  }
}

function supportedVariables(type: ToolType): Set<string> {
  const source: ToolPromptSource = { type, form: { selectedNovel: 'fixture' }, selectedPrompt: null,
    novels: [{ value: 'fixture', label: '' }], originals: [{ id: 'fixture' }], chapters: [] }
  return new Set(Object.keys(promptValues(source)))
}

export function unsupportedToolVariables(type: ToolType, content: string): string[] {
  const supported = supportedVariables(type)
  return [...new Set([...content.matchAll(variables)].map(match => match[1]))].filter(name => !supported.has(name))
}

/** Writer's single-character and chapter-prose tasks are not Tools output contracts. */
export function isCompatibleToolPrompt(type: ToolType, prompt: { content: string }): boolean {
  const original = DEFAULT_PROMPTS.find(template => template.content === prompt.content)
  const compatibleBuiltins: Partial<Record<ToolType, number[]>> = { outline: [21, 23, 24], character: [22], worldview: [18] }
  if (original && !compatibleBuiltins[type]?.includes(Number(original.id))) return false
  return unsupportedToolVariables(type, prompt.content).length === 0
}

/** Local tool defaults do not migrate, delete or overwrite the user's prompt catalog. */
export function getToolPrompts(type: ToolType, catalog: PromptTemplate[], category?: string): PromptTemplate[] {
  const selectedCategory = category ?? TOOL_DEFINITIONS[type].fields.find(field => field.type === 'prompt-select')?.category ?? type
  let defaultId = `tool-template:${type}`
  while (catalog.some(prompt => prompt.id === defaultId)) defaultId += ':default'
  const dedicated: PromptTemplate = {
    id: defaultId, title: `${TOOL_DEFINITIONS[type].title}默认模板`, category: selectedCategory,
    description: '按照当前工具的生成参数输出内容', tags: ['工具'], isDefault: true,
    content: `请使用自然流畅的简体中文完成以下任务。\n\n{生成要求}\n\n生成参数：\n{工具参数}`,
  }
  const matchesCategory = (prompt: PromptTemplate) => prompt.category === selectedCategory
    || (type === 'synopsis' && prompt.category === 'content' && !DEFAULT_PROMPTS.some(original => original.content === prompt.content))
  return [dedicated, ...catalog.filter(prompt => matchesCategory(prompt) && isCompatibleToolPrompt(type, prompt))]
}

export function buildToolPrompt(source: ToolPromptSource): string {
  const tool = TOOL_DEFINITIONS[source.type]
  for (const key of ['count', 'chapters']) {
    const raw = source.form[key]
    if (hasValue(raw) && (!/^\d+$/.test(String(raw).trim()) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1)) {
      throw new Error(key === 'count' ? '生成数量必须是正整数' : '章节数量必须是正整数')
    }
  }
  const values = promptValues(source)
  const content = source.selectedPrompt?.content
  if (content) {
    const missing = unsupportedToolVariables(source.type, content)
    if (missing.length) throw new Error(`此模板缺少当前工具无法提供的变量：${missing.map(name => `{${name}}`).join('、')}。请修改模板或使用工具默认模板`)
    if (!isCompatibleToolPrompt(source.type, { content })) throw new Error('此模板的生成任务与当前工具不兼容，请选择工具专用模板')
  }
  const novelInfo = tool.hasNovelSelector
    ? `=== 目标小说信息 ===\n小说标题：${values.小说标题}\n小说类型：${values.小说类型}\n小说简介：${values.小说简介}\n标签：${values.标签}\n\n=== 主要角色 ===\n${values.主要人物}\n\n=== 世界观设定 ===\n${values.世界观设定}\n\n=== 参考章节内容 ===\n${values.参考章节内容}\n\n`
    : ''
  // Replace in one pass so inserted text containing braces or $ tokens remains literal.
  const template = content?.replace(variables, (_match, name: string) => values[name])
  const parameters = values.工具参数
  const quantity = source.type === 'outline' ? `生成章节数量：${values.生成章节数量}章\n`
    : ['title', 'genre', 'brainstorm', 'character'].includes(source.type) ? `生成数量：${values.生成数量}个\n` : ''
  const instructions = `=== 当前工具任务：${tool.title} ===\n${TOOL_OUTPUT_REQUIREMENTS[source.type]}\n${quantity}${parameters}\n以上任务、数量和参数是本次输出要求；模板中的通用示例不能改变这些要求。`
  return `${novelInfo}${template ? `=== 提示词模板 ===\n${template}\n\n` : ''}${instructions}`
}
