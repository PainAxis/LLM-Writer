/** Actual SDK serializer/parser with an in-process fetch sink; never calls a provider. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { CreativeGoGrantV1, CreativeLiveBinding } from '../src/types/creativePilot'

const originalFetch = globalThis.fetch
const originalNow = Date.now
let now = Date.UTC(2026, 10, 2)
Date.now = () => now
globalThis.fetch = async () => { throw new Error('network_not_installed') }
let http = 0, intents = 0, assertions = 0
let mode = 'success'
try {
  const { sealCreativeGoGrant, CREATIVE_GO_GRANT_DEFAULTS } = await import('../src/services/writerCampaign/creativePilotProtocol')
  const { createCreativeGoSdkHost, getCreativeSdkAdapter, getCreativeOfflineSdkAdapter } = await import('../src/services/writerCampaign/creativePilotTransport')
  const grant = await sealCreativeGoGrant({ ...CREATIVE_GO_GRANT_DEFAULTS, grantId: 'go-transport-control',
    campaignIds: { zh: 'go-control-zh', en: 'go-control-en' },
    briefHashes: { zh: 'a'.repeat(64), en: 'b'.repeat(64) }, maxCostMicroUsd: 3_000_000,
    transmissionConsent: true, extraUsageDisabled: true, expiresAt: 1794182400000 })
  let current: CreativeGoGrantV1 | null = grant, key: string | null = null, reads = 0
  const host = await createCreativeGoSdkHost({ grant, currentGrant: () => current, readCredential: () => { reads++; return key } })
  assert.equal(reads, 0); assertions++
  assert.equal(getCreativeSdkAdapter({} as never), null); assertions++
  assert.equal(getCreativeOfflineSdkAdapter(host as never), null); assertions++
  const adapter = getCreativeSdkAdapter(host)!
  const binding: CreativeLiveBinding = { campaignId: grant.campaignIds.zh, briefHash: grant.briefHashes.zh, language: 'zh',
    policy: { protocol: 'creative-pilot-go-policy-v1', mode: 'sdk_live_pilot', transportPolicy: 'creative-pilot-opencode-go-sdk-v1',
      inputTokenEnforcement: 'worst_case_context_reservation', retention: 'local_campaign_lifetime_no_automatic_deletion', grant } }
  const wire = { system: 'Synthetic transport system', prompt: 'Synthetic transport prompt' }
  let expectedCampaign = grant.campaignIds.zh
  globalThis.fetch = async (url, init) => {
    http++
    assert.equal(String(url), 'https://opencode.ai/inference/go/openai/v1/chat/completions')
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error')
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-not-a-key')
    const value = JSON.parse(String(init?.body))
    assert.deepEqual(Object.keys(value).sort(), ['model', 'temperature', 'messages', 'max_completion_tokens', 'thinking', 'stream'].sort())
    assert.equal(value.model, 'mimo-v2.6-flash'); assert.equal(value.temperature, 0.7); assert.equal(value.max_completion_tokens, 4096)
    assert.deepEqual(value.thinking, { type: 'disabled' }); assert.equal(value.stream, false)
    const headers = new Headers(init?.headers)
    assert.deepEqual([...headers.keys()].sort(), ['authorization', 'content-type', 'user-agent', 'x-opencode-session'])
    assert.equal(headers.get('user-agent'), 'LLM-Writer-Creative-Pilot/1.0')
    assert.equal(headers.get('x-opencode-session'), 'ses_' + expectedCampaign)
    assert.deepEqual(value.messages, [{ role: 'system', content: wire.system }, { role: 'user', content: wire.prompt }])
    assertions += 14
    if (mode === 'redirect') return new Response(null, { status: 307, headers: { location: 'https://invalid.test/' } })
    if (mode === 'http_error') return new Response('{"error":{"message":"synthetic provider error must not escape"}}', { status: 429, headers: { 'content-type': 'application/json' } })
    const responseBody = JSON.stringify({ id: 'synthetic-chat', object: 'chat.completion', created: 1, model: 'mimo-v2.6-flash',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Synthetic output' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 37, completion_tokens: 5, total_tokens: 42,
        ...(mode === 'missing_billing' ? {} : { cost: mode === 'charged' ? 0.0000123 : 0,
          opencode: { billing_source: mode === 'balance' ? 'balance' : mode === 'plus' ? 'go-plus' : 'go',
            allowance: mode === 'negative' ? -0.000001 : mode === 'over_allowance' ? 0.147949 : 0.00000658,
            list_cost: mode === 'over_listcost' ? 0.147949 : 0.00000658,
            tokens: { input: 37, output: 5, ...(mode === 'missing_reasoning' ? {} : { reasoning: mode === 'reasoning' ? 1 : 0 }) } } }),
      },
    })
    const costLexemes: Record<string, string> = { underflow: '1e-400', negative_underflow: '-1e-400', explicit_zero: '0e-400', string_cost: '\"1e-400\"' }
    return new Response(mode in costLexemes ? responseBody.replace('\"cost\":0', '\"cost\":' + costLexemes[mode]) : responseBody, { headers: { 'content-type': 'application/json' } })
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
  for (const invalid of ['missing_billing', 'balance', 'charged', 'negative', 'underflow', 'negative_underflow', 'string_cost', 'over_allowance', 'over_listcost']) {
    mode = invalid
    const rejected = await invoke()
    assert.equal(rejected.textJson, JSON.stringify('Synthetic output')); assert.equal(rejected.usage.status, 'invalid'); assertions += 2
    assert.equal(rejected.usage.go?.status, 'invalid'); assertions++
    if (invalid === 'balance') { assert.equal(rejected.usage.go?.billingSource, 'balance'); assertions++ }
    if (invalid === 'charged') { assert.equal(rejected.usage.go?.costUsd, '0.0000123'); assertions++ }
    if (invalid === 'underflow') { assert.equal(rejected.usage.go?.costUsd, null); assertions++ }
    if (invalid === 'negative') { assert.equal(rejected.usage.go?.allowanceUsd, '-0.000001'); assertions++ }
  }
  mode = 'explicit_zero'
  assert.equal((await invoke()).usage.go?.status, 'valid'); assertions++
  mode = 'missing_reasoning'
  const partial = await invoke()
  assert.equal(partial.usage.reasoningTokens, null); assert.equal(partial.usage.status, 'partial'); assertions += 2
  mode = 'plus'
  assert.equal((await invoke()).usage.go?.billingSource, 'go-plus'); assertions++
  mode = 'success'
  expectedCampaign = grant.campaignIds.en
  await invoke({ ...binding, campaignId: grant.campaignIds.en, language: 'en', briefHash: grant.briefHashes.en })
  expectedCampaign = grant.campaignIds.zh
  mode = 'success'
  const beforeRevocation = http
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  try {
    await assert.rejects(createCreativeGoSdkHost({ grant, currentGrant: () => current, readCredential: () => key })); assertions++
    await assert.rejects(invoke()); assertions++
  } finally { Reflect.deleteProperty(globalThis, 'window') }
  assert.equal(http, beforeRevocation); assertions++
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
  await assert.rejects(createCreativeGoSdkHost({ grant, currentGrant: () => current, readCredential: () => { reads++; return key } }),
    error => (error as { code?: string }).code === 'configuration_changed'); assertions++
  await assert.rejects(invoke(), error => (error as { code?: string }).code === 'configuration_changed'); assertions++
  assert.equal(http, beforeRevocation); assert.equal(intents, beforeExpiryIntents); assert.equal(reads, beforeExpiryReads); assertions += 3
  console.log(JSON.stringify({ status: 'pass', scope: 'actual_sdk_go_contract_in_process_fetch_only', assertions, mockHttpAttempts: http, providerHttpAttempts: 0 }))
} finally { globalThis.fetch = originalFetch; Date.now = originalNow }
