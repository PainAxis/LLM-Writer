import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
/** Explicit actual-SDK test environment. No successful fixture adapter or accepted-artifact injection. */
import type { CreativePilotEngine, CreativeRepository, CreativeSnapshot } from '../../src/types/creativePilot'
import type { ControlBrief } from './creative-pilot-briefs'
import { createCreativeMemoryIO } from './creative-pilot-io'
import { createCreativeControlServer, installCreativeNodeStorage } from './creative-pilot-node-server'
import { creativeControlConfiguration, creativeControlIdentity, type CreativeControlMode } from './creative-pilot-control'
import { controlAssert, rowMapOracle } from './creative-pilot-oracles'
import type { CreativeCapturedPrefix } from './creative-pilot-runner'
import { safeCreativeCode, type CreativeControlRow } from './creative-pilot-report'

export async function createCreativeEngineControl(id: string, mode: CreativeControlMode = 'normal') {
  const storage = installCreativeNodeStorage(), server = await createCreativeControlServer({ maxAttempts: 9 }); server.setMode(mode)
  const prefixes: CreativeCapturedPrefix[] = []
  const memory = createCreativeMemoryIO(new Map(), (entries, rows) => {
    const records = entries.map(e => JSON.parse(e.value)), receipt = records.find(v => v.protocolVersion === 'creative-pilot-receipt-v4'), phase = records.find(v => v.protocol === 'creative-pilot-phase-v1'), cp = records.find(v => v.protocolVersion === 'creative-pilot-checkpoint-v4')
    controlAssert(prefixes.length < 48)
    prefixes.push({ kind: receipt.kind, sequence: receipt.sequence, taskId: cp.tasks.find((t: any) => t.requestHash === phase?.requestHash)?.taskId ?? null, phase: phase?.status ?? null, rows: new Map(rows) })
  })
  let engine: CreativePilotEngine | null = null, repository: CreativeRepository | null = null, revision = 'creative-control-v1'
  try {
    const { createCreativePilotRepository } = await import('../../src/services/writerCampaign/creativePilotStore')
    const { createCreativeOfflineSdkHost } = await import('../../src/services/writerCampaign/creativePilotTransport')
    const { createCreativePilotEngine } = await import('../../src/services/writerCampaign/creativePilotEngine')
    repository = createCreativePilotRepository({ io: memory.io })
    const config = creativeControlConfiguration(server.endpoint), identity = creativeControlIdentity(server.endpoint, revision)
    const host = createCreativeOfflineSdkHost({ identity, currentConfigurationRevision: () => revision, readConfiguration: () => structuredClone(config) })
    engine = createCreativePilotEngine({ repository, host, identity: { runtimeIdentity: 'creative-control', source: { commit: null, tree: null } } })
    const campaignId = `creative-control-${id}`
    return { campaignId, engine, repository, memory, prefixes, server, revoke() { revision += '-revoked' }, async close() { engine!.dispose(); server.release(); await server.close(); storage.dispose() } }
  } catch (error) { engine?.dispose(); await server.close(); storage.dispose(); throw error }
}
export async function runCreativeFaultSeed(id: string, brief: ControlBrief, mode: CreativeControlMode, stopAfterFirst: boolean | 'characters' = false, afterSnapshot?: (snapshot: CreativeSnapshot) => void) {
  const env = await createCreativeEngineControl(id, mode)
  let snapshot: CreativeSnapshot | null = null, errorCode: string | null = null
  try {
    const prepared = await env.engine.prepare({ campaignId: env.campaignId, operationId: 'prepare-control', brief })
    if (stopAfterFirst) env.engine.subscribeProgress(event => { if (event.kind === 'accepted' && event.taskId === (stopAfterFirst === 'characters' ? 'characters' : 'outline')) env.engine.stop(env.campaignId) })
    try { await env.engine.start({ campaignId: env.campaignId, operationId: 'start-control', expectedRawHead: prepared.rawHead, expectedCandidateHash: prepared.candidate.hash }) } catch (error) { errorCode = safeCreativeCode(error) }
    snapshot = await env.repository.read(env.campaignId)
    controlAssert(snapshot)
    if (snapshot.checkpoint.tasks.some(t => t.status === 'outcome_unknown' || t.status === 'dispatch_intent')) {
      const before = env.server.observe().attempts
      try { await env.engine.resume({ campaignId: env.campaignId, operationId: 'resume-unknown-control', expectedRawHead: snapshot.rawHead, expectedCandidateHash: snapshot.candidate.hash }) } catch { /* The subsequent independent count and durable phase are the oracle. */ }
      controlAssert(env.server.observe().attempts === before)
      snapshot = await env.repository.read(env.campaignId); controlAssert(snapshot)
    }
    afterSnapshot?.(snapshot)
    return { snapshot, prefixes: env.prefixes, rows: new Map(env.memory.rows), http: env.server.observe(), errorCode, io: env.memory.observe() }
  } catch (error) {
    env.engine.stop(env.campaignId)
    try { snapshot = await env.repository.read(env.campaignId) } catch { /* Preserve the private exact raw map and last verified snapshot. */ }
    const failure = error instanceof Error ? error : new Error('creative_control_failure')
    // Attach actual observations before a fallible private write; capture failure cannot erase them.
    Object.defineProperty(failure, 'creativeControlEvidence', { value: { snapshot, http: env.server.observe(), io: env.memory.observe(), rows: new Map(env.memory.rows) }, enumerable: false, configurable: true })
    Object.assign(failure, { creativePrivateCapture: 'pending' })
    try { await preserveCreativePrivateRows(id, env.memory.rows); Object.assign(failure, { creativePrivateCapture: 'saved' }) }
    catch { Object.assign(failure, { creativePrivateCapture: 'failed' }) }
    throw failure
  } finally { await env.close() }
}
export async function preserveCreativePrivateRows(id: string, rows: ReadonlyMap<string, string>) {
  const privateRoot = path.resolve(process.env.CREATIVE_PILOT_PRIVATE_DIR ?? 'artifacts/creative-pilot-private')
  await mkdir(privateRoot, { recursive: true, mode: 0o700 })
  await writeFile(path.join(privateRoot, `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}-failure-${crypto.randomUUID()}.json`), JSON.stringify({ rows: [...rows] }), { mode: 0o600, flag: 'wx' })
}
type SeedEvidence = { snapshot: CreativeSnapshot | null; http: { attempts: number }; io: { successfulCas: number } }
export function creditCreativeSeedEvidence(row: CreativeControlRow, evidence: SeedEvidence, bucket: 'exercise' | 'setup' = 'exercise') {
  row[bucket === 'setup' ? 'setupHttpAttempts' : 'exerciseHttpAttempts'] += evidence.http.attempts
  row[bucket === 'setup' ? 'setupSuccessfulCas' : 'successfulCas'] += evidence.io.successfulCas
  const snapshot = evidence.snapshot
  if (snapshot) {
    const current = snapshot.checkpoint.requests.map(index => {
      const phase = snapshot.phases.get(index.phaseHash)!, request = snapshot.requests.get(index.requestHash)!
      return { requestHash: request.hash, phaseHash: phase.hash, status: phase.status, responseHash: phase.responseHash, outcome: phase.resolution?.outcome ?? null, resolutionReason: phase.resolution?.reason ?? null, unknownReason: phase.reason, outstandingBytes: Number(snapshot.checkpoint.storage.openAllocations.find(a => a.request.id === request.id)?.remainingBytes ?? '0') }
    })
    row.obligations = [...row.obligations.filter(prior => prior.status !== 'resolved' && !current.some(item => item.requestHash === prior.requestHash)), ...current]
    row.receiptHash = snapshot.receipt.hash; row.observation = 'last_verified'
    const last = current.at(-1); row.resolutionReason = last?.resolutionReason ?? null; row.unknownReason = last?.unknownReason ?? null
  }
  controlAssert(row.obligations.length <= 9)
}
export function collectCreativeFaultFailure(row: CreativeControlRow, error: unknown, bucket: 'exercise' | 'setup' = 'exercise') {
  const evidence = (error as { creativeControlEvidence?: SeedEvidence })?.creativeControlEvidence
  if (!evidence) return
  creditCreativeSeedEvidence(row, evidence, bucket); row.observation = 'unconfirmed'
}
/** Credit every completed real seed before another can run; keep exact prior maps on any later failure. */
export async function runCreativeSeedSequence(row: CreativeControlRow, actions: Array<() => ReturnType<typeof runCreativeFaultSeed>>, bucket: 'exercise' | 'setup' = 'exercise') {
  const completed: Awaited<ReturnType<typeof runCreativeFaultSeed>>[] = []
  try {
    for (const action of actions) {
      let seed: Awaited<ReturnType<typeof runCreativeFaultSeed>>
      try { seed = await action() } catch (error) { collectCreativeFaultFailure(row, error, bucket); throw error }
      completed.push(seed); creditCreativeSeedEvidence(row, seed, bucket)
      row.snapshotHash = await rowMapOracle(seed.rows)
    }
    return completed
  } catch (error) {
    for (const [index, seed] of completed.entries()) { try { await preserveCreativePrivateRows(`${row.id}-completed-seed-${index}`, seed.rows) } catch { /* Already-credited HTTP/CAS/obligations survive a private filesystem refusal. */ } }
    // The sequence has already credited a failing seed. Avoid double credit in outer scenario handlers.
    const failure = new Error('creative_seed_sequence_failed', { cause: error })
    Object.assign(failure, { code: safeCreativeCode(error) }); throw failure
  }
}
