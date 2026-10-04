import type { MemoryEmbeddingConfig, MemoryRerankConfig } from '@/types/memory'

export const MEMORY_PROVIDER_DEFAULTS: {
  embedding: MemoryEmbeddingConfig
  rerank: MemoryRerankConfig
} = {
  embedding: {
    protocol: 'jina', endpoint: 'https://api.jina.ai/v1/embeddings',
    model: 'jina-embeddings-v3', apiKey: '', dimensions: 512,
  },
  rerank: {
    endpoint: 'https://api.jina.ai/v1/rerank',
    model: 'jina-reranker-v2-base-multilingual', apiKey: '',
  },
}

const REQUEST_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_EMBEDDING_BATCH = 64
const MAX_RERANK_BATCH = 60
const MAX_TEXT_CHARS = 8_192
const MAX_BATCH_CHARS = 128_000
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u

/** Only local messages from this adapter may reach the evidence panel. */
class MemoryProviderError extends Error {
  constructor(message: string) { super(message); this.name = 'MemoryProviderError' }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MemoryProviderError('记忆检索服务配置或响应格式无效')
  }
  return value as Record<string, unknown>
}

function endpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2_048 || CONTROL_CHARACTERS.test(value)) {
    throw new MemoryProviderError('记忆检索服务地址无效')
  }
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new MemoryProviderError('请输入完整的记忆检索服务 HTTP 地址') }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new MemoryProviderError('远程记忆检索服务须使用 HTTPS；本机服务可使用 HTTP')
  }
  if (url.username || url.password || value.includes('?') || value.includes('#')) {
    throw new MemoryProviderError('记忆检索服务地址不能包含用户名、密码、查询参数或片段')
  }
  return url.href
}

function model(value: unknown): string {
  if (typeof value !== 'string' || CONTROL_CHARACTERS.test(value) || !value.trim() || value.trim().length > 200) {
    throw new MemoryProviderError('记忆检索模型名称须为 1 至 200 个字符')
  }
  return value.trim()
}

function apiKey(value: unknown): string {
  // Validate before trimming so a pasted line break is never silently accepted.
  if (typeof value !== 'string' || value.length > 8_192 || !/^[\x20-\x7e]+$/.test(value) || !value.trim() || /\s/.test(value.trim())) {
    throw new MemoryProviderError('请输入有效的本次会话 API Key')
  }
  return value.trim()
}

export function normalizeEmbeddingConfig(value: unknown): MemoryEmbeddingConfig {
  const source = record(value)
  if (source.protocol !== 'jina' && source.protocol !== 'openai-compatible') {
    throw new MemoryProviderError('请选择受支持的嵌入协议')
  }
  if (typeof source.dimensions !== 'number' || !Number.isInteger(source.dimensions) || source.dimensions < 1 || source.dimensions > 4_096) {
    throw new MemoryProviderError('嵌入维度须为 1 至 4096 的整数，并与服务模型一致')
  }
  return {
    protocol: source.protocol, endpoint: endpoint(source.endpoint), model: model(source.model),
    apiKey: apiKey(source.apiKey), dimensions: source.dimensions,
  }
}

export function normalizeRerankConfig(value: unknown): MemoryRerankConfig {
  const source = record(value)
  return { endpoint: endpoint(source.endpoint), model: model(source.model), apiKey: apiKey(source.apiKey) }
}

function cancelled(): DOMException { return new DOMException('记忆检索请求已取消', 'AbortError') }
function timedOut(): DOMException { return new DOMException('记忆检索服务请求超时', 'TimeoutError') }

function textsForRequest(texts: string[], maxItems: number): string[] {
  if (!Array.isArray(texts) || !texts.length || texts.length > maxItems ||
    Array.from(texts).some(text => typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT_CHARS) ||
    texts.reduce((sum, text) => sum + text.length, 0) > MAX_BATCH_CHARS) {
    throw new MemoryProviderError('记忆检索请求文本为空或超过单次预算')
  }
  // Preserve exact content, but detach the mutable caller-owned array before awaiting.
  return [...texts]
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const contentLength = response.headers.get('content-length')
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined)
    throw new MemoryProviderError('记忆检索服务响应超过大小限制')
  }
  if (!response.body) throw new MemoryProviderError('记忆检索服务返回了空响应')
  const reader = response.body.getReader()
  const abort = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', abort, { once: true })
  let bytes = 0
  let text = ''
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      signal.throwIfAborted()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined)
        throw new MemoryProviderError('记忆检索服务响应超过大小限制')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text) as unknown
  } catch (error) {
    void reader.cancel().catch(() => undefined)
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}

async function postJson(config: MemoryRerankConfig, body: Record<string, unknown>, callerSignal?: AbortSignal): Promise<unknown> {
  if (callerSignal?.aborted) throw cancelled()
  const controller = new AbortController()
  let timeout = false
  const abortFromCaller = () => { controller.abort(cancelled()) }
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = setTimeout(() => { timeout = true; controller.abort(timedOut()) }, REQUEST_TIMEOUT_MS)
  let rejectAborted: () => void = () => undefined
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = () => { reject(timeout ? timedOut() : cancelled()) }
    controller.signal.addEventListener('abort', rejectAborted, { once: true })
  })
  const request = async () => {
    const response = await fetch(config.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body), signal: controller.signal,
      credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
    })
    controller.signal.throwIfAborted()
    if (response.redirected) {
      void response.body?.cancel().catch(() => undefined)
      throw new MemoryProviderError('记忆检索服务不允许重定向，请填写最终接口地址')
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      if (response.status === 401 || response.status === 403) throw new MemoryProviderError('记忆检索服务鉴权失败，请检查本次会话 API Key')
      if (response.status === 429) throw new MemoryProviderError('记忆检索服务达到调用限制，请稍后重试')
      throw new MemoryProviderError('记忆检索服务请求失败，请检查模型与服务配置')
    }
    return boundedJson(response, controller.signal)
  }
  try {
    // The race also bounds a stalled response body or a transport that ignores abort.
    return await Promise.race([request(), aborted])
  } catch (error) {
    const safe = controller.signal.aborted ? (timeout ? timedOut() : cancelled())
      : error instanceof MemoryProviderError ? error
        : new MemoryProviderError('记忆检索服务请求失败，请检查网络、地址及服务的浏览器 CORS 配置')
    controller.abort()
    throw safe
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', abortFromCaller)
    controller.signal.removeEventListener('abort', rejectAborted)
  }
}

/** Documents must already pass the current revision and disclosure-cutoff gates. */
export async function embedMemoryTexts(
  input: MemoryEmbeddingConfig, texts: string[], task: 'retrieval.query' | 'retrieval.passage', signal?: AbortSignal,
): Promise<number[][]> {
  if (signal?.aborted) throw cancelled()
  const config = normalizeEmbeddingConfig(input)
  const content = textsForRequest(texts, MAX_EMBEDDING_BATCH)
  if (task !== 'retrieval.query' && task !== 'retrieval.passage') throw new MemoryProviderError('嵌入检索任务无效')
  const response = record(await postJson(config, {
    model: config.model, input: content, dimensions: config.dimensions,
    ...(config.protocol === 'jina'
      ? { task, embedding_type: 'float', late_chunking: false }
      : { encoding_format: 'float' }),
  }, signal))
  const data = response.data
  if (!Array.isArray(data) || data.length !== content.length) throw new MemoryProviderError('嵌入服务返回的向量数量不完整')
  const vectors: number[][] = new Array(content.length)
  const seen = new Set<number>()
  for (const value of data) {
    const item = record(value)
    const index = item.index
    const vector = item.embedding
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= content.length || seen.has(index)) {
      throw new MemoryProviderError('嵌入服务返回了无效或重复的向量索引')
    }
    if (!Array.isArray(vector) || vector.length !== config.dimensions ||
      !vector.every(value => typeof value === 'number' && Number.isFinite(value) && Number.isFinite(Math.fround(value))) ||
      !vector.some(value => Math.fround(value) !== 0)) {
      throw new MemoryProviderError('嵌入服务返回了无效向量或与设置不一致的维度')
    }
    seen.add(index)
    vectors[index] = [...vector]
  }
  return vectors
}

/** Provider text is deliberately discarded: only indexes into verified input survive. */
export async function rerankMemoryTexts(
  input: MemoryRerankConfig, query: string, texts: string[], signal?: AbortSignal,
): Promise<Array<{ index: number; score: number }>> {
  if (signal?.aborted) throw cancelled()
  const config = normalizeRerankConfig(input)
  const content = textsForRequest(texts, MAX_RERANK_BATCH)
  if (typeof query !== 'string' || !query.trim() || query.length > 4_000) throw new MemoryProviderError('重排查询为空或超过长度限制')
  const response = record(await postJson(config, {
    model: config.model, query, documents: content, top_n: content.length, return_documents: false,
  }, signal))
  if (!Array.isArray(response.results) || response.results.length !== content.length) {
    throw new MemoryProviderError('重排服务返回的候选数量不完整')
  }
  const seen = new Set<number>()
  const ranked = response.results.map(value => {
    const item = record(value)
    const index = item.index
    const score = item.relevance_score
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= content.length || seen.has(index) ||
      typeof score !== 'number' || !Number.isFinite(score)) {
      throw new MemoryProviderError('重排服务返回了无效索引或分数')
    }
    seen.add(index)
    return { index, score }
  })
  return ranked.sort((a, b) => b.score - a.score || a.index - b.index)
}
