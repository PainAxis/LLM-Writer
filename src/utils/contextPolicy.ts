import { DEFAULT_CONTEXT_POLICY } from './contextCompactor'
import type { AssistantInfo, ContextPolicy } from '@/types/api'

/** Tolerate partial legacy data without sharing mutable policy objects. */
export function normalizeContextPolicy(value: unknown): ContextPolicy {
  const data = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const integer = (key: keyof ContextPolicy, maximum: number, minimum = 0): number => {
    const number = data[key]
    return typeof number === 'number' && Number.isFinite(number) && number >= minimum
      ? Math.min(maximum, Math.floor(number))
      : (DEFAULT_CONTEXT_POLICY[key] as number)
  }
  return {
    maxTokens: integer('maxTokens', 1_000_000),
    maxTurns: integer('maxTurns', 500),
    retainTurns: integer('retainTurns', 500),
    summaryThreshold: integer('summaryThreshold', 100, 1),
    strategy: data.strategy === 'summary' ? 'summary' : 'truncation',
  }
}

/** Legacy assistants had an unused policy field; only explicit custom mode activates it. */
export function resolveAssistantContextPolicy(
  assistant: Pick<AssistantInfo, 'contextPolicyMode' | 'contextPolicy'> | null | undefined,
  globalPolicy: ContextPolicy
): ContextPolicy {
  return normalizeContextPolicy(
    assistant?.contextPolicyMode === 'custom' ? assistant.contextPolicy : globalPolicy
  )
}
