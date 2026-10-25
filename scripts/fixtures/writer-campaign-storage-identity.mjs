import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { campaignBuildIdentity, CAMPAIGN_CORE_PATHS } from '../campaign-build-identity.mjs'
export const STORAGE_HARNESS_PATHS = Object.freeze(['scripts/campaign-evidence.mjs', 'scripts/lib/writer-campaign-storage-reporting.mjs', 'scripts/campaign-build-identity.mjs', 'scripts/fixtures/writer-campaign-browser-probe.mjs', 'scripts/profile-writer-campaign-capacity.ts', 'scripts/browser-writer-campaign-storage.mjs', 'scripts/fixtures/writer-campaign-capacity-profile.ts', 'scripts/fixtures/writer-campaign-storage-browser.ts', 'scripts/fixtures/writer-campaign-storage-meter.mjs', 'scripts/fixtures/writer-campaign-storage-identity.mjs'])
const hash = value => createHash('sha256').update(value).digest('hex')
export async function storageEvidenceIdentity(root) {
  const hashes = async files => Promise.all([...files].sort().map(async file => [file, hash(await readFile(path.join(root, file)))]))
  const commit = process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('storage_identity_invalid')
  return { identity: campaignBuildIdentity(root), commit, sourceTreeSha256: hash(JSON.stringify(await hashes(CAMPAIGN_CORE_PATHS))), harnessSha256: hash(JSON.stringify(await hashes(STORAGE_HARNESS_PATHS))) }
}
