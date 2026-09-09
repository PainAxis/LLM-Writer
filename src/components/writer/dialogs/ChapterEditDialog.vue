<template>
  <el-dialog v-model="visible" :title="editing ? '编辑章节' : '新增章节'" width="600px">
    <el-form :model="form" label-width="80px">
      <el-form-item label="章节标题">
        <el-input v-model="form.title" placeholder="请输入章节标题" />
      </el-form-item>
      <el-form-item label="章节简介">
        <div class="form-item-with-ai">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="4"
            placeholder="简要描述本章节内容..."
          />
          <el-button
            size="small"
            type="primary"
            :loading="generatingOutline"
            :disabled="generatingOutline"
            style="margin-top: 8px"
            @click="emit('generate-outline')"
          >
            <el-icon><Star /></el-icon>
            AI生成大纲
          </el-button>
        </div>
      </el-form-item>
      <div v-if="generatingOutline" class="outline-preview" aria-live="polite">
        <div class="outline-preview-header">AI 正在生成章节大纲...</div>
        <div ref="outlinePreviewElement" class="outline-preview-content">
          <pre>{{ streamingContent || '正在等待 AI 返回内容...' }}</pre>
        </div>
      </div>
      <el-form-item label="章节状态">
        <el-select v-model="form.status">
          <el-option label="草稿" value="draft" />
          <el-option label="完成" value="completed" />
          <el-option label="发表" value="published" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="generatingOutline" @click="emit('save')">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Star } from '@element-plus/icons-vue'
import type { WriterChapterForm } from '@/types/writer'

const visible = defineModel<boolean>({ required: true })
const form = defineModel<WriterChapterForm>('form', { required: true })

const props = defineProps<{
  editing: boolean
  generatingOutline: boolean
  streamingContent: string
}>()

const outlinePreviewElement = ref<HTMLElement | null>(null)
watch(() => props.streamingContent, () => {
  if (!props.generatingOutline || !outlinePreviewElement.value) return
  outlinePreviewElement.value.scrollTop = outlinePreviewElement.value.scrollHeight
}, { flush: 'post' })

const emit = defineEmits<{
  save: []
  'generate-outline': []
}>()
</script>

<style scoped>
.form-item-with-ai {
  display: flex;
  align-items: center;
}

.form-item-with-ai .el-input {
  flex: 1;
}

.form-item-with-ai .el-button {
  margin-top: 8px;
}

.outline-preview {
  margin: -4px 0 18px 80px;
  overflow: hidden;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
}

.outline-preview-header {
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--el-color-success);
  border-bottom: 1px solid var(--el-border-color-light);
}

.outline-preview-content {
  max-height: 220px;
  padding: 12px;
  overflow-y: auto;
  background: var(--el-bg-color);
}

.outline-preview-content pre {
  margin: 0;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
