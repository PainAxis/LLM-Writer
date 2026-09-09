<template>
  <el-dialog
    v-model="visible"
    title="AI批量生成章节"
    width="900px"
    :close-on-click-modal="!committing"
    :close-on-press-escape="!committing"
    :show-close="!committing"
    @close="emit('close')"
  >
    <div class="ai-batch-chapter-content">
      <el-form :model="form" label-width="120px" :disabled="generating">
        <el-form-item label="生成数量">
          <el-input-number v-model="form.count" :min="1" :max="10" />
        </el-form-item>
        <el-form-item label="情节要求">
          <el-input
            v-model="form.plotRequirement"
            type="textarea"
            :rows="3"
            placeholder="描述希望的情节发展..."
          />
        </el-form-item>
        <el-form-item label="提示词模板">
          <el-select v-model="form.template" placeholder="选择模板">
            <el-option label="通用章节" value="general" />
            <el-option label="战斗场景" value="battle" />
            <el-option label="情感戏" value="emotion" />
            <el-option label="转折剧情" value="turning" />
          </el-select>
        </el-form-item>
      </el-form>

      <!-- 自定义提示词状态显示 -->
      <div v-if="selectedPrompt" class="custom-prompt-status">
        <el-alert
          :title="`已选择自定义提示词：${selectedPrompt.title}`"
          type="success"
          show-icon
          :closable="false"
        >
          <div class="prompt-preview">
            {{
              selectedPrompt.description ||
              '自定义提示词已准备就绪，点击"批量生成"按钮开始使用此提示词生成章节'
            }}
          </div>
        </el-alert>

        <!-- 提示词内容预览 -->
        <el-collapse v-model="promptCollapse" class="prompt-content-collapse">
          <el-collapse-item title="查看提示词内容" name="promptContent">
            <div class="prompt-content-preview">
              <div class="prompt-content-header">
                <span class="content-label">原始提示词内容：</span>
              </div>
              <div class="prompt-content-text">
                {{ selectedPrompt.content }}
              </div>

              <div v-if="finalPrompt" class="final-prompt-section">
                <div class="prompt-content-header">
                  <span class="content-label">填充变量后的最终提示词：</span>
                </div>
                <div class="prompt-content-text final-prompt">
                  {{ finalPrompt }}
                </div>
              </div>
            </div>
          </el-collapse-item>
        </el-collapse>
      </div>

      <!-- 流式生成内容显示 -->
      <div v-if="streaming" class="streaming-content-area">
        <el-card shadow="never" class="streaming-card">
          <template #header>
            <div class="streaming-header">
              <span>🔄 AI正在批量生成章节大纲...</span>
              <el-tag type="success" size="small">实时生成中...</el-tag>
            </div>
          </template>
          <div ref="streamingContentElement" class="streaming-content">
            <pre class="streaming-text-plain">{{ streamingContent }}</pre>
          </div>
        </el-card>
      </div>
    </div>
    <template #footer>
      <el-button :disabled="committing" @click="visible = false">取消</el-button>
      <el-button :disabled="generating" @click="emit('choose-prompt')">选择提示词</el-button>
      <el-button type="primary" :loading="generating" :disabled="committing" @click="emit('generate')">
        <el-icon><Star /></el-icon>
        {{ committing ? '保存中...' : selectedPrompt ? '使用自定义提示词生成' : '批量生成' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Star } from '@element-plus/icons-vue'
import type { PromptTemplate, WriterBatchChapterGenerationForm } from '@/types/writer'

const visible = defineModel<boolean>({ required: true })
const form = defineModel<WriterBatchChapterGenerationForm>('form', { required: true })
const promptCollapse = ref(['promptContent'])

watch(visible, opened => {
  if (opened) promptCollapse.value = ['promptContent']
})

const props = defineProps<{
  selectedPrompt: PromptTemplate | null
  finalPrompt: string
  streamingContent: string
  streaming: boolean
  generating: boolean
  committing: boolean
}>()

const streamingContentElement = ref<HTMLElement | null>(null)
watch(() => props.streamingContent, () => {
  if (!props.streaming || !streamingContentElement.value) return
  streamingContentElement.value.scrollTop = streamingContentElement.value.scrollHeight
}, { flush: 'post' })

const emit = defineEmits<{
  close: []
  'choose-prompt': []
  generate: []
}>()
</script>

<style scoped>
.ai-batch-chapter-content {
  padding: 10px 0;
}

.custom-prompt-status {
  margin: 16px 0;
}

.custom-prompt-status .el-alert {
  border-radius: 8px;
}

.prompt-preview {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--el-color-success);
  opacity: 0.9;
}

.prompt-content-collapse {
  margin-top: 12px;
  background-color: #f8fdff;
  border: 1px solid #e1f5fe;
  border-radius: 6px;
}

.prompt-content-preview {
  padding: 0;
}

.prompt-content-header {
  padding-bottom: 6px;
  margin-bottom: 8px;
  border-bottom: 1px solid #e8f4fd;
}

.content-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--brand-500);
}

.prompt-content-text {
  max-height: 200px;
  padding: 12px;
  margin-bottom: 16px;
  overflow-y: auto;
  font-family: 'Courier New', Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
  word-wrap: break-word;
  white-space: pre-wrap;
  background-color: #fafcff;
  border: 1px solid #e8f4fd;
  border-radius: 4px;
}

.final-prompt-section {
  padding-top: 16px;
  margin-top: 16px;
  border-top: 1px solid #e8f4fd;
}

.final-prompt {
  margin-top: 20px;
  color: #01579b;
  background-color: var(--brand-50);
  border-color: #b3e5fc;
}

.streaming-content-area {
  margin-top: 20px;
  margin-bottom: 16px;
  background-color: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
}

.streaming-card {
  margin: 0;
  background: transparent;
  border: none;
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

.streaming-text-plain {
  margin: 0;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  word-break: break-all;
  white-space: pre-wrap;
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
</style>
