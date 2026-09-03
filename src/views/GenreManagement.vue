<template>
  <div class="genre-management">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <h1>小说类型管理</h1>
        <p>管理小说类型及其相关的提示词和标签</p>
      </div>
      <div class="header-actions">
        <el-button type="primary" @click="showCreateDialog = true">
          <el-icon><Plus /></el-icon>
          添加新类型
        </el-button>
      </div>
    </div>

    <!-- 类型列表 -->
    <div class="genres-grid">
      <div 
        v-for="genre in genres" 
        :key="genre.code"
        class="genre-card"
      >
        <el-card shadow="hover" class="genre-item">
          <div class="genre-header">
            <div class="genre-info">
              <h3 class="genre-name">{{ genre.name }}</h3>
              <el-tag size="small" type="info">{{ genre.code }}</el-tag>
            </div>
            <div class="genre-actions">
              <el-button size="small" type="primary" @click="editGenre(genre)">
                <el-icon><Edit /></el-icon>
                编辑
              </el-button>
              <el-dropdown @command="(cmd) => handleGenreAction(cmd, genre)">
                <el-button size="small" type="text">
                  <el-icon><MoreFilled /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="duplicate">
                      <el-icon><CopyDocument /></el-icon>
                      复制
                    </el-dropdown-item>
                    <el-dropdown-item divided command="delete" :disabled="genre.isDefault">
                      <el-icon><Delete /></el-icon>
                      删除
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
          
          <div class="genre-description">
            <p>{{ genre.prompt }}</p>
          </div>
          
          <div class="genre-tags">
            <el-tag 
              v-for="tag in genre.tags.slice(0, 5)" 
              :key="tag"
              size="small"
              style="margin: 2px 4px 2px 0;"
            >
              {{ tag }}
            </el-tag>
            <el-tag v-if="genre.tags.length > 5" size="small" type="info">
              +{{ genre.tags.length - 5 }}
            </el-tag>
          </div>
          
          <div class="genre-meta">
            <div class="meta-item">
              <el-icon><Calendar /></el-icon>
              <span>{{ formatDate(genre.createdAt) }}</span>
            </div>
            <div class="meta-item" v-if="genre.usageCount">
              <el-icon><Document /></el-icon>
              <span>已使用 {{ genre.usageCount }} 次</span>
            </div>
            <div class="meta-item" v-if="genre.isDefault">
              <el-tag type="warning" size="small">系统预设</el-tag>
            </div>
          </div>
        </el-card>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="genres.length === 0" class="empty-state">
      <el-empty description="暂无类型，创建第一个小说类型吧！">
        <el-button type="primary" @click="showCreateDialog = true">创建类型</el-button>
      </el-empty>
    </div>

    <!-- 创建/编辑类型对话框 -->
    <el-dialog 
      v-model="showCreateDialog" 
      :title="editingGenre ? '编辑类型' : '创建新类型'"
      width="600px"
      @close="resetForm"
    >
      <el-form 
        ref="formRef" 
        :model="genreForm" 
        :rules="genreRules" 
        label-width="100px"
      >
        <el-form-item label="类型代码" prop="code">
          <el-input 
            v-model="genreForm.code" 
            placeholder="例如：urban, fantasy" 
            :disabled="editingGenre?.isDefault"
          />
          <div class="form-tip">用于程序识别的英文代码，不可重复</div>
        </el-form-item>
        
        <el-form-item label="类型名称" prop="name">
          <el-input v-model="genreForm.name" placeholder="例如：都市、玄幻" />
        </el-form-item>
        
        <el-form-item label="创作提示" prop="prompt">
          <el-input 
            v-model="genreForm.prompt" 
            type="textarea" 
            :rows="4"
            placeholder="描述这个类型的创作特点和要求..."
          />
        </el-form-item>
        
        <el-form-item label="关键标签" prop="tags">
          <div class="tags-input-section">
            <el-input 
              v-model="tagInput"
              placeholder="输入标签后按回车添加"
              @keyup.enter="addTag"
            >
              <template #append>
                <el-button @click="addTag">添加</el-button>
              </template>
            </el-input>
            <div class="tags-display" v-if="genreForm.tags.length > 0">
              <el-tag 
                v-for="(tag, index) in genreForm.tags"
                :key="index"
                closable
                @close="removeTag(index)"
                style="margin: 4px 4px 0 0;"
              >
                {{ tag }}
              </el-tag>
            </div>
          </div>
        </el-form-item>
        
        <el-form-item label="示例作品" prop="examples">
          <el-input 
            v-model="genreForm.examples" 
            type="textarea" 
            :rows="2"
            placeholder="列举一些典型的作品或作者（可选）"
          />
        </el-form-item>
      </el-form>
      
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="showCreateDialog = false">取消</el-button>
          <el-button type="primary" @click="saveGenre" :loading="isSaving">
            {{ editingGenre ? '保存修改' : '创建类型' }}
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { storageGet, storageSet, StorageKeys } from '@/utils/storage'
import { 
  Plus, Edit, Delete, Calendar, Document, MoreFilled, CopyDocument 
} from '@element-plus/icons-vue'

// 响应式数据
const genres = ref([])
const showCreateDialog = ref(false)
const editingGenre = ref(null)
const formRef = ref()
const tagInput = ref('')
const isSaving = ref(false)

// 表单数据
const genreForm = ref({
  code: '',
  name: '',
  prompt: '',
  tags: [],
  examples: ''
})

// 表单验证规则
const genreRules = {
  code: [
    { required: true, message: '请输入类型代码', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_-]+$/, message: '代码只能包含字母、数字、下划线和横线', trigger: 'blur' },
    { validator: validateCodeUnique, trigger: 'blur' }
  ],
  name: [
    { required: true, message: '请输入类型名称', trigger: 'blur' }
  ],
  prompt: [
    { required: true, message: '请输入创作提示', trigger: 'blur' }
  ]
}

// 验证代码唯一性
function validateCodeUnique(rule, value, callback) {
  if (!value) {
    callback()
    return
  }
  
  const existingGenre = genres.value.find(g => 
    g.code === value && (!editingGenre.value || g.code !== editingGenre.value.code)
  )
  
  if (existingGenre) {
    callback(new Error('类型代码已存在'))
  } else {
    callback()
  }
}

// 加载默认类型
const loadDefaultGenres = () => {
  const defaultGenres = [
    {
      code: 'fantasy',
      name: '玄幻',
      tags: ['修仙', '异世界', '法宝', '灵气', '境界'],
      prompt: '创作一部玄幻小说，包含修仙体系、异世界冒险等元素，注重世界观构建和修炼体系描写。',
      examples: '《斗破苍穹》、《完美世界》',
      isDefault: true,
      createdAt: new Date(),
      usageCount: 0
    },
    {
      code: 'urban',
      name: '都市',
      tags: ['都市', '现代', '职场', '生活'],
      prompt: '创作一部都市小说，以现代都市为背景，贴近现实生活，注重人物情感和社会现象描写。',
      examples: '《何以笙箫默》、《杜拉拉升职记》',
      isDefault: true,
      createdAt: new Date(),
      usageCount: 0
    },
    {
      code: 'history',
      name: '历史',
      tags: ['历史', '古代', '朝廷', '战争'],
      prompt: '创作一部历史小说，以真实历史为背景，注重历史考证和时代特色描写。',
      examples: '《明朝那些事儿》、《康熙大帝》',
      isDefault: true,
      createdAt: new Date(),
      usageCount: 0
    },
    {
      code: 'scifi',
      name: '科幻',
      tags: ['科幻', '未来', '科技', '太空'],
      prompt: '创作一部科幻小说，包含未来科技、太空探索等元素，注重科学性和想象力的平衡。',
      examples: '《三体》、《银河系漫游指南》',
      isDefault: true,
      createdAt: new Date(),
      usageCount: 0
    },
    {
      code: 'wuxia',
      name: '武侠',
      tags: ['武侠', '江湖', '武功', '侠义'],
      prompt: '创作一部武侠小说，以江湖为背景，注重武功描写和侠义精神体现。',
      examples: '《射雕英雄传》、《天龙八部》',
      isDefault: true,
      createdAt: new Date(),
      usageCount: 0
    },
    {
      code: 'romance',
      name: '言情',
      tags: ['言情', '爱情', '情感', '浪漫'],
      prompt: '创作一部言情小说，以爱情为主线，注重情感描写和人物关系发展。',
      examples: '《简爱》、《傲慢与偏见》',
      isDefault: true,
      createdAt: new Date(),
      usageCount: 0
    }
  ]
  return defaultGenres
}

// 加载类型数据
const loadGenres = () => {
  try {
    const parsed = storageGet(StorageKeys.novelGenres, null)
    if (parsed) {
      // 确保包含默认类型
      const defaultGenres = loadDefaultGenres()
      const savedCodes = parsed.map(g => g.code)
      const missingDefaults = defaultGenres.filter(g => !savedCodes.includes(g.code))
      genres.value = [...parsed, ...missingDefaults]
    } else {
      // 首次加载，使用默认类型
      genres.value = loadDefaultGenres()
      saveGenres()
    }
  } catch (error) {
    console.error('加载类型数据失败:', error)
    genres.value = loadDefaultGenres()
  }
}

// 保存类型数据
const saveGenres = () => {
  try {
    storageSet(StorageKeys.novelGenres, genres.value)
    console.log('类型数据已保存:', genres.value)
  } catch (error) {
    console.error('保存类型数据失败:', error)
    ElMessage.error('保存数据失败')
  }
}

// 编辑类型
const editGenre = (genre) => {
  editingGenre.value = genre
  genreForm.value = {
    code: genre.code,
    name: genre.name,
    prompt: genre.prompt,
    tags: [...genre.tags],
    examples: genre.examples || ''
  }
  showCreateDialog.value = true
}

// 处理类型操作
const handleGenreAction = async (command, genre) => {
  switch (command) {
    case 'duplicate':
      duplicateGenre(genre)
      break
    case 'delete':
      await deleteGenre(genre)
      break
  }
}

// 复制类型
const duplicateGenre = (genre) => {
  genreForm.value = {
    code: `${genre.code}_copy`,
    name: `${genre.name}（副本）`,
    prompt: genre.prompt,
    tags: [...genre.tags],
    examples: genre.examples || ''
  }
  editingGenre.value = null
  showCreateDialog.value = true
}

// 删除类型
const deleteGenre = async (genre) => {
  if (genre.isDefault) {
    ElMessage.warning('系统预设类型不能删除')
    return
  }
  
  try {
    await ElMessageBox.confirm(
      `确定要删除类型"${genre.name}"吗？此操作不可恢复。`,
      '确认删除',
      { type: 'warning' }
    )
    
    const index = genres.value.findIndex(g => g.code === genre.code)
    if (index > -1) {
      genres.value.splice(index, 1)
      saveGenres()
      ElMessage.success('类型删除成功')
    }
  } catch {
    // 用户取消删除
  }
}

// 添加标签
const addTag = () => {
  const tag = tagInput.value.trim()
  if (tag && !genreForm.value.tags.includes(tag)) {
    genreForm.value.tags.push(tag)
    tagInput.value = ''
  }
}

// 移除标签
const removeTag = (index) => {
  genreForm.value.tags.splice(index, 1)
}

// 保存类型
const saveGenre = async () => {
  try {
    await formRef.value.validate()
    isSaving.value = true
    
    const genreData = {
      ...genreForm.value,
      tags: genreForm.value.tags.filter(tag => tag.trim()),
      createdAt: editingGenre.value?.createdAt || new Date(),
      updatedAt: new Date(),
      usageCount: editingGenre.value?.usageCount || 0,
      isDefault: editingGenre.value?.isDefault || false
    }
    
    if (editingGenre.value) {
      // 编辑现有类型
      const index = genres.value.findIndex(g => g.code === editingGenre.value.code)
      if (index > -1) {
        genres.value[index] = genreData
      }
      ElMessage.success('类型更新成功')
    } else {
      // 创建新类型
      genres.value.push(genreData)
      ElMessage.success('类型创建成功')
    }
    
    saveGenres()
    showCreateDialog.value = false
    resetForm()
  } catch (error) {
    console.error('保存类型失败:', error)
  } finally {
    isSaving.value = false
  }
}

// 重置表单
const resetForm = () => {
  genreForm.value = {
    code: '',
    name: '',
    prompt: '',
    tags: [],
    examples: ''
  }
  tagInput.value = ''
  editingGenre.value = null
  formRef.value?.clearValidate()
}

// 格式化日期
const formatDate = (date) => {
  return new Date(date).toLocaleDateString('zh-CN')
}

// 生命周期
onMounted(() => {
  loadGenres()
})
</script>

<style scoped>
.genre-management {
  padding: 0;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  padding: 24px;
  background: var(--el-bg-color);
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
}

.header-content h1 {
  margin: 0 0 8px 0;
  font-size: 24px;
  color: var(--el-text-color-primary);
}

.header-content p {
  margin: 0;
  color: var(--el-text-color-regular);
  font-size: 14px;
}

.genres-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 20px;
  padding: 0 24px;
}

.genre-item {
  border: none;
  transition: all 0.3s;
}

.genre-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
}

.genre-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

.genre-info {
  flex: 1;
}

.genre-name {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.genre-actions {
  display: flex;
  gap: 8px;
}

.genre-description {
  margin-bottom: 16px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  border-left: 3px solid var(--brand-500);
}

.genre-description p {
  margin: 0;
  color: var(--el-text-color-regular);
  line-height: 1.6;
}

.genre-tags {
  margin-bottom: 16px;
  min-height: 32px;
}

.genre-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tags-input-section {
  width: 100%;
}

.tags-display {
  margin-top: 8px;
}

.form-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.empty-state {
  padding: 60px 24px;
  text-align: center;
}

.dialog-footer {
  text-align: right;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .genres-grid {
    grid-template-columns: 1fr;
    padding: 0 16px;
  }
  
  .page-header {
    flex-direction: column;
    gap: 16px;
    align-items: stretch;
    padding: 16px;
  }
}
</style>
