import type {
  WriterCharacterForm,
  WriterNovel,
  WriterWorldSettingForm,
} from '../../types/writer'
import { describeWriterGenre } from './chapterContentPrompt'

type MaterialFormPromptNovel = Readonly<Pick<WriterNovel, 'title' | 'genre' | 'description'>>
type CharacterFormPromptSnapshot = Readonly<
  Pick<WriterCharacterForm, 'name' | 'role' | 'gender' | 'age'>
>
type WorldSettingFormPromptSnapshot = Readonly<
  Pick<WriterWorldSettingForm, 'title' | 'category'>
>

export interface CharacterFormPromptInput {
  novel: MaterialFormPromptNovel | null
  form: CharacterFormPromptSnapshot
  /** Presence selects the custom-prompt path; an empty string remains meaningful. */
  customPrompt?: string
}

export interface WorldSettingFormPromptInput {
  novel: MaterialFormPromptNovel | null
  form: WorldSettingFormPromptSnapshot
}

export interface CharacterFormGenerationResult {
  appearance: string
  personality: string
  background: string
  tags: string[]
}

export interface WorldSettingFormGenerationResult {
  description: string
}

const CHARACTER_FORMAT_SUFFIX = `

=== Output format — MANDATORY, machine-parsed (overrides anything above) ===
Output ONLY the following four lines, nothing else (no title, no preamble, no extra fields, no markdown). Keep the Chinese field labels 外貌/性格/背景/标签 exactly as shown; do NOT translate or rename them:

外貌：[详细外貌描述]
性格：[性格特点描述]
背景：[背景故事]
标签：[标签1,标签2,标签3]

All field values must be written in natural, idiomatic Simplified Chinese. Tags must use half-width commas (,).`

function novelContext(novel: MaterialFormPromptNovel | null): string {
  return `=== 小说基本信息 ===
小说标题：${novel?.title || '未命名小说'}
小说类型：${describeWriterGenre(novel?.genre)}
小说简介：${novel?.description || '暂无简介'}`
}

function describeCharacterRole(role: WriterCharacterForm['role']): string {
  if (role === 'protagonist') return '主角'
  if (role === 'antagonist') return '反派'
  return '配角'
}

function describeCharacterGender(gender: WriterCharacterForm['gender']): string {
  if (gender === 'male') return '男'
  if (gender === 'female') return '女'
  return '其他'
}

function characterBasics(form: CharacterFormPromptSnapshot): string {
  return `=== 角色基本设定 ===
- 姓名：${form.name}
- 角色定位：${describeCharacterRole(form.role)}
- 性别：${describeCharacterGender(form.gender)}
- 年龄：${form.age}岁`
}

/** Build the exact request used by the default or prompt-library character flow. */
export function buildCharacterFormPrompt(input: CharacterFormPromptInput): string {
  const { novel, form } = input
  const customPrompt = input.customPrompt

  const task = customPrompt !== undefined
    ? `${novelContext(novel)}

${characterBasics(form)}

=== 角色生成要求 ===
${customPrompt}

请确保角色设定符合小说的世界观、类型和风格特点。`
    : `${novelContext(novel)}

=== Character generation task ===
You are a professional character designer for Chinese fiction. Design the character 《${form.name}》 for the novel above.

Requirements:
- Appearance: concrete and visualizable (build, hair, eyes, distinguishing mark), matching the genre's aesthetic.
- Personality: 2-4 traits with a built-in contradiction or flaw that can generate drama.
- Background: causal, not biographic listing — key formative event, current motivation, and a hidden tension that can surface later.

${characterBasics(form)}

请确保角色设定符合小说的世界观、类型和风格特点。

开始生成：`

  return task + CHARACTER_FORMAT_SUFFIX
}

const WORLD_SETTING_CATEGORY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  setting: '世界设定',
  magic: '魔法体系',
  politics: '政治势力',
  geography: '地理环境',
  history: '历史背景',
})

/** Build the exact request used by the single world-setting description flow. */
export function buildWorldSettingFormPrompt(input: WorldSettingFormPromptInput): string {
  const { novel, form } = input
  const category = WORLD_SETTING_CATEGORY_LABELS[form.category] || '世界设定'

  return `${novelContext(novel)}

=== 世界观设定生成任务 ===
请为上述小说生成世界观设定的详细描述。

=== 设定信息 ===
- 设定标题：${form.title}
- 设定类别：${category}

=== 生成要求 ===
请生成详细的设定描述，包括：
1. 具体的设定内容和规则
2. 在小说世界中的作用和意义
3. 与其他设定的关联性
4. 对故事情节的影响

要求描述详细、生动，符合小说的类型、风格和整体世界观。`
}

/**
 * Parse the four line-oriented fields emitted for a single character.
 * This intentionally preserves Writer.vue's full-width-colon and ASCII-comma
 * contract so extraction does not silently broaden persisted behavior.
 */
export function parseCharacterFormResponse(response: string): CharacterFormGenerationResult {
  const result: CharacterFormGenerationResult = {
    appearance: '',
    personality: '',
    background: '',
    tags: [],
  }

  for (const line of response.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('外貌：')) {
      result.appearance = trimmed.replace('外貌：', '').trim()
    } else if (trimmed.startsWith('性格：')) {
      result.personality = trimmed.replace('性格：', '').trim()
    } else if (trimmed.startsWith('背景：')) {
      result.background = trimmed.replace('背景：', '').trim()
    } else if (trimmed.startsWith('标签：')) {
      const tags = trimmed.replace('标签：', '').trim()
      result.tags = tags.split(',').map(tag => tag.trim()).filter(Boolean)
    }
  }

  return result
}

/** Preserve the completed world-setting response exactly as Writer.vue did. */
export function parseWorldSettingFormResponse(
  response: string,
): WorldSettingFormGenerationResult {
  return { description: response }
}
