<template>
  <el-card shadow="never" class="chapters-card">
    <template #header>
      <div class="card-header">
        <span>📝 章节列表</span>
        <el-dropdown @command="handleCreateCommand">
          <el-button size="small" type="primary">
            <el-icon><Plus /></el-icon>
            新增章节 <el-icon><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="manual">手动创建</el-dropdown-item>
              <el-dropdown-item command="ai-single">AI生成单章</el-dropdown-item>
              <el-dropdown-item command="ai-batch">AI批量生成</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </template>

    <div class="chapters-list">
      <div
        v-for="(chapter, index) in chapters"
        :key="chapter.id"
        class="chapter-item"
        :class="{ active: selectedChapterId === chapter.id }"
        @click="emit('select', chapter)"
      >
        <div class="chapter-info">
          <h4>第{{ index + 1 }}章</h4>
          <p>{{ chapter.title }}</p>
          <div class="chapter-meta">
            <span>{{ chapter.wordCount || 0 }}字</span>
            <el-tag v-if="chapter.status" :type="getChapterStatusType(chapter.status)" size="small">
              {{ getChapterStatusText(chapter.status) }}
            </el-tag>
          </div>
          <el-tooltip
            v-if="chapter.description"
            :content="chapter.description"
            placement="top-start"
            :disabled="chapter.description.length <= 50"
            effect="light"
            :show-after="300"
          >
            <p class="chapter-desc chapter-desc-truncated">
              {{
                chapter.description.length > 50
                  ? chapter.description.substring(0, 50) + '...'
                  : chapter.description
              }}
            </p>
          </el-tooltip>
        </div>
        <div class="chapter-actions">
          <el-dropdown @command="(command: unknown) => handleChapterAction(command, chapter)">
            <el-button size="small" type="text">
              <el-icon><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="edit">编辑信息</el-dropdown-item>
                <el-dropdown-item command="generate">AI生成正文</el-dropdown-item>
                <el-dropdown-item divided command="delete">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <div v-if="chapters.length === 0" class="empty-chapters">
        <p>暂无章节</p>
        <el-button size="small" type="primary" @click="emit('create')">创建第一章</el-button>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ArrowDown, MoreFilled, Plus } from '@element-plus/icons-vue'
import type { WriterChapter, WriterChapterStatus } from '@/types/writer'

type TagType = 'primary' | 'success' | 'warning' | 'info' | 'danger'

defineProps<{
  chapters: readonly WriterChapter[]
  selectedChapterId?: number | null
}>()

const emit = defineEmits<{
  select: [chapter: WriterChapter]
  create: []
  'generate-single': []
  'generate-batch': []
  edit: [chapter: WriterChapter]
  generate: [chapter: WriterChapter]
  delete: [chapter: WriterChapter]
}>()

const statusTypes: Record<string, TagType> = {
  draft: 'warning',
  completed: 'success',
  published: 'primary',
}

const statusTexts: Record<string, string> = {
  draft: '草稿',
  completed: '完成',
  published: '发表',
}

const getChapterStatusType = (status: WriterChapterStatus): TagType =>
  statusTypes[status] ?? 'warning'

const getChapterStatusText = (status: WriterChapterStatus): string => statusTexts[status] ?? '草稿'

const handleCreateCommand = (command: unknown) => {
  if (command === 'manual') emit('create')
  else if (command === 'ai-single') emit('generate-single')
  else if (command === 'ai-batch') emit('generate-batch')
}

const handleChapterAction = (command: unknown, chapter: WriterChapter) => {
  if (command === 'edit') emit('edit', chapter)
  else if (command === 'generate') emit('generate', chapter)
  else if (command === 'delete') emit('delete', chapter)
}
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.chapters-list {
  max-height: calc(100vh - 190px);
  overflow-y: auto;
}

.chapter-item {
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

.chapter-item:hover {
  background-color: var(--brand-50);
  border-color: var(--brand-500);
}

.chapter-item.active {
  background-color: #ecf5ff;
  border-color: var(--brand-500);
}

.chapter-info {
  flex: 1;
}

.chapter-info h4 {
  margin: 0 0 4px;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.chapter-info p {
  margin: 0 0 4px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--el-text-color-regular);
}

.chapter-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.chapter-desc {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.3;
  color: var(--el-text-color-secondary);
}

.chapter-desc-truncated {
  cursor: help;
  transition: color 0.2s ease;
}

.chapter-desc-truncated:hover {
  color: var(--el-text-color-regular);
}

.chapter-actions {
  display: flex;
  gap: 4px;
}

.empty-chapters {
  padding: 40px 20px;
  color: var(--el-text-color-secondary);
  text-align: center;
}
</style>
