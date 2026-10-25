/** Runner-only driver. Imported by a separate test build, never the application.
 * Capacity uses default production repository IO. Fault wrappers delegate to the
 * real blobStore transactions; they never inject a Map, clocks, or fixture state. */
import type { CampaignMutation, CampaignRepository, CampaignRepositoryIO, CampaignSnapshot } from '../../src/types/writerCampaign'
import { idbCompareAndSwapMany, idbGetMany } from '../../src/services/blobStore'
import { getCampaignBuildIdentity } from '../../src/services/writerCampaign/buildIdentity'
import { canonicalStringify, decodeStorageBytes } from '../../src/services/writerCampaign/protocol'
import { createCampaignRepository } from '../../src/services/writerCampaign/store'
import { createOfflineCampaignEngine, type OfflineCampaignEngine } from '../../src/services/writerCampaign/engine'
import { runCampaignCapacityProfile, type StorageObservation } from './writer-campaign-capacity-profile'
const verify = (condition: unknown) => { if (!condition) throw new Error('storage_boundary_failed') }
const meter = () => (globalThis as unknown as { __campaignStorageMeter: { snapshot(): StorageObservation } }).__campaignStorageMeter.snapshot()
const restartIdentity = () => (globalThis as unknown as { __campaignStorageMeter: { restartIdentity(): { checkpointHash: string } } }).__campaignStorageMeter.restartIdentity()
const probeSnapshot = () => (globalThis as unknown as { __campaignProbe: { snapshot(): { aborted: number } } }).__campaignProbe.snapshot()
const same = (left: unknown, right: unknown) => canonicalStringify(left) === canonicalStringify(right)
const phase = (value: string) => { (globalThis as unknown as { __campaignStorageStage: string }).__campaignStorageStage = value }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
function totals(snapshot: CampaignSnapshot) {
  const s = snapshot.checkpoint.storage, result = { written: decodeStorageBytes(s.writtenBytes), outstanding: decodeStorageBytes(s.outstandingBytes), released: decodeStorageBytes(s.releasedBytes) }
  verify(decodeStorageBytes(s.allocatedBytes) - decodeStorageBytes(s.allocationConsumedBytes) - result.released === result.outstanding)
  verify(s.openAllocations.reduce((sum, row) => sum + decodeStorageBytes(row.remainingBytes), 0) === result.outstanding)
  verify(result.written + result.outstanding + decodeStorageBytes(s.recoveryRemainingBytes) <= decodeStorageBytes(snapshot.manifest.storage.limitBytes))
  return result
}
function preservedObligations(before: CampaignSnapshot, after: CampaignSnapshot, kind: 'replacement' | 'cancel') {
  const prior = before.checkpoint, next = after.checkpoint
  verify(same(next.storage.openAllocations, prior.storage.openAllocations))
  for (const key of ['allocatedBytes', 'allocationConsumedBytes', 'releasedBytes', 'outstandingBytes'] as const) verify(next.storage[key] === prior.storage[key])
  // These are metadata-only operations: provider reservations stay cumulative;
  // only the operation, active-time allowance and replacement artifact may grow.
  verify(same(next.budget, { ...prior.budget, operations: prior.budget.operations + 1,
    activeMs: prior.budget.activeMs + 10_000, artifacts: prior.budget.artifacts + (kind === 'replacement' ? 1 : 0) }))
  if (kind === 'replacement') verify(next.storage.recoveryRemainingBytes === prior.storage.recoveryRemainingBytes)
}
async function read(id: string) { const snapshot = await createCampaignRepository().read(id); verify(snapshot); return snapshot! }
const entryKind = (entries: Parameters<CampaignRepositoryIO['compareAndSwapMany']>[0]) => {
  const receipt = entries.find(entry => entry.key.includes(':receipt:'))
  return receipt ? JSON.parse(receipt.value).kind : null
}
export async function runStorageBoundary(caseId: string) {
  const id = `storage-${caseId}`, identity = getCampaignBuildIdentity()
  let calls = 0, before: ((entries: Parameters<CampaignRepositoryIO['compareAndSwapMany']>[0]) => Promise<void>) | undefined
  let after: typeof before, engine: OfflineCampaignEngine | undefined
  const engines: OfflineCampaignEngine[] = []
  const io: CampaignRepositoryIO = { getMany: idbGetMany, async compareAndSwapMany(entries, canCommit) {
    await before?.(entries)
    const result = await idbCompareAndSwapMany(entries, canCommit)
    if (result) await after?.(entries)
    return result
  } }
  const repository = createCampaignRepository(io)
  const make = (repo: CampaignRepository = repository, onDispatch?: () => Promise<void>) => {
    const result = createOfflineCampaignEngine({ identity, repository: repo, fixture: { onDispatch: async () => { calls++; await onDispatch?.() } } })
    engines.push(result); return result
  }
  phase('prepare')
  try {
    if (caseId === 'S06') {
      const gate = deferred(), entered = deferred()
      engine = make(repository, async () => { if (calls === 2) { entered.resolve(); await gate.promise } })
      await engine.prepare({ campaignId: id, language: 'en' }); await engine.step(id, 'first')
      phase('exercise')
      const pending = engine.step(id, 'unknown'); await entered.promise
      const old = await read(id), oldOpen = old.checkpoint.storage.openAllocations[0]!
      verify(oldOpen && calls === 2)
      const other = make(createCampaignRepository())
      const replaced = await other.replaceCandidate(id, 'outline', 'Controlled replacement outline.', 'replacement')
      preservedObligations(old, replaced, 'replacement')
      verify(replaced.checkpoint.storage.openAllocations[0]!.request.id === oldOpen.request.id)
      verify(replaced.checkpoint.tasks[1]!.request === null)
      phase('restart')
      const restarted = await read(id); verify(restarted.head.checkpointHash === replaced.head.checkpointHash)
      verify(same(restarted.checkpoint.storage.openAllocations, old.checkpoint.storage.openAllocations))
      const writes = meter().committedTransactions
      gate.resolve(); await pending
      verify(meter().committedTransactions === writes && (await read(id)).head.checkpointHash === replaced.head.checkpointHash)
    } else if (caseId === 'S05') {
      let captured: { expected: CampaignSnapshot; mutation: CampaignMutation } | undefined
      const proxy: CampaignRepository = { ...repository, async commit(expected, mutation, canCommit) {
        if (!captured && mutation.kind === 'accept_artifact') {
          captured = { expected, mutation }; engine!.stopLocal(id); throw new Error('controlled_stop_before_accept')
        }
        return repository.commit(expected, mutation, canCommit)
      } }
      engine = make(proxy); await engine.prepare({ campaignId: id, language: 'en' })
      phase('exercise'); await engine.step(id, 'race').catch(() => null)
      verify(captured)
      const { expected, mutation } = captured!, writes = meter().committedTransactions
      const results = await Promise.allSettled([createCampaignRepository().commit(expected, mutation), createCampaignRepository().commit(expected, mutation)])
      verify(results.some(row => row.status === 'fulfilled'))
      verify(meter().committedTransactions === writes + 1)
      phase('replay')
      const replay = await createCampaignRepository().commit(expected, mutation)
      verify(replay.replayed && meter().committedTransactions === writes + 1 && totals(replay.snapshot).outstanding === 0)
    } else if (caseId === 'S07') {
      const gate = deferred(), entered = deferred(); let held = false
      before = async entries => { if (!held && entryKind(entries) === 'accept_artifact') { held = true; entered.resolve(); await gate.promise } }
      engine = make(); await engine.prepare({ campaignId: id, language: 'en' })
      phase('exercise'); const pending = engine.step(id, 'cancel-race'); await entered.promise
      const retained = await read(id), other = make(createCampaignRepository())
      const cancelled = await other.cancel(id, 'cancel')
      preservedObligations(retained, cancelled, 'cancel')
      verify(cancelled.head.status === 'cancelled')
      const writes = meter().committedTransactions
      gate.resolve(); await pending
      verify(meter().committedTransactions === writes)
      verify((await read(id)).artifacts.size === 0 && totals(await read(id)).released === 0)
    } else {
      engine = make(); await engine.prepare({ campaignId: id, language: 'en' })
      phase('exercise')
      let fired = false, abortedBefore: number | null = null
      if (caseId === 'S02') before = async entries => { if (!fired && entryKind(entries) === 'accept_artifact') { fired = true; throw new Error('controlled_before_accept') } }
      if (caseId === 'S03' || caseId === 'S04') after = async entries => {
        if (!fired && entryKind(entries) === (caseId === 'S03' ? 'reserve' : 'accept_artifact')) { fired = true; throw new Error('controlled_ack_lost') }
      }
      if (caseId === 'S08') {
        const probe = (globalThis as unknown as { __campaignProbe: { arm(rule: object): void } }).__campaignProbe
        abortedBefore = probeSnapshot().aborted
        probe.arm({ kind: 'write', operation: 'accept_artifact', abort: true })
      }
      await engine.step(id, 'original').catch(() => null)
      before = undefined; after = undefined
      phase('restart'); engine.dispose()
      const restarted = make(createCampaignRepository()), snapshot = await read(id)
      if (['S02', 'S08'].includes(caseId)) {
        if (caseId === 'S02') verify(fired)
        else verify(abortedBefore !== null && probeSnapshot().aborted === abortedBefore + 1)
        verify(snapshot.artifacts.size === 0 && await createCampaignRepository().getReceipt(id, 'original:artifact') === null)
        verify(snapshot.checkpoint.tasks[0]!.status === 'response_retained' && calls === 1 && totals(snapshot).outstanding > 0 && totals(snapshot).released === 0)
        const recovered = await restarted.recoverSaveOnly(id, 'save-only')
        verify(recovered.checkpoint.tasks[0]!.status === 'committed' && calls === 1 && totals(recovered).outstanding === 0)
        const accepted = await createCampaignRepository().getReceipt(id, 'original:artifact')
        verify(accepted?.kind === 'accept_artifact' && decodeStorageBytes(accepted.storageEffect.releasedBytes) > 0)
      } else if (caseId === 'S03') {
        verify(fired && snapshot.checkpoint.budget.attempts === 1 && calls === 0 && totals(snapshot).outstanding > 0)
        await restarted.resume(id, 'continue-reserved'); const completed = await restarted.step(id, 'continuation')
        verify(completed.checkpoint.budget.attempts === 1 && calls === 1 && totals(completed).outstanding === 0)
      } else {
        verify(caseId === 'S01' || caseId === 'S04'); if (caseId === 'S04') verify(fired)
        verify(snapshot.checkpoint.tasks[0]!.status === 'committed' && totals(snapshot).outstanding === 0 && calls === 1)
        await restarted.pause(id, 'head-advancement')
        await restarted.resume(id, 'head-resume')
        const advanced = await read(id), writes = meter().committedTransactions, released = totals(advanced).released
        const attempts = advanced.checkpoint.budget.attempts, invocations = calls
        verify(advanced.head.status === 'running' && advanced.checkpoint.tasks[1]!.status === 'pending')
        phase('replay'); await restarted.step(id, 'original')
        const replayed = await read(id)
        verify(meter().committedTransactions === writes && calls === invocations)
        verify(replayed.checkpoint.budget.attempts === attempts && totals(replayed).released === released)
        verify(replayed.head.checkpointHash === advanced.head.checkpointHash && same(replayed.checkpoint.budget, advanced.checkpoint.budget))
      }
    }
    phase('accounting')
    const snapshot = await read(id), storage = totals(snapshot), measured = meter()
    verify(storage.written === measured.cumulativeWrittenBytes && measured.accountingMismatches === 0)
    phase('complete')
    return { restartExpected: { checkpointHash: snapshot.head.checkpointHash }, report: { id: caseId, status: 'pass', failureStage: null, fixtureDispatchEntries: calls, committedTransactions: measured.committedTransactions,
      cumulativeWrittenBytes: storage.written, outstandingBytes: storage.outstanding, releasedBytes: storage.released, accountingMismatches: measured.accountingMismatches } }
  } finally { engines.forEach(value => value.dispose()) }
}
export async function runStorageCapacity(language: 'zh' | 'en') {
  const report = await runCampaignCapacityProfile(language, getCampaignBuildIdentity(), meter, undefined, async row => {
    await (globalThis as unknown as { __campaignStorageProgress(row: object): Promise<void> }).__campaignStorageProgress(row)
  })
  return { report, restartExpected: restartIdentity() }
}
/** Fresh document/process read: no saved snapshot, cache, fixture or IO injection. */
export async function inspectAfterBrowserRestart(campaignId: string, expected: { cumulativeWrittenBytes: number; outstandingBytes: number; releasedBytes: number }, restartExpected: { checkpointHash: string }) {
  const started = performance.now(), snapshot = await read(campaignId), value = totals(snapshot)
  verify(/^[a-f0-9]{64}$/.test(restartExpected.checkpointHash) && snapshot.head.checkpointHash === restartExpected.checkpointHash && snapshot.checkpoint.hash === restartExpected.checkpointHash)
  verify(value.written === expected.cumulativeWrittenBytes && value.outstanding === expected.outstandingBytes && value.released === expected.releasedBytes)
  verify(meter().committedTransactions === 0)
  return { coldProcessReadMs: Math.round(performance.now() - started), coldProcessReadBytes: meter().totalReadBytes, coldProcessReadCalls: meter().totalReadCalls }
}
