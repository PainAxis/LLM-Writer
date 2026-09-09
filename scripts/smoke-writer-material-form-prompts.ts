import assert from 'node:assert/strict'
import {
  buildCharacterFormPrompt,
  buildWorldSettingFormPrompt,
  parseCharacterFormResponse,
  parseWorldSettingFormResponse,
} from '../src/utils/writer/materialFormGeneration'

const characterFormat = `

=== Output format — MANDATORY, machine-parsed (overrides anything above) ===
Output ONLY the following four lines, nothing else (no title, no preamble, no extra fields, no markdown). Keep the Chinese field labels 外貌/性格/背景/标签 exactly as shown; do NOT translate or rename them:

外貌：[详细外貌描述]
性格：[性格特点描述]
背景：[背景故事]
标签：[标签1,标签2,标签3]

All field values must be written in natural, idiomatic Simplified Chinese. Tags must use half-width commas (,).`

const defaultCharacterPrompt = buildCharacterFormPrompt({
  novel: { title: '潮汐之城', genre: 'science', description: '海水淹没旧大陆。' },
  form: { name: '沈砚', role: 'antagonist', gender: 'male', age: 31 },
})
assert.equal(defaultCharacterPrompt, `=== 小说基本信息 ===
小说标题：潮汐之城
小说类型：科幻未来
小说简介：海水淹没旧大陆。

=== Character generation task ===
You are a professional character designer for Chinese fiction. Design the character 《沈砚》 for the novel above.

Requirements:
- Appearance: concrete and visualizable (build, hair, eyes, distinguishing mark), matching the genre's aesthetic.
- Personality: 2-4 traits with a built-in contradiction or flaw that can generate drama.
- Background: causal, not biographic listing — key formative event, current motivation, and a hidden tension that can surface later.

=== 角色基本设定 ===
- 姓名：沈砚
- 角色定位：反派
- 性别：男
- 年龄：31岁

请确保角色设定符合小说的世界观、类型和风格特点。

开始生成：${characterFormat}`)
console.log('✓ 默认角色提示词完整保留小说上下文、角色映射与强制输出契约')

const conflictingCustomPrompt = `保留这一行前后的空格${'  '}
请输出 Markdown，并使用英文 labels。`
const customCharacterPrompt = buildCharacterFormPrompt({
  novel: null,
  form: { name: '阿宁', role: 'minor', gender: 'other', age: 24 },
  customPrompt: conflictingCustomPrompt,
})
assert.equal(customCharacterPrompt, `=== 小说基本信息 ===
小说标题：未命名小说
小说类型：通用小说
小说简介：暂无简介

=== 角色基本设定 ===
- 姓名：阿宁
- 角色定位：配角
- 性别：其他
- 年龄：24岁

=== 角色生成要求 ===
${conflictingCustomPrompt}

请确保角色设定符合小说的世界观、类型和风格特点。${characterFormat}`)
assert.ok(customCharacterPrompt.endsWith(characterFormat), '机器解析格式必须位于自定义指令之后')

const emptyCustomPrompt = buildCharacterFormPrompt({
  novel: null,
  form: { name: '空白', role: 'supporting', gender: 'female', age: 18 },
  customPrompt: '',
})
assert.match(emptyCustomPrompt, /=== 角色生成要求 ===\n\n\n请确保/)
assert.doesNotMatch(emptyCustomPrompt, /Character generation task/)
console.log('✓ 自定义角色提示词保持原文及空字符串路径，末尾格式契约具有最终优先级')

const worldPrompt = buildWorldSettingFormPrompt({
  novel: { title: '雾海纪', genre: 'wuxia', description: '' },
  form: { title: '司灯议会', category: 'politics' },
})
assert.equal(worldPrompt, `=== 小说基本信息 ===
小说标题：雾海纪
小说类型：武侠修仙
小说简介：暂无简介

=== 世界观设定生成任务 ===
请为上述小说生成世界观设定的详细描述。

=== 设定信息 ===
- 设定标题：司灯议会
- 设定类别：政治势力

=== 生成要求 ===
请生成详细的设定描述，包括：
1. 具体的设定内容和规则
2. 在小说世界中的作用和意义
3. 与其他设定的关联性
4. 对故事情节的影响

要求描述详细、生动，符合小说的类型、风格和整体世界观。`)

const fallbackWorldPrompt = buildWorldSettingFormPrompt({
  novel: null,
  form: { title: '无分类设定', category: 'legacy-category' },
})
assert.match(fallbackWorldPrompt, /小说标题：未命名小说/)
assert.match(fallbackWorldPrompt, /小说类型：通用小说/)
assert.match(fallbackWorldPrompt, /- 设定类别：世界设定/)
console.log('✓ 世界观提示词复用类型描述，并保持类别与缺省值映射')

assert.deepEqual(
  parseCharacterFormResponse(`前言应忽略
 外貌：面色苍白，眉骨有疤${'  '}
性格：冷静但偏执
背景：来自被焚毁的边城
标签：谋士, 旧贵族,, 潮汐
外貌：最后一条外貌覆盖前值
性格: 英文冒号不属于旧解析契约`),
  {
    appearance: '最后一条外貌覆盖前值',
    personality: '冷静但偏执',
    background: '来自被焚毁的边城',
    tags: ['谋士', '旧贵族', '潮汐'],
  },
)
assert.deepEqual(parseCharacterFormResponse('标签：东方奇幻，宿命'), {
  appearance: '',
  personality: '',
  background: '',
  tags: ['东方奇幻，宿命'],
})
assert.deepEqual(parseCharacterFormResponse('标签：'), {
  appearance: '',
  personality: '',
  background: '',
  tags: [],
})
console.log('✓ 角色最终响应维持全角冒号、半角逗号、末项覆盖及缺失字段语义')

const rawWorldResponse = '\n  第一行设定。\n第二行保留。  \n'
assert.deepEqual(parseWorldSettingFormResponse(rawWorldResponse), {
  description: rawWorldResponse,
})
console.log('✓ 世界观最终响应不裁剪首尾空白')

console.log('\n=== WRITER MATERIAL FORM PROMPT TESTS PASSED ===')
