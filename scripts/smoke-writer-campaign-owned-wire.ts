/** Portable owned-wire regression. The unchanged public parser/validators/hash
 * path is the oracle; fresh bilingual offline fixtures need no saved/private data.
 * Hash preimages stay in memory. No live provider, native browser or performance claim. */
import * as old from '../src/services/writerCampaign/protocol'
import * as next from '../src/services/writerCampaign/protocol'
import { createOfflineCampaignEngine } from '../src/services/writerCampaign/engine'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { createBodyEvidenceMemoryIO } from './fixtures/writer-campaign-body-evidence-io'

type Kind = 'manifest' | 'checkpoint' | 'receipt' | 'request' | 'artifact'
type Owner = ReturnType<typeof next.createCampaignRawReadValidator>
type Owned = Awaited<ReturnType<Owner['historyCheckpoint']>>
type Row = Record<string, any>
const kinds: Kind[] = ['manifest', 'checkpoint', 'receipt', 'request', 'artifact']
const validators = { manifest: old.validateCampaignManifest, checkpoint: old.validateCampaignCheckpoint, receipt: old.validateCampaignReceipt, request: old.validateCampaignRequest, artifact: old.validateCampaignArtifact }
const newValidators = { manifest: next.validateCampaignManifest, checkpoint: next.validateCampaignCheckpoint, receipt: next.validateCampaignReceipt, request: next.validateCampaignRequest, artifact: next.validateCampaignArtifact }
const copy = <T,>(value: T): T => structuredClone(value)
let stage = 'generated_bilingual_fixture', failure = '', checks = 0, pairs = 0, hashCalls = 0, successes = 0, errors = 0, fixtureRows = 0, historicalOperations = 0, reuseObserved = 0, fallbackObserved = 0
const counts = { manifest: 0, checkpoint: 0, receipt: 0, request: 0, artifact: 0, head: 0, catalog: 0 }
function must(value: unknown, code = 'assertion'): asserts value { checks++; if (!value) { failure = code; throw new Error('canonical_owned_differential') } }
const fingerprint = (error: unknown) => {
  const value = error as { name?: unknown; code?: unknown; message?: unknown }
  return [String(value?.name), String(value?.code), String(value?.message)]
}
type DigestCall = { input: Buffer; output: Buffer }
let capturing: DigestCall[] | null = null
let gate: { entered(): void; release: Promise<void>; hit: boolean } | null = null
const digestDescriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'digest')
const nativeDigest = crypto.subtle.digest.bind(crypto.subtle)
Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
  const captured = capturing, input = Buffer.from(ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data))
  const output = await nativeDigest(algorithm, data)
  if (captured) captured.push({ input, output: Buffer.from(output) })
  if (gate && !gate.hit) { const current = gate; current.hit = true; current.entered(); await current.release }
  return output
} })
async function outcome(run: () => unknown | Promise<unknown>) {
  const calls: DigestCall[] = []; capturing = calls
  try { return { ok: true as const, value: await run(), calls } }
  catch (error) { return { ok: false as const, error: fingerprint(error), calls } }
  finally { capturing = null }
}
async function pair(a: () => unknown | Promise<unknown>, b: () => unknown | Promise<unknown>) {
  const x = await outcome(a), y = await outcome(b); pairs++
  must(x.ok === y.ok, 'success_error_divergence')
  if (x.ok && y.ok) { must(old.canonicalStringify(x.value) === old.canonicalStringify(y.value), 'successful_value_divergence'); successes++ }
  else if (!x.ok && !y.ok) { must(JSON.stringify(x.error) === JSON.stringify(y.error), 'error_name_code_message_divergence'); errors++ }
  must(x.calls.length === y.calls.length, 'hash_call_count_divergence')
  for (const [index, call] of x.calls.entries()) {
    must(call.input.equals(y.calls[index]!.input), 'hash_preimage_divergence'); must(call.output.equals(y.calls[index]!.output), 'hash_digest_divergence'); hashCalls++
  }
  return y
}
const rawPair = (owner: Owner, kind: Kind, raw: string | null) => pair(() => validators[kind](old.parseCampaignRecord(raw)), () => owner[kind](raw))
async function observeOperation(owner: Owner, value: unknown, sentinel?: string, reuse?: boolean) {
  let observed = 0
  const nativeStringify = JSON.stringify
  const result = await pair(() => old.hashCampaignValue('campaign-operation-v2', value), async () => {
    JSON.stringify = function (input: unknown, ...args: unknown[]) {
      if (sentinel !== undefined && input === sentinel) observed++
      return Reflect.apply(nativeStringify, JSON, [input, ...args])
    } as typeof JSON.stringify
    try { return await owner.operationDigest(value) } finally { JSON.stringify = nativeStringify }
  })
  if (reuse !== undefined) {
    must(result.ok, 'observation_requires_success')
    must(reuse ? observed === 0 : observed > 0, 'fragment_reuse_observation')
    if (reuse) reuseObserved++; else fallbackObserved++
  }
  return result
}
function allFrozen(value: unknown): boolean { return value === null || typeof value !== 'object' || Object.isFrozen(value) && Object.values(value).every(allFrozen) }
function nodes(value: unknown): number { return 1 + (value && typeof value === 'object' ? Object.values(value).reduce<number>((sum, child) => sum + nodes(child), 0) : 0) }
function attemptMutation(run: () => void) { let threw = false; try { run() } catch { threw = true }; must(threw, 'owned_mutation_not_blocked') }
const operation = (item: Row, previous: Row, receipt: Row, requests: Map<string, Row>) => {
  const request = receipt.requestHashes.length ? requests.get(receipt.requestHashes[0]) : null
  const budgetDelta = Object.fromEntries(old.CAMPAIGN_BUDGET_KEYS.filter(key => !['artifacts', 'operations'].includes(key)).map(key => [key, item.budget[key] - previous.budget[key]]))
  return { kind: receipt.kind, next: { status: item.status, reason: item.reason, candidateId: item.candidateId, tasks: item.tasks, budgetDelta },
    storageRule: { source: request ? 'request' : ['pause', 'cancel', 'reconcile', 'block'].includes(receipt.kind) ? 'recovery' : 'direct', requestId: request?.id ?? null, settle: receipt.kind === 'accept_artifact' }, artifacts: receipt.artifactHashes, requests: receipt.requestHashes }
}
async function reseal(kind: Kind, value: Row) {
  const { hash: _hash, ...payload } = value
  return { ...payload, hash: await old.hashCampaignValue(`campaign-${kind}-v2`, payload) }
}
async function freshHistory(raw: string) { const owner = next.createCampaignRawReadValidator(); owner.beginHistoryBatch(); return { owner, item: await owner.historyCheckpoint(raw) } }

const originalFetch = globalThis.fetch
let forbiddenNetworkCalls = 0, fixtureDispatches = 0
globalThis.fetch = async () => { forbiddenNetworkCalls++; throw new Error('owned_wire_network_forbidden') }
async function fixture(language: 'zh' | 'en') {
  const storage = createBodyEvidenceMemoryIO(), campaignId = `owned-wire-${language}`, identity = { runtimeIdentity: 'owned-wire-portable-smoke-v1', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }
  const engine = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(storage.io), clock: () => 1_900_000_000_000,
    fixture: { onDispatch() { fixtureDispatches++ } } })
  try {
    let snapshot = await engine.prepareBodyEvidence({ campaignId, language }, 'owned-wire-create')
    for (let index = 0; index < 9; index++) snapshot = await engine.step(campaignId, `owned-wire-step-${index}`)
    must(snapshot.head.status === 'completed' && snapshot.checkpoint.tasks.filter(row => row.status === 'committed').length === 9, 'fixture_completion')
    const rows = [...storage.rows], observation = storage.observe(), namespace = old.canonicalStringify(rows)
    return { rows, storage, observation, namespace }
  } finally { engine.dispose() }
}
try {
  const fixtures = []
  for (const language of ['zh', 'en'] as const) fixtures.push(await fixture(language))
  const rows = fixtures.flatMap(row => row.rows)
  must(fixtureDispatches === 18 && rows.length === 248, 'bounded_fixture_inventory')
  const samples = new Map<Kind, string>(), checkpointGroups = new Map<string, Array<{ raw: string; value: Row }>>(), receipts = new Map<string, Row>(), requests = new Map<string, Row>()
  const owner = next.createCampaignRawReadValidator()
  stage = 'generated_records_and_hash_preimages'
  for (const [key, raw] of rows) {
    const kind = (key === 'writer-campaign:catalog' ? 'catalog' : key.split(':')[2]) as Kind | 'head' | 'catalog'
    must(kind in counts); counts[kind]++; fixtureRows++
    if (kind === 'head') { await pair(() => old.validateCampaignHead(old.parseCampaignRecord(raw)), () => next.validateCampaignHead(next.parseCampaignRecord(raw))); continue }
    if (kind === 'catalog') { await pair(() => old.parseCampaignRecord(raw), () => next.parseCampaignRecord(raw)); continue }
    const result = await rawPair(owner, kind, raw); must(result.ok)
    samples.set(kind, raw)
    const value = result.value as Row
    if (kind === 'checkpoint') { const group = checkpointGroups.get(value.campaignId) ?? []; group[value.sequence] = { raw, value }; checkpointGroups.set(value.campaignId, group) }
    if (kind === 'receipt') receipts.set(`${value.campaignId}/${value.operationId}`, value)
    if (kind === 'request') requests.set(value.hash, value)
  }
  owner.dispose(); must(checkpointGroups.size === 2 && counts.checkpoint === 76 && counts.request === 72)
  stage = 'generated_historical_operations'
  const historyOwner = next.createCampaignRawReadValidator()
  for (const checkpoints of checkpointGroups.values()) for (let offset = 0; offset < checkpoints.length; offset += 32) {
    historyOwner.beginHistoryBatch()
    const batch: Owned[] = []
    for (const entry of checkpoints.slice(offset, offset + 32)) batch.push(await historyOwner.historyCheckpoint(entry.raw))
    for (const item of batch) {
      must(allFrozen(item), 'historical_deep_freeze')
      if (item.sequence > 0) {
        const receipt = receipts.get(`${item.campaignId}/${item.operationId}`)!, value = operation(item, checkpoints[item.sequence - 1]!.value, receipt, requests)
        const digest = await observeOperation(historyOwner, value)
        must(digest.ok && digest.value === receipt.businessDigest, 'generated_business_digest'); historicalOperations++
      }
      historyOwner.releaseHistoryCheckpoint(item)
    }
    historyOwner.endHistoryBatch()
  }
  historyOwner.dispose(); must(historicalOperations === 74)
  const checkpoints = [...checkpointGroups.values()][1]!

  stage = 'raw_error_order_and_closed_shapes'
  const invalidRaw: Array<string | null> = [null, '', '{', '{"schemaVersion":2,}', 'null', '[]', '0', '-0', 'true', '"text"', '{}', '{"schemaVersion":1}', '{"schemaVersion":3}', ' {"schemaVersion":1} ', '{"schemaVersion":2}', '{"schemaVersion":2,"schemaVersion":2}', '{"schemaVersion":2,"x":-0}', '{"schemaVersion":2,"x":1e0}', '{"schemaVersion":2,"x":-1}', '{"schemaVersion":2,"x":1.5}', '{"schemaVersion":2,"x":1e999}', '{"schemaVersion":2,"x":"\\ud800"}', '\ud800', ' '.repeat(1_048_576), ' '.repeat(1_048_577)]
  const malformedOwner = next.createCampaignRawReadValidator()
  for (const kind of kinds) {
    for (const raw of invalidRaw) await rawPair(malformedOwner, kind, raw)
    const raw = samples.get(kind)!, parsed = JSON.parse(raw) as Row
    for (const text of [` ${raw}`, `${raw}\n`, JSON.stringify(parsed, null, 2), JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse())), raw.replace('"schemaVersion":2', '"schemaVersion":2,"schemaVersion":2')]) await rawPair(malformedOwner, kind, text)
    for (const key of Object.keys(parsed)) { const changed = copy(parsed); delete changed[key]; await rawPair(malformedOwner, kind, old.canonicalStringify(changed)) }
    for (const changed of [{ ...parsed, unknownField: 0 }, { ...parsed, schemaVersion: 1 }, { ...parsed, schemaVersion: 3 }, { ...parsed, hash: 'f'.repeat(64) }, { ...parsed, hash: 'bad' }]) await rawPair(malformedOwner, kind, old.canonicalStringify(changed))
    // Public object validators retain their exact rejection and clone contract.
    for (const changed of [null, [], { ...parsed, unknownField: 0 }, { ...parsed, schemaVersion: 3 }, { ...parsed, hash: 'bad' }]) await pair(() => validators[kind](copy(changed)), () => newValidators[kind](copy(changed)))
    const input = JSON.parse(raw), direct = await newValidators[kind](input), normal = await malformedOwner[kind](raw)
    must(direct !== input && normal !== input && !Object.isFrozen(direct) && !Object.isFrozen(normal), 'public_clone_contract')
    const unchanged = old.canonicalStringify(input); (direct as unknown as Row).campaignId = 'mutated-public-clone'; must(old.canonicalStringify(input) === unchanged)
  }
  for (const raw of invalidRaw) await pair(() => old.parseCampaignRecord(raw), () => next.parseCampaignRecord(raw))
  for (const depth of [31, 32, 33]) {
    let child: unknown = null; for (let i = 0; i < depth; i++) child = { a: child }
    await rawPair(malformedOwner, 'checkpoint', JSON.stringify({ a: child, schemaVersion: 2 }))
  }
  for (const length of [99_997, 99_998]) await rawPair(malformedOwner, 'checkpoint', JSON.stringify({ a: Array(length).fill(0), schemaVersion: 2 }))
  malformedOwner.dispose()

  stage = 'scalar_numeric_text_and_nested_hashes'
  const adversarialOwner = next.createCampaignRawReadValidator(), artifact = JSON.parse(samples.get('artifact')!) as Row, request = JSON.parse(samples.get('request')!) as Row
  for (const text of ['', '中文', 'a\r\nb', 'a\rb', 'a\nb', 'e\u0301', 'é', '🚀𐐷', '\u0000', 'x'.repeat(65_536)]) {
    const { hash: _hash, raw: _raw, canonical: _canonical, ...data } = copy(artifact)
    const sealed = await old.sealCampaignArtifact({ ...data, text } as Parameters<typeof old.sealCampaignArtifact>[0]); await rawPair(adversarialOwner, 'artifact', old.canonicalStringify(sealed))
    const changed = copy(request); changed.preparedInput = text; changed.inputDigest = await old.hashText(text); changed.inputBytes = old.utf8Bytes(text); changed.inputUtf16 = text.length
    if (changed.response) { changed.response.inputDigest = changed.inputDigest; changed.response.text = text }
    await rawPair(adversarialOwner, 'request', old.canonicalStringify(await reseal('request', changed)))
  }
  for (const text of ['\ud800', '\udfff', '\ud800x', 'x\udfff', 'x'.repeat(65_537)]) {
    await rawPair(adversarialOwner, 'artifact', JSON.stringify({ ...artifact, text }))
    await rawPair(adversarialOwner, 'request', JSON.stringify({ ...request, preparedInput: text }))
  }
  for (const kind of ['checkpoint', 'request'] as const) {
    const sample = JSON.parse(samples.get(kind)!) as Row, budgetKey = kind === 'checkpoint' ? 'budget' : 'reservation'
    for (const key of old.CAMPAIGN_BUDGET_KEYS) for (const value of [-0, 0, 2048, 2049, Number.MAX_SAFE_INTEGER, -1, 0.5, null, '0']) {
      const changed = copy(sample); changed[budgetKey][key] = value
      let raw: string
      try { raw = old.canonicalStringify(await reseal(kind, changed)) } catch { raw = JSON.stringify(changed) }
      await rawPair(adversarialOwner, kind, raw)
    }
    for (const key of Object.keys(sample[budgetKey])) { const changed = copy(sample); delete changed[budgetKey][key]; await rawPair(adversarialOwner, kind, old.canonicalStringify(changed)) }
    const changed = copy(sample); changed[budgetKey].unknownField = 0; await rawPair(adversarialOwner, kind, old.canonicalStringify(changed))
  }
  for (const root of ['raw', 'canonical'] as const) for (const key of Object.keys(artifact[root])) {
    const changed = copy(artifact); delete changed[root][key]; await rawPair(adversarialOwner, 'artifact', old.canonicalStringify(changed))
  }
  for (const root of ['response', 'usage'] as const) {
    const object = root === 'response' ? request.response : request.response.usage
    for (const key of [...Object.keys(object), 'unknownField']) {
      const changed = copy(request), nested = root === 'response' ? changed.response : changed.response.usage
      if (key === 'unknownField') nested[key] = 0; else delete nested[key]
      await rawPair(adversarialOwner, 'request', old.canonicalStringify(changed))
    }
  }
  adversarialOwner.dispose()

  const historyRaw = checkpoints.at(-1)!.raw, sentinel = checkpoints.at(-1)!.value.tasks[0].taskId as string
  stage = 'owned_freeze_identity_and_consumption'
  {
    const { owner: o, item } = await freshHistory(historyRaw), before = old.canonicalStringify(item)
    must(allFrozen(item)); attemptMutation(() => { (item as unknown as Row).reason = 'changed' }); attemptMutation(() => { item.tasks.push(copy(item.tasks[0]!)) })
    attemptMutation(() => { item.tasks[0]!.status = 'invalidated' }); attemptMutation(() => { item.tasks[0]!.artifact!.hash = 'f'.repeat(64) }); attemptMutation(() => { item.budget.operations++ }); attemptMutation(() => { item.storage.writtenBytes = '0000000000000000' as typeof item.storage.writtenBytes })
    const parsed = old.parseCampaignRecord(historyRaw) as Row, publicClone = await next.validateCampaignCheckpoint(parsed)
    parsed.tasks[0].taskId = 'caller-mutated'; publicClone.tasks[0]!.taskId = 'public-mutated'; must(old.canonicalStringify(item) === before)
    await observeOperation(o, { next: { tasks: item.tasks, status: 'changed-surrounding-state', budgetDelta: { attempts: 3 } }, storageRule: { source: 'different' }, artifacts: ['a'], requests: ['b'] }, sentinel, true)
    await observeOperation(o, { next: { tasks: item.tasks } }, sentinel, false)
    o.releaseHistoryCheckpoint(item); o.releaseHistoryCheckpoint(item); o.dispose()
  }
  for (const transform of [(item: Owned) => copy(item.tasks), (item: Owned) => [...item.tasks], (item: Owned) => [...item.tasks].reverse(), (item: Owned) => ({ encodedTasks: 'forged', tasks: copy(item.tasks), nodeCount: 1 })]) {
    const { owner: o, item } = await freshHistory(historyRaw)
    await observeOperation(o, { next: { tasks: transform(item) } }, sentinel, false)
    await observeOperation(o, { next: { tasks: item.tasks } }, sentinel, true); o.dispose()
  }
  for (const action of ['foreign', 'release', 'end', 'new_batch', 'dispose', 'operation_error'] as const) {
    const { owner: o, item } = await freshHistory(historyRaw), target = action === 'foreign' ? next.createCampaignRawReadValidator() : o
    if (action === 'release') o.releaseHistoryCheckpoint(item)
    if (action === 'end') o.endHistoryBatch()
    if (action === 'new_batch') o.beginHistoryBatch()
    if (action === 'dispose') o.dispose()
    if (action === 'operation_error') { await observeOperation(o, { tasks: item.tasks, z: '\ud800' }); o.releaseHistoryCheckpoint(item) }
    await observeOperation(target, { next: { tasks: item.tasks } }, sentinel, false); target.dispose(); o.dispose()
  }
  const allocationRaw = checkpoints.find(row => row.value.storage.openAllocations.length > 0)!.raw
  { const { owner: o, item } = await freshHistory(allocationRaw); must(allFrozen(item.storage.openAllocations)); attemptMutation(() => { item.storage.openAllocations[0]!.request.hash = 'f'.repeat(64) }); o.dispose() }

  stage = 'fragment_node_and_depth_budget'
  for (const excess of [0, 1]) {
    const { owner: o, item } = await freshHistory(historyRaw), count = nodes(item.tasks)
    await observeOperation(o, { aPad: Array(100_000 - 4 - count + excess).fill(0), tasks: item.tasks }); o.dispose()
  }
  for (let depth = 25; depth <= 33; depth++) {
    const { owner: o, item } = await freshHistory(historyRaw)
    let value: unknown = item.tasks; for (let i = 0; i < depth; i++) value = { a: value }
    await observeOperation(o, value); o.dispose()
  }

  stage = 'entry_byte_caps_and_monotone_admission'
  async function sizedCheckpoint(size: number, sequence = 1) {
    const item = copy(checkpoints[1]!.value)
    item.sequence = sequence; item.tasks = Array.from({ length: 128 }, (_, index) => ({ taskId: `task${String(index).padStart(3, '0')}`, revision: 0, status: 'committed', artifact: { taskId: 'artifact', revision: 0, hash: 'a'.repeat(64) }, priorArtifact: null, request: null }))
    let remaining = size - old.utf8Bytes(old.canonicalStringify(item.tasks)); must(remaining >= 0)
    for (const task of item.tasks) { const add = Math.min(128 - task.taskId.length, remaining); task.taskId += 'x'.repeat(add); remaining -= add }
    must(remaining === 0 && old.utf8Bytes(old.canonicalStringify(item.tasks)) === size)
    const raw = old.canonicalStringify(await reseal('checkpoint', item)); await old.validateCampaignCheckpoint(old.parseCampaignRecord(raw)); return raw
  }
  const exactRaw = await sizedCheckpoint(32_768), overRaw = await sizedCheckpoint(32_769)
  for (const oneByteOver of [false, true]) {
    const o = next.createCampaignRawReadValidator(); o.beginHistoryBatch(); const items: Owned[] = []
    for (let index = 0; index < 33; index++) items.push(await o.historyCheckpoint(index === 31 && oneByteOver ? overRaw : exactRaw))
    // A too-large fragment is never readmitted, but a later smaller fragment
    // may still fit before processing closes admission (no capacity was freed).
    for (const index of [0, 30, 31, 32]) await observeOperation(o, { next: { tasks: items[index]!.tasks } }, items[index]!.tasks[0]!.taskId, index < 31 || index === 31 && !oneByteOver || index === 32 && oneByteOver)
    o.releaseHistoryCheckpoint(items[0]!); const late = await o.historyCheckpoint(exactRaw)
    await observeOperation(o, { next: { tasks: late.tasks } }, late.tasks[0]!.taskId, false); o.dispose()
  }
  {
    const o = next.createCampaignRawReadValidator(); o.beginHistoryBatch(); const items: Owned[] = []
    must(old.utf8Bytes(old.canonicalStringify(checkpoints[1]!.value.tasks)) * 33 < old.CAMPAIGN_LIMITS.recordBytes)
    for (let index = 0; index < 33; index++) items.push(await o.historyCheckpoint(checkpoints[1]!.raw))
    await observeOperation(o, { tasks: items[31]!.tasks }, items[31]!.tasks[0]!.taskId, true)
    await observeOperation(o, { tasks: items[32]!.tasks }, items[32]!.tasks[0]!.taskId, false); o.dispose()
  }
  { const { owner: o, item } = await freshHistory(checkpoints[0]!.raw); await observeOperation(o, { tasks: item.tasks }, item.tasks[0]!.taskId, false); o.dispose() }
  for (const boundary of ['operation', 'release', 'end', 'dispose', 'new_batch'] as const) {
    stage = `late_completion_${boundary}`
    const o = next.createCampaignRawReadValidator(); o.beginHistoryBatch()
    let entered!: () => void, release!: () => void
    const observed = new Promise<void>(yes => { entered = yes }), released = new Promise<void>(yes => { release = yes })
    gate = { entered, release: released, hit: false }
    const pending = o.historyCheckpoint(historyRaw)
    must(await Promise.race([observed.then(() => true), pending.then(() => false, () => false)]), 'late_completion_hash_gate_not_entered')
    if (boundary === 'operation') await o.operationDigest({ harmless: true })
    if (boundary === 'release') o.releaseHistoryCheckpoint(copy(checkpoints[0]!.value) as Owned)
    if (boundary === 'end') o.endHistoryBatch()
    if (boundary === 'dispose') o.dispose()
    if (boundary === 'new_batch') o.beginHistoryBatch()
    release(); const item = await pending; gate = null
    await observeOperation(o, { next: { tasks: item.tasks } }, sentinel, false); o.dispose()
  }
  stage = 'retry_owner_isolation'
  {
    // A moved-head/error retry gets a new owner, never the old registry.
    // Real IO retry/fence execution is independently exercised by read-batches.
    const first = await freshHistory(historyRaw); first.owner.dispose()
    const retry = await freshHistory(historyRaw)
    await observeOperation(retry.owner, { next: { tasks: first.item.tasks } }, sentinel, false)
    await observeOperation(retry.owner, { next: { tasks: retry.item.tasks } }, sentinel, true)
    retry.owner.dispose()
  }
  stage = 'disposed_fallback_and_readonly_comparisons'
  const disposed = next.createCampaignRawReadValidator(); disposed.beginHistoryBatch(); disposed.dispose()
  for (const kind of kinds) await rawPair(disposed, kind, samples.get(kind)!)
  await pair(() => old.validateCampaignCheckpoint(old.parseCampaignRecord(historyRaw)), () => disposed.historyCheckpoint(historyRaw))
  for (const item of fixtures) {
    must(old.canonicalStringify(item.storage.observe()) === old.canonicalStringify(item.observation), 'comparison_io_activity')
    must(old.canonicalStringify([...item.storage.rows]) === item.namespace, 'comparison_storage_mutation')
  }
  must(forbiddenNetworkCalls === 0, 'network_entry')
  console.log(JSON.stringify({ suite: 'writer-campaign-owned-wire', status: 'pass', fixtureLanguages: 2, fixtureDispatches, fixtureRows, counts,
    historicalOperations, checks, pairs, successes, errors, identicalHashCalls: hashCalls, observedFragmentReuses: reuseObserved, observedOrdinaryFallbacks: fallbackObserved,
    comparisonIoChanges: 0, forbiddenNetworkCalls, nativeExecution: false, performanceAcceptance: false }))
} catch {
  console.error(JSON.stringify({ suite: 'writer-campaign-owned-wire', status: 'failed', stage, failure, checks, pairs, successes, errors, identicalHashCalls: hashCalls,
    fixtureDispatches, forbiddenNetworkCalls, nativeExecution: false, performanceAcceptance: false })); process.exitCode = 1
} finally {
  gate = null; capturing = null; globalThis.fetch = originalFetch
  if (digestDescriptor) Object.defineProperty(crypto.subtle, 'digest', digestDescriptor); else delete (crypto.subtle as unknown as Record<string, unknown>).digest
}
