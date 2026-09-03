/**
 * 语料库检索推荐纯函数冒烟测试（无需浏览器与网络）：
 * 覆盖 关键词提取 / 重合度评分与 top-K / 预算注入与截断。
 * 运行：npx tsx scripts/smoke-corpus-retrieval.ts
 */
import assert from 'node:assert'
import {
  buildCorpusInjection,
  extractKeywords,
  recommendCorpus,
} from '../src/utils/corpusRetrieval'

// ---- 测试 1：关键词提取（2 字窗口 / 去重 / 停用词） ----
const keywords = extractKeywords('剑修凌云在青云宗修炼剑道，剑道领悟极高。他修炼刻苦', 12)
assert.ok(keywords.includes('剑修'), '应提取出领域词')
assert.ok(keywords.includes('青云'), '应提取出名词窗口')
assert.ok(!keywords.includes('他'), '单字不应出现（窗口为 2 字）')
assert.ok(!keywords.includes('我们'), '停用词应被过滤')
assert.ok(new Set(keywords).size === keywords.length, '应去重')
assert.ok(keywords.every(k => k.length >= 2), '关键词长度应 ≥ 2')
console.log('✓ 测试1 通过：关键词提取')

// ---- 测试 2：重合度评分与 top-K（bigram 交集、零重合排除） ----
const corpus = [
  { id: 1, title: '剑道设定', content: '剑修以剑入道，剑气纵横，凌云的剑名为听雨' },
  { id: 2, title: '都市生活', content: '写字楼、地铁、咖啡与加班的都市日常' },
  { id: 3, title: '宗门设定', content: '青云宗分内门外门，凌云是内门弟子，修炼剑道' },
]
const recs = recommendCorpus(corpus, '凌云在青云宗修炼剑道，剑气大涨', { topK: 5 })
assert.ok(recs.length >= 2, '应至少命中 2 条语料')
assert.strictEqual(recs[0].item.id, 3, '宗门设定重合度最高（青云宗/凌云/修炼剑道）')
assert.ok(recs[0].score > recs[1].score, '结果应按重合度降序')
assert.ok(!recs.some(rec => rec.item.id === 2), '都市生活零重合应被排除')
assert.strictEqual(recommendCorpus(corpus, '凌云在青云宗修炼剑道', { topK: 1 }).length, 1, 'topK 应生效')
assert.deepStrictEqual(recommendCorpus(corpus, '地铁', {}).length, 0, '低于 minScore 的巧合重合应被过滤')
console.log('✓ 测试2 通过：重合度评分与 top-K')

// ---- 测试 3：注入组装与预算约束（整条优先，单条超预算才截断） ----
const longContent = '字'.repeat(3000)
const injection = buildCorpusInjection(
  [
    { title: 'A', content: '短内容A' },
    { title: 'B', content: longContent },
  ],
  2000,
)
assert.ok(injection.text.length <= 2000, '注入文本应不超过预算')
assert.strictEqual(injection.usedCount, 1, '第二条放不下应整体丢弃')
assert.strictEqual(injection.truncated, true, '丢弃时应标记截断')
const clampSingle = buildCorpusInjection([{ title: 'C', content: longContent }], 2000)
assert.ok(clampSingle.text.length <= 2000, '单条超预算应截断塞满')
assert.strictEqual(clampSingle.usedCount, 1, '截断后仍应使用该条')
assert.ok(clampSingle.truncated, '截断应被标记')
const overflow = buildCorpusInjection(
  [
    { title: 'A', content: 'x'.repeat(1500) },
    { title: 'B', content: 'y'.repeat(1500) },
  ],
  2000,
)
assert.strictEqual(overflow.usedCount, 1, '第二条放不下时应丢弃')
assert.ok(overflow.truncated, '丢弃时应标记截断')
console.log('✓ 测试3 通过：注入预算与截断')

// ---- 测试 4：空输入兜底 ----
assert.deepStrictEqual(extractKeywords(''), [], '空文本应返回空关键词')
assert.deepStrictEqual(recommendCorpus([], '任意', {}), [], '空语料库应返回空推荐')
assert.strictEqual(buildCorpusInjection([], 1000).text, '', '空语料应返回空注入文本')
console.log('✓ 测试4 通过：空输入兜底')

console.log('\n=== ALL CORPUS-RETRIEVAL TESTS PASSED ===')
