import assert from 'node:assert/strict'
import {
  buildChapterContentPrompt,
  describeNarrativeStyle,
  describeWriterGenre,
  type ChapterContentPromptInput,
} from '../src/utils/writer/chapterContentPrompt'

assert.equal(describeWriterGenre('science'), '科幻未来')
assert.equal(describeWriterGenre('scifi'), '科幻未来')
assert.equal(describeWriterGenre('history'), '历史架空')
assert.equal(describeWriterGenre('martial'), '武侠修仙')
assert.equal(describeWriterGenre('wuxia'), '武侠修仙')
assert.equal(describeWriterGenre('unknown'), '通用小说')
assert.equal(describeNarrativeStyle('first-person'), '第一人称')
assert.equal(describeNarrativeStyle('unknown'), '第三人称')
console.log('✓ 小说类型别名与写作视角使用统一映射')

const longContext = `<p>开头标记${'甲'.repeat(650)}中段不应出现${'乙'.repeat(650)}结尾标记</p>`
const input: ChapterContentPromptInput = {
  novel: {
    id: 1,
    title: '雾港纪事',
    genre: 'scifi',
    description: '灯塔熄灭后的港口故事',
  },
  chapter: {
    id: 14,
    title: '司灯议会',
    description: '沈砚进入议会寻找内鬼',
  },
  config: {
    wordCount: 3333,
    style: 'first-person',
    focus: '揭示议长的谎言',
  },
  materials: {
    characters: [{ id: 21, name: '沈砚', role: '主角', personality: '克制而敏锐' }],
    worldSettings: [{ title: '雾港', description: '终年被潮雾笼罩' }],
    corpus: [{ title: '航海笔记', content: '潮线每天向北移动。' }],
    events: [{
      chapter: 3,
      title: '灯塔熄灭',
      description: '港口失去航标',
      characterIds: [21, '旧船长', 999],
    }],
  },
  contextChapters: [
    {
      id: 11,
      chapterIndex: 1,
      title: '潮声',
      description: '沈砚抵达雾港',
      content: '<p>短篇&nbsp;上下文</p>',
    },
    {
      id: 13,
      chapterIndex: 3,
      title: '灯塔',
      description: '灯塔突然熄灭',
      content: longContext,
    },
  ],
  characterNamesById: { 21: '沈砚' },
  prompt: '自定义核心要求：保留潮汐伏笔。',
}

const before = structuredClone(input)
const built = buildChapterContentPrompt(input)

assert.deepEqual(input, before, '纯 builder 不得修改 snapshot')
assert.deepEqual(built.contextLabels, ['第1章：潮声', '第3章：灯塔'])
for (const marker of [
  '小说标题：雾港纪事',
  '小说类型：科幻未来',
  '章节标题：司灯议会',
  '目标字数：约3333字',
  '写作视角：第一人称',
  '重点内容：揭示议长的谎言',
  '- 沈砚（主角）：克制而敏锐',
  '- 雾港：终年被潮雾笼罩',
  '【航海笔记】潮线每天向北移动。',
  '灯塔熄灭 - 港口失去航标（参与角色：沈砚、旧船长）',
  '第1章《潮声》：沈砚抵达雾港',
  '自定义核心要求：保留潮汐伏笔。',
]) {
  assert.ok(built.prompt.includes(marker), `最终提示词应包含：${marker}`)
}
assert.match(built.prompt, /【第1章内容】\n短篇&nbsp;上下文/)
assert.match(built.prompt, /【第3章开头部分】\n开头标记/)
assert.match(built.prompt, /【第3章结尾部分】[\s\S]*结尾标记/)
assert.doesNotMatch(built.prompt, /中段不应出现/)
assert.doesNotMatch(built.prompt, /<p>|<\/p>/)
console.log('✓ 正文提示词完整注入配置与四类素材，并从快照解析事件参与角色')
console.log('✓ 长上下文仅保留首尾片段，短上下文完整保留且清除 HTML 标签')

const minimal = buildChapterContentPrompt({
  novel: {},
  chapter: { id: 1, title: '无素材章节' },
  config: { wordCount: 1000, style: 'unknown' },
  materials: { characters: [], worldSettings: [], corpus: [], events: [] },
  contextChapters: [],
  characterNamesById: {},
  prompt: '直接推进剧情。',
})

assert.deepEqual(minimal.contextLabels, [])
assert.match(minimal.prompt, /小说标题：未命名小说/)
assert.match(minimal.prompt, /小说类型：通用小说/)
assert.match(minimal.prompt, /写作视角：第三人称/)
assert.doesNotMatch(minimal.prompt, /=== 主要人物设定 ===/)
assert.doesNotMatch(minimal.prompt, /=== 前文概要（必须保持连贯） ===/)
console.log('✓ 空素材与空上下文不生成空章节，未知值使用稳定兜底')

console.log('\n=== WRITER CHAPTER CONTENT PROMPT TESTS PASSED ===')
