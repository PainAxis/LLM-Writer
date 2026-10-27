/** Independent actual key/value accounting and explicit ACK fault controls. Raw maps stay private. */
import type { CampaignRepositoryIO } from '../../src/types/writerCampaign'
import { byteOracle, controlAssert, storageCounterOracle, writeBytesOracle } from './creative-pilot-oracles'
export interface CreativeIoMetrics { readCalls: number; readBytes: number; casCalls: number; successfulCas: number; writtenBytes: number; accountingMismatches: number; maxReadBatchKeys: number; maxReadBatchBytes: number; maxRawIoMs: number; maxCasMs: number; liveRows: number; liveBytes: number }
export type CreativeFaultCut = 'before_cas' | 'after_commit' | 'late_ack'
export function observeCreativeIO(base: CampaignRepositoryIO, initial?: ReadonlyMap<string, string>) {
  const metrics: CreativeIoMetrics = { readCalls: 0, readBytes: 0, casCalls: 0, successfulCas: 0, writtenBytes: 0, accountingMismatches: 0, maxReadBatchKeys: 0, maxReadBatchBytes: 0, maxRawIoMs: 0, maxCasMs: 0, liveRows: 0, liveBytes: 0 }
  const totals = new Map<string, number>(), sizes = new Map<string, number>()
  let trace: Array<{ keys: string[]; rows: Map<string, string | null> }> | null = null
  let fault: { kind: string; cut: CreativeFaultCut } | null = null, releaseAck: (() => void) | null = null, faultEntered = false
  if (initial) for (const [key, raw] of initial) {
    sizes.set(key, byteOracle(key) + byteOracle(raw))
    const value = JSON.parse(raw)
    if (value.protocolVersion === 'creative-pilot-checkpoint-v4') {
      const prior = totals.get(value.campaignId) ?? 0
      totals.set(value.campaignId, Math.max(prior, storageCounterOracle(value.storage.writtenBytes)))
    }
  }
  metrics.liveRows = sizes.size; metrics.liveBytes = [...sizes.values()].reduce((a, b) => a + b, 0)
  const closedError = (code: string) => Object.assign(new Error(code), { code })
  const io: CampaignRepositoryIO = {
    async getMany(keys) {
      const started = performance.now(); let result: Map<string, string | null>
      try { result = await base.getMany(keys) } finally { metrics.maxRawIoMs = Math.max(metrics.maxRawIoMs, performance.now() - started) }
      const bytes = [...result].reduce((sum, [key, value]) => sum + byteOracle(key) + (value === null ? 0 : byteOracle(value)), 0)
      if (trace) { controlAssert(trace.length < 1024, 'creative_control_trace_capacity'); trace.push({ keys: [...keys], rows: new Map(result) }) }
      metrics.readCalls++; metrics.readBytes += bytes; metrics.maxReadBatchKeys = Math.max(metrics.maxReadBatchKeys, keys.length); metrics.maxReadBatchBytes = Math.max(metrics.maxReadBatchBytes, bytes)
      return result
    },
    async compareAndSwapMany(entries, canCommit) {
      metrics.casCalls++
      const records = entries.map(row => JSON.parse(row.value)), receipt = records.find(row => row.protocolVersion === 'creative-pilot-receipt-v4')
      const selected = fault && receipt?.kind === fault.kind ? fault : null
      if (selected) { fault = null; faultEntered = true }
      if (selected?.cut === 'before_cas') throw closedError('cancelled')
      const started = performance.now(); let changed: boolean
      try {
        changed = await base.compareAndSwapMany(entries, canCommit)
        if (changed) {
          metrics.successfulCas++ // The actual write precedes every fallible reporting/accounting oracle.
          const bytes = writeBytesOracle(entries), checkpoint = records.find(row => row.protocolVersion === 'creative-pilot-checkpoint-v4')
          controlAssert(checkpoint && receipt, 'creative_control_missing_commit')
          const prior = totals.get(checkpoint.campaignId) ?? 0, next = prior + bytes, s = checkpoint.storage
          const W = storageCounterOracle(s.writtenBytes), U = storageCounterOracle(s.outstandingBytes), P = storageCounterOracle(s.recoveryRemainingBytes)
          const L = storageCounterOracle(s.allocatedBytes), Q = storageCounterOracle(s.allocationConsumedBytes), S = storageCounterOracle(s.releasedBytes)
          const open = s.openAllocations.reduce((sum: number, row: any) => sum + storageCounterOracle(row.remainingBytes), 0)
          if (storageCounterOracle(receipt.serializedBytes) !== bytes || W !== next || L - Q - S !== U || open !== U || Q > W || W + U + P > 67108864) metrics.accountingMismatches++
          totals.set(checkpoint.campaignId, next); metrics.writtenBytes += bytes
          for (const row of entries) { const size = byteOracle(row.key) + byteOracle(row.value); metrics.liveBytes += size - (sizes.get(row.key) ?? 0); sizes.set(row.key, size) }
          metrics.liveRows = sizes.size
          if (selected?.cut === 'after_commit') throw closedError('storage_unknown')
          if (selected?.cut === 'late_ack') await new Promise<void>(resolve => { releaseAck = resolve })
        }
      } finally { metrics.maxCasMs = Math.max(metrics.maxCasMs, performance.now() - started) }
      return changed
    },
  }
  return { io, beginTrace() { controlAssert(trace === null); trace = [] }, endTrace() { const value = trace ?? []; trace = null; return value }, observe: (): CreativeIoMetrics => ({ ...metrics }), arm(kind: string, cut: CreativeFaultCut) { controlAssert(fault === null && releaseAck === null); faultEntered = false; fault = { kind, cut } }, entered: () => faultEntered, release() { releaseAck?.(); releaseAck = null } }
}
export function createCreativeMemoryIO(initial: ReadonlyMap<string, string> = new Map(), onCommit?: (entries: ReadonlyArray<{ key: string; value: string }>, rows: ReadonlyMap<string, string>) => void) {
  const rows = new Map(initial)
  const base: CampaignRepositoryIO = {
    async getMany(keys) { return new Map(keys.map(key => [key, rows.get(key) ?? null])) },
    async compareAndSwapMany(entries, canCommit) { if (canCommit && !canCommit() || entries.some(row => (rows.get(row.key) ?? null) !== row.expectedValue)) return false; for (const row of entries) rows.set(row.key, row.value); onCommit?.(entries, rows); return true },
  }
  return { rows, ...observeCreativeIO(base, initial) }
}
