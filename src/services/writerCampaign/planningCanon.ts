import type { CampaignArtifact, CampaignArtifactRef, CampaignManifest } from '../../types/writerCampaign'
import { canonicalStringify, hashCampaignValue, utf8Bytes } from './protocol'
import {
  PLANNING_LIMITS, PLANNING_PROTOCOL, parsePlanningEnvelope, planningAssert, planningChapterAddress,
  type Beat, type Character, type CharacterBiblePayload, type CharacterState, type ChapterEntry,
  type ChapterOutlinePayload, type DetailedOutlinePayload, type EpistemicState, type LoreEntity,
  type Obligation, type OutlinePayload, type PlanningCheck, type PlanningEnvelope, type PlanningRecordKind,
  type PlanningRecordValue, type PlanningRef, type Transition, type WorldFact,
} from './planningProtocol'

/** A closed schema field identity, never an offset into decoded JSON or a body quotation. */
export type PlanningFieldIdentity = 'invariantFactRefs' | 'subjectRefs' | 'premiseRefs' | 'initialStateRef' |
  'initialEpistemicRefs' | 'characterRef' | 'capabilityFactRefs' | 'holderRef' | 'subjectFactRef' | 'fromRef' |
  'toRef' | 'supportPromiseRefs' | 'causalPredecessorRefs' | 'participantRefs' | 'factRefs' | 'transitionRefs' |
  'readerDisclosureFactRefs' | 'setupRefs' | 'payoffRefs' | 'contextRefs' | 'openThreadRef' | 'povRef' |
  'beatRefs' | 'requiredConstraintRefs' | 'requiredFactRefs' | 'requiredTransitionRefs' | 'obligationRefs'
export interface PlanningRecord {
  key: string
  artifact: CampaignArtifactRef
  recordKind: PlanningRecordKind
  recordId: string
  value: PlanningRecordValue
  refs: PlanningRef[]
  fieldRefs: Array<{ field: PlanningFieldIdentity; ref: PlanningRef }>
}
export interface GlobalPlanningCanonV1 {
  protocol: 'campaign-global-canon-v1'
  canonBaseRoot: string
  sources: CampaignArtifactRef[]
  outline: OutlinePayload
  characterBible: CharacterBiblePayload
  detailedOutline: DetailedOutlinePayload
}
export interface PlanningCanon {
  records: PlanningRecord[]
  envelopes: Map<string, PlanningEnvelope>
  artifactsByTask: Map<string, CampaignArtifact>
  canonBaseRoot: string | null
  fullPlanRoot: string | null
  globalCanon: GlobalPlanningCanonV1 | null
  globalCanonBytes: number
  planningBytes: number
  edgeCount: number
}
/** Caller-owned read/action-local cache. No global or durable source retention. */
export class PlanningParseCache {
  #entries = new WeakMap<CampaignArtifact, { text: string; manifestHash: string; taskId: string; dependencies: string; envelope: PlanningEnvelope }>()
  parse(artifact: CampaignArtifact, manifest: CampaignManifest, check: PlanningCheck): PlanningEnvelope {
    const task = manifest.tasks.find(task => task.id === artifact.taskId)
    planningAssert(task && task.kind === artifact.kind, 'source_identity_mismatch')
    const dependencies = canonicalStringify(artifact.dependencies), cached = this.#entries.get(artifact)
    if (cached && cached.text === artifact.text && cached.manifestHash === manifest.hash && cached.taskId === artifact.taskId && cached.dependencies === dependencies) return cached.envelope
    const envelope = parsePlanningEnvelope(artifact.text, manifest, task, artifact.dependencies, check)
    const freeze = (value: unknown): void => { if (value && typeof value === 'object') { check(); Object.values(value).forEach(freeze); Object.freeze(value) } }
    freeze(envelope)
    this.#entries.set(artifact, { text: artifact.text, manifestHash: manifest.hash, taskId: artifact.taskId, dependencies, envelope })
    return envelope
  }
}
export function planningArtifactRef(artifact: CampaignArtifact): CampaignArtifactRef { return { taskId: artifact.taskId, revision: artifact.revision, hash: artifact.hash } }
const exact = (a: CampaignArtifactRef, b: CampaignArtifactRef) => a.taskId === b.taskId && a.revision === b.revision && a.hash === b.hash
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const artifactKey = (ref: CampaignArtifactRef) => `${ref.taskId}/${ref.revision}/${ref.hash}`
const recordKey = (artifact: CampaignArtifactRef, kind: PlanningRecordKind, id: string) => `${artifactKey(artifact)}/${kind}/${id}`
function isRef(value: unknown): value is PlanningRef { return value !== null && typeof value === 'object' && Object.hasOwn(value, 'recordKind') && Object.hasOwn(value, 'source') }
function allRefs(value: unknown): PlanningRef[] {
  if (isRef(value)) return [value]
  if (Array.isArray(value)) return value.flatMap(allRefs)
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(allRefs)
  return []
}
/** The owner must itself be an exact supplied active artifact; ancestors must be direct accepted sources. */
export function resolvePlanningRef(canon: PlanningCanon, ref: PlanningRef, ownerArtifact: CampaignArtifactRef): PlanningRecord {
  const owner = canon.artifactsByTask.get(ownerArtifact.taskId)
  planningAssert(owner && exact(owner, ownerArtifact), 'source_identity_mismatch')
  const source = ref.source === 'self' ? ownerArtifact : ref.artifact
  planningAssert(source !== null, 'invalid_planning_reference')
  if (ref.source === 'ancestor') planningAssert(owner.dependencies.some(dependency => exact(dependency, source)), 'invalid_planning_reference')
  const artifact = canon.artifactsByTask.get(source.taskId)
  planningAssert(artifact && exact(artifact, source), 'source_identity_mismatch')
  const found = canon.records.find(row => row.key === recordKey(source, ref.recordKind, ref.recordId))
  planningAssert(found, 'invalid_planning_reference')
  return found
}
export interface PlanningClosureSeed { ref: PlanningRef; ownerArtifact: CampaignArtifactRef }
/** Cyclic lore/fact adjacency is allowed; the visited set preserves every declared premise exactly once. */
export function planningClosure(canon: PlanningCanon, seeds: readonly PlanningClosureSeed[], check: PlanningCheck = () => {}): PlanningRecord[] {
  const visited = new Set<string>(), queue = [...seeds]
  while (queue.length) {
    check(); planningAssert(queue.length <= PLANNING_LIMITS.edges + PLANNING_LIMITS.records, 'planning_budget_exceeded')
    const seed = queue.pop()!, row = resolvePlanningRef(canon, seed.ref, seed.ownerArtifact)
    if (visited.has(row.key)) continue
    visited.add(row.key)
    for (const ref of row.refs) queue.push({ ref, ownerArtifact: row.artifact })
  }
  return canon.records.filter(row => visited.has(row.key))
}
function recordsFor(envelope: PlanningEnvelope): Array<[PlanningRecordKind, PlanningRecordValue[]]> {
  switch (envelope.stage) {
    case 'outline': return [['genre_rule', envelope.payload.genreRules], ['lore_entity', envelope.payload.loreEntities], ['world_fact', envelope.payload.worldFacts], ['plot_promise', envelope.payload.plotPromises], ['intentionally_open_thread', envelope.payload.intentionallyOpenThreads]]
    case 'character_bible': return [['character', envelope.payload.characters], ['character_state', envelope.payload.characterStates], ['epistemic_state', envelope.payload.epistemicStates], ['transition', envelope.payload.transitions]]
    case 'detailed_outline': return [['beat', envelope.payload.beats], ['obligation', envelope.payload.obligations], ['chapter_entry', envelope.payload.chapters]]
    case 'chapter_outline': return []
  }
}
const values = <T extends PlanningRecordValue>(canon: PlanningCanon, kind: PlanningRecordKind) => canon.records.filter(row => row.recordKind === kind) as Array<PlanningRecord & { value: T }>
const assertSchedule = (condition: unknown) => planningAssert(condition, 'invalid_planning_schedule')
const active = (state: { validFrom: { ordinal: number }; validThrough: { ordinal: number } }, chapter: number) => state.validFrom.ordinal <= chapter && state.validThrough.ordinal >= chapter

function validateRelations(canon: PlanningCanon, manifest: CampaignManifest, check: PlanningCheck): void {
  const chapters = manifest.tasks.filter(task => task.kind === 'chapter_outline').length
  const resolve = (owner: PlanningRecord | CampaignArtifactRef, ref: PlanningRef) => resolvePlanningRef(canon, ref, 'artifact' in owner ? owner.artifact : owner)
  const key = (owner: PlanningRecord | CampaignArtifactRef, ref: PlanningRef) => resolve(owner, ref).key
  const same = (ownerA: PlanningRecord, refA: PlanningRef | null, ownerB: PlanningRecord, refB: PlanningRef | null) => refA === null || refB === null ? refA === refB : key(ownerA, refA) === key(ownerB, refB)
  const factRows = values<WorldFact>(canon, 'world_fact')
  for (const row of factRows) { check(); if (row.value.invariant) assertSchedule(row.value.validFrom.ordinal === 1 && row.value.validThrough.ordinal === chapters) }
  for (const row of values<LoreEntity>(canon, 'lore_entity')) for (const ref of row.value.invariantFactRefs) planningAssert((resolve(row, ref).value as WorldFact).invariant, 'invalid_planning_reference')
  const characterRows = values<Character>(canon, 'character'), stateRows = values<CharacterState>(canon, 'character_state'), epistemicRows = values<EpistemicState>(canon, 'epistemic_state'), transitionRows = values<Transition>(canon, 'transition')
  for (const row of characterRows) {
    check(); const state = resolve(row, row.value.initialStateRef) as PlanningRecord & { value: CharacterState }
    assertSchedule(key(state, state.value.characterRef) === row.key && state.value.validFrom.ordinal === 1)
    const expected = epistemicRows.filter(ep => ep.value.holderRef !== null && key(ep, ep.value.holderRef) === row.key && ep.value.validFrom.ordinal === 1).map(ep => ep.key).sort()
    const declared = row.value.initialEpistemicRefs.map(ref => key(row, ref)).sort()
    assertSchedule(canonicalStringify(expected) === canonicalStringify(declared))
  }
  const groups = new Map<string, Array<PlanningRecord & { value: CharacterState | EpistemicState }>>()
  for (const row of [...stateRows, ...epistemicRows]) {
    check(); const v = row.value
    const holder = 'characterRef' in v ? key(row, v.characterRef) : v.holderRef ? key(row, v.holderRef) : 'narrator'
    const group = row.recordKind === 'character_state' ? `state/${holder}` : `epistemic/${holder}/${key(row, (v as EpistemicState).subjectFactRef)}/${(v as EpistemicState).presentation}`
    const entries = groups.get(group) ?? []; entries.push(row); groups.set(group, entries)
  }
  for (const row of transitionRows) {
    check(); const v = row.value, from = resolve(row, v.fromRef) as PlanningRecord & { value: CharacterState | EpistemicState }, to = resolve(row, v.toRef) as PlanningRecord & { value: CharacterState | EpistemicState }
    assertSchedule(from.key !== to.key && v.atChapter.ordinal < chapters && from.value.validThrough.ordinal === v.atChapter.ordinal && to.value.validFrom.ordinal === v.atChapter.ordinal + 1)
    const fromHolder = 'characterRef' in from.value ? from.value.characterRef : from.value.holderRef
    const toHolder = 'characterRef' in to.value ? to.value.characterRef : to.value.holderRef
    assertSchedule(same(row, v.holderRef, from, fromHolder) && same(row, v.holderRef, to, toHolder))
    if (v.transitionKind === 'epistemic_state') {
      const a = from.value as EpistemicState, b = to.value as EpistemicState
      assertSchedule(a.presentation === b.presentation && same(from, a.subjectFactRef, to, b.subjectFactRef))
      if (v.holderRef === null) assertSchedule(a.presentation === 'narrator_claim' && b.presentation === 'narrator_claim')
    }
  }
  for (const rows of groups.values()) {
    rows.sort((a, b) => a.value.validFrom.ordinal - b.value.validFrom.ordinal)
    for (const [i, row] of rows.entries()) {
      check(); if (!i) {
        assertSchedule(row.value.validFrom.ordinal === 1)
        if (row.recordKind === 'character_state') {
          const character = resolve(row, (row.value as CharacterState).characterRef) as PlanningRecord & { value: Character }
          assertSchedule(key(character, character.value.initialStateRef) === row.key)
        }
        continue
      }
      const previous = rows[i - 1]!
      assertSchedule(previous.value.validThrough.ordinal < row.value.validFrom.ordinal)
      const incoming = transitionRows.filter(t => key(t, t.value.toRef) === row.key)
      assertSchedule(incoming.length === 1 && key(incoming[0]!, incoming[0]!.value.fromRef) === previous.key)
    }
  }
  // Every declared transition has one origin/destination edge, even for a malformed duplicate binding.
  for (const row of transitionRows) {
    assertSchedule(transitionRows.filter(t => key(t, t.value.toRef) === key(row, row.value.toRef)).length === 1)
  }
  const beats = values<Beat>(canon, 'beat'), obligations = values<Obligation>(canon, 'obligation'), entries = values<ChapterEntry>(canon, 'chapter_entry')
  const detailed = [...canon.envelopes.entries()].find(([, envelope]) => envelope.stage === 'detailed_outline')
  if (detailed) {
    const detailedRef = planningArtifactRef(canon.artifactsByTask.get(detailed[0])!), payload = (detailed[1] as PlanningEnvelope & { stage: 'detailed_outline' }).payload
    assertSchedule(entries.length === chapters && payload.chapters.every((chapter, i) => chapter.chapter.ordinal === i + 1))
    assertSchedule(new Set(beats.map(row => row.value.order)).size === beats.length)
    assertSchedule(payload.beats.every((beat, i) => i === 0 || payload.beats[i - 1]!.order < beat.order && payload.beats[i - 1]!.chapter.ordinal <= beat.chapter.ordinal))
    for (const row of beats) {
      check(); const v = row.value
      for (const ref of v.causalPredecessorRefs) { const before = resolve(row, ref).value as Beat; assertSchedule(before.chapter.ordinal <= v.chapter.ordinal && before.order < v.order) }
      for (const ref of v.participantRefs) { const participant = resolve(row, ref); if (participant.recordKind === 'character_state') assertSchedule(active(participant.value as CharacterState, v.chapter.ordinal)) }
      for (const ref of [...v.factRefs, ...v.readerDisclosureFactRefs]) assertSchedule(active(resolve(row, ref).value as WorldFact, v.chapter.ordinal))
      for (const ref of v.readerDisclosureFactRefs) assertSchedule((resolve(row, ref).value as WorldFact).readerNotBefore.ordinal <= v.chapter.ordinal)
      for (const ref of v.transitionRefs) assertSchedule((resolve(row, ref).value as Transition).atChapter.ordinal === v.chapter.ordinal)
    }
    const bindings = payload.transitionBindings.map(binding => ({ transition: resolve(detailedRef, binding.transitionRef), beats: binding.supportingBeatRefs.map(ref => resolve(detailedRef, ref)) }))
    assertSchedule(bindings.length === transitionRows.length && new Set(bindings.map(binding => binding.transition.key)).size === bindings.length)
    for (const transition of transitionRows) {
      const binding = bindings.find(binding => binding.transition.key === transition.key)
      assertSchedule(binding)
      const chapter = transition.value.atChapter.ordinal, chapterBeats = beats.filter(beat => beat.value.chapter.ordinal === chapter)
      assertSchedule(chapterBeats.length > 0)
      const last = chapterBeats.reduce((a, b) => a.value.order > b.value.order ? a : b)
      assertSchedule(binding!.beats.some(beat => beat.key === last.key))
      for (const beat of binding!.beats) {
        assertSchedule((beat.value as Beat).chapter.ordinal === chapter)
        assertSchedule((beat.value as Beat).transitionRefs.some(ref => key(beat, ref) === transition.key))
      }
      for (const beat of beats.filter(beat => beat.value.transitionRefs.some(ref => key(beat, ref) === transition.key))) assertSchedule(binding!.beats.some(item => item.key === beat.key))
    }
    for (const row of obligations) {
      check(); const v = row.value, setups = v.setupRefs.map(ref => resolve(row, ref).value as Beat), payoffs = v.payoffRefs.map(ref => resolve(row, ref).value as Beat)
      assertSchedule(v.readerNotBefore.ordinal <= v.dueChapter.ordinal && setups.every(beat => beat.chapter.ordinal <= v.dueChapter.ordinal))
      if (v.disposition === 'planned_payoff') assertSchedule(payoffs.every(payoff => payoff.chapter.ordinal >= v.readerNotBefore.ordinal && payoff.chapter.ordinal <= v.dueChapter.ordinal && setups.every(setup => setup.order <= payoff.order && setup.chapter.ordinal <= payoff.chapter.ordinal)))
      else assertSchedule(v.dueChapter.ordinal === chapters)
    }
    for (const entry of entries) {
      check(); const v = entry.value, chapter = v.chapter.ordinal
      const expectedBeats = beats.filter(beat => beat.value.chapter.ordinal === chapter).map(beat => beat.key).sort()
      assertSchedule(canonicalStringify(v.beatRefs.map(ref => key(entry, ref)).sort()) === canonicalStringify(expectedBeats))
      const expectedTransitions = transitionRows.filter(t => t.value.atChapter.ordinal === chapter).map(t => t.key).sort()
      assertSchedule(canonicalStringify(v.requiredTransitionRefs.map(ref => key(entry, ref)).sort()) === canonicalStringify(expectedTransitions))
      for (const ref of v.requiredFactRefs) assertSchedule(active(resolve(entry, ref).value as WorldFact, chapter))
      for (const obligation of obligations) {
        const scheduled = obligation.value.dueChapter.ordinal === chapter || [...obligation.value.setupRefs, ...obligation.value.payoffRefs].some(ref => (resolve(obligation, ref).value as Beat).chapter.ordinal === chapter)
        if (scheduled) assertSchedule(v.obligationRefs.some(ref => key(entry, ref) === obligation.key))
      }
    }
  }
  for (const [taskId, envelope] of canon.envelopes) {
    check(); if (envelope.stage !== 'chapter_outline') continue
    const p: ChapterOutlinePayload = envelope.payload, owner = planningArtifactRef(canon.artifactsByTask.get(taskId)!), chapter = p.chapter.ordinal, entry = entries.find(entry => entry.value.chapter.ordinal === chapter)
    planningAssert(entry, 'missing_planning_source')
    assertSchedule(p.povRef === null || entry.value.povRef === null ? p.povRef === entry.value.povRef : key(owner, p.povRef) === key(entry, entry.value.povRef))
    const assigned: string[] = []
    let priorBeatOrder = 0
    for (const scene of p.scenes) {
      check(); const sceneBeats = scene.beatRefs.map(ref => resolve(owner, ref))
      assigned.push(...sceneBeats.map(row => row.key))
      const cast = scene.castRefs.map(ref => key(owner, ref)), states = scene.stateRefs.map(ref => resolve(owner, ref)), epistemic = scene.epistemicRefs.map(ref => resolve(owner, ref))
      for (const row of sceneBeats) {
        const beat = row.value as Beat; assertSchedule(beat.chapter.ordinal === chapter && beat.order > priorBeatOrder); priorBeatOrder = beat.order
        for (const ref of beat.participantRefs) { const participant = resolve(row, ref); assertSchedule(participant.recordKind === 'character' ? cast.includes(participant.key) : states.some(state => state.key === participant.key)) }
      }
      for (const state of states) { assertSchedule(active(state.value as CharacterState, chapter)); assertSchedule(cast.includes(key(state, (state.value as CharacterState).characterRef))) }
      // These are scheduled claims, including false beliefs or historical subjects.
      // An active claim is not an assertion that its subject world fact is true now.
      for (const state of epistemic) { const v = state.value as EpistemicState; assertSchedule(active(v, chapter)); if (v.holderRef) assertSchedule(cast.includes(key(state, v.holderRef))) }
      for (const ref of scene.withheldFactRefs) assertSchedule((resolve(owner, ref).value as WorldFact).readerNotBefore.ordinal > chapter)
      for (const obligation of obligations) {
        for (const [refs, actions] of [[obligation.value.setupRefs, scene.setupObligationRefs], [obligation.value.payoffRefs, scene.payoffObligationRefs]] as const) {
          const expected = refs.some(ref => sceneBeats.some(beat => beat.key === key(obligation, ref)))
          const declared = actions.some(ref => key(owner, ref) === obligation.key)
          assertSchedule(expected === declared)
        }
      }
    }
    assertSchedule(new Set(assigned).size === assigned.length && canonicalStringify(assigned.sort()) === canonicalStringify(entry.value.beatRefs.map(ref => key(entry, ref)).sort()))
  }
}

/** Minimum wire structure used only to refuse impossible future completion. These placeholders
 * never enter a packet, root, index or accepted artifact. IDs/text use one byte even when
 * actual uniqueness forces longer values, so this remains a conservative lower bound.
 */
function minimumGlobalPayloads(manifest: CampaignManifest, sources: CampaignArtifactRef[], known: Array<PlanningEnvelope['payload'] | null>): Array<PlanningEnvelope['payload']> {
  const last = manifest.tasks.filter(task => task.kind === 'chapter_outline').length
  const firstAddress = planningChapterAddress(manifest, 1), lastAddress = planningChapterAddress(manifest, last)
  const self = (recordKind: PlanningRecordKind): PlanningRef => ({ source: 'self', artifact: null, recordKind, recordId: 'a' })
  const minimumOutline: OutlinePayload = { premise: 'a', endingIntent: 'a', genreRules: [{ id: 'a', polarity: 'required', statement: 'a' }], loreEntities: [], worldFacts: [], plotPromises: [], intentionallyOpenThreads: [] }
  const minimumBible: CharacterBiblePayload = {
    characters: [{ id: 'a', name: 'a', role: 'a', motivation: 'a', identityInvariants: ['a'], capabilityInvariants: ['a'], initialStateRef: self('character_state'), initialEpistemicRefs: [] }],
    characterStates: [{ id: 'a', characterRef: self('character'), description: 'a', capabilityFactRefs: [], validFrom: firstAddress, validThrough: firstAddress }], epistemicStates: [], transitions: [],
  }
  const bible = (known[1] ?? minimumBible) as CharacterBiblePayload
  const transitionRef = (transition: Transition): PlanningRef => ({ source: 'ancestor', artifact: sources[1]!, recordKind: 'transition', recordId: transition.id })
  const transitionChapters = [...new Set(bible.transitions.map(transition => transition.atChapter.ordinal))].sort((a, b) => a - b)
  const minimumDetails: DetailedOutlinePayload = {
    beats: transitionChapters.map(ordinal => ({ id: 'a', chapter: planningChapterAddress(manifest, ordinal), order: 1, summary: 'a', causalPredecessorRefs: [], participantRefs: [], factRefs: [], transitionRefs: bible.transitions.filter(transition => transition.atChapter.ordinal === ordinal).map(transitionRef), readerDisclosureFactRefs: [] })),
    transitionBindings: bible.transitions.map(transition => ({ transitionRef: transitionRef(transition), supportingBeatRefs: [self('beat')] })), obligations: [],
    chapters: Array.from({ length: last }, (_, i) => ({ id: 'a', chapter: i + 1 === last ? lastAddress : planningChapterAddress(manifest, i + 1), povRef: null, beatRefs: transitionChapters.includes(i + 1) ? [self('beat')] : [], requiredConstraintRefs: [], requiredFactRefs: [], requiredTransitionRefs: bible.transitions.filter(transition => transition.atChapter.ordinal === i + 1).map(transitionRef), obligationRefs: [] })),
  }
  return [known[0] ?? minimumOutline, known[1] ?? minimumBible, known[2] ?? minimumDetails]
}

/** Build a derived index from already outer-validated active artifact objects, never from repository keys. */
export async function buildPlanningCanon(manifest: CampaignManifest, artifacts: readonly CampaignArtifact[], check: PlanningCheck = () => {}, cache = new PlanningParseCache()): Promise<PlanningCanon> {
  check(); const canon: PlanningCanon = { records: [], envelopes: new Map(), artifactsByTask: new Map(), canonBaseRoot: null, fullPlanRoot: null, globalCanon: null, globalCanonBytes: 0, planningBytes: 0, edgeCount: 0 }
  const sourceIndex = new Map(manifest.tasks.map((task, index) => [task.id, index])), ids = new Set<string>()
  let sceneCount = 0
  for (const artifact of artifacts) {
    check(); if (artifact.kind === 'chapter_body') continue
    const task = manifest.tasks.find(task => task.id === artifact.taskId)
    planningAssert(artifact.campaignId === manifest.campaignId && task && task.kind === artifact.kind && !canon.artifactsByTask.has(artifact.taskId), 'source_identity_mismatch')
    planningAssert(artifact.dependencies.length === task.dependsOn.length && artifact.dependencies.every((ref, i) => ref.taskId === task.dependsOn[i]), 'source_identity_mismatch')
    canon.planningBytes += utf8Bytes(artifact.text); planningAssert(canon.planningBytes <= PLANNING_LIMITS.activeTextBytes, 'planning_budget_exceeded')
    const envelope = cache.parse(artifact, manifest, check)
    canon.artifactsByTask.set(artifact.taskId, artifact); canon.envelopes.set(artifact.taskId, envelope)
    const envelopeRefs = allRefs(envelope.payload); canon.edgeCount += envelopeRefs.length
    planningAssert(canon.edgeCount <= PLANNING_LIMITS.edges, 'planning_budget_exceeded')
    if (envelope.stage === 'chapter_outline') {
      planningAssert(envelopeRefs.length <= 128, 'planning_budget_exceeded'); sceneCount += envelope.payload.scenes.length
      for (const scene of envelope.payload.scenes) { planningAssert(!ids.has(scene.id), 'invalid_planning_reference'); ids.add(scene.id) }
    }
    for (const [recordKind, rows] of recordsFor(envelope)) for (const value of rows) {
      check(); planningAssert(!ids.has(value.id), 'invalid_planning_reference'); ids.add(value.id)
      const fieldRefs: PlanningRecord['fieldRefs'] = []
      for (const [field, item] of Object.entries(value)) for (const ref of allRefs(item)) fieldRefs.push({ field: field as PlanningFieldIdentity, ref })
      const ref = planningArtifactRef(artifact)
      canon.records.push({ key: recordKey(ref, recordKind, value.id), artifact: ref, recordKind, recordId: value.id, value, refs: fieldRefs.map(row => row.ref), fieldRefs })
    }
    planningAssert(canon.records.length + sceneCount <= PLANNING_LIMITS.records, 'planning_budget_exceeded')
  }
  canon.records.sort((a, b) => sourceIndex.get(a.artifact.taskId)! - sourceIndex.get(b.artifact.taskId)! || compare(a.artifact.taskId, b.artifact.taskId) || a.artifact.revision - b.artifact.revision || compare(a.artifact.hash, b.artifact.hash) || compare(a.recordKind, b.recordKind) || compare(a.recordId, b.recordId))
  for (const artifact of canon.artifactsByTask.values()) {
    check(); for (const dependency of artifact.dependencies) {
      const actual = canon.artifactsByTask.get(dependency.taskId)
      planningAssert(actual && exact(actual, dependency), 'missing_planning_source')
    }
    for (const ref of allRefs(canon.envelopes.get(artifact.taskId)!.payload)) resolvePlanningRef(canon, ref, planningArtifactRef(artifact))
  }
  validateRelations(canon, manifest, check)
  const global = ['outline', 'character_bible', 'detailed_outline'].map(kind => [...canon.artifactsByTask.values()].find(artifact => artifact.kind === kind))
  const payloads = global.map(artifact => artifact ? canon.envelopes.get(artifact.taskId)!.payload : null)
  const minimumSources = ['outline', 'character_bible', 'detailed_outline'].map((kind, i) => global[i] ? planningArtifactRef(global[i]!) : { taskId: manifest.tasks.find(task => task.kind === kind)!.id, revision: 0, hash: '0'.repeat(64) })
  const minimumPayloads = minimumGlobalPayloads(manifest, minimumSources, payloads)
  const lowerBound = { protocol: 'campaign-global-canon-v1', canonBaseRoot: '0'.repeat(64), sources: minimumSources, outline: minimumPayloads[0], characterBible: minimumPayloads[1], detailedOutline: minimumPayloads[2] }
  planningAssert(utf8Bytes(canonicalStringify(lowerBound)) <= PLANNING_LIMITS.globalCanonBytes, 'canon_budget_exceeded')
  if (global.every((artifact): artifact is CampaignArtifact => !!artifact)) {
    const sources = global.map(planningArtifactRef)
    check(); canon.canonBaseRoot = await hashCampaignValue('campaign-canon-base-v1', { protocol: PLANNING_PROTOCOL, manifestHash: manifest.hash, sources }); check()
    canon.globalCanon = { protocol: 'campaign-global-canon-v1', canonBaseRoot: canon.canonBaseRoot, sources, outline: payloads[0] as OutlinePayload, characterBible: payloads[1] as CharacterBiblePayload, detailedOutline: payloads[2] as DetailedOutlinePayload }
    canon.globalCanonBytes = utf8Bytes(canonicalStringify(canon.globalCanon)); planningAssert(canon.globalCanonBytes <= PLANNING_LIMITS.globalCanonBytes, 'canon_budget_exceeded')
    const outlines = manifest.tasks.filter(task => task.kind === 'chapter_outline').map(task => canon.artifactsByTask.get(task.id))
    if (outlines.every((artifact): artifact is CampaignArtifact => !!artifact)) {
      check(); canon.fullPlanRoot = await hashCampaignValue('campaign-full-plan-v1', { protocol: PLANNING_PROTOCOL, manifestHash: manifest.hash, canonBaseRoot: canon.canonBaseRoot, sources: [...sources, ...outlines.map(planningArtifactRef)] }); check()
    }
  }
  check(); return canon
}
