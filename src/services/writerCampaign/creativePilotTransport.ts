/** Real bounded SDK transport for the explicitly installed loopback control host.
 * There is no live branch, saved grant, ordinary billing hook or fixture adapter. */
import type { ApiConfig } from '../../types/api'
import type {
  CreativeAdapterIdentity, CreativeAdapterResult, CreativeContentAnomaly, CreativeContentEvidence,
  CreativeDispatchWire, CreativeFinishReason, CreativeGenerationAdapter, CreativeReportedModel, CreativeUsageEvidence, CreativeOfflineHost,
} from '../../types/creativePilot'
import { loadAISDK, resolveLanguageModel } from '../aiProviders'
import { BoundedGenerationError, createBoundedRequestScope, type BoundedRequestScope } from '../aiRequestLimits'
import { usesCompletionTokenLimit } from '../../utils/generationBudget'
import { assertScalarText, canonicalStringify, hashText, utf8Bytes } from './protocol'
import { CREATIVE_ANOMALIES, CREATIVE_LIMITS, CreativePilotError, encodeCreativeResponseText, validateCreativeAdapter } from './creativePilotProtocol'
import { parseCreativeJson } from './creativePilotJson'

export type { CreativeOfflineHost } from '../../types/creativePilot'
export interface CreativeOfflineSdkHostOptions {
  identity: CreativeAdapterIdentity
  currentConfigurationRevision: () => string
  readConfiguration: () => ApiConfig
}
const hosts = new WeakMap<object, CreativeGenerationAdapter>()
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(value)
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const own = (value: Record<string, unknown>, key: string) => Object.hasOwn(value, key)
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => own(value, key))
function wireFailure(): never { throw new CreativePilotError('transport_wire_invalid') }
function configurationFailure(): never { throw new CreativePilotError('configuration_changed') }
const jsonLimits = Object.freeze({ maxUtf16: 65_536, maxDepth: 32, maxNodes: 16_384 })

/** Internal engine seam. Only opaque factory products resolve; serialized or
 * structurally matching values never disclose an adapter or confer authority. */
export function getCreativeOfflineSdkAdapter(host: CreativeOfflineHost | undefined): CreativeGenerationAdapter | null {
  return host && typeof host === 'object' ? hosts.get(host) ?? null : null
}

function validateConfiguration(config: ApiConfig, identity: Readonly<CreativeAdapterIdentity>): void {
  // Never inspect/copy the credential until these non-secret destination checks pass.
  if (!config || config.provider !== 'custom' || config.baseURL !== identity.endpointIdentity
    || config.selectedModel !== identity.effectiveModelId || config.proxyUrl
    || !record(config.customHeaders ?? {}) || Object.keys(config.customHeaders ?? {}).length
    || config.thinkingMode !== 'disabled') configurationFailure()
}

function frozenWire(input: Readonly<{ system: string; prompt: string }>): Readonly<{ system: string; prompt: string }> {
  const value = record(input)
  if (!value || !exactKeys(value, ['system', 'prompt']) || typeof value.system !== 'string' || !value.system.length
    || typeof value.prompt !== 'string' || !value.prompt.length) throw new CreativePilotError('input_invalid')
  const output = { system: value.system, prompt: value.prompt }
  try {
    const encoded = canonicalStringify(output)
    if (encoded.length > CREATIVE_LIMITS.inputUtf16 || utf8Bytes(encoded) > CREATIVE_LIMITS.inputBytes) throw new Error()
  } catch { throw new CreativePilotError('input_invalid') }
  return Object.freeze(output)
}

async function observeDispatchBody(body: unknown, wire: Readonly<{ system: string; prompt: string }>, config: ApiConfig,
  check: () => void): Promise<CreativeDispatchWire> {
  check()
  if (typeof body !== 'string' || !body.length || body.length > CREATIVE_LIMITS.inputUtf16) wireFailure()
  let bytes: number, value: Record<string, unknown> | null
  try {
    assertScalarText(body)
    bytes = utf8Bytes(body)
    if (bytes > CREATIVE_LIMITS.inputBytes) wireFailure()
    value = record(parseCreativeJson(body, jsonLimits, check))
  } catch (error) {
    check()
    if (error instanceof CreativePilotError) throw error
    return wireFailure()
  }
  const limitKey = usesCompletionTokenLimit(config) ? 'max_completion_tokens' : 'max_tokens'
  if (!value || !exactKeys(value, ['model', 'temperature', 'messages', limitKey])
    || value.model !== config.selectedModel || value.temperature !== 0.7 || value[limitKey] !== CREATIVE_LIMITS.outputTokens
    || !Array.isArray(value.messages) || value.messages.length !== 2) wireFailure()
  const system = record(value.messages[0]), prompt = record(value.messages[1])
  if (!system || !prompt || !exactKeys(system, ['role', 'content']) || !exactKeys(prompt, ['role', 'content'])
    || system.role !== 'system' || system.content !== wire.system || prompt.role !== 'user' || prompt.content !== wire.prompt) wireFailure()
  const bodyDigest = await hashText(body)
  check()
  return Object.freeze({ wireProtocol: 'creative-pilot-http-wire-v1', bodyDigest, bodyBytes: bytes, bodyUtf16: body.length })
}

/** Pure admission evidence only. This never grants a host, intent or dispatch. */
export async function inspectCreativeDispatchRequest(url: unknown, init: Readonly<{ method?: string; body?: unknown }> | undefined,
  endpoint: string, wire: Readonly<{ system: string; prompt: string }>, config: ApiConfig, check: () => void): Promise<CreativeDispatchWire> {
  check()
  if (url instanceof Request || (typeof url !== 'string' && !(url instanceof URL))
    || String(url) !== endpoint || !init || init.method !== 'POST') wireFailure()
  return observeDispatchBody(init.body, wire, config, check)
}

function projectRawMetadata(value: unknown, effectiveModelId: string): { usage: CreativeUsageEvidence; reportedModel: CreativeReportedModel } {
  const root = record(value)
  if (!root) throw new BoundedGenerationError('transport')
  let reportedModel: CreativeReportedModel = { status: 'absent', value: null }
  if (own(root, 'model')) reportedModel = identifier(root.model)
    ? { status: root.model === effectiveModelId ? 'matched' : 'mismatch', value: root.model }
    : { status: 'invalid', value: null }
  let invalid = false
  const usage = own(root, 'usage') ? record(root.usage) : null
  if (own(root, 'usage') && !usage) invalid = true
  const counter = (object: Record<string, unknown> | null, key: string): number | null => {
    if (!object || !own(object, key)) return null
    const value = object[key]
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
    invalid = true
    return null
  }
  const inputTokens = counter(usage, 'prompt_tokens'), outputTokens = counter(usage, 'completion_tokens')
  const details = usage && own(usage, 'completion_tokens_details') ? record(usage.completion_tokens_details) : null
  if (usage && own(usage, 'completion_tokens_details') && !details) invalid = true
  const reasoningTokens = counter(details, 'reasoning_tokens')
  if ((outputTokens !== null && outputTokens > CREATIVE_LIMITS.outputTokens)
    || (reasoningTokens !== null && outputTokens !== null && reasoningTokens > outputTokens)) invalid = true
  const known = [inputTokens, outputTokens, reasoningTokens].filter(value => value !== null).length
  return { reportedModel, usage: { status: invalid ? 'invalid' : known === 3 ? 'complete' : known ? 'partial' : 'unavailable',
    provenance: 'synthetic_control', inputTokens, outputTokens, reasoningTokens } }
}

/** Pure closed anomaly projection. This conveys no host or invocation authority. */
export function projectCreativeContentEvidence(result: Record<string, unknown>, text: string): CreativeContentEvidence {
  const flags = new Set<CreativeContentAnomaly>()
  const steps = result.steps
  const stepCount = Array.isArray(steps) && Number.isSafeInteger(steps.length) ? steps.length : null
  if (stepCount !== 1) flags.add('invalid_step_count')
  const inspect = (value: Record<string, unknown> | null): string | null => {
    if (!value) { flags.add('invalid_content_metadata'); return null }
    if (value.toolCalls !== undefined) {
      if (!Array.isArray(value.toolCalls)) flags.add('invalid_content_metadata')
      else if (value.toolCalls.length) flags.add('tool_calls_present')
    }
    const parts = value.content
    if (!Array.isArray(parts) || parts.length > 16_384) { flags.add('invalid_content_metadata'); return null }
    const textParts: string[] = []
    let size = 0, completeText = true
    for (const partValue of parts) {
      const part = record(partValue)
      if (!part || typeof part.type !== 'string') { flags.add('invalid_content_metadata'); continue }
      if (part.type === 'text') {
        if (typeof part.text !== 'string') { flags.add('invalid_content_metadata'); completeText = false; continue }
        size += part.text.length
        if (size > CREATIVE_LIMITS.textUtf16) { flags.add('invalid_content_metadata'); completeText = false; continue }
        textParts.push(part.text)
      } else if (part.type === 'reasoning') flags.add('reasoning_present')
      else if (part.type.startsWith('tool-')) flags.add('tool_calls_present')
      else flags.add('unexpected_content')
    }
    return completeText ? textParts.join('') : null
  }
  const resultText = inspect(result)
  const stepText = stepCount === 1 ? inspect(record((steps as unknown[])[0])) : null
  if (resultText !== text || (stepCount === 1 && stepText !== text)) flags.add('invalid_content_metadata')
  return { stepCount, anomalies: CREATIVE_ANOMALIES.filter(flag => flags.has(flag)) }
}

/** Creates only a real SDK adapter, with no endpoint discovery or credential
 * access at construction. The ordinary App never installs this optional host. */
export function createCreativeOfflineSdkHost(options: CreativeOfflineSdkHostOptions): CreativeOfflineHost {
  try { validateCreativeAdapter(options.identity) } catch { throw new CreativePilotError('unconfigured') }
  if (options.identity.adapterId !== 'creative-pilot-sdk-v1' || options.identity.adapterVersion !== 'creative-pilot-sdk-v1'
    || typeof options.currentConfigurationRevision !== 'function' || typeof options.readConfiguration !== 'function') throw new CreativePilotError('unconfigured')
  const identity = Object.freeze({ ...options.identity })
  const revision = options.currentConfigurationRevision, readConfiguration = options.readConfiguration
  let configurationWasRead = false
  const assertCurrent = () => {
    try {
      if (revision() !== identity.configurationRevision) configurationFailure()
      if (configurationWasRead) validateConfiguration(readConfiguration(), identity)
    } catch { configurationFailure() }
  }
  const adapter: CreativeGenerationAdapter = Object.freeze({
    identity,
    assertCurrent,
    async invoke(input: Parameters<CreativeGenerationAdapter['invoke']>[0]): Promise<CreativeAdapterResult> {
      const completionDeadline = performance.now() + CREATIVE_LIMITS.sdkMs
      const scope = createBoundedRequestScope({ maxAttempts: 1, maxResponseBytes: CREATIVE_LIMITS.httpBytes,
        timeoutMs: CREATIVE_LIMITS.sdkMs, omitUsageContent: true }, input.signal)
      let rawMetadata: ReturnType<typeof projectRawMetadata> | null = null
      let completeResultObserved = false
      try {
        scope.assertActive()
        const wire = frozenWire(input.wire)
        if (!/^[a-f0-9]{64}$/.test(input.requestHash) || typeof input.beforeRequest !== 'function') throw new CreativePilotError('input_invalid')
        assertCurrent()
        let config: ApiConfig
        try {
          const current = readConfiguration()
          validateConfiguration(current, identity)
          configurationWasRead = true
          // Snapshot only after destination/config validation; the credential is
          // confined to the SDK config and is never hashed, reported or persisted.
          config = { ...current, customHeaders: {} }
          if (typeof config.apiKey !== 'string' || !config.apiKey.length) configurationFailure()
        } catch { configurationFailure() }
        assertCurrent()
        scope.assertActive()
        const endpoint = `${identity.endpointIdentity.replace(/\/+$/, '')}/chat/completions`
        const guardedScope: BoundedRequestScope = { ...scope, createFetch: beforeRequest => {
          let binding: CreativeDispatchWire | null = null
          const boundedFetch = scope.createFetch(async () => {
            scope.assertActive(); assertCurrent()
            if (!binding) wireFailure()
            await input.beforeRequest(binding)
            scope.assertActive(); assertCurrent()
            if (beforeRequest) await beforeRequest()
            scope.assertActive(); assertCurrent()
          })
          return async (url, init) => {
            scope.assertActive(); assertCurrent()
            const body = init?.body
            binding = await inspectCreativeDispatchRequest(url, init && { method: init.method, body }, endpoint, wire, config, scope.assertActive)
            // Preserve the exact checked string across the asynchronous durable
            // guard. Copy header ownership without logging or hashing secrets.
            const ownedInit: RequestInit = { ...init, method: 'POST', body: body as string, headers: new Headers(init?.headers) }
            // Do not re-read an admitted mutable URL or method after hashing.
            const response = await boundedFetch(endpoint, ownedInit)
            scope.assertActive()
            const bytes = await scope.run(() => response.clone().arrayBuffer())
            if (bytes.byteLength > CREATIVE_LIMITS.httpBytes) throw new BoundedGenerationError('response_too_large')
            let parsed: unknown
            try {
              const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
              parsed = parseCreativeJson(decoded, jsonLimits, scope.assertActive)
            } catch { scope.assertActive(); throw new BoundedGenerationError('transport') }
            rawMetadata = projectRawMetadata(parsed, identity.effectiveModelId)
            scope.assertActive()
            return response
          }
        } }
        const { generateText } = await scope.run(loadAISDK)
        const model = await scope.run(() => resolveLanguageModel(config, undefined, guardedScope))
        const result = await scope.run(() => generateText({ model, prompt: wire.prompt, system: wire.system,
          maxOutputTokens: CREATIVE_LIMITS.outputTokens, temperature: 0.7, maxRetries: 0,
          abortSignal: scope.signal, telemetry: { isEnabled: false } }))
        scope.assertActive()
        const observed = record(result)
        if (!observed || typeof observed.text !== 'string' || !rawMetadata) throw new BoundedGenerationError('transport')
        // The bounded SDK has now yielded a trusted complete reply. Revoking
        // creative authority must not erase this evidence during its hashes.
        // This handoff retains the original SDK deadline; it grants no publish
        // or next-call authority, and the engine applies its settlement guard.
        completeResultObserved = true
        const text = observed.text
        const finishValues: readonly string[] = ['stop', 'length', 'content_filter', 'tool_calls', 'error', 'other', 'unknown']
        const sdkFinish = typeof observed.finishReason === 'string' ? observed.finishReason.replaceAll('-', '_') : 'unknown'
        const finishReason: CreativeFinishReason = finishValues.includes(sdkFinish) ? sdkFinish as CreativeFinishReason : 'unknown'
        const contentEvidence = projectCreativeContentEvidence(observed, text)
        const remaining = completionDeadline - performance.now()
        if (remaining <= 0) throw new BoundedGenerationError('timeout')
        let completionTimer: ReturnType<typeof setTimeout> | undefined
        const encoded = await Promise.race([encodeCreativeResponseText(text), new Promise<never>((_resolve, reject) => {
          completionTimer = setTimeout(() => reject(new BoundedGenerationError('timeout')), remaining)
        })]).finally(() => { if (completionTimer) clearTimeout(completionTimer) })
        if (performance.now() >= completionDeadline) throw new BoundedGenerationError('timeout')
        const metadata = rawMetadata as ReturnType<typeof projectRawMetadata>
        return { evidenceId: `creative-invocation-${crypto.randomUUID()}`, ...encoded, finishReason,
          contentEvidence, usage: metadata.usage, reportedModel: metadata.reportedModel }
      } catch (error) {
        if (!completeResultObserved) scope.assertActive()
        if (error instanceof CreativePilotError || error instanceof BoundedGenerationError) throw error
        throw new BoundedGenerationError('transport')
      } finally { rawMetadata = null; scope.close() }
    },
  })
  const host = Object.freeze({}) as CreativeOfflineHost
  hosts.set(host, adapter)
  return host
}
