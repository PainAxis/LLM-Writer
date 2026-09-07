import { useApiConfig } from './apiConfig'
import { buildModelsProbe, getPreset, loadAISDK, resolveLanguageModel } from './aiProviders'
import billingService from './billing'
import { PREVIOUS_CONTENT_MAX_CHARS, trimTextFromEnd } from '@/utils/tokenBudget'
import { buildCorpusInjection, recommendCorpus } from '@/utils/corpusRetrieval'
import { AIRequestCancelledError } from '@/utils/aiRequestScope'

/** 个性化生成时注入语料的字符预算 */
const CORPUS_INJECTION_MAX_CHARS = 4000
import type {
  CharacterInfo,
  ChatMessage,
  GenerateOptions,
  NovelBasicInfo,
  StreamCallback,
  TemplateInfo,
  WorldSettingInfo,
} from '@/types/api'

const STREAM_TIMEOUT_MS = 300_000 // 5分钟，给长内容生成留足时间

interface UsageInfo {
  inputTokens?: number
  outputTokens?: number
}

/**
 * AI 服务：基于 Vercel AI SDK 的统一多服务商实现。
 * - 服务商解析 / OpenAI 兼容层 / SSE 解析交给 SDK
 * - 本类只负责：门面接口、提示词构建、中断、计费挂钩
 * - 配置由 apiConfig 模块统一管理，每次请求实时读取活动配置
 */
class APIService {
  private activeControllers = new Set<AbortController>()

  /** 兼容全局中断入口；视图应通过自己的 signal 取消所属请求。 */
  abortActiveRequests(): void {
    const controllers = [...this.activeControllers]
    this.activeControllers.clear()
    for (const controller of controllers) controller.abort()
  }

  private getConfig() {
    return useApiConfig().activeConfig.value
  }

  private assertConfigReady(): void {
    const config = this.getConfig()
    const preset = getPreset(config.provider)
    if (!config.apiKey?.trim()) {
      throw new Error('API密钥未配置，请先在设置中配置API密钥')
    }
    if (!config.selectedModel?.trim()) {
      throw new Error('未选择模型，请先在设置中选择模型')
    }
    if (preset.editableBaseURL && !config.baseURL?.trim()) {
      throw new Error('API地址未配置，请先在设置中配置API地址')
    }
  }

  /** 清理提示词中的控制字符 */
  private sanitizePrompt(prompt: string): string {
    return prompt.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
  }

  /** 创建超时中断源（返回 signal 与清理函数） */
  private createTimeoutSignal(externalSignal?: AbortSignal): { signal: AbortSignal; clearTimeout: () => void } {
    const controller = new AbortController()
    this.activeControllers.add(controller)
    const abortFromCaller = () => controller.abort(externalSignal?.reason)
    if (externalSignal?.aborted) abortFromCaller()
    else externalSignal?.addEventListener('abort', abortFromCaller, { once: true })
    const timeout = setTimeout(() => controller.abort(new DOMException('AI请求超时，请重试', 'TimeoutError')), STREAM_TIMEOUT_MS)
    const clearTimeoutFn = () => {
      clearTimeout(timeout)
      externalSignal?.removeEventListener('abort', abortFromCaller)
      this.activeControllers.delete(controller)
    }
    return { signal: controller.signal, clearTimeout: clearTimeoutFn }
  }

  private throwIfAborted(signal: AbortSignal, partialContent = ''): void {
    if (!signal.aborted) return
    if (signal.reason instanceof Error && signal.reason.name === 'TimeoutError') throw signal.reason
    throw new AIRequestCancelledError(partialContent)
  }

  private buildRequestBody(config: { maxTokens: number | null; temperature: number }, options: GenerateOptions, stream: boolean) {
    const maxOutputTokens = options.maxTokens ?? config.maxTokens ?? undefined
    const temperature = options.temperature ?? config.temperature
    return { maxOutputTokens, temperature, stream }
  }

  private recordUsage(
    model: string,
    prompt: string,
    response: string,
    estimatedInputTokens: number,
    usage: UsageInfo | undefined,
    status: 'success' | 'failed',
    type: string,
  ): void {
    const inputTokens = usage?.inputTokens ?? estimatedInputTokens
    const outputTokens = usage?.outputTokens ?? billingService.estimateTokens(response)
    billingService.recordAPICall({
      type,
      model,
      content: prompt,
      response,
      inputTokens,
      outputTokens,
      status,
    })
  }

  // ============ 非流式请求 ============

  async generateText(prompt: string, options: GenerateOptions = {}): Promise<string> {
    this.assertConfigReady()
    const config = this.getConfig()
    const estimatedInputTokens = billingService.estimateTokens(prompt)
    const { maxOutputTokens, temperature } = this.buildRequestBody(config, options, false)
    const { signal, clearTimeout } = this.createTimeoutSignal(options.signal)
    const effectiveModel = options.model?.trim() || config.selectedModel

    try {
      this.throwIfAborted(signal)
      const { generateText } = await loadAISDK()
      const model = await resolveLanguageModel(
        effectiveModel === config.selectedModel ? config : { ...config, selectedModel: effectiveModel },
      )
      this.throwIfAborted(signal)
      const result = await generateText({
        model,
        ...(options.messages?.length ? { messages: options.messages } : { prompt: this.sanitizePrompt(prompt) }),
        system: options.system ? this.sanitizePrompt(options.system) : undefined,
        temperature,
        maxOutputTokens,
        abortSignal: signal,
      })

      this.throwIfAborted(signal)
      const content = result.text ?? ''
      this.recordUsage(effectiveModel, prompt, content, estimatedInputTokens, result.usage, 'success', options.type ?? 'generation')
      return content
    } catch (error) {
      this.recordUsage(effectiveModel, prompt, '', estimatedInputTokens, undefined, 'failed', options.type ?? 'generation')
      this.throwIfAborted(signal)
      throw error
    } finally {
      clearTimeout()
    }
  }

  // ============ 流式请求 ============

  async generateTextStream(prompt: string, options: GenerateOptions = {}, onChunk: StreamCallback | null = null): Promise<string> {
    this.assertConfigReady()
    const config = this.getConfig()

    const messages = options.messages
    const hasMessages = Array.isArray(messages) && messages.length > 0

    if (!hasMessages && (!prompt || typeof prompt !== 'string')) {
      throw new Error('无效的prompt参数')
    }

    const cleanPrompt = this.sanitizePrompt(prompt)
    const systemPrompt = options.system ? this.sanitizePrompt(options.system) : undefined
    const promptForEstimate = hasMessages
      ? `${systemPrompt ?? ''}\n${messages!.map((msg) => msg.content).join('\n')}`
      : cleanPrompt
    const estimatedInputTokens = billingService.estimateTokens(promptForEstimate)
    const { maxOutputTokens, temperature } = this.buildRequestBody(config, options, true)
    const { clearTimeout, signal: abortSignal } = this.createTimeoutSignal(options.signal)
    const effectiveModel = options.model?.trim() ? options.model.trim() : config.selectedModel

    let fullContent = ''
    let usage: UsageInfo | undefined
    let streamError: unknown

    try {
      this.throwIfAborted(abortSignal)
      const { streamText } = await loadAISDK()
      const model = await resolveLanguageModel(
        effectiveModel === config.selectedModel ? config : { ...config, selectedModel: effectiveModel },
      )
      this.throwIfAborted(abortSignal)

      const result = streamText({
        model,
        system: systemPrompt,
        ...(hasMessages ? { messages } : { prompt: cleanPrompt }),
        temperature,
        maxOutputTokens,
        abortSignal,
        maxRetries: 2,
        onError: ({ error }) => { streamError = error },
      })

      for await (const chunk of result.textStream) {
        this.throwIfAborted(abortSignal, fullContent)
        fullContent += chunk
        onChunk?.(chunk, fullContent)
      }
      this.throwIfAborted(abortSignal, fullContent)
      // SDK 的 textStream 只包含文本增量；服务端 error 事件需单独处理。
      if (streamError) throw streamError

      // 读取真实用量；中断或无用量时由回退逻辑处理
      try {
        const u = await result.usage
        usage = { inputTokens: u.inputTokens, outputTokens: u.outputTokens }
      } catch {
        usage = undefined
      }
      this.throwIfAborted(abortSignal, fullContent)

      if (!fullContent.trim()) {
        throw new Error('AI返回内容为空')
      }

      this.recordUsage(effectiveModel, promptForEstimate, fullContent, estimatedInputTokens, usage, 'success', options.type ?? 'generation')
      return fullContent
    } catch (error) {
      this.recordUsage(effectiveModel, promptForEstimate, fullContent, estimatedInputTokens, usage, 'failed', options.type ?? 'generation')
      this.throwIfAborted(abortSignal, fullContent)
      throw error
    } finally {
      clearTimeout()
    }
  }

  // ============ 领域方法（提示词构建统一在此） ============

  private buildOutlinePrompt(theme: string, keywords: string, template?: TemplateInfo | null): string {
    const templateInfo = template ? `\n参考模板：${template.name} - ${template.description}` : ''
    const keywordList = keywords ? `\n关键词：${keywords}` : ''

    return `请为以下主题生成一个详细的小说大纲：
主题：${theme}${templateInfo}${keywordList}

要求：
1. 生成5-8个章节
2. 每个章节用 ### 开头，后跟章节标题
3. 每个章节下面写2-3句话描述该章节的主要内容
4. 整体结构要完整，有开头、发展、高潮、结局
5. 符合所选模板的风格特点

请直接输出大纲内容：`
  }

  async generateOutline(theme: string, keywords: string, template?: TemplateInfo | null): Promise<string> {
    return this.generateTextStream(this.buildOutlinePrompt(theme, keywords, template))
  }

  async generateOutlineStream(
    theme: string,
    keywords: string,
    template: TemplateInfo | null | undefined,
    onChunk: StreamCallback | null = null,
  ): Promise<string> {
    return this.generateTextStream(this.buildOutlinePrompt(theme, keywords, template), {}, onChunk)
  }

  private buildChapterPrompt(
    chapterTitle: string,
    chapterOutline: string,
    previousContent: string,
    template?: TemplateInfo | null,
    characters: CharacterInfo[] = [],
    worldSettings: WorldSettingInfo[] = [],
    novelInfo: NovelBasicInfo = {},
  ): string {
    const templateInfo = template ? `\n写作风格：${template.style}\n写作提示：${template.writingTips}` : ''
    const contextInfo = previousContent
      ? `\n前文内容参考：${trimTextFromEnd(previousContent, PREVIOUS_CONTENT_MAX_CHARS)}`
      : ''

    let novelBasicInfo = ''
    if (novelInfo.title || novelInfo.genre || novelInfo.intro || novelInfo.theme) {
      novelBasicInfo += '\n\n小说基本信息：'
      if (novelInfo.title) novelBasicInfo += `\n- 小说名称：${novelInfo.title}`
      if (novelInfo.genre) novelBasicInfo += `\n- 小说类型：${novelInfo.genre}`
      if (novelInfo.theme) novelBasicInfo += `\n- 小说主题：${novelInfo.theme}`
      if (novelInfo.intro) novelBasicInfo += `\n- 小说简介：${novelInfo.intro}`
    }

    let charactersInfo = ''
    if (characters.length > 0) {
      charactersInfo = '\n\n人物设定：'
      for (const char of characters) {
        charactersInfo += `\n- ${char.name}：${char.description}`
        if (char.traits && char.traits.length > 0) {
          charactersInfo += ` (特点：${char.traits.join('、')})`
        }
      }
    }

    let worldInfo = ''
    if (worldSettings.length > 0) {
      worldInfo = '\n\n世界观设定：'
      for (const setting of worldSettings) {
        worldInfo += `\n- ${setting.title}：${setting.description}`
      }
    }

    return `请根据以下信息生成小说章节内容：
章节标题：${chapterTitle}
章节大纲：${chapterOutline}${novelBasicInfo}${templateInfo}${contextInfo}${charactersInfo}${worldInfo}

要求：
1. 字数控制在800-1200字
2. 内容要生动有趣，符合章节大纲
3. 语言流畅，描写细腻
4. 如果有前文内容，要保持连贯性
5. 符合所选模板的风格特点
6. 充分利用提供的人物设定和世界观设定
7. 确保人物行为符合其性格特点
8. 场景描写要符合世界观设定
9. 内容要符合小说的整体类型、主题和设定
10. 保持与小说简介和整体风格的一致性

请直接输出章节内容：`
  }

  async generateChapterContent(
    chapterTitle: string,
    chapterOutline: string,
    previousContent = '',
    template: TemplateInfo | null = null,
    characters: CharacterInfo[] = [],
    worldSettings: WorldSettingInfo[] = [],
    novelInfo: NovelBasicInfo = {},
  ): Promise<string> {
    return this.generateTextStream(
      this.buildChapterPrompt(chapterTitle, chapterOutline, previousContent, template, characters, worldSettings, novelInfo),
    )
  }

  async generateChapterContentStream(
    chapterTitle: string,
    chapterOutline: string,
    previousContent = '',
    template: TemplateInfo | null = null,
    characters: CharacterInfo[] = [],
    worldSettings: WorldSettingInfo[] = [],
    novelInfo: NovelBasicInfo = {},
    onChunk: StreamCallback | null = null,
  ): Promise<string> {
    return this.generateTextStream(
      this.buildChapterPrompt(chapterTitle, chapterOutline, previousContent, template, characters, worldSettings, novelInfo),
      {},
      onChunk,
    )
  }

  async chatWithAI(
    message: string,
    chatHistory: Array<{ isUser: boolean; content: string }> = [],
    system?: string,
  ): Promise<string> {
    const messages: ChatMessage[] = [
      ...chatHistory.map((msg) => ({
        role: (msg.isUser ? 'user' : 'assistant') as ChatMessage['role'],
        content: msg.content,
      })),
      { role: 'user', content: message },
    ]

    return this.generateTextStream('', {
      type: 'chat',
      system:
        system ??
        '你是一个专业的小说写作助手，擅长帮助用户进行创意写作、情节构思、人物塑造等。请用友好、专业的语气回答用户的问题。',
      messages,
    })
  }

  async generateSummary(content: string, options: { length?: string; type?: string } = {}): Promise<string> {
    const { length = 'medium', type = 'keypoints' } = options

    const lengthInstructions: Record<string, string> = {
      short: '请生成50-100字的简短摘要',
      medium: '请生成100-200字的中等长度摘要',
      long: '请生成200-300字的详细摘要',
    }
    const typeInstructions: Record<string, string> = {
      keypoints: '重点提取文章的关键要点和核心内容',
      plot: '重点概括故事情节和主要事件',
      character: '重点分析人物特点和关系',
      theme: '重点阐述文章的主题思想和深层含义',
    }

    const prompt = `${lengthInstructions[length] ?? ''}，${typeInstructions[type] ?? ''}。\n\n文章内容：\n${content}`

    return this.generateTextStream(prompt, { maxTokens: null, temperature: 0.3 })
  }

  async getWritingAdvice(content: string): Promise<string> {
    const prompt = `请对以下文章内容提供写作建议：

${content}

请从以下几个方面给出具体建议：
1. 语言表达
2. 情节结构
3. 人物塑造
4. 描写技巧
5. 整体改进方向

建议：`

    return this.generateTextStream(prompt, { maxTokens: null })
  }

  async generatePersonalizedContent(prompt: string, corpus: Array<{ content: string; title?: string }>): Promise<string> {
    // 按与提示词的关键词重合度选取 top-K 语料，并按预算截断（全文 join 在大语料库下会撑爆上下文与账单）
    const recommendations = recommendCorpus(corpus, prompt, { topK: 8 })
    const injection = buildCorpusInjection(
      recommendations.length > 0 ? recommendations.map((rec) => rec.item) : corpus,
      CORPUS_INJECTION_MAX_CHARS,
    )
    if (injection.text.trim() === '') {
      throw new Error('语料库内容为空，请先添加语料内容')
    }

    const personalizedPrompt = `参考以下写作风格和内容：

${injection.text}

现在请根据上述风格，生成以下内容：
${prompt}

要求：
1. 保持与参考内容相似的写作风格
2. 语言表达要一致
3. 内容要原创且符合要求

生成内容：`

    return this.generateTextStream(personalizedPrompt)
  }

  private buildGeneralPrompt(keywords: string, template?: TemplateInfo | null, outline?: string | null, wordLimit = 500): string {
    const templateInfo = template ? `\n写作风格：${template.style}\n写作提示：${template.writingTips}` : ''
    const outlineInfo = outline ? `\n参考大纲：${outline}` : ''
    const keywordList = keywords ? `\n关键词：${keywords}` : ''

    return `请根据以下信息生成小说内容：${keywordList}${templateInfo}${outlineInfo}

要求：
1. 字数控制在${wordLimit}字左右
2. 内容要生动有趣，情节引人入胜
3. 语言流畅，描写细腻
4. 符合所选模板的风格特点
5. 如果有大纲，要与大纲保持一致

请直接输出小说内容：`
  }

  async generateGeneralContent(
    keywords: string,
    template?: TemplateInfo | null,
    outline?: string | null,
    wordLimit = 500,
  ): Promise<string> {
    return this.generateTextStream(this.buildGeneralPrompt(keywords, template, outline, wordLimit))
  }

  async generateGeneralContentStream(
    keywords: string,
    template: TemplateInfo | null | undefined,
    outline: string | null | undefined,
    wordLimit = 500,
    onChunk: StreamCallback | null = null,
  ): Promise<string> {
    return this.generateTextStream(this.buildGeneralPrompt(keywords, template, outline, wordLimit), {}, onChunk)
  }

  async generateCharacter(theme: string, characterType = ''): Promise<Record<string, unknown>> {
    const typeInfo = characterType ? `角色类型：${characterType}` : ''
    const prompt = `请根据主题"${theme}"生成一个小说人物，${typeInfo}

要求：
1. 提供人物的基本信息（姓名、年龄、职业等）
2. 详细的外貌描述
3. 性格特点和行为习惯
4. 背景故事和经历
5. 人物的特殊技能或能力
6. 与主题相关的特征

请以JSON格式返回：
{
  "name": "人物姓名",
  "age": "年龄",
  "occupation": "职业",
  "appearance": "外貌描述",
  "personality": "性格特点",
  "background": "背景故事",
  "skills": ["技能1", "技能2"],
  "traits": ["特征1", "特征2", "特征3"]
}`

    const response = await this.generateTextStream(prompt)
    return JSON.parse(response)
  }

  async generateWorldSetting(theme: string, settingType = ''): Promise<Record<string, unknown>> {
    const typeInfo = settingType ? `设定类型：${settingType}` : ''
    const prompt = `请根据主题"${theme}"生成一个小说世界观设定，${typeInfo}

要求：
1. 设定的名称和概述
2. 详细的背景描述
3. 重要的规则或法则
4. 地理环境或空间结构
5. 历史背景或重要事件
6. 与主题相关的特色元素

请以JSON格式返回：
{
  "title": "设定名称",
  "overview": "概述",
  "description": "详细描述",
  "rules": ["规则1", "规则2"],
  "geography": "地理环境",
  "history": "历史背景",
  "features": ["特色1", "特色2"]
}`

    const response = await this.generateTextStream(prompt)
    return JSON.parse(response)
  }

  async analyzeArticle(content: string): Promise<Record<string, unknown>> {
    const prompt = `请对以下文章进行深度分析，并以JSON格式返回分析结果：

文章内容：
${content}

请分析以下方面：
1. 情感倾向（积极/消极/中性）
2. 文章标签（最多5个关键标签）
3. 文章分类（玄幻/都市/悬疑/科幻/历史/校园/武侠/其他）
4. 文章评分（0-100分，考虑文笔、情节、结构等）
5. 详细评价（包括优点、缺点、改进建议）

返回格式：
{
  "sentiment": "积极/消极/中性",
  "tags": ["标签1", "标签2", "标签3"],
  "category": "分类",
  "score": 85,
  "evaluation": {
    "strengths": ["优点1", "优点2"],
    "weaknesses": ["缺点1", "缺点2"],
    "suggestions": ["建议1", "建议2"]
  },
  "summary": "整体评价总结"
}`

    const { generateText } = await loadAISDK()
    const config = this.getConfig()
    const model = await resolveLanguageModel(config)

    const result = await generateText({
      model,
      system: '你是一位专业的文学评论家和编辑，擅长分析各种类型的文章。请客观、专业地分析文章，给出建设性的评价和建议。',
      prompt,
      maxOutputTokens: 1000,
      temperature: 0.3,
    })

    const analysisText = result.text?.trim()
    if (!analysisText) {
      throw new Error('AI响应格式错误')
    }

    try {
      return JSON.parse(analysisText) as Record<string, unknown>
    } catch (parseError) {
      console.error('解析AI分析结果失败:', parseError)
      return {
        sentiment: '中性',
        tags: ['AI分析'],
        category: '其他',
        score: 70,
        evaluation: {
          strengths: ['内容完整'],
          weaknesses: ['AI分析解析失败'],
          suggestions: ['请检查内容格式'],
        },
        summary: 'AI分析暂时不可用，使用基础分析结果',
      }
    }
  }

  async validateAPIKey(): Promise<boolean> {
    try {
      const config = this.getConfig()
      const probe = buildModelsProbe(config)
      const response = await fetch(probe.url, {
        method: 'GET',
        headers: probe.headers,
      })
      return response.ok
    } catch (error) {
      console.error('API密钥验证失败:', error)
      return false
    }
  }
}

export default new APIService()
