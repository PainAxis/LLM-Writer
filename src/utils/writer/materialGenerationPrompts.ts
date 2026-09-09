import type {
  WriterBatchCharacterGenerationConfig,
  WriterNovel,
  WriterWorldGenerationConfig,
} from '../../types/writer'
import { describeWriterGenre } from './chapterContentPrompt'

type PromptNovel = Pick<WriterNovel, 'title' | 'genre' | 'description'>

export interface BatchCharacterPromptInput {
  novel: PromptNovel | null
  config: Readonly<WriterBatchCharacterGenerationConfig>
  /** A rendered prompt selected from the prompt library. */
  selectedTemplatePrompt?: string | null
}

export interface BatchWorldPromptInput {
  novel: PromptNovel | null
  config: Readonly<WriterWorldGenerationConfig>
  /** A rendered prompt selected from the prompt library. */
  selectedTemplatePrompt?: string | null
}

export const WORLD_SETTING_GENERATION_TYPES = Object.freeze([
  '地理环境',
  '文化社会',
  '历史背景',
  '魔法体系',
  '科技水平',
  '政治势力',
  '宗教信仰',
  '经济贸易',
  '种族设定',
  '语言文字',
] as const)

export function getBatchCharacterTypes(
  config: Readonly<WriterBatchCharacterGenerationConfig>,
): string[] {
  const types: string[] = []
  if (config.includeMainCharacters) types.push('主角')
  if (config.includeSupportingCharacters) types.push('配角')
  if (config.includeMinorCharacters) types.push('次要角色')
  return types
}

export function getBatchWorldSettingTypes(
  config: Readonly<WriterWorldGenerationConfig>,
): string[] {
  const types: string[] = []
  if (config.includeGeography) types.push('地理环境')
  if (config.includeCulture) types.push('文化社会')
  if (config.includeHistory) types.push('历史背景')
  if (config.includeMagic) types.push('魔法体系')
  if (config.includeTechnology) types.push('科技水平')
  if (config.includePolitics) types.push('政治势力')
  if (config.includeReligion) types.push('宗教信仰')
  if (config.includeEconomy) types.push('经济贸易')
  if (config.includeRaces) types.push('种族设定')
  if (config.includeLanguage) types.push('语言文字')
  return types
}

function novelContext(novel: PromptNovel | null): string {
  return `小说标题：${novel?.title || '未命名小说'}
小说类型：${describeWriterGenre(novel?.genre)}
小说简介：${novel?.description || '暂无简介'}`
}

function batchCharacterFormat(count: number, characterTypes: readonly string[]): string {
  const requiredTypes = characterTypes.length > 0 ? characterTypes.join('、') : '主角、配角、次要角色'

  return `=== Output format — MANDATORY, machine-parsed (overrides anything above) ===
Output ONLY ${count} character blocks in exactly the format below, nothing else (no title, no preamble, no markdown). Keep the Chinese labels 角色/姓名/角色/性别/年龄/外貌/性格/背景/标签 exactly as shown; do NOT translate or rename them:

角色1：
姓名：[角色姓名]
角色：[主角/配角/反派/次要角色]
性别：[男/女/其他]
年龄：[数字]
外貌：[详细外貌描述]
性格：[性格特点描述]
背景：[背景故事]
标签：[标签1,标签2,标签3]

角色2：
（同上格式）

Continue the numbering up to 角色${count}. Every block must contain all 8 fields. 角色类型必须符合：${requiredTypes}。Tags must use half-width commas (,).`
}

function batchWorldFormat(count: number, selectedTypes: readonly string[]): string {
  const requestedTypes = selectedTypes.length > 0 ? selectedTypes.join(' / ') : '其他'
  const supportedTypes = [...WORLD_SETTING_GENERATION_TYPES, '其他'].join(' / ')

  return `=== Output format — MANDATORY, machine-parsed (overrides anything above) ===
Output ONLY ${count} setting blocks in exactly the format below, nothing else (no title, no preamble, no markdown). Keep the Chinese labels 设定/标题/类型/描述 exactly as shown; do NOT translate or rename them.
类型优先从本次所选类型中选择：${requestedTypes}。
类型允许值：${supportedTypes}。

设定1：
标题：[设定标题]
类型：[设定类型]
描述：[详细描述：具体规则、运作方式、代价、影响]

设定2：
（同上格式）

Continue the numbering up to 设定${count}. Generate exactly ${count} blocks.`
}

export function buildBatchCharacterPrompt(input: BatchCharacterPromptInput): string {
  const { novel, config } = input
  const characterTypes = getBatchCharacterTypes(config)
  const typeText = characterTypes.length > 0 ? characterTypes.join('、') : '主角、配角、次要角色'
  const assignmentConstraint = config.autoAssignRoles
    ? '自动平衡角色之间的定位、关系和重要性，并至少设计一组可推动剧情的内在张力。'
    : '不要自动改写或平衡角色定位；严格按照已选角色类型与特殊要求分配角色。'
  const selectedTemplatePrompt = input.selectedTemplatePrompt?.trim()

  const task = selectedTemplatePrompt
    ? `=== 小说基本信息 ===
${novelContext(novel)}

=== 角色生成要求 ===
${selectedTemplatePrompt}

=== 生成配置 ===
生成数量：${config.count}个角色
角色类型：${typeText}
角色分配：${assignmentConstraint}
${config.customPrompt.trim() ? `额外要求：${config.customPrompt.trim()}` : ''}

请根据小说信息、提示词和当前配置生成角色，确保人物符合小说的世界观和风格。`
    : `You are a professional character designer for Chinese fiction. All field values must be written in natural, idiomatic Simplified Chinese.

=== Novel info ===
${novelContext(novel)}

=== Task ===
Generate ${config.count} characters that fit this novel's genre, world and tone.

Cast design requirements:
- Characters complement each other: distinct names (no similar-sounding names), distinct roles, and at least one pair with built-in tension.
- Each character internally: concrete visualizable appearance, layered personality with a flaw that can generate drama, causal background (key formative event + current motivation), 3-4 separating tags.

=== 角色类型要求 ===
${typeText}
角色分配：${assignmentConstraint}
${config.customPrompt.trim() ? `特殊要求：${config.customPrompt.trim()}` : ''}

开始生成：`

  // The machine contract is deliberately last so it overrides both the
  // built-in task and any conflicting format in a selected user template.
  return `${task.trim()}\n\n${batchCharacterFormat(config.count, characterTypes)}`
}

export function buildBatchWorldPrompt(input: BatchWorldPromptInput): string {
  const { novel, config } = input
  const selectedTypes = getBatchWorldSettingTypes(config)
  const selectedTypeText = selectedTypes.length > 0 ? selectedTypes.join('、') : '其他'
  const selectedTemplatePrompt = input.selectedTemplatePrompt?.trim()

  const task = selectedTemplatePrompt
    ? `=== 小说基本信息 ===
${novelContext(novel)}

=== 世界观生成要求 ===
${selectedTemplatePrompt}

=== 生成配置 ===
生成数量：${config.count}个世界观设定
设定类型：${selectedTypeText}
${config.customPrompt.trim() ? `额外要求：${config.customPrompt.trim()}` : ''}

请根据小说信息、提示词和当前配置生成相互关联且符合整体风格的世界观设定。`
    : `You are a professional worldbuilder for Chinese fiction. All field values must be written in natural, idiomatic Simplified Chinese.

=== Novel info ===
${novelContext(novel)}

=== Task ===
Generate ${config.count} worldbuilding settings that fit this novel's genre and tone.

=== 生成要求 ===
设定类型要求：${selectedTypeText}
${config.customPrompt.trim() ? `特殊要求：${config.customPrompt.trim()}` : ''}

Quality requirements:
- Each setting contains concrete rules and consequences (who can do what, at what cost, enforced by whom) — not mood adjectives.
- Settings interlock: at least one explicit dependency or friction between them.
- Every setting hints at conflicts characters can run into.`

  // Custom templates receive the same final contract as the default path.
  return `${task.trim()}\n\n${batchWorldFormat(config.count, selectedTypes)}`
}
