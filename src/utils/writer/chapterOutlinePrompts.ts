import type { WriterChapterTemplate } from '../../types/writer'
import { describeWriterGenre } from './chapterContentPrompt'

const CHAPTER_TEMPLATE_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  general: '通用章节模板，平衡叙述和对话',
  battle: '战斗场景模板，突出动作和紧张感',
  emotion: '情感戏模板，重点描写心理和情感',
  turning: '转折剧情模板，制造悬念和反转',
})

export interface ChapterOutlinePromptNovel {
  id?: number
  title?: string
  genre?: string
  description?: string
}

export interface ChapterOutlinePromptChapter {
  id: number
  title: string
  description?: string
  wordCount?: number
}

export interface ChapterOutlinePromptCharacter {
  name: string
  role?: string
}

export interface ChapterOutlinePromptWorldSetting {
  title: string
}

export interface ChapterOutlinePromptForm {
  title: string
}

export interface SingleChapterPromptForm {
  title: string
  plotRequirement: string
  template: WriterChapterTemplate
}

export interface BatchChapterPromptForm {
  count: number
  plotRequirement: string
  template: WriterChapterTemplate
}

export interface ChapterOutlinePromptSnapshot {
  readonly novel: Readonly<ChapterOutlinePromptNovel> | null
  readonly form: Readonly<ChapterOutlinePromptForm>
  readonly chapters: readonly Readonly<ChapterOutlinePromptChapter>[]
  readonly characters: readonly Readonly<ChapterOutlinePromptCharacter>[]
  readonly worldSettings: readonly Readonly<ChapterOutlinePromptWorldSetting>[]
}

export interface SingleChapterPromptSnapshot {
  readonly novel: Readonly<ChapterOutlinePromptNovel> | null
  readonly form: Readonly<SingleChapterPromptForm>
  readonly chapters: readonly Readonly<ChapterOutlinePromptChapter>[]
  /** A rendered library prompt. Undefined/null selects the built-in prompt. */
  readonly customPrompt?: string | null
}

export interface BatchChapterPromptSnapshot {
  readonly novel: Readonly<ChapterOutlinePromptNovel> | null
  readonly form: Readonly<BatchChapterPromptForm>
  readonly chapters: readonly Readonly<ChapterOutlinePromptChapter>[]
  /** A rendered library prompt. Undefined/null selects the built-in prompt. */
  readonly customPrompt?: string | null
}

export interface CreateChapterOutlinePromptSnapshotInput {
  novel: ChapterOutlinePromptNovel | null
  form: ChapterOutlinePromptForm
  chapters: readonly ChapterOutlinePromptChapter[]
  characters: readonly ChapterOutlinePromptCharacter[]
  worldSettings: readonly ChapterOutlinePromptWorldSetting[]
}

export interface CreateSingleChapterPromptSnapshotInput {
  novel: ChapterOutlinePromptNovel | null
  form: SingleChapterPromptForm
  chapters: readonly ChapterOutlinePromptChapter[]
  customPrompt?: string | null
}

export interface CreateBatchChapterPromptSnapshotInput {
  novel: ChapterOutlinePromptNovel | null
  form: BatchChapterPromptForm
  chapters: readonly ChapterOutlinePromptChapter[]
  customPrompt?: string | null
}

function snapshotNovel(
  novel: ChapterOutlinePromptNovel | null,
): Readonly<ChapterOutlinePromptNovel> | null {
  if (!novel) return null

  return Object.freeze({
    id: novel.id,
    title: novel.title,
    genre: novel.genre,
    description: novel.description,
  })
}

function snapshotChapters(
  chapters: readonly ChapterOutlinePromptChapter[],
): readonly Readonly<ChapterOutlinePromptChapter>[] {
  return Object.freeze(chapters.map(chapter => Object.freeze({
    id: chapter.id,
    title: chapter.title,
    description: chapter.description,
    wordCount: chapter.wordCount,
  })))
}

/** Capture only the values used by the current-chapter outline request. */
export function createChapterOutlinePromptSnapshot(
  input: CreateChapterOutlinePromptSnapshotInput,
): ChapterOutlinePromptSnapshot {
  return Object.freeze({
    novel: snapshotNovel(input.novel),
    form: Object.freeze({ title: input.form.title }),
    chapters: snapshotChapters(input.chapters),
    characters: Object.freeze(input.characters.map(character => Object.freeze({
      name: character.name,
      role: character.role,
    }))),
    worldSettings: Object.freeze(input.worldSettings.map(setting => Object.freeze({
      title: setting.title,
    }))),
  })
}

/** Capture a single-chapter request so later form/list edits cannot alter its prompt. */
export function createSingleChapterPromptSnapshot(
  input: CreateSingleChapterPromptSnapshotInput,
): SingleChapterPromptSnapshot {
  return Object.freeze({
    novel: snapshotNovel(input.novel),
    form: Object.freeze({
      title: input.form.title,
      plotRequirement: input.form.plotRequirement,
      template: input.form.template,
    }),
    chapters: snapshotChapters(input.chapters),
    customPrompt: input.customPrompt,
  })
}

/** Capture a batch request so its count, constraints and continuity context stay coherent. */
export function createBatchChapterPromptSnapshot(
  input: CreateBatchChapterPromptSnapshotInput,
): BatchChapterPromptSnapshot {
  return Object.freeze({
    novel: snapshotNovel(input.novel),
    form: Object.freeze({
      count: input.form.count,
      plotRequirement: input.form.plotRequirement,
      template: input.form.template,
    }),
    chapters: snapshotChapters(input.chapters),
    customPrompt: input.customPrompt,
  })
}

export function describeChapterTemplate(template?: string | null): string {
  return CHAPTER_TEMPLATE_DESCRIPTIONS[template ?? ''] || '通用模板'
}

export function formatExistingChapterSummaries(
  chapters: readonly ChapterOutlinePromptChapter[],
): string {
  return chapters
    .map((chapter, index) => `第${index + 1}章：${chapter.title} - ${chapter.description || '暂无描述'}`)
    .join('\n')
}

/** Preserve the Writer page's existing "last five chapters" continuity format. */
export function formatRecentChapterDetails(
  chapters: readonly ChapterOutlinePromptChapter[],
): string {
  if (chapters.length === 0) return '暂无已有章节'

  const recentCount = Math.min(5, chapters.length)
  return chapters.slice(-recentCount).map((chapter, index) => {
    const chapterIndex = chapters.length - recentCount + index + 1
    let detail = `第${chapterIndex}章《${chapter.title}》`

    if (chapter.description && chapter.description.trim()) {
      detail += `\n章节大纲：${chapter.description}`
    } else {
      detail += '\n章节大纲：暂无大纲描述'
    }

    if (chapter.wordCount && chapter.wordCount > 0) {
      detail += `\n字数：${chapter.wordCount}字`
    }

    return detail
  }).join('\n\n')
}

function formatNovelInfo(novel: Readonly<ChapterOutlinePromptNovel> | null): string {
  return `小说标题：${novel?.title || '未命名小说'}
小说类型：${describeWriterGenre(novel?.genre)}
小说简介：${novel?.description || '暂无简介'}`
}

export function buildChapterOutlinePrompt(input: ChapterOutlinePromptSnapshot): string {
  const chapterTitle = input.form.title || '新章节'

  return `=== 小说基本信息 ===
${formatNovelInfo(input.novel)}

=== 章节大纲生成任务 ===
请为上述小说的章节《${chapterTitle}》生成详细大纲。

章节标题：${chapterTitle}

${input.characters.length > 0 ? `主要人物：
${input.characters.map(character => `- ${character.name}（${character.role}）`).join('\n')}` : ''}

${input.worldSettings.length > 0 ? `世界观设定：
${input.worldSettings.map(setting => `- ${setting.title}`).join('\n')}` : ''}

已有章节：
${formatExistingChapterSummaries(input.chapters)}

=== 核心约束（必须严格遵守） ===
1. 【主题控制】大纲必须服务于小说的主线剧情，不得偏离主题
2. 【连贯性】与前文章节在情节、人物、世界观上保持完全连贯
3. 【逻辑性】情节发展必须符合逻辑，人物行为合理
4. 【完整性】确保章节有明确的目标和完整的结构

=== 大纲生成要求 ===
1. 生成该章节的详细内容大纲
2. 包含具体的情节发展和转折点
3. 标明重要的人物出场和互动
4. 设计关键的场景和冲突
5. 安排章节的起承转合
6. 明确章节在整体故事中的作用

=== 质量标准 ===
1. 大纲内容与小说主题高度契合
2. 情节发展自然流畅，无逻辑漏洞
3. 人物行为符合已建立的性格特点
4. 与前文章节形成有机整体

【警告】绝对不能：
- 偏离小说的主线剧情
- 违背已建立的世界观设定
- 出现与前文矛盾的情节
- 设计不符合人物性格的行为

请生成详细的章节大纲：`
}

function buildDefaultSingleChapterPrompt(input: SingleChapterPromptSnapshot): string {
  const { form, chapters } = input
  const chapterNumber = chapters.length + 1

  return `=== 小说基本信息 ===
${formatNovelInfo(input.novel)}

=== 单章生成任务 ===
【重要提醒】：请只生成一个章节的大纲，不要生成多个章节！

目标章节信息：
- 章节标题：${form.title}
- 情节要求：${form.plotRequirement || '请根据章节标题合理发展'}
- 模板类型：${describeChapterTemplate(form.template)}
- 章节序号：第${chapterNumber}章

已有章节概况：
${formatExistingChapterSummaries(chapters)}

【核心要求】：
1. 只生成一个章节（第${chapterNumber}章）的详细大纲
2. 使用用户指定的章节标题：${form.title}
3. 严格遵循用户的情节要求：${form.plotRequirement || '按章节标题合理发展'}
4. 与前文保持逻辑连贯性，推进主线剧情发展
5. 包含具体的情节要点、人物发展、重要事件等
6. 不要生成多个章节，只生成一个章节的内容

请严格按照以下格式返回（只返回一个章节）：
大纲：[详细的章节内容描述，包含主要情节、人物发展、重要事件等]`
}

function buildCustomSingleChapterPrompt(input: SingleChapterPromptSnapshot): string {
  const { form, chapters, customPrompt } = input

  return `=== 用户输入信息 ===
章节标题：${form.title}
情节要求：${form.plotRequirement || '请根据章节标题合理发展'}
模板类型：${describeChapterTemplate(form.template)}

=== 小说基本信息 ===
${formatNovelInfo(input.novel)}

=== 已有章节概况 ===
${formatExistingChapterSummaries(chapters)}

=== 基于以上信息，请按照以下要求生成章节 ===
${customPrompt}

=== 重要约束 ===
【关键】：请只生成一个章节的大纲，不要生成多个章节！

1. 只生成一个章节（第${chapters.length + 1}章）的详细大纲
2. 必须使用用户指定的章节标题：${form.title}
3. 必须遵循用户的情节要求：${form.plotRequirement || '按章节标题合理发展'}
4. 与已有章节保持逻辑连贯性，推进主线剧情发展
5. 包含具体的情节要点、人物发展、重要事件等
6. 不要生成多个章节，无论提示词中是否提到"10章"等内容，都只生成一个章节

请严格按照以下格式返回（只返回一个章节）：
大纲：[详细的章节内容描述，包含主要情节、人物发展、重要事件等]`
}

/** Build either the legacy default or custom-template single-chapter request. */
export function buildSingleChapterOutlinePrompt(input: SingleChapterPromptSnapshot): string {
  return input.customPrompt
    ? buildCustomSingleChapterPrompt(input)
    : buildDefaultSingleChapterPrompt(input)
}

function buildBatchChapterExamples(count: number): string {
  const examples: string[] = []
  for (let index = 1; index <= count; index += 1) {
    examples.push(`章节${index}：
标题：[章节标题]
大纲：[详细的章节内容描述，包含主要情节、人物发展、重要事件等]`)
  }
  return examples.join('\n\n')
}

function buildDefaultBatchChapterPrompt(input: BatchChapterPromptSnapshot): string {
  const { form, chapters } = input
  const { count, plotRequirement, template } = form

  return `You are a professional Chinese web-novel story architect. All output must be written in natural, idiomatic Simplified Chinese.

=== Novel info ===
${formatNovelInfo(input.novel)}

=== Task ===
Generate ${count} chapter outlines that continue from the existing chapters.

【用户具体要求】：
- 生成章节数量：${count}个章节（不多不少）
- 用户情节要求：${plotRequirement || '请根据小说主题合理发展'}
- 模板类型：${describeChapterTemplate(template)}
- Every outline is concrete: name the events, decisions, reversals and which characters appear — never vague summaries.
- Chapters connect causally and escalate; every chapter ends on a hook.
- 严格遵循用户的情节要求，围绕用户指定的情节发展

已有章节数：${chapters.length}个

=== 前文章节信息（重要参考，接续其情节，不得矛盾或重复） ===
${formatRecentChapterDetails(chapters)}

=== Output format — MANDATORY, machine-parsed ===
Output ONLY chapter blocks in exactly the format below, nothing else (no preamble, no closing remarks, no markdown). Keep the Chinese labels 章节/标题/大纲 exactly as shown; do NOT translate or rename them:

${buildBatchChapterExamples(count)}

Hard constraints:
1. Start every block with the exact line "章节X：" (X = 1 to ${count}).
2. Every block contains both "标题：" and "大纲：" fields.
3. Generate exactly ${count} complete chapters — neither fewer nor more.

请现在开始生成：`
}

function buildCustomBatchChapterPrompt(input: BatchChapterPromptSnapshot): string {
  const { form, chapters, customPrompt } = input
  const { count, plotRequirement, template } = form

  const promptWithChapters = `=== 用户输入信息 ===
生成数量：${count}个章节
用户情节要求：${plotRequirement || '请根据小说主题合理发展'}
模板类型：${describeChapterTemplate(template)}

=== 小说基本信息 ===
${formatNovelInfo(input.novel)}

=== 前文章节信息（重要参考） ===
${formatRecentChapterDetails(chapters)}

=== 基于以上信息，请按照以下要求生成新章节 ===
${customPrompt}`

  return `${promptWithChapters}

=== 重要格式约束（必须严格遵守） ===
无论上述提示词如何，你必须严格按照以下格式输出${count}个章节，不得有任何偏差：

${buildBatchChapterExamples(count)}

【核心约束】：
1. 必须严格按照"章节X："格式开始每个章节（X为数字1到${count}）
2. 每个章节必须包含"标题："和"大纲："两个字段
3. 必须生成完整的${count}个章节，缺一不可
4. 确保格式完全一致，便于程序解析
5. 不要生成超过${count}个章节
6. 不要生成少于${count}个章节
7. 标题要简洁有吸引力
8. 大纲要详细具体，包含具体的情节发展
9. 严格遵循用户的情节要求：${plotRequirement || '请根据小说主题合理发展'}

请现在开始生成${count}个章节大纲：`
}

/** Build either the legacy default or custom-template batch request. */
export function buildBatchChapterOutlinePrompt(input: BatchChapterPromptSnapshot): string {
  return input.customPrompt
    ? buildCustomBatchChapterPrompt(input)
    : buildDefaultBatchChapterPrompt(input)
}
