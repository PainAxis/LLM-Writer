import type { CampaignBudget, CampaignManifest } from '../../types/writerCampaign'

export const CAMPAIGN_BUDGET_KEYS = ['attempts', 'inputBytes', 'inputUtf16', 'outputTokens', 'reasoningTokens', 'responseBytes', 'activeMs', 'storageReservedBytes', 'serializedBytes', 'artifacts', 'operations'] as const
export const CAMPAIGN_REQUEST_ACTIVE_MS = 10_000
export const CAMPAIGN_METADATA_ACTIVE_MS = 10_000
export const CAMPAIGN_RECOVERY_ACTIVE_RESERVE_MS = 160_000
export const CAMPAIGN_MAX_INPUT_BYTES = 65_536
export const CAMPAIGN_MAX_RESPONSE_BYTES = 65_536
export const CAMPAIGN_IO_TIMEOUT_MS = 3_000
export const CAMPAIGN_DISPATCH_TIMEOUT_MS = 5_000

export class CampaignRuntimeError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'CampaignRuntimeError' }
}
export const emptyCampaignBudget = (): CampaignBudget => ({ attempts: 0, inputBytes: 0, inputUtf16: 0, outputTokens: 0, reasoningTokens: 0, responseBytes: 0, activeMs: 0, storageReservedBytes: 0, serializedBytes: 0, artifacts: 0, operations: 0 })
export function checkedCampaignAdd(left: number, right: number): number {
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0 || !Number.isSafeInteger(left + right)) throw new CampaignRuntimeError('budget_invalid')
  return left + right
}
export function reserveCampaignBudget(manifest: CampaignManifest, current: CampaignBudget, delta: CampaignBudget, recovery = false): CampaignBudget {
  const next = emptyCampaignBudget()
  for (const key of CAMPAIGN_BUDGET_KEYS) {
    next[key] = checkedCampaignAdd(current[key], delta[key])
    if (!Number.isSafeInteger(manifest.budget[key]) || manifest.budget[key] < 0 || next[key] > manifest.budget[key]) throw new CampaignRuntimeError('budget_exhausted')
  }
  if (!recovery && next.activeMs > manifest.budget.activeMs - CAMPAIGN_RECOVERY_ACTIVE_RESERVE_MS) throw new CampaignRuntimeError('active_budget_exhausted')
  if (!recovery && next.storageReservedBytes > manifest.budget.serializedBytes - manifest.recoveryReserveBytes) throw new CampaignRuntimeError('storage_budget_exhausted')
  return next
}
/** Reserve before an intent; covers escaped request/response revisions and bounded task-index snapshots. */
export function campaignRequestReservation(inputBytes: number, inputUtf16: number, taskCount: number, responseBytes = CAMPAIGN_MAX_RESPONSE_BYTES): CampaignBudget {
  for (const value of [inputBytes, inputUtf16, taskCount, responseBytes]) if (!Number.isSafeInteger(value) || value < 0) throw new CampaignRuntimeError('budget_invalid')
  if (!taskCount || inputBytes > CAMPAIGN_MAX_INPUT_BYTES || responseBytes > CAMPAIGN_MAX_RESPONSE_BYTES) throw new CampaignRuntimeError('request_too_large')
  const result = emptyCampaignBudget()
  result.attempts = 1
  result.inputBytes = inputBytes
  result.inputUtf16 = inputUtf16
  result.outputTokens = responseBytes
  result.responseBytes = responseBytes
  result.activeMs = CAMPAIGN_REQUEST_ACTIVE_MS
  result.storageReservedBytes = 6 * (16_384 + taskCount * 1024 + inputBytes * 6 + responseBytes * 6)
  if (!Number.isSafeInteger(result.storageReservedBytes)) throw new CampaignRuntimeError('budget_invalid')
  return result
}
export function campaignMetadataReservation(taskCount: number): CampaignBudget {
  const result = emptyCampaignBudget()
  result.activeMs = CAMPAIGN_METADATA_ACTIVE_MS
  result.storageReservedBytes = checkedCampaignAdd(16_384, taskCount * 1024)
  return result
}
export function checkCampaignClock(manifest: CampaignManifest, lastWallTime: number, now: number): void {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(lastWallTime) || now < lastWallTime || now < manifest.createdAt) throw new CampaignRuntimeError('clock_rollback')
  if (now >= manifest.expiresAt) throw new CampaignRuntimeError('deadline')
}
