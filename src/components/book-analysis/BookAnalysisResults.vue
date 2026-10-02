<template>
<div class="right-panel">
        <div class="editor-container">
          <div class="editor-header">
            <h3 v-if="!bookContent">📋 分析结果</h3>
            <h3 v-else-if="analysisResult === null && !analyzing">📄 文本预览</h3>
            <h3 v-else-if="analyzing">🔄 正在分析...</h3>
            <h3 v-else>📋 分析结果</h3>
            <el-tag v-if="currentLibraryReportTitle" size="small">{{ currentLibraryReportTitle }}</el-tag>
            
            <div class="header-actions" v-if="analysisResult !== null">
              <el-button size="small" :disabled="!analysisResult.trim()" @click="exportResults">
                <el-icon><Download /></el-icon>
                导出
              </el-button>
              <el-button size="small" :disabled="libraryReportBusy || !analysisResult.trim()" title="保存到参考库" @click="saveToLibrary">
                <el-icon><FolderAdd /></el-icon>
                保存
              </el-button>
            </div>
          </div>
          
          <!-- 分析进度 -->
          <div v-if="analyzing" class="progress-section">
            <el-progress 
              :percentage="analysisProgress" 
              :stroke-width="6"
              :show-text="false"
            />
            <p class="progress-text">{{ analysisStatus }}</p>
          </div>
          
          <!-- 富文本编辑器 -->
          <el-input
            ref="analysisEditorRef"
            v-model="displayContent"
            type="textarea"
            :placeholder="getPlaceholder()"
            :rows="30"
            :readonly="analyzing || savingLibraryReport"
            class="analysis-editor"
          />
        </div>
      </div>
</template>

<script setup lang="ts">
import { useBookAnalysisWorkspaceContext } from '@/composables/book-analysisContext'
import { Download, FolderAdd } from '@element-plus/icons-vue'
const { savingLibraryReport, libraryReportBusy, currentLibraryReportTitle, bookContent, analysisProgress, analysisStatus, analysisResult, analysisEditorRef, displayContent, getPlaceholder, analyzing, exportResults, saveToLibrary } = useBookAnalysisWorkspaceContext()
</script>
