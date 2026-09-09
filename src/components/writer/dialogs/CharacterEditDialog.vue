<template>
  <el-dialog v-model="visible" title="编辑角色" width="700px">
    <el-form :model="form" label-width="80px">
      <el-row :gutter="20">
        <el-col :span="12">
          <el-form-item label="姓名">
            <el-input v-model="form.name" />
          </el-form-item>
          <el-form-item label="角色">
            <el-select v-model="form.role">
              <el-option label="主角" value="protagonist" />
              <el-option label="配角" value="supporting" />
              <el-option label="反派" value="antagonist" />
              <el-option label="路人" value="minor" />
            </el-select>
          </el-form-item>
          <el-form-item label="性别">
            <el-radio-group v-model="form.gender">
              <el-radio label="male">男</el-radio>
              <el-radio label="female">女</el-radio>
              <el-radio label="other">其他</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="年龄">
            <el-input-number v-model="form.age" :min="0" :max="1000" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="外貌">
            <el-input v-model="form.appearance" type="textarea" :rows="3" />
          </el-form-item>
          <el-form-item label="性格">
            <el-input v-model="form.personality" type="textarea" :rows="3" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="背景故事">
        <div class="form-item-with-ai">
          <el-input v-model="form.background" type="textarea" :rows="4" />
          <div class="ai-button-group" style="margin-top: 8px">
            <el-button
              size="small"
              type="primary"
              :loading="generating"
              style="flex: 1"
              @click="emit('generate-character')"
            >
              <el-icon><Star /></el-icon>
              AI生成角色信息
            </el-button>
            <el-button size="small" style="margin-left: 8px" @click="emit('choose-prompt')">
              📝 提示词
            </el-button>
          </div>
        </div>
      </el-form-item>
      <el-form-item label="标签">
        <el-input v-model="characterTagInput" placeholder="输入标签后按回车" @keyup.enter="addCharacterTag">
          <template #append>
            <el-button @click="addCharacterTag">添加</el-button>
          </template>
        </el-input>
        <div v-if="form.tags.length > 0" style="margin-top: 8px">
          <el-tag
            v-for="(tag, index) in form.tags"
            :key="index"
            closable
            style="margin-right: 8px"
            @close="removeCharacterTag(index)"
          >
            {{ tag }}
          </el-tag>
        </div>
      </el-form-item>
    </el-form>

    <div v-if="showStreaming" class="streaming-status-card">
      <div class="streaming-header">
        <span class="streaming-title">AI 正在生成角色信息...</span>
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
import { ref } from 'vue'
import { Star } from '@element-plus/icons-vue'
import type { WriterCharacterForm } from '@/types/writer'

const visible = defineModel<boolean>({ default: false })
const form = defineModel<WriterCharacterForm>('form', { required: true })

defineProps<{
  generating: boolean
  showStreaming: boolean
  streamingContent: string
}>()

const emit = defineEmits<{
  save: []
  'generate-character': []
  'choose-prompt': []
}>()

const characterTagInput = ref('')

function addCharacterTag(): void {
  const tag = characterTagInput.value.trim()
  if (tag && !form.value.tags.includes(tag)) {
    form.value.tags.push(tag)
    characterTagInput.value = ''
  }
}

function removeCharacterTag(index: number): void {
  form.value.tags.splice(index, 1)
}
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

.ai-button-group {
  display: flex;
  align-items: center;
}

.streaming-status-card {
  margin-top: 16px;
  background-color: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
}

.streaming-header {
  padding: 12px 16px;
  font-weight: 500;
  color: var(--el-color-success);
  border-bottom: 1px solid var(--el-border-color-light);
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
