/** Full production engine/store execution. No metadata shortcut and no deadline override. */
import type { CampaignRepositoryIO, CampaignSnapshot } from '../../src/types/writerCampaign'
import { canonicalStringify, decodeStorageBytes, hashCampaignValue, utf8Bytes } from '../../src/services/writerCampaign/protocol'
import { createCampaignRepository } from '../../src/services/writerCampaign/store'
import { createOfflineCampaignEngine, createOfflineCampaignManifest, type CampaignRuntimeIdentity } from '../../src/services/writerCampaign/engine'
import { planningManifestOptions, planningFixtureBodyTarget, type PlanningProfileName } from '../../src/services/writerCampaign/planningProfile'
import { PLANNING_STAGE_LIMITS } from '../../src/services/writerCampaign/planningProtocol'
import { emptyPlanningProfile, safePlanningCode, type PlanningAuthority, type PlanningProfileMeasurement } from './writer-campaign-planning-report'
import type { StorageObservation } from './writer-campaign-capacity-profile'
export const planningProfileId = (profile: PlanningProfileName, language: 'zh' | 'en') => `planning-${profile}-${language}`
const verify = (condition: unknown): void => { if (!condition) throw new Error('planning_profile_verification_failed') }
export async function planningArtifactSetHash(snapshot: CampaignSnapshot): Promise<string> {
  return hashCampaignValue('planning-profile-artifact-set-v1', snapshot.checkpoint.tasks.map(task => task.artifact))
}
export async function runPlanningProfile(profile: PlanningProfileName, language: 'zh' | 'en', identity: CampaignRuntimeIdentity,
  observe: () => StorageObservation, authority: () => PlanningAuthority, io?: CampaignRepositoryIO,
  onProgress?: (row: PlanningProfileMeasurement) => Promise<void>): Promise<PlanningProfileMeasurement> {
  const result = emptyPlanningProfile(profile, language), id = planningProfileId(profile, language), repository = createCampaignRepository(io)
  result.coldProcessRestart = io ? 'not_applicable' : 'not_run'
  let calls = 0, snapshot: CampaignSnapshot | undefined, dispatchPurposeVerified = true
  const engine = createOfflineCampaignEngine({ identity, repository, fixture: { onDispatch(request) {
    calls++
    const stage = snapshot!.manifest.tasks.find(task => task.id === request.taskId)!.kind, row = result.stages.find(row => row.stage === stage)!
    const packet = JSON.parse(request.preparedInput)
    verify(packet.protocol === 'campaign-context-v1' && packet.purpose === (stage === 'chapter_body' ? 'body_fixture_dispatch' : 'stage_dispatch'))
    verify(request.inputBytes === new TextEncoder().encode(request.preparedInput).length && request.inputUtf16 === request.preparedInput.length)
    verify(request.reservation.responseBytes === PLANNING_STAGE_LIMITS[stage].responseBytes)
    verify(request.inputBytes <= PLANNING_STAGE_LIMITS[stage].inputBytes)
    if (stage === 'chapter_body') {
      dispatchPurposeVerified &&= packet.purpose !== 'planning_preview' && packet.fullPlanRoot === result.fullPlanRoot
      verify(packet.globalCanon && packet.sourceRefs.length === 3 + result.plannedChapters + (snapshot!.manifest.tasks.find(task => task.id === request.taskId)!.chapterOrdinal! > 1 ? 1 : 0))
    }
    row.dispatches++; row.maxInputBytes = Math.max(row.maxInputBytes, request.inputBytes); row.maxInputUtf16 = Math.max(row.maxInputUtf16, request.inputUtf16); row.maxResponseReservationBytes = Math.max(row.maxResponseReservationBytes, request.reservation.responseBytes)
  } } })
  const started = performance.now()
  const update = () => {
    const measured = observe()
    result.actualFixtureInvocations = calls; result.executionMs = Math.round(performance.now() - started); result.authority = authority()
    Object.assign(result, { cumulativeWrittenBytes: measured.cumulativeWrittenBytes, liveRecordCount: measured.liveRecordCount,
      liveSerializedMapBytes: Object.values(measured.liveBytesByRecordKind).reduce((sum, n) => sum + n, 0), committedTransactions: measured.committedTransactions,
      totalReadBytes: measured.totalReadBytes, totalReadCalls: measured.totalReadCalls, maxReadBatchBytes: measured.maxReadBatchBytes, maxReadBatchKeys: measured.maxReadBatchKeys,
      peakOutstandingBytes: measured.peakOutstandingBytes, accountingMismatches: measured.accountingMismatches })
    const timings = engine.readOperationTimings(); verify(timings.status === 'collected')
    result.operations = timings.phases.map(({ histogram: _histogram, ...row }) => row)
    const timeouts = engine.readTimeoutDiagnostics(); result.timeoutEvents = timeouts.events.length + timeouts.overflow
    if (snapshot) {
      const c = snapshot.checkpoint, s = c.storage
      Object.assign(result, { committedTasks: c.tasks.filter(task => task.status === 'committed').length, committedBodyScalars: c.bodyCharacters, reservedAttempts: c.budget.attempts,
        committedOperations: c.budget.operations, checkpointHash: c.hash, cumulativeActiveReservationMs: c.budget.activeMs,
        cumulativeWrittenBytes: decodeStorageBytes(s.writtenBytes), cumulativeAllocatedBytes: decodeStorageBytes(s.allocatedBytes), allocationConsumedBytes: decodeStorageBytes(s.allocationConsumedBytes),
        outstandingBytes: decodeStorageBytes(s.outstandingBytes), releasedBytes: decodeStorageBytes(s.releasedBytes), recoveryRemainingBytes: decodeStorageBytes(s.recoveryRemainingBytes), openAllocations: s.openAllocations.length })
    }
  }
  const progress = async () => { update(); if (onProgress) await onProgress(structuredClone(result)) }
  try {
    const manifest = await createOfflineCampaignManifest(planningManifestOptions({ campaignId: id, language, identity, profile }))
    snapshot = await engine.prepare(manifest); result.status = 'running'; await progress()
    const early = await engine.previewPlanningContext(id, result.plannedChapters)
    verify(early.status === 'refused' && early.refusalCode === 'incomplete_plan'); result.expectedPreviewRefusals++
    for (let i = 0; i < result.plannedTasks; i++) {
      if (i === 3 + result.plannedChapters) {
        verify(snapshot.checkpoint.tasks.filter(task => task.status === 'committed').length === i && snapshot.checkpoint.bodyCharacters === 0)
        verify(snapshot.checkpoint.tasks.slice(i).every(task => task.status === 'pending' && task.request === null))
        result.fullPlanFreeze = 'verified'
        const before = observe(), head = snapshot.head.checkpointHash, budget = canonicalStringify(snapshot.checkpoint.budget), beforeCalls = calls
        const selected = await engine.previewPlanningContext(id, result.plannedChapters)
        verify(selected.status === 'ready')
        if (selected.status !== 'ready') throw new Error('planning_preview_required')
        const packet = JSON.parse(selected.input)
        verify(packet.protocol === 'campaign-context-v1' && packet.purpose === 'planning_preview' && packet.previousBody === null)
        verify(selected.nextEligibleBodyTaskId === manifest.tasks[i]!.id && packet.fullPlanRoot === selected.fullPlanRoot && packet.canonBaseRoot === selected.canonBaseRoot)
        verify(packet.globalCanon && packet.scope.includedChapterOutlineCount === 1 && packet.scope.omittedChapterOutlineCount === result.plannedChapters - 1)
        verify(selected.inputBytes === new TextEncoder().encode(selected.input).length && selected.inputUtf16 === selected.input.length)
        const again = await engine.previewPlanningContext(id, result.plannedChapters)
        verify(again.status === 'ready' && again.input === selected.input && again.inputDigest === selected.inputDigest)
        const fresh = await repository.read(id)
        verify(fresh && fresh.head.checkpointHash === head && canonicalStringify(fresh.checkpoint.budget) === budget && observe().committedTransactions === before.committedTransactions && calls === beforeCalls)
        result.canonBaseRoot = selected.canonBaseRoot; result.fullPlanRoot = selected.fullPlanRoot; result.globalCanonBytes = utf8Bytes(canonicalStringify(packet.globalCanon)); result.previewReadOnly = 'verified'
      }
      const start = performance.now()
      try { snapshot = await engine.step(id, `planning-step-${i}`) }
      finally { result.maxStepMs = Math.max(result.maxStepMs, Math.round(performance.now() - start)) }
      if (snapshot.head.status === 'blocked' || snapshot.head.status === 'paused' || snapshot.head.status === 'cancelled') {
        result.refusalCode = safePlanningCode(snapshot.checkpoint.reason); result.status = result.refusalCode === 'operation_timeout' || result.refusalCode === 'local_stopped' ? 'timeout' : 'refused'; break
      }
      const task = snapshot.checkpoint.tasks[i]!, artifact = task.artifact ? snapshot.artifacts.get(task.artifact.hash) : null
      verify(artifact && task.status === 'committed')
      if (artifact) {
        const row = result.stages.find(row => row.stage === artifact.kind)!
        row.maxResponseBytes = Math.max(row.maxResponseBytes, new TextEncoder().encode(artifact.text).length)
        if (artifact.kind !== 'chapter_body') result.planningTextBytes += new TextEncoder().encode(artifact.text).length
        else { const independentScalars = [...artifact.text.replaceAll('\r\n', '\n').normalize('NFC')].length; verify(independentScalars === artifact.canonical.scalars); result.maxBodyScalars = Math.max(result.maxBodyScalars, independentScalars) }
      }
      await progress()
    }
    update()
    if (snapshot.head.status === 'completed') {
      const expectedScalars = planningFixtureBodyTarget(language, profile === 'compact-60' ? 60 : 3)
      verify(snapshot.checkpoint.bodyCharacters === expectedScalars && result.committedTasks === result.plannedTasks && calls === result.plannedTasks && result.reservedAttempts === calls)
      verify(result.committedOperations === 2 + 4 * result.plannedTasks && result.outstandingBytes === 0 && result.openAllocations === 0)
      verify(result.cumulativeWrittenBytes === observe().cumulativeWrittenBytes && result.accountingMismatches === 0 && dispatchPurposeVerified)
      verify(result.cumulativeAllocatedBytes - result.allocationConsumedBytes - result.releasedBytes === result.outstandingBytes)
      verify(result.cumulativeWrittenBytes + result.outstandingBytes + result.recoveryRemainingBytes <= 67_108_864)
      result.previewDispatchSeparation = 'verified'; result.artifactSetHash = await planningArtifactSetHash(snapshot)
      const beforeCold = observe(), cold = performance.now(), coldEngine = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(io) })
      let reopened: CampaignSnapshot | null
      try { reopened = await coldEngine.inspect(id) as CampaignSnapshot | null } finally { coldEngine.dispose() }
      result.coldRepositoryReadMs = Math.round(performance.now() - cold)
      verify(result.coldRepositoryReadMs < 3000)
      result.coldRepositoryReadBytes = observe().totalReadBytes - beforeCold.totalReadBytes; result.coldRepositoryReadCalls = observe().totalReadCalls - beforeCold.totalReadCalls
      verify(reopened && reopened.head.checkpointHash === snapshot.head.checkpointHash && await planningArtifactSetHash(reopened) === result.artifactSetHash)
      result.coldRepositoryRead = 'verified'; result.status = 'pass'
    }
  } catch (error) {
    result.refusalCode = safePlanningCode(error); result.status = result.refusalCode === 'operation_timeout' || result.refusalCode === 'local_stopped' ? 'timeout' : 'failed'
    // Establish durable terminal state after a recovery attempt, without dispatching
    // or pretending this diagnostic read makes the timed-out action a pass.
    try { snapshot = (await createCampaignRepository(io).read(id)) ?? snapshot } catch { /* Keep the last independently verified snapshot. */ }
  }
  finally { update(); engine.dispose(); await onProgress?.(structuredClone(result)) }
  return result
}
