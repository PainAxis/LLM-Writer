/**
 * 默认提示词库回归校验（npm run smoke:prompts）
 * 覆盖：id 唯一性 / 必填字段 / 占位符兼容（填充代码按中文字面量替换）/
 * 解析格式硬依赖（角色四字段·批量八字段·章节N·设定N）/ 中文输出指令。
 */
import assert from 'node:assert'
import { DEFAULT_PROMPTS, PROMPTS_VERSION, mergeDefaultPrompts } from '../src/config/defaultPrompts'

// ---- 测试 1：id 唯一且必填字段非空 ----
const ids = new Set<number>()
for (const p of DEFAULT_PROMPTS) {
  assert.ok(!ids.has(p.id), `模板 id 重复: ${p.id}`)
  ids.add(p.id)
  assert.ok(p.title && p.category && p.content && Array.isArray(p.tags) && p.tags.length > 0, `模板 ${p.id} 必填字段缺失`)
}
assert.strictEqual(DEFAULT_PROMPTS.length, 38, '内置模板总数应为 38')
console.log('✓ 测试1 通过：38 个模板 id 唯一、必填字段完整')

// ---- 测试 2：占位符兼容（代码填充端按中文字面量替换，缺一不可） ----
const placeholdersOf = (id: number): string[] => {
  const p = DEFAULT_PROMPTS.find((x) => x.id === id)!
  return [...p.content.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
}
const expectPlaceholders = (id: number, required: string[]) => {
  const actual = new Set(placeholdersOf(id))
  for (const name of required) {
    assert.ok(actual.has(name), `模板 ${id} 缺少占位符 {${name}}`)
  }
}

// 正文生成类（Writer 自动填充）
expectPlaceholders(2, ['小说标题', '章节标题', '章节大纲', '目标字数', '写作视角', '重点内容'])
expectPlaceholders(6, ['主要人物', '世界观设定', '参考语料', '前文概要'])
expectPlaceholders(7, ['章节大纲', '主要人物'])
expectPlaceholders(8, ['世界观设定'])
expectPlaceholders(9, ['主要人物'])
expectPlaceholders(10, ['重点内容', '主要人物'])
expectPlaceholders(3, ['原文内容'])
expectPlaceholders(4, ['当前内容', '续写字数'])
// 角色类（Writer 自动填充）
expectPlaceholders(5, ['姓名', '角色定位', '性别', '年龄', '小说类型'])
expectPlaceholders(11, ['姓名', '性别', '年龄', '小说类型'])
expectPlaceholders(12, ['关系设定'])
expectPlaceholders(14, ['社会地位'])
expectPlaceholders(15, ['职业设定'])
expectPlaceholders(16, ['修为等级'])
expectPlaceholders(17, ['科技设定'])
expectPlaceholders(22, ['生成数量', '小说类型', '小说简介', '角色类型', '特殊要求'])
// 世界观类
expectPlaceholders(18, ['生成数量', '设定类型', '特殊要求'])
expectPlaceholders(19, ['特殊要求'])
expectPlaceholders(20, ['特殊要求'])
expectPlaceholders(25, ['特殊要求'])
expectPlaceholders(26, ['时间背景', '科技水平', '修真体系', '政治制度', '经济模式', '阶级分层', '文化特色', '独特法则', '限制条件', '冲突矛盾', '重要设施', '特殊物品', '势力组织', '主要冲突', '时代特征', '故事类型', '主角设定', '核心情节'])
expectPlaceholders(27, ['在此处详细描述您的世界观设定', '标题', '内容类型', '具体要求', '目标字数'])
// 章节大纲类
expectPlaceholders(21, ['生成章节数量', '已有章节', '情节要求', '模板类型'])
expectPlaceholders(23, ['生成章节数量', '已有章节', '情节要求'])
expectPlaceholders(24, ['生成章节数量', '已有章节', '情节要求'])
// 短篇类（ShortStory 自动填充）
for (const id of [28, 29, 30, 31, 32, 33]) {
  expectPlaceholders(id, ['小说标题', '主角姓名', '主角性别', '主角年龄', '故事地点', '字数要求', '题材类型', '情节类型', '情绪氛围', '时间背景', '创作要求', '参考文本'])
}
// 拆书类
for (const id of [34, 35, 36, 37, 38]) {
  expectPlaceholders(id, ['小说文本'])
}
console.log('✓ 测试2 通过：全部模板占位符与填充端兼容')

// ---- 测试 3：解析格式硬依赖（Writer 解析器按中文字段名 + 全角冒号提取） ----
const contentOf = (id: number): string => DEFAULT_PROMPTS.find((x) => x.id === id)!.content

// 单角色：外貌：/性格：/背景：/标签： 四字段 + 半角逗号标签
for (const id of [5, 11, 12, 13, 14, 15, 16, 17]) {
  const c = contentOf(id)
  assert.ok(c.includes('外貌：'), `模板 ${id} 缺少 外貌： 字段`)
  assert.ok(c.includes('性格：'), `模板 ${id} 缺少 性格： 字段`)
  assert.ok(c.includes('背景：'), `模板 ${id} 缺少 背景： 字段`)
  assert.ok(c.includes('标签：'), `模板 ${id} 缺少 标签： 字段`)
  assert.ok(c.includes('标签：['), `模板 ${id} 标签须有示例值`)
  assert.ok(!/标签：\[[^\]]*，/.test(c), `模板 ${id} 标签示例须用半角逗号`)
}
// 批量角色：角色1： 块头 + 8 字段
const c22 = contentOf(22)
for (const f of ['角色1：', '姓名：', '角色：', '性别：', '年龄：', '外貌：', '性格：', '背景：', '标签：']) {
  assert.ok(c22.includes(f), `批量角色模板缺少 ${f}`)
}
// 批量章节：章节N： + 标题：/大纲：
for (const id of [21, 23, 24]) {
  const c = contentOf(id)
  assert.ok(c.includes('章节1：'), `模板 ${id} 缺少 章节1： 块头`)
  assert.ok(c.includes('标题：'), `模板 ${id} 缺少 标题： 字段`)
  assert.ok(c.includes('大纲：'), `模板 ${id} 缺少 大纲： 字段`)
}
// 世界观：设定N： + 标题：/类型：/描述：，类型值落在枚举内
for (const id of [18, 19, 20, 25]) {
  const c = contentOf(id)
  assert.ok(c.includes('设定1：'), `模板 ${id} 缺少 设定1： 块头`)
  assert.ok(c.includes('标题：'), `模板 ${id} 缺少 标题： 字段`)
  assert.ok(c.includes('类型：'), `模板 ${id} 缺少 类型： 字段`)
  assert.ok(c.includes('描述：'), `模板 ${id} 缺少 描述： 字段`)
}
const TYPE_ENUM = ['地理环境', '文化社会', '历史背景', '魔法体系', '科技水平', '其他']
for (const [id, type] of [[19, '魔法体系'], [20, '文化社会'], [25, '地理环境']] as const) {
  assert.ok(contentOf(id).includes(`类型：${type}`), `模板 ${id} 的类型值应为 ${type}（解析枚举内）`)
}
console.log('✓ 测试3 通过：角色/章节/世界观解析格式硬依赖全部保留')

// ---- 测试 4：英文强约束 + 中文输出指令全覆盖 ----
for (const p of DEFAULT_PROMPTS) {
  assert.ok(/Simplified Chinese/.test(p.content), `模板 ${p.id} 缺少 Simplified Chinese 输出指令`)
}
console.log('✓ 测试4 通过：38 个模板全部强制简体中文输出')

// ---- 测试 5：mergeDefaultPrompts 合并语义 ----
const v = PROMPTS_VERSION
assert.ok(v >= 2, '版本号应 ≥ 2')
const userTemplate = { id: 999, title: '用户模板', category: 'polish', description: 'd', content: 'c', tags: ['t'], isDefault: false }
const stale = { id: 18, title: '旧内容', category: 'worldview', description: 'd', content: '旧', tags: [], isDefault: true }
const merged = mergeDefaultPrompts([stale, userTemplate])
const m18 = merged.find((p) => p.id === 18)!
assert.strictEqual(m18.title, '基础世界观生成器', '同 id 默认模板应被新库覆盖')
assert.ok(merged.some((p) => p.id === 999), '用户自建模板应保留')
assert.ok(merged.some((p) => p.id === 26), '新增默认模板应补齐')
assert.strictEqual(merged.find((p) => p.id === 999)!.content, 'c', '用户模板内容不被修改')
console.log('✓ 测试5 通过：mergeDefaultPrompts 同 id 覆盖 / 新增补齐 / 用户模板保留')

console.log('\n=== ALL DEFAULT-PROMPTS TESTS PASSED ===')
