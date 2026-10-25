/** Production planning integration recovery. No provider, network or editor authority. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import type { CampaignMutation, CampaignRepository } from '../src/types/writerCampaign'
import { createOfflineCampaignEngine, createOfflineCampaignManifest } from '../src/services/writerCampaign/engine'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { createOfflineFixtureHost, type OfflineFixtureOptions } from '../src/services/writerCampaign/fixtureAdapter'
import { planningManifestOptions } from '../src/services/writerCampaign/planningProfile'
import { canonicalStringify, decodeStorageBytes } from '../src/services/writerCampaign/protocol'
import { createPlanningMemoryIO } from './fixtures/writer-campaign-planning-io'
import { safePlanningCode } from './fixtures/writer-campaign-planning-report'
import { runPlanningBoundary } from './fixtures/writer-campaign-planning-boundaries'
import { installNodePlanningAuthorityGuard } from './fixtures/writer-campaign-planning-authority.mjs'
// Independent transitive import-graph gate complements runtime entry sentinels.
const root = fileURLToPath(new URL('../', import.meta.url)), visited = new Set<string>()
function inspectAuthorityGraph(file: string) {
  if (visited.has(file)) return
  assert.ok(file.startsWith(path.join(root, 'src/services/writerCampaign/')) || file === path.join(root, 'src/services/blobStore.ts') || file === path.join(root, 'src/types/writerCampaign.ts'))
  visited.add(file)
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text
      assert.ok(specifier.startsWith('.'), 'planning_import_scope')
      const target = path.resolve(path.dirname(file), specifier); inspectAuthorityGraph(target.endsWith('.ts') ? target : `${target}.ts`)
    }
    if (ts.isIdentifier(node)) assert.ok(!['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'localStorage', 'sessionStorage', 'eval'].includes(node.text), 'planning_authority_identifier')
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) assert.ok(node.expression.kind !== ts.SyntaxKind.ImportKeyword && !(ts.isIdentifier(node.expression) && ['require', 'Function'].includes(node.expression.text)), 'planning_dynamic_authority')
    ts.forEachChild(node, visit)
  }
  visit(source)
}
inspectAuthorityGraph(path.join(root, 'src/services/writerCampaign/engine.ts'))
const identity = { runtimeIdentity: 'controlled-planning-engine-smoke-v1', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }
const guard = installNodePlanningAuthorityGuard(), engines: Array<ReturnType<typeof createOfflineCampaignEngine>> = []
let cases = 0
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
function setup(id: string, options: OfflineFixtureOptions = {}) {
  const storage = createPlanningMemoryIO(), repository = createCampaignRepository(storage.io); let calls = 0
  const host = createOfflineFixtureHost({ ...options, onDispatch: async request => { calls++; await options.onDispatch?.(request) } })
  const engine = createOfflineCampaignEngine({ identity, repository, host }); engines.push(engine)
  return { storage, repository, host, engine, calls: () => calls, async prepare() { await engine.prepare(await createOfflineCampaignManifest(planningManifestOptions({ campaignId: id, language: 'en', identity }))) } }
}
try {
  for (const language of ['zh', 'en'] as const) for (const boundary of ['replacement', 'cancel_accept', 'accept_ack_loss'] as const) {
    const storage = createPlanningMemoryIO(), row = await runPlanningBoundary(boundary, language, identity, storage.observe, guard.snapshot, storage.io)
    assert.equal(row.status, 'pass'); assert.equal(row.accountingMismatches, 0); assert.equal(row.dispatches, boundary === 'replacement' ? 6 : 1); assert.equal(row.committedTransactions, boundary === 'replacement' ? 27 : 6); cases++
  }
  // Invalid bounded response remains retained but unaccepted across cold reopen/save-only.
  {
    const t = setup('invalid-retained', { responseFor: () => '{"invalid":true}' }); await t.prepare()
    await t.engine.step('invalid-retained', 'invalid-output').catch(() => null)
    const snapshot = (await t.repository.read('invalid-retained'))!
    assert.equal(snapshot.head.status, 'blocked'); assert.equal(snapshot.checkpoint.tasks[0]!.status, 'response_retained'); assert.equal(snapshot.artifacts.size, 0)
    const storageBefore = snapshot.checkpoint.storage, attempts = snapshot.checkpoint.budget.attempts
    const restarted = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(t.storage.io) }); engines.push(restarted)
    await restarted.recoverSaveOnly('invalid-retained', 'invalid-save').catch(() => null)
    const after = (await t.repository.read('invalid-retained'))!
    assert.equal(after.head.status, 'blocked'); assert.equal(after.artifacts.size, 0); assert.equal(t.calls(), 1); assert.equal(after.checkpoint.budget.attempts, attempts)
    assert.equal(after.checkpoint.storage.outstandingBytes, storageBefore.outstandingBytes); assert.equal(after.checkpoint.storage.releasedBytes, storageBefore.releasedBytes); assert.equal(after.checkpoint.bodyCharacters, 0)
    cases++
  }
  // Unknown intent is never reconstructed by redispatching deterministic fixtures.
  {
    const entered = deferred(), gate = deferred(), t = setup('unknown-intent', { async onDispatch() { entered.resolve(); await gate.promise } }); await t.prepare()
    const pending = t.engine.step('unknown-intent', 'original'); await entered.promise
    const restarted = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(t.storage.io) }); engines.push(restarted)
    await restarted.resume('unknown-intent', 'takeover'); const snapshot = await restarted.step('unknown-intent', 'inspect-unknown')
    assert.equal(snapshot.head.status, 'blocked'); assert.equal(snapshot.checkpoint.reason, 'dispatch_outcome_unknown'); assert.equal(snapshot.artifacts.size, 0); assert.equal(t.calls(), 1)
    gate.resolve(); await pending.catch(() => null)
    const after = (await t.repository.read('unknown-intent'))!; assert.equal(after.artifacts.size, 0); assert.equal(t.calls(), 1); assert.ok(decodeStorageBytes(after.checkpoint.storage.outstandingBytes) > 0)
    cases++
  }
  // Valid retained response is accepted after a cold save-only reopen with no new call.
  {
    const t = setup('valid-retained'); let held = false, capture: CampaignMutation | undefined
    const proxy: CampaignRepository = { ...t.repository, async commit(expected, mutation, canCommit, scope) {
      if (!held && mutation.kind === 'accept_artifact') { held = true; capture = mutation; throw new Error('controlled_before_accept') }
      return t.repository.commit(expected, mutation, canCommit, scope)
    } }
    const engine = createOfflineCampaignEngine({ identity, repository: proxy, host: t.host }); engines.push(engine)
    await engine.prepare(await createOfflineCampaignManifest(planningManifestOptions({ campaignId: 'valid-retained', language: 'en', identity })))
    await engine.step('valid-retained', 'original').catch(() => null)
    assert.ok(capture); const retained = (await t.repository.read('valid-retained'))!; assert.equal(retained.checkpoint.tasks[0]!.status, 'response_retained'); assert.equal(retained.artifacts.size, 0)
    const restarted = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(t.storage.io) }); engines.push(restarted)
    const saved = await restarted.recoverSaveOnly('valid-retained', 'save-only')
    assert.equal(saved.checkpoint.tasks[0]!.status, 'committed'); assert.equal(t.calls(), 1); assert.equal(decodeStorageBytes(saved.checkpoint.storage.outstandingBytes), 0)
    assert.equal(saved.artifacts.values().next().value!.text, retained.requests.values().next().value!.response!.text); cases++
  }
  // Cancellation during preparation prevents any reservation/intent; it is not zero cost after intent.
  {
    const entered = deferred(), gate = deferred(), t = setup('cancel-prepare'); await t.prepare()
    const original = t.host.provider.prepareRequest.bind(t.host.provider)
    t.host.provider.prepareRequest = async context => { entered.resolve(); await gate.promise; return original(context) }
    const pending = t.engine.step('cancel-prepare', 'original'); await entered.promise
    const other = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(t.storage.io) }); engines.push(other)
    await other.cancel('cancel-prepare', 'cancel'); gate.resolve(); await pending.catch(() => null)
    const snapshot = (await t.repository.read('cancel-prepare'))!
    assert.equal(snapshot.head.status, 'cancelled'); assert.equal(snapshot.checkpoint.budget.attempts, 0); assert.equal(t.calls(), 0); assert.equal(snapshot.requests.size, 0); cases++
  }
  // Reserved-input restart reproduces exact digest without refilling attempts.
  {
    const t = setup('reserved-restart'); await t.prepare(); let fired = false
    t.storage.setAfter(async entries => { const receipt = entries.find(entry => entry.key.includes(':receipt:')); if (!fired && receipt && JSON.parse(receipt.value).kind === 'reserve') { fired = true; throw new Error('controlled_reserve_ack_loss') } })
    await t.engine.step('reserved-restart', 'reserve').catch(() => null); t.storage.setAfter()
    const before = (await t.repository.read('reserved-restart'))!; assert.equal(before.checkpoint.tasks[0]!.status, 'reserved'); assert.equal(t.calls(), 0)
    const request = before.requests.get(before.checkpoint.tasks[0]!.request!.hash)!, restarted = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(t.storage.io), host: t.host }); engines.push(restarted)
    await restarted.resume('reserved-restart', 'resume'); const saved = await restarted.step('reserved-restart', 'continue')
    const after = saved.requests.get(saved.checkpoint.tasks[0]!.request!.hash)!
    assert.equal(after.preparedInput, request.preparedInput); assert.equal(after.inputDigest, request.inputDigest); assert.equal(saved.checkpoint.budget.attempts, 1); assert.equal(t.calls(), 1); cases++
  }
  // Body replacement is forbidden only for this profile, after successful real task execution.
  {
    const t = setup('body-replacement'); await t.prepare()
    for (let i = 0; i < 9; i++) await t.engine.step('body-replacement', `step-${i}`)
    const snapshot = (await t.repository.read('body-replacement'))!, task = snapshot.manifest.tasks.find(task => task.kind === 'chapter_body')!
    const before = canonicalStringify(snapshot.checkpoint), calls = t.calls()
    await assert.rejects(() => t.engine.replaceCandidate('body-replacement', task.id, 'unauthorized replacement', 'replace-body'))
    assert.equal(canonicalStringify((await t.repository.read('body-replacement'))!.checkpoint), before); assert.equal(t.calls(), calls); cases++
  }
  assert.ok(Object.values(guard.snapshot()).every(value => value === 0))
  console.log(`Planning engine recovery: ${cases} cases passed; semanticConsistency=NOT_RUN.`)
} catch (error) { console.error(JSON.stringify({ suite: 'writer-campaign-planning-engine', code: safePlanningCode(error), semanticConsistency: 'NOT_RUN' })); process.exitCode = 1 }
finally { engines.forEach(engine => engine.dispose()); guard.restore() }
