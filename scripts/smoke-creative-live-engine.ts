/** Real SDK/engine/repository with an in-process HTTP response control, never a provider call. */
import assert from 'node:assert/strict'
import { createCreativePilotEngine } from '../src/services/writerCampaign/creativePilotEngine'
import { createCreativePilotRepository } from '../src/services/writerCampaign/creativePilotStore'
import { createCreativeLiveSdkHost } from '../src/services/writerCampaign/creativePilotTransport'
import { CREATIVE_LIVE_GRANT_DEFAULTS, sealCreativeLiveGrant } from '../src/services/writerCampaign/creativePilotProtocol'
import { canonicalStringify, hashCampaignValue } from '../src/services/writerCampaign/protocol'
import { creativePilotBriefs } from './lib/creative-pilot-briefs'
import { creativeControlText } from './lib/creative-pilot-control'
import { createCreativeMemoryIO } from './lib/creative-pilot-io'
import { installCreativeNodeStorage } from './lib/creative-pilot-node-server'
import type { CreativeLiveGrantV1, CreativeSnapshot, CreativePromptPayloadV1 } from '../src/types/creativePilot'

const realNow = Date.now
Date.now = () => Date.UTC(2026, 10, 2, 12)
const storage = installCreativeNodeStorage(), originalFetch = globalThis.fetch
const memory = createCreativeMemoryIO(), repository = createCreativePilotRepository({ io: memory.io })
const identity = { runtimeIdentity: `campaign-core-sha256:${'a'.repeat(64)}`, source: { commit: 'b'.repeat(40), tree: 'c'.repeat(40) } }
const briefs = { zh: creativePilotBriefs()[0]!.brief, en: creativePilotBriefs()[3]!.brief }
const campaignIds = { zh: 'live-engine-zh', en: 'live-engine-en' }
const briefHashes = { zh: await hashCampaignValue('creative-brief-v1', briefs.zh), en: await hashCampaignValue('creative-brief-v1', briefs.en) }
const grant = await sealCreativeLiveGrant({ ...CREATIVE_LIVE_GRANT_DEFAULTS, grantId: 'live-engine-grant', campaignIds, briefHashes,
  maxCostMicroUsd: 6_000_000, transmissionConsent: true, expiresAt: Date.now() + 86_400_000 })
let current: CreativeLiveGrantV1 | null = grant
let credential: string | null = 'synthetic-session-key-never-real'
let calls = 0
const packets: CreativePromptPayloadV1[] = []
globalThis.fetch = async (url, init) => {
  try {
  assert.equal(String(url), 'https://api.openai.com/v1/chat/completions')
  assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error')
  assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${credential}`)
  const wire = JSON.parse(String(init?.body))
  assert.deepEqual(Object.keys(wire).sort(), ['model','temperature','messages','max_completion_tokens','reasoning_effort','service_tier','store','stream'].sort())
  assert.equal(wire.model, grant.modelId); assert.equal(wire.reasoning_effort, 'none')
  assert.equal(wire.service_tier, 'default'); assert.equal(wire.store, false); assert.equal(wire.stream, false)
  assert.equal(wire.max_completion_tokens, 4096); assert.equal(wire.temperature, 0.7)
  const packet = JSON.parse(wire.messages[1].content) as CreativePromptPayloadV1
  assert.equal(packet.scope.exposure, 'author_and_openai_writer')
  calls++; assert.ok(calls <= 18); packets.push(packet)
  const content = await creativeControlText(packet)
  return new Response(JSON.stringify({ id: `synthetic-live-${calls}`, object: 'chat.completion', created: 1, model: grant.modelId,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 37, completion_tokens: 29, completion_tokens_details: { reasoning_tokens: 0 } } }),
  { status: 200, headers: { 'content-type': 'application/json' } })
  } catch (error) { console.error(error); throw error }
}
const host = await createCreativeLiveSdkHost({ grant, readCredential: () => credential, currentGrant: () => current })
const engine = createCreativePilotEngine({ repository, host, liveGrant: grant, identity })
const command = (s: CreativeSnapshot) => ({ campaignId: s.manifest.campaignId, operationId: `run-${s.manifest.language}`,
  expectedRawHead: s.rawHead, expectedCandidateHash: s.candidate.hash })
try {
  const finals: CreativeSnapshot[] = []
  for (const language of ['zh', 'en'] as const) {
    const prepared = await engine.prepare({ campaignId: campaignIds[language], operationId: `prepare-${language}`, brief: briefs[language] })
    const preview = await engine.dryPrepare(campaignIds[language])
    assert.equal(preview.readiness, 'live_provider_ready')
    assert.equal(calls, language === 'zh' ? 0 : 9)
    const final = await engine.start(command(prepared)); finals.push(final)
    assert.equal(final.checkpoint.status, 'completed'); assert.equal(final.checkpoint.budget.attempts, 9)
    assert.equal(final.artifacts.size, 9)
    assert.ok([...final.responses.values()].every(r => r.usage.provenance === 'provider_reported'))
    const body3 = packets.find(p => p.identity.language === language && p.identity.taskId === 'b-3')!
    assert.equal(body3.previousBodies.length, 2)
    assert.deepEqual(body3.previousBodies.map(b => b.text), ['b-1', 'b-2'].map(task => [...final.artifacts.values()].find(a => a.taskId === task)!.text))
    await assert.rejects(engine.start(command(final)))
  }
  assert.equal(calls, 18); assert.equal(memory.observe().accountingMismatches, 0)
  assert.ok(![...memory.rows.values()].some(raw => raw.includes(credential!)))
  engine.dispose(); current = null; credential = null
  const reopened = createCreativePilotEngine({ repository, identity })
  for (const final of finals) {
    const read = await reopened.inspect(final.manifest.campaignId)
    assert.equal(read?.checkpoint.hash, final.checkpoint.hash)
    await assert.rejects(reopened.start(command(final)))
  }
  reopened.dispose(); assert.equal(calls, 18)
  assert.equal(canonicalStringify(grant), canonicalStringify(finals[0]!.manifest.policy.protocol === 'creative-pilot-live-policy-v1' ? finals[0]!.manifest.policy.grant : null))
  console.log(JSON.stringify({ status: 'pass', scope: 'synthetic_live_contract_sdk_engine', languages: 2, tasks: 18, actualProviderCalls: 0, keyPersisted: false }))
} finally { engine.dispose(); globalThis.fetch = originalFetch; Date.now = realNow; storage.dispose() }
