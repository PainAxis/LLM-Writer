import type { InputInstance } from 'element-plus'
import type { ToolType, ToolId, ToolForm, ToolField, ToolSourceNovel } from '@/types/tools'
import type { PromptTemplate } from '@/config/defaultPrompts'

interface StoredToolChapter {
  id?: ToolId
  title?: string
  content?: string
  description?: string
}
interface StoredToolNovel extends ToolSourceNovel {
  chapterList?: StoredToolChapter[]
  chapters?: number | StoredToolChapter[]
}
interface NovelOption {
  value: ToolId
  label: string
  chapters: StoredToolChapter[]
}
interface ChapterOption {
  value: ToolId
  label: string
  content: string
  description: string
}

import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { useNovelStore } from '@/stores/novel'
import { useAIStream } from '@/composables/useAIStream'
import { useGenerationTask } from '@/composables/useGenerationTask'
import { TOOL_DEFINITIONS as toolsConfig } from '@/config/tools'
import { buildToolPrompt } from '@/utils/toolPrompts'
import { isToolFormComplete } from '@/utils/toolForms'
import { storageGet, StorageKeys } from '@/utils/storage'

/** Typed orchestration for the ToolsLibrary view. */
export function useToolsLibraryWorkspace() {
  const novelStore = useNovelStore()

  const showToolDialog = ref(false)

  const generatedContent = ref('')

  const generatingProgress = ref(0)

  const generatingStatusText = ref('')

  const toolForm = reactive<ToolForm>({})

  const resultTextarea = ref<InputInstance | null>(null)

  // 小说列表数据
  const novelList = ref<NovelOption[]>([])

  const selectedNovelChapters = ref<ChapterOption[]>([])

  // 提示词数据
  const availablePrompts = ref<PromptTemplate[]>([])

  const selectedPromptData = ref<PromptTemplate | null>(null)

  // 加载小说列表
  const loadNovelList = () => {
    try {
      const savedNovels = storageGet<StoredToolNovel[]>(StorageKeys.novels, [])
      console.log('原始小说数据:', savedNovels) // 调试用

      if (!Array.isArray(savedNovels)) {
        console.warn('小说数据不是数组格式')
        novelList.value = []
        return
      }

      novelList.value = savedNovels
        .map((novel) => {
          if (!novel || typeof novel !== 'object') {
            return null
          }

          return {
            value: novel.id || `novel_${Date.now()}_${Math.random()}`,
            label: novel.title || '未命名小说',
            chapters: Array.isArray(novel.chapterList)
              ? novel.chapterList
              : Array.isArray(novel.chapters)
                ? novel.chapters
                : [],
          }
        })
        .filter((novel) => novel !== null) // 过滤掉无效的小说

      console.log('处理后的小说列表:', novelList.value) // 调试用
    } catch (error) {
      console.error('加载小说列表失败:', error)
      novelList.value = []
    }
  }

  // 当选择小说时，更新章节列表
  const onNovelChange = (novelId: ToolId) => {
    console.log('选择的小说ID:', novelId) // 调试用
    const selectedNovel = novelList.value.find((novel) => novel.value === novelId)
    console.log('找到的小说:', selectedNovel) // 调试用

    if (selectedNovel && selectedNovel.chapters && Array.isArray(selectedNovel.chapters)) {
      console.log('小说章节数据:', selectedNovel.chapters) // 调试用
      selectedNovelChapters.value = selectedNovel.chapters
        .map((chapter) => {
          if (!chapter || typeof chapter !== 'object') {
            return null
          }
          return {
            value: chapter.id || `chapter_${Date.now()}_${Math.random()}`,
            label: chapter.title || '未命名章节',
            content: chapter.content || '',
            description: chapter.description || '',
          }
        })
        .filter((chapter) => chapter !== null)
    } else {
      console.log('没有找到有效的章节数据') // 调试用
      selectedNovelChapters.value = []
    }

    // 清空已选择的章节
    if (toolForm.selectedChapters) {
      toolForm.selectedChapters = []
    }
  }

  // 工具配置
  const currentTool = computed(() => {
    return toolsConfig[currentToolType.value]
  })

  const currentToolType = ref<ToolType>('title')

  // 计算属性：检查是否可以生成
  const canGenerate = computed(() => isToolFormComplete(currentTool.value, toolForm))

  // 计算属性：显示内容（用于流式输出）
  const displayContent = computed(() => {
    return generatedContent.value
  })

  const openTool = (toolType: ToolType) => {
    currentToolType.value = toolType
    showToolDialog.value = true
    clearForm()

    // 如果工具需要小说选择器，加载小说列表
    if (currentTool.value.hasNovelSelector) {
      loadNovelList()
    }
  }

  const clearForm = () => {
    stopGeneration()
    Object.keys(toolForm).forEach((key) => {
      delete toolForm[key]
    })
    generatedContent.value = ''
    generatingProgress.value = 0
    generatingStatusText.value = ''
    selectedNovelChapters.value = []
    selectedPromptData.value = null
  }

  const generationTask = useGenerationTask({
    stream: useAIStream(),
    source: () => [
      showToolDialog.value,
      currentToolType.value,
      { ...toolForm },
      selectedPromptData.value?.content,
    ],
  })

  const generating = generationTask.running

  onBeforeUnmount(generationTask.dispose)

  const stopGeneration = () => {
    generationTask.stop()
    generatingProgress.value = 0
    generatingStatusText.value = ''
  }

  const generateContent = async () => {
    if (generating.value || !showToolDialog.value) return
    if (!canGenerate.value) {
      ElMessage.warning('请填写所有必填字段')
      return
    }
    if (currentToolType.value === 'character' && !isValidCharacterCount(toolForm.count)) {
      ElMessage.warning('角色数量必须是1-15之间的数字')
      return
    }
    if (!novelStore.isApiConfigured) {
      ElMessage.error('请先配置API密钥')
      return
    }
    generatedContent.value = ''
    generatingProgress.value = 0
    generatingStatusText.value = '正在准备生成...'
    await generationTask.start({
      prompt: buildPrompt(),
      options: { type: 'content_generation' },
      onText: (text, isCurrent) => {
        generatedContent.value = text
        generatingProgress.value = Math.min(90, text.length / 30)
        generatingStatusText.value = `已生成${text.length}字`
        nextTick(() => {
          if (!isCurrent()) return
          const textarea = resultTextarea.value?.textarea
          if (textarea) textarea.scrollTop = textarea.scrollHeight
        })
      },
      onSuccess: () => {
        generatingProgress.value = 100
        generatingStatusText.value = '生成完成'
        ElMessage.success('内容生成成功！')
      },
      onError: (error) => {
        generatedContent.value = ''
        generatingProgress.value = 0
        generatingStatusText.value = '生成失败'
        ElMessage.error('生成失败：' + error.message)
      },
    })
  }

  const buildPrompt = () =>
    buildToolPrompt({
      type: currentToolType.value,
      form: toolForm,
      selectedPrompt: selectedPromptData.value,
      novels: novelList.value,
      chapters: selectedNovelChapters.value,
      originals: storageGet<StoredToolNovel[]>(StorageKeys.novels, []),
    })

  const copyToClipboard = async () => {
    if (!generatedContent.value) {
      ElMessage.warning('没有可复制的内容')
      return
    }

    try {
      await navigator.clipboard.writeText(generatedContent.value)
      ElMessage.success('内容已复制到剪贴板')
    } catch {
      // 如果 Clipboard API 不可用，使用传统方法
      const textArea = document.createElement('textarea')
      textArea.value = generatedContent.value
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      ElMessage.success('内容已复制到剪贴板')
    }
  }

  const saveResult = () => {
    if (!generatedContent.value) {
      ElMessage.warning('没有可保存的内容')
      return
    }

    try {
      // 创建文件内容
      const content = `=== ${currentTool.value.title} ===
生成时间：${new Date().toLocaleString()}

=== 生成参数 ===
${currentTool.value.fields
  .map((field) => (toolForm[field.key] ? `${field.label}：${toolForm[field.key]}` : ''))
  .filter((line) => line)
  .join('\n')}

=== 生成结果 ===
${generatedContent.value}
`

      // 创建并下载文件
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${currentTool.value.title}_${new Date().getTime()}.txt`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      ElMessage.success('结果已保存到本地文件')
    } catch (error) {
      console.error('保存文件失败:', error)
      ElMessage.error('保存失败')
    }
  }

  // 加载提示词数据
  const loadPrompts = () => {
    try {
      const savedPrompts = storageGet<PromptTemplate[] | null>(StorageKeys.prompts, null)
      if (savedPrompts) {
        availablePrompts.value = savedPrompts
      } else {
        availablePrompts.value = []
      }
      console.log('加载提示词数据:', availablePrompts.value.length)
    } catch (error) {
      console.error('加载提示词失败:', error)
      availablePrompts.value = []
    }
  }

  // 根据分类获取提示词
  const getPromptsByCategory = (category?: string) => {
    if (!category) return []
    return availablePrompts.value.filter((prompt) => prompt.category === category)
  }

  // 当选择提示词时
  const onPromptChange = (promptId?: number) => {
    console.log('选择的提示词ID:', promptId)
    if (promptId) {
      selectedPromptData.value =
        availablePrompts.value.find((prompt) => prompt.id === promptId) ?? null
      console.log('选择的提示词数据:', selectedPromptData.value)
    } else {
      selectedPromptData.value = null
    }
  }

  // 验证角色数量
  const isValidCharacterCount = (count: unknown) => {
    const num = Number(count)
    return (
      (typeof count === 'number' || typeof count === 'string') &&
      Number.isInteger(num) &&
      num >= 1 &&
      num <= 15
    )
  }

  // 角色数量输入验证
  const validateCharacterCount = (field: ToolField, value: string) => {
    if (field.key === 'count' && currentToolType.value === 'character') {
      // 限制只能输入数字
      const numericValue = value.replace(/[^0-9]/g, '')
      if (numericValue !== value) {
        toolForm[field.key] = numericValue
      }
    }
  }

  // 组件挂载时加载小说列表和提示词
  onMounted(() => {
    loadNovelList()
    loadPrompts()
  })

  const getScalarField = (key: string): string | number => {
    const value = toolForm[key]
    return typeof value === 'string' || typeof value === 'number' ? value : ''
  }

  return {
    getScalarField,
    showToolDialog,
    generatedContent,
    generatingProgress,
    generatingStatusText,
    toolForm,
    resultTextarea,
    novelList,
    selectedNovelChapters,
    onNovelChange,
    currentTool,
    currentToolType,
    canGenerate,
    displayContent,
    openTool,
    clearForm,
    generating,
    stopGeneration,
    generateContent,
    copyToClipboard,
    saveResult,
    getPromptsByCategory,
    onPromptChange,
    isValidCharacterCount,
    validateCharacterCount,
  }
}
