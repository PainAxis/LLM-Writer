/** Injected-IO control-flow unit only. Never writes a native report or claims browser execution. */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { campaignBuildIdentity } from './campaign-build-identity.mjs'
import { hashCampaignValue } from '../src/services/writerCampaign/protocol'
import { installNodeBodyEvidenceAuthorityGuard } from './fixtures/writer-campaign-body-evidence-authority.mjs'
import { createBodyEvidenceMemoryIO } from './fixtures/writer-campaign-body-evidence-io'
import { inspectBodyEvidenceReplacementControl, runBodyEvidenceReplacementControl } from './fixtures/writer-campaign-body-evidence-browser'

const identity = campaignBuildIdentity(fileURLToPath(new URL('../', import.meta.url)))
const guard = installNodeBodyEvidenceAuthorityGuard()
try {
  for (const language of ['zh', 'en'] as const) {
    const storage = createBodyEvidenceMemoryIO()
    const ports = { identity, io: storage.io, observe: storage.observe, authority: guard.snapshot,
      namespaceDigest: () => hashCampaignValue('body-evidence-node-control-namespace-v1', [...storage.rows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) }
    const result = await runBodyEvidenceReplacementControl(language, ports)
    assert.equal(result.status, 'pass', `Injected-IO ${language} control failed: ${result.refusalCode}`)
    assert.equal(result.setupFixtureInvocations, 9)
    assert.equal(result.rebuildFixtureInvocations, 3)
    assert.equal(result.explicitCommittedTransactions, 14)
    assert.equal(result.finalCommittedTransactions, 52)
    assert.equal(result.finalOperations, 52)
    assert.equal(result.finalAttempts, 12)
    assert.equal(result.previewInvocations, 5)
    assert.equal(result.previewCommitAttempts, 0)
    assert.equal(result.previewFixtureInvocations, 0)
    assert.equal(result.sourceChangeRefusal, 'source_changed')
    assert.equal(result.invalidatedPrefixRefusal, 'no_accepted_body')
    assert.equal(result.staleProposalRefusal, 'source_identity_mismatch')
    assert.notEqual(result.oldBodyPrefixRoot, result.newBodyPrefixRoot)
    assert.notEqual(result.oldFullPlanRoot, result.newFullPlanRoot)
    assert.equal(result.historicalPlanningAncestorCount, 5)
    assert.equal(result.historicalPlanningAncestorsVerified, true)
    assert.equal(result.coldProcessRestart, 'not_run')
    assert.equal(result.checks.filter(row => row.status === 'pass').length, 7)
    assert.equal(result.checks.find(row => row.id === 'cold_process_reopen')?.status, 'not_run')
    const before = storage.observe(), digest = await ports.namespaceDigest()
    // Reuse the bounded read-only control, but do not copy its native-wrapper
    // result into a report: these ports prove cold repository reopening only.
    await inspectBodyEvidenceReplacementControl(result, ports)
    assert.equal(storage.observe().committedTransactions, before.committedTransactions)
    assert.equal(storage.observe().cumulativeWrittenBytes, before.cumulativeWrittenBytes)
    assert.equal(await ports.namespaceDigest(), digest)
    assert.equal(result.coldProcessRestart, 'not_run')
  }
  assert.deepEqual(guard.snapshot(), { observed: true, networkEntries: 0, credentialEntries: 0, configurationReads: 0, ordinaryWriterMutations: 0, externalToolEntries: 0 })
  console.log('Body Evidence injected-IO replacement control: 2 languages passed; cold repository only; native/UI NOT RUN.')
} finally { guard.restore() }
