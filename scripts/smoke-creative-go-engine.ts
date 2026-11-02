/** Real SDK + shared engine/repository, wholly synthetic fetch; never a provider connection. */
import assert from 'node:assert/strict'
import { createCreativePilotEngine } from '../src/services/writerCampaign/creativePilotEngine'
import { createCreativePilotRepository } from '../src/services/writerCampaign/creativePilotStore'
import { createCreativeGoSdkHost } from '../src/services/writerCampaign/creativePilotTransport'
import { CREATIVE_GO_GRANT_DEFAULTS, sealCreativeGoGrant } from '../src/services/writerCampaign/creativePilotProtocol'
import { canonicalStringify, hashCampaignValue } from '../src/services/writerCampaign/protocol'
import { creativePilotBriefs } from './lib/creative-pilot-briefs'
import { creativeControlText } from './lib/creative-pilot-control'
import { createCreativeMemoryIO } from './lib/creative-pilot-io'
import { installCreativeNodeStorage } from './lib/creative-pilot-node-server'
import type { CreativeGoGrantV1, CreativeSnapshot, CreativePromptPayloadV1 } from '../src/types/creativePilot'

const originalNow = Date.now, originalFetch = globalThis.fetch
Date.now = () => Date.UTC(2026, 10, 2, 12)
const storage = installCreativeNodeStorage()
const memory = createCreativeMemoryIO(), repository = createCreativePilotRepository({ io: memory.io })
const identity = { runtimeIdentity: `campaign-core-sha256:${'a'.repeat(64)}`, source: { commit: 'b'.repeat(40), tree: 'c'.repeat(40) } }
const briefs = { zh: creativePilotBriefs()[0]!.brief, en: creativePilotBriefs()[3]!.brief }
const briefHashes = { zh: await hashCampaignValue('creative-brief-v1', briefs.zh), en: await hashCampaignValue('creative-brief-v1', briefs.en) }
const makeGrant = (suffix: string) => sealCreativeGoGrant({ ...CREATIVE_GO_GRANT_DEFAULTS,
  grantId: `go-engine-${suffix}`, campaignIds: { zh: `go-engine-${suffix}-zh`, en: `go-engine-${suffix}-en` }, briefHashes,
  maxCostMicroUsd: 3_000_000, transmissionConsent: true, expiresAt: Date.now() + 86_400_000 })
const grant = await makeGrant('positive')
let current: CreativeGoGrantV1 | null = grant
const syntheticCredential = 'synthetic-go-engine-credential-never-real'
let credential: string | null = syntheticCredential
let calls = 0, loseResponse = false
const packets: CreativePromptPayloadV1[] = [], sessions: string[] = []
const billing = { status: 'valid', billingSource: 'go', costUsd: '0', allowanceUsd: '0.00000658', listCostUsd: '0.00000658' } as const
globalThis.fetch = async (url, init) => {
  calls++
  assert.ok(calls <= 19)
  assert.equal(String(url), 'https://opencode.ai/inference/go/openai/v1/chat/completions')
  assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error')
  const headers = new Headers(init?.headers)
  assert.deepEqual([...headers.keys()].sort(), ['authorization', 'content-type', 'user-agent', 'x-opencode-session'].sort())
  assert.equal(headers.get('authorization'), `Bearer ${syntheticCredential}`)
  assert.equal(headers.get('content-type'), 'application/json')
  assert.equal(headers.get('user-agent'), 'LLM-Writer-Creative-Pilot/1.0')
  const wire = JSON.parse(String(init?.body))
  assert.deepEqual(Object.keys(wire).sort(), ['model', 'temperature', 'messages', 'max_completion_tokens', 'thinking', 'stream'].sort())
  assert.equal(wire.model, 'mimo-v2.6-flash'); assert.equal(wire.temperature, 0.7)
  assert.equal(wire.max_completion_tokens, 4096); assert.deepEqual(wire.thinking, { type: 'disabled' }); assert.equal(wire.stream, false)
  assert.equal(wire.messages.length, 2)
  const packet = JSON.parse(wire.messages[1].content) as CreativePromptPayloadV1
  assert.equal(packet.scope.exposure, 'author_and_opencode_go_writer')
  assert.equal(headers.get('x-opencode-session'), `ses_${current!.campaignIds[packet.identity.language]}`)
  packets.push(packet); sessions.push(headers.get('x-opencode-session')!)
  if (loseResponse) throw new TypeError('synthetic_response_lost_after_dispatch')
  const content = await creativeControlText(packet)
  return new Response(JSON.stringify({ id: `synthetic-go-${calls}`, object: 'chat.completion', created: 1, model: 'mimo-v2.6-flash',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 37, completion_tokens: 29, cost: 0,
      opencode: { billing_source: 'go', allowance: 0.00000658, list_cost: 0.00000658, tokens: { reasoning: 0 } } } }),
  { status: 200, headers: { 'content-type': 'application/json' } })
}
const engines: ReturnType<typeof createCreativePilotEngine>[] = []
const buildEngine = async (liveGrant: CreativeGoGrantV1) => {
  const host = await createCreativeGoSdkHost({ grant: liveGrant, readCredential: () => credential, currentGrant: () => current })
  const engine = createCreativePilotEngine({ repository, host, liveGrant, identity, maxTasksPerRun: 1 })
  engines.push(engine); return engine
}
let operation = 0
const command = (s: CreativeSnapshot) => ({ campaignId: s.manifest.campaignId, operationId: `go-run-${++operation}`,
  expectedRawHead: s.rawHead, expectedCandidateHash: s.candidate.hash })
try {
  const engine = await buildEngine(grant), finals: CreativeSnapshot[] = []
  for (const language of ['zh', 'en'] as const) {
    let snapshot = await engine.prepare({ campaignId: grant.campaignIds[language], operationId: `prepare-${language}`, brief: briefs[language] })
    const before = calls
    const preview = await engine.dryPrepare(snapshot.manifest.campaignId)
    assert.equal(preview.readiness, 'live_provider_ready'); assert.equal(calls, before)
    for (let task = 1; task <= 9; task++) {
      snapshot = await (task === 1 ? engine.start(command(snapshot)) : engine.resume(command(snapshot)))
      assert.equal(calls, before + task)
      assert.equal(snapshot.artifacts.size, task)
      assert.equal(snapshot.checkpoint.budget.attempts, task)
      assert.ok(snapshot.checkpoint.budget.operations <= 48)
      assert.equal(snapshot.checkpoint.metadata.recoveryUsed, 0)
      assert.equal(snapshot.checkpoint.metadata.cancelUsed, false)
      assert.equal(snapshot.checkpoint.tasks.filter(row => row.status === 'accepted').length, task)
      assert.equal(snapshot.checkpoint.status, task === 9 ? 'completed' : 'prepared')
      assert.equal(snapshot.manifest.hash, (await engine.inspect(snapshot.manifest.campaignId))!.manifest.hash)
      // A normal one-task return leaves no unknown/dispatch obligation and needs no stop/cancel.
      assert.ok(snapshot.checkpoint.requests.every(row => snapshot.phases.get(row.phaseHash)?.status === 'resolved'))
      await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, before + task)
      assert.ok([...snapshot.responses.values()].every(response => response.usage.provenance === 'provider_reported'))
      for (const response of snapshot.responses.values()) assert.deepEqual(response.usage.go, billing)
    }
    assert.equal([...snapshot.artifacts.values()].filter(a => a.taskId.startsWith('b-')).length, 3)
    for (const packet of packets.filter(p => p.identity.language === language && p.identity.stage === 'chapter_body')) {
      const ordinal = packet.identity.chapterOrdinal!
      assert.equal(packet.previousBodies.length, ordinal - 1)
      assert.deepEqual(packet.previousBodies.map(body => body.text), Array.from({ length: ordinal - 1 }, (_, i) =>
        [...snapshot.artifacts.values()].find(a => a.taskId === `b-${i + 1}`)!.text))
    }
    assert.equal(new Set(sessions.slice(before, calls)).size, 1)
    assert.ok(snapshot.manifest.policy.protocol === 'creative-pilot-go-policy-v1')
    assert.equal(canonicalStringify(snapshot.manifest.policy.grant), canonicalStringify(grant))
    await assert.rejects(engine.start(command(snapshot))); await assert.rejects(engine.resume(command(snapshot)))
    finals.push(snapshot)
  }
  assert.equal(calls, 18); engine.dispose()
  current = null; credential = null
  const readOnly = createCreativePilotEngine({ repository, identity }); engines.push(readOnly)
  for (const final of finals) {
    const restored = await readOnly.inspect(final.manifest.campaignId)
    assert.equal(restored?.checkpoint.hash, final.checkpoint.hash)
    for (const response of restored!.responses.values()) assert.deepEqual(response.usage.go, billing)
    await assert.rejects(readOnly.start(command(final))); await assert.rejects(readOnly.resume(command(final)))
  }
  assert.equal(calls, 18)

  // A separate authorized synthetic pair loses its first reply after dispatch.
  const unknownGrant = await makeGrant('unknown'); current = unknownGrant; credential = syntheticCredential
  const interrupted = await buildEngine(unknownGrant)
  const prepared = await interrupted.prepare({ campaignId: unknownGrant.campaignIds.zh, operationId: 'prepare-unknown', brief: briefs.zh })
  loseResponse = true
  await assert.rejects(interrupted.start(command(prepared)))
  assert.equal(calls, 19)
  const unknown = await interrupted.inspect(prepared.manifest.campaignId)
  assert.ok(unknown); assert.equal(unknown.checkpoint.budget.attempts, 1)
  assert.equal(unknown.responses.size, 0); assert.equal(unknown.artifacts.size, 0)
  assert.equal(unknown.checkpoint.requests.length, 1)
  assert.equal(unknown.phases.get(unknown.checkpoint.requests[0]!.phaseHash)?.status, 'outcome_unknown')
  await assert.rejects(interrupted.resume(command(unknown))); assert.equal(calls, 19)
  interrupted.dispose()
  const reopened = await buildEngine(unknownGrant)
  const restoredUnknown = await reopened.inspect(prepared.manifest.campaignId)
  assert.equal(restoredUnknown?.checkpoint.hash, unknown.checkpoint.hash)
  await assert.rejects(reopened.start(command(restoredUnknown!)))
  await assert.rejects(reopened.resume(command(restoredUnknown!)))
  assert.equal(calls, 19); assert.equal(restoredUnknown!.checkpoint.budget.attempts, 1)
  assert.equal(memory.observe().accountingMismatches, 0)
  assert.ok(![...memory.rows.values()].some(raw => raw.includes(syntheticCredential)))
  console.log(JSON.stringify({ status: 'pass', scope: 'synthetic_go_sdk_engine', languages: 2, tasks: 18, bodies: 6,
    maxTasksPerRun: 1, normalPauses: 16, fullPreviousBodies: true, interceptedRequests: 19, unknownNotReplayed: true,
    providerReportedBillingRetained: true, actualProviderCalls: 0, keyPersisted: false }))
} finally {
  for (const engine of engines) engine.dispose()
  globalThis.fetch = originalFetch; Date.now = originalNow; storage.dispose()
}
