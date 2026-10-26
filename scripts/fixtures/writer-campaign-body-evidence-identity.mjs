/** Closed identities for source, fixture, UI and all evidence-producing harness code. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { campaignBuildIdentity, CAMPAIGN_CORE_PATHS } from '../campaign-build-identity.mjs'
export const BODY_EVIDENCE_FIXTURE_PATHS = Object.freeze(['src/services/writerCampaign/bodyEvidenceFixture.ts', 'src/services/writerCampaign/bodyEvidenceFixtureData.ts', 'src/services/writerCampaign/planningProfile.ts', 'src/services/writerCampaign/planningFixture.ts'].sort())
export const BODY_EVIDENCE_UI_PATHS = Object.freeze(['src/composables/useWriterCampaign.ts', 'src/views/CampaignLab.vue', 'src/router/index.ts', 'src/main.ts', 'src/App.vue'].sort())
export const BODY_EVIDENCE_HARNESS_PATHS = Object.freeze([
  'scripts/campaign-build-identity.mjs', 'scripts/profile-writer-campaign-body-evidence.ts',
  'scripts/browser-writer-campaign-body-evidence.mjs', 'scripts/browser-writer-campaign-body-evidence-ui.mjs',
  'scripts/fixtures/writer-campaign-body-evidence-profile.ts', 'scripts/fixtures/writer-campaign-body-evidence-browser.ts',
  'scripts/fixtures/writer-campaign-body-evidence-report.ts', 'scripts/fixtures/writer-campaign-body-evidence-identity.mjs',
  'scripts/fixtures/writer-campaign-body-evidence-authority.mjs', 'scripts/fixtures/writer-campaign-body-evidence-io.ts',
  'scripts/fixtures/writer-campaign-storage-meter.mjs', 'scripts/prepare-body-evidence-evidence.ts',
].sort())
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export async function bodyEvidenceIdentity(root) {
  const hashes = async names => Promise.all([...names].sort().map(async name => [name, hash(await readFile(path.join(root, name)))]))
  const identity = campaignBuildIdentity(root), coreSha256 = hash(JSON.stringify(await hashes(CAMPAIGN_CORE_PATHS)))
  if (identity.runtimeIdentity !== `campaign-core-sha256:${coreSha256}`) throw new Error('body_evidence_source_changed')
  return { identity, source: { ...identity.source, coreSha256, harnessSha256: hash(JSON.stringify(await hashes(BODY_EVIDENCE_HARNESS_PATHS))), fixtureSha256: hash(JSON.stringify(await hashes(BODY_EVIDENCE_FIXTURE_PATHS))), uiSha256: hash(JSON.stringify(await hashes(BODY_EVIDENCE_UI_PATHS))), buildSha256: coreSha256 } }
}
export async function bodyEvidenceIdentityMatches(root, expected) {
  try { const current = (await bodyEvidenceIdentity(root)).source; return ['commit', 'tree', 'coreSha256', 'harnessSha256', 'fixtureSha256', 'uiSha256', 'buildSha256'].every(key => current[key] === expected[key]) } catch { return false }
}
