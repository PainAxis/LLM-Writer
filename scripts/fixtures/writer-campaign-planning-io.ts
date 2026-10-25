/** Injected atomic IO, separate from real IndexedDB evidence. Maps never enter reports. */
import type { CampaignRepositoryIO } from '../../src/types/writerCampaign'
import { decodeStorageBytes, utf8Bytes } from '../../src/services/writerCampaign/protocol'
import type { StorageObservation } from './writer-campaign-capacity-profile'
export function createPlanningMemoryIO() {
  const rows = new Map<string, string>(), kinds = ['catalog', 'manifest', 'head', 'checkpoint', 'receipt', 'request', 'artifact']
  const metrics: StorageObservation = { cumulativeWrittenBytes: 0, committedTransactions: 0, liveRecordCount: 0, liveBytesByRecordKind: Object.fromEntries(kinds.map(key => [key, 0])), totalReadBytes: 0, totalReadCalls: 0, maxReadBatchBytes: 0, maxReadBatchKeys: 0, peakOutstandingBytes: 0, accountingMismatches: 0 }
  let before: ((entries: Parameters<CampaignRepositoryIO['compareAndSwapMany']>[0]) => Promise<void>) | undefined
  let after: typeof before
  const io: CampaignRepositoryIO = {
    async getMany(keys) {
      if (keys.some(key => !key.startsWith('writer-campaign:'))) throw new Error('planning_storage_scope')
      const result = new Map(keys.map(key => [key, rows.get(key) ?? null]))
      const bytes = [...result].reduce((sum, [key, value]) => sum + utf8Bytes(key) + (value === null ? 0 : utf8Bytes(value)), 0)
      metrics.totalReadBytes += bytes; metrics.totalReadCalls++; metrics.maxReadBatchBytes = Math.max(metrics.maxReadBatchBytes, bytes); metrics.maxReadBatchKeys = Math.max(metrics.maxReadBatchKeys, keys.length)
      return result
    },
    async compareAndSwapMany(entries, canCommit) {
      await before?.(entries)
      if ((canCommit && !canCommit()) || entries.some(entry => (rows.get(entry.key) ?? null) !== entry.expectedValue)) return false
      const bytes = entries.reduce((sum, entry) => sum + utf8Bytes(entry.key) + utf8Bytes(entry.value), 0)
      for (const entry of entries) {
        if (!entry.key.startsWith('writer-campaign:')) throw new Error('planning_storage_scope')
        const kind = entry.key === 'writer-campaign:catalog' ? 'catalog' : kinds.find(kind => entry.key.includes(`:${kind}:`) || entry.key.endsWith(`:${kind}`))
        if (!kind) throw new Error('planning_storage_kind')
        const previous = rows.get(entry.key)
        if (previous !== undefined) metrics.liveBytesByRecordKind[kind]! -= utf8Bytes(entry.key) + utf8Bytes(previous)
        rows.set(entry.key, entry.value); metrics.liveBytesByRecordKind[kind]! += utf8Bytes(entry.key) + utf8Bytes(entry.value)
      }
      metrics.cumulativeWrittenBytes += bytes; metrics.committedTransactions++; metrics.liveRecordCount = rows.size
      const checkpoint = JSON.parse(entries.find(entry => entry.key.includes(':checkpoint:'))!.value)
      const receipt = JSON.parse(entries.find(entry => entry.key.includes(':receipt:'))!.value)
      if (decodeStorageBytes(receipt.serializedBytes) !== bytes || decodeStorageBytes(checkpoint.storage.writtenBytes) !== metrics.cumulativeWrittenBytes) metrics.accountingMismatches++
      metrics.peakOutstandingBytes = Math.max(metrics.peakOutstandingBytes, decodeStorageBytes(checkpoint.storage.outstandingBytes))
      await after?.(entries)
      return true
    },
  }
  return { io, rows, observe: () => structuredClone(metrics), setBefore(hook?: typeof before) { before = hook }, setAfter(hook?: typeof after) { after = hook } }
}
