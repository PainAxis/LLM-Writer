/** Native/Node faults share production operations, not fixture state shortcuts. */
import type { CampaignRepository, CampaignRepositoryIO, CampaignSnapshot } from '../../src/types/writerCampaign'
import { createCampaignRepository } from '../../src/services/writerCampaign/store'
import { createOfflineCampaignEngine, createOfflineCampaignManifest, type CampaignRuntimeIdentity, type OfflineCampaignEngine } from '../../src/services/writerCampaign/engine'
import { planningManifestOptions } from '../../src/services/writerCampaign/planningProfile'
import { canonicalStringify, decodeStorageBytes } from '../../src/services/writerCampaign/protocol'
import { emptyPlanningAuthority, type PlanningAuthority, type PlanningBoundaryMeasurement } from './writer-campaign-planning-report'
import type { StorageObservation } from './writer-campaign-capacity-profile'
const verify = (condition: unknown) => { if (!condition) throw new Error('planning_boundary_failed') }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
const kind = (entries: Parameters<CampaignRepositoryIO['compareAndSwapMany']>[0]) => {
  const receipt = entries.find(entry => entry.key.includes(':receipt:')); return receipt ? JSON.parse(receipt.value).kind : null
}
export const planningBoundaryId = (id: PlanningBoundaryMeasurement['id'], language: 'zh' | 'en') => `planning-boundary-${id}-${language}`
export async function runPlanningBoundary(id: PlanningBoundaryMeasurement['id'], language: 'zh' | 'en', identity: CampaignRuntimeIdentity,
  observe: () => StorageObservation, authority: () => PlanningAuthority, baseIO: CampaignRepositoryIO): Promise<PlanningBoundaryMeasurement> {
  const campaignId = planningBoundaryId(id, language)
  const result: PlanningBoundaryMeasurement = { id, language, status: 'not_run', dispatches: 0, committedTransactions: 0, checkpointHash: null, coldProcessRestart: 'not_run', accountingMismatches: 0, authority: emptyPlanningAuthority() }
  const engines: OfflineCampaignEngine[] = []
  let before: ((entries: Parameters<CampaignRepositoryIO['compareAndSwapMany']>[0]) => Promise<void>) | undefined, after: typeof before
  const io: CampaignRepositoryIO = { getMany: keys => baseIO.getMany(keys), async compareAndSwapMany(entries, canCommit) {
    await before?.(entries); const ok = await baseIO.compareAndSwapMany(entries, canCommit); if (ok) await after?.(entries); return ok
  } }
  const repository = createCampaignRepository(io), independent = () => createCampaignRepository(baseIO)
  const make = (repo: CampaignRepository = repository) => {
    const engine = createOfflineCampaignEngine({ identity, repository: repo, fixture: { onDispatch() { result.dispatches++ } } }); engines.push(engine); return engine
  }
  const read = async () => { const snapshot = await independent().read(campaignId); verify(snapshot); return snapshot! }
  let engine = make()
  try {
    const manifest = await createOfflineCampaignManifest(planningManifestOptions({ campaignId, language, identity }))
    await engine.prepare(manifest)
    if (id === 'replacement') {
      let snapshot!: CampaignSnapshot
      for (let i = 0; i < 6; i++) snapshot = await engine.step(campaignId, `plan-${i}`)
      const initial = await engine.previewPlanningContext(campaignId, 3); verify(initial.status === 'ready')
      if (initial.status !== 'ready') throw new Error('planning_boundary_failed')
      const target = snapshot.manifest.tasks.find(task => task.kind === 'chapter_outline' && task.chapterOrdinal === 1)!
      const state = snapshot.checkpoint.tasks.find(task => task.taskId === target.id)!, artifact = snapshot.artifacts.get(state.artifact!.hash)!
      const replacement = JSON.parse(artifact.text); replacement.payload.scenes[0].summary += language === 'zh' ? ' 复核。' : ' Rechecked.'
      const text = canonicalStringify(replacement), oldRoot = initial.fullPlanRoot, other = make(independent())
      let reads = 0
      const proxy: CampaignRepository = { ...repository, async read(...args) {
        reads++
        if (reads === 2) await other.replaceCandidate(campaignId, target.id, text, 'source-change')
        return repository.read(...args)
      } }
      engine = make(proxy)
      const beforeCalls = result.dispatches, preview = await engine.previewPlanningContext(campaignId, 3)
      verify(preview.status === 'refused' && preview.refusalCode === 'source_changed' && result.dispatches === beforeCalls)
      const afterPreview = await engine.previewPlanningContext(campaignId, 3)
      verify(afterPreview.status === 'ready' && afterPreview.fullPlanRoot !== oldRoot && afterPreview.canonBaseRoot === initial.canonBaseRoot)
      const replaced = await read()
      verify(replaced.checkpoint.tasks.filter(task => snapshot.manifest.tasks.find(spec => spec.id === task.taskId)!.kind === 'chapter_body').every(task => task.status === 'invalidated' && task.artifact === null && task.request === null))
      verify(replaced.checkpoint.budget.attempts === snapshot.checkpoint.budget.attempts && replaced.checkpoint.storage.outstandingBytes === snapshot.checkpoint.storage.outstandingBytes)
    } else if (id === 'cancel_accept') {
      const gate = deferred(), entered = deferred(); let held = false
      before = async entries => { if (!held && kind(entries) === 'accept_artifact') { held = true; entered.resolve(); await gate.promise } }
      const pending = engine.step(campaignId, 'cancel-race'); await entered.promise
      const retained = await read(), other = make(independent()), cancelled = await other.cancel(campaignId, 'cancel')
      verify(retained.checkpoint.tasks[0]!.status === 'response_retained' && cancelled.head.status === 'cancelled')
      const writes = observe().committedTransactions; gate.resolve(); await pending.catch(() => null)
      const afterCancel = await read()
      verify(observe().committedTransactions === writes && afterCancel.artifacts.size === 0 && result.dispatches === 1)
      verify(afterCancel.checkpoint.storage.outstandingBytes === retained.checkpoint.storage.outstandingBytes && decodeStorageBytes(afterCancel.checkpoint.storage.releasedBytes) === 0)
      const preview = await other.previewPlanningContext(campaignId, 1); verify(preview.status === 'refused' && preview.refusalCode === 'planning_cancelled')
    } else {
      let fired = false
      after = async entries => { if (!fired && kind(entries) === 'accept_artifact') { fired = true; throw new Error('controlled_accept_ack_loss') } }
      await engine.step(campaignId, 'ack-loss').catch(() => null); after = undefined; engine.dispose()
      const stored = await read(); verify(fired && stored.checkpoint.tasks[0]!.status === 'committed' && result.dispatches === 1 && decodeStorageBytes(stored.checkpoint.storage.outstandingBytes) === 0)
      engine = make(independent()); const writes = observe().committedTransactions, budget = canonicalStringify(stored.checkpoint.budget)
      await engine.step(campaignId, 'ack-loss')
      verify(observe().committedTransactions === writes && result.dispatches === 1 && canonicalStringify((await read()).checkpoint.budget) === budget)
    }
    const snapshot = await read(), measured = observe()
    verify(measured.accountingMismatches === 0 && measured.cumulativeWrittenBytes === decodeStorageBytes(snapshot.checkpoint.storage.writtenBytes))
    result.checkpointHash = snapshot.head.checkpointHash; result.status = 'pass'
  } finally {
    engines.forEach(engine => engine.dispose()); result.committedTransactions = observe().committedTransactions; result.accountingMismatches = observe().accountingMismatches; result.authority = authority()
  }
  return result
}
