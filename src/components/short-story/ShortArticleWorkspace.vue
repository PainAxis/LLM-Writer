<template>
<div v-show="activeTab === 'article'" class="workspace">
        <div class="workspace-layout">
          <!-- 左侧配置面板 -->
          <div class="config-sidebar">
            <div class="config-header">
              <h3>📝 短文配置</h3>
              <el-button size="small" text @click="resetArticleConfig">
                重置
              </el-button>
            </div>
            
            <!-- 生成按钮 -->
            <el-button 
              type="primary" 
              size="default"
              @click="generateArticle" 
              :loading="generatingArticle"
              :disabled="!isArticleConfigValid"
              class="generate-btn"
            >
              <el-icon><MagicStick /></el-icon>
              {{ generatingArticle ? '生成中...' : '生成短文' }}
            </el-button>
            
            <!-- 配置表单 -->
            <div class="config-form">

<!-- 必填项提示 -->
            <div v-if="!isArticleConfigValid" class="validation-tip">
              <el-icon><InfoFilled /></el-icon>
              <span>还需填写：
                <span v-if="!articleData.title">标题</span>
                <span v-if="!articleData.title && !articleData.prompt.trim()">、</span>
                <span v-if="!articleData.prompt.trim()">提示词</span>
              </span>
            </div>


              <!-- 标题 -->
              <div class="form-item">
                <label>文章标题</label>
                <el-input 
                  v-model="articleData.title" 
                  placeholder="请输入文章标题"
                />
              </div>

              <!-- 字数和文风 -->
              <div class="form-row">
                <div class="form-item">
                  <label>字数</label>
                  <el-input-number 
                    v-model="articleData.wordCount" 
                    :min="200" 
                    :max="5000" 
                    :step="100"
                    style="width: 100%"
                  />
                </div>
                <div class="form-item">
                  <div class="item-header">
                    <label>文风</label>
                    <el-button size="small" text @click="showWritingStyleManager = true">
                      <el-icon><Setting /></el-icon>设置文风
                    </el-button>
                  </div>
                  <el-select v-model="articleData.style" placeholder="选择文风" style="width: 100%">
                    <el-option v-for="style in customWritingStyles" :key="style.value" :label="style.label" :value="style.value" />
                  </el-select>
                </div>
              </div>

              <!-- 提示词 -->
              <div class="form-item">
                <div class="item-header">
                  <label>创作提示词</label>
                  <el-button size="small" text @click="showArticlePromptSelector = true">
                    <el-icon><List /></el-icon>选择模板
                  </el-button>
                </div>
                
                <div v-if="selectedArticlePromptTemplate" class="selected-template">
                  <el-tag type="info" size="small">{{ selectedArticlePromptTemplate.title }}</el-tag>
                  <el-button size="small" text @click="clearArticleSelectedTemplate">清除</el-button>
                </div>
                
                <el-input
                  v-model="articleData.prompt"
                  type="textarea"
                  :rows="4"
                  placeholder="描述您想要创作的短文内容、主题、风格等要求..."
                />
              </div>

              <!-- 参考文章 -->
              <div class="form-item">
                <div class="item-header">
                  <label>参考文章（可选）</label>
                  <el-button size="small" text type="primary" @click="addReferenceArticle">
                    <el-icon><Plus /></el-icon>添加
                  </el-button>
                </div>
                
                <div v-if="articleData.references.length > 0" class="reference-list">
                  <div v-for="(ref, index) in articleData.references" :key="index" class="reference-item">
                    <div class="ref-header">
                      <span>参考 {{ index + 1 }}</span>
                      <el-button size="small" text @click="removeReferenceArticle(index)">删除</el-button>
                    </div>
                    <el-input v-model="ref.title" placeholder="标题" size="small" style="margin-bottom: 6px" />
                    <el-input v-model="ref.content" type="textarea" :rows="2" placeholder="内容要点..." />
                  </div>
                </div>
              </div>
            </div>

          </div>

          <!-- 右侧编辑器 -->
          <div class="editor-main">
            <div class="editor-header">
              <div class="editor-title">
                <span>{{ articleData.title || '短文编辑器' }}</span>
                <span class="word-count">{{ articleWordCount }} 字</span>
              </div>
              <div class="editor-actions">
                <el-button size="small" @click="copyArticleContent">
                  <el-icon><DocumentCopy /></el-icon>复制
                </el-button>
                <el-button size="small" @click="saveArticle">
                  <el-icon><Download /></el-icon>保存
                </el-button>
                <el-button size="small" @click="clearArticleContent">
                  <el-icon><Delete /></el-icon>清空
                </el-button>
              </div>
            </div>
            
            <div class="editor-content">
              <div v-if="generatingArticle" class="generating-overlay">
                <div class="generating-header">
                  <span>AI正在生成短文...</span>
                  <el-button size="small" type="danger" text @click="stopArticleGeneration">停止生成</el-button>
                </div>
                <div class="streaming-content">{{ articleStreamingContent }}</div>
              </div>
              
              <div v-show="!generatingArticle" class="editor-wrapper">
                <Toolbar
                  :editor="articleEditorRef || undefined"
                  :defaultConfig="articleToolbarConfig"
                  mode="default"
                />
                <Editor
                  v-model="articleContent"
                  :defaultConfig="articleEditorConfig"
                  mode="default"
                  @onCreated="handleArticleEditorCreated"
                  @onChange="onArticleEditorChange"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
</template>

<script setup lang="ts">
import { useShortStoryWorkspaceContext } from '@/composables/short-storyContext'
import { MagicStick, Download, Plus, Setting, List, DocumentCopy, Delete, InfoFilled } from '@element-plus/icons-vue'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'
const { activeTab, articleData, articleContent, selectedArticlePromptTemplate, showArticlePromptSelector, showWritingStyleManager, generatingArticle, articleStreamingContent, isArticleConfigValid, articleWordCount, articleEditorRef, articleToolbarConfig, articleEditorConfig, customWritingStyles, resetArticleConfig, addReferenceArticle, removeReferenceArticle, clearArticleSelectedTemplate, generateArticle, stopArticleGeneration, copyArticleContent, saveArticle, clearArticleContent, handleArticleEditorCreated, onArticleEditorChange } = useShortStoryWorkspaceContext()
</script>
