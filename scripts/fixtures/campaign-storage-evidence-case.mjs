// Source-free synthetic projection fixture. Never an executed capacity/browser result.
import { CAMPAIGN_STORAGE_BOUNDARIES, CAMPAIGN_PROOF_BOUNDARIES, emptyCampaignProofBoundary, emptyCampaignStorageProfile } from '../campaign-evidence.mjs'
export function campaignStorageEvidenceCase(environment = 'browser-native-idb') {
  return { schemaVersion: 3, sourceSchemaVersion: 3, reportKind: 'campaign-storage-v2', commit: '1'.repeat(40), sourceTreeSha256: '2'.repeat(64), harnessSha256: '3'.repeat(64), buildSha256: '4'.repeat(64), environment,
    buildMode: environment === 'browser-native-idb' ? 'test_driver_production_modules' : 'node_typescript_production_modules',
    readAccounting: environment === 'browser-native-idb' ? 'native_idb_get_transactions_including_cas_and_aborts' : 'repository_getMany_only', baselineReadAccounting: 'historical_node_repository_getMany_only',
    geometry: { version: 'synthetic-storage-geometry-60x16667-v1', plannedTasks: 123, plannedBodyTasks: 60, targetBodyScalars: 1_000_000, storageCeilingBytes: 67_108_864, recoveryReserveBytes: 524_288 }, baselineV1: { zh: { committedBodyScalars: 200_004, completedTasks: 28, cumulativeWrittenBytes: 6_346_657, permanentStorageReservationBytes: 66_456_411, totalReadBytes: 570_635_858, totalReadCalls: 10_577 }, en: { committedBodyScalars: 350_007, completedTasks: 46, cumulativeWrittenBytes: 6_618_786, permanentStorageReservationBytes: 65_625_495, totalReadBytes: 997_803_343, totalReadCalls: 26_957 } },
    boundaries: environment === 'browser-native-idb' ? CAMPAIGN_STORAGE_BOUNDARIES.map(id => ({ id, status: 'not_run', failureStage: null, fixtureDispatchEntries: 0, committedTransactions: 0, cumulativeWrittenBytes: 0, outstandingBytes: 0, releasedBytes: 0, accountingMismatches: 0 })) : [],
    proofBoundaries: environment === 'browser-native-idb' ? CAMPAIGN_PROOF_BOUNDARIES.map(emptyCampaignProofBoundary) : [],
    profiles: ['zh', 'en'].map(emptyCampaignStorageProfile), browserErrors: 0, blockedExternalRequests: 0, realModelRequests: 0, longformAcceptance: 'NOT_RUN' }
}
