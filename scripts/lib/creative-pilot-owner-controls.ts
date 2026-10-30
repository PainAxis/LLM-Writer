/** Real SDK ownership controls. Faults pause actual hashes/CAS; no successful
 * response, artifact, progress or execution grant is injected. */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CreativeHeadCommand, CreativePilotEngine, CreativeSnapshot } from '../../src/types/creativePilot'
import { creativePilotBriefs } from './creative-pilot-briefs'
import { creativeControlConfiguration, creativeControlIdentity } from './creative-pilot-control'
import { createCreativeEngineControl } from './creative-pilot-engine-controls'
import { fillCreativeControlSnapshot } from './creative-pilot-faults'
import { canonicalOracle, controlAssert, rowMapOracle, storageCounterOracle } from './creative-pilot-oracles'
import { safeCreativeCode, type CreativeControlRow } from './creative-pilot-report'

type Environment = Awaited<ReturnType<typeof createCreativeEngineControl>>
type HttpBucket = 'setupHttpAttempts' | 'exerciseHttpAttempts' | 'recoveryHttpAttempts'
const brief = () => creativePilotBriefs()[3]!.brief
const head = (env: Environment, snapshot: CreativeSnapshot, operationId: string): CreativeHeadCommand => ({ campaignId: env.campaignId,
  operationId, expectedRawHead: snapshot.rawHead, expectedCandidateHash: snapshot.candidate.hash })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
async function boundedWait(promise: Promise<unknown>, milliseconds = 5000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { await Promise.race([promise, new Promise<never>((_r, reject) => { timer = setTimeout(() => reject(new Error('creative_control_hold_not_entered')), milliseconds) })]) }
  finally { if (timer) clearTimeout(timer) }
}
function latest(snapshot: CreativeSnapshot) { const index = snapshot.checkpoint.requests.at(-1); controlAssert(index); const phase = snapshot.phases.get(index.phaseHash), request = snapshot.requests.get(index.requestHash); controlAssert(phase && request); return { phase, request } }
async function freshEngine(env: Environment, options: { sourceChanged?: boolean; revision?: string; clock?: () => number; monotonic?: () => number } = {}) {
  const { createCreativePilotEngine } = await import('../../src/services/writerCampaign/creativePilotEngine')
  const { createCreativeOfflineSdkHost } = await import('../../src/services/writerCampaign/creativePilotTransport')
  const config = creativeControlConfiguration(env.server.endpoint), identity = creativeControlIdentity(env.server.endpoint, options.revision)
  const host = createCreativeOfflineSdkHost({ identity, currentConfigurationRevision: () => identity.configurationRevision, readConfiguration: () => structuredClone(config) })
  return createCreativePilotEngine({ repository: env.repository, host, identity: { runtimeIdentity: options.sourceChanged ? 'changed-control-source' : 'creative-control', source: { commit: null, tree: null } },
    ...(options.clock ? { clock: options.clock } : {}), ...(options.monotonic ? { monotonic: options.monotonic } : {}) })
}
async function snapshot(env: Environment) { const value = await env.repository.read(env.campaignId); controlAssert(value); return value }
function stopAt(engine: CreativePilotEngine, kind: string) {
  let stopped = false
  return engine.subscribeProgress(event => { if (!stopped && event.kind === kind && event.taskId === 'outline') { stopped = true; engine.stop(event.campaignId) } })
}
function heldKnownTextHash(env: Environment) {
  const original = crypto.subtle.digest.bind(crypto.subtle), entered = deferred(), release = deferred()
  let selected = false
  crypto.subtle.digest = async (algorithm, data) => {
    const text = new TextDecoder().decode(data)
    if (!selected && env.server.observe().records.length === 1 && text.startsWith('{"domain":"creative-visible-text-json-v1",')) { selected = true; entered.resolve(); await release.promise }
    return original(algorithm, data)
  }
  return { entered: entered.promise, release: release.resolve, restore() { release.resolve(); crypto.subtle.digest = original } }
}

export async function runCreativeOwnerControls(rows: CreativeControlRow[]): Promise<void> {
  const pending = new Set<Promise<string | null>>()
  const outcome = (promise: Promise<unknown>) => {
    const result = promise.then(() => null, error => safeCreativeCode(error))
    pending.add(result); void result.finally(() => { pending.delete(result) }); return result
  }
  const verify = (row: CreativeControlRow, value: unknown) => { controlAssert(value); row.assertions++ }
  async function scenario(id: string, name: string, run: (env: Environment, row: CreativeControlRow, countAs: (bucket: HttpBucket) => void) => Promise<void>, initialBucket: HttpBucket = 'exerciseHttpAttempts') {
    const row = rows.find(value => value.id === id); controlAssert(row)
    row.status = 'running'; row.activeCheck = id
    const env = await createCreativeEngineControl(`${id.toLowerCase()}-${name}`)
    let httpObserved = 0, httpBucket = initialBucket
    const countAs = (next: HttpBucket) => {
      const actual = env.server.observe().attempts
      controlAssert(actual >= httpObserved)
      row[httpBucket] += actual - httpObserved; httpObserved = actual; httpBucket = next
    }
    const priorOpen = row.obligations.filter(obligation => obligation.status !== 'resolved')
    const observe = (value: CreativeSnapshot | null) => {
      fillCreativeControlSnapshot(row, value)
      const current = new Map(row.obligations.map(obligation => [obligation.requestHash, obligation]))
      for (const obligation of priorOpen) if (!current.has(obligation.requestHash)) current.set(obligation.requestHash, obligation)
      controlAssert(current.size <= 9)
      row.obligations = [...current.values()]
    }
    try {
      await run(env, row, countAs)
      const value = await snapshot(env), io = env.memory.observe(), http = env.server.observe()
      observe(value); row.snapshotHash = await rowMapOracle(env.memory.rows)
      verify(row, io.accountingMismatches === 0 && http.blockedExternalRequests === 0 && http.errors === 0)
      verify(row, http.attempts <= 9)
    } catch (error) {
      row.status = 'failed'; row.errorCode = safeCreativeCode(error)
      env.engine.stop(env.campaignId)
      let drained = true
      try { await boundedWait(Promise.all([...pending]), 10000) } catch { drained = false }
      try {
        observe(await env.repository.read(env.campaignId)); row.snapshotHash = await rowMapOracle(env.memory.rows)
      } catch { row.observation = 'unconfirmed' }
      if (!drained) row.observation = 'unconfirmed'
      const directory = process.env.CREATIVE_PILOT_PRIVATE_DIR ?? 'artifacts/creative-pilot-private'
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(path.join(directory, `failure-${id}-${name}-${crypto.randomUUID()}.json`), JSON.stringify([...env.memory.rows]), { mode: 0o600, flag: 'wx' })
      throw error
    } finally {
      try { await env.close() } finally { countAs(httpBucket); row.successfulCas += env.memory.observe().successfulCas }
    }
  }
  const prepare = (env: Environment) => env.engine.prepare({ campaignId: env.campaignId, operationId: 'prepare-owner-control', brief: brief() })

  await scenario('E07', 'reserved-resume', async (env, row, countAs) => {
    const before = await prepare(env), off = stopAt(env.engine, 'reserved')
    verify(row, await outcome(env.engine.start(head(env, before, 'start'))) !== null); off()
    const reserved = await snapshot(env), origin = latest(reserved).request, budget = reserved.checkpoint.budget
    verify(row, latest(reserved).phase.status === 'reserved' && env.server.observe().attempts === 0 && budget.attempts === 1)
    const preview = await env.engine.dryPrepare(env.campaignId)
    verify(row, canonicalOracle(preview.prepared) === canonicalOracle(origin.prepared))
    for (const options of [{ sourceChanged: true }, { revision: 'changed-config' }]) {
      const invalid = await freshEngine(env, options)
      try { verify(row, await outcome(invalid.resume(head(env, reserved, 'refuse-mismatch'))) === ('sourceChanged' in options ? 'source_changed' : 'configuration_changed')) }
      finally { invalid.dispose() }
    }
    countAs('recoveryHttpAttempts')
    env.engine.dispose(); const resumed = await freshEngine(env), offAccepted = stopAt(resumed, 'accepted')
    try { verify(row, await outcome(resumed.resume(head(env, reserved, 'resume'))) !== null) } finally { offAccepted(); resumed.dispose() }
    const done = await snapshot(env), result = latest(done)
    verify(row, env.server.observe().attempts === 1 && result.request.hash === origin.hash && result.request.expiresAt === origin.expiresAt)
    verify(row, done.checkpoint.budget.attempts === 1 && done.checkpoint.budget.outputTokens === budget.outputTokens && done.checkpoint.budget.activeMs === budget.activeMs)
    verify(row, result.phase.resolution?.outcome === 'accepted' && storageCounterOracle(done.checkpoint.storage.outstandingBytes) === 0)
  })

  for (const winner of ['old', 'fresh'] as const) await scenario('E07', `intent-${winner}-wins`, async (env, row, countAs) => {
    const before = await prepare(env), originalCas = env.memory.io.compareAndSwapMany.bind(env.memory.io), entered = deferred(), release = deferred()
    let selected = false, oldResult: boolean | null = null
    env.memory.io.compareAndSwapMany = async (entries, canCommit) => {
      const intent = entries.some(entry => { const value = JSON.parse(entry.value); return value.protocolVersion === 'creative-pilot-receipt-v4' && value.kind === 'dispatch_intent' })
      if (!selected && intent) {
        selected = true
        if (winner === 'old') oldResult = await originalCas(entries, canCommit)
        entered.resolve(); await release.promise
        if (winner === 'fresh') oldResult = await originalCas(entries, canCommit)
        return oldResult!
      }
      return originalCas(entries, canCommit)
    }
    let resumed: CreativePilotEngine | null = null
    try {
      const first = outcome(env.engine.start(head(env, before, 'old-start')))
      await boundedWait(entered.promise); env.engine.stop(env.campaignId); verify(row, await first !== null)
      const current = await snapshot(env), origin = latest(current).request
      verify(row, current.checkpoint.budget.attempts === 1 && env.server.observe().attempts === 0)
      countAs('recoveryHttpAttempts'); resumed = await freshEngine(env)
      if (winner === 'old') {
        verify(row, latest(current).phase.status === 'outcome_unknown')
        verify(row, await outcome(resumed.resume(head(env, current, 'fresh-resume'))) !== null)
        verify(row, env.server.observe().attempts === 0 && storageCounterOracle(current.checkpoint.storage.outstandingBytes) > 0)
      } else {
        verify(row, latest(current).phase.status === 'reserved')
        const off = stopAt(resumed, 'accepted')
        verify(row, await outcome(resumed.resume(head(env, current, 'fresh-resume'))) !== null); off()
        const finished = await snapshot(env)
        verify(row, latest(finished).request.hash === origin.hash && latest(finished).phase.resolution?.outcome === 'accepted')
        verify(row, env.server.observe().attempts === 1 && finished.checkpoint.budget.attempts === 1)
      }
      release.resolve(); await new Promise(resolve => setTimeout(resolve, 20))
      verify(row, oldResult === (winner === 'old') && env.server.observe().attempts === (winner === 'old' ? 0 : 1))
      } finally { env.engine.stop(env.campaignId); resumed?.dispose(); release.resolve(); env.memory.io.compareAndSwapMany = originalCas }
  })

  // A virtual monotonic clock fires the actual originally requested 60s owner
  // timer while WebCrypto is held. This is deadline correctness, not speed data.
  await scenario('E07', 'pending-hash-deadline', async (env, row) => {
    const before = await prepare(env), baseWall = Date.now(); let elapsed = 0
    const engine = await freshEngine(env, { clock: () => baseWall + elapsed, monotonic: () => elapsed })
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle), originalTimer = globalThis.setTimeout
    const entered = deferred(), release = deferred(), timers: Array<{ callback: () => void; handle: ReturnType<typeof setTimeout> }> = []
    let selected = false
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      const handle = originalTimer(callback, delay, ...args)
      if (delay === 60000) timers.push({ callback: () => callback(...args), handle })
      return handle
    }) as typeof setTimeout
    crypto.subtle.digest = async (algorithm, data) => {
      if (!selected && new TextDecoder().decode(data).startsWith('{"domain":"creative-pilot-request-v1",')) { selected = true; entered.resolve(); await release.promise }
      return originalDigest(algorithm, data)
    }
    try {
      const pending = outcome(engine.start(head(env, before, 'pending-hash')))
      await boundedWait(entered.promise); verify(row, timers.length > 0)
      elapsed = 60001; timers[0]!.callback()
      verify(row, await pending === 'deadline_exceeded')
      release.resolve(); await new Promise(resolve => originalTimer(resolve, 20))
      const current = await snapshot(env)
      verify(row, env.server.observe().attempts === 0 && current.checkpoint.budget.attempts === 0 && current.rawHead === before.rawHead)
      verify(row, await outcome(engine.start({ ...head(env, before, 'new-metadata-owner'), expectedRawHead: before.rawHead + 'x' })) === 'source_changed')
    } finally { engine.dispose(); release.resolve(); crypto.subtle.digest = originalDigest; globalThis.setTimeout = originalTimer; for (const timer of timers) clearTimeout(timer.handle) }
  })

  await scenario('E08', 'intent-no-entry', async (env, row, countAs) => {
    const before = await prepare(env), off = stopAt(env.engine, 'dispatch_intent')
    verify(row, await outcome(env.engine.start(head(env, before, 'start'))) !== null); off()
    let current = await snapshot(env)
    verify(row, latest(current).phase.status === 'outcome_unknown' && env.server.observe().attempts === 0)
    const U = current.checkpoint.storage.outstandingBytes, attempts = current.checkpoint.budget.attempts
    verify(row, storageCounterOracle(U) > 0 && attempts === 1)
    countAs('recoveryHttpAttempts')
    verify(row, await outcome(env.engine.resume(head(env, current, 'resume'))) !== null)
    current = await env.engine.cancel(head(env, current, 'cancel'))
    verify(row, current.checkpoint.storage.outstandingBytes === U && current.checkpoint.budget.attempts === attempts && env.server.observe().attempts === 0)
  })

  for (const action of ['stop', 'cancel', 'accounting_only'] as const) await scenario('E10', `known-${action}`, async (env, row, countAs) => {
    const before = await prepare(env), hold = heldKnownTextHash(env)
    try {
      const run = outcome(env.engine.start(head(env, before, 'start')))
      await boundedWait(hold.entered); let current = await snapshot(env)
      verify(row, latest(current).phase.status === 'dispatch_intent' && env.server.observe().attempts === 1)
      if (action === 'cancel') current = await env.engine.cancel(head(env, current, 'cancel'))
      else env.engine.stop(env.campaignId)
      hold.release(); verify(row, await run !== null); hold.restore()
      current = await snapshot(env)
      verify(row, latest(current).phase.status === 'response_retained' && current.responses.size === 1 && current.artifacts.size === 0 && env.server.observe().attempts === 1)
      if (action === 'cancel') verify(row, current.checkpoint.status === 'cancelled')
      countAs('recoveryHttpAttempts')
      const resolved = await env.engine.resolveRetained({ ...head(env, current, 'explicit-local-resolve'), requestHash: latest(current).request.hash,
        disposition: action === 'stop' ? 'publish_if_valid' : 'accounting_only' })
      const resolution = latest(resolved).phase.resolution!
      verify(row, resolution.outcome === (action === 'stop' ? 'accepted' : action === 'cancel' ? 'refused' : 'authority_revoked'))
      verify(row, resolution.reason === (action === 'stop' ? null : action === 'cancel' ? 'cancelled' : 'authority_revoked'))
      verify(row, env.server.observe().attempts === 1 && storageCounterOracle(resolved.checkpoint.storage.outstandingBytes) === 0)
    } finally { env.engine.stop(env.campaignId); hold.restore() }
  })

  await scenario('E11', 'reload-local-resolve', async (env, row, countAs) => {
    const before = await prepare(env), off = stopAt(env.engine, 'response_retained')
    verify(row, await outcome(env.engine.start(head(env, before, 'start'))) !== null); off(); env.engine.dispose()
    countAs('recoveryHttpAttempts')
    const engine = await freshEngine(env)
    try {
      const retained = await engine.inspect(env.campaignId); controlAssert(retained)
      verify(row, latest(retained).phase.status === 'response_retained' && env.server.observe().attempts === 1)
      const resolved = await engine.resolveRetained({ ...head(env, retained, 'resolve-after-reload'), requestHash: latest(retained).request.hash, disposition: 'publish_if_valid' })
      verify(row, latest(resolved).phase.resolution?.outcome === 'accepted' && resolved.artifacts.size === 1 && resolved.checkpoint.metadata.recoveryUsed === 1)
      await new Promise(resolve => setTimeout(resolve, 20))
      verify(row, env.server.observe().attempts === 1 && resolved.checkpoint.budget.attempts === 1 && resolved.checkpoint.tasks[1]!.status === 'pending')
    } finally { engine.dispose() }
  }, 'setupHttpAttempts')

  for (const moment of ['prepare', 'reserved', 'dispatch_intent', 'known_hash'] as const) await scenario('E16', moment, async (env, row, countAs) => {
    const before = await prepare(env)
    if (moment === 'prepare') {
      env.revoke(); verify(row, await outcome(env.engine.start(head(env, before, 'start'))) === 'configuration_changed')
      verify(row, (await snapshot(env)).checkpoint.budget.attempts === 0 && env.server.observe().attempts === 0); return
    }
    if (moment !== 'known_hash') {
      const off = env.engine.subscribeProgress(event => { if (event.kind === moment && event.taskId === 'outline') env.revoke() })
      try { verify(row, await outcome(env.engine.start(head(env, before, 'start'))) === 'configuration_changed') } finally { off() }
      const current = await snapshot(env)
      verify(row, latest(current).phase.status === (moment === 'reserved' ? 'reserved' : 'outcome_unknown') && env.server.observe().attempts === 0 && current.artifacts.size === 0)
      verify(row, current.checkpoint.budget.attempts === 1 && storageCounterOracle(current.checkpoint.storage.outstandingBytes) > 0); return
    }
    const hold = heldKnownTextHash(env)
    try {
      const run = outcome(env.engine.start(head(env, before, 'start')))
      await boundedWait(hold.entered); env.revoke(); hold.release(); verify(row, await run === 'configuration_changed'); hold.restore()
      const current = await snapshot(env)
      verify(row, latest(current).phase.status === 'response_retained' && current.artifacts.size === 0 && env.server.observe().attempts === 1)
      countAs('recoveryHttpAttempts')
      verify(row, await outcome(env.engine.resolveRetained({ ...head(env, current, 'resolve-revoked'), requestHash: latest(current).request.hash, disposition: 'publish_if_valid' })) === 'authority_revoked')
      const closed = await env.engine.resolveRetained({ ...head(env, current, 'close-revoked'), requestHash: latest(current).request.hash, disposition: 'accounting_only' })
      verify(row, latest(closed).phase.resolution?.outcome === 'authority_revoked' && env.server.observe().attempts === 1)
    } finally { env.engine.stop(env.campaignId); hold.restore() }
  })
  for (const id of ['E07', 'E08', 'E10', 'E11', 'E16']) rows.find(row => row.id === id)!.status = 'pass'
}
