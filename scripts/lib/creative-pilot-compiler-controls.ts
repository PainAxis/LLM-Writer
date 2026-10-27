/** C01–C24 are pure compiler controls, never SDK-positive tasks or durable campaign runs. */
import type { CreativeArtifact, CreativeArtifactTextV1, CreativeCheckpoint, CreativeCompileRefusal, CreativeRequest, CreativeResponse, CreativeSourceView, CreativeTaskId, PreparedCreativeInputV1 } from '../../src/types/creativePilot'
import { compileCreativeInput } from '../../src/services/writerCampaign/creativePilotContext'
import { compileCreativeResponse } from '../../src/services/writerCampaign/creativePilotCompiler'
import { createCreativeCandidate, createCreativeManifest, creativeRequestReservation, encodeCreativeResponseText, sealCreativeArtifactCandidate, sealCreativeRequest, sealCreativeResponse } from '../../src/services/writerCampaign/creativePilotProtocol'
import { creativePilotBriefs } from './creative-pilot-briefs'
import { CREATIVE_CONTROL_MODEL, creativeControlIdentity, creativeControlText } from './creative-pilot-control'
import { bodyOracle, byteOracle, canonicalOracle, controlAssert, domainOracle, hashOracle } from './creative-pilot-oracles'
import { CREATIVE_COMPILER_IDS } from './creative-pilot-registry'
import { safeCreativeCode, type CreativeControlRow } from './creative-pilot-report'

interface UnitCase { view: CreativeSourceView; request: CreativeRequest; prepared: PreparedCreativeInputV1; raw: string }
// Model wire is intentionally unknown to production. These test-only mutations are admitted by the real compiler.
type PlanWire = { protocol: string; stage: string; language: string; payload: Record<string, any> }
function parse(raw: string): PlanWire { return JSON.parse(raw) as PlanWire }
const self = (recordKind: string, recordId: string) => ({ source: 'self', recordKind, recordId })
function unitAssert(row: CreativeControlRow, condition: unknown): asserts condition { controlAssert(condition, 'creative_compiler_control_failed'); row.assertions++ }
async function responseFor(unit: UnitCase, raw = unit.raw): Promise<CreativeResponse> {
  return sealCreativeResponse({ schemaVersion: 1, protocol: 'creative-pilot-response-v1', campaignId: unit.request.campaignId, requestHash: unit.request.hash,
    intentHash: 'a'.repeat(64), evidenceId: 'pure-compiler-evidence', ...await encodeCreativeResponseText(raw), finishReason: 'stop',
    contentEvidence: { stepCount: 1, anomalies: [] }, usage: { status: 'partial', provenance: 'synthetic_control', inputTokens: 37, outputTokens: 29, reasoningTokens: null },
    reportedModel: { status: 'matched', value: CREATIVE_CONTROL_MODEL } })
}
async function accept(row: CreativeControlRow, unit: UnitCase, raw = unit.raw): Promise<{ artifact: CreativeArtifact; response: CreativeResponse }> {
  const response = await responseFor(unit, raw), result = await compileCreativeResponse(unit.view, unit.request, response)
  unitAssert(row, result.outcome === 'accepted')
  unitAssert(row, result.artifact.requestHash === unit.request.hash && result.artifact.responseHash === response.hash)
  const metrics = await bodyOracle(result.artifact.text)
  unitAssert(row, canonicalOracle(result.artifact.raw) === canonicalOracle(metrics.raw) && canonicalOracle(result.artifact.canonical) === canonicalOracle(metrics.canonical))
  unitAssert(row, result.artifact.raw.utf8Bytes === byteOracle(result.artifact.text))
  return { artifact: result.artifact, response }
}
async function refuse(row: CreativeControlRow, unit: UnitCase, raw: string, reason: CreativeCompileRefusal): Promise<CreativeResponse> {
  const response = await responseFor(unit, raw), before = canonicalOracle(response)
  const result = await compileCreativeResponse(unit.view, unit.request, response)
  unitAssert(row, result.outcome === 'refused' && result.reason === reason)
  unitAssert(row, !Object.hasOwn(result, 'artifact') && canonicalOracle(response) === before)
  row.resolutionReason = reason
  return response
}
async function throwsCode(row: CreativeControlRow, action: () => Promise<unknown>, code: string): Promise<void> {
  let observed: string | null = null
  try { await action() } catch (error) { observed = safeCreativeCode(error) }
  unitAssert(row, observed === code)
}

/** Explicit isolated unit state. Only real compiler-accepted setup artifacts enter this private view.
 * It is never persisted or returned to a positive/engine campaign runner. */
async function setup(index: number, taskId: CreativeTaskId, alteredOutline = false, campaign = `compiler-unit-${index}`, mutateRaw?: (prepared: PreparedCreativeInputV1, raw: string) => string, onAccepted?: (view: CreativeSourceView, artifact: CreativeArtifact) => void): Promise<UnitCase> {
  const brief = creativePilotBriefs()[index % 6]!.brief
  const candidate = await createCreativeCandidate(campaign, brief, 1)
  const manifest = await createCreativeManifest(campaign, candidate, { runtimeIdentity: 'pure-compiler-control', source: { commit: null, tree: null } })
  const checkpoint = { candidateHash: candidate.hash, tasks: manifest.tasks.map(t => ({ taskId: t.id, revision: 0, status: 'pending', artifactHash: null, requestHash: null })) } as CreativeCheckpoint
  const view: CreativeSourceView = { manifest, candidate, checkpoint, artifacts: new Map(), rawHead: 'pure-unit-not-persisted' }
  for (const task of manifest.tasks) {
    const prepared = await compileCreativeInput(view, task.id)
    const request = await sealCreativeRequest({ schemaVersion: 1, protocol: 'creative-pilot-request-v1', campaignId: campaign, id: `unit-request-${task.id}`, operationId: `unit-operation-${task.id}`,
      manifestHash: manifest.hash, candidateHash: candidate.hash, taskId: task.id, taskRevision: 0, dependencies: prepared.sourceRefs, prepared,
      adapter: creativeControlIdentity('http://127.0.0.1:1/v1'), invocationId: 'pure-unit-no-dispatch-authority', reservation: creativeRequestReservation(), createdAt: 2, expiresAt: 60002, storageAllocationBytes: '0000000001900544' as never })
    const dynamicRaw = await creativeControlText(prepared, alteredOutline && task.id === 'outline' ? 'change_outline' : 'normal')
    const raw = mutateRaw ? mutateRaw(prepared, dynamicRaw) : dynamicRaw, unit = { view, request, prepared, raw }
    if (task.id === taskId) return unit
    const result = await compileCreativeResponse(view, request, await responseFor(unit))
    controlAssert(result.outcome === 'accepted', 'creative_compiler_setup_failed')
    ;(view.artifacts as Map<string, CreativeArtifact>).set(result.artifact.hash, result.artifact)
    const state = view.checkpoint.tasks.find(row => row.taskId === task.id)!
    state.status = 'accepted'; state.artifactHash = result.artifact.hash
    onAccepted?.(view, result.artifact)
  }
  throw new Error('creative_compiler_setup_failed')
}

async function runOne(row: CreativeControlRow, index: number): Promise<void> {
  const outline = () => setup(index, 'outline'), bible = () => setup(index, 'characters'), details = () => setup(index, 'details'), chapter = () => setup(index, 'o-2')
  switch (row.id) {
    case 'C01': {
      const u = await outline(), p = parse(u.raw)
      const alternate = JSON.stringify({ payload: p.payload, language: p.language, stage: p.stage, protocol: p.protocol }, null, 2)
      const a = await accept(row, u, alternate), b = await accept(row, u)
      unitAssert(row, alternate !== u.raw && a.artifact.text === b.artifact.text && a.response.hash !== b.response.hash)
      unitAssert(row, parse(a.artifact.text).payload.premise === u.prepared.brief.premise)
      break
    }
    case 'C02': {
      const u = await bible(), p = parse(u.raw), original = 'A named person'; p.payload.characters[0].name = original
      const raw = JSON.stringify(p).replace(original, '\\u0041 named person')
      const a = await accept(row, u, raw)
      unitAssert(row, raw.includes('\\u0041') && parse(a.artifact.text).payload.characters[0].name === original)
      break
    }
    case 'C03': {
      const u = await details(), p = parse(u.raw), raw = JSON.stringify(p, null, '\t')
      const a = await accept(row, u, raw), out = parse(a.artifact.text)
      unitAssert(row, raw !== canonicalOracle(p) && canonicalOracle(out.payload.beats.map((x: any) => x.id)) === canonicalOracle(p.payload.beats.map((x: any) => x.id)))
      unitAssert(row, canonicalOracle(out.payload.chapters.map((x: any) => x.id)) === canonicalOracle(p.payload.chapters.map((x: any) => x.id)))
      break
    }
    case 'C04': {
      const u = await chapter(), a = await accept(row, u, ` \n${JSON.stringify(parse(u.raw), null, 2)}\n `), out = parse(a.artifact.text)
      unitAssert(row, out.payload.chapter.ordinal === 2 && out.payload.chapter.outlineTaskId === 'o-2' && out.payload.chapter.bodyTaskId === 'b-2')
      break
    }
    case 'C05': { const u = await outline(); await refuse(row, u, u.raw.slice(0, -1) + ',"protocol":"creative-plan-wire-v1"}', 'duplicate_json_key'); break }
    case 'C06': {
      const u = await outline(), raw = u.raw.replace('"premise":', '"premise":"other","prem\\u0069se":')
      unitAssert(row, raw !== u.raw); await refuse(row, u, raw, 'duplicate_json_key'); break
    }
    case 'C07': { const u = await bible(), p = parse(u.raw); p.payload.characters[0].unexpected = true; await refuse(row, u, JSON.stringify(p), 'output_schema'); break }
    case 'C08': { const u = await details(), p = parse(u.raw); delete p.payload.transitionBindings; await refuse(row, u, JSON.stringify(p), 'output_schema'); break }
    case 'C09': { const u = await chapter(); await refuse(row, u, '```json\n' + u.raw + '\n```', 'invalid_json'); await refuse(row, u, u.raw + '\nExplanation', 'invalid_json'); break }
    case 'C10': {
      const u = await outline(); await refuse(row, u, u.raw.slice(0, -1), 'invalid_json')
      await refuse(row, u, u.raw.replace('"protocol":', '"protocol":"other","protocol":').slice(0, -1), 'invalid_json'); break
    }
    case 'C11': { const u = await bible(), p = parse(u.raw); p.stage = 'outline'; await refuse(row, u, JSON.stringify(p), 'output_schema'); break }
    case 'C12': { const u = await details(), p = parse(u.raw); p.language = p.language === 'zh' ? 'en' : 'zh'; await refuse(row, u, JSON.stringify(p), 'output_schema'); break }
    case 'C13': {
      const u = await bible(), p = parse(u.raw); unitAssert(row, u.prepared.catalog.length < 512)
      p.payload.characterStates[0].capabilityFactRefs = [{ source: 'catalog', token: 512 }]
      await refuse(row, u, JSON.stringify(p), 'invalid_reference'); break
    }
    case 'C14': {
      const u = await bible(), other = await setup(index, 'characters', false, `other-compiler-unit-${index}`), response = await responseFor(u)
      await throwsCode(row, () => compileCreativeResponse(other.view, u.request, response), 'integrity')
      const changed = await setup(index, 'characters', true)
      unitAssert(row, changed.view.candidate.hash === u.view.candidate.hash && changed.prepared.catalogDigest !== u.prepared.catalogDigest)
      await throwsCode(row, () => compileCreativeResponse(changed.view, u.request, response), 'source_changed')
      const a = await accept(row, u), b = await accept(row, changed)
      unitAssert(row, a.artifact.hash !== b.artifact.hash && a.artifact.catalogRoot !== b.artifact.catalogRoot)
      break
    }
    case 'C15': {
      const u = await bible(), p = parse(u.raw), token = u.prepared.catalog.find(x => x.identity.recordKind === 'genre_rule')!.token
      p.payload.characterStates[0].capabilityFactRefs = [{ source: 'catalog', token }]
      await refuse(row, u, JSON.stringify(p), 'invalid_reference'); break
    }
    case 'C16': {
      const u = await outline(), p = parse(u.raw); p.payload.genreRules[0].id = 'foreign.rule'; await refuse(row, u, JSON.stringify(p), 'output_schema')
      const duplicate = parse(u.raw); duplicate.payload.genreRules.push(structuredClone(duplicate.payload.genreRules[0])); await refuse(row, u, JSON.stringify(duplicate), 'invalid_reference'); break
    }
    case 'C17': {
      const u = await details(), p = parse(u.raw); p.payload.beats[0].causalPredecessorRefs = [self('beat', p.payload.beats[1].id)]
      await refuse(row, u, JSON.stringify(p), 'invalid_schedule')
      const cycle = parse(u.raw); cycle.payload.beats[0].causalPredecessorRefs = [self('beat', cycle.payload.beats[2].id)]
      await refuse(row, u, JSON.stringify(cycle), 'invalid_schedule')
      // The normal outline has the permitted lore object <-> world fact adjacency cycle.
      const o = await outline(), accepted = await accept(row, o), out = parse(accepted.artifact.text)
      unitAssert(row, out.payload.loreEntities[0].invariantFactRefs[0].recordId === out.payload.worldFacts[0].id && out.payload.worldFacts[0].subjectRefs[0].recordId === out.payload.loreEntities[0].id)
      break
    }
    case 'C18': {
      const u = await chapter(), p = parse(u.raw), token = u.prepared.catalog.find(x => x.identity.recordKind === 'world_fact')!.token
      p.payload.scenes[0].withheldFactRefs = [{ source: 'catalog', token }]
      await refuse(row, u, JSON.stringify(p), 'invalid_schedule')
      const b = await bible(), invalid = parse(b.raw); invalid.payload.characterStates[0].validFrom = 2
      await refuse(row, b, JSON.stringify(invalid), 'invalid_schedule')
      const knowledge = parse(b.raw), fact = b.prepared.catalog.find(x => x.identity.recordKind === 'world_fact')!.token
      knowledge.payload.characters[0].initialEpistemicRefs = [self('epistemic_state', 'characters.knowledge')]
      knowledge.payload.epistemicStates = [{ id: 'characters.knowledge', holderRef: self('character', knowledge.payload.characters[0].id), subjectFactRef: { source: 'catalog', token: fact }, attitude: 'knows', claimText: 'A scheduled claim.', presentation: 'character_internal', validFrom: 2, validThrough: 3, readerNotBefore: 2 }]
      await refuse(row, b, JSON.stringify(knowledge), 'invalid_schedule'); break
    }
    case 'C19': {
      const u = await details(), p = parse(u.raw); p.payload.chapters.pop(); await refuse(row, u, JSON.stringify(p), 'output_schema')
      const c = await chapter(), missing = parse(c.raw); missing.payload.scenes[0].beatRefs = []; await refuse(row, c, JSON.stringify(missing), 'invalid_schedule')
      const body = await setup(index, 'b-1'), broken = structuredClone(body.view), state = broken.checkpoint.tasks.find(x => x.taskId === 'o-3')!
      state.status = 'pending'; state.artifactHash = null
      await throwsCode(row, () => compileCreativeInput(broken, 'b-1'), 'source_changed'); break
    }
    case 'C20': {
      for (const [task, cap] of [['outline', 8192], ['characters', 16384], ['details', 32768], ['o-2', 6144]] as const) {
        const u = await setup(index, task), count = byteOracle(u.raw); unitAssert(row, count < cap)
        const boundary = u.raw + ' '.repeat(cap - count)
        unitAssert(row, byteOracle(boundary) === cap && byteOracle(boundary + ' ') === cap + 1)
        const a = await accept(row, u, boundary); unitAssert(row, a.response.scalarMetrics?.utf8Bytes === cap && a.artifact.raw.utf8Bytes <= cap)
        const b = await refuse(row, u, boundary + ' ', 'raw_output_capacity'); unitAssert(row, b.scalarMetrics?.utf8Bytes === cap + 1)
      }
      break
    }
    case 'C21': {
      const u = await outline(), p = parse(u.raw)
      p.payload = { premise: 'Bounded expansion.', endingIntent: 'An ordinary ending.', genreRules: [{ id: 'outline.rule', polarity: 'required', statement: 'Use ordinary events.' }], loreEntities: [], plotPromises: [], intentionallyOpenThreads: [],
        worldFacts: Array.from({ length: 25 }, (_, i) => ({ id: `outline.fact${i}`, statement: 'An ordinary fact.', subjectRefs: [], premiseRefs: [], invariant: false, validFrom: 1, validThrough: 3, readerNotBefore: 1 })) }
      const raw = JSON.stringify(p); unitAssert(row, byteOracle(raw) <= 8192)
      // Independent expansion/serialization computes the actual derived-stage overflow witness.
      const payload = structuredClone(p.payload)
      for (const fact of payload.worldFacts) for (const key of ['validFrom', 'validThrough', 'readerNotBefore']) { const n = fact[key]; fact[key] = { ordinal: n, outlineTaskId: `o-${n}`, bodyTaskId: `b-${n}` } }
      const derived = canonicalOracle({ protocol: 'campaign-plan-v1', stage: p.stage, language: p.language, dependencies: [], payload })
      unitAssert(row, byteOracle(derived) > 8192)
      const retained = await refuse(row, u, raw, 'compiled_capacity'); unitAssert(row, JSON.parse(retained.textJson) === raw)
      const b = await bible(), expanded = parse(b.raw), fact = b.prepared.catalog.find(x => x.identity.recordKind === 'world_fact')!
      expanded.payload = { characters: [], characterStates: [], epistemicStates: [], transitions: [] }
      for (let n = 0; n < 18; n++) {
        expanded.payload.characters.push({ id: `characters.c${n}`, name: 'A', role: 'A', motivation: 'A', identityInvariants: ['A'], capabilityInvariants: ['A'], initialStateRef: self('character_state', `characters.s${n}`), initialEpistemicRefs: [] })
        expanded.payload.characterStates.push({ id: `characters.s${n}`, characterRef: self('character', `characters.c${n}`), description: 'x'.repeat(280), capabilityFactRefs: [{ source: 'catalog', token: fact.token }], validFrom: 1, validThrough: 3 })
      }
      const expandedRaw = JSON.stringify(expanded)
      const project = (value: any, key = ''): any => {
        if (['validFrom', 'validThrough'].includes(key)) return { ordinal: value, outlineTaskId: `o-${value}`, bodyTaskId: `b-${value}` }
        if (Array.isArray(value)) return value.map(item => project(item))
        if (value && typeof value === 'object') {
          if (value.source === 'catalog') return { source: 'ancestor', artifact: fact.identity.artifact, recordKind: fact.identity.recordKind, recordId: fact.identity.recordId }
          if (value.source === 'self') return { ...value, artifact: null }
          return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, project(item, name)]))
        }
        return value
      }
      const expandedDerived = canonicalOracle({ protocol: 'campaign-plan-v1', stage: expanded.stage, language: expanded.language, dependencies: b.request.dependencies, payload: project(expanded.payload) })
      unitAssert(row, byteOracle(expandedRaw) <= 16384 && byteOracle(expandedDerived) > 16384)
      await refuse(row, b, expandedRaw, 'compiled_capacity')
      break
    }
    case 'C22': {
      const u = await outline(), raw = '\ud800', retained = await responseFor(u, raw)
      const retainedUnitEvidence = new Map([[retained.hash, structuredClone(retained)]])
      unitAssert(row, retained.textJson === '"\\ud800"' && retained.textUtf16 === 1 && retained.scalarMetrics === null)
      unitAssert(row, retained.textJsonHash === await domainOracle('creative-visible-text-json-v1', JSON.stringify(raw)))
      const result = await compileCreativeResponse(u.view, u.request, retainedUnitEvidence.get(retained.hash)!)
      unitAssert(row, result.outcome === 'refused' && result.reason === 'invalid_scalar' && !Object.hasOwn(result, 'artifact'))
      unitAssert(row, JSON.parse(retainedUnitEvidence.get(retained.hash)!.textJson) === raw)
      row.resolutionReason = 'invalid_scalar'; break
    }
    case 'C23': {
      const u = await bible(), p = parse(u.raw), narrative = 'A\u030a\r\n🙂'; p.payload.characters[0].name = narrative
      const a = await accept(row, u, JSON.stringify(p)), decoded = parse(a.artifact.text).payload.characters[0].name
      unitAssert(row, decoded === narrative && decoded !== narrative.replace(/\r\n/g, '\n').normalize('NFC'))
      const body = await setup(index, 'b-1'), prose = narrative.repeat(128), b = await accept(row, body, prose), metrics = await bodyOracle(prose)
      unitAssert(row, b.artifact.text === prose && b.artifact.canonical.scalars === 384 && canonicalOracle(b.artifact.raw) === canonicalOracle(metrics.raw))
      for (const [scalars, expected] of [[255, 'body_length'], [256, null], [1024, null], [1025, 'body_length']] as const) {
        if (expected) await refuse(row, body, 'x'.repeat(scalars), expected)
        else { const edge = await accept(row, body, 'x'.repeat(scalars)); unitAssert(row, edge.artifact.canonical.scalars === scalars) }
      }
      break
    }
    case 'C24': {
      const u = await bible(), response = await responseFor(u), first = await compileCreativeResponse(u.view, u.request, response), second = await compileCreativeResponse(u.view, u.request, response)
      unitAssert(row, first.outcome === 'accepted' && second.outcome === 'accepted')
      unitAssert(row, canonicalOracle(first.artifact) === canonicalOracle(second.artifact) && first.artifact.hash === second.artifact.hash)
      const a = first.artifact, { hash: _hash, ...origin } = u.request
      const changedRequest = await sealCreativeRequest({ ...origin, id: 'changed-origin-identity' })
      await throwsCode(row, () => compileCreativeResponse(u.view, changedRequest, response), 'integrity')
      const textValue = { text: a.text, raw: a.raw, canonical: a.canonical, catalogRoot: a.catalogRoot, semanticStatus: a.semanticStatus }
      for (const key of ['campaignId', 'taskId', 'candidateHash', 'requestHash', 'responseHash', 'revision', 'hash']) {
        await throwsCode(row, () => sealCreativeArtifactCandidate(u.request, response, { ...textValue, [key]: 'extra-identity-must-not-override' } as CreativeArtifactTextV1), 'integrity')
      }
      const sourceBefore = canonicalOracle([...u.view.artifacts]), requestBefore = canonicalOracle(u.request), responseBefore = canonicalOracle(response)
      const sentinel = Object.assign(new Error('cancelled'), { code: 'cancelled' }); let checks = 0
      await throwsCode(row, () => compileCreativeResponse(u.view, u.request, response, () => { if (++checks > 100) throw sentinel }), 'cancelled')
      unitAssert(row, canonicalOracle([...u.view.artifacts]) === sourceBefore && canonicalOracle(u.request) === requestBefore && canonicalOracle(response) === responseBefore)
      break
    }
    default: throw new Error('creative_compiler_unknown_control')
  }
}

export async function runCreativeCompilerControls(rows: CreativeControlRow[]): Promise<void> {
  controlAssert(rows.length === CREATIVE_COMPILER_IDS.length && rows.every((row, i) => row.id === CREATIVE_COMPILER_IDS[i] && row.status === 'not_run'), 'creative_compiler_population_invalid')
  for (const [index, row] of rows.entries()) {
    row.status = 'running'; row.activeCheck = row.id
    try {
      unitAssert(row, row.setupHttpAttempts === 0 && row.exerciseHttpAttempts === 0 && row.recoveryHttpAttempts === 0 && row.successfulCas === 0)
      await runOne(row, index)
      row.status = 'pass'; row.observation = 'last_verified'
    } catch (error) {
      row.status = 'failed'; row.errorCode = safeCreativeCode(error); row.observation = 'unconfirmed'
      throw error // Preserve the failed row and leave all later rows NOT_RUN; never retry for a green report.
    }
  }
}


/** M06: actual earliest overflowing assembly, not a claim that later stages ran.
 * The rich three accepted global plans fail o-1's full schema/context cap. Prefix
 * tampering is exercised separately on an otherwise ordinary b-3 pure unit case. */
export async function runCreativeContextCapacityControl(row: CreativeControlRow): Promise<void> {
  controlAssert(row.id === 'M06' && row.status === 'not_run', 'creative_compiler_population_invalid')
  row.status = 'running'; row.activeCheck = row.id
  try {
    unitAssert(row, row.setupHttpAttempts === 0 && row.exerciseHttpAttempts === 0 && row.recoveryHttpAttempts === 0 && row.successfulCas === 0)
    const accepted: CreativeArtifact[] = [], captured: CreativeSourceView[] = []
    const richWire = (prepared: PreparedCreativeInputV1, raw: string): string => {
      const wire = parse(raw), p = wire.payload
      if (prepared.identity.taskId === 'outline') for (let n = 1; n <= 2; n++) p.worldFacts.push({ id: `outline.f${n}`, statement: 'x'.repeat(170), subjectRefs: [], premiseRefs: [], invariant: true, validFrom: 1, validThrough: 3, readerNotBefore: 1 })
      if (prepared.identity.taskId === 'characters') for (let n = 1; n <= 20; n++) {
        p.characters.push({ id: `characters.c${n}`, name: 'A', role: 'A', motivation: 'x'.repeat(30), identityInvariants: ['A'], capabilityInvariants: ['A'], initialStateRef: self('character_state', `characters.s${n}`), initialEpistemicRefs: [] })
        p.characterStates.push({ id: `characters.s${n}`, characterRef: self('character', `characters.c${n}`), description: 'x'.repeat(30), capabilityFactRefs: [], validFrom: 1, validThrough: 3 })
      }
      if (prepared.identity.taskId === 'details') for (const beat of p.beats) beat.summary = 'x'.repeat(512)
      return JSON.stringify(wire)
    }
    await throwsCode(row, () => setup(3, 'o-1', false, 'compiler-capacity-unit', richWire, (view, artifact) => { accepted.push(artifact); captured[0] = structuredClone(view) }), 'context_capacity')
    unitAssert(row, canonicalOracle(accepted.map(a => a.taskId)) === canonicalOracle(['outline', 'characters', 'details']))
    unitAssert(row, accepted.every((a, i) => a.raw.utf8Bytes === byteOracle(a.text) && a.raw.utf8Bytes <= [8192, 16384, 32768][i]!))
    const full = captured[0]!
    unitAssert(row, full.checkpoint.tasks.filter(t => t.status === 'accepted').length === 3 && full.artifacts.size === 3)
    unitAssert(row, full.checkpoint.tasks.filter(t => t.taskId.startsWith('o-') || t.taskId.startsWith('b-')).every(t => t.status === 'pending' && t.artifactHash === null))
    const before = canonicalOracle([...full.artifacts])
    await throwsCode(row, () => compileCreativeInput(full, 'o-1'), 'context_capacity')
    unitAssert(row, canonicalOracle([...full.artifacts]) === before)

    // Complete-prefix source integrity is a distinct admitted unit fixture, not
    // downstream execution of the overflowing campaign above.
    const body = await setup(3, 'b-3'), original = body.prepared
    unitAssert(row, original.previousBodies.length === 2 && original.previousBodies[0]!.source.taskId === 'b-1' && original.previousBodies[1]!.source.taskId === 'b-2')
    for (const prior of original.previousBodies) unitAssert(row, prior.text === body.view.artifacts.get(prior.source.hash)!.text)
    await accept(row, body)
    const variants: Array<(packet: PreparedCreativeInputV1) => void> = [
      packet => { packet.previousBodies.pop() },
      packet => { packet.previousBodies[0]!.text = packet.previousBodies[0]!.text.slice(1) },
      packet => { packet.previousBodies.reverse() },
      packet => { packet.fullPlanRoot = '0'.repeat(64) },
    ]
    for (const mutate of variants) {
      const changed = structuredClone(original); mutate(changed)
      const { wire: _wire, inputDigest: _digest, inputBytes: _bytes, inputUtf16: _utf16, ...payload } = changed
      changed.wire = { system: original.wire.system, prompt: canonicalOracle(payload) }
      const encoded = canonicalOracle(changed.wire)
      changed.inputDigest = await hashOracle(encoded); changed.inputBytes = byteOracle(encoded); changed.inputUtf16 = encoded.length
      const { hash: _hash, ...origin } = body.request
      const request = await sealCreativeRequest({ ...origin, prepared: changed })
      const unit = { ...body, request, prepared: changed }, response = await responseFor(unit)
      unitAssert(row, request.hash !== body.request.hash && changed.inputDigest !== original.inputDigest)
      await throwsCode(row, () => compileCreativeResponse(body.view, request, response), 'source_changed')
    }
    row.status = 'pass'; row.observation = 'last_verified'
  } catch (error) {
    row.status = 'failed'; row.errorCode = safeCreativeCode(error); row.observation = 'unconfirmed'
    throw error
  }
}
