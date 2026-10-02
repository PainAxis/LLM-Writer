import assert from 'node:assert/strict'
import { TOOL_DEFINITIONS, TOOL_OUTPUT_REQUIREMENTS } from '../src/config/tools'
import { DEFAULT_PROMPTS } from '../src/config/defaultPrompts'
import { isToolFormComplete } from '../src/utils/toolForms'
import { buildToolPrompt, getToolPrompts, isCompatibleToolPrompt } from '../src/utils/toolPrompts'
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
    '{小说标题}|{小说类型}|{小说简介}|{标签}|{主要人物}|{世界观设定}|{参考章节内容}',
}
const custom = buildToolPrompt(reference)
assert.ok(custom.includes('城市漫游|都市|寻找旧友|旅行|小林：谨慎|北城：沿河而建|'))
assert.ok(!custom.includes('[待填充]'))
assert.ok(!custom.includes('未选择正文'))

const literal = source('title', { count: '5', genre: 'urban', keywords: '$& $1 $$ 城市' })
literal.selectedPrompt = { content: '{关键词}|{keywords}|{生成数量}|{count}' }
assert.ok(buildToolPrompt(literal).includes('$& $1 $$ 城市|$& $1 $$ 城市|5|5'))
reference.form.selectedChapters = []
reference.selectedPrompt = { content: '{参考章节内容}' }
assert.ok(buildToolPrompt(reference).includes('暂无参考章节'))
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

const originalCatalog = JSON.stringify(DEFAULT_PROMPTS)
for (const type of Object.keys(TOOL_DEFINITIONS) as ToolType[]) {
  const definition = TOOL_DEFINITIONS[type]
  const form: ToolForm = {}
  for (const field of definition.fields) {
    if (field.type === 'novel-select') form[field.key] = 'novel-1'
    else if (field.type === 'chapter-select') form[field.key] = ['chapter-1']
    else if (field.type !== 'prompt-select') form[field.key] = field.options?.at(-1)?.value
      ?? (['count', 'chapters'].includes(field.key) ? '7' : `${field.label}：$& $1 $$ {count}`)
  }
  const templates = getToolPrompts(type, DEFAULT_PROMPTS)
  assert.ok(templates.length, `${type} always has a tool-specific default template`)
  for (const template of [null, ...templates]) {
    const prompt = buildToolPrompt({ ...source(type, form), selectedPrompt: template })
    assert.ok(prompt.includes(TOOL_OUTPUT_REQUIREMENTS[type]), `${type}: task survives every template route`)
    for (const field of definition.fields.filter(field => !['novel-select', 'chapter-select', 'prompt-select'].includes(field.type))) {
      const raw = form[field.key]
      const label = field.options?.find(option => option.value === raw)?.label ?? raw
      assert.ok(prompt.includes(`${field.label}：${label}`), `${type}: ${field.label} survives every template route`)
    }
    if (form.count) assert.ok(prompt.includes(`生成数量：${form.count}个`))
    if (form.chapters) assert.ok(prompt.includes(`生成章节数量：${form.chapters}章`))
    assert.ok(!prompt.includes('[待填充]'))
  }
}
assert.equal(JSON.stringify(DEFAULT_PROMPTS), originalCatalog, 'Tools template filtering never rewrites the prompt catalog')

const duplicates = source('synopsis', { selectedNovel: 2, style: 'direct' })
duplicates.novels = [{ value: 1, label: '同名作品' }, { value: 2, label: '同名作品' }]
duplicates.originals = [{ id: 1, title: '同名作品', genre: '玄幻', description: '第一本龙王', characters: [{ name: '龙王' }] },
  { id: 2, title: '同名作品', genre: '科幻', description: '第二本星舰', characters: [{ name: '舰长' }] }]
for (const selectedNovel of [2, '2']) {
  const result = buildToolPrompt({ ...duplicates, form: { ...duplicates.form, selectedNovel } })
  assert.ok(result.includes('第二本星舰') && result.includes('舰长') && !result.includes('龙王'))
  assert.ok(result.includes('100-200字') && result.includes('简介风格：直白介绍'))
}
assert.throws(() => buildToolPrompt({ ...duplicates, form: { selectedNovel: 3 } }), /重新选择小说/)
assert.throws(() => buildToolPrompt({ ...duplicates, originals: [duplicates.originals[0]] }), /重新选择小说/)
duplicates.originals[1].id = 0
duplicates.novels[1].value = 0
duplicates.form.selectedNovel = 0
assert.ok(buildToolPrompt(duplicates).includes('第二本星舰'))
assert.equal(isToolFormComplete(TOOL_DEFINITIONS.synopsis, { selectedNovel: 0 }), true)

const html = source('outline', { selectedNovel: 'novel-1', selectedChapters: ['chapter-1'], chapters: '3' })
html.chapters[0].content = '<p>甲&amp;乙</p><p>段二<br>行二 &lt;林&gt;</p>'
const visible = buildToolPrompt(html)
assert.ok(visible.includes('内容：甲&乙\n\n段二\n行二 <林>'))
assert.ok(!visible.includes('<p>') && !visible.includes('&amp;'))
html.form.selectedChapters = ['deleted-chapter']
assert.throws(() => buildToolPrompt(html), /重新选择章节/)

const character = source('character', { count: '5', role: 'protagonist', gender: 'female', personality: '内向但善于伪装 $& {count}' })
for (const template of getToolPrompts('character', DEFAULT_PROMPTS)) {
  const result = buildToolPrompt({ ...character, selectedPrompt: template })
  assert.ok(result.includes('生成数量：5个') && result.includes('性别：女性') && result.includes('角色定位：主角'))
  assert.ok(result.includes('内向但善于伪装 $& {count}'), 'Inserted braces and dollar replacement tokens remain literal')
  assert.ok(!result.includes('Design one'))
}
const incompatible = DEFAULT_PROMPTS.find(prompt => prompt.id === 5)!
assert.equal(isCompatibleToolPrompt('character', incompatible), false)
assert.throws(() => buildToolPrompt({ ...character, selectedPrompt: incompatible }), /姓名|年龄/)
assert.equal(getToolPrompts('synopsis', DEFAULT_PROMPTS).some(prompt => prompt.category === 'content'), false)
const edited = { ...incompatible, content: '{生成数量}个{性别}角色；性格：{性格特点}' }
assert.ok(getToolPrompts('character', [edited]).some(prompt => prompt.id === edited.id), 'User-edited built-in IDs remain usable')
assert.ok(buildToolPrompt({ ...character, selectedPrompt: edited }).includes('5个女性角色；性格：内向但善于伪装 $& {count}'))
const legacySynopsis = { ...incompatible, id: 'user-synopsis', category: 'content', content: '生成{小说标题}的简介：{简介风格}' }
assert.ok(getToolPrompts('synopsis', [legacySynopsis]).some(prompt => prompt.id === legacySynopsis.id))
assert.throws(() => buildToolPrompt({ ...character, selectedPrompt: { content: '{不存在的变量}' } }), /\{不存在的变量\}/)
assert.throws(() => buildToolPrompt({ ...character, form: { ...character.form, count: '2.5' } }), /正整数/)
assert.throws(() => buildToolPrompt({ ...source('outline', { selectedNovel: 'novel-1', chapters: '-1' }) }), /正整数/)
const collision = { ...edited, id: 'tool-template:character' }
assert.notEqual(getToolPrompts('character', [collision])[0].id, collision.id, 'Local default IDs never shadow user templates')
console.log('PASS all tool/template field contracts, stable novel IDs, HTML context, template compatibility and literal substitutions')
