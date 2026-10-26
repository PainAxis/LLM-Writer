/** Serial N60 readiness profile, shared by injected atomic IO and real native IDB.
 * It produces no semantic verdict and returns only allowlisted derived metadata. */
import type { CampaignRepositoryIO } from '../../src/types/writerCampaign'
import type { BodyProducerAdapter, BodyProducerEngine, ProducerCampaignRepository, ProducerCampaignSnapshot } from '../../src/types/bodyProducer'
import { createCampaignRepository } from '../../src/services/writerCampaign/store'
import { createOfflineCampaignEngine, createOfflineCampaignManifest, type CampaignRuntimeIdentity } from '../../src/services/writerCampaign/engine'
import { planningManifestOptions } from '../../src/services/writerCampaign/planningProfile'
import { deriveBodyEvidencePrefix } from '../../src/services/writerCampaign/bodyEvidence'
import { canonicalStringify, decodeStorageBytes, hashText, utf8Bytes } from '../../src/services/writerCampaign/protocol'
import { createProducerCampaignRepository } from '../../src/services/writerCampaign/producerStore'
import { createBodyProducerEngine } from '../../src/services/writerCampaign/bodyProducerEngine'
import { producerStorageAllowance } from '../../src/services/writerCampaign/producerStorage'
import { arbitraryProducerBody, type ProducerHttpObservation } from './writer-body-producer-control'
import { emptyProducerProfile, ORIGIN_PROOF_KEYS, producerBudgetRefusal, producerProfileChecks, safeProducerCode, safeProducerReason, type ProducerProfileRow } from './writer-body-producer-report'
import { mergeOwnerNumbers, mergeVerificationNumbers, OWNER_STAT_KEYS, VERIFICATION_STAT_KEYS, type OwnerNumbers, type VerificationNumbers } from './writer-body-producer-verification-report'
import type { ProducerIoMetrics } from './writer-body-producer-io'
import { createCampaignHeapObservation } from './writer-campaign-heap-observation'
const verify: (value: unknown) => asserts value = value => { if (!value) throw new Error('producer_profile_verification_failed') }
const ms = (value: number) => Math.max(0, Math.ceil(value))
export const producerProfileCampaignId = (language: 'zh' | 'en') => `producer-readiness-n60-${language}`
export interface ProducerProfileOptions { language: 'zh' | 'en'; platform: 'node' | 'native'; identity: CampaignRuntimeIdentity; io: CampaignRepositoryIO; observeIo(): ProducerIoMetrics; adapter: BodyProducerAdapter; observeHttp(): Promise<ProducerHttpObservation>; onProgress?(row: ProducerProfileRow): Promise<void> }
export function forwardProducerProofCapabilities(source: ProducerCampaignRepository, target: ProducerCampaignRepository): void {
  if (source.createActionScope) target.createActionScope = source.createActionScope.bind(source)
  if (source.disposeActionScope) target.disposeActionScope = source.disposeActionScope.bind(source)
  if (source.getActionProofStats) target.getActionProofStats = source.getActionProofStats.bind(source)
  if (source.getVerificationStats) target.getVerificationStats = source.getVerificationStats.bind(source)
  if (source.verifyCurrent && !target.verifyCurrent) target.verifyCurrent = source.verifyCurrent.bind(source)
  if (source.adoptVerified && !target.adoptVerified) target.adoptVerified = source.adoptVerified.bind(source)
}
function assertConservation(snapshot: ProducerCampaignSnapshot, observed: ProducerIoMetrics): void {
  const s = snapshot.checkpoint.storage
  const w = decodeStorageBytes(s.writtenBytes), u = decodeStorageBytes(s.outstandingBytes), p = decodeStorageBytes(s.recoveryRemainingBytes)
  verify(w === observed.writtenBytes && observed.accountingMismatches === 0)
  verify(decodeStorageBytes(s.allocatedBytes) - decodeStorageBytes(s.allocationConsumedBytes) - decodeStorageBytes(s.releasedBytes) === u)
  verify(s.openAllocations.reduce((sum, row) => sum + decodeStorageBytes(row.remainingBytes), 0) === u)
  verify(w + u + p <= 67_108_864 && decodeStorageBytes(snapshot.origin.manifest.storage.limitBytes) === 67_108_864)
}
function admissionActuallyExhausted(snapshot: ProducerCampaignSnapshot): boolean {
  const state = snapshot.checkpoint, max = snapshot.origin.manifest.budget, storage = state.storage
  return state.producerRequests.length >= 8 || state.budget.attempts + 1 > max.attempts
    || state.budget.activeMs + 60_000 > max.activeMs - 160_000
    || state.budget.outputTokens + 1200 > max.outputTokens || state.budget.responseBytes + 65_536 > max.responseBytes
    || decodeStorageBytes(storage.writtenBytes) + decodeStorageBytes(storage.outstandingBytes) + decodeStorageBytes(storage.recoveryRemainingBytes)
      + producerStorageAllowance(snapshot.origin.manifest.tasks.length) > decodeStorageBytes(snapshot.origin.manifest.storage.limitBytes)
}
export async function runProducerProfile(options: ProducerProfileOptions): Promise<ProducerProfileRow> {
  const { language, identity, io, observeIo, adapter, observeHttp } = options, row = emptyProducerProfile(options.platform, language), id = producerProfileCampaignId(language)
  const producerRepositories: ProducerCampaignRepository[] = [], producerEngines: BodyProducerEngine[] = [], subscriptions: Array<() => void> = []
  let fixtureCalls = 0, snapshot: ProducerCampaignSnapshot | null = null
  const heap = createCampaignHeapObservation()
  const checks = producerProfileChecks(row), mark = checks.pass
  const update = async () => {
    const observed = observeIo(), http = await observeHttp()
    heap.sample(); row.observations.heap = heap.snapshot()
    Object.assign(row.observations.retention, { status: 'collected', maxReadBatchBytes: observed.maxReadBatchBytes, maxReadBatchKeys: observed.maxReadBatchKeys, liveRecordCount: observed.liveRecordCount, liveSerializedBytes: observed.liveSerializedBytes })
    const proof = repository.getActionProofStats?.()
    if (proof) Object.assign(row.observations.proof, { status: 'collected', legacyAdmittedScopes: proof.admittedScopes, legacyFallbackScopes: proof.fallbackScopes, legacyDisposedScopes: proof.disposedScopes, legacyColdReplays: proof.coldReplays, legacyExactPasses: proof.exactPasses, legacyRetainedBytes: proof.retainedBytes, legacyPeakRetainedBytes: proof.peakRetainedBytes, legacyPeakRetainedEntries: proof.peakRetainedEntries, legacyColdMaxMs: ms(proof.coldMaxMs), legacyExactMaxMs: ms(proof.exactMaxMs) })
    if (proof) row.metrics.maxVerifiedReadMs = Math.max(row.metrics.maxVerifiedReadMs, ms(proof.coldMaxMs), ms(proof.exactMaxMs))
    const originProofs = producerRepositories.map(value => value.getActionProofStats?.()).filter(value => value !== undefined)
    if (originProofs.length) {
      row.observations.producerOriginProof.status = 'collected'
      for (const key of ORIGIN_PROOF_KEYS) row.observations.producerOriginProof[key] = ms(key.includes('Max') || key.startsWith('peak') ? Math.max(...originProofs.map(value => value[key])) : originProofs.reduce((sum, value) => sum + value[key], 0))
      row.metrics.maxVerifiedReadMs = Math.max(row.metrics.maxVerifiedReadMs, ...originProofs.flatMap(value => [ms(value.coldMaxMs), ms(value.exactMaxMs)]))
    }
    const verification = producerRepositories.map(value => value.getVerificationStats?.()), execution = producerEngines.map(value => value.getExecutionStats?.())
    if (verification.length && verification.every(value => value !== undefined) && execution.every(value => value !== undefined)) {
      verify(verification.every(value => value.protocol === 'producer-verification-session-v1') && execution.every(value => value.protocol === 'producer-execution-owner-v1'))
      row.observations.verification.status = 'collected'
      row.observations.verification.stats = mergeVerificationNumbers(verification.map(value => Object.fromEntries(VERIFICATION_STAT_KEYS.map(key => [key, ms(value[key])])) as VerificationNumbers))
      row.observations.verification.owners = mergeOwnerNumbers(execution.map(value => Object.fromEntries(OWNER_STAT_KEYS.map(key => [key, ms(value[key])])) as OwnerNumbers))
      row.metrics.maxVerifiedReadMs = Math.max(row.metrics.maxVerifiedReadMs, row.observations.verification.stats.sessionMaxMs)
      row.metrics.maxRepositoryActionMs = Math.max(row.metrics.maxRepositoryActionMs, row.observations.verification.stats.sessionMaxMs)
    }
    Object.assign(row.metrics, { readCalls: observed.readCalls, readBytes: observed.readBytes, writeTransactions: observed.writeTransactions, accountingMismatches: observed.accountingMismatches, httpAttempts: http.attempts, maxRawIoWaitMs: ms(observed.maxRawIoWaitMs), maxCasWaitMs: ms(observed.maxCasWaitMs) })
    if (snapshot) {
      Object.assign(row.metrics, { committedTasks: snapshot.checkpoint.tasks.filter(task => task.status === 'committed').length, producerRequests: snapshot.checkpoint.producerRequests.length, sharedAttempts: snapshot.checkpoint.budget.attempts, sharedOperations: snapshot.checkpoint.budget.operations, sourceEpoch: snapshot.checkpoint.sourceEpoch, writtenBytes: decodeStorageBytes(snapshot.checkpoint.storage.writtenBytes), outstandingBytes: decodeStorageBytes(snapshot.checkpoint.storage.outstandingBytes), recoveryBytes: decodeStorageBytes(snapshot.checkpoint.storage.recoveryRemainingBytes) })
      row.checkpointHash = snapshot.checkpoint.hash
      row.requests = snapshot.checkpoint.producerRequests.map(index => {
        const phase = snapshot!.phases.get(index.phaseHash)!, allocation = snapshot!.checkpoint.storage.openAllocations.find(value => value.request.id === index.id)
        return { requestHash: index.requestHash, phaseHash: phase.hash, status: phase.status, responseHash: phase.responseHash,
          resolutionOutcome: phase.resolution?.outcome ?? null, resolutionReason: safeProducerReason(phase.resolution?.reason ?? null), phaseReason: safeProducerReason(phase.reason),
          outstandingBytes: allocation ? decodeStorageBytes(allocation.remainingBytes) : 0 }
      })
      const payloads = new Map<string, unknown>()
      for (const map of [snapshot.origin.artifacts, snapshot.origin.requests, snapshot.artifacts, snapshot.requests, snapshot.phases, snapshot.responses, snapshot.reviews]) for (const [hash, value] of map) payloads.set(hash, value)
      row.observations.retention.activePayloadRecords = payloads.size
      row.observations.retention.activeSerializedPayloadBytes = [...payloads.values()].reduce<number>((bytes, value) => bytes + utf8Bytes(canonicalStringify(value)), 0)
    }
    if (options.onProgress) await options.onProgress(structuredClone(row))
  }
  const repository = createCampaignRepository(io), originalRead = repository.read.bind(repository)
  repository.read = async (...args) => { const started = performance.now(); try { return await originalRead(...args) } finally { const elapsed = ms(performance.now() - started); row.metrics.maxLegacyVerifiedReadMs = Math.max(row.metrics.maxLegacyVerifiedReadMs, elapsed); row.metrics.maxVerifiedReadMs = Math.max(row.metrics.maxVerifiedReadMs, elapsed); row.metrics.maxRepositoryActionMs = Math.max(row.metrics.maxRepositoryActionMs, elapsed) } }
  const legacy = createOfflineCampaignEngine({ identity, repository, fixture: { onDispatch() { fixtureCalls++ } } })
  function observedEngine(): BodyProducerEngine {
    const v3 = createProducerCampaignRepository({ io }); producerRepositories.push(v3)
    const measured = Object.fromEntries((['read', 'adopt', 'commit', 'getReceipt', 'verifyCurrent', 'adoptVerified'] as const).filter(name => v3[name]).map(name => [name, async (...args: unknown[]) => {
      const started = performance.now(); let verifiedRead = false
      try {
        const result = await (v3[name] as (...args: unknown[]) => Promise<unknown>)(...args)
        if ((name === 'read' || name === 'verifyCurrent') && result) { snapshot = result as ProducerCampaignSnapshot; verifiedRead = true; row.requestObservation = 'last_verified'; row.observations.proof.v3Mode = 'session_full_raw_fence_then_warm_full_v3_tail_exact_origin'; row.observations.proof.v3VerifiedReads++ }
        else if (['commit', 'adopt', 'adoptVerified'].includes(name) && result) { snapshot = (result as { snapshot: ProducerCampaignSnapshot }).snapshot; row.requestObservation = 'last_verified' }
        return result
      } catch (error) { row.requestObservation = 'unconfirmed'; throw error }
      finally {
        const elapsed = ms(performance.now() - started); row.metrics.maxRepositoryActionMs = Math.max(row.metrics.maxRepositoryActionMs, elapsed)
        if (name === 'read' || name === 'verifyCurrent') { row.metrics.maxVerifiedReadMs = Math.max(row.metrics.maxVerifiedReadMs, elapsed); if (verifiedRead && row.metrics.initialProducerReadMs === 0) row.metrics.initialProducerReadMs = elapsed }
        if (name !== 'verifyCurrent' && name !== 'adoptVerified') { row.metrics.maxWarmRepositoryActionMs = Math.max(row.metrics.maxWarmRepositoryActionMs, elapsed); if (name === 'read') row.metrics.maxWarmVerifiedReadMs = Math.max(row.metrics.maxWarmVerifiedReadMs, elapsed) }
      }
    }])) as unknown as ProducerCampaignRepository
    forwardProducerProofCapabilities(v3, measured)
    const created = createBodyProducerEngine({ identity, repository: measured, adapters: [adapter] }); producerEngines.push(created)
    const stop = created.subscribeVerification?.(event => { row.observations.verification.last = { status: event.status, progress: event.progress ? structuredClone(event.progress) : event.status === 'started' ? null : row.observations.verification.last?.progress ?? null } })
    if (stop) subscriptions.push(stop)
    return created
  }
  const engine = observedEngine()
  try {
    row.status = 'running'; await update()
    const started = performance.now(), manifest = await createOfflineCampaignManifest(planningManifestOptions({ campaignId: id, language, identity, profile: 'compact-60' }))
    let accepted = await legacy.prepare(manifest)
    for (let step = 0; step < 123; step++) {
      accepted = await legacy.step(id, `producer-profile-setup-${step}`)
      verify(accepted.head.status !== 'blocked' && accepted.head.status !== 'cancelled' && accepted.head.status !== 'paused')
      if (step % 12 === 0) await update()
    }
    row.metrics.setupMs = ms(performance.now() - started); row.metrics.legacyAttempts = accepted.checkpoint.budget.attempts
    verify(accepted.head.status === 'completed' && accepted.checkpoint.tasks.length === 123 && accepted.checkpoint.tasks.every(task => task.status === 'committed') && fixtureCalls === 123 && accepted.checkpoint.budget.attempts === 123)
    mark('legacy_source_complete')
    checks.begin('legacy_preview_read_only')
    const prefix = await deriveBodyEvidencePrefix(accepted, 60)
    const proposal = canonicalStringify({ protocol: 'campaign-body-evidence-proposals-v1', purpose: 'local_author_continuity_preview', campaignId: id, currentCandidateId: prefix.currentCandidateId, manifestHash: prefix.manifestHash, canonBaseRoot: prefix.canonBaseRoot, fullPlanRoot: prefix.fullPlanRoot, bodyPrefixRoot: prefix.bodyPrefixRoot, throughChapterOrdinal: 60, producer: { kind: 'local_declaration', version: 'producer-readiness-source-control' }, spans: [], claims: [], examination: { status: 'not_run', windows: [] } })
    const beforePreview = observeIo(), callsBeforePreview = (await observeHttp()).attempts, previewStart = performance.now()
    const preview = await legacy.previewBodyEvidence(id, proposal)
    row.metrics.maxLegacyPreviewMs = ms(performance.now() - previewStart)
    verify(preview.status === 'ready' && row.metrics.maxLegacyPreviewMs < 10_000 && observeIo().writeTransactions === beforePreview.writeTransactions && (await observeHttp()).attempts === callsBeforePreview && fixtureCalls === 123)
    mark('legacy_preview_read_only')
    checks.begin('adoption_shared_counters')
    const beforeAdoption = accepted.checkpoint, adoptionStart = performance.now()
    snapshot = await engine.adopt(id, 'producer-profile-adopt'); row.metrics.adoptionMs = ms(performance.now() - adoptionStart)
    verify(snapshot.origin.rawHead === accepted.rawHead && snapshot.manifest.adoptedManifestHash === accepted.manifest.hash && snapshot.checkpoint.budget.attempts === beforeAdoption.budget.attempts && decodeStorageBytes(snapshot.checkpoint.storage.writtenBytes) > decodeStorageBytes(beforeAdoption.storage.writtenBytes) && snapshot.checkpoint.storage.outstandingBytes === beforeAdoption.storage.outstandingBytes)
    assertConservation(snapshot, observeIo()); mark('adoption_shared_counters')
    checks.begin('input_source_sensitive')
    const oldText = prefix.bodyArtifacts.at(-1)!.text, oldPrepared = await engine.prepare(id, { chapterOrdinal: 60, startUtf16: 0, endUtf16: oldText.length, planningRefs: [] }, adapter.identity.adapterId)
    const body = arbitraryProducerBody(language)
    checks.begin('body_revision_exact')
    snapshot = await engine.reviseBody(id, 60, body, snapshot.rawHead, 'producer-profile-revise')
    const state = snapshot.source.tasks.find(task => task.taskId === 'b-60')!, artifact = snapshot.source.artifacts.get(state.artifact!.hash)!
    verify(artifact.text === body && artifact.parentHash === prefix.bodyArtifacts.at(-1)!.hash && snapshot.checkpoint.sourceEpoch > 0)
    row.sourceHash = await hashText(body); mark('body_revision_exact')
    let first = true
    for (let attempt = 0; attempt <= 8; attempt++) {
      const before = observeIo(), network = await observeHttp()
      checks.begin('input_source_sensitive')
      let handle
      try { handle = await engine.prepare(id, { chapterOrdinal: 60, startUtf16: 0, endUtf16: body.length, planningRefs: [] }, adapter.identity.adapterId) }
      catch (error) {
        const code = producerBudgetRefusal(error, checks)
        verify(snapshot && admissionActuallyExhausted(snapshot))
        verify(observeIo().writeTransactions === before.writeTransactions && (await observeHttp()).attempts === network.attempts)
        row.admissionStop = code; mark('budget_refusal_no_dispatch'); break
      }
      verify(handle.invocationAllowed && handle.prepared.window.text === body && handle.prepared.catalog.length === 0 && handle.prepared.inputDigest !== oldPrepared.prepared.inputDigest)
      row.inputDigest = handle.prepared.inputDigest; mark('input_source_sensitive')
      checks.begin('sdk_one_call')
      const start = performance.now(), pending = engine.invoke(handle, `producer-profile-call-${attempt}`)
      const duplicated = first ? engine.invoke(handle, `producer-profile-call-${attempt}`) : pending
      let duplicateResult: ProducerCampaignSnapshot
      try { snapshot = await pending; duplicateResult = await duplicated }
      finally { row.metrics.maxInvokeMs = Math.max(row.metrics.maxInvokeMs, ms(performance.now() - start)) }
      checks.begin('duplicate_no_replay'); verify(duplicateResult.rawHead === snapshot.rawHead)
      const http = await observeHttp()
      checks.begin('sdk_one_call')
      verify(http.errors === 0 && http.attempts === network.attempts + 1 && http.inputDigests.at(-1) === handle.prepared.inputDigest && http.windowDigests.at(-1) === row.sourceHash)
      mark('sdk_one_call')
      checks.begin('retained_outcome')
      const index = snapshot.checkpoint.producerRequests.at(-1)!, phase = snapshot.phases.get(index.phaseHash)!, review = phase.resolution?.reviewHash && snapshot.reviews.get(phase.resolution.reviewHash)
      verify(phase.status === 'resolved' && phase.resolution?.outcome === 'review_ready' && review)
      const packet = review.result.packet
      verify(packet.spans.some(span => span.quote === body) && packet.producer.inputDigest === handle.prepared.inputDigest && packet.inventory.digest === review.result.inventoryDigest)
      row.packetDigest = review.result.packetDigest; mark('retained_outcome')
      checks.begin('unresolved_visible')
      verify(review.result.responseItemCount === 1 && review.result.compiledClaimCount === 1 && review.result.unresolvedObservationCount === 1 && review.result.inventory.unresolved[0]!.reason === 'unmapped_topic'); mark('unresolved_visible')
      checks.begin('semantics_unreviewed')
      verify(packet.coverage.semanticReview.status === 'not_reviewed' && packet.coverage.semanticReview.relationCompleteness === 'not_assessed' && packet.coverage.examinedDeclaration.status === 'not_run')
      mark('semantics_unreviewed')
      if (first) {
        checks.begin('duplicate_no_replay')
        const repeat = await engine.invoke(handle, `producer-profile-call-${attempt}`)
        verify(repeat.rawHead === snapshot.rawHead && (await observeHttp()).attempts === http.attempts)
        mark('duplicate_no_replay'); first = false
      }
      checks.begin('shared_budget_conservation')
      assertConservation(snapshot, observeIo()); mark('shared_budget_conservation'); await update()
    }
    checks.begin('maximum_admitted_history')
    verify(row.admissionStop !== null && snapshot.checkpoint.producerRequests.length >= 1 && snapshot.checkpoint.producerRequests.length <= 5)
    mark('maximum_admitted_history')
    checks.begin('cold_repository_reopen')
    const expectedColdHead = snapshot.rawHead, cold = observedEngine(), coldStart = performance.now(), httpBeforeCold = (await observeHttp()).attempts
    const restored = await cold.inspect(id); row.metrics.coldReadMs = ms(performance.now() - coldStart)
    verify(restored && restored.rawHead === expectedColdHead && row.metrics.coldReadMs < 10_000 && (await observeHttp()).attempts === httpBeforeCold)
    assertConservation(restored, observeIo()); mark('cold_repository_reopen'); snapshot = restored
    await update()
    const v = row.observations.verification, p = row.observations.proof, m = row.metrics
    checks.begin('verification_session_contract')
    verify(v.status === 'collected' && v.stats.sessionsStarted > 0 && v.stats.sessionsCompleted === v.stats.sessionsStarted && v.stats.sessionsFailed === 0 && v.stats.sessionsCancelled === 0 && v.stats.sessionMaxMs < 10_000 && v.owners.maxMetadataOwnerMs < 10_000 && v.owners.maxInvocationOwnerMs < 60_000 && v.owners.ownersExpired === 0 && v.owners.deadlineRefusals === 0 && v.owners.lateResultRefusals === 0); mark('verification_session_contract')
    checks.begin('actual_io_and_warm_deadlines')
    verify(m.maxLegacyVerifiedReadMs < 3_000 && p.legacyColdMaxMs < 3_000 && p.legacyExactMaxMs < 3_000 && m.maxWarmVerifiedReadMs > 0 && m.maxWarmVerifiedReadMs < 3_000 && m.maxWarmRepositoryActionMs < 3_000 && m.maxRawIoWaitMs < 3_000 && m.maxCasWaitMs < 3_000 && v.stats.rawIoMaxMs < 3_000 && v.stats.casMaxMs < 3_000 && m.maxInvokeMs < 60_000); mark('actual_io_and_warm_deadlines')
    checks.begin('responsive_quantum_and_final_fence')
    verify(v.stats.maxOperationsPerAdvance > 0 && v.stats.maxOperationsPerAdvance <= 8 && v.stats.hostYields > 0 && v.stats.synchronousSegmentMaxMs <= 250 && v.stats.finalFencePasses > 0 && v.stats.finalFencePasses === v.stats.sessionsCompleted && v.stats.finalFenceExpectedRecords === v.stats.finalFenceObservedRecords); mark('responsive_quantum_and_final_fence')
    checks.begin('proof_retention_disposed')
    verify(v.stats.activeSessions === 0 && v.stats.sessionsDisposed === v.stats.sessionsStarted && v.owners.activeOwners === 0 && v.stats.retainedBytes === 0 && v.stats.retainedEntries === 0 && v.stats.activePayloadRecords === 0 && v.stats.peakRetainedBytes <= 67_108_864 && v.stats.peakRetainedEntries <= 8193 && v.stats.peakActivePayloadRecords <= 512); mark('proof_retention_disposed')
    row.status = 'pass'; await update()
  } catch (error) {
    row.refusalCode = safeProducerCode(error); row.status = ['deadline_exceeded', 'operation_timeout'].includes(row.refusalCode) ? 'timeout' : 'failed'
    checks.fail(); await update()
  } finally { legacy.dispose(); producerEngines.forEach(value => value.cancelLocal()); subscriptions.forEach(stop => stop()); await update(); row.observations.heap = heap.stop() }
  return row
}
export async function verifyProducerRestart(expected: ProducerProfileRow, identity: CampaignRuntimeIdentity, io?: CampaignRepositoryIO): Promise<ProducerProfileRow> {
  const next = structuredClone(expected), started = performance.now(), repository = createProducerCampaignRepository(io ? { io } : {}), engine = createBodyProducerEngine({ identity, repository })
  const stop = engine.subscribeVerification?.(event => { next.observations.verification.last = { status: event.status, progress: event.progress ? structuredClone(event.progress) : event.status === 'started' ? null : next.observations.verification.last?.progress ?? null } })
  try {
    const snapshot = await engine.inspect(producerProfileCampaignId(expected.language)); next.metrics.coldReadMs = ms(performance.now() - started)
    verify(snapshot && next.metrics.coldReadMs < 10_000 && snapshot.checkpoint.hash === expected.checkpointHash && snapshot.checkpoint.sourceEpoch === expected.metrics.sourceEpoch && snapshot.checkpoint.budget.attempts === expected.metrics.sharedAttempts && decodeStorageBytes(snapshot.checkpoint.storage.writtenBytes) === expected.metrics.writtenBytes && snapshot.checkpoint.producerRequests.length === expected.metrics.producerRequests); next.restart = 'pass'
  } catch (error) { next.restart = 'fail'; next.status = 'failed'; next.refusalCode = safeProducerCode(error); next.requestObservation = 'unconfirmed' }
  finally {
    engine.cancelLocal(); stop?.()
    const stats = repository.getVerificationStats?.(), owners = engine.getExecutionStats?.()
    const proof = repository.getActionProofStats?.()
    if (proof) for (const key of ORIGIN_PROOF_KEYS) {
      const prior = next.observations.producerOriginProof[key], current = ms(proof[key])
      next.observations.producerOriginProof[key] = key.includes('Max') || key.startsWith('peak') ? Math.max(prior, current) : prior + current
    }
    if (next.restart === 'pass') next.observations.proof.v3VerifiedReads++
    if (stats && owners) {
      next.observations.verification.stats = mergeVerificationNumbers([next.observations.verification.stats, Object.fromEntries(VERIFICATION_STAT_KEYS.map(key => [key, ms(stats[key])])) as VerificationNumbers])
      next.observations.verification.owners = mergeOwnerNumbers([next.observations.verification.owners, Object.fromEntries(OWNER_STAT_KEYS.map(key => [key, ms(owners[key])])) as OwnerNumbers])
      next.metrics.maxRepositoryActionMs = Math.max(next.metrics.maxRepositoryActionMs, ms(stats.sessionMaxMs)); next.metrics.maxVerifiedReadMs = Math.max(next.metrics.maxVerifiedReadMs, ms(stats.sessionMaxMs))
    } else { next.restart = 'fail'; next.status = 'failed'; next.refusalCode = 'profile_failed' }
  }
  return next
}
