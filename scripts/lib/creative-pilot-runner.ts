import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readCreativeColdProcess, type CreativeColdRead } from './creative-pilot-cold-process'
import type { CreativeRuntimeIdentity } from '../../src/types/creativePilot'
/** Actual production engine/repository/SDK positive runner. Private snapshots never enter reports. */
import type { CreativePilotEngine, CreativeProgressEvent, CreativeReceipt, CreativeRepository, CreativeSnapshot } from '../../src/types/creativePilot'
import type { ControlBrief } from './creative-pilot-briefs'
import { createCreativeMemoryIO } from './creative-pilot-io'
import { bodyOracle, byteOracle, canonicalOracle, controlAssert, domainOracle, hashOracle, rowMapOracle, storageCounterOracle } from './creative-pilot-oracles'
import { creativeControlConfiguration, creativeControlIdentity, type CreativeHttpObservation } from './creative-pilot-control'
import { createCreativeControlServer, installCreativeNodeStorage } from './creative-pilot-node-server'
import { safeCreativeCode, type CreativePositiveRow } from './creative-pilot-report'

export interface CreativeCapturedPrefix { kind: string; sequence: number; taskId: string | null; phase: string | null; rows: Map<string, string> }
export function verifyCreativeFinalFence(before: ReadonlyMap<string, string>, campaignId: string, trace: Array<{ keys: string[]; rows: Map<string, string | null> }>) {
  const prefix = `writer-campaign:${encodeURIComponent(campaignId)}:`, headKey = prefix + 'head', rawHead = before.get(headKey)
  if (!rawHead) return null
  const head = JSON.parse(rawHead), catalogKey = 'writer-campaign:catalog', successor = prefix + `v4:checkpoint:${head.sequence + 1}`
  const terminal = trace.at(-1)
  controlAssert(terminal && canonicalOracle(terminal.keys) === canonicalOracle([headKey, catalogKey, successor]), 'creative_control_fence_terminal')
  controlAssert(terminal.rows.get(headKey) === rawHead && terminal.rows.get(catalogKey) === (before.get(catalogKey) ?? null) && terminal.rows.get(successor) === null, 'creative_control_fence_roots')
  const immutable = new Map([...before].filter(([key]) => key.startsWith(prefix + 'v4:'))), count = Math.ceil(immutable.size / 32)
  const batches = trace.slice(-(count + 1), -1), matched = new Set<string>()
  controlAssert(batches.length === count)
  for (const batch of batches) {
    controlAssert(batch.keys.length <= 33 && batch.rows.get(headKey) === rawHead)
    for (const key of batch.keys) if (key !== headKey) { controlAssert(immutable.has(key) && batch.rows.get(key) === immutable.get(key) && !matched.has(key), 'creative_control_fence_row'); matched.add(key) }
  }
  controlAssert(matched.size === immutable.size, 'creative_control_fence_coverage')
  return { keys: immutable.size + 3, bytes: [...immutable, [headKey, rawHead], [catalogKey, before.get(catalogKey) ?? '']].reduce((n, [k, v]) => n + byteOracle(k!) + byteOracle(v!), 0) }
}
export async function fillCreativePositive(row: CreativePositiveRow, snapshot: CreativeSnapshot, http: CreativeHttpObservation, rawRows?: ReadonlyMap<string, string>, verifyProvenance = true) {
  const cp = snapshot.checkpoint, s = cp.storage
  const receipts: CreativeReceipt[] = rawRows ? [...rawRows].filter(([key]) => key.startsWith(`writer-campaign:${encodeURIComponent(snapshot.manifest.campaignId)}:v4:receipt:`)).map(([, value]) => JSON.parse(value)) : [snapshot.receipt]
  row.finalCheckpointHash = cp.hash; row.observation = 'last_verified'
  Object.assign(row.metrics, { attempts: cp.budget.attempts, acceptedTasks: cp.tasks.filter(t => t.status === 'accepted').length, acceptedBodies: cp.tasks.filter(t => t.taskId.startsWith('b-') && t.status === 'accepted').length, httpAttempts: http.attempts, operations: cp.budget.operations, activeReservationMs: cp.budget.activeMs, writtenBytes: storageCounterOracle(s.writtenBytes), allocatedBytes: storageCounterOracle(s.allocatedBytes), consumedBytes: storageCounterOracle(s.allocationConsumedBytes), releasedBytes: storageCounterOracle(s.releasedBytes), outstandingBytes: storageCounterOracle(s.outstandingBytes), recoveryBytes: storageCounterOracle(s.recoveryRemainingBytes) })
  row.obligations = []
  for (const index of cp.requests) {
    const phase = snapshot.phases.get(index.phaseHash)!, request = snapshot.requests.get(index.requestHash)!
    controlAssert(phase && request)
    const response = phase.responseHash ? snapshot.responses.get(phase.responseHash) : null
    const artifact = phase.resolution?.artifactHash ? snapshot.artifacts.get(phase.resolution.artifactHash) : null
    // Resolve emits a phase, not a new origin request: event.requestHash is intentionally null.
    const terminalReceipts = receipts.filter(receipt => phase.status === 'resolved' && phase.requestHash === request.hash && receipt.kind === 'resolve' && receipt.event.phaseHash === phase.hash && receipt.campaignId === request.campaignId && receipt.manifestHash === request.manifestHash && receipt.event.requestHash === null && receipt.event.artifactHash === (phase.resolution?.artifactHash ?? null))
    controlAssert(terminalReceipts.length <= 1, 'creative_control_receipt_ambiguous')
    const terminalReceipt = terminalReceipts[0] ?? null
    if (terminalReceipt) {
      const { hash, ...payload } = terminalReceipt
      const prefix = `writer-campaign:${encodeURIComponent(request.campaignId)}:v4:`, rawCheckpoint = rawRows?.get(prefix + `checkpoint:${terminalReceipt.sequence}`)
      const checkpoint = rawRows ? rawCheckpoint ? JSON.parse(rawCheckpoint) : null : snapshot.checkpoint
      controlAssert(hash === await domainOracle('creative-pilot-receipt-v4', payload) && checkpoint?.hash === terminalReceipt.checkpointHash && checkpoint.operationId === terminalReceipt.operationId && checkpoint.requests.some((entry: { requestHash: string; phaseHash: string }) => entry.requestHash === request.hash && entry.phaseHash === phase.hash), 'creative_control_receipt_identity')
      if (rawRows) controlAssert(rawRows.get(prefix + `receipt:${encodeURIComponent(terminalReceipt.operationId)}`) === canonicalOracle(terminalReceipt), 'creative_control_receipt_key')
    }
    const task = row.tasks.find(t => t.id === request.taskId)!, observed = http.records.find(r => r.inputDigest === request.prepared.inputDigest)
    const intent = [...snapshot.phases.values()].find(p => p.requestHash === request.hash && p.status === 'dispatch_intent')
    Object.assign(task, { phase: phase.status, outcome: phase.resolution?.outcome ?? null, resolutionReason: phase.resolution?.reason ?? null, unknownReason: phase.reason, requestHash: request.hash, intentHash: intent?.hash ?? null, responseHash: response?.hash ?? null, artifactHash: artifact?.hash ?? null, receiptHash: terminalReceipt?.hash ?? null, sourceRoot: request.prepared.fullPlanRoot ?? request.prepared.canonBaseRoot ?? request.candidateHash, inputDigest: request.prepared.inputDigest, wireDigest: phase.dispatchWire?.bodyDigest ?? null, wireBytes: phase.dispatchWire?.bodyBytes ?? 0, wireUtf16: phase.dispatchWire?.bodyUtf16 ?? 0, textJsonHash: response?.textJsonHash ?? null, catalogRoot: artifact?.catalogRoot ?? null })
    if (response) Object.assign(task, { rawBytes: response.scalarMetrics?.utf8Bytes ?? null, rawUtf16: response.textUtf16, rawScalars: response.scalarMetrics?.scalars ?? null, finishReason: response.finishReason, reportedModelStatus: response.reportedModel.status, reportedModelHash: response.reportedModel.value ? await hashOracle(response.reportedModel.value) : null, usageStatus: response.usage.status, usageProvenance: response.usage.provenance, inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, reasoningTokens: response.usage.reasoningTokens, stepCount: response.contentEvidence.stepCount, anomalies: [...response.contentEvidence.anomalies] })
    if (artifact) Object.assign(task, { derivedBytes: artifact.raw.utf8Bytes, derivedUtf16: artifact.raw.utf16Units, derivedScalars: artifact.raw.scalars, canonicalScalars: artifact.canonical.scalars })
    row.obligations.push({ requestHash: request.hash, phaseHash: phase.hash, status: phase.status, responseHash: response?.hash ?? null, outcome: phase.resolution?.outcome ?? null, resolutionReason: phase.resolution?.reason ?? null, unknownReason: phase.reason, outstandingBytes: storageCounterOracle(s.openAllocations.find(a => a.request.id === request.id)?.remainingBytes ?? '0000000000000000') })
    if (verifyProvenance && phase.resolution?.outcome === 'accepted') {
      controlAssert(observed && phase.dispatchWire && response && artifact && terminalReceipt)
      controlAssert(observed.inputDigest === request.prepared.inputDigest && observed.bodyDigest === phase.dispatchWire.bodyDigest && observed.bodyBytes === phase.dispatchWire.bodyBytes && observed.bodyUtf16 === phase.dispatchWire.bodyUtf16)
      controlAssert(observed.replyTextJsonHash === response.textJsonHash && response.textJsonHash === await domainOracle('creative-visible-text-json-v1', response.textJson))
      controlAssert(observed.briefDigest === await hashOracle(canonicalOracle(request.prepared.brief)))
      controlAssert(canonicalOracle(observed.previousBodyDigests) === canonicalOracle(await Promise.all(request.prepared.previousBodies.map(p => hashOracle(p.text)))))
      if (artifact.kind === 'chapter_body') { controlAssert(artifact.text === JSON.parse(response.textJson)); const m = await bodyOracle(artifact.text); controlAssert(canonicalOracle(m.raw) === canonicalOracle(artifact.raw) && canonicalOracle(m.canonical) === canonicalOracle(artifact.canonical)) }
    }
  }
}

export async function runCreativePositiveCampaign(input: { id: string; brief: ControlBrief; row: CreativePositiveRow; onProgress?: () => Promise<void>; capturePrefixes?: boolean; identity?: CreativeRuntimeIdentity; coldProcess?: boolean }) {
  const storage = installCreativeNodeStorage(), server = await createCreativeControlServer({ maxAttempts: 9 })
  let engine: CreativePilotEngine | null = null, last: CreativeSnapshot | null = null, coldRead: CreativeColdRead | null = null
  const prefixes: CreativeCapturedPrefix[] = [], row = input.row, ownerStarts = new Map<number, number>(), sdkStarts = new Map<number, number>()
  const campaignId = `creative-positive-${input.id}`, started = performance.now()
  const memory = createCreativeMemoryIO(new Map(), input.capturePrefixes ? (entries, rows) => {
    const records = entries.map(e => JSON.parse(e.value)), receipt = records.find(v => v.protocolVersion === 'creative-pilot-receipt-v4'), phase = records.find(v => v.protocol === 'creative-pilot-phase-v1')
    controlAssert(prefixes.length < 48)
    const cp = records.find(v => v.protocolVersion === 'creative-pilot-checkpoint-v4'), active = cp?.tasks.find((t: any) => t.requestHash === phase?.requestHash)
    prefixes.push({ kind: receipt.kind, sequence: receipt.sequence, taskId: active?.taskId ?? null, phase: phase?.status ?? null, rows: new Map(rows) })
  } : undefined)
  const begin = (id: string) => { row.activeCheck = id }, pass = (id: string) => { row.checks.find(c => c.id === id)!.status = 'pass' }
  const progress = (event: Readonly<CreativeProgressEvent>) => {
    const now = performance.now()
    if (event.taskId && event.kind === 'verifying' && !ownerStarts.has(event.ownerId)) ownerStarts.set(event.ownerId, now)
    if (event.kind === 'reserved') sdkStarts.set(event.ownerId, now)
    // This conservative observed interval includes retention, never discounts SDK setup/guard work.
    if (event.kind === 'response_retained' && sdkStarts.has(event.ownerId)) row.metrics.maxSdkMs = Math.max(row.metrics.maxSdkMs, now - sdkStarts.get(event.ownerId)!)
    if (event.taskId && ['accepted', 'refused', 'blocked', 'authority_revoked', 'stopped'].includes(event.kind) && ownerStarts.has(event.ownerId)) { row.metrics.maxStageMs = Math.max(row.metrics.maxStageMs, now - ownerStarts.get(event.ownerId)!); ownerStarts.delete(event.ownerId) }
  }
  try {
    row.status = 'running'; begin('brief_exact'); row.beforeOrdinaryHash = await rowMapOracle(storage.rows)
    const { createCreativePilotRepository } = await import('../../src/services/writerCampaign/creativePilotStore')
    const { createCreativeOfflineSdkHost } = await import('../../src/services/writerCampaign/creativePilotTransport')
    const { createCreativePilotEngine } = await import('../../src/services/writerCampaign/creativePilotEngine')
    const rawRepository = createCreativePilotRepository({ io: memory.io })
    const repository = {} as CreativeRepository
    for (const name of ['read', 'create', 'replaceBrief', 'commit', 'getReceipt'] as const) (repository as any)[name] = async (...args: any[]) => {
      const before = new Map(memory.rows), start = performance.now(); memory.beginTrace()
      try {
        const result = await (rawRepository[name] as (...a: any[]) => Promise<any>)(...args)
        const trace = memory.endTrace(), id = typeof args[0] === 'string' ? args[0] : args[0].campaignId ?? args[0].manifest.campaignId
        const fence = verifyCreativeFinalFence(before, id, trace)
        if (fence) { row.metrics.finalFenceExpectedKeys = fence.keys; row.metrics.finalFenceObservedKeys = fence.keys; row.metrics.maxCapturedKeys = Math.max(row.metrics.maxCapturedKeys, fence.keys); row.metrics.maxCapturedBytes = Math.max(row.metrics.maxCapturedBytes, fence.bytes) }
        if (result?.snapshot) last = result.snapshot; else if (name === 'read') last = result
        if (last && input.onProgress) { await fillCreativePositive(row, last, server.observe(), memory.rows, false); await input.onProgress() }
        return result
      } finally { memory.endTrace(); const elapsed = performance.now() - start; row.metrics.maxRepositoryActionMs = Math.max(row.metrics.maxRepositoryActionMs, elapsed); if (name === 'read') row.metrics.maxVerifiedReadMs = Math.max(row.metrics.maxVerifiedReadMs, elapsed) }
    }
    const identity = creativeControlIdentity(server.endpoint), config = creativeControlConfiguration(server.endpoint)
    const host = createCreativeOfflineSdkHost({ identity, currentConfigurationRevision: () => identity.configurationRevision, readConfiguration: () => structuredClone(config) })
    engine = createCreativePilotEngine({ repository, host, identity: input.identity ?? { runtimeIdentity: 'creative-pilot-control', source: { commit: null, tree: null } } })
    engine.subscribeProgress(progress)
    const prepared = await engine.prepare({ campaignId, operationId: 'prepare-positive', brief: input.brief })
    controlAssert(canonicalOracle(prepared.candidate.brief) === canonicalOracle(input.brief)); pass('brief_exact')
    const preview = await engine.dryPrepare(campaignId)
    controlAssert(preview.readiness === 'offline_control_ready' && preview.prepared.identity.taskId === 'outline'); pass('single_grant')
    begin('real_sdk_wire')
    const result = await engine.start({ campaignId, operationId: 'start-positive', expectedRawHead: prepared.rawHead, expectedCandidateHash: prepared.candidate.hash })
    last = result
    controlAssert(result.checkpoint.status === 'completed' && server.observe().attempts === 9 && server.observe().errors === 0 && server.observe().blockedExternalRequests === 0 && server.observe().maxActiveRequests === 1 && server.observe().activeRequests === 0)
    pass('real_sdk_wire'); begin('raw_to_compiled'); await fillCreativePositive(row, result, server.observe(), memory.rows); pass('raw_to_compiled')
    begin('nine_task_schedule'); controlAssert(result.checkpoint.tasks.every(t => t.status === 'accepted')); pass('nine_task_schedule')
    begin('planning_closure'); controlAssert(result.artifacts.size === 9 && [...result.artifacts.values()].filter(a => a.kind !== 'chapter_body').length === 6); pass('planning_closure')
    begin('complete_body_prefix'); const third = [...result.requests.values()].find(r => r.taskId === 'b-3')!; controlAssert(third.prepared.previousBodies.length === 2 && canonicalOracle(third.prepared.scope.omittedChapterOutlineOrdinals) === '[1,2]'); pass('complete_body_prefix')
    begin('shared_accounting'); controlAssert(memory.observe().accountingMismatches === 0 && result.checkpoint.budget.activeMs === 550000); pass('shared_accounting')
    begin('cold_reopen'); engine.dispose(); engine = null
    const fresh = createCreativePilotRepository({ io: memory.io }), coldStarted = performance.now(), beforeCold = new Map(memory.rows); memory.beginTrace()
    const reopened = await fresh.read(campaignId), coldTrace = memory.endTrace(), fence = verifyCreativeFinalFence(beforeCold, campaignId, coldTrace)
    row.metrics.maxVerifiedReadMs = Math.max(row.metrics.maxVerifiedReadMs, performance.now() - coldStarted); row.metrics.maxRepositoryActionMs = Math.max(row.metrics.maxRepositoryActionMs, row.metrics.maxVerifiedReadMs)
    controlAssert(reopened && fence && reopened.head.checkpointHash === result.head.checkpointHash && server.observe().attempts === 9); if (input.coldProcess !== false) { const cold = await readCreativeColdProcess(campaignId, memory.rows); coldRead = cold; controlAssert(cold.checkpointHash === result.checkpoint.hash && cold.httpAttempts === 0); row.metrics.maxVerifiedReadMs = Math.max(row.metrics.maxVerifiedReadMs, cold.elapsedMs); row.metrics.maxRepositoryActionMs = Math.max(row.metrics.maxRepositoryActionMs, cold.elapsedMs); row.metrics.maxRawIoMs = Math.max(row.metrics.maxRawIoMs, cold.io.maxRawIoMs) }; row.coldReopen = 'pass'; pass('cold_reopen')
    begin('isolated_readout'); row.afterOrdinaryHash = await rowMapOracle(storage.rows); controlAssert(row.beforeOrdinaryHash === row.afterOrdinaryHash); pass('isolated_readout')
    begin('one_call_terminal'); controlAssert(row.obligations.length === 9 && row.obligations.every(o => o.outstandingBytes === 0)); pass('one_call_terminal')
    begin('honest_scope'); controlAssert(result.manifest.policy.mode === 'sdk_offline_readiness'); pass('honest_scope'); row.status = 'pass'
  } catch (error) {
    row.status = safeCreativeCode(error) === 'deadline_exceeded' ? 'timeout' : 'failed'; row.errorCode = safeCreativeCode(error)
    if (row.activeCheck) row.checks.find(c => c.id === row.activeCheck)!.status = 'fail'
    engine?.stop(campaignId)
    row.observation = 'unconfirmed'
    let verified = false
    try { const { createCreativePilotRepository } = await import('../../src/services/writerCampaign/creativePilotStore'); const snapshot = await createCreativePilotRepository({ io: memory.io }).read(campaignId); if (snapshot) { last = snapshot; verified = true } } catch { /* Raw map below preserves an unconfirmed durable outcome. */ }
    if (last) { try { await fillCreativePositive(row, last, server.observe(), memory.rows, false); row.observation = verified ? 'last_verified' : 'unconfirmed' } catch { row.observation = 'unconfirmed' } }
    const privateRoot = path.resolve(process.env.CREATIVE_PILOT_PRIVATE_DIR ?? 'artifacts/creative-pilot-private')
    await mkdir(privateRoot, { recursive: true, mode: 0o700 }); await writeFile(path.join(privateRoot, `${input.id}-failure-${crypto.randomUUID()}.json`), JSON.stringify({ rows: [...memory.rows] }), { mode: 0o600, flag: 'wx' })
  } finally {
    engine?.dispose(); row.metrics.runWallMs = performance.now() - started
    const m = memory.observe(); if (coldRead) { m.readCalls += coldRead.io.readCalls; m.readBytes += coldRead.io.readBytes; m.maxReadBatchKeys = Math.max(m.maxReadBatchKeys, coldRead.io.maxReadBatchKeys); m.maxReadBatchBytes = Math.max(m.maxReadBatchBytes, coldRead.io.maxReadBatchBytes) }; m.maxRawIoMs = Math.max(m.maxRawIoMs, row.metrics.maxRawIoMs); Object.assign(row.metrics, { readCalls: m.readCalls, readBytes: m.readBytes, casCalls: m.casCalls, successfulCas: m.successfulCas, accountingMismatches: m.accountingMismatches, maxReadBatchKeys: m.maxReadBatchKeys, maxReadBatchBytes: m.maxReadBatchBytes, maxRawIoMs: m.maxRawIoMs, maxCasMs: m.maxCasMs, httpAttempts: server.observe().attempts, activeOwners: ownerStarts.size, activeCalls: server.observe().activeRequests })
    await server.close(); storage.dispose(); await input.onProgress?.()
  }
  return { row, snapshot: last, rows: memory.rows, prefixes, http: server.observe(), io: memory.observe() }
}
