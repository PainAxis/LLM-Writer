<template>
  <el-dialog
    v-model="visible"
    title="AI批量生成角色"
    width="900px"
    :close-on-click-modal="!importing"
    :close-on-press-escape="!importing"
    :show-close="!importing"
  >
    <div class="batch-generate-content">
      <!-- 配置区域 -->
      <el-card v-if="!generating && results.length === 0" shadow="never" class="config-section">
        <template #header>
          <span>⚙️ 生成配置</span>
        </template>

        <el-form label-width="120px" size="default">
          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item label="生成数量">
                <el-input-number v-model="config.count" :min="2" :max="10" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="角色类型">
                <div class="character-type-options">
                  <el-checkbox v-model="config.includeMainCharacters">主角</el-checkbox>
                  <el-checkbox v-model="config.includeSupportingCharacters">配角</el-checkbox>
                  <el-checkbox v-model="config.includeMinorCharacters">次要角色</el-checkbox>
                </div>
              </el-form-item>
            </el-col>
          </el-row>

          <!-- 提示词选择 -->
          <el-form-item label="使用提示词">
            <div style="display: flex; gap: 10px; align-items: center">
              <el-button type="primary" plain size="small" @click="emit('request-prompt')">
                📝 选择提示词
              </el-button>
              <span v-if="selectedPrompt" class="selected-prompt-info">
                已选择：{{ selectedPrompt.title }}
              </span>
              <el-button
                v-if="selectedPrompt"
                link
                size="small"
                type="danger"
                @click="emit('clear-prompt')"
              >
                清除
              </el-button>
            </div>
          </el-form-item>

          <el-form-item label="特殊要求">
            <el-input
              v-model="config.customPrompt"
              type="textarea"
              :rows="3"
              placeholder="例如：需要包含反派角色、特定职业角色、具有魔法能力的角色等..."
            />
          </el-form-item>

          <el-form-item label="智能分配">
            <el-checkbox v-model="config.autoAssignRoles"> 自动平衡角色关系和重要性 </el-checkbox>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 流式生成区域 -->
      <el-card v-if="generating" shadow="never" class="streaming-section">
        <template #header>
          <span>🤖 AI正在生成角色...</span>
        </template>

        <div class="streaming-content-container">
          <div class="streaming-content">{{ streamingContent }}</div>
        </div>
      </el-card>

      <!-- 生成结果区域 -->
      <el-card v-if="!generating && results.length > 0" shadow="never" class="results-section">
        <template #header>
          <div class="results-header">
            <span>✨ 生成结果 ({{ results.length }}个角色)</span>
            <div class="result-actions">
              <el-button size="small" @click="selectAll(true)">全选</el-button>
              <el-button size="small" @click="selectAll(false)">全不选</el-button>
            </div>
          </div>
        </template>

        <div class="generated-characters-grid">
          <div
            v-for="character in results"
            :key="character.id"
            class="generated-character-card"
            :class="{ selected: character.selected !== false }"
            @click="toggleCharacterSelection(character)"
          >
            <div class="character-header">
              <div class="character-avatar-preview">
                <div class="default-avatar">{{ character.name?.charAt(0) || '？' }}</div>
              </div>
              <div class="character-basic-info">
                <h4>{{ character.name }}</h4>
                <div class="character-meta">
                  <el-tag :type="getRoleType(character.role)" size="small">
                    {{ getRoleText(character.role) }}
                  </el-tag>
                  <el-tag type="info" size="small">{{ getGenderText(character.gender) }}</el-tag>
                  <span class="age-text">{{ character.age }}岁</span>
                </div>
              </div>
              <div class="selection-indicator">
                <el-icon v-if="character.selected !== false" class="selected-icon">
                  <Check />
                </el-icon>
              </div>
            </div>

            <div class="character-details">
              <div class="detail-item">
                <label>外貌：</label>
                <p>{{ character.appearance || '暂无描述' }}</p>
              </div>
              <div class="detail-item">
                <label>性格：</label>
                <p>{{ character.personality || '暂无描述' }}</p>
              </div>
              <div class="detail-item">
                <label>背景：</label>
                <p>{{ character.background || '暂无描述' }}</p>
              </div>
              <div v-if="character.tags?.length" class="character-tags-preview">
                <el-tag v-for="tag in character.tags" :key="tag" size="small">
                  {{ tag }}
                </el-tag>
              </div>
            </div>
          </div>
        </div>
      </el-card>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button :disabled="importing" @click="visible = false">取消</el-button>
        <el-button
          v-if="!generating && results.length === 0"
          type="primary"
          :disabled="!hasSelectedCharacterType"
          @click="emit('generate')"
        >
          🚀 开始生成
        </el-button>
        <el-button
          v-if="!generating && results.length > 0"
          :disabled="importing"
          @click="emit('generate')"
        >
          🔄 重新生成
        </el-button>
        <el-button
          v-if="!generating && results.length > 0"
          type="primary"
          :loading="importing"
          @click="importSelected"
        >
          ✅ 添加选中角色
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Check } from '@element-plus/icons-vue'
import type {
  PromptTemplate,
  WriterBatchCharacterGenerationConfig,
  WriterCharacter,
} from '@/types/writer'

type TagType = 'primary' | 'success' | 'warning' | 'info' | 'danger'

const visible = defineModel<boolean>({ required: true })
const config = defineModel<WriterBatchCharacterGenerationConfig>('config', { required: true })
const results = defineModel<WriterCharacter[]>('results', { required: true })

defineProps<{
  generating: boolean
  importing: boolean
  selectedPrompt: Pick<PromptTemplate, 'id' | 'title'> | null
  streamingContent: string
}>()

const emit = defineEmits<{
  'request-prompt': []
  'clear-prompt': []
  generate: []
  import: [characters: WriterCharacter[]]
}>()

const hasSelectedCharacterType = computed(
  () =>
    config.value.includeMainCharacters ||
    config.value.includeSupportingCharacters ||
    config.value.includeMinorCharacters
)

const selectAll = (selected: boolean) => {
  results.value = results.value.map((character) => ({ ...character, selected }))
}

const toggleCharacterSelection = (target: WriterCharacter) => {
  results.value = results.value.map((character) =>
    character === target
      ? { ...character, selected: character.selected !== false ? false : true }
      : character
  )
}

const importSelected = () => {
  emit(
    'import',
    results.value.filter((character) => character.selected !== false)
  )
}

const getRoleType = (role: WriterCharacter['role']): TagType => {
  const roleMap: Record<string, TagType> = {
    protagonist: 'danger',
    supporting: 'primary',
    antagonist: 'warning',
    minor: 'info',
  }
  return role ? roleMap[role] || 'info' : 'info'
}

const getRoleText = (role: WriterCharacter['role']) => {
  const roleMap: Record<string, string> = {
    protagonist: '主角',
    supporting: '配角',
    antagonist: '反派',
    minor: '次要角色',
  }
  return role ? roleMap[role] || '配角' : '配角'
}

const getGenderText = (gender: WriterCharacter['gender']) => {
  const genderMap: Record<string, string> = {
    male: '男',
    female: '女',
    other: '其他',
  }
  return gender ? genderMap[gender] || '男' : '男'
}
</script>

<style scoped>
.batch-generate-content {
  max-height: 70vh;
  overflow-y: auto;
}

.config-section,
.streaming-section,
.results-section {
  margin-bottom: 16px;
}

.character-type-options {
  display: flex;
  gap: 16px;
}

.streaming-content-container {
  max-height: 300px;
  overflow-y: auto;
  background-color: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
}

.streaming-content {
  max-height: 300px;
  padding: 16px;
  overflow-y: auto;
  font-family: 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  background-color: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
}

.streaming-content::-webkit-scrollbar {
  width: 6px;
}

.streaming-content::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

.streaming-content::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

.streaming-content::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}

.results-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.result-actions {
  display: flex;
  gap: 8px;
}

.generated-characters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 16px;
  max-height: 400px;
  overflow-y: auto;
}

.generated-character-card {
  padding: 16px;
  cursor: pointer;
  background-color: var(--el-bg-color);
  border: 2px solid var(--el-border-color-light);
  border-radius: 8px;
  transition: all 0.3s;
}

.generated-character-card:hover {
  background-color: var(--brand-50);
  border-color: var(--brand-500);
}

.generated-character-card.selected {
  background-color: #ecf5ff;
  border-color: var(--brand-500);
  box-shadow: 0 0 0 1px var(--brand-500);
}

.character-header {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.character-avatar-preview {
  flex-shrink: 0;
}

.character-avatar-preview .default-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  font-size: 16px;
  font-weight: bold;
  color: white;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 50%;
}

.character-basic-info {
  flex: 1;
}

.character-basic-info h4 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.character-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin: 4px 0;
}

.character-meta .age-text {
  margin-left: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.selection-indicator {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}

.selected-icon {
  font-size: 18px;
  color: var(--brand-500);
}

.character-details {
  padding-top: 12px;
  border-top: 1px solid var(--ink-100);
}

.detail-item {
  margin-bottom: 8px;
}

.detail-item label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.detail-item p {
  display: -webkit-box;
  max-height: 40px;
  margin: 0;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.4;
  color: var(--el-text-color-regular);
  text-overflow: ellipsis;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.character-tags-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.character-tags-preview :deep(.el-tag) {
  height: 18px;
  font-size: 10px;
  line-height: 16px;
}

.selected-prompt-info {
  margin-left: 5px;
  font-size: 12px;
  color: var(--brand-500);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
