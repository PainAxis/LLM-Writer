import type { CampaignArtifact, CampaignManifest, CampaignRequest, CampaignResponse, CampaignTaskSpec } from '../../types/writerCampaign'
import { CampaignRuntimeError, CAMPAIGN_MAX_INPUT_BYTES, CAMPAIGN_MAX_RESPONSE_BYTES } from './budget'
import { canonicalStringify, hashCampaignValue, hashText } from './protocol'

declare const dispatchPermitBrand: unique symbol
export interface DispatchPermit { readonly [dispatchPermitBrand]: true }
export interface CampaignPreparedInput { text: string; digest: string; bytes: number; utf16: number; responseBytes: number }
export interface CampaignProviderContext {
  manifest: CampaignManifest
  candidateId: string
  task: CampaignTaskSpec
  taskRevision: number
  dependencies: CampaignArtifact[]
}
/** Provider contract is independent of UI, API configuration and manual Writer Agent consent. */
export interface CampaignProvider {
  readonly id: 'offline-fixture-v1'
  readonly capabilities: Readonly<{ network: false; retries: 0; maxResponseBytes: number }>
  prepareRequest(context: CampaignProviderContext): Promise<CampaignPreparedInput>
  dispatch(request: CampaignRequest, permit: DispatchPermit, signal: AbortSignal): Promise<CampaignResponse>
  reconcile(request: CampaignRequest): Promise<CampaignResponse | null>
}
export interface CampaignAuthorizationHost {
  readonly provider: CampaignProvider
  issuePermit(request: CampaignRequest): DispatchPermit
}
export interface FixtureCompletionStore {
  read(requestId: string): Promise<CampaignResponse | null>
  write(response: CampaignResponse): Promise<void>
}
export interface OfflineFixtureOptions {
  /** Controlled test/capacity host only. The application never supplies user text or live adapters. */
  responseFor?: (context: CampaignProviderContext) => string
  responseBytesFor?: (context: CampaignProviderContext) => number
  completionStore?: FixtureCompletionStore
  onDispatch?: (request: CampaignRequest) => void | Promise<void>
}
const hosts = new WeakSet<object>()
const permits = new WeakMap<object, string>()
const binding = (request: CampaignRequest) => canonicalStringify([request.campaignId, request.candidateId, request.taskId, request.taskRevision, request.id, request.inputDigest, request.reservation])
const copyResponse = (response: CampaignResponse): CampaignResponse => ({ ...response, usage: { ...response.usage } })
export function isOfflineCampaignHost(host: CampaignAuthorizationHost): boolean { return hosts.has(host) }

const TEXT = {
  zh: {
    outline: '离线合成大纲：守塔人寻找失落的铜铃，在晨雾散去前修复灯塔。',
    character_bible: '离线合成人设：林岚是谨慎的守塔人；同伴阿澈负责记录潮汐。铜铃属于灯塔。',
    detailed_outline: '离线合成细纲：林岚发现铜铃失踪，阿澈提供潮汐记录，两人在堤岸找回铜铃并修复信号。',
    chapter_outline: '离线合成章纲：晨雾笼罩堤岸。林岚循着阿澈的记录找到铜铃，然后返回灯塔。',
    chapter_body: '晨雾落在堤岸上。林岚翻开阿澈的潮汐记录，在石缝间找到了铜铃。她把铜铃带回灯塔，清亮的声音穿过雾气。',
  },
  en: {
    outline: 'Offline synthetic outline: a lighthouse keeper retrieves a missing brass bell before the morning fog clears.',
    character_bible: 'Offline synthetic characters: Mara is a cautious lighthouse keeper. Eli records the tides. The brass bell belongs to the lighthouse.',
    detailed_outline: 'Offline synthetic detailed outline: Mara discovers the missing bell, follows Eli\'s tide notes to the seawall, and restores the signal.',
    chapter_outline: 'Offline synthetic chapter outline: fog covers the seawall. Mara uses Eli\'s notes to find the bell and returns to the lighthouse.',
    chapter_body: 'Morning fog settled over the seawall. Mara opened Eli\'s tide notes and found the brass bell between two stones. She carried it back to the lighthouse. Its clear note crossed the mist.',
  },
} as const

/** The only registered host has no network capability and never reads credentials. */
export function createOfflineFixtureHost(options: OfflineFixtureOptions = {}): CampaignAuthorizationHost {
  const completions = new Map<string, CampaignResponse>()
  const issued = new Set<string>()
  const contexts = new Map<string, CampaignProviderContext>()
  const evidenceStore = options.completionStore ?? {
    async read(id: string) { const value = completions.get(id); return value ? copyResponse(value) : null },
    async write(response: CampaignResponse) { completions.set(response.requestId, copyResponse(response)) },
  }
  const provider: CampaignProvider = {
    id: 'offline-fixture-v1',
    capabilities: Object.freeze({ network: false, retries: 0, maxResponseBytes: CAMPAIGN_MAX_RESPONSE_BYTES }),
    async prepareRequest(context) {
      if (context.manifest.mode !== 'offline_fixture' || context.manifest.adapterId !== provider.id) throw new CampaignRuntimeError('unsupported_adapter')
      const text = JSON.stringify({ protocol: 'campaign-input-v1', manifestHash: context.manifest.hash, candidateId: context.candidateId,
        language: context.manifest.language, bodyTarget: context.manifest.bodyTarget, task: context.task, taskRevision: context.taskRevision,
        dependencies: context.dependencies.map(artifact => ({ taskId: artifact.taskId, revision: artifact.revision, hash: artifact.hash, text: artifact.text })) })
      const bytes = new TextEncoder().encode(text).length
      if (bytes > CAMPAIGN_MAX_INPUT_BYTES) throw new CampaignRuntimeError('request_too_large')
      const digest = await hashText(text)
      const responseBytes = options.responseBytesFor?.(context) ?? 4096
      if (!Number.isSafeInteger(responseBytes) || responseBytes < 1 || responseBytes > CAMPAIGN_MAX_RESPONSE_BYTES) throw new CampaignRuntimeError('response_too_large')
      contexts.set(digest, context)
      return { text, digest, bytes, utf16: text.length, responseBytes }
    },
    async dispatch(request, permit, _signal) {
      const expected = permits.get(permit)
      permits.delete(permit)
      if (expected !== binding(request) || request.status !== 'dispatch_intent') throw new CampaignRuntimeError('invalid_dispatch_permit')
      await options.onDispatch?.(request)
      const context = contexts.get(request.inputDigest)
      // Restart can rebuild a bound context by prepareRequest, but cannot mint an intent or replay a dispatch.
      if (!context) throw new CampaignRuntimeError('missing_prepared_context')
      const text = options.responseFor?.(context) ?? TEXT[context.manifest.language][context.task.kind]
      if (new TextEncoder().encode(text).length > provider.capabilities.maxResponseBytes) throw new CampaignRuntimeError('response_too_large')
      const response: CampaignResponse = { requestId: request.id, inputDigest: request.inputDigest, text,
        usage: { provenance: 'fixture', inputTokens: null, outputTokens: null, reasoningTokens: null },
        evidenceId: await hashCampaignValue('fixture-completion', { requestId: request.id, inputDigest: request.inputDigest, text }) }
      // Only an actual completed invocation creates evidence. reconcile must never derive it from text/IDs.
      await evidenceStore.write(response)
      contexts.delete(request.inputDigest)
      return copyResponse(response)
    },
    async reconcile(request) {
      const response = await evidenceStore.read(request.id)
      if (!response) return null
      if (response.requestId !== request.id || response.inputDigest !== request.inputDigest) throw new CampaignRuntimeError('completion_identity_mismatch')
      return copyResponse(response)
    },
  }
  const host: CampaignAuthorizationHost = Object.freeze({ provider,
    issuePermit(request: CampaignRequest) {
      if (request.adapterId !== provider.id || request.status !== 'dispatch_intent') throw new CampaignRuntimeError('invalid_dispatch_intent')
      const key = binding(request), requestIdentity = `${request.campaignId}/${request.id}`
      if (issued.has(requestIdentity)) throw new CampaignRuntimeError('dispatch_permit_already_issued')
      issued.add(requestIdentity)
      const permit = Object.freeze({}) as DispatchPermit
      permits.set(permit, key)
      return permit
    },
  })
  hosts.add(host)
  return host
}
