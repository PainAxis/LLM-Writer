export type ApiConfigType = 'official' | 'custom'

export interface ApiConfig {
  apiKey: string
  baseURL: string
  /** 服务商预设 ID（见 services/aiProviders.ts），custom 表示用户自填地址 */
  provider: string
  /** 当前使用的模型 ID */
  selectedModel: string
  maxTokens: number | null
  unlimitedTokens: boolean
  temperature: number
  /** 附加请求头（如直连 Anthropic 需要的浏览器访问声明） */
  customHeaders?: Record<string, string>
  /** 可选代理前缀：请求 URL = proxyUrl + 实际 API 地址（用于绕过浏览器 CORS 限制） */
  proxyUrl?: string
}

export interface CustomModelOption {
  id: string
  name: string
  description?: string
  price?: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface GenerateOptions {
  model?: string
  maxTokens?: number | null
  temperature?: number
  type?: string
  signal?: AbortSignal
  /** 系统提示词（人设）；提供时作为顶层 system 参数发送 */
  system?: string
  /** 多轮消息；提供时优先于 prompt 作为对话载荷 */
  messages?: ChatMessage[]
}

/** 上下文容量策略：truncation 硬截断 / summary 滚动摘要，显式二选一 */
export interface ContextPolicy {
  /** 上下文预算上限（token），0 = 不限 */
  maxTokens: number
  /** 上下文保留的最大对话轮数，0 = 不限 */
  maxTurns: number
  strategy: 'summary' | 'truncation'
  /** 上下文达到有效预算的百分比时触发压缩（仅 summary 策略） */
  summaryThreshold: number
  /** 压缩时保留原文的最近轮数 */
  retainTurns: number
}

/** AI 助手（人设 + 会话隔离） */
export interface AssistantInfo {
  id: number
  name: string
  /** 人设/系统提示词 */
  persona: string
  /** 按助手覆盖的默认模型，空 = 跟随全局活动配置 */
  defaultModel?: string
  contextPolicy: ContextPolicy
  createdAt: string
  updatedAt: string
}

/** 助手会话消息 */
export interface AssistantChatEntry {
  id: string
  content: string
  isUser: boolean
  timestamp: string
}

export type StreamCallback = (chunk: string, fullContent: string) => void

export interface NovelBasicInfo {
  title?: string
  genre?: string
  intro?: string
  theme?: string
}

export interface CharacterInfo {
  name: string
  description: string
  traits?: string[]
}

export interface WorldSettingInfo {
  title: string
  description: string
}

export interface TemplateInfo {
  name?: string
  description?: string
  style?: string
  writingTips?: string
}
