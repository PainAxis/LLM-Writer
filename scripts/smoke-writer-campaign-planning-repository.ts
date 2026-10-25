/** Independent repository-boundary probes. Generated packets/stores never leave this process. */
import assert from 'node:assert/strict'
import type { CampaignActionScope, CampaignMutation, CampaignRepositoryIO, CampaignSnapshot, CampaignState } from '../src/types/writerCampaign'
import { createOfflineCampaignEngine, createOfflineCampaignManifest } from '../src/services/writerCampaign/engine'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { planningManifestOptions } from '../src/services/writerCampaign/planningProfile'
import { createOfflineFixtureHost } from '../src/services/writerCampaign/fixtureAdapter'
import { canonicalStringify, hashText, sealCampaignArtifact, sealCampaignRequest, decodeStorageBytes } from '../src/services/writerCampaign/protocol'
import { campaignRequestStorageAllowance } from '../src/services/writerCampaign/budget'

const identity = { runtimeIdentity: 'planning-independent-repository-v1', source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }
const now = 1_800_000_000_000
const cases: string[] = []
let activeCase = 'initial', networkCalls = 0
const originalFetch = globalThis.fetch
globalThis.fetch = async () => { networkCalls++; throw new Error('network disabled') }
function memoryIO() {
  const disk = new Map<string, string>()
  let writes = 0
  const io: CampaignRepositoryIO = {
    async getMany(keys) { return new Map(keys.map(key => [key, disk.get(key) ?? null])) },
    async compareAndSwapMany(entries, canCommit = () => true) {
      if (!canCommit() || entries.some(entry => (disk.get(entry.key) ?? null) !== entry.expectedValue)) return false
      for (const entry of entries) disk.set(entry.key, entry.value)
      writes++; return true
    },
  }
  return { io, disk, get writes() { return writes } }
}
async function manifest(id: string, language: 'zh' | 'en' = 'en') {
  return createOfflineCampaignManifest(planningManifestOptions({ campaignId: id, language, identity, now }))
}
async function finish(engine: ReturnType<typeof createOfflineCampaignEngine>, id: string) {
  let snapshot = await engine.inspect(id) as CampaignSnapshot
  for (let i = 0; i < 10 && snapshot.head.status !== 'completed'; i++) {
    snapshot = await engine.step(id, `complete-${i}`)
    assert.equal(snapshot.checkpoint.reason, null)
  }
  assert.equal(snapshot.head.status, 'completed'); return snapshot
}
function stateOf(snapshot: CampaignSnapshot): CampaignState {
  const c = snapshot.checkpoint
  return { status: c.status, reason: c.reason, executionEpoch: c.executionEpoch, candidateId: c.candidateId,
    tasks: structuredClone(c.tasks), budget: { ...c.budget }, storage: structuredClone(c.storage), lastWallTime: c.lastWallTime }
}
async function replacementMutation(snapshot: CampaignSnapshot, taskId: string, text: string): Promise<CampaignMutation> {
  const oldTask = snapshot.checkpoint.tasks.find(task => task.taskId === taskId)!, old = snapshot.artifacts.get(oldTask.artifact!.hash)!
  const next = stateOf(snapshot), candidateId = 'candidate-independent-bypass', affected = new Set([taskId])
  for (const task of snapshot.manifest.tasks) if (task.dependsOn.some(id => affected.has(id))) affected.add(task.id)
  for (const task of next.tasks) if (affected.has(task.taskId)) {
    task.revision++; task.status = 'invalidated'; task.priorArtifact = task.artifact ?? task.priorArtifact; task.artifact = null; task.request = null
  }
  const artifact = await sealCampaignArtifact({ schemaVersion: 2, campaignId: snapshot.manifest.campaignId, candidateId,
    taskId, taskRevision: oldTask.revision + 1, revision: old.revision + 1, parentHash: old.hash, kind: old.kind,
    dependencies: old.dependencies, text, semanticStatus: 'not_reviewed' })
  const target = next.tasks.find(task => task.taskId === taskId)!
  target.status = 'committed'; target.artifact = { taskId, revision: artifact.revision, hash: artifact.hash }
  next.candidateId = candidateId; next.executionEpoch++; next.status = 'paused'; next.reason = 'candidate_replaced'
  next.budget.activeMs += 10_000
  return { operationId: `bypass-replacement-${taskId}`, kind: 'replace_candidate', next, artifacts: [artifact] }
}
async function test(name: string, run: () => Promise<void>) { activeCase = name; await run(); cases.push(name) }

async function main() {
  for (const language of ['zh', 'en'] as const) await test(`replacement_${language}`, async () => {
    const storage = memoryIO(), repository = createCampaignRepository(storage.io)
    let calls = 0
    const host = createOfflineFixtureHost({ onDispatch: () => { calls++ } })
    const engine = createOfflineCampaignEngine({ identity, clock: () => now, repository, host })
    const m = await manifest(`planning-repository-${language}`, language); await engine.prepare(m)
    const full = await finish(engine, m.campaignId)
    assert.equal(calls, 9); assert.equal(full.checkpoint.tasks.filter(task => task.status === 'committed').length, 9)
    assert.equal(decodeStorageBytes(full.checkpoint.storage.outstandingBytes), 0)
    assert.equal((await createCampaignRepository(storage.io).read(m.campaignId))!.head.checkpointHash, full.head.checkpointHash)
    const writes = storage.writes
    await assert.rejects(() => engine.replaceCandidate(m.campaignId, 'b-1', 'forbidden body replacement', 'bad-body-replacement'))
    assert.equal(storage.writes, writes)
    await assert.rejects(() => replacementMutation(full, 'b-1', 'forbidden repository body replacement').then(mutation => repository.commit(full, mutation)),
      (error: { code: string }) => error.code === 'invalid_planning_payload')
    await assert.rejects(() => replacementMutation(full, 'o-1', '{"invalid":"planning"}').then(mutation => repository.commit(full, mutation)),
      (error: { code: string }) => error.code === 'invalid_planning_payload')
    assert.equal(storage.writes, writes, 'repository bypass attempts must not commit')
    const selected = full.artifacts.get(full.checkpoint.tasks.find(task => task.taskId === 'o-1')!.artifact!.hash)!
    const payload = JSON.parse(selected.text); payload.payload.scenes[0].summary += '!'
    const replaced = await engine.replaceCandidate(m.campaignId, 'o-1', canonicalStringify(payload), 'planning-replacement')
    assert.equal(replaced.checkpoint.bodyCharacters, 0)
    assert.equal(replaced.checkpoint.tasks.filter(task => task.status === 'invalidated').length, 3)
    assert.notEqual(replaced.checkpoint.candidateId, full.checkpoint.candidateId)
    for (const id of ['outline', 'characters', 'details']) {
      const ancestor = replaced.artifacts.get(replaced.checkpoint.tasks.find(task => task.taskId === id)!.artifact!.hash)!
      assert.equal(ancestor.candidateId, full.checkpoint.candidateId, 'unchanged ancestors retain original candidate identity')
    }
    await engine.resume(m.campaignId, 'resume-replacement')
    for (let i = 0; i < 3; i++) await engine.step(m.campaignId, `body-again-${i}`)
    assert.equal(calls, 12)
    const after = await createCampaignRepository(storage.io).read(m.campaignId)
    assert.equal(after!.head.status, 'completed'); assert.equal(after!.checkpoint.bodyCharacters, full.checkpoint.bodyCharacters)
    engine.dispose()
  })

  for (const variant of ['instruction', 'purpose', 'stage_cap', 'omitted_global_record', 'closure_container', 'early_closure_container'] as const) await test(`reserve_${variant}`, async () => {
    const storage = memoryIO(), base = createCampaignRepository(storage.io)
    const targetTask = variant === 'early_closure_container' ? 'characters'
      : ['omitted_global_record', 'closure_container'].includes(variant) ? 'b-1' : 'outline'
    let calls = 0, attacked = false
    const repository = { ...base, async commit(expected: CampaignSnapshot, mutation: CampaignMutation, canCommit?: () => boolean, scope?: CampaignActionScope) {
      const request = mutation.requests?.[0]
      if (!attacked && mutation.kind === 'reserve' && request?.taskId === targetTask) {
        attacked = true
        const forged = structuredClone(request), next = structuredClone(mutation.next)
        if (variant === 'stage_cap') {
          forged.reservation.responseBytes++; forged.reservation.outputTokens++
          next.budget.responseBytes++; next.budget.outputTokens++
        } else {
          const packet = JSON.parse(forged.preparedInput)
          if (variant === 'instruction') packet.instruction = packet.instruction.slice(0, -1) + 'X'
          else if (variant === 'purpose') packet.purpose = 'planning_preview'
          else if (variant === 'closure_container' || variant === 'early_closure_container') {
            const early = variant === 'early_closure_container'
            const row = packet.closure.find((row: { container: string }) => row.container === (early ? 'early_outline' : 'global_outline'))
            assert.ok(row, 'fixture must carry a closure row from the intended source')
            // Preserve the exact record kind/ID and all complete payloads/source refs.
            // Only redirect its container, then legitimately reseal the request below.
            row.container = early ? 'early_character_bible' : 'global_character_bible'
          }
          else packet.globalCanon.outline.genreRules = []
          forged.preparedInput = canonicalStringify(packet); forged.inputDigest = await hashText(forged.preparedInput)
          const oldBytes = forged.inputBytes, oldUtf16 = forged.inputUtf16
          forged.inputBytes = Buffer.byteLength(forged.preparedInput); forged.inputUtf16 = forged.preparedInput.length
          forged.reservation.inputBytes = forged.inputBytes; forged.reservation.inputUtf16 = forged.inputUtf16
          next.budget.inputBytes += forged.inputBytes - oldBytes; next.budget.inputUtf16 += forged.inputUtf16 - oldUtf16
        }
        forged.storageAllocationBytes = campaignRequestStorageAllowance(forged.preparedInput, expected.manifest.tasks.length, forged.reservation.responseBytes)
        const { hash: _hash, ...plain } = forged
        const sealed = await sealCampaignRequest(plain)
        next.tasks.find(task => task.taskId === sealed.taskId)!.request!.hash = sealed.hash
        return base.commit(expected, { ...mutation, next, requests: [sealed] }, canCommit, scope)
      }
      return base.commit(expected, mutation, canCommit, scope)
    } }
    const engine = createOfflineCampaignEngine({ identity, clock: () => now, repository, fixture: { onDispatch: () => { calls++ } } })
    const m = await manifest(`planning-forge-${variant}`); await engine.prepare(m)
    const steps = targetTask === 'b-1' ? 7 : targetTask === 'characters' ? 2 : 1
    let result: CampaignSnapshot | null = null
    for (let i = 0; i < steps; i++) result = await engine.step(m.campaignId, `forge-${i}`)
    assert.equal(attacked, true); assert.equal(result!.head.status, 'blocked')
    assert.equal(result!.checkpoint.reason, 'source_identity_mismatch')
    assert.equal(calls, steps - 1); assert.equal(result!.checkpoint.budget.attempts, steps - 1)
    assert.equal(result!.checkpoint.storage.openAllocations.length, 0)
    await createCampaignRepository(storage.io).read(m.campaignId)
    engine.dispose()
  })

  await test('invalid_retained_save_only', async () => {
    const storage = memoryIO(), repository = createCampaignRepository(storage.io)
    let calls = 0
    const engine = createOfflineCampaignEngine({ identity, clock: () => now, repository,
      fixture: { responseFor: () => '{"not":"planning"}', onDispatch: () => { calls++ } } })
    const m = await manifest('planning-invalid-retained'); await engine.prepare(m); await engine.step(m.campaignId, 'bad-output')
    const snapshot = await repository.read(m.campaignId)
    assert.equal(snapshot!.checkpoint.tasks[0]!.status, 'response_retained'); assert.equal(snapshot!.artifacts.size, 0); assert.equal(calls, 1)
    const attempts = snapshot!.checkpoint.budget.attempts, body = snapshot!.checkpoint.bodyCharacters
    await assert.rejects(() => engine.recoverSaveOnly(m.campaignId, 'invalid-save-only'))
    const after = await repository.read(m.campaignId)
    assert.equal(after!.head.status, 'blocked'); assert.equal(after!.checkpoint.tasks[0]!.status, 'response_retained')
    assert.equal(after!.checkpoint.bodyCharacters, body); assert.equal(after!.checkpoint.budget.attempts, attempts)
    assert.equal(calls, 1); assert.equal(after!.checkpoint.storage.openAllocations.length, 1)
    assert.equal(after!.artifacts.size, 0)
    const running = await engine.resume(m.campaignId, 'resume-invalid-for-bypass')
    const task = running.checkpoint.tasks[0]!, retained = running.requests.get(task.request!.hash)!
    const artifact = await sealCampaignArtifact({ schemaVersion: 2, campaignId: m.campaignId, candidateId: running.checkpoint.candidateId,
      taskId: task.taskId, taskRevision: task.revision, revision: 0, parentHash: null, kind: 'outline', dependencies: [],
      text: retained.response!.text, semanticStatus: 'not_reviewed' })
    const { hash: _retainedHash, ...plain } = retained
    const committed = await sealCampaignRequest({ ...plain, revision: retained.revision + 1, parentHash: retained.hash, status: 'committed' })
    const next = stateOf(running), target = next.tasks[0]!
    target.status = 'committed'; target.artifact = { taskId: task.taskId, revision: 0, hash: artifact.hash }
    target.request = { id: committed.id, revision: committed.revision, hash: committed.hash }
    const writes = storage.writes
    await assert.rejects(() => repository.commit(running, { operationId: `${retained.commandId}:artifact`, kind: 'accept_artifact', next,
      artifacts: [artifact], requests: [committed] }), (error: { code: string }) => error.code === 'invalid_planning_payload')
    assert.equal(storage.writes, writes); assert.equal(calls, 1)
    engine.dispose()
  })
  assert.equal(networkCalls, 0)
  console.log(`Campaign planning repository: ${cases.length} independent boundary cases passed; offline structural checks only.`)
}
try { await main() } catch {
  process.stderr.write(`Campaign planning repository: failed (${activeCase}).\n`)
  process.exitCode = 1
} finally { globalThis.fetch = originalFetch }
