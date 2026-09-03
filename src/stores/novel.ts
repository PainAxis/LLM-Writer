import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import apiService from '@/services/api'
import { useApiConfig } from '@/services/apiConfig'
import { generateUniqueId } from '@/utils/id'
import type { ApiConfig, NovelBasicInfo, StreamCallback, TemplateInfo } from '@/types/api'

export interface NovelChapter {
  id: number
  title: string
  content: string
  generatedText: string
  isCompleted: boolean
}

export interface ChatEntry {
  id: number
  content: string
  isUser: boolean
  timestamp: string
}

export interface CorpusItem {
  id: number
  content: string
  createdAt: string
}

export interface Character {
  id: number
  name: string
  description: string
  traits: string[]
  [key: string]: unknown
}

export interface WorldSetting {
  id: number
  title: string
  description: string
  [key: string]: unknown
}

export interface ArticleStats {
  wordCount: number
  readingTime: number
  sentiment: string
  tags: string[]
  category: string
  score: number
  aiAnalysis?: Record<string, unknown>
}

export const useNovelStore = defineStore('novel', () => {
  // ---------- 状态 ----------
  const currentNovel = ref('')
  const generatedContent = ref('')
  const outline = ref('')
  const isGeneratingOutline = ref(false)
  const chapters = ref<NovelChapter[]>([])
  const selectedChapter = ref<NovelChapter | null>(null)
  const isGeneratingChapter = ref(false)
  const aiChatHistory = ref<ChatEntry[]>([])
  const currentChatInput = ref('')
  const isAiChatting = ref(false)
  const templates = ref<TemplateInfo[]>([])
  const selectedTemplate = ref<TemplateInfo | null>(null)
  const keywords = ref('')
  const isGenerating = ref(false)
  const corpus = ref<CorpusItem[]>([])
  const characters = ref<Character[]>([])
  const worldSettings = ref<WorldSetting[]>([])

  // ---------- API 配置（委托给 apiConfig 模块统一管理） ----------
  const { activeConfig, isApiConfigured, updateConfig } = useApiConfig()

  const getCurrentApiConfig = () => activeConfig.value

  const updateApiConfig = (config: Partial<ApiConfig>) => {
    updateConfig(config)
  }

  const validateApiKey = async () => {
    try {
      const isValid = await apiService.validateAPIKey()
      return isValid
    } catch (error) {
      console.error('API密钥验证失败:', error)
      return false
    }
  }

  // ---------- 摘要与建议 ----------
  const articleSummary = ref('')
  const isGeneratingSummary = ref(false)
  const writingAdvice = ref('')
  const isGeneratingAdvice = ref(false)

  const articleStats = ref<ArticleStats>({
    wordCount: 0,
    readingTime: 0,
    sentiment: '',
    tags: [],
    category: '',
    score: 0,
  })

  // ---------- 计算属性 ----------
  const wordCount = computed(() => currentNovel.value.replace(/<[^>]*>/g, '').length)

  const readingTime = computed(() => Math.ceil(wordCount.value / 200))

  // ---------- 基础操作 ----------
  const setCurrentNovel = async (content: string) => {
    currentNovel.value = content
    await updateStats()
  }

  const setGeneratedContent = (content: string) => {
    generatedContent.value = content
  }

  const addToNovel = async () => {
    if (generatedContent.value) {
      if (!currentNovel.value || currentNovel.value === '<p><br></p>') {
        currentNovel.value = `<p>${generatedContent.value}</p>`
      } else {
        currentNovel.value += `<p><br></p><p>${generatedContent.value}</p>`
      }
      await updateStats()
    }
  }

  const clearNovel = async () => {
    currentNovel.value = ''
    await updateStats()
  }

  const setOutline = (content: string) => {
    outline.value = content
  }

  const setGeneratingOutline = (status: boolean) => {
    isGeneratingOutline.value = status
  }

  const clearOutline = () => {
    outline.value = ''
    chapters.value = []
  }

  // ---------- 章节管理 ----------
  const parseOutlineToChapters = () => {
    const outlineText = outline.value
    const chapterRegex = /###\s*(.+?)\n([\s\S]*?)(?=###|$)/g
    const newChapters: NovelChapter[] = []
    let match: RegExpExecArray | null
    let index = 1

    while ((match = chapterRegex.exec(outlineText)) !== null) {
      newChapters.push({
        id: index++,
        title: match[1].trim(),
        content: match[2].trim(),
        generatedText: '',
        isCompleted: false,
      })
    }

    chapters.value = newChapters
  }

  const setSelectedChapter = (chapter: NovelChapter | null) => {
    selectedChapter.value = chapter
  }

  const updateChapterContent = (chapterId: number, content: string) => {
    const chapter = chapters.value.find((c) => c.id === chapterId)
    if (chapter) {
      chapter.content = content
    }
  }

  const setChapterGenerated = (chapterId: number, text: string) => {
    const chapter = chapters.value.find((c) => c.id === chapterId)
    if (chapter) {
      chapter.generatedText = text
      chapter.isCompleted = true
    }
  }

  const setGeneratingChapter = (status: boolean) => {
    isGeneratingChapter.value = status
  }

  // ---------- AI 对话 ----------
  const addChatMessage = (message: string, isUser = true) => {
    aiChatHistory.value.push({
      id: generateUniqueId(),
      content: message,
      isUser,
      timestamp: new Date().toLocaleTimeString(),
    })
  }

  const setChatInput = (input: string) => {
    currentChatInput.value = input
  }

  const setAiChatting = (status: boolean) => {
    isAiChatting.value = status
  }

  const clearChatHistory = () => {
    aiChatHistory.value = []
  }

  const setTemplate = (template: TemplateInfo | null) => {
    selectedTemplate.value = template
  }

  const setKeywords = (kw: string) => {
    keywords.value = kw
  }

  const setGenerating = (status: boolean) => {
    isGenerating.value = status
  }

  // ---------- 语料库 ----------
  const addCorpus = (text: string) => {
    corpus.value.push({
      id: generateUniqueId(),
      content: text,
      createdAt: new Date().toISOString(),
    })
  }

  const removeCorpus = (id: number) => {
    const index = corpus.value.findIndex((item) => item.id === id)
    if (index > -1) {
      corpus.value.splice(index, 1)
    }
  }

  const addCorpusFromFile = async (file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        addCorpus(content)
        resolve(content)
      }
      reader.onerror = reject
      reader.readAsText(file)
    })
  }

  const exportCorpus = () => {
    const data = JSON.stringify(corpus.value, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'corpus.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const importCorpus = async (file: File) => {
    return new Promise<CorpusItem[]>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string) as CorpusItem[]
          corpus.value = data
          resolve(data)
        } catch {
          reject(new Error('语料库文件格式错误'))
        }
      }
      reader.onerror = reject
      reader.readAsText(file)
    })
  }

  // ---------- 本地文本分析 ----------
  const analyzeSentiment = (content: string): string => {
    const positiveWords = ['快乐', '幸福', '美好', '成功', '胜利', '爱', '喜欢']
    const negativeWords = ['悲伤', '痛苦', '失败', '死亡', '恐惧', '愤怒', '绝望']

    let positiveCount = 0
    let negativeCount = 0

    for (const word of positiveWords) {
      positiveCount += (content.match(new RegExp(word, 'g')) ?? []).length
    }
    for (const word of negativeWords) {
      negativeCount += (content.match(new RegExp(word, 'g')) ?? []).length
    }

    if (positiveCount > negativeCount) return '积极'
    if (negativeCount > positiveCount) return '消极'
    return '中性'
  }

  const generateTags = (content: string): string[] => {
    const tags: string[] = []
    if (content.includes('修仙') || content.includes('仙人')) tags.push('修仙')
    if (content.includes('爱情') || content.includes('恋人')) tags.push('爱情')
    if (content.includes('悬疑') || content.includes('推理')) tags.push('悬疑')
    if (content.includes('科幻') || content.includes('未来')) tags.push('科幻')
    if (content.includes('古代') || content.includes('穿越')) tags.push('古代')
    return tags
  }

  const categorizeContent = (content: string): string => {
    if (content.includes('修仙') || content.includes('异世界')) return '玄幻'
    if (content.includes('都市') || content.includes('现代')) return '都市'
    if (content.includes('悬疑') || content.includes('推理')) return '悬疑'
    if (content.includes('科幻') || content.includes('未来')) return '科幻'
    if (content.includes('古代') || content.includes('历史')) return '历史'
    return '其他'
  }

  const calculateScore = (content: string): number => {
    let score = 50

    if (content.length > 1000) score += 10
    if (content.length > 3000) score += 10
    if (content.length > 5000) score += 10

    const paragraphs = content.split('\n\n').filter((p) => p.trim())
    if (paragraphs.length > 3) score += 5
    if (paragraphs.length > 6) score += 5

    const dialogues = (content.match(/[""]/g) ?? []).length
    if (dialogues > 4) score += 5

    return Math.min(100, score)
  }

  const updateStats = async () => {
    const content = currentNovel.value.replace(/<[^>]*>/g, '')

    articleStats.value = {
      wordCount: content.length,
      readingTime: Math.ceil(content.length / 200),
      sentiment: analyzeSentiment(content),
      tags: generateTags(content),
      category: categorizeContent(content),
      score: calculateScore(content),
    }

    if (isApiConfigured.value && content.length > 100) {
      try {
        await updateStatsWithAI(content)
      } catch (error) {
        console.log('AI分析失败，使用本地分析结果:', (error as Error).message)
      }
    }
  }

  const updateStatsWithAI = async (content: string) => {
    try {
      const analysis = await apiService.analyzeArticle(content)
      articleStats.value = {
        ...articleStats.value,
        sentiment: (analysis.sentiment as string) || articleStats.value.sentiment,
        tags: (analysis.tags as string[]) || articleStats.value.tags,
        category: (analysis.category as string) || articleStats.value.category,
        score: (analysis.score as number) || articleStats.value.score,
        aiAnalysis: analysis,
      }
    } catch (error) {
      console.error('AI文章分析失败:', error)
      throw error
    }
  }

  // ---------- 人物 / 世界观 ----------
  const addCharacter = (
    character: { name: string; description: string; traits?: string[]; traitsInput?: string; [key: string]: unknown },
  ) => {
    const { traitsInput, ...rest } = character
    characters.value.push({
      id: generateUniqueId(),
      ...rest,
      traits: traitsInput
        ? traitsInput.split(',').map((t) => t.trim()).filter(Boolean)
        : character.traits ?? [],
    })
  }

  const removeCharacter = (id: number) => {
    characters.value = characters.value.filter((char) => char.id !== id)
  }

  const addWorldSetting = (setting: { title: string; description: string; [key: string]: unknown }) => {
    worldSettings.value.push({
      id: generateUniqueId(),
      ...setting,
    })
  }

  const removeWorldSetting = (id: number) => {
    worldSettings.value = worldSettings.value.filter((setting) => setting.id !== id)
  }

  const updateWorldSetting = (id: number, updatedSetting: Partial<WorldSetting>) => {
    const index = worldSettings.value.findIndex((setting) => setting.id === id)
    if (index > -1) {
      worldSettings.value[index] = { ...worldSettings.value[index], ...updatedSetting }
    }
  }

  // ---------- AI 生成 ----------
  const assertApiConfigured = () => {
    if (!isApiConfigured.value) {
      throw new Error('请先配置API密钥')
    }
  }

  const generateOutlineWithAPI = async (theme: string) => {
    assertApiConfigured()
    setGeneratingOutline(true)
    try {
      const result = await apiService.generateOutline(theme, keywords.value, selectedTemplate.value)
      setOutline(result)
      parseOutlineToChapters()
      return result
    } catch (error) {
      console.error('生成大纲失败:', error)
      throw error
    } finally {
      setGeneratingOutline(false)
    }
  }

  const generateOutlineWithAPIStream = async (theme: string, onChunk: StreamCallback | null = null) => {
    assertApiConfigured()
    setGeneratingOutline(true)
    setOutline('')

    try {
      const result = await apiService.generateOutlineStream(theme, keywords.value, selectedTemplate.value, (chunk, fullContent) => {
        setOutline(fullContent)
        onChunk?.(chunk, fullContent)
      })
      parseOutlineToChapters()
      return result
    } catch (error) {
      console.error('生成大纲失败:', error)
      throw error
    } finally {
      setGeneratingOutline(false)
    }
  }

  const generateChapterWithAPI = async (chapter: NovelChapter, novelInfo: NovelBasicInfo | null = null) => {
    assertApiConfigured()
    setGeneratingChapter(true)
    try {
      const previousContent = currentNovel.value.replace(/<[^>]*>/g, '')
      const result = await apiService.generateChapterContent(
        chapter.title,
        chapter.content,
        previousContent,
        selectedTemplate.value,
        characters.value,
        worldSettings.value,
        novelInfo ?? {},
      )
      setChapterGenerated(chapter.id, result)
      setGeneratedContent(result)
      return result
    } catch (error) {
      console.error('生成章节内容失败:', error)
      throw error
    } finally {
      setGeneratingChapter(false)
    }
  }

  const sendChatMessageWithAPI = async (message: string) => {
    assertApiConfigured()
    setAiChatting(true)

    try {
      const response = await apiService.chatWithAI(message, aiChatHistory.value)
      addChatMessage(response, false)
      return response
    } catch (error) {
      console.error('AI对话失败:', error)
      addChatMessage('抱歉，AI暂时无法回应，请稍后再试。', false)
      throw error
    } finally {
      setAiChatting(false)
    }
  }

  const setGeneratingSummary = (status: boolean) => {
    isGeneratingSummary.value = status
  }

  const setArticleSummary = (summary: string) => {
    articleSummary.value = summary
  }

  const generateSummaryWithAPI = async (options: { length?: string; type?: string } = {}) => {
    assertApiConfigured()

    if (!currentNovel.value) {
      throw new Error('请先输入文章内容')
    }

    isGeneratingSummary.value = true
    try {
      const content = currentNovel.value.replace(/<[^>]*>/g, '')
      const summary = await apiService.generateSummary(content, options)
      articleSummary.value = summary
      return summary
    } catch (error) {
      console.error('生成摘要失败:', error)
      throw error
    } finally {
      isGeneratingSummary.value = false
    }
  }

  const getWritingAdviceWithAPI = async () => {
    assertApiConfigured()

    if (!currentNovel.value) {
      throw new Error('请先输入文章内容')
    }

    isGeneratingAdvice.value = true
    try {
      const content = currentNovel.value.replace(/<[^>]*>/g, '')
      const advice = await apiService.getWritingAdvice(content)
      writingAdvice.value = advice
      return advice
    } catch (error) {
      console.error('获取写作建议失败:', error)
      throw error
    } finally {
      isGeneratingAdvice.value = false
    }
  }

  const generatePersonalizedContent = async (prompt: string) => {
    assertApiConfigured()

    if (corpus.value.length === 0) {
      throw new Error('请先添加语料库内容')
    }

    setGenerating(true)
    try {
      const result = await apiService.generatePersonalizedContent(prompt, corpus.value)
      setGeneratedContent(result)
      return result
    } catch (error) {
      console.error('生成个性化内容失败:', error)
      throw error
    } finally {
      setGenerating(false)
    }
  }

  const generateContentWithAPI = async (keywords: string, template: TemplateInfo | null, outline: string, wordLimit: number) => {
    assertApiConfigured()

    try {
      const result = await apiService.generateGeneralContent(keywords, template, outline, wordLimit)
      setGeneratedContent(result)
      return result
    } catch (error) {
      console.error('生成内容失败:', error)
      throw error
    }
  }

  const generateContentWithAPIStream = async (
    keywords: string,
    template: TemplateInfo | null,
    outline: string,
    wordLimit: number,
    onChunk: StreamCallback | null = null,
  ) => {
    assertApiConfigured()

    setGenerating(true)
    setGeneratedContent('')

    try {
      const result = await apiService.generateGeneralContentStream(keywords, template, outline, wordLimit, (chunk, fullContent) => {
        setGeneratedContent(fullContent)
        onChunk?.(chunk, fullContent)
      })
      return result
    } catch (error) {
      console.error('生成内容失败:', error)
      throw error
    } finally {
      setGenerating(false)
    }
  }

  const generateContent = async (prompt: string, onChunk: ((chunk: string) => void) | null = null) => {
    assertApiConfigured()

    try {
      isGenerating.value = true
      const result = await apiService.generateTextStream(
        prompt,
        { type: 'content_generation' },
        onChunk ? (chunk) => onChunk(chunk) : null,
      )
      return result
    } catch (error) {
      console.error('生成内容失败:', error)
      throw error
    } finally {
      isGenerating.value = false
    }
  }

  return {
    // 状态
    currentNovel,
    generatedContent,
    outline,
    isGeneratingOutline,
    chapters,
    selectedChapter,
    isGeneratingChapter,
    aiChatHistory,
    currentChatInput,
    isAiChatting,
    templates,
    selectedTemplate,
    keywords,
    isGenerating,
    corpus,
    characters,
    worldSettings,
    articleStats,
    isApiConfigured,
    articleSummary,
    isGeneratingSummary,
    writingAdvice,
    isGeneratingAdvice,

    // 计算属性
    wordCount,
    readingTime,

    // 方法
    setCurrentNovel,
    setGeneratedContent,
    addToNovel,
    clearNovel,
    setOutline,
    setGeneratingOutline,
    clearOutline,
    parseOutlineToChapters,
    setSelectedChapter,
    updateChapterContent,
    setChapterGenerated,
    setGeneratingChapter,
    addChatMessage,
    setChatInput,
    setAiChatting,
    clearChatHistory,
    setTemplate,
    setKeywords,
    setGenerating,
    addCorpus,
    removeCorpus,
    addCharacter,
    removeCharacter,
    addWorldSetting,
    removeWorldSetting,
    updateWorldSetting,
    updateStats,

    // API 相关方法
    updateApiConfig,
    getCurrentApiConfig,
    validateApiKey,
    generateOutlineWithAPI,
    generateOutlineWithAPIStream,
    generateChapterWithAPI,
    sendChatMessageWithAPI,
    generateSummaryWithAPI,
    getWritingAdviceWithAPI,
    generatePersonalizedContent,
    generateContentWithAPI,
    generateContentWithAPIStream,
    addCorpusFromFile,
    exportCorpus,
    importCorpus,
    setGeneratingSummary,
    setArticleSummary,
    generateContent,
  }
})
