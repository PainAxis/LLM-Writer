<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-header">
        <span>📚 语料库</span>
        <el-button size="small" type="primary" @click="emit('add')">
          <el-icon><Plus /></el-icon>
          新增
        </el-button>
      </div>
    </template>

    <div class="corpus-toolbar">
      <el-select
        v-model="corpusFilter"
        clearable
        placeholder="全部分类"
        size="small"
        style="width: 160px"
      >
        <el-option v-for="category in corpusCategories" :key="category" :label="category" :value="category" />
      </el-select>
      <el-input
        v-model="corpusSearch"
        size="small"
        clearable
        placeholder="搜索标题 / 内容"
        style="width: 200px"
        :prefix-icon="Search"
      />
    </div>

    <div class="corpus-list">
      <div v-for="corpus in filteredCorpusData" :key="corpus.id" class="corpus-item">
        <div class="corpus-content">
          <div class="corpus-header">
            <h4>{{ corpus.title }}</h4>
            <el-tag :type="getCorpusType(corpus.type)">{{ getCorpusTypeText(corpus.type) }}</el-tag>
            <el-tag v-if="getCorpusCategory(corpus)" size="small" effect="plain">
              {{ getCorpusCategory(corpus) }}
            </el-tag>
          </div>
          <el-tooltip
            :content="corpus.content"
            placement="right"
            :disabled="corpus.content.length <= 100"
            effect="light"
            :show-after="300"
          >
            <p class="corpus-preview corpus-preview-truncated">
              {{ corpus.content.length > 100 ? `${corpus.content.substring(0, 100)}...` : corpus.content }}
            </p>
          </el-tooltip>
        </div>
        <div class="corpus-actions">
          <el-button size="small" @click="emit('edit', corpus)">编辑</el-button>
          <el-button size="small" type="danger" @click="emit('delete', corpus)">删除</el-button>
        </div>
      </div>

      <div v-if="filteredCorpusData.length === 0 && corpusData.length > 0" class="empty-state">
        <p>没有符合筛选条件的语料</p>
      </div>

      <div v-if="corpusData.length === 0" class="empty-state">
        <p>暂无语料数据</p>
        <el-button size="small" @click="emit('add')">添加第一个语料</el-button>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, Search } from '@element-plus/icons-vue'
import type { TagProps } from 'element-plus'
import type { WriterCorpusItem, WriterCorpusType } from '@/types/writer'

const props = defineProps<{
  corpusData: readonly WriterCorpusItem[]
}>()

const emit = defineEmits<{
  add: []
  edit: [corpus: WriterCorpusItem]
  delete: [corpus: WriterCorpusItem]
}>()

const corpusFilter = ref('')
const corpusSearch = ref('')

const corpusTypeTags: Record<string, TagProps['type']> = {
  description: 'success',
  dialogue: 'primary',
  emotion: 'warning',
  action: 'danger',
  psychology: 'info',
}

const corpusTypeTexts: Record<string, string> = {
  description: '场景描述',
  dialogue: '对话模板',
  emotion: '情感表达',
  action: '动作描写',
  psychology: '心理描写',
}

function getCorpusType(type?: WriterCorpusType): TagProps['type'] {
  return corpusTypeTags[type ?? ''] ?? 'info'
}

function getCorpusTypeText(type?: WriterCorpusType): string {
  return corpusTypeTexts[type ?? ''] ?? type ?? ''
}

function getCorpusCategory(corpus: WriterCorpusItem): string {
  return (corpus.category ?? '').trim()
}

const corpusCategories = computed<string[]>(() => {
  const categories = new Set<string>()
  props.corpusData.forEach((corpus) => {
    const category = getCorpusCategory(corpus)
    if (category) categories.add(category)
  })
  return [...categories].sort()
})

const filteredCorpusData = computed<WriterCorpusItem[]>(() => {
  const keyword = corpusSearch.value.trim().toLowerCase()
  return props.corpusData.filter((corpus) => {
    if (corpusFilter.value && getCorpusCategory(corpus) !== corpusFilter.value) return false
    if (keyword) {
      const haystack = `${corpus.title ?? ''}\n${corpus.content ?? ''}`.toLowerCase()
      if (!haystack.includes(keyword)) return false
    }
    return true
  })
})
</script>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}

.corpus-toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}

.corpus-list {
  max-height: calc(100vh - 190px);
  overflow-y: auto;
}

.corpus-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  padding: 12px;
  margin-bottom: 8px;
  cursor: pointer;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  transition: all 0.3s;
}

.corpus-item:hover {
  background-color: var(--brand-50);
  border-color: var(--brand-500);
}

.corpus-content {
  flex: 1;
  text-align: left;
}

.corpus-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.corpus-header h4 {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.corpus-preview {
  margin: 8px 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.corpus-preview-truncated {
  cursor: help;
  transition: color 0.2s ease;
}

.corpus-preview-truncated:hover {
  color: var(--el-text-color-primary);
}

.corpus-actions {
  display: flex;
  gap: 4px;
}

.empty-state {
  padding: 40px 20px;
  color: var(--el-text-color-secondary);
  text-align: center;
}
</style>
