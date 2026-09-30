<template>
  <div class="book-analysis">
    <div class="analysis-container">
      <!-- 左侧操作面板 -->
      <div class="left-panel">
        <!-- 文件上传区域 -->
        <BookFileImportPanel
          v-model:encoding="selectedEncoding"
          :uploaded-file="uploadedFile"
          :importing-file="importingFile"
          :busy="analyzing || generatingSummary"
          :is-docx="isDocx"
          :file-format-label="fileFormatLabel"
          @change="handleFileChange"
          @exceed="handleFileExceed"
          @reread="rereadWithEncoding"
          @remove="removeFile"
        />

        <!-- 分析设置 -->
        <div class="panel-section" v-if="bookContent">
          <h3>⚙️ 分析设置</h3>
          
          <div class="setting-item">
            <label>拆书模板</label>
            <el-select v-model="selectedTemplate" placeholder="选择分析模板">
              <el-option 
                v-for="template in analysisTemplates" 
                :key="template.id"
                :label="template.name" 
                :value="template.id"
              >
                <div class="template-option">
                  <span class="template-icon">{{ template.icon }}</span>
                  <span class="template-name">{{ template.name }}</span>
                </div>
              </el-option>
            </el-select>
          </div>
          
          <div class="setting-item" v-if="detectedChapters.length > 0">
            <label>章节选择</label>
            <el-select 
              v-model="selectedChapters" 
              multiple 
              placeholder="选择要分析的章节"
              size="small"
              style="width: 100%"
            >
              <el-option
                v-for="chapter in detectedChapters"
                :key="chapter.index"
                :label="chapter.title"
                :value="chapter.index"
              >
                <div class="chapter-option">
                  <div class="chapter-title">
                    <span>{{ chapter.title }}</span>
                    <span class="chapter-words">{{ chapter.wordCount }}字</span>
                  </div>
                  <div class="chapter-summary" v-if="chapter.summary">
                    {{ chapter.summary }}
                  </div>
                </div>
              </el-option>
            </el-select>
            
            <div class="chapter-actions">
              <el-button size="small" @click="selectAllChapters">全选</el-button>
              <el-button size="small" @click="clearChapterSelection">清空</el-button>
              <el-button 
                size="small" 
                type="primary"
                @click="openChapterViewer"
              >
                <el-icon><View /></el-icon>
                查看内容
              </el-button>
              <el-button 
                v-if="autoDetectedChapters.length > 0"
                size="small" 
                type="info"
                @click="openChapterDetailsViewer"
              >
                查看简读
              </el-button>
            </div>
          </div>
          
          <div class="setting-item" v-else-if="bookContent">
            <label>分析范围</label>
            <div class="range-input-group">
              <el-input-number 
                v-model="analysisStartWords" 
                :min="1" 
                :max="bookContent.length"
                :step="1000"
                size="small"
                placeholder="起始字数"
              />
              <span class="range-separator">至</span>
              <el-input-number 
                v-model="analysisEndWords" 
                :min="analysisStartWords"
                :max="bookContent.length"
                :step="1000"
                size="small"
                placeholder="结束字数"
              />
            </div>
            <p style="font-size: 12px; color: var(--el-text-color-secondary); margin: 5px 0 0 0;">
              未检测到章节，将分析第 {{ analysisStartWords }} - {{ analysisEndWords }} 字
            </p>
            
            <div class="local-chapter-section">
              <el-button 
                size="small" 
                type="primary" 
                @click="startLocalChapterDetection"
                :disabled="importingFile"
                style="width: 100%; margin-top: 8px;"
              >
                <el-icon><MagicStick /></el-icon>
                本地自动分章
              </el-button>
              <p class="el-upload__tip">按约 3000 字及句末或换行拆分，不调用 AI。</p>
            </div>
          </div>
        </div>
        
        <!-- 操作按钮 -->
        <div class="panel-section" v-if="bookContent">
          <div class="action-buttons">
            <el-button 
              type="primary" 
              @click="startAnalysis" 
              :loading="analyzing"
              :disabled="!selectedTemplate || importingFile"
              block
            >
              <el-icon><DataAnalysis /></el-icon>
              {{ analyzing ? '分析中...' : '开始拆书分析' }}
            </el-button>
            
            <el-button v-if="analyzing" @click="stopAnalysis">停止分析</el-button>
            <el-button 
              v-if="analysisResult" 
              @click="exportResults" 
              block
            >
              <el-icon><Download /></el-icon>
              导出分析结果
            </el-button>
            
            <el-button 
              v-if="analysisResult" 
              @click="saveToLibrary" 
              block
            >
              <el-icon><FolderAdd /></el-icon>
              保存到参考库
            </el-button>
          </div>
        </div>
        
        <!-- 文件统计 -->
        <div class="panel-section stats-section" v-if="bookContent">
          <h3>📊 文件统计</h3>
          <div class="stats-grid">
            <div class="stat-item">
              <span class="stat-label">总字数</span>
              <span class="stat-value">{{ bookContent.length.toLocaleString() }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">预计章节</span>
              <span class="stat-value">{{ estimatedChapters }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">阅读时长</span>
              <span class="stat-value">{{ Math.ceil(bookContent.length / 300) }}分钟</span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 右侧内容区域 -->
      <div class="right-panel">
        <div class="editor-container">
          <div class="editor-header">
            <h3 v-if="!bookContent">📋 分析结果</h3>
            <h3 v-else-if="!analysisResult && !analyzing">📄 文本预览</h3>
            <h3 v-else-if="analyzing">🔄 正在分析...</h3>
            <h3 v-else>📋 分析结果</h3>
            
            <div class="header-actions" v-if="analysisResult">
              <el-button size="small" @click="exportResults">
                <el-icon><Download /></el-icon>
                导出
              </el-button>
              <el-button size="small" @click="saveToLibrary">
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
            :readonly="analyzing && !analysisResult"
            class="analysis-editor"
          />
        </div>
      </div>
    </div>
    
    <!-- 章节简读对话框 -->
    <el-dialog 
      v-model="showChapterDetails" 
      title="章节管理"
      width="90%"
      :show-close="true"
    >
      <div class="chapter-details-main">
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
    
    <!-- 章节内容查看弹窗 -->
    <el-dialog
      v-model="showChapterContent"
      title="章节内容查看"
      width="80%"
      :before-close="closeChapterContent"
    >
      <div class="chapter-content-dialog">
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
    
    <!-- 完整提示词预览弹窗 -->
    <el-dialog
      v-model="showPromptPreview"
      title="完整提示词预览"
      width="70%"
      :before-close="() => showPromptPreview = false"
    >
      <div class="prompt-preview-dialog">
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
  </div>
</template>

<script setup lang="ts">
import { 
  Document, DataAnalysis, Download, FolderAdd,
  DocumentCopy, MagicStick, View, Edit
} from '@element-plus/icons-vue'
import BookFileImportPanel from '@/components/book-analysis/BookFileImportPanel.vue'
import { useBookAnalysisWorkspace } from '@/composables/useBookAnalysisWorkspace'
const { uploadedFile, bookContent, selectedEncoding, importingFile, isDocx, fileFormatLabel, handleFileChange, handleFileExceed, rereadWithEncoding, removeFile, selectedTemplate, selectedChapters, analysisStartWords, analysisEndWords, analysisProgress, analysisStatus, analysisResult, analysisEditorRef, detectedChapters, autoDetectedChapters, showChapterDetails, showChapterContent, selectedViewChapter, currentViewChapter, currentChapterContent, selectedDetailChapter, currentDetailChapter, currentDetailChapterContent, activeDetailTab, summaryPromptTemplate, showPromptEditor, showPromptPreview, fullPromptPreview, analysisTemplates, estimatedChapters, displayContent, getPlaceholder, selectAllChapters, clearChapterSelection, startLocalChapterDetection, summaryTask, analyzing, generatingSummary, stopAnalysis, startAnalysis, exportResults, saveToLibrary, openChapterViewer, closeChapterContent, loadChapterContent, copyChapterContent, exportChapterContent, selectDetailChapter, copyDetailChapterContent, exportDetailChapterContent, exportAllChapterSummary, exportAllChapterContent, openChapterDetailsViewer, getPreviewPrompt, generateChapterSummaryWithAI, regenerateChapterSummary, resetPromptTemplate, previewFullPrompt, copyFullPrompt } = useBookAnalysisWorkspace()
</script>

<style scoped>
.book-analysis {
  height: calc(100vh - 140px);
  display: flex;
  flex-direction: column;
}

.page-header {
  text-align: center;
  margin-bottom: 20px;
}

.page-header h2 {
  font-size: 24px;
  color: #2c3e50;
  margin-bottom: 8px;
}

.page-header p {
  color: #7f8c8d;
  margin: 0;
}

.analysis-container {
  display: flex;
  flex: 1;
  gap: 20px;
  height: 100%;
  overflow: hidden;
}

/* 左侧面板 */
.left-panel {
  width: 320px;
  background: var(--el-bg-color);
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  overflow-y: auto;
}

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

/* 编码选择样式 */
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

.setting-item {
  margin-bottom: 16px;
}

.setting-item label {
  display: block;
  font-size: 14px;
  color: var(--el-text-color-regular);
  margin-bottom: 8px;
}

.template-option {
  display: flex;
  align-items: center;
  gap: 8px;
}

.template-icon {
  font-size: 16px;
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stats-section {
  background: var(--el-fill-color-light);
  border-radius: 6px;
  padding: 16px;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-label {
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

.stat-value {
  font-size: 14px;
  color: #2c3e50;
  font-weight: 500;
}

/* 右侧面板 */
.right-panel {
  flex: 1;
  background: var(--el-bg-color);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.editor-header h3 {
  margin: 0;
  font-size: 18px;
  color: #2c3e50;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.progress-section {
  margin-bottom: 16px;
}

.progress-text {
  margin-top: 8px;
  font-size: 14px;
  color: var(--el-text-color-regular);
  text-align: center;
}

.analysis-editor {
  flex: 1;
}

.analysis-editor .el-textarea__inner {
  height: 100% !important;
  resize: none;
  font-family: 'Monaco', 'Consolas', 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.6;
}

.chapter-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.chapter-actions button{
    margin-left: 0 !important;
}

.range-input-group {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.range-separator {
  color: var(--el-text-color-regular);
  font-size: 14px;
}

.chapter-option {
  width: 100%;
}

.chapter-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.chapter-words {
  color: #8492a6;
  font-size: 12px;
}

.chapter-summary {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.4;
  white-space: normal;
  word-break: break-all;
}

.chapter-details-content {
  max-height: 500px;
  overflow-y: auto;
}

.chapter-detail-item {
  padding: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  margin-bottom: 12px;
}

.chapter-detail-item:last-child {
  margin-bottom: 0;
}

.chapter-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.chapter-detail-header h4 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: 16px;
}

.chapter-detail-words {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.chapter-detail-summary {
  margin-bottom: 12px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.chapter-detail-preview {
  color: var(--el-text-color-secondary);
  font-size: 14px;
  line-height: 1.6;
  background: var(--el-fill-color-light);
  padding: 8px 12px;
  border-radius: 4px;
}

.local-chapter-section {
  margin-top: 8px;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  color: var(--el-text-color-secondary);
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
}

.content-preview {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.preview-header h3 {
  margin: 0;
  color: #2c3e50;
}

.preview-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.preview-content {
  line-height: 1.8;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
}

.analysis-progress {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 40px;
}

.progress-content {
  text-align: center;
  max-width: 400px;
}

.progress-icon {
  font-size: 48px;
  color: var(--brand-500);
  margin-bottom: 16px;
  animation: spin 2s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.progress-steps {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.progress-step {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: 6px;
  transition: all 0.3s;
}

.progress-step.active {
  background: #e6f7ff;
  color: #1890ff;
}

.progress-step.completed {
  color: #52c41a;
}

.step-text {
  font-size: 14px;
}

.analysis-results {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.results-header {
  padding: 20px 20px 0;
  border-bottom: 1px solid var(--el-border-color-light);
}

.results-header h3 {
  margin: 0 0 8px 0;
  color: #2c3e50;
}

.results-meta {
  display: flex;
  gap: 20px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 16px;
}

.results-tabs {
  flex: 1;
  overflow: hidden;
}

.results-tabs :deep(.el-tabs__content) {
  height: calc(100% - 40px);
  overflow-y: auto;
  padding: 20px;
}

/* 基础分析样式 */
.analysis-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
}

.analysis-card {
  background: var(--el-fill-color-light);
  border-radius: 8px;
  padding: 16px;
  border: 1px solid #e9ecef;
}

.analysis-card h4 {
  margin: 0 0 16px 0;
  color: #2c3e50;
  font-size: 16px;
}

.info-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.label {
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.value {
  font-size: 14px;
  color: #2c3e50;
  font-weight: 500;
}

.characters-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.character-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px;
  background: var(--el-bg-color);
  border-radius: 4px;
  font-size: 14px;
}

.character-name {
  font-weight: 500;
  color: #2c3e50;
}

.character-role {
  color: var(--el-text-color-secondary);
}

.character-frequency {
  color: var(--brand-500);
  font-size: 12px;
}

.plot-structure {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.structure-item {
  display: flex;
  gap: 8px;
  padding: 8px;
  background: var(--el-bg-color);
  border-radius: 4px;
}

.structure-label {
  font-size: 14px;
  color: var(--el-text-color-regular);
  min-width: 80px;
}

.structure-value {
  font-size: 14px;
  color: #2c3e50;
  flex: 1;
}

/* 技法分析样式 */
.techniques-analysis {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.technique-section {
  background: var(--el-fill-color-light);
  border-radius: 8px;
  padding: 20px;
  border: 1px solid #e9ecef;
}

.technique-section h4 {
  margin: 0 0 12px 0;
  color: #2c3e50;
}

.technique-description {
  color: var(--el-text-color-regular);
  margin-bottom: 16px;
  line-height: 1.6;
}

.examples-section h5 {
  margin: 0 0 12px 0;
  color: #2c3e50;
  font-size: 14px;
}

.example-item {
  background: var(--el-bg-color);
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 12px;
  border: 1px solid var(--el-border-color-light);
}

.example-text {
  font-style: italic;
  color: var(--brand-500);
  margin-bottom: 8px;
}

.example-analysis {
  font-size: 14px;
  color: var(--el-text-color-regular);
}

/* 章节详情样式 */
.chapters-analysis {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.chapter-detail {
  background: var(--el-fill-color-light);
  border-radius: 8px;
  padding: 20px;
  border: 1px solid #e9ecef;
}

.chapter-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.chapter-header h4 {
  margin: 0;
  color: #2c3e50;
}

.chapter-words {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: #e9ecef;
  padding: 4px 8px;
  border-radius: 12px;
}

.chapter-content {
  display: grid;
  gap: 16px;
}

.chapter-summary h5,
.chapter-techniques h5 {
  margin: 0 0 8px 0;
  color: #2c3e50;
  font-size: 14px;
}

.chapter-summary p {
  margin: 0;
  color: var(--el-text-color-regular);
  line-height: 1.6;
}

.technique-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* 创作启发样式 */
.inspiration-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
}

.inspiration-card {
  background: var(--el-fill-color-light);
  border-radius: 8px;
  padding: 20px;
  border: 1px solid #e9ecef;
}

.inspiration-card h4 {
  margin: 0 0 16px 0;
  color: #2c3e50;
}

.highlight-list,
.suggestion-list {
  margin: 0;
  padding-left: 20px;
}

.highlight-list li,
.suggestion-list li {
  margin-bottom: 8px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
}

.related-techniques {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* 章节内容查看弹窗样式 */
.chapter-content-dialog {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.chapter-selector {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chapter-select-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.chapter-title {
  font-weight: 500;
  color: #2c3e50;
}

.chapter-words {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.chapter-info {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.chapter-content-viewer {
  background: var(--el-fill-color-light);
  border-radius: 8px;
  border: 1px solid var(--el-border-color-light);
  overflow: hidden;
}

.chapter-text {
  padding: 20px;
  line-height: 1.8;
  font-family: 'Microsoft YaHei', sans-serif;
  color: #2c3e50;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-state {
  padding: 60px 20px;
  text-align: center;
  color: var(--el-text-color-secondary);
}

.empty-state .el-icon {
  font-size: 48px;
  margin-bottom: 16px;
  color: #c0c4cc;
}

.empty-state p {
  margin: 0;
  font-size: 14px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

/* 响应式设计 */
@media (max-width: 1200px) {
  .analysis-container {
    flex-direction: column;
    height: auto;
  }
  
  .left-panel {
    width: 100%;
    order: 1;
  }
  
  .right-panel {
    order: 2;
    min-height: 600px;
  }
  
  .analysis-grid {
    grid-template-columns: 1fr;
  }
  
  .inspiration-grid {
    grid-template-columns: 1fr;
  }
  
  .chapter-content-dialog {
    gap: 16px;
  }
  
  .chapter-text {
    padding: 16px;
    line-height: 1.6;
  }
}

@media (max-width: 768px) {
  .analysis-container {
    gap: 16px;
  }
  
  .left-panel,
  .right-panel {
    border-radius: 6px;
    padding: 16px;
  }
  
  .chapter-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  
  .chapter-selector .el-select {
    width: 100% !important;
  }
  
  .dialog-footer {
    flex-direction: column;
    gap: 8px;
  }
  
  .dialog-footer .el-button {
    width: 100%;
  }
}

/* 章节详情管理弹窗样式 */
.chapter-details-main {
  display: flex;
  gap: 20px;
  height: 600px;
}

.chapter-list-panel {
  width: 350px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow: hidden;
}

.panel-header {
  background: var(--el-fill-color-light);
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.panel-header h4 {
  margin: 0;
  font-size: 14px;
  color: #2c3e50;
}

.chapter-list {
  height: calc(100% - 49px);
  overflow-y: auto;
}

.chapter-list-item {
  padding: 12px 16px;
  border-bottom: 1px solid var(--ink-100);
  cursor: pointer;
  transition: all 0.2s;
}

.chapter-list-item:hover {
  background: var(--el-fill-color-light);
}

.chapter-list-item.active {
  background: #e8f4fd;
  border-left: 3px solid var(--brand-500);
}

.chapter-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.chapter-item-title {
  font-weight: 500;
  color: #2c3e50;
  font-size: 14px;
}

.chapter-item-words {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.chapter-item-summary {
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.chapter-item-summary:empty::before {
  content: '暂无简读，点击查看后可调用AI生成';
  color: #c0c4cc;
  font-style: italic;
}

.chapter-detail-panel {
  flex: 1;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-light);
}

.detail-header h4 {
  margin: 0;
  color: #2c3e50;
  font-size: 16px;
}

.detail-actions {
  display: flex;
  gap: 8px;
}

.summary-content {
  padding: 20px;
}

.chapter-meta {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.summary-actions {
  margin-top: 20px;
}

.summary-display {
  margin-top: 16px;
}

.summary-text {
  color: #2c3e50;
  line-height: 1.6;
  font-size: 14px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  padding: 16px;
  border: 1px solid var(--el-border-color-light);
}

.summary-actions-bottom {
  margin-top: 12px;
  text-align: right;
}

/* 提示词编辑相关样式 */
.prompt-section {
  margin-bottom: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  overflow: hidden;
}

.prompt-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-light);
}

.prompt-label {
  font-size: 13px;
  font-weight: 500;
  color: #2c3e50;
}

.prompt-preview {
  padding: 12px;
  background: #fafbfc;
}

.prompt-text {
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
}

.prompt-editor {
  padding: 12px;
  background: var(--el-bg-color);
}

.prompt-textarea {
  margin-bottom: 8px;
}

.prompt-textarea .el-textarea__inner {
  font-size: 12px;
  font-family: 'Monaco', 'Consolas', 'Courier New', monospace;
}

.prompt-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
}

.prompt-tips {
  flex: 1;
}

.prompt-buttons {
  display: flex;
  gap: 8px;
}

/* 提示词预览弹窗样式 */
.prompt-preview-dialog {
  padding: 16px;
}

.preview-content {
  margin-bottom: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  overflow: hidden;
}

.prompt-full-text {
  margin: 0;
  padding: 16px;
  background: var(--el-fill-color-light);
  font-family: 'Monaco', 'Consolas', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
  color: #2c3e50;
  white-space: pre-wrap;
  word-break: break-word;
}

.preview-stats {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.full-content {
  padding: 20px;
}

.chapter-full-text {
  color: #2c3e50;
  line-height: 1.8;
  font-family: 'Microsoft YaHei', sans-serif;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  color: var(--el-text-color-secondary);
}

.empty-detail .el-icon {
  font-size: 48px;
  margin-bottom: 16px;
  color: #c0c4cc;
}

.empty-detail p {
  margin: 0;
  font-size: 14px;
}

/* 响应式适配 */
@media (max-width: 1200px) {
  .chapter-details-main {
    flex-direction: column;
    height: auto;
  }
  
  .chapter-list-panel {
    width: 100%;
    height: 250px;
  }
  
  .chapter-detail-panel {
    min-height: 400px;
  }
}

@media (max-width: 768px) {
  .chapter-details-main {
    gap: 16px;
  }
  
  .detail-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  
  .chapter-meta {
    flex-wrap: wrap;
  }
  
  .summary-content,
  .full-content {
    padding: 16px;
  }
}
</style>
