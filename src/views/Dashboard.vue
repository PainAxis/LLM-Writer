<template>
  <div class="dashboard-container">
    <!-- 侧边栏 -->
    <div class="sidebar" :class="{ 'collapsed': isCollapse }">
      <div class="logo">
        <div class="logo-mark">L</div>
        <h2>LLM-Writer</h2>
      </div>
      
      <el-menu
        :default-active="activeMenu"
        class="sidebar-menu"
        @select="handleMenuSelect"
        :collapse="isCollapse"
        :collapse-transition="false"
      >
        <el-menu-item index="/">
          <el-icon><House /></el-icon>
          <template #title>首页</template>
        </el-menu-item>
        
        <el-menu-item index="/novels">
          <el-icon><Document /></el-icon>
          <template #title>小说列表</template>
        </el-menu-item>
        
        <el-menu-item index="/prompts">
          <el-icon><ChatLineSquare /></el-icon>
          <template #title>提示词库</template>
        </el-menu-item>

        <el-menu-item index="/assistants">
          <el-icon><ChatDotRound /></el-icon>
          <template #title>AI 助手</template>
        </el-menu-item>

        <el-menu-item index="/genres">
          <el-icon><Collection /></el-icon>
          <template #title>小说类型管理</template>
        </el-menu-item>
        
        <el-menu-item index="/chapters">
          <el-icon><Notebook /></el-icon>
          <template #title>章节管理</template>
        </el-menu-item>
        
        <el-menu-item index="/goals">
          <el-icon><Aim /></el-icon>
          <template #title>写作目标</template>
        </el-menu-item>
        
        <el-menu-item index="/billing">
          <el-icon><CreditCard /></el-icon>
          <template #title>Token计费</template>
        </el-menu-item>
        
        <el-menu-item index="/tools">
          <el-icon><Tools /></el-icon>
          <template #title>工具库</template>
        </el-menu-item>
        
        <el-menu-item index="/short-story">
          <el-icon><EditPen /></el-icon>
          <template #title>短文写作</template>
        </el-menu-item>
        
        <el-menu-item index="/book-analysis">
          <el-icon><DataAnalysis /></el-icon>
          <template #title>拆书工具</template>
        </el-menu-item>

        <el-menu-item index="/mindmap">
          <el-icon><Share /></el-icon>
          <template #title>思维导图</template>
        </el-menu-item>

        <el-menu-item index="/settings">
          <el-icon><Setting /></el-icon>
          <template #title>系统设置</template>
        </el-menu-item>
      </el-menu>
    </div>
    
    <!-- 主要内容区域 -->
    <div class="main-container">
      <!-- 顶部导航栏 -->
      <div class="header">
        <div class="header-left">
          <el-button 
            type="text" 
            @click="toggleSidebar"
            class="collapse-btn"
          >
            <el-icon><Expand v-if="isCollapse" /><Fold v-else /></el-icon>
          </el-button>
          <span class="page-title">{{ pageTitle }}</span>
        </div>
        
        <div class="header-right">
          <!-- 主题切换：light / dark / system -->
          <el-tooltip :content="themeTooltip" placement="bottom">
            <el-button class="theme-toggle" @click="onToggleTheme">
              <el-icon><Sunny v-if="themeMode === 'light'" /><Moon v-else-if="themeMode === 'dark'" /><Monitor v-else /></el-icon>
            </el-button>
          </el-tooltip>

          <!-- 模型选择 -->
          <div class="model-selector" v-if="isApiConfigured">
            <el-select 
              v-model="currentModel"
              @change="handleModelChange"
              size="small"
              style="width: 220px"
              placeholder="选择模型"
            >
              <!-- 模型列表：服务端同步 + 本地/常用 -->
              <el-option-group
                v-if="currentServerModels.length > 0"
                label="🛰️ 服务端模型列表"
              >
                <el-option
                  v-for="model in currentServerModels"
                  :key="`srv-${model}`"
                  :label="model"
                  :value="model"
                />
              </el-option-group>

              <el-option-group label="📌 常用与自定义模型">
                <el-option
                  v-for="model in localModels"
                  :key="model.id"
                  :label="model.name"
                  :value="model.id"
                >
                  <span>{{ model.name }}</span>
                  <span v-if="model.description" style="float: right; color: #8492a6; font-size: 12px">
                    {{ model.description }}
                  </span>
                </el-option>
              </el-option-group>
            </el-select>
          </div>

          <!-- 公告及教程 -->
          <el-button 
            @click="openAnnouncement" 
            type="primary"
            size="small"
          >
            <el-icon><Bell /></el-icon>
            公告及教程
          </el-button>

          <!-- API配置状态 -->
          <el-button 
            @click="showApiConfig = true" 
            :type="isApiConfigured ? 'success' : 'warning'"
            size="small"
          >
            <el-icon><Key /></el-icon>
            {{ isApiConfigured ? 'API已配置' : 'API配置' }}
          </el-button>
        </div>
      </div>
      
      <!-- 页面内容 -->
      <div class="content">
        <router-view v-slot="{ Component }">
          <transition name="page-fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </div>
    </div>
    
    <!-- API配置对话框 -->
    <el-dialog v-model="showApiConfig" title="API配置" width="1000px">
      <ApiConfig @close="showApiConfig = false" />
    </el-dialog>

    <!-- 公告对话框 -->
    <AnnouncementDialog
      v-model:visible="showAnnouncement"
      :announcement="currentAnnouncement"
      @close="handleAnnouncementClose"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useApiConfig } from '@/services/apiConfig'
import { FALLBACK_MODELS } from '@/services/aiProviders'
import {
  House, Document, ChatLineSquare, ChatDotRound, Collection, Notebook, Aim,
  CreditCard, Setting, Key, Tools, EditPen, DataAnalysis, Share,
  Expand, Fold, Bell, Sunny, Moon, Monitor
} from '@element-plus/icons-vue'
import { useTheme } from '@/composables/useTheme'
import ApiConfig from '@/components/ApiConfig.vue'
import AnnouncementDialog from '@/components/AnnouncementDialog.vue'
import { getLatestAnnouncement } from '@/config/announcements.js'
import { ElMessage } from 'element-plus'

const router = useRouter()
const route = useRoute()
const { customModels: savedCustomModels, providerModels, activeConfig, isApiConfigured, updateConfig } = useApiConfig()

// 响应式数据
const isCollapse = ref(false)
const showApiConfig = ref(false)
const showAnnouncement = ref(false)
const currentAnnouncement = ref({})
const activeMenu = ref('/')
const currentModel = ref('')

// 主题切换（light / dark / system 循环）
const { themeMode, cycleTheme } = useTheme()
const themeTooltip = computed(() => {
  const map = { light: '当前：亮色模式（点击切换）', dark: '当前：暗色模式（点击切换）', system: '当前：跟随系统（点击切换）' }
  return map[themeMode.value]
})
const onToggleTheme = () => {
  const next = cycleTheme()
  const label = { light: '亮色模式', dark: '暗色模式', system: '跟随系统' }
  ElMessage.success(`已切换为${label[next]}`)
}

// 本地兜底模型列表（共享清单，剔除与服务端列表重复的项）
const currentServerModels = computed(() => providerModels.value[activeConfig.value.provider] ?? [])

const localModels = computed(() => {
  const serverSet = new Set(currentServerModels.value)
  const deduped = []
  for (const model of FALLBACK_MODELS) {
    if (!deduped.some((m) => m.id === model.id) && !serverSet.has(model.id)) {
      deduped.push(model)
    }
  }
  for (const model of savedCustomModels.value) {
    if (!deduped.some((m) => m.id === model.id) && !serverSet.has(model.id)) {
      deduped.push(model)
    }
  }
  return deduped
})

const pageTitle = computed(() => {
  const titleMap = {
    '/': '首页',
    '/novels': '小说列表',
    '/prompts': '提示词库',
    '/genres': '小说类型管理',
    '/chapters': '章节管理',
    '/goals': '写作目标',
    '/billing': 'Token计费',
    '/tools': '工具库',
    '/short-story': '短文写作',
    '/book-analysis': '拆书工具',
    '/settings': '系统设置'
  }
  return titleMap[route.path] || '首页'
})

// 方法
const toggleSidebar = () => {
  isCollapse.value = !isCollapse.value
}

const handleMenuSelect = (index) => {
  router.push(index)
}

// 公告相关功能
const openAnnouncement = () => {
  try {
    currentAnnouncement.value = getLatestAnnouncement()
    showAnnouncement.value = true
  } catch (error) {
    console.error('获取公告错误:', error)
  }
}

const handleAnnouncementClose = () => {
  showAnnouncement.value = false
}

// 模型相关功能
const isKnownModel = (modelId) => {
  return currentServerModels.value.includes(modelId) || localModels.value.some((m) => m.id === modelId)
}

const handleModelChange = (modelId) => {
  try {
    if (!isKnownModel(modelId)) {
      ElMessage.error('未知的模型类型')
      return
    }

    updateConfig({ selectedModel: modelId })

    const modelName = getModelDisplayName(modelId)

    // 检查是否需要配置API密钥
    const needsApiKey = !activeConfig.value.apiKey?.trim()

    if (needsApiKey) {
      ElMessage.warning(`已切换到模型: ${modelName}，请先配置API密钥`)
      setTimeout(() => {
        showApiConfig.value = true
      }, 1000)
    } else {
      ElMessage.success(`已切换到模型: ${modelName}`)
    }
  } catch (error) {
    console.error('切换模型失败:', error)
    ElMessage.error('切换模型失败: ' + error.message)
  }
}

const getModelDisplayName = (modelId) => {
  return modelId
}

// 监听路由变化
watch(() => route.path, (newPath) => {
  activeMenu.value = newPath
}, { immediate: true })

// 配置变化时同步模型选择器（统一配置模块为响应式，无需轮询 localStorage）
watch(
  () => [isApiConfigured.value, activeConfig.value],
  () => {
    currentModel.value = activeConfig.value.selectedModel || ''
  },
  { immediate: true }
)
</script>

<style scoped>
.dashboard-container {
  display: flex;
  height: 100vh;
  background-color: var(--el-bg-color-page);
}

/* ---------- 侧边栏：浅色纸面质感 ---------- */
.sidebar {
  width: 232px;
  background-color: var(--app-sidebar-bg);
  border-right: 1px solid var(--ink-200);
  color: var(--ink-700);
  display: flex;
  flex-direction: column;
  transition: width 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.sidebar.collapsed {
  width: 64px;
}

.sidebar.collapsed .logo h2 {
  display: none;
}

.sidebar.collapsed .logo {
  padding: 0;
  justify-content: center;
}

.logo {
  height: 64px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  flex-shrink: 0;
}

.logo-mark {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: linear-gradient(135deg, var(--brand-600), var(--brand-400));
  color: #fff;
  font-family: Georgia, 'Songti SC', 'SimSun', serif;
  font-size: 17px;
  font-weight: 700;
  box-shadow: 0 2px 6px rgba(79, 70, 229, 0.35);
}

.logo h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.2px;
  white-space: nowrap;
  color: var(--ink-900);
  font-family: Georgia, 'Songti SC', 'SimSun', serif;
}

/* 菜单：胶囊交互 */
.sidebar-menu {
  border: none;
  background-color: transparent;
  height: calc(100vh - 64px);
  padding: 6px 10px;
}

.sidebar-menu :deep(.el-menu-item) {
  height: 42px;
  line-height: 42px;
  margin: 2px 0;
  border-radius: var(--radius-md);
  color: var(--ink-500);
  font-size: 14px;
  transition: all 0.18s ease;
}

.sidebar-menu :deep(.el-menu-item .el-icon) {
  color: var(--ink-400);
  transition: color 0.18s ease;
}

.sidebar-menu :deep(.el-menu-item:hover) {
  background-color: var(--ink-100);
  color: var(--ink-900);
}

.sidebar-menu :deep(.el-menu-item:hover .el-icon) {
  color: var(--ink-700);
}

.sidebar-menu :deep(.el-menu-item.is-active) {
  background-color: var(--brand-50);
  color: var(--brand-600);
  font-weight: 600;
}

.sidebar-menu :deep(.el-menu-item.is-active .el-icon) {
  color: var(--brand-600);
}

/* ---------- 主区域 ---------- */
.main-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.header {
  height: 64px;
  background-color: var(--app-header-bg);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--ink-200);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}

.header-left {
  display: flex;
  align-items: center;
}

.collapse-btn {
  margin-right: 14px;
  font-size: 18px;
  border: none;
  color: var(--ink-500);
}

.page-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--ink-900);
  letter-spacing: 0.2px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.theme-toggle {
  border: none;
  background: transparent;
  color: var(--ink-500);
  font-size: 17px;
  padding: 8px;
}

.theme-toggle:hover {
  color: var(--brand-600);
  background: var(--ink-100);
}

.model-selector {
  display: flex;
  align-items: center;
}

.model-selector .el-select {
  min-width: 200px;
}

.model-selector .el-select .el-input__inner {
  font-size: 13px;
}

/* 模型分组样式 */
.model-selector :deep(.el-select-group__title) {
  font-weight: 600;
  color: var(--brand-600);
  padding: 8px 12px;
  background-color: var(--ink-50);
  border-bottom: 1px solid var(--ink-100);
}

.model-selector :deep(.el-option-group .el-option) {
  padding-left: 20px;
}

.model-selector :deep(.el-option-group:not(:last-child)) {
  border-bottom: 1px solid var(--ink-100);
}

.content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  background-color: var(--el-bg-color-page);
}

/* ---------- 响应式设计 ---------- */
@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    z-index: 1000;
    height: 100vh;
    box-shadow: var(--shadow-card-hover);
  }

  .main-container {
    margin-left: 0;
  }

  .content {
    padding: 16px;
  }
}
</style>
