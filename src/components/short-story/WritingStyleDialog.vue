<template>
<el-dialog v-model="showWritingStyleManager" title="文风配置管理" width="800px" class="writing-style-dialog short-story-dialog">
        <div class="writing-style-container">
          <div class="style-header">
            <h4>文风配置</h4>
            <el-button type="primary" size="small" @click="addWritingStyle">
              <el-icon><Plus /></el-icon>添加文风
            </el-button>
          </div>
          
          <div class="style-list">
            <div v-for="(style, index) in configData.writingStyles" :key="index" class="style-item-row">
              <el-input v-model="style.label" placeholder="显示名称" class="style-input" />
              <el-input v-model="style.value" placeholder="值（英文）" class="style-input" />
              <el-input v-model="style.prompt" placeholder="文风提示词" class="style-input style-prompt-input" />
              <el-button type="danger" size="small" text @click="removeWritingStyle(index)">
                删除
              </el-button>
            </div>
          </div>
        </div>
        
        <template #footer>
          <div class="dialog-footer">
            <el-button @click="showWritingStyleManager = false">取消</el-button>
            <el-button type="primary" @click="saveWritingStyleConfig">保存配置</el-button>
          </div>
        </template>
      </el-dialog>
</template>

<script setup lang="ts">
import { useShortStoryWorkspaceContext } from '@/composables/short-storyContext'
import { Plus } from '@element-plus/icons-vue'
const { showWritingStyleManager, configData, addWritingStyle, removeWritingStyle, saveWritingStyleConfig } = useShortStoryWorkspaceContext()
</script>
