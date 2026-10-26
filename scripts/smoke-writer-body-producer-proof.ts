/** Scoped exact-origin verification controls; no performance, SDK, or browser claims. */
import assert from 'node:assert/strict'
import type { CampaignActionScope, CampaignRepositoryIO } from '../src/types/writerCampaign'
import type { ProducerActionScope } from '../src/types/bodyProducer'
import { CampaignActionProofPool, CAMPAIGN_PROOF_ENTRY_LIMIT } from '../src/services/writerCampaign/actionProof'
import { campaignKeys, CAMPAIGN_CATALOG_KEY, createCampaignRepository } from '../src/services/writerCampaign/store'
import { createProducerCampaignRepository, producerKeys } from '../src/services/writerCampaign/producerStore'
import { createBodyProducerEngine } from '../src/services/writerCampaign/bodyProducerEngine'
import { createOfflineCampaignEngine } from '../src/services/writerCampaign/engine'
import { CAMPAIGN_LIMITS, canonicalStringify } from '../src/services/writerCampaign/protocol'
import { installNodePlanningAuthorityGuard } from './fixtures/writer-campaign-planning-authority.mjs'

class IO implements CampaignRepositoryIO {
  disk = new Map<string, string>()
  reads: string[][] = []
  writes = 0
  onRead: ((keys: readonly string[]) => void | Promise<void>) | null = null
  onCas: (() => void | Promise<void>) | null = null
  async getMany(keys: readonly string[]) {
    this.reads.push([...keys]); await this.onRead?.(keys)
    return new Map(keys.map(key => [key, this.disk.get(key) ?? null]))
  }
  async compareAndSwapMany(entries: ReadonlyArray<{ key: string; expectedValue: string | null; value: string }>, canCommit = () => true) {
    await this.onCas?.()
    if (!canCommit() || entries.some(row => (this.disk.get(row.key) ?? null) !== row.expectedValue)) return false
    for (const row of entries) this.disk.set(row.key, row.value)
    this.writes++; return true
  }
  fork() { const next = new IO(); next.disk = new Map(this.disk); return next }
}
const id = 'producer-proof', now = 1_900_000_000_000
const identity = { runtimeIdentity: 'producer-proof-runtime', source: { commit: null, tree: null } }
const guard = installNodePlanningAuthorityGuard(), base = new IO(), legacy = createCampaignRepository(base)
const writer = createOfflineCampaignEngine({ repository: legacy, identity, clock: () => now })
let cases = 0
async function test(action: () => Promise<void>) { await action(); cases++ }
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve }); return { promise, release } }
function assertEmpty(repository: ReturnType<typeof createProducerCampaignRepository>) {
  const stats = repository.getActionProofStats!()
  assert.equal(stats.retainedBytes, 0); assert.equal(stats.retainedEntries, 0); assert.equal(stats.activeRecords, 0)
}

try {
  await writer.prepareBodyEvidence({ campaignId: id, language: 'en' })
  for (let i = 0; i < 9; i++) await writer.step(id, `step-${i}`)
  const original = (await legacy.read(id))!, v2 = base.fork()
  const adopted = await createProducerCampaignRepository({ io: base, clock: () => now }).adopt(id, 'adopt', identity)
  const fixture = () => { const io = base.fork(), repository = createProducerCampaignRepository({ io, clock: () => now }); return { io, repository } }

  await test(async () => {
    const io = v2.fork(), repository = createCampaignRepository(io), scope = repository.createActionScope!(id)
    const seeded = (await repository.read(id, scope))!
    seeded.checkpoint.tasks.length = 0; seeded.artifacts.clear()
    io.reads = []
    const verified = await repository.verifyWithinAction!(id, original.rawHead, scope)
    assert.equal(verified.checkpoint.tasks.length, 9); assert.ok(verified.artifacts.size > 0)
    const observed = new Set(io.reads.flat())
    for (const key of v2.disk.keys()) assert.ok(observed.has(key), `Exact verification rereads ${key}`)
    verified.artifacts.clear()
    assert.ok((await repository.verifyWithinAction!(id, original.rawHead, scope)).artifacts.size > 0)
    assert.equal(repository.getActionProofStats!().coldReplays, 1); assert.equal(repository.getActionProofStats!().exactPasses, 2)
    repository.disposeActionScope!(scope)
    await assert.rejects(repository.verifyWithinAction!(id, original.rawHead, scope), /closed/)
  })
  await test(async () => {
    const repository = createCampaignRepository(v2.fork()), scope = repository.createActionScope!(id)
    await assert.rejects(repository.verifyWithinAction!(id, original.rawHead, scope), /rebase/)
    await assert.rejects(repository.verifyWithinAction!(id, original.rawHead, {} as CampaignActionScope), /Unknown/)
    const foreign = createCampaignRepository(v2.fork()).createActionScope!(id)
    await assert.rejects(repository.verifyWithinAction!(id, original.rawHead, foreign), /Unknown/)
    const good = repository.createActionScope!(id); await repository.read(id, good)
    await assert.rejects(repository.verifyWithinAction!('other', original.rawHead, good), /Unknown/)
    await assert.rejects(repository.verifyWithinAction!(id, `${original.rawHead} `, good), /rebase/)
  })
  await test(async () => {
    const repository = createCampaignRepository(v2.fork()), first = repository.createActionScope!(id), fallback = repository.createActionScope!(id)
    await repository.read(id, first); await repository.read(id, fallback)
    const before = repository.getActionProofStats!()
    await repository.verifyWithinAction!(id, original.rawHead, fallback)
    const after = repository.getActionProofStats!()
    assert.equal(after.admittedScopes, 1); assert.equal(after.coldReplays, before.coldReplays + 1); assert.equal(after.retainedBytes, before.retainedBytes)
    repository.disposeActionScope!(first)
    await repository.verifyWithinAction!(id, original.rawHead, fallback)
    assert.equal(repository.getActionProofStats!().admittedScopes, 1, 'Fallback cannot reseed after the admitted action closes')
    repository.disposeActionScope!(fallback)
    await assert.rejects(repository.verifyWithinAction!(id, original.rawHead, fallback), /closed/)
  })
  await test(async () => {
    const pool = new CampaignActionProofPool({ bytes: 8, entries: 1 }), scope = pool.create(id), lease = pool.begin(scope, id)!
    pool.capture(lease); pool.observe(lease, 'key', 'too-large', 9); pool.seedVerification(lease, original); pool.end(lease)
    const acquired = pool.acquireForVerification(scope, id, original.rawHead)
    assert.equal(pool.collecting(acquired), false); assert.equal(pool.canCommit(acquired), true); assert.equal(acquired.verificationHead, original.rawHead)
    assert.equal(pool.observations().retainedBytes, 0); pool.end(acquired)
    assert.throws(() => pool.acquireForVerification(scope, id, `${original.rawHead} `), /rebase/)
    assert.throws(() => pool.acquireForVerification(scope, id, original.rawHead), /closed/)
    assert.equal(CAMPAIGN_PROOF_ENTRY_LIMIT, 8193); assert.equal(CAMPAIGN_LIMITS.serializedBytes, 67_108_864); assert.equal(4 * CAMPAIGN_LIMITS.tasks, 512)
  })
  await test(async () => {
    for (const fallback of [false, true]) {
      const io = v2.fork(), repository = createCampaignRepository(io), first = repository.createActionScope!(id), scope = fallback ? repository.createActionScope!(id) : first
      await repository.read(id, first); if (fallback) await repository.read(id, scope)
      const entered = deferred(), gate = deferred()
      io.onRead = async keys => { if (keys.includes(CAMPAIGN_CATALOG_KEY)) { entered.release(); await gate.promise } }
      const pending = repository.verifyWithinAction!(id, original.rawHead, scope), refused = assert.rejects(pending, /closed|expired/)
      await entered.promise
      if (fallback) repository.disposeActionScope!(scope)
      else await assert.rejects(repository.verifyWithinAction!(id, original.rawHead, scope), /Concurrent/)
      gate.release(); await refused; repository.disposeActionScope!(first)
      assert.equal(repository.getActionProofStats!().retainedBytes, 0)
      await assert.rejects(repository.verifyWithinAction!(id, original.rawHead, scope), /closed/)
    }
  })
  await test(async () => {
    const repository = createCampaignRepository(v2.fork()), scope = repository.createActionScope!(id)
    await repository.read(id, scope); await repository.read(id, scope)
    assert.equal(repository.getActionProofStats!().coldReplays, 2, 'Existing public read remains cold')
    await assert.rejects(repository.verifyWithinAction!(id, original.rawHead, scope), /closed/)
  })
  await test(async () => {
    const { repository } = fixture(), scope = repository.createActionScope!(id)
    const first = (await repository.read(id, undefined, scope))!
    const poisoned = structuredClone(first); poisoned.origin.artifacts.clear(); poisoned.checkpoint.budget.attempts = 0
    const changed = await repository.commit(poisoned, { kind: 'body_revision', operationId: 'revision', chapterOrdinal: 1, text: 'Changed accepted source.' }, undefined, scope)
    assert.equal(changed.snapshot.checkpoint.budget.attempts, first.checkpoint.budget.attempts)
    const fresh = (await repository.read(id, undefined, scope))!
    assert.equal(fresh.checkpoint.sourceEpoch, 1)
    assert.equal((await repository.getReceipt(id, 'revision', undefined, scope))!.hash, changed.receipt.hash)
    assert.equal((await repository.commit(first, { kind: 'body_revision', operationId: 'revision', chapterOrdinal: 1, text: 'Changed accepted source.' }, undefined, scope)).replayed, true)
    const stats = repository.getActionProofStats!(); assert.equal(stats.coldReplays, 1); assert.equal(stats.exactPasses, 4)
    assert.ok(stats.peakRetainedBytes <= CAMPAIGN_LIMITS.serializedBytes); assert.ok(stats.peakRetainedEntries <= 8193); assert.ok(stats.peakActiveRecords <= 512)
    repository.disposeActionScope!(scope); assertEmpty(repository)
    const next = repository.createActionScope!(id); await repository.read(id, undefined, next)
    assert.equal(repository.getActionProofStats!().coldReplays, 2, 'No cross-action origin reuse')
    repository.disposeActionScope!(next)
  })
  await test(async () => {
    const { repository } = fixture(), first = repository.createActionScope!(id), fallback = repository.createActionScope!(id)
    await repository.read(id, undefined, first); const retained = repository.getActionProofStats!().retainedBytes
    await repository.read(id, undefined, fallback); await repository.read(id, undefined, fallback)
    assert.equal(repository.getActionProofStats!().retainedBytes, retained); assert.equal(repository.getActionProofStats!().admittedScopes, 1)
    repository.disposeActionScope!(first); await repository.read(id, undefined, fallback)
    assertEmpty(repository); assert.equal(repository.getActionProofStats!().admittedScopes, 1)
    repository.disposeActionScope!(fallback)
  })
  await test(async () => {
    for (const tokenKind of ['foreign', 'forged', 'disposed', 'wrong_campaign'] as const) {
      const { repository } = fixture(), token = tokenKind === 'foreign' ? fixture().repository.createActionScope!(id) : tokenKind === 'forged' ? {} as ProducerActionScope : repository.createActionScope!(id)
      if (tokenKind === 'disposed') repository.disposeActionScope!(token)
      await assert.rejects(repository.read(tokenKind === 'wrong_campaign' ? 'other' : id, undefined, token), /Unknown or closed/)
      assertEmpty(repository)
    }
  })
  await test(async () => {
    for (const kind of ['immutable', 'catalog', 'successor', 'v3_tail'] as const) {
      const { io, repository } = fixture(), scope = repository.createActionScope!(id)
      await repository.read(id, undefined, scope)
      if (kind === 'immutable') { const key = campaignKeys.checkpoint(id, 0); const value = io.disk.get(key)!; io.disk.set(key, value.replace('prepared', 'prepXred')) }
      else if (kind === 'catalog') io.disk.set(CAMPAIGN_CATALOG_KEY, canonicalStringify(['another']))
      else if (kind === 'successor') io.disk.set(campaignKeys.checkpoint(id, original.head.sequence + 1), '{}')
      else { const key = producerKeys.checkpoint(id, adopted.snapshot.head.sequence); io.disk.set(key, `${io.disk.get(key)!} `) }
      await assert.rejects(repository.read(id, undefined, scope))
      assertEmpty(repository); await assert.rejects(repository.read(id, undefined, scope), /closed/)
    }
  })
  await test(async () => {
    const { io, repository } = fixture(), scope = repository.createActionScope!(id)
    await repository.read(id, undefined, scope)
    io.onRead = keys => { if (keys.includes(CAMPAIGN_CATALOG_KEY)) io.disk.set(campaignKeys.head(id), `${io.disk.get(campaignKeys.head(id))!} `) }
    await assert.rejects(repository.read(id, undefined, scope), /head changed/); assertEmpty(repository)
  })
  await test(async () => {
    for (const fallback of [false, true]) {
      const { io, repository } = fixture(), first = repository.createActionScope!(id), scope = fallback ? repository.createActionScope!(id) : first
      await repository.read(id, undefined, first); if (fallback) await repository.read(id, undefined, scope)
      io.disk.set(campaignKeys.head(id), original.rawHead)
      await assert.rejects(repository.read(id, undefined, scope), /downgrade/)
      repository.disposeActionScope!(first); assertEmpty(repository)
      assert.equal(await repository.read(id), null, 'Unscoped verified legacy inspection remains unchanged')
    }
  })
  await test(async () => {
    for (const fallback of [false, true]) {
      const { io, repository } = fixture(), first = repository.createActionScope!(id), scope = fallback ? repository.createActionScope!(id) : first
      await repository.read(id, undefined, first); if (fallback) await repository.read(id, undefined, scope)
      const head = io.disk.get(campaignKeys.head(id))!
      io.disk.delete(campaignKeys.head(id))
      await assert.rejects(repository.read(id, undefined, scope), /lost its adopted aggregate/)
      repository.disposeActionScope!(first); assertEmpty(repository)
      assert.equal(await repository.read(id), null, 'Unscoped missing-head read remains unchanged')
      io.disk.set(campaignKeys.head(id), head)
      await assert.rejects(repository.read(id, undefined, scope), /closed/, 'Restoring the head cannot reopen a closed action')
    }
  })
  await test(async () => {
    const { io, repository } = fixture(), scope = repository.createActionScope!(id), entered = deferred(), gate = deferred()
    await repository.read(id, undefined, scope)
    io.onRead = async keys => { if (keys.includes(CAMPAIGN_CATALOG_KEY)) { entered.release(); await gate.promise } }
    const pending = repository.read(id, undefined, scope); const refused = assert.rejects(pending, /closed/)
    await entered.promise
    await assert.rejects(repository.read(id, undefined, scope), /Concurrent/)
    gate.release(); await refused; assertEmpty(repository)
  })
  await test(async () => {
    for (const atCas of [false, true]) {
      const { io, repository } = fixture(), scope = repository.createActionScope!(id), entered = deferred(), gate = deferred()
      const snapshot = (await repository.read(id, undefined, scope))!
      const hold = async () => { entered.release(); await gate.promise }
      if (atCas) io.onCas = hold
      else io.onRead = async keys => { if (keys.includes(CAMPAIGN_CATALOG_KEY)) await hold() }
      const pending = repository.commit(snapshot, { kind: 'body_revision', operationId: 'closed-write', chapterOrdinal: 1, text: 'Must not persist.' }, undefined, scope)
      const refused = assert.rejects(pending, /closed/)
      await entered.promise; repository.disposeActionScope!(scope); gate.release(); await refused
      assert.equal(io.writes, 0); assertEmpty(repository)
    }
  })
  await test(async () => {
    const { io, repository } = fixture(), scope = repository.createActionScope!(id)
    const first = (await repository.read(id, undefined, scope))!
    const other = createProducerCampaignRepository({ io, clock: () => now })
    await other.commit(first, { kind: 'body_revision', operationId: 'other-tab', chapterOrdinal: 1, text: 'Another author revision.' })
    const refreshed = (await repository.read(id, undefined, scope))!
    assert.equal(refreshed.checkpoint.sourceEpoch, 1); assert.equal(repository.getActionProofStats!().exactPasses, 1)
    await assert.rejects(repository.commit(first, { kind: 'cancel', operationId: 'stale' }, undefined, scope), /head changed/)
    assert.equal(io.writes, 1); assertEmpty(repository)
  })
  await test(async () => {
    const { io, repository } = fixture(), entered = deferred(), gate = deferred()
    const engine = createBodyProducerEngine({ repository, identity, clock: () => now })
    io.onRead = async keys => { if (keys.includes(CAMPAIGN_CATALOG_KEY)) { entered.release(); await gate.promise } }
    const pending = engine.inspect(id), refused = assert.rejects(pending, /cancelled/)
    await entered.promise; engine.cancelLocal(id); gate.release(); await refused
    assertEmpty(repository); assert.equal(io.writes, 0)
  })
  await test(async () => {
    const { repository } = fixture(), created: ProducerActionScope[] = [], disposed: ProducerActionScope[] = []
    const create = repository.createActionScope!, dispose = repository.disposeActionScope!
    repository.createActionScope = campaign => { const token = create(campaign); created.push(token); return token }
    repository.disposeActionScope = token => { disposed.push(token); dispose(token) }
    let calls = 0
    const engine = createBodyProducerEngine({ repository, identity, clock: () => now, adapters: [{
      identity: { adapterId: 'proof-control', adapterVersion: 'v1', mode: 'offline_control', requestedModelId: 'control', effectiveModelId: 'control', configurationRevision: 'v1', endpointIdentity: 'no-network' },
      assertCurrent() {}, async invoke(input) { calls++; await input.beforeRequest(); throw new Error('controlled_unknown') },
    }] })
    const handle = await engine.prepare(id, { chapterOrdinal: 1, startUtf16: 0, endUtf16: 1, planningRefs: [] }, 'proof-control')
    const snapshot = await engine.invoke(handle, 'proof-unknown')
    assert.equal(calls, 1); assert.equal(snapshot.phases.get(snapshot.checkpoint.producerRequests[0]!.phaseHash)!.status, 'outcome_unknown')
    assert.equal(created.length, 3, 'Prepare, invocation and metadata recovery have distinct scopes')
    assert.equal(new Set(created).size, 3); assert.deepEqual(disposed, created); assertEmpty(repository)
    assert.equal(repository.getActionProofStats!().coldReplays, 3)
    assert.ok(repository.getActionProofStats!().exactPasses >= 4)
  })
  console.log(JSON.stringify({ suite: 'body-producer-proof', cases, sdkCalls: 0, profilesExecuted: false, browserExecuted: false }))
} finally { writer.dispose(); guard.restore() }
