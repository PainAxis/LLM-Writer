/** The production bounded SDK path, admitted only by an explicit local-control host.
 * Importing/constructing this adapter does not inspect API settings or credentials.
 * Its persisted identity never grants authority and cannot enable a live endpoint. */
import type { ApiConfig, GenerationRequestUsage } from '../../types/api'
import type { BodyProducerAdapter, BodyProducerIdentity, BodyProducerUsage } from '../../types/bodyProducer'
import { BoundedGenerationError } from '../aiRequestLimits'
import { assertScalarText, canonicalStringify, utf8Bytes } from './protocol'

export const BODY_PRODUCER_TRANSPORT_LIMITS = Object.freeze({
  inputBytes: 32_768, inputUtf16: 16_384, textBytes: 16_384, textUtf16: 16_384,
  httpBytes: 65_536, outputTokens: 1_200, timeoutMs: 30_000,
})
export type BodyProducerTransportErrorCode = 'offline_only' | 'configuration_changed' | 'invalid_input' | 'response_capacity'
/** Never carries config, URLs, response text, credentials or a provider cause. */
export class BodyProducerTransportError extends Error {
  constructor(readonly code: BodyProducerTransportErrorCode) { super(code); this.name = 'BodyProducerTransportError' }
}
export interface OfflineSdkBodyProducerOptions {
  identity: BodyProducerIdentity
  /** Opaque revision must change on any credential/configuration edit. No secret enters it. */
  currentConfigurationRevision(): string
  /** A smaller local-control deadline is allowed; the production maximum cannot increase. */
  timeoutMs?: number
}

const identityKeys = ['adapterId', 'adapterVersion', 'mode', 'requestedModelId', 'effectiveModelId', 'configurationRevision', 'endpointIdentity'] as const
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(value)
function loopbackEndpoint(value: string): string {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.href !== value) throw new Error()
    return url.href
  } catch { throw new BodyProducerTransportError('offline_only') }
}
function freezeIdentity(input: BodyProducerIdentity): Readonly<BodyProducerIdentity> {
  if (!input || typeof input !== 'object' || Object.keys(input).length !== identityKeys.length
    || !identityKeys.every(key => Object.hasOwn(input, key)) || input.mode !== 'offline_control'
    || !['adapterId', 'adapterVersion', 'requestedModelId', 'effectiveModelId', 'configurationRevision']
      .every(key => identifier(input[key as keyof BodyProducerIdentity]))) throw new BodyProducerTransportError('offline_only')
  loopbackEndpoint(input.endpointIdentity)
  return Object.freeze({ ...input })
}
function boundedWire(wire: { system: string; prompt: string }): { system: string; prompt: string } {
  try {
    if (!wire || typeof wire !== 'object' || Object.keys(wire).length !== 2 || !Object.hasOwn(wire, 'system') || !Object.hasOwn(wire, 'prompt')
      || typeof wire.system !== 'string' || typeof wire.prompt !== 'string' || !wire.system.length || !wire.prompt.length) throw new Error()
    const frozen = { system: wire.system, prompt: wire.prompt }, serialized = canonicalStringify(frozen)
    if (serialized.length > BODY_PRODUCER_TRANSPORT_LIMITS.inputUtf16 || utf8Bytes(serialized) > BODY_PRODUCER_TRANSPORT_LIMITS.inputBytes) throw new Error()
    return frozen
  } catch { throw new BodyProducerTransportError('invalid_input') }
}

/** This initial adapter intentionally supports no live grant, proxy or arbitrary headers.
 * Only APIService accesses the synthetic credential when its admitted loopback call runs. */
export function createOfflineSdkBodyProducer(options: OfflineSdkBodyProducerOptions): BodyProducerAdapter {
  const identity = freezeIdentity(options.identity)
  const revision = options.currentConfigurationRevision
  const timeoutMs = options.timeoutMs ?? BODY_PRODUCER_TRANSPORT_LIMITS.timeoutMs
  if (typeof revision !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > BODY_PRODUCER_TRANSPORT_LIMITS.timeoutMs) {
    throw new BoundedGenerationError('invalid_limits')
  }
  let readCurrentConfig: (() => ApiConfig) | undefined
  function assertConfig(config: ApiConfig): void {
    // Check the non-secret destination first; never read, copy, persist or hash apiKey here.
    if (config.provider !== 'custom' || config.proxyUrl || Object.keys(config.customHeaders ?? {}).length > 0
      || loopbackEndpoint(config.baseURL) !== identity.endpointIdentity || config.selectedModel !== identity.effectiveModelId
      || config.thinkingMode !== 'disabled') throw new BodyProducerTransportError('configuration_changed')
  }
  const assertCurrent = () => {
    let current: string
    try { current = revision() } catch { throw new BodyProducerTransportError('configuration_changed') }
    if (current !== identity.configurationRevision) throw new BodyProducerTransportError('configuration_changed')
    if (readCurrentConfig) assertConfig(readCurrentConfig())
  }
  return Object.freeze({
    identity,
    assertCurrent,
    async invoke(input: Parameters<BodyProducerAdapter['invoke']>[0]): Promise<Awaited<ReturnType<BodyProducerAdapter['invoke']>>> {
      if (input.signal.aborted) throw new BoundedGenerationError('cancelled')
      const wire = boundedWire(input.wire)
      assertCurrent()
      const { useApiConfig } = await import('../apiConfig')
      readCurrentConfig = () => useApiConfig().activeConfig.value
      assertCurrent()
      if (input.signal.aborted) throw new BoundedGenerationError('cancelled')
      const { default: api } = await import('../api')
      let usage: BodyProducerUsage = { provenance: 'synthetic_control', inputTokens: null, outputTokens: null, reasoningTokens: null }
      const capture = (metadata: GenerationRequestUsage) => {
        // A tokenizer estimate is not provider metering. Partial reports stay partial.
        if (metadata.usageSource === 'reported') usage = {
          provenance: 'synthetic_control', inputTokens: metadata.inputTokens ?? null, outputTokens: metadata.outputTokens ?? null, reasoningTokens: null,
        }
      }
      const text = await api.generateText(wire.prompt, {
        system: wire.system, model: identity.effectiveModelId, signal: input.signal,
        maxTokens: BODY_PRODUCER_TRANSPORT_LIMITS.outputTokens, temperature: 0.1, type: 'body-producer-offline-control',
        requestLimits: { maxAttempts: 1, maxResponseBytes: BODY_PRODUCER_TRANSPORT_LIMITS.httpBytes, timeoutMs, omitUsageContent: true },
        beforeRequest: async () => {
          assertCurrent()
          await input.beforeRequest()
          // A source/config edit while durable intent is being committed revokes dispatch.
          assertCurrent()
        },
        onRequestUsage: capture,
      })
      if (input.signal.aborted) throw new BoundedGenerationError('cancelled')
      try {
        assertScalarText(text)
        if (text.length > BODY_PRODUCER_TRANSPORT_LIMITS.textUtf16 || utf8Bytes(text) > BODY_PRODUCER_TRANSPORT_LIMITS.textBytes) throw new Error()
      } catch { throw new BodyProducerTransportError('response_capacity') }
      return { text, evidenceId: `invocation-${crypto.randomUUID()}`, usage, reportedModelId: null }
    },
  })
}
