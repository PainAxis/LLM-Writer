/** Local UI/session checks, with networking forbidden. Not model acceptance. */
import assert from 'node:assert/strict'
import * as Vue from 'vue'
import { useCreativePilotLab } from '../src/composables/useCreativePilotLab'
import type { CreativePilotEngine, CreativeSnapshot } from '../src/types/creativePilot'
import { CAMPAIGN_CORE_PATHS } from './campaign-build-identity.mjs'
assert.ok(CAMPAIGN_CORE_PATHS.includes('src/composables/useCreativeLivePilot.ts'))
assert.ok(CAMPAIGN_CORE_PATHS.includes('src/views/CreativeLivePilot.vue'))
import { useCreativeLivePilot, parsePilotUsd } from '../src/composables/useCreativeLivePilot'
import { createCreativePilotRepository } from '../src/services/writerCampaign/creativePilotStore'
import type { CampaignRepositoryIO } from '../src/types/writerCampaign'
const originalNow = Date.now, testStart = performance.now()
Date.now = () => Date.UTC(2026, 10, 2, 12) + Math.floor(performance.now() - testStart)
const rows = new Map<string, string>()
let failure: 'before' | 'after' | null = null, createAttempts = 0
const io: CampaignRepositoryIO = {
  async getMany(keys) { return new Map(keys.map(key => [key, rows.get(key) ?? null])) },
  async compareAndSwapMany(entries, canCommit = () => true) {
    if (!canCommit() || entries.some(row => (rows.get(row.key) ?? null) !== row.expectedValue)) return false
    const englishCreate = entries.some(row => row.value?.includes('\"protocolVersion\":\"creative-pilot-v4\"') && row.value.includes('\"language\":\"en\"'))
    if (englishCreate) createAttempts++
    const fault = englishCreate ? failure : null
    if (fault) failure = null
    if (fault === 'before') throw new Error('synthetic_create_failure')
    for (const row of entries) rows.set(row.key, row.value)
    if (fault === 'after') throw new Error('synthetic_ack_unknown')
    return true
  },
}
const repository = createCreativePilotRepository({ io })
const identity = { runtimeIdentity: `campaign-core-sha256:${'a'.repeat(64)}`, source: { commit: 'b'.repeat(40), tree: 'c'.repeat(40) } }
const session = useCreativeLivePilot({ repository, identity })
let attempts = 0
const fetchBefore = globalThis.fetch
const secret = 'synthetic-ui-secret-never-persist'
globalThis.fetch = async () => { attempts++; throw new Error('external_network_forbidden') }
try {
  assert.equal(parsePilotUsd('5.743728'), 5743728)
  for (const value of ['5.743727', 'NaN', '1e2', '-6', '6.0000001', '']) assert.throws(() => parsePilotUsd(value))
  const zh = { protocol: 'creative-brief-v1' as const, language: 'zh' as const, premise: '一位馆员寻找失落的雨声。', constraints: [] }
  const en = { protocol: 'creative-brief-v1' as const, language: 'en' as const, premise: 'An archivist searches for a missing sound of rain.', constraints: [] }
  assert.equal(await session.prepare({ zh, en, maxUsd: '6', consent: false }), false)
  assert.equal(rows.size, 0)
  assert.equal(await session.prepare({ zh, en, maxUsd: '6', consent: true }), true, session.error.value)
  const grant = session.grant.value!
  assert.equal(session.authorized.value, false)
  assert.equal(attempts, 0)
  assert.equal(await session.authorize(secret, false), false)
  assert.equal(await session.authorize('', true), false)
  assert.equal(await session.authorize(secret, true), true, session.error.value)
  assert.equal(session.authorized.value, true)
  assert.equal(attempts, 0)
  assert.equal([...rows.values()].some(value => value.includes(secret)), false)
  const preview = await session.engines.value.zh!.dryPrepare(grant.campaignIds.zh)
  assert.equal(preview.readiness, 'live_provider_ready')
  assert.equal(attempts, 0)
  // Two mounted-panel ownership chains: one held run blocks the sibling,
  // then its completion must release the sibling's preview and Start controls.
  const running = Vue.reactive({ zh: false, en: false }), app = Vue.createApp({ render: () => null })
  const labs: Partial<Record<'zh' | 'en', ReturnType<typeof useCreativePilotLab>>> = {}
  const stopWatches: Array<() => void> = []
  let finishChinese!: (value: CreativeSnapshot) => void
  const heldChinese = new Promise<CreativeSnapshot>(resolve => { finishChinese = resolve })
  for (const language of ['zh', 'en'] as const) {
    const original = session.engines.value[language]!
    const engine: CreativePilotEngine = { ...original, start: language === 'zh' ? () => heldChinese : original.start }
    const lab = app.runWithContext(() => useCreativePilotLab({ campaignId: Vue.ref(grant.campaignIds[language]), selectedV4: Vue.ref(true), lockedBrief: true, engine,
      externalBusy: Vue.computed(() => running[language === 'zh' ? 'en' : 'zh']) }))
    labs[language] = lab
    stopWatches.push(Vue.watch([lab.busy, lab.loading], ([active, reading]) => { running[language] = active || reading }, { flush: 'sync' }))
  }
  try {
    for (let spin = 0; spin < 1000 && (labs.zh!.loading.value || labs.en!.loading.value); spin++) await new Promise(resolve => setTimeout(resolve, 1))
    assert.equal(labs.zh!.canDryPrepare.value, true)
    assert.equal(labs.en!.canDryPrepare.value, true)
    assert.equal(await labs.zh!.dryPrepare(), true)
    labs.zh!.consent.value = true
    const started = labs.zh!.start()
    assert.equal(running.zh, true); assert.equal(labs.en!.canDryPrepare.value, false)
    const completed = structuredClone(labs.zh!.snapshot.value!)
    completed.checkpoint.status = 'completed'; finishChinese(completed)
    assert.equal(await started, true)
    await Vue.nextTick()
    assert.equal(running.zh, false); assert.equal(labs.en!.canDryPrepare.value, true)
    assert.equal(await labs.en!.dryPrepare(), true)
    labs.en!.consent.value = true
    assert.equal(labs.en!.canStart.value, true)
    assert.equal(attempts, 0)
    console.log('PASS paired panel busy ownership releases English preview and Start after Chinese completion')
  } finally { stopWatches.forEach(stop => stop()); labs.zh?.dispose(); labs.en?.dispose() }
  session.revoke()
  assert.equal(session.authorized.value, false)
  assert.deepEqual(session.engines.value, {})
  const beforeRestore = new Map(rows)
  assert.equal(await session.restore(grant.campaignIds.en), true, session.error.value)
  assert.equal(session.grant.value!.hash, grant.hash)
  assert.equal(session.authorized.value, false)
  assert.deepEqual(rows, beforeRestore)
  assert.equal((await session.engines.value.en!.inspect(grant.campaignIds.en))!.checkpoint.budget.attempts, 0)
  assert.equal((await session.engines.value.en!.dryPrepare(grant.campaignIds.en)).readiness, 'unconfigured')
  session.dispose()
  assert.equal(await session.authorize(secret, true), false)
  assert.equal(attempts, 0)
  const partial = useCreativeLivePilot({ repository, identity })
  failure = 'before'
  assert.equal(await partial.prepare({ zh, en, maxUsd: '6', consent: true }), false)
  assert.deepEqual(partial.prepared.value, { zh: true, en: false })
  const partialGrant = partial.grant.value!
  assert.equal(await partial.authorize(secret, true), false)
  const firstZh = await partial.engines.value.zh!.inspect(partialGrant.campaignIds.zh)
  partial.dispose()
  const restored = useCreativeLivePilot({ repository, identity })
  assert.equal(await restored.restore(partialGrant.campaignIds.zh), true)
  assert.deepEqual(restored.prepared.value, { zh: true, en: false })
  assert.equal(await restored.complete({ en: { ...en, premise: 'Changed brief' } }), false)
  assert.equal(await restored.complete({ en }), true, restored.error.value)
  assert.equal(restored.grant.value!.hash, partialGrant.hash)
  assert.equal((await restored.engines.value.zh!.inspect(partialGrant.campaignIds.zh))!.rawHead, firstZh!.rawHead)
  restored.dispose()
  const acknowledged = useCreativeLivePilot({ repository, identity })
  const priorAttempts = createAttempts; failure = 'after'
  assert.equal(await acknowledged.prepare({ zh, en, maxUsd: '6', consent: true }), true, acknowledged.error.value)
  assert.equal(createAttempts - priorAttempts, 1)
  assert.deepEqual(acknowledged.prepared.value, { zh: true, en: true })
  const expiredGrant = acknowledged.grant.value!, expiredRows = new Map(rows)
  const pendingAuthorization = acknowledged.authorize(secret, true)
  assert.equal(acknowledged.busy.value, true)
  acknowledged.revoke()
  assert.equal(acknowledged.busy.value, false)
  assert.equal(acknowledged.authorized.value, false)
  assert.equal(await pendingAuthorization, false)
  assert.equal(acknowledged.busy.value, false)
  assert.equal(await acknowledged.restore(expiredGrant.campaignIds.zh), true)
  assert.deepEqual(rows, expiredRows)
  assert.equal(attempts, 0)
  console.log('PASS revocation during pending live authorization clears busy and cannot restore authority')
  Date.now = () => expiredGrant.expiresAt + 1
  assert.equal(await acknowledged.authorize(secret, true), false)
  assert.equal(acknowledged.busy.value, false)
  assert.equal(acknowledged.authorized.value, false)
  assert.equal((await acknowledged.engines.value.zh!.inspect(expiredGrant.campaignIds.zh))!.checkpoint.budget.attempts, 0)
  assert.equal(await acknowledged.restore(expiredGrant.campaignIds.en), true, acknowledged.error.value)
  assert.equal(acknowledged.busy.value, false)
  assert.equal(acknowledged.authorized.value, false)
  assert.equal(acknowledged.grant.value!.hash, expiredGrant.hash)
  assert.deepEqual(rows, expiredRows)
  assert.equal([...rows.values()].some(value => value.includes(secret)), false)
  acknowledged.dispose()
  assert.equal(attempts, 0)
  console.log('PASS expired live authorization leaves idle read-only inspection/restoration and zero calls')
  console.log('PASS live-ui partial pair restoration + hash-bound completion; lost create acknowledgement read-back without replay')
  console.log('PASS live-ui budget parsing, explicit consent, zero-call pair preparation/preview, session-only credential, revocation, same-pair read-only restoration')
} finally { session.dispose(); globalThis.fetch = fetchBefore; Date.now = originalNow }
