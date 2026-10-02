<template>
<el-dialog
      v-model="showChapterContent"
      title="章节内容查看"
      width="80%"
      :before-close="closeChapterContent"
    >
      <div class="chapter-content-dialog book-analysis-dialog">
        <div class="chapter-selector">
          <el-select 
            v-model="selectedViewChapter" 
            placeholder="选择要查看的章节" 
            style="width: 300px"
            @change="loadChapterContent"
          >
            <el-option
              v-for="chapter in detectedChapters"
              :key="chapter.index"
              :label="chapter.title"
              :value="chapter.index"
            >
              <div class="chapter-select-option">
                <span class="chapter-title">{{ chapter.title }}</span>
                <span class="chapter-words">({{ chapter.wordCount }}字)</span>
              </div>
            </el-option>
          </el-select>
          
          <div class="chapter-info" v-if="currentViewChapter">
            <el-tag>{{ currentViewChapter.title }}</el-tag>
            <el-tag type="info">{{ currentViewChapter.wordCount }}字</el-tag>
            <el-tag type="warning" v-if="currentViewChapter.summary">{{ currentViewChapter.summary }}</el-tag>
          </div>
        </div>
        
        <div class="chapter-content-viewer">
          <el-scrollbar height="500px">
            <div class="chapter-text" v-if="currentChapterContent">
              {{ currentChapterContent }}
            </div>
            <div class="empty-state" v-else>
              <el-icon><Document /></el-icon>
              <p>请选择章节查看内容</p>
            </div>
          </el-scrollbar>
        </div>
      </div>
      
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="closeChapterContent">关闭</el-button>
          <el-button type="primary" @click="copyChapterContent" :disabled="!currentChapterContent">
            <el-icon><DocumentCopy /></el-icon>
            复制内容
          </el-button>
          <el-button type="success" @click="exportChapterContent" :disabled="!currentChapterContent">
            <el-icon><Download /></el-icon>
            导出章节
          </el-button>
        </div>
      </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { useBookAnalysisWorkspaceContext } from '@/composables/book-analysisContext'
import { Document, Download, DocumentCopy } from '@element-plus/icons-vue'
const { detectedChapters, showChapterContent, selectedViewChapter, currentViewChapter, currentChapterContent, closeChapterContent, loadChapterContent, copyChapterContent, exportChapterContent } = useBookAnalysisWorkspaceContext()
</script>
