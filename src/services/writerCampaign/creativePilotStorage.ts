/** V4 phase policy over the one shared W/U/P ledger. No independent credit. */
import type { CreativeManifest, CreativeOperationKind, CreativePhase, CreativeRequest, CreativeStorageEffect } from '../../types/creativePilot'
import type { CampaignStorageState } from '../../types/writerCampaign'
import { encodeStorageBytes as enc, decodeStorageBytes as dec } from './protocol'
import { addStorage, subtractStorage, assertStorageConservation } from './storageAccounting'
import { CREATIVE_LIMITS as L, creativeAssert, creativeInteger } from './creativePilotProtocol'
export function creativeRequestEnvelope(): number { return L.requestAllowance }
export function creativeFutureBytes(status: CreativePhase['status']): number {
  return ({ reserved: 4 * L.metadataBytes + L.responseRecordBytes + L.artifactBytes,
    dispatch_intent: 3 * L.metadataBytes + L.responseRecordBytes + L.artifactBytes,
    outcome_unknown: 2 * L.metadataBytes + L.responseRecordBytes + L.artifactBytes,
    response_retained: L.metadataBytes + L.artifactBytes, resolved: 0 })[status]
}
export function applyCreativeStorage(manifest: CreativeManifest, previous: CampaignStorageState, kind: CreativeOperationKind,
  request: CreativeRequest | null, phase: CreativePhase | null, charge: number): { storage: CampaignStorageState; effect: CreativeStorageEffect } {
  creativeInteger(charge)
  const storage = structuredClone(previous), cancellation = kind === 'cancel'
  const effect: CreativeStorageEffect = { source: cancellation ? 'recovery' : phase ? 'request' : 'direct', requestId: request?.id ?? null,
    allocatedBytes: enc(0), consumedBytes: enc(0), releasedBytes: enc(0) }
  storage.writtenBytes = enc(addStorage(dec(previous.writtenBytes), charge))
  if (cancellation) storage.recoveryRemainingBytes = enc(subtractStorage(dec(previous.recoveryRemainingBytes), charge))
  if (phase) {
    creativeAssert(request && phase.requestHash === request.hash)
    const index = storage.openAllocations.findIndex(row => row.request.id === request.id)
    let remaining: number
    if (kind === 'reserve') {
      creativeAssert(index < 0 && storage.openAllocations.length === 0 && request.storageAllocationBytes === enc(L.requestAllowance), 'Request liability conflict', 'budget')
      remaining = L.requestAllowance
      creativeAssert(dec(previous.writtenBytes) + dec(previous.outstandingBytes) + dec(previous.recoveryRemainingBytes) + remaining <= dec(manifest.storage.limitBytes), 'Shared storage capacity', 'budget')
      storage.allocatedBytes = enc(addStorage(dec(storage.allocatedBytes), remaining)); storage.outstandingBytes = enc(addStorage(dec(storage.outstandingBytes), remaining)); effect.allocatedBytes = enc(remaining)
    } else { creativeAssert(index >= 0, 'Missing request liability'); remaining = dec(storage.openAllocations[index]!.remainingBytes) }
    const consumed = cancellation ? 0 : charge
    const payload = kind === 'reserve' ? L.originBytes : kind === 'retain_response' ? L.responseRecordBytes : kind === 'resolve' ? L.artifactBytes : 0
    creativeAssert(charge <= L.metadataBytes + payload, 'Phase envelope exceeded', 'budget')
    const residual = subtractStorage(remaining, consumed)
    creativeAssert(residual >= creativeFutureBytes(phase.status), 'Unfunded future phase', 'budget')
    storage.allocationConsumedBytes = enc(addStorage(dec(storage.allocationConsumedBytes), consumed)); storage.outstandingBytes = enc(subtractStorage(dec(storage.outstandingBytes), consumed)); effect.consumedBytes = enc(consumed)
    if (phase.status === 'resolved') {
      creativeAssert(index >= 0 && (kind === 'resolve' || cancellation), 'Invalid settlement')
      storage.releasedBytes = enc(addStorage(dec(storage.releasedBytes), residual)); storage.outstandingBytes = enc(subtractStorage(dec(storage.outstandingBytes), residual)); effect.releasedBytes = enc(residual)
      storage.openAllocations.splice(index, 1)
    } else {
      const row = { request: { id: request.id, revision: phase.revision, hash: phase.hash }, remainingBytes: enc(residual) }
      if (index < 0) storage.openAllocations.push(row); else storage.openAllocations[index] = row
    }
  }
  assertStorageConservation(manifest.storage, storage)
  if (!cancellation) creativeAssert(dec(storage.recoveryRemainingBytes) >= L.metadataBytes, 'Final cancellation must remain funded', 'budget')
  return { storage, effect }
}
