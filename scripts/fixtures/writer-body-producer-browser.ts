/** CI-only entrypoint: real native IDB and the actual shipped producer panel. */
import { createApp, h, ref, watch, type App } from 'vue'
import ProducerLabPanel from '../../src/components/ProducerLabPanel.vue'
import { idbCompareAndSwapMany, idbGetMany } from '../../src/services/blobStore'
import { getCampaignBuildIdentity } from '../../src/services/writerCampaign/buildIdentity'
import { createCampaignRepository } from '../../src/services/writerCampaign/store'
import { createOfflineCampaignEngine, createOfflineCampaignManifest } from '../../src/services/writerCampaign/engine'
import { decodeStorageBytes } from '../../src/services/writerCampaign/protocol'
import { planningManifestOptions } from '../../src/services/writerCampaign/planningProfile'
import { createProducerCampaignRepository } from '../../src/services/writerCampaign/producerStore'
import { createBodyProducerEngine } from '../../src/services/writerCampaign/bodyProducerEngine'
import { createOfflineSdkBodyProducer } from '../../src/services/writerCampaign/bodyProducerTransport'
import { observeProducerIO } from './writer-body-producer-io'
import { configureProducerLoopback, producerControlIdentity, type ProducerHttpObservation } from './writer-body-producer-control'
import { runProducerProfile, verifyProducerRestart } from './writer-body-producer-profile'
import type { ProducerProfileRow } from './writer-body-producer-report'
import type { CampaignSnapshot } from '../../src/types/writerCampaign'
const host = globalThis as unknown as { __producerReadHttp(): Promise<ProducerHttpObservation>; __producerProgress(row: ProducerProfileRow): Promise<void> }
const nativeIO = { getMany: idbGetMany, compareAndSwapMany: idbCompareAndSwapMany }
async function controlledAdapter(endpoint: string) {
  await configureProducerLoopback(endpoint)
  const { useApiConfig } = await import('../../src/services/apiConfig')
  let revision = `readiness-control-${crypto.randomUUID()}`
  const stop = watch(useApiConfig().activeConfig, () => { revision = `readiness-control-${crypto.randomUUID()}` }, { deep: true, flush: 'sync' })
  const adapter = createOfflineSdkBodyProducer({ identity: { ...producerControlIdentity(endpoint), configurationRevision: revision }, currentConfigurationRevision: () => revision })
  return { adapter, stop }
}
export async function runNativeProfile(language: 'zh' | 'en', endpoint: string) {
  const observed = observeProducerIO(nativeIO), { adapter, stop } = await controlledAdapter(endpoint)
  try { return await runProducerProfile({ language, platform: 'native', identity: getCampaignBuildIdentity(), io: observed.io, observeIo: observed.observe, adapter, observeHttp: () => host.__producerReadHttp(), onProgress: row => host.__producerProgress(row) }) }
  finally { stop() }
}
export function restartNative(expected: ProducerProfileRow) { return verifyProducerRestart(expected, getCampaignBuildIdentity()) }
let app: App | null = null, currentCampaignId = '', stopConfigurationWatch: (() => void) | null = null
export const producerUiCampaignId = (language: 'zh' | 'en') => `producer-readiness-ui-${language}`
export async function mountProducerUi(language: 'zh' | 'en', endpoint: string, existing = false): Promise<{ campaignId: string; native: true }> {
  app?.unmount(); app = null; stopConfigurationWatch?.(); stopConfigurationWatch = null
  const identity = getCampaignBuildIdentity(), campaignId = producerUiCampaignId(language)
  let legacySnapshot: CampaignSnapshot | null = null
  if (!existing) {
    const legacy = createOfflineCampaignEngine({ identity, repository: createCampaignRepository() })
    try { const manifest = await createOfflineCampaignManifest(planningManifestOptions({ campaignId, language, identity, profile: 'three-chapter' })); legacySnapshot = await legacy.prepare(manifest); for (let step = 0; step < 9; step++) legacySnapshot = await legacy.step(campaignId, `producer-ui-setup-${step}`) }
    finally { legacy.dispose() }
    if (legacySnapshot.head.status !== 'completed') throw new Error('producer_ui_source_incomplete')
  }
  const { adapter, stop } = await controlledAdapter(endpoint); stopConfigurationWatch = stop
  const engine = createBodyProducerEngine({ identity, adapters: [adapter] })
  const element = document.getElementById('app') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'app' }))
  const selectedCampaign = ref(campaignId)
  app = createApp({ render: () => h('main', [
    h('nav', { 'aria-label': 'Campaign navigation acceptance host' }, [
      h('button', { 'data-testid': 'body-producer-host-away', onClick: () => { selectedCampaign.value = `${campaignId}-away` } }, 'Navigate to another campaign'),
      h('button', { 'data-testid': 'body-producer-host-home', onClick: () => { selectedCampaign.value = campaignId } }, 'Return to source campaign'),
    ]), h(ProducerLabPanel, { campaignId: selectedCampaign.value, legacySnapshot, engine }),
  ]) }); app.mount(element); currentCampaignId = campaignId
  return { campaignId, native: true }
}
/** Read-only native observation also serves the separate real-App route cut;
 * it neither touches that App's injected engine nor acquires execution ownership. */
export async function producerCampaignObservation(campaignId: string) {
  const snapshot = await createProducerCampaignRepository().read(campaignId)
  if (!snapshot) return { adopted: false, requests: 0, unknown: 0, sourceEpoch: 0, latestStatus: 'none', latestOutcome: 'none', latestRequestId: null, currentReviews: 0, outstandingBytes: 0 }
  const rows = snapshot.checkpoint.producerRequests.map(index => ({ request: snapshot.requests.get(index.requestHash)!, phase: snapshot.phases.get(index.phaseHash)! }))
  const latest = rows.at(-1)
  return { adopted: true, requests: rows.length, unknown: rows.filter(row => ['dispatch_intent', 'outcome_unknown'].includes(row.phase.status)).length, sourceEpoch: snapshot.checkpoint.sourceEpoch, latestStatus: latest?.phase.status ?? 'none', latestOutcome: latest?.phase.resolution?.outcome ?? 'none', latestRequestId: latest?.request.id ?? null,
    outstandingBytes: decodeStorageBytes(snapshot.checkpoint.storage.outstandingBytes), currentReviews: rows.filter(row => row.request.sourceEpoch === snapshot.checkpoint.sourceEpoch && row.phase.resolution?.outcome === 'review_ready').length }
}
export function producerUiObservation() { return producerCampaignObservation(currentCampaignId) }
