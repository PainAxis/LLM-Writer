<template>
  <el-form ref="formRef" :model="form" :disabled="disabled" :rules="rules" label-width="80px">
    <el-form-item label="小说标题" prop="title">
      <el-input v-model="form.title" placeholder="请输入小说标题" />
    </el-form-item>

    <el-form-item label="类型" prop="genre">
      <el-select
        v-model="form.genre"
        placeholder="请选择小说类型"
        @change="emit('genreChange', String($event))"
      >
        <el-option v-for="(preset, key) in genres" :key="key" :label="preset.name" :value="key">
          <div style="display: flex; justify-content: space-between; align-items: center">
            <span>{{ preset.name }}</span>
            <el-tag size="small" type="info">{{ preset.tags.slice(0, 2).join('、') }}</el-tag>
          </div>
        </el-option>
      </el-select>
      <div
        v-if="form.genre && genres[form.genre]"
        style="margin-top: 8px; font-size: 12px; color: var(--el-text-color-secondary)"
      >
        💡 {{ genres[form.genre].prompt }}
      </div>
    </el-form-item>

    <el-form-item v-if="mode === 'edit'" label="状态" prop="status">
      <el-select v-model="form.status" placeholder="请选择小说状态">
        <el-option label="创作中" value="writing" />
        <el-option label="已完成" value="completed" />
        <el-option label="已暂停" value="paused" />
      </el-select>
    </el-form-item>

    <el-form-item label="简介" prop="description">
      <div class="description-input-group">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="4"
          placeholder="请输入小说简介或点击AI生成"
        />
        <div class="ai-generate-section" v-if="form.genre">
          <el-button
            type="primary"
            size="small"
            @click="emit('generate')"
            :loading="generating"
            :disabled="!form.title?.trim()"
          >
            <el-icon><Star /></el-icon>
            {{ generating ? 'AI生成中...' : mode === 'edit' ? 'AI重新生成' : 'AI智能生成' }}
          </el-button>
          <el-button
            v-if="mode === 'create' && form.description"
            size="small"
            @click="emit('generate')"
            :loading="generating"
            :disabled="!form.title?.trim()"
          >
            重新生成
          </el-button>
          <span class="generate-tip">使用AI技术基于标题和类型智能生成</span>
        </div>
      </div>
    </el-form-item>

    <el-form-item label="封面">
      <div class="cover-upload-container">
        <div class="cover-uploader" @click="fileInput?.click()">
          <img v-if="form.cover" :src="form.cover" class="cover-preview" />
          <div v-else class="cover-uploader-placeholder">
            <el-icon class="cover-uploader-icon"><Plus /></el-icon>
            <div class="upload-text">点击上传封面</div>
          </div>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          style="display: none"
          @change="emit('coverChange', $event)"
        />
        <div v-if="form.cover" class="cover-actions">
          <el-button size="small" type="danger" @click="emit('removeCover')">
            <el-icon><Delete /></el-icon>
            移除封面
          </el-button>
        </div>
      </div>
    </el-form-item>

    <el-form-item label="标签">
      <el-input v-model="tagInput" placeholder="输入标签后按回车添加" @keyup.enter="emit('addTag')">
        <template #append>
          <el-button @click="emit('addTag')">添加</el-button>
        </template>
      </el-input>
      <div class="tags-display" v-if="form.tags.length > 0">
        <el-tag
          v-for="(tag, index) in form.tags"
          :key="index"
          closable
          @close="emit('removeTag', index)"
          style="margin: 2px 4px 2px 0"
        >
          {{ tag }}
        </el-tag>
      </div>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Plus, Delete, Star } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import type { NovelMetadataDraft, NovelGenrePreset } from '@/types/novelManagement'
const form = defineModel<NovelMetadataDraft>({ required: true })
const tagInput = defineModel<string>('tagInput', { required: true })
defineProps<{
  mode: 'create' | 'edit'
  genres: Record<string, NovelGenrePreset>
  rules: FormRules
  disabled: boolean
  generating: boolean
}>()
const emit = defineEmits<{
  genreChange: [genre: string]
  generate: []
  coverChange: [event: Event]
  removeCover: []
  addTag: []
  removeTag: [index: number]
}>()
const formRef = ref<FormInstance>()
const fileInput = ref<HTMLInputElement>()
defineExpose({
  validate: () => {
    if (!formRef.value) return Promise.reject(new Error('Form is not mounted'))
    return formRef.value.validate()
  },
  clearValidate: () => formRef.value?.clearValidate(),
  clearCoverInput: () => {
    if (fileInput.value) fileInput.value.value = ''
  },
})
</script>

<style scoped>
.cover-uploader {
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  width: 120px;
  height: 160px;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-uploader:hover {
  border-color: var(--brand-500);
  background-color: var(--el-fill-color-light);
}

.cover-uploader-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  text-align: center;
}

.cover-uploader-icon {
  font-size: 24px;
  color: #8c939d;
  margin-bottom: 8px;
}

.upload-text {
  font-size: 12px;
  color: #8c939d;
  line-height: 1.2;
}

.cover-preview {
  width: 120px;
  height: 160px;
  object-fit: cover;
  display: block;
  border-radius: 6px;
}

.cover-upload-container {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.cover-actions {
  display: flex;
  gap: 8px;
}

.tags-display {
  margin-top: 10px;
}

.tags-display .el-tag {
  margin: 2px 4px 2px 0;
}

.description-input-group {
  position: relative;
}

.ai-generate-section {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  border: 1px solid #e9ecef;
}

.generate-tip {
  font-size: 12px;
  color: #6c757d;
}
</style>
