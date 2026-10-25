/** Frozen synthetic geometry shared by Node atomic IO and real browser IDB.
 * No provider/network requests and no literary/semantic acceptance claims. */
import type { CampaignRepositoryIO, CampaignTaskSpec, CampaignSnapshot } from '../../src/types/writerCampaign'
import { CampaignProtocolError, decodeStorageBytes } from '../../src/services/writerCampaign/protocol'
import { CampaignRuntimeError } from '../../src/services/writerCampaign/budget'
import { createCampaignRepository } from '../../src/services/writerCampaign/store'
import { createOfflineCampaignEngine, createOfflineCampaignManifest, type CampaignRuntimeIdentity, type CampaignTimeoutDiagnostics } from '../../src/services/writerCampaign/engine'

export const CAPACITY_GEOMETRY = Object.freeze({ version: 'synthetic-storage-geometry-60x16667-v1', plannedTasks: 123, plannedBodyTasks: 60, targetBodyScalars: 1_000_000, storageCeilingBytes: 67_108_864, recoveryReserveBytes: 524_288 })
export const CAPACITY_V1_BASELINE = Object.freeze({
  zh: { committedBodyScalars: 200_004, completedTasks: 28, cumulativeWrittenBytes: 6_346_657, permanentStorageReservationBytes: 66_456_411, totalReadBytes: 570_635_858, totalReadCalls: 10_577 },
  en: { committedBodyScalars: 350_007, completedTasks: 46, cumulativeWrittenBytes: 6_618_786, permanentStorageReservationBytes: 65_625_495, totalReadBytes: 997_803_343, totalReadCalls: 26_957 },
})
export const STORAGE_SAFE_CODES = ['budget', 'storage_budget_exhausted', 'budget_exhausted', 'active_budget_exhausted', 'operation_timeout', 'storage_unknown', 'integrity', 'conflict', 'local_stopped', 'profile_failure', 'dispatch_outcome_unknown', 'deadline', 'clock_rollback'] as const
export function safeStorageCode(error: unknown): string {
  const code = typeof error === 'string' ? error : error instanceof CampaignRuntimeError || error instanceof CampaignProtocolError ? error.code : 'profile_failure'
  return STORAGE_SAFE_CODES.includes(code as typeof STORAGE_SAFE_CODES[number]) ? code : 'profile_failure'
}
export function capacityTasks(): CampaignTaskSpec[] {
  const tasks: CampaignTaskSpec[] = [
    { id: 'outline', kind: 'outline', chapterOrdinal: null, dependsOn: [] },
    { id: 'characters', kind: 'character_bible', chapterOrdinal: null, dependsOn: ['outline'] },
    { id: 'details', kind: 'detailed_outline', chapterOrdinal: null, dependsOn: ['outline', 'characters'] },
  ]
  for (let i = 1; i <= 60; i++) tasks.push(
    { id: `outline-${i}`, kind: 'chapter_outline', chapterOrdinal: i, dependsOn: ['details', 'characters'] },
    { id: `body-${i}`, kind: 'chapter_body', chapterOrdinal: i, dependsOn: i === 1 ? [`outline-${i}`] : [`outline-${i}`, `body-${i - 1}`] },
  )
  return tasks
}
export const capacityAtomCount = (ordinal: number): number => ordinal < 60 ? 16_667 : 16_647
export interface StorageObservation {
  cumulativeWrittenBytes: number; committedTransactions: number; liveRecordCount: number
  liveBytesByRecordKind: Record<string, number>; totalReadBytes: number; totalReadCalls: number
  maxReadBatchBytes: number; maxReadBatchKeys: number; peakOutstandingBytes: number; accountingMismatches: number
}
const verify = (value: unknown): void => { if (!value) throw new Error('capacity_verification_failed') }
export async function runCampaignCapacityProfile(language: 'zh' | 'en', identity: CampaignRuntimeIdentity,
  observe: () => StorageObservation, io?: CampaignRepositoryIO, onProgress?: (row: ReturnType<typeof capacityRow>) => Promise<void>) {
  // Omitting io is intentional: browser profiles use the production blobStore implementation.
  const repository = createCampaignRepository(io)
  let calls = 0
  const engine = createOfflineCampaignEngine({ identity, repository, fixture: {
    responseFor(context) {
      return context.task.kind === 'chapter_body' ? (language === 'zh' ? '文' : 'a').repeat(capacityAtomCount(context.task.chapterOrdinal!))
        : `synthetic geometry planning ${context.task.kind} ${context.task.chapterOrdinal ?? 0}`
    },
    responseBytesFor(context) { return context.task.kind === 'chapter_body' ? capacityAtomCount(context.task.chapterOrdinal!) * (language === 'zh' ? 3 : 1) : 512 },
    onDispatch() { calls++ },
  } })
  const manifest = await createOfflineCampaignManifest({ identity, campaignId: `capacity-${language}`, language, tasks: capacityTasks(), fixtureVersion: CAPACITY_GEOMETRY.version })
  const started = performance.now()
  let snapshot = await engine.prepare(manifest), blockerCode: string | null = null, maxStepMs = 0
  const timedStep = async (commandId: string) => {
    const stepStarted = performance.now()
    try { return await engine.step(manifest.campaignId, commandId) }
    finally { maxStepMs = Math.max(maxStepMs, Math.round(performance.now() - stepStarted)) }
  }
  const progress = async () => { if (onProgress) await onProgress(capacityRow(language, snapshot, observe(), calls, io === undefined, engine.readTimeoutDiagnostics(), 'running', null, Math.round(performance.now() - started), maxStepMs)) }
  await progress()
  try {
    for (let attempt = 0; attempt < manifest.tasks.length && !['blocked', 'paused', 'cancelled', 'completed'].includes(snapshot.head.status); attempt++) {
      try { snapshot = await timedStep(`profile-${attempt}`) }
      catch (error) { blockerCode = safeStorageCode(error); snapshot = (await repository.read(manifest.campaignId))!; break }
      await progress()
    }
  } finally { engine.dispose() }
  const executionMs = Math.round(performance.now() - started)
  blockerCode ??= snapshot.checkpoint.reason === null ? null : safeStorageCode(snapshot.checkpoint.reason)
  const before = observe(), coldStart = performance.now()
  const restored = await createCampaignRepository(io).read(manifest.campaignId)
  const coldRepositoryReadMs = Math.round(performance.now() - coldStart), metrics = observe()
  verify(restored && restored.head.checkpointHash === snapshot.head.checkpointHash)
  const storage = snapshot.checkpoint.storage
  const writtenBytes = decodeStorageBytes(storage.writtenBytes), outstandingBytes = decodeStorageBytes(storage.outstandingBytes)
  const allocatedBytes = decodeStorageBytes(storage.allocatedBytes), consumedBytes = decodeStorageBytes(storage.allocationConsumedBytes), releasedBytes = decodeStorageBytes(storage.releasedBytes)
  const recoveryRemainingBytes = decodeStorageBytes(storage.recoveryRemainingBytes), committedTasks = snapshot.checkpoint.tasks.filter(task => task.status === 'committed').length
  verify(writtenBytes === metrics.cumulativeWrittenBytes && metrics.accountingMismatches === 0)
  verify(allocatedBytes - consumedBytes - releasedBytes === outstandingBytes)
  verify(storage.openAllocations.reduce((sum, row) => sum + decodeStorageBytes(row.remainingBytes), 0) === outstandingBytes)
  verify(writtenBytes + outstandingBytes + recoveryRemainingBytes <= CAPACITY_GEOMETRY.storageCeilingBytes)
  verify(decodeStorageBytes(manifest.storage.limitBytes) === CAPACITY_GEOMETRY.storageCeilingBytes)
  const complete = snapshot.head.status === 'completed'
  if (complete) verify(snapshot.checkpoint.bodyCharacters === 1_000_000 && committedTasks === 123 && calls === 123 && snapshot.checkpoint.budget.operations === 494 && outstandingBytes === 0 && storage.openAllocations.length === 0)
  return capacityRow(language, snapshot, metrics, calls, io === undefined, engine.readTimeoutDiagnostics(), complete ? 'pass' : blockerCode === 'operation_timeout' || blockerCode === 'local_stopped' ? 'timeout' : 'refused', blockerCode, executionMs, maxStepMs, coldRepositoryReadMs, metrics.totalReadBytes - before.totalReadBytes, metrics.totalReadCalls - before.totalReadCalls)
}

function capacityRow(language: 'zh' | 'en', snapshot: CampaignSnapshot, metrics: StorageObservation, calls: number, nativeIDB: boolean, timeoutDiagnostics: CampaignTimeoutDiagnostics, status: string, blockerCode: string | null, executionMs: number, maxStepMs: number, coldRepositoryReadMs = 0, coldRepositoryReadBytes = 0, coldRepositoryReadCalls = 0) {
  const storage = snapshot.checkpoint.storage
  const writtenBytes = decodeStorageBytes(storage.writtenBytes), outstandingBytes = decodeStorageBytes(storage.outstandingBytes)
  const allocatedBytes = decodeStorageBytes(storage.allocatedBytes), consumedBytes = decodeStorageBytes(storage.allocationConsumedBytes), releasedBytes = decodeStorageBytes(storage.releasedBytes)
  const recoveryRemainingBytes = decodeStorageBytes(storage.recoveryRemainingBytes), committedTasks = snapshot.checkpoint.tasks.filter(task => task.status === 'committed').length
  return { language, status, blockerCode, timeoutDiagnostics, coldProcessRestart: nativeIDB ? 'not_run' : 'not_applicable', coldProcessReadMs: 0, coldProcessReadBytes: 0, coldProcessReadCalls: 0,
    execution: snapshot.head.status, committedBodyScalars: snapshot.checkpoint.bodyCharacters, committedTasks, actualFixtureInvocations: calls,
    reservedAttempts: snapshot.checkpoint.budget.attempts, committedOperations: snapshot.checkpoint.budget.operations,
    cumulativeWrittenBytes: writtenBytes, cumulativeAllocatedBytes: allocatedBytes, allocationConsumedBytes: consumedBytes,
    outstandingBytes, peakOutstandingBytes: metrics.peakOutstandingBytes, releasedBytes, recoveryRemainingBytes, openAllocations: storage.openAllocations.length,
    liveRecordCount: metrics.liveRecordCount, liveSerializedMapBytes: Object.values(metrics.liveBytesByRecordKind).reduce((sum, n) => sum + n, 0), liveBytesByRecordKind: metrics.liveBytesByRecordKind,
    cumulativeActiveReservationMs: snapshot.checkpoint.budget.activeMs, totalReadBytes: metrics.totalReadBytes, totalReadCalls: metrics.totalReadCalls,
    maxReadBatchKeys: metrics.maxReadBatchKeys, maxReadBatchBytes: metrics.maxReadBatchBytes, coldRepositoryReadMs,
    coldRepositoryReadBytes, coldRepositoryReadCalls,
    executionMs, maxStepMs, accountingMismatches: metrics.accountingMismatches, committedTransactions: metrics.committedTransactions }
}
