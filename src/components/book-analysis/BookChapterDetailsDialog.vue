<template>
<el-dialog 
      v-model="showChapterDetails" 
      title="章节管理"
      width="90%"
      :show-close="true"
    >
      <div class="chapter-details-main book-analysis-dialog">
        <!-- 左侧章节列表 -->
        <div class="chapter-list-panel">
          <div class="panel-header">
            <h4>章节列表 ({{ autoDetectedChapters.length }}章)</h4>
          </div>
          <div class="chapter-list">
            <div 
              v-for="chapter in autoDetectedChapters"
              :key="chapter.index"
              class="chapter-list-item"
              :class="{ active: selectedDetailChapter === chapter.index }"
              @click="selectDetailChapter(chapter.index)"
            >
              <div class="chapter-item-header">
                <span class="chapter-item-title">{{ chapter.title }}</span>
                <span class="chapter-item-words">{{ chapter.wordCount }}字</span>
              </div>
              <div class="chapter-item-summary">
                {{ chapter.summary || '暂无简读，点击查看后可调用AI生成' }}
              </div>
            </div>
          </div>
        </div>
        
        <!-- 右侧章节详情 -->
        <div class="chapter-detail-panel">
          <div class="detail-header" v-if="currentDetailChapter">
            <h4>{{ currentDetailChapter.title }}</h4>
            <div class="detail-actions">
              <el-button size="small" @click="copyDetailChapterContent">
                <el-icon><DocumentCopy /></el-icon>
                复制
              </el-button>
              <el-button size="small" type="primary" @click="exportDetailChapterContent">
                <el-icon><Download /></el-icon>
                导出
              </el-button>
            </div>
          </div>
          
          <!-- 标签页切换 -->
          <el-tabs v-model="activeDetailTab" v-if="currentDetailChapter">
            <el-tab-pane label="完整内容" name="content">
              <div class="full-content">
                <el-scrollbar height="400px">
                  <div class="chapter-full-text">
                    {{ currentDetailChapterContent }}
                  </div>
                </el-scrollbar>
              </div>
            </el-tab-pane>
            
            <el-tab-pane label="章节简读" name="summary">
              <el-button v-if="generatingSummary" @click="summaryTask.stop">停止解读</el-button>
              <div class="summary-content">
                <div class="chapter-meta">
                  <el-tag>{{ currentDetailChapter.title }}</el-tag>
                  <el-tag type="info">{{ currentDetailChapter.wordCount }}字</el-tag>
                </div>
                
                <!-- AI解读控制区域 -->
                <div class="summary-actions" v-if="!currentDetailChapter.summary || currentDetailChapter.summary.trim() === ''">
                  <!-- 提示词编辑区域 -->
                  <div class="prompt-section">
                    <div class="prompt-header">
                      <span class="prompt-label">AI解读提示词</span>
                      <el-button 
                        size="small" 
                        text 
                        @click="showPromptEditor = !showPromptEditor"
                      >
                        <el-icon><Edit /></el-icon>
                        {{ showPromptEditor ? '收起编辑' : '编辑提示词' }}
                      </el-button>
                    </div>
                    
                    <div class="prompt-preview" v-if="!showPromptEditor">
                      <div class="prompt-text">
                        {{ getPreviewPrompt() }}
                      </div>
                    </div>
                    
                    <div class="prompt-editor" v-else>
                      <el-input
                        v-model="summaryPromptTemplate"
                        type="textarea"
                        :rows="8"
                        placeholder="编辑AI解读提示词..."
                        class="prompt-textarea"
                      />
                      <div class="prompt-actions">
                        <div class="prompt-tips">
                          <el-tag size="small" type="info">提示：使用 {章节标题}、{章节字数}、{章节内容} 作为变量占位符</el-tag>
                        </div>
                        <div class="prompt-buttons">
                          <el-button size="small" @click="resetPromptTemplate">
                            重置默认
                          </el-button>
                          <el-button size="small" type="primary" @click="previewFullPrompt">
                            <el-icon><View /></el-icon>
                            预览完整提示词
                          </el-button>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <el-empty 
                    description="暂无章节简读" 
                    :image-size="60"
                  >
                    <el-button 
                      type="primary" 
                      @click="generateChapterSummaryWithAI"
                      :loading="generatingSummary"
                      :disabled="importingFile"
                    >
                      <el-icon><MagicStick /></el-icon>
                      {{ generatingSummary ? 'AI解读中...' : '调用AI解读' }}
                    </el-button>
                  </el-empty>
                </div>
                
                <!-- 显示已有简读 -->
                <div class="summary-display" v-else>
                  <!-- 提示词编辑区域（已有简读时） -->
                  <div class="prompt-section">
                    <div class="prompt-header">
                      <span class="prompt-label">AI解读提示词</span>
                      <el-button 
                        size="small" 
                        text 
                        @click="showPromptEditor = !showPromptEditor"
                      >
                        <el-icon><Edit /></el-icon>
                        {{ showPromptEditor ? '收起编辑' : '编辑提示词' }}
                      </el-button>
                    </div>
                    
                    <div class="prompt-preview" v-if="!showPromptEditor">
                      <div class="prompt-text">
                        {{ getPreviewPrompt() }}
                      </div>
                    </div>
                    
                    <div class="prompt-editor" v-else>
                      <el-input
                        v-model="summaryPromptTemplate"
                        type="textarea"
                        :rows="8"
                        placeholder="编辑AI解读提示词..."
                        class="prompt-textarea"
                      />
                      <div class="prompt-actions">
                        <div class="prompt-tips">
                          <el-tag size="small" type="info">提示：使用 {章节标题}、{章节字数}、{章节内容} 作为变量占位符</el-tag>
                        </div>
                        <div class="prompt-buttons">
                          <el-button size="small" @click="resetPromptTemplate">
                            重置默认
                          </el-button>
                          <el-button size="small" type="primary" @click="previewFullPrompt">
                            <el-icon><View /></el-icon>
                            预览完整提示词
                          </el-button>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div class="summary-text">
                    {{ currentDetailChapter.summary }}
                  </div>
                  <div class="summary-actions-bottom">
                    <el-button 
                      size="small" 
                      @click="regenerateChapterSummary"
                      :loading="generatingSummary"
                      :disabled="importingFile"
                    >
                      重新解读
                    </el-button>
                  </div>
                </div>
              </div>
            </el-tab-pane>
          </el-tabs>
          
          <div class="empty-detail" v-else>
            <el-icon><Document /></el-icon>
            <p>请选择左侧章节查看详情</p>
          </div>
        </div>
      </div>
      
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="showChapterDetails = false">关闭</el-button>
          <el-button type="info" @click="exportAllChapterSummary">导出所有简读</el-button>
          <el-button type="primary" @click="exportAllChapterContent">导出所有章节</el-button>
        </div>
      </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { useBookAnalysisWorkspaceContext } from '@/composables/book-analysisContext'
import { Document, Download, DocumentCopy, MagicStick, View, Edit } from '@element-plus/icons-vue'
const { importingFile, autoDetectedChapters, showChapterDetails, selectedDetailChapter, currentDetailChapter, currentDetailChapterContent, activeDetailTab, summaryPromptTemplate, showPromptEditor, summaryTask, generatingSummary, selectDetailChapter, copyDetailChapterContent, exportDetailChapterContent, exportAllChapterSummary, exportAllChapterContent, getPreviewPrompt, generateChapterSummaryWithAI, regenerateChapterSummary, resetPromptTemplate, previewFullPrompt } = useBookAnalysisWorkspaceContext()
</script>
