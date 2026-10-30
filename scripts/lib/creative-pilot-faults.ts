/** Exact durable-operation ACK cuts on copies of actual SDK-created historical rows. */
import type { CreateCreativeCommand, CreativeCommitGuard, CreativeCommitResult, CreativeMutation, CreativeRepository, CreativeSnapshot, ReplaceCreativeBriefCommand } from '../../src/types/creativePilot'
import { createCreativePilotRepository } from '../../src/services/writerCampaign/creativePilotStore'
import { creativePilotBriefs } from './creative-pilot-briefs'
import { runCreativeFaultSeed, runCreativeSeedSequence, preserveCreativePrivateRows } from './creative-pilot-engine-controls'
import { createCreativeMemoryIO, type CreativeFaultCut } from './creative-pilot-io'
import { controlAssert, rowMapOracle, storageCounterOracle } from './creative-pilot-oracles'
import { safeCreativeCode, type CreativeControlRow } from './creative-pilot-report'
import { CREATIVE_DURABLE_VARIANTS } from './creative-pilot-registry'
import type { CreativeCapturedPrefix } from './creative-pilot-runner'
export type CreativeFaultSeed = Awaited<ReturnType<typeof runCreativeFaultSeed>>
const liveGuard: CreativeCommitGuard = { canCommit: () => true, canPublish: () => true }
const findPrefix = (seed: CreativeFaultSeed, kind: string, phase?: string) => { const value = seed.prefixes.find(p => p.kind === kind && (!phase || p.phase === phase)); controlAssert(value); return value }
function latestClock(rows: ReadonlyMap<string, string>) { return Math.max(...[...rows.values()].map(raw => JSON.parse(raw)).filter(r => r.protocolVersion === 'creative-pilot-checkpoint-v4').map(r => r.lastWallTime)) }
export function fillCreativeControlSnapshot(row: CreativeControlRow, snapshot: CreativeSnapshot | null) {
  row.observation = 'last_verified'; row.receiptHash = snapshot?.receipt.hash ?? null
  row.obligations = snapshot ? snapshot.checkpoint.requests.map(index => {
    const phase = snapshot.phases.get(index.phaseHash)!, request = snapshot.requests.get(index.requestHash)!
    return { requestHash: request.hash, phaseHash: phase.hash, status: phase.status, responseHash: phase.responseHash, outcome: phase.resolution?.outcome ?? null, resolutionReason: phase.resolution?.reason ?? null, unknownReason: phase.reason, outstandingBytes: storageCounterOracle(snapshot.checkpoint.storage.openAllocations.find(a => a.request.id === request.id)?.remainingBytes ?? '0000000000000000') }
  }) : []
  const last = row.obligations.at(-1); row.resolutionReason = last?.resolutionReason ?? null; row.unknownReason = last?.unknownReason ?? null
}
export async function createCreativeDurabilitySeeds(row: CreativeControlRow, runSeed: typeof runCreativeFaultSeed = runCreativeFaultSeed) {
  const brief = creativePilotBriefs()[0]!.brief
  const [good, bad] = await runCreativeSeedSequence(row, [() => runSeed('ack-good', brief, 'normal', true), () => runSeed('ack-refused', brief, 'finish_length')], 'setup')
  controlAssert(good && bad)
  controlAssert(good.http.attempts === 1 && bad.http.attempts === 1 && good.snapshot.checkpoint.tasks[0]!.status === 'accepted' && bad.snapshot.checkpoint.tasks[0]!.status === 'refused')
  return { good, bad }
}
export async function runCreativeDurabilityControls(rows: CreativeControlRow[], seeds?: { good: CreativeFaultSeed; bad: CreativeFaultSeed }, onCase?: (row: CreativeControlRow) => void, runSeed: typeof runCreativeFaultSeed = runCreativeFaultSeed) {
  const ownSeeds = !seeds, setupRow = rows.find(row => row.id === 'B:D01')!
  if (ownSeeds) {
    setupRow.status = 'running'; setupRow.activeCheck = setupRow.id
    try { seeds = await createCreativeDurabilitySeeds(setupRow, runSeed) }
    catch (error) { setupRow.status = 'failed'; setupRow.errorCode = safeCreativeCode(error); setupRow.observation = 'unconfirmed'; onCase?.(setupRow); throw error }
  }
  controlAssert(seeds)
  const firstRequest = [...seeds.good.snapshot.requests.values()][0]!, goodResponse = [...seeds.good.snapshot.responses.values()][0]!
  const goodIntent = [...seeds.good.snapshot.phases.values()].find(p => p.status === 'dispatch_intent')!
  const badRequest = [...seeds.bad.snapshot.requests.values()][0]!
  const created = findPrefix(seeds.good, 'create'), reserved = findPrefix(seeds.good, 'reserve'), intent = findPrefix(seeds.good, 'dispatch_intent'), retained = findPrefix(seeds.good, 'retain_response'), badRetained = findPrefix(seeds.bad, 'retain_response')
  const unknownMemory = createCreativeMemoryIO(intent.rows), unknownRepo = createCreativePilotRepository({ io: unknownMemory.io, clock: () => latestClock(intent.rows) })
  try {
    const beforeUnknown = await unknownRepo.read(firstRequest.campaignId); controlAssert(beforeUnknown)
    const unknownResult = await unknownRepo.commit(beforeUnknown, { kind: 'outcome_unknown', operationId: firstRequest.operationId + ':unknown', recovery: false, requestHash: firstRequest.hash, reason: 'interrupted' }, liveGuard)
    fillCreativeControlSnapshot(setupRow, unknownResult.snapshot); setupRow.snapshotHash = await rowMapOracle(unknownMemory.rows)
    controlAssert(unknownMemory.observe().accountingMismatches === 0)
  }
  catch (error) {
    setupRow.status = 'failed'; setupRow.errorCode = safeCreativeCode(error); setupRow.observation = 'unconfirmed'
    try { fillCreativeControlSnapshot(setupRow, await unknownRepo.read(firstRequest.campaignId)) } catch { setupRow.observation = 'unconfirmed' }
    try { await preserveCreativePrivateRows('durability-unknown-setup', unknownMemory.rows) } catch { /* Preserve independent setup counts even if private IO is unavailable. */ }; onCase?.(setupRow); throw error
  } finally { setupRow.setupSuccessfulCas += unknownMemory.observe().successfulCas }
  const setupObligations = setupRow.obligations.filter(item => item.status !== 'resolved')
  const unknown: CreativeCapturedPrefix = { kind: 'outcome_unknown', sequence: 3, taskId: 'outline', phase: 'outcome_unknown', rows: new Map(unknownMemory.rows) }
  for (let index = 0; index < CREATIVE_DURABLE_VARIANTS.length; index++) {
    const variant = CREATIVE_DURABLE_VARIANTS[index]!
    let prefix = created, operation: CreativeMutation | null = null, replacement: ReplaceCreativeBriefCommand | null = null, creation: CreateCreativeCommand | null = null
    const recovery = variant.startsWith('recovery_'), request = variant.includes('refused') ? badRequest : firstRequest
    let expectedPhase: string | null = null, expectedOutcome: string | null = null, expectedReason: string | null = null
    if (variant === 'create') creation = { campaignId: firstRequest.campaignId, operationId: 'prepare-control', brief: seeds.good.snapshot.candidate.brief, identity: { runtimeIdentity: seeds.good.snapshot.manifest.runtimeIdentity, source: seeds.good.snapshot.manifest.source } }
    else if (variant === 'replace_brief') replacement = { operationId: 'ack-replace', brief: { ...seeds.good.snapshot.candidate.brief, premise: seeds.good.snapshot.candidate.brief.premise + ' 不改变授权次数。' } }
    else if (variant === 'reserve') { operation = { kind: 'reserve', operationId: request.operationId + ':reserve', recovery: false, request }; expectedPhase = 'reserved' }
    else if (variant === 'dispatch_intent') { prefix = reserved; operation = { kind: 'dispatch_intent', operationId: request.operationId + ':intent', recovery: false, requestHash: request.hash, dispatchWire: goodIntent.dispatchWire! }; expectedPhase = 'dispatch_intent' }
    else if (variant.endsWith('unknown') && !variant.startsWith('cancel')) { prefix = intent; operation = { kind: 'outcome_unknown', operationId: request.operationId + ':unknown', recovery, requestHash: request.hash, reason: 'interrupted' }; expectedPhase = 'outcome_unknown' }
    else if (variant === 'retain_response' || variant === 'recovery_retain') { prefix = recovery ? unknown : intent; operation = { kind: 'retain_response', operationId: request.operationId + ':retain', recovery, requestHash: request.hash, response: goodResponse }; expectedPhase = 'response_retained' }
    else if (variant.startsWith('cancel')) {
      prefix = ({ cancel_idle: created, cancel_reserved: reserved, cancel_intent: intent, cancel_unknown: unknown, cancel_retained: retained } as Record<string, CreativeCapturedPrefix>)[variant]!
      operation = { kind: 'cancel', operationId: 'ack-cancel', recovery: false }
      if (variant === 'cancel_reserved') { expectedPhase = 'resolved'; expectedOutcome = 'not_dispatched'; expectedReason = 'cancelled' }
      else if (variant === 'cancel_intent' || variant === 'cancel_unknown') expectedPhase = 'outcome_unknown'
      else if (variant === 'cancel_retained') expectedPhase = 'response_retained'
    } else {
      prefix = variant.includes('not_dispatched') ? reserved : variant.includes('refused') ? badRetained : retained
      const accounting = variant.includes('not_dispatched') || variant.includes('authority_revoked')
      operation = { kind: 'resolve', operationId: recovery ? 'author-recovery-ack-' + index : request.operationId + ':resolve', recovery, requestHash: request.hash, disposition: accounting ? 'accounting_only' : 'publish_if_valid' }
      expectedPhase = 'resolved'; expectedOutcome = variant.includes('not_dispatched') ? 'not_dispatched' : variant.includes('authority_revoked') ? 'authority_revoked' : variant.includes('refused') ? 'refused' : 'accepted'
      expectedReason = expectedOutcome === 'not_dispatched' ? recovery ? 'stage_expired_before_intent' : 'closed_before_intent' : expectedOutcome === 'authority_revoked' ? 'authority_revoked' : expectedOutcome === 'refused' ? 'finish_incomplete' : null
    }
    const starting = creation ? new Map<string, string>() : prefix.rows
    const now = creation ? seeds.good.snapshot.manifest.createdAt : recovery ? Math.max(latestClock(starting), request.expiresAt + 1) : Math.max(latestClock(starting), variant === 'reserve' ? request.createdAt : 0)
    for (const [boundary, cut] of [['B', 'before_cas'], ['A', 'after_commit'], ['L', 'late_ack']] as const) {
      const row = rows.find(r => r.id === `${boundary}:D${String(index + 1).padStart(2, '0')}`)!
      row.status = 'running'; row.activeCheck = row.id
      const memory = createCreativeMemoryIO(starting), repo = createCreativePilotRepository({ io: memory.io, clock: () => now }), campaignId = request.campaignId
      let owns = true
      const guard = { canCommit: () => owns, canPublish: () => owns }, initial = await repo.read(campaignId), beforeHash = await rowMapOracle(memory.rows)
      const operationId = creation?.operationId ?? replacement?.operationId ?? operation!.operationId
      const invoke = (repository: CreativeRepository, active: CreativeCommitGuard): Promise<CreativeCommitResult> => creation ? repository.create(creation, active) : replacement ? repository.replaceBrief(initial!, replacement, active) : repository.commit(initial!, operation!, active)
      try {
        memory.arm(creation ? 'create' : replacement ? 'replace_brief' : operation!.kind, cut as CreativeFaultCut)
        const pending = invoke(repo, guard).then(value => ({ value, error: null }), error => ({ value: null, error }))
        if (cut === 'late_ack') {
          const until = performance.now() + 2500
          while ((!memory.entered() || memory.observe().successfulCas !== 1) && performance.now() < until) await new Promise(resolve => setTimeout(resolve, 1))
          controlAssert(memory.entered() && memory.observe().successfulCas === 1); owns = false; memory.release()
        }
        const result = await pending
        controlAssert(result.value === null && result.error !== null && memory.entered()); row.assertions++
        const fresh = createCreativePilotRepository({ io: memory.io, clock: () => now }), snapshot = await fresh.read(campaignId), receipt = await fresh.getReceipt(campaignId, operationId)
        row.successfulCas = memory.observe().successfulCas; row.snapshotHash = await rowMapOracle(memory.rows); fillCreativeControlSnapshot(row, snapshot)
        if (row === setupRow) row.obligations = [...setupObligations.filter(prior => !row.obligations.some(item => item.requestHash === prior.requestHash)), ...row.obligations]
        controlAssert(row.successfulCas === (boundary === 'B' ? 0 : 1) && memory.observe().accountingMismatches === 0); row.assertions++
        if (boundary === 'B') { controlAssert(receipt === null && row.snapshotHash === beforeHash); row.assertions++ }
        else {
          controlAssert(snapshot && receipt && receipt.operationId === operationId && receipt.hash === snapshot.receipt.hash); row.assertions++
          const casBefore = memory.observe().successfulCas, hashBefore = row.snapshotHash
          const replay = await invoke(fresh, liveGuard)
          controlAssert(replay.replayed && replay.receipt.hash === receipt.hash && memory.observe().successfulCas === casBefore && await rowMapOracle(memory.rows) === hashBefore); row.assertions++
          if (expectedPhase) { const phase = snapshot.phases.get(snapshot.checkpoint.requests.at(-1)!.phaseHash)!; controlAssert(phase.status === expectedPhase && (expectedOutcome === null || phase.resolution?.outcome === expectedOutcome && phase.resolution.reason === expectedReason)); row.assertions++ }
          if (variant.startsWith('cancel')) { controlAssert(snapshot.checkpoint.status === 'cancelled'); row.assertions++ }
          if (expectedOutcome === 'authority_revoked') { controlAssert(snapshot.artifacts.size === 0 && storageCounterOracle(snapshot.checkpoint.storage.outstandingBytes) === 0); row.assertions++ }
          if (expectedPhase === 'outcome_unknown') { controlAssert(storageCounterOracle(snapshot.checkpoint.storage.outstandingBytes) > 0); row.assertions++ }
        }
        row.status = 'pass'; onCase?.(row)
      } catch (error) {
        memory.release(); row.successfulCas = memory.observe().successfulCas; row.status = 'failed'; row.errorCode = safeCreativeCode(error); row.observation = 'unconfirmed'
        try { fillCreativeControlSnapshot(row, await createCreativePilotRepository({ io: memory.io, clock: () => now }).read(campaignId)); row.snapshotHash = await rowMapOracle(memory.rows) } catch { row.observation = 'unconfirmed' }
        if (row === setupRow) row.obligations = [...setupObligations.filter(prior => !row.obligations.some(item => item.requestHash === prior.requestHash)), ...row.obligations]
        try { await preserveCreativePrivateRows(row.id + '-durability', memory.rows) } catch { /* Counts and obligations already survive. */ }; onCase?.(row); throw error
      }
    }
  }
  return { setupHttpAttempts: ownSeeds ? seeds.good.http.attempts + seeds.bad.http.attempts : 0, setupUnknownCas: 1, exerciseHttpAttempts: 0, recoveryHttpAttempts: 0 }
}
