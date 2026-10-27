import type { CampaignManifest, CampaignStoragePolicy, CampaignOperationKind, CampaignRequest, CampaignStorageEffect, CampaignStorageState, StorageBytes16 } from '../../types/writerCampaign'
import { campaignAssert, campaignInteger, decodeStorageBytes as dec, encodeStorageBytes as enc, utf8Bytes, validateCampaignStorage } from './protocol'

export const CAMPAIGN_MAX_OPEN_ALLOCATIONS = 128
export const CAMPAIGN_RECOVERY_STORAGE_BYTES = 524_288
const ZERO = enc(0)
export function addStorage(left: number, right: number): number {
  campaignInteger(left); campaignInteger(right); campaignInteger(left + right)
  return left + right
}
export function subtractStorage(left: number, right: number): number {
  campaignInteger(left); campaignInteger(right)
  campaignAssert(right <= left, 'Storage allowance exhausted', 'budget')
  return left - right
}
/** This is also the protected final-cancel envelope, a subset of P. */
export function campaignFinalCancelBytes(taskCount: number): number {
  campaignInteger(taskCount, 128, 1)
  return 16_384 + 1024 * taskCount + 512 * CAMPAIGN_MAX_OPEN_ALLOCATIONS
}
export function campaignRequestBounds(preparedInput: string, taskCount: number, responseBytes: number) {
  campaignInteger(responseBytes, 65_536, 1)
  campaignAssert(utf8Bytes(preparedInput) <= 65_536, 'Request input exceeds bound', 'budget')
  const M = campaignFinalCancelBytes(taskCount), Q = 8192 + utf8Bytes(JSON.stringify(preparedInput)), X = 6 * responseBytes + 2, G = 4096 + 256 * taskCount
  return { M, Q, X, G, allowance: 5 * M + 5 * Q + 3 * X + G }
}
export function campaignRequestStorageAllowance(preparedInput: string, taskCount: number, responseBytes: number): StorageBytes16 {
  return enc(campaignRequestBounds(preparedInput, taskCount, responseBytes).allowance)
}
function requestPhaseBound(status: CampaignRequest['status'], { M, Q, X, G }: ReturnType<typeof campaignRequestBounds>): number {
  return M + Q + (status === 'committed' ? 2 * X + G : status === 'response_retained' ? X : 0)
}
export function campaignRequestPhaseBound(request: CampaignRequest, taskCount: number): number {
  return requestPhaseBound(request.status, campaignRequestBounds(request.preparedInput, taskCount, request.reservation.responseBytes))
}
function requestFutureBound(status: CampaignRequest['status'], { M, Q, X, G }: ReturnType<typeof campaignRequestBounds>): number {
  switch (status) {
    case 'reserved': return 4 * (M + Q) + 3 * X + G
    case 'dispatch_intent': return 3 * (M + Q) + 3 * X + G
    case 'outcome_unknown': return 2 * (M + Q) + 3 * X + G
    case 'response_retained': return M + Q + 2 * X + G
    default: return 0
  }
}
export function campaignRequestFutureBound(request: CampaignRequest, taskCount: number): number {
  return requestFutureBound(request.status, campaignRequestBounds(request.preparedInput, taskCount, request.reservation.responseBytes))
}
export function emptyCampaignStorage(recoveryBytes: number | StorageBytes16): CampaignStorageState {
  return { writtenBytes: ZERO, allocatedBytes: ZERO, allocationConsumedBytes: ZERO, releasedBytes: ZERO, outstandingBytes: ZERO,
    recoveryRemainingBytes: typeof recoveryBytes === 'number' ? enc(recoveryBytes) : enc(dec(recoveryBytes)), openAllocations: [] }
}
export function campaignStorageSource(kind: CampaignOperationKind, request: CampaignRequest | null): CampaignStorageEffect['source'] {
  if (request) return 'request'
  return ['pause', 'cancel', 'reconcile', 'block'].includes(kind) ? 'recovery' : 'direct'
}
export function assertCampaignStorage(manifest: CampaignManifest, storage: CampaignStorageState): void {
  assertStorageConservation(manifest.storage, storage)
}
export function assertStorageConservation(policy: CampaignStoragePolicy, storage: CampaignStorageState): void {
  validateCampaignStorage(storage)
  const W = dec(storage.writtenBytes), L = dec(storage.allocatedBytes), Q = dec(storage.allocationConsumedBytes), S = dec(storage.releasedBytes), U = dec(storage.outstandingBytes), P = dec(storage.recoveryRemainingBytes)
  campaignAssert(subtractStorage(subtractStorage(L, Q), S) === U, 'Storage allocation conservation mismatch')
  campaignAssert(storage.openAllocations.reduce((sum, row) => addStorage(sum, dec(row.remainingBytes)), 0) === U, 'Open allocation sum mismatch')
  campaignAssert(Q <= W && P <= dec(policy.recoveryReserveBytes), 'Storage source conservation mismatch')
  campaignAssert(addStorage(addStorage(W, U), P) <= dec(policy.limitBytes), 'Campaign storage budget exceeded', 'budget')
}
/** All totals and effects are repository-derived. The operation fixes row shape before D is measured. */
export function applyCampaignStorage(manifest: CampaignManifest, previous: CampaignStorageState, kind: CampaignOperationKind, request: CampaignRequest | null, charge: number): { storage: CampaignStorageState; effect: CampaignStorageEffect } {
  campaignInteger(charge)
  const storage = structuredClone(previous), source = campaignStorageSource(kind, request)
  const effect: CampaignStorageEffect = { source, requestId: request?.id ?? null, allocatedBytes: ZERO, releasedBytes: ZERO, remainingBytes: ZERO }
  storage.writtenBytes = enc(addStorage(dec(previous.writtenBytes), charge))
  if (request) {
    const index = storage.openAllocations.findIndex(row => row.request.id === request.id)
    let remaining: number, bounds: ReturnType<typeof campaignRequestBounds>
    if (kind === 'reserve') {
      campaignAssert(index < 0 && storage.openAllocations.length < CAMPAIGN_MAX_OPEN_ALLOCATIONS, 'Open allocation limit or duplicate allocation', 'budget')
      const allowance = dec(request.storageAllocationBytes)
      bounds = campaignRequestBounds(request.preparedInput, manifest.tasks.length, request.reservation.responseBytes)
      campaignAssert(request.storageAllocationBytes === enc(bounds.allowance), 'Request allocation differs from immutable envelope', 'budget')
      // Admission includes the whole grant; its reserve write is paid from it.
      campaignAssert(addStorage(addStorage(addStorage(dec(previous.writtenBytes), dec(previous.outstandingBytes)), allowance), dec(previous.recoveryRemainingBytes)) <= dec(manifest.storage.limitBytes), 'Request allocation exceeds storage budget', 'budget')
      storage.allocatedBytes = enc(addStorage(dec(storage.allocatedBytes), allowance))
      storage.outstandingBytes = enc(addStorage(dec(storage.outstandingBytes), allowance))
      effect.allocatedBytes = request.storageAllocationBytes
      remaining = allowance
    } else {
      campaignAssert(index >= 0, 'Request allocation is not open')
      remaining = dec(storage.openAllocations[index]!.remainingBytes)
      bounds = campaignRequestBounds(request.preparedInput, manifest.tasks.length, request.reservation.responseBytes)
    }
    // Reuse only this invocation's validated immutable envelope, never a request/revision cache.
    campaignAssert(charge <= requestPhaseBound(request.status, bounds), 'Request phase exceeds proved envelope', 'budget')
    const residual = subtractStorage(remaining, charge)
    campaignAssert(residual >= requestFutureBound(request.status, bounds), 'Request cannot fund its remaining phases', 'budget')
    storage.allocationConsumedBytes = enc(addStorage(dec(storage.allocationConsumedBytes), charge))
    storage.outstandingBytes = enc(subtractStorage(dec(storage.outstandingBytes), charge))
    if (kind === 'accept_artifact') {
      campaignAssert(index >= 0 && request.status === 'committed', 'Only exact artifact acceptance settles storage')
      effect.releasedBytes = enc(residual)
      storage.releasedBytes = enc(addStorage(dec(storage.releasedBytes), residual))
      storage.outstandingBytes = enc(subtractStorage(dec(storage.outstandingBytes), residual))
      storage.openAllocations.splice(index, 1)
    } else {
      effect.remainingBytes = enc(residual)
      const row = { request: { id: request.id, revision: request.revision, hash: request.hash }, remainingBytes: enc(residual) }
      if (index >= 0) storage.openAllocations[index] = row
      else storage.openAllocations.push(row)
      storage.openAllocations.sort((a, b) => a.request.id < b.request.id ? -1 : a.request.id > b.request.id ? 1 : 0)
    }
  } else if (source === 'recovery') storage.recoveryRemainingBytes = enc(subtractStorage(dec(storage.recoveryRemainingBytes), charge))
  assertCampaignStorage(manifest, storage)
  if (kind !== 'cancel') campaignAssert(dec(storage.recoveryRemainingBytes) >= campaignFinalCancelBytes(manifest.tasks.length), 'Final cancel storage is protected', 'budget')
  return { storage, effect }
}
