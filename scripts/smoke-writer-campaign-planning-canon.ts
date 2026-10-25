/** Pure structural contract probes. Fixture prose is neither autonomous generation nor semantic evidence. */
import assert from 'node:assert/strict'
import type { CampaignArtifact, CampaignManifest, CampaignTaskKind } from '../src/types/writerCampaign'
import { canonicalStringify, encodeStorageBytes, hashText, sealCampaignArtifact, sealCampaignManifest, utf8Bytes } from '../src/services/writerCampaign/protocol'
import { buildPlanningCanon, PlanningParseCache, planningArtifactRef, planningClosure } from '../src/services/writerCampaign/planningCanon'
import { PLANNING_LIMITS, PLANNING_STAGE_LIMITS, PlanningRefusalError, parsePlanningEnvelope, planningByteLength } from '../src/services/writerCampaign/planningProtocol'
import { planningFixtureResponse } from '../src/services/writerCampaign/planningFixture'
import { PLANNING_COMPACT_PROFILE, PLANNING_THREE_CHAPTER_PROFILE, planningFixtureBodyTarget, planningTasks } from '../src/services/writerCampaign/planningProfile'

async function main() {

let passed = 0
const test = async (name: string, action: () => unknown | Promise<unknown>) => { await action(); passed++; console.log(`PASS ${name}`) }
async function manifest(language: 'zh' | 'en', count: 3 | 60): Promise<CampaignManifest> {
  return sealCampaignManifest({ schemaVersion: 2, protocolVersion: 'campaign-v2', campaignId: `canon-${language}-${count}`, candidateId: 'candidate-0', language,
    bodyTarget: { unit: 'unicode_scalar', characters: planningFixtureBodyTarget(language, count) }, mode: 'offline_fixture', adapterId: 'offline-fixture-v1', fixtureVersion: count === 3 ? PLANNING_THREE_CHAPTER_PROFILE : PLANNING_COMPACT_PROFILE,
    countingVersion: 'crlf-lf-nfc-scalar-v1', runtimeIdentity: `campaign-core-sha256:${'0'.repeat(64)}`, source: { commit: '1'.repeat(40), tree: '2'.repeat(40) },
    createdAt: 1800000000000, expiresAt: 1800086400000, maxRepairRounds: 0, maxProviderRetries: 0, tasks: planningTasks(count),
    budget: { attempts: 128, inputBytes: 8388608, inputUtf16: 8388608, outputTokens: 8388608, reasoningTokens: 0, responseBytes: 8388608, activeMs: 1600000, artifacts: 256, operations: 2048 },
    storage: { limitBytes: encodeStorageBytes(67108864), recoveryReserveBytes: encodeStorageBytes(524288) } })
}
type Mutator = (envelope: any, taskId: string) => void
async function fixture(language: 'zh' | 'en' = 'en', count: 3 | 60 = 3, mutate?: Mutator) {
  const m = await manifest(language, count), artifacts: CampaignArtifact[] = [], cache = new PlanningParseCache()
  let canon = await buildPlanningCanon(m, artifacts, undefined, cache)
  for (const task of m.tasks.filter(task => task.kind !== 'chapter_body')) {
    const dependencies = task.dependsOn.map(id => artifacts.find(artifact => artifact.taskId === id)!)
    let text = planningFixtureResponse({ manifest: m, candidateId: m.candidateId, task, taskRevision: 0, dependencies })
    if (mutate) { const envelope = JSON.parse(text); mutate(envelope, task.id); text = canonicalStringify(envelope) }
    const artifact = await sealCampaignArtifact({ schemaVersion: 2, campaignId: m.campaignId, candidateId: m.candidateId, taskId: task.id, taskRevision: 0, revision: 0, kind: task.kind, dependencies: dependencies.map(planningArtifactRef), parentHash: null, text, semanticStatus: 'not_reviewed' })
    artifacts.push(artifact); canon = await buildPlanningCanon(m, artifacts, undefined, cache)
  }
  return { manifest: m, artifacts, canon }
}
const valid = await fixture()
const refusal = (code?: string) => (error: unknown) => error instanceof PlanningRefusalError && (!code || error.code === code)
const bad = (mutate: Mutator, code?: string) => assert.rejects(fixture('en', 3, mutate), refusal(code))
const local = (stage: CampaignTaskKind, mutate: (wire: any) => void) => {
  const artifact = valid.artifacts.find(a => a.kind === stage)!, wire = JSON.parse(artifact.text); mutate(wire)
  return () => parsePlanningEnvelope(canonicalStringify(wire), valid.manifest, valid.manifest.tasks.find(t => t.id === artifact.taskId)!, artifact.dependencies)
}
await test('bilingual rich and compact real planning topology', async () => {
  for (const language of ['zh', 'en'] as const) for (const count of [3, 60] as const) {
    const { artifacts, canon, manifest: m } = await fixture(language, count)
    assert.equal(artifacts.length, 3 + count); assert.ok(canon.canonBaseRoot && canon.fullPlanRoot && canon.globalCanon)
    assert.ok(canon.globalCanonBytes <= 32768); assert.ok(canon.planningBytes <= 512 * 1024)
    assert.equal(m.tasks.length, 3 + 2 * count)
    assert.equal(canonicalStringify(canon.globalCanon!.outline), canonicalStringify(JSON.parse(artifacts[0]!.text).payload))
    const again = await buildPlanningCanon(m, artifacts)
    assert.equal(again.fullPlanRoot, canon.fullPlanRoot)
    assert.equal(again.globalCanonBytes, Buffer.byteLength(canonicalStringify(canon.globalCanon)))
  }
})
await test('partial stages expose no invented roots', async () => {
  for (let n = 0; n < valid.artifacts.length; n++) {
    const c = await buildPlanningCanon(valid.manifest, valid.artifacts.slice(0, n))
    assert.equal(c.fullPlanRoot, null); assert.equal(c.canonBaseRoot === null, n < 3)
  }
})
await test('wire envelope closure and discriminators', () => {
  for (const kind of ['outline', 'character_bible', 'detailed_outline', 'chapter_outline'] as const) {
    for (const mutate of [(w: any) => { w.extra = 1 }, (w: any) => { delete w.language }, (w: any) => { w.protocol = 'campaign-plan-v2' }, (w: any) => { w.stage = 'chapter_body' }, (w: any) => { w.language = 'zh' }, (w: any) => { w.payload.extra = 1 }]) assert.throws(local(kind, mutate), refusal())
  }
})
await test('canonical spelling refuses duplicates fences trailing and alternate numbers', () => {
  const a = valid.artifacts[0]!, task = valid.manifest.tasks[0]!
  for (const raw of [`\`\`\`json\n${a.text}\n\`\`\``, `${a.text} trailing`, ` ${a.text}`, a.text.replace('{', '{"language":"en",'), a.text.replace('"ordinal":1', '"ordinal":1.0'), a.text.replace('"ordinal":1', '"ordinal":-1'), a.text.replace('"ordinal":1', '"ordinal":9007199254740992'), a.text.replace('"ordinal":1', '"ordinal":NaN')]) assert.throws(() => parsePlanningEnvelope(raw, valid.manifest, task, []), refusal())
})
await test('scalar and nested bounds', () => {
  assert.throws(local('outline', w => { w.payload.premise = '\ud800' }), /surrogate|invalid_planning_payload/)
  assert.throws(local('outline', w => { w.payload.premise = 'x'.repeat(1025) }), refusal())
  assert.throws(local('outline', w => { w.payload.genreRules = Array(17).fill(w.payload.genreRules[0]) }), refusal())
  let deep: unknown = null; for (let i = 0; i < 14; i++) deep = [deep]
  assert.throws(local('outline', w => { w.payload.deep = deep }), refusal('planning_budget_exceeded'))
})
await test('byte helper exact caps UTF8 UTF16 escaping and combining', () => {
  const caps = new Set([...Object.values(PLANNING_STAGE_LIMITS).flatMap(v => [v.inputBytes, v.responseBytes]), PLANNING_LIMITS.globalCanonBytes, PLANNING_LIMITS.activeTextBytes])
  for (const cap of caps) { assert.equal(planningByteLength('x'.repeat(cap), cap), cap); assert.throws(() => planningByteLength('x'.repeat(cap + 1), cap), refusal('planning_budget_exceeded')) }
  for (const s of ['中', '😀', 'e\u0301', '\n"\\\t', '\u0001']) { assert.equal(planningByteLength(s, 1024), Buffer.byteLength(s)); assert.equal(utf8Bytes(canonicalStringify({ s })), Buffer.byteLength(JSON.stringify({ s }))) }
})
await test('valid outline response binds at exactly8192 bytes without truncation', async () => {
  const wire = JSON.parse(valid.artifacts[0]!.text); wire.payload.premise = 'x'
  let i = 0
  while (Buffer.byteLength(canonicalStringify(wire)) < 8192 - 600) wire.payload.loreEntities.push({ id: `lore.pad${i++}`, entityKind: 'place', name: 'P', description: 'x'.repeat(400), invariantFactRefs: [] })
  const remaining = 8192 - Buffer.byteLength(canonicalStringify(wire)); assert.ok(remaining >= 0 && remaining < 1024)
  wire.payload.premise += 'x'.repeat(remaining)
  const text = canonicalStringify(wire); assert.equal(Buffer.byteLength(text), 8192)
  parsePlanningEnvelope(text, valid.manifest, valid.manifest.tasks[0]!, [])
  wire.payload.premise += 'x'; assert.throws(() => parsePlanningEnvelope(canonicalStringify(wire), valid.manifest, valid.manifest.tasks[0]!, []), refusal('planning_budget_exceeded'))
})
await test('complete global canon exact32768-byte cap outranks valid stage caps', async () => {
  const padded = async (target: number) => {
    let remaining = target - valid.canon.globalCanonBytes
    const result = await fixture('en', 3, (wire, taskId) => {
      if (!['outline', 'characters', 'details'].includes(taskId)) return
      const stageCap = PLANNING_STAGE_LIMITS[wire.stage as keyof typeof PLANNING_STAGE_LIMITS].responseBytes
      const append = (holder: Record<string, any>, field: string, limit: number) => {
        const room = Math.min(remaining, limit - holder[field].length, stageCap - Buffer.byteLength(canonicalStringify(wire)))
        if (room > 0) { holder[field] += 'x'.repeat(room); remaining -= room }
      }
      const walk = (value: any) => {
        if (!value || typeof value !== 'object') return
        for (const [key, child] of Object.entries(value)) {
          if (typeof child === 'string' && ['premise', 'endingIntent', 'statement', 'description', 'role', 'motivation', 'summary', 'claimText', 'name'].includes(key)) append(value, key, ['premise', 'endingIntent'].includes(key) ? 1024 : key === 'name' ? 128 : 512)
          else if (typeof child === 'object') walk(child)
        }
      }
      walk(wire.payload)
      if (taskId === 'outline') {
        while (remaining > 100 && wire.payload.loreEntities.length < 48 && Buffer.byteLength(canonicalStringify(wire)) < stageCap - 600) {
          const before = Buffer.byteLength(canonicalStringify(wire))
          const row = { id: `lore.padding${wire.payload.loreEntities.length}`, entityKind: 'place', name: 'P', description: 'x', invariantFactRefs: [] }
          wire.payload.loreEntities.push(row); remaining -= Buffer.byteLength(canonicalStringify(wire)) - before
          append(row, 'description', 512)
        }
      }
      if (taskId === 'characters') for (const character of wire.payload.characters) for (const field of ['identityInvariants', 'capabilityInvariants']) {
        const list = character[field]
        while (remaining > 3 && list.length < 8 && Buffer.byteLength(canonicalStringify(wire)) < stageCap - 4) {
          const before = Buffer.byteLength(canonicalStringify(wire)); list.push('x'); remaining -= Buffer.byteLength(canonicalStringify(wire)) - before
          append(list, String(list.length - 1), 512)
        }
      }
    })
    assert.equal(remaining, 0)
    return result
  }
  const exact = await padded(32768); assert.equal(exact.canon.globalCanonBytes, 32768)
  await assert.rejects(padded(32769), refusal('canon_budget_exceeded'))
})
await test('N60 partial canon refuses provably impossible completion before detailed dispatch', async () => {
  let latestStage = ''
  await assert.rejects(fixture('en', 60, (wire, taskId) => {
    latestStage = taskId
    if (taskId === 'outline') {
      wire.payload.premise = 'x'.repeat(1024); wire.payload.endingIntent = 'x'.repeat(1024)
      while (Buffer.byteLength(canonicalStringify(wire)) < 7600) wire.payload.loreEntities.push({ id: `lore.fill${wire.payload.loreEntities.length}`, entityKind: 'place', name: 'P', description: 'x'.repeat(400), invariantFactRefs: [] })
    }
    if (taskId === 'characters') {
      const character = wire.payload.characters[0]
      character.motivation = 'x'.repeat(512); character.role = 'x'.repeat(512)
      character.identityInvariants = Array(8).fill('x'.repeat(512)); character.capabilityInvariants = Array(8).fill('x'.repeat(512))
      // A second independent fully modeled character fills the still-valid bible envelope.
      const other = structuredClone(character); other.id = 'char.extra'; other.initialStateRef.recordId = 'state.extra'; other.initialEpistemicRefs = []
      other.identityInvariants = ['x']; other.capabilityInvariants = ['x']; wire.payload.characters.push(other)
      const state = structuredClone(wire.payload.characterStates[0]); state.id = 'state.extra'; state.characterRef.recordId = 'char.extra'; wire.payload.characterStates.push(state)
      for (const field of ['identityInvariants', 'capabilityInvariants']) while (other[field].length < 8 && Buffer.byteLength(canonicalStringify(wire)) < 15800) other[field].push('x'.repeat(400))
    }
  }), refusal('canon_budget_exceeded'))
  assert.equal(latestStage, 'characters', 'do not reserve or generate detailed output when its minimum mandatory structure already cannot fit')
})
await test('duplicate and nonexistent record IDs refused', async () => {
  await bad((w, id) => { if (id === 'outline') w.payload.genreRules.push(w.payload.genreRules[0]) }, 'invalid_planning_reference')
  await bad((w, id) => { if (id === 'characters') w.payload.characters[0].initialStateRef.recordId = 'state.missing' }, 'invalid_planning_reference')
})
await test('scene identifiers remain unique across active planning artifacts', async () => {
  await bad((w, id) => { if (id === 'o-2') w.payload.scenes[0].id = 'scene.1' }, 'invalid_planning_reference')
  await bad((w, id) => { if (id === 'o-1') w.payload.scenes[0].id = 'char.keeper' }, 'invalid_planning_reference')
})
await test('scalar-valid planning fields preserve exact escaped and decomposed data', async () => {
  const literal = '中😀e\u0301\n"\\\t\u0001'
  const result = await fixture('en', 3, (w, id) => { if (id === 'outline') w.payload.premise = literal })
  assert.equal(result.canon.globalCanon!.outline.premise, literal)
  for (const artifact of result.artifacts) assert.equal(artifact.raw.utf8Bytes, Buffer.byteLength(artifact.text))
})
await test('source revision hash kind task and dependency order cannot alias', async () => {
  for (const patch of [{ hash: 'f'.repeat(64) }, { revision: 1 }, { taskId: 'characters' }]) await bad((w, id) => { if (id === 'characters') Object.assign(w.payload.epistemicStates[0].subjectFactRef.artifact, patch) })
  await bad((w, id) => { if (id === 'characters') w.payload.epistemicStates[0].subjectFactRef.recordKind = 'character' })
  await bad((w, id) => { if (id === 'details') w.dependencies.reverse() }, 'source_identity_mismatch')
  const foreign = structuredClone(valid.artifacts); foreign[0]!.campaignId = 'other'
  await assert.rejects(buildPlanningCanon(valid.manifest, foreign), refusal('source_identity_mismatch'))
})
await test('ancestor refs cannot be smuggled as self and vice versa', async () => {
  await bad((w, id) => { if (id === 'characters') { w.payload.epistemicStates[0].subjectFactRef.source = 'self'; w.payload.epistemicStates[0].subjectFactRef.artifact = null } }, 'invalid_planning_reference')
  await bad((w, id) => { if (id === 'outline') w.payload.worldFacts[0].subjectRefs[0].artifact = { taskId: 'outline', revision: 0, hash: '0'.repeat(64) } })
})
await test('causal cycle and reverse chronology refused', async () => {
  await bad((w, id) => { if (id === 'details') w.payload.beats[0].causalPredecessorRefs = [{ source: 'self', artifact: null, recordKind: 'beat', recordId: 'beat.recover' }] }, 'invalid_planning_schedule')
  await bad((w, id) => { if (id === 'details') { w.payload.beats[0].order = 4; w.payload.beats[3].order = 1; w.payload.beats.forEach((b: any) => { b.causalPredecessorRefs = [] }) } }, 'invalid_planning_schedule')
})
await test('scene chronological assignment cannot reverse or reorder final beats', async () => {
  await bad((w, id) => { if (id === 'o-1') w.payload.scenes[0].beatRefs.reverse() }, 'invalid_planning_schedule')
  await bad((w, id) => { if (id === 'o-1') { const s = w.payload.scenes[0]; w.payload.scenes = [{ ...s, beatRefs: [s.beatRefs[1]] }, { ...s, id: 'scene.second', order: 2, beatRefs: [s.beatRefs[0]] }] } }, 'invalid_planning_schedule')
})
await test('end-of-chapter knowledge remains old throughK and startsK+1', async () => {
  await bad((w, id) => { if (id === 'o-2') w.payload.scenes[0].epistemicRefs[0].recordId = 'know.keeper_after' }, 'invalid_planning_schedule')
  await bad((w, id) => { if (id === 'characters') w.payload.epistemicStates[1].validFrom.ordinal = 2 }, 'invalid_planning_schedule')
  await bad((w, id) => { if (id === 'characters') w.payload.transitions[1].holderRef.recordId = 'char.recorder' }, 'invalid_planning_schedule')
  await bad((w, id) => { if (id === 'characters') w.payload.transitions[1].toRef.recordId = 'know.keeper_before' }, 'invalid_planning_schedule')
})
await test('detached initial and silently appearing epistemic states refused', async () => {
  await bad((w, id) => { if (id === 'characters') w.payload.characters[0].initialEpistemicRefs = [] }, 'invalid_planning_schedule')
  await bad((w, id) => { if (id === 'characters') { const row = w.payload.epistemicStates[3]; row.validFrom = { ordinal: 2, outlineTaskId: 'o-2', bodyTaskId: 'b-2' } } }, 'invalid_planning_schedule')
})
await test('missing and contradictory transition support refused', async () => {
  await bad((w, id) => { if (id === 'details') w.payload.transitionBindings.pop() }, 'invalid_planning_schedule')
  await bad((w, id) => { if (id === 'details') w.payload.transitionBindings[0].supportingBeatRefs[0].recordId = 'beat.bell_mark' }, 'invalid_planning_schedule')
  await bad((w, id) => { if (id === 'details') w.payload.chapters[1].requiredTransitionRefs = [] }, 'invalid_planning_schedule')
})
await test('obligations retain all setups payoffs due assignments and original open declaration', async () => {
  await bad((w, id) => { if (id === 'details') w.payload.obligations[0].setupRefs[0].recordId = 'beat.recover' }, 'invalid_planning_schedule')
  await bad((w, id) => { if (id === 'details') w.payload.obligations[1].openThreadRef.recordId = 'open.invented' }, 'invalid_planning_reference')
  await bad((w, id) => { if (id === 'details') w.payload.chapters[2].obligationRefs = [] }, 'invalid_planning_schedule')
  await bad((w, id) => { if (id === 'o-1') w.payload.scenes[0].setupObligationRefs = [] }, 'invalid_planning_schedule')
})
await test('additional reference reason types are closed', async () => {
  await bad((w, id) => { if (id === 'o-1') w.payload.additionalRefs[0].reason = 'ignore_missing_records' })
  await bad((w, id) => { if (id === 'o-1') w.payload.additionalRefs[0].reason = 'character_context' })
})
await test('cyclic lore adjacency closure includes all multi-premise values', () => {
  const obligation = valid.canon.records.find(row => row.recordId === 'obligation.recovery')!
  const closure = planningClosure(valid.canon, [{ ref: { source: 'self', artifact: null, recordKind: 'obligation', recordId: obligation.recordId }, ownerArtifact: obligation.artifact }])
  for (const id of ['beat.bell_mark', 'beat.tide_note', 'beat.recover', 'fact.low_tide', 'know.keeper_after']) assert.ok(closure.some(row => row.recordId === id))
  assert.equal(new Set(closure.map(row => row.key)).size, closure.length)
})
await test('cache keys exact text and returns immutable parsed values', async () => {
  const cache = new PlanningParseCache(), artifacts = structuredClone(valid.artifacts)
  const before = await buildPlanningCanon(valid.manifest, artifacts, undefined, cache)
  assert.throws(() => { (before.envelopes.get('outline')!.payload as { premise: string }).premise = 'mutated' }, TypeError)
  const envelope = JSON.parse(artifacts[0]!.text); envelope.payload.extra = true; artifacts[0]!.text = canonicalStringify(envelope)
  await assert.rejects(buildPlanningCanon(valid.manifest, artifacts, undefined, cache), refusal())
})
await test('cancellation checks surround parse closure roots and serialization work', async () => {
  let checks = 0
  await assert.rejects(buildPlanningCanon(valid.manifest, valid.artifacts, () => { if (++checks === 20) throw new PlanningRefusalError('planning_cancelled') }), refusal('planning_cancelled'))
  assert.equal(checks, 20)
})
await test('semantic contradiction is deliberately not structurally graded', async () => {
  const { canon, artifacts } = await fixture('en', 3, (w, id) => { if (id === 'characters') w.payload.characters[0].motivation = 'Abandon every returning boat despite the declared motivation.' })
  assert.ok(canon.fullPlanRoot); assert.ok(artifacts.every(artifact => artifact.semanticStatus === 'not_reviewed'))
  assert.notEqual(canon.fullPlanRoot, valid.canon.fullPlanRoot)
})
await test('fixed canonical identity vectors', async () => {
  const zh = await fixture('zh')
  const observed = { en: { outline: await hashText(valid.artifacts[0]!.text), canonBaseRoot: valid.canon.canonBaseRoot, fullPlanRoot: valid.canon.fullPlanRoot }, zh: { outline: await hashText(zh.artifacts[0]!.text), canonBaseRoot: zh.canon.canonBaseRoot, fullPlanRoot: zh.canon.fullPlanRoot } }
  assert.deepEqual(observed, { en: { outline: '508487179838aa1ae478aa9be9a4b28b91453782aa98d64e742d7986b6b0ed37', canonBaseRoot: '82b0b709eae2e752955ab88ae4bb79b85361b7534b2fdf5f796076ea7e8e2d4b', fullPlanRoot: '3542bd94fd287d9e4111431816d98013a8369d458b591537700d070ed15e216b' }, zh: { outline: '5381fa2e58c35945305f904cdeb261835ca4587cf7c9ebb4713c3585294ce651', canonBaseRoot: 'b2b7cf51ad86fa731a3c0861c60460a7a04b89ea41b375435657bed3c7273660', fullPlanRoot: '91b03b3d497964afca5f6247c9bcc47311a6a29652527ac707507b9ec65b2971' } })
})
console.log(JSON.stringify({ status: 'pass', cases: passed, semanticConsistency: 'not_reviewed', liveModelCalls: 0 }))
}
try { await main() } catch { process.stderr.write('planning_canon_assertion_failed\n'); process.exitCode = 1 }
