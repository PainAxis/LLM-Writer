<template>
<el-dialog 
      v-model="showContinueDialog" 
      title="" 
      width="1000px" 
      class="modern-continue-dialog short-story-dialog"
      :show-close="false"
      destroy-on-close
    >
      <template #header>
        <div class="dialog-header">
          <div class="header-left">
            <div class="header-icon">
              <el-icon size="24"><EditPen /></el-icon>
            </div>
            <div class="header-text">
              <h3>AI智能续写</h3>
              <p>基于现有内容智能续写，保持风格连贯</p>
            </div>
          </div>
          <el-button 
            type="text" 
            size="large" 
            @click="showContinueDialog = false"
            class="close-btn"
          >
            <el-icon size="20"><Close /></el-icon>
          </el-button>
        </div>
      </template>
      
      <div class="modern-continue-container">
        <!-- 配置卡片 -->
        <el-card shadow="never" class="config-card">
          <template #header>
            <div class="card-header">
              <el-icon><Setting /></el-icon>
              <span>续写配置</span>
            </div>
          </template>
          
          <div class="config-content">
            <div class="config-row">
              <div class="config-item">
                <label class="config-label">
                  <el-icon><Document /></el-icon>
                  续写方向
                </label>
                <el-input 
                  v-model="continueDirection"
                  type="textarea"
                  :rows="4"
                  placeholder="描述续写的具体方向和要求，例如：\n• 推进主角与反派的最终对决\n• 展现角色内心的复杂情感\n• 描写紧张刺激的追逐场面\n• 揭示隐藏已久的重要秘密\n\n留空将根据前文内容自动续写"
                  class="direction-input"
                />
              </div>
              
              <div class="config-item">
                <label class="config-label">
                  <el-icon><Tickets /></el-icon>
                  续写字数
                </label>
                <el-slider
                  v-model="continueWordCount"
                  :min="200"
                  :max="5000"
                  :step="100"
                  show-input
                  :format-tooltip="(val) => `${val}字`"
                  class="word-count-slider"
                />
              </div>
            </div>
            
            <div class="tips-section">
              <div class="tips-header">
                <el-icon><InfoFilled /></el-icon>
                <span>使用提示</span>
              </div>
              <div class="tips-grid">
                <div class="tip-item">
                  <el-icon color="var(--el-color-success)"><Check /></el-icon>
                  <span>基于当前内容智能续写</span>
                </div>
                <div class="tip-item">
                  <el-icon color="var(--el-color-success)"><Check /></el-icon>
                  <span>保持原有风格和语调</span>
                </div>
                <div class="tip-item">
                  <el-icon color="var(--el-color-success)"><Check /></el-icon>
                  <span>支持自定义续写方向</span>
                </div>
                <div class="tip-item">
                  <el-icon color="var(--el-color-success)"><Check /></el-icon>
                  <span>确保情节自然连贯</span>
                </div>
              </div>
            </div>
          </div>
        </el-card>
        
        <!-- 结果卡片 -->
        <el-card shadow="never" class="result-card">
          <template #header>
            <div class="card-header">
              <el-icon><Magic /></el-icon>
              <span>续写结果</span>
              <div class="header-actions" v-if="continueResult && !continuingStory">
                <el-button size="small" @click="copyContinueText">
                  <el-icon><CopyDocument /></el-icon>
                  复制
                </el-button>
              </div>
            </div>
          </template>
          
          <div class="result-content">
            <!-- 续写中状态 -->
            <div v-if="continuingStory" class="streaming-state">
              <div class="streaming-header">
                <div class="streaming-icon">
                  <el-icon class="rotating"><Loading /></el-icon>
                </div>
                <div class="streaming-text">
                  <h4>AI正在创作中...</h4>
                  <p>请稍候，正在为您生成精彩的续写内容</p>
                </div>
              </div>
              <div class="streaming-content" v-if="continueResult">
                <div class="streaming-text-content">{{ continueResult }}</div>
              </div>
            </div>
            
            <!-- 续写完成状态 -->
            <div v-else-if="continueResult" class="result-display">
              <div class="result-stats">
                <div class="stat-item">
                  <span class="stat-label">续写字数</span>
                  <span class="stat-value">{{ getPlainTextWordCount(continueResult) }}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">预计阅读</span>
                  <span class="stat-value">{{ Math.ceil(getPlainTextWordCount(continueResult) / 300) }}分钟</span>
                </div>
              </div>
              <div ref="continueTextRef" class="result-text">{{ continueResult }}</div>
            </div>
            
            <!-- 空状态 -->
            <div v-else class="empty-state">
              <div class="empty-icon">
                <el-icon size="48" color="#c0c4cc"><Document /></el-icon>
              </div>
              <h4>准备开始续写</h4>
              <p>点击下方按钮，AI将基于您的现有内容进行智能续写</p>
            </div>
          </div>
        </el-card>
      </div>
      
      <template #footer>
        <div class="dialog-footer">
          <div class="footer-info">
            <el-icon><InfoFilled /></el-icon>
            <span>续写将基于当前{{ getTextWordCount(generatedStory) }}字的内容</span>
          </div>
          <div class="footer-actions">
            <el-button size="large" @click="showContinueDialog = false">取消</el-button>
            <el-button 
              type="primary" 
              size="large" 
              @click="performContinue" 
              :loading="continuingStory"
              :disabled="getTextWordCount(generatedStory) < 50"
            >
              <el-icon v-if="!continuingStory"><Magic /></el-icon>
              {{ continuingStory ? '续写中...' : (continueResult ? '重新续写' : '开始续写') }}
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { useShortStoryWorkspaceContext } from '@/composables/short-storyContext'
import { EditPen, Check, Loading, Setting, InfoFilled } from '@element-plus/icons-vue'
const { generatedStory, showContinueDialog, continueDirection, continueWordCount, continueTextRef, continuingStory, continueResult, performContinue, copyContinueText, getTextWordCount, getPlainTextWordCount } = useShortStoryWorkspaceContext()
</script>
