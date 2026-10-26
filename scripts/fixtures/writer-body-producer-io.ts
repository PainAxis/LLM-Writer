/** Exact independent write oracle; raw rows stay private and never enter summaries. */
import type { CampaignRepositoryIO } from '../../src/types/writerCampaign'
import { utf8Bytes, decodeStorageBytes } from '../../src/services/writerCampaign/protocol'
export interface ProducerIoMetrics { readCalls: number; readBytes: number; writeTransactions: number; writtenBytes: number; accountingMismatches: number; maxReadBatchBytes: number; maxReadBatchKeys: number; liveRecordCount: number; liveSerializedBytes: number; maxRawIoWaitMs: number; maxCasWaitMs: number }
export function observeProducerIO(base: CampaignRepositoryIO) {
  const values: ProducerIoMetrics = { readCalls: 0, readBytes: 0, writeTransactions: 0, writtenBytes: 0, accountingMismatches: 0, maxReadBatchBytes: 0, maxReadBatchKeys: 0, liveRecordCount: 0, liveSerializedBytes: 0, maxRawIoWaitMs: 0, maxCasWaitMs: 0 }
  const writtenByCampaign = new Map<string, number>(), liveSizes = new Map<string, number>()
  const io: CampaignRepositoryIO = {
    async getMany(keys) { const started = performance.now(); let rows: Map<string, string | null>; try { rows = await base.getMany(keys) } finally { values.maxRawIoWaitMs = Math.max(values.maxRawIoWaitMs, performance.now() - started) }; const bytes = [...rows].reduce((sum, [key, value]) => sum + utf8Bytes(key) + (value === null ? 0 : utf8Bytes(value)), 0); values.readCalls++; values.readBytes += bytes; values.maxReadBatchBytes = Math.max(values.maxReadBatchBytes, bytes); values.maxReadBatchKeys = Math.max(values.maxReadBatchKeys, keys.length); return rows },
    async compareAndSwapMany(entries, canCommit) {
      const started = performance.now(); let changed: boolean
      try { changed = await base.compareAndSwapMany(entries, canCommit) } finally { values.maxCasWaitMs = Math.max(values.maxCasWaitMs, performance.now() - started) }
      if (!changed) return false
      const bytes = entries.reduce((sum, row) => sum + utf8Bytes(row.key) + utf8Bytes(row.value), 0)
      const records = entries.map(row => JSON.parse(row.value) as Record<string, any>)
      const checkpoint = records.find(row => row.schemaVersion === 3 && row.protocolVersion === 'campaign-v3-checkpoint') ?? records.find(row => row.schemaVersion === 2 && Object.hasOwn(row, 'previousHash') && Object.hasOwn(row, 'storage') && Object.hasOwn(row, 'tasks'))
      const receipt = records.find(row => Object.hasOwn(row, 'serializedBytes') && Object.hasOwn(row, 'businessDigest'))
      if (!checkpoint || !receipt) throw new Error('producer_oracle_missing_commit')
      const prior = writtenByCampaign.get(checkpoint.campaignId) ?? 0, next = prior + bytes
      writtenByCampaign.set(checkpoint.campaignId, next)
      values.writeTransactions++; values.writtenBytes += bytes
      for (const row of entries) { const size = utf8Bytes(row.key) + utf8Bytes(row.value); values.liveSerializedBytes += size - (liveSizes.get(row.key) ?? 0); liveSizes.set(row.key, size) }
      values.liveRecordCount = liveSizes.size
      if (decodeStorageBytes(receipt.serializedBytes) !== bytes || decodeStorageBytes(checkpoint.storage.writtenBytes) !== next) values.accountingMismatches++
      return true
    },
  }
  return { io, observe: (): ProducerIoMetrics => ({ ...values }) }
}
export function createProducerMemoryIO() { const rows = new Map<string, string>(); const base: CampaignRepositoryIO = { async getMany(keys) { return new Map(keys.map(key => [key, rows.get(key) ?? null])) }, async compareAndSwapMany(entries, canCommit) { if (canCommit && !canCommit() || entries.some(row => (rows.get(row.key) ?? null) !== row.expectedValue)) return false; for (const row of entries) rows.set(row.key, row.value); return true } }; return { rows, ...observeProducerIO(base) } }
