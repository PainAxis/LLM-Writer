<template>
  <el-dialog
    v-model="visible"
    title="AI智能续写"
    width="1000px"
    top="5vh"
    @close="emit('close')"
  >
    <div class="new-continue-container">
      <el-row :gutter="20" style="height: 100%">
        <!-- 左侧：配置区域 -->
        <el-col :span="10" style="height: 100%">
          <el-card shadow="never" class="continue-config-card">
            <template #header>
              <div class="card-header">
                <span>⚙️ 续写配置</span>
              </div>
            </template>

            <!-- 续写方向 -->
            <div class="continue-direction">
              <h4>续写方向</h4>
              <el-input
                v-model="form.direction"
                type="textarea"
                :rows="6"
                placeholder="请描述续写方向，例如：&#10;- 推进主角与反派的对决&#10;- 展现角色内心的纠结&#10;- 描写紧张的追逐场面&#10;- 揭示重要的秘密&#10;&#10;留空将根据大纲和前文自动续写"
              />
            </div>

            <!-- 续写字数 -->
            <div class="continue-word-count">
              <h4>续写字数</h4>
              <el-slider
                v-model="form.wordCount"
                :min="200"
                :max="5000"
                :step="100"
                show-stops
                show-input
              />
              <div class="word-count-tips">
                <span>建议：200-1000字为佳，最多支持5000字</span>
              </div>
            </div>

            <!-- 当前内容预览 -->
            <div class="current-content-preview">
              <h4>当前内容</h4>
              <el-input
                :model-value="currentContent"
                type="textarea"
                :rows="6"
                readonly
                placeholder="暂无内容"
                style="max-height: 150px"
              />
              <div class="content-stats">当前字数：{{ contentWordCount }}</div>
            </div>
          </el-card>
        </el-col>

        <!-- 右侧：续写结果区域 -->
        <el-col :span="14" style="height: 100%">
          <el-card shadow="never" class="continue-result-card">
            <template #header>
              <div class="card-header">
                <span>✍️ 续写结果</span>
                <el-button v-if="streamingContent && !streaming" type="success" size="small" @click="emit('copy')">
                  <el-icon><CopyDocument /></el-icon>
                  复制结果
                </el-button>
              </div>
            </template>

            <!-- 流式输出区域 -->
            <div v-if="streaming" class="streaming-area">
              <div class="streaming-header">
                <span class="streaming-status">🤖 AI正在续写中...</span>
                <el-button size="small" type="text" @click="emit('stop')">
                  <el-icon><Close /></el-icon>
                  停止
                </el-button>
              </div>
              <div class="streaming-content-box">
                <div class="streaming-text">{{ streamingContent }}</div>
              </div>
            </div>

            <!-- 续写结果显示 -->
            <div v-else-if="streamingContent" class="result-area">
              <div class="result-content">{{ streamingContent }}</div>
              <div class="result-stats">
                <span>续写字数：{{ streamingContent.length }}</span>
                <span>总字数：{{ contentWordCount + streamingContent.length }}</span>
              </div>
            </div>

            <!-- 空状态 -->
            <div v-else class="empty-result">
              <el-empty description="点击续写按钮开始AI续写" />
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="streaming" :disabled="!canStart" @click="emit('start')">
          <el-icon><ArrowRight /></el-icon>
          {{ streaming ? '续写中...' : '开始续写' }}
        </el-button>
        <el-button
          v-if="streamingContent && !streaming"
          type="success"
          :loading="appending"
          :disabled="appending"
          @click="emit('append')"
        >
          <el-icon><Check /></el-icon>
          追加到文章
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ArrowRight, Check, Close, CopyDocument } from '@element-plus/icons-vue'
import type { WriterContinueForm } from '@/types/writer'

const visible = defineModel<boolean>({ default: false })
const form = defineModel<WriterContinueForm>('form', { required: true })

defineProps<{
  currentContent: string
  contentWordCount: number
  streamingContent: string
  streaming: boolean
  appending: boolean
  canStart: boolean
}>()

const emit = defineEmits<{
  close: []
  copy: []
  stop: []
  start: []
  append: []
}>()
</script>

<style scoped>
.new-continue-container {
  height: 600px;
  max-height: 80vh;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}

.continue-config-card,
.continue-result-card {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.continue-config-card :deep(.el-card__body),
.continue-result-card :deep(.el-card__body) {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
}

.continue-direction,
.continue-word-count,
.current-content-preview {
  margin-bottom: 20px;
}

.continue-direction h4,
.continue-word-count h4,
.current-content-preview h4 {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.word-count-tips {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.content-stats {
  margin-top: 8px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.streaming-area,
.result-area {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.streaming-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding: 12px 16px;
  font-weight: 500;
  color: var(--el-color-success);
  background-color: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-light);
  border-radius: 6px 6px 0 0;
}

.streaming-status {
  font-size: 14px;
  font-weight: 500;
  color: var(--brand-500);
}

.streaming-content-box {
  flex: 1;
  min-height: 300px;
  max-height: 400px;
  padding: 16px;
  overflow-y: auto;
  background-color: var(--el-fill-color-light);
  border-radius: 6px;
}

.streaming-text {
  min-height: 100px;
  padding: 12px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  word-break: break-all;
  word-wrap: break-word;
  background-color: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
}

.streaming-text::after {
  color: var(--brand-500);
  content: '▋';
  animation: blink 1s infinite;
}

.result-content {
  flex: 1;
  min-height: 300px;
  max-height: 400px;
  padding: 16px;
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.8;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  word-wrap: break-word;
  background-color: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
}

.result-stats {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.empty-result {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 300px;
  padding: 20px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

@keyframes blink {
  0%,
  50% {
    opacity: 1;
  }

  51%,
  100% {
    opacity: 0;
  }
}
</style>
