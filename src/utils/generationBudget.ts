import type { ApiConfig, GenerateOptions, ThinkingMode, ThinkingProtocol } from '@/types/api'
import type { JSONValue } from '@ai-sdk/provider'

export const DEFAULT_OUTPUT_TOKENS = 16384
export const THINKING_PROTOCOL_OPTIONS = [
  { value: 'auto', label: '自动识别模型' },
  { value: 'openai', label: 'OpenAI 思考强度' },
  { value: 'deepseek', label: 'DeepSeek 思考模式 / 强度' },
  { value: 'glm', label: 'GLM 思考模式 / 强度' },
  { value: 'mimo', label: 'MiMo 思考开关' },
  { value: 'qwen', label: 'Qwen / DashScope 思考预算' },
] as const
export const THINKING_PROTOCOLS = ['auto', 'openai', 'anthropic', 'google', 'deepseek', 'mimo', 'glm', 'qwen'] as const
export const THINKING_MODES = ['default', 'disabled', 'enabled', 'effort', 'budget'] as const
const modeLabels = { default: '服务商默认', disabled: '关闭思考', enabled: '开启思考', effort: '按思考强度', budget: '按 Token 预算' }
const effortLabels: Record<string, string> = { minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '更高', max: '最高' }
type BudgetConfig = Pick<ApiConfig, 'provider' | 'selectedModel'> & Partial<ApiConfig>
export interface ThinkingCapability {
  protocol: Exclude<ThinkingProtocol, 'auto'> | 'unknown'
  label: string
  modes: Array<{ value: ThinkingMode; label: string }>
  efforts: Array<{ value: string; label: string }>
  budgetMin: number
  budgetMax?: number
  hint: string
}
const modes = (...values: ThinkingMode[]) => values.map(value => ({ value, label: modeLabels[value] }))
const efforts = (...values: string[]) => values.map(value => ({ value, label: effortLabels[value] ?? value }))

function resolveProtocol(config: BudgetConfig): ThinkingCapability['protocol'] {
  if (config.provider === 'anthropic' || config.provider === 'google') return config.provider
  if (config.thinkingProtocol && config.thinkingProtocol !== 'auto') return config.thinkingProtocol
  const model = config.selectedModel.toLowerCase()
  if (/deepseek/.test(model)) return 'deepseek'
  if (/glm[-\d]/.test(model)) return 'glm'
  if (/mimo[-\d]/.test(model)) return 'mimo'
  if (/qwen/.test(model)) {
    // Hosted Qwen APIs do not share DashScope's thinking_budget contract.
    let dashscope = false
    try { dashscope = /^(?:[\w-]+\.)?dashscope(?:-intl|-us)?\.aliyuncs\.com$|^[\w-]+\.[\w-]+\.maas\.aliyuncs\.com$/.test(new URL(config.baseURL ?? '').hostname) } catch { /* unknown gateway */ }
    return config.provider === 'qwen' || dashscope ? 'qwen' : 'unknown'
  }
  if (/(?:^|\/)(?:gpt-[5-9]|gpt-oss|o[1-9])/.test(model)) return 'openai'
  return 'unknown'
}
function claudeVersion(model: string): number {
  // A dated Claude 4 ID ends in -20250514; that suffix is not a minor version.
  const match = model.match(/(?:^|\/)claude-(?:opus|sonnet|haiku)[-.](\d)(?:[.-](\d{1,2})(?=[-.]|$))?(?=[-.]|$)/)
    ?? model.match(/(?:^|\/)claude-(\d)(?:[.-](\d{1,2})(?=[-.]|$))?(?=[-.]|$)/)
  return match ? Number(`${match[1]}.${match[2] ?? 0}`) : 0
}

/** Capability rules are deliberately conservative; unrecognized aliases require an explicit format.
 * Sources and semantics: docs/generation-budgets.md. Defaults never add reasoning fields. */
export function getThinkingCapability(config: BudgetConfig): ThinkingCapability {
  const model = config.selectedModel.toLowerCase()
  const protocol = resolveProtocol(config)
  const base: ThinkingCapability = { protocol, label: '服务商默认', modes: modes('default'), efforts: [], budgetMin: 1,
    hint: '未识别到思考参数。可使用服务商默认；自定义模型别名可手动选择已确认支持的参数格式。' }
  switch (protocol) {
    case 'openai': {
      const originalGPT5 = /gpt-5(?:$|-(?:mini|nano|\d{4}))/.test(model)
      const oldReasoner = /(?:^|\/)(?:o[1-9]|gpt-oss)/.test(model)
      const pro = /gpt-5(?:\.[245])?-pro(?:-|$)/.test(model)
      const modernGPT5 = /gpt-5\.[1245](?:-|$)/.test(model)
      if (!originalGPT5 && !oldReasoner && !pro && !modernGPT5 && config.thinkingProtocol !== 'openai') return base
      return { ...base, label: 'OpenAI', modes: modes('default', ...(originalGPT5 || oldReasoner || pro ? [] : ['disabled'] as ThinkingMode[]), 'effort'),
        efforts: pro ? (/gpt-5-pro/.test(model) ? efforts('high') : efforts('medium', 'high', 'xhigh')) : originalGPT5 ? efforts('minimal', 'low', 'medium', 'high') : oldReasoner || /gpt-5\.1/.test(model) || !modernGPT5 ? efforts('low', 'medium', 'high') : efforts('low', 'medium', 'high', 'xhigh'),
        hint: '按强度控制思考，不支持独立的思考 Token 硬上限。输出额度包含思考与正文；模型支持的强度以接口为准。' }
    }
    case 'deepseek':
      return { ...base, label: 'DeepSeek', modes: modes('default', 'disabled', 'enabled', ...(/(?:v4|flash|pro)/.test(model) || config.thinkingProtocol === 'deepseek' ? ['effort'] as ThinkingMode[] : [])),
        efforts: efforts('low', 'high', 'max'), hint: '支持思考开关；V4 系列支持强度。强度不是精确 Token 配额，输出额度仍可能被思考消耗。' }
    case 'glm': {
      const reasoningOnly = /glm-(?:5\.[3-9]|[6-9])/.test(model)
      return { ...base, label: 'GLM', modes: reasoningOnly ? modes('default', 'effort') : modes('default', 'disabled', 'enabled'),
        efforts: reasoningOnly ? efforts('low', 'high', 'max') : [], hint: reasoningOnly ? 'GLM 5.3 系列始终开启思考，可降低强度以缩短等待；不支持关闭或精确 Token 预算。' : '该参数格式提供思考开关，不发送未定义的思考 Token 预算。' }
    }
    case 'mimo':
      return { ...base, label: 'MiMo', modes: modes('default', 'disabled', 'enabled'), hint: 'MiMo 提供思考开关，没有独立的思考 Token 预算。输出额度包含思考与正文。' }
    case 'qwen': {
      const thinkingOnly = /thinking|qwq|qvq/.test(model)
      const instructOnly = /instruct|qwen[12](?:\.|-|$)/.test(model)
      return { ...base, label: 'Qwen / DashScope', modes: instructOnly ? modes('default') : thinkingOnly ? modes('default', 'budget') : modes('default', 'disabled', 'enabled', 'budget'),
        hint: '思考预算通过 thinking_budget 传递；输出额度约束正文，思考额度单独计算。仅适用于支持此参数的 DashScope 模型或兼容网关。' }
    }
    case 'anthropic': {
      const version = claudeVersion(model)
      if (!version || version < 3.7) return base
      const adaptive = version >= 4.6
      const manual = version < 4.7
      // Match the pinned native adapter's clamping limits for manual-thinking models.
      const modelLimit = version === 4.6 ? 128000 : version === 4.5 ? 64000
        : version >= 4 && version <= 4.1 ? (/opus/.test(model) ? 32000 : 64000) : undefined
      return { ...base, label: 'Anthropic Claude', modes: modes('default', 'disabled', ...(adaptive ? ['enabled', 'effort'] as ThinkingMode[] : []), ...(manual ? ['budget'] as ThinkingMode[] : [])),
        efforts: efforts('low', 'medium', 'high', ...(/opus/.test(model) ? ['max'] : [])), budgetMin: 1024, budgetMax: modelLimit === undefined ? undefined : modelLimit - 1,
        hint: manual ? 'Token 预算至少为 1024，必须小于输出总额度；总额度已包含思考，不会额外叠加。Claude 4.6 优先使用强度。' : '此模型使用自适应思考与强度，不支持旧版 budget_tokens。输出总额度包含思考。' }
    }
    case 'google': {
      if (/gemini-2\.5/.test(model)) {
        const pro = /pro/.test(model), lite = /lite/.test(model)
        return { ...base, label: 'Gemini 2.5', modes: modes('default', ...(!pro ? ['disabled'] as ThinkingMode[] : []), 'enabled', 'budget'), budgetMin: pro ? 128 : lite ? 512 : 1, budgetMax: pro ? 32768 : 24576,
          hint: `${pro ? 'Pro 无法关闭思考。' : ''}支持按 Token 设置思考预算，输出总额度包含思考与正文。开启思考使用动态预算。` }
      }
      if (/gemini-3/.test(model)) {
        const minimal = /flash/.test(model) && !/gemini-3\.[78]-flash(?!-lite)/.test(model)
        const oldPro = /gemini-3-pro/.test(model)
        return { ...base, label: 'Gemini 3', modes: modes('default', 'effort'), efforts: efforts(...(minimal ? ['minimal'] : []), 'low', ...(!oldPro ? ['medium'] : []), 'high'),
          hint: '使用思考强度，不保证完全关闭思考；输出总额度包含思考与正文。' }
      }
      return base
    }
    default: return base
  }
}

export function validateGenerationBudget(config: BudgetConfig): string | null {
  const total = config.unlimitedTokens ? null : config.maxTokens
  if (total != null && (!Number.isInteger(total) || total <= 0 || total > 10_000_000)) return '输出预算必须是 1 至 10000000 的整数，或使用服务商默认值'
  if (config.thinkingProtocol !== undefined && !THINKING_PROTOCOLS.includes(config.thinkingProtocol)) return '未知的思考参数格式'
  const mode = config.thinkingMode ?? 'default'
  if (!THINKING_MODES.includes(mode)) return '未知的思考模式'
  if (mode === 'default') return null
  const capability = getThinkingCapability(config)
  if ((capability.protocol === 'google' || capability.protocol === 'anthropic') && config.provider !== capability.protocol) return '此思考参数格式需要选择对应的原生服务商'
  if (!capability.modes.some(option => option.value === mode)) return `${capability.label} 不支持当前思考模式，请改用服务商默认或支持的模式`
  if (mode === 'effort' && !capability.efforts.some(option => option.value === config.thinkingEffort)) return '请选择当前模型支持的思考强度'
  if (mode === 'budget') {
    const budget = config.thinkingBudget
    if (typeof budget !== 'number' || !Number.isInteger(budget) || budget < capability.budgetMin || budget > (capability.budgetMax ?? 10_000_000)) return `思考预算必须是 ${capability.budgetMin} 至 ${capability.budgetMax ?? 10_000_000} 的整数`
    if (capability.protocol !== 'qwen' && total != null && budget >= total) return '思考预算必须小于输出总预算，为正文保留额度'
  }
  return null
}

/** Build options against the effective model (including assistant overrides), before any network request. */
export function buildGenerationBudget(config: ApiConfig, options: GenerateOptions = {}) {
  const maxOutputTokens = options.maxTokens ?? (config.unlimitedTokens ? undefined : config.maxTokens) ?? undefined
  const effective = { ...config, selectedModel: options.model?.trim() || config.selectedModel, maxTokens: maxOutputTokens ?? null, unlimitedTokens: maxOutputTokens === undefined }
  const error = validateGenerationBudget(effective)
  if (error) throw new Error(error)
  let output = maxOutputTokens
  let temperature: number | undefined = options.temperature ?? config.temperature
  const capability = getThinkingCapability(effective)
  const mode = config.thinkingMode ?? 'default'
  const providerOptions: Record<string, Record<string, JSONValue>> = {}
  let fields: Record<string, JSONValue> | undefined
  if (mode !== 'default') {
    const enabled = mode !== 'disabled'
    switch (capability.protocol) {
      case 'openai': fields = { reasoningEffort: enabled ? config.thinkingEffort as string : 'none' }; temperature = undefined; break
      case 'deepseek':
      case 'glm': fields = { thinking: { type: enabled ? 'enabled' : 'disabled' }, ...(mode === 'effort' ? { reasoningEffort: config.thinkingEffort as string } : {}) }; if (enabled) temperature = undefined; break
      case 'mimo': fields = { thinking: { type: enabled ? 'enabled' : 'disabled' } }; if (enabled) temperature = undefined; break
      case 'qwen': fields = { enable_thinking: enabled, ...(mode === 'budget' ? { thinking_budget: config.thinkingBudget! } : {}) }; break
      case 'anthropic': {
        if (mode === 'budget') {
          fields = { thinking: { type: 'enabled', budgetTokens: config.thinkingBudget! } }
          // The native adapter adds thinkingBudget to maxOutputTokens. Keep the user's total ceiling.
          if (output !== undefined) output -= config.thinkingBudget!
        } else fields = { thinking: { type: enabled ? 'adaptive' : 'disabled' }, ...(mode === 'effort' ? { effort: config.thinkingEffort as string } : {}) }
        if (enabled) temperature = undefined
        break
      }
      case 'google': fields = { thinkingConfig: mode === 'effort' ? { thinkingLevel: config.thinkingEffort as string } : { thinkingBudget: mode === 'disabled' ? 0 : mode === 'enabled' ? -1 : config.thinkingBudget! } }; break
    }
  }
  // Known reasoning-only defaults also reject sampling parameters; do not force a temperature.
  if (capability.protocol === 'openai' || (capability.protocol === 'mimo' && mode === 'default') || (capability.protocol === 'anthropic' && claudeVersion(effective.selectedModel) >= 4.6 && mode === 'default')) temperature = undefined
  if (fields) providerOptions[config.provider] = fields
  return { maxOutputTokens: output, temperature, providerOptions }
}

/** Compatible SDK defaults to max_tokens, while these Chat Completion APIs require the newer field. */
export function usesCompletionTokenLimit(config: ApiConfig): boolean {
  const protocol = resolveProtocol(config)
  return protocol === 'mimo' || (protocol === 'openai' && !/gpt-oss/i.test(config.selectedModel))
}
