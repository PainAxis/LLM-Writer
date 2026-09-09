import assert from 'node:assert/strict'
import { describeWriterGenre } from '../src/utils/writer/chapterContentPrompt'
import {
  WORLD_SETTING_GENERATION_TYPES,
  buildBatchCharacterPrompt,
  buildBatchWorldPrompt,
  getBatchWorldSettingTypes,
} from '../src/utils/writer/materialGenerationPrompts'
import type {
  WriterBatchCharacterGenerationConfig,
  WriterWorldGenerationConfig,
} from '../src/types/writer'

const genreCases: Array<[string | null | undefined, string]> = [
  ['fantasy', '玄幻小说'],
  ['urban', '都市言情'],
  ['history', '历史架空'],
  ['historical', '历史架空'],
  ['scifi', '科幻未来'],
  ['science', '科幻未来'],
  ['wuxia', '武侠修仙'],
  ['martial', '武侠修仙'],
  ['romance', '现代言情'],
  ['western_fantasy', '西方奇幻'],
  ['自定义蒸汽朋克', '通用小说'],
  [null, '通用小说'],
]

for (const [input, expected] of genreCases) {
  assert.equal(describeWriterGenre(input), expected)
}
console.log('✓ Writer 类型描述兼容 canonical 与 legacy alias')

const characterConfig: WriterBatchCharacterGenerationConfig = {
  count: 4,
  includeMainCharacters: true,
  includeSupportingCharacters: true,
  includeMinorCharacters: false,
  customPrompt: '至少一人隐瞒身份',
  autoAssignRoles: true,
}

const defaultCharacterPrompt = buildBatchCharacterPrompt({
  novel: { title: '雾港', genre: 'history', description: '港城权力斗争' },
  config: characterConfig,
})
assert.match(defaultCharacterPrompt, /小说类型：历史架空/)
assert.match(defaultCharacterPrompt, /Generate 4 characters/)
assert.match(defaultCharacterPrompt, /角色类型要求 ===\n主角、配角/)
assert.match(defaultCharacterPrompt, /自动平衡角色之间的定位、关系和重要性/)
assert.match(defaultCharacterPrompt, /特殊要求：至少一人隐瞒身份/)
assert.match(defaultCharacterPrompt, /角色1：\n姓名：\[角色姓名\]/)
assert.match(defaultCharacterPrompt, /Continue the numbering up to 角色4/)
assert.ok(
  defaultCharacterPrompt.endsWith('Tags must use half-width commas (,).'),
  '机器解析格式必须位于最终提示词末尾',
)
console.log('✓ 默认批量角色提示词包含当前配置、智能分配约束与最终机器格式')

const manualCharacterPrompt = buildBatchCharacterPrompt({
  novel: { title: '星河', genre: 'science', description: '远航舰队' },
  config: { ...characterConfig, count: 2, autoAssignRoles: false },
  selectedTemplatePrompt: '使用用户模板，并输出一段自由格式说明。',
})
assert.match(manualCharacterPrompt, /小说类型：科幻未来/)
assert.match(manualCharacterPrompt, /使用用户模板，并输出一段自由格式说明。/)
assert.match(manualCharacterPrompt, /不要自动改写或平衡角色定位/)
assert.ok(
  manualCharacterPrompt.indexOf('使用用户模板') < manualCharacterPrompt.indexOf('Output format — MANDATORY'),
  '自定义模板后必须追加覆盖性的机器格式',
)
assert.match(manualCharacterPrompt, /Output ONLY 2 character blocks/)
console.log('✓ 自定义批量角色模板仍追加机器格式，并真实响应 autoAssignRoles=false')

const allWorldTypesConfig: WriterWorldGenerationConfig = {
  count: 5,
  includeGeography: true,
  includeCulture: true,
  includeHistory: true,
  includeMagic: true,
  includeTechnology: true,
  includePolitics: true,
  includeReligion: true,
  includeEconomy: true,
  includeRaces: true,
  includeLanguage: true,
  customPrompt: '每项都给出明确代价',
}

assert.deepEqual(getBatchWorldSettingTypes(allWorldTypesConfig), WORLD_SETTING_GENERATION_TYPES)
const defaultWorldPrompt = buildBatchWorldPrompt({
  novel: { title: '十洲记', genre: 'wuxia', description: '十洲纷争' },
  config: allWorldTypesConfig,
})
assert.match(defaultWorldPrompt, /小说类型：武侠修仙/)
assert.match(defaultWorldPrompt, /设定类型要求：地理环境、文化社会、历史背景、魔法体系、科技水平、政治势力、宗教信仰、经济贸易、种族设定、语言文字/)
for (const type of WORLD_SETTING_GENERATION_TYPES) {
  assert.match(defaultWorldPrompt, new RegExp(type))
}
assert.match(defaultWorldPrompt, /Continue the numbering up to 设定5/)
console.log('✓ 默认批量世界观提示词覆盖配置中的全部 10 类设定')

const customWorldPrompt = buildBatchWorldPrompt({
  novel: { title: '夜航船', genre: 'historical', description: '海上商路' },
  config: {
    ...allWorldTypesConfig,
    count: 2,
    includeMagic: false,
    includeTechnology: false,
    customPrompt: '港口之间必须相互制约',
  },
  selectedTemplatePrompt: '请自由描述港口网络，不需要固定格式。',
})
assert.match(customWorldPrompt, /请自由描述港口网络，不需要固定格式。/)
assert.match(customWorldPrompt, /额外要求：港口之间必须相互制约/)
assert.ok(
  customWorldPrompt.indexOf('不需要固定格式') < customWorldPrompt.indexOf('Output format — MANDATORY'),
  '世界观自定义分支也必须在末尾追加强制格式',
)
assert.match(customWorldPrompt, /Output ONLY 2 setting blocks/)
assert.match(customWorldPrompt, /类型允许值：地理环境 \/ 文化社会 \/ 历史背景 \/ 魔法体系 \/ 科技水平 \/ 政治势力 \/ 宗教信仰 \/ 经济贸易 \/ 种族设定 \/ 语言文字 \/ 其他/)
assert.ok(customWorldPrompt.endsWith('Generate exactly 2 blocks.'))
console.log('✓ 自定义批量世界观模板无条件追加支持 10 类设定的机器格式')

console.log('\n=== WRITER MATERIAL PROMPT TESTS PASSED ===')
