/** Exact, complete source assembly for the bounded v4 pilot. No IO or authority. */
import type { CreativeArtifact, CreativeArtifactRef, CreativeOrdinal, CreativePromptPayloadV1, CreativeRecordIdentity, CreativeSourceView, CreativeTaskId, PreparedCreativeInputV1 } from '../../types/creativePilot'
import { canonicalStringify, hashCampaignValue, hashText, utf8Bytes } from './protocol'
import { buildPlanningCanon, resolvePlanningRef, type PlanningRecord } from './planningCanon'
import { PLANNING_STAGE_LIMITS, planningChapterAddress, type Beat, type ChapterEntry, type EpistemicState, type Obligation, type Transition, type WorldFact } from './planningProtocol'
import { CreativePilotError } from './creativePilotProtocol'
import { creativePlanOutputSchema, CREATIVE_COMPILER_VERSION, CREATIVE_PROMPT_VERSION, CREATIVE_STAGE_INSTRUCTIONS, CREATIVE_SYSTEM } from './creativePilotSchema'

export function creativeArtifactRef(artifact: CreativeArtifact): CreativeArtifactRef {
  return { taskId: artifact.taskId, revision: artifact.revision, hash: artifact.hash }
}
function sourceAssert(value: unknown): asserts value { if (!value) throw new CreativePilotError('source_changed') }
const refOf = (record: PlanningRecord): CreativeRecordIdentity => ({ artifact: { taskId: record.artifact.taskId as CreativeTaskId, revision: record.artifact.revision as 0, hash: record.artifact.hash }, recordKind: record.recordKind, recordId: record.recordId })

export async function compileCreativeInput(view: CreativeSourceView, taskId: CreativeTaskId, check: () => void = () => {}): Promise<PreparedCreativeInputV1> {
  check()
  // Detach once before asynchronous hashes; a mutable caller cannot swap sources mid-compile.
  const { manifest, candidate, checkpoint, artifacts } = structuredClone(view)
  const task = manifest.tasks.find(row => row.id === taskId), state = checkpoint.tasks.find(row => row.taskId === taskId)
  sourceAssert(task && state && checkpoint.candidateHash === candidate.hash && candidate.campaignId === manifest.campaignId
    && candidate.brief.language === manifest.language && state.revision === candidate.revision)
  const dependencies = task.dependsOn.map(id => {
    check(); const parent = checkpoint.tasks.find(row => row.taskId === id)
    const artifact = parent?.artifactHash ? artifacts.get(parent.artifactHash) : undefined
    const spec = manifest.tasks.find(row => row.id === id)
    sourceAssert(parent?.status === 'accepted' && artifact && spec && artifact.taskId === id && artifact.hash === parent.artifactHash
      && artifact.campaignId === manifest.campaignId && artifact.candidateHash === candidate.hash
      && artifact.taskRevision === parent.revision && artifact.revision === 0 && artifact.kind === spec.kind)
    return artifact
  })
  const plans = dependencies.filter(artifact => artifact.kind !== 'chapter_body')
  const canon = await buildPlanningCanon(manifest, plans, check)
  check()
  const ordinal = task.chapterOrdinal ?? 0
  if (task.kind === 'chapter_outline' || task.kind === 'chapter_body') sourceAssert(canon.globalCanon && canon.canonBaseRoot)
  if (task.kind === 'chapter_body') sourceAssert(canon.fullPlanRoot && plans.length === 6)
  const sourceRefs = dependencies.map(creativeArtifactRef)
  const earlyPlanning: CreativePromptPayloadV1['earlyPlanning'] = { outline: null, characterBible: null }
  if (!canon.globalCanon) for (const envelope of canon.envelopes.values()) {
    if (envelope.stage === 'outline') earlyPlanning.outline = envelope.payload
    if (envelope.stage === 'character_bible') earlyPlanning.characterBible = envelope.payload
  }
  const partitions: CreativePromptPayloadV1['partitions'] = {
    authorOnlyFactRefs: [], readerVisibleFactRefs: [], characterEpistemic: { current: [], future: [], past: [] }, narratorClaims: { current: [], future: [], past: [] },
  }
  const applicableObligations: CreativeRecordIdentity[] = [], applicableTransitions: CreativeRecordIdentity[] = []
  // The canon's registered order is task order, then record kind/id ASCII order.
  const catalog = canon.records.map((record, index) => {
    check(); const identity = refOf(record)
    const owner = plans.find(artifact => artifact.taskId === identity.artifact.taskId)
    sourceAssert(owner && owner.revision === record.artifact.revision && owner.hash === record.artifact.hash)
    const resolved = resolvePlanningRef(canon, { source: 'self', artifact: null, recordKind: identity.recordKind, recordId: identity.recordId }, record.artifact)
    sourceAssert(resolved === record)
    if (record.recordKind === 'world_fact') {
      const fact = record.value as WorldFact
      ;(ordinal >= fact.readerNotBefore.ordinal ? partitions.readerVisibleFactRefs : partitions.authorOnlyFactRefs).push(identity)
    } else if (record.recordKind === 'epistemic_state') {
      const epistemic = record.value as EpistemicState
      const bucket = epistemic.presentation === 'narrator_claim' ? partitions.narratorClaims : partitions.characterEpistemic
      bucket[ordinal < epistemic.validFrom.ordinal ? 'future' : ordinal > epistemic.validThrough.ordinal ? 'past' : 'current'].push(identity)
    } else if (record.recordKind === 'transition' && (record.value as Transition).atChapter.ordinal === ordinal) applicableTransitions.push(identity)
    else if (record.recordKind === 'obligation') {
      const obligation = record.value as Obligation
      const first = Math.min(...obligation.setupRefs.map(ref => (resolvePlanningRef(canon, ref, record.artifact).value as Beat).chapter.ordinal))
      if (ordinal >= first && ordinal <= obligation.dueChapter.ordinal) applicableObligations.push(identity)
    }
    return { token: index + 1, identity }
  })
  let selectedChapter: CreativePromptPayloadV1['selectedChapter'] = null
  if (task.chapterOrdinal !== null) {
    const entry = canon.records.find(row => row.recordKind === 'chapter_entry' && (row.value as ChapterEntry).chapter.ordinal === ordinal)
    sourceAssert(entry)
    const address = planningChapterAddress(manifest, ordinal), outline = canon.envelopes.get(address.outlineTaskId)
    const source = plans.find(row => row.taskId === address.outlineTaskId)
    selectedChapter = { address, entry: structuredClone(entry.value as ChapterEntry), outline: outline?.stage === 'chapter_outline' && source
      ? { source: creativeArtifactRef(source), payload: outline.payload } : null, applicableObligations, applicableTransitions }
    if (task.kind === 'chapter_body') sourceAssert(selectedChapter.outline)
  }
  const bodies = dependencies.filter(artifact => artifact.kind === 'chapter_body')
  sourceAssert(bodies.length === (task.kind === 'chapter_body' ? ordinal - 1 : 0))
  const previousBodies = bodies.map((body, index) => {
    sourceAssert(body.taskId === `b-${index + 1}`)
    return { source: creativeArtifactRef(body), taskRevision: body.taskRevision, text: body.text, raw: { ...body.raw } }
  })
  const suppliedChapterOutlineOrdinals: CreativeOrdinal[] = selectedChapter?.outline ? [ordinal as CreativeOrdinal] : []
  const payload: CreativePromptPayloadV1 = {
    protocol: 'creative-pilot-input-v1', promptVersion: CREATIVE_PROMPT_VERSION, compilerVersion: CREATIVE_COMPILER_VERSION,
    identity: { campaignId: manifest.campaignId, manifestHash: manifest.hash, candidateHash: candidate.hash, briefHash: candidate.briefHash,
      taskId, taskRevision: state.revision, stage: task.kind, chapterOrdinal: task.chapterOrdinal, language: manifest.language },
    brief: structuredClone(candidate.brief), target: { chapters: 3, perChapterTargetScalars: 512, acceptedMinScalars: 256, acceptedMaxScalars: 1024 },
    sourceRefs, canonBaseRoot: canon.canonBaseRoot, fullPlanRoot: canon.fullPlanRoot, earlyPlanning,
    globalCanon: canon.globalCanon, selectedChapter, catalog, catalogDigest: await hashCampaignValue('creative-catalog-v1', catalog), partitions, previousBodies,
    scope: { planningCoverage: selectedChapter?.outline ? 'complete_global_canon_and_selected_chapter' : canon.globalCanon ? 'complete_global_canon' : 'complete_available_global_stages',
      suppliedChapterOutlineOrdinals, omittedChapterOutlineOrdinals: plans.filter(row => row.kind === 'chapter_outline' && row.taskId !== selectedChapter?.outline?.source.taskId)
        .map(row => manifest.tasks.find(spec => spec.id === row.taskId)!.chapterOrdinal as CreativeOrdinal),
      realizedBodyCoverage: previousBodies.length ? 'complete_accepted_preceding_prefix' : 'none',
      suppliedBodyOrdinals: bodies.map((_row, index) => (index + 1) as CreativeOrdinal), semanticCompleteness: 'not_reviewed', exposure: 'author_and_offline_control_writer_only' },
    stageInstruction: CREATIVE_STAGE_INSTRUCTIONS[task.kind],
    outputSchema: task.kind === 'chapter_body' ? null : creativePlanOutputSchema(task.kind, task.id, manifest.language),
  }
  check()
  const wire = { system: CREATIVE_SYSTEM, prompt: canonicalStringify(payload) }, encoded = canonicalStringify(wire)
  const inputBytes = utf8Bytes(encoded), inputUtf16 = encoded.length
  if (inputBytes > PLANNING_STAGE_LIMITS[task.kind].inputBytes || inputBytes > 65_536 || inputUtf16 > 65_536) throw new CreativePilotError('context_capacity')
  const inputDigest = await hashText(encoded)
  check(); return { ...payload, wire, inputDigest, inputBytes, inputUtf16 }
}
