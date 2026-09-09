<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-header">
        <span>🌍 世界观设定</span>
        <div class="world-actions">
          <el-button size="small" type="primary" @click="emit('add')">
            <el-icon><Plus /></el-icon>
            新增
          </el-button>
          <el-button size="small" type="success" @click="emit('generate')">🤖 AI生成</el-button>
        </div>
      </div>
    </template>

    <div class="worldview-list">
      <div v-for="setting in worldSettings" :key="setting.id" class="worldview-item">
        <div class="worldview-content" @click="emit('edit', setting)">
          <div class="worldview-header">
            <h4>{{ setting.title }}</h4>
            <el-tag :type="getWorldSettingTagType(setting.category)">
              {{ getWorldSettingTagText(setting.category) }}
            </el-tag>
          </div>
          <el-tooltip
            v-if="setting.description"
            :content="setting.description"
            placement="right"
            :disabled="setting.description.length <= 80"
            effect="light"
            :show-after="300"
          >
            <p class="worldview-description worldview-description-truncated">
              {{
                setting.description.length > 80
                  ? `${setting.description.substring(0, 80)}...`
                  : setting.description
              }}
            </p>
          </el-tooltip>
          <p v-else class="worldview-description">暂无描述</p>
          <div class="worldview-meta">
            <span class="create-time">{{ formatDate(setting.createdAt) }}</span>
            <span v-if="setting.generated" class="ai-generated">AI生成</span>
          </div>
        </div>
        <div class="worldview-actions">
          <el-dropdown trigger="click" @command="handleCommand($event, setting)">
            <el-button size="small" type="text" @click.stop>
              <el-icon><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="edit">
                  <el-icon><Edit /></el-icon>
                  编辑
                </el-dropdown-item>
                <el-dropdown-item command="duplicate">
                  <el-icon><CopyDocument /></el-icon>
                  复制
                </el-dropdown-item>
                <el-dropdown-item command="delete" divided>
                  <el-icon><Delete /></el-icon>
                  删除
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <div v-if="worldSettings.length === 0" class="empty-state">
        <p>暂无世界观设定</p>
        <el-button size="small" @click="emit('add')">创建第一个设定</el-button>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { CopyDocument, Delete, Edit, MoreFilled, Plus } from '@element-plus/icons-vue'
import type { TagProps } from 'element-plus'
import type {
  WriterTimestamp,
  WriterWorldSetting,
  WriterWorldSettingCategory,
} from '@/types/writer'

defineProps<{
  worldSettings: readonly WriterWorldSetting[]
}>()

const emit = defineEmits<{
  add: []
  generate: []
  edit: [setting: WriterWorldSetting]
  duplicate: [setting: WriterWorldSetting]
  delete: [setting: WriterWorldSetting]
}>()

type WorldSettingCommand = 'edit' | 'duplicate' | 'delete'

const tagTypes: Record<string, TagProps['type']> = {
  setting: 'primary',
  magic: 'danger',
  politics: 'warning',
  geography: 'success',
  history: 'info',
}

const tagTexts: Record<string, string> = {
  setting: '世界设定',
  magic: '魔法体系',
  politics: '政治势力',
  geography: '地理环境',
  history: '历史背景',
}

function getWorldSettingTagType(category?: WriterWorldSettingCategory): TagProps['type'] {
  return tagTypes[category ?? ''] ?? 'info'
}

function getWorldSettingTagText(category?: WriterWorldSettingCategory): string {
  return tagTexts[category ?? ''] ?? category ?? ''
}

function handleCommand(command: WorldSettingCommand, setting: WriterWorldSetting): void {
  switch (command) {
    case 'edit':
      emit('edit', setting)
      break
    case 'duplicate':
      emit('duplicate', setting)
      break
    case 'delete':
      emit('delete', setting)
      break
  }
}

function formatDate(value?: WriterTimestamp): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return date.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.world-actions {
  display: flex;
  gap: 8px;
}

.worldview-list {
  max-height: calc(100vh - 190px);
  overflow-y: auto;
}

.worldview-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  margin-bottom: 8px;
  cursor: pointer;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  transition: all 0.3s;
}

.worldview-item:hover {
  background-color: var(--brand-50);
  border-color: var(--brand-500);
}

.worldview-content {
  flex: 1;
  cursor: pointer;
}

.worldview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.worldview-header h4 {
  flex: 1;
  margin: 0 8px 0 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.worldview-description {
  display: -webkit-box;
  margin: 6px 0;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.4;
  color: var(--el-text-color-regular);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.worldview-description-truncated {
  cursor: help;
  transition: color 0.2s ease;
}

.worldview-description-truncated:hover {
  color: var(--el-text-color-primary);
}

.worldview-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 6px;
}

.worldview-meta .create-time {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.worldview-meta .ai-generated {
  padding: 2px 6px;
  font-size: 11px;
  color: var(--el-color-success);
  background-color: var(--brand-50);
  border: 1px solid #b3d8ff;
  border-radius: 10px;
}

.worldview-actions {
  flex-shrink: 0;
  margin-left: 8px;
}

.empty-state {
  padding: 40px 20px;
  color: var(--el-text-color-secondary);
  text-align: center;
}
</style>
