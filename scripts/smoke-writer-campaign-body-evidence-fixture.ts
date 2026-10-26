/** Real short offline source runs. Proposals, including false interpretations, are not adjudicated. */
import assert from 'node:assert/strict'
import { createOfflineCampaignEngine, createOfflineCampaignManifest } from '../src/services/writerCampaign/engine'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { planningManifestOptions, planningFixtureBodyTarget, planningBodyFixture, BODY_EVIDENCE_THREE_CHAPTER_PROFILE } from '../src/services/writerCampaign/planningProfile'
import { buildBodyEvidenceFixtureProposal } from '../src/services/writerCampaign/bodyEvidenceFixture'
import { BODY_EVIDENCE_BODY_FIXTURES, bodyEvidenceFixtureBodyTarget } from '../src/services/writerCampaign/bodyEvidenceFixtureData'
import { compileBodyEvidence } from '../src/services/writerCampaign/bodyEvidence'
import { canonicalStringify, hashText } from '../src/services/writerCampaign/protocol'
import { createPlanningMemoryIO } from './fixtures/writer-campaign-planning-io'

const identity = { runtimeIdentity: 'controlled-body-evidence-fixture-v1', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }
let cases = 0
async function main() {
for (const language of ['zh', 'en'] as const) {
  const id = `body-fixture-${language}`, storage = createPlanningMemoryIO(), repository = createCampaignRepository(storage.io)
  let calls = 0
  const engine = createOfflineCampaignEngine({ identity, repository, fixture: { onDispatch() { calls++ } } })
  try {
    const manifest = await createOfflineCampaignManifest(planningManifestOptions({ campaignId: id, language, identity, profile: 'body-evidence-three-chapter' }))
    assert.equal(manifest.fixtureVersion, BODY_EVIDENCE_THREE_CHAPTER_PROFILE)
    assert.equal(manifest.tasks.length, 9)
    assert.equal(manifest.bodyTarget.characters, bodyEvidenceFixtureBodyTarget(language))
    for (let k = 1; k <= 3; k++) assert.equal(planningBodyFixture(manifest, k), BODY_EVIDENCE_BODY_FIXTURES[language][k - 1])
    await engine.prepare(manifest)
    for (let i = 0; i < 9; i++) await engine.step(id, `source-step-${i}`)
    const snapshot = (await repository.read(id))!
    assert.equal(snapshot.head.status, 'completed')
    assert.equal(snapshot.checkpoint.bodyCharacters, bodyEvidenceFixtureBodyTarget(language))
    assert.equal(calls, 9); cases++
    const before = storage.observe(), head = snapshot.rawHead, roots: string[] = []
    for (let k = 1; k <= 3; k++) {
      const raw = await buildBodyEvidenceFixtureProposal(snapshot, k)
      const compiled = await compileBodyEvidence(snapshot, raw)
      roots.push(compiled.bodyPrefixRoot)
      assert.equal(compiled.packet.coverage.supplied.status, 'complete')
      assert.equal(compiled.packet.coverage.examinedDeclaration.status, 'producer_declared')
      assert.equal(compiled.packet.coverage.semanticReview.status, 'not_reviewed')
      assert.equal(compiled.packet.coverage.semanticAdjudication, 'not_run')
      assert.equal(compiled.packet.coverage.availablePrefix.acceptedOutsidePrefix, 3 - k)
      assert.equal(compiled.packetText, (await compileBodyEvidence(snapshot, raw)).packetText)
      const preview = await engine.previewBodyEvidence(id, raw)
      assert.equal(preview.status, 'ready')
      if (preview.status !== 'ready') throw new Error('body_fixture_preview_required')
      assert.equal(preview.packetText, compiled.packetText)
      assert.equal(preview.packetDigest, await hashText(preview.packetText))
      assert.equal(preview.sourceHead.rawHeadHash, await hashText(head))
      const decoded = JSON.parse(raw)
      if (k === 3) {
        assert.ok(decoded.claims.some((claim: { id: string }) => claim.id === 'claim.contradictory'))
        assert.deepEqual(new Set(decoded.claims.map((claim: { kind: string }) => claim.kind)), new Set(['world_assertion', 'attributed_belief', 'narrator_claim', 'character_change', 'setup_payoff']))
        const relation = compiled.packet.claims.find(claim => claim.id === 'claim.payoff')!
        assert.equal(relation.kind, 'setup_payoff')
        if (relation.kind === 'setup_payoff') assert.deepEqual(relation.payload.contextClaimIds, ['claim.relearn'])
        assert.ok(compiled.packet.planning.suppliedRecordCount > 0)
      }
      assert.ok(preview.packetBytes <= 65536 && preview.packetUtf16 <= 65536); cases++
    }
    assert.equal(new Set(roots).size, 3)
    assert.equal((await repository.read(id))!.rawHead, head)
    assert.equal(storage.observe().committedTransactions, before.committedTransactions)
    assert.equal(storage.observe().cumulativeWrittenBytes, before.cumulativeWrittenBytes)
    assert.equal(calls, 9); cases++
  } finally { engine.dispose() }
  // Old profiles keep their graph/body target/literal response behavior for the same inputs.
  for (const profile of ['three-chapter', 'compact-60'] as const) {
    const manifest = await createOfflineCampaignManifest(planningManifestOptions({ campaignId: `old-${profile}-${language}`, language, identity, profile }))
    const count = profile === 'compact-60' ? 60 : 3
    assert.equal(manifest.bodyTarget.characters, planningFixtureBodyTarget(language, count))
    assert.equal(manifest.tasks.length, 3 + 2 * count)
    assert.equal(canonicalStringify(manifest.tasks), canonicalStringify((await createOfflineCampaignManifest(planningManifestOptions({ campaignId: `old-${profile}-${language}`, language, identity, profile, now: manifest.createdAt, expiresAt: manifest.expiresAt }))).tasks))
    cases++
  }
}
console.log(JSON.stringify({ status: 'pass', cases, semanticAdjudication: 'NOT_RUN', nativeExecution: 'NOT_RUN', liveModelCalls: 0 }))

}
main().catch(() => { console.error(`Body evidence fixture failed at bounded case ${cases + 1}; source details withheld.`); process.exitCode = 1 })
