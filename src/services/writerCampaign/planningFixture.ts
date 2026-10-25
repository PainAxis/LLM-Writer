/** Fixed offline responses. Exact ancestor hashes come from the real sealed inputs. */
import type { CampaignArtifact, CampaignManifest } from '../../types/writerCampaign'
import type { CampaignProviderContext } from './fixtureAdapter'
import { canonicalStringify } from './protocol'
import { planningBodyFixture, planningChapterCount, validatePlanningProfile } from './planningProfile'
import { PLANNING_PROTOCOL, PlanningRefusalError, planningChapterAddress, type PlanningRecordKind, type PlanningRef, type OutlinePayload, type CharacterBiblePayload, type DetailedOutlinePayload, type ChapterOutlinePayload, type PlanningEnvelope, type Beat } from './planningProtocol'

const self = (recordKind: PlanningRecordKind, recordId: string): PlanningRef => ({ source: 'self', artifact: null, recordKind, recordId })
const ancestor = (artifact: CampaignArtifact, recordKind: PlanningRecordKind, recordId: string): PlanningRef => ({ source: 'ancestor', artifact: { taskId: artifact.taskId, revision: artifact.revision, hash: artifact.hash }, recordKind, recordId })

export function planningFixtureResponse(context: CampaignProviderContext): string {
  const { manifest, task, dependencies } = context
  if (!validatePlanningProfile(manifest)) throw new PlanningRefusalError('unsupported_profile')
  if (task.kind === 'chapter_body') return planningBodyFixture(manifest, task.chapterOrdinal!)
  const count = planningChapterCount(manifest), zh = manifest.language === 'zh'
  const say = (chinese: string, english: string) => zh ? chinese : english
  const addr = (ordinal: number) => planningChapterAddress(manifest, ordinal)
  const source = (kind: CampaignArtifact['kind']) => {
    const artifact = dependencies.find(value => value.kind === kind)
    if (!artifact) throw new PlanningRefusalError('missing_planning_source')
    return artifact
  }
  let payload: PlanningEnvelope['payload']
  if (task.kind === 'outline') {
    const full = count === 3
    const outline: OutlinePayload = {
      premise: say('守塔人与记录员寻找失落的铜铃。', 'A keeper and recorder search for a missing brass bell.'),
      endingIntent: say('恢复信号，保留远船去向。', 'Restore the signal while leaving the distant ship unresolved.'),
      genreRules: [{ id: 'genre.coastal', polarity: 'required', statement: say('沿海悬疑；不引入超自然解答。', 'Coastal mystery; no supernatural solution.') }],
      loreEntities: [{ id: 'lore.bell', entityKind: 'object', name: say('铜铃', 'brass bell'), description: say('灯塔的潮汐信号铃。', 'The lighthouse tide-signal bell.'), invariantFactRefs: [self('world_fact', 'fact.bell_owner')] }],
      worldFacts: [{ id: 'fact.bell_owner', statement: say('铜铃属于灯塔。', 'The bell belongs to the lighthouse.'), subjectRefs: [self('lore_entity', 'lore.bell')], premiseRefs: [], invariant: true, validFrom: addr(1), validThrough: addr(count), readerNotBefore: addr(1) }],
      plotPromises: [{ id: 'promise.signal', statement: say(full ? '第三章前恢复信号。' : '结束前恢复信号。', full ? 'Restore the signal by chapter three.' : 'Restore the signal by the ending.'), dueChapter: addr(count), premiseRefs: [self('world_fact', 'fact.bell_owner')] }],
      intentionallyOpenThreads: [{ id: 'open.ship', statement: say('远船的去向留待以后。', "The distant ship's destination remains open."), premiseRefs: [], disposition: 'intentionally_open_at_end' }],
    }
    if (full) {
      outline.worldFacts.push({ id: 'fact.low_tide', statement: say('退潮时石槽会露出。', 'The stone channel is exposed at low tide.'), subjectRefs: [], premiseRefs: [], invariant: false, validFrom: addr(1), validThrough: addr(3), readerNotBefore: addr(2) })
      outline.plotPromises[0]!.premiseRefs.push(self('world_fact', 'fact.low_tide'))
    }
    payload = outline
  } else if (task.kind === 'character_bible') {
    const outline = source('outline'), o = (kind: PlanningRecordKind, id: string) => ancestor(outline, kind, id)
    const bible: CharacterBiblePayload = {
      characters: [{ id: 'char.keeper', name: say('林岚', 'Mara'), role: say('守塔人', 'lighthouse keeper'), motivation: say('恢复信号，保护归船。', 'Restore the signal to protect returning boats.'), identityInvariants: [say('始终是灯塔守护者。', 'Remains the lighthouse keeper.')], capabilityInvariants: [say('依靠记录，不会超自然感知。', 'Relies on records, not supernatural perception.')], initialStateRef: self('character_state', 'state.keeper_cautious'), initialEpistemicRefs: count === 3 ? [self('epistemic_state', 'know.keeper_before')] : [] }],
      characterStates: [{ id: 'state.keeper_cautious', characterRef: self('character', 'char.keeper'), description: say('先核对记录再行动。', 'Check the record before acting.'), capabilityFactRefs: [], validFrom: addr(1), validThrough: addr(count === 3 ? 2 : count) }],
      epistemicStates: [], transitions: [],
    }
    if (count === 3) {
      bible.characters.push({ id: 'char.recorder', name: say('阿澈', 'Eli'), role: say('潮汐记录员', 'tide recorder'), motivation: say('保存准确的潮汐记录。', 'Keep accurate tide records.'), identityInvariants: [say('始终负责记录。', 'Remains responsible for the record.')], capabilityInvariants: [say('只能解释已记录的潮汐。', 'Can explain only recorded tides.')], initialStateRef: self('character_state', 'state.recorder'), initialEpistemicRefs: [self('epistemic_state', 'know.recorder')] })
      bible.characterStates.push(
        { id: 'state.keeper_decisive', characterRef: self('character', 'char.keeper'), description: say('依据已核对的记录行动。', 'Act on the checked record.'), capabilityFactRefs: [], validFrom: addr(3), validThrough: addr(3) },
        { id: 'state.recorder', characterRef: self('character', 'char.recorder'), description: say('谨慎保存潮汐记录。', 'Preserve the tide record carefully.'), capabilityFactRefs: [], validFrom: addr(1), validThrough: addr(3) },
      )
      bible.epistemicStates.push(
        { id: 'know.keeper_before', holderRef: self('character', 'char.keeper'), subjectFactRef: o('world_fact', 'fact.low_tide'), attitude: 'unaware', claimText: say('尚不知道石槽何时露出。', 'Does not yet know when the channel is exposed.'), presentation: 'character_internal', validFrom: addr(1), validThrough: addr(2), readerNotBefore: addr(2) },
        { id: 'know.keeper_after', holderRef: self('character', 'char.keeper'), subjectFactRef: o('world_fact', 'fact.low_tide'), attitude: 'knows', claimText: say('已读懂退潮记录。', 'Has understood the low-tide record.'), presentation: 'character_internal', validFrom: addr(3), validThrough: addr(3), readerNotBefore: addr(3) },
        { id: 'know.recorder', holderRef: self('character', 'char.recorder'), subjectFactRef: o('world_fact', 'fact.low_tide'), attitude: 'knows', claimText: say('熟悉退潮记录。', 'Understands the low-tide record.'), presentation: 'character_internal', validFrom: addr(1), validThrough: addr(3), readerNotBefore: addr(2) },
        { id: 'claim.narrator', holderRef: null, subjectFactRef: o('world_fact', 'fact.bell_owner'), attitude: 'believes', claimText: say('铜铃似乎一直属于灯塔。', 'The bell seems always to have belonged to the lighthouse.'), presentation: 'narrator_claim', validFrom: addr(1), validThrough: addr(3), readerNotBefore: addr(1) },
      )
      bible.transitions.push(
        { id: 'transition.keeper_state', transitionKind: 'character_state', holderRef: self('character', 'char.keeper'), fromRef: self('character_state', 'state.keeper_cautious'), toRef: self('character_state', 'state.keeper_decisive'), atChapter: addr(2), phase: 'end_of_chapter', supportPromiseRefs: [o('plot_promise', 'promise.signal')] },
        { id: 'transition.keeper_knowledge', transitionKind: 'epistemic_state', holderRef: self('character', 'char.keeper'), fromRef: self('epistemic_state', 'know.keeper_before'), toRef: self('epistemic_state', 'know.keeper_after'), atChapter: addr(2), phase: 'end_of_chapter', supportPromiseRefs: [o('plot_promise', 'promise.signal')] },
      )
    }
    payload = bible
  } else if (task.kind === 'detailed_outline') {
    payload = detailedFixture(manifest, source('outline'), source('character_bible'))
  } else {
    const outline = source('outline'), bible = source('character_bible'), details = source('detailed_outline')
    const d = (kind: PlanningRecordKind, id: string) => ancestor(details, kind, id)
    const b = (kind: PlanningRecordKind, id: string) => ancestor(bible, kind, id)
    const o = (kind: PlanningRecordKind, id: string) => ancestor(outline, kind, id)
    const ordinal = task.chapterOrdinal!, full = count === 3
    const beatIds = full ? ordinal === 1 ? ['beat.bell_mark', 'beat.tide_note'] : ordinal === 2 ? ['beat.learn'] : ['beat.recover'] : ordinal === 1 ? ['beat.start'] : ordinal === count ? ['beat.end'] : []
    const chapter: ChapterOutlinePayload = { chapter: addr(ordinal), povRef: full ? b('character', 'char.keeper') : null,
      scenes: [{ id: `scene.${ordinal}`, order: 1, summary: say('记录本章的灯塔事件。', 'Record this chapter of lighthouse events.'), beatRefs: beatIds.map(id => d('beat', id)),
        castRefs: full ? [b('character', 'char.keeper'), b('character', 'char.recorder')] : [],
        stateRefs: full ? [b('character_state', ordinal === 3 ? 'state.keeper_decisive' : 'state.keeper_cautious'), b('character_state', 'state.recorder')] : [],
        epistemicRefs: full ? [b('epistemic_state', ordinal === 3 ? 'know.keeper_after' : 'know.keeper_before'), b('epistemic_state', 'know.recorder')] : [],
        setupObligationRefs: full && ordinal === 1 ? [d('obligation', 'obligation.recovery'), d('obligation', 'obligation.ship')] : [],
        payoffObligationRefs: full && ordinal === 3 ? [d('obligation', 'obligation.recovery')] : [],
        withheldFactRefs: full && ordinal === 1 ? [o('world_fact', 'fact.low_tide')] : [],
      }], additionalRefs: full ? [{ ref: o('lore_entity', 'lore.bell'), reason: 'lore_detail' }] : [] }
    payload = chapter
  }
  return canonicalStringify({ protocol: PLANNING_PROTOCOL, stage: task.kind, language: manifest.language,
    dependencies: dependencies.map(artifact => ({ taskId: artifact.taskId, revision: artifact.revision, hash: artifact.hash })), payload })
}

function detailedFixture(manifest: CampaignManifest, outline: CampaignArtifact, bible: CampaignArtifact): DetailedOutlinePayload {
  const count = planningChapterCount(manifest), full = count === 3, zh = manifest.language === 'zh'
  const say = (chinese: string, english: string) => zh ? chinese : english
  const addr = (ordinal: number) => planningChapterAddress(manifest, ordinal)
  const o = (kind: PlanningRecordKind, id: string) => ancestor(outline, kind, id)
  const b = (kind: PlanningRecordKind, id: string) => ancestor(bible, kind, id)
  const beat = (id: string, ordinal: number, order: number, summary: string, predecessors: string[]): Beat => ({ id, chapter: addr(ordinal), order, summary, causalPredecessorRefs: predecessors.map(name => self('beat', name)), participantRefs: full ? [b('character', 'char.keeper'), b('character', 'char.recorder')] : [], factRefs: [], transitionRefs: [], readerDisclosureFactRefs: [] })
  const beats: Beat[] = full ? [
    beat('beat.bell_mark', 1, 1, say('铃座刻痕', 'Bell-seat mark'), []),
    beat('beat.tide_note', 1, 2, say('潮汐记号', 'Tide notation'), ['beat.bell_mark']),
    beat('beat.learn', 2, 3, say('读懂记录', 'Read the record'), ['beat.tide_note']),
    beat('beat.recover', 3, 4, say('找回铜铃', 'Recover the bell'), ['beat.bell_mark', 'beat.tide_note', 'beat.learn']),
  ] : [beat('beat.start', 1, 1, say('打开日志。', 'Open the log.'), []), beat('beat.end', count, 2, say('结束日志。', 'Close the log.'), ['beat.start'])]
  if (full) {
    beats[2]!.transitionRefs = [b('transition', 'transition.keeper_state'), b('transition', 'transition.keeper_knowledge')]
    beats[2]!.factRefs = [o('world_fact', 'fact.low_tide')]
    beats[2]!.readerDisclosureFactRefs = [o('world_fact', 'fact.low_tide')]
    beats[3]!.factRefs = [o('world_fact', 'fact.bell_owner'), o('world_fact', 'fact.low_tide')]
  }
  return { beats,
    transitionBindings: full ? ['transition.keeper_state', 'transition.keeper_knowledge'].map(id => ({ transitionRef: b('transition', id), supportingBeatRefs: [self('beat', 'beat.learn')] })) : [],
    obligations: full ? [
      { id: 'obligation.recovery', summary: say('由刻痕、记号与退潮条件共同回收伏笔。', 'Resolve the setup using the mark, notation and low-tide condition together.'), setupRefs: [self('beat', 'beat.bell_mark'), self('beat', 'beat.tide_note')], payoffRefs: [self('beat', 'beat.recover')], contextRefs: [o('world_fact', 'fact.low_tide'), b('epistemic_state', 'know.keeper_after')], dueChapter: addr(3), readerNotBefore: addr(3), disposition: 'planned_payoff', openThreadRef: null },
      { id: 'obligation.ship', summary: say('结尾仍保留远船去向。', "Leave the distant ship's destination open at the ending."), setupRefs: [self('beat', 'beat.bell_mark')], payoffRefs: [], contextRefs: [], dueChapter: addr(3), readerNotBefore: addr(1), disposition: 'intentionally_open_at_end', openThreadRef: o('intentionally_open_thread', 'open.ship') },
    ] : [],
    chapters: Array.from({ length: count }, (_, index) => {
      const ordinal = index + 1
      return { id: `chapter.${ordinal}`, chapter: addr(ordinal), povRef: full ? b('character', 'char.keeper') : null,
        beatRefs: beats.filter(value => value.chapter.ordinal === ordinal).map(value => self('beat', value.id)),
        requiredConstraintRefs: full ? [o('genre_rule', 'genre.coastal'), b('character', 'char.keeper')] : [],
        requiredFactRefs: full && ordinal > 1 ? [o('world_fact', 'fact.low_tide')] : [],
        requiredTransitionRefs: full && ordinal === 2 ? [b('transition', 'transition.keeper_state'), b('transition', 'transition.keeper_knowledge')] : [],
        obligationRefs: full ? [self('obligation', 'obligation.recovery'), self('obligation', 'obligation.ship')] : [],
      }
    }),
  }
}
