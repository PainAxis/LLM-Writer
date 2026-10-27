/** Source-only identity sensitivity. No build, SDK, browser or production source mutation. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { campaignBuildIdentity, CAMPAIGN_CORE_PATHS } from './campaign-build-identity.mjs'
const root = process.cwd(), temp = await mkdtemp(path.join(tmpdir(), 'creative-identity-'))
const changed = ['src/services/writerCampaign/creativePilotEngine.ts', 'src/services/writerCampaign/creativePilotTransport.ts', 'src/services/writerCampaign/creativePilotCompiler.ts']
try {
  assert.equal(new Set(CAMPAIGN_CORE_PATHS).size, CAMPAIGN_CORE_PATHS.length)
  for (const file of CAMPAIGN_CORE_PATHS) { const target = path.join(temp, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, await readFile(path.join(root, file))) }
  const original = campaignBuildIdentity(temp)
  assert.deepEqual(original.source, { commit: null, tree: null })
  for (const file of changed) {
    const target = path.join(temp, file), before = await readFile(target)
    await writeFile(target, Buffer.concat([before, Buffer.from('\n// controlled source-only identity witness\n')]))
    const edited = campaignBuildIdentity(temp)
    assert.deepEqual(edited.source, { commit: null, tree: null })
    assert.notEqual(edited.runtimeIdentity, original.runtimeIdentity)
    await writeFile(target, before)
    assert.deepEqual(campaignBuildIdentity(temp), original)
  }
  console.log(JSON.stringify({ status: 'pass', sourceOnly: true, nullCommitTree: true, changedModules: changed.length, sdkCalls: 0 }))
} finally { await rm(temp, { recursive: true, force: true }) }
