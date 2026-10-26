/** Exact source/fixture/UI/harness manifests; source-bearing inputs never enter them. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { campaignBuildIdentity, CAMPAIGN_CORE_PATHS } from '../campaign-build-identity.mjs'
const hash = value => createHash('sha256').update(value).digest('hex')
export const PRODUCER_SOURCE_PATHS = Object.freeze([...new Set([...CAMPAIGN_CORE_PATHS,
  'src/types/bodyProducer.ts', 'src/types/api.ts', 'src/services/writerCampaign/bodyProducerEngine.ts',
  'src/services/writerCampaign/bodyProducerEvidence.ts', 'src/services/writerCampaign/bodyProducerProtocol.ts',
  'src/services/writerCampaign/bodyProducerTransport.ts', 'src/services/writerCampaign/producerStore.ts',
  'src/services/writerCampaign/producerStorage.ts', 'src/services/api.ts', 'src/services/apiConfig.ts',
  'src/services/aiProviders.ts', 'src/services/aiRequestLimits.ts', 'package-lock.json',
  'src/composables/bodyProducerHost.ts',
])].sort())
export const PRODUCER_UI_PATHS = Object.freeze(['index.html', 'src/main.ts', 'src/App.vue', 'src/router/index.ts', 'src/components/ProducerLabPanel.vue', 'src/composables/bodyProducerHost.ts', 'src/composables/useBodyProducer.ts', 'src/views/CampaignLab.vue', 'src/composables/useWriterCampaign.ts', 'src/views/Dashboard.vue', 'src/services/novelPersistence.ts', 'src/config/announcements.js', 'src/components/AnnouncementDialog.vue'].sort())
export const PRODUCER_FIXTURE_PATHS = Object.freeze(['src/services/writerCampaign/planningProfile.ts', 'src/services/writerCampaign/planningFixture.ts', 'scripts/fixtures/writer-body-producer-control.ts'].sort())
export const PRODUCER_HARNESS_PATHS = Object.freeze([
  'scripts/profile-writer-body-producer.ts', 'scripts/browser-writer-body-producer.mjs',
  'scripts/fixtures/writer-body-producer-profile.ts', 'scripts/fixtures/writer-body-producer-browser.ts',
  'scripts/fixtures/writer-body-producer-control.ts', 'scripts/fixtures/writer-body-producer-node-server.ts',
  'scripts/fixtures/writer-body-producer-app.ts',
  'scripts/fixtures/writer-body-producer-verification-report.ts',
  'scripts/fixtures/writer-body-producer-io.ts', 'scripts/fixtures/writer-body-producer-report.ts',
  'scripts/fixtures/writer-body-producer-identity.mjs', 'scripts/fixtures/writer-body-producer-build.mjs', 'scripts/smoke-writer-body-producer-report.ts',
  'scripts/fixtures/writer-campaign-heap-observation.ts', 'scripts/prepare-body-producer-evidence.ts',
  'scripts/smoke-writer-body-producer-archive.ts', 'package.json', '.github/workflows/ci.yml', 'scripts/campaign-build-identity.mjs',
  'scripts/smoke-ci-evidence.mjs', 'scripts/smoke-writer-body-producer-recovery.ts',
  'scripts/smoke-writer-body-producer-session-engine.ts', 'scripts/smoke-writer-body-producer-session-store.ts',
  'scripts/smoke-writer-body-producer-proof.ts', 'scripts/smoke-writer-body-producer-deadlines.ts',
  'scripts/smoke-body-producer-ui.ts', 'scripts/smoke-writer-body-producer-engine.ts',
  'scripts/smoke-writer-body-producer-store.ts', 'scripts/smoke-writer-body-producer-transport.ts',
  'scripts/smoke-writer-campaign-body-producer.ts',
].sort())
export async function producerIdentity(root) {
  const digest = async names => hash(JSON.stringify(await Promise.all(names.map(async name => [name, hash(await readFile(path.join(root, name)))]))))
  const identity = campaignBuildIdentity(root), coreSha256 = await digest(PRODUCER_SOURCE_PATHS)
  return { identity, source: { ...identity.source, coreSha256, harnessSha256: await digest(PRODUCER_HARNESS_PATHS), uiSha256: await digest(PRODUCER_UI_PATHS), fixtureSha256: await digest(PRODUCER_FIXTURE_PATHS), buildSha256: coreSha256 } }
}
export async function producerIdentityMatches(root, expected) { try { const current = (await producerIdentity(root)).source; return ['commit', 'tree', 'coreSha256', 'harnessSha256', 'uiSha256', 'fixtureSha256', 'buildSha256'].every(key => current[key] === expected[key]) } catch { return false } }
