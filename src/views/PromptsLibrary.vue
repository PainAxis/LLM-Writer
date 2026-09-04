<template>
  <div class="prompts-library">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <h1>提示词库</h1>
        <p>精选的AI写作提示词，助力您的创作</p>
      </div>
      <div class="header-actions">
        <el-button type="success" @click="showImportDialog = true">
          <el-icon><Upload /></el-icon>
          导入提示词
        </el-button>
        <el-button type="primary" @click="showAddDialog = true">
          <el-icon><Plus /></el-icon>
          添加提示词
        </el-button>
      </div>
    </div>

    <!-- 分类筛选 -->
    <div class="filter-section">
      <el-card shadow="never">
        <div class="filter-content">
          <div class="category-tabs">
            <el-button
              v-for="category in categories"
              :key="category.key"
              :type="activeCategory === category.key ? 'primary' : 'default'"
              @click="activeCategory = category.key"
              class="category-btn"
            >
              {{ category.icon }} {{ category.name }}
            </el-button>
          </div>
          
          <div class="search-box">
            <el-input
              v-model="searchKeyword"
              placeholder="搜索提示词..."
              clearable
              @input="handleSearch"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 提示词列表 -->
    <div class="prompts-grid">
      <div 
        v-for="prompt in filteredPrompts" 
        :key="prompt.id"
        class="prompt-card"
      >
        <el-card shadow="hover" class="prompt-item">
          <div class="prompt-header">
            <div class="prompt-title">
              <span class="category-icon">{{ getCategoryIcon(prompt.category) }}</span>
              <h3>{{ prompt.title }}</h3>
            </div>
            <div class="prompt-actions">
              <el-dropdown trigger="click">
                <el-button type="text" size="small">
                  <el-icon><MoreFilled /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>

                    <el-dropdown-item @click="editPrompt(prompt)">
                      <el-icon><Edit /></el-icon>
                      编辑
                    </el-dropdown-item>
                    <el-dropdown-item @click="copyPrompt(prompt)">
                      <el-icon><CopyDocument /></el-icon>
                      复制
                    </el-dropdown-item>
                    <el-dropdown-item divided @click="deletePrompt(prompt)">
                      <el-icon><Delete /></el-icon>
                      删除
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
          
          <div class="prompt-description">
            <p>{{ prompt.description }}</p>
          </div>
          
          <div class="prompt-content">
            <div class="content-preview">
              {{ prompt.content.substring(0, 150) }}{{ prompt.content.length > 150 ? '...' : '' }}
            </div>
          </div>
          
          <div class="prompt-footer">
            <div class="prompt-tags">
              <el-tag 
                v-for="tag in prompt.tags" 
                :key="tag"
                size="small"
                type="info"
              >
                {{ tag }}
              </el-tag>
            </div>

          </div>
        </el-card>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="filteredPrompts.length === 0" class="empty-state">
      <el-empty description="暂无匹配的提示词">
        <el-button type="primary" @click="showAddDialog = true">添加提示词</el-button>
      </el-empty>
    </div>

    <!-- 添加/编辑提示词对话框 -->
    <el-dialog 
      v-model="showAddDialog" 
      :title="editingPrompt ? '编辑提示词' : '添加提示词'" 
      width="800px"
      @close="resetForm"
    >
      <el-form 
        ref="formRef" 
        :model="promptForm" 
        :rules="formRules" 
        label-width="100px"
      >
        <el-form-item label="标题" prop="title">
          <el-input v-model="promptForm.title" placeholder="请输入提示词标题" />
        </el-form-item>
        
        <el-form-item label="分类" prop="category">
          <el-select v-model="promptForm.category" placeholder="请选择分类">
            <el-option 
              v-for="category in categories.filter(c => c.key !== 'all')"
              :key="category.key"
              :label="category.name"
              :value="category.key"
            />
          </el-select>
        </el-form-item>
        
        <el-form-item label="描述" prop="description">
          <el-input 
            v-model="promptForm.description" 
            type="textarea" 
            :rows="2"
            placeholder="请输入提示词描述"
          />
        </el-form-item>
        
        <el-form-item label="内容" prop="content">
          <div class="content-input-area">
            <div class="content-toolbar">
              <el-button 
                size="small" 
                @click="insertWorldviewTemplate"
                v-if="promptForm.category === 'worldview'"
              >
                📖 插入世界观模板
              </el-button>
              <el-button 
                size="small" 
                @click="insertFormatTemplate"
              >
                🎯 插入格式模板
              </el-button>
            </div>
            <el-input 
              v-model="promptForm.content" 
              type="textarea" 
              :rows="12"
              placeholder="请输入提示词内容，可以使用 {变量名} 作为占位符"
            />
          </div>
        </el-form-item>
        
        <el-form-item label="标签">
          <el-input 
            v-model="tagInput"
            placeholder="输入标签后按回车添加"
            @keyup.enter="addTag"
          >
            <template #append>
              <el-button @click="addTag">添加</el-button>
            </template>
          </el-input>
          <div class="tags-display" v-if="promptForm.tags.length > 0">
            <el-tag 
              v-for="(tag, index) in promptForm.tags"
              :key="index"
              closable
              @close="removeTag(index)"
              style="margin: 5px 5px 0 0;"
            >
              {{ tag }}
            </el-tag>
          </div>
        </el-form-item>
      </el-form>
      
      <template #footer>
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" @click="savePrompt">保存</el-button>
      </template>
    </el-dialog>

    <!-- 导入提示词对话框 -->
    <el-dialog v-model="showImportDialog" title="导入提示词" width="600px">
      <div class="import-content">
        <el-alert 
          title="导入说明" 
          type="info" 
          :closable="false"
          style="margin-bottom: 20px;"
        >
          <div>
            <p>请选择JSON文件或直接粘贴JSON内容来导入提示词</p>
            <p><strong>支持的格式：</strong></p>
            <ul>
              <li>系统导出格式：<code>{"prompts": [...], "exportTime": "...", "type": "prompts"}</code></li>
              <li>提示词数组：<code>[{"title": "标题1", ...}, {"title": "标题2", ...}]</code></li>
              <li>单个提示词对象：<code>{"title": "标题", "category": "分类", ...}</code></li>
            </ul>
          </div>
        </el-alert>
        
        <el-tabs v-model="importMethod" type="border-card">
          <el-tab-pane label="文件导入" name="file">
            <div class="file-import">
              <el-upload
                ref="uploadRef"
                :auto-upload="false"
                :show-file-list="false"
                accept=".json"
                :on-change="handleFileChange"
                drag
              >
                <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
                <div class="el-upload__text">
                  将JSON文件拖到此处，或<em>点击上传</em>
                </div>
                <template #tip>
                  <div class="el-upload__tip">
                    只能上传JSON文件
                  </div>
                </template>
              </el-upload>
            </div>
          </el-tab-pane>
          
          <el-tab-pane label="文本导入" name="text">
            <div class="text-import">
              <el-input
                v-model="importJsonText"
                type="textarea"
                :rows="12"
                placeholder="请粘贴JSON格式的提示词数据..."
              />
            </div>
          </el-tab-pane>
        </el-tabs>
        
        <div v-if="previewPrompts.length > 0" class="preview-section">
          <h4>预览导入的提示词 ({{ previewPrompts.length }}条)</h4>
          <div class="preview-list">
            <div 
              v-for="(prompt, index) in previewPrompts" 
              :key="index"
              class="preview-item"
            >
              <div class="preview-header">
                <span class="preview-title">{{ prompt.title }}</span>
                <el-tag size="small">{{ getCategoryName(prompt.category) }}</el-tag>
              </div>
              <div class="preview-description">{{ prompt.description }}</div>
            </div>
          </div>
        </div>
      </div>
      
      <template #footer>
        <el-button @click="cancelImport">取消</el-button>
        <el-button @click="parseImportData">解析数据</el-button>
        <el-button 
          type="primary" 
          @click="confirmImport"
          :disabled="previewPrompts.length === 0"
        >
          确认导入 ({{ previewPrompts.length }}条)
        </el-button>
      </template>
    </el-dialog>


  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Plus, Search, MoreFilled, Edit, CopyDocument, 
  Delete, Upload, UploadFilled
} from '@element-plus/icons-vue'
import { storageGet, storageSet, StorageKeys } from '@/utils/storage'
import { DEFAULT_PROMPTS, PROMPTS_VERSION, mergeDefaultPrompts } from '../config/defaultPrompts'

// 响应式数据
const activeCategory = ref('all')
const searchKeyword = ref('')
const showAddDialog = ref(false)

const showImportDialog = ref(false)
const editingPrompt = ref(null)

const tagInput = ref('')
const formRef = ref()
const uploadRef = ref()

// 导入相关数据
const importMethod = ref('file')
const importJsonText = ref('')
const previewPrompts = ref([])

// 分类定义
const categories = ref([
  { key: 'all', name: '全部', icon: '📝' },
  { key: 'outline', name: '大纲', icon: '📋' },
  { key: 'content', name: '基础正文', icon: '📝' },
  { key: 'content-dialogue', name: '对话生成', icon: '💬' },
  { key: 'content-scene', name: '场景描写', icon: '🏞️' },
  { key: 'content-action', name: '动作情节', icon: '⚡' },
  { key: 'content-psychology', name: '心理描写', icon: '🧠' },
  { key: 'continue', name: '智能续写', icon: '➡️' },
  { key: 'polish', name: '润色优化', icon: '✨' },
  { key: 'character', name: '人设生成', icon: '👤' },
  { key: 'expand', name: '扩写', icon: '📈' },
  { key: 'rewrite', name: '改写', icon: '🔄' },
  { key: 'title', name: '标题', icon: '🏷️' },
  { key: 'cheat', name: '金手指', icon: '🎯' },
  { key: 'opening', name: '黄金开篇', icon: '🌟' },
  { key: 'inspiration', name: '灵感激发', icon: '💡' },
  { key: 'worldview', name: '世界观生成', icon: '🌍' },
  { key: 'brainstorm', name: '脑洞生成', icon: '🧠' },
  { key: 'short-story', name: '短篇小说', icon: '📖' },
  { key: 'book-analysis', name: '拆书分析', icon: '📚' }
])

// 提示词数据
const prompts = ref([])

// 表单数据
const promptForm = ref({
  title: '',
  category: '',
  description: '',
  content: '',
  tags: []
})

// 表单验证规则
const formRules = {
  title: [{ required: true, message: '请输入标题', trigger: 'blur' }],
  category: [{ required: true, message: '请选择分类', trigger: 'change' }],
  description: [{ required: true, message: '请输入描述', trigger: 'blur' }],
  content: [{ required: true, message: '请输入内容', trigger: 'blur' }]
}



// 计算属性
const filteredPrompts = computed(() => {
  let result = prompts.value
  
  // 分类筛选
  if (activeCategory.value !== 'all') {
    result = result.filter(prompt => prompt.category === activeCategory.value)
  }
  
  // 关键词搜索
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase()
    result = result.filter(prompt => 
      prompt.title.toLowerCase().includes(keyword) ||
      prompt.description.toLowerCase().includes(keyword) ||
      prompt.content.toLowerCase().includes(keyword) ||
      prompt.tags.some(tag => tag.toLowerCase().includes(keyword))
    )
  }
  
  return result
})

// 方法
const getCategoryIcon = (category) => {
  const cat = categories.value.find(c => c.key === category)
  return cat ? cat.icon : '📝'
}

const handleSearch = () => {
  // 搜索逻辑已在计算属性中处理
}



const editPrompt = (prompt) => {
  editingPrompt.value = prompt
  promptForm.value = { ...prompt }
  showAddDialog.value = true
}

const copyPrompt = async (prompt) => {
  try {
    await navigator.clipboard.writeText(prompt.content)
    ElMessage.success('提示词已复制到剪贴板')
  } catch {
    ElMessage.error('复制失败')
  }
}

const deletePrompt = async (prompt) => {
  try {
    await ElMessageBox.confirm('确定要删除这个提示词吗？', '确认删除', {
      type: 'warning'
    })
    
    const index = prompts.value.findIndex(p => p.id === prompt.id)
    if (index > -1) {
      prompts.value.splice(index, 1)
      savePrompts()
      ElMessage.success('删除成功')
    }
  } catch {
    // 用户取消删除
  }
}

const insertWorldviewTemplate = () => {
  const template = `【世界观设定解析指南】

===== 核心设定 =====
世界类型：{世界类型}
时间背景：{时间背景}
技术水平：{技术水平}
魔法/修真体系：{力量体系}

===== 社会结构 =====
政治制度：{政治制度}
经济模式：{经济模式}
阶级分层：{阶级分层}
文化特色：{文化特色}

===== 特殊机制 =====
独特法则：{独特法则}
限制条件：{限制条件}
冲突矛盾：{冲突矛盾}

===== 关键元素 =====
重要设施：{重要设施}
特殊物品：{特殊物品}
势力组织：{势力组织}

===== 故事背景 =====
主要冲突：{主要冲突}
时代特征：{时代特征}

请基于以上世界观设定，创作一个{故事类型}故事，主角是{主角设定}，情节围绕{核心情节}展开。

注意保持世界观的一致性和逻辑性，所有描写都要符合已设定的规则体系。`

  promptForm.value.content = template
}

const insertFormatTemplate = () => {
  const template = `【固定输出格式】

请严格按照以下格式输出：

## 标题
{生成的内容标题}

## 内容
{主要内容，确保逻辑清晰}

## 关键要素
- 人物：{人物介绍}
- 设定：{世界观要素}
- 冲突：{主要矛盾}

## 续写提示
{为后续情节发展提供的建议}

---
请确保输出严格遵循上述格式，不要遗漏任何部分。`

  if (promptForm.value.content) {
    promptForm.value.content += '\n\n' + template
  } else {
    promptForm.value.content = template
  }
}

const addTag = () => {
  if (tagInput.value.trim() && !promptForm.value.tags.includes(tagInput.value.trim())) {
    promptForm.value.tags.push(tagInput.value.trim())
    tagInput.value = ''
  }
}

const removeTag = (index) => {
  promptForm.value.tags.splice(index, 1)
}

const savePrompt = async () => {
  try {
    await formRef.value.validate()
    
    if (editingPrompt.value) {
      // 编辑模式
      const index = prompts.value.findIndex(p => p.id === editingPrompt.value.id)
      if (index > -1) {
        prompts.value[index] = { ...promptForm.value, id: editingPrompt.value.id }
      }
      ElMessage.success('提示词更新成功')
    } else {
      // 新增模式
      const newPrompt = {
        ...promptForm.value,
        id: Date.now()
      }
      prompts.value.push(newPrompt)
      ElMessage.success('提示词添加成功')
    }
    
    showAddDialog.value = false
    resetForm()
    savePrompts()
  } catch {
    // 验证失败
  }
}

const resetForm = () => {
  promptForm.value = {
    title: '',
    category: '',
    description: '',
    content: '',
    tags: []
  }
  editingPrompt.value = null
  tagInput.value = ''
}



// 导入功能相关方法
const getCategoryName = (categoryKey) => {
  const category = categories.value.find(c => c.key === categoryKey)
  return category ? category.name : '未知分类'
}

const handleFileChange = (file) => {
  const reader = new FileReader()
  reader.onload = (e) => {
    importJsonText.value = e.target.result
    parseImportData()
  }
  reader.readAsText(file.raw)
}

const parseImportData = () => {
  previewPrompts.value = []
  
  if (!importJsonText.value.trim()) {
    ElMessage.warning('请输入JSON内容或选择文件')
    return
  }
  
  try {
    const data = JSON.parse(importJsonText.value)
    let importData = []
    
    // 支持不同的格式
    if (data.prompts && Array.isArray(data.prompts)) {
      // 系统导出格式：{"prompts": [...], "exportTime": "...", "type": "prompts"}
      importData = data.prompts
    } else if (Array.isArray(data)) {
      // 纯数组格式：[{...}, {...}]
      importData = data
    } else if (data.title && data.category) {
      // 单个提示词对象格式：{title: "...", category: "..."}
      importData = [data]
    } else {
      throw new Error('不支持的数据格式')
    }
    
    // 验证和处理每个提示词对象
    const validPrompts = []
    const errors = []
    
    importData.forEach((item, index) => {
      const validation = validatePromptItem(item, index)
      if (validation.valid) {
        validPrompts.push(validation.prompt)
      } else {
        errors.push(validation.error)
      }
    })
    
    if (errors.length > 0) {
      ElMessage.error(`发现 ${errors.length} 个错误：\n${errors.join('\n')}`)
    }
    
    if (validPrompts.length > 0) {
      previewPrompts.value = validPrompts
      
      // 检测是否为系统导出格式
      const isSystemExport = data.prompts && data.exportTime && data.type === 'prompts'
      if (isSystemExport) {
        const exportTime = new Date(data.exportTime).toLocaleString()
        ElMessage.success(`成功解析系统导出文件（导出时间：${exportTime}），共 ${validPrompts.length} 个提示词`)
      } else {
        ElMessage.success(`成功解析 ${validPrompts.length} 个提示词`)
      }
    } else {
      ElMessage.error('没有找到有效的提示词数据')
    }
    
  } catch (error) {
    ElMessage.error('JSON格式错误：' + error.message)
  }
}

const validatePromptItem = (item, index) => {
  const requiredFields = ['title', 'category', 'description', 'content']
  const missing = requiredFields.filter(field => !item[field])
  
  if (missing.length > 0) {
    return {
      valid: false,
      error: `第${index + 1}项缺少必需字段：${missing.join(', ')}`
    }
  }
  
  // 验证分类是否有效
  const validCategories = categories.value.map(c => c.key).filter(k => k !== 'all')
  if (!validCategories.includes(item.category)) {
    return {
      valid: false,
      error: `第${index + 1}项分类"${item.category}"无效，请使用：${validCategories.join(', ')}`
    }
  }
  
  // 构造标准的提示词对象
  const prompt = {
    id: Date.now() + Math.random(), // 临时ID，导入时会重新生成
    title: item.title.trim(),
    category: item.category,
    description: item.description.trim(),
    content: item.content.trim(),
    tags: Array.isArray(item.tags) ? item.tags : [],
    
    isDefault: false
  }
  
  return { valid: true, prompt }
}

const confirmImport = () => {
  if (previewPrompts.value.length === 0) {
    ElMessage.warning('没有可导入的提示词')
    return
  }
  
  // 重新生成ID避免冲突
  const newPrompts = previewPrompts.value.map(prompt => ({
    ...prompt,
    id: Date.now() + Math.random()
  }))
  
  // 添加到现有提示词列表
  prompts.value.push(...newPrompts)
  
  // 保存到本地存储
  savePrompts()
  
  ElMessage.success(`成功导入 ${newPrompts.length} 个提示词`)
  
  // 重置导入状态
  cancelImport()
}

const cancelImport = () => {
  showImportDialog.value = false
  importJsonText.value = ''
  previewPrompts.value = []
  importMethod.value = 'file'
}

// 生命周期
onMounted(() => {
  // 加载提示词数据
  loadPrompts()
})

// 加载提示词数据（内置默认库升级时自动合并刷新，用户自建模板保留）
const loadPrompts = () => {
  const parsed = storageGet(StorageKeys.prompts, null)
  if (parsed && Array.isArray(parsed)) {
    try {
      const version = storageGet(StorageKeys.promptsVersion, 0)
      if (version !== PROMPTS_VERSION) {
        prompts.value = mergeDefaultPrompts(parsed)
        savePrompts()
        storageSet(StorageKeys.promptsVersion, PROMPTS_VERSION)
      } else {
        prompts.value = parsed
      }
    } catch (error) {
      console.error('加载提示词失败:', error)
      prompts.value = getDefaultPrompts()
      savePrompts()
    }
  } else {
    prompts.value = getDefaultPrompts()
    savePrompts()
    storageSet(StorageKeys.promptsVersion, PROMPTS_VERSION)
  }
}

// 获取默认提示词数据（统一来源于 config/defaultPrompts.ts）
const getDefaultPrompts = () => {
  return DEFAULT_PROMPTS.map((p) => ({ ...p }))
}

// 保存提示词数据
const savePrompts = () => {
  try {
    storageSet(StorageKeys.prompts, prompts.value)
  } catch (error) {
    console.error('保存提示词失败:', error)
  }
}
</script>

<style scoped>
.prompts-library {
  padding: 0;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 20px;
  background: var(--el-bg-color);
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.header-content h1 {
  margin: 0 0 5px 0;
  font-size: 24px;
  color: var(--el-text-color-primary);
}

.header-content p {
  margin: 0;
  color: var(--el-text-color-regular);
  font-size: 14px;
}

.filter-section {
  margin-bottom: 20px;
}

.filter-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}

.category-tabs {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.category-btn {
  border-radius: 20px;
  padding: 8px 16px;
}

.search-box {
  width: 300px;
}

.prompts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

.prompt-card {
  height: 100%;
}

.prompt-item {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.prompt-item :deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.prompt-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
}

.prompt-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.category-icon {
  font-size: 18px;
}

.prompt-title h3 {
  margin: 0;
  font-size: 16px;
  color: var(--el-text-color-primary);
  line-height: 1.4;
}

.prompt-description {
  margin-bottom: 15px;
}

.prompt-description p {
  margin: 0;
  color: var(--el-text-color-regular);
  font-size: 14px;
  line-height: 1.5;
}

.prompt-content {
  flex: 1;
  margin-bottom: 15px;
}

.content-preview {
  background: var(--el-fill-color-light);
  padding: 12px;
  border-radius: 6px;
  font-size: 13px;
  color: #666;
  line-height: 1.4;
  border-left: 3px solid var(--brand-500);
}

.prompt-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
}

.prompt-tags {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}



.empty-state {
  padding: 60px 0;
}

.tags-display {
  margin-top: 10px;
}

.content-input-area {
  width: 100%;
}

.content-toolbar {
  margin-bottom: 8px;
  display: flex;
  gap: 8px;
  align-items: center;
}

.content-toolbar .el-button {
  border-radius: 4px;
  font-size: 12px;
}

.use-prompt-content h4 {
  margin: 0 0 10px 0;
  color: var(--el-text-color-primary);
}

.use-prompt-content p {
  margin: 0 0 20px 0;
  color: var(--el-text-color-regular);
}

.generated-prompt {
  margin-top: 20px;
}

.generated-prompt h5 {
  margin: 0 0 10px 0;
  color: var(--el-text-color-primary);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    gap: 15px;
    text-align: center;
  }
  
  .filter-content {
    flex-direction: column;
    gap: 15px;
  }
  
  .search-box {
    width: 100%;
  }
  
  .prompts-grid {
    grid-template-columns: 1fr;
  }
  
  .category-tabs {
    justify-content: center;
  }
}

/* 导入功能样式 */
.import-content {
  padding: 10px 0;
}

.import-content .el-alert :deep(.el-alert__description) {
  line-height: 1.6;
}

.import-content .el-alert ul {
  margin: 10px 0 0 0;
  padding-left: 20px;
}

.import-content .el-alert li {
  margin: 5px 0;
}

.import-content code {
  background: #f1f2f6;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
  font-size: 12px;
}

.file-import {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.text-import {
  padding: 20px;
}

.preview-section {
  margin-top: 20px;
  border-top: 1px solid #ebeef5;
  padding-top: 20px;
}

.preview-section h4 {
  margin: 0 0 15px 0;
  color: var(--el-text-color-primary);
  font-size: 16px;
}

.preview-list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid #ebeef5;
  border-radius: 6px;
}

.preview-item {
  padding: 12px 16px;
  border-bottom: 1px solid #f5f7fa;
  transition: background-color 0.2s;
}

.preview-item:last-child {
  border-bottom: none;
}

.preview-item:hover {
  background-color: var(--el-fill-color-light);
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
}

.preview-title {
  font-weight: 500;
  color: var(--el-text-color-primary);
  flex: 1;
  margin-right: 10px;
}

.preview-description {
  color: var(--el-text-color-regular);
  font-size: 13px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.el-tabs--border-card :deep(.el-tabs__content) {
  padding: 20px;
}

.el-upload--text {
  width: 100%;
}

.el-upload-dragger {
  width: 100%;
}
</style>
