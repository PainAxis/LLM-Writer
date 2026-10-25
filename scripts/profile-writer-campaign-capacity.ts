/** Local-only structural capacity profile. Synthetic repetitions are not narrative or quality evidence. */
import type { CampaignRepositoryIO, CampaignTaskSpec } from '../src/types/writerCampaign'
import { CampaignProtocolError, utf8Bytes } from '../src/services/writerCampaign/protocol'
import { CampaignRuntimeError } from '../src/services/writerCampaign/budget'
import { createCampaignRepository } from '../src/services/writerCampaign/store'
import { createOfflineCampaignEngine, createOfflineCampaignManifest } from '../src/services/writerCampaign/engine'

const identity = { runtimeIdentity: 'controlled-local-capacity-profile-v1', source: { commit: 'c'.repeat(40), tree: 'd'.repeat(40) } }
const originalFetch = globalThis.fetch
const safeCodes = new Set(['budget', 'storage_budget_exhausted', 'budget_exhausted', 'active_budget_exhausted', 'operation_timeout', 'storage_unknown', 'integrity', 'conflict'])
function safeCode(error: unknown): string {
  const code = error instanceof CampaignRuntimeError || error instanceof CampaignProtocolError ? error.code : 'profile_failure'
  return safeCodes.has(code) ? code : 'profile_failure'
}
function profileTasks(): CampaignTaskSpec[] {
  const tasks: CampaignTaskSpec[] = [
    { id: 'outline', kind: 'outline', chapterOrdinal: null, dependsOn: [] },
    { id: 'characters', kind: 'character_bible', chapterOrdinal: null, dependsOn: ['outline'] },
    { id: 'details', kind: 'detailed_outline', chapterOrdinal: null, dependsOn: ['outline', 'characters'] },
  ]
  for (let i = 1; i <= 60; i++) tasks.push(
    { id: `outline-${i}`, kind: 'chapter_outline', chapterOrdinal: i, dependsOn: ['details', 'characters'] },
    { id: `body-${i}`, kind: 'chapter_body', chapterOrdinal: i, dependsOn: i === 1 ? [`outline-${i}`] : [`outline-${i}`, `body-${i - 1}`] },
  )
  return tasks
}
function atomCount(ordinal: number): number { return ordinal < 60 ? 16_667 : 16_647 }
async function profile(language: 'zh' | 'en') {
  const rows = new Map<string, string>()
  let writtenBytes = 0, readBytes = 0, reads = 0, maxBatchBytes = 0, maxBatchKeys = 0, calls = 0
  const io: CampaignRepositoryIO = {
    async getMany(keys) {
      const result = new Map(keys.map(key => [key, rows.get(key) ?? null]))
      const bytes = [...result].reduce((sum, [key, value]) => sum + utf8Bytes(key) + (value === null ? 0 : utf8Bytes(value)), 0)
      readBytes += bytes; reads++; maxBatchBytes = Math.max(maxBatchBytes, bytes); maxBatchKeys = Math.max(maxBatchKeys, keys.length)
      return result
    },
    async compareAndSwapMany(entries, canCommit) {
      if ((canCommit && !canCommit()) || entries.some(entry => (rows.get(entry.key) ?? null) !== entry.expectedValue)) return false
      for (const entry of entries) { rows.set(entry.key, entry.value); writtenBytes += utf8Bytes(entry.key) + utf8Bytes(entry.value) }
      return true
    },
  }
  const repository = createCampaignRepository(io)
  const engine = createOfflineCampaignEngine({ identity, repository, fixture: {
    responseFor(context) {
      if (context.task.kind === 'chapter_body') return (language === 'zh' ? '文' : 'a').repeat(atomCount(context.task.chapterOrdinal!))
      return `synthetic geometry planning ${context.task.kind} ${context.task.chapterOrdinal ?? 0}`
    },
    responseBytesFor(context) { return context.task.kind === 'chapter_body' ? atomCount(context.task.chapterOrdinal!) * (language === 'zh' ? 3 : 1) : 512 },
    onDispatch() { calls++ },
  } })
  const manifest = await createOfflineCampaignManifest({ identity, campaignId: `capacity-${language}`, language, tasks: profileTasks(), fixtureVersion: 'synthetic-storage-geometry-60x16667-v1' })
  const started = performance.now()
  let snapshot = await engine.prepare(manifest), exception: string | null = null
  for (let attempt = 0; attempt < manifest.tasks.length && !['blocked', 'paused', 'cancelled', 'completed'].includes(snapshot.head.status); attempt++) {
    try { snapshot = await engine.step(manifest.campaignId, `profile-${attempt}`) }
    catch (error) { exception = safeCode(error); snapshot = (await engine.inspect(manifest.campaignId))!; break }
  }
  const executionMs = Math.round((performance.now() - started) * 100) / 100
  engine.dispose()
  const beforeBytes = readBytes, beforeReads = reads, resumeStarted = performance.now()
  const restartedRepository = createCampaignRepository(io)
  const restored = await restartedRepository.read(manifest.campaignId)
  const resumeMs = Math.round((performance.now() - resumeStarted) * 100) / 100
  if (!restored || restored.head.checkpointHash !== snapshot.head.checkpointHash || restored.checkpoint.budget.serializedBytes !== writtenBytes) throw new Error('profile verification failed')
  const liveBytesByRecordKind: Record<string, number> = { catalog: 0, manifest: 0, head: 0, checkpoint: 0, receipt: 0, request: 0, artifact: 0 }
  for (const [key, value] of rows) {
    const kind = key === 'writer-campaign:catalog' ? 'catalog' : Object.keys(liveBytesByRecordKind).find(kind => key.includes(`:${kind}:`) || key.endsWith(`:${kind}`))
    if (!kind) throw new Error('profile key category failed')
    liveBytesByRecordKind[kind]! += utf8Bytes(key) + utf8Bytes(value)
  }
  return {
    suite: 'writer-campaign-capacity', language, environment: 'node-injected-atomic-io-not-browser-idb', data: 'runtime-generated-synthetic-repetitions', longformAcceptance: 'NOT_RUN',
    targetBodyScalars: manifest.bodyTarget.characters, plannedTasks: manifest.tasks.length, plannedBodyTasks: 60,
    execution: snapshot.head.status, blockerCode: exception ?? snapshot.checkpoint.reason, committedBodyScalars: snapshot.checkpoint.bodyCharacters,
    committedTasks: snapshot.checkpoint.tasks.filter(task => task.status === 'committed').length, actualFixtureInvocations: calls, reservedAttempts: snapshot.checkpoint.budget.attempts,
    liveRecordCount: rows.size, liveSerializedMapBytes: Object.values(liveBytesByRecordKind).reduce((sum, value) => sum + value, 0), liveBytesByRecordKind,
    cumulativeSerializedBytes: snapshot.checkpoint.budget.serializedBytes, permanentStorageReservationBytes: snapshot.checkpoint.budget.storageReservedBytes,
    reservationHeadroomBytes: snapshot.checkpoint.budget.storageReservedBytes - snapshot.checkpoint.budget.serializedBytes,
    serializedCeilingBytes: manifest.budget.serializedBytes, cumulativeActiveReservationMs: snapshot.checkpoint.budget.activeMs,
    maxReadBatchKeys: maxBatchKeys, maxReadBatchBytes: maxBatchBytes, totalReadBytes: readBytes, totalReadCalls: reads,
    coldRepositoryReadMs: resumeMs, coldRepositoryReadBytes: readBytes - beforeBytes, coldRepositoryReadCalls: reads - beforeReads, executionMs,
    actualBilling: 'unavailable-not-reported', liveModelCalls: 0,
  }
}
try {
  globalThis.fetch = async () => { throw new Error('Network forbidden in local capacity profile') }
  for (const language of ['zh', 'en'] as const) console.log(JSON.stringify(await profile(language)))
} catch (error) {
  console.error(JSON.stringify({ suite: 'writer-campaign-capacity', category: safeCode(error), longformAcceptance: 'NOT_RUN' }))
  process.exitCode = 1
} finally { globalThis.fetch = originalFetch }
