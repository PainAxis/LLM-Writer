/** Local synthetic endpoint response, derived only from the actual submitted window. */
import type { BodyProducerIdentity } from '../../src/types/bodyProducer'
export interface ProducerHttpObservation { attempts: number; inputDigests: string[]; windowDigests: string[]; errors: number }
export const CONTROL_MODEL = 'synthetic-body-producer'
export function producerControlIdentity(endpoint: string): BodyProducerIdentity { return { adapterId: 'bounded-sdk-v1', adapterVersion: 'body-producer-sdk-v1', mode: 'offline_control', requestedModelId: CONTROL_MODEL, effectiveModelId: CONTROL_MODEL, configurationRevision: 'readiness-control-v1', endpointIdentity: endpoint } }
export function arbitraryProducerBody(language: 'zh' | 'en', revision = 1): string { return language === 'zh' ? `顾雨把第${revision}枚银钥匙放进蓝色信封。\r\n无名访客说：“潮水不会替我们作证。”𠮷🙂 A\u030A\u0085` : `Nora placed silver key ${revision} inside the blue envelope.\r\nThe unnamed visitor said, “The tide will not testify for us.”𠮷🙂 A\u030A\u0085` }
export function producerControlOutput(window: string): string {
  if (typeof window !== 'string' || !window.length) throw new Error('producer_control_input')
  let end = Math.min(window.length, 256)
  if (end < window.length && /[\uD800-\uDBFF]/.test(window[end - 1]!) && /[\uDC00-\uDFFF]/.test(window[end]!)) end--
  const quote = window.slice(0, end), label = [...quote][0]!
  return JSON.stringify({ protocol: 'body-producer-output-v1', items: [{ kind: 'narrator_claim', statement: 'A deliberately unreviewed interpretation of this exact passage.', reliability: 'unspecified', spans: [{ startUtf16: 0, endUtf16: end, quote }], subjects: [{ spanIndex: 1, label, planningReference: null, role: 'topic' }] }], saturated: false, examination: { status: 'not_declared', intervals: [] } })
}
export async function configureProducerLoopback(endpoint: string): Promise<void> {
  const { useApiConfig } = await import('../../src/services/apiConfig')
  useApiConfig().updateConfig({ provider: 'custom', apiKey: 'synthetic-loopback-control-only', baseURL: endpoint, selectedModel: CONTROL_MODEL, thinkingMode: 'disabled', thinkingProtocol: 'deepseek', maxTokens: 1200, unlimitedTokens: false, customHeaders: {}, proxyUrl: '' })
}
