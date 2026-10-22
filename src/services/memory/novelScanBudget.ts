import { NOVEL_SCAN_DEFAULT_ALLOCATION, NOVEL_SCAN_HARD_ALLOCATION, NOVEL_SCAN_LIMITS as L,
  type NovelScanAllocation, type NovelScanGrant, type NovelScanIdentity, type NovelScanLedger } from '../../types/memoryNovelScan'
import { novelFail, type NovelScanWirePrompt } from './novelScanProtocol'
export const NOVEL_ALLOCATION_KEYS = ['attempts', 'activeMs', 'inputChars', 'inputBytes', 'outputTokens', 'responseBytes'] as const
const zero = (): NovelScanAllocation => ({ attempts: 0, activeMs: 0, inputChars: 0, inputBytes: 0, outputTokens: 0, responseBytes: 0 })
export function validateNovelAllocation(value: NovelScanAllocation, positive: boolean): NovelScanAllocation {
  if (!value || Object.keys(value).length !== NOVEL_ALLOCATION_KEYS.length || NOVEL_ALLOCATION_KEYS.some(key =>
    !Number.isSafeInteger(value[key]) || value[key] < (positive ? 1 : 0) || value[key] > NOVEL_SCAN_HARD_ALLOCATION[key])) novelFail('invalid_input')
  const normalized = zero()
  for (const key of NOVEL_ALLOCATION_KEYS) normalized[key] = value[key]
  return normalized
}
export class NovelScanBudget {
  readonly ledger: NovelScanLedger
  private grants = new Map<string, string>()
  private activeStarted: number | null = null
  private activeUsed = 0
  constructor(allocation: NovelScanAllocation = { ...NOVEL_SCAN_DEFAULT_ALLOCATION }) {
    this.ledger = { authorized: validateNovelAllocation(allocation, true), used: zero(), observedResponseBytes: 0, attemptedSourceChars: 0, guardMs: 0, providerMs: 0, preparationMs: 0, reviewMs: 0 }
  }
  start() { if (this.activeStarted === null) this.activeStarted = performance.now() }
  charge() {
    if (this.activeStarted !== null) {
      const now = performance.now(); this.activeUsed += Math.max(0, now - this.activeStarted); this.activeStarted = now
      this.ledger.used.activeMs = Math.ceil(this.activeUsed)
    }
  }
  stop() { this.charge(); this.activeStarted = null }
  remainingMs() { this.charge(); return this.ledger.authorized.activeMs - this.ledger.used.activeMs }
  check() { if (this.remainingMs() <= 0) novelFail('budget') }
  canDispatch(prompt: NovelScanWirePrompt) {
    this.check()
    const costs = { attempts: 1, inputChars: prompt.inputChars, inputBytes: prompt.inputBytes, outputTokens: L.outputTokens, responseBytes: L.responseBytes }
    for (const key of ['attempts', 'inputChars', 'inputBytes', 'outputTokens', 'responseBytes'] as const)
      if (this.ledger.used[key] + costs[key] > this.ledger.authorized[key]) novelFail('budget')
  }
  reserve(prompt: NovelScanWirePrompt) {
    this.canDispatch(prompt)
    this.ledger.used.attempts++; this.ledger.used.inputChars += prompt.inputChars; this.ledger.used.inputBytes += prompt.inputBytes
    this.ledger.used.outputTokens += L.outputTokens; this.ledger.used.responseBytes += L.responseBytes; this.ledger.attemptedSourceChars += prompt.sourceChars
  }
  grant(grant: NovelScanGrant, identity: NovelScanIdentity) {
    if (grant.campaignId !== identity.campaignId || grant.segmentId !== identity.segmentId || grant.generation !== identity.generation
      || typeof grant.grantId !== 'string' || !grant.grantId.length || grant.grantId.length > 128) novelFail('stale_handle')
    const add = validateNovelAllocation(grant.add, false), serialized = JSON.stringify(add), previous = this.grants.get(grant.grantId)
    if (previous !== undefined) { if (previous !== serialized) novelFail('invalid_decision'); return }
    if (this.grants.size >= 4_096) novelFail('invalid_decision')
    const next = { ...this.ledger.authorized }
    for (const key of NOVEL_ALLOCATION_KEYS) {
      next[key] += add[key]
      if (!Number.isSafeInteger(next[key]) || next[key] > NOVEL_SCAN_HARD_ALLOCATION[key]) novelFail('invalid_decision')
    }
    this.ledger.authorized = next; this.grants.set(grant.grantId, serialized)
  }
}
