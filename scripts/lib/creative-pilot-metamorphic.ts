/** Dynamic actual-wire interventions; fresh campaigns, never injected successful artifacts. */
import type { CreativeControlRow } from './creative-pilot-report'
import { safeCreativeCode } from './creative-pilot-report'
import { createCreativeEngineControl, runCreativeFaultSeed, collectCreativeFaultFailure, runCreativeSeedSequence } from './creative-pilot-engine-controls'
import { fillCreativeControlSnapshot, type CreativeFaultSeed } from './creative-pilot-faults'
import { canonicalOracle, controlAssert, hashOracle, rowMapOracle } from './creative-pilot-oracles'
import { runCreativeContextCapacityControl } from './creative-pilot-compiler-controls'
export async function runCreativeMetamorphicControls(rows: CreativeControlRow[], baseline: CreativeFaultSeed, runSeed: typeof runCreativeFaultSeed = runCreativeFaultSeed) {
  const brief = baseline.snapshot.candidate.brief
  const verify = (row: CreativeControlRow, value: unknown) => { controlAssert(value); row.assertions++ }
  async function scenario(id: string, run: (row: CreativeControlRow) => Promise<void>) { const row = rows.find(r => r.id === id)!; row.status = 'running'; row.activeCheck = id; try { await run(row); row.status = 'pass' } catch (error) { collectCreativeFaultFailure(row, error); row.status = 'failed'; row.errorCode = safeCreativeCode(error); row.observation = 'unconfirmed'; throw error } }
  async function record(row: CreativeControlRow, seed: CreativeFaultSeed) { row.exerciseHttpAttempts += seed.http.attempts; row.successfulCas += seed.io.successfulCas; row.snapshotHash = await rowMapOracle(seed.rows); fillCreativeControlSnapshot(row, seed.snapshot); verify(row, seed.http.errors === 0 && seed.http.blockedExternalRequests === 0 && seed.io.accountingMismatches === 0) }
  for (const [id, variant] of [['M01', { ...brief, premise: brief.premise + ' 新的精确前提。' }], ['M02', { ...brief, constraints: [brief.constraints[0] + '  保留此标点！ ', ...brief.constraints.slice(1)] }]] as Array<[string, typeof brief]>) await scenario(id, async row => {
    const [original, changed] = await runCreativeSeedSequence(row, [() => runSeed(id.toLowerCase() + '-before', brief, 'normal', true), () => runSeed(id.toLowerCase() + '-after', variant, 'normal', true)])
    controlAssert(original && changed)
    for (const seed of [original, changed]) verify(row, seed.http.errors === 0 && seed.http.blockedExternalRequests === 0 && seed.io.accountingMismatches === 0)
    verify(row, row.exerciseHttpAttempts === 2 && original.http.records[0]!.briefDigest === await hashOracle(canonicalOracle(brief)) && changed.http.records[0]!.briefDigest === await hashOracle(canonicalOracle(variant)) && original.http.records[0]!.briefDigest !== changed.http.records[0]!.briefDigest)
    const a = [...original.snapshot.requests.values()][0]!, b = [...changed.snapshot.requests.values()][0]!
    verify(row, a.prepared.inputDigest !== b.prepared.inputDigest && canonicalOracle(a.prepared.brief) === canonicalOracle(brief) && canonicalOracle(b.prepared.brief) === canonicalOracle(variant))
    verify(row, id === 'M01' ? canonicalOracle(brief.constraints) === canonicalOracle(variant.constraints) : brief.premise === variant.premise)
  })
  await scenario('M03', async row => {
    const env = await createCreativeEngineControl('m03-replacement')
    try {
      const draft = await env.engine.prepare({ campaignId: env.campaignId, operationId: 'draft', brief }), old = await env.engine.dryPrepare(env.campaignId)
      const changed = { ...brief, premise: brief.premise + ' 新的持久前提。' }, revised = await env.engine.replaceBrief({ campaignId: env.campaignId, operationId: 'replace', expectedRawHead: draft.rawHead, expectedCandidateHash: draft.candidate.hash, brief: changed })
      const { createCreativePilotRepository } = await import('../../src/services/writerCampaign/creativePilotStore')
      const cold = await createCreativePilotRepository({ io: env.memory.io }).read(env.campaignId); controlAssert(cold)
      verify(row, cold.candidate.hash === revised.candidate.hash && cold.checkpoint.budget.attempts === 0 && cold.checkpoint.budget.activeMs === 20000 && canonicalOracle(cold.candidate.brief) === canonicalOracle(changed))
      let refused = false; try { await env.engine.start({ campaignId: env.campaignId, operationId: 'old-handle', expectedRawHead: old.rawHead, expectedCandidateHash: old.candidateHash }) } catch (error) { refused = ['conflict', 'source_changed'].includes(safeCreativeCode(error)) }
      verify(row, refused && env.server.observe().attempts === 0)
      env.engine.subscribeProgress(event => { if (event.kind === 'accepted' && event.taskId === 'outline') env.engine.stop(env.campaignId) })
      try { await env.engine.start({ campaignId: env.campaignId, operationId: 'fresh-grant', expectedRawHead: cold.rawHead, expectedCandidateHash: cold.candidate.hash }) } catch (error) { controlAssert(['cancelled', 'authority_revoked'].includes(safeCreativeCode(error))) }
      const after = await env.repository.read(env.campaignId); controlAssert(after)
      row.exerciseHttpAttempts = env.server.observe().attempts; row.successfulCas = env.memory.observe().successfulCas; row.snapshotHash = await rowMapOracle(env.memory.rows); fillCreativeControlSnapshot(row, after)
      verify(row, row.exerciseHttpAttempts === 1 && env.server.observe().records[0]!.briefDigest === await hashOracle(canonicalOracle(changed)) && after.checkpoint.budget.attempts === 1 && after.checkpoint.budget.activeMs === 80000 && env.memory.observe().accountingMismatches === 0)
    } finally { row.exerciseHttpAttempts = env.server.observe().attempts; row.successfulCas = env.memory.observe().successfulCas; await env.close() }
  })
  await scenario('M04', async row => {
    const changed = await runCreativeFaultSeed('m04-parent', brief, 'change_outline', 'characters'); await record(row, changed)
    const a = [...baseline.snapshot.requests.values()].find(r => r.taskId === 'characters')!, b = [...changed.snapshot.requests.values()].find(r => r.taskId === 'characters')!
    const originalText = a.prepared.earlyPlanning.outline!.endingIntent, changedText = b.prepared.earlyPlanning.outline!.endingIntent
    verify(row, row.exerciseHttpAttempts === 2 && changedText === originalText + (brief.language === 'zh' ? ' 另一个明确结局。' : ' A distinct explicit ending.'))
    verify(row, baseline.http.records.find(r => r.taskId === 'characters')!.outlineEndingDigest === await hashOracle(originalText) && changed.http.records.find(r => r.taskId === 'characters')!.outlineEndingDigest === await hashOracle(changedText))
    verify(row, canonicalOracle(a.prepared.brief) === canonicalOracle(b.prepared.brief) && changed.snapshot.checkpoint.tasks[0]!.status === 'accepted' && changed.snapshot.checkpoint.tasks[1]!.status === 'accepted')
  })
  await scenario('M05', async row => {
    const changed = await runCreativeFaultSeed('m05-body-parent', brief, 'change_body_one'); await record(row, changed)
    const a = [...baseline.snapshot.requests.values()].find(r => r.taskId === 'b-3')!, b = [...changed.snapshot.requests.values()].find(r => r.taskId === 'b-3')!
    verify(row, row.exerciseHttpAttempts === 9 && b.prepared.previousBodies.length === 2 && a.prepared.previousBodies.length === 2 && changed.snapshot.checkpoint.status === 'completed')
    verify(row, !a.prepared.previousBodies[0]!.text.includes('ALTERED-ORIGINAL-BODY-ONE.') && b.prepared.previousBodies[0]!.text.includes('ALTERED-ORIGINAL-BODY-ONE.'))
    // Compare the intervention itself, not identity-dependent plan hashes embedded in the synthetic body recipe.
    const observed = changed.http.records.find(r => r.taskId === 'b-3')!
    verify(row, canonicalOracle(observed.previousBodyDigests) === canonicalOracle(await Promise.all(b.prepared.previousBodies.map(p => hashOracle(p.text)))))
    for (const [index, taskId] of ['b-1', 'b-2'].entries()) verify(row, b.prepared.previousBodies[index]!.text === [...changed.snapshot.artifacts.values()].find(a => a.taskId === taskId)!.text)
  })
  await runCreativeContextCapacityControl(rows.find(row => row.id === 'M06')!)
  controlAssert(rows.reduce((total, row) => total + row.exerciseHttpAttempts, 0) === 16)
}
