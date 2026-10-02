<template>
<div v-show="activeTab === 'story'" class="workspace">
        <div class="workspace-layout">
        
          <!-- 配置面板 -->
          <div class="config-sidebar">
            <div class="config-header">
              <h3>📖 小说配置</h3>
              <div class="header-actions">
                <el-button 
                  size="small" 
                  type="primary" 
                  @click="openConfigManager"
                  title="管理数据源设置"
                >
                  <el-icon><Setting /></el-icon>数据源设置
                </el-button>
                <el-button size="small" text @click="resetConfig">
                  重置
                </el-button>
              </div>
            </div>
            

            
            <el-button 
              type="primary" 
              @click="generateStory" 
              :loading="generating"
              :disabled="!isConfigValid"
              class="generate-btn"
            >
              <el-icon><MagicStick /></el-icon>
              {{ generating ? '生成中...' : '生成小说' }}
            </el-button>


            <!-- 验证提示 -->
            <div v-if="!isConfigValid" class="validation-tip">
              <el-icon><InfoFilled /></el-icon>
              <span>还需填写：
                <span v-if="!storyData.title">标题</span>
                <span v-if="!storyData.title && !storyData.protagonist.name">、</span>
                <span v-if="!storyData.protagonist.name">主角</span>
                <span v-if="(!storyData.title || !storyData.protagonist.name) && !unifiedPrompt.trim()">、</span>
                <span v-if="!unifiedPrompt.trim()">提示词</span>
              </span>
            </div>

            <div class="config-form">
              <!-- 基础配置区域 -->
              <div class="config-section">
                <div class="section-title">基础配置</div>
                <div class="form-grid">
                  <div class="form-item">
                    <label>小说标题</label>
                    <el-input v-model="storyData.title" placeholder="请输入小说标题" size="small" />
                  </div>
                  <div class="form-item">
                    <label>主角姓名</label>
                    <el-input v-model="storyData.protagonist.name" placeholder="请输入主角姓名" size="small" />
                  </div>
                  <div class="form-item">
                    <label>题材类型</label>
                    <el-select v-model="storyData.genre" placeholder="选择题材" size="small">
                      <el-option v-for="genre in customGenres" :key="genre.value" :label="genre.label" :value="genre.value" />
                    </el-select>
                  </div>
                  <div class="form-item">
                    <label>情节设定</label>
                    <el-select v-model="storyData.plotType" placeholder="选择情节" size="small">
                      <el-option v-for="plot in customPlotTypes" :key="plot.value" :label="plot.label" :value="plot.value" />
                    </el-select>
                  </div>
                  <div class="form-item">
                    <label>故事氛围</label>
                    <el-select v-model="storyData.emotion" placeholder="选择氛围" size="small">
                      <el-option v-for="emotion in customEmotions" :key="emotion.value" :label="emotion.label" :value="emotion.value" />
                    </el-select>
                  </div>
                  <div class="form-item">
                    <label>时代背景</label>
                    <el-select v-model="storyData.timeFrame" placeholder="选择时代" size="small">
                      <el-option v-for="time in customTimeFrames" :key="time.value" :label="time.label" :value="time.value" />
                    </el-select>
                  </div>
                  <div class="form-item">
                    <label>目标字数</label>
                    <el-input-number v-model="storyData.wordCount" :min="500" :max="10000" :step="100" size="small" style="width: 100%" />
                  </div>
                </div>
              </div>

              <!-- 创作提示词区域 -->
              <div class="config-section">
                <div class="section-header">
                  <div class="section-title">创作提示词</div>
                  <div class="section-actions">
                    <el-button size="small" text @click="showStoryPromptSelector = true">
                      <el-icon><List /></el-icon>模板
                    </el-button>
                    <el-button size="small" text type="primary" @click="showAdvancedConfig = showAdvancedConfig.includes('advanced') ? [] : ['advanced']">
                      {{ showAdvancedConfig.includes('advanced') ? '收起' : '展开' }}高级
                    </el-button>
                  </div>
                </div>
                
                <div v-if="selectedPromptTemplate" class="selected-template">
                  <el-tag type="info" size="small">{{ selectedPromptTemplate.title }}</el-tag>
                  <el-button size="small" text @click="clearSelectedTemplate">清除</el-button>
                </div>
                
                <el-input
                  v-model="unifiedPrompt"
                  type="textarea"
                  :rows="3"
                  :placeholder="promptPlaceholder"
                  size="small"
                />
              </div>

              <!-- 高级配置 -->
              <el-collapse v-model="showAdvancedConfig" class="advanced-config">
                <el-collapse-item title="高级配置" name="advanced">
                  <div class="form-grid">
                    <div class="form-item">
                      <label>主角性别</label>
                      <el-radio-group v-model="storyData.protagonist.gender" size="small">
                        <el-radio-button label="male">男</el-radio-button>
                        <el-radio-button label="female">女</el-radio-button>
                      </el-radio-group>
                    </div>
                    <div class="form-item">
                      <label>主角年龄</label>
                      <div class="age-input">
                        <el-button size="small" @click="storyData.protagonist.age = Math.max(10, storyData.protagonist.age - 1)">-</el-button>
                        <span class="age-display">{{ storyData.protagonist.age }}</span>
                        <el-button size="small" @click="storyData.protagonist.age = Math.min(100, storyData.protagonist.age + 1)">+</el-button>
                      </div>
                    </div>
                  </div>
                  
                  <div class="form-item">
                    <label>故事地点</label>
                    <el-input v-model="storyData.location" placeholder="故事发生地点" size="small" />
                  </div>
                  
                  <div class="form-item full-width">
                    <label>参考文本</label>
                    <el-input
                      v-model="storyData.referenceText"
                      type="textarea"
                      :rows="2"
                      placeholder="可以贴一些参考文本或风格例子（可选）"
                      size="small"
                    />
                  </div>
                </el-collapse-item>
              </el-collapse>
            </div>

            
          </div>

          <!-- 编辑器 -->
          <div class="editor-main">
            <div class="editor-header">
              <div class="editor-title">
                <span>{{ storyData.title || '小说编辑器' }}</span>
                <span class="word-count">{{ getTextWordCount(generatedStory) }} 字</span>
              </div>
              <div class="editor-actions">
                <el-button size="small" @click="continueStory" :disabled="!generatedStory || continuingStory">
                  <el-icon><EditPen /></el-icon>续写
                </el-button>
                <el-button size="small" @pointerdown.prevent @click="optimizeCurrentSelection" :disabled="!generatedStory">
                  <el-icon><MagicStick /></el-icon>优化
                </el-button>

                <el-button size="small" @click="exportStory" :disabled="!generatedStory">
                  <el-icon><Download /></el-icon>导出
                </el-button>
              </div>
            </div>
            
            <div class="editor-content">
              <!-- 生成状态提示 -->
              <div v-if="generating" class="generating-status">
                <div class="status-bar">
                  <div class="status-info">
                    <el-icon class="rotating"><Loading /></el-icon>
                    <span>AI正在生成小说... ({{ getTextWordCount(generatedStory) }}字)</span>
                  </div>
                  <el-button size="small" type="danger" text @click="stopGeneration">停止生成</el-button>
                </div>
              </div>
              
              <div class="editor-wrapper">
                <Toolbar
                  :editor="editorRef || undefined"
                  :defaultConfig="toolbarConfig"
                  mode="default"
                />
                <Editor
                  v-model="generatedStory"
                  :defaultConfig="editorConfig"
                  mode="default"
                  @onCreated="handleEditorCreated"
                  @onChange="onEditorChange"
                  @mouseup="handleTextSelection"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
</template>

<script setup lang="ts">
import { useShortStoryWorkspaceContext } from '@/composables/short-storyContext'
import { MagicStick, EditPen, Download, Loading, Setting, List, InfoFilled } from '@element-plus/icons-vue'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'
import { DomEditor } from '@wangeditor/editor'
const { activeTab, generatedStory, showAdvancedConfig, unifiedPrompt, selectedPromptTemplate, generating, continuingStory, showStoryPromptSelector, promptPlaceholder, editorRef, toolbarConfig, editorConfig, storyData, isConfigValid, customGenres, customPlotTypes, customEmotions, customTimeFrames, generateStory, continueStory, resetConfig, handleEditorCreated, onEditorChange, handleTextSelection, optimizeSelection, exportStory, getTextWordCount, openConfigManager, clearSelectedTemplate, stopGeneration } = useShortStoryWorkspaceContext()
// Keep pointer activation from moving focus before reading the live DOM range.
// Keyboard activation follows the same click path and preserves range direction.
const optimizeCurrentSelection = () => {
  const editor = editorRef.value
  try {
    const selection = window.getSelection()
    if (!editor || editor.isDestroyed || !selection || selection.rangeCount !== 1 || selection.isCollapsed
      || !selection.anchorNode || !selection.focusNode
      || !DomEditor.hasDOMNode(editor, selection.anchorNode, { editable: true })
      || !DomEditor.hasDOMNode(editor, selection.focusNode, { editable: true })) {
      void optimizeSelection(null)
      return
    }
    const range = DomEditor.toSlateRange(editor, selection, { exactMatch: true, suppressThrow: true })
    void optimizeSelection(range)
  } catch {
    // Detached editor DOM must reject the selection rather than revive a cached range.
    void optimizeSelection(null)
  }
}
</script>
