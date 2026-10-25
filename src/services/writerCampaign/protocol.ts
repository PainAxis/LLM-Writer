import type {
  CampaignArtifact, CampaignArtifactRef, CampaignBudget, CampaignCheckpoint, CampaignHead,
  CampaignManifest, CampaignReceipt, CampaignRequest, CampaignRequestRef, CampaignState,
  CampaignTaskKind, CampaignTextMetrics, StorageBytes16, CampaignStorageState, CampaignStorageEffect,
} from '../../types/writerCampaign'

// Bounded local fixture protocol: at most 128 indexed tasks and 2,048 immutable
// checkpoints. 64 KiB/text bounds hash/normalization work; 64 MiB is a serialized
// accounting ceiling, NOT an IndexedDB quota promise or long-form acceptance.
export const CAMPAIGN_LIMITS = Object.freeze({ tasks: 128, operations: 2048, campaigns: 32, textBytes: 65_536, serializedBytes: 67_108_864, recordBytes: 1_048_576, identifier: 128 })
export const CAMPAIGN_BOOTSTRAP_RESERVE_BYTES = 32_768
export const CAMPAIGN_TASK_KINDS: readonly CampaignTaskKind[] = ['outline', 'character_bible', 'detailed_outline', 'chapter_outline', 'chapter_body']
export const CAMPAIGN_BUDGET_KEYS = ['attempts', 'inputBytes', 'inputUtf16', 'outputTokens', 'reasoningTokens', 'responseBytes', 'activeMs', 'artifacts', 'operations'] as const
const STATUSES = ['prepared', 'running', 'paused', 'blocked', 'cancelled', 'completed']
const TASK_STATUSES = ['pending', 'reserved', 'dispatch_intent', 'response_retained', 'committed', 'known_failed', 'outcome_unknown', 'invalidated']
const OPERATIONS = ['create', 'start', 'reserve', 'dispatch_intent', 'retain_response', 'accept_artifact', 'pause', 'resume', 'cancel', 'reconcile', 'replace_candidate', 'block']
const encoder = new TextEncoder()

export class CampaignProtocolError extends Error {
  constructor(public readonly code: 'integrity' | 'unsupported_schema' | 'conflict' | 'operation_conflict' | 'budget' | 'storage_unknown' | 'legacy_read_only', message: string) {
    super(message)
    this.name = 'CampaignProtocolError'
  }
}
export function campaignAssert(condition: unknown, message: string, code: CampaignProtocolError['code'] = 'integrity'): asserts condition {
  if (!condition) throw new CampaignProtocolError(code, message)
}
export function campaignRecord(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  campaignAssert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: expected object`)
  const own = Object.keys(value)
  campaignAssert(own.length === keys.length && keys.every(key => Object.hasOwn(value, key)), `${label}: missing or unexpected fields`)
}
export function campaignInteger(value: unknown, max = Number.MAX_SAFE_INTEGER, min = 0): asserts value is number {
  campaignAssert(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max, 'Invalid bounded integer')
}
export function campaignId(value: unknown): asserts value is string {
  campaignAssert(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value), 'Invalid campaign identifier')
}
function hash(value: unknown): asserts value is string { campaignAssert(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'Missing or invalid SHA-256') }
function choice(value: unknown, allowed: readonly unknown[]): void { campaignAssert(allowed.includes(value), 'Unsupported enum value') }
function shortText(value: unknown, nullable = false): void {
  if (value === null && nullable) return
  campaignAssert(typeof value === 'string' && value.length > 0 && value.length <= 512, 'Invalid bounded text')
  assertScalarText(value)
}
function version(value: unknown): void {
  campaignAssert(value !== null && typeof value === 'object' && 'schemaVersion' in value, 'Missing schema version')
  campaignAssert((value as { schemaVersion: unknown }).schemaVersion === 2, 'Unsupported Campaign schema; stored bytes preserved', 'unsupported_schema')
}
export function assertScalarText(text: string): void {
  campaignAssert(typeof text === 'string', 'Expected text')
  // Stateless native scan: in the absence of any surrogate code unit, every
  // UTF-16 unit is already a Unicode scalar. Keep the original pairing/error
  // loop unchanged for all strings containing surrogates (valid or malformed).
  if (!/[\uD800-\uDFFF]/.test(text)) return
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i)
      campaignAssert(next >= 0xdc00 && next <= 0xdfff, 'Unpaired high surrogate')
    } else campaignAssert(code < 0xdc00 || code > 0xdfff, 'Unpaired low surrogate')
  }
}
export function utf8Bytes(value: string): number { assertScalarText(value); return encoder.encode(value).byteLength }
export function canonicalStringify(value: unknown): string {
  let nodes = 0
  function encode(item: unknown, depth: number): string {
    campaignAssert(++nodes <= 100_000 && depth <= 32, 'Canonical value exceeds bounded complexity')
    if (item === null) return 'null'
    if (typeof item === 'string') { assertScalarText(item); return JSON.stringify(item) }
    if (typeof item === 'boolean') return String(item)
    if (typeof item === 'number') { campaignInteger(item); return String(item) }
    if (Array.isArray(item)) return `[${item.map(entry => encode(entry, depth + 1)).join(',')}]`
    campaignAssert(typeof item === 'object' && item !== null && (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null), 'Non-JSON canonical value')
    return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${encode((item as Record<string, unknown>)[key], depth + 1)}`).join(',')}}`
  }
  return encode(value, 0)
}
export async function hashText(text: string): Promise<string> {
  assertScalarText(text)
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
export async function hashCampaignValue(domain: string, value: unknown): Promise<string> {
  return hashText(canonicalStringify({ domain, value }))
}
export function canonicalCampaignText(text: string): string { assertScalarText(text); return text.replace(/\r\n/g, '\n').normalize('NFC') }
export async function measureCampaignText(text: string): Promise<CampaignTextMetrics> {
  assertScalarText(text)
  return { hash: await hashText(text), utf8Bytes: utf8Bytes(text), utf16Units: text.length, scalars: Array.from(text).length }
}
export function emptyCampaignBudget(): CampaignBudget {
  return { attempts: 0, inputBytes: 0, inputUtf16: 0, outputTokens: 0, reasoningTokens: 0, responseBytes: 0, activeMs: 0, artifacts: 0, operations: 0 }
}
export function validateCampaignBudget(value: unknown): asserts value is CampaignBudget {
  campaignRecord(value, CAMPAIGN_BUDGET_KEYS, 'budget')
  for (const key of CAMPAIGN_BUDGET_KEYS) campaignInteger(value[key])
  campaignInteger(value.operations, CAMPAIGN_LIMITS.operations)
  campaignInteger(value.attempts, CAMPAIGN_LIMITS.operations)
  campaignInteger(value.artifacts, CAMPAIGN_LIMITS.operations)
}
function artifactRef(value: unknown): asserts value is CampaignArtifactRef {
  campaignRecord(value, ['taskId', 'revision', 'hash'], 'artifact reference')
  campaignId(value.taskId); campaignInteger(value.revision, CAMPAIGN_LIMITS.operations); hash(value.hash)
}
function requestRef(value: unknown): asserts value is CampaignRequestRef {
  campaignRecord(value, ['id', 'revision', 'hash'], 'request reference')
  campaignId(value.id); campaignInteger(value.revision, CAMPAIGN_LIMITS.operations); hash(value.hash)
}
function array(value: unknown, max: number): asserts value is unknown[] { campaignAssert(Array.isArray(value) && value.length <= max, 'Invalid bounded array') }
function unique(values: unknown[]): void { campaignAssert(new Set(values).size === values.length, 'Duplicate identity') }
async function verifyHash(value: { hash: string }, domain: string): Promise<void> {
  hash(value.hash)
  const { hash: _hash, ...payload } = value
  campaignAssert(await hashCampaignValue(domain, payload) === value.hash, `${domain}: digest mismatch`)
}
export async function sealCampaignManifest(value: Omit<CampaignManifest, 'hash'>): Promise<CampaignManifest> {
  const result = { ...structuredClone(value), hash: await hashCampaignValue('campaign-manifest-v2', value) }
  return validateCampaignManifest(result)
}
export async function validateCampaignManifest(value: unknown): Promise<CampaignManifest> {
  version(value)
  campaignRecord(value, ['schemaVersion', 'protocolVersion', 'campaignId', 'candidateId', 'language', 'bodyTarget', 'mode', 'adapterId', 'fixtureVersion', 'countingVersion', 'runtimeIdentity', 'source', 'createdAt', 'expiresAt', 'maxRepairRounds', 'maxProviderRetries', 'tasks', 'budget', 'storage', 'hash'], 'manifest')
  choice(value.protocolVersion, ['campaign-v2']); campaignId(value.campaignId); campaignId(value.candidateId)
  choice(value.language, ['zh', 'en']); choice(value.mode, ['offline_fixture']); choice(value.adapterId, ['offline-fixture-v1'])
  choice(value.countingVersion, ['crlf-lf-nfc-scalar-v1']); shortText(value.fixtureVersion); shortText(value.runtimeIdentity)
  campaignRecord(value.bodyTarget, ['unit', 'characters'], 'body target'); choice(value.bodyTarget.unit, ['unicode_scalar']); campaignInteger(value.bodyTarget.characters, 2_000_000, 1)
  campaignRecord(value.source, ['commit', 'tree'], 'source')
  campaignAssert((value.source.commit === null) === (value.source.tree === null), 'Source commit/tree must both be known or both unknown')
  for (const entry of Object.values(value.source)) campaignAssert(entry === null || typeof entry === 'string' && /^[a-f0-9]{40}$/.test(entry), 'Invalid source identity')
  campaignInteger(value.createdAt); campaignInteger(value.expiresAt); campaignAssert(value.expiresAt > value.createdAt, 'Deadline must follow creation')
  choice(value.maxRepairRounds, [0]); choice(value.maxProviderRetries, [0]); validateCampaignBudget(value.budget)
  campaignRecord(value.storage, ['limitBytes', 'recoveryReserveBytes'], 'storage policy')
  const limit = decodeStorageBytes(value.storage.limitBytes), recovery = decodeStorageBytes(value.storage.recoveryReserveBytes)
  campaignAssert(limit <= CAMPAIGN_LIMITS.serializedBytes && recovery <= 524_288, 'Storage policy exceeds unchanged limits', 'budget')
  campaignAssert(value.budget.activeMs >= 170_000, 'Insufficient bootstrap and terminal active-time reserve', 'budget')
  campaignAssert(limit >= CAMPAIGN_BOOTSTRAP_RESERVE_BYTES + recovery, 'Insufficient bootstrap and recovery capacity', 'budget')
  array(value.tasks, CAMPAIGN_LIMITS.tasks); campaignAssert(value.tasks.length >= 5, 'Every real planning/body stage is required')
  campaignAssert(recovery >= 16_384 + value.tasks.length * 1024 + 512 * 128, 'Recovery envelope cannot cover final cancel', 'budget')
  const seen = new Map<string, { kind: CampaignTaskKind; chapterOrdinal: number | null }>()
  const ordinals = new Set<number>()
  for (const task of value.tasks) {
    campaignRecord(task, ['id', 'kind', 'chapterOrdinal', 'dependsOn'], 'task')
    campaignId(task.id); choice(task.kind, CAMPAIGN_TASK_KINDS); array(task.dependsOn, CAMPAIGN_LIMITS.tasks); unique(task.dependsOn)
    campaignAssert(!seen.has(task.id), 'Duplicate task ID')
    const kind = task.kind as CampaignTaskKind
    if (kind.startsWith('chapter_')) campaignInteger(task.chapterOrdinal, 63, 1)
    else campaignAssert(task.chapterOrdinal === null, 'Planning task has no chapter ordinal')
    const dependencies = task.dependsOn.map(id => { campaignId(id); const prior = seen.get(id); campaignAssert(prior, 'Dependency must precede its task'); return prior })
    const required: Record<CampaignTaskKind, CampaignTaskKind[]> = { outline: [], character_bible: ['outline'], detailed_outline: ['outline', 'character_bible'], chapter_outline: ['detailed_outline', 'character_bible'], chapter_body: ['chapter_outline'] }
    for (const predecessor of required[kind]) campaignAssert(dependencies.some(dependency => dependency.kind === predecessor && (predecessor !== 'chapter_outline' || dependency.chapterOrdinal === task.chapterOrdinal)), 'Missing required stage dependency')
    if (kind === 'outline') campaignAssert(dependencies.length === 0 && ![...seen.values()].some(t => t.kind === kind), 'Outline must be the unique root')
    if (kind === 'character_bible' || kind === 'detailed_outline') campaignAssert(![...seen.values()].some(t => t.kind === kind), 'Duplicate planning stage')
    if (kind.startsWith('chapter_')) campaignAssert(![...seen.values()].some(t => t.kind === kind && t.chapterOrdinal === task.chapterOrdinal), 'Duplicate chapter stage')
    if (kind === 'chapter_body' && (task.chapterOrdinal as number) > 1) campaignAssert(dependencies.some(dependency => dependency.kind === 'chapter_body' && dependency.chapterOrdinal === (task.chapterOrdinal as number) - 1), 'Later body requires the preceding body revision')
    if (kind === 'chapter_body') ordinals.add(task.chapterOrdinal as number)
    seen.set(task.id, { kind, chapterOrdinal: task.chapterOrdinal as number | null })
  }
  campaignAssert(CAMPAIGN_TASK_KINDS.every(kind => [...seen.values()].some(t => t.kind === kind)), 'Missing real task kind')
  for (const task of seen.values()) if (task.kind === 'chapter_outline') campaignAssert(ordinals.has(task.chapterOrdinal!), 'Chapter outline needs a body task')
  campaignAssert([...ordinals].sort((a, b) => a - b).every((ordinal, index) => ordinal === index + 1), 'Chapter ordinals must be contiguous')
  await verifyHash(value as unknown as CampaignManifest, 'campaign-manifest-v2')
  return structuredClone(value) as unknown as CampaignManifest
}
export async function sealCampaignArtifact(value: Omit<CampaignArtifact, 'hash' | 'raw' | 'canonical'>): Promise<CampaignArtifact> {
  const payload = { ...structuredClone(value), raw: await measureCampaignText(value.text), canonical: await measureCampaignText(canonicalCampaignText(value.text)) }
  return validateCampaignArtifact({ ...payload, hash: await hashCampaignValue('campaign-artifact-v2', payload) })
}
export async function validateCampaignArtifact(value: unknown): Promise<CampaignArtifact> {
  version(value)
  campaignRecord(value, ['schemaVersion', 'campaignId', 'candidateId', 'taskId', 'taskRevision', 'revision', 'kind', 'dependencies', 'parentHash', 'text', 'raw', 'canonical', 'semanticStatus', 'hash'], 'artifact')
  campaignId(value.campaignId); campaignId(value.candidateId); campaignId(value.taskId); campaignInteger(value.taskRevision, CAMPAIGN_LIMITS.operations); campaignInteger(value.revision, CAMPAIGN_LIMITS.operations)
  choice(value.kind, CAMPAIGN_TASK_KINDS); choice(value.semanticStatus, ['not_reviewed']); array(value.dependencies, CAMPAIGN_LIMITS.tasks)
  value.dependencies.forEach(artifactRef); unique(value.dependencies.map(ref => (ref as CampaignArtifactRef).taskId))
  if (value.parentHash !== null) hash(value.parentHash)
  campaignAssert((value.revision === 0) === (value.parentHash === null), 'Artifact revision needs immutable parent identity')
  campaignAssert(typeof value.text === 'string' && utf8Bytes(value.text) <= CAMPAIGN_LIMITS.textBytes, 'Artifact exceeds text bound')
  for (const [name, text] of [['raw', value.text], ['canonical', canonicalCampaignText(value.text)]] as const) {
    campaignRecord(value[name], ['hash', 'utf8Bytes', 'utf16Units', 'scalars'], 'text metrics')
    campaignAssert(canonicalStringify(value[name]) === canonicalStringify(await measureCampaignText(text)), 'Text metrics/hash mismatch')
  }
  await verifyHash(value as unknown as CampaignArtifact, 'campaign-artifact-v2')
  return structuredClone(value) as unknown as CampaignArtifact
}
export async function sealCampaignRequest(value: Omit<CampaignRequest, 'hash'>): Promise<CampaignRequest> {
  return validateCampaignRequest({ ...structuredClone(value), hash: await hashCampaignValue('campaign-request-v2', value) })
}
export async function validateCampaignRequest(value: unknown): Promise<CampaignRequest> {
  version(value)
  campaignRecord(value, ['schemaVersion', 'campaignId', 'id', 'revision', 'parentHash', 'taskId', 'taskRevision', 'candidateId', 'adapterId', 'inputDigest', 'preparedInput', 'commandId', 'inputBytes', 'inputUtf16', 'status', 'reservation', 'storageAllocationBytes', 'response', 'failureReason', 'hash'], 'request')
  for (const key of ['campaignId', 'id', 'taskId', 'candidateId', 'commandId']) campaignId(value[key])
  campaignInteger(value.revision, CAMPAIGN_LIMITS.operations); campaignInteger(value.taskRevision, CAMPAIGN_LIMITS.operations)
  if (value.parentHash !== null) hash(value.parentHash)
  campaignAssert((value.revision === 0) === (value.parentHash === null), 'Request revision needs parent hash')
  choice(value.adapterId, ['offline-fixture-v1']); hash(value.inputDigest)
  campaignAssert(typeof value.preparedInput === 'string' && utf8Bytes(value.preparedInput) <= CAMPAIGN_LIMITS.textBytes, 'Request input exceeds bound')
  campaignAssert(value.inputDigest === await hashText(value.preparedInput) && value.inputBytes === utf8Bytes(value.preparedInput) && value.inputUtf16 === value.preparedInput.length, 'Request input identity mismatch')
  choice(value.status, TASK_STATUSES.filter(status => status !== 'pending' && status !== 'invalidated')); validateCampaignBudget(value.reservation); shortText(value.failureReason, true)
  decodeStorageBytes(value.storageAllocationBytes)
  campaignAssert((value.status === 'response_retained' || value.status === 'committed') === (value.response !== null), 'Response presence does not match request phase')
  if (value.response !== null) {
    campaignRecord(value.response, ['requestId', 'inputDigest', 'text', 'usage', 'evidenceId'], 'response')
    campaignAssert(value.response.requestId === value.id && value.response.inputDigest === value.inputDigest, 'Response is not bound to its request')
    campaignId(value.response.evidenceId)
    campaignAssert(typeof value.response.text === 'string' && utf8Bytes(value.response.text) <= CAMPAIGN_LIMITS.textBytes, 'Response text exceeds bound')
    campaignRecord(value.response.usage, ['provenance', 'inputTokens', 'outputTokens', 'reasoningTokens'], 'usage')
    choice(value.response.usage.provenance, ['fixture', 'unknown', 'unavailable', 'estimated', 'reported'])
    for (const key of ['inputTokens', 'outputTokens', 'reasoningTokens']) if (value.response.usage[key] !== null) campaignInteger(value.response.usage[key])
  }
  if (value.status === 'response_retained' || value.status === 'committed') campaignAssert(value.response !== null, 'Retained/committed request lacks completion evidence')
  await verifyHash(value as unknown as CampaignRequest, 'campaign-request-v2')
  return structuredClone(value) as unknown as CampaignRequest
}
export function validateCampaignState(value: unknown): asserts value is CampaignState {
  campaignRecord(value, ['status', 'reason', 'executionEpoch', 'candidateId', 'tasks', 'budget', 'storage', 'lastWallTime'], 'state')
  choice(value.status, STATUSES); shortText(value.reason, true); campaignInteger(value.executionEpoch, CAMPAIGN_LIMITS.operations); campaignId(value.candidateId); campaignInteger(value.lastWallTime)
  validateCampaignBudget(value.budget); validateCampaignStorage(value.storage); array(value.tasks, CAMPAIGN_LIMITS.tasks)
  for (const task of value.tasks) {
    campaignRecord(task, ['taskId', 'revision', 'status', 'artifact', 'priorArtifact', 'request'], 'task state')
    campaignId(task.taskId); campaignInteger(task.revision, CAMPAIGN_LIMITS.operations); choice(task.status, TASK_STATUSES)
    if (task.artifact !== null) artifactRef(task.artifact)
    if (task.priorArtifact !== null) artifactRef(task.priorArtifact)
    if (task.request !== null) requestRef(task.request)
    campaignAssert((task.status === 'committed') === (task.artifact !== null), 'Only committed tasks have an active artifact')
    if (!['pending', 'invalidated', 'committed'].includes(task.status as string)) campaignAssert(task.request !== null, 'Active task requires request identity')
  }
  unique(value.tasks.map(task => (task as { taskId: string }).taskId))
}
export async function validateCampaignCheckpoint(value: unknown): Promise<CampaignCheckpoint> {
  version(value)
  campaignRecord(value, ['schemaVersion', 'campaignId', 'sequence', 'manifestHash', 'previousHash', 'operationId', 'bodyCharacters', 'hash', 'status', 'reason', 'executionEpoch', 'candidateId', 'tasks', 'budget', 'storage', 'lastWallTime'], 'checkpoint')
  const { schemaVersion: _schema, campaignId: id, sequence, manifestHash, previousHash, operationId, bodyCharacters, hash: _hash, ...state } = value
  campaignId(id); campaignInteger(sequence, CAMPAIGN_LIMITS.operations - 1); hash(manifestHash); campaignId(operationId); campaignInteger(bodyCharacters, CAMPAIGN_LIMITS.tasks * CAMPAIGN_LIMITS.textBytes)
  if (previousHash !== null) hash(previousHash)
  campaignAssert((sequence === 0) === (previousHash === null), 'Invalid checkpoint predecessor')
  validateCampaignState(state); await verifyHash(value as unknown as CampaignCheckpoint, 'campaign-checkpoint-v2')
  return structuredClone(value) as unknown as CampaignCheckpoint
}
export async function validateCampaignReceipt(value: unknown): Promise<CampaignReceipt> {
  version(value)
  campaignRecord(value, ['schemaVersion', 'campaignId', 'operationId', 'kind', 'businessDigest', 'expectedSequence', 'sequence', 'executionEpoch', 'manifestHash', 'checkpointHash', 'artifactHashes', 'requestHashes', 'serializedBytes', 'storageEffect', 'hash'], 'receipt')
  campaignId(value.campaignId); campaignId(value.operationId); choice(value.kind, OPERATIONS)
  for (const key of ['businessDigest', 'manifestHash', 'checkpointHash']) hash(value[key])
  campaignInteger(value.sequence, CAMPAIGN_LIMITS.operations - 1); campaignInteger(value.executionEpoch, CAMPAIGN_LIMITS.operations); decodeStorageBytes(value.serializedBytes); validateCampaignStorageEffect(value.storageEffect)
  campaignAssert(value.expectedSequence === (value.sequence === 0 ? null : value.sequence - 1), 'Receipt sequence mismatch')
  for (const key of ['artifactHashes', 'requestHashes']) { array(value[key], CAMPAIGN_LIMITS.tasks); (value[key] as unknown[]).forEach(hash); unique(value[key] as unknown[]) }
  await verifyHash(value as unknown as CampaignReceipt, 'campaign-receipt-v2')
  return structuredClone(value) as unknown as CampaignReceipt
}
export function validateCampaignHead(value: unknown): CampaignHead {
  version(value)
  campaignRecord(value, ['schemaVersion', 'campaignId', 'sequence', 'manifestHash', 'checkpointHash', 'executionEpoch', 'status', 'receiptId'], 'head')
  campaignId(value.campaignId); campaignInteger(value.sequence, CAMPAIGN_LIMITS.operations - 1); hash(value.manifestHash); hash(value.checkpointHash); campaignInteger(value.executionEpoch, CAMPAIGN_LIMITS.operations); choice(value.status, STATUSES); campaignId(value.receiptId)
  return structuredClone(value) as unknown as CampaignHead
}
export function parseCampaignRecord(raw: string | null): unknown {
  campaignAssert(typeof raw === 'string' && utf8Bytes(raw) <= CAMPAIGN_LIMITS.recordBytes, 'Missing or oversized Campaign record')
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new CampaignProtocolError('integrity', 'Malformed Campaign record; stored bytes preserved') }
  // Legacy parsing remains in its frozen read-only module. V2 writes have one wire spelling.
  if (parsed !== null && typeof parsed === 'object' && 'schemaVersion' in parsed && parsed.schemaVersion === 2) campaignAssert(canonicalStringify(parsed) === raw, 'Noncanonical Campaign wire record')
  return parsed
}

/** Reject numeric/string mixing and every noncanonical or unsafe wire encoding. */
export function decodeStorageBytes(value: unknown): number {
  campaignAssert(typeof value === 'string' && /^[0-9]{16}$/.test(value), 'Invalid canonical storage bytes')
  const result = Number(value)
  campaignAssert(Number.isSafeInteger(result) && result >= 0 && String(result).padStart(16, '0') === value, 'Unsafe storage bytes')
  return result
}
export function encodeStorageBytes(value: number): StorageBytes16 {
  campaignInteger(value)
  return String(value).padStart(16, '0') as StorageBytes16
}
export function validateCampaignStorage(value: unknown): asserts value is CampaignStorageState {
  campaignRecord(value, ['writtenBytes', 'allocatedBytes', 'allocationConsumedBytes', 'releasedBytes', 'outstandingBytes', 'recoveryRemainingBytes', 'openAllocations'], 'storage state')
  for (const key of ['writtenBytes', 'allocatedBytes', 'allocationConsumedBytes', 'releasedBytes', 'outstandingBytes', 'recoveryRemainingBytes']) decodeStorageBytes(value[key])
  array(value.openAllocations, 128)
  let previous = ''
  for (const row of value.openAllocations) {
    campaignRecord(row, ['request', 'remainingBytes'], 'open allocation')
    requestRef(row.request); decodeStorageBytes(row.remainingBytes)
    campaignAssert(row.request.id > previous, 'Open allocations must be sorted and unique')
    previous = row.request.id
  }
}
export function validateCampaignStorageEffect(value: unknown): asserts value is CampaignStorageEffect {
  campaignRecord(value, ['source', 'requestId', 'allocatedBytes', 'releasedBytes', 'remainingBytes'], 'storage effect')
  choice(value.source, ['request', 'recovery', 'direct'])
  const bytes = ['allocatedBytes', 'releasedBytes', 'remainingBytes'].map(key => decodeStorageBytes(value[key]))
  if (value.source === 'request') campaignId(value.requestId)
  else campaignAssert(value.requestId === null && bytes.every(n => n === 0), 'Non-request effect must have no allocation')
}
