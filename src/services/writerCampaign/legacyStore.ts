/** Read-only v1 verifier. No write/CAS path is exported. */
import { idbGetMany } from '../blobStore'
import type {
  CampaignArtifact, CampaignCheckpoint, CampaignHead,
  CampaignManifest, CampaignReceipt, CampaignRepository, CampaignRepositoryIO,
  CampaignRequest, CampaignSnapshot, CampaignState,
} from './legacyTypes'
import {
  CAMPAIGN_BUDGET_KEYS, CAMPAIGN_LIMITS, CampaignProtocolError,
  campaignAssert, campaignId, campaignInteger, campaignRecord, canonicalStringify,
  parseCampaignRecord,
  validateCampaignArtifact, validateCampaignCheckpoint, validateCampaignHead, validateCampaignManifest,
  validateCampaignReceipt, validateCampaignRequest,
} from './legacyProtocol'

export const CAMPAIGN_KEY_PREFIX = 'writer-campaign:'
export const CAMPAIGN_CATALOG_KEY = `${CAMPAIGN_KEY_PREFIX}catalog`
export const campaignKeys = {
  head: (id: string) => `${root(id)}head`,
  manifest: (id: string, hash: string) => `${root(id)}manifest:${hash}`,
  checkpoint: (id: string, sequence: number) => `${root(id)}checkpoint:${sequence}`,
  receipt: (id: string, operationId: string) => { campaignId(operationId); return `${root(id)}receipt:${encodeURIComponent(operationId)}` },
  artifact: (id: string, taskId: string, revision: number) => { campaignId(taskId); return `${root(id)}artifact:${encodeURIComponent(taskId)}:${revision}` },
  request: (id: string, requestId: string, revision: number) => { campaignId(requestId); return `${root(id)}request:${encodeURIComponent(requestId)}:${revision}` },
}
function root(id: string): string { campaignId(id); return `${CAMPAIGN_KEY_PREFIX}${encodeURIComponent(id)}:` }
function same(a: unknown, b: unknown): boolean { return canonicalStringify(a) === canonicalStringify(b) }
function catalog(raw: string | null): string[] {
  if (raw === null) return []
  const value = parseCampaignRecord(raw)
  campaignAssert(value !== null && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 1, 'Unsupported Campaign catalog; bytes preserved', 'unsupported_schema')
  campaignRecord(value, ['schemaVersion', 'ids'], 'catalog')
  const record = value as Record<string, unknown>
  campaignAssert(Array.isArray(record.ids) && record.ids.length <= CAMPAIGN_LIMITS.campaigns, 'Invalid catalog bound')
  record.ids.forEach(campaignId)
  campaignAssert(new Set(record.ids).size === record.ids.length, 'Duplicate Campaign catalog ID')
  return record.ids as string[]
}
function counterSum(a: number, b: number): number { const result = a + b; campaignInteger(result); return result }
function headMatches(head: CampaignHead, checkpoint: CampaignCheckpoint, receipt: CampaignReceipt): void {
  campaignAssert(head.campaignId === checkpoint.campaignId && head.campaignId === receipt.campaignId && head.sequence === checkpoint.sequence && head.sequence === receipt.sequence && head.manifestHash === checkpoint.manifestHash && head.manifestHash === receipt.manifestHash && head.checkpointHash === checkpoint.hash && head.checkpointHash === receipt.checkpointHash && head.executionEpoch === checkpoint.executionEpoch && head.executionEpoch === receipt.executionEpoch && head.status === checkpoint.status && head.receiptId === checkpoint.operationId && head.receiptId === receipt.operationId, 'Head/checkpoint/receipt identity mismatch')
}
function assertIndex(manifest: CampaignManifest, checkpoint: CampaignState): void {
  campaignAssert(checkpoint.tasks.length === manifest.tasks.length && checkpoint.tasks.every((task, index) => task.taskId === manifest.tasks[index]!.id), 'Task index differs from immutable manifest')
  for (const key of CAMPAIGN_BUDGET_KEYS) campaignAssert(checkpoint.budget[key] <= manifest.budget[key], `Campaign ${key} budget exceeded`, 'budget')
  campaignAssert(checkpoint.budget.serializedBytes <= checkpoint.budget.storageReservedBytes, 'Serialized payload exceeds its persisted reservation', 'budget')
}
function assertActiveRefs(manifest: CampaignManifest, checkpoint: CampaignCheckpoint | CampaignState, artifacts: Map<string, CampaignArtifact>, requests: Map<string, CampaignRequest>): number {
  let body = 0
  for (const task of checkpoint.tasks) {
    const spec = manifest.tasks.find(item => item.id === task.taskId)!
    if (task.request) {
      const request = requests.get(task.request.hash)
      campaignAssert(request && request.campaignId === manifest.campaignId && request.taskId === task.taskId && request.taskRevision === task.revision && request.id === task.request.id && request.revision === task.request.revision, 'Task request identity mismatch')
      campaignAssert(request.status === task.status, 'Task/request status mismatch')
    }
    if (task.priorArtifact) {
      const prior = artifacts.get(task.priorArtifact.hash)
      campaignAssert(prior && prior.campaignId === manifest.campaignId && prior.taskId === task.taskId && prior.revision === task.priorArtifact.revision && prior.taskRevision < task.revision, 'Prior artifact lineage mismatch')
    }
    if (task.artifact) {
      const artifact = artifacts.get(task.artifact.hash)
      campaignAssert(artifact && artifact.campaignId === manifest.campaignId && artifact.taskId === task.taskId && artifact.taskRevision === task.revision && artifact.kind === spec.kind && artifact.revision === task.artifact.revision, 'Task artifact identity mismatch')
      const dependencies = spec.dependsOn.map(id => checkpoint.tasks.find(item => item.taskId === id)!.artifact)
      campaignAssert(dependencies.every(Boolean) && same(artifact.dependencies, dependencies), 'Artifact dependencies are missing or stale')
      if (task.request) campaignAssert(requests.get(task.request.hash)!.response?.text === artifact.text, 'Accepted text differs from retained exact response')
      if (spec.kind === 'chapter_body') body = counterSum(body, artifact.canonical.scalars)
    }
    if (['reserved', 'dispatch_intent', 'response_retained', 'committed'].includes(task.status)) {
      campaignAssert(spec.dependsOn.every(id => checkpoint.tasks.find(item => item.taskId === id)!.status === 'committed'), 'Executable task has unmet dependencies')
    }
  }
  return body
}

/** Reads and commits use only the dedicated Campaign namespace. No fallback storage. */
export function createLegacyCampaignInspector(io: Pick<CampaignRepositoryIO, 'getMany'> = { getMany: idbGetMany }): Pick<CampaignRepository, 'list' | 'read' | 'getReceipt' | 'getOperationArtifacts'> {
  async function readRecord(key: string): Promise<string | null> { return (await io.getMany([key])).get(key) ?? null }
  async function list(): Promise<string[]> { return catalog(await readRecord(CAMPAIGN_CATALOG_KEY)) }

  async function getReceipt(campaignIdValue: string, operationId: string): Promise<CampaignReceipt | null> {
    const key = campaignKeys.receipt(campaignIdValue, operationId)
    const raw = await readRecord(key)
    if (raw === null) return null
    const receipt = await validateCampaignReceipt(parseCampaignRecord(raw))
    campaignAssert(receipt.campaignId === campaignIdValue && receipt.operationId === operationId, 'Receipt key mismatch')
    const checkpointKey = campaignKeys.checkpoint(campaignIdValue, receipt.sequence)
    const values = await io.getMany([key, checkpointKey])
    campaignAssert(values.get(key) === raw, 'Receipt changed during verification')
    const checkpoint = await validateCampaignCheckpoint(parseCampaignRecord(values.get(checkpointKey) ?? null))
    campaignAssert(checkpoint.hash === receipt.checkpointHash && checkpoint.operationId === receipt.operationId && checkpoint.campaignId === receipt.campaignId && checkpoint.manifestHash === receipt.manifestHash && checkpoint.sequence === receipt.sequence && checkpoint.executionEpoch === receipt.executionEpoch, 'Receipt lacks matching immutable commit evidence')
    return receipt
  }

  async function getOperationArtifacts(campaignIdValue: string, operationId: string): Promise<CampaignArtifact[] | null> {
    const receipt = await getReceipt(campaignIdValue, operationId)
    if (!receipt) return null
    const checkpoint = await validateCampaignCheckpoint(parseCampaignRecord(await readRecord(campaignKeys.checkpoint(campaignIdValue, receipt.sequence))))
    campaignAssert(checkpoint.hash === receipt.checkpointHash, 'Operation checkpoint changed')
    const refs = checkpoint.tasks.flatMap(task => [task.artifact, task.priorArtifact].filter((ref): ref is NonNullable<typeof ref> => ref !== null))
    const result: CampaignArtifact[] = []
    for (const hash of receipt.artifactHashes) {
      const ref = refs.find(item => item.hash === hash)
      campaignAssert(ref, 'Operation artifact absent from its checkpoint')
      const artifact = await validateCampaignArtifact(parseCampaignRecord(await readRecord(campaignKeys.artifact(campaignIdValue, ref.taskId, ref.revision))))
      campaignAssert(artifact.hash === hash && artifact.campaignId === campaignIdValue && artifact.taskId === ref.taskId && artifact.revision === ref.revision, 'Operation artifact identity mismatch')
      result.push(artifact)
    }
    return result
  }

  async function read(campaignIdValue: string): Promise<CampaignSnapshot | null> {
    const headKey = campaignKeys.head(campaignIdValue)
    // Retry only a concurrently advanced head, never corrupt records. Immutable
    // records are checked again with the head in one final committed snapshot.
    for (let retry = 0; retry < 4; retry++) {
      const discovery = await io.getMany([headKey, CAMPAIGN_CATALOG_KEY])
      const rawHead = discovery.get(headKey) ?? null
      const ids = catalog(discovery.get(CAMPAIGN_CATALOG_KEY) ?? null)
      if (rawHead === null) {
        campaignAssert(!ids.includes(campaignIdValue), 'Catalog Campaign has no head; stored bytes preserved')
        return null
      }
      campaignAssert(ids.includes(campaignIdValue), 'Campaign head is absent from its catalog; stored bytes preserved')
      const head = validateCampaignHead(parseCampaignRecord(rawHead))
      campaignAssert(head.campaignId === campaignIdValue, 'Head key mismatch')
      const manifestKey = campaignKeys.manifest(campaignIdValue, head.manifestHash)
      const checkpointKey = campaignKeys.checkpoint(campaignIdValue, head.sequence)
      const receiptKey = campaignKeys.receipt(campaignIdValue, head.receiptId)
      const successorKey = campaignKeys.checkpoint(campaignIdValue, head.sequence + 1)
      const values = await io.getMany([headKey, manifestKey, checkpointKey, receiptKey, successorKey])
      if (values.get(headKey) !== rawHead) continue
      campaignAssert(values.get(successorKey) == null, 'Campaign head sequence rolled back behind an immutable checkpoint; stored bytes preserved')
      const manifest = await validateCampaignManifest(parseCampaignRecord(values.get(manifestKey) ?? null))
      const checkpoint = await validateCampaignCheckpoint(parseCampaignRecord(values.get(checkpointKey) ?? null))
      const receipt = await validateCampaignReceipt(parseCampaignRecord(values.get(receiptKey) ?? null))
      campaignAssert(manifest.campaignId === campaignIdValue && manifest.hash === head.manifestHash, 'Manifest key mismatch')
      headMatches(head, checkpoint, receipt); assertIndex(manifest, checkpoint)
      campaignAssert(checkpoint.budget.operations === head.sequence + 1, 'Operation count differs from checkpoint sequence')
      // Immutable records are create-only. Every bounded read includes the actual
      // head; if it moves, restart rather than joining revisions from two commits.
      // Do not retain a second full raw copy of history or narrative content.
      let moved = false
      async function guarded(keys: string[]): Promise<Map<string, string | null>> {
        campaignAssert(keys.length <= 32, 'Internal read batch exceeded its bound')
        const result = await io.getMany([headKey, ...keys])
        if (result.get(headKey) !== rawHead) moved = true
        return result
      }
      let previous: CampaignCheckpoint | null = null
      let accumulatedBytes = 0
      const operationIds = new Set<string>()
      for (let from = 0; from <= head.sequence && !moved; from += 32) {
        const sequences = Array.from({ length: Math.min(32, head.sequence - from + 1) }, (_, index) => from + index)
        const keys = sequences.map(sequence => campaignKeys.checkpoint(campaignIdValue, sequence))
        const history = await guarded(keys)
        if (moved) break
        const batch: CampaignCheckpoint[] = []
        for (const [index, sequence] of sequences.entries()) {
          const item = await validateCampaignCheckpoint(parseCampaignRecord(history.get(keys[index]!) ?? null))
          history.delete(keys[index]!)
          campaignAssert(item.sequence === sequence && item.campaignId === campaignIdValue && item.manifestHash === manifest.hash && item.previousHash === (previous?.hash ?? null), 'Broken immutable checkpoint chain')
          campaignAssert(item.executionEpoch >= (previous?.executionEpoch ?? 0) && item.budget.operations === sequence + 1, 'Checkpoint epoch/count regression')
          assertIndex(manifest, item)
          if (previous) for (const key of CAMPAIGN_BUDGET_KEYS) campaignAssert(item.budget[key] >= previous.budget[key], 'Checkpoint budget regression')
          campaignAssert(!operationIds.has(item.operationId), 'Operation reused in checkpoint chain')
          operationIds.add(item.operationId); previous = item; batch.push(item)
        }
        const receiptKeys = batch.map(item => campaignKeys.receipt(campaignIdValue, item.operationId))
        const evidenceBatch = await guarded(receiptKeys)
        if (moved) break
        for (const [index, item] of batch.entries()) {
          const evidence = await validateCampaignReceipt(parseCampaignRecord(evidenceBatch.get(receiptKeys[index]!) ?? null))
          campaignAssert(evidence.campaignId === campaignIdValue && evidence.operationId === item.operationId && evidence.sequence === item.sequence && evidence.checkpointHash === item.hash && evidence.manifestHash === manifest.hash && evidence.executionEpoch === item.executionEpoch, 'Broken receipt chain')
          accumulatedBytes = counterSum(accumulatedBytes, evidence.serializedBytes)
          campaignAssert(accumulatedBytes === item.budget.serializedBytes, 'Receipt/checkpoint accounting mismatch')
          evidenceBatch.delete(receiptKeys[index]!)
        }
      }
      if (moved) continue
      const artifactRefs = checkpoint.tasks.flatMap(task => [task.artifact, task.priorArtifact].filter((ref): ref is NonNullable<typeof ref> => ref !== null))
      const requestRefs = checkpoint.tasks.flatMap(task => task.request ? [task.request] : [])
      const artifacts = new Map<string, CampaignArtifact>()
      const requests = new Map<string, CampaignRequest>()
      for (let from = 0; from < artifactRefs.length && !moved; from += 32) {
        const refs = artifactRefs.slice(from, from + 32)
        const keys = refs.map(ref => campaignKeys.artifact(campaignIdValue, ref.taskId, ref.revision))
        const related = await guarded(keys)
        if (moved) break
        for (const [index, ref] of refs.entries()) {
          const artifact = await validateCampaignArtifact(parseCampaignRecord(related.get(keys[index]!) ?? null))
          campaignAssert(artifact.hash === ref.hash, 'Artifact reference hash mismatch')
          artifacts.set(artifact.hash, artifact); related.delete(keys[index]!)
        }
      }
      for (let from = 0; from < requestRefs.length && !moved; from += 32) {
        const refs = requestRefs.slice(from, from + 32)
        const keys = refs.map(ref => campaignKeys.request(campaignIdValue, ref.id, ref.revision))
        const related = await guarded(keys)
        if (moved) break
        for (const [index, ref] of refs.entries()) {
          const request = await validateCampaignRequest(parseCampaignRecord(related.get(keys[index]!) ?? null))
          campaignAssert(request.hash === ref.hash, 'Request reference hash mismatch')
          requests.set(request.hash, request); related.delete(keys[index]!)
        }
      }
      if (moved) continue
      // Verify immutable revision parents even when prior text is no longer active.
      // Old text is discarded after verification instead of accumulating in Snapshot.
      for (const item of artifacts.values()) {
        let child = item
        for (let revision = child.revision - 1; revision >= 0 && !moved; revision--) {
          const key = campaignKeys.artifact(campaignIdValue, child.taskId, revision)
          const prior = await validateCampaignArtifact(parseCampaignRecord((await guarded([key])).get(key) ?? null))
          campaignAssert(prior.hash === child.parentHash && prior.taskId === child.taskId && prior.campaignId === campaignIdValue && prior.revision === revision, 'Broken artifact revision chain')
          child = prior
        }
      }
      for (const item of requests.values()) {
        let child = item
        for (let revision = child.revision - 1; revision >= 0 && !moved; revision--) {
          const key = campaignKeys.request(campaignIdValue, child.id, revision)
          const prior = await validateCampaignRequest(parseCampaignRecord((await guarded([key])).get(key) ?? null))
          campaignAssert(prior.hash === child.parentHash && prior.id === child.id && prior.campaignId === campaignIdValue && prior.revision === revision, 'Broken request revision chain')
          child = prior
        }
      }
      if (moved) continue
      campaignAssert(assertActiveRefs(manifest, checkpoint, artifacts, requests) === checkpoint.bodyCharacters, 'Canonical body count/index mismatch')
      if (await readRecord(headKey) !== rawHead) continue
      return { manifest, head, checkpoint, receipt, artifacts, requests, rawHead }
    }
    throw new CampaignProtocolError('conflict', 'Campaign changed repeatedly while reading; refresh before acting')
  }

  return { list, read, getReceipt, getOperationArtifacts }
}
