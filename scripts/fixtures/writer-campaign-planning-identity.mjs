import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { campaignBuildIdentity, CAMPAIGN_CORE_PATHS } from '../campaign-build-identity.mjs'
export const PLANNING_HARNESS_PATHS = Object.freeze([
  'scripts/campaign-build-identity.mjs',
  'scripts/profile-writer-campaign-planning.ts', 'scripts/browser-writer-campaign-planning.mjs',
  'scripts/fixtures/writer-campaign-planning-profile.ts', 'scripts/fixtures/writer-campaign-planning-boundaries.ts',
  'scripts/fixtures/writer-campaign-planning-browser.ts', 'scripts/fixtures/writer-campaign-planning-report.ts',
  'scripts/fixtures/writer-campaign-planning-io.ts', 'scripts/fixtures/writer-campaign-planning-authority.mjs',
  'scripts/fixtures/writer-campaign-planning-identity.mjs', 'scripts/fixtures/writer-campaign-storage-meter.mjs',
])
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export async function planningEvidenceIdentity(root) {
  const hashes = async files => Promise.all([...files].sort().map(async file => [file, hash(await readFile(path.join(root, file)))]))
  const identity = campaignBuildIdentity(root)
  const coreSha256 = hash(JSON.stringify(await hashes(CAMPAIGN_CORE_PATHS)))
  if (identity.runtimeIdentity !== `campaign-core-sha256:${coreSha256}`) throw new Error('planning_source_changed')
  return { identity, source: { ...identity.source, coreSha256, harnessSha256: hash(JSON.stringify(await hashes(PLANNING_HARNESS_PATHS))), buildSha256: identity.runtimeIdentity.split(':')[1] } }
}

/** A measured process cannot silently acquire a later source/harness identity. */
export async function planningEvidenceIdentityMatches(root, expected) {
  try {
    const current = await planningEvidenceIdentity(root)
    return ['commit', 'tree', 'coreSha256', 'harnessSha256'].every(key => current.source[key] === expected[key])
  } catch { return false }
}
