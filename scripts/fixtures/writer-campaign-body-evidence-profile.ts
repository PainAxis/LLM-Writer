/** Serial N60 workload: real engine/repository tasks, then read-only generic proposals.
 * Independent packet/source checks do not assert semantic truth or extraction completeness. */
import type { CampaignArtifact, CampaignRepositoryIO, CampaignSnapshot } from '../../src/types/writerCampaign'
import { idbCompareAndSwapMany, idbGetMany } from '../../src/services/blobStore'
import { getCampaignBuildIdentity } from '../../src/services/writerCampaign/buildIdentity'
import { createCampaignRepository } from '../../src/services/writerCampaign/store'
import { createOfflineCampaignEngine, createOfflineCampaignManifest, type CampaignRuntimeIdentity } from '../../src/services/writerCampaign/engine'
import { canonicalStringify, decodeStorageBytes, hashCampaignValue, hashText, utf8Bytes } from '../../src/services/writerCampaign/protocol'
import { planningManifestOptions, planningFixtureBodyTarget } from '../../src/services/writerCampaign/planningProfile'
import { buildPlanningCanon, planningArtifactRef } from '../../src/services/writerCampaign/planningCanon'
import { buildBodyEvidenceFixtureProposal } from '../../src/services/writerCampaign/bodyEvidenceFixture'
import { compileBodyEvidence } from '../../src/services/writerCampaign/bodyEvidence'
import { BodyEvidenceRefusalError, type BodyEvidencePacket, type BodyEvidenceProposalEnvelope } from '../../src/services/writerCampaign/bodyEvidenceProtocol'
import { emptyBodyEvidenceProfile, safeBodyEvidenceCode, type BodyEvidenceAuthority, type BodyEvidenceProfile, type BODY_PROFILE_CHECKS } from './writer-campaign-body-evidence-report'
import type { StorageObservation } from './writer-campaign-capacity-profile'
const verify = (condition: unknown): void => { if (!condition) throw new Error('body_evidence_profile_verification_failed') }
const ms = (value: number) => Math.max(0, Math.ceil(value))
export const bodyEvidenceProfileId = (language: 'zh' | 'en') => `body-evidence-compact-${language}`
export async function bodyEvidenceArtifactSetHash(snapshot: CampaignSnapshot): Promise<string> { return hashCampaignValue('body-evidence-profile-artifact-set-v1', snapshot.checkpoint.tasks.map(row => row.artifact)) }
const accepted = (snapshot: CampaignSnapshot): CampaignArtifact[] => snapshot.manifest.tasks.map(task => {
  const state = snapshot.checkpoint.tasks.find(row => row.taskId === task.id), artifact = state?.artifact && snapshot.artifacts.get(state.artifact.hash)
  verify(state?.status === 'committed' && artifact); return artifact as CampaignArtifact
})
/** Independent explicit root construction, not a compiler-supplied source table. */
async function sourceOracle(snapshot: CampaignSnapshot) {
  const artifacts = accepted(snapshot), plans = artifacts.filter(row => row.kind !== 'chapter_body'), bodies = artifacts.filter(row => row.kind === 'chapter_body')
  const canon = await buildPlanningCanon(snapshot.manifest, plans)
  verify(canon.canonBaseRoot && canon.fullPlanRoot && bodies.length === 60)
  const bodySources = bodies.map((artifact, index) => ({ chapterOrdinal: index + 1, artifact: planningArtifactRef(artifact), taskRevision: artifact.taskRevision, artifactCandidateId: artifact.candidateId, rawBodyHash: artifact.raw.hash, rawUtf16Units: artifact.text.length, rawUtf8Bytes: new TextEncoder().encode(artifact.text).length, rawScalars: [...artifact.text].length }))
  const bodyPrefixRoot = await hashCampaignValue('campaign-body-prefix-v1', { protocol: 'campaign-body-prefix-v1', manifestHash: snapshot.manifest.hash, campaignId: snapshot.manifest.campaignId, currentCandidateId: snapshot.checkpoint.candidateId, canonBaseRoot: canon.canonBaseRoot, fullPlanRoot: canon.fullPlanRoot, throughChapterOrdinal: 60, bodySources })
  return { bodies, bodySources, bodyPrefixRoot, canon }
}
/** Window union is recalculated from literal slices, independently of reported coverage. */
async function packetOracle(snapshot: CampaignSnapshot, proposal: BodyEvidenceProposalEnvelope, packet: BodyEvidencePacket) {
  const oracle = await sourceOracle(snapshot)
  verify(packet.bodyPrefixRoot === oracle.bodyPrefixRoot && packet.canonBaseRoot === oracle.canon.canonBaseRoot && packet.fullPlanRoot === oracle.canon.fullPlanRoot)
  verify(canonicalStringify(packet.bodySources) === canonicalStringify(oracle.bodySources))
  verify(packet.spans.length === 60 && packet.claims.length === 60 && packet.exposure === 'local_author_only' && packet.purpose === 'local_author_continuity_preview')
  let total = 0
  for (let index = 0; index < 60; index++) {
    const body = oracle.bodies[index]!, spans = packet.spans.filter(span => span.sourceIndex === index)
    verify(spans.length === 1)
    const span = spans[0]!, input = proposal.spans.find(row => row.id === span.id)
    verify(input && canonicalStringify(input.artifact) === canonicalStringify(planningArtifactRef(body)) && span.startUtf16 === 0 && span.endUtf16 === body.text.length && span.quote === body.text && span.quoteHash === await hashText(body.text))
    const row = packet.coverage.supplied.rows[index]
    verify(row && row.sourceIndex === index && row.coveredUtf16Units === body.text.length && row.status === 'complete' && row.gaps.length === 0 && canonicalStringify(row.intervals) === canonicalStringify([[0, body.text.length]]))
    total += body.text.length
  }
  verify(packet.coverage.availablePrefix.totalUtf16Units === total && packet.coverage.availablePrefix.sourceCount === 60 && packet.coverage.availablePrefix.acceptedOutsidePrefix === 0 && packet.coverage.supplied.coveredUtf16Units === total)
  const examination = packet.coverage.examinedDeclaration
  verify(examination.status === 'producer_declared')
  if (examination.status !== 'producer_declared') throw new Error('body_evidence_examination_required')
  verify(examination.verification === 'range_and_identity_only' && examination.declaredUtf16Units === total && examination.coverageStatus === 'complete' && canonicalStringify(examination.rows) === canonicalStringify(packet.coverage.supplied.rows))
  verify(packet.coverage.semanticReview.status === 'not_reviewed' && packet.coverage.semanticReview.reviewedUtf16Units === 0 && packet.coverage.semanticReview.relationCompleteness === 'not_assessed' && packet.coverage.semanticAdjudication === 'not_run')
  const final = packet.claims.find(row => row.id === 'claim.60')
  verify(final && canonicalStringify(final.premiseClaimIds) === canonicalStringify(['claim.1', 'claim.30']) && packet.claims.some(row => row.id === 'claim.1') && packet.claims.some(row => row.id === 'claim.30'))
  verify(packet.planning.suppliedRecordCount === 0 && packet.planning.records.length === 0 && packet.planning.omittedRecordCount === oracle.canon.records.length && packet.planning.chapterOutlinesSupplied === 0 && packet.planning.chapterOutlinesOmitted === 60)
  return total
}
export async function runBodyEvidenceProfile(language: 'zh' | 'en', identity: CampaignRuntimeIdentity, observe: () => StorageObservation, authority: () => BodyEvidenceAuthority,
  io?: CampaignRepositoryIO, onProgress?: (row: BodyEvidenceProfile) => Promise<void>, namespaceDigest?: () => Promise<string>): Promise<BodyEvidenceProfile> {
  const result = emptyBodyEvidenceProfile(io ? 'node' : 'native', language), id = bodyEvidenceProfileId(language), baseIO = io ?? { getMany: idbGetMany, compareAndSwapMany: idbCompareAndSwapMany }
  let previewScope = false, dispatches = 0, commitAttempts = 0, ioCalls = 0, ioRecords = 0, ioBytes = 0, repositoryReads = 0, repositoryMs = 0, repositoryMax = 0
  const measuredIO: CampaignRepositoryIO = {
    async getMany(keys) {
      const rows = await baseIO.getMany(keys)
      if (previewScope) { ioCalls++; ioRecords += keys.length; ioBytes += [...rows].reduce((sum, [key, value]) => sum + utf8Bytes(key) + (value === null ? 0 : utf8Bytes(value)), 0) }
      return rows
    },
    async compareAndSwapMany(entries, canCommit) { if (previewScope) commitAttempts++; return baseIO.compareAndSwapMany(entries, canCommit) },
  }
  const repository = createCampaignRepository(measuredIO), read = repository.read.bind(repository)
  repository.read = async (...args) => {
    const measured = previewScope, start = performance.now()
    try { return await read(...args) } finally { if (measured) { const elapsed = performance.now() - start; repositoryReads++; repositoryMs += elapsed; repositoryMax = Math.max(repositoryMax, elapsed) } }
  }
  const engine = createOfflineCampaignEngine({ identity, repository, fixture: { onDispatch() { dispatches++ } } })
  let snapshot: CampaignSnapshot | null = null, activeCheck: typeof BODY_PROFILE_CHECKS[number] = 'committed_source'
  const mark = (id: typeof BODY_PROFILE_CHECKS[number]) => { result.checks.find(row => row.id === id)!.status = 'pass'; activeCheck = id }
  const update = () => {
    const measured = observe(); result.actualFixtureInvocations = dispatches; result.authority = authority()
    Object.assign(result, { liveRecordCount: measured.liveRecordCount, liveSerializedMapBytes: Object.values(measured.liveBytesByRecordKind).reduce((sum, n) => sum + n, 0), committedTransactions: measured.committedTransactions, accountingMismatches: measured.accountingMismatches })
    if (snapshot) Object.assign(result, { committedTasks: snapshot.checkpoint.tasks.filter(row => row.status === 'committed').length, committedBodyScalars: snapshot.checkpoint.bodyCharacters, reservedAttempts: snapshot.checkpoint.budget.attempts, committedOperations: snapshot.checkpoint.budget.operations, checkpointHash: snapshot.checkpoint.hash, cumulativeWrittenBytes: decodeStorageBytes(snapshot.checkpoint.storage.writtenBytes), outstandingBytes: decodeStorageBytes(snapshot.checkpoint.storage.outstandingBytes), recoveryRemainingBytes: decodeStorageBytes(snapshot.checkpoint.storage.recoveryRemainingBytes), openAllocations: snapshot.checkpoint.storage.openAllocations.length })
    const operations = engine.readOperationTimings(); result.operationTimingsCollected = operations.status === 'collected'; result.operationTimeouts = operations.phases.reduce((sum, row) => sum + row.timeout, 0); result.operationAborts = operations.phases.reduce((sum, row) => sum + row.abort, 0); result.operationErrors = operations.phases.reduce((sum, row) => sum + row.error, 0); result.maxIoOperationMs = ms(Math.max(0, ...operations.phases.filter(row => row.phase !== 'dispatch').map(row => row.maxMs ?? 0))); result.maxDispatchOperationMs = ms(Math.max(0, ...operations.phases.filter(row => row.phase === 'dispatch').map(row => row.maxMs ?? 0)));
    const timeouts = engine.readTimeoutDiagnostics(); result.timeoutEvents = timeouts.events.length + timeouts.overflow
  }
  const progress = async () => { update(); if (onProgress) await onProgress(structuredClone(result)) }
  const started = performance.now()
  try {
    verify(namespaceDigest)
    result.status = 'running'; await progress()
    const manifest = await createOfflineCampaignManifest(planningManifestOptions({ campaignId: id, language, identity, profile: 'compact-60' }))
    snapshot = await engine.prepare(manifest)
    for (let i = 0; i < 123; i++) {
      const start = performance.now()
      try { snapshot = await engine.step(id, `body-evidence-setup-${i}`) } finally { result.maxStepMs = Math.max(result.maxStepMs, ms(performance.now() - start)) }
      if (snapshot.head.status === 'blocked' || snapshot.head.status === 'paused' || snapshot.head.status === 'cancelled') throw { code: snapshot.checkpoint.reason }
      await progress()
    }
    result.setupMs = ms(performance.now() - started); update()
    verify(snapshot.head.status === 'completed' && result.committedTasks === 123 && result.committedOperations === 494 && result.committedTransactions === 494 && result.actualFixtureInvocations === 123 && result.reservedAttempts === 123 && result.committedBodyScalars === planningFixtureBodyTarget(language, 60))
    result.maxBodyScalars = Math.max(...accepted(snapshot).filter(row => row.kind === 'chapter_body').map(row => [...row.text].length)); verify(result.maxBodyScalars <= 256)
    result.artifactSetHash = await bodyEvidenceArtifactSetHash(snapshot); mark('committed_source')
    const fixtureProposal = await buildBodyEvidenceFixtureProposal(snapshot, 60), generic = JSON.parse(fixtureProposal) as BodyEvidenceProposalEnvelope
    generic.producer = { kind: 'local_declaration', version: 'generic-local-control-v1' }; generic.claims[0]!.statement = language === 'zh' ? '未审阅的替代解释。' : 'An unreviewed alternative interpretation.'
    const genericProposal = canonicalStringify(generic), measuredBefore = observe(), dispatchBefore = dispatches
    const operationBefore = engine.readOperationTimings(); verify(operationBefore.status === 'collected');
    result.namespaceHashBefore = await namespaceDigest!()
    previewScope = true
    let firstText: string | null = null, finalPacket: BodyEvidencePacket | null = null
    for (const [index, text] of [fixtureProposal, fixtureProposal, genericProposal].entries()) {
      const begin = performance.now(), preview = await engine.previewBodyEvidence(id, text), elapsed = performance.now() - begin
      result.previewInvocations++; result.previewMs += ms(elapsed); result.maxPreviewMs = Math.max(result.maxPreviewMs, ms(elapsed))
      if (preview.status !== 'ready') throw { code: preview.refusalCode }
      verify(preview.packetBytes === utf8Bytes(preview.packetText) && preview.packetUtf16 === preview.packetText.length && preview.packetDigest === await hashText(preview.packetText))
      if (index === 0) firstText = preview.packetText
      if (index === 1) { verify(preview.packetText === firstText); mark('deterministic_packet') }
      if (index === 2) {
        finalPacket = JSON.parse(preview.packetText) as BodyEvidencePacket
        verify(finalPacket.producer.kind === 'local_declaration' && finalPacket.claims.some(row => row.statement === generic.claims[0]!.statement)); mark('generic_input')
        result.sourceUtf16 = await packetOracle(snapshot, generic, finalPacket); mark('prefix_root'); mark('literal_anchors'); mark('coverage_union'); mark('declared_premises')
        Object.assign(result, { canonBaseRoot: preview.canonBaseRoot, fullPlanRoot: preview.fullPlanRoot, bodyPrefixRoot: preview.bodyPrefixRoot, packetDigest: preview.packetDigest, proposalBytes: utf8Bytes(genericProposal), proposalUtf16: genericProposal.length, packetBytes: preview.packetBytes, packetUtf16: preview.packetUtf16, sourceCount: finalPacket.bodySources.length, spanCount: finalPacket.spans.length, claimCount: finalPacket.claims.length, suppliedUtf16: finalPacket.coverage.supplied.coveredUtf16Units, declaredExaminedUtf16: finalPacket.coverage.examinedDeclaration.status === 'producer_declared' ? finalPacket.coverage.examinedDeclaration.declaredUtf16Units : 0 })
        const compileStarted = performance.now(), check = () => { if (performance.now() - compileStarted >= 3000) throw new BodyEvidenceRefusalError('deadline_exceeded') }
        const pure = await compileBodyEvidence(snapshot, genericProposal, check); check(); result.compileMs = ms(performance.now() - compileStarted); verify(pure.packetText === preview.packetText)
      }
    }
    previewScope = false
    result.namespaceHashAfter = await namespaceDigest!()
    const measuredAfter = observe(), operationAfter = engine.readOperationTimings(); verify(operationAfter.status === 'collected');
    result.previewOperationTimeouts = operationAfter.phases.reduce((sum, row, index) => sum + row.timeout - operationBefore.phases[index]!.timeout, 0); result.previewOperationAborts = operationAfter.phases.reduce((sum, row, index) => sum + row.abort - operationBefore.phases[index]!.abort, 0); result.previewOperationErrors = operationAfter.phases.reduce((sum, row, index) => sum + row.error - operationBefore.phases[index]!.error, 0)
    Object.assign(result, { previewRepositoryReadCalls: repositoryReads, previewRepositoryReadMs: ms(repositoryMs), maxPreviewRepositoryReadMs: ms(repositoryMax), previewIoReadCalls: ioCalls, previewIoReadRecords: ioRecords, previewIoReadBytes: ioBytes, previewCampaignCommitAttempts: commitAttempts, previewCampaignTransactions: measuredAfter.committedTransactions - measuredBefore.committedTransactions, previewWrittenBytes: measuredAfter.cumulativeWrittenBytes - measuredBefore.cumulativeWrittenBytes, previewFixtureInvocations: dispatches - dispatchBefore })
    verify(finalPacket && result.namespaceHashBefore === result.namespaceHashAfter && result.previewCampaignCommitAttempts === 0 && result.previewCampaignTransactions === 0 && result.previewWrittenBytes === 0 && result.previewFixtureInvocations === 0); mark('no_writes_or_dispatch')
    verify(result.previewOperationTimeouts === 0 && result.previewOperationAborts === 0 && result.previewOperationErrors === 0 && repositoryReads === 6 && repositoryMax < 3000 && ioCalls > 0 && ioRecords > 0 && ioBytes > 0); mark('fresh_reads')
    const beforeCold = observe(), coldStarted = performance.now(), coldRepository = createCampaignRepository(baseIO), coldEngine = createOfflineCampaignEngine({ identity, repository: coldRepository })
    try {
      const reopened = await coldEngine.inspect(id) as CampaignSnapshot | null
      result.coldRepositoryReadMs = ms(performance.now() - coldStarted)
      verify(result.coldRepositoryReadMs < 3000 && reopened && reopened.rawHead === snapshot.rawHead && await bodyEvidenceArtifactSetHash(reopened) === result.artifactSetHash)
    } finally { coldEngine.dispose() }
    result.coldRepositoryReadBytes = observe().totalReadBytes - beforeCold.totalReadBytes; result.coldRepositoryReadCalls = observe().totalReadCalls - beforeCold.totalReadCalls; result.coldRepositoryRead = 'verified'; mark('cold_repository_reopen')
    verify(result.namespaceHashAfter === await namespaceDigest!() && authority().observed && Object.entries(authority()).every(([key, value]) => key === 'observed' || value === 0))
    result.status = 'pass'; await progress()
  } catch (error) {
    const code = safeBodyEvidenceCode(error); result.refusalCode = code; result.status = code === 'operation_timeout' || code === 'deadline_exceeded' ? 'timeout' : code === 'profile_failure' ? 'failed' : 'refused'; result.checks.find(row => row.id === activeCheck)!.status = 'fail'; update(); if (onProgress) await onProgress(structuredClone(result))
  } finally { previewScope = false; engine.dispose() }
  return result
}
/** A separate browser process starts with no caches; inspect and preview stay read-only. */
export async function inspectBodyEvidenceAfterRestart(expected: BodyEvidenceProfile, observe: () => StorageObservation, authority: () => BodyEvidenceAuthority, namespaceDigest: () => Promise<string>) {
  const started = performance.now(), before = observe(), repository = createCampaignRepository(), engine = createOfflineCampaignEngine({ repository, identity: getCampaignBuildIdentity() })
  try {
    const snapshot = await engine.inspect(bodyEvidenceProfileId(expected.language)) as CampaignSnapshot | null, initialMs = performance.now() - started
    verify(snapshot && initialMs < 3000 && snapshot.head.status === 'completed' && snapshot.head.checkpointHash === expected.checkpointHash && await bodyEvidenceArtifactSetHash(snapshot) === expected.artifactSetHash)
    if (!snapshot) throw new Error('body_evidence_restart_missing')
    verify(await namespaceDigest() === expected.namespaceHashAfter && decodeStorageBytes(snapshot.checkpoint.storage.writtenBytes) === expected.cumulativeWrittenBytes && snapshot.checkpoint.bodyCharacters === expected.committedBodyScalars)
    const raw = JSON.parse(await buildBodyEvidenceFixtureProposal(snapshot, 60)) as BodyEvidenceProposalEnvelope
    raw.producer = { kind: 'local_declaration', version: 'generic-local-control-v1' }; raw.claims[0]!.statement = expected.language === 'zh' ? '未审阅的替代解释。' : 'An unreviewed alternative interpretation.'
    const preview = await engine.previewBodyEvidence(snapshot.manifest.campaignId, canonicalStringify(raw))
    verify(preview.status === 'ready' && preview.bodyPrefixRoot === expected.bodyPrefixRoot && preview.packetDigest === expected.packetDigest && await namespaceDigest() === expected.namespaceHashAfter)
    verify(observe().committedTransactions === before.committedTransactions && observe().cumulativeWrittenBytes === before.cumulativeWrittenBytes && authority().observed && Object.entries(authority()).every(([key, value]) => key === 'observed' || value === 0))
    return { coldProcessRestart: 'verified' as const, coldProcessReadMs: ms(performance.now() - started), coldProcessInitialReadMs: ms(initialMs), coldProcessReadBytes: observe().totalReadBytes - before.totalReadBytes, coldProcessReadCalls: observe().totalReadCalls - before.totalReadCalls }
  } finally { engine.dispose() }
}
