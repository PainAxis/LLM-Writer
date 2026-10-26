/** Closed observations for the explicitly new session contract, not a v1 speedup. */
import type { BodyProducerVerificationEvent, ProducerVerificationProgress } from '../../src/types/bodyProducer'
export const PRODUCER_VERIFICATION_CONTRACT = Object.freeze({
  protocol: 'producer-verification-session-v1', legacyV2ReadLimitMs: 3000, coldSessionLimitMs: 10_000,
  metadataOwnerLimitMs: 10_000, invocationOwnerLimitMs: 60_000, actualIoLimitMs: 3000, warmOperationLimitMs: 3000,
  synchronousSegmentLimitMs: 250, operationsPerAdvance: 8, hostYieldTargetMs: 50,
  retainedBytesLimit: 67_108_864, retainedEntriesLimit: 8193, activePayloadLimit: 512,
  oldMonolithicThreeSecondGate: 'not_awarded', performanceClaim: 'bounded_interruptible_completion_not_speedup',
} as const)
export const VERIFICATION_STAT_KEYS = ['sessionsStarted', 'sessionsCompleted', 'sessionsFailed', 'sessionsCancelled', 'sessionsDisposed', 'activeSessions', 'sessionMaxMs', 'rawIoCalls', 'rawIoMaxMs', 'casCalls', 'casMaxMs', 'advances', 'maxOperationsPerAdvance', 'hostYields', 'synchronousSegmentMaxMs', 'finalFencePasses', 'finalFenceMaxMs', 'finalFenceExpectedRecords', 'finalFenceObservedRecords', 'retainedBytes', 'retainedEntries', 'activePayloadRecords', 'peakRetainedBytes', 'peakRetainedEntries', 'peakActivePayloadRecords'] as const
export const OWNER_STAT_KEYS = ['metadataOwnersStarted', 'invocationOwnersStarted', 'ownersCompleted', 'ownersRefused', 'ownersCancelled', 'ownersExpired', 'activeOwners', 'peakActiveOwners', 'maxMetadataOwnerMs', 'maxInvocationOwnerMs', 'deadlineRefusals', 'lateResultRefusals'] as const
export type VerificationNumbers = Record<typeof VERIFICATION_STAT_KEYS[number], number>
export type OwnerNumbers = Record<typeof OWNER_STAT_KEYS[number], number>
export interface ProducerVerificationObservation {
  status: 'not_run' | 'collected'
  stats: VerificationNumbers
  owners: OwnerNumbers
  last: { status: BodyProducerVerificationEvent['status']; progress: ProducerVerificationProgress | null } | null
}
export function emptyProducerVerification(): ProducerVerificationObservation {
  return { status: 'not_run', stats: Object.fromEntries(VERIFICATION_STAT_KEYS.map(key => [key, 0])) as VerificationNumbers,
    owners: Object.fromEntries(OWNER_STAT_KEYS.map(key => [key, 0])) as OwnerNumbers, last: null }
}
const maximum = (key: string) => key.includes('Max') || key.startsWith('max') || key.startsWith('peak')
/** Merge independent repository/engine observations, never consecutive snapshots of one. */
export function mergeVerificationNumbers(values: readonly VerificationNumbers[]): VerificationNumbers {
  return Object.fromEntries(VERIFICATION_STAT_KEYS.map(key => [key, maximum(key) ? Math.max(0, ...values.map(value => value[key])) : values.reduce((sum, value) => sum + value[key], 0)])) as VerificationNumbers
}
export function mergeOwnerNumbers(values: readonly OwnerNumbers[]): OwnerNumbers {
  return Object.fromEntries(OWNER_STAT_KEYS.map(key => [key, maximum(key) ? Math.max(0, ...values.map(value => value[key])) : values.reduce((sum, value) => sum + value[key], 0)])) as OwnerNumbers
}
function verify(value: unknown): asserts value { if (!value) throw new Error('producer_report_invalid') }
function keys(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> { verify(value !== null && typeof value === 'object' && !Array.isArray(value)); verify(Object.keys(value).length === names.length && names.every(key => Object.hasOwn(value, key))) }
function integer(value: unknown) { verify(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) }
export function validateProducerVerification(value: unknown, passed: boolean, foreign = false): asserts value is ProducerVerificationObservation {
  keys(value, ['status', 'stats', 'owners', 'last']); verify(['not_run', 'collected'].includes(String(value.status)))
  keys(value.stats, VERIFICATION_STAT_KEYS); VERIFICATION_STAT_KEYS.forEach(key => integer((value.stats as Record<string, unknown>)[key]))
  keys(value.owners, OWNER_STAT_KEYS); OWNER_STAT_KEYS.forEach(key => integer((value.owners as Record<string, unknown>)[key]))
  if (value.last !== null) {
    keys(value.last, ['status', 'progress']); verify(['started', 'progress', 'completed', 'failed', 'cancelled'].includes(String(value.last.status)))
    if (value.last.progress !== null) {
      const progress = value.last.progress; keys(progress, ['purpose', 'stage', 'verifiedOperations', 'verifiedRecords', 'capturedBytes', 'capturedEntries', 'totalOperations'])
      verify(['adoption_v2', 'current_v3'].includes(String(progress.purpose)) && ['discovery', 'origin_replay', 'tail_replay', 'final_fence'].includes(String(progress.stage)))
      for (const key of ['verifiedOperations', 'verifiedRecords', 'capturedBytes', 'capturedEntries']) integer(progress[key])
      if (progress.totalOperations !== null) { integer(progress.totalOperations); verify(Number(progress.verifiedOperations) <= Number(progress.totalOperations)) }
      verify(Number(progress.capturedBytes) <= 67_108_864 && Number(progress.capturedEntries) <= 8193)
    }
  }
  const s = value.stats as VerificationNumbers, o = value.owners as OwnerNumbers
  verify(o.metadataOwnersStarted + o.invocationOwnersStarted === o.ownersCompleted + o.ownersRefused + o.ownersCancelled + o.ownersExpired + o.activeOwners)
  verify(s.sessionsStarted === s.sessionsCompleted + s.sessionsFailed + s.sessionsCancelled + s.activeSessions)
  verify(s.sessionsDisposed === s.sessionsCompleted + s.sessionsFailed + s.sessionsCancelled)
  verify(s.finalFenceObservedRecords <= s.finalFenceExpectedRecords && s.finalFencePasses <= s.sessionsCompleted)
  if (foreign || value.status === 'not_run') verify(value.status === 'not_run' && value.last === null && VERIFICATION_STAT_KEYS.every(key => s[key] === 0) && OWNER_STAT_KEYS.every(key => o[key] === 0))
  if (passed) {
    verify(value.status === 'collected' && s.sessionsStarted > 0 && s.sessionsFailed === 0 && s.sessionsCancelled === 0 && s.activeSessions === 0)
    verify(s.sessionMaxMs > 0 && s.sessionMaxMs < 10_000 && s.rawIoCalls > 0 && s.rawIoMaxMs < 3000 && s.casCalls > 0 && s.casMaxMs < 3000)
    verify(s.advances > 0 && s.maxOperationsPerAdvance > 0 && s.maxOperationsPerAdvance <= 8 && s.hostYields > 0 && s.synchronousSegmentMaxMs > 0 && s.synchronousSegmentMaxMs <= 250)
    // Happy N60/adoption/restart profiles always select existing sources; a
    // completed legacy-null inspection cannot stand in for any of their fences.
    verify(s.finalFencePasses === s.sessionsCompleted && s.finalFencePasses > 0 && s.finalFenceMaxMs > 0 && s.finalFenceMaxMs < 10_000 && s.finalFenceExpectedRecords > 0 && s.finalFenceObservedRecords === s.finalFenceExpectedRecords)
    verify(s.retainedBytes === 0 && s.retainedEntries === 0 && s.activePayloadRecords === 0 && s.peakRetainedBytes > 0 && s.peakRetainedBytes <= 67_108_864 && s.peakRetainedEntries > 0 && s.peakRetainedEntries <= 8193 && s.peakActivePayloadRecords > 0 && s.peakActivePayloadRecords <= 512)
    verify(o.metadataOwnersStarted > 0 && o.invocationOwnersStarted > 0 && o.activeOwners === 0 && o.ownersExpired === 0 && o.deadlineRefusals === 0 && o.lateResultRefusals === 0)
    verify(o.maxMetadataOwnerMs > 0 && o.maxMetadataOwnerMs < 10_000 && o.maxInvocationOwnerMs > 0 && o.maxInvocationOwnerMs < 60_000)
  }
}
