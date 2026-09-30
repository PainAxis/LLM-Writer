<template>
  <div class="tools-library">
    
    <ToolCatalog @select="openTool" />

    <!-- 工具对话框 -->
    <el-dialog 
      v-model="showToolDialog" 
      :title="currentTool.title"
      width="900px"
      class="tool-dialog"
      :close-on-click-modal="false"
    >
      <div class="tool-content">
        <div class="tool-form">
          <el-form :model="toolForm" label-width="100px" @submit.prevent="generateContent">
            <el-form-item v-for="field in currentTool.fields" :key="field.key" :label="field.label">
              <!-- 小说选择器 -->
              <el-select 
                v-if="field.type === 'novel-select'"
                v-model="toolForm[field.key]" 
                :placeholder="field.placeholder"
                @change="onNovelChange"
                clearable
              >
                <el-option 
                  v-for="novel in novelList" 
                  :key="novel.value" 
                  :label="novel.label" 
                  :value="novel.value"
                />
              </el-select>
              
              <!-- 章节多选器 -->
              <el-select 
                v-else-if="field.type === 'chapter-select'"
                v-model="toolForm[field.key]" 
                :placeholder="field.placeholder"
                multiple
                collapse-tags
                collapse-tags-tooltip
                :disabled="!toolForm.selectedNovel"
                clearable
              >
                <el-option 
                  v-for="chapter in selectedNovelChapters" 
                  :key="chapter.value" 
                  :label="chapter.label" 
                  :value="chapter.value"
                />
              </el-select>
              
              <!-- 普通输入框 -->
              <el-input 
                v-else-if="field.type === 'input'"
                v-model="toolForm[field.key]" 
                :placeholder="field.placeholder"
                :type="field.key === 'count' && currentToolType === 'character' ? 'number' : 'text'"
                :min="field.key === 'count' && currentToolType === 'character' ? 1 : undefined"
                :max="field.key === 'count' && currentToolType === 'character' ? 15 : undefined"
                @keyup.enter="generateContent"
                @input="validateCharacterCount(field, $event)"
              />
              <!-- 角色数量提示 -->
              <div 
                v-if="field.key === 'count' && currentToolType === 'character' && toolForm[field.key]"
                class="character-count-hint"
              >
                <span v-if="isValidCharacterCount(toolForm[field.key])" class="valid-hint">
                  ✓ 将生成 {{ toolForm[field.key] }} 个角色
                </span>
                <span v-else class="invalid-hint">
                  ⚠️ 请输入1-15之间的数字
                </span>
              </div>
              
              <!-- 文本域 -->
              <el-input 
                v-else-if="field.type === 'textarea'"
                v-model="toolForm[field.key]" 
                type="textarea" 
                :rows="4"
                :placeholder="field.placeholder"
              />
              
              <!-- 提示词选择器 -->
              <el-select 
                v-else-if="field.type === 'prompt-select'"
                v-model="toolForm[field.key]" 
                :placeholder="field.placeholder"
                clearable
                filterable
                @change="onPromptChange"
              >
                <el-option 
                  v-for="prompt in getPromptsByCategory(field.category)" 
                  :key="prompt.id" 
                  :label="prompt.title" 
                  :value="prompt.id"
                >
                  <div class="prompt-option">
                    <div class="prompt-option-title">{{ prompt.title }}</div>
                    <div class="prompt-option-desc">{{ prompt.description }}</div>
                  </div>
                </el-option>
              </el-select>
              
              <!-- 下拉选择 -->
              <el-select 
                v-else-if="field.type === 'select'"
                v-model="toolForm[field.key]" 
                :placeholder="field.placeholder"
              >
                <el-option 
                  v-for="option in field.options" 
                  :key="option.value" 
                  :label="option.label" 
                  :value="option.value"
                />
              </el-select>
            </el-form-item>
          </el-form>
        </div>
        
        <div class="tool-actions">
          <el-button type="primary" @click="generateContent" :loading="generating" :disabled="!canGenerate">
            <el-icon><MagicStick /></el-icon>
            {{ generating ? '生成中...' : '生成内容' }}
          </el-button>
          <el-button v-if="generating" @click="stopGeneration">停止生成</el-button>
          <el-button @click="clearForm">
            清空
          </el-button>
        </div>
        
        <!-- 生成进度提示 -->
        <div v-if="generating" class="generating-status">
          <el-progress :percentage="generatingProgress" :show-text="false" />
          <span class="status-text">{{ generatingStatusText }}</span>
        </div>
        
        <!-- 结果显示区 -->
        <div class="tool-result" v-if="generatedContent || generating">
          <h4>生成结果：</h4>
          <div class="result-content-wrapper">
            <el-input
               :model-value="displayContent"
              type="textarea"
              :rows="15"
              readonly
              class="result-textarea"
              placeholder="生成的内容将在这里显示..."
              ref="resultTextarea"
            />
          </div>
          <div class="result-actions" v-if="generatedContent && !generating">
            <el-button @click="copyToClipboard" :disabled="!generatedContent">
              <el-icon><CopyDocument /></el-icon>
              复制
            </el-button>
            <el-button @click="saveResult" :disabled="!generatedContent">
              <el-icon><DocumentAdd /></el-icon>
              保存到本地
            </el-button>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { MagicStick, CopyDocument, DocumentAdd } from '@element-plus/icons-vue'
import { useNovelStore } from '@/stores/novel'
import { useAIStream } from '@/composables/useAIStream'
import { useGenerationTask } from '@/composables/useGenerationTask'
import ToolCatalog from '@/components/tools/ToolCatalog.vue'
import { TOOL_DEFINITIONS as toolsConfig } from '@/config/tools'
import { buildToolPrompt } from '@/utils/toolPrompts'
import { isToolFormComplete } from '@/utils/toolForms'
import { storageGet, StorageKeys } from '@/utils/storage'

const novelStore = useNovelStore()

const showToolDialog = ref(false)
const generatedContent = ref('')
const generatingProgress = ref(0)
const generatingStatusText = ref('')
const toolForm = reactive({})
const resultTextarea = ref(null)

// 小说列表数据
const novelList = ref([])
const selectedNovelChapters = ref([])

// 提示词数据
const availablePrompts = ref([])
const selectedPromptData = ref(null)

// 加载小说列表
const loadNovelList = () => {
  try {
    const savedNovels = storageGet(StorageKeys.novels, [])
    console.log('原始小说数据:', savedNovels) // 调试用
    
    if (!Array.isArray(savedNovels)) {
      console.warn('小说数据不是数组格式')
      novelList.value = []
      return
    }
    
    novelList.value = savedNovels.map(novel => {
      if (!novel || typeof novel !== 'object') {
        return null
      }
      
      return {
        value: novel.id || `novel_${Date.now()}_${Math.random()}`,
        label: novel.title || '未命名小说',
        chapters: Array.isArray(novel.chapterList) ? novel.chapterList : (Array.isArray(novel.chapters) ? novel.chapters : [])
      }
    }).filter(novel => novel !== null) // 过滤掉无效的小说
    
    console.log('处理后的小说列表:', novelList.value) // 调试用
  } catch (error) {
    console.error('加载小说列表失败:', error)
    novelList.value = []
  }
}

// 当选择小说时，更新章节列表
const onNovelChange = (novelId) => {
  console.log('选择的小说ID:', novelId) // 调试用
  const selectedNovel = novelList.value.find(novel => novel.value === novelId)
  console.log('找到的小说:', selectedNovel) // 调试用
  
  if (selectedNovel && selectedNovel.chapters && Array.isArray(selectedNovel.chapters)) {
    console.log('小说章节数据:', selectedNovel.chapters) // 调试用
    selectedNovelChapters.value = selectedNovel.chapters.map(chapter => {
      if (!chapter || typeof chapter !== 'object') {
        return null
      }
      return {
        value: chapter.id || `chapter_${Date.now()}_${Math.random()}`,
        label: chapter.title || '未命名章节',
        content: chapter.content || '',
        description: chapter.description || ''
      }
    }).filter(chapter => chapter !== null)
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
  return toolsConfig[currentToolType.value] || {}
})

const currentToolType = ref('')

// 计算属性：检查是否可以生成
const canGenerate = computed(() => isToolFormComplete(currentTool.value, toolForm))

// 计算属性：显示内容（用于流式输出）
const displayContent = computed(() => {
  return generatedContent.value
})

const openTool = (toolType) => {
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
  Object.keys(toolForm).forEach(key => {
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
  source: () => [showToolDialog.value, currentToolType.value, { ...toolForm }, selectedPromptData.value?.content],
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
        const textarea = resultTextarea.value?.$el.querySelector('textarea')
        if (textarea) textarea.scrollTop = textarea.scrollHeight
      })
    },
    onSuccess: () => {
      generatingProgress.value = 100
      generatingStatusText.value = '生成完成'
      ElMessage.success('内容生成成功！')
    },
    onError: error => {
      generatedContent.value = ''
      generatingProgress.value = 0
      generatingStatusText.value = '生成失败'
      ElMessage.error('生成失败：' + error.message)
    },
  })
}

const buildPrompt = () => buildToolPrompt({
  type: currentToolType.value,
  form: toolForm,
  selectedPrompt: selectedPromptData.value,
  novels: novelList.value,
  chapters: selectedNovelChapters.value,
  originals: storageGet(StorageKeys.novels, []),
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
${currentTool.value.fields.map(field => 
  toolForm[field.key] ? `${field.label}：${toolForm[field.key]}` : ''
).filter(line => line).join('\n')}

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
    const savedPrompts = storageGet(StorageKeys.prompts, null)
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
const getPromptsByCategory = (category) => {
  if (!category) return []
  return availablePrompts.value.filter(prompt => prompt.category === category)
}

// 当选择提示词时
const onPromptChange = (promptId) => {
  console.log('选择的提示词ID:', promptId)
  if (promptId) {
    selectedPromptData.value = availablePrompts.value.find(prompt => prompt.id === promptId)
    console.log('选择的提示词数据:', selectedPromptData.value)
  } else {
    selectedPromptData.value = null
  }
}

// 验证角色数量
const isValidCharacterCount = (count) => {
  const num = parseInt(count)
  return !isNaN(num) && num >= 1 && num <= 15
}

// 角色数量输入验证
const validateCharacterCount = (field, value) => {
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
</script>

<style scoped>
.tools-library {
  max-width: 1200px;
  margin: 0 auto;
}

.tool-dialog .tool-content {
  padding: 20px 0;
}

.tool-form {
  margin-bottom: 24px;
}

.tool-actions {
  text-align: center;
  margin-bottom: 24px;
}

.tool-actions .el-button {
  margin: 0 8px;
}

.generating-status {
  margin: 16px 0;
  text-align: center;
}

.status-text {
  display: block;
  margin-top: 8px;
  color: var(--el-text-color-regular);
  font-size: 14px;
}

.tool-result {
  background: var(--el-fill-color-light);
  border-radius: 8px;
  padding: 20px;
  border: 1px solid #e9ecef;
}

.tool-result h4 {
  margin-top: 0;
  margin-bottom: 16px;
  color: #2c3e50;
}

.result-content-wrapper {
  margin-bottom: 16px;
}

.result-textarea {
  width: 100%;
}

.result-textarea :deep(.el-textarea__inner) {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
}

.result-actions {
  text-align: center;
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}

.result-actions .el-button {
  margin: 4px;
}

/* 小说和章节选择器样式 */
.tool-form .el-select {
  width: 100%;
}

.tool-form .el-select .el-tag {
  max-width: 120px;
}

.tool-form .el-form-item {
  margin-bottom: 18px;
}

/* 提示词选择器样式 */
.prompt-option {
  padding: 8px 0;
}

.prompt-option-title {
  font-weight: 500;
  color: var(--el-text-color-primary);
  margin-bottom: 4px;
}

.prompt-option-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}

/* 角色数量提示样式 */
.character-count-hint {
  margin-top: 5px;
  font-size: 12px;
}

.valid-hint {
  color: var(--el-color-success);
}

.invalid-hint {
  color: var(--el-color-danger);
}

@media (max-width: 768px) {
  
  .tool-dialog {
    width: 95% !important;
  }
  
  .result-actions {
    flex-direction: column;
    align-items: center;
  }
  
  .result-actions .el-button {
    width: 100%;
    max-width: 200px;
  }
}
</style>
