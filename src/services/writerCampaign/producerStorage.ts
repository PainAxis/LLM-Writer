/** Campaign v3 producer envelopes share the original Campaign W/U/P ledger. */
import type { CampaignManifest, CampaignStorageState } from '../../types/writerCampaign'
import type { BodyProducerPhase, ProducerCampaignReceipt, ProducerOperationKind } from '../../types/bodyProducer'
import { campaignAssert, campaignInteger, decodeStorageBytes as dec, encodeStorageBytes as enc } from './protocol'
import { addStorage, assertCampaignStorage, subtractStorage } from './storageAccounting'

export const PRODUCER_ORIGIN_RECORD_BYTES = 65_536
export const PRODUCER_RESPONSE_RECORD_BYTES = 131_072
export const PRODUCER_REVIEW_RECORD_BYTES = 131_072
export function producerMetadataBound(tasks: number): number {
  campaignInteger(tasks, 128, 1)
  return 32_768 + 1_024 * tasks + 512 * 128 + 1_024 * 8
}
export function producerStorageAllowance(tasks: number): number {
  return 5 * producerMetadataBound(tasks) + PRODUCER_ORIGIN_RECORD_BYTES + PRODUCER_RESPONSE_RECORD_BYTES + PRODUCER_REVIEW_RECORD_BYTES
}
export function producerFuturePhases(status: BodyProducerPhase['status']): number {
  return { reserved: 4, dispatch_intent: 3, outcome_unknown: 2, response_retained: 1, resolved: 0 }[status]
}
export function producerFutureBytes(tasks: number, status: BodyProducerPhase['status']): number {
  const metadata = producerFuturePhases(status) * producerMetadataBound(tasks)
  return metadata + (status === 'resolved' ? 0 : PRODUCER_REVIEW_RECORD_BYTES)
    + (['reserved', 'dispatch_intent', 'outcome_unknown'].includes(status) ? PRODUCER_RESPONSE_RECORD_BYTES : 0)
}
export function applyProducerStorage(
  manifest: CampaignManifest, previous: CampaignStorageState, kind: ProducerOperationKind,
  phase: BodyProducerPhase | null, charge: number,
): { storage: CampaignStorageState; effect: ProducerCampaignReceipt['storageEffect'] } {
  campaignInteger(charge)
  const storage = structuredClone(previous)
  const source = phase ? 'request' : kind === 'cancel' ? 'recovery' : 'direct'
  const effect: ProducerCampaignReceipt['storageEffect'] = {
    source, requestId: phase?.requestId ?? null, allocatedBytes: enc(0), consumedBytes: enc(0), releasedBytes: enc(0),
  }
  storage.writtenBytes = enc(addStorage(dec(previous.writtenBytes), charge))
  if (phase) {
    const index = storage.openAllocations.findIndex(row => row.request.id === phase.requestId)
    let remaining: number
    if (kind === 'reserve') {
      campaignAssert(index < 0 && storage.openAllocations.length < 128, 'Producer allocation identity/capacity conflict', 'budget')
      remaining = producerStorageAllowance(manifest.tasks.length)
      campaignAssert(addStorage(addStorage(addStorage(dec(previous.writtenBytes), dec(previous.outstandingBytes)), dec(previous.recoveryRemainingBytes)), remaining) <= dec(manifest.storage.limitBytes), 'Producer storage admission exhausted', 'budget')
      storage.allocatedBytes = enc(addStorage(dec(storage.allocatedBytes), remaining))
      storage.outstandingBytes = enc(addStorage(dec(storage.outstandingBytes), remaining))
      effect.allocatedBytes = enc(remaining)
    } else {
      campaignAssert(index >= 0, 'Producer request has no open storage allocation')
      remaining = dec(storage.openAllocations[index]!.remainingBytes)
    }
    const payloadBound = kind === 'reserve' ? PRODUCER_ORIGIN_RECORD_BYTES : kind === 'retain_response' ? PRODUCER_RESPONSE_RECORD_BYTES : kind === 'resolve' ? PRODUCER_REVIEW_RECORD_BYTES : 0
    campaignAssert(charge <= producerMetadataBound(manifest.tasks.length) + payloadBound, 'Producer phase exceeds immutable storage envelope', 'budget')
    const residual = subtractStorage(remaining, charge)
    campaignAssert(residual >= producerFutureBytes(manifest.tasks.length, phase.status), 'Producer future phases are unfunded', 'budget')
    storage.allocationConsumedBytes = enc(addStorage(dec(storage.allocationConsumedBytes), charge))
    storage.outstandingBytes = enc(subtractStorage(dec(storage.outstandingBytes), charge))
    effect.consumedBytes = enc(charge)
    if (phase.status === 'resolved') {
      campaignAssert(kind === 'resolve' && index >= 0, 'Only terminal producer resolution settles storage')
      storage.releasedBytes = enc(addStorage(dec(storage.releasedBytes), residual))
      storage.outstandingBytes = enc(subtractStorage(dec(storage.outstandingBytes), residual))
      effect.releasedBytes = enc(residual)
      storage.openAllocations.splice(index, 1)
    } else {
      const row = { request: { id: phase.requestId, revision: phase.revision, hash: phase.hash }, remainingBytes: enc(residual) }
      if (index < 0) storage.openAllocations.push(row)
      else storage.openAllocations[index] = row
      storage.openAllocations.sort((a, b) => a.request.id < b.request.id ? -1 : a.request.id > b.request.id ? 1 : 0)
    }
  } else if (source === 'recovery') {
    storage.recoveryRemainingBytes = enc(subtractStorage(dec(storage.recoveryRemainingBytes), charge))
  }
  assertCampaignStorage(manifest, storage)
  if (kind !== 'cancel') campaignAssert(dec(storage.recoveryRemainingBytes) >= producerMetadataBound(manifest.tasks.length), 'V3 final control envelope is protected', 'budget')
  return { storage, effect }
}
