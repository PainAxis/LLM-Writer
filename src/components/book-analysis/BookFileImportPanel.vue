<template>
<div class="panel-section">
          <h3>📁 导入小说</h3>

          <!-- 编码选择 -->
          <div class="encoding-selection" v-if="!uploadedFile">
            <label>文件编码:</label>
            <el-radio-group v-model="selectedEncoding" size="small">
              <el-radio-button label="utf-8">UTF-8</el-radio-button>
              <el-radio-button label="gbk">GBK/GB2312</el-radio-button>
            </el-radio-group>
          </div>

          <el-upload
            class="upload-area"
            drag
            :auto-upload="false"
            :disabled="busy"
            :on-change="file => emit('change', file)"
            :on-exceed="files => emit('exceed', files)"
            accept=".txt,.docx"
            :limit="1"
            :show-file-list="false"
          >
            <el-icon class="el-icon--upload">
              <UploadFilled />
            </el-icon>
            <div class="el-upload__text">
              拖拽文件到此处或<em>点击上传</em>
            </div>
            <template #tip>
              <div class="el-upload__tip">
                支持 .txt 和 .docx 格式；编码选择仅用于 TXT
              </div>
            </template>
          </el-upload>

          <p v-if="importingFile" role="status">正在读取文件...</p>
          <div v-if="uploadedFile" class="file-info">
            <div class="file-card">
              <el-icon><Document /></el-icon>
              <div class="file-details">
                <span class="file-name">{{ uploadedFile.name }}</span>
                <span class="file-size">{{ ((uploadedFile.size || 0) / 1024).toFixed(1) }}KB</span>
                <span class="file-encoding">{{ fileFormatLabel }}</span>
              </div>
              <div class="file-actions">
                <el-button type="text" size="small" @click="emit('reread')" :disabled="busy" title="重新读取">
                  重新读取
                </el-button>
                <el-button type="text" @click="emit('remove')" :disabled="busy" class="remove-btn">
                  <el-icon><Close /></el-icon>
                </el-button>
              </div>
            </div>

            <!-- 编码切换 -->
            <div v-if="!isDocx" class="encoding-switch">
              <span>编码:</span>
              <el-radio-group v-model="selectedEncoding" size="small" :disabled="busy" @change="emit('reread')">
                <el-radio-button label="utf-8">UTF-8</el-radio-button>
                <el-radio-button label="gbk">GBK/GB2312</el-radio-button>
              </el-radio-group>
            </div>
          </div>
        </div>
</template>

<script setup lang="ts">
import { UploadFilled, Document, Close } from '@element-plus/icons-vue'
import type { BookSourceFile } from '@/composables/useBookAnalysisFile'
import type { TextEncoding } from '@/utils/bookImport'
const selectedEncoding = defineModel<TextEncoding>('encoding', { required: true })
defineProps<{ uploadedFile: BookSourceFile | null; importingFile: boolean; busy: boolean; isDocx: boolean; fileFormatLabel: string }>()
const emit = defineEmits<{ change: [file: BookSourceFile]; exceed: [files: File[]]; reread: []; remove: [] }>()
</script>

<style scoped>


.panel-section {
  margin-bottom: 24px;
}

.panel-section h3 {
  font-size: 16px;
  color: #2c3e50;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.upload-area {
  width: 100%;
}

.upload-area .el-upload-dragger {
  width: 100%;
  height: 120px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}
.encoding-selection {
  margin-bottom: 16px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  border: 1px solid var(--el-border-color-light);
}

.encoding-selection label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #2c3e50;
}

.encoding-switch {
  margin-top: 12px;
  padding: 8px 12px;
  background: #f0f2f5;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.encoding-switch span {
  font-size: 12px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}

.file-info {
  margin-top: 12px;
}

.file-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background: var(--el-fill-color-light);
}

.file-details {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.file-name {
  font-size: 14px;
  color: #2c3e50;
  font-weight: 500;
}

.file-size {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.file-encoding {
  font-size: 11px;
  color: var(--el-color-success);
  background: var(--brand-50);
  padding: 2px 6px;
  border-radius: 10px;
  border: 1px solid #b3e5fc;
  align-self: flex-start;
}

.file-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}

.remove-btn {
  color: var(--el-color-danger);
}
</style>
