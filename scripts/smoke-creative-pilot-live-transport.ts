/** Actual SDK serializer/parser with an in-process fetch sink; never calls a provider. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { installCreativeNodeStorage } from './lib/creative-pilot-node-server'
import type { CreativeLiveGrantV1, CreativeLiveBinding } from '../src/types/creativePilot'

const storage = installCreativeNodeStorage()
const originalFetch = globalThis.fetch
const originalNow = Date.now
let now = Date.UTC(2026, 10, 2)
Date.now = () => now
let http = 0, intents = 0, assertions = 0
let mode: 'success' | 'redirect' | 'http_error' | 'reasoning' | 'tier' = 'success'
try {
  const { sealCreativeLiveGrant } = await import('../src/services/writerCampaign/creativePilotProtocol')
  const { createCreativeLiveSdkHost, getCreativeSdkAdapter, getCreativeOfflineSdkAdapter } = await import('../src/services/writerCampaign/creativePilotTransport')
  const grant = await sealCreativeLiveGrant({ protocol: 'creative-pilot-live-grant-v1', grantId: 'live-transport-control',
    provider: 'openai', modelId: 'gpt-6-luna', endpoint: 'https://api.openai.com/v1', reasoningEffort: 'none',
    serviceTier: 'default', store: false, pricingDate: '2026-11-02', pricingValidUntil: 1794182400000, campaignIds: { zh: 'live-control-zh', en: 'live-control-en' },
    briefHashes: { zh: 'a'.repeat(64), en: 'b'.repeat(64) }, maxCostMicroUsd: 6_000_000,
    reservedCostMicroUsd: 5_743_728, slots: 18, inputTokensPerSlot: 1_050_000, outputTokensPerSlot: 4096,
    inputMicroUsdPerMillion: 300_000, outputMicroUsdPerMillion: 1_000_000, transmissionConsent: true,
    expiresAt: 1794182400000 })
  let current: CreativeLiveGrantV1 | null = grant, key: string | null = null, reads = 0
  const host = await createCreativeLiveSdkHost({ grant, currentGrant: () => current, readCredential: () => { reads++; return key } })
  assert.equal(reads, 0); assertions++
  assert.equal(getCreativeSdkAdapter({} as never), null); assertions++
  assert.equal(getCreativeOfflineSdkAdapter(host as never), null); assertions++
  const adapter = getCreativeSdkAdapter(host)!
  const binding: CreativeLiveBinding = { campaignId: grant.campaignIds.zh, briefHash: grant.briefHashes.zh, language: 'zh',
    policy: { protocol: 'creative-pilot-live-policy-v1', mode: 'sdk_live_pilot', transportPolicy: 'creative-pilot-live-sdk-v1',
      inputTokenEnforcement: 'worst_case_context_reservation', retention: 'local_campaign_lifetime_no_automatic_deletion', grant } }
  const wire = { system: 'Synthetic transport system', prompt: 'Synthetic transport prompt' }
  globalThis.fetch = async (url, init) => {
    http++
    assert.equal(String(url), 'https://api.openai.com/v1/chat/completions')
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error')
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-not-a-key')
    const value = JSON.parse(String(init?.body))
    assert.deepEqual(Object.keys(value).sort(), ['model', 'temperature', 'messages', 'max_completion_tokens', 'reasoning_effort', 'service_tier', 'stream', 'store'].sort())
    assert.equal(value.model, 'gpt-6-luna'); assert.equal(value.temperature, 0.7); assert.equal(value.max_completion_tokens, 4096)
    assert.equal(value.reasoning_effort, 'none'); assert.equal(value.service_tier, 'default'); assert.equal(value.stream, false); assert.equal(value.store, false)
    assert.deepEqual(value.messages, [{ role: 'system', content: wire.system }, { role: 'user', content: wire.prompt }])
    assertions += 13
    if (mode === 'redirect') return new Response(null, { status: 307, headers: { location: 'https://invalid.test/' } })
    if (mode === 'http_error') return new Response('{"error":{"message":"synthetic provider error must not escape"}}', { status: 429, headers: { 'content-type': 'application/json' } })
    return new Response(JSON.stringify({ id: 'synthetic-chat', object: 'chat.completion', created: 1, model: 'gpt-6-luna',
      service_tier: mode === 'tier' ? 'priority' : 'default',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Synthetic output' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 37, completion_tokens: 5, total_tokens: 42, completion_tokens_details: { reasoning_tokens: mode === 'reasoning' ? 1 : 0 } },
    }), { headers: { 'content-type': 'application/json' } })
  }
  const invoke = (supplied: CreativeLiveBinding | undefined = binding, before?: () => void) => adapter.invoke({ requestHash: 'c'.repeat(64), wire,
    binding: supplied, signal: new AbortController().signal, beforeRequest: async dispatch => {
      intents++; assert.equal(dispatch.wireProtocol, 'creative-pilot-http-wire-v1'); assert.match(dispatch.bodyDigest, /^[a-f0-9]{64}$/)
      assert.ok(dispatch.bodyBytes > 0); before?.()
    } })
  await assert.rejects(invoke(), error => (error as { code?: string }).code === 'configuration_changed'); assertions++
  assert.equal(http, 0); assert.equal(intents, 0); assertions += 2
  key = 'synthetic-not-a-key'
  const result = await invoke()
  assert.equal(http, 1); assert.equal(intents, 1); assertions += 2
  assert.equal(result.textJson, JSON.stringify('Synthetic output')); assert.equal(result.usage.provenance, 'provider_reported')
  assert.equal(result.usage.status, 'complete'); assert.equal(result.usage.inputTokens, 37); assert.equal(result.usage.reasoningTokens, 0)
  assert.equal(result.reportedModel.status, 'matched'); assert.equal(result.finishReason, 'stop')
  assert.equal(result.textJsonHash, createHash('sha256').update(JSON.stringify({ domain: 'creative-visible-text-json-v1', value: result.textJson })).digest('hex')); assertions += 8
  assert.ok(!JSON.stringify(result).includes('synthetic-not-a-key')); assertions++
  assert.ok([...storage.rows.values()].every(value => !value.includes('synthetic-not-a-key'))); assertions++
  for (const changed of [{ ...binding, campaignId: 'other' }, { ...binding, briefHash: 'd'.repeat(64) }, { ...binding, language: 'en' as const }]) {
    await assert.rejects(invoke(changed)); assertions++
    assert.equal(http, 1); assertions++
  }
  await assert.rejects(adapter.invoke({ requestHash: 'c'.repeat(64), wire, signal: new AbortController().signal, beforeRequest: async () => {} })); assertions++
  assert.equal(http, 1); assertions++
  for (const next of ['redirect', 'http_error'] as const) {
    mode = next
    const before = http
    await assert.rejects(invoke(), error => !String(error).includes('synthetic provider error')); assertions++
    assert.equal(http, before + 1); assertions++
  }
  mode = 'reasoning'
  assert.equal((await invoke()).usage.reasoningTokens, 1); assertions++
  mode = 'tier'
  assert.equal((await invoke()).usage.status, 'invalid'); assertions++
  mode = 'success'
  const beforeRevocation = http
  const aborted = new AbortController(); aborted.abort()
  await assert.rejects(adapter.invoke({ requestHash: 'c'.repeat(64), wire, binding, signal: aborted.signal,
    beforeRequest: async () => { throw new Error('cancelled_call_reached_intent') } })); assertions++
  assert.equal(http, beforeRevocation); assertions++
  await assert.rejects(invoke(binding, () => { key = 'synthetic-changed-key' })); assertions++
  assert.equal(http, beforeRevocation); assertions++
  key = null
  await assert.rejects(invoke()); assertions++
  assert.equal(http, beforeRevocation); assertions++
  key = 'synthetic-not-a-key'
  await assert.rejects(invoke(binding, () => { current = null })); assertions++
  assert.equal(http, beforeRevocation); assertions++
  current = structuredClone(grant); current.maxCostMicroUsd++
  await assert.rejects(invoke()); assertions++
  assert.equal(http, beforeRevocation); assertions++
  current = grant
  now = grant.pricingValidUntil
  const beforeExpiryIntents = intents, beforeExpiryReads = reads
  await assert.rejects(createCreativeLiveSdkHost({ grant, currentGrant: () => current, readCredential: () => { reads++; return key } }),
    error => (error as { code?: string }).code === 'configuration_changed'); assertions++
  await assert.rejects(invoke(), error => (error as { code?: string }).code === 'configuration_changed'); assertions++
  assert.equal(http, beforeRevocation); assert.equal(intents, beforeExpiryIntents); assert.equal(reads, beforeExpiryReads); assertions += 3
  console.log(JSON.stringify({ status: 'pass', scope: 'actual_sdk_live_contract_in_process_fetch_only', assertions, mockHttpAttempts: http, providerHttpAttempts: 0 }))
} finally { globalThis.fetch = originalFetch; Date.now = originalNow; storage.dispose() }
