import assert from 'node:assert/strict'
import { TOOL_DEFINITIONS } from '../src/config/tools'
import { isToolFormComplete } from '../src/utils/toolForms'
import { buildToolPrompt } from '../src/utils/toolPrompts'
import type { ToolForm, ToolPromptSource, ToolType } from '../src/types/tools'

const source = (type: ToolType, form: ToolForm): ToolPromptSource => ({
  type,
  form,
  selectedPrompt: null,
  novels: [{ value: 'novel-1', label: '城市漫游' }],
  chapters: [
    {
      value: 'chapter-1',
      label: '第一章',
      description: '出发',
      content: '甲'.repeat(501) + '截断标记',
    },
    { value: 'chapter-2', label: '第二章', description: '未选择大纲', content: '未选择正文' },
  ],
  originals: [
    {
      id: 'novel-1',
      title: '城市漫游',
      genre: '都市',
      description: '寻找旧友',
      tags: ['旅行'],
      characters: [{ name: '小林', personality: '谨慎' }],
      worldSettings: [{ title: '北城', content: '沿河而建' }],
    },
  ],
})

assert.equal(Object.keys(TOOL_DEFINITIONS).length, 10)
assert.equal(isToolFormComplete({}, {}), false)
for (const type of Object.keys(TOOL_DEFINITIONS) as ToolType[]) {
  const definition = TOOL_DEFINITIONS[type]
  assert.equal(isToolFormComplete(definition, {}), false, `${type} must require its inputs`)
  const form: ToolForm = {}
  for (const field of definition.fields) {
    if (!field.required) continue
    form[field.key] =
      field.type === 'novel-select'
        ? 'novel-1'
        : (field.options?.[0]?.value ?? (field.key === 'count' ? '2' : '合成输入'))
  }
  assert.equal(isToolFormComplete(definition, form), true, `${type} accepts a complete form`)
  for (const field of definition.fields.filter((field) => field.required)) {
    assert.equal(isToolFormComplete(definition, { ...form, [field.key]: '  ' }), false)
  }
  const before = JSON.stringify(form)
  const prompt = buildToolPrompt(source(type, form))
  assert.ok(prompt.includes(definition.title), `${type} keeps its task instructions`)
  if (definition.hasNovelSelector) {
    for (const expected of ['城市漫游', '寻找旧友', '小林：谨慎', '北城：沿河而建']) {
      assert.ok(prompt.includes(expected), `${type} retains ${expected}`)
    }
  }
  assert.equal(JSON.stringify(form), before, 'Prompt building must not mutate form state')
}

const reference = source('outline', { selectedNovel: 'novel-1', selectedChapters: ['chapter-1'] })
const prompt = buildToolPrompt(reference)
assert.ok(prompt.includes('【第一章】'))
assert.ok(prompt.includes('甲'.repeat(500) + '...'))
for (const excluded of ['截断标记', '未选择大纲', '未选择正文', '【第二章】']) {
  assert.ok(!prompt.includes(excluded), `Only selected, bounded chapter context: ${excluded}`)
}
reference.selectedPrompt = {
  content:
    '{小说标题}|{小说类型}|{小说简介}|{标签}|{主要人物}|{世界观设定}|{参考章节内容}|{未知变量}',
}
const custom = buildToolPrompt(reference)
assert.ok(custom.includes('城市漫游|都市|寻找旧友|旅行|小林：谨慎|北城：沿河而建|'))
assert.ok(custom.endsWith('[待填充]'))
assert.ok(!custom.includes('未选择正文'))

const literal = source('title', { count: '5', genre: 'urban', keywords: '$& $1 $$ 城市' })
literal.selectedPrompt = { content: '{关键词}|{keywords}|{生成数量}|{count}' }
assert.equal(buildToolPrompt(literal), '$& $1 $$ 城市|$& $1 $$ 城市|5|5')
reference.form.selectedChapters = []
reference.selectedPrompt = { content: '{参考章节内容}' }
assert.ok(buildToolPrompt(reference).endsWith('暂无参考章节'))
assert.equal(
  isToolFormComplete(
    {
      fields: [
        { key: 'chapters', type: 'chapter-select', label: '章节', placeholder: '', required: true },
      ],
    },
    { chapters: [] }
  ),
  false
)
assert.equal(
  isToolFormComplete(
    {
      fields: [
        { key: 'chapters', type: 'chapter-select', label: '章节', placeholder: '', required: true },
      ],
    },
    { chapters: ['chapter-1'] }
  ),
  true
)
console.log(
  'PASS tool catalog, required forms, prompt context, templates and bounded chapter selection'
)
