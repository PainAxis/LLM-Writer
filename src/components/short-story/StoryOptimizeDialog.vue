<template>
<el-dialog v-model="showOptimizeModal" title="✨ 选段优化" width="900px" class="optimize-dialog short-story-dialog">
      <div class="optimize-container">
        <el-row :gutter="20" style="height: 100%;">
          <!-- 左侧：配置区域 -->
          <el-col :span="12" style="height: 100%;">
            <div class="optimize-config">
              <div class="config-section">
                <h4>选中的文本</h4>
                <div class="selected-text-preview">{{ selectedTextForOptimize || '请先在编辑器中选择要优化的文本' }}</div>
              </div>
              
              <div class="config-section">
                <h4>优化方向</h4>
                <el-input 
                  v-model="optimizeDirection"
                  type="textarea"
                  :rows="6"
                  placeholder="请描述优化方向，例如：&#10;- 使语言更加生动形象&#10;- 增强情感表达&#10;- 优化描写细节&#10;- 提升文学性&#10;- 改善节奏感"
                />
              </div>
              
              <div class="config-actions">
                <el-button @click="showOptimizeModal = false">取消</el-button>
                <el-button type="primary" @click="performOptimize" :loading="optimizing">
                  {{ optimizing ? '优化中...' : '开始优化' }}
                </el-button>
              </div>
            </div>
          </el-col>
          
          <!-- 右侧：结果区域 -->
          <el-col :span="12" style="height: 100%;">
            <div class="optimize-result">
              <div class="result-header">
                <h4>优化结果</h4>
              </div>
              
              <div class="result-content">
                <!-- 优化状态提示 -->
                <div v-if="optimizing" class="optimizing-status">
                  <div class="status-bar">
                    <div class="status-info">
                      <el-icon class="rotating"><Loading /></el-icon>
                      <span>AI正在优化中... ({{ optimizedResult.length }}字)</span>
                    </div>
                  </div>
                </div>
                
                <!-- 优化结果显示区域 -->
                <div v-if="optimizedResult || optimizing" class="optimized-content-container">
                  <div ref="optimizedTextRef" class="optimized-content">{{ optimizedResult }}</div>
                  <div v-if="!optimizing" class="result-actions">
                    <el-button size="small" @click="copyOptimizedText">复制</el-button>
                    <el-button size="small" type="primary" @click="replaceOriginalText">替换原文</el-button>
                  </div>
                </div>
                
                <div v-else class="empty-result">
                  <el-empty description="点击开始优化" :image-size="80" />
                </div>
              </div>
            </div>
          </el-col>
        </el-row>
      </div>
    </el-dialog>
</template>

<script setup lang="ts">
import { useShortStoryWorkspaceContext } from '@/composables/short-storyContext'
import { Loading } from '@element-plus/icons-vue'
const { showOptimizeModal, selectedTextForOptimize, optimizeDirection, optimizedTextRef, optimizing, optimizedResult, performOptimize, copyOptimizedText, replaceOriginalText } = useShortStoryWorkspaceContext()
</script>
