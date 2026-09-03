/**
 * 上下文压缩纯函数集（无副作用、无 AI 调用，可独立单测）。
 * 策略语义（与产品讨论定稿一致）：
 * - truncation：硬截断滑窗，确定性丢弃超预算的最早条目
 * - summary：滚动摘要，压缩只作用于"发给 AI 的上下文"，
 *   本地持久化与界面展示仍保存全量原文（摘要 ≠ 删除）
 * - 有效预算 = min(maxTokens, maxTurns)，0 = 不限
 * - 触发条件 = 当前用量 > 有效预算 × summaryThreshold
 */

import { estimateTokens } from './tokenBudget'
import type { ContextPolicy } from '@/types/api'

/** 全局默认上下文容量策略：默认保守值，显式设置才放开 */
export const DEFAULT_CONTEXT_POLICY: ContextPolicy = {
  maxTokens: 8000,
  maxTurns: 30,
  strategy: 'truncation',
  summaryThreshold: 75,
  retainTurns: 6,
}

export interface CompactorEntry {
  isUser: boolean
  content: string
}

export interface ContextEvaluation {
  currentTokens: number
  currentTurns: number
  /** 有效预算（token）；0 = 不限 */
  budgetTokens: number
  /** 有效预算（条数）；0 = 不限 */
  budgetTurns: number
  /** 是否达到压缩触发阈值 */
  overThreshold: boolean
  /** 是否超出硬预算（发送后可能被服务商拒绝） */
  overBudget: boolean
}

export interface FoldResult {
  /** 保留原文的最近条目 */
  kept: CompactorEntry[]
  /** 被折叠进摘要的较早条目 */
  folded: CompactorEntry[]
}

const clampPositive = (value: number): number => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)

/** 有效预算（token 维度）：0 = 不限 */
export function effectiveBudgetTokens(policy: ContextPolicy): number {
  return clampPositive(policy.maxTokens)
}

/** 有效预算（条数维度） */
export function effectiveBudgetTurns(policy: ContextPolicy): number {
  return clampPositive(policy.maxTurns)
}

/** 评估当前上下文用量（含即将发送的新消息） */
export function evaluateContext(entries: CompactorEntry[], policy: ContextPolicy): ContextEvaluation {
  const currentTokens = estimateTokens(entries.map((entry) => entry.content).join('\n'))
  const currentTurns = entries.length
  const budgetTokens = effectiveBudgetTokens(policy)
  const budgetTurns = effectiveBudgetTurns(policy)
  const ratio = clampPositive(policy.summaryThreshold) / 100

  const tokenRatio = budgetTokens > 0 ? currentTokens / budgetTokens : 0
  const turnRatio = budgetTurns > 0 ? currentTurns / budgetTurns : 0

  return {
    currentTokens,
    currentTurns,
    budgetTokens,
    budgetTurns,
    overThreshold: Math.max(tokenRatio, turnRatio) >= ratio,
    overBudget: (budgetTokens > 0 && currentTokens > budgetTokens) || (budgetTurns > 0 && currentTurns > budgetTurns),
  }
}

/** 按保留轮数切分：最近 retainTurns 条保留原文，其余折叠 */
export function foldEntries(entries: CompactorEntry[], retainTurns: number): FoldResult {
  const retain = clampPositive(retainTurns)
  if (entries.length <= retain) {
    return { kept: [...entries], folded: [] }
  }
  return {
    kept: entries.slice(entries.length - retain),
    folded: entries.slice(0, entries.length - retain),
  }
}

/** truncation 滑窗：从尾部保留不超预算的条目（预算为 0 的维度不限制） */
export function keptWithinBudget(entries: CompactorEntry[], policy: ContextPolicy): CompactorEntry[] {
  const budgetTokens = effectiveBudgetTokens(policy)
  const budgetTurns = effectiveBudgetTurns(policy)

  if ((budgetTokens <= 0 && budgetTurns <= 0) || entries.length === 0) {
    return [...entries]
  }

  const kept: CompactorEntry[] = []
  let tokens = 0
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    const entryTokens = estimateTokens(entry.content)
    if (kept.length > 0 && budgetTokens > 0 && tokens + entryTokens > budgetTokens) {
      break
    }
    if (kept.length > 0 && budgetTurns > 0 && kept.length >= budgetTurns) {
      break
    }
    kept.unshift(entry)
    tokens += entryTokens
  }
  return kept
}

/** 增量摘要提示词：新摘要 = 旧摘要 + 本次折叠条目 */
export function buildSummaryPrompt(previousSummary: string, folded: CompactorEntry[]): string {
  const transcript = folded
    .map((entry) => `${entry.isUser ? '用户' : '助手'}：${entry.content}`)
    .join('\n')

  const previous = previousSummary.trim()
  return `请将以下对话内容合并${previous ? '到既有摘要' : ''}中，生成一份连贯的对话摘要。摘要需保留关键事实、决定与未尽事项，控制在 500 字以内，直接输出摘要内容。

${previous ? `【既有摘要】\n${previous}\n\n` : ''}【新增对话】
${transcript}`
}

/** 组装发送给 AI 的 system：人设 + 摘要前置说明 */
export function composeSystemWithSummary(persona: string, summary: string): string {
  const trimmedSummary = summary.trim()
  const personaPart = persona.trim()
  if (!trimmedSummary) return personaPart
  const summaryPart = `【此前对话摘要】\n${trimmedSummary}`
  return personaPart ? `${personaPart}\n\n${summaryPart}` : summaryPart
}
