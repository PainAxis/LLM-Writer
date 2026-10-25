import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const CAMPAIGN_CORE_PATHS = Object.freeze([
  'src/types/writerCampaign.ts',
  'src/services/blobStore.ts',
  'src/services/writerCampaign/buildIdentity.ts',
  'src/services/writerCampaign/budget.ts',
  'src/services/writerCampaign/engine.ts',
  'src/services/writerCampaign/fixtureAdapter.ts',
  'src/services/writerCampaign/legacyProtocol.ts',
  'src/services/writerCampaign/legacyStore.ts',
  'src/services/writerCampaign/legacyTypes.ts',
  'src/services/writerCampaign/protocol.ts',
  'src/services/writerCampaign/storageAccounting.ts',
  'src/services/writerCampaign/store.ts',
].sort())

export function campaignBuildIdentity(root) {
  const sourceHashes = CAMPAIGN_CORE_PATHS.map(file => [file,
    createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')])
  const digest = createHash('sha256').update(JSON.stringify(sourceHashes)).digest('hex')
  let commit = null, tree = null
  try {
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    // An edited source tree is not represented by its parent commit. Its exact
    // core digest remains usable; commit/tree deliberately stay unknown.
    if (git(['status', '--porcelain', '--untracked-files=all']) === '') {
      const c = git(['rev-parse', 'HEAD']), t = git(['rev-parse', 'HEAD^{tree}'])
      if (/^[a-f0-9]{40}$/.test(c) && /^[a-f0-9]{40}$/.test(t)) { commit = c; tree = t }
    }
  } catch { /* Source archives can still use their exact core source digest. */ }
  return { runtimeIdentity: `campaign-core-sha256:${digest}`, source: { commit, tree } }
}
