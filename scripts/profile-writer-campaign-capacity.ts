/** Local Node structural profile, explicitly not browser IndexedDB evidence. */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { CampaignRepositoryIO } from '../src/types/writerCampaign'
import { decodeStorageBytes, utf8Bytes } from '../src/services/writerCampaign/protocol'
import { CAPACITY_GEOMETRY, CAPACITY_V1_BASELINE, runCampaignCapacityProfile, safeStorageCode, type StorageObservation } from './fixtures/writer-campaign-capacity-profile'
import { storageEvidenceIdentity } from './fixtures/writer-campaign-storage-identity.mjs'
import { CAMPAIGN_CAPACITY_NODE_REPORT_PATH, emptyCampaignStorageProfile, projectCampaignStorageReport, campaignStorageReportExitCode } from './campaign-evidence.mjs'
const originalFetch = globalThis.fetch
const root = fileURLToPath(new URL('../', import.meta.url))
function memoryObservation() {
  const rows = new Map<string, string>(), kinds = ['catalog', 'manifest', 'head', 'checkpoint', 'receipt', 'request', 'artifact']
  const metrics: StorageObservation = { cumulativeWrittenBytes: 0, committedTransactions: 0, liveRecordCount: 0, liveBytesByRecordKind: Object.fromEntries(kinds.map(key => [key, 0])), totalReadBytes: 0, totalReadCalls: 0, maxReadBatchBytes: 0, maxReadBatchKeys: 0, peakOutstandingBytes: 0, accountingMismatches: 0 }
  const io: CampaignRepositoryIO = {
    async getMany(keys) {
      const result = new Map(keys.map(key => [key, rows.get(key) ?? null]))
      const bytes = [...result].reduce((sum, [key, value]) => sum + utf8Bytes(key) + (value === null ? 0 : utf8Bytes(value)), 0)
      metrics.totalReadBytes += bytes; metrics.totalReadCalls++; metrics.maxReadBatchBytes = Math.max(metrics.maxReadBatchBytes, bytes); metrics.maxReadBatchKeys = Math.max(metrics.maxReadBatchKeys, keys.length)
      return result
    },
    async compareAndSwapMany(entries, canCommit) {
      if ((canCommit && !canCommit()) || entries.some(entry => (rows.get(entry.key) ?? null) !== entry.expectedValue)) return false
      const bytes = entries.reduce((sum, entry) => sum + utf8Bytes(entry.key) + utf8Bytes(entry.value), 0)
      for (const entry of entries) {
        const kind = entry.key === 'writer-campaign:catalog' ? 'catalog' : kinds.find(kind => entry.key.includes(`:${kind}:`) || entry.key.endsWith(`:${kind}`))
        if (!kind) throw new Error('profile_key_category')
        const previous = rows.get(entry.key)
        if (previous !== undefined) metrics.liveBytesByRecordKind[kind]! -= utf8Bytes(entry.key) + utf8Bytes(previous)
        rows.set(entry.key, entry.value); metrics.liveBytesByRecordKind[kind]! += utf8Bytes(entry.key) + utf8Bytes(entry.value)
      }
      metrics.cumulativeWrittenBytes += bytes; metrics.committedTransactions++; metrics.liveRecordCount = rows.size
      const checkpoint = JSON.parse(entries.find(entry => entry.key.includes(':checkpoint:'))!.value)
      const receipt = JSON.parse(entries.find(entry => entry.key.includes(':receipt:'))!.value)
      if (decodeStorageBytes(receipt.serializedBytes) !== bytes || decodeStorageBytes(checkpoint.storage.writtenBytes) !== metrics.cumulativeWrittenBytes) metrics.accountingMismatches++
      metrics.peakOutstandingBytes = Math.max(metrics.peakOutstandingBytes, decodeStorageBytes(checkpoint.storage.outstandingBytes))
      return true
    },
  }
  return { io, observe: () => structuredClone(metrics) }
}
try {
  globalThis.fetch = async () => { throw new Error('Network forbidden in local capacity profile') }
  const provenance = await storageEvidenceIdentity(root)
  const report = { schemaVersion: 3, sourceSchemaVersion: 3, reportKind: 'campaign-storage-v2', commit: provenance.commit, sourceTreeSha256: provenance.sourceTreeSha256,
    harnessSha256: provenance.harnessSha256, buildSha256: provenance.identity.runtimeIdentity.split(':')[1], environment: 'node-injected-atomic-io-not-browser-idb', buildMode: 'node_typescript_production_modules', readAccounting: 'repository_getMany_only', baselineReadAccounting: 'historical_node_repository_getMany_only',
    geometry: CAPACITY_GEOMETRY, baselineV1: CAPACITY_V1_BASELINE, boundaries: [], proofBoundaries: [], profiles: ['zh', 'en'].map(emptyCampaignStorageProfile) as Array<ReturnType<typeof emptyCampaignStorageProfile> | Awaited<ReturnType<typeof runCampaignCapacityProfile>>>, browserErrors: 0, blockedExternalRequests: 0, realModelRequests: 0, longformAcceptance: 'NOT_RUN' }
  const persist = async () => {
    const closed = projectCampaignStorageReport(report)
    await mkdir(path.dirname(path.join(root, CAMPAIGN_CAPACITY_NODE_REPORT_PATH)), { recursive: true })
    await writeFile(path.join(root, CAMPAIGN_CAPACITY_NODE_REPORT_PATH), `${JSON.stringify(closed, null, 2)}\n`)
  }
  for (const [index, language] of (['zh', 'en'] as const).entries()) {
    const { io, observe } = memoryObservation()
    report.profiles[index] = await runCampaignCapacityProfile(language, provenance.identity, observe, io, async row => { report.profiles[index] = row; await persist() })
    console.log(JSON.stringify(report.profiles[index]))
  }
  await persist()
  process.exitCode = campaignStorageReportExitCode(report)
} catch (error) {
  console.error(JSON.stringify({ suite: 'writer-campaign-capacity', category: safeStorageCode(error), longformAcceptance: 'NOT_RUN' }))
  process.exitCode = 1
} finally { globalThis.fetch = originalFetch }
