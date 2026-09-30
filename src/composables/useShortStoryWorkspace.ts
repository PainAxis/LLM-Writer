import type { Ref } from 'vue'
import type { IDomEditor } from '@wangeditor/editor'
import type { TabsPaneContext } from 'element-plus'
import type { ShortArticleDraft, ShortStoryDraft, ShortStoryConfig } from '@/types/shortStory'
import type { PromptTemplate } from '@/config/defaultPrompts'
import {
  ref,
  reactive,
  computed,
  shallowRef,
  toRef,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAIStream } from '@/composables/useAIStream'
import { destroyEditor } from '@/utils/destroyEditor'
import { useShortStoryConfig } from '@/composables/useShortStoryConfig'
import {
  buildShortArticlePrompt,
  buildShortStoryPrompt,
  buildShortStoryContinuation,
  buildShortStoryOptimization,
} from '@/utils/shortStoryPrompts'
import { useShortStoryGeneration } from '@/composables/useShortStoryGeneration'
import { storageGet, storageSet, StorageKeys } from '@/utils/storage'
import { DEFAULT_PROMPTS, PROMPTS_VERSION, mergeDefaultPrompts } from '../config/defaultPrompts'
import { useRouter } from 'vue-router'

/** Typed orchestration for the ShortStory view. */
export function useShortStoryWorkspace() {
  const router = useRouter()

  // 模块切换
  const activeTab = ref('article')
  // 默认显示短文模块

  // 短文模块数据
  const articleData = reactive<ShortArticleDraft>({
    title: '',
    wordCount: 800,
    style: '',
    prompt: '',
    references: [],
  })

  // 短文模块状态
  const articleContent = ref('')

  const selectedArticlePromptTemplate = ref<PromptTemplate | null>(null)

  const showArticlePromptSelector = ref(false)

  // 响应式数据
  const generatedStory = ref('')

  const hasSelection = ref(false)

  const selectedText = ref('')

  const showAdvancedConfig = ref<string[]>([])

  const unifiedPrompt = ref('')

  // 续写相关
  const showContinueDialog = ref(false)

  const continueDirection = ref('')

  const continueWordCount = ref(2000)

  const continueTextRef = ref<HTMLElement | null>(null)

  // 配置管理相关
  const showConfigManager = ref(false)

  const activeConfigTab = ref('genres')

  const showWritingStyleManager = ref(false)

  // 提示词选择相关
  const showPromptSelector = ref(false)

  const selectedPromptId = ref<number | null>(null)

  const selectedPromptTemplate = ref<PromptTemplate | null>(null)

  const previewPrompt = ref<PromptTemplate | null>(null)

  const editablePromptContent = ref('')

  const availablePrompts = ref<PromptTemplate[]>([])

  // 选段优化相关
  const showOptimizeModal = ref(false)

  const selectedTextForOptimize = ref('')

  const optimizeDirection = ref('')

  const optimizedTextRef = ref<HTMLElement | null>(null)

  const optimizeSourceContent = ref('')

  const generation = useShortStoryGeneration({
    storyContent: generatedStory,
    streams: {
      article: useAIStream(),
      story: useAIStream(),
      continue: useAIStream(),
      optimize: useAIStream(),
    },
    notify: { success: ElMessage.success, warning: ElMessage.warning, error: ElMessage.error },
  })

  const generatingArticle = toRef(generation.states.article, 'running')

  const articleStreamingContent = toRef(generation.states.article, 'text')

  const generating = toRef(generation.states.story, 'running')

  const streamingContent = toRef(generation.states.story, 'text')

  const continuingStory = toRef(generation.states.continue, 'running')

  const continueResult = toRef(generation.states.continue, 'text')

  const optimizing = toRef(generation.states.optimize, 'running')

  const optimizedResult = toRef(generation.states.optimize, 'text')

  watch(
    showContinueDialog,
    (visible) => {
      if (!visible) generation.stop('continue')
    },
    { flush: 'sync' }
  )

  watch(
    showOptimizeModal,
    (visible) => {
      if (!visible) generation.stop('optimize')
    },
    { flush: 'sync' }
  )

  const updateGeneratedEditor = (
    content: Ref<string>,
    editor: Ref<IDomEditor | null>,
    text: string,
    isCurrent: () => boolean
  ) => {
    const html = text.replace(/\n/g, '<br/>')
    content.value = html
    const instance = editor.value
    nextTick(() => {
      if (isCurrent() && instance && editor.value === instance && content.value === html)
        instance.setHtml(html)
    })
  }

  // 短文模块计算属性
  const isArticleConfigValid = computed(() => {
    return articleData.title.trim() && articleData.prompt.trim()
  })

  const articleWordCount = computed(() => {
    if (!articleContent.value) return 0
    // 移除HTML标签并计算字数
    return articleContent.value.replace(/<[^>]*>/g, '').trim().length
  })

  // 短篇小说提示词选择
  const showStoryPromptSelector = ref(false)

  // 计算属性 - 短篇小说提示词
  // 计算属性 - 提示词占位符
  const promptPlaceholder = computed(() => {
    if (selectedPromptTemplate.value) {
      return '请编辑上方选择的提示词模板，可以根据需要修改内容'
    }
    return `请详细描述您想要创作的短篇小说，包括：
• 主角的性格特点和背景
• 故事情节和冲突
• 场景和环境描述
• 您希望的故事风格和结局

例如：创作一篇都市爱情小说，主角是25岁的软件工程师李明，性格内向但善良。故事讲述他在咖啡馆遇到了画家女孩小雅，两人从陌生到相知相爱的过程。希望故事温馨感人，有一些生活的小细节，结局美满。`
  })

  // WangEditor相关
  const editorRef = shallowRef<IDomEditor | null>(null)

  const toolbarConfig = {}

  const editorConfig = {
    placeholder: '生成的小说内容将显示在这里...',
    MENU_CONF: {
      uploadImage: {
        server: '/api/upload-image',
        fieldName: 'file',
        maxFileSize: 5 * 1024 * 1024,
        allowedFileTypes: ['image/*'],
      },
    },
  }

  // 短文编辑器相关
  const articleEditorRef = shallowRef<IDomEditor | null>(null)

  const articleToolbarConfig = {}

  const articleEditorConfig = {
    placeholder: '生成的短文内容将显示在这里，您也可以直接编辑...',
    MENU_CONF: {
      uploadImage: {
        server: '/api/upload-image',
        fieldName: 'file',
        maxFileSize: 5 * 1024 * 1024,
        allowedFileTypes: ['image/*'],
      },
    },
  }

  // 故事数据
  const storyData = reactive<ShortStoryDraft>({
    genre: '',
    protagonist: {
      name: '',
      gender: 'male',
      age: 25,
    },
    plotType: '',
    emotion: '',
    timeFrame: '',
    location: '',
    referenceText: '',
    title: '',
    wordCount: 3000,
  })

  const configuration = useShortStoryConfig()

  const configData = configuration.data

  // 计算属性
  const isConfigValid = computed(() => {
    return storyData.title && storyData.protagonist.name && unifiedPrompt.value.trim().length > 0
  })

  // 获取当前配置选项
  const customGenres = computed(() => configData.genres)

  const customPlotTypes = computed(() => configData.plotTypes)

  const customEmotions = computed(() => configData.emotions)

  const customTimeFrames = computed(() => configData.timeFrames)

  const customWritingStyles = computed(() => configData.writingStyles)

  // 短文模块方法
  const handleTabClick = (tab: TabsPaneContext) => {
    activeTab.value = String(tab.paneName ?? 'article')
  }

  const resetArticleConfig = () => {
    generation.stop('article', true)
    articleData.title = ''
    articleData.wordCount = 800
    articleData.style = ''
    articleData.prompt = ''
    articleData.references = []
    articleContent.value = ''
  }

  const addReferenceArticle = () => {
    articleData.references.push({
      title: '',
      content: '',
    })
  }

  const removeReferenceArticle = (index: number) => {
    articleData.references.splice(index, 1)
  }

  const selectArticlePrompt = (prompt: PromptTemplate) => {
    selectedArticlePromptTemplate.value = prompt
    articleData.prompt = prompt.content
    showArticlePromptSelector.value = false
  }

  const clearArticleSelectedTemplate = () => {
    selectedArticlePromptTemplate.value = null
  }

  // 短篇小说提示词选择方法
  const selectStoryPrompt = (prompt: PromptTemplate) => {
    selectedPromptTemplate.value = prompt
    unifiedPrompt.value = prompt.content
    showStoryPromptSelector.value = false
  }

  const generateArticle = async () => {
    if (generatingArticle.value) return
    if (!isArticleConfigValid.value) {
      ElMessage.warning('请完善文章配置')
      return
    }
    articleContent.value = ''
    const prompt = buildShortArticlePrompt(articleData, configData)

    await generation.start('article', {
      prompt,
      onText: (text, isCurrent) =>
        updateGeneratedEditor(articleContent, articleEditorRef, text, isCurrent),
      successMessage: '短文生成完成',
      errorPrefix: '短文生成失败',
    })
  }

  const stopArticleGeneration = () => {
    generation.stop('article')
    ElMessage.info('已停止生成')
  }

  const copyArticleContent = async () => {
    if (!articleContent.value) {
      ElMessage.warning('没有可复制的内容')
      return
    }

    try {
      // 移除HTML标签，获取纯文本
      const plainText = articleContent.value.replace(/<[^>]*>/g, '').trim()
      await navigator.clipboard.writeText(plainText)
      ElMessage.success('内容已复制到剪贴板')
    } catch {
      ElMessage.error('复制失败')
    }
  }

  const saveArticle = () => {
    if (!articleContent.value) {
      ElMessage.warning('没有可保存的内容')
      return
    }

    // 移除HTML标签，获取纯文本
    const plainText = articleContent.value.replace(/<[^>]*>/g, '').trim()
    const content = `${articleData.title}\n\n${plainText}`

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${articleData.title || '短文'}.txt`
    link.click()
    ElMessage.success('文章已保存')
  }

  const clearArticleContent = () => {
    ElMessageBox.confirm('确定要清空内容吗？', '确认', {
      type: 'warning',
    })
      .then(() => {
        generation.stop('article', true)
        articleContent.value = ''
        ElMessage.success('内容已清空')
      })
      .catch(() => {})
  }

  const createPrompt = () => {
    router.push('/prompts')
  }

  // 方法

  const generateStory = async () => {
    if (generating.value) return
    const prompt = buildShortStoryPrompt(storyData, configData, unifiedPrompt.value)
    generatedStory.value = ''
    await generation.start('story', {
      prompt,
      onText: (text, isCurrent) =>
        updateGeneratedEditor(generatedStory, editorRef, text, isCurrent),
      successMessage: '小说生成成功！',
      errorPrefix: '小说生成失败',
    })
  }

  const _regenerateStory = () => {
    generatedStory.value = ''
    generateStory()
  }

  // 续写功能
  const continueStory = async () => {
    if (continuingStory.value) return

    if (generating.value) {
      ElMessage.warning('请先停止正文生成')
      return
    }
    generation.stop('continue', true)
    // 显示续写弹窗
    showContinueDialog.value = true
    continueDirection.value = ''
    continueResult.value = ''
  }

  // 执行续写
  const performContinue = async () => {
    if (continuingStory.value) return
    const sourceContent = generatedStory.value
    const currentText = sourceContent.replace(/<[^>]*>/g, '')
    if (!currentText.trim()) {
      ElMessage.warning('请先生成一些内容再进行续写')
      return
    }
    await generation.start('continue', {
      prompt: buildShortStoryContinuation(
        currentText,
        storyData,
        configData,
        continueDirection.value,
        continueWordCount.value
      ),
      sourceContent,
      onText: (_text, isCurrent) =>
        nextTick(() => {
          if (isCurrent() && continueTextRef.value)
            continueTextRef.value.scrollTop = continueTextRef.value.scrollHeight
        }),
      successMessage: '续写完成！',
      errorPrefix: '续写失败',
    })
  }

  // 复制续写内容
  const copyContinueText = async () => {
    try {
      if (!continueResult.value.trim()) {
        ElMessage.warning('没有续写内容可以复制')
        return
      }

      await navigator.clipboard.writeText(continueResult.value)
      ElMessage.success('续写内容已复制到剪贴板')
    } catch (error) {
      console.error('复制失败:', error)
      ElMessage.error('复制失败，请手动复制')
    }
  }

  // 追加续写内容到原文
  // 构建续写提示词
  const resetConfig = () => {
    ElMessageBox.confirm('确定要重置所有配置吗？这将清空当前所有设置内容。', '重置确认', {
      confirmButtonText: '确定重置',
      cancelButtonText: '取消',
      type: 'warning',
    })
      .then(() => {
        // 重置所有配置
        storyData.genre = ''
        storyData.title = ''
        storyData.plotType = ''
        storyData.emotion = ''
        storyData.timeFrame = ''
        storyData.location = ''
        storyData.referenceText = ''
        storyData.wordCount = 3000
        storyData.protagonist.name = ''
        storyData.protagonist.gender = 'male'
        storyData.protagonist.age = 25
        unifiedPrompt.value = ''
        showAdvancedConfig.value = []

        ElMessage.success('配置已重置')
      })
      .catch(() => {
        // 用户取消
      })
  }

  const handleEditorCreated = (editor: IDomEditor) => {
    editorRef.value = editor
  }

  const onEditorChange = (_editor: IDomEditor) => {
    // 编辑器内容变化时的处理，v-model会自动处理
  }

  // 短文编辑器事件处理
  const handleArticleEditorCreated = (editor: IDomEditor) => {
    articleEditorRef.value = editor
  }

  const onArticleEditorChange = (_editor: IDomEditor) => {
    // 短文编辑器内容变化时的处理，v-model会自动处理
  }

  const handleTextSelection = (_event: Event) => {
    const selection = window.getSelection()?.toString() ?? ''
    if (selection.length > 0) {
      selectedText.value = selection
      hasSelection.value = true
    } else {
      hasSelection.value = false
    }
  }

  // 显示选段优化弹窗
  const showOptimizeDialog = () => {
    if (generating.value) {
      ElMessage.warning('请先停止正文生成')
      return
    }
    if (!editorRef.value) {
      ElMessage.warning('编辑器未初始化')
      return
    }

    // 改进文本选择逻辑
    let selectedText = ''
    try {
      // 尝试从编辑器获取选中文本
      selectedText = editorRef.value.getSelectionText()

      // 如果编辑器方法失败，尝试使用浏览器原生方法
      if (!selectedText) {
        const selection = window.getSelection()
        if (selection && selection.toString()) {
          selectedText = selection.toString()
        }
      }
    } catch (error) {
      console.warn('获取选中文本失败，尝试备用方法:', error)
      const selection = window.getSelection()
      if (selection && selection.toString()) {
        selectedText = selection.toString()
      }
    }

    if (!selectedText || selectedText.trim().length === 0) {
      ElMessage.warning('请先选择要优化的文本')
      return
    }

    generation.stop('optimize', true)
    optimizeSourceContent.value = generatedStory.value
    selectedTextForOptimize.value = selectedText.trim()
    optimizeDirection.value = ''
    optimizedResult.value = ''
    showOptimizeModal.value = true
  }

  // 执行优化
  const performOptimize = async () => {
    if (optimizing.value) return
    if (!selectedTextForOptimize.value) {
      ElMessage.warning('没有选中的文本')
      return
    }
    if (!optimizeDirection.value.trim()) {
      ElMessage.warning('请填写优化方向')
      return
    }
    const prompt = buildShortStoryOptimization(
      selectedTextForOptimize.value,
      optimizeDirection.value
    )

    await generation.start('optimize', {
      prompt,
      sourceContent: optimizeSourceContent.value,
      onText: (_text, isCurrent) =>
        nextTick(() => {
          if (isCurrent() && optimizedTextRef.value)
            optimizedTextRef.value.scrollTop = optimizedTextRef.value.scrollHeight
        }),
      successMessage: '优化完成！',
      errorPrefix: '优化失败',
    })
  }

  // 复制优化后的文本
  const copyOptimizedText = async () => {
    if (!optimizedResult.value) {
      ElMessage.warning('没有优化结果可复制')
      return
    }

    try {
      await navigator.clipboard.writeText(optimizedResult.value)
      ElMessage.success('已复制到剪贴板')
    } catch {
      // 如果clipboard API不可用，使用传统方法
      const textArea = document.createElement('textarea')
      textArea.value = optimizedResult.value
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      ElMessage.success('已复制到剪贴板')
    }
  }

  // 替换原文
  const replaceOriginalText = () => {
    if (!generation.canUseResult('optimize')) {
      ElMessage.warning('原文已改变或结果尚未完成，请重新选择并生成')
      return
    }
    if (!optimizedResult.value) {
      ElMessage.warning('没有优化结果可替换')
      return
    }

    if (!selectedTextForOptimize.value) {
      ElMessage.warning('没有选中的原文')
      return
    }

    try {
      // 获取当前编辑器的HTML内容
      let currentContent = ''
      if (editorRef.value) {
        currentContent = editorRef.value.getHtml() || generatedStory.value || ''
      } else {
        currentContent = generatedStory.value || ''
      }

      console.log('当前内容:', currentContent)
      console.log('要替换的文本:', selectedTextForOptimize.value)
      console.log('替换为:', optimizedResult.value)

      // 处理HTML内容中的文本替换
      // 先尝试直接替换
      let newContent = currentContent.replace(selectedTextForOptimize.value, optimizedResult.value)

      // 如果直接替换失败，尝试处理HTML标签
      if (newContent === currentContent) {
        // 移除HTML标签进行匹配
        const plainContent = currentContent.replace(/<[^>]*>/g, '')
        if (plainContent.includes(selectedTextForOptimize.value)) {
          // 在纯文本中找到了，需要在HTML中定位并替换
          const regex = new RegExp(
            selectedTextForOptimize.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            'g'
          )
          newContent = currentContent.replace(regex, optimizedResult.value)
        }
      }

      if (newContent === currentContent) {
        ElMessage.warning('未找到要替换的文本，请重新选择')
        return
      }

      // 更新内容
      generatedStory.value = newContent

      // 更新编辑器
      if (editorRef.value) {
        editorRef.value.setHtml(newContent)
      }

      // 关闭弹窗
      showOptimizeModal.value = false

      ElMessage.success('已替换原文')
    } catch (error) {
      console.error('替换失败:', error)
      ElMessage.error('替换失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  const optimizeSelection = async () => {
    // 保留原有方法以防兼容性问题
    showOptimizeDialog()
  }

  const exportStory = () => {
    // 实现导出功能
    const pureText = generatedStory.value ? generatedStory.value.replace(/<[^>]*>/g, '') : ''
    const content = `${storyData.title}\n\n${pureText}`
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${storyData.title || '短篇小说'}.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  // 获取纯文本字数统计
  const getTextWordCount = (html: string) => {
    if (!html) return 0
    // 移除HTML标签
    const text = html.replace(/<[^>]*>/g, '')
    return text.length
  }

  // 配置管理方法
  const loadConfigData = configuration.load

  const saveConfigData = async () => {
    try {
      await configuration.save()
      ElMessage.success('配置保存成功！')
      showConfigManager.value = false
    } catch (error) {
      console.error('保存配置失败:', error)
      ElMessage.error('保存配置失败')
    }
  }

  const addConfigItem = (type: keyof ShortStoryConfig) => {
    configData[type].push({
      label: '',
      value: '',
      description: '',
    })
  }

  const removeConfigItem = (type: keyof ShortStoryConfig, index: number) => {
    configData[type].splice(index, 1)
  }

  // 文风管理方法
  const addWritingStyle = () => {
    configData.writingStyles.push({
      label: '',
      value: '',
      prompt: '',
    })
  }

  const removeWritingStyle = (index: number) => {
    configData.writingStyles.splice(index, 1)
  }

  const saveWritingStyleConfig = async () => {
    try {
      await configuration.save()
      ElMessage.success('文风配置保存成功！')
      showWritingStyleManager.value = false
    } catch (error) {
      console.error('保存文风配置失败:', error)
      ElMessage.error('保存文风配置失败')
    }
  }

  const openConfigManager = () => {
    if (configData.genres.length === 0) loadConfigData()
    showConfigManager.value = true
  }

  const resetToDefault = () => {
    ElMessageBox.confirm('确定要恢复默认配置吗？这将清除所有自定义配置。', '恢复默认配置', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
      .then(() => {
        configuration.reset()
        ElMessage.success('已恢复默认配置')
      })
      .catch(() => {
        // 用户取消
      })
  }

  // 提示词管理方法
  const loadPrompts = () => {
    try {
      const prompts = storageGet<PromptTemplate[] | null>(StorageKeys.prompts, null)
      if (Array.isArray(prompts) && prompts.length > 0) {
        const version = storageGet<number>(StorageKeys.promptsVersion, 0)
        let list = prompts
        if (version !== PROMPTS_VERSION) {
          // 旧版短篇默认模板的 id 是 Date.now() 随机值，无法按 id 升级：
          // 先按标题移除旧默认短篇，再合并统一默认库（用户自建模板保留）
          const legacyTitles = new Set([
            '都市短篇小说生成器',
            '通用短篇小说模板',
            '玄幻短篇小说生成器',
          ])
          list = list.filter(
            (p) => !(p.category === 'short-story' && p.isDefault && legacyTitles.has(p.title))
          )
          list = mergeDefaultPrompts(list)
          storageSet(StorageKeys.prompts, list)
          storageSet(StorageKeys.promptsVersion, PROMPTS_VERSION)
          console.log('短篇小说模块已刷新内置提示词')
        }
        availablePrompts.value = list
      } else {
        // 没有任何提示词时，写入统一默认库
        const defaultPrompts = DEFAULT_PROMPTS.map((p) => ({ ...p }))
        availablePrompts.value = defaultPrompts
        storageSet(StorageKeys.prompts, defaultPrompts)
        storageSet(StorageKeys.promptsVersion, PROMPTS_VERSION)
      }
      console.log('短篇小说模块加载提示词数据:', availablePrompts.value.length)
    } catch (error) {
      console.error('加载提示词失败:', error)
      // 出错时也提供默认的短篇小说提示词
      availablePrompts.value = getDefaultShortStoryPrompts()
    }
  }

  // 出错兜底：从统一默认库取短篇模板
  const getDefaultShortStoryPrompts = () => {
    return DEFAULT_PROMPTS.filter((p) => p.category === 'short-story').map((p) => ({ ...p }))
  }

  const _selectPrompt = (prompt: PromptTemplate) => {
    selectedPromptId.value = prompt.id
    previewPrompt.value = prompt
    editablePromptContent.value = prompt.content
  }

  const _resetPromptSelector = () => {
    selectedPromptId.value = null
    previewPrompt.value = null
    editablePromptContent.value = ''
  }

  const clearSelectedTemplate = () => {
    selectedPromptTemplate.value = null
    // 清空当前提示词内容，让用户重新输入
    unifiedPrompt.value = ''
    ElMessage.success('已清除提示词模板')
  }

  const _useOriginalPrompt = () => {
    if (!previewPrompt.value) return

    // 使用原版提示词并填充变量
    const filledPrompt = fillPromptVariables(previewPrompt.value.content)
    unifiedPrompt.value = filledPrompt
    selectedPromptTemplate.value = previewPrompt.value
    showPromptSelector.value = false
    ElMessage.success('已使用原版提示词模板')
  }

  const _useEditedPrompt = () => {
    if (!previewPrompt.value || !editablePromptContent.value) return

    // 使用编辑后的提示词并填充变量
    const filledPrompt = fillPromptVariables(editablePromptContent.value)
    unifiedPrompt.value = filledPrompt
    selectedPromptTemplate.value = { ...previewPrompt.value, content: editablePromptContent.value }
    showPromptSelector.value = false
    ElMessage.success('已使用编辑版提示词模板')
  }

  const fillPromptVariables = (promptContent: string) => {
    let result = promptContent

    // 填充基础信息变量
    const variables: Record<string, string | number> = {
      小说标题: storyData.title || '{小说标题}',
      主角姓名: storyData.protagonist.name || '{主角姓名}',
      主角性别: storyData.protagonist.gender === 'male' ? '男' : '女',
      主角年龄: storyData.protagonist.age || '{主角年龄}',
      故事地点: storyData.location || '{故事地点}',
      字数要求: getWordCountText(storyData.wordCount),
      题材类型: getGenreText(storyData.genre) || '{题材类型}',
      情节类型: getPlotText(storyData.plotType) || '{情节类型}',
      情绪氛围: getEmotionText(storyData.emotion) || '{情绪氛围}',
      时间背景: getTimeFrameText(storyData.timeFrame) || '{时间背景}',
      创作要求: '请根据上述设定创作一篇精彩的短篇小说',
      参考文本: storyData.referenceText || '无',
    }

    // 替换变量
    Object.keys(variables).forEach((key) => {
      const regex = new RegExp(`\\{${key}\\}`, 'g')
      result = result.replace(regex, () => String(variables[key]))
    })

    return result
  }

  // 辅助方法 - 获取选项文本
  const getWordCountText = (value: number) => {
    // 现在wordCount是数字形式
    return `${value}字`
  }

  const getGenreText = (value: string) => {
    const genre = customGenres.value.find((g) => g.value === value)
    return genre?.label
  }

  const getPlotText = (value: string) => {
    const plot = customPlotTypes.value.find((p) => p.value === value)
    return plot?.label
  }

  const getEmotionText = (value: string) => {
    const emotion = customEmotions.value.find((e) => e.value === value)
    return emotion?.label?.replace(/[😊😢😰💕🔮]\s/, '') || emotion?.label
  }

  const getTimeFrameText = (value: string) => {
    const timeFrame = customTimeFrames.value.find((t) => t.value === value)
    return timeFrame?.label
  }

  const _goToPromptLibrary = () => {
    router.push('/prompts')
  }

  // 停止生成
  const stopGeneration = () => {
    generation.stop('story')
    ElMessage.info('已停止生成')
  }

  // 页面初始化时加载配置
  onMounted(() => {
    loadConfigData()
    loadPrompts()
  })

  // 组件卸载时销毁编辑器
  onBeforeUnmount(() => {
    generation.dispose()
    destroyEditor(editorRef.value)
    destroyEditor(articleEditorRef.value)
  })

  return {
    activeTab,
    articleData,
    articleContent,
    selectedArticlePromptTemplate,
    showArticlePromptSelector,
    generatedStory,
    showAdvancedConfig,
    unifiedPrompt,
    showContinueDialog,
    continueDirection,
    continueWordCount,
    continueTextRef,
    showConfigManager,
    activeConfigTab,
    showWritingStyleManager,
    selectedPromptTemplate,
    availablePrompts,
    showOptimizeModal,
    selectedTextForOptimize,
    optimizeDirection,
    optimizedTextRef,
    generatingArticle,
    articleStreamingContent,
    generating,
    streamingContent,
    continuingStory,
    continueResult,
    optimizing,
    optimizedResult,
    isArticleConfigValid,
    articleWordCount,
    showStoryPromptSelector,
    promptPlaceholder,
    editorRef,
    toolbarConfig,
    editorConfig,
    articleEditorRef,
    articleToolbarConfig,
    articleEditorConfig,
    storyData,
    configData,
    isConfigValid,
    customGenres,
    customPlotTypes,
    customEmotions,
    customTimeFrames,
    customWritingStyles,
    handleTabClick,
    resetArticleConfig,
    addReferenceArticle,
    removeReferenceArticle,
    selectArticlePrompt,
    clearArticleSelectedTemplate,
    selectStoryPrompt,
    generateArticle,
    stopArticleGeneration,
    copyArticleContent,
    saveArticle,
    clearArticleContent,
    createPrompt,
    generateStory,
    continueStory,
    performContinue,
    copyContinueText,
    resetConfig,
    handleEditorCreated,
    onEditorChange,
    handleArticleEditorCreated,
    onArticleEditorChange,
    handleTextSelection,
    performOptimize,
    copyOptimizedText,
    replaceOriginalText,
    optimizeSelection,
    exportStory,
    getTextWordCount,
    saveConfigData,
    addConfigItem,
    removeConfigItem,
    addWritingStyle,
    removeWritingStyle,
    saveWritingStyleConfig,
    openConfigManager,
    resetToDefault,
    clearSelectedTemplate,
    stopGeneration,
  }
}
