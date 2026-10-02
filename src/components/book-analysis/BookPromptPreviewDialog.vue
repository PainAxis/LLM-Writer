<template>
<el-dialog
      v-model="showPromptPreview"
      title="完整提示词预览"
      width="70%"
      :before-close="() => showPromptPreview = false"
    >
      <div class="prompt-preview-dialog book-analysis-dialog">
        <div class="preview-content">
          <el-scrollbar height="400px">
            <pre class="prompt-full-text">{{ fullPromptPreview }}</pre>
          </el-scrollbar>
        </div>
        
        <div class="preview-stats">
          <el-tag type="info">字符数：{{ fullPromptPreview.length }}</el-tag>
          <el-tag type="warning">行数：{{ fullPromptPreview.split('\n').length }}</el-tag>
        </div>
      </div>
      
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="showPromptPreview = false">关闭</el-button>
          <el-button type="primary" @click="copyFullPrompt">
            <el-icon><DocumentCopy /></el-icon>
            复制提示词
          </el-button>
        </div>
      </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { useBookAnalysisWorkspaceContext } from '@/composables/book-analysisContext'
import { DocumentCopy } from '@element-plus/icons-vue'
const { showPromptPreview, fullPromptPreview, copyFullPrompt } = useBookAnalysisWorkspaceContext()
</script>
