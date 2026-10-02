<template>
  <div class="book-analysis">
    <div class="analysis-container">
      <!-- 左侧操作面板 -->
      <BookAnalysisControls />
      
      <!-- 右侧内容区域 -->
      <BookAnalysisResults />
    </div>
    
    <!-- 章节简读对话框 -->
    <BookChapterDetailsDialog />
    
    <!-- 章节内容查看弹窗 -->
    <BookChapterContentDialog />
    
    <!-- 完整提示词预览弹窗 -->
    <BookPromptPreviewDialog />
  </div>
</template>

<script setup lang="ts">
import { useBookAnalysisWorkspace } from '@/composables/useBookAnalysisWorkspace'
import { provideBookAnalysisWorkspace } from '@/composables/book-analysisContext'
import BookAnalysisControls from '@/components/book-analysis/BookAnalysisControls.vue'
import BookAnalysisResults from '@/components/book-analysis/BookAnalysisResults.vue'
import BookChapterDetailsDialog from '@/components/book-analysis/BookChapterDetailsDialog.vue'
import BookChapterContentDialog from '@/components/book-analysis/BookChapterContentDialog.vue'
import BookPromptPreviewDialog from '@/components/book-analysis/BookPromptPreviewDialog.vue'
import '@/components/book-analysis/book-analysis.css'
const workspace = useBookAnalysisWorkspace()
provideBookAnalysisWorkspace(workspace)
</script>
