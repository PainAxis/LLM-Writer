import type { LanguageModel } from 'ai'
import type { ApiConfig } from '@/types/api'

export type ProviderKind = 'compatible' | 'anthropic' | 'google'

export interface ProviderPreset {
  id: string
  label: string
  baseURL: string
  kind: ProviderKind
  /** baseURL 是否允许用户编辑（仅 custom 允许） */
  editableBaseURL: boolean
  /** 预设强制附加的请求头 */
  defaultHeaders?: Record<string, string>
  /** 切换到该服务商时的默认模型 */
  defaultModel?: string
}

/**
 * 服务商预设表。
 * - anthropic / google：API 格式不兼容 OpenAI，使用官方原生 provider 包
 * - 其余（含各类国产模型）：均为 OpenAI 兼容格式，统一走 openai-compatible
 * - custom：用户自填任意 OpenAI 兼容地址（ollama、lmstudio、中转站等）
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'custom',
    label: 'OpenAI 兼容（自定义地址）',
    baseURL: 'https://api.openai.com/v1',
    kind: 'compatible',
    editableBaseURL: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    kind: 'compatible',
    editableBaseURL: false,
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    baseURL: 'https://api.anthropic.com/v1',
    kind: 'anthropic',
    editableBaseURL: false,
    defaultHeaders: {
      // 允许从浏览器直接访问 Anthropic API
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  },
  {
    id: 'google',
    label: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    kind: 'google',
    editableBaseURL: false,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    kind: 'compatible',
    editableBaseURL: false,
  },
  {
    id: 'groq',
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    kind: 'compatible',
    editableBaseURL: false,
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    baseURL: 'https://api.x.ai/v1',
    kind: 'compatible',
    editableBaseURL: false,
  },
  {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    kind: 'compatible',
    editableBaseURL: false,
  },
  {
    id: 'qwen',
    label: '阿里通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    kind: 'compatible',
    editableBaseURL: false,
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    kind: 'compatible',
    editableBaseURL: false,
  },
]

export function getPreset(providerId: string): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === providerId) ?? PROVIDER_PRESETS[0]
}

export interface FallbackModel {
  id: string
  name: string
  description: string
}

/**
 * 未同步模型列表时的兜底选项（2026-09 核实，来源：LLM Gateway / AI Business 榜单公开 Model ID）。
 * 仅作离线兜底，请优先使用"同步模型列表"从服务商获取实时列表。
 */
export const FALLBACK_MODELS: FallbackModel[] = [
  { id: 'gpt-5.5', name: 'gpt-5.5', description: 'OpenAI 旗舰' },
  { id: 'gpt-5.4', name: 'gpt-5.4', description: 'OpenAI 通用' },
  { id: 'gpt-5.4-mini', name: 'gpt-5.4-mini', description: 'OpenAI 性价比' },
  { id: 'claude-opus-4.8', name: 'claude-opus-4.8', description: 'Anthropic 最强推理' },
  { id: 'claude-sonnet-4.6', name: 'claude-sonnet-4.6', description: 'Anthropic 均衡主力' },
  { id: 'gemini-3.1-pro', name: 'gemini-3.1-pro', description: 'Google 长上下文旗舰' },
  { id: 'gemini-3.6-flash', name: 'gemini-3.6-flash', description: 'Google 高速' },
  { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', description: 'DeepSeek 推理旗舰' },
  { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', description: 'DeepSeek 高速低价' },
  { id: 'grok-4.3', name: 'grok-4.3', description: 'xAI' },
  { id: 'kimi-k2-6', name: 'kimi-k2-6', description: 'Moonshot 长上下文' },
  { id: 'qwen3.8-flash', name: 'qwen3.8-flash', description: '阿里 高速' },
  { id: 'qwen3.6-plus', name: 'qwen3.6-plus', description: '阿里 均衡' },
  { id: 'glm-5.3-flash', name: 'glm-5.3-flash', description: '智谱 高速' },
  { id: 'glm-5.1', name: 'glm-5.1', description: '智谱 均衡' },
]

/**
 * SDK 动态加载：`ai` 内核与各 provider 包体积较大，
 * 按需加载使其只进入"首次调用 AI 功能"时才下载的异步 chunk。
 */
interface AISDK {
  streamText: typeof import('ai')['streamText']
  generateText: typeof import('ai')['generateText']
  createOpenAICompatible: typeof import('@ai-sdk/openai-compatible')['createOpenAICompatible']
  createAnthropic: typeof import('@ai-sdk/anthropic')['createAnthropic']
  createGoogleGenerativeAI: typeof import('@ai-sdk/google')['createGoogleGenerativeAI']
}

let sdkPromise: Promise<AISDK> | null = null

export function loadAISDK(): Promise<AISDK> {
  if (!sdkPromise) {
    sdkPromise = Promise.all([
      import('ai'),
      import('@ai-sdk/openai-compatible'),
      import('@ai-sdk/anthropic'),
      import('@ai-sdk/google'),
    ]).then(([ai, oc, anthropic, google]) => ({
      streamText: ai.streamText,
      generateText: ai.generateText,
      createOpenAICompatible: oc.createOpenAICompatible,
      createAnthropic: anthropic.createAnthropic,
      createGoogleGenerativeAI: google.createGoogleGenerativeAI,
    }))
  }
  return sdkPromise
}

/**
 * 应用可选代理前缀：最终 URL = proxyUrl + 实际 URL。
 * 用于自建反向代理 / CORS 转发服务（代理需完整转发后续路径）。
 */
export function applyProxyPrefix(url: string, proxyUrl?: string): string {
  const proxy = (proxyUrl ?? '').trim()
  if (!proxy) return url
  return proxy.endsWith('/') ? `${proxy}${url}` : `${proxy}/${url}`
}

/**
 * 根据配置解析出 AI SDK 的 LanguageModel 实例。
 * 预设服务商的 baseURL 不可改；custom 使用用户自填地址。
 */
export async function resolveLanguageModel(config: ApiConfig): Promise<LanguageModel> {
  const preset = getPreset(config.provider)
  const baseURL = preset.editableBaseURL ? config.baseURL || preset.baseURL : preset.baseURL
  const proxiedBaseURL = applyProxyPrefix(baseURL, config.proxyUrl)
  const headers = {
    ...(preset.defaultHeaders ?? {}),
    ...(config.customHeaders ?? {}),
  }

  const { createOpenAICompatible, createAnthropic, createGoogleGenerativeAI } = await loadAISDK()

  switch (preset.kind) {
    case 'anthropic': {
      const provider = createAnthropic({ apiKey: config.apiKey, baseURL: proxiedBaseURL, headers })
      return provider.languageModel(config.selectedModel)
    }
    case 'google': {
      const provider = createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL: proxiedBaseURL, headers })
      return provider.languageModel(config.selectedModel)
    }
    default: {
      const provider = createOpenAICompatible({
        name: preset.id,
        baseURL: proxiedBaseURL,
        apiKey: config.apiKey,
        headers,
        includeUsage: true,
      })
      return provider.chatModel(config.selectedModel)
    }
  }
}

/** 供连接测试用的最佳实现：各服务商模型列表端点探活 */
export function buildModelsProbe(config: ApiConfig): { url: string; headers: Record<string, string> } {
  const preset = getPreset(config.provider)
  const baseURL = preset.editableBaseURL ? config.baseURL || preset.baseURL : preset.baseURL
  const proxiedBaseURL = applyProxyPrefix(baseURL, config.proxyUrl)
  const headers: Record<string, string> = {
    ...(preset.defaultHeaders ?? {}),
    ...(config.customHeaders ?? {}),
  }

  switch (preset.kind) {
    case 'anthropic':
      return {
        url: `${proxiedBaseURL}/models`,
        headers: { ...headers, 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
      }
    case 'google':
      return { url: `${proxiedBaseURL}/models`, headers: { ...headers, 'x-goog-api-key': config.apiKey } }
    default:
      return { url: `${proxiedBaseURL}/models`, headers: { ...headers, Authorization: `Bearer ${config.apiKey}` } }
  }
}

interface ModelsProbeResponse {
  data?: Array<{ id?: string }>
  models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>
}

/**
 * 从服务商拉取可用模型列表，三种响应格式归一化为模型 ID 数组：
 * - OpenAI 兼容 / Anthropic: `{ data: [{ id }] }`
 * - Google: `{ models: [{ name: "models/xxx" }] }`（过滤出支持 generateContent 的模型）
 */
export async function fetchProviderModels(config: ApiConfig): Promise<string[]> {
  const probe = buildModelsProbe(config)

  const response = await fetch(probe.url, {
    method: 'GET',
    headers: probe.headers,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`获取模型列表失败: HTTP ${response.status}${text ? ` - ${text.slice(0, 150)}` : ''}`)
  }

  const data = (await response.json()) as ModelsProbeResponse
  const preset = getPreset(config.provider)

  let ids: string[]
  if (preset.kind === 'google') {
    ids = (data.models ?? [])
      .filter(
        (m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'),
      )
      .map((m) => String(m.name ?? '').replace(/^models\//, ''))
  } else {
    ids = (data.data ?? []).map((m) => String(m.id ?? ''))
  }

  return [...new Set(ids.filter(Boolean))].sort()
}
