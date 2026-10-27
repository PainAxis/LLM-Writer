import type { PlanningSourceManifest } from './planningSource'
import type { CampaignArtifactRef, CampaignTaskKind, CampaignTaskSpec } from '../../types/writerCampaign'
import { assertScalarText, canonicalStringify, utf8Bytes } from './protocol'

export const PLANNING_PROTOCOL = 'campaign-plan-v1' as const
export type PlanningStage = Exclude<CampaignTaskKind, 'chapter_body'>
export const PLANNING_LIMITS = Object.freeze({ records: 512, edges: 2048, depth: 12, nodes: 16384, activeTextBytes: 512 * 1024, globalCanonBytes: 32768, chapters: 60 })
export const PLANNING_STAGE_LIMITS = Object.freeze({
  outline: Object.freeze({ inputBytes: 12288, responseBytes: 8192 }),
  character_bible: Object.freeze({ inputBytes: 20480, responseBytes: 16384 }),
  detailed_outline: Object.freeze({ inputBytes: 49152, responseBytes: 32768 }),
  chapter_outline: Object.freeze({ inputBytes: 57344, responseBytes: 6144 }),
  chapter_body: Object.freeze({ inputBytes: 65536, responseBytes: 65536 }),
})
export const PLANNING_REFUSAL_CODES = Object.freeze([
  'invalid_planning_payload', 'unsupported_planning_protocol', 'invalid_planning_reference',
  'invalid_planning_schedule', 'planning_budget_exceeded', 'canon_budget_exceeded',
  'context_budget_exceeded', 'invalid_planning_graph', 'missing_planning_source',
  'source_identity_mismatch', 'planning_cancelled', 'unsupported_profile', 'incomplete_plan',
  'runtime_identity_changed', 'expired', 'source_changed', 'invalid_purpose', 'preview_unavailable',
] as const)
export type PlanningRefusalCode = typeof PLANNING_REFUSAL_CODES[number]
/** Codes are safe to report. No source-bearing message, record ID or JSON path escapes. */
export class PlanningRefusalError extends Error {
  constructor(readonly code: PlanningRefusalCode) { super(code); this.name = 'PlanningRefusalError' }
}
export function planningAssert(value: unknown, code: PlanningRefusalCode = 'invalid_planning_payload'): asserts value {
  if (!value) throw new PlanningRefusalError(code)
}
export type PlanningCheck = () => void
export function planningByteLength(value: string, maximum: number, code: PlanningRefusalCode = 'planning_budget_exceeded'): number {
  let bytes: number
  try { bytes = utf8Bytes(value) } catch { throw new PlanningRefusalError('invalid_planning_payload') }
  planningAssert(bytes <= maximum, code)
  return bytes
}
export const PLANNING_RECORD_KINDS = Object.freeze(['genre_rule', 'lore_entity', 'world_fact', 'plot_promise', 'intentionally_open_thread', 'character', 'character_state', 'epistemic_state', 'transition', 'beat', 'obligation', 'chapter_entry'] as const)
export type PlanningRecordKind = typeof PLANNING_RECORD_KINDS[number]
export interface PlanningRef { source: 'self' | 'ancestor'; artifact: CampaignArtifactRef | null; recordKind: PlanningRecordKind; recordId: string }
export interface ChapterAddress { ordinal: number; outlineTaskId: string; bodyTaskId: string }
export interface GenreRule { id: string; polarity: 'required' | 'forbidden'; statement: string }
export interface LoreEntity { id: string; entityKind: 'place' | 'object' | 'group' | 'system' | 'historical_event'; name: string; description: string; invariantFactRefs: PlanningRef[] }
export interface WorldFact { id: string; statement: string; subjectRefs: PlanningRef[]; premiseRefs: PlanningRef[]; invariant: boolean; validFrom: ChapterAddress; validThrough: ChapterAddress; readerNotBefore: ChapterAddress }
export interface PlotPromise { id: string; statement: string; dueChapter: ChapterAddress; premiseRefs: PlanningRef[] }
export interface IntentionallyOpenThread { id: string; statement: string; premiseRefs: PlanningRef[]; disposition: 'intentionally_open_at_end' }
export interface OutlinePayload { premise: string; endingIntent: string; genreRules: GenreRule[]; loreEntities: LoreEntity[]; worldFacts: WorldFact[]; plotPromises: PlotPromise[]; intentionallyOpenThreads: IntentionallyOpenThread[] }
export interface Character { id: string; name: string; role: string; motivation: string; identityInvariants: string[]; capabilityInvariants: string[]; initialStateRef: PlanningRef; initialEpistemicRefs: PlanningRef[] }
export interface CharacterState { id: string; characterRef: PlanningRef; description: string; capabilityFactRefs: PlanningRef[]; validFrom: ChapterAddress; validThrough: ChapterAddress }
export interface EpistemicState { id: string; holderRef: PlanningRef | null; subjectFactRef: PlanningRef; attitude: 'knows' | 'believes' | 'doubts' | 'unaware'; claimText: string; presentation: 'character_internal' | 'narrator_claim'; validFrom: ChapterAddress; validThrough: ChapterAddress; readerNotBefore: ChapterAddress }
export interface Transition { id: string; transitionKind: 'character_state' | 'epistemic_state'; holderRef: PlanningRef | null; fromRef: PlanningRef; toRef: PlanningRef; atChapter: ChapterAddress; phase: 'end_of_chapter'; supportPromiseRefs: PlanningRef[] }
export interface CharacterBiblePayload { characters: Character[]; characterStates: CharacterState[]; epistemicStates: EpistemicState[]; transitions: Transition[] }
export interface Beat { id: string; chapter: ChapterAddress; order: number; summary: string; causalPredecessorRefs: PlanningRef[]; participantRefs: PlanningRef[]; factRefs: PlanningRef[]; transitionRefs: PlanningRef[]; readerDisclosureFactRefs: PlanningRef[] }
export interface TransitionBinding { transitionRef: PlanningRef; supportingBeatRefs: PlanningRef[] }
export interface Obligation { id: string; summary: string; setupRefs: PlanningRef[]; payoffRefs: PlanningRef[]; contextRefs: PlanningRef[]; dueChapter: ChapterAddress; readerNotBefore: ChapterAddress; disposition: 'planned_payoff' | 'intentionally_open_at_end'; openThreadRef: PlanningRef | null }
export interface ChapterEntry { id: string; chapter: ChapterAddress; povRef: PlanningRef | null; beatRefs: PlanningRef[]; requiredConstraintRefs: PlanningRef[]; requiredFactRefs: PlanningRef[]; requiredTransitionRefs: PlanningRef[]; obligationRefs: PlanningRef[] }
export interface DetailedOutlinePayload { beats: Beat[]; transitionBindings: TransitionBinding[]; obligations: Obligation[]; chapters: ChapterEntry[] }
export interface Scene { id: string; order: number; summary: string; beatRefs: PlanningRef[]; castRefs: PlanningRef[]; stateRefs: PlanningRef[]; epistemicRefs: PlanningRef[]; setupObligationRefs: PlanningRef[]; payoffObligationRefs: PlanningRef[]; withheldFactRefs: PlanningRef[] }
export interface AdditionalPlanningRef { ref: PlanningRef; reason: 'lore_detail' | 'character_context' | 'plot_context' | 'setup_payoff_context' }
export interface ChapterOutlinePayload { chapter: ChapterAddress; povRef: PlanningRef | null; scenes: Scene[]; additionalRefs: AdditionalPlanningRef[] }
export type PlanningEnvelope = { protocol: typeof PLANNING_PROTOCOL; language: 'zh' | 'en'; dependencies: CampaignArtifactRef[] } & (
  { stage: 'outline'; payload: OutlinePayload } | { stage: 'character_bible'; payload: CharacterBiblePayload } |
  { stage: 'detailed_outline'; payload: DetailedOutlinePayload } | { stage: 'chapter_outline'; payload: ChapterOutlinePayload }
)
export type PlanningRecordValue = GenreRule | LoreEntity | WorldFact | PlotPromise | IntentionallyOpenThread | Character | CharacterState | EpistemicState | Transition | Beat | Obligation | ChapterEntry

function object(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  planningAssert(value !== null && typeof value === 'object' && !Array.isArray(value))
  const actual = Object.keys(value)
  planningAssert(actual.length === keys.length && keys.every(key => Object.hasOwn(value, key)))
}
function array(value: unknown, max: number, min = 0): asserts value is unknown[] { planningAssert(Array.isArray(value) && value.length >= min && value.length <= max) }
function integer(value: unknown, max: number, min = 0): asserts value is number { planningAssert(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max) }
function text(value: unknown, max = 512): asserts value is string {
  planningAssert(typeof value === 'string' && value.length > 0 && value.length <= max)
  try { assertScalarText(value) } catch { throw new PlanningRefusalError('invalid_planning_payload') }
}
function id(value: unknown): asserts value is string { planningAssert(typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_.:-]{0,63}$/.test(value)) }
function choice(value: unknown, allowed: readonly unknown[]): void { planningAssert(allowed.includes(value)) }
function artifactRef(value: unknown): void {
  object(value, ['taskId', 'revision', 'hash']); text(value.taskId, 128); integer(value.revision, 2048)
  planningAssert(typeof value.hash === 'string' && /^[a-f0-9]{64}$/.test(value.hash))
}
function ref(value: unknown, kinds: readonly PlanningRecordKind[] = PLANNING_RECORD_KINDS, nullable = false): void {
  if (value === null && nullable) return
  object(value, ['source', 'artifact', 'recordKind', 'recordId']); choice(value.source, ['self', 'ancestor'])
  if (value.source === 'self') planningAssert(value.artifact === null)
  else artifactRef(value.artifact)
  choice(value.recordKind, kinds); id(value.recordId)
}
function refs(value: unknown, kinds: readonly PlanningRecordKind[], max = 8, min = 0): asserts value is PlanningRef[] {
  array(value, max, min); value.forEach(item => ref(item, kinds))
  planningAssert(new Set(value.map(item => canonicalStringify(item))).size === value.length)
}
export function planningChapterAddress(manifest: PlanningSourceManifest, ordinal: number): ChapterAddress {
  const outline = manifest.tasks.find(t => t.kind === 'chapter_outline' && t.chapterOrdinal === ordinal)
  const body = manifest.tasks.find(t => t.kind === 'chapter_body' && t.chapterOrdinal === ordinal)
  planningAssert(outline && body, 'invalid_planning_schedule')
  return { ordinal, outlineTaskId: outline.id, bodyTaskId: body.id }
}
function address(value: unknown, manifest: PlanningSourceManifest): void {
  object(value, ['ordinal', 'outlineTaskId', 'bodyTaskId']); integer(value.ordinal, PLANNING_LIMITS.chapters, 1)
  const expected = planningChapterAddress(manifest, value.ordinal)
  planningAssert(value.outlineTaskId === expected.outlineTaskId && value.bodyTaskId === expected.bodyTaskId, 'invalid_planning_schedule')
}
function interval(value: Record<string, unknown>, manifest: PlanningSourceManifest): void {
  address(value.validFrom, manifest); address(value.validThrough, manifest)
  planningAssert((value.validFrom as ChapterAddress).ordinal <= (value.validThrough as ChapterAddress).ordinal, 'invalid_planning_schedule')
}
function strings(value: unknown): void { array(value, 8, 1); value.forEach(item => text(item)) }
function boundedTree(value: unknown, check: PlanningCheck): void {
  let nodes = 0
  const walk = (node: unknown, depth: number) => {
    check(); planningAssert(++nodes <= PLANNING_LIMITS.nodes && depth <= PLANNING_LIMITS.depth, 'planning_budget_exceeded')
    if (typeof node === 'number') integer(node, Number.MAX_SAFE_INTEGER)
    else if (typeof node === 'string') { try { assertScalarText(node) } catch { throw new PlanningRefusalError('invalid_planning_payload') } }
    else if (Array.isArray(node)) node.forEach(item => walk(item, depth + 1))
    else if (node !== null && typeof node === 'object') Object.values(node).forEach(item => walk(item, depth + 1))
    else planningAssert(node === null || typeof node === 'boolean')
  }
  walk(value, 0)
}
/** Wire parsing only; reference identity and relational schedules are checked by planningCanon. */
export function parsePlanningEnvelope(raw: string, manifest: PlanningSourceManifest, task: CampaignTaskSpec, dependencies: readonly CampaignArtifactRef[], check: PlanningCheck = () => {}): PlanningEnvelope {
  check(); planningAssert(task.kind !== 'chapter_body')
  planningAssert(typeof raw === 'string')
  planningByteLength(raw, PLANNING_STAGE_LIMITS[task.kind].responseBytes)
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new PlanningRefusalError('invalid_planning_payload') }
  check(); boundedTree(value, check)
  object(value, ['protocol', 'stage', 'language', 'dependencies', 'payload'])
  planningAssert(value.protocol === PLANNING_PROTOCOL, 'unsupported_planning_protocol')
  planningAssert(value.stage === task.kind && value.language === manifest.language)
  array(value.dependencies, 64); value.dependencies.forEach(artifactRef)
  planningAssert(canonicalStringify(value.dependencies) === canonicalStringify(dependencies), 'source_identity_mismatch')
  const p = value.payload
  if (task.kind === 'outline') {
    object(p, ['premise', 'endingIntent', 'genreRules', 'loreEntities', 'worldFacts', 'plotPromises', 'intentionallyOpenThreads'])
    text(p.premise, 1024); text(p.endingIntent, 1024)
    array(p.genreRules, 16, 1); p.genreRules.forEach(row => { object(row, ['id', 'polarity', 'statement']); id(row.id); choice(row.polarity, ['required', 'forbidden']); text(row.statement) })
    array(p.loreEntities, 48); p.loreEntities.forEach(row => { object(row, ['id', 'entityKind', 'name', 'description', 'invariantFactRefs']); id(row.id); choice(row.entityKind, ['place', 'object', 'group', 'system', 'historical_event']); text(row.name, 128); text(row.description); refs(row.invariantFactRefs, ['world_fact']) })
    array(p.worldFacts, 32); p.worldFacts.forEach(row => { object(row, ['id', 'statement', 'subjectRefs', 'premiseRefs', 'invariant', 'validFrom', 'validThrough', 'readerNotBefore']); id(row.id); text(row.statement); refs(row.subjectRefs, ['lore_entity']); refs(row.premiseRefs, ['world_fact']); planningAssert(typeof row.invariant === 'boolean'); interval(row, manifest); address(row.readerNotBefore, manifest) })
    array(p.plotPromises, 16); p.plotPromises.forEach(row => { object(row, ['id', 'statement', 'dueChapter', 'premiseRefs']); id(row.id); text(row.statement); address(row.dueChapter, manifest); refs(row.premiseRefs, ['lore_entity', 'world_fact']) })
    array(p.intentionallyOpenThreads, 16); p.intentionallyOpenThreads.forEach(row => { object(row, ['id', 'statement', 'premiseRefs', 'disposition']); id(row.id); text(row.statement); refs(row.premiseRefs, ['lore_entity', 'world_fact']); choice(row.disposition, ['intentionally_open_at_end']) })
    planningAssert(p.plotPromises.length + p.intentionallyOpenThreads.length <= 16)
  } else if (task.kind === 'character_bible') {
    object(p, ['characters', 'characterStates', 'epistemicStates', 'transitions'])
    array(p.characters, 24, 1); p.characters.forEach(row => { object(row, ['id', 'name', 'role', 'motivation', 'identityInvariants', 'capabilityInvariants', 'initialStateRef', 'initialEpistemicRefs']); id(row.id); text(row.name, 128); text(row.role); text(row.motivation); strings(row.identityInvariants); strings(row.capabilityInvariants); ref(row.initialStateRef, ['character_state']); refs(row.initialEpistemicRefs, ['epistemic_state']) })
    array(p.characterStates, 72, 1); p.characterStates.forEach(row => { object(row, ['id', 'characterRef', 'description', 'capabilityFactRefs', 'validFrom', 'validThrough']); id(row.id); ref(row.characterRef, ['character']); text(row.description); refs(row.capabilityFactRefs, ['world_fact']); interval(row, manifest) })
    array(p.epistemicStates, 96); p.epistemicStates.forEach(row => { object(row, ['id', 'holderRef', 'subjectFactRef', 'attitude', 'claimText', 'presentation', 'validFrom', 'validThrough', 'readerNotBefore']); id(row.id); ref(row.holderRef, ['character'], true); ref(row.subjectFactRef, ['world_fact']); choice(row.attitude, ['knows', 'believes', 'doubts', 'unaware']); text(row.claimText); choice(row.presentation, ['character_internal', 'narrator_claim']); planningAssert((row.presentation === 'narrator_claim') === (row.holderRef === null)); interval(row, manifest); address(row.readerNotBefore, manifest) })
    array(p.transitions, 96); p.transitions.forEach(row => { object(row, ['id', 'transitionKind', 'holderRef', 'fromRef', 'toRef', 'atChapter', 'phase', 'supportPromiseRefs']); id(row.id); choice(row.transitionKind, ['character_state', 'epistemic_state']); ref(row.holderRef, ['character'], row.transitionKind === 'epistemic_state'); ref(row.fromRef, [row.transitionKind as 'character_state' | 'epistemic_state']); ref(row.toRef, [row.transitionKind as 'character_state' | 'epistemic_state']); address(row.atChapter, manifest); choice(row.phase, ['end_of_chapter']); refs(row.supportPromiseRefs, ['plot_promise'], 8, 1) })
    planningAssert(p.epistemicStates.length + p.transitions.length <= 96)
  } else if (task.kind === 'detailed_outline') {
    object(p, ['beats', 'transitionBindings', 'obligations', 'chapters'])
    array(p.beats, 128); p.beats.forEach(row => { object(row, ['id', 'chapter', 'order', 'summary', 'causalPredecessorRefs', 'participantRefs', 'factRefs', 'transitionRefs', 'readerDisclosureFactRefs']); id(row.id); address(row.chapter, manifest); integer(row.order, 128, 1); text(row.summary); refs(row.causalPredecessorRefs, ['beat']); refs(row.participantRefs, ['character', 'character_state']); refs(row.factRefs, ['world_fact']); refs(row.transitionRefs, ['transition']); refs(row.readerDisclosureFactRefs, ['world_fact']) })
    array(p.transitionBindings, 96); p.transitionBindings.forEach(row => { object(row, ['transitionRef', 'supportingBeatRefs']); ref(row.transitionRef, ['transition']); refs(row.supportingBeatRefs, ['beat'], 8, 1) })
    array(p.obligations, 64); p.obligations.forEach(row => { object(row, ['id', 'summary', 'setupRefs', 'payoffRefs', 'contextRefs', 'dueChapter', 'readerNotBefore', 'disposition', 'openThreadRef']); id(row.id); text(row.summary); refs(row.setupRefs, ['beat'], 8, 1); refs(row.payoffRefs, ['beat']); refs(row.contextRefs, ['world_fact', 'lore_entity', 'character_state', 'epistemic_state', 'plot_promise', 'beat']); address(row.dueChapter, manifest); address(row.readerNotBefore, manifest); choice(row.disposition, ['planned_payoff', 'intentionally_open_at_end']); ref(row.openThreadRef, ['intentionally_open_thread'], true); planningAssert(row.disposition === 'planned_payoff' ? row.payoffRefs.length > 0 && row.openThreadRef === null : row.payoffRefs.length === 0 && row.openThreadRef !== null) })
    array(p.chapters, 60, 1); p.chapters.forEach(row => { object(row, ['id', 'chapter', 'povRef', 'beatRefs', 'requiredConstraintRefs', 'requiredFactRefs', 'requiredTransitionRefs', 'obligationRefs']); id(row.id); address(row.chapter, manifest); ref(row.povRef, ['character'], true); refs(row.beatRefs, ['beat'], 128); refs(row.requiredConstraintRefs, ['genre_rule', 'character'], 128); refs(row.requiredFactRefs, ['world_fact'], 128); refs(row.requiredTransitionRefs, ['transition'], 128); refs(row.obligationRefs, ['obligation'], 128) })
  } else {
    object(p, ['chapter', 'povRef', 'scenes', 'additionalRefs']); address(p.chapter, manifest); planningAssert((p.chapter as ChapterAddress).ordinal === task.chapterOrdinal, 'invalid_planning_schedule'); ref(p.povRef, ['character'], true)
    array(p.scenes, 12, 1); p.scenes.forEach((row, index) => { object(row, ['id', 'order', 'summary', 'beatRefs', 'castRefs', 'stateRefs', 'epistemicRefs', 'setupObligationRefs', 'payoffObligationRefs', 'withheldFactRefs']); id(row.id); integer(row.order, 12, 1); planningAssert(row.order === index + 1, 'invalid_planning_schedule'); text(row.summary); refs(row.beatRefs, ['beat'], 128); refs(row.castRefs, ['character'], 128); refs(row.stateRefs, ['character_state'], 128); refs(row.epistemicRefs, ['epistemic_state'], 128); refs(row.setupObligationRefs, ['obligation'], 128); refs(row.payoffObligationRefs, ['obligation'], 128); refs(row.withheldFactRefs, ['world_fact'], 128) })
    planningAssert(new Set(p.scenes.map(row => (row as { id: string }).id)).size === p.scenes.length)
    array(p.additionalRefs, 8); p.additionalRefs.forEach(row => { object(row, ['ref', 'reason']); choice(row.reason, ['lore_detail', 'character_context', 'plot_context', 'setup_payoff_context']); const kinds: Record<string, PlanningRecordKind[]> = { lore_detail: ['lore_entity', 'world_fact'], character_context: ['character', 'character_state', 'epistemic_state', 'transition'], plot_context: ['plot_promise', 'beat', 'chapter_entry'], setup_payoff_context: ['obligation', 'intentionally_open_thread', 'beat', 'world_fact'] }; ref(row.ref, kinds[row.reason as string]) })
  }
  check(); planningAssert(canonicalStringify(value) === raw)
  check(); return value as unknown as PlanningEnvelope
}
