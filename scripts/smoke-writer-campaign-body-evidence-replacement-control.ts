/** Injected-IO control-flow unit only. Never writes a native report or claims browser execution. */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { createOfflineCampaignEngine } from '../src/services/writerCampaign/engine'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { buildBodyEvidenceFixtureProposal } from '../src/services/writerCampaign/bodyEvidenceFixture'
import type { CampaignSnapshot } from '../src/types/writerCampaign'
import { installBodyEvidenceUiGate } from './browser-writer-campaign-body-evidence-ui.mjs'
import { campaignBuildIdentity } from './campaign-build-identity.mjs'
import { hashCampaignValue } from '../src/services/writerCampaign/protocol'
import { installNodeBodyEvidenceAuthorityGuard } from './fixtures/writer-campaign-body-evidence-authority.mjs'
import { createBodyEvidenceMemoryIO } from './fixtures/writer-campaign-body-evidence-io'
import { inspectBodyEvidenceReplacementControl, runBodyEvidenceReplacementControl } from './fixtures/writer-campaign-body-evidence-browser'

const identity = campaignBuildIdentity(fileURLToPath(new URL('../', import.meta.url)))
const guard = installNodeBodyEvidenceAuthorityGuard()
try {
  for (const language of ['zh', 'en'] as const) {
    const storage = createBodyEvidenceMemoryIO()
    const ports = { identity, io: storage.io, observe: storage.observe, authority: guard.snapshot,
      namespaceDigest: () => hashCampaignValue('body-evidence-node-control-namespace-v1', [...storage.rows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) }
    const result = await runBodyEvidenceReplacementControl(language, ports)
    assert.equal(result.status, 'pass', `Injected-IO ${language} control failed: ${result.refusalCode}`)
    assert.equal(result.setupFixtureInvocations, 9)
    assert.equal(result.rebuildFixtureInvocations, 3)
    assert.equal(result.explicitCommittedTransactions, 14)
    assert.equal(result.finalCommittedTransactions, 52)
    assert.equal(result.finalOperations, 52)
    assert.equal(result.finalAttempts, 12)
    assert.equal(result.previewInvocations, 5)
    assert.equal(result.previewCommitAttempts, 0)
    assert.equal(result.previewFixtureInvocations, 0)
    assert.equal(result.sourceChangeRefusal, 'source_changed')
    assert.equal(result.invalidatedPrefixRefusal, 'no_accepted_body')
    assert.equal(result.staleProposalRefusal, 'source_identity_mismatch')
    assert.notEqual(result.oldBodyPrefixRoot, result.newBodyPrefixRoot)
    assert.notEqual(result.oldFullPlanRoot, result.newFullPlanRoot)
    assert.equal(result.historicalPlanningAncestorCount, 5)
    assert.equal(result.historicalPlanningAncestorsVerified, true)
    assert.equal(result.coldProcessRestart, 'not_run')
    assert.equal(result.checks.filter(row => row.status === 'pass').length, 7)
    assert.equal(result.checks.find(row => row.id === 'cold_process_reopen')?.status, 'not_run')
    const before = storage.observe(), digest = await ports.namespaceDigest()
    // Reuse the bounded read-only control, but do not copy its native-wrapper
    // result into a report: these ports prove cold repository reopening only.
    await inspectBodyEvidenceReplacementControl(result, ports)
    assert.equal(storage.observe().committedTransactions, before.committedTransactions)
    assert.equal(storage.observe().cumulativeWrittenBytes, before.cumulativeWrittenBytes)
    assert.equal(await ports.namespaceDigest(), digest)
    assert.equal(result.coldProcessRestart, 'not_run')
  }
  // The legacy-probe head read is deliberately NOT the verified-snapshot
  // boundary. Preserve that distinction in both languages using real engine,
  // repository and stored artifacts, with only IO completion injected.
  for (const language of ['zh', 'en'] as const) for (const position of ['first_head', 'verified_fence'] as const) {
    const storage = createBodyEvidenceMemoryIO(), id = `cross-tab-${language}-${position}`, head = `writer-campaign:${id}:head`
    let dispatches = 0, previewWrites = 0, held = false, verifiedReads = 0
    let release!: () => void, reached!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), entered = new Promise<void>(resolve => { reached = resolve })
    const action = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(storage.io), fixture: { onDispatch() { dispatches++ } } })
    let preview: ReturnType<typeof createOfflineCampaignEngine> | undefined
    try {
      await action.prepareBodyEvidence({ campaignId: id, language })
      for (let index = 0; index < 8; index++) await action.step(id, `setup-${index}`)
      const original = await action.inspect(id) as CampaignSnapshot
      const proposal = await buildBodyEvidenceFixtureProposal(original, 2)
      const fence = [head, 'writer-campaign:catalog', `writer-campaign:${id}:checkpoint:${original.head.sequence + 1}`]
      const repository = createCampaignRepository({
        async getMany(keys) {
          const result = await storage.io.getMany(keys)
          const match = position === 'first_head' ? keys.length === 1 && keys[0] === head : keys.length === fence.length && fence.every((key, index) => keys[index] === key)
          if (!held && match) { held = true; reached(); await gate }
          return result
        },
        async compareAndSwapMany() { previewWrites++; throw new Error('preview_write_forbidden') },
      })
      const read = repository.read.bind(repository)
      repository.read = async (...args) => { const value = await read(...args); verifiedReads++; return value }
      preview = createOfflineCampaignEngine({ identity, repository })
      const pending = preview.previewBodyEvidence(id, proposal)
      // If the production bounded preview finishes without reaching the selected
      // phase, fail instead of leaving the test waiting on an unreachable gate.
      await Promise.race([entered, pending.then(() => { throw new Error('expected_read_phase_not_reached') })])
      const beforeMutation = storage.observe(), current = await action.step(id, 'other-tab-step')
      const afterMutation = storage.observe(), bytesAfterMutation = [...storage.rows]
      assert.equal(afterMutation.committedTransactions - beforeMutation.committedTransactions, 4)
      assert.equal(current.head.sequence, original.head.sequence + 4)
      release()
      const result = await pending
      assert.equal(verifiedReads, 2); assert.equal(previewWrites, 0); assert.equal(dispatches, 9)
      assert.deepEqual([...storage.rows], bytesAfterMutation)
      assert.equal(storage.observe().committedTransactions, afterMutation.committedTransactions)
      if (position === 'first_head') {
        assert.equal(result.status, 'ready')
        if (result.status === 'ready') { assert.equal(result.sourceHead.sequence, current.head.sequence); assert.equal(result.throughChapterOrdinal, 2) }
      } else assert.deepEqual(result, { status: 'refused', refusalCode: 'source_changed' })
    } finally { release(); action.dispose(); preview?.dispose() }
  }
  const mockChecks = checkNativeGateMock()
  assert.deepEqual(guard.snapshot(), { observed: true, networkEntries: 0, credentialEntries: 0, configurationReads: 0, ordinaryWriterMutations: 0, externalToolEntries: 0 })
  console.log(`Body Evidence controls: 2 bilingual replacements, 4 cross-tab read positions, ${mockChecks} exported native-gate mock checks; injected IO/cold repository only; native/UI NOT RUN.`)
} finally { guard.restore() }

/** Execute the exact exported init-script code against small API mocks, not a browser. */
function checkNativeGateMock(): number {
  class Storage {
    values = new Map<string, string>()
    getItem(key: string) { return this.values.get(key) ?? null }
    setItem(key: string, value: string) { this.values.set(key, value) }
    removeItem(key: string) { this.values.delete(key) }
    clear() { this.values.clear() }
  }
  class IDBTransaction {
    nativeComplete: ((event: unknown) => void) | null = null
    aborted = false
    constructor(readonly db: IDBDatabase, readonly mode: string) {}
    get oncomplete() { return this.nativeComplete }
    set oncomplete(value) { this.nativeComplete = value }
    abort() { this.aborted = true }
    finish(event: unknown) { this.nativeComplete?.call(this, event) }
  }
  class IDBObjectStore {
    constructor(readonly transaction: IDBTransaction, readonly name: string) {}
    get(_key: string) { return {} }
    put() {} add() {} delete() {} clear() {} openCursor() {}
  }
  class IDBDatabase {
    constructor(readonly name: string) {}
    transaction(_store: string, mode: string) { return new IDBTransaction(this, mode) }
  }
  class XMLHttpRequest { open() {} }
  const sandbox: Record<string, any> = { Storage, IDBTransaction, IDBObjectStore, IDBDatabase, XMLHttpRequest,
    location: { origin: 'https://gate.invalid' }, localStorage: new Storage(), navigator: {}, window: {},
    crypto: { subtle: { async digest() { return new ArrayBuffer(32) } } }, TextEncoder }
  runInNewContext(`(${installBodyEvidenceUiGate.toString()})({expectedOrigin:'https://gate.invalid'})`, sandbox)
  const gate = sandbox.__bodyEvidenceUiGate, head = 'writer-campaign:gate:head'
  const fence = [head, 'writer-campaign:catalog', 'writer-campaign:gate:checkpoint:34']
  let checks = 0, callbacks = 0
  function complete(keys: string[], dbName = 'llm-writer', storeName = 'kv', mode = 'readonly') {
    const tx = new IDBDatabase(dbName).transaction(storeName, mode), store = new IDBObjectStore(tx, storeName), event = {}
    for (const key of keys) store.get(key)
    tx.oncomplete = function (actualEvent) { assert.equal(this, tx); assert.equal(actualEvent, event); callbacks++ }
    tx.finish(event)
    return tx
  }
  for (const invalid of [[], fence.slice(0, 2), [head, fence[2], fence[1]], [head, fence[1], 'writer-campaign:other:checkpoint:34']]) {
    assert.throws(() => gate.armReadBatch(invalid), /body_evidence_ui_gate_batch/); checks++
  }
  const supplied = [...fence]; gate.armReadBatch(supplied); supplied[2] = 'changed-after-arm'
  for (const keys of [[head], fence.slice(0, 2), [head, fence[2]], [head, fence[2], fence[1]], [...fence, 'extra'], [...fence, 'extra', 'extra-again'], [head, fence[1], 'writer-campaign:gate:checkpoint:35']]) {
    const before = callbacks; complete(keys); assert.equal(callbacks, before + 1); assert.equal(gate.snapshot().readHeld, false); checks++
  }
  for (const [db, store, mode] of [['other-db', 'kv', 'readonly'], ['llm-writer', 'other-store', 'readonly'], ['llm-writer', 'kv', 'readwrite']]) {
    const before = callbacks; complete(fence, db, store, mode); assert.equal(callbacks, before + 1); assert.equal(gate.snapshot().readHeld, false); checks++
  }
  const before = callbacks; complete(fence)
  assert.equal(callbacks, before); assert.equal(gate.snapshot().readHeld, true); assert.equal(gate.snapshot().readObserved, 1); assert.equal(gate.snapshot().heldReadKind, 'exact_read_batch'); assert.equal(JSON.stringify(gate.snapshot().heldReadBatch), JSON.stringify(fence)); checks++
  assert.throws(() => gate.armRead(head), /body_evidence_ui_gate_busy/); checks++
  gate.releaseRead(); assert.equal(callbacks, before + 1); assert.equal(gate.snapshot().readHeld, false); assert.equal(gate.snapshot().heldReadBatch, null); assert.equal(gate.snapshot().heldReadKind, null); checks++
  assert.throws(() => gate.releaseRead(), /body_evidence_ui_gate_empty/); checks++
  // Capture continues after oncomplete is installed and no barrier is awarded
  // before the actual completion callback, even when the exact keys exist.
  gate.armReadBatch(fence)
  const early = new IDBDatabase('llm-writer').transaction('kv', 'readonly'), store = new IDBObjectStore(early, 'kv'), event = {}
  let called = false
  store.get(fence[0]!)
  early.oncomplete = function (actualEvent) { assert.equal(this, early); assert.equal(actualEvent, event); called = true }
  store.get(fence[1]!); store.get(fence[2]!)
  assert.equal(gate.snapshot().readHeld, false); assert.equal(called, false)
  early.finish(event); assert.equal(gate.snapshot().readHeld, true); assert.equal(called, false)
  gate.releaseRead(); assert.equal(called, true); checks++
  // Existing first-key and abort gates retain their original behavior.
  gate.armRead(head); complete([head]); assert.equal(gate.snapshot().readHeld, true); gate.releaseRead(); checks++
  gate.armRead(head, 'hold', 1); complete([head]); assert.equal(gate.snapshot().readHeld, false); complete([head]); assert.equal(gate.snapshot().readHeld, true); gate.releaseRead(); checks++
  gate.armRead(head, 'abort'); const aborted = complete([head]); assert.equal(aborted.aborted, true); assert.equal(gate.snapshot().readAborts, 1); assert.equal(gate.snapshot().readHeld, false); checks++
  return checks
}
