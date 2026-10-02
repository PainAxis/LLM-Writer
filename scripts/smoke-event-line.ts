/**
 * 事件线纯函数冒烟测试（无需浏览器）：
 * 覆盖 章节引用迁移（标题→章号 / 章号保留 / 无法匹配保留 / 空值）。
 * 运行：npx tsx scripts/smoke-event-line.ts
 */
import assert from 'node:assert'
import { migrateEventChapters, remapEventChapters } from '../src/utils/eventLine'

const chapters = [{ title: '初入宗门' }, { title: '剑冢奇遇' }, { title: '第三幕' }]

// ---- 测试 1：标题引用迁移为章号 ----
const events = [
  { title: 'A', chapter: '初入宗门' },
  { title: 'B', chapter: '剑冢奇遇' },
  { title: 'C', chapter: '第三幕' },
]
assert.strictEqual(migrateEventChapters(events, chapters), true, '有可迁移项应返回 true')
assert.deepStrictEqual(
  events.map((event) => event.chapter),
  ['1', '2', '3'],
  '标题应全部换算为章号字符串',
)
console.log('✓ 测试1 通过：标题引用迁移')

// ---- 测试 2：章号/空值/无法匹配的保留 ----
const mixed = [
  { title: '已是章号', chapter: '2' },
  { title: '空章节', chapter: '' },
  { title: '无 chapter 字段' },
  { title: '标题对不上', chapter: '不存在的章节' },
  { title: '数字别的格式', chapter: '第2章' },
]
assert.strictEqual(migrateEventChapters(mixed, chapters), false, '无可迁移项应返回 false')
assert.strictEqual(mixed[0].chapter, '2', '纯章号应原样保留')
assert.strictEqual(mixed[1].chapter, '', '空值应保留')
assert.strictEqual(mixed[2].chapter, undefined, '缺失字段应保留')
assert.strictEqual(mixed[3].chapter, '不存在的章节', '匹配不到的标题应保留原样（不臆测）')
assert.strictEqual(mixed[4].chapter, '第2章', '「第2章」类文本 parseInt=2 但字符串不等，应保留（避免误迁移）')
console.log('✓ 测试2 通过：章号/空值/无法匹配保留')

// ---- 测试 3：原地修改且不新增字段 ----
const single = [{ title: 'X', chapter: '剑冢奇遇', extra: 1 }]
migrateEventChapters(single, chapters)
assert.strictEqual(single[0].chapter, '2')
assert.strictEqual(single[0].extra, 1)
assert.strictEqual(Object.keys(single[0]).length, 3, '不应新增字段')
console.log('✓ 测试3 通过：原地修改不引入副作用')

const originalChapters = [
  { id: 11, title: '甲章' }, { id: 12, title: '乙章' }, { id: 13, title: '丙章' },
]
const linked = [
  { id: 1, chapter: '1', extension: { keep: true } },
  { id: 2, chapter: 2 },
  { id: 3, chapter: '丙章' },
  { id: 4, chapter: '' },
  { id: 5 },
  { id: 6, chapter: '未知章节' },
  { id: 7, chapter: '99' },
]
const snapshot = JSON.stringify(linked)
const reordered = remapEventChapters(linked, originalChapters, [originalChapters[2], originalChapters[0], originalChapters[1]])
assert.deepStrictEqual(reordered.map(event => event.chapter), ['2', 3, '1', '', undefined, '未知章节', '99'])
assert.deepStrictEqual(reordered[0].extension, { keep: true })
const deleted = remapEventChapters(linked, originalChapters, [originalChapters[1], originalChapters[2]])
assert.deepStrictEqual(deleted.map(event => event.chapter), ['', 1, '2', '', undefined, '未知章节', '99'])
const added = remapEventChapters(linked, originalChapters, [{ id: 14, title: '插入章节' }, ...originalChapters])
assert.deepStrictEqual(added.map(event => event.chapter), ['2', 3, '4', '', undefined, '未知章节', '99'])
assert.equal(JSON.stringify(linked), snapshot, '映射不能污染原事件，失败时可完整保留原快照')
assert.deepStrictEqual(remapEventChapters(deleted, [originalChapters[1], originalChapters[2]], [originalChapters[1], originalChapters[2]]), deleted, '同一候选重复保存不能二次移动章号')
assert.deepStrictEqual(remapEventChapters([{ chapter: '99' }], [{ id: 1, title: '99' }], []), [{ chapter: '99' }], '越界旧章号不能猜成同名标题后删除')
console.log('✓ 测试4 通过：增删重排按章节身份维护事件，保留旧格式及扩展字段')

console.log('\n=== ALL EVENT-LINE TESTS PASSED ===')
