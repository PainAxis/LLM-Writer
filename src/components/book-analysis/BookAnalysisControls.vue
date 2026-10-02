<template>
<div class="left-panel">
        <div class="panel-section">
          <el-button @click="openAnalysisLibrary">拆书参考库</el-button>
          <el-tag v-if="libraryRecords.length" size="small">{{ libraryRecords.length }} 份报告</el-tag>
        </div>
        <!-- 文件上传区域 -->
        <BookFileImportPanel
          v-model:encoding="selectedEncoding"
          :uploaded-file="uploadedFile"
          :importing-file="importingFile"
          :busy="analyzing || generatingSummary || savingLibraryReport"
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
              :disabled="!selectedTemplate || importingFile || savingLibraryReport"
              block
            >
              <el-icon><DataAnalysis /></el-icon>
              {{ analyzing ? '分析中...' : '开始拆书分析' }}
            </el-button>
            
            <el-button v-if="analyzing" @click="stopAnalysis">停止分析</el-button>
            <el-button 
              v-if="analysisResult !== null"
              @click="exportResults" 
              block
            >
              <el-icon><Download /></el-icon>
              导出分析结果
            </el-button>
            
            <el-button 
              v-if="analysisResult !== null"
              @click="saveToLibrary" 
              :disabled="libraryReportBusy || !analysisResult.trim()"
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
</template>

<script setup lang="ts">
import { useBookAnalysisWorkspaceContext } from '@/composables/book-analysisContext'
import { DataAnalysis, Download, FolderAdd, MagicStick, View } from '@element-plus/icons-vue'
import BookFileImportPanel from './BookFileImportPanel.vue'
const { openAnalysisLibrary, libraryRecords, savingLibraryReport, libraryReportBusy, uploadedFile, bookContent, selectedEncoding, importingFile, isDocx, fileFormatLabel, handleFileChange, handleFileExceed, rereadWithEncoding, removeFile, selectedTemplate, selectedChapters, analysisStartWords, analysisEndWords, analysisResult, detectedChapters, autoDetectedChapters, analysisTemplates, estimatedChapters, selectAllChapters, clearChapterSelection, startLocalChapterDetection, analyzing, generatingSummary, stopAnalysis, startAnalysis, exportResults, saveToLibrary, openChapterViewer, openChapterDetailsViewer } = useBookAnalysisWorkspaceContext()
</script>
