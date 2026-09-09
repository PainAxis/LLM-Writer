<template>
  <el-dialog v-model="visible" title="AI文本润色" width="1200px" @close="emit('close')">
    <div class="new-optimize-container">
      <el-row :gutter="20">
        <!-- 左侧：配置区域 -->
        <el-col :span="8">
          <el-card shadow="never" class="optimize-config-card">
            <template #header>
              <div class="card-header">
                <span>⚙️ 润色配置</span>
                <el-tag v-if="form.mode === 'selection'" type="info" size="small">
                  选择内容
                </el-tag>
                <el-tag v-else type="warning" size="small">整篇文章</el-tag>
              </div>
            </template>

            <!-- 预设提示词选择 -->
            <div class="prompt-selection">
              <h4>选择润色类型</h4>
              <div class="prompt-list">
                <div
                  v-for="prompt in prompts"
                  :key="prompt.id"
                  class="prompt-item"
                  :class="{ active: form.selectedPrompt?.id === prompt.id }"
                  @click="emit('select-prompt', prompt)"
                >
                  <div class="prompt-title">{{ prompt.title }}</div>
                  <div class="prompt-desc">
                    {{ prompt.description || prompt.content.substring(0, 60) + '...' }}
                  </div>
                </div>
              </div>
              <div v-if="prompts.length === 0" class="empty-prompts">
                <p>暂无润色提示词</p>
                <el-button size="small" @click="emit('open-prompt-library')">
                  去提示词库添加
                </el-button>
              </div>
            </div>

            <!-- 自定义提示词 -->
            <div class="custom-prompt">
              <h4>自定义润色要求</h4>
              <el-input
                v-model="form.customPrompt"
                type="textarea"
                :rows="4"
                placeholder="输入具体的润色要求，例如：提升文字的画面感、增强对话的真实感、优化句式结构等..."
              />
            </div>

            <!-- 原始内容预览 -->
            <div class="original-content-preview">
              <h4>原始内容预览</h4>
              <el-input
                :value="form.originalContent"
                type="textarea"
                :rows="8"
                readonly
                placeholder="暂无内容"
                class="original-content-textarea"
              />
              <div class="content-stats">字数：{{ form.originalContent.length }}</div>
            </div>
          </el-card>
        </el-col>

        <!-- 右侧：优化结果区域 -->
        <el-col :span="16">
          <el-card shadow="never" class="optimize-result-card">
            <template #header>
              <div class="card-header">
                <span>✨ 润色结果</span>
                <el-button
                  v-if="form.optimizedContent && !streaming"
                  type="success"
                  size="small"
                  @click="emit('copy')"
                >
                  <el-icon><CopyDocument /></el-icon>
                  复制结果
                </el-button>
              </div>
            </template>

            <!-- 流式输出区域 -->
            <div v-if="streaming" class="streaming-area">
              <div class="streaming-header">
                <span class="streaming-status">🤖 AI正在润色中...</span>
                <el-button size="small" type="text" @click="emit('stop')">
                  <el-icon><Close /></el-icon>
                  停止
                </el-button>
              </div>
              <div class="streaming-content-box">
                <div class="streaming-text">{{ streamingContent }}</div>
              </div>
            </div>

            <!-- 优化结果显示 -->
            <div v-else-if="form.optimizedContent" class="result-area">
              <div class="result-content">
                {{ form.optimizedContent }}
              </div>
              <div class="result-stats">
                <span>润色后字数：{{ form.optimizedContent.length }}</span>
                <span>
                  字数变化：{{
                    form.optimizedContent.length - form.originalContent.length > 0 ? '+' : ''
                  }}{{ form.optimizedContent.length - form.originalContent.length }}
                </span>
              </div>
            </div>

            <!-- 空状态 -->
            <div v-else class="empty-result">
              <el-empty description="点击润色按钮开始AI润色" />
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="streaming" :disabled="!canStart" @click="emit('start')">
          <el-icon><MagicStick /></el-icon>
          {{ streaming ? '润色中...' : '开始润色' }}
        </el-button>
        <el-button
          v-if="form.optimizedContent && form.mode === 'selection'"
          type="success"
          :loading="applying"
          :disabled="applying"
          @click="emit('apply-selection')"
        >
          <el-icon><Check /></el-icon>
          替换选择内容
        </el-button>
        <el-button
          v-if="form.optimizedContent && form.mode === 'full'"
          type="success"
          :loading="applying"
          :disabled="applying"
          @click="emit('apply-full')"
        >
          <el-icon><Check /></el-icon>
          替换全文内容
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { Check, Close, CopyDocument, MagicStick } from '@element-plus/icons-vue'
import type { PromptTemplate, WriterOptimizeForm } from '@/types/writer'

const visible = defineModel<boolean>({ required: true })
const form = defineModel<WriterOptimizeForm>('form', { required: true })

defineProps<{
  prompts: readonly PromptTemplate[]
  streamingContent: string
  streaming: boolean
  applying: boolean
  canStart: boolean
}>()

const emit = defineEmits<{
  close: []
  'select-prompt': [prompt: PromptTemplate]
  'open-prompt-library': []
  copy: []
  stop: []
  start: []
  'apply-selection': []
  'apply-full': []
}>()
</script>

<style scoped>
.new-optimize-container {
  max-height: 70vh;
  overflow-y: auto;
}

.optimize-config-card,
.optimize-result-card {
  display: flex;
  flex-direction: column;
}

.optimize-config-card {
  height: 600px;
}

.optimize-result-card {
  height: 100%;
}

.optimize-config-card :deep(.el-card__body),
.optimize-result-card :deep(.el-card__body) {
  flex: 1;
  overflow-y: auto;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}

.prompt-selection {
  margin-bottom: 20px;
}

.prompt-selection h4 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.prompt-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prompt-item {
  padding: 12px;
  cursor: pointer;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  transition: all 0.3s;
}

.prompt-item:hover {
  background-color: var(--brand-50);
  border-color: var(--brand-500);
}

.prompt-item.active {
  background-color: #ecf5ff;
  border-color: var(--brand-500);
  box-shadow: 0 0 0 1px var(--brand-500);
}

.prompt-title {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.prompt-desc {
  margin: 0 0 8px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--el-text-color-regular);
}

.empty-prompts {
  padding: 40px 20px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.custom-prompt,
.original-content-preview {
  margin-bottom: 20px;
}

.custom-prompt h4,
.original-content-preview h4 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
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
  padding: 12px 16px;
  margin-bottom: 12px;
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
  word-wrap: break-word;
  word-break: break-all;
  white-space: pre-wrap;
  background-color: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
}

.streaming-text::after {
  color: var(--brand-500);
  content: '▋';
  animation: blink 1s infinite;
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

.result-content {
  flex: 1;
  min-height: 300px;
  max-height: 400px;
  padding: 16px;
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.8;
  color: var(--el-text-color-primary);
  word-wrap: break-word;
  white-space: pre-wrap;
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
  min-height: 300px;
  height: 100%;
  padding: 20px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
