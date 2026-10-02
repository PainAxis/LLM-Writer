<template>
<el-dialog v-model="showConfigManager" title="创作配置管理" width="1000px" class="config-manager-dialog short-story-dialog">
      <div class="config-manager-container">
        <el-tabs v-model="activeConfigTab" class="config-tabs">
          <!-- 题材管理 -->
          <el-tab-pane label="题材" name="genres">
            <div class="config-tab-content">
              <div class="tab-header">
                <h4>题材配置</h4>
                <el-button type="primary" size="small" @click="addConfigItem('genres')">
                  <el-icon><Plus /></el-icon>添加题材
                </el-button>
              </div>
              
              <div class="config-list">
                <div v-for="(item, index) in configData.genres" :key="index" class="config-item-row">
                  <el-input v-model="item.label" placeholder="显示名称" class="config-input" />
                  <el-input v-model="item.value" placeholder="值（英文）" class="config-input" />
                  <el-input v-model="item.description" placeholder="描述" class="config-input description-input" />
                  <el-button type="danger" size="small" text @click="removeConfigItem('genres', index)">
                    删除
                  </el-button>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <!-- 情节管理 -->
          <el-tab-pane label="情节" name="plotTypes">
            <div class="config-tab-content">
              <div class="tab-header">
                <h4>情节配置</h4>
                <el-button type="primary" size="small" @click="addConfigItem('plotTypes')">
                  <el-icon><Plus /></el-icon>添加情节
                </el-button>
              </div>
              
              <div class="config-list">
                <div v-for="(item, index) in configData.plotTypes" :key="index" class="config-item-row">
                  <el-input v-model="item.label" placeholder="显示名称" class="config-input" />
                  <el-input v-model="item.value" placeholder="值（英文）" class="config-input" />
                  <el-input v-model="item.description" placeholder="描述" class="config-input description-input" />
                  <el-button type="danger" size="small" text @click="removeConfigItem('plotTypes', index)">
                    删除
                  </el-button>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <!-- 氛围管理 -->
          <el-tab-pane label="氛围" name="emotions">
            <div class="config-tab-content">
              <div class="tab-header">
                <h4>氛围配置</h4>
                <el-button type="primary" size="small" @click="addConfigItem('emotions')">
                  <el-icon><Plus /></el-icon>添加氛围
                </el-button>
              </div>
              
              <div class="config-list">
                <div v-for="(item, index) in configData.emotions" :key="index" class="config-item-row">
                  <el-input v-model="item.label" placeholder="显示名称" class="config-input" />
                  <el-input v-model="item.value" placeholder="值（英文）" class="config-input" />
                  <el-input v-model="item.description" placeholder="描述" class="config-input description-input" />
                  <el-button type="danger" size="small" text @click="removeConfigItem('emotions', index)">
                    删除
                  </el-button>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <!-- 时代管理 -->
          <el-tab-pane label="时代" name="timeFrames">
            <div class="config-tab-content">
              <div class="tab-header">
                <h4>时代配置</h4>
                <el-button type="primary" size="small" @click="addConfigItem('timeFrames')">
                  <el-icon><Plus /></el-icon>添加时代
                </el-button>
              </div>
              
              <div class="config-list">
                <div v-for="(item, index) in configData.timeFrames" :key="index" class="config-item-row">
                  <el-input v-model="item.label" placeholder="显示名称" class="config-input" />
                  <el-input v-model="item.value" placeholder="值（英文）" class="config-input" />
                  <el-input v-model="item.description" placeholder="描述" class="config-input description-input" />
                  <el-button type="danger" size="small" text @click="removeConfigItem('timeFrames', index)">
                    删除
                  </el-button>
                </div>
              </div>
            </div>
          </el-tab-pane>


        </el-tabs>
      </div>
      
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="resetToDefault">恢复默认</el-button>
          <el-button @click="showConfigManager = false">取消</el-button>
          <el-button type="primary" @click="saveConfigData">保存配置</el-button>
        </div>
      </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { useShortStoryWorkspaceContext } from '@/composables/short-storyContext'
import { Plus } from '@element-plus/icons-vue'
const { showConfigManager, activeConfigTab, configData, saveConfigData, addConfigItem, removeConfigItem, resetToDefault } = useShortStoryWorkspaceContext()
</script>
