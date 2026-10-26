/** Pure producer admission/compiler checks. No provider, durability or semantic-quality claim. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { CampaignRepositoryIO, CampaignSnapshot } from '../src/types/writerCampaign'
import type { BodyProducerCompileBinding } from '../src/types/bodyProducer'
import { createOfflineCampaignEngine, createOfflineCampaignManifest } from '../src/services/writerCampaign/engine'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { planningManifestOptions } from '../src/services/writerCampaign/planningProfile'
import { canonicalStringify, hashText, sealCampaignArtifact } from '../src/services/writerCampaign/protocol'
import { bodyEvidenceSourceView, compileBodyEvidence, deriveBodyEvidencePrefix, deriveBodyEvidencePrefixFromSource, type BodyEvidenceSourceView } from '../src/services/writerCampaign/bodyEvidence'
import { BodyEvidenceRefusalError } from '../src/services/writerCampaign/bodyEvidenceProtocol'
import { BODY_PRODUCER_LIMITS as L, BodyProducerRefusalError, parseBodyProducerOutput } from '../src/services/writerCampaign/bodyProducerProtocol'
import { compileProducedBodyEvidence, prepareBodyProducerInput, validatePreparedBodyProducerInput } from '../src/services/writerCampaign/bodyProducerEvidence'

const identity = { runtimeIdentity: 'body-producer-smoke-v1', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }
const now = 1_800_000_000_000, cases: string[] = []
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const binding: BodyProducerCompileBinding = { requestId: 'request-1', requestHash: '1'.repeat(64), responseHash: '2'.repeat(64), intentHash: '3'.repeat(64),
  aggregateManifestHash: '4'.repeat(64), sourceEpoch: 1,
  producer: { adapterId: 'generic-sdk', adapterVersion: 'v1', mode: 'offline_control', requestedModelId: 'synthetic', effectiveModelId: 'synthetic', configurationRevision: 'config-1', endpointIdentity: 'local-control' }, reportedModelId: null }
const refused = (error: unknown) => error instanceof BodyProducerRefusalError || error instanceof BodyEvidenceRefusalError
const empty = () => ({ protocol: 'body-producer-output-v1', items: [] as any[], saturated: false, examination: { status: 'not_declared', intervals: [] as any[] } })
const world = (quote: string) => ({ kind: 'world_assertion', statement: 'An intentionally unverified interpretation.', polarity: 'affirmed', spans: [{ startUtf16: 0, endUtf16: quote.length, quote }], subjects: [] as any[] })
async function fixture(language: 'zh' | 'en') {
  const disk = new Map<string, string>()
  const io: CampaignRepositoryIO = { async getMany(keys) { return new Map(keys.map(key => [key, disk.get(key) ?? null])) },
    async compareAndSwapMany(entries, canCommit = () => true) {
      if (!canCommit() || entries.some(row => (disk.get(row.key) ?? null) !== row.expectedValue)) return false
      for (const row of entries) disk.set(row.key, row.value)
      return true
    } }
  const repository = createCampaignRepository(io), engine = createOfflineCampaignEngine({ identity, clock: () => now, repository })
  const manifest = await createOfflineCampaignManifest(planningManifestOptions({ campaignId: `producer-smoke-${language}`, language, identity, now, profile: 'body-evidence-three-chapter' }))
  let snapshot = await engine.prepare(manifest)
  for (let i = 0; i < 9; i++) snapshot = await engine.step(manifest.campaignId, `step-${i}`)
  assert.equal(snapshot.head.status, 'completed'); return snapshot
}
/** Crafted source projection exercises only pure compiler admission. Store/native suites own real revision commits. */
async function changedView(snapshot: CampaignSnapshot, text: string): Promise<BodyEvidenceSourceView> {
  const source = bodyEvidenceSourceView(structuredClone(snapshot)), tasks = [...source.tasks], artifacts = new Map(source.artifacts)
  const task = tasks.find(row => row.taskId === 'b-1')!, old = artifacts.get(task.artifact!.hash)!
  const { hash: _hash, raw: _raw, canonical: _canonical, ...fields } = old
  const artifact = await sealCampaignArtifact({ ...fields, text, candidateId: 'manual-control', taskRevision: old.taskRevision + 1, revision: old.revision + 1, parentHash: old.hash })
  task.revision++; task.artifact = { taskId: artifact.taskId, revision: artifact.revision, hash: artifact.hash }; task.request = null
  artifacts.set(artifact.hash, artifact)
  for (const row of tasks.filter(row => ['b-2', 'b-3'].includes(row.taskId))) { row.revision++; row.status = 'invalidated'; row.priorArtifact = row.artifact; row.artifact = null; row.request = null }
  return { ...source, candidateId: 'manual-control', tasks, artifacts }
}
async function test(name: string, work: () => unknown | Promise<unknown>) { await work(); cases.push(name); console.log(`PASS ${name}`) }
async function main() {
  const originalFetch = globalThis.fetch; let networkCalls = 0
  globalThis.fetch = async () => { networkCalls++; throw new Error('network_disabled') }
  try {
    const snapshots = { zh: await fixture('zh'), en: await fixture('en') }
    const bodies = { zh: '阿遥在雨中拾起紫色钥匙。陌生客说：“潮水不会回来。”😀 e\u0301\r\n钥匙仍然冰冷。', en: 'Zora found a violet key in the rain. The stranger said, “The tide will not return.” 😀 e\u0301\r\nThe key stayed cold.' }
    const views = { zh: await changedView(snapshots.zh, bodies.zh), en: await changedView(snapshots.en, bodies.en) }
    for (const language of ['zh', 'en'] as const) {
      await test(`v1_byte_golden_${language}`, async () => {
        const snapshot = snapshots[language], prefix = await deriveBodyEvidencePrefix(snapshot, 1), artifact = prefix.bodyArtifacts[0]!
        const raw = canonicalStringify({ protocol: 'campaign-body-evidence-proposals-v1', purpose: 'local_author_continuity_preview', campaignId: prefix.campaignId,
          currentCandidateId: prefix.currentCandidateId, manifestHash: prefix.manifestHash, canonBaseRoot: prefix.canonBaseRoot, fullPlanRoot: prefix.fullPlanRoot,
          bodyPrefixRoot: prefix.bodyPrefixRoot, throughChapterOrdinal: 1, producer: { kind: 'local_declaration', version: 'v1-golden' },
          spans: [{ id: 'whole', artifact: prefix.bodySources[0]!.artifact, startUtf16: 0, endUtf16: artifact.text.length, quote: artifact.text, quoteHash: await hashText(artifact.text) }],
          claims: [], examination: { status: 'not_run', windows: [] } })
        const result = await compileBodyEvidence(snapshot, raw)
        // Independently obtained from accepted tree 3ef65b75, not this refactored implementation.
        assert.equal(result.packetDigest, language === 'zh' ? '0fd0a8827d1bdfde63780490614fe5df6f5a7a8fdc9258b9b876a5f9fcd7fd37' : '59423fc7a76e72a45fd2dff0f8865d57de468054ce05283a844aa214f25f1489')
        assert.equal(result.packetBytes, language === 'zh' ? 2808 : 2926)
      })
      await test(`dynamic_literal_input_and_provenance_${language}`, async () => {
        const text = bodies[language], prepared = await prepareBodyProducerInput(views[language], { chapterOrdinal: 1, startUtf16: 0, endUtf16: text.length, planningRefs: [] })
        const wire = JSON.parse(prepared.wire.prompt)
        assert.equal(wire.window.text, text); assert.deepEqual(wire.planningCatalog, [])
        assert.equal(prepared.inputDigest, hash(canonicalStringify(prepared.wire)))
        assert.equal(prepared.inputBytes, Buffer.byteLength(canonicalStringify(prepared.wire))); assert.equal(prepared.inputUtf16, canonicalStringify(prepared.wire).length)
        assert.equal(prepared.source.artifactCandidateId, 'manual-control')
        await validatePreparedBodyProducerInput(views[language], prepared)
        const output = empty(); output.items.push(world(text))
        const result = await compileProducedBodyEvidence(views[language], prepared, JSON.stringify(output), binding)
        assert.equal(result.packet.protocol, 'campaign-body-evidence-packet-v2'); assert.equal(result.packet.producer.kind, 'registered_producer')
        assert.equal(result.packet.producer.aggregateManifestHash, binding.aggregateManifestHash); assert.equal(result.packet.producer.sourceEpoch, 1)
        assert.equal(result.packet.producer.responseTextDigest, hash(JSON.stringify(output))); assert.equal(result.packet.producer.sourceManifestHash, snapshots[language].manifest.hash)
        assert.equal(result.compiledClaimCount, 1); assert.equal(result.packet.coverage.semanticReview.status, 'not_reviewed')
        assert.equal(result.packet.coverage.semanticAdjudication, 'not_run'); assert.equal(result.packet.inventory.scope, 'standalone_subset_only')
        assert.equal(result.packet.inventory.digest, hash(canonicalStringify(result.inventory)))
      })
    }
    const text = bodies.en, view = views.en
    const prepared = await prepareBodyProducerInput(view, { chapterOrdinal: 1, startUtf16: 0, endUtf16: text.length, planningRefs: [] })
    await test('counterfactual_and_lineage_invalidation', async () => {
      const changed = await changedView(snapshots.en, text.replace('violet', 'silver'))
      const next = await prepareBodyProducerInput(changed, { chapterOrdinal: 1, startUtf16: 0, endUtf16: text.length, planningRefs: [] })
      assert.notEqual(prepared.inputDigest, next.inputDigest); assert.notEqual(prepared.source.rawBodyHash, next.source.rawBodyHash)
      await assert.rejects(validatePreparedBodyProducerInput(changed, prepared), refused)
      const forged = structuredClone(prepared); forged.wire.prompt += ' '; await assert.rejects(validatePreparedBodyProducerInput(view, forged), refused)
      const extra = { ...prepared, approved: true }; await assert.rejects(validatePreparedBodyProducerInput(view, extra), refused)
    })
    await test('empty_and_saturated_are_not_no_facts_or_examination', async () => {
      const plain = await compileProducedBodyEvidence(view, prepared, JSON.stringify(empty()), binding)
      assert.equal(plain.responseItemCount, 0); assert.equal(plain.packet.coverage.supplied.coveredUtf16Units, text.length)
      assert.equal(plain.packet.coverage.examinedDeclaration.status, 'not_run'); assert.equal(plain.packet.coverage.semanticReview.status, 'not_reviewed')
      const output = empty(); output.saturated = true
      const result = await compileProducedBodyEvidence(view, prepared, JSON.stringify(output), binding)
      assert.equal(result.unresolvedObservationCount, 1); assert.equal(result.inventory.unresolved[0]!.reason, 'output_capacity')
      assert.equal(result.inventory.unresolved[0]!.omittedItemCount, null); assert.deepEqual(result.inventory.unresolved[0]!.anchorIds, ['producer.window'])
    })
    await test('unmapped_belief_subjects_and_unsupported_relations_stay_visible', async () => {
      const output = empty(), item = world(text)
      item.subjects = [{ spanIndex: 1, label: 'Zora', planningReference: null, role: 'holder' }]; output.items.push(item)
      output.items.push({ kind: 'attributed_belief', statement: 'Zora believes the tide will not return.', attitude: 'believes', holderReference: null, subjectFactReference: null, spans: item.spans, subjects: [] })
      for (const [reason, intendedKind] of [['character_change_out_of_scope', 'character_change'], ['setup_payoff_out_of_scope', 'setup_payoff'], ['ambiguous_attribution', 'other'], ['missing_body_premise', 'other']] as const)
        output.items.push({ kind: 'unresolved', reason, intendedKind, explanation: reason, spans: item.spans, subjects: [] })
      const result = await compileProducedBodyEvidence(view, prepared, JSON.stringify(output), binding)
      assert.equal(result.responseItemCount, 6); assert.equal(result.compiledClaimCount, 1); assert.equal(result.unresolvedObservationCount, 7)
      assert.equal(result.inventory.items.length, output.items.length); assert.equal(result.inventory.items[1]!.claimId, null)
      assert.equal(result.packet.spans.length, 7)
    })
    await test('selected_complete_planning_catalog_and_belief_types', async () => {
      const prefix = await deriveBodyEvidencePrefixFromSource(view, 1)
      const chosen = ['character', 'world_fact'].map(kind => prefix.canon.records.find(row => row.recordKind === kind)!)
      const refs = chosen.map(row => ({ artifact: row.artifact, recordKind: row.recordKind, recordId: row.recordId }))
      const withPlan = await prepareBodyProducerInput(view, { chapterOrdinal: 1, startUtf16: 0, endUtf16: text.length, planningRefs: refs })
      assert.ok(withPlan.catalog.length >= refs.length); assert.ok(withPlan.catalog.length <= L.planningRecords)
      await validatePreparedBodyProducerInput(view, withPlan)
      const character = withPlan.catalog.find(row => row.identity.recordKind === 'character'), fact = withPlan.catalog.find(row => row.identity.recordKind === 'world_fact')
      assert.ok(character && fact)
      const output = empty(); output.items.push({ kind: 'attributed_belief', statement: 'A proposed belief.', attitude: 'believes', holderReference: character.token, subjectFactReference: fact.token, spans: world(text).spans, subjects: [] })
      assert.equal((await compileProducedBodyEvidence(view, withPlan, JSON.stringify(output), binding)).compiledClaimCount, 1)
      output.items[0].holderReference = fact.token; await assert.rejects(compileProducedBodyEvidence(view, withPlan, JSON.stringify(output), binding), refused)
      output.items[0].holderReference = 32; await assert.rejects(compileProducedBodyEvidence(view, prepared, JSON.stringify(output), binding), refused)
    })
    await test('original_offsets_no_normalization_or_quote_relocation', async () => {
      const unicode = await changedView(snapshots.en, 'A😀e\u0301\r\nrepeat repeat')
      await assert.rejects(prepareBodyProducerInput(unicode, { chapterOrdinal: 1, startUtf16: 2, endUtf16: 4, planningRefs: [] }), refused)
      const p = await prepareBodyProducerInput(unicode, { chapterOrdinal: 1, startUtf16: 0, endUtf16: 20, planningRefs: [] })
      const output = empty(); output.items.push(world(p.window.text))
      output.items[0].spans[0].quote = p.window.text.normalize('NFC'); await assert.rejects(compileProducedBodyEvidence(unicode, p, JSON.stringify(output), binding), refused)
      output.items[0].spans = [{ startUtf16: 0, endUtf16: 6, quote: 'repeat' }]; await assert.rejects(compileProducedBodyEvidence(unicode, p, JSON.stringify(output), binding), refused)
      output.items[0].spans = [{ startUtf16: 1, endUtf16: 2, quote: '\ud83d' }]; await assert.rejects(compileProducedBodyEvidence(unicode, p, JSON.stringify(output), binding), refused)
    })
    await test('examined_declarations_remain_separate', async () => {
      const output = empty(); output.examination = { status: 'producer_declared', intervals: [{ startUtf16: 0, endUtf16: 10 }, { startUtf16: 5, endUtf16: 15 }] }
      const result = await compileProducedBodyEvidence(view, prepared, JSON.stringify(output), binding)
      assert.equal(result.packet.coverage.examinedDeclaration.declaredUtf16Units, 15)
      assert.equal(result.packet.coverage.examinedDeclaration.provenance, 'registered_producer_declaration')
      assert.equal(result.packet.coverage.examinedDeclaration.verification, 'range_and_identity_only')
      output.examination.intervals[1]!.endUtf16 = text.length + 1
      await assert.rejects(compileProducedBodyEvidence(view, prepared, JSON.stringify(output), binding), refused)
    })
    const badCases: Array<[string, (value: any) => void]> = [
      ['extra_root', v => { v.approved = true }], ['extra_provenance', v => { v.items[0].producer = 'trusted' }],
      ['missing_subjects', v => { delete v.items[0].subjects }], ['unknown_kind', v => { v.items[0].kind = 'character_change' }],
      ['fractional_offset', v => { v.items[0].spans[0].startUtf16 = 0.5 }], ['zero_width', v => { v.items[0].spans[0].endUtf16 = 0 }],
      ['unpaired_statement', v => { v.items[0].statement = '\ud800' }], ['whitespace_statement', v => { v.items[0].statement = '\u00a0\n' }],
      ['long_quote', v => { v.items[0].spans[0].quote = 'x'.repeat(513) }], ['duplicate_item', v => { v.items.push(structuredClone(v.items[0])) }],
      ['duplicate_span', v => { v.items[0].spans.push(structuredClone(v.items[0].spans[0])) }],
      ['invalid_subject_reference', v => { v.items[0].subjects = [{ spanIndex: 0, label: 'Zora', planningReference: null, role: 'holder' }] }],
      ['invalid_catalog_reference', v => { v.items[0].subjects = [{ spanIndex: 1, label: 'Zora', planningReference: -1, role: 'holder' }] }],
      ['unanchored_subject_label', v => { v.items[0].subjects = [{ spanIndex: 1, label: 'NOT PRESENT', planningReference: null, role: 'holder' }] }],
      ['not_declared_with_interval', v => { v.examination.intervals = [{ startUtf16: 0, endUtf16: 1 }] }],
      ['nonboolean_saturated', v => { v.saturated = 0 }],
    ]
    for (const [name, change] of badCases) await test(`parser_${name}`, () => { const value = empty(); value.items.push(world(text)); change(value); assert.throws(() => parseBodyProducerOutput(JSON.stringify(value)), refused) })
    await test('duplicate_keys_escaped_keys_size_depth_and_cooperative_cancel', () => {
      assert.throws(() => parseBodyProducerOutput('{"protocol":"body-producer-output-v1","items":[],"saturated":false,"satur\\u0061ted":true,"examination":{"status":"not_declared","intervals":[]}}'), refused)
      assert.throws(() => parseBodyProducerOutput('['.repeat(10) + '0' + ']'.repeat(10)), refused)
      assert.throws(() => parseBodyProducerOutput(' '.repeat(L.responseUtf16 + 1)), refused)
      const token = new Error('owner_cancelled'); assert.throws(() => parseBodyProducerOutput(JSON.stringify(empty()), () => { throw token }), error => error === token)
    })
    await test('parser_exact_depth_boundary_precedes_schema_admission', () => {
      const nested = (depth: number) => '['.repeat(depth) + '0' + ']'.repeat(depth)
      // Eight containers pass lexical capacity and then fail the closed root
      // schema. The ninth must fail capacity before JSON/schema admission.
      assert.throws(() => parseBodyProducerOutput(nested(L.depth)),
        error => error instanceof BodyProducerRefusalError && error.code === 'invalid_output')
      assert.throws(() => parseBodyProducerOutput(nested(L.depth + 1)),
        error => error instanceof BodyProducerRefusalError && error.code === 'output_capacity')
    })
    await test('collection_caps_duplicates_and_exact_whitespace_quotes', () => {
      const value = empty()
      for (let i = 0; i < 8; i++) value.items.push({ ...world('Z'), statement: `Observation ${i}`, spans: [{ startUtf16: 0, endUtf16: 1, quote: 'Z' }, { startUtf16: 1, endUtf16: 2, quote: 'o' }] })
      assert.equal(parseBodyProducerOutput(JSON.stringify(value)).items.length, 8)
      const tooManyItems = structuredClone(value); tooManyItems.items.push({ ...world('Z'), statement: 'Ninth' })
      assert.throws(() => parseBodyProducerOutput(JSON.stringify(tooManyItems)), refused)
      value.items[0].spans.push({ startUtf16: 2, endUtf16: 3, quote: 'r' }); assert.throws(() => parseBodyProducerOutput(JSON.stringify(value)), refused)
      const subjects = empty(); subjects.items.push(world('Zora'))
      const subject = { spanIndex: 1, label: 'Zora', planningReference: null, role: 'holder' }
      subjects.items[0].subjects = [subject, { ...subject }]; assert.throws(() => parseBodyProducerOutput(JSON.stringify(subjects)), refused)
      const intervals = empty(); intervals.examination = { status: 'producer_declared', intervals: [{ startUtf16: 0, endUtf16: 1 }, { startUtf16: 0, endUtf16: 1 }] }
      assert.throws(() => parseBodyProducerOutput(JSON.stringify(intervals)), refused)
      const whitespace = empty(); whitespace.items.push(world(' ')); assert.equal(parseBodyProducerOutput(JSON.stringify(whitespace)).items[0]!.spans[0]!.quote, ' ')
    })
    await test('input_window_limit_and_selection_admission', async () => {
      const maximum = await changedView(snapshots.en, 'x'.repeat(L.windowUtf16 + 1))
      const allowed = await prepareBodyProducerInput(maximum, { chapterOrdinal: 1, startUtf16: 0, endUtf16: L.windowUtf16, planningRefs: [] })
      assert.equal(allowed.window.text.length, L.windowUtf16)
      await assert.rejects(prepareBodyProducerInput(maximum, { chapterOrdinal: 1, startUtf16: 0, endUtf16: L.windowUtf16 + 1, planningRefs: [] }), refused)
      await assert.rejects(prepareBodyProducerInput(view, { chapterOrdinal: 1, startUtf16: 0, endUtf16: 1, planningRefs: [], hidden: true } as any), refused)
    })
    await test('closed_binding_and_review_digests', async () => {
      await assert.rejects(compileProducedBodyEvidence(view, prepared, JSON.stringify(empty()), { ...binding, sourceEpoch: -1 }), refused)
      const result = await compileProducedBodyEvidence(view, prepared, JSON.stringify(empty()), { ...binding, reportedModelId: 'endpoint-says-model' })
      assert.equal(result.packet.producer.producer.effectiveModelId, 'synthetic'); assert.equal(result.packet.producer.reportedModelId, 'endpoint-says-model')
      assert.equal(result.packetDigest, hash(result.packetText)); assert.equal(result.inventoryDigest, hash(canonicalStringify(result.inventory)))
      assert.ok(Buffer.byteLength(canonicalStringify(result)) <= L.reviewBytes)
    })
    assert.equal(networkCalls, 0)
    console.log(JSON.stringify({ status: 'passed', cases: cases.length, networkCalls, scope: 'pure_admission_and_compiler', semanticReview: 'not_run', durableOrNativeExecution: 'not_run' }))
  } finally { globalThis.fetch = originalFetch }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
