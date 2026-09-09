import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  buildBatchChapterOutlinePrompt,
  buildChapterOutlinePrompt,
  buildSingleChapterOutlinePrompt,
  createBatchChapterPromptSnapshot,
  createChapterOutlinePromptSnapshot,
  createSingleChapterPromptSnapshot,
  describeChapterTemplate,
  formatExistingChapterSummaries,
  formatRecentChapterDetails,
  type ChapterOutlinePromptChapter,
  type ChapterOutlinePromptNovel,
  type SingleChapterPromptForm,
} from '../src/utils/writer/chapterOutlinePrompts'

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

for (const [template, expected] of [
  ['general', '通用章节模板，平衡叙述和对话'],
  ['battle', '战斗场景模板，突出动作和紧张感'],
  ['emotion', '情感戏模板，重点描写心理和情感'],
  ['turning', '转折剧情模板，制造悬念和反转'],
  ['unknown', '通用模板'],
  [null, '通用模板'],
] as const) {
  assert.equal(describeChapterTemplate(template), expected)
}
console.log('✓ 章节模板描述保持页面原有映射和兜底')

const novel: ChapterOutlinePromptNovel = {
  id: 7,
  title: '雾港纪事',
  genre: 'scifi',
  description: '灯塔熄灭后的港口故事',
}
const chapters: ChapterOutlinePromptChapter[] = [
  { id: 1, title: '潮声', description: '沈砚抵达雾港', wordCount: 900 },
  { id: 2, title: '旧船', description: '找到废弃航海图', wordCount: 0 },
  { id: 3, title: '断桥', description: '   ', wordCount: 1200 },
  { id: 4, title: '密信', description: '议长的密信被截获' },
  { id: 5, title: '钟楼' },
  { id: 6, title: '熄灯', description: '灯塔突然熄灭', wordCount: 1800 },
]

assert.equal(
  formatExistingChapterSummaries(chapters.slice(0, 2)),
  '第1章：潮声 - 沈砚抵达雾港\n第2章：旧船 - 找到废弃航海图',
)
assert.equal(formatExistingChapterSummaries([]), '')
assert.equal(
  formatRecentChapterDetails(chapters),
  `第2章《旧船》
章节大纲：找到废弃航海图

第3章《断桥》
章节大纲：暂无大纲描述
字数：1200字

第4章《密信》
章节大纲：议长的密信被截获

第5章《钟楼》
章节大纲：暂无大纲描述

第6章《熄灯》
章节大纲：灯塔突然熄灭
字数：1800字`,
)
assert.equal(formatRecentChapterDetails([]), '暂无已有章节')
console.log('✓ 已有章节与最近 5 章 helper 保留原有编号、空大纲、字数语义')

const mutableNovel: ChapterOutlinePromptNovel = { ...novel }
const mutableChapters = chapters.map(chapter => ({ ...chapter }))
const mutableForm: SingleChapterPromptForm = {
  title: '司灯议会',
  plotRequirement: '揭示议长隐瞒的航线',
  template: 'turning',
}
const isolatedSnapshot = createSingleChapterPromptSnapshot({
  novel: mutableNovel,
  chapters: mutableChapters,
  form: mutableForm,
  customPrompt: '先呈现假线索，再反转。',
})

mutableNovel.title = '被篡改的小说'
mutableChapters[0].title = '被篡改的章节'
mutableForm.title = '被篡改的表单'

assert.equal(isolatedSnapshot.novel?.title, '雾港纪事')
assert.equal(isolatedSnapshot.chapters[0].title, '潮声')
assert.equal(isolatedSnapshot.form.title, '司灯议会')
assert.ok(Object.isFrozen(isolatedSnapshot))
assert.ok(Object.isFrozen(isolatedSnapshot.form))
assert.ok(Object.isFrozen(isolatedSnapshot.chapters))
assert.ok(Object.isFrozen(isolatedSnapshot.chapters[0]))
console.log('✓ 请求 snapshot 仅复制 prompt 必需字段，并隔离后续表单/章节变更')

const outlineSnapshot = createChapterOutlinePromptSnapshot({
  novel,
  form: { title: '司灯议会' },
  chapters: chapters.slice(0, 2),
  characters: [
    { name: '沈砚', role: 'protagonist' },
    { name: '陆微', role: 'supporting' },
  ],
  worldSettings: [{ title: '潮雾律' }],
})
const outlineBefore = structuredClone(outlineSnapshot)
const outlinePrompt = buildChapterOutlinePrompt(outlineSnapshot)
assert.deepEqual(outlineSnapshot, outlineBefore)
assert.match(outlinePrompt, /^=== 小说基本信息 ===\n小说标题：雾港纪事\n小说类型：科幻未来/)
assert.match(outlinePrompt, /章节《司灯议会》/)
assert.match(outlinePrompt, /主要人物：\n- 沈砚（protagonist）\n- 陆微（supporting）/)
assert.match(outlinePrompt, /世界观设定：\n- 潮雾律/)
assert.ok(outlinePrompt.endsWith('请生成详细的章节大纲：'))

const emptyOutlinePrompt = buildChapterOutlinePrompt(createChapterOutlinePromptSnapshot({
  novel: null,
  form: { title: '' },
  chapters: [],
  characters: [],
  worldSettings: [],
}))
assert.match(emptyOutlinePrompt, /小说标题：未命名小说/)
assert.match(emptyOutlinePrompt, /章节《新章节》/)
assert.doesNotMatch(emptyOutlinePrompt, /主要人物：/)
assert.doesNotMatch(emptyOutlinePrompt, /世界观设定：/)
console.log('✓ 当前章节大纲 prompt 完整注入小说、人物、世界观与已有章节')

const defaultSingleSnapshot = createSingleChapterPromptSnapshot({
  novel,
  chapters: chapters.slice(0, 2),
  form: {
    title: '司灯议会',
    plotRequirement: '揭示议长隐瞒的航线',
    template: 'turning',
  },
})
const defaultSinglePrompt = buildSingleChapterOutlinePrompt(defaultSingleSnapshot)
assert.match(defaultSinglePrompt, /^=== 小说基本信息 ===/)
assert.match(defaultSinglePrompt, /章节序号：第3章/)
assert.match(defaultSinglePrompt, /模板类型：转折剧情模板，制造悬念和反转/)
assert.match(defaultSinglePrompt, /1\. 只生成一个章节（第3章）/)
assert.ok(defaultSinglePrompt.endsWith('大纲：[详细的章节内容描述，包含主要情节、人物发展、重要事件等]'))

const customSinglePrompt = buildSingleChapterOutlinePrompt(createSingleChapterPromptSnapshot({
  novel,
  chapters: chapters.slice(0, 2),
  form: defaultSingleSnapshot.form,
  customPrompt: '输出 10 章，并添加 Markdown 标题。',
}))
assert.match(customSinglePrompt, /^=== 用户输入信息 ===/)
assert.ok(
  customSinglePrompt.indexOf('输出 10 章') < customSinglePrompt.indexOf('=== 重要约束 ==='),
)
assert.match(customSinglePrompt, /无论提示词中是否提到"10章"等内容，都只生成一个章节/)
assert.match(customSinglePrompt, /必须使用用户指定的章节标题：司灯议会/)

const emptyCustomSingle = buildSingleChapterOutlinePrompt(createSingleChapterPromptSnapshot({
  novel: null,
  chapters: [],
  form: { title: '新章', plotRequirement: '', template: 'unknown' },
  customPrompt: '',
}))
assert.match(emptyCustomSingle, /^=== 小说基本信息 ===/)
assert.match(emptyCustomSingle, /情节要求：请根据章节标题合理发展/)
assert.match(emptyCustomSingle, /模板类型：通用模板/)
console.log('✓ 单章默认/自定义 prompt 共用快照与约束，空自定义内容回退默认路径')

const defaultBatchSnapshot = createBatchChapterPromptSnapshot({
  novel,
  chapters,
  form: {
    count: 2,
    plotRequirement: '让沈砚找到内鬼',
    template: 'battle',
  },
})
const defaultBatchPrompt = buildBatchChapterOutlinePrompt(defaultBatchSnapshot)
assert.match(defaultBatchPrompt, /^You are a professional Chinese web-novel story architect\./)
assert.match(defaultBatchPrompt, /Generate 2 chapter outlines/)
assert.match(defaultBatchPrompt, /已有章节数：6个/)
assert.doesNotMatch(defaultBatchPrompt, /第1章《潮声》/)
assert.match(defaultBatchPrompt, /第2章《旧船》/)
assert.match(defaultBatchPrompt, /第6章《熄灯》/)
assert.match(defaultBatchPrompt, /章节1：\n标题：\[章节标题\]/)
assert.match(defaultBatchPrompt, /章节2：\n标题：\[章节标题\]/)
assert.doesNotMatch(defaultBatchPrompt, /章节3：\n标题：\[章节标题\]/)
assert.ok(defaultBatchPrompt.endsWith('请现在开始生成：'))

const customBatchPrompt = buildBatchChapterOutlinePrompt(createBatchChapterPromptSnapshot({
  novel,
  chapters,
  form: defaultBatchSnapshot.form,
  customPrompt: '先输出一段前言，再生成一个章节。',
}))
assert.match(customBatchPrompt, /^=== 用户输入信息 ===/)
assert.ok(
  customBatchPrompt.indexOf('先输出一段前言') < customBatchPrompt.indexOf('=== 重要格式约束'),
)
assert.match(customBatchPrompt, /无论上述提示词如何，你必须严格按照以下格式输出2个章节/)
assert.equal(
  [...customBatchPrompt.matchAll(/^章节\d+：$/gm)].length,
  2,
  '自定义分支的格式示例数必须与请求数量一致',
)
assert.match(customBatchPrompt, /必须生成完整的2个章节，缺一不可/)
assert.ok(customBatchPrompt.endsWith('请现在开始生成2个章节大纲：'))
console.log('✓ 批量默认/自定义 prompt 继承最近 5 章上下文和最终机器解析契约')

// Full-output hashes lock the extracted Writer.vue behavior, except for the
// intentional custom-batch example-count fix. Marker checks stay diagnostic.
const promptGoldens = {
  outline: '09d74eeabde2eb3a4d8286566ee17d3af4d28e3e512f6f19bf226c0f64f6035c',
  singleDefault: 'e2c90ef8dcdf6edd10f8ddcd600d37e9b8091008ec06a7807d59a4ac621a5c93',
  singleCustom: '75c626d13c59895193a06a3cee43627c019e2fa6b3c94c9367d0f916d9dabf41',
  batchDefault: 'e7fccdbc9d7c3d96f03be0413a3022f2202a6ce888b4163c2b379036ff508ad0',
  batchCustom: '24074fb5ebfb6742e18f258f206ed06270c1f256c6dc90beb65ff73ae58b67fb',
}
const actualGoldens = {
  outline: digest(outlinePrompt),
  singleDefault: digest(defaultSinglePrompt),
  singleCustom: digest(customSinglePrompt),
  batchDefault: digest(defaultBatchPrompt),
  batchCustom: digest(customBatchPrompt),
}

assert.deepEqual(actualGoldens, promptGoldens)
console.log('✓ 五条 prompt 路径通过完整输出 golden 校验')

console.log('\n=== WRITER CHAPTER OUTLINE PROMPT TESTS PASSED ===')
