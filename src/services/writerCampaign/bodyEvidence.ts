/** Pure read-local source/proposal compiler. A supplied snapshot is not repository proof. */
import type { CampaignArtifact, CampaignArtifactRef, CampaignSnapshot, CampaignTaskSpec, CampaignManifest, CampaignTaskState } from '../../types/writerCampaign'
import { assertScalarText, canonicalStringify, hashCampaignValue, hashText, utf8Bytes } from './protocol'
import { buildPlanningCanon, planningArtifactRef, planningClosure, type PlanningCanon, type PlanningClosureSeed, type PlanningRecord } from './planningCanon'
import { planningChapterCount, validatePlanningProfile } from './planningProfile'
import { PlanningRefusalError, type PlanningRecordKind } from './planningProtocol'
import {
  BODY_EVIDENCE_LIMITATIONS, BODY_EVIDENCE_LIMITS, BODY_EVIDENCE_PACKET_PROTOCOL, BODY_EVIDENCE_PREFIX_PROTOCOL, BODY_EVIDENCE_PURPOSE,
  BodyEvidenceRefusalError, bodyEvidenceAssert, parseBodyEvidenceProposal,
  type BodyCoverage, type BodyEvidenceCheck, type BodyEvidencePacket, type BodyEvidenceRange, type BodyEvidenceRefusalCode,
  type BodySource, type ClaimProposal, type CoverageRow, type CoverageStatus,
  type PacketPlanning, type PacketSpan, type PlanningRecordIdentity, type BodyEvidenceProposalEnvelope,
} from './bodyEvidenceProtocol'

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const same = (a: unknown, b: unknown) => canonicalStringify(a) === canonicalStringify(b)
const refKey = (ref: CampaignArtifactRef) => `${ref.taskId}/${ref.revision}/${ref.hash}`
const recordKey = (ref: PlanningRecordIdentity) => `${refKey(ref.artifact)}/${ref.recordKind}/${ref.recordId}`
const noCheck = () => {}
function planError(error: unknown): never {
  if (error instanceof BodyEvidenceRefusalError) throw error
  if (error instanceof PlanningRefusalError) {
    if (error.code === 'unsupported_profile') throw new BodyEvidenceRefusalError('unsupported_profile')
    if (error.code === 'missing_planning_source' || error.code === 'incomplete_plan') throw new BodyEvidenceRefusalError('incomplete_plan')
    if (error.code === 'source_identity_mismatch') throw new BodyEvidenceRefusalError('source_identity_mismatch')
    if (error.code.includes('budget')) throw new BodyEvidenceRefusalError('proposal_budget_exceeded')
    throw new BodyEvidenceRefusalError('invalid_reference')
  }
  throw error
}
export interface BodyEvidencePrefix {
  campaignId: string; currentCandidateId: string; manifestHash: string; throughChapterOrdinal: number
  canonBaseRoot: string; fullPlanRoot: string; bodyPrefixRoot: string; bodySources: BodySource[]
  bodyArtifacts: CampaignArtifact[]; canon: PlanningCanon; plannedChapterCount: number; acceptedBodyCount: number; acceptedOutsidePrefix: number
}
/** Explicit projection of current source membership; never a fabricated v2 checkpoint.
 * This pure view grants no repository, persistence or dispatch authority. */
export interface BodyEvidenceSourceView {
  sourceManifest: CampaignManifest
  candidateId: string
  tasks: readonly CampaignTaskState[]
  artifacts: ReadonlyMap<string, CampaignArtifact>
}
export function bodyEvidenceSourceView(snapshot: CampaignSnapshot): BodyEvidenceSourceView {
  return { sourceManifest: snapshot.manifest, candidateId: snapshot.checkpoint.candidateId,
    tasks: snapshot.checkpoint.tasks, artifacts: snapshot.artifacts }
}
export async function deriveBodyEvidencePrefix(snapshot: CampaignSnapshot, throughChapterOrdinal: number, check: BodyEvidenceCheck = noCheck): Promise<BodyEvidencePrefix> {
  return deriveBodyEvidencePrefixFromSource(bodyEvidenceSourceView(snapshot), throughChapterOrdinal, check)
}
/** Caller must obtain the source view through a current verified repository read.
 * Rechecks active membership/dependencies/metrics, not the entire historical log. */
export async function deriveBodyEvidencePrefixFromSource(source: BodyEvidenceSourceView, throughChapterOrdinal: number, check: BodyEvidenceCheck = noCheck): Promise<BodyEvidencePrefix> {
  check()
  let count: number
  try { bodyEvidenceAssert(validatePlanningProfile(source.sourceManifest), 'unsupported_profile'); count = planningChapterCount(source.sourceManifest) } catch (error) { planError(error) }
  bodyEvidenceAssert(Number.isSafeInteger(throughChapterOrdinal) && throughChapterOrdinal >= 1 && throughChapterOrdinal <= count!, 'source_outside_prefix')
  const manifest = source.sourceManifest
  const active = (spec: CampaignTaskSpec, missing: BodyEvidenceRefusalCode): CampaignArtifact => {
    check()
    const state = source.tasks.find(row => row.taskId === spec.id)
    const artifact = state?.artifact && source.artifacts.get(state.artifact.hash)
    bodyEvidenceAssert(state?.status === 'committed' && state.artifact && artifact, missing)
    bodyEvidenceAssert(artifact.campaignId === manifest.campaignId && artifact.taskId === spec.id && artifact.kind === spec.kind
      && artifact.taskRevision === state.revision && same(planningArtifactRef(artifact), state.artifact), 'source_identity_mismatch')
    const dependencies = spec.dependsOn.map(id => {
      check()
      const dependencyState = source.tasks.find(row => row.taskId === id)
      const dependency = dependencyState?.artifact && source.artifacts.get(dependencyState.artifact.hash)
      bodyEvidenceAssert(dependencyState?.status === 'committed' && dependencyState.artifact && dependency
        && dependency.campaignId === manifest.campaignId && dependency.taskId === id && dependency.taskRevision === dependencyState.revision
        && same(planningArtifactRef(dependency), dependencyState.artifact), 'source_identity_mismatch')
      return dependencyState.artifact
    })
    bodyEvidenceAssert(same(artifact.dependencies, dependencies), 'source_identity_mismatch')
    return artifact
  }
  const planningArtifacts = manifest.tasks.filter(task => task.kind !== 'chapter_body').map(task => active(task, 'incomplete_plan'))
  let canon: PlanningCanon
  try { canon = await buildPlanningCanon(manifest, planningArtifacts, check) } catch (error) { planError(error) }
  check(); bodyEvidenceAssert(canon!.canonBaseRoot && canon!.fullPlanRoot, 'incomplete_plan')
  const bodySpecs = manifest.tasks.filter(task => task.kind === 'chapter_body')
  const acceptedBodyCount = bodySpecs.filter(task => source.tasks.find(row => row.taskId === task.id)?.status === 'committed').length
  bodyEvidenceAssert(acceptedBodyCount > 0, 'no_accepted_body')
  const bodyArtifacts: CampaignArtifact[] = [], bodySources: BodySource[] = []
  let sourceBytes = 0
  for (let ordinal = 1; ordinal <= throughChapterOrdinal; ordinal++) {
    check()
    const spec = bodySpecs.find(task => task.chapterOrdinal === ordinal)
    bodyEvidenceAssert(spec, 'noncontiguous_prefix')
    const artifact = active(spec, 'noncontiguous_prefix')
    try { assertScalarText(artifact.text) } catch { throw new BodyEvidenceRefusalError('invalid_scalar_text') }
    const bytes = utf8Bytes(artifact.text)
    bodyEvidenceAssert(bytes <= 65_536 && (sourceBytes += bytes) <= BODY_EVIDENCE_LIMITS.sourceBytes, 'proposal_budget_exceeded')
    check(); const rawHash = await hashText(artifact.text); check()
    bodyEvidenceAssert(artifact.raw.hash === rawHash && artifact.raw.utf16Units === artifact.text.length
      && artifact.raw.utf8Bytes === bytes && artifact.raw.scalars === Array.from(artifact.text).length, 'source_identity_mismatch')
    bodyArtifacts.push(artifact)
    bodySources.push({ chapterOrdinal: ordinal, artifact: planningArtifactRef(artifact), taskRevision: artifact.taskRevision,
      artifactCandidateId: artifact.candidateId, rawBodyHash: artifact.raw.hash, rawUtf16Units: artifact.raw.utf16Units,
      rawUtf8Bytes: artifact.raw.utf8Bytes, rawScalars: artifact.raw.scalars })
  }
  const identity = { campaignId: manifest.campaignId, currentCandidateId: source.candidateId, manifestHash: manifest.hash,
    canonBaseRoot: canon!.canonBaseRoot!, fullPlanRoot: canon!.fullPlanRoot!, throughChapterOrdinal }
  check(); const bodyPrefixRoot = await hashCampaignValue(BODY_EVIDENCE_PREFIX_PROTOCOL, { protocol: BODY_EVIDENCE_PREFIX_PROTOCOL, ...identity, bodySources }); check()
  return { ...identity, bodyPrefixRoot, bodySources, bodyArtifacts, canon: canon!, plannedChapterCount: count!, acceptedBodyCount, acceptedOutsidePrefix: acceptedBodyCount - throughChapterOrdinal }
}

type Position = [number, number]
const comparePosition = (a: Position, b: Position) => a[0] - b[0] || a[1] - b[1]
const isBase = (claim: ClaimProposal) => claim.kind === 'world_assertion' || claim.kind === 'attributed_belief' || claim.kind === 'narrator_claim'
function scalarBoundary(text: string, offset: number): boolean {
  if (offset === 0 || offset === text.length) return true
  const current = text.charCodeAt(offset), previous = text.charCodeAt(offset - 1)
  return !(current >= 0xdc00 && current <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff)
}
function status(covered: number, total: number): CoverageStatus { return total === 0 || covered === 0 ? 'none' : covered === total ? 'complete' : 'partial' }
function union(input: readonly BodyEvidenceRange[], check: BodyEvidenceCheck): BodyEvidenceRange[] {
  const sorted = input.map(([start, end]): BodyEvidenceRange => [start, end]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const result: BodyEvidenceRange[] = []
  for (const range of sorted) {
    check(); const last = result.at(-1)
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else result.push(range)
  }
  return result
}
function coverageRows(sources: readonly BodySource[], ranges: ReadonlyMap<number, BodyEvidenceRange[]>, check: BodyEvidenceCheck): CoverageRow[] {
  let intervals = 0, gapCount = 0
  return sources.map((source, sourceIndex) => {
    check(); const merged = union(ranges.get(sourceIndex) ?? [], check), gaps: BodyEvidenceRange[] = []
    let previous = 0, coveredUtf16Units = 0
    for (const [start, end] of merged) {
      check(); if (start > previous) gaps.push([previous, start]); coveredUtf16Units += end - start; previous = end
    }
    if (previous < source.rawUtf16Units) gaps.push([previous, source.rawUtf16Units])
    intervals += merged.length; gapCount += gaps.length
    bodyEvidenceAssert(intervals <= BODY_EVIDENCE_LIMITS.unionIntervals && gapCount <= BODY_EVIDENCE_LIMITS.prefixGaps, 'proposal_budget_exceeded')
    return { sourceIndex, intervals: merged, coveredUtf16Units, gaps, status: status(coveredUtf16Units, source.rawUtf16Units) }
  })
}
function requiredClaimIds(claim: ClaimProposal): string[] {
  switch (claim.kind) {
    case 'character_change': return [...claim.premiseClaimIds, claim.payload.beforeClaimId, claim.payload.afterClaimId]
    case 'setup_payoff': return [...claim.premiseClaimIds, ...claim.payload.setupClaimIds, ...claim.payload.payoffClaimIds, ...claim.payload.contextClaimIds]
    default: return [...claim.premiseClaimIds]
  }
}
export interface CompiledBodyEvidence {
  packet: BodyEvidencePacket; packetText: string; packetDigest: string; packetBytes: number; packetUtf16: number
  throughChapterOrdinal: number; bodyPrefixRoot: string; canonBaseRoot: string; fullPlanRoot: string; coverage: BodyCoverage
}
export type BodyEvidenceDeclarationProvenance = 'local_declaration' | 'offline_fixture_declaration' | 'registered_producer_declaration'
export type BodyEvidenceCoreCoverage<P extends BodyEvidenceDeclarationProvenance> = Omit<BodyCoverage, 'examinedDeclaration'> & {
  examinedDeclaration: Extract<BodyCoverage['examinedDeclaration'], { status: 'not_run' }>
    | (Omit<Extract<BodyCoverage['examinedDeclaration'], { status: 'producer_declared' }>, 'provenance'> & { provenance: P })
}
export type BodyEvidenceCoreProposal = Omit<BodyEvidenceProposalEnvelope, 'protocol' | 'purpose' | 'producer'>
export type CompiledBodyEvidenceCore<P extends BodyEvidenceDeclarationProvenance> = Omit<BodyEvidencePacket,
  'protocol' | 'purpose' | 'exposure' | 'producer' | 'proposalDigest' | 'coverage' | 'limitations'> & { coverage: BodyEvidenceCoreCoverage<P> }
/** Shared pure source, quote, declared-premise and coverage checks. Inputs must be
 * closed parsed data assembled by the entrypoint; no producer provenance is forged. */
export async function compileBodyEvidenceCore<P extends BodyEvidenceDeclarationProvenance>(source: BodyEvidenceSourceView,
  envelope: BodyEvidenceCoreProposal, declarationProvenance: P, check: BodyEvidenceCheck = noCheck): Promise<CompiledBodyEvidenceCore<P>> {
  const prefix = await deriveBodyEvidencePrefixFromSource(source, envelope.throughChapterOrdinal, check)
  check()
  for (const key of ['campaignId', 'currentCandidateId', 'manifestHash', 'canonBaseRoot', 'fullPlanRoot', 'bodyPrefixRoot', 'throughChapterOrdinal'] as const) {
    bodyEvidenceAssert(envelope[key] === prefix[key], 'source_identity_mismatch')
  }
  const sourceIndex = new Map(prefix.bodySources.map((source, index) => [refKey(source.artifact), index]))
  const findSource = (ref: CampaignArtifactRef): number => {
    const index = sourceIndex.get(refKey(ref))
    if (index !== undefined) return index
    const spec = source.sourceManifest.tasks.find(task => task.id === ref.taskId)
    if (spec?.kind === 'chapter_body' && spec.chapterOrdinal! > prefix.throughChapterOrdinal) throw new BodyEvidenceRefusalError('source_outside_prefix')
    throw new BodyEvidenceRefusalError('source_identity_mismatch')
  }
  const validateWindow = (source: number, start: number, end: number, code: 'invalid_anchor' | 'invalid_coverage') => {
    check(); const text = prefix.bodyArtifacts[source]!.text
    bodyEvidenceAssert(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < end && end <= text.length
      && scalarBoundary(text, start) && scalarBoundary(text, end), code)
  }
  const spans: PacketSpan[] = [], spanMap = new Map<string, PacketSpan>(), suppliedRanges = new Map<number, BodyEvidenceRange[]>()
  for (const span of envelope.spans) {
    check(); const source = findSource(span.artifact); validateWindow(source, span.startUtf16, span.endUtf16, 'invalid_anchor')
    bodyEvidenceAssert(prefix.bodyArtifacts[source]!.text.slice(span.startUtf16, span.endUtf16) === span.quote, 'quote_mismatch')
    check(); const quoteHash = await hashText(span.quote); check(); bodyEvidenceAssert(quoteHash === span.quoteHash, 'quote_hash_mismatch')
    const row: PacketSpan = { id: span.id, sourceIndex: source, startUtf16: span.startUtf16, endUtf16: span.endUtf16, quote: span.quote, quoteHash }
    spans.push(row); spanMap.set(row.id, row)
    const intervals = suppliedRanges.get(source) ?? []; intervals.push([row.startUtf16, row.endUtf16]); suppliedRanges.set(source, intervals)
  }
  const suppliedRows = coverageRows(prefix.bodySources, suppliedRanges, check), totalUtf16Units = prefix.bodySources.reduce((sum, source) => sum + source.rawUtf16Units, 0)
  const suppliedUnits = suppliedRows.reduce((sum, row) => sum + row.coveredUtf16Units, 0)
  const coverage: BodyEvidenceCoreCoverage<P> = {
    availablePrefix: { sourceCount: prefix.bodySources.length, totalUtf16Units, plannedChapterCount: prefix.plannedChapterCount, acceptedBodyCount: prefix.acceptedBodyCount, acceptedOutsidePrefix: prefix.acceptedOutsidePrefix },
    supplied: { rows: suppliedRows, coveredUtf16Units: suppliedUnits, status: status(suppliedUnits, totalUtf16Units) },
    examinedDeclaration: { status: 'not_run', provenance: null, verification: 'not_run', rows: [], declaredUtf16Units: 0, coverageStatus: 'none' },
    semanticReview: { status: 'not_reviewed', reviewedUtf16Units: 0, relationCompleteness: 'not_assessed' }, declaredPremiseClosure: 'complete', semanticAdjudication: 'not_run',
  }
  if (envelope.examination.status === 'producer_declared') {
    const examinedRanges = new Map<number, BodyEvidenceRange[]>()
    for (const window of envelope.examination.windows) {
      check(); const source = findSource(window.artifact); validateWindow(source, window.startUtf16, window.endUtf16, 'invalid_coverage')
      bodyEvidenceAssert(suppliedRows[source]!.intervals.some(([start, end]) => start <= window.startUtf16 && end >= window.endUtf16), 'invalid_coverage')
      const ranges = examinedRanges.get(source) ?? []; ranges.push([window.startUtf16, window.endUtf16]); examinedRanges.set(source, ranges)
    }
    const rows = coverageRows(prefix.bodySources, examinedRanges, check), units = rows.reduce((sum, row) => sum + row.coveredUtf16Units, 0)
    coverage.examinedDeclaration = { status: 'producer_declared', provenance: declarationProvenance,
      verification: 'range_and_identity_only', rows, declaredUtf16Units: units, coverageStatus: status(units, totalUtf16Units) }
  }
  const positions = new Map<string, Position>(), claims = new Map(envelope.claims.map(claim => [claim.id, claim]))
  const spanPosition = (span: PacketSpan): Position => [prefix.bodySources[span.sourceIndex]!.chapterOrdinal, span.endUtf16]
  const claimFor = (id: string): ClaimProposal => { const claim = claims.get(id); bodyEvidenceAssert(claim, 'missing_required_premise'); return claim }
  const position = (id: string): Position => { const found = positions.get(id); bodyEvidenceAssert(found, 'missing_required_premise'); return found }
  for (const claim of envelope.claims) {
    check(); let maximum: Position = [0, 0]
    for (const id of claim.anchorIds) {
      check(); const span = spanMap.get(id); bodyEvidenceAssert(span, 'missing_required_premise')
      const p = spanPosition(span); if (comparePosition(p, maximum) > 0) maximum = p
    }
    bodyEvidenceAssert(maximum[0] === claim.atChapterOrdinal && maximum[0] <= prefix.throughChapterOrdinal, 'unsupported_relation'); positions.set(claim.id, maximum)
  }
  const records = new Map(prefix.canon.records.map(record => [recordKey(record), record])), seeds: PlanningClosureSeed[] = []
  const planned = (ref: PlanningRecordIdentity, expected?: PlanningRecordKind, code: BodyEvidenceRefusalCode = 'invalid_reference'): PlanningRecord => {
    check(); bodyEvidenceAssert(expected === undefined || ref.recordKind === expected, code)
    const record = records.get(recordKey(ref)); bodyEvidenceAssert(record, code)
    seeds.push({ ref: { source: 'self', artifact: null, recordKind: ref.recordKind, recordId: ref.recordId }, ownerArtifact: ref.artifact })
    return record
  }
  const hasMaxAnchor = (claim: ClaimProposal, ends: readonly ClaimProposal[], maximum: Position) => ends.some(end => end.anchorIds.some(id => claim.anchorIds.includes(id) && comparePosition(spanPosition(spanMap.get(id)!), maximum) === 0))
  for (const claim of envelope.claims) {
    check(); claim.planningRefs.forEach(ref => planned(ref))
    if (claim.kind === 'attributed_belief') {
      planned(claim.payload.holderRef, 'character', 'unsupported_subject'); planned(claim.payload.subjectFactRef, 'world_fact', 'unsupported_subject')
    } else if (claim.kind === 'character_change') {
      const p = claim.payload; planned(p.holderRef, 'character', 'unsupported_subject')
      const before = claimFor(p.beforeClaimId), after = claimFor(p.afterClaimId)
      bodyEvidenceAssert(isBase(before) && isBase(after) && comparePosition(position(before.id), position(after.id)) < 0, 'unsupported_relation')
      if (p.changeKind === 'state') {
        bodyEvidenceAssert([before, after].every(end => end.planningRefs.some(ref => same(ref, p.holderRef))), 'unsupported_subject')
      } else {
        bodyEvidenceAssert(before.kind === 'attributed_belief' && after.kind === 'attributed_belief'
          && same(before.payload.holderRef, p.holderRef) && same(after.payload.holderRef, p.holderRef)
          && same(before.payload.subjectFactRef, after.payload.subjectFactRef), 'unsupported_subject')
      }
      bodyEvidenceAssert(hasMaxAnchor(claim, [after], position(after.id)), 'missing_required_premise')
    } else if (claim.kind === 'setup_payoff') {
      const p = claim.payload; planned(p.obligationRef, 'obligation', 'unsupported_relation')
      const setups = p.setupClaimIds.map(claimFor), payoffs = p.payoffClaimIds.map(claimFor), contexts = p.contextClaimIds.map(claimFor)
      bodyEvidenceAssert([...setups, ...payoffs, ...contexts].every(isBase), 'unsupported_relation')
      bodyEvidenceAssert(setups.every(setup => payoffs.every(payoff => comparePosition(position(setup.id), position(payoff.id)) <= 0)), 'unsupported_relation')
      const maximum = payoffs.reduce((max, payoff) => comparePosition(position(payoff.id), max) > 0 ? position(payoff.id) : max, [0, 0] as Position)
      bodyEvidenceAssert(hasMaxAnchor(claim, payoffs, maximum), 'missing_required_premise')
    }
    for (const id of requiredClaimIds(claim)) {
      check(); claimFor(id); bodyEvidenceAssert(comparePosition(position(id), position(claim.id)) <= 0, 'unsupported_relation')
    }
  }
  const visited = new Set<string>(), visiting = new Set<string>()
  const visit = (id: string) => {
    check(); if (visited.has(id)) return
    bodyEvidenceAssert(!visiting.has(id), 'support_cycle'); visiting.add(id)
    for (const dependency of requiredClaimIds(claimFor(id))) visit(dependency)
    visiting.delete(id); visited.add(id)
  }
  for (const claim of envelope.claims) visit(claim.id)
  let closure: PlanningRecord[]
  try { closure = planningClosure(prefix.canon, seeds, check) } catch (error) { planError(error) }
  const planningOrder = new Map(source.sourceManifest.tasks.map((task, index) => [task.id, index]))
  closure!.sort((a, b) => planningOrder.get(a.artifact.taskId)! - planningOrder.get(b.artifact.taskId)! || compare(a.recordKind, b.recordKind) || compare(a.recordId, b.recordId))
  const neededSources = new Set(closure!.map(record => refKey(record.artifact)))
  const planningSources = source.sourceManifest.tasks.filter(task => task.kind !== 'chapter_body').map(task => prefix.canon.artifactsByTask.get(task.id)!)
    .filter(artifact => neededSources.has(refKey(planningArtifactRef(artifact)))).map(planningArtifactRef)
  const planningIndex = new Map(planningSources.map((source, index) => [refKey(source), index]))
  let omittedScenes = 0
  for (const envelope of prefix.canon.envelopes.values()) if (envelope.stage === 'chapter_outline') omittedScenes += envelope.payload.scenes.length
  const planning: PacketPlanning = { sources: planningSources, records: closure!.map(record => {
    check(); const source = planningIndex.get(refKey(record.artifact)); bodyEvidenceAssert(source !== undefined, 'invalid_reference')
    return { sourceIndex: source, recordKind: record.recordKind, recordId: record.recordId, value: record.value }
  }), suppliedRecordCount: closure!.length, omittedRecordCount: prefix.canon.records.length - closure!.length,
  chapterOutlinesSupplied: 0, chapterOutlinesOmitted: prefix.plannedChapterCount, chapterOutlineScenesSupplied: 0, chapterOutlineScenesOmitted: omittedScenes }
  return { campaignId: prefix.campaignId, currentCandidateId: prefix.currentCandidateId, manifestHash: prefix.manifestHash,
    canonBaseRoot: prefix.canonBaseRoot, fullPlanRoot: prefix.fullPlanRoot, bodyPrefixRoot: prefix.bodyPrefixRoot,
    throughChapterOrdinal: prefix.throughChapterOrdinal, bodySources: prefix.bodySources,
    spans: spans.sort((a, b) => a.sourceIndex - b.sourceIndex || a.startUtf16 - b.startUtf16 || a.endUtf16 - b.endUtf16 || compare(a.id, b.id)),
    claims: [...envelope.claims].sort((a, b) => compare(a.id, b.id)), planning, coverage }
}
/** Legacy v1 parser and formatter retain their exact wire semantics. */
export async function compileBodyEvidence(snapshot: CampaignSnapshot, proposalText: unknown, check: BodyEvidenceCheck = noCheck): Promise<CompiledBodyEvidence> {
  const envelope = parseBodyEvidenceProposal(proposalText, check)
  const core = await compileBodyEvidenceCore(bodyEvidenceSourceView(snapshot), envelope,
    envelope.producer.kind === 'offline_fixture' ? 'offline_fixture_declaration' : 'local_declaration', check)
  check(); const proposalDigest = await hashText(proposalText as string); check()
  const packet: BodyEvidencePacket = { protocol: BODY_EVIDENCE_PACKET_PROTOCOL, purpose: BODY_EVIDENCE_PURPOSE,
    exposure: 'local_author_only', ...core, producer: { ...envelope.producer }, proposalDigest, limitations: { ...BODY_EVIDENCE_LIMITATIONS } }
  check(); let packetText: string
  try { packetText = canonicalStringify(packet) } catch { throw new BodyEvidenceRefusalError('packet_budget_exceeded') }
  bodyEvidenceAssert(packetText.length <= BODY_EVIDENCE_LIMITS.packetUtf16, 'packet_budget_exceeded')
  const packetBytes = utf8Bytes(packetText); bodyEvidenceAssert(packetBytes <= BODY_EVIDENCE_LIMITS.packetBytes, 'packet_budget_exceeded')
  check(); const packetDigest = await hashText(packetText); check()
  return { packet, packetText, packetDigest, packetBytes, packetUtf16: packetText.length, throughChapterOrdinal: core.throughChapterOrdinal,
    bodyPrefixRoot: core.bodyPrefixRoot, canonBaseRoot: core.canonBaseRoot, fullPlanRoot: core.fullPlanRoot, coverage: core.coverage }
}
