import { useBookChapterViewer } from './useBookChapterViewer'
import type { InputInstance } from 'element-plus'
import type { BookChapter, BookAnalysisData, BookAnalysisTemplate } from '@/types/bookAnalysis'
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAIStream } from '@/composables/useAIStream'
import { useGenerationTask } from '@/composables/useGenerationTask'
import { storageGetRaw, storageSetRaw, StorageKeys } from '@/utils/storage'
import { promptCatalog } from '@/services/promptCatalog'
import { splitBookLocally } from '@/utils/bookImport'
import { useBookAnalysisFile } from '@/composables/useBookAnalysisFile'
import { useBookAnalysisLibraryWorkspace } from '@/composables/useBookAnalysisLibraryWorkspace'
import {
  detectBookChapters,
  prepareBookAnalysisSelection,
  prepareBookAnalysis,
  buildBookAnalysisPrompt,
} from '@/utils/bookAnalysisContext'

/** Typed orchestration for the BookAnalysis view. */
export function useBookAnalysisWorkspace() {
  // 响应式数据
  const fileWorkspace = useBookAnalysisFile({
    isBusy: () => analyzing.value || generatingSummary.value || savingLibraryReport.value,
    onImported: (content) => {
      resetBookAnalysis()
      analysisStartWords.value = 1
      analysisEndWords.value = Math.min(5000, content.length)
      detectedChapters.value = detectBookChapters(content)
    },
    onRemoved: () => resetBookAnalysis(),
    notify: { success: ElMessage.success, error: ElMessage.error },
  })

  const {
    uploadedFile,
    bookContent,
    selectedEncoding,
    importingFile,
    isDocx,
    fileFormatLabel,
    handleFileChange,
    handleFileExceed,
    rereadWithEncoding,
    removeFile,
  } = fileWorkspace

  const selectedTemplate = ref<string | number>('')

  const selectedChapters = ref<number[]>([])

  const analysisStartWords = ref(1)

  const analysisEndWords = ref(5000)

  const analysisProgress = ref(0)

  const analysisStatus = ref('')

  const analysisResult = ref<string | null>(null)

  const libraryWorkspace = useBookAnalysisLibraryWorkspace({
    content: analysisResult,
    sourceFileName: () => uploadedFile.value?.name ?? '',
    isBusy: () => analyzing.value || generatingSummary.value || importingFile.value,
    onOpen: report => {
      analysisTask.stop()
      summaryTask.stop()
      analysisResult.value = report.content
      analysisProgress.value = 100
      analysisStatus.value = '已打开参考库报告'
    },
    confirmDelete: report => ElMessageBox.confirm(`确定要删除「${report.title}」吗？当前编辑区的内容会保留。`, '删除参考报告', { type: 'warning' }),
    notify: { success: ElMessage.success, warning: ElMessage.warning, error: ElMessage.error },
  })
  const { savingLibraryReport, resetLibraryReport } = libraryWorkspace

  const analysisTime = ref('')

  // 分析编辑器引用
  const analysisEditorRef = ref<InputInstance | null>(null)

  // 章节检测相关
  const detectedChapters = ref<BookChapter[]>([])

  const autoDetectedChapters = ref<BookChapter[]>([])

  const analysisScope = computed(() => {
    try {
      return {
        selection: prepareBookAnalysisSelection({
          content: bookContent.value,
          chapters: detectedChapters.value,
          selectedChapters: selectedChapters.value,
          start: analysisStartWords.value,
          end: analysisEndWords.value,
        }),
        error: '',
      }
    } catch (error) {
      return { selection: null, error: error instanceof Error ? error.message : '请选择有效的分析范围' }
    }
  })
  const analysisScopeError = computed(() => analysisScope.value.error)
  const analysisScopeDescription = computed(() => {
    const { selection, error } = analysisScope.value
    if (!selection) return error
    return selection.chapterInfos.length
      ? `将分析所选的 ${selection.chapterInfos.length} 个章节，共 ${selection.textToAnalyze.length.toLocaleString()} 字`
      : `${selection.analysisInfo}，共 ${selection.textToAnalyze.length.toLocaleString()} 字`
  })

  const { showChapterDetails, showChapterContent, selectedViewChapter, currentViewChapter, currentChapterContent, selectedDetailChapter, currentDetailChapter, currentDetailChapterContent, activeDetailTab, openChapterViewer, closeChapterContent, loadChapterContent, copyChapterContent, exportChapterContent, selectDetailChapter, copyDetailChapterContent, exportDetailChapterContent, exportAllChapterSummary, exportAllChapterContent, openChapterDetailsViewer } = useBookChapterViewer({ bookContent, detectedChapters, autoDetectedChapters })

  // 章节简读提示词
  const summaryPromptTemplate =
    ref(`You are a professional Chinese fiction editor. Write the summary in natural, idiomatic Simplified Chinese.

Task: Write a concise chapter digest (章节简读) for the chapter below.

Requirements:
1. Summarize the chapter's main events and content — concrete, not vague.
2. Name the key characters and what they do or decide.
3. State this chapter's role in the overall story (setup, escalation, reversal, payoff...).
4. Length: at most 100 Chinese characters. One or two sentences, dense with information.
5. Output the digest text only — no title, no preamble, no bullet points.

章节标题：{章节标题}
章节字数：{章节字数}字

章节内容：
{章节内容}

请生成章节简读：`)

  const showPromptEditor = ref(false)

  const showPromptPreview = ref(false)

  const fullPromptPreview = ref('')

  // 分析步骤
  const _analysisSteps = ['文本预处理', '结构分析', '人物识别', '技法提取', '生成报告']

  // 拆书模板（从提示词库获取）
  const analysisTemplates = computed<Array<BookAnalysisTemplate & { icon: string }>>(() =>
    promptCatalog.prompts.value.filter(prompt => prompt.category === 'book-analysis').map(prompt => ({
      id: prompt.id, name: prompt.title, icon: '📚', description: prompt.description, content: prompt.content,
    })))

  const loadAnalysisTemplates = async () => {
    try {
      await promptCatalog.load()
    } catch (error) {
      ElMessage.error(`加载拆书模板失败：${error instanceof Error ? error.message : String(error)}，请重试`)
    }
  }

  // 计算属性
  const estimatedChapters = computed(() => {
    if (!bookContent.value) return 0
    return Math.ceil(bookContent.value.length / 3000)
  })

  const displayContent = computed({
    get() {
      // 如果有分析结果，优先显示分析结果（包括流式输出过程中）
      if (analysisResult.value !== null) return analysisResult.value
      // 如果正在分析但还没有结果，显示空内容
      if (analyzing.value) return ''
      // 如果有书籍内容，显示书籍内容
      if (bookContent.value) return bookContent.value
      return ''
    },
    set(value) {
      if (!analyzing.value) {
        analysisResult.value = value
      }
    },
  })

  const getPlaceholder = () => {
    if (analysisResult.value !== null) return '编辑分析结果...'
    if (!bookContent.value) return '请先上传小说文件...'
    if (analysisResult.value === null && !analyzing.value) return '小说完整内容预览'
    if (analyzing.value) return '正在进行AI流式分析，内容将实时显示...'
    return '编辑分析结果...'
  }

  // 方法
  const resetBookAnalysis = () => {
    analysisTask.stop()
    summaryTask.stop()
    analysisResult.value = null
    resetLibraryReport()
    detectedChapters.value = []
    selectedChapters.value = []
    autoDetectedChapters.value = []
    showChapterDetails.value = false
    showChapterContent.value = false
    selectedViewChapter.value = null
    currentViewChapter.value = null
    currentChapterContent.value = ''
    selectedDetailChapter.value = null
    currentDetailChapter.value = null
    currentDetailChapterContent.value = ''
  }

  onBeforeUnmount(fileWorkspace.dispose)

  // 章节选择相关方法
  const selectAllChapters = () => {
    selectedChapters.value = detectedChapters.value.map((chapter) => chapter.index)
  }

  const clearChapterSelection = () => {
    selectedChapters.value = []
  }

  // 对没有章节标题的文本执行本地启发式分章。
  const startLocalChapterDetection = () => {
    const chapters = splitBookLocally(bookContent.value)
    autoDetectedChapters.value = chapters
    detectedChapters.value = chapters
    selectedChapters.value = []
    ElMessage.success(`本地分章完成！共 ${chapters.length} 个章节`)
  }

  const analysisTask = useGenerationTask({
    stream: useAIStream(),
    source: () => [
      bookContent.value,
      selectedTemplate.value,
      [...selectedChapters.value],
      analysisStartWords.value,
      analysisEndWords.value,
    ],
  })

  const summaryTask = useGenerationTask({
    stream: useAIStream(),
    source: () => [
      bookContent.value,
      showChapterDetails.value,
      currentDetailChapter.value?.index,
      currentDetailChapterContent.value,
      summaryPromptTemplate.value,
    ],
  })

  const analyzing = analysisTask.running

  const generatingSummary = summaryTask.running

  onBeforeUnmount(() => {
    analysisTask.dispose()
    summaryTask.dispose()
  })

  const stopAnalysis = () => {
    analysisTask.stop()
    analysisStatus.value = '分析已停止'
  }

  const startAnalysis = async () => {
    if (importingFile.value || analyzing.value || savingLibraryReport.value) return
    if (!selectedTemplate.value) {
      ElMessage.error('请选择分析模板')
      return
    }
    if (analysisScopeError.value) {
      ElMessage.warning(analysisScopeError.value)
      return
    }
    try {
      const data = prepareAnalysisData()
      const header = buildReportHeader(data)
      resetLibraryReport()
      analysisResult.value = header
      analysisProgress.value = 40
      analysisStatus.value = 'AI深度分析中...'
      await analysisTask.start({
        prompt: buildBookAnalysisPrompt(data),
        options: { type: 'content_generation' },
        onText: (text, isCurrent) => {
          analysisResult.value = header + text
          analysisProgress.value = 40 + Math.min(55, (text.length / 3000) * 55)
          analysisStatus.value = `AI分析中... (已生成${text.length}字)`
          scrollToBottom(isCurrent)
        },
        onSuccess: (text, isCurrent) => {
          analysisResult.value = header + text + buildReportFooter(data)
          analysisProgress.value = 100
          analysisStatus.value = '分析完成'
          analysisTime.value = new Date().toLocaleString()
          scrollToBottom(isCurrent)
          ElMessage.success('拆书分析完成！结果已生成，您可以编辑和导出。')
        },
        onError: (error) => {
          analysisStatus.value = '分析失败'
          ElMessage.error(`分析失败: ${error instanceof Error ? error.message : String(error)}`)
        },
      })
    } catch (error) {
      ElMessage.error(`分析失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // 准备分析数据
  const prepareAnalysisData = () =>
    prepareBookAnalysis({
      content: bookContent.value,
      selectedChapters: selectedChapters.value,
      chapters: detectedChapters.value,
      start: analysisStartWords.value,
      end: analysisEndWords.value,
      templates: analysisTemplates.value,
      templateId: selectedTemplate.value,
      fileName: uploadedFile.value?.name || '未知文件',
      encoding: fileFormatLabel.value,
    })

  const buildReportHeader = (data: BookAnalysisData) => {
    const {
      textToAnalyze,
      analysisInfo,
      chapterInfos,
      template,
      totalWordCount,
      fileName,
      encoding,
    } = data
    return `《${template.name}报告》

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 分析信息
• 分析时间：${new Date().toLocaleString()}
• 分析模板：${template.name}
• 文件名称：${fileName}
• 文件编码：${encoding.toUpperCase()}
• 总字数：${totalWordCount.toLocaleString()}字
• ${analysisInfo}
• 分析字数：${textToAnalyze.length.toLocaleString()}字

${
  chapterInfos.length > 0
    ? `
📖 章节概况
${chapterInfos
  .map(
    (chapter, index) => `${index + 1}. ${chapter.title} (${chapter.wordCount}字)
   简读：${chapter.summary}`
  )
  .join('\n')}
`
    : ''
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`
  }

  const buildReportFooter = ({ template, encoding }: BookAnalysisData) => {
    return `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 分析完成！
• 本报告由AI基于《${template.name}》模板生成
• 内容完全可编辑修改，您可以根据实际需要调整分析结果
• 建议将优质分析结果保存到拆书参考库以供后续学习参考

🔧 技术信息
• API调用时间：${new Date().toISOString()}
• 使用编码：${encoding.toUpperCase()}
• 处理状态：成功`
  }

  const _getTemplateName = () => {
    const template = analysisTemplates.value.find((t) => t.id == selectedTemplate.value)
    return template ? template.name : ''
  }

  // 自动滚动到文本框底部
  const scrollToBottom = (isCurrent = () => true) => {
    nextTick(() => {
      if (!isCurrent()) return
      if (analysisEditorRef.value) {
        const textarea = analysisEditorRef.value.textarea
        if (textarea) {
          textarea.scrollTop = textarea.scrollHeight
        }
      }
    })
  }

  const exportResults = () => {
    // 导出文本格式的分析结果
    const content = analysisResult.value || ''
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `拆书分析结果_${new Date().getTime()}.txt`
    link.click()
    URL.revokeObjectURL(url)
    ElMessage.success('分析结果已导出！')
  }

  // 章节内容查看相关方法
  // 获取预览提示词（截取前200字）
  const getPreviewPrompt = () => {
    if (!summaryPromptTemplate.value) return '暂无提示词'

    const previewText =
      summaryPromptTemplate.value.length > 200
        ? summaryPromptTemplate.value.substring(0, 200) + '...'
        : summaryPromptTemplate.value

    return previewText
  }

  // 构建完整的AI提示词
  const buildFullPrompt = () => {
    if (!currentDetailChapter.value || !currentDetailChapterContent.value) {
      return summaryPromptTemplate.value
    }

    return summaryPromptTemplate.value
      .replace(/{章节标题}/g, currentDetailChapter.value.title)
      .replace(/{章节字数}/g, currentDetailChapter.value.wordCount.toString())
      .replace(/{章节内容}/g, currentDetailChapterContent.value)
  }

  // AI生成章节简读
  const generateChapterSummaryWithAI = async () => {
    if (importingFile.value || generatingSummary.value) return
    const chapter = currentDetailChapter.value
    if (!chapter || !currentDetailChapterContent.value) {
      ElMessage.error('当前章节内容为空')
      return
    }
    if (!summaryPromptTemplate.value.trim()) {
      ElMessage.error('请先设置提示词模板')
      return
    }
    await summaryTask.start({
      prompt: buildFullPrompt(),
      options: { type: 'content_generation' },
      onSuccess: (summary) => {
        const target = autoDetectedChapters.value.find((c) => c === chapter)
        if (!target) return
        target.summary = summary.trim()
        ElMessage.success('章节简读生成完成！')
      },
      onError: (error) => {
        ElMessage.error(`生成失败: ${error.message}`)
      },
    })
  }

  // Keep the previous digest until a replacement finishes successfully.
  const regenerateChapterSummary = generateChapterSummaryWithAI

  // 保存提示词模板到本地存储
  const saveSummaryPromptTemplate = () => {
    try {
      storageSetRaw(StorageKeys.chapterSummaryPromptTemplate, summaryPromptTemplate.value)
    } catch (error) {
      console.error('保存提示词模板失败:', error)
    }
  }

  // 从本地存储加载提示词模板
  const loadSummaryPromptTemplate = () => {
    try {
      const saved = storageGetRaw(StorageKeys.chapterSummaryPromptTemplate)
      if (saved) {
        summaryPromptTemplate.value = saved
      }
    } catch (error) {
      console.error('加载提示词模板失败:', error)
    }
  }

  // 重置提示词模板为默认值
  const resetPromptTemplate = () => {
    const defaultTemplate = `请为以下小说章节生成一个简洁的章节简读，要求：
1. 概括本章节的主要情节和内容
2. 突出关键人物和事件
3. 体现本章节在整体故事中的作用
4. 简读长度控制在100字以内
5. 语言简洁明了，突出重点

章节标题：{章节标题}
章节字数：{章节字数}字

章节内容：
{章节内容}

请生成章节简读：`

    summaryPromptTemplate.value = defaultTemplate
    ElMessage.success('已重置为默认提示词模板')
  }

  // 预览完整提示词
  const previewFullPrompt = () => {
    if (!currentDetailChapter.value || !currentDetailChapterContent.value) {
      ElMessage.warning('当前没有选中章节，无法预览完整提示词')
      return
    }

    fullPromptPreview.value = buildFullPrompt()
    showPromptPreview.value = true
  }

  // 复制完整提示词
  const copyFullPrompt = () => {
    navigator.clipboard
      .writeText(fullPromptPreview.value)
      .then(() => {
        ElMessage.success('提示词已复制到剪贴板')
      })
      .catch((err) => {
        console.error('复制失败:', err)
        ElMessage.error('复制失败')
      })
  }

  // 监听提示词模板变化，自动保存
  watch(summaryPromptTemplate, () => {
    saveSummaryPromptTemplate()
  })

  // 组件挂载时加载模板
  onMounted(() => {
    void libraryWorkspace.loadAnalysisLibrary()
    loadAnalysisTemplates()
    loadSummaryPromptTemplate()
  })

  return {
    ...libraryWorkspace,
    uploadedFile,
    bookContent,
    selectedEncoding,
    importingFile,
    isDocx,
    fileFormatLabel,
    handleFileChange,
    handleFileExceed,
    rereadWithEncoding,
    removeFile,
    selectedTemplate,
    selectedChapters,
    analysisStartWords,
    analysisEndWords,
    analysisScopeError,
    analysisScopeDescription,
    analysisProgress,
    analysisStatus,
    analysisResult,
    analysisEditorRef,
    detectedChapters,
    autoDetectedChapters,
    showChapterDetails,
    showChapterContent,
    selectedViewChapter,
    currentViewChapter,
    currentChapterContent,
    selectedDetailChapter,
    currentDetailChapter,
    currentDetailChapterContent,
    activeDetailTab,
    summaryPromptTemplate,
    showPromptEditor,
    showPromptPreview,
    fullPromptPreview,
    analysisTemplates,
    estimatedChapters,
    displayContent,
    getPlaceholder,
    selectAllChapters,
    clearChapterSelection,
    startLocalChapterDetection,
    summaryTask,
    analyzing,
    generatingSummary,
    stopAnalysis,
    startAnalysis,
    exportResults,
    openChapterViewer,
    closeChapterContent,
    loadChapterContent,
    copyChapterContent,
    exportChapterContent,
    selectDetailChapter,
    copyDetailChapterContent,
    exportDetailChapterContent,
    exportAllChapterSummary,
    exportAllChapterContent,
    openChapterDetailsViewer,
    getPreviewPrompt,
    generateChapterSummaryWithAI,
    regenerateChapterSummary,
    resetPromptTemplate,
    previewFullPrompt,
    copyFullPrompt,
  }
}
