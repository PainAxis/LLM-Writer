/** Explicitly loaded synthetic proposal drafts; never extraction, adjudication or a provider path. */
import type { CampaignSnapshot } from '../../types/writerCampaign'
import { canonicalStringify, hashText } from './protocol'
import { deriveBodyEvidencePrefix } from './bodyEvidence'
import { BodyEvidenceRefusalError, type BodyEvidenceProposalEnvelope, type ClaimProposal, type EvidenceSpan, type PlanningRecordIdentity } from './bodyEvidenceProtocol'
import { BODY_EVIDENCE_THREE_CHAPTER_PROFILE, planningBodyFixture } from './planningProfile'
import { BODY_EVIDENCE_SEGMENTS } from './bodyEvidenceFixtureData'

export const BODY_EVIDENCE_FIXTURE_VERSION = 'body-evidence-fixture-v1'

/**
 * The supplied snapshot is not a proof or execution capability. A caller may load
 * a stale example; the independent engine preview will freshly verify its roots.
 * Source matching below is ONLY the fixed-example builder's contract. Generic
 * production proposal validation never requires these fixture texts or claims.
 */
export async function buildBodyEvidenceFixtureProposal(snapshot: CampaignSnapshot, throughChapterOrdinal: number,
  check: () => void = () => {}): Promise<string> {
  check()
  const prefix = await deriveBodyEvidencePrefix(snapshot, throughChapterOrdinal, check)
  const spans: EvidenceSpan[] = [], claims: ClaimProposal[] = []
  const artifacts = prefix.bodySources.map(source => {
    const artifact = snapshot.artifacts.get(source.artifact.hash)
    if (!artifact || artifact.text !== planningBodyFixture(snapshot.manifest, source.chapterOrdinal)) throw new BodyEvidenceRefusalError('unsupported_profile')
    return artifact
  })
  const span = async (id: string, ordinal: number, start: number, end: number) => {
    check()
    const source = prefix.bodySources[ordinal - 1]!, text = artifacts[ordinal - 1]!.text
    const quote = text.slice(start, end), quoteHash = await hashText(quote)
    check()
    spans.push({ id, artifact: { ...source.artifact }, startUtf16: start, endUtf16: end, quote, quoteHash })
    return id
  }
  for (const [i, artifact] of artifacts.entries()) await span(`span.full.${i + 1}`, i + 1, 0, artifact.text.length)
  const rich = snapshot.manifest.fixtureVersion === BODY_EVIDENCE_THREE_CHAPTER_PROFILE
  if (!rich) {
    for (const [i, artifact] of artifacts.entries()) {
      check()
      claims.push({ id: `claim.${i + 1}`, kind: 'world_assertion', statement: artifact.text, atChapterOrdinal: i + 1,
        anchorIds: [`span.full.${i + 1}`], premiseClaimIds: i === 59 ? ['claim.1', 'claim.30'] : [], planningRefs: [], payload: { polarity: 'affirmed' } })
    }
  } else {
    const segmentIds = new Map<string, string>()
    for (const [i, segments] of BODY_EVIDENCE_SEGMENTS[snapshot.manifest.language].entries()) {
      if (i >= throughChapterOrdinal) break
      let start = 0
      for (const [name, quote] of Object.entries(segments)) {
        const key = `${i + 1}.${name}`, id = `span.${key}`
        await span(id, i + 1, start, start + quote.length)
        segmentIds.set(key, id); start += quote.length + 1
      }
    }
    const ref = (recordKind: PlanningRecordIdentity['recordKind'], recordId: string): PlanningRecordIdentity => {
      const row = prefix.canon.records.find(row => row.recordKind === recordKind && row.recordId === recordId)
      if (!row) throw new BodyEvidenceRefusalError('invalid_reference')
      return { artifact: { ...row.artifact }, recordKind, recordId }
    }
    const keeper = ref('character', 'char.keeper'), ownership = ref('world_fact', 'fact.bell_owner'), tide = ref('world_fact', 'fact.low_tide')
    const a = (key: string) => {
      const id = segmentIds.get(key)
      if (!id) throw new BodyEvidenceRefusalError('invalid_anchor')
      return id
    }
    const zh = snapshot.manifest.language === 'zh'
    const say = (chinese: string, english: string) => zh ? chinese : english
    const common = (id: string, statement: string, chapter: number, anchors: string[]) => ({
      id, statement, atChapterOrdinal: chapter, anchorIds: anchors, premiseClaimIds: [] as string[], planningRefs: [] as PlanningRecordIdentity[],
    })
    claims.push(
      { ...common('claim.mark', say('林岚记录了铃座刻痕。', 'Mara recorded the bell-seat mark.'), 1, [a('1.mark')]), kind: 'world_assertion', payload: { polarity: 'affirmed' } },
      { ...common('claim.record', say('潮汐记号被留在桌上。', 'The tide notation was left on the table.'), 1, [a('1.record')]), kind: 'world_assertion', payload: { polarity: 'affirmed' } },
      { ...common('claim.belief', say('林岚相信铜铃属于家族。', 'Mara believes the bell belongs to her family.'), 1, [a('1.belief')]), kind: 'attributed_belief', payload: { holderRef: keeper, subjectFactRef: ownership, attitude: 'believes' } },
      { ...common('claim.narrator', say('叙述者声称铜铃从未属于灯塔。', 'The narrator claims the bell never belonged to the lighthouse.'), 1, [a('1.narrator')]), kind: 'narrator_claim', payload: { reliability: 'proposed_unreliable' } },
      { ...common('claim.unaware', say('林岚声称尚不知道石槽何时露出。', 'Mara says she does not yet know when the channel is exposed.'), 1, [a('1.unaware')]), kind: 'attributed_belief', payload: { holderRef: keeper, subjectFactRef: tide, attitude: 'unaware' } },
      { ...common('claim.ship', say('远船进入了雾中。', 'The distant ship entered the fog.'), 1, [a('1.ship')]), kind: 'world_assertion', payload: { polarity: 'affirmed' } },
    )
    if (throughChapterOrdinal >= 2) claims.push(
      { ...common('claim.learn', say('林岚声称已经知道退潮规律。', 'Mara claims to know the low-tide pattern.'), 2, [a('2.learn')]), kind: 'attributed_belief', payload: { holderRef: keeper, subjectFactRef: tide, attitude: 'claims_to_know' } },
      { ...common('claim.acquire', say('提议：林岚获得了关于退潮的知识。', 'Proposal: Mara acquired knowledge about low tide.'), 2, [a('2.learn')]), kind: 'character_change', payload: { holderRef: keeper, changeKind: 'knowledge_acquired', beforeClaimId: 'claim.unaware', afterClaimId: 'claim.learn' } },
      { ...common('claim.forgot', say('林岚承认已经忘记露槽时间。', 'Mara admits she has forgotten when the channel is exposed.'), 2, [a('2.forget')]), kind: 'attributed_belief', payload: { holderRef: keeper, subjectFactRef: tide, attitude: 'unaware' } },
      { ...common('claim.loss', say('提议：林岚遗忘了关于退潮的知识。', 'Proposal: Mara lost her knowledge about low tide.'), 2, [a('2.forget')]), kind: 'character_change', payload: { holderRef: keeper, changeKind: 'knowledge_lost', beforeClaimId: 'claim.learn', afterClaimId: 'claim.forgot' } },
    )
    if (throughChapterOrdinal >= 3) claims.push(
      { ...common('claim.relearn', say('林岚声称通过重读再次知道退潮规律。', 'Mara claims to know the low-tide pattern after rereading.'), 3, [a('3.relearn')]), kind: 'attributed_belief', premiseClaimIds: ['claim.forgot'], payload: { holderRef: keeper, subjectFactRef: tide, attitude: 'claims_to_know' } },
      { ...common('claim.recover', say('林岚用刻痕和记号找回了铜铃。', 'Mara used the mark and notation to recover the bell.'), 3, [a('3.recover')]), kind: 'world_assertion', premiseClaimIds: ['claim.mark', 'claim.record', 'claim.relearn'], payload: { polarity: 'affirmed' } },
      { ...common('claim.payoff', say('提议：第一章的刻痕与记号在找铃时得到回收。', 'Proposal: the first-chapter mark and notation pay off in the recovery.'), 3, [a('3.recover')]), kind: 'setup_payoff', payload: { obligationRef: ref('obligation', 'obligation.recovery'), setupClaimIds: ['claim.mark', 'claim.record'], payoffClaimIds: ['claim.recover'], contextClaimIds: ['claim.relearn'] } },
      // Deliberately wrong interpretation of a valid literal citation. Validation
      // must NOT turn a matching quote into semantic support or a truth verdict.
      { ...common('claim.contradictory', say('铜铃没有被找回。', 'The brass bell was not recovered.'), 3, [a('3.recover')]), kind: 'world_assertion', payload: { polarity: 'negated' } },
      { ...common('claim.ship_open', say('远船的去向仍未揭晓。', 'The distant ship remains unexplained.'), 3, [a('3.ship')]), kind: 'world_assertion', premiseClaimIds: ['claim.ship'], payload: { polarity: 'affirmed' } },
    )
  }
  check()
  const proposal: BodyEvidenceProposalEnvelope = {
    protocol: 'campaign-body-evidence-proposals-v1', purpose: 'local_author_continuity_preview',
    campaignId: snapshot.manifest.campaignId, currentCandidateId: snapshot.checkpoint.candidateId, manifestHash: snapshot.manifest.hash,
    canonBaseRoot: prefix.canonBaseRoot, fullPlanRoot: prefix.fullPlanRoot, bodyPrefixRoot: prefix.bodyPrefixRoot, throughChapterOrdinal,
    producer: { kind: 'offline_fixture', version: BODY_EVIDENCE_FIXTURE_VERSION }, spans, claims,
    examination: { status: 'producer_declared', windows: prefix.bodySources.map(source => ({ artifact: { ...source.artifact }, startUtf16: 0, endUtf16: source.rawUtf16Units })) },
  }
  const raw = canonicalStringify(proposal)
  check()
  return raw
}
