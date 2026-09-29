<template>
  <el-dialog v-model="visible" :title="title" width="80%" :before-close="close">
    <div class="prompt-selector">
      <div class="search-bar">
        <el-input v-model="search" placeholder="搜索提示词模板..." prefix-icon="Search" size="small" clearable />
      </div>
      <div class="prompt-list">
        <div v-for="prompt in filtered" :key="prompt.id" class="prompt-item" @click="emit('select', prompt)">
          <div class="prompt-title">{{ prompt.title }}</div>
          <div class="prompt-description">{{ prompt.description }}</div>
          <div class="prompt-tags">
            <el-tag v-for="tag in prompt.tags" :key="tag" size="small">{{ tag }}</el-tag>
          </div>
        </div>
      </div>
      <div v-if="filtered.length === 0" class="empty-state">
        <el-empty :description="emptyMessage">
          <el-button type="primary" @click="emit('create')">创建提示词</el-button>
        </el-empty>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PromptTemplate } from '@/config/defaultPrompts'

const visible = defineModel<boolean>({ required: true })
const props = defineProps<{ title: string; emptyMessage: string; prompts: PromptTemplate[] }>()
const emit = defineEmits<{ select: [prompt: PromptTemplate]; create: [] }>()
const search = ref('')
const filtered = computed(() => {
  const keyword = search.value.toLowerCase()
  return props.prompts.filter(prompt => prompt.category === 'short-story'
    && (!keyword || [prompt.title, prompt.description, ...prompt.tags].some(value => value.toLowerCase().includes(keyword))))
})
const close = () => { visible.value = false; search.value = '' }
</script>

<style scoped>


.prompt-selector {
  display: flex;
  gap: 20px;
  min-height: 500px;
}

.prompt-list {
  flex: 1;
  max-height: 500px;
  overflow-y: auto;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  color: #6b7280;
}

.empty-state h4 {
  margin: 0 0 8px 0;
  color: #374151;
  font-size: 16px;
}

.empty-state p {
  margin: 0;
  font-size: 14px;
  max-width: 280px;
}

.prompt-selector {
  height: 400px;
  display: flex;
  flex-direction: column;
}

.search-bar {
  margin-bottom: 16px;
}

.prompt-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.prompt-item {
  padding: 16px;
  border: 1px solid #e1e5e9;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.prompt-item:hover {
  border-color: var(--brand-500);
  background: var(--brand-50);
}

.prompt-title {
  font-weight: 500;
  color: #2c3e50;
  margin-bottom: 8px;
}

.prompt-description {
  color: var(--el-text-color-regular);
  font-size: 13px;
  margin-bottom: 8px;
}

.prompt-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
</style>
