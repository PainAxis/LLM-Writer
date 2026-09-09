import assert from 'node:assert/strict'
import { parseGeneratedCharacters } from '../src/utils/writer/characterGeneration'
import {
  normalizeWorldSettingCategory,
  parseGeneratedWorldSettings,
} from '../src/utils/writer/worldGeneration'

const fixedNow = '2026-01-02T03:04:05.000Z'

const characters = parseGeneratedCharacters(`前言应被忽略

角色1：
姓名：沈砚
角色：反派
性别：男
年龄：31岁
外貌：面色苍白，眉骨有疤
左手常戴一只旧手套
性格：冷静但偏执
背景：来自被焚毁的边城
标签：谋士，旧贵族

角色2:
姓名: 阿宁
角色: 主角
性别: female
年龄: 24
外貌: 黑色短发
性格: 果断
背景: 城防军斥候
标签: 斥候, 主角`, {
  idFactory: index => 900 + index,
  now: () => fixedNow,
})

assert.equal(characters.length, 2)
assert.deepEqual(
  characters.map(character => ({ id: character.id, name: character.name })),
  [{ id: 900, name: '沈砚' }, { id: 901, name: '阿宁' }],
)
assert.equal(characters[0].appearance, '面色苍白，眉骨有疤\n左手常戴一只旧手套')
assert.equal(characters[0].personality, '冷静但偏执')
assert.equal(characters[0].background, '来自被焚毁的边城')
assert.equal(characters[0].role, 'antagonist')
assert.equal(characters[0].gender, 'male')
assert.equal(characters[0].age, 31)
assert.deepEqual(characters[0].tags, ['谋士', '旧贵族'])
assert.equal(characters[0].createdAt, fixedNow)
assert.equal(characters[1].role, 'protagonist')
assert.equal(characters[1].gender, 'female')
console.log('✓ 角色字段逐行解析，中文外貌/性格/背景不会被字段名字符截断')

const repeatedNames = parseGeneratedCharacters(`姓名：顾遥
外貌：银灰长发
性格：沉静

姓名: 陆野
appearance: 右眼有一道浅疤
personality: 坦率`, { idFactory: index => 1000 + index })
assert.deepEqual(repeatedNames.map(character => character.name), ['顾遥', '陆野'])
assert.equal(repeatedNames[1].appearance, '右眼有一道浅疤')
console.log('✓ 重复姓名与中英文冒号可稳定分段')

const repeatedTitles = parseGeneratedWorldSettings(`以下是世界观设定：
标题：雾港
类型：地理环境
描述：港口每1.5小时退潮一次。
退潮时走私者可以穿过礁洞。
1. 船主必须先向灯塔缴费。

标题：司灯议会
类型：政治势力
描述：议会垄断灯油，并向船主征税。`, {
  idFactory: index => 2000 + index,
  now: () => fixedNow,
})

assert.equal(repeatedTitles.length, 2)
assert.deepEqual(repeatedTitles.map(setting => setting.title), ['雾港', '司灯议会'])
assert.equal(
  repeatedTitles[0].description,
  '港口每1.5小时退潮一次。\n退潮时走私者可以穿过礁洞。\n1. 船主必须先向灯塔缴费。',
)
assert.match(repeatedTitles[0].description ?? '', /1\. 船主必须先向灯塔缴费/)
assert.equal(repeatedTitles[0].type, '地理环境')
assert.equal(repeatedTitles[0].category, 'geography')
assert.equal(repeatedTitles[1].category, 'politics')
assert.equal(repeatedTitles[0].id, 2000)
assert.equal(repeatedTitles[1].createdAt, fixedNow)
console.log('✓ 连续“标题”设定保留首项，并同步保存中文 type 与英文 category')

const numberedSettings = parseGeneratedWorldSettings(`1. 潮汐契约
类型：魔法体系
描述：施法需要支付1.5枚银币，不能因此误分段。
规则的第二行仍属于描述。
2. 旧历断层
类型：历史背景
描述：王朝在三百年前改历。`, { idFactory: index => 3000 + index })

assert.equal(numberedSettings.length, 2)
assert.equal(numberedSettings[0].title, '潮汐契约')
assert.match(numberedSettings[0].description ?? '', /1\.5枚银币/)
assert.equal(numberedSettings[0].category, 'magic')
assert.equal(numberedSettings[1].title, '旧历断层')
assert.equal(numberedSettings[1].category, 'history')
console.log('✓ 仅行首完整编号触发分段，描述中的小数保持完整')

const standardSettings = parseGeneratedWorldSettings(`设定1:
标题: 浮空城
类型: 科技水平
描述: 反重力核心每年停机七天。

设定2：
标题：北境公国
类型：国家制度
描述：领主由行会轮选。`)
assert.equal(standardSettings.length, 2)
assert.deepEqual(standardSettings.map(setting => setting.category), ['setting', 'politics'])
console.log('✓ 标准“设定N”格式兼容中英文冒号')

assert.deepEqual(
  ['地理环境', '历史背景', '魔法体系', '政治势力', '文化社会', 'technology']
    .map(normalizeWorldSettingCategory),
  ['geography', 'history', 'magic', 'politics', 'setting', 'setting'],
)
assert.deepEqual(parseGeneratedCharacters('   '), [])
assert.deepEqual(parseGeneratedWorldSettings('\n'), [])

const unstructuredSetting = parseGeneratedWorldSettings(
  '这是一段超过五十个字符且没有任何字段标签的世界观说明，它应当完整保留为描述，而不是因为无法提取短标题而被解析器丢弃。',
)
assert.equal(unstructuredSetting[0].title, '世界观设定1')
assert.match(unstructuredSetting[0].description ?? '', /完整保留为描述/)
console.log('✓ 世界观中文类型归一化及空输入行为稳定')

console.log('\n=== WRITER MATERIAL PARSER TESTS PASSED ===')
