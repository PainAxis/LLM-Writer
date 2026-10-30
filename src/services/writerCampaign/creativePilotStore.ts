/** Fresh v4 full replay. No legacy projection, hidden quota or persistent verification cache. */
import type {
  CreateCreativeCommand, CreativeArtifact, CreativeCandidate, CreativeCheckpoint, CreativeCommitGuard, CreativeCommitResult,
  CreativeEvent, CreativeHead, CreativeManifest, CreativeMutation, CreativeOperationKind, CreativePhase, CreativeReceipt,
  CreativeRepository, CreativeRepositoryOptions, CreativeRequest, CreativeResponse, CreativeSnapshot,
  ReplaceCreativeBriefCommand,
} from '../../types/creativePilot'
import type { CampaignRepositoryIO } from '../../types/writerCampaign'
import { idbCompareAndSwapMany, idbGetMany } from '../blobStore'
import { canonicalStringify, decodeStorageBytes as dec, encodeStorageBytes as enc, hashCampaignValue, utf8Bytes } from './protocol'
import { emptyCampaignStorage } from './storageAccounting'
import {
  CREATIVE_DOMAIN as DOMAIN, CREATIVE_LIMITS as L, CreativePilotError, creativeAssert, creativeEqual as equal, creativeId, creativeInteger,
  creativeRecord, createCreativeCandidate, createCreativeManifest, emptyCreativeBudget, parseCreativeRecord, sealCreativeRecord,
  validateCreativeArtifact, validateCreativeBrief, validateCreativeCandidate, validateCreativeCheckpoint, validateCreativeDispatchWire,
  validateCreativeHead, validateCreativeManifest, validateCreativePhase, validateCreativeReceipt, validateCreativeRequest, validateCreativeResponse,
} from './creativePilotProtocol'
import { applyCreativeStorage } from './creativePilotStorage'
import { compileCreativeInput } from './creativePilotContext'
import { compileCreativeResponse } from './creativePilotCompiler'

const CATALOG = 'writer-campaign:catalog', ZERO_HASH = '0'.repeat(64)
function root(id: string) { creativeId(id); return `writer-campaign:${encodeURIComponent(id)}:` }
export const creativePilotKeys = {
  head: (id: string) => `${root(id)}head`, manifest: (id: string, hash: string) => `${root(id)}v4:manifest:${hash}`,
  candidate: (id: string, hash: string) => `${root(id)}v4:candidate:${hash}`, checkpoint: (id: string, sequence: number) => `${root(id)}v4:checkpoint:${sequence}`,
  receipt: (id: string, operationId: string) => { creativeId(operationId); return `${root(id)}v4:receipt:${encodeURIComponent(operationId)}` },
  request: (id: string, hash: string) => `${root(id)}v4:request:${hash}`, phase: (id: string, hash: string) => `${root(id)}v4:phase:${hash}`,
  response: (id: string, hash: string) => `${root(id)}v4:response:${hash}`, artifact: (id: string, hash: string) => `${root(id)}v4:artifact:${hash}`,
}
type Entry = { key: string; expectedValue: string | null; value: string }
type Records = { candidate: CreativeCandidate | null; request: CreativeRequest | null; phase: CreativePhase | null; response: CreativeResponse | null; artifact: CreativeArtifact | null }
const none = (): Records => ({ candidate: null, request: null, phase: null, response: null, artifact: null })
const eventOf = (r: Records): CreativeEvent => ({ candidateHash: r.candidate?.hash ?? null, requestHash: r.request?.hash ?? null,
  phaseHash: r.phase?.hash ?? null, responseHash: r.response?.hash ?? null, artifactHash: r.artifact?.hash ?? null })
const charge = (rows: readonly { key: string; value: string }[]) => rows.reduce((n, row) => n + utf8Bytes(row.key) + utf8Bytes(row.value), 0)
function catalog(raw: string | null): string[] {
  if (raw === null) return []
  const value = parseCreativeRecord(raw, 8192); creativeRecord(value, ['schemaVersion', 'ids']); creativeAssert(value.schemaVersion === 1 && Array.isArray(value.ids) && value.ids.length <= 32)
  value.ids.forEach(creativeId); creativeAssert(new Set(value.ids).size === value.ids.length); return value.ids as string[]
}
function operationDigest(kind: CreativeOperationKind, command: unknown): Promise<string> { return hashCampaignValue('creative-pilot-operation-v4', { kind, command }) }
function initialCheckpoint(manifest: CreativeManifest, candidate: CreativeCandidate, operationId: string): CreativeCheckpoint {
  return { schemaVersion: 4, protocolVersion: 'creative-pilot-checkpoint-v4', campaignId: manifest.campaignId, manifestHash: manifest.hash,
    sequence: 0, previousHash: null, operationId, candidateHash: candidate.hash, adapter: null, executionEpoch: 0, status: 'prepared', reason: null,
    tasks: manifest.tasks.map(task => ({ taskId: task.id, revision: 0, status: 'pending', requestHash: null, artifactHash: null })), requests: [],
    budget: { ...emptyCreativeBudget(), activeMs: 10000 }, metadata: { createUsed: true, replacementUsed: false, recoveryUsed: 0, cancelUsed: false },
    storage: emptyCampaignStorage(524288), bodyCharacters: 0, lastWallTime: manifest.createdAt, hash: ZERO_HASH }
}
function currentPhase(snapshot: CreativeSnapshot, requestHash: string): { request: CreativeRequest; phase: CreativePhase } {
  const index = snapshot.checkpoint.requests.find(row => row.requestHash === requestHash)
  const request = snapshot.requests.get(requestHash), phase = index && snapshot.phases.get(index.phaseHash)
  creativeAssert(index && request && phase && phase.requestHash === request.hash && phase.revision === index.phaseRevision, 'Request index mismatch')
  return { request, phase }
}
function advance(previous: CreativeSnapshot | null, manifest: CreativeManifest, candidate: CreativeCandidate,
  built: { checkpoint: CreativeCheckpoint; head: CreativeHead; receipt: CreativeReceipt }, records: Records): CreativeSnapshot {
  const artifacts = new Map(previous?.artifacts), requests = new Map(previous?.requests), phases = new Map(previous?.phases), responses = new Map(previous?.responses)
  if (records.artifact) artifacts.set(records.artifact.hash, records.artifact)
  if (records.request) requests.set(records.request.hash, records.request)
  if (records.phase) phases.set(records.phase.hash, records.phase)
  if (records.response) responses.set(records.response.hash, records.response)
  return { manifest, candidate, ...built, artifacts, requests, phases, responses, rawHead: canonicalStringify(built.head) }
}
export function createCreativePilotRepository(options: CreativeRepositoryOptions = {}): CreativeRepository {
  const io: CampaignRepositoryIO = options.io ?? { getMany: idbGetMany, compareAndSwapMany: idbCompareAndSwapMany }
  const clock = options.clock ?? Date.now, monotonic = options.monotonic ?? (() => performance.now())
  function context(external: () => void = () => {}) {
    const deadline = monotonic() + L.repositoryMs
    let open = true, casEntered = false
    const disposers = new Set<() => void>()
    const close = () => {
      open = false
      for (const dispose of disposers) dispose()
      disposers.clear()
    }
    const check = () => { creativeAssert(open, 'Closed creative repository operation', 'cancelled'); external(); if (monotonic() >= deadline) throw new CreativePilotError('deadline_exceeded') }
    async function wait<T>(action: (permit: () => boolean) => Promise<T>): Promise<T> {
      check(); const ioDeadline = Math.min(deadline, monotonic() + L.ioMs); let live = true, timer: ReturnType<typeof setTimeout> | undefined
      const permit = () => { try { check(); return live && monotonic() < ioDeadline } catch { return false } }
      try {
        const result = await Promise.race([Promise.resolve().then(() => { check(); return action(permit) }), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new CreativePilotError(monotonic() >= deadline ? 'deadline_exceeded' : 'operation_timeout')), Math.max(0, ioDeadline - monotonic()))
        })])
        check(); if (monotonic() >= ioDeadline) throw new CreativePilotError('operation_timeout'); return result
      } finally { live = false; if (timer !== undefined) clearTimeout(timer) }
    }
    return { check, wait, close, deadline,
      expired: () => monotonic() >= deadline,
      enterCas: () => { check(); casEntered = true },
      hasEnteredCas: () => casEntered,
      onClose: (dispose: () => void) => { if (open) disposers.add(dispose); else dispose() },
    }
  }
  type Context = ReturnType<typeof context>
  /** The whole public promise is bounded, including stalled asynchronous hashes.
   * Closing first revokes every outstanding IO/CAS permit and clears raw capture;
   * the losing task stays observed and can only unwind through its own finally. */
  async function boundedOperation<T>(ctx: Context, action: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      ctx.check()
      const boundary = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new CreativePilotError(ctx.hasEnteredCas() ? 'storage_unknown' : 'deadline_exceeded')
          ctx.close(); reject(error)
        }, Math.max(0, ctx.deadline - monotonic()))
      })
      const work = Promise.resolve().then(() => { ctx.check(); return action() })
      const result = await Promise.race([work, boundary])
      ctx.check(); return result
    } catch (error) {
      if (ctx.expired() && ctx.hasEnteredCas()) throw new CreativePilotError('storage_unknown')
      throw error
    } finally { ctx.close(); if (timer !== undefined) clearTimeout(timer) }
  }
  async function checkedRead(keys: readonly string[], ctx: Context) {
    creativeAssert(keys.length <= 33 && new Set(keys).size === keys.length)
    const result = await ctx.wait(() => io.getMany(keys)); ctx.check(); return result
  }
  function captureGuard(value: CreativeCommitGuard): CreativeCommitGuard {
    const canCommit = value.canCommit, canPublish = value.canPublish
    creativeAssert(typeof canCommit === 'function' && typeof canPublish === 'function')
    return Object.freeze({ canCommit: () => canCommit(), canPublish: () => canPublish() })
  }
  function guarded(guard: CreativeCommitGuard): () => void { return () => { creativeAssert(guard.canCommit(), 'Creative action no longer owns mutation', 'cancelled') } }
  async function nextPhase(request: CreativeRequest, prior: CreativePhase | null, change: Partial<CreativePhase>): Promise<CreativePhase> {
    const base: Omit<CreativePhase, 'hash'> = prior ? { ...prior, revision: prior.revision + 1, parentHash: prior.hash } : {
      schemaVersion: 1, protocol: 'creative-pilot-phase-v1', campaignId: request.campaignId, requestHash: request.hash, revision: 0, parentHash: null,
      status: 'reserved', intentHash: null, dispatchWire: null, responseHash: null, resolution: null, reason: null }
    if ('hash' in base) delete (base as Partial<CreativePhase>).hash
    return validateCreativePhase(await sealCreativeRecord<CreativePhase>({ ...base, ...change }, DOMAIN.phase))
  }
  async function transition(previous: CreativeSnapshot, mutation: CreativeMutation, at: number, ctx: Context, publication: () => boolean) {
    ctx.check(); creativeInteger(at); creativeAssert(at >= previous.checkpoint.lastWallTime, 'Clock regressed', 'clock_rollback')
    creativeRecord(mutation, ['operationId', 'recovery', 'kind', ...({ reserve: ['request'], dispatch_intent: ['requestHash', 'dispatchWire'], outcome_unknown: ['requestHash', 'reason'], retain_response: ['requestHash', 'response'], resolve: ['requestHash', 'disposition'], cancel: [] } as Record<string, string[]>)[mutation.kind] ?? []])
    creativeId(mutation.operationId); creativeAssert(typeof mutation.recovery === 'boolean')
    const checkpoint = structuredClone(previous.checkpoint), records = none()
    let request: CreativeRequest | null = null, phase: CreativePhase | null = null
    let slot: CreativeReceipt['metadataSlot'] = null
    const active = checkpoint.status !== 'cancelled' && at < previous.manifest.expiresAt
    if (mutation.kind === 'reserve') {
      creativeAssert(!mutation.recovery && active && checkpoint.status === 'prepared', 'Run cannot reserve', 'already_terminal')
      creativeAssert(checkpoint.requests.length < 9 && checkpoint.storage.openAllocations.length === 0, 'Request allowance exhausted', 'attempt_spent')
      request = await validateCreativeRequest(structuredClone(mutation.request)); ctx.check()
      creativeAssert(mutation.operationId === `${request.operationId}:reserve` && request.campaignId === previous.manifest.campaignId && request.manifestHash === previous.manifest.hash && request.candidateHash === previous.candidate.hash)
      const task = checkpoint.tasks.find(t => t.status !== 'accepted')
      creativeAssert(task && task.status === 'pending' && task.taskId === request.taskId && task.revision === request.taskRevision, 'Task is not eligible', 'attempt_spent')
      creativeAssert(!checkpoint.requests.some(r => r.id === request!.id) && at >= request.createdAt && at < request.expiresAt && request.expiresAt === Math.min(request.createdAt + L.stageMs, previous.manifest.expiresAt), 'Request deadline', 'expired')
      const prepared = await compileCreativeInput(previous, request.taskId, ctx.check); ctx.check()
      creativeAssert(equal(request.prepared, prepared) && equal(request.dependencies, prepared.sourceRefs), 'Prepared source mismatch', 'source_changed')
      if (checkpoint.adapter) creativeAssert(equal(checkpoint.adapter, request.adapter), 'Pinned adapter changed', 'configuration_changed')
      else checkpoint.adapter = structuredClone(request.adapter)
      for (const key of Object.keys(checkpoint.budget) as Array<keyof typeof checkpoint.budget>) if (!['inputTokens', 'artifacts', 'operations'].includes(key)) checkpoint.budget[key] = (checkpoint.budget[key] as number) + (request.reservation[key] as number) as never
      phase = await nextPhase(request, null, {}); records.request = request; task.requestHash = request.hash; checkpoint.status = 'running'; checkpoint.reason = null
    } else if (mutation.kind === 'cancel') {
      creativeAssert(!mutation.recovery && checkpoint.status !== 'cancelled' && checkpoint.status !== 'completed' && !checkpoint.metadata.cancelUsed, 'Campaign already terminal', 'already_terminal')
      slot = 'cancel'; checkpoint.metadata.cancelUsed = true; checkpoint.budget.activeMs += 10000; checkpoint.status = 'cancelled'; checkpoint.reason = 'cancelled'; checkpoint.executionEpoch++
      const openRequest = checkpoint.requests.find(row => previous.phases.get(row.phaseHash)!.status !== 'resolved')
      if (openRequest) {
        const found = currentPhase(previous, openRequest.requestHash); request = found.request
        if (found.phase.status === 'reserved') phase = await nextPhase(request, found.phase, { status: 'resolved', resolution: { outcome: 'not_dispatched', reason: 'cancelled', artifactHash: null } })
        else if (found.phase.status === 'dispatch_intent') phase = await nextPhase(request, found.phase, { status: 'outcome_unknown', intentHash: found.phase.hash, reason: 'interrupted' })
      }
    } else {
      const found = currentPhase(previous, mutation.requestHash); request = found.request; const prior = found.phase
      creativeAssert(prior.status !== 'resolved', 'Request is terminal', 'already_terminal')
      if (mutation.kind === 'dispatch_intent') {
        creativeAssert(!mutation.recovery && active && prior.status === 'reserved' && at < request.expiresAt, 'Intent not dispatchable', 'unknown_outcome')
        creativeAssert(mutation.operationId === `${request.operationId}:intent`); validateCreativeDispatchWire(mutation.dispatchWire)
        phase = await nextPhase(request, prior, { status: 'dispatch_intent', dispatchWire: structuredClone(mutation.dispatchWire) })
      } else {
        if (mutation.recovery) { creativeAssert(checkpoint.metadata.recoveryUsed < 3, 'Recovery metadata exhausted', 'metadata_capacity'); checkpoint.metadata.recoveryUsed++; checkpoint.budget.activeMs += 10000; slot = 'recovery' }
        // A still-live original stage may retain an exact completed reply after
        // Cancel through its settlement-only guard. It cannot resolve/publish,
        // renew the origin deadline, or manufacture another unknown phase.
        else creativeAssert(at < request.expiresAt && (checkpoint.status !== 'cancelled' || mutation.kind === 'retain_response'), 'Standalone settlement needs recovery admission', 'metadata_capacity')
        if (mutation.kind === 'outcome_unknown') {
          creativeAssert(prior.status === 'dispatch_intent' && mutation.operationId === `${request.operationId}:unknown`, 'Unknown phase conflict')
          phase = await nextPhase(request, prior, { status: 'outcome_unknown', intentHash: prior.hash, reason: mutation.reason })
          checkpoint.status = 'blocked'; checkpoint.reason = mutation.reason
        } else if (mutation.kind === 'retain_response') {
          creativeAssert(['dispatch_intent', 'outcome_unknown'].includes(prior.status) && mutation.operationId === `${request.operationId}:retain`, 'Retention phase conflict')
          const response = await validateCreativeResponse(structuredClone(mutation.response)), intentHash = prior.status === 'dispatch_intent' ? prior.hash : prior.intentHash!
          creativeAssert(response.campaignId === request.campaignId && response.requestHash === request.hash && response.intentHash === intentHash, 'Response correlation mismatch')
          records.response = response; phase = await nextPhase(request, prior, { status: 'response_retained', intentHash, responseHash: response.hash, reason: null })
        } else {
          creativeAssert((mutation.recovery || mutation.operationId === `${request.operationId}:resolve`) && ['publish_if_valid', 'accounting_only'].includes(mutation.disposition), 'Resolution identity mismatch')
          let resolution: NonNullable<CreativePhase['resolution']>
          if (prior.status === 'reserved') {
            creativeAssert(mutation.disposition === 'accounting_only' || at >= request.expiresAt, 'Reserved origin remains resumable', 'unknown_outcome')
            resolution = { outcome: 'not_dispatched', reason: at >= request.expiresAt ? 'stage_expired_before_intent' : 'closed_before_intent', artifactHash: null }
          } else {
            creativeAssert(prior.status === 'response_retained' && prior.responseHash, 'Unknown outcome cannot settle', 'unknown_outcome')
            const response = previous.responses.get(prior.responseHash); creativeAssert(response, 'Retained response missing')
            if (checkpoint.status === 'cancelled') resolution = { outcome: 'refused', reason: 'cancelled', artifactHash: null }
            else if (at >= previous.manifest.expiresAt) resolution = { outcome: 'refused', reason: 'expired', artifactHash: null }
            else {
              const result = await compileCreativeResponse(previous, request, response, ctx.check); ctx.check()
              if (result.outcome === 'refused') resolution = { outcome: 'refused', reason: result.reason, artifactHash: null }
              else if (mutation.disposition === 'accounting_only') resolution = { outcome: 'authority_revoked', reason: 'authority_revoked', artifactHash: null }
              else { creativeAssert(publication(), 'Creative publication revoked', 'authority_revoked'); records.artifact = await validateCreativeArtifact(result.artifact); resolution = { outcome: 'accepted', reason: null, artifactHash: records.artifact.hash } }
            }
          }
          phase = await nextPhase(request, prior, { status: 'resolved', resolution, reason: null })
          if (checkpoint.status !== 'cancelled') { checkpoint.status = resolution.outcome === 'accepted' ? 'prepared' : 'blocked'; checkpoint.reason = resolution.reason }
        }
      }
    }
    if (phase && request) {
      records.phase = phase
      const index = checkpoint.requests.findIndex(r => r.requestHash === request!.hash)
      const row = { id: request.id, requestHash: request.hash, phaseHash: phase.hash, phaseRevision: phase.revision }
      if (index < 0) checkpoint.requests.push(row); else checkpoint.requests[index] = row
      const task = checkpoint.tasks.find(t => t.taskId === request!.taskId); creativeAssert(task && task.requestHash === request.hash)
      task.status = phase.status === 'resolved' ? phase.resolution!.outcome : phase.status
      task.artifactHash = phase.resolution?.artifactHash ?? null
    }
    if (records.artifact) checkpoint.budget.artifacts++
    if (checkpoint.tasks.every(t => t.status === 'accepted') && checkpoint.status !== 'cancelled') { checkpoint.status = 'completed'; checkpoint.reason = null }
    const artifacts = new Map(previous.artifacts); if (records.artifact) artifacts.set(records.artifact.hash, records.artifact)
    checkpoint.bodyCharacters = checkpoint.tasks.reduce((n, t) => n + (t.status === 'accepted' && t.artifactHash && previous.manifest.tasks.find(s => s.id === t.taskId)!.kind === 'chapter_body' ? artifacts.get(t.artifactHash)!.canonical.scalars : 0), 0)
    checkpoint.lastWallTime = at
    return { checkpoint, records, request, phase, slot }
  }
  async function replacement(previous: CreativeSnapshot, command: ReplaceCreativeBriefCommand, at: number, ctx: Context) {
    ctx.check(); creativeRecord(command, ['operationId', 'brief']); creativeId(command.operationId); validateCreativeBrief(command.brief)
    creativeAssert(at >= previous.checkpoint.lastWallTime, 'Clock regressed', 'clock_rollback')
    creativeAssert(previous.checkpoint.budget.attempts === 0 && !previous.checkpoint.metadata.replacementUsed, 'Brief replacement no longer eligible', 'replacement_after_reservation')
    creativeAssert(at < previous.manifest.expiresAt && previous.checkpoint.status === 'prepared', 'Run is not prepared', 'expired')
    creativeAssert(command.brief.language === previous.manifest.language, 'Language is immutable', 'input_invalid')
    const candidate = await createCreativeCandidate(previous.manifest.campaignId, command.brief, at, previous.candidate)
    const checkpoint = structuredClone(previous.checkpoint)
    checkpoint.candidateHash = candidate.hash; checkpoint.executionEpoch++; checkpoint.metadata.replacementUsed = true; checkpoint.budget.activeMs += 10000
    checkpoint.tasks = checkpoint.tasks.map(t => ({ ...t, revision: 1, status: 'pending', requestHash: null, artifactHash: null }))
    checkpoint.lastWallTime = at
    const records = none(); records.candidate = candidate
    return { checkpoint, records, candidate }
  }
  function fixedRecords(id: string, records: Records): Entry[] {
    const rows: Entry[] = []
    for (const kind of ['candidate', 'request', 'phase', 'response', 'artifact'] as const) {
      const value = records[kind]
      if (value) rows.push({ key: creativePilotKeys[kind](id, value.hash), expectedValue: null, value: canonicalStringify(value) })
    }
    return rows
  }
  async function buildWrite(previous: CreativeSnapshot | null, manifest: CreativeManifest, draft: CreativeCheckpoint, kind: CreativeOperationKind,
    operationId: string, businessDigest: string, records: Records, slot: CreativeReceipt['metadataSlot'], request: CreativeRequest | null,
    phase: CreativePhase | null, createCatalog?: { before: string | null; after: string }) {
    const id = manifest.campaignId, checkpoint = structuredClone(draft)
    checkpoint.sequence = previous ? previous.checkpoint.sequence + 1 : 0
    checkpoint.previousHash = previous?.checkpoint.hash ?? null; checkpoint.operationId = operationId; checkpoint.budget.operations++
    creativeAssert(checkpoint.sequence < L.operations, 'Operation ceiling exceeded', 'budget')
    const priorStorage = previous?.checkpoint.storage ?? emptyCampaignStorage(L.recoveryBytes)
    const fixed = fixedRecords(id, records)
    if (kind === 'create') {
      creativeAssert(!previous && createCatalog && records.candidate)
      fixed.push({ key: creativePilotKeys.manifest(id, manifest.hash), expectedValue: null, value: canonicalStringify(manifest) },
        { key: CATALOG, expectedValue: createCatalog.before, value: createCatalog.after })
    }
    const event = eventOf(records)
    // The event names newly written immutable payloads only. The phase itself
    // carries the exact retained origin identity on every later transition.
    const zero = applyCreativeStorage(manifest, priorStorage, kind, request, phase, 0)
    checkpoint.storage = zero.storage; checkpoint.hash = ZERO_HASH
    const receipt: CreativeReceipt = { schemaVersion: 4, protocolVersion: 'creative-pilot-receipt-v4', campaignId: id, manifestHash: manifest.hash,
      operationId, kind, businessDigest, sequence: checkpoint.sequence, previousHash: previous?.receipt.hash ?? null,
      checkpointHash: ZERO_HASH, event, metadataSlot: slot, serializedBytes: enc(0), storageEffect: zero.effect, hash: ZERO_HASH }
    const head: CreativeHead = { schemaVersion: 4, protocolVersion: 'creative-pilot-head-v4', campaignId: id, manifestHash: manifest.hash,
      sequence: checkpoint.sequence, checkpointHash: ZERO_HASH, receiptId: operationId, candidateHash: checkpoint.candidateHash,
      executionEpoch: checkpoint.executionEpoch, status: checkpoint.status }
    const entriesFor = (): Entry[] => [...fixed,
      { key: creativePilotKeys.checkpoint(id, checkpoint.sequence), expectedValue: null, value: canonicalStringify(checkpoint) },
      { key: creativePilotKeys.receipt(id, operationId), expectedValue: null, value: canonicalStringify(receipt) },
      { key: creativePilotKeys.head(id), expectedValue: previous?.rawHead ?? null, value: canonicalStringify(head) }]
    const measured = charge(entriesFor()), paid = applyCreativeStorage(manifest, priorStorage, kind, request, phase, measured)
    checkpoint.storage = paid.storage
    const { hash: _checkpointHash, ...cp } = checkpoint
    checkpoint.hash = (await sealCreativeRecord<CreativeCheckpoint>(cp, DOMAIN.checkpoint)).hash
    receipt.checkpointHash = checkpoint.hash; receipt.serializedBytes = enc(measured); receipt.storageEffect = paid.effect
    const { hash: _receiptHash, ...rp } = receipt
    receipt.hash = (await sealCreativeRecord<CreativeReceipt>(rp, DOMAIN.receipt)).hash; head.checkpointHash = checkpoint.hash
    const entries = entriesFor(); creativeAssert(charge(entries) === measured, 'Frozen serialization charge changed')
    let metadataBytes = 0
    for (const row of entries) {
      const bytes = charge([row]); creativeAssert(bytes <= L.recordBytes, 'Record ceiling exceeded', 'retention_capacity')
      const payload = ['request', 'response', 'artifact'].some(k => row.key.includes(`:v4:${k}:`))
      if (payload) creativeAssert(bytes <= L.originBytes, 'Payload envelope exceeded', 'retention_capacity')
      else metadataBytes += bytes
    }
    creativeAssert(kind === 'create' ? measured <= L.createBytes : metadataBytes <= L.metadataBytes, 'Metadata envelope exceeded', 'budget')
    await validateCreativeCheckpoint(checkpoint); await validateCreativeReceipt(receipt); validateCreativeHead(head)
    return { checkpoint, receipt, head, entries }
  }
  async function replay(id: string, ctx: Context) {
    creativeId(id)
    const headKey = creativePilotKeys.head(id), discovery = await checkedRead([headKey, CATALOG], ctx)
    const rawHead = discovery.get(headKey) ?? null, rawCatalog = discovery.get(CATALOG) ?? null, ids = catalog(rawCatalog)
    if (rawHead === null) { creativeAssert(!ids.includes(id), 'Catalog head missing'); return null }
    const parsedHead = parseCreativeRecord(rawHead)
    creativeAssert(parsedHead !== null && typeof parsedHead === 'object' && 'schemaVersion' in parsedHead && parsedHead.schemaVersion === 4, 'Not a v4 creative campaign', 'unsupported_schema')
    const head = validateCreativeHead(parsedHead as CreativeHead)
    creativeAssert(head.campaignId === id && ids.includes(id), 'Head/catalog identity mismatch')
    const capture = new Map<string, string>(), expectedKeys = new Set<string>(), receipts = new Map<string, CreativeReceipt>()
    let snapshot: CreativeSnapshot | null = null
    const dispose = () => {
      capture.clear(); expectedKeys.clear(); receipts.clear()
      if (snapshot) {
        snapshot.requests.clear(); snapshot.phases.clear(); snapshot.responses.clear()
        const artifacts = snapshot.artifacts as Map<string, CreativeArtifact>
        artifacts.clear()
      }
    }
    ctx.onClose(dispose)
    let capturedBytes = charge([{ key: headKey, value: rawHead }, { key: CATALOG, value: rawCatalog! }])
    async function raw(key: string, maximum: number = L.recordBytes): Promise<string> {
      ctx.check(); expectedKeys.add(key)
      creativeAssert(expectedKeys.size + 3 <= L.observedKeys, 'Closed history inventory exceeded', 'retention_capacity')
      const cached = capture.get(key)
      if (cached !== undefined) return cached
      const rows = await checkedRead([key, headKey], ctx)
      creativeAssert(rows.get(headKey) === rawHead, 'Campaign moved during replay', 'source_changed')
      const value = rows.get(key)
      creativeAssert(typeof value === 'string', 'Missing immutable creative record')
      const bytes = charge([{ key, value }]); creativeAssert(bytes <= maximum, 'Creative capture record capacity', 'retention_capacity')
      capturedBytes += bytes; creativeAssert(capturedBytes <= L.storageBytes, 'Read-local capture capacity', 'retention_capacity')
      capture.set(key, value); return value
    }
    async function record<T>(key: string, validate: (v: T) => T | Promise<T>, maximum: number = L.recordBytes): Promise<T> {
      const value = await validate(parseCreativeRecord(await raw(key, maximum), maximum) as T); ctx.check(); return value
    }
    const manifest = await record(creativePilotKeys.manifest(id, head.manifestHash), validateCreativeManifest)
    creativeAssert(manifest.campaignId === id && manifest.hash === head.manifestHash)
    const initialCandidate = await record(creativePilotKeys.candidate(id, manifest.initialCandidateHash), validateCreativeCandidate)
    creativeAssert(initialCandidate.hash === manifest.initialCandidateHash && initialCandidate.campaignId === id && initialCandidate.revision === 0
      && initialCandidate.brief.language === manifest.language && initialCandidate.createdAt === manifest.createdAt)
    creativeAssert(equal(initialCandidate, await createCreativeCandidate(id, initialCandidate.brief, initialCandidate.createdAt)), 'Initial candidate identity differs')
    for (let sequence = 0; sequence <= head.sequence; sequence++) {
      ctx.check()
      const checkpoint = await record(creativePilotKeys.checkpoint(id, sequence), validateCreativeCheckpoint)
      creativeAssert(checkpoint.sequence === sequence && checkpoint.campaignId === id && checkpoint.manifestHash === manifest.hash)
      const receipt = await record(creativePilotKeys.receipt(id, checkpoint.operationId), validateCreativeReceipt)
      creativeAssert(receipt.operationId === checkpoint.operationId && receipt.sequence === sequence && receipt.campaignId === id && receipt.manifestHash === manifest.hash
        && receipt.checkpointHash === checkpoint.hash && !receipts.has(receipt.operationId))
      const records = none(), event = receipt.event
      if (event.candidateHash) records.candidate = await record(creativePilotKeys.candidate(id, event.candidateHash), validateCreativeCandidate)
      if (event.requestHash) records.request = await record(creativePilotKeys.request(id, event.requestHash), validateCreativeRequest, L.originBytes)
      if (event.phaseHash) records.phase = await record(creativePilotKeys.phase(id, event.phaseHash), validateCreativePhase, L.metadataBytes)
      if (event.responseHash) records.response = await record(creativePilotKeys.response(id, event.responseHash), validateCreativeResponse, L.responseRecordBytes)
      if (event.artifactHash) records.artifact = await record(creativePilotKeys.artifact(id, event.artifactHash), validateCreativeArtifact, L.artifactBytes)
      creativeAssert(equal(event, eventOf(records)), 'Event payload identity mismatch')
      let draft: CreativeCheckpoint, derived: Records, candidate: CreativeCandidate, slot: CreativeReceipt['metadataSlot'], request: CreativeRequest | null = null, phase: CreativePhase | null = null
      let command: unknown, creationCatalog: { before: string | null; after: string } | undefined
      if (!snapshot) {
        creativeAssert(receipt.kind === 'create' && sequence === 0 && equal(records.candidate, initialCandidate))
        candidate = initialCandidate; derived = none(); derived.candidate = initialCandidate
        command = { campaignId: id, operationId: receipt.operationId, brief: candidate.brief, identity: { runtimeIdentity: manifest.runtimeIdentity, source: manifest.source } }
        const recreated = await createCreativeManifest(id, candidate, (command as CreateCreativeCommand).identity)
        creativeAssert(equal(recreated, manifest), 'Creation manifest differs')
        draft = initialCheckpoint(manifest, candidate, receipt.operationId); slot = 'create'
        const index = ids.indexOf(id), prefix = ids.slice(0, index)
        creationCatalog = { before: index === 0 ? null : canonicalStringify({ schemaVersion: 1, ids: prefix }), after: canonicalStringify({ schemaVersion: 1, ids: [...prefix, id] }) }
      } else if (receipt.kind === 'replace_brief') {
        creativeAssert(records.candidate, 'Replacement candidate missing')
        command = { operationId: receipt.operationId, brief: records.candidate.brief }
        const result = await replacement(snapshot, command as ReplaceCreativeBriefCommand, checkpoint.lastWallTime, ctx)
        draft = result.checkpoint; derived = result.records; candidate = result.candidate; slot = 'replacement'
      } else {
        creativeAssert(receipt.kind !== 'create', 'Repeated create')
        const base = { operationId: receipt.operationId, recovery: receipt.metadataSlot === 'recovery' }
        let mutation: CreativeMutation
        if (receipt.kind === 'reserve') { creativeAssert(records.request); mutation = { ...base, kind: 'reserve', request: records.request } }
        else if (receipt.kind === 'cancel') mutation = { ...base, kind: 'cancel' }
        else {
          creativeAssert(records.phase, 'Phase event missing')
          const requestHash = records.phase.requestHash
          if (receipt.kind === 'dispatch_intent') { creativeAssert(records.phase.dispatchWire); mutation = { ...base, kind: 'dispatch_intent', requestHash, dispatchWire: records.phase.dispatchWire } }
          else if (receipt.kind === 'outcome_unknown') { creativeAssert(records.phase.reason); mutation = { ...base, kind: 'outcome_unknown', requestHash, reason: records.phase.reason } }
          else if (receipt.kind === 'retain_response') { creativeAssert(records.response); mutation = { ...base, kind: 'retain_response', requestHash, response: records.response } }
          else {
            const first: CreativeMutation = { ...base, kind: 'resolve', requestHash, disposition: 'publish_if_valid' }
            const second: CreativeMutation = { ...first, disposition: 'accounting_only' }
            mutation = await operationDigest('resolve', first) === receipt.businessDigest ? first : second
          }
        }
        command = mutation
        const result = await transition(snapshot, mutation, checkpoint.lastWallTime, ctx, () => true)
        draft = result.checkpoint; derived = result.records; candidate = snapshot.candidate; slot = result.slot; request = result.request; phase = result.phase
      }
      creativeAssert(await operationDigest(receipt.kind, command) === receipt.businessDigest, 'Business receipt mismatch')
      creativeAssert(equal(derived, records), 'Historical transition payload differs')
      const built = await buildWrite(snapshot, manifest, draft, receipt.kind, receipt.operationId, receipt.businessDigest, derived, slot, request, phase, creationCatalog)
      ctx.check(); creativeAssert(equal(built.checkpoint, checkpoint) && equal(built.receipt, receipt), 'Historical transition/accounting mismatch')
      for (const row of built.entries) if (row.key !== headKey && row.key !== CATALOG) creativeAssert(capture.get(row.key) === row.value, 'Historical raw write mismatch')
      snapshot = advance(snapshot, manifest, candidate, built, derived); receipts.set(receipt.operationId, receipt)
    }
    creativeAssert(snapshot && snapshot.rawHead === rawHead, 'Final head differs from replay')
    creativeAssert(capture.size === expectedKeys.size && [...expectedKeys].every(key => capture.has(key)), 'Incomplete captured immutable set')
    creativeAssert(charge([...capture].map(([key, value]) => ({ key, value }))) <= dec(snapshot.checkpoint.storage.writtenBytes), 'Immutable history exceeds verified W')
    const successorKey = creativePilotKeys.checkpoint(id, head.sequence + 1)
    const fence = async () => {
      ctx.check(); const keys = [...expectedKeys]
      for (let start = 0; start < keys.length; start += 32) {
        const batch = keys.slice(start, start + 32), rows = await checkedRead([...batch, headKey], ctx)
        creativeAssert(rows.get(headKey) === rawHead, 'Head changed at final raw fence', 'source_changed')
        for (const key of batch) creativeAssert(rows.get(key) === capture.get(key), 'Immutable raw changed at final fence', 'source_changed')
      }
      const final = await checkedRead([headKey, CATALOG, successorKey], ctx)
      creativeAssert(final.get(headKey) === rawHead && final.get(CATALOG) === rawCatalog && (final.get(successorKey) ?? null) === null, 'Final head/catalog/successor fence changed', 'source_changed')
      ctx.check()
    }
    await fence()
    return { snapshot, receipts, fence, dispose }
  }
  async function persist(built: Awaited<ReturnType<typeof buildWrite>>, ctx: Context, guard: CreativeCommitGuard): Promise<void> {
    let entered = false
    try {
      const committed = await ctx.wait(permit => {
        ctx.enterCas(); entered = true
        return io.compareAndSwapMany(built.entries, () => permit() && (!built.receipt.event.artifactHash || guard.canPublish()))
      })
      creativeAssert(committed, 'Creative head or immutable target changed', 'conflict')
    } catch (error) {
      if (entered && !(error instanceof CreativePilotError && error.code === 'conflict')) throw new CreativePilotError('storage_unknown')
      throw error
    }
  }
  async function read(id: string, check?: () => void): Promise<CreativeSnapshot | null> {
    const ctx = context(check); let verified: Awaited<ReturnType<typeof replay>> = null
    return boundedOperation(ctx, async () => {
      try { verified = await replay(id, ctx); ctx.check(); return verified ? structuredClone(verified.snapshot) : null }
      finally { verified?.dispose() }
    })
  }
  async function getReceipt(id: string, operationId: string, check?: () => void): Promise<CreativeReceipt | null> {
    creativeId(operationId); const ctx = context(check); let verified: Awaited<ReturnType<typeof replay>> = null
    return boundedOperation(ctx, async () => {
      try { verified = await replay(id, ctx); ctx.check(); return structuredClone(verified?.receipts.get(operationId) ?? null) }
      finally { verified?.dispose() }
    })
  }
  async function create(input: CreateCreativeCommand, suppliedGuard: CreativeCommitGuard): Promise<CreativeCommitResult> {
    const guard = captureGuard(suppliedGuard), ctx = context(guarded(guard)), command = structuredClone(input); let verified: Awaited<ReturnType<typeof replay>> = null
    return boundedOperation(ctx, async () => {
      try {
        creativeRecord(command, ['campaignId', 'operationId', 'brief', 'identity']); creativeId(command.campaignId); creativeId(command.operationId); validateCreativeBrief(command.brief)
        creativeRecord(command.identity, ['runtimeIdentity', 'source'])
        const digest = await operationDigest('create', command); ctx.check()
        verified = await replay(command.campaignId, ctx)
        if (verified) {
          const receipt = verified.receipts.get(command.operationId)
          creativeAssert(receipt?.kind === 'create' && receipt.businessDigest === digest, 'Campaign already exists', 'operation_conflict')
          return structuredClone({ snapshot: verified.snapshot, receipt, replayed: true })
        }
        const values = await checkedRead([creativePilotKeys.head(command.campaignId), CATALOG], ctx), rawCatalog = values.get(CATALOG) ?? null, ids = catalog(rawCatalog)
        creativeAssert((values.get(creativePilotKeys.head(command.campaignId)) ?? null) === null && !ids.includes(command.campaignId), 'Campaign creation conflict', 'conflict')
        creativeAssert(ids.length < 32, 'Campaign catalog full', 'budget')
        const at = clock(); creativeInteger(at)
        const candidate = await createCreativeCandidate(command.campaignId, command.brief, at), manifest = await createCreativeManifest(command.campaignId, candidate, command.identity)
        const records = none(); records.candidate = candidate
        const built = await buildWrite(null, manifest, initialCheckpoint(manifest, candidate, command.operationId), 'create', command.operationId, digest, records, 'create', null, null,
          { before: rawCatalog, after: canonicalStringify({ schemaVersion: 1, ids: [...ids, command.campaignId] }) })
        await persist(built, ctx, guard); ctx.check()
        return structuredClone({ snapshot: advance(null, manifest, candidate, built, records), receipt: built.receipt, replayed: false })
      } finally { verified?.dispose() }
    })
  }
  async function mutate(expected: CreativeSnapshot, input: CreativeMutation | ReplaceCreativeBriefCommand, suppliedGuard: CreativeCommitGuard, replacing: boolean): Promise<CreativeCommitResult> {
    // Only identities are read from caller-owned snapshots. Maps and nested source
    // objects never become a trusted input to replay or mutation.
    const guard = captureGuard(suppliedGuard), ctx = context(guarded(guard))
    const id = expected.manifest.campaignId, expectedHead = expected.rawHead, command = structuredClone(input); let verified: Awaited<ReturnType<typeof replay>> = null
    return boundedOperation(ctx, async () => {
      try {
        const kind = replacing ? 'replace_brief' : (command as CreativeMutation).kind, digest = await operationDigest(kind, command)
        verified = await replay(id, ctx); creativeAssert(verified, 'Campaign missing', 'conflict')
        const previous = verified.snapshot, found = verified.receipts.get(command.operationId)
        if (found) {
          creativeAssert(found.kind === kind && found.businessDigest === digest, 'Operation identifier reused', 'operation_conflict')
          ctx.check(); return structuredClone({ snapshot: previous, receipt: found, replayed: true })
        }
        creativeAssert(expectedHead === previous.rawHead, 'Expected creative head changed', 'conflict')
        const at = clock(); creativeInteger(at)
        let built: Awaited<ReturnType<typeof buildWrite>>, records: Records, candidate = previous.candidate
        if (replacing) {
          const result = await replacement(previous, command as ReplaceCreativeBriefCommand, at, ctx); records = result.records; candidate = result.candidate
          built = await buildWrite(previous, previous.manifest, result.checkpoint, kind, command.operationId, digest, records, 'replacement', null, null)
        } else {
          const result = await transition(previous, command as CreativeMutation, at, ctx, () => guard.canPublish()); records = result.records
          built = await buildWrite(previous, previous.manifest, result.checkpoint, kind, command.operationId, digest, records, result.slot, result.request, result.phase)
        }
        await verified.fence(); await persist(built, ctx, guard); ctx.check()
        return structuredClone({ snapshot: advance(previous, previous.manifest, candidate, built, records), receipt: built.receipt, replayed: false })
      } finally { verified?.dispose() }
    })
  }
  return { read, create, getReceipt,
    replaceBrief: (expected, command, guard) => mutate(expected, command, guard, true),
    commit: (expected, mutation, guard) => mutate(expected, mutation, guard, false) }
}
