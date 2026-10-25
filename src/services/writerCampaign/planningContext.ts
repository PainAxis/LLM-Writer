/** Pure deterministic local packet compiler. It never reserves, dispatches or saves. */
import type { CampaignArtifact, CampaignArtifactRef, CampaignTaskKind } from '../../types/writerCampaign'
import type { CampaignProviderContext, CampaignPreparedInput } from './fixtureAdapter'
import { canonicalStringify, hashText, utf8Bytes } from './protocol'
import { buildPlanningCanon, planningClosure, resolvePlanningRef, type PlanningCanon, type PlanningRecord } from './planningCanon'
import { PLANNING_BRIEF, PLANNING_STAGE_INSTRUCTIONS, PLANNING_TEMPLATE_VERSION, planningChapterCount, validatePlanningProfile } from './planningProfile'
import { PLANNING_STAGE_LIMITS, PlanningRefusalError, planningAssert, planningChapterAddress, type PlanningCheck, type PlanningRefusalCode, type PlanningRef, type PlanningRecordKind, type ChapterAddress, type OutlinePayload, type CharacterBiblePayload, type ChapterOutlinePayload, type WorldFact, type EpistemicState, type Transition, type Obligation, type Beat } from './planningProtocol'

export type PlanningContextPurpose = 'stage_dispatch' | 'body_fixture_dispatch' | 'planning_preview'
export interface PlanningContextScope {
  planningCoverage: 'complete_available_global_stages' | 'complete_global_planning_canon' | 'complete_global_planning_canon_and_selected_chapter'
  declaredReferenceCoverage: 'complete'
  semanticCompleteness: 'not_reviewed'
  realizedBodyCoverage: 'none' | 'complete_previous_body_only'
  proseEvidenceScope: 'planning_only' | 'planning_only_with_previous_body'
  includedChapterOutlineCount: number
  omittedChapterOutlineCount: number
}
export type PlanningPreviewResult = {
  status: 'ready'
  selectedChapter: ChapterAddress
  nextEligibleBodyTaskId: string | null
  canonBaseRoot: string
  fullPlanRoot: string
  sourceRefs: CampaignArtifactRef[]
  scope: PlanningContextScope
  input: string
  inputDigest: string
  inputBytes: number
  inputUtf16: number
} | { status: 'refused'; refusalCode: PlanningRefusalCode }
export interface CompiledPlanningContext extends CampaignPreparedInput {
  canonBaseRoot: string | null
  fullPlanRoot: string | null
  sourceRefs: CampaignArtifactRef[]
  scope: PlanningContextScope
  selectedChapter: ChapterAddress | null
}
interface PlanningRecordIdentity { artifact: CampaignArtifactRef; recordKind: PlanningRecordKind; recordId: string }
type Container = 'early_outline' | 'early_character_bible' | 'global_outline' | 'global_character_bible' | 'global_detailed_outline'
interface TemporalPartition { current: PlanningRecordIdentity[]; future: PlanningRecordIdentity[]; past: PlanningRecordIdentity[] }
interface EarlyPlanning { outline: OutlinePayload | null; characterBible: CharacterBiblePayload | null }
const CONTAINER_RECORD_FIELDS: Readonly<Record<'outline' | 'character_bible' | 'detailed_outline', Readonly<Partial<Record<PlanningRecordKind, string>>>>> = Object.freeze({
  outline: Object.freeze({ genre_rule: 'genreRules', lore_entity: 'loreEntities', world_fact: 'worldFacts', plot_promise: 'plotPromises', intentionally_open_thread: 'intentionallyOpenThreads' }),
  character_bible: Object.freeze({ character: 'characters', character_state: 'characterStates', epistemic_state: 'epistemicStates', transition: 'transitions' }),
  detailed_outline: Object.freeze({ beat: 'beats', obligation: 'obligations', chapter_entry: 'chapters' }),
})
const artifactRef = (artifact: CampaignArtifact): CampaignArtifactRef => ({ taskId: artifact.taskId, revision: artifact.revision, hash: artifact.hash })
const recordRef = (record: PlanningRecord): PlanningRecordIdentity => ({ artifact: { ...record.artifact }, recordKind: record.recordKind, recordId: record.recordId })
const same = (left: unknown, right: unknown) => canonicalStringify(left) === canonicalStringify(right)

/** A closed container is an exact source/value binding, not a lossy projection.
 * Full artifact refs are already supplied once in the relevant source table.
 */
function closureRow(record: PlanningRecord, canon: PlanningCanon, early: EarlyPlanning, sourceRefs: CampaignArtifactRef[]) {
  const artifact = canon.artifactsByTask.get(record.artifact.taskId)
  planningAssert(artifact && same(artifactRef(artifact), record.artifact), 'source_identity_mismatch')
  let container: Container, payload: unknown, source: CampaignArtifactRef | undefined
  switch (artifact.kind) {
    case 'outline':
      container = canon.globalCanon ? 'global_outline' : 'early_outline'
      payload = canon.globalCanon ? canon.globalCanon.outline : early.outline
      source = canon.globalCanon ? canon.globalCanon.sources[0] : sourceRefs[0]
      break
    case 'character_bible':
      container = canon.globalCanon ? 'global_character_bible' : 'early_character_bible'
      payload = canon.globalCanon ? canon.globalCanon.characterBible : early.characterBible
      source = canon.globalCanon ? canon.globalCanon.sources[1] : sourceRefs[1]
      break
    case 'detailed_outline':
      planningAssert(canon.globalCanon, 'missing_planning_source')
      container = 'global_detailed_outline'; payload = canon.globalCanon.detailedOutline; source = canon.globalCanon.sources[2]
      break
    default: throw new PlanningRefusalError('invalid_planning_reference')
  }
  planningAssert(source && same(source, record.artifact), 'source_identity_mismatch')
  planningAssert(payload !== null && typeof payload === 'object' && !Array.isArray(payload), 'missing_planning_source')
  const field = CONTAINER_RECORD_FIELDS[artifact.kind][record.recordKind]
  planningAssert(field, 'invalid_planning_reference')
  const rows = (payload as Record<string, unknown>)[field]
  // Canon payloads and records share already-validated values. No second copy,
  // fresh parse, inferred source or duplicate per-record serialization is needed.
  planningAssert(Array.isArray(rows) && rows.some(value => value === record.value && value.id === record.recordId), 'missing_planning_source')
  return { container, recordKind: record.recordKind, recordId: record.recordId }
}

/** Byte limits measure the serialized wire, never guessed provider tokens. */
export function planningContextMetrics(text: string, stage: CampaignTaskKind): { bytes: number; utf16: number } {
  const bytes = utf8Bytes(text)
  if (bytes > PLANNING_STAGE_LIMITS[stage].inputBytes) throw new PlanningRefusalError('context_budget_exceeded')
  return { bytes, utf16: text.length }
}

/**
 * Dependencies are the repository/engine's verified exact source view. The optional
 * canon is read-local derived work only: it must match the entire planning source
 * set exactly and is never loaded from a persisted packet or adapter output.
 */
export async function compilePlanningContext(context: CampaignProviderContext, purpose?: PlanningContextPurpose,
  check: PlanningCheck = context.check ?? (() => {}), verifiedCanon?: PlanningCanon): Promise<CompiledPlanningContext> {
  check()
  const { manifest, task, dependencies } = context
  planningAssert(validatePlanningProfile(manifest), 'unsupported_profile')
  const registeredTask = manifest.tasks.find(value => value.id === task.id)
  planningAssert(registeredTask && same(task, registeredTask), 'invalid_planning_graph')
  planningAssert(Number.isSafeInteger(context.taskRevision) && context.taskRevision >= 0, 'source_identity_mismatch')
  const selectedPurpose = purpose ?? (task.kind === 'chapter_body' ? 'body_fixture_dispatch' : 'stage_dispatch')
  planningAssert(task.kind === 'chapter_body'
    ? selectedPurpose === 'body_fixture_dispatch' || selectedPurpose === 'planning_preview'
    : selectedPurpose === 'stage_dispatch', 'invalid_purpose')
  const preview = selectedPurpose === 'planning_preview'
  const expectedIds = preview ? task.dependsOn.filter(id => manifest.tasks.find(value => value.id === id)!.kind !== 'chapter_body') : task.dependsOn
  planningAssert(dependencies.length === expectedIds.length, 'missing_planning_source')
  for (let index = 0; index < expectedIds.length; index++) {
    check()
    const artifact = dependencies[index]!, spec = manifest.tasks.find(value => value.id === expectedIds[index])!
    planningAssert(artifact.taskId === spec.id && artifact.kind === spec.kind && artifact.campaignId === manifest.campaignId, 'source_identity_mismatch')
  }
  const planningArtifacts = dependencies.filter(value => value.kind !== 'chapter_body')
  let canon: PlanningCanon
  if (verifiedCanon) {
    planningAssert(verifiedCanon.artifactsByTask.size === planningArtifacts.length && planningArtifacts.every(artifact => {
      const known = verifiedCanon.artifactsByTask.get(artifact.taskId)
      return known && same(artifactRef(known), artifactRef(artifact)) && known.text === artifact.text
    }), 'source_identity_mismatch')
    canon = verifiedCanon
  } else canon = await buildPlanningCanon(manifest, planningArtifacts, check)
  check()
  const sourceRefs = dependencies.map(artifactRef)
  const selectedChapter = task.chapterOrdinal === null ? null : planningChapterAddress(manifest, task.chapterOrdinal)
  const earlyPlanning: EarlyPlanning = { outline: null, characterBible: null }
  if (!canon.globalCanon) {
    for (const envelope of canon.envelopes.values()) {
      if (envelope.stage === 'outline') earlyPlanning.outline = envelope.payload
      if (envelope.stage === 'character_bible') earlyPlanning.characterBible = envelope.payload
    }
  }
  if (task.kind === 'chapter_outline' || task.kind === 'chapter_body') planningAssert(canon.globalCanon && canon.canonBaseRoot, 'missing_planning_source')
  if (task.kind === 'chapter_body') planningAssert(canon.fullPlanRoot, 'incomplete_plan')

  const closure = planningClosure(canon, canon.records.map(record => ({
    ref: { source: 'self', artifact: null, recordKind: record.recordKind, recordId: record.recordId } as PlanningRef,
    ownerArtifact: record.artifact,
  })), check).map(record => { check(); return closureRow(record, canon, earlyPlanning, sourceRefs) })
  const partitions = { authorOnlyFactRefs: [] as PlanningRecordIdentity[], readerVisibleFactRefs: [] as PlanningRecordIdentity[],
    characterEpistemic: { current: [], future: [], past: [] } as TemporalPartition,
    narratorClaims: { current: [], future: [], past: [] } as TemporalPartition }
  const applicableObligationRefs: PlanningRecordIdentity[] = [], applicableTransitionRefs: PlanningRecordIdentity[] = []
  const ordinal = selectedChapter?.ordinal ?? 0
  for (const record of canon.records) {
    check()
    if (record.recordKind === 'world_fact') {
      const fact = record.value as WorldFact
      ;(ordinal >= fact.readerNotBefore.ordinal ? partitions.readerVisibleFactRefs : partitions.authorOnlyFactRefs).push(recordRef(record))
    } else if (record.recordKind === 'epistemic_state') {
      const state = record.value as EpistemicState
      const partition = state.presentation === 'narrator_claim' ? partitions.narratorClaims : partitions.characterEpistemic
      partition[ordinal < state.validFrom.ordinal ? 'future' : ordinal > state.validThrough.ordinal ? 'past' : 'current'].push(recordRef(record))
    } else if (record.recordKind === 'transition' && ordinal === (record.value as Transition).atChapter.ordinal) {
      applicableTransitionRefs.push(recordRef(record))
    } else if (record.recordKind === 'obligation') {
      const obligation = record.value as Obligation
      const firstSetup = Math.min(...obligation.setupRefs.map(ref => (resolvePlanningRef(canon, ref, record.artifact).value as Beat).chapter.ordinal))
      if (ordinal >= firstSetup && ordinal <= obligation.dueChapter.ordinal) applicableObligationRefs.push(recordRef(record))
    }
  }
  let chapter: null | { address: ChapterAddress; entryRef: PlanningRecordIdentity; outline: { source: CampaignArtifactRef; payload: ChapterOutlinePayload } | null; applicableObligationRefs: PlanningRecordIdentity[]; applicableTransitionRefs: PlanningRecordIdentity[] } = null
  if (selectedChapter) {
    const entry = canon.records.find(record => record.recordKind === 'chapter_entry' && (record.value as { chapter: ChapterAddress }).chapter.ordinal === ordinal)
    planningAssert(entry, 'missing_planning_source')
    const selectedOutline = canon.envelopes.get(selectedChapter.outlineTaskId)
    if (task.kind === 'chapter_body') planningAssert(selectedOutline?.stage === 'chapter_outline', 'incomplete_plan')
    chapter = { address: selectedChapter, entryRef: recordRef(entry), outline: selectedOutline?.stage === 'chapter_outline'
      ? { source: artifactRef(canon.artifactsByTask.get(selectedChapter.outlineTaskId)!), payload: selectedOutline.payload } : null,
    applicableObligationRefs, applicableTransitionRefs }
  }
  const predecessor = dependencies.find(value => value.kind === 'chapter_body')
  if (predecessor) {
    planningAssert(!preview && task.kind === 'chapter_body' && ordinal > 1 && predecessor.taskId === planningChapterAddress(manifest, ordinal - 1).bodyTaskId, 'source_identity_mismatch')
    // The predecessor's plan closure must be the same frozen plan, even after a candidate edit.
    planningAssert(same(predecessor.dependencies.slice(0, planningArtifacts.length), planningArtifacts.map(artifactRef)), 'source_identity_mismatch')
  }
  const previousBody = predecessor ? { source: artifactRef(predecessor), text: predecessor.text } : null
  const includedChapterOutlineCount = chapter?.outline ? 1 : 0
  const scope: PlanningContextScope = {
    planningCoverage: includedChapterOutlineCount ? 'complete_global_planning_canon_and_selected_chapter' : canon.globalCanon ? 'complete_global_planning_canon' : 'complete_available_global_stages',
    declaredReferenceCoverage: 'complete', semanticCompleteness: 'not_reviewed',
    realizedBodyCoverage: previousBody ? 'complete_previous_body_only' : 'none',
    proseEvidenceScope: previousBody ? 'planning_only_with_previous_body' : 'planning_only', includedChapterOutlineCount,
    omittedChapterOutlineCount: planningArtifacts.filter(artifact => artifact.kind === 'chapter_outline').length - includedChapterOutlineCount,
  }
  const packet = {
    protocol: 'campaign-context-v1', purpose: selectedPurpose, profile: manifest.fixtureVersion, templateVersion: PLANNING_TEMPLATE_VERSION,
    identity: { campaignId: manifest.campaignId, manifestHash: manifest.hash, candidateId: context.candidateId, taskId: task.id,
      taskRevision: context.taskRevision, stage: task.kind, chapterOrdinal: task.chapterOrdinal, language: manifest.language,
      bodyTarget: { ...manifest.bodyTarget }, chapterCount: planningChapterCount(manifest) },
    brief: PLANNING_BRIEF[manifest.language],
    instruction: preview ? (manifest.language === 'zh' ? '只读规划预览；不授权正文调度、保存或对外披露。' : 'Read-only planning preview; no authority to dispatch, save a body or disclose externally.') : PLANNING_STAGE_INSTRUCTIONS[manifest.language][task.kind],
    sourceRefs, canonBaseRoot: canon.canonBaseRoot, fullPlanRoot: canon.fullPlanRoot,
    globalCanon: canon.globalCanon, earlyPlanning, chapter, closure, partitions, previousBody, scope,
  }
  check()
  const text = canonicalStringify(packet)
  check()
  const metrics = planningContextMetrics(text, task.kind)
  const digest = await hashText(text)
  check()
  return { text, digest, ...metrics, responseBytes: PLANNING_STAGE_LIMITS[task.kind].responseBytes,
    canonBaseRoot: canon.canonBaseRoot, fullPlanRoot: canon.fullPlanRoot, sourceRefs, scope, selectedChapter }
}
