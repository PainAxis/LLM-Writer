<template>
  <div class="tools-library">
    
    <ToolCatalog @select="openTool" />

    <!-- 工具对话框 -->
    <el-dialog 
      v-model="showToolDialog" 
      :title="currentTool.title"
      width="900px"
      class="tool-dialog"
      :close-on-click-modal="false"
    >
      <div class="tool-content">
        <div class="tool-form">
          <el-form :model="toolForm" label-width="100px" @submit.prevent="generateContent">
            <el-form-item v-for="field in currentTool.fields" :key="field.key" :label="field.label">
              <!-- 小说选择器 -->
              <el-select 
                v-if="field.type === 'novel-select'"
                v-model="toolForm[field.key]" 
                :placeholder="field.placeholder"
                @change="onNovelChange"
                clearable
              >
                <el-option 
                  v-for="novel in novelList" 
                  :key="novel.value" 
                  :label="novel.label" 
                  :value="novel.value"
                />
              </el-select>
              
              <!-- 章节多选器 -->
              <el-select 
                v-else-if="field.type === 'chapter-select'"
                v-model="toolForm[field.key]" 
                :placeholder="field.placeholder"
                multiple
                collapse-tags
                collapse-tags-tooltip
                :disabled="toolForm.selectedNovel === undefined || toolForm.selectedNovel === ''"
                clearable
              >
                <el-option 
                  v-for="chapter in selectedNovelChapters" 
                  :key="chapter.value" 
                  :label="chapter.label" 
                  :value="chapter.value"
                />
              </el-select>
              
              <!-- 普通输入框 -->
              <el-input 
                v-else-if="field.type === 'input'"
                :model-value="getScalarField(field.key)" @update:model-value="toolForm[field.key] = $event"
                :placeholder="field.placeholder"
                :type="field.key === 'count' && currentToolType === 'character' ? 'number' : 'text'"
                :min="field.key === 'count' && currentToolType === 'character' ? 1 : undefined"
                :max="field.key === 'count' && currentToolType === 'character' ? 15 : undefined"
                @keyup.enter="generateContent"
                @input="validateCharacterCount(field, $event)"
              />
              
              <!-- 文本域 -->
              <el-input 
                v-else-if="field.type === 'textarea'"
                :model-value="getScalarField(field.key)" @update:model-value="toolForm[field.key] = $event"
                type="textarea" 
                :rows="4"
                :placeholder="field.placeholder"
              />
              
              <!-- 提示词选择器 -->
              <el-select 
                v-else-if="field.type === 'prompt-select'"
                v-model="toolForm[field.key]" 
                :placeholder="field.placeholder"
                clearable
                filterable
                @change="onPromptChange"
              >
                <el-option 
                  v-for="prompt in getPromptsByCategory(field.category)" 
                  :key="prompt.id" 
                  :label="prompt.title" 
                  :value="prompt.id"
                >
                  <div class="prompt-option">
                    <div class="prompt-option-title">{{ prompt.title }}</div>
                    <div class="prompt-option-desc">{{ prompt.description }}</div>
                  </div>
                </el-option>
              </el-select>
              
              <!-- 下拉选择 -->
              <el-select 
                v-else-if="field.type === 'select'"
                v-model="toolForm[field.key]" 
                :placeholder="field.placeholder"
              >
                <el-option 
                  v-for="option in field.options" 
                  :key="option.value" 
                  :label="option.label" 
                  :value="option.value"
                />
              </el-select>
              <div v-if="field.type === 'prompt-select'" class="form-tip">模板用于补充创作要求，生成数量和风格以当前表单为准。</div>
              <div
                v-if="field.key === 'count' && currentToolType === 'character' && toolForm[field.key]"
                class="character-count-hint"
              >
                <span v-if="isValidCharacterCount(toolForm[field.key])" class="valid-hint">✓ 将生成 {{ toolForm[field.key] }} 个角色</span>
                <span v-else class="invalid-hint">⚠️ 请输入1-15之间的数字</span>
              </div>
            </el-form-item>
          </el-form>
        </div>
        
        <div class="tool-actions">
          <el-button type="primary" @click="generateContent" :loading="generating" :disabled="!canGenerate">
            <el-icon><MagicStick /></el-icon>
            {{ generating ? '生成中...' : '生成内容' }}
          </el-button>
          <el-button v-if="generating" @click="stopGeneration">停止生成</el-button>
          <el-button @click="clearForm">
            清空
          </el-button>
        </div>
        
        <!-- 生成进度提示 -->
        <div v-if="generating" class="generating-status">
          <el-progress :percentage="generatingProgress" :show-text="false" />
          <span class="status-text">{{ generatingStatusText }}</span>
        </div>
        
        <!-- 结果显示区 -->
        <div class="tool-result" v-if="generatedContent || generating">
          <h4>生成结果：</h4>
          <div class="result-content-wrapper">
            <el-input
               :model-value="displayContent"
              type="textarea"
              :rows="15"
              readonly
              class="result-textarea"
              placeholder="生成的内容将在这里显示..."
              ref="resultTextarea"
            />
          </div>
          <div class="result-actions" v-if="generatedContent && !generating">
            <el-button @click="copyToClipboard" :disabled="!generatedContent">
              <el-icon><CopyDocument /></el-icon>
              复制
            </el-button>
            <el-button @click="saveResult" :disabled="!generatedContent">
              <el-icon><DocumentAdd /></el-icon>
              保存到本地
            </el-button>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { MagicStick, CopyDocument, DocumentAdd } from '@element-plus/icons-vue'
import ToolCatalog from '@/components/tools/ToolCatalog.vue'
import { useToolsLibraryWorkspace } from '@/composables/useToolsLibraryWorkspace'
const { getScalarField, showToolDialog, generatedContent, generatingProgress, generatingStatusText, toolForm, resultTextarea, novelList, selectedNovelChapters, onNovelChange, currentTool, currentToolType, canGenerate, displayContent, openTool, clearForm, generating, stopGeneration, generateContent, copyToClipboard, saveResult, getPromptsByCategory, onPromptChange, isValidCharacterCount, validateCharacterCount } = useToolsLibraryWorkspace()
</script>

<style scoped>
.tools-library {
  max-width: 1200px;
  margin: 0 auto;
}

.tool-dialog .tool-content {
  padding: 20px 0;
}

.tool-form {
  margin-bottom: 24px;
}

.tool-actions {
  text-align: center;
  margin-bottom: 24px;
}

.tool-actions .el-button {
  margin: 0 8px;
}

.generating-status {
  margin: 16px 0;
  text-align: center;
}

.status-text {
  display: block;
  margin-top: 8px;
  color: var(--el-text-color-regular);
  font-size: 14px;
}

.tool-result {
  background: var(--el-fill-color-light);
  border-radius: 8px;
  padding: 20px;
  border: 1px solid #e9ecef;
}

.tool-result h4 {
  margin-top: 0;
  margin-bottom: 16px;
  color: #2c3e50;
}

.result-content-wrapper {
  margin-bottom: 16px;
}

.result-textarea {
  width: 100%;
}

.result-textarea :deep(.el-textarea__inner) {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
}

.result-actions {
  text-align: center;
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}

.result-actions .el-button {
  margin: 4px;
}

/* 小说和章节选择器样式 */
.tool-form .el-select {
  width: 100%;
}

.tool-form .el-select .el-tag {
  max-width: 120px;
}

.tool-form .el-form-item {
  margin-bottom: 18px;
}

/* 提示词选择器样式 */
.prompt-option {
  padding: 8px 0;
}

.prompt-option-title {
  font-weight: 500;
  color: var(--el-text-color-primary);
  margin-bottom: 4px;
}

.prompt-option-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}

/* 角色数量提示样式 */
.character-count-hint {
  margin-top: 5px;
  font-size: 12px;
}

.valid-hint {
  color: var(--el-color-success);
}

.invalid-hint {
  color: var(--el-color-danger);
}

@media (max-width: 768px) {
  
  .tool-dialog {
    width: 95% !important;
  }
  
  .result-actions {
    flex-direction: column;
    align-items: center;
  }
  
  .result-actions .el-button {
    width: 100%;
    max-width: 200px;
  }
}
</style>
