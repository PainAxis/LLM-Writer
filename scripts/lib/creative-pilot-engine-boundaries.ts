/** Engine/storage boundary controls, separate from 54 positive SDK tasks. */
import type { CreativeCommitGuard, CreativeMutation, CreativeSnapshot } from '../../src/types/creativePilot'
import type { CampaignRepositoryIO } from '../../src/types/writerCampaign'
import { createCreativePilotRepository, creativePilotKeys } from '../../src/services/writerCampaign/creativePilotStore'
import { createCreativeMemoryIO as rawCreativeMemoryIO } from './creative-pilot-io'
import { createCreativeEngineControl, runCreativeFaultSeed, collectCreativeFaultFailure, creditCreativeSeedEvidence, preserveCreativePrivateRows } from './creative-pilot-engine-controls'
import { creativePilotBriefs } from './creative-pilot-briefs'
import { creativeControlConfiguration, creativeControlIdentity } from './creative-pilot-control'
import { fillCreativeControlSnapshot, type CreativeFaultSeed } from './creative-pilot-faults'
import { canonicalOracle, controlAssert, rowMapOracle, storageCounterOracle } from './creative-pilot-oracles'
import { safeCreativeCode, type CreativeControlRow } from './creative-pilot-report'
const guard: CreativeCommitGuard = { canCommit: () => true, canPublish: () => true }
const command = (snapshot: CreativeSnapshot, operationId: string) => ({ campaignId: snapshot.manifest.campaignId, operationId, expectedRawHead: snapshot.rawHead, expectedCandidateHash: snapshot.candidate.hash })
async function refusal(action: () => Promise<unknown>, codes: string[]) { let code: string | null = null; try { await action() } catch (error) { code = safeCreativeCode(error) }; controlAssert(code !== null && codes.includes(code)); return code }
/** Every observed CAS is counted even when a later assertion/ACK fails. Private maps are never archived. */
function boundaryScenarios(rows: CreativeControlRow[], afterObservedCas?: (id: string, successfulCas: number) => void) {
  type Memory = ReturnType<typeof rawCreativeMemoryIO>
  let active: CreativeControlRow | null = null, tracked: Memory[] = []
  function track(memory: Memory) {
    controlAssert(active); tracked.push(memory)
    const original = memory.io.compareAndSwapMany, caseId = active.id
    memory.io = { ...memory.io, async compareAndSwapMany(entries, permit) {
      const result = await original(entries, permit)
      if (result) afterObservedCas?.(caseId, tracked.reduce((sum, item) => sum + item.observe().successfulCas, 0))
      return result
    } }
    return memory
  }
  return {
    track,
    memory: (initial: ReadonlyMap<string, string> = new Map()) => track(rawCreativeMemoryIO(initial)),
    async scenario(id: string, run: (row: CreativeControlRow) => Promise<void>) {
      const row = rows.find(item => item.id === id); if (!row) return
      active = row; tracked = []; row.status = 'running'; row.activeCheck = id
      // Seed evidence is credited separately; tracked repositories must never overwrite those counts.
      const initialCas = row.successfulCas
      try { await run(row); row.status = 'pass' }
      catch (error) {
        collectCreativeFaultFailure(row, error); row.status = 'failed'; row.errorCode = safeCreativeCode(error); row.observation = 'unconfirmed'
        for (const [index, memory] of tracked.entries()) {
          const head = [...memory.rows].find(([key]) => key.endsWith(':head'))
          try {
            const campaignId = head ? JSON.parse(head[1]).campaignId : null
            if (campaignId) {
              const snapshot = await createCreativePilotRepository({ io: memory.io }).read(campaignId)
              creditCreativeSeedEvidence(row, { snapshot, http: { attempts: 0 }, io: { successfulCas: 0 } })
              row.snapshotHash = await rowMapOracle(memory.rows)
            }
          } catch { /* Keep the raw map; never turn an unverified read into a confirmed empty outcome. */ }
          try { await preserveCreativePrivateRows(`${id}-boundary-${index}`, memory.rows) } catch { /* Never replace the independent failed CAS observation with a filesystem error. */ }
        }
        row.observation = 'unconfirmed'; throw error
      } finally {
        if (tracked.length) row.successfulCas = initialCas + tracked.reduce((sum, memory) => sum + memory.observe().successfulCas, 0)
        active = null
      }
    },
  }
}
export async function runCreativeEngineBoundaries(rows: CreativeControlRow[], baseline: CreativeFaultSeed, afterObservedCas?: (id: string, successfulCas: number) => void) {
  const { createCreativePilotEngine } = await import('../../src/services/writerCampaign/creativePilotEngine')
  const { createCreativeOfflineSdkHost, getCreativeOfflineSdkAdapter, projectCreativeContentEvidence } = await import('../../src/services/writerCampaign/creativePilotTransport')
  const createPrefix = baseline.prefixes.find(p => p.kind === 'create')!, request = [...baseline.snapshot.requests.values()][0]!
  const clock = () => request.createdAt, id = request.campaignId
  const verify = (row: CreativeControlRow, value: unknown) => { controlAssert(value); row.assertions++ }
  const { scenario, memory: createCreativeMemoryIO, track } = boundaryScenarios(rows, afterObservedCas)
  await scenario('E01', async row => {
    let reads = 0
    const host = createCreativeOfflineSdkHost({ identity: creativeControlIdentity('http://127.0.0.1:9/v1'), currentConfigurationRevision: () => 'creative-control-v1', readConfiguration: () => { reads++; throw new Error('credential_read') } })
    verify(row, reads === 0 && getCreativeOfflineSdkAdapter({} as any) === null && getCreativeOfflineSdkAdapter(host) !== null)
    const memory = createCreativeMemoryIO(createPrefix.rows), repository = createCreativePilotRepository({ io: memory.io, clock }), engine = createCreativePilotEngine({ repository, clock, identity: { runtimeIdentity: baseline.snapshot.manifest.runtimeIdentity, source: baseline.snapshot.manifest.source } })
    try { const snapshot = await repository.read(id); controlAssert(snapshot); verify(row, (await engine.dryPrepare(id)).readiness === 'unconfigured'); await refusal(() => engine.start(command(snapshot, 'unconfigured-start')), ['unconfigured']); verify(row, memory.observe().successfulCas === 0 && reads === 0) } finally { engine.dispose() }
  })
  await scenario('E02', async row => {
    const { runCreativeDispatchControls } = await import('./creative-pilot-dispatch-controls')
    const dispatch = await runCreativeDispatchControls(); verify(row, dispatch.httpAttempts === 0 && dispatch.intentCalls === 0); row.assertions += dispatch.assertions
    for (const endpoint of ['https://example.invalid/v1', 'http://127.0.0.1:9/v1?redirect=x', 'http://user@127.0.0.1:9/v1']) {
      let read = false
      await refusal(async () => createCreativeOfflineSdkHost({ identity: creativeControlIdentity(endpoint), currentConfigurationRevision: () => 'creative-control-v1', readConfiguration: () => { read = true; return creativeControlConfiguration('http://127.0.0.1:9/v1') } }), ['unconfigured']); verify(row, !read)
    }
    const env = await createCreativeEngineControl('e02-config'); track(env.memory)
    try {
      for (const change of [{ proxyUrl: 'http://127.0.0.1:1' }, { customHeaders: { test: 'not-permitted' } }, { provider: 'openai' }, { baseURL: env.server.endpoint + '/fallback' }]) {
        const config = { ...creativeControlConfiguration(env.server.endpoint), ...change } as any
        const host = createCreativeOfflineSdkHost({ identity: creativeControlIdentity(env.server.endpoint), currentConfigurationRevision: () => 'creative-control-v1', readConfiguration: () => config }), adapter = getCreativeOfflineSdkAdapter(host)!
        await refusal(() => adapter.invoke({ requestHash: 'a'.repeat(64), wire: { system: 'control', prompt: 'control' }, signal: new AbortController().signal, beforeRequest: async () => { throw new Error('unexpected_intent') } }), ['configuration_changed']); verify(row, env.server.observe().attempts === 0)
      }
      const host = createCreativeOfflineSdkHost({ identity: creativeControlIdentity(env.server.endpoint), currentConfigurationRevision: () => 'creative-control-v1', readConfiguration: () => creativeControlConfiguration(env.server.endpoint) })
      await refusal(() => getCreativeOfflineSdkAdapter(host)!.invoke({ requestHash: 'a'.repeat(64), wire: { system: 'control', prompt: 'control', tools: [] } as any, signal: new AbortController().signal, beforeRequest: async () => {} }), ['input_invalid']); verify(row, env.server.observe().attempts === 0)
      env.server.setMode('http_redirect')
      const prepared = await env.engine.prepare({ campaignId: env.campaignId, operationId: 'redirect-control', brief: creativePilotBriefs()[0]!.brief })
      await refusal(() => env.engine.start(command(prepared, 'redirect-start')), ['unknown_outcome', 'storage_unknown'])
      const unknown = await env.repository.read(env.campaignId); controlAssert(unknown)
      row.exerciseHttpAttempts = env.server.observe().attempts; row.successfulCas = env.memory.observe().successfulCas; fillCreativeControlSnapshot(row, unknown); row.snapshotHash = await rowMapOracle(env.memory.rows)
      verify(row, row.exerciseHttpAttempts === 1 && env.server.observe().blockedExternalRequests === 0 && row.obligations[0]!.status === 'outcome_unknown')
    } finally { row.exerciseHttpAttempts = env.server.observe().attempts; row.successfulCas = env.memory.observe().successfulCas; await env.close() }
  })
  await scenario('E03', async row => {
    const env = await createCreativeEngineControl('e03-duplicate'); track(env.memory)
    try {
      const before = await env.engine.prepare({ campaignId: env.campaignId, operationId: 'create', brief: creativePilotBriefs()[0]!.brief })
      env.engine.subscribeProgress(event => { if (event.kind === 'accepted' && event.taskId === 'outline') env.engine.stop(env.campaignId) })
      const one = env.engine.start(command(before, 'start-a')), two = env.engine.start(command(before, 'start-b')); verify(row, one === two)
      await Promise.allSettled([one, two]); const after = await env.repository.read(env.campaignId); controlAssert(after)
      row.exerciseHttpAttempts = env.server.observe().attempts; row.successfulCas = env.memory.observe().successfulCas; fillCreativeControlSnapshot(row, after); row.snapshotHash = await rowMapOracle(env.memory.rows)
      verify(row, row.exerciseHttpAttempts === 1 && after.checkpoint.budget.attempts === 1 && env.memory.observe().accountingMismatches === 0)
    } finally { row.exerciseHttpAttempts = env.server.observe().attempts; row.successfulCas = env.memory.observe().successfulCas; await env.close() }
  })
  await scenario('E04', async row => {
    const memory = createCreativeMemoryIO(createPrefix.rows), repo = createCreativePilotRepository({ io: memory.io, clock }), snapshot = await repo.read(id); controlAssert(snapshot)
    const original = { campaignId: id, operationId: snapshot.receipt.operationId, brief: snapshot.candidate.brief, identity: { runtimeIdentity: snapshot.manifest.runtimeIdentity, source: snapshot.manifest.source } }
    const duplicate = await repo.create(original, guard); verify(row, duplicate.replayed && duplicate.receipt.hash === snapshot.receipt.hash && memory.observe().successfulCas === 0)
    await refusal(() => repo.create({ ...original, brief: { ...original.brief, premise: original.brief.premise + 'x' } }, guard), ['operation_conflict']); verify(row, memory.observe().successfulCas === 0)
    fillCreativeControlSnapshot(row, snapshot); row.snapshotHash = await rowMapOracle(memory.rows)
  })
  await scenario('E05', async row => {
    const memory = createCreativeMemoryIO(createPrefix.rows), other = createCreativePilotRepository({ io: memory.io, clock }); let changed = false
    const io: CampaignRepositoryIO = { ...memory.io, async getMany(keys) {
      if (!changed && keys.length === 3 && keys.some(key => key.endsWith(':v4:checkpoint:1'))) { changed = true; const snapshot = await other.read(id); controlAssert(snapshot); await other.replaceBrief(snapshot, { operationId: 'concurrent-author', brief: { ...snapshot.candidate.brief, premise: snapshot.candidate.brief.premise + 'x' } }, guard) }
      return memory.io.getMany(keys)
    } }
    const repo = createCreativePilotRepository({ io, clock }); await refusal(() => repo.read(id), ['source_changed']); verify(row, changed && memory.observe().successfulCas === 1 && memory.observe().accountingMismatches === 0)
    row.successfulCas = memory.observe().successfulCas; row.snapshotHash = await rowMapOracle(memory.rows); fillCreativeControlSnapshot(row, await other.read(id))
    // Actual stale v2 create: absence/catalog were captured before the fresh v4 winner.
    const { createCampaignRepository } = await import('../../src/services/writerCampaign/store')
    const { createOfflineCampaignManifest } = await import('../../src/services/writerCampaign/engine')
    const { planningManifestOptions } = await import('../../src/services/writerCampaign/planningProfile')
    const competing = createCreativeMemoryIO(), shared = competing.rows; let release!: () => void, entered!: () => void, legacyWrites = 0
    const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
    const rawIo = competing.io
    const oldIo: CampaignRepositoryIO = { ...rawIo, async compareAndSwapMany(entries, permit) { entered(); await gate; const written = await rawIo.compareAndSwapMany(entries, permit); if (written) legacyWrites++; return written } }
    const competingId = id + '-v2-race', identity = { runtimeIdentity: 'creative-legacy-compatibility', source: { commit: null, tree: null } }
    const legacy = createCampaignRepository(oldIo), manifest = await createOfflineCampaignManifest(planningManifestOptions({ campaignId: competingId, language: 'zh', identity }))
    const pending = legacy.create(manifest, 'old-create').then(() => null, error => safeCreativeCode(error)); await ready
    const current = createCreativePilotRepository({ io: rawIo })
    try {
      await current.create({ campaignId: competingId, operationId: 'new-create', brief: baseline.snapshot.candidate.brief, identity }, guard)
      const winningRows = await rowMapOracle(shared); release(); verify(row, await pending === 'conflict' && legacyWrites === 0 && await rowMapOracle(shared) === winningRows)
      await refusal(() => legacy.read(competingId), ['unsupported_schema']); verify(row, (await current.read(competingId))?.manifest.schemaVersion === 4)
    } finally { release(); await pending }

  })
  await scenario('E06', async row => {
    const accepted = baseline.prefixes.find(p => p.kind === 'resolve')!
    for (const category of ['candidate', 'artifact', 'catalog']) {
      const memory = createCreativeMemoryIO(category === 'candidate' ? createPrefix.rows : accepted.rows)
      const key = category === 'catalog' ? 'writer-campaign:catalog' : [...memory.rows.keys()].find(k => k.includes(`:v4:${category}:`))!
      const old = memory.rows.get(key)!; controlAssert(old)
      const value = JSON.parse(old)
      if (category === 'candidate') value.brief.premise = 'X' + value.brief.premise.slice(1)
      else if (category === 'artifact') value.text = 'X' + value.text.slice(1)
      else value.ids[0] = value.ids[0].slice(0, -1) + 'X'
      memory.rows.set(key, canonicalOracle(value))
      await refusal(() => createCreativePilotRepository({ io: memory.io, clock }).read(id), ['integrity', 'conflict']); verify(row, memory.observe().successfulCas === 0)
    }
  })
  await scenario('E09', async row => {
    const seed = await runCreativeFaultSeed('e09-lost', creativePilotBriefs()[0]!.brief, 'lost_response')
    row.exerciseHttpAttempts = seed.http.attempts; row.successfulCas = seed.io.successfulCas; fillCreativeControlSnapshot(row, seed.snapshot); row.snapshotHash = await rowMapOracle(seed.rows)
    verify(row, seed.http.attempts === 1 && row.obligations.length === 1 && row.obligations[0]!.status === 'outcome_unknown' && row.obligations[0]!.outstandingBytes > 0 && seed.snapshot.checkpoint.budget.attempts === 1 && seed.io.accountingMismatches === 0)
  })
  // Pure SDK-result projection witnesses do not claim another endpoint/model task.
  const e14 = rows.find(r => r.id === 'E14')!
  if (e14?.status === 'pass') {
  const text = 'visible', part = { type: 'text', text }, valid = { content: [part], steps: [{ content: [part] }] }
  verify(e14, projectCreativeContentEvidence(valid, text).anomalies.length === 0)
  for (const value of [{ content: [part] }, { content: [part], steps: [] }, { content: [part], steps: [{ content: [part] }, { content: [part] }] }, { content: [{ type: 'text', text: 'different' }], steps: [{ content: [part] }] }, { content: [{ type: 'text', text: 3 }], steps: [{ content: [part] }] }, { content: [part, { type: 'file', data: 'not retained' }], steps: [{ content: [part] }] }, { content: [part], toolCalls: [{}], steps: [{ content: [part] }] }]) verify(e14, projectCreativeContentEvidence(value, text).anomalies.length > 0)
  }
  await runCreativeAllowanceBoundaries(rows, baseline, afterObservedCas)
}

export async function runCreativeAllowanceBoundaries(rows: CreativeControlRow[], baseline: CreativeFaultSeed, afterObservedCas?: (id: string, successfulCas: number) => void) {
  const verify = (row: CreativeControlRow, value: unknown) => { controlAssert(value); row.assertions++ }
  const request = [...baseline.snapshot.requests.values()][0]!, id = request.campaignId, first = baseline.prefixes.find(p => p.kind === 'create')!
  const { scenario, memory: createCreativeMemoryIO } = boundaryScenarios(rows, afterObservedCas)
  await scenario('E17', async row => {
    const memory = createCreativeMemoryIO(baseline.rows), repo = createCreativePilotRepository({ io: memory.io, clock: () => baseline.snapshot.checkpoint.lastWallTime }), before = await repo.read(id); controlAssert(before && before.checkpoint.budget.attempts === 9)
    const hash = await rowMapOracle(memory.rows)
    await refusal(() => repo.commit(before, { kind: 'reserve', operationId: request.operationId + ':tenth', recovery: false, request }, guard), ['already_terminal', 'attempt_spent']); verify(row, await rowMapOracle(memory.rows) === hash && memory.observe().successfulCas === 0)
    const { createCreativePilotEngine } = await import('../../src/services/writerCampaign/creativePilotEngine')
    const { createCreativeOfflineSdkHost } = await import('../../src/services/writerCampaign/creativePilotTransport')
    const adapter = before.checkpoint.adapter!; controlAssert(adapter)
    const host = createCreativeOfflineSdkHost({ identity: adapter, currentConfigurationRevision: () => adapter.configurationRevision, readConfiguration: () => creativeControlConfiguration(adapter.endpointIdentity) })
    const engine = createCreativePilotEngine({ repository: repo, host, clock: () => before.checkpoint.lastWallTime, identity: { runtimeIdentity: before.manifest.runtimeIdentity, source: before.manifest.source } })
    try { await refusal(() => engine.start(command(before, 'completed-start')), ['attempt_spent']); verify(row, await rowMapOracle(memory.rows) === hash && memory.observe().successfulCas === 0) } finally { engine.dispose() }
    row.snapshotHash = hash; fillCreativeControlSnapshot(row, before)
  })
  await scenario('E18', async row => {
    const candidates = baseline.prefixes.filter(p => p.kind === 'reserve' || p.kind === 'dispatch_intent').slice(0, 2)
    const unknownMemory = createCreativeMemoryIO(candidates[1]!.rows), unknownRepo = createCreativePilotRepository({ io: unknownMemory.io, clock: () => baseline.snapshot.checkpoint.lastWallTime }), knownIntent = await unknownRepo.read(id); controlAssert(knownIntent)
    await unknownRepo.commit(knownIntent, { kind: 'outcome_unknown', operationId: request.operationId + ':unknown', requestHash: request.hash, recovery: false, reason: 'interrupted' }, guard)
    candidates.push({ ...candidates[1]!, rows: new Map(unknownMemory.rows), phase: 'outcome_unknown' }); row.successfulCas = unknownMemory.observe().successfulCas
    for (const prefix of candidates) {
      const memory = createCreativeMemoryIO(prefix.rows), repo = createCreativePilotRepository({ io: memory.io, clock: () => baseline.snapshot.checkpoint.lastWallTime }), before = await repo.read(id); controlAssert(before)
      const hash = await rowMapOracle(memory.rows)
      await refusal(() => repo.replaceBrief(before, { operationId: 'forbidden-replace', brief: { ...before.candidate.brief, premise: before.candidate.brief.premise + 'x' } }, guard), ['replacement_after_reservation']); verify(row, await rowMapOracle(memory.rows) === hash && before.checkpoint.budget.attempts === 1 && memory.observe().successfulCas === 0)
    }
  })
  await scenario('E19', async row => {
    const request2 = [...baseline.snapshot.requests.values()].find(r => r.taskId === 'characters')!, response = [...baseline.snapshot.responses.values()].find(r => r.requestHash === request.hash)!, intent = baseline.prefixes.find(p => p.kind === 'dispatch_intent')!
    const memory = createCreativeMemoryIO(intent.rows), now = Math.max(request2.createdAt, request.createdAt), repo = createCreativePilotRepository({ io: memory.io, clock: () => now }); let snapshot = await repo.read(id); controlAssert(snapshot)
    const mutations: CreativeMutation[] = [
      { kind: 'outcome_unknown', requestHash: request.hash, operationId: request.operationId + ':unknown', reason: 'interrupted', recovery: true },
      { kind: 'retain_response', requestHash: request.hash, operationId: request.operationId + ':retain', response, recovery: true },
      { kind: 'resolve', requestHash: request.hash, operationId: 'metadata-recovery-resolve', disposition: 'publish_if_valid', recovery: true },
      { kind: 'reserve', request: request2, operationId: request2.operationId + ':reserve', recovery: false },
      { kind: 'dispatch_intent', requestHash: request2.hash, operationId: request2.operationId + ':intent', dispatchWire: [...baseline.snapshot.phases.values()].find(p => p.requestHash === request2.hash && p.status === 'dispatch_intent')!.dispatchWire!, recovery: false },
    ]
    for (const mutation of mutations) snapshot = (await repo.commit(snapshot, mutation, guard)).snapshot
    verify(row, snapshot.checkpoint.metadata.recoveryUsed === 3)
    const before = await rowMapOracle(memory.rows), calls = memory.observe().successfulCas
    await refusal(() => repo.commit(snapshot!, { kind: 'outcome_unknown', requestHash: request2.hash, operationId: request2.operationId + ':unknown', reason: 'interrupted', recovery: true }, guard), ['metadata_capacity']); verify(row, memory.observe().successfulCas === calls && await rowMapOracle(memory.rows) === before)
    snapshot = (await repo.commit(snapshot, { kind: 'cancel', operationId: 'protected-final-cancel', recovery: false }, guard)).snapshot
    verify(row, snapshot.checkpoint.status === 'cancelled' && snapshot.checkpoint.metadata.cancelUsed && storageCounterOracle(snapshot.checkpoint.storage.outstandingBytes) > 0 && snapshot.checkpoint.budget.attempts === 2 && memory.observe().accountingMismatches === 0)
    const count = memory.observe().successfulCas; verify(row, (await repo.getReceipt(id, 'metadata-recovery-resolve')) !== null && memory.observe().successfulCas === count)
    row.successfulCas = count; row.snapshotHash = await rowMapOracle(memory.rows); fillCreativeControlSnapshot(row, snapshot)
  })
  await scenario('E20', async row => {
    const { CREATIVE_LIMITS } = await import('../../src/services/writerCampaign/creativePilotProtocol')
    verify(row, CREATIVE_LIMITS.repositoryMs === 10000 && CREATIVE_LIMITS.ioMs === 3000 && CREATIVE_LIMITS.stageMs === 60000 && CREATIVE_LIMITS.metadataMs === 10000 && CREATIVE_LIMITS.sdkMs === 30000 && CREATIVE_LIMITS.operations === 48 && CREATIVE_LIMITS.observedKeys === 174)
    const memory = createCreativeMemoryIO(first.rows), before = await createCreativePilotRepository({ io: memory.io, clock: () => request.createdAt }).read(id); controlAssert(before)
    await refusal(() => createCreativePilotRepository({ io: memory.io, clock: () => before.checkpoint.lastWallTime - 1 }).replaceBrief(before, { operationId: 'rollback', brief: before.candidate.brief }, guard), ['clock_rollback']); verify(row, memory.observe().successfulCas === 0)
    let mono = 0
    const io: CampaignRepositoryIO = { ...memory.io, async getMany(keys) { const result = await memory.io.getMany(keys); mono += 10001; return result } }
    await refusal(() => createCreativePilotRepository({ io, monotonic: () => mono }).read(id), ['deadline_exceeded']); verify(row, memory.observe().successfulCas === 0)
    let releaseRead!: () => void
    const heldRead: CampaignRepositoryIO = { ...memory.io, getMany: keys => new Promise(resolve => { releaseRead = () => { void memory.io.getMany(keys).then(resolve) } }) }
    await refusal(() => createCreativePilotRepository({ io: heldRead }).read(id), ['operation_timeout']); releaseRead(); verify(row, memory.observe().successfulCas === 0)
    let releaseCas!: () => Promise<boolean>, lateCas = false
    const heldCas: CampaignRepositoryIO = { ...memory.io, compareAndSwapMany: (entries, permit) => new Promise(resolve => { releaseCas = async () => { lateCas = await memory.io.compareAndSwapMany(entries, permit); resolve(lateCas); return lateCas } }) }
    await refusal(() => createCreativePilotRepository({ io: heldCas, clock: () => request.createdAt }).replaceBrief(before, { operationId: 'late-cas', brief: before.candidate.brief }, guard), ['storage_unknown']); verify(row, await releaseCas() === false && !lateCas && memory.observe().successfulCas === 0)
    for (const changed of [{ sequence: 49 }, { sequence: 1000000000 }]) { const corrupt = createCreativeMemoryIO(first.rows), head = creativePilotKeys.head(id); corrupt.rows.set(head, canonicalOracle({ ...JSON.parse(corrupt.rows.get(head)!), ...changed })); await refusal(() => createCreativePilotRepository({ io: corrupt.io }).read(id), ['integrity']); verify(row, corrupt.observe().maxReadBatchKeys <= 33) }
  })
}
