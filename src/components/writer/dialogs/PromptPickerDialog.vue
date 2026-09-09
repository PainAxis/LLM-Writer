<template>
  <el-dialog v-model="visible" title="选择提示词" width="800px" @close="emit('close')">
    <div class="prompt-dialog-content">
      <div class="prompt-list">
        <h4>{{ categoryName }} 提示词</h4>
        <div class="prompt-cards">
          <div
            v-for="prompt in filteredPrompts"
            :key="prompt.id"
            class="prompt-card"
            :class="{ active: selectedPrompt?.id === prompt.id }"
            @click="emit('select', prompt)"
          >
            <div class="prompt-card-header">
              <h5>{{ prompt.title }}</h5>
            </div>
            <div class="prompt-card-description">
              <p>{{ prompt.description }}</p>
            </div>
            <div class="prompt-card-tags">
              <el-tag v-for="tag in prompt.tags" :key="tag" size="small">{{ tag }}</el-tag>
            </div>
          </div>
        </div>

        <div v-if="filteredPrompts.length === 0" class="empty-prompts">
          <p>暂无该类型的提示词</p>
          <el-button type="primary" @click="emit('open-library')">去提示词库添加</el-button>
        </div>
      </div>

      <div v-if="selectedPrompt && Object.keys(variables).length > 0" class="prompt-variables">
        <h4>填充变量</h4>
        <el-form label-width="120px" size="small">
          <el-form-item
            v-for="(value, variable) in variables"
            :key="variable"
            :label="variable + '：'"
          >
            <el-input
              v-model="variables[variable]"
              :placeholder="'请输入' + variable"
              @input="emit('variables-change')"
            />
          </el-form-item>
        </el-form>
      </div>

      <div v-if="selectedPrompt" class="final-prompt">
        <h4>最终提示词预览</h4>
        <el-input
          v-model="finalPrompt"
          type="textarea"
          :rows="8"
          readonly
          placeholder="请先选择提示词并填充变量"
        />
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button v-if="selectedPrompt" @click="emit('copy')">复制提示词</el-button>
      <el-button v-if="selectedPrompt" type="primary" @click="emit('confirm')">
        使用此提示词
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PromptTemplate, WriterPromptVariables } from '@/types/writer'

const visible = defineModel<boolean>({ default: false })
const selectedPrompt = defineModel<PromptTemplate | null>('selectedPrompt', { required: true })
const variables = defineModel<WriterPromptVariables>('variables', { required: true })
const finalPrompt = defineModel<string>('finalPrompt', { required: true })

const props = defineProps<{
  category: string
  prompts: readonly PromptTemplate[]
}>()

const emit = defineEmits<{
  close: []
  select: [prompt: PromptTemplate]
  'variables-change': []
  'open-library': []
  copy: []
  confirm: []
}>()

const categoryNames: Readonly<Record<string, string>> = {
  outline: '章节大纲',
  content: '基础正文',
  'content-dialogue': '对话生成',
  'content-scene': '场景描写',
  'content-action': '动作情节',
  'content-psychology': '心理描写',
  polish: '文本优化',
  continue: '智能续写',
  character: '人物生成',
  worldview: '世界观生成',
}

const filteredPrompts = computed(() => props.prompts.filter((prompt) => prompt.category === props.category))
const categoryName = computed(() => categoryNames[props.category] || '提示词')
</script>

<style scoped>
.prompt-dialog-content {
  max-height: 600px;
  overflow-y: auto;
}

.prompt-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prompt-list h4 {
  margin: 0 0 16px 0;
  color: var(--el-text-color-primary);
  font-size: 16px;
}

.prompt-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.prompt-card {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.3s;
  background-color: var(--el-bg-color);
}

.prompt-card:hover {
  border-color: var(--brand-500);
  background-color: var(--brand-50);
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(64, 158, 255, 0.1);
}

.prompt-card.active {
  border-color: var(--brand-500);
  background-color: #ecf5ff;
  box-shadow: 0 0 0 1px var(--brand-500);
}

.prompt-card-header h5 {
  margin: 0 0 8px 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.prompt-card-description p {
  margin: 0 0 8px 0;
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.4;
}

.prompt-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.prompt-card-tags .el-tag {
  font-size: 11px;
  height: 20px;
  line-height: 18px;
}

.empty-prompts {
  text-align: center;
  padding: 40px 20px;
  color: var(--el-text-color-secondary);
}

.prompt-variables {
  margin: 20px 0;
  padding: 16px;
  background-color: #f9f9f9;
  border-radius: 6px;
}

.prompt-variables h4 {
  margin: 0 0 16px 0;
  color: var(--el-text-color-primary);
  font-size: 14px;
}

.final-prompt {
  margin-top: 20px;
  background-color: var(--brand-50);
  border-color: #b3e5fc;
  color: #01579b;
}

.final-prompt h4 {
  margin: 0 0 12px 0;
  color: var(--el-text-color-primary);
  font-size: 14px;
}

</style>
