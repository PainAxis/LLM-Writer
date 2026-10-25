/** Test-driver production build, actual default IndexedDB and real process restart. */
import { idbCompareAndSwapMany, idbGetMany } from '../../src/services/blobStore'
import { getCampaignBuildIdentity } from '../../src/services/writerCampaign/buildIdentity'
import type { CampaignSnapshot } from '../../src/types/writerCampaign'
import { createCampaignRepository } from '../../src/services/writerCampaign/store'
import { createOfflineCampaignEngine } from '../../src/services/writerCampaign/engine'
import { decodeStorageBytes } from '../../src/services/writerCampaign/protocol'
import { planningArtifactSetHash, planningProfileId, runPlanningProfile } from './writer-campaign-planning-profile'
import { planningBoundaryId, runPlanningBoundary } from './writer-campaign-planning-boundaries'
import type { PlanningProfileName } from '../../src/services/writerCampaign/planningProfile'
import type { PlanningAuthority, PlanningBoundaryMeasurement, PlanningProfileMeasurement } from './writer-campaign-planning-report'
import type { StorageObservation } from './writer-campaign-capacity-profile'
const meter = () => (globalThis as unknown as { __campaignStorageMeter: { snapshot(): StorageObservation } }).__campaignStorageMeter.snapshot()
const authority = () => (globalThis as unknown as { __planningAuthority: { snapshot(): PlanningAuthority } }).__planningAuthority.snapshot()
const verify = (condition: unknown) => { if (!condition) throw new Error('planning_restart_failed') }
export async function runNativePlanningProfile(profile: PlanningProfileName, language: 'zh' | 'en') {
  return runPlanningProfile(profile, language, getCampaignBuildIdentity(), meter, authority, undefined, row => (globalThis as unknown as { __planningProgress(row: PlanningProfileMeasurement): Promise<void> }).__planningProgress(row))
}
export async function runNativePlanningBoundary(id: PlanningBoundaryMeasurement['id'], language: 'zh' | 'en') {
  return runPlanningBoundary(id, language, getCampaignBuildIdentity(), meter, authority, { getMany: idbGetMany, compareAndSwapMany: idbCompareAndSwapMany })
}
export async function inspectPlanningAfterRestart(expected: PlanningProfileMeasurement | PlanningBoundaryMeasurement) {
  const start = performance.now(), id = 'profile' in expected ? planningProfileId(expected.profile, expected.language) : planningBoundaryId(expected.id, expected.language)
  const coldEngine = createOfflineCampaignEngine({ repository: createCampaignRepository() })
  let snapshot: CampaignSnapshot | null
  try { snapshot = await coldEngine.inspect(id) as CampaignSnapshot | null } finally { coldEngine.dispose() }
  const firstReadMs = performance.now() - start
  verify(firstReadMs < 3000)
  verify(snapshot && snapshot.head.checkpointHash === expected.checkpointHash && snapshot.checkpoint.hash === expected.checkpointHash)
  if (!snapshot) throw new Error('planning_restart_failed')
  if ('profile' in expected) {
    verify(snapshot.head.status === 'completed' && snapshot.checkpoint.bodyCharacters === expected.committedBodyScalars && await planningArtifactSetHash(snapshot) === expected.artifactSetHash)
    verify(decodeStorageBytes(snapshot.checkpoint.storage.writtenBytes) === expected.cumulativeWrittenBytes && decodeStorageBytes(snapshot.checkpoint.storage.outstandingBytes) === 0)
    const engine = createOfflineCampaignEngine()
    try {
      const preview = await engine.previewPlanningContext(id, expected.plannedChapters)
      verify(preview.status === 'ready' && preview.fullPlanRoot === expected.fullPlanRoot && preview.canonBaseRoot === expected.canonBaseRoot)
    } finally { engine.dispose() }
  }
  verify(meter().committedTransactions === 0 && Object.values(authority()).every(value => value === 0))
  return { coldProcessRestart: 'verified' as const, coldProcessReadMs: Math.round(performance.now() - start), coldProcessInitialReadMs: Math.round(firstReadMs), coldProcessReadBytes: meter().totalReadBytes, coldProcessReadCalls: meter().totalReadCalls }
}
