/**
 * 上下文压缩纯函数冒烟测试（无需浏览器与网络）：
 * 覆盖 预算评估 / 硬截断滑窗 / 摘要折叠 / 增量摘要提示词 / system 组装。
 * 运行：npx tsx scripts/smoke-context-compactor.ts
 */
import assert from 'node:assert'
import {
  buildSummaryPrompt,
  composeSystemWithSummary,
  DEFAULT_CONTEXT_POLICY,
  evaluateContext,
  foldEntries,
  keptWithinBudget,
} from '../src/utils/contextCompactor'
import type { CompactorEntry } from '../src/utils/contextCompactor'
import type { ContextPolicy } from '../src/types/api'

function policy(overrides: Partial<ContextPolicy>): ContextPolicy {
  return { ...DEFAULT_CONTEXT_POLICY, ...overrides }
}

function entries(count: number, content = '这是一条测试消息内容'): CompactorEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    isUser: index % 2 === 0,
    content: content + (index > 0 ? String(index) : ''),
  }))
}

// ---- 测试 1：evaluateContext 阈值与硬预算判定 ----
const p1 = policy({ maxTokens: 100, maxTurns: 10, summaryThreshold: 75 })
const small = evaluateContext(entries(2), p1)
assert.strictEqual(small.overThreshold, false, '小上下文不应触发阈值')
const nearLimit = evaluateContext(entries(8, '这是一条测试消息内容这是另一段较长的内容用来撑高token数量'.repeat(2)), p1)
assert.ok(nearLimit.currentTokens > 0, 'token 估算应大于 0')
const turnLimit = policy({ maxTokens: 0, maxTurns: 4, summaryThreshold: 75 })
const atTurns = evaluateContext(entries(4), turnLimit)
assert.strictEqual(atTurns.overThreshold, true, '条数达到 100% 预算应触发阈值')
assert.strictEqual(atTurns.overBudget, false, '恰好等于预算不算超限')
const overTurns = evaluateContext(entries(5), turnLimit)
assert.strictEqual(overTurns.overBudget, true, '条数超预算应标记 overBudget')
console.log('✓ 测试1 通过：evaluateContext 阈值与预算判定')

// ---- 测试 2：不限预算（0 = 不限） ----
const unlimited = evaluateContext(entries(200), policy({ maxTokens: 0, maxTurns: 0 }))
assert.strictEqual(unlimited.overBudget, false, '0 预算应视为不限')
assert.strictEqual(unlimited.overThreshold, false, '不限时不应触发阈值')
console.log('✓ 测试2 通过：0 值表示不限')

// ---- 测试 3：foldEntries 保留最近 N 条 ----
const fold = foldEntries(entries(10, '内容'), 3)
assert.strictEqual(fold.kept.length, 3, '应保留最近 3 条')
assert.strictEqual(fold.folded.length, 7, '其余 7 条应折叠')
assert.ok(fold.kept[2].content.includes('9'), '保留的应是最后 3 条（末条下标 9）')
const foldSmall = foldEntries(entries(2, '内容'), 6)
assert.strictEqual(foldSmall.folded.length, 0, '不足保留数时不应折叠')
console.log('✓ 测试3 通过：foldEntries 折叠/保留切分')

// ---- 测试 4：keptWithinBudget 硬截断滑窗 ----
const longContent = '字'.repeat(500)
const windowed = keptWithinBudget(entries(50, longContent), policy({ maxTokens: 3000, maxTurns: 0 }))
assert.ok(windowed.length >= 1, '至少保留 1 条')
assert.ok(windowed.length < 50, '超预算时应丢弃较早条目')
assert.ok(windowed[0].content.includes(longContent), '保留的应是最近的条目')
const turnWindow = keptWithinBudget(entries(30, '短'), policy({ maxTokens: 0, maxTurns: 5 }))
assert.strictEqual(turnWindow.length, 5, '条数预算应精确截断为最近 5 条')
console.log('✓ 测试4 通过：keptWithinBudget 滑窗')

// ---- 测试 5：增量摘要提示词 ----
const prompt1 = buildSummaryPrompt('', [{ isUser: true, content: '你好' }])
assert.ok(prompt1.includes('你好'), '提示词应包含折叠内容')
const prompt2 = buildSummaryPrompt('旧摘要内容', [{ isUser: false, content: '回复' }])
assert.ok(prompt2.includes('旧摘要内容'), '增量摘要应包含既有摘要')
console.log('✓ 测试5 通过：buildSummaryPrompt 增量组装')

// ---- 测试 6：composeSystemWithSummary ----
assert.strictEqual(composeSystemWithSummary('人设A', ''), '人设A', '无摘要时仅人设')
const composed = composeSystemWithSummary('人设A', '摘要B')
assert.ok(composed.includes('人设A') && composed.includes('摘要B'), '摘要应与人设合并')
assert.ok(composed.indexOf('人设A') < composed.indexOf('摘要B'), '人设在前、摘要在后')
console.log('✓ 测试6 通过：composeSystemWithSummary 组装')

console.log('\n=== ALL COMPACTOR TESTS PASSED ===')
