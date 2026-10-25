/** Literal packet identities and independent byte oracles. Offline structural tests only. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { CampaignArtifact, CampaignArtifactRef, CampaignTaskSpec } from '../src/types/writerCampaign'
import type { CampaignProviderContext } from '../src/services/writerCampaign/fixtureAdapter'
import { createOfflineCampaignManifest } from '../src/services/writerCampaign/engine'
import { buildPlanningCanon } from '../src/services/writerCampaign/planningCanon'
import { compilePlanningContext, planningContextMetrics } from '../src/services/writerCampaign/planningContext'
import { planningFixtureResponse } from '../src/services/writerCampaign/planningFixture'
import { isPlanningProfile, planningManifestOptions, planningFixtureBodyTarget, validatePlanningProfile, type PlanningProfileName } from '../src/services/writerCampaign/planningProfile'
import { PLANNING_STAGE_LIMITS, PlanningRefusalError, type PlanningRefusalCode } from '../src/services/writerCampaign/planningProtocol'
import { canonicalStringify, sealCampaignArtifact, sealCampaignManifest } from '../src/services/writerCampaign/protocol'

async function main() {

const identity = { runtimeIdentity: `campaign-core-sha256:${'0'.repeat(64)}`, source: { commit: null, tree: null } }
const now = 1700000000000
const expected = {
  "three-chapter": {
    "zh": [
      "e822ed85ff3a470181af808a9f546a2bf9ae5adbdfdf73672b7d9f9c9c0d56b6",
      "0fb63c8ff1be967bce95a58af797cab0f102e5f1a419a787155d559b3644a7d3",
      "c2595b52589e021a4fb0b091c24042c69f74c3004e9da0b50a0352717b2bf711",
      "c40795c4049412ba92e1d44975eb99b318558880ba0591b79b5e516bcdb6b8cd"
    ],
    "en": [
      "d9451d4686fd8b9d8beece8a8ffc4f2ef408fa367d20744e1dabe938f55fe24b",
      "fdbea1bcc7dd7250a8ee979fcd09d4b93c35cce7eb195c2e9598494f03ab4ca3",
      "34da18001fe1e4afc566febbcdb46f6b199f771f70aaf2d94ae0a88d18f86325",
      "62536483c18b088292a7cf1c4e83a5733798fb9b92d8170c4650f680d7bab65c"
    ]
  },
  "compact-60": {
    "zh": [
      "dccb213970b891341c9eea800572863e5b73c150cffef9544f1f3e59d7cd1c41",
      "4083ca746e6e10b2f7b91aa4d01fbc31a29fce6640ad037a9e77f22bc136abb5",
      "92ccf6d964b96c53a1096041c5adaac52affd4d671b7259cd86095718a87fc8d",
      "23d44a15352d84f1a9f03cee6ac6ff29da1b71078530c4098deb4b016ac7baa5"
    ],
    "en": [
      "afa893211794fd0d5ed62e04d1904e07b62a05064692cd9957c216880f4deaa6",
      "1f80376e356dda774fe01ffabce6a0535883074f83438568206a6cd1a67797e1",
      "8ceccc7d81c6effdf75dfe19de4d2f6cd3bb315adb0f165986a56b767f7fda99",
      "bb04d9f12020de33ed13ccbb4a33faba7c534d7db2699f33ba2fecc037d99618"
    ]
  }
} as const
const expectedPlanningArtifactHashes = {
  "three-chapter": {
    "zh": {
      "outline": "35769ccd69724ce9c8f5a65de571f710daca53960c1f80ebdce9d915a7dd3119",
      "characters": "8d7e3c79c4c4c817a30ad994f1097a9959ffab928f9e83c937a280d16638e3cb",
      "details": "c9ce867b5816eb2e88d0592b1e90bcfd4d25a1e79047b794bfce432e8bb9ada4",
      "o-1": "1d29ca7815fec6d9ff649075de4568524b0c1e612a77dab0e4fa1a46b4fb380f"
    },
    "en": {
      "outline": "3635b9e2ee63c0ae2b9c0b5ae616df98b1866e1faaff83bbef08edac44e42bcd",
      "characters": "a51a22cdb297f4af6d004b3df08cd079aacb4089b07a5944bdd4d053d11eff4b",
      "details": "46da8597fc656f55367befa85f7709ef52ff03f27f711ecc297fcb26fc20fdec",
      "o-1": "ac6b662d99f759cdbe8240dea5f697651d04a442be215d3cb1f2a4f05e71de98"
    }
  },
  "compact-60": {
    "zh": {
      "outline": "8671e208b60fcdfebb75d15211e875106d07f94638e198038ce9f2477a5daa43",
      "characters": "4f1f4ffc4e9c4dbf49e44cfa28eb30ec6233123b31480347473d140713861dd8",
      "details": "801cde3332cf9527c8d02c891d84f3c65eaeabaf7b6c5a2c825cd076ec228ec3",
      "o-1": "f5f75e7f25931e4062423641042ab9edd0175b8b28342a9f4b9a0dc6050576ee"
    },
    "en": {
      "outline": "815170da16fec13ce963842b4a5c0371f0e630b8001ce2d0204181ffbd0b1ab8",
      "characters": "09641c0de1ffb4267665288d4619c255e9f98b0564102438cdbdfd74cfbd4529",
      "details": "8c3529ea8c263d800c1cdbe200a31c790c9d96f9c70d9f8ef7d7dcdf64570452",
      "o-1": "3bea7f74b88e78d034d8a0895c1ad95b4f912ca8903cdbbbc276cd62cfc96bf9"
    }
  }
} as const
const topKeys = ['protocol', 'purpose', 'profile', 'templateVersion', 'identity', 'brief', 'instruction', 'sourceRefs', 'canonBaseRoot', 'fullPlanRoot', 'globalCanon', 'earlyPlanning', 'chapter', 'closure', 'partitions', 'previousBody', 'scope'].sort()
let passed = 0
const ref = (artifact: CampaignArtifact) => ({ taskId: artifact.taskId, revision: artifact.revision, hash: artifact.hash })
const refuses = (code: PlanningRefusalCode) => (error: unknown) => error instanceof PlanningRefusalError && error.code === code
async function reseal(artifact: CampaignArtifact, text: string): Promise<CampaignArtifact> {
  const { hash: _hash, raw: _raw, canonical: _canonical, ...rest } = artifact
  return sealCampaignArtifact({ ...rest, text })
}
// Independent wire oracle: reconstruct source identity through the closed role
// table, then recover the complete record from the supplied payload collection.
function expandClosure(packet: {
  sourceRefs: CampaignArtifactRef[]
  globalCanon: null | { sources: CampaignArtifactRef[]; outline: unknown; characterBible: unknown; detailedOutline: unknown }
  earlyPlanning: { outline: unknown; characterBible: unknown }
  closure: Array<{ container: string; recordKind: string; recordId: string }>
}, artifacts: Map<string, CampaignArtifact>) {
  const roles: Record<string, { source: CampaignArtifactRef | undefined; payload: unknown; stage: string }> = {
    early_outline: { source: packet.sourceRefs[0], payload: packet.earlyPlanning.outline, stage: 'outline' },
    early_character_bible: { source: packet.sourceRefs[1], payload: packet.earlyPlanning.characterBible, stage: 'character_bible' },
    global_outline: { source: packet.globalCanon?.sources[0], payload: packet.globalCanon?.outline, stage: 'outline' },
    global_character_bible: { source: packet.globalCanon?.sources[1], payload: packet.globalCanon?.characterBible, stage: 'character_bible' },
    global_detailed_outline: { source: packet.globalCanon?.sources[2], payload: packet.globalCanon?.detailedOutline, stage: 'detailed_outline' },
  }
  const fields: Record<string, Record<string, string>> = {
    outline: { genre_rule: 'genreRules', lore_entity: 'loreEntities', world_fact: 'worldFacts', plot_promise: 'plotPromises', intentionally_open_thread: 'intentionallyOpenThreads' },
    character_bible: { character: 'characters', character_state: 'characterStates', epistemic_state: 'epistemicStates', transition: 'transitions' },
    detailed_outline: { beat: 'beats', obligation: 'obligations', chapter_entry: 'chapters' },
  }
  return packet.closure.map(row => {
    assert.deepEqual(Object.keys(row).sort(), ['container', 'recordId', 'recordKind'])
    assert.ok(Object.hasOwn(roles, row.container))
    const role = roles[row.container]!
    assert.ok(role.source && role.payload && typeof role.payload === 'object')
    const source = artifacts.get(role.source.taskId)!
    assert.ok(source && source.kind === role.stage); assert.deepEqual(role.source, ref(source))
    const field = fields[role.stage]![row.recordKind]; assert.ok(field)
    const payload = role.payload as Record<string, Array<{ id: string }>>
    assert.ok(Array.isArray(payload[field!]))
    const values = payload[field!]!.filter(value => value.id === row.recordId); assert.equal(values.length, 1)
    const original = JSON.parse(source.text).payload[field!].find((value: { id: string }) => value.id === row.recordId)
    assert.deepEqual(values[0], original)
    return { ...row, artifact: role.source }
  })
}

async function fixture(profile: PlanningProfileName, language: 'zh' | 'en', mutate?: (task: CampaignTaskSpec, text: string) => string) {
  const manifest = await createOfflineCampaignManifest(planningManifestOptions({ campaignId: `freeze-${profile}-${language}`, language, profile, now, identity }))
  const artifacts = new Map<string, CampaignArtifact>(), inputs = new Map<string, Awaited<ReturnType<typeof compilePlanningContext>>>()
  const context = (task: CampaignTaskSpec): CampaignProviderContext => ({ manifest, candidateId: manifest.candidateId, task, taskRevision: 0, dependencies: task.dependsOn.map(id => artifacts.get(id)!) })
  for (const task of manifest.tasks) {
    const ctx = context(task), input = await compilePlanningContext(ctx), packet = JSON.parse(input.text)
    assert.deepEqual(Object.keys(packet).sort(), topKeys)
    expandClosure(packet, artifacts)
    assert.equal(input.digest, createHash('sha256').update(input.text, 'utf8').digest('hex'))
    assert.equal(input.bytes, Buffer.byteLength(input.text, 'utf8')); assert.equal(input.utf16, input.text.length)
    assert.equal(input.responseBytes, PLANNING_STAGE_LIMITS[task.kind].responseBytes)
    assert.equal(packet.scope.semanticCompleteness, 'not_reviewed')
    const fixtureText = planningFixtureResponse(ctx), text = mutate?.(task, fixtureText) ?? fixtureText
    const artifact = await sealCampaignArtifact({ schemaVersion: 2, campaignId: manifest.campaignId, candidateId: manifest.candidateId,
      taskId: task.id, taskRevision: 0, revision: 0, kind: task.kind, dependencies: ctx.dependencies.map(ref), parentHash: null, text, semanticStatus: 'not_reviewed' })
    artifacts.set(task.id, artifact); inputs.set(task.id, input)
  }
  const canon = await buildPlanningCanon(manifest, [...artifacts.values()].filter(artifact => artifact.kind !== 'chapter_body'))
  return { manifest, artifacts, inputs, canon, context }
}

for (const profile of ['three-chapter', 'compact-60'] as const) for (const language of ['zh', 'en'] as const) {
  const f = await fixture(profile, language), count = profile === 'three-chapter' ? 3 : 60, literals = expected[profile][language]
  for (const [id, hash] of Object.entries(expectedPlanningArtifactHashes[profile][language])) assert.equal(f.artifacts.get(id)!.hash, hash)
  assert.equal(f.inputs.get('outline')!.digest, literals[0]); assert.equal(f.inputs.get('b-1')!.digest, literals[1]); assert.equal(f.inputs.get(`b-${count}`)!.digest, literals[2]); assert.equal(f.canon.fullPlanRoot, literals[3])
  if (count === 60) {
    const chapterInput = f.inputs.get('o-1')!, packet = JSON.parse(chapterInput.text)
    const expanded = expandClosure(packet, f.artifacts)
    const oldBytes = Buffer.byteLength(canonicalStringify({ ...packet, closure: expanded }), 'utf8')
    assert.equal(packet.closure.length, 69)
    assert.equal(oldBytes - chapterInput.bytes, 8217)
    assert.ok(chapterInput.bytes <= oldBytes * 0.76)
  }
  assert.equal(f.manifest.tasks.length, 3 + count * 2); assert.equal(f.manifest.tasks.findIndex(task => task.kind === 'chapter_body'), 3 + count)
  assert.equal(f.manifest.bodyTarget.characters, planningFixtureBodyTarget(language, count))
  assert.ok(f.canon.globalCanonBytes <= 32768 && f.canon.planningBytes <= 512 * 1024)
  const task = f.manifest.tasks.find(task => task.id === `b-${count}`)!, dispatch = f.inputs.get(task.id)!
  const ctx = f.context(task), planningOnly = { ...ctx, dependencies: ctx.dependencies.filter(artifact => artifact.kind !== 'chapter_body') }
  const preview = await compilePlanningContext(planningOnly, 'planning_preview')
  assert.notEqual(preview.digest, dispatch.digest); assert.equal(preview.fullPlanRoot, dispatch.fullPlanRoot)
  assert.equal(preview.scope.includedChapterOutlineCount, 1); assert.equal(preview.scope.omittedChapterOutlineCount, count - 1)
  const packet = JSON.parse(preview.text), bodyPacket = JSON.parse(dispatch.text)
  assert.equal(packet.previousBody, null); assert.equal(packet.purpose, 'planning_preview')
  assert.deepEqual(packet.globalCanon, f.canon.globalCanon); assert.equal(packet.sourceRefs.length, 3 + count)
  assert.equal(bodyPacket.previousBody.text, f.artifacts.get(`b-${count - 1}`)!.text)
  assert.equal(bodyPacket.scope.realizedBodyCoverage, 'complete_previous_body_only')
  assert.equal(packet.scope.realizedBodyCoverage, 'none')
  assert.ok(Buffer.byteLength(canonicalStringify({ preparedInput: preview.text }), 'utf8') > preview.bytes)
  assert.equal((await compilePlanningContext(planningOnly, 'planning_preview')).text, preview.text)
  assert.equal((await compilePlanningContext(planningOnly, 'planning_preview', () => {}, f.canon)).text, preview.text)
  if (count === 3) {
    const p1 = JSON.parse(f.inputs.get('b-1')!.text), p2 = JSON.parse(f.inputs.get('b-2')!.text), p3 = JSON.parse(f.inputs.get('b-3')!.text)
    assert.ok(p1.partitions.authorOnlyFactRefs.some((r: { recordId: string }) => r.recordId === 'fact.low_tide'))
    assert.ok(!p1.partitions.readerVisibleFactRefs.some((r: { recordId: string }) => r.recordId === 'fact.low_tide'))
    assert.ok(p1.partitions.characterEpistemic.future.some((r: { recordId: string }) => r.recordId === 'know.keeper_after'))
    assert.ok(p2.partitions.characterEpistemic.current.some((r: { recordId: string }) => r.recordId === 'know.keeper_before'))
    assert.ok(p3.partitions.characterEpistemic.current.some((r: { recordId: string }) => r.recordId === 'know.keeper_after'))
    assert.ok(p3.partitions.characterEpistemic.past.some((r: { recordId: string }) => r.recordId === 'know.keeper_before'))
    assert.ok(p1.partitions.narratorClaims.current.some((r: { recordId: string }) => r.recordId === 'claim.narrator'))
  }
  passed++
}

for (const stage of Object.keys(PLANNING_STAGE_LIMITS) as Array<keyof typeof PLANNING_STAGE_LIMITS>) {
  const limit = PLANNING_STAGE_LIMITS[stage].inputBytes
  for (const vector of ['A', '中', '😀', 'e\u0301', JSON.stringify('"\\\n\u0001')]) {
    const text = vector + 'a'.repeat(limit - Buffer.byteLength(vector, 'utf8'))
    assert.deepEqual(planningContextMetrics(text, stage), { bytes: limit, utf16: text.length })
    assert.throws(() => planningContextMetrics(`${text}a`, stage), refuses('context_budget_exceeded'))
  }
  passed++
}

const f = await fixture('three-chapter', 'en'), body2 = f.manifest.tasks.find(task => task.id === 'b-2')!, bodyContext = f.context(body2)
await assert.rejects(compilePlanningContext({ ...bodyContext, dependencies: bodyContext.dependencies.slice(0, -1) }), refuses('missing_planning_source')); passed++
await assert.rejects(compilePlanningContext({ ...bodyContext, dependencies: [...bodyContext.dependencies].reverse() }), refuses('source_identity_mismatch')); passed++
await assert.rejects(compilePlanningContext({ ...bodyContext, dependencies: bodyContext.dependencies.map((artifact, index) => index ? artifact : { ...artifact, campaignId: 'other-campaign' }) }), refuses('source_identity_mismatch')); passed++
await assert.rejects(compilePlanningContext(f.context(f.manifest.tasks[0]!), 'planning_preview'), refuses('invalid_purpose')); passed++
await assert.rejects(compilePlanningContext(bodyContext, 'stage_dispatch'), refuses('invalid_purpose')); passed++
assert.equal(isPlanningProfile('tiny-bilingual-v1'), false)
assert.throws(() => isPlanningProfile('planning-contract-v2'), refuses('unsupported_profile')); passed++
const { hash: _hash, ...manifestRest } = f.manifest
const weakened = await sealCampaignManifest({ ...manifestRest, tasks: manifestRest.tasks.map(task => task.id === 'b-1' ? { ...task, dependsOn: ['o-1'] } : task) })
assert.throws(() => validatePlanningProfile(weakened), refuses('invalid_planning_graph')); passed++
const wrongCanon = { ...f.canon, artifactsByTask: new Map(f.canon.artifactsByTask) }
wrongCanon.artifactsByTask.set('outline', { ...f.artifacts.get('outline')!, hash: '0'.repeat(64) })
await assert.rejects(compilePlanningContext(bodyContext, undefined, () => {}, wrongCanon), refuses('source_identity_mismatch')); passed++
const absentPayloadCanon = { ...f.canon, globalCanon: { ...f.canon.globalCanon!, outline: null } } as unknown as typeof f.canon
await assert.rejects(compilePlanningContext(bodyContext, undefined, () => {}, absentPayloadCanon), refuses('missing_planning_source')); passed++
const forgedContainerSource = { ...f.canon, globalCanon: { ...f.canon.globalCanon!, sources: [...f.canon.globalCanon!.sources] } }
forgedContainerSource.globalCanon.sources[0] = { ...forgedContainerSource.globalCanon.sources[1]! }
await assert.rejects(compilePlanningContext(bodyContext, undefined, () => {}, forgedContainerSource), refuses('source_identity_mismatch')); passed++
const forgedRecordKind = { ...f.canon, records: f.canon.records.map((row, index) => index ? row : { ...row, recordKind: 'character' as const }) }
await assert.rejects(compilePlanningContext(bodyContext, undefined, () => {}, forgedRecordKind), refuses('invalid_planning_reference')); passed++
const forgedWirePacket = JSON.parse(f.inputs.get('b-1')!.text)
forgedWirePacket.closure[0].container = 'early_character_bible'
assert.throws(() => expandClosure(forgedWirePacket, f.artifacts)); passed++
let checks = 0
await assert.rejects(compilePlanningContext(bodyContext, undefined, () => { if (++checks === 20) throw new PlanningRefusalError('planning_cancelled') }), refuses('planning_cancelled')); passed++

// Integrate an entire previous body at the binding 64-KiB packet cap; never take a tail.
const before = bodyContext.dependencies.at(-1)!, baseline = f.inputs.get('b-2')!.bytes
const exactBody = 'a'.repeat(65536 - baseline + Buffer.byteLength(before.text, 'utf8'))
const atCap = await reseal(before, exactBody), capContext = { ...bodyContext, dependencies: [...bodyContext.dependencies.slice(0, -1), atCap] }
const capInput = await compilePlanningContext(capContext)
assert.equal(capInput.bytes, 65536); assert.equal(JSON.parse(capInput.text).previousBody.text, exactBody)
await assert.rejects(compilePlanningContext({ ...capContext, dependencies: [...capContext.dependencies.slice(0, -1), await reseal(before, `${exactBody}a`)] }), refuses('context_budget_exceeded')); passed++

// Active long-distance obligations are scanned even when this chapter selects none.
const sparse = await fixture('three-chapter', 'en', (task, text) => {
  if (task.kind !== 'detailed_outline') return text
  const value = JSON.parse(text); value.payload.chapters[1].obligationRefs = []; return canonicalStringify(value)
})
const sparsePacket = JSON.parse(sparse.inputs.get('b-2')!.text)
assert.ok(sparsePacket.chapter.applicableObligationRefs.some((r: { recordId: string }) => r.recordId === 'obligation.recovery'))
assert.ok(sparsePacket.closure.some((r: { recordId: string }) => r.recordId === 'know.keeper_after')); passed++

// A plausible but contradictory prose/attitude remains structurally valid, not semantically certified.
const contradiction = await fixture('three-chapter', 'en', (task, text) => {
  if (task.kind !== 'character_bible') return text
  const value = JSON.parse(text); value.payload.epistemicStates.find((row: { id: string }) => row.id === 'know.keeper_after').attitude = 'unaware'; return canonicalStringify(value)
})
assert.equal(JSON.parse(contradiction.inputs.get('b-3')!.text).scope.semanticCompleteness, 'not_reviewed')
assert.notEqual(contradiction.canon.fullPlanRoot, f.canon.fullPlanRoot); passed++
console.log(`writer-campaign-planning-context: ${passed} scenarios passed; offline structural validation, semantic consistency NOT_RUN.`)
}
try { await main() } catch { process.stderr.write('planning_context_assertion_failed\n'); process.exitCode = 1 }
