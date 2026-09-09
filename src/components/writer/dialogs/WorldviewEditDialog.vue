<template>
  <el-dialog v-model="visible" title="编辑世界观设定" width="600px">
    <el-form :model="form" label-width="80px">
      <el-form-item label="设定标题">
        <el-input v-model="form.title" />
      </el-form-item>
      <el-form-item label="类别">
        <el-select v-model="form.category">
          <el-option label="世界设定" value="setting" />
          <el-option label="魔法体系" value="magic" />
          <el-option label="政治势力" value="politics" />
          <el-option label="地理环境" value="geography" />
          <el-option label="历史背景" value="history" />
        </el-select>
      </el-form-item>
      <el-form-item label="详细描述">
        <div class="form-item-with-ai">
          <el-input v-model="form.description" type="textarea" :rows="6" />
          <el-button
            size="small"
            type="primary"
            :loading="generating"
            style="margin-top: 8px"
            @click="emit('generate-description')"
          >
            <el-icon><Star /></el-icon>
            AI生成描述
          </el-button>
        </div>
      </el-form-item>
    </el-form>

    <div v-if="showStreaming" class="streaming-status-card">
      <div class="streaming-header">
        <span class="streaming-title">AI 正在生成世界观设定...</span>
      </div>
      <div class="streaming-content-display">{{ streamingContent }}</div>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="generating" @click="emit('save')">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { Star } from '@element-plus/icons-vue'
import type { WriterWorldSettingForm } from '@/types/writer'

const visible = defineModel<boolean>({ default: false })
const form = defineModel<WriterWorldSettingForm>('form', { required: true })

defineProps<{
  generating: boolean
  showStreaming: boolean
  streamingContent: string
}>()

const emit = defineEmits<{
  save: []
  'generate-description': []
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

.streaming-status-card {
  margin-top: 16px;
  background-color: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
}

.streaming-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  margin-bottom: 12px;
  font-weight: 500;
  color: var(--el-color-success);
  background-color: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-light);
  border-radius: 6px 6px 0 0;
}

.streaming-title {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.streaming-content-display {
  max-height: 200px;
  padding: 16px;
  overflow-y: auto;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
}
</style>
