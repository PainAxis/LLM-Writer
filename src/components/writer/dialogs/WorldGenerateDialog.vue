<template>
  <el-dialog
    v-model="visible"
    title="AI生成世界观设定"
    width="800px"
    :close-on-click-modal="!importing"
    :close-on-press-escape="!importing"
    :show-close="!importing"
    @close="visible = false"
  >
    <div class="world-generate-content">
      <!-- 配置区域 -->
      <el-card v-if="!generating && results.length === 0" shadow="never" class="config-section">
        <template #header>
          <span>⚙️ 生成配置</span>
        </template>

        <el-form label-width="120px" size="default">
          <el-form-item label="生成数量">
            <el-input-number v-model="config.count" :min="1" :max="8" />
          </el-form-item>

          <el-form-item label="设定类型">
            <div class="world-type-options">
              <el-checkbox v-model="config.includeGeography">地理环境</el-checkbox>
              <el-checkbox v-model="config.includeCulture">文化社会</el-checkbox>
              <el-checkbox v-model="config.includeHistory">历史背景</el-checkbox>
              <el-checkbox v-model="config.includeMagic">魔法体系</el-checkbox>
              <el-checkbox v-model="config.includeTechnology">科技水平</el-checkbox>
              <el-checkbox v-model="config.includePolitics">政治势力</el-checkbox>
              <el-checkbox v-model="config.includeReligion">宗教信仰</el-checkbox>
              <el-checkbox v-model="config.includeEconomy">经济贸易</el-checkbox>
              <el-checkbox v-model="config.includeRaces">种族设定</el-checkbox>
              <el-checkbox v-model="config.includeLanguage">语言文字</el-checkbox>
            </div>
          </el-form-item>

          <!-- 提示词选择 -->
          <el-form-item label="使用提示词">
            <div style="display: flex; gap: 10px; align-items: center">
              <el-button type="primary" plain size="small" @click="emit('request-prompt')">📝 选择提示词</el-button>
              <span v-if="selectedPrompt" class="selected-prompt-info"> 已选择：{{ selectedPrompt.title }} </span>
              <el-button v-if="selectedPrompt" link size="small" type="danger" @click="emit('clear-prompt')">
                清除
              </el-button>
            </div>
          </el-form-item>

          <el-form-item label="特殊要求">
            <el-input
              v-model="config.customPrompt"
              type="textarea"
              :rows="3"
              placeholder="例如：需要包含特定的种族设定、独特的政治制度、特殊的自然现象等..."
            />
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 流式生成区域 -->
      <el-card v-if="generating" shadow="never" class="streaming-section">
        <template #header>
          <span>🤖 AI正在生成世界观设定...</span>
        </template>

        <div class="streaming-content-container">
          <div class="streaming-content">{{ streamingContent }}</div>
        </div>
      </el-card>

      <!-- 生成结果区域 -->
      <el-card v-if="!generating && results.length > 0" shadow="never" class="results-section">
        <template #header>
          <div class="results-header">
            <span>✨ 生成结果 ({{ results.length }}个设定)</span>
            <div class="result-actions">
              <el-button size="small" @click="setAllSelected(true)">全选</el-button>
              <el-button size="small" @click="setAllSelected(false)">全不选</el-button>
            </div>
          </div>
        </template>

        <div class="generated-settings-list">
          <div
            v-for="setting in results"
            :key="setting.id"
            class="generated-setting-card"
            :class="{ selected: setting.selected !== false }"
            @click="toggleSelection(setting)"
          >
            <div class="setting-header">
              <div class="setting-basic-info">
                <h4>{{ setting.title }}</h4>
                <el-tag :type="getWorldSettingType(setting.type)" size="small">{{ setting.type }}</el-tag>
              </div>
              <div class="selection-indicator">
                <el-icon v-if="setting.selected !== false" class="selected-icon"><Check /></el-icon>
              </div>
            </div>

            <div class="setting-content">
              <p>{{ setting.description || '暂无描述' }}</p>
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
          :disabled="!hasSelectedType"
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
          @click="emit('import')"
        >
          ✅ 添加选中设定
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Check } from '@element-plus/icons-vue'
import type { TagProps } from 'element-plus'
import type { PromptTemplate, WriterWorldGenerationConfig, WriterWorldSetting } from '@/types/writer'

const visible = defineModel<boolean>({ required: true })
const config = defineModel<WriterWorldGenerationConfig>('config', { required: true })
const results = defineModel<WriterWorldSetting[]>('results', { required: true })

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
  import: []
}>()

const worldSettingTypes: Record<string, TagProps['type']> = {
  地理环境: 'success',
  文化社会: 'primary',
  历史背景: 'warning',
  魔法体系: 'danger',
  科技水平: 'info',
}

const hasSelectedType = computed<boolean>(() => {
  return (
    config.value.includeGeography ||
    config.value.includeCulture ||
    config.value.includeHistory ||
    config.value.includeMagic ||
    config.value.includeTechnology ||
    config.value.includePolitics ||
    config.value.includeReligion ||
    config.value.includeEconomy ||
    config.value.includeRaces ||
    config.value.includeLanguage
  )
})

function getWorldSettingType(type?: string): TagProps['type'] {
  return worldSettingTypes[type ?? '']
}

function setAllSelected(selected: boolean): void {
  results.value.forEach((setting) => {
    setting.selected = selected
  })
}

function toggleSelection(setting: WriterWorldSetting): void {
  setting.selected = setting.selected === false
}
</script>

<style scoped>
.world-generate-content {
  max-height: 70vh;
  overflow-y: auto;
}

.config-section,
.streaming-section,
.results-section {
  margin-bottom: 16px;
}

.world-type-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  margin-top: 8px;
}

.world-type-options .el-checkbox {
  min-width: fit-content;
  margin: 0;
  white-space: nowrap;
}

.selected-prompt-info {
  margin-left: 5px;
  font-size: 12px;
  color: var(--brand-500);
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

.generated-settings-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
}

.generated-setting-card {
  padding: 16px;
  cursor: pointer;
  background-color: var(--el-bg-color);
  border: 2px solid var(--el-border-color-light);
  border-radius: 8px;
  transition: all 0.3s;
}

.generated-setting-card:hover {
  background-color: var(--brand-50);
  border-color: var(--brand-500);
}

.generated-setting-card.selected {
  background-color: #ecf5ff;
  border-color: var(--brand-500);
  box-shadow: 0 0 0 1px var(--brand-500);
}

.setting-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}

.setting-basic-info {
  flex: 1;
}

.setting-basic-info h4 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
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

.setting-content p {
  display: -webkit-box;
  max-height: 80px;
  margin: 0;
  overflow: hidden;
  font-size: 14px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
  text-overflow: ellipsis;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
