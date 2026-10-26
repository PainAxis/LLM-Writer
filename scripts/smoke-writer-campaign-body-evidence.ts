/** Source/proposal tests, never semantic review. Crafted snapshots below exercise
 * the pure compiler only; only the initial fixture uses verified repository IO. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { CampaignArtifact, CampaignRepositoryIO, CampaignSnapshot } from '../src/types/writerCampaign'
import { createOfflineCampaignEngine, createOfflineCampaignManifest } from '../src/services/writerCampaign/engine'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { planningManifestOptions } from '../src/services/writerCampaign/planningProfile'
import { canonicalCampaignText, canonicalStringify, hashText, sealCampaignArtifact } from '../src/services/writerCampaign/protocol'
import { buildBodyEvidenceFixtureProposal } from '../src/services/writerCampaign/bodyEvidenceFixture'
import { compileBodyEvidence, deriveBodyEvidencePrefix } from '../src/services/writerCampaign/bodyEvidence'
import { BODY_EVIDENCE_LIMITS, BodyEvidenceRefusalError, parseBodyEvidenceProposal, type BodyEvidenceProposalEnvelope, type BodyEvidenceRefusalCode, type PlanningRecordIdentity } from '../src/services/writerCampaign/bodyEvidenceProtocol'

const identity = { runtimeIdentity: 'body-evidence-smoke-v1', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }
const now = 1_800_000_000_000, cases: string[] = []
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const artifactRef = (artifact: CampaignArtifact) => ({ taskId: artifact.taskId, revision: artifact.revision, hash: artifact.hash })
const refusal = (code?: BodyEvidenceRefusalCode) => (error: unknown) => error instanceof BodyEvidenceRefusalError && (!code || error.code === code)
function memoryIO() {
  const disk = new Map<string, string>(); let writes = 0
  const io: CampaignRepositoryIO = {
    async getMany(keys) { return new Map(keys.map(key => [key, disk.get(key) ?? null])) },
    async compareAndSwapMany(entries, canCommit = () => true) {
      if (!canCommit() || entries.some(row => disk.get(row.key) !== row.expectedValue && !(row.expectedValue === null && !disk.has(row.key)))) return false
      for (const row of entries) disk.set(row.key, row.value); writes++; return true
    },
  }
  return { io, disk, get writes() { return writes } }
}
async function fixture(language: 'zh' | 'en') {
  const storage = memoryIO(), repository = createCampaignRepository(storage.io)
  const engine = createOfflineCampaignEngine({ identity, clock: () => now, repository })
  const manifest = await createOfflineCampaignManifest(planningManifestOptions({ campaignId: `body-smoke-${language}`, language, identity, now, profile: 'body-evidence-three-chapter' }))
  let snapshot = await engine.prepare(manifest)
  for (let i = 0; i < 9; i++) snapshot = await engine.step(manifest.campaignId, `step-${i}`)
  assert.equal(snapshot.head.status, 'completed'); assert.equal(snapshot.checkpoint.tasks.filter(t => t.status === 'committed').length, 9)
  return { snapshot, engine, repository, storage }
}
async function generic(snapshot: CampaignSnapshot, k = 3): Promise<BodyEvidenceProposalEnvelope> {
  const prefix = await deriveBodyEvidencePrefix(snapshot, k)
  const spans = await Promise.all(prefix.bodyArtifacts.filter(artifact => artifact.text.length).map(async artifact => ({ id: `span.${artifact.taskId}`, artifact: artifactRef(artifact), startUtf16: 0, endUtf16: artifact.text.length, quote: artifact.text, quoteHash: await hashText(artifact.text) })))
  return { protocol: 'campaign-body-evidence-proposals-v1', purpose: 'local_author_continuity_preview', campaignId: prefix.campaignId, currentCandidateId: prefix.currentCandidateId,
    manifestHash: prefix.manifestHash, canonBaseRoot: prefix.canonBaseRoot, fullPlanRoot: prefix.fullPlanRoot, bodyPrefixRoot: prefix.bodyPrefixRoot, throughChapterOrdinal: k,
    producer: { kind: 'local_declaration', version: 'local-test-v1' }, spans, claims: [], examination: { status: 'not_run', windows: [] } }
}
async function changedBodies(original: CampaignSnapshot, bodies: string[]): Promise<CampaignSnapshot> {
  const snapshot = structuredClone(original)
  for (const [index, text] of bodies.entries()) {
    const task = snapshot.manifest.tasks.find(task => task.kind === 'chapter_body' && task.chapterOrdinal === index + 1)!
    const state = snapshot.checkpoint.tasks.find(state => state.taskId === task.id)!, old = snapshot.artifacts.get(state.artifact!.hash)!
    const { raw: _raw, canonical: _canonical, hash: _hash, ...fields } = old
    const artifact = await sealCampaignArtifact({ ...fields, text, dependencies: task.dependsOn.map(id => snapshot.checkpoint.tasks.find(state => state.taskId === id)!.artifact!) })
    snapshot.artifacts.set(artifact.hash, artifact); state.artifact = artifactRef(artifact)
  }
  return snapshot
}
function rawJSON(value: any): string { const sort = (item: any): any => Array.isArray(item) ? item.map(sort) : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])])) : item; return JSON.stringify(sort(value)) }
function mutated(raw: string, mutate: (wire: any) => void): string { const wire = JSON.parse(raw); mutate(wire); return rawJSON(wire) }
async function test(id: string, action: () => unknown | Promise<unknown>) { await action(); cases.push(id); console.log(`PASS ${id}`) }
async function main() {
  const originalFetch = globalThis.fetch; let fetchCalls = 0
  globalThis.fetch = async () => { fetchCalls++; throw new Error('network_disabled') }
  try {
    const both = { zh: await fixture('zh'), en: await fixture('en') }
    const en = both.en.snapshot, rich = await buildBodyEvidenceFixtureProposal(en, 3)
    const bad = (mutate: (wire: any) => void, code?: BodyEvidenceRefusalCode) => assert.rejects(compileBodyEvidence(en, mutated(rich, mutate)), refusal(code))
    for (const language of ['zh', 'en'] as const) await test(`bilingual_production_sources_${language}`, async () => {
      const { snapshot, storage, repository } = both[language], before = [...storage.disk.entries()], writes = storage.writes
      const raw = await buildBodyEvidenceFixtureProposal(snapshot, 3), compiled = await compileBodyEvidence(snapshot, raw)
      assert.equal(compiled.packetDigest, hash(compiled.packetText)); assert.equal(compiled.packetBytes, Buffer.byteLength(compiled.packetText)); assert.equal(compiled.packetUtf16, compiled.packetText.length)
      assert.equal(compiled.packet.claims.length, 15); assert.equal(compiled.coverage.supplied.status, 'complete'); assert.equal(compiled.coverage.examinedDeclaration.status, 'producer_declared')
      assert.deepEqual(compiled.coverage.semanticReview, { status: 'not_reviewed', reviewedUtf16Units: 0, relationCompleteness: 'not_assessed' })
      assert.equal(compiled.packet.claims.find(c => c.id === 'claim.contradictory')?.kind, 'world_assertion')
      assert.ok(compiled.packet.planning.records.length > 0); assert.equal(compiled.packet.planning.chapterOutlinesSupplied, 0); assert.equal(compiled.packet.planning.chapterOutlineScenesOmitted, 3)
      const again = await compileBodyEvidence((await repository.read(snapshot.manifest.campaignId))!, raw)
      assert.equal(again.packetText, compiled.packetText); assert.deepEqual([...storage.disk.entries()], before); assert.equal(storage.writes, writes)
    })
    await test('prefix_identity_and_omissions', async () => {
      const roots = []
      for (const k of [1, 2, 3]) {
        const raw = await buildBodyEvidenceFixtureProposal(en, k), result = await compileBodyEvidence(en, raw)
        roots.push(result.bodyPrefixRoot); assert.equal(result.coverage.availablePrefix.acceptedOutsidePrefix, 3 - k)
        assert.equal(result.packet.bodySources.length, k); assert.equal(result.packet.claims.some(c => c.id === 'claim.payoff'), k === 3)
      }
      assert.equal(new Set(roots).size, 3)
    })
    await test('empty_inventory_is_not_semantic_success', async () => {
      const wire = await generic(en); wire.spans = []
      const result = await compileBodyEvidence(en, canonicalStringify(wire))
      assert.equal(result.coverage.supplied.status, 'none'); assert.equal(result.coverage.supplied.coveredUtf16Units, 0); assert.equal(result.coverage.examinedDeclaration.status, 'not_run')
      assert.equal(result.coverage.semanticReview.status, 'not_reviewed'); assert.equal(result.packet.planning.suppliedRecordCount, 0)
      assert.ok(result.packet.planning.omittedRecordCount > 0); assert.ok(result.coverage.supplied.rows.every(r => r.gaps.length === 1))
    })
    await test('generic_unregistered_proposal_text_is_supported', async () => {
      const wire = await generic(en); wire.claims = [{ id: 'new.claim', kind: 'narrator_claim', statement: 'An arbitrary and unreviewed interpretation.', atChapterOrdinal: 1, anchorIds: ['span.b-1'], premiseClaimIds: [], planningRefs: [], payload: { reliability: 'unspecified' } }]
      const result = await compileBodyEvidence(en, canonicalStringify(wire)); assert.equal(result.packet.claims[0]!.statement, wire.claims[0]!.statement)
      assert.equal(result.packet.producer.kind, 'local_declaration'); assert.equal(result.coverage.semanticAdjudication, 'not_run')
    })
    for (const key of ['campaignId', 'currentCandidateId', 'manifestHash', 'canonBaseRoot', 'fullPlanRoot', 'bodyPrefixRoot']) await test(`identity_${key}`, () => bad(w => { w[key] = key.endsWith('Id') ? 'wrong-id' : 'f'.repeat(64) }, 'source_identity_mismatch'))
    for (const [id, mutate, code] of [
      ['unknown_protocol', (w: any) => { w.protocol = 'campaign-body-evidence-v2' }, 'unsupported_contract'],
      ['external_purpose', (w: any) => { w.purpose = 'provider_dispatch' }, 'unsupported_purpose'],
      ['extra_status', (w: any) => { w.semanticStatus = 'supported' }, 'invalid_envelope'],
      ['missing_field', (w: any) => { delete w.examination }, 'invalid_envelope'],
      ['duplicate_span', (w: any) => { w.spans.push(w.spans[0]) }, 'duplicate_identity'],
      ['duplicate_claim', (w: any) => { w.claims.push(w.claims[0]) }, 'duplicate_identity'],
      ['missing_anchor', (w: any) => { w.claims[0].anchorIds = ['absent'] }, 'missing_required_premise'],
      ['missing_premise', (w: any) => { w.claims[0].premiseClaimIds = ['absent'] }, 'missing_required_premise'],
      ['forged_quote', (w: any) => { w.spans[0].quote += 'x' }, 'quote_mismatch'],
      ['forged_quote_hash', (w: any) => { w.spans[0].quoteHash = 'f'.repeat(64) }, 'quote_hash_mismatch'],
      ['wrong_artifact_revision', (w: any) => { w.spans[0].artifact.revision++ }, 'source_identity_mismatch'],
      ['wrong_artifact_hash', (w: any) => { w.spans[0].artifact.hash = 'f'.repeat(64) }, 'source_identity_mismatch'],
      ['negative_offset', (w: any) => { w.spans[0].startUtf16 = -1 }, 'invalid_anchor'],
      ['fractional_offset', (w: any) => { w.spans[0].startUtf16 = 0.5 }, 'invalid_anchor'],
      ['zero_width', (w: any) => { w.spans[0].endUtf16 = w.spans[0].startUtf16 }, 'invalid_anchor'],
      ['overrun_offset', (w: any) => { w.spans[0].endUtf16 = 999999 }, 'invalid_anchor'],
      ['unknown_claim_kind', (w: any) => { w.claims[0].kind = 'established_fact' }, 'unsupported_relation'],
      ['extra_claim_status', (w: any) => { w.claims[0].supported = true }, 'invalid_envelope'],
      ['too_many_spans', (w: any) => { w.spans = Array.from({ length: 257 }, (_, i) => ({ ...w.spans.at(-1), id: `s${i}`, quote: 'x' })) }, 'envelope_budget_exceeded'],
      ['long_statement', (w: any) => { w.claims[0].statement = 'x'.repeat(513) }, 'proposal_budget_exceeded'],
    ] as const) await test(id, () => bad(mutate, code))
    await test('canonical_duplicate_keys_whitespace_and_surrogates', () => {
      assert.throws(() => parseBodyEvidenceProposal(` ${rich}`), refusal('invalid_envelope'))
      assert.throws(() => parseBodyEvidenceProposal(`{"protocol":"campaign-body-evidence-proposals-v1",${rich.slice(1)}`), refusal('invalid_envelope'))
      const wire = JSON.parse(rich); wire.claims[0].statement = '\ud800'; assert.throws(() => parseBodyEvidenceProposal(JSON.stringify(wire)), refusal('invalid_scalar_text'))
      assert.throws(() => parseBodyEvidenceProposal('x'.repeat(65537)), refusal('envelope_budget_exceeded'))
      assert.throws(() => parseBodyEvidenceProposal({}), refusal('invalid_envelope'))
    })
    await test('knowledge_subject_holder_and_state_type', async () => {
      const select = (w: any, id: string) => w.claims.find((c: any) => c.id === id)
      await bad(w => { select(w, 'claim.learn').payload.subjectFactRef = select(w, 'claim.belief').payload.subjectFactRef }, 'unsupported_subject')
      await bad(w => { select(w, 'claim.loss').payload.holderRef = select(w, 'claim.learn').payload.subjectFactRef }, 'unsupported_subject')
      await bad(w => { select(w, 'claim.loss').payload.changeKind = 'state'; select(w, 'claim.loss').payload.holderRef = select(w, 'claim.learn').payload.subjectFactRef }, 'unsupported_subject')
      await bad(w => { select(w, 'claim.learn').payload.holderRef.recordId = 'unplanned.person' }, 'unsupported_subject')
    })
    await test('typed_relation_all_premises_and_roles', async () => {
      await bad(w => { w.claims = w.claims.filter((c: any) => c.id !== 'claim.mark') }, 'missing_required_premise')
      await bad(w => { w.claims.find((c: any) => c.id === 'claim.payoff').payload.contextClaimIds.push('absent') }, 'missing_required_premise')
      await bad(w => { const p = w.claims.find((c: any) => c.id === 'claim.payoff').payload; p.payoffClaimIds = p.setupClaimIds }, 'unsupported_relation')
      await bad(w => { w.claims.find((c: any) => c.id === 'claim.payoff').anchorIds = ['span.3.ship'] }, 'missing_required_premise')
      await bad(w => { w.claims.find((c: any) => c.id === 'claim.loss').anchorIds = ['span.full.2'] }, 'missing_required_premise')
      await bad(w => { w.claims.find((c: any) => c.id === 'claim.payoff').payload.obligationRef.recordId = 'unplanned.obligation' }, 'unsupported_relation')
      const sameRole = mutated(rich, w => { w.claims.find((c: any) => c.id === 'claim.payoff').payload.contextClaimIds.push('claim.mark') })
      assert.equal((await compileBodyEvidence(en, sameRole)).packet.claims.length, 15)
    })
    await test('same_chapter_forward_premise_and_cycle', async () => {
      await bad(w => { w.claims.find((c: any) => c.id === 'claim.mark').premiseClaimIds = ['claim.record'] }, 'unsupported_relation')
      await bad(w => { w.claims.find((c: any) => c.id === 'claim.mark').premiseClaimIds = ['claim.recover'] }, 'unsupported_relation')
      await bad(w => { const a = w.claims.find((c: any) => c.id === 'claim.recover'), b = w.claims.find((c: any) => c.id === 'claim.contradictory'); a.premiseClaimIds = [b.id]; b.premiseClaimIds = [a.id] }, 'support_cycle')
    })
    await test('planning_closure_exact_records_complete_future_intent', async () => {
      const result = await compileBodyEvidence(en, rich), plan = result.packet.planning
      assert.equal(plan.suppliedRecordCount, plan.records.length)
      for (const row of plan.records) {
        assert.equal(row.recordId, row.value.id); assert.ok(plan.sources[row.sourceIndex])
      }
      assert.ok(plan.records.some(r => r.recordKind === 'transition'))
      await bad(w => { w.claims.find((c: any) => c.id === 'claim.learn').payload.subjectFactRef.artifact.hash = 'f'.repeat(64) }, 'unsupported_subject')
      await bad(w => { w.claims[0].planningRefs.push({ artifact: w.spans[0].artifact, recordKind: 'world_fact', recordId: 'fact.low_tide' }) }, 'invalid_reference')
    })
    await test('exact_unicode_original_offsets_and_v2_counting', async () => {
      const text = 'A\u030A\r\n中😀 \rZ &amp; A\u030A', snapshot = await changedBodies(en, [text, 'plain', 'tail'])
      const wire = await generic(snapshot)
      const result = await compileBodyEvidence(snapshot, canonicalStringify(wire))
      assert.equal(result.packet.spans[0]!.quote, text); assert.equal(result.packet.bodySources[0]!.rawBodyHash, hash(text))
      assert.equal(canonicalCampaignText(text), 'Å\n中😀 \rZ &amp; Å')
      const split = text.indexOf('😀') + 1
      for (const property of ['startUtf16', 'endUtf16']) {
        const badWire = structuredClone(wire); badWire.spans[0]![property as 'startUtf16'] = split
        await assert.rejects(compileBodyEvidence(snapshot, canonicalStringify(badWire)), refusal('invalid_anchor'))
      }
      const normalized = structuredClone(wire); normalized.spans[0]!.quote = canonicalCampaignText(text); normalized.spans[0]!.quoteHash = hash(normalized.spans[0]!.quote)
      await assert.rejects(compileBodyEvidence(snapshot, canonicalStringify(normalized)), refusal('quote_mismatch'))
    })
    await test('coverage_union_gaps_subset_and_repeated_literals', async () => {
      const snapshot = await changedBodies(en, ['abcabc😀xyz', 'b', 'c']), wire = await generic(snapshot)
      const ref = wire.spans[0]!.artifact
      wire.spans = await Promise.all([[0, 3], [2, 6], [8, 9], [9, 10], [0, 3]].map(async ([start, end], i) => ({ id: `p${i}`, artifact: ref, startUtf16: start!, endUtf16: end!, quote: snapshot.artifacts.get(ref.hash)!.text.slice(start, end), quoteHash: hash(snapshot.artifacts.get(ref.hash)!.text.slice(start, end)) })))
      wire.examination = { status: 'producer_declared', windows: [{ artifact: ref, startUtf16: 0, endUtf16: 6 }, { artifact: ref, startUtf16: 0, endUtf16: 3 }] }
      const result = await compileBodyEvidence(snapshot, canonicalStringify(wire))
      assert.deepEqual(result.coverage.supplied.rows[0]!.intervals, [[0, 6], [8, 10]]); assert.deepEqual(result.coverage.supplied.rows[0]!.gaps, [[6, 8], [10, 11]])
      assert.equal(result.coverage.supplied.coveredUtf16Units, 8)
      assert.equal(result.coverage.examinedDeclaration.status === 'producer_declared' && result.coverage.examinedDeclaration.declaredUtf16Units, 6)
      wire.examination.windows.push({ artifact: ref, startUtf16: 0, endUtf16: 8 })
      await assert.rejects(compileBodyEvidence(snapshot, canonicalStringify(wire)), refusal('invalid_coverage'))
    })
    await test('source_metrics_membership_lineage_and_prerequisites', async () => {
      const metric = structuredClone(en), task = metric.checkpoint.tasks.find(t => t.taskId === 'b-1')!; metric.artifacts.get(task.artifact!.hash)!.raw.hash = 'f'.repeat(64)
      await assert.rejects(deriveBodyEvidencePrefix(metric, 1), refusal('source_identity_mismatch'))
      const pending = structuredClone(en); pending.checkpoint.tasks.find(t => t.taskId === 'o-1')!.status = 'pending'
      await assert.rejects(deriveBodyEvidencePrefix(pending, 1), refusal('incomplete_plan'))
      const none = structuredClone(en); none.checkpoint.tasks.filter(t => t.taskId.startsWith('b-')).forEach(t => { t.status = 'invalidated' })
      await assert.rejects(deriveBodyEvidencePrefix(none, 1), refusal('no_accepted_body'))
      const gap = structuredClone(en); gap.checkpoint.tasks.find(t => t.taskId === 'b-2')!.status = 'invalidated'
      await assert.rejects(deriveBodyEvidencePrefix(gap, 3), refusal('noncontiguous_prefix'))
      const lineage = structuredClone(en); lineage.checkpoint.candidateId = 'candidate-new'
      const prefix = await deriveBodyEvidencePrefix(lineage, 3); assert.equal(prefix.currentCandidateId, 'candidate-new'); assert.equal(prefix.bodySources[0]!.artifactCandidateId, 'candidate-0')
      assert.notEqual(prefix.bodyPrefixRoot, (await deriveBodyEvidencePrefix(en, 3)).bodyPrefixRoot)
    })
    await test('outside_prefix_and_empty_source_denominators', async () => {
      const one = await generic(en, 1), all = await generic(en)
      one.spans.push(all.spans[1]!); await assert.rejects(compileBodyEvidence(en, canonicalStringify(one)), refusal('source_outside_prefix'))
      const empty = await changedBodies(en, ['', '', '']), wire = await generic(empty), result = await compileBodyEvidence(empty, canonicalStringify(wire))
      assert.equal(result.coverage.availablePrefix.totalUtf16Units, 0); assert.equal(result.coverage.supplied.status, 'none'); assert.ok(result.coverage.supplied.rows.every(r => r.gaps.length === 0))
    })
    await test('deterministic_order_and_exact_input_digest', async () => {
      const wire = JSON.parse(rich), baseline = await compileBodyEvidence(en, rich)
      wire.spans.reverse(); wire.claims.reverse(); const raw = canonicalStringify(wire), changed = await compileBodyEvidence(en, raw)
      assert.deepEqual(changed.packet.spans, baseline.packet.spans); assert.deepEqual(changed.packet.claims, baseline.packet.claims)
      assert.equal(changed.packet.proposalDigest, hash(raw)); assert.notEqual(changed.packetDigest, baseline.packetDigest)
    })
    await test('packet_aggregate_cap_and_hostile_dimensions', async () => {
      const snapshot = await changedBodies(en, ['x'.repeat(8192), 'y', 'z']), wire = await generic(snapshot)
      const base = wire.spans[0]!
      wire.spans = Array.from({ length: 7 }, (_, i) => ({ ...base, id: `s${i}` }))
      const raw = canonicalStringify(wire); assert.ok(Buffer.byteLength(raw) < BODY_EVIDENCE_LIMITS.envelopeBytes)
      // Add complete planning closure through explicit current planning records: retained in packet, not in input.
      const prefix = await deriveBodyEvidencePrefix(snapshot, 3)
      const refs: PlanningRecordIdentity[] = prefix.canon.records.slice(0, 16).map(row => ({ artifact: row.artifact, recordKind: row.recordKind, recordId: row.recordId }))
      wire.claims = [{ id: 'claim', kind: 'world_assertion', statement: 'unreviewed', atChapterOrdinal: 1, anchorIds: ['s0'], premiseClaimIds: [], planningRefs: refs, payload: { polarity: 'affirmed' } }]
      assert.ok(Buffer.byteLength(canonicalStringify(wire)) < BODY_EVIDENCE_LIMITS.envelopeBytes)
      await assert.rejects(compileBodyEvidence(snapshot, canonicalStringify(wire)), refusal('packet_budget_exceeded'))
      // Deterministic byte-boundary search, not timing retry or a changed ceiling.
      // All source body bytes stay fixed; only the last supplied exact prefix changes.
      let low = 1, high = 8192
      const last = wire.spans.at(-1)!
      const setLength = (length: number) => { last.endUtf16 = length; last.quote = 'x'.repeat(length); last.quoteHash = hash(last.quote) }
      while (low < high) {
        const middle = Math.ceil((low + high) / 2); setLength(middle)
        try { await compileBodyEvidence(snapshot, canonicalStringify(wire)); low = middle }
        catch (error) { assert.ok(refusal('packet_budget_exceeded')(error)); high = middle - 1 }
      }
      setLength(low)
      let atCap = await compileBodyEvidence(snapshot, canonicalStringify(wire))
      const slack = BODY_EVIDENCE_LIMITS.packetBytes - atCap.packetBytes
      assert.ok(slack <= 1)
      wire.claims[0]!.statement += 'x'.repeat(slack)
      atCap = await compileBodyEvidence(snapshot, canonicalStringify(wire))
      assert.equal(atCap.packetBytes, 65536); assert.equal(atCap.packetUtf16, 65536)
      wire.claims[0]!.statement += 'x'
      assert.ok(Buffer.byteLength(canonicalStringify(wire)) < BODY_EVIDENCE_LIMITS.envelopeBytes)
      await assert.rejects(compileBodyEvidence(snapshot, canonicalStringify(wire)), refusal('packet_budget_exceeded'))
      const empty = await generic(en); empty.spans = []
      for (const count of [128, 129]) {
        empty.claims = Array.from({ length: count }, (_, i) => ({ id: `c${i}`, kind: 'world_assertion', statement: 'x', atChapterOrdinal: 1, anchorIds: ['a'], premiseClaimIds: [], planningRefs: [], payload: { polarity: 'affirmed' } }))
        if (count === 128) assert.equal(parseBodyEvidenceProposal(canonicalStringify(empty)).claims.length, 128)
        else assert.throws(() => parseBodyEvidenceProposal(canonicalStringify(empty)), refusal('proposal_budget_exceeded'))
      }
      const depth = JSON.parse(rich); depth.extra = {}; let nested = depth.extra; for (let i = 0; i < 20; i++) { nested.a = {}; nested = nested.a }
      assert.throws(() => parseBodyEvidenceProposal(canonicalStringify(depth)), refusal('proposal_budget_exceeded'))
    })
    await test('exact_envelope_byte_utf16_and_collection_caps', async () => {
      const template = await generic(en); template.spans = []; template.claims = []
      const source = (await generic(en)).spans[0]!.artifact
      const tiny = (index: number, quote = 'x') => ({ id: `s${index}`, artifact: source, startUtf16: 0, endUtf16: quote.length, quote, quoteHash: 'a'.repeat(64) })
      for (const count of [256, 257]) {
        template.spans = Array.from({ length: count }, (_, i) => tiny(i))
        const raw = canonicalStringify(template); assert.ok(Buffer.byteLength(raw) < 65536)
        if (count === 256) assert.equal(parseBodyEvidenceProposal(raw).spans.length, 256)
        else assert.throws(() => parseBodyEvidenceProposal(raw), refusal('proposal_budget_exceeded'))
      }
      template.spans = []
      for (const count of [256, 257]) {
        template.examination = { status: 'producer_declared', windows: Array.from({ length: count }, () => ({ artifact: source, startUtf16: 0, endUtf16: 1 })) }
        const raw = canonicalStringify(template)
        if (count === 256) assert.equal(parseBodyEvidenceProposal(raw).examination.windows.length, 256)
        else assert.throws(() => parseBodyEvidenceProposal(raw), refusal('proposal_budget_exceeded'))
      }
      template.examination = { status: 'not_run', windows: [] }
      template.spans = [tiny(0, 'x'.repeat(8192))]
      assert.equal(parseBodyEvidenceProposal(canonicalStringify(template)).spans[0]!.quote.length, 8192)
      template.spans[0]!.quote += 'x'; template.spans[0]!.endUtf16++
      assert.throws(() => parseBodyEvidenceProposal(canonicalStringify(template)), refusal('proposal_budget_exceeded'))
      // Construct valid closed admission wires with exact ASCII and UTF-8 ceilings.
      for (const multibyte of [false, true]) {
        template.spans = Array.from({ length: 8 }, (_, i) => tiny(i, multibyte ? '中' : 'x'))
        for (let i = 0; i < 8; i++) {
          const row = template.spans[i]!, target = multibyte ? '中' : 'x'
          let lo = 1, hi = 8192
          while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2); row.quote = target.repeat(mid); row.endUtf16 = row.quote.length
            if (Buffer.byteLength(canonicalStringify(template)) <= 65536) lo = mid; else hi = mid - 1
          }
          row.quote = target.repeat(lo); row.endUtf16 = row.quote.length
        }
        let raw = canonicalStringify(template)
        const remaining = 65536 - Buffer.byteLength(raw)
        assert.ok(remaining >= 0 && remaining <= 2)
        template.spans.at(-1)!.quote += 'x'.repeat(remaining); template.spans.at(-1)!.endUtf16 = template.spans.at(-1)!.quote.length
        raw = canonicalStringify(template); assert.equal(Buffer.byteLength(raw), 65536); assert.ok(raw.length <= 65536)
        assert.equal(parseBodyEvidenceProposal(raw).spans.length, 8)
        template.spans.at(-1)!.quote += 'x'; template.spans.at(-1)!.endUtf16++
        assert.throws(() => parseBodyEvidenceProposal(canonicalStringify(template)), refusal('envelope_budget_exceeded'))
      }
    })
    await test('reference_and_edge_caps_count_each_declared_occurrence', async () => {
      const template = await generic(en); template.spans = []; template.claims = []
      const common = (index: number, count: number) => ({ id: `claim${index}`, kind: 'world_assertion' as const, statement: 'x', atChapterOrdinal: 1,
        anchorIds: Array.from({ length: count }, (_, i) => `a${i}`), premiseClaimIds: [], planningRefs: [], payload: { polarity: 'affirmed' as const } })
      template.claims = Array.from({ length: 64 }, (_, i) => common(i, 16))
      assert.equal(parseBodyEvidenceProposal(canonicalStringify(template)).claims.length, 64) // exactly1024 reference occurrences
      template.claims.push(common(64, 1))
      assert.throws(() => parseBodyEvidenceProposal(canonicalStringify(template)), refusal('proposal_budget_exceeded'))
      template.claims = [common(0, 17)]
      assert.throws(() => parseBodyEvidenceProposal(canonicalStringify(template)), refusal('proposal_budget_exceeded'))
      template.claims = [common(0, 1)]; template.claims[0]!.statement = 'x'.repeat(512)
      assert.equal(parseBodyEvidenceProposal(canonicalStringify(template)).claims[0]!.statement.length, 512)
    })
    await test('cooperative_cancellation_propagates_without_source_error_rewrite', async () => {
      for (const boundary of [1, 30, 600]) {
        let checks = 0
        await assert.rejects(compileBodyEvidence(en, rich, () => { if (++checks === boundary) throw new BodyEvidenceRefusalError('cancelled') }), refusal('cancelled'))
      }
    })
    for (const { engine } of Object.values(both)) engine.dispose()
    assert.equal(fetchCalls, 0)
    console.log(JSON.stringify({ status: 'passed', cases: cases.length, networkCalls: fetchCalls, scope: 'source_and_declared_structure_only', semanticReview: 'not_run' }))
  } finally { globalThis.fetch = originalFetch }
}
main().catch(error => { console.error(error instanceof BodyEvidenceRefusalError ? error.code : 'body_evidence_protocol_smoke_failed'); process.exitCode = 1 })
