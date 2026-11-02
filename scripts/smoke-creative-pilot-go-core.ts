/** Local-only live policy/storage controls. Zero network, SDK calls or quality claims. */
import assert from 'node:assert/strict'
import { createCreativePilotEngine } from '../src/services/writerCampaign/creativePilotEngine'
import type { CreativeBriefV1, CreativeLiveAdapterIdentity, CreativeResponse } from '../src/types/creativePilot'
import { CREATIVE_LIVE_GRANT_DEFAULTS, sealCreativeLiveGrant, CREATIVE_GO_GRANT_DEFAULTS, CREATIVE_POLICY, createCreativeCandidate, createCreativeManifest, creativeRequestReservation, encodeCreativeResponseText, sealCreativeGoGrant, sealCreativeRequest, sealCreativeResponse, validateCreativeAdapter, validateCreativeBinding, validateCreativeCampaignAuthority, validateCreativeGoGrant, validateCreativeResponseAuthority } from '../src/services/writerCampaign/creativePilotProtocol'
import { createCreativePilotRepository } from '../src/services/writerCampaign/creativePilotStore'
import { compileCreativeInput } from '../src/services/writerCampaign/creativePilotContext'
import { createCreativeMemoryIO } from './lib/creative-pilot-io'
import { encodeStorageBytes } from '../src/services/writerCampaign/protocol'

const guard = { canCommit: () => true, canPublish: () => true }
const identity = { runtimeIdentity: 'core-compatibility', source: { commit: null, tree: null } }
const brief: CreativeBriefV1 = { protocol: 'creative-brief-v1', language: 'zh', premise: 'A locked premise.', constraints: [] }
let checks = 0
const check = (condition: unknown) => { assert.ok(condition); checks++ }
const rejects = async (fn: () => unknown) => { await assert.rejects(async () => fn()); checks++ }
for (const limit of [0, -1, 10, 1.5, NaN, Infinity, null, '1']) { await rejects(() => createCreativePilotEngine({ maxTasksPerRun: limit as number })) }
const legacy = createCreativeMemoryIO()
const old = await createCreativePilotRepository({ io: legacy.io, clock: () => 1000 }).create({ campaignId: 'compatibility-zh', operationId: 'create-compatibility', brief, identity }, guard)
// Frozen hashes computed with the accepted pre-live repository, including accounting and operation digest.
check(old.snapshot.candidate.hash === '77084d753a9b10ad9d012cf093d5d938b86d6cd8623733e82dec660496bdba47')
check(old.snapshot.manifest.hash === '82aca3cb1be2fb961383ae1f9e90aec65da41510c4761fd6871d59fd0261af43')
check(old.snapshot.checkpoint.hash === '34c164b566002c3b15a2e4294740a37cbd1cdee4f9acf389244922108e3de5dc')
check(old.receipt.hash === '150c86326d63fb0fc5373e37a3f2738b8f0dd932730802e26ee48667947a6722')
check(JSON.stringify(old.snapshot.manifest.policy) === JSON.stringify(CREATIVE_POLICY))
const zh = await createCreativeCandidate('live-zh', brief, 1000), enBrief = { ...brief, language: 'en' as const }
const en = await createCreativeCandidate('live-en', enBrief, 1000)
const openaiGrant = await sealCreativeLiveGrant({ ...CREATIVE_LIVE_GRANT_DEFAULTS, grantId: 'grant-core', campaignIds: { zh: 'live-zh', en: 'live-en' }, briefHashes: { zh: zh.briefHash, en: en.briefHash }, maxCostMicroUsd: 5743728, transmissionConsent: true, expiresAt: 86401000 })
const openaiManifest = await createCreativeManifest('live-zh', zh, identity, openaiGrant)
// Exact accepted ccbde956 OpenAI v1 bytes remain independently pinned as well as offline records.
check(openaiGrant.hash === '87a12d40ae7b4b170af8b557a853295783159e1d898240a380495669892690cf')
check(openaiManifest.hash === 'b9a110bd761993d50b7a4c6ac50cad427b9275f8d5d8bf00bddca61aafd20ee3')
const grant = await sealCreativeGoGrant({ ...CREATIVE_GO_GRANT_DEFAULTS, grantId: 'grant-core', campaignIds: { zh: 'live-zh', en: 'live-en' }, briefHashes: { zh: zh.briefHash, en: en.briefHash }, maxCostMicroUsd: 2663064, transmissionConsent: true, expiresAt: 86401000 })
const { hash: _grantHash, ...grantInput } = grant
check(grant.reservedCostMicroUsd === grant.slots * Math.ceil((grant.inputTokensPerSlot * grant.inputMicroUsdPerMillion + grant.outputTokensPerSlot * grant.outputMicroUsdPerMillion) / 1e6))
check(CREATIVE_GO_GRANT_DEFAULTS.pricingValidUntil === Date.UTC(2026, 10, 9))
await rejects(() => sealCreativeGoGrant({ ...grantInput, expiresAt: CREATIVE_GO_GRANT_DEFAULTS.pricingValidUntil + 1 }))
await rejects(() => sealCreativeGoGrant({ ...grantInput, pricingValidUntil: CREATIVE_GO_GRANT_DEFAULTS.pricingValidUntil + 1 } as never))
const deadlineGrant = await sealCreativeGoGrant({ ...grantInput, expiresAt: CREATIVE_GO_GRANT_DEFAULTS.pricingValidUntil })
check((await validateCreativeGoGrant(deadlineGrant)).expiresAt === CREATIVE_GO_GRANT_DEFAULTS.pricingValidUntil)
await rejects(() => validateCreativeGoGrant({ ...grant, hash: 'a'.repeat(64) }))
await rejects(() => sealCreativeGoGrant({ ...grantInput, maxCostMicroUsd: 2663063 }))
await rejects(() => sealCreativeGoGrant({ ...grantInput, campaignIds: { zh: 'live-zh', en: 'live-zh' } }))
await rejects(() => sealCreativeGoGrant({ ...grantInput, transmissionConsent: false } as never))
await rejects(() => validateCreativeGoGrant({ ...grant, extra: true } as never))
await rejects(() => sealCreativeGoGrant({ ...grantInput, inputMicroUsdPerMillion: 299999 } as never))
await rejects(() => sealCreativeGoGrant({ ...grantInput, slots: 19 } as never))
await rejects(() => sealCreativeGoGrant({ ...grantInput, modelId: 'wrong-model' } as never))
const adapter: CreativeLiveAdapterIdentity = { mode: 'live_provider', adapterId: 'creative-pilot-opencode-go-sdk-v1', adapterVersion: 'creative-pilot-opencode-go-sdk-v1', requestedModelId: 'mimo-v2.6-flash', effectiveModelId: 'mimo-v2.6-flash', configurationRevision: grant.grantId, endpointIdentity: grant.endpoint, grantHash: grant.hash }
validateCreativeAdapter(adapter); checks++
await rejects(() => validateCreativeCampaignAuthority(openaiManifest, zh, { ...adapter, grantHash: openaiGrant.hash }))
await rejects(() => validateCreativeAdapter({ ...adapter, endpointIdentity: 'http://127.0.0.1:1/v1' }))
await rejects(() => createCreativeManifest('live-zh', zh, identity, null as never))
await rejects(() => createCreativeManifest('live-other', zh, identity, grant))
await rejects(async () => createCreativeManifest('live-zh', await createCreativeCandidate('live-zh', { ...brief, premise: 'Changed' }, 1000), identity, grant))
const expired = await sealCreativeGoGrant({ ...grantInput, expiresAt: 1001 })
await rejects(() => createCreativeManifest('live-zh', zh, identity, expired))
const memory = createCreativeMemoryIO(), repo = createCreativePilotRepository({ io: memory.io, clock: () => 1000 })
const created = await repo.create({ campaignId: 'live-zh', operationId: 'create-live-zh', brief, identity, liveGrant: grant }, guard)
const english = await repo.create({ campaignId: 'live-en', operationId: 'create-live-en', brief: enBrief, identity, liveGrant: grant }, guard)
const snapshot = created.snapshot
check(snapshot.manifest.policy.protocol === 'creative-pilot-go-policy-v1' && english.snapshot.manifest.policy.protocol === 'creative-pilot-go-policy-v1')
check(snapshot.manifest.budget.attempts === 9 && english.snapshot.manifest.budget.attempts === 9)
check((await repo.read('live-zh'))?.manifest.hash === snapshot.manifest.hash)
validateCreativeCampaignAuthority(snapshot.manifest, snapshot.candidate, adapter); checks++
await rejects(() => validateCreativeCampaignAuthority(old.snapshot.manifest, old.snapshot.candidate, adapter))
await rejects(() => validateCreativeCampaignAuthority(snapshot.manifest, snapshot.candidate, { mode: 'offline_control', adapterId: 'control', adapterVersion: 'v1', requestedModelId: 'synthetic', effectiveModelId: 'synthetic', configurationRevision: 'v1', endpointIdentity: 'http://127.0.0.1:1/v1' }))
await rejects(() => validateCreativeCampaignAuthority(snapshot.manifest, snapshot.candidate, { ...adapter, grantHash: 'b'.repeat(64) }))
await rejects(() => validateCreativeBinding({ campaignId: 'live-en', language: 'en', briefHash: zh.briefHash, policy: snapshot.manifest.policy }, adapter))
await rejects(() => repo.replaceBrief(snapshot, { operationId: 'replace-live', brief: { ...brief, premise: 'Changed' } }, guard))
const prepared = await compileCreativeInput(snapshot, 'outline')
check(prepared.scope.exposure === 'author_and_opencode_go_writer')
check((await compileCreativeInput(old.snapshot, 'outline')).scope.exposure === 'author_and_offline_control_writer_only')
const request = await sealCreativeRequest({ schemaVersion: 1, protocol: 'creative-pilot-request-v1', campaignId: 'live-zh', id: 'request-1', operationId: 'operation-1', manifestHash: snapshot.manifest.hash, candidateHash: snapshot.candidate.hash, taskId: 'outline', taskRevision: 0, dependencies: [], prepared, adapter, invocationId: 'local-only-not-dispatched', reservation: creativeRequestReservation(), createdAt: 1000, expiresAt: 61000, storageAllocationBytes: encodeStorageBytes(1900544) })
const mutation = { kind: 'reserve' as const, operationId: 'operation-1:reserve', recovery: false, request }
const reserved = await repo.commit(snapshot, mutation, guard)
check(reserved.snapshot.checkpoint.budget.attempts === 1 && reserved.snapshot.requests.size === 1)
const duplicate = await repo.commit(snapshot, mutation, guard)
check(duplicate.replayed && duplicate.snapshot.checkpoint.budget.attempts === 1)
const wire = { wireProtocol: 'creative-pilot-http-wire-v1' as const, bodyDigest: 'a'.repeat(64), bodyBytes: 1, bodyUtf16: 1 }
const intent = await repo.commit(reserved.snapshot, { kind: 'dispatch_intent', operationId: 'operation-1:intent', recovery: false, requestHash: request.hash, dispatchWire: wire }, guard)
const response = await sealCreativeResponse({ schemaVersion: 1, protocol: 'creative-pilot-response-v1', campaignId: 'live-zh', requestHash: request.hash, intentHash: intent.snapshot.phases.get(intent.snapshot.checkpoint.requests[0]!.phaseHash)!.hash, evidenceId: 'local-fake-response', ...await encodeCreativeResponseText('{}'), finishReason: 'stop', contentEvidence: { stepCount: 1, anomalies: [] }, usage: { status: 'unavailable', provenance: 'synthetic_control', inputTokens: null, outputTokens: null, reasoningTokens: null }, reportedModel: { status: 'matched', value: 'mimo-v2.6-flash' } })
await rejects(() => validateCreativeResponseAuthority(adapter, response))
await rejects(() => repo.commit(intent.snapshot, { kind: 'retain_response', operationId: 'operation-1:retain', recovery: false, requestHash: request.hash, response }, guard))
const { hash: _responseHash, ...responseInput } = response
const liveResponse = await sealCreativeResponse({ ...responseInput, usage: { ...response.usage, provenance: 'provider_reported', go: { status: 'valid', billingSource: 'go', costUsd: '0', allowanceUsd: '0.00125', listCostUsd: '0.00125' } } } as CreativeResponse)
validateCreativeResponseAuthority(adapter, liveResponse); checks++
await rejects(() => validateCreativeResponseAuthority({ mode: 'offline_control', adapterId: 'control', adapterVersion: 'v1', requestedModelId: 'synthetic', effectiveModelId: 'synthetic', configurationRevision: 'v1', endpointIdentity: 'http://127.0.0.1:1/v1' }, liveResponse))
const invalidBilling = await sealCreativeResponse({ ...responseInput, usage: { ...liveResponse.usage, status: 'invalid', go: { ...liveResponse.usage.go!, status: 'invalid', billingSource: 'balance', costUsd: '0.125' } } })
const retained = await repo.commit(intent.snapshot, { kind: 'retain_response', operationId: 'operation-1:retain', recovery: false, requestHash: request.hash, response: invalidBilling }, guard)
check(retained.snapshot.responses.get(invalidBilling.hash)?.usage.go?.costUsd === '0.125')
const resolved = await repo.commit(retained.snapshot, { kind: 'resolve', operationId: 'operation-1:resolve', recovery: false, requestHash: request.hash, disposition: 'publish_if_valid' }, guard)
check(resolved.snapshot.checkpoint.status === 'blocked' && resolved.snapshot.checkpoint.reason === 'usage_invalid' && resolved.snapshot.artifacts.size === 0)
check((await repo.read('live-zh'))?.responses.get(invalidBilling.hash)?.usage.go?.billingSource === 'balance')
for (const go of [
  { status: 'invalid' as const, billingSource: 'go' as const, costUsd: '0', allowanceUsd: '0.147949', listCostUsd: '0.1' },
  { status: 'invalid' as const, billingSource: 'go-plus' as const, costUsd: '0', allowanceUsd: '0.1', listCostUsd: '0.147949' },
  { status: 'invalid' as const, billingSource: null, costUsd: null, allowanceUsd: null, listCostUsd: null },
  { status: 'invalid' as const, billingSource: 'go' as const, costUsd: '0.1', allowanceUsd: '0', listCostUsd: '0.1' },
  { status: 'invalid' as const, billingSource: 'byok' as const, costUsd: '0', allowanceUsd: '-1', listCostUsd: '0' },
]) {
  const evidence = await sealCreativeResponse({ ...responseInput, usage: { ...liveResponse.usage, status: 'invalid', go } })
  validateCreativeResponseAuthority(adapter, evidence); checks++
}
await rejects(() => sealCreativeResponse({ ...responseInput, usage: { ...liveResponse.usage, go: { ...liveResponse.usage.go!, status: 'valid', costUsd: '0.01' } } }))
await rejects(() => sealCreativeResponse({ ...responseInput, usage: { ...liveResponse.usage, go: { ...liveResponse.usage.go!, costUsd: '0.00' } } }))
const ceilingResponse = await sealCreativeResponse({ ...responseInput, usage: { ...liveResponse.usage, go: { ...liveResponse.usage.go!, allowanceUsd: '0.147948', listCostUsd: '0.147948' } } })
validateCreativeResponseAuthority(adapter, ceilingResponse); checks++
await rejects(() => sealCreativeResponse({ ...responseInput, usage: { ...liveResponse.usage, go: { ...liveResponse.usage.go!, allowanceUsd: '0.147949' } } }))
await rejects(() => sealCreativeGoGrant({ ...grantInput, extraUsageDisabled: false } as never))
const cancelled = await repo.commit(resolved.snapshot, { kind: 'cancel', operationId: 'cancel-live', recovery: false }, guard)
check(cancelled.snapshot.checkpoint.budget.attempts === 1 && cancelled.snapshot.manifest.policy.protocol === 'creative-pilot-go-policy-v1' && cancelled.snapshot.manifest.policy.grant.reservedCostMicroUsd === 2663064)
check((await repo.read('live-zh'))?.checkpoint.budget.attempts === 1)
check(memory.observe().accountingMismatches === 0)
console.log(JSON.stringify({ status: 'pass', scope: 'local_go_policy_storage_controls', checks, networkRequests: 0, liveProviderCalls: 0, literaryAcceptance: 'NOT_RUN' }))
