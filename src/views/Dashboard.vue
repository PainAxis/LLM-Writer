<template>
  <div class="dashboard-container">
    <button v-if="isMobile && mobileOpen" class="sidebar-backdrop" tabindex="-1" aria-label="关闭导航遮罩" data-testid="navigation-backdrop" @click="closeMobileMenu" />
    <!-- 侧边栏 -->
    <div
      v-show="!isMobile || mobileOpen"
      id="app-navigation"
      ref="sidebar"
      class="sidebar"
      :class="{ 'collapsed': !isMobile && isCollapse }"
      :role="isMobile ? 'dialog' : 'navigation'"
      :aria-modal="isMobile ? true : undefined"
      aria-label="主导航"
      data-testid="app-navigation"
      @keydown="handleNavigationKeydown"
    >
      <div class="logo">
        <div class="logo-mark">L</div>
        <h2>LLM-Writer</h2>
        <button v-if="isMobile" ref="closeNavigationButton" class="close-navigation" aria-label="关闭导航" data-testid="navigation-close" @click="closeMobileMenu"><el-icon><Close /></el-icon></button>
      </div>
      
      <el-menu
        :default-active="activeMenu"
        class="sidebar-menu"
        @select="handleMenuSelect"
        :collapse="!isMobile && isCollapse"
        :collapse-transition="false"
      >
        <el-menu-item index="/" tabindex="0" @keydown.enter.prevent="handleMenuSelect('/')" @keydown.space.prevent="handleMenuSelect('/')">
          <el-icon><House /></el-icon>
          <template #title>首页</template>
        </el-menu-item>
        
        <el-menu-item index="/novels" tabindex="0" @keydown.enter.prevent="handleMenuSelect('/novels')" @keydown.space.prevent="handleMenuSelect('/novels')">
          <el-icon><Document /></el-icon>
          <template #title>小说列表</template>
        </el-menu-item>
        
        <el-menu-item index="/prompts" tabindex="0" @keydown.enter.prevent="handleMenuSelect('/prompts')" @keydown.space.prevent="handleMenuSelect('/prompts')">
          <el-icon><ChatLineSquare /></el-icon>
          <template #title>提示词库</template>
        </el-menu-item>

        <el-menu-item index="/assistants" tabindex="0" @keydown.enter.prevent="handleMenuSelect('/assistants')" @keydown.space.prevent="handleMenuSelect('/assistants')">
          <el-icon><ChatDotRound /></el-icon>
          <template #title>AI 助手</template>
        </el-menu-item>

        <el-menu-item index="/genres" tabindex="0" @keydown.enter.prevent="handleMenuSelect('/genres')" @keydown.space.prevent="handleMenuSelect('/genres')">
          <el-icon><Collection /></el-icon>
          <template #title>小说类型管理</template>
        </el-menu-item>
        
        <el-menu-item index="/chapters" tabindex="0" @keydown.enter.prevent="handleMenuSelect('/chapters')" @keydown.space.prevent="handleMenuSelect('/chapters')">
          <el-icon><Notebook /></el-icon>
          <template #title>章节管理</template>
        </el-menu-item>
        
        <el-menu-item index="/goals" tabindex="0" @keydown.enter.prevent="handleMenuSelect('/goals')" @keydown.space.prevent="handleMenuSelect('/goals')">
          <el-icon><Aim /></el-icon>
          <template #title>写作目标</template>
        </el-menu-item>
        
        <el-menu-item index="/billing" tabindex="0" @keydown.enter.prevent="handleMenuSelect('/billing')" @keydown.space.prevent="handleMenuSelect('/billing')">
          <el-icon><CreditCard /></el-icon>
          <template #title>Token计费</template>
        </el-menu-item>
        
        <el-menu-item index="/tools" tabindex="0" @keydown.enter.prevent="handleMenuSelect('/tools')" @keydown.space.prevent="handleMenuSelect('/tools')">
          <el-icon><Tools /></el-icon>
          <template #title>工具库</template>
        </el-menu-item>
        
        <el-menu-item index="/short-story" tabindex="0" @keydown.enter.prevent="handleMenuSelect('/short-story')" @keydown.space.prevent="handleMenuSelect('/short-story')">
          <el-icon><EditPen /></el-icon>
          <template #title>短文写作</template>
        </el-menu-item>
        
        <el-menu-item index="/book-analysis" tabindex="0" @keydown.enter.prevent="handleMenuSelect('/book-analysis')" @keydown.space.prevent="handleMenuSelect('/book-analysis')">
          <el-icon><DataAnalysis /></el-icon>
          <template #title>拆书工具</template>
        </el-menu-item>

        <el-menu-item index="/mindmap" tabindex="0" @keydown.enter.prevent="handleMenuSelect('/mindmap')" @keydown.space.prevent="handleMenuSelect('/mindmap')">
          <el-icon><Share /></el-icon>
          <template #title>思维导图</template>
        </el-menu-item>

        <el-menu-item index="/memory" tabindex="0" @keydown.enter.prevent="handleMenuSelect('/memory')" @keydown.space.prevent="handleMenuSelect('/memory')">
          <el-icon><Search /></el-icon>
          <template #title>记忆检索 · 原型</template>
        </el-menu-item>

        <el-menu-item index="/settings" tabindex="0" @keydown.enter.prevent="handleMenuSelect('/settings')" @keydown.space.prevent="handleMenuSelect('/settings')">
          <el-icon><Setting /></el-icon>
          <template #title>系统设置</template>
        </el-menu-item>
      </el-menu>
    </div>
    
    <!-- 主要内容区域 -->
    <div class="main-container" :inert="isMobile && mobileOpen">
      <!-- 顶部导航栏 -->
      <div class="header">
        <div class="header-left">
          <el-button 
            ref="navigationToggle"
            type="text" 
            @click="toggleSidebar"
            class="collapse-btn"
            :aria-label="isMobile ? '打开导航' : isCollapse ? '展开导航' : '收起导航'"
            :aria-expanded="isMobile ? mobileOpen : !isCollapse"
            aria-controls="app-navigation"
            data-testid="navigation-toggle"
          >
            <el-icon><Expand v-if="isCollapse" /><Fold v-else /></el-icon>
          </el-button>
          <span class="page-title">{{ pageTitle }}</span>
        </div>
        
        <div class="header-right">
          <!-- 主题切换：light / dark / system -->
          <el-tooltip :content="themeTooltip" placement="bottom">
            <el-button class="theme-toggle" :aria-label="themeTooltip" @click="onToggleTheme">
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
    <el-dialog v-model="showApiConfig" title="API配置" width="min(1000px, calc(100vw - 24px))" destroy-on-close @close="apiConfigPanel?.cancelRequests()">
      <ApiConfig ref="apiConfigPanel" @close="showApiConfig = false" />
    </el-dialog>

    <!-- 公告对话框 -->
    <AnnouncementDialog
      v-model:visible="showAnnouncement"
      :announcement="currentAnnouncement"
      @close="handleAnnouncementClose"
    />
  </div>
</template>

<script setup lang="ts">
import type { CustomModelOption } from '@/types/api'
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useApiConfig } from '@/services/apiConfig'
import { FALLBACK_MODELS } from '@/services/aiProviders'
import {
  House, Document, ChatLineSquare, ChatDotRound, Collection, Notebook, Aim,
  CreditCard, Setting, Key, Tools, EditPen, DataAnalysis, Share, Search,
  Expand, Fold, Bell, Sunny, Moon, Monitor, Close
} from '@element-plus/icons-vue'
import { useTheme } from '@/composables/useTheme'
import ApiConfig from '@/components/ApiConfig.vue'
import AnnouncementDialog from '@/components/AnnouncementDialog.vue'
import { getLatestAnnouncement } from '@/config/announcements.js'
import { ElMessage } from 'element-plus'

const router = useRouter()
const route = useRoute()
const { customModels: savedCustomModels, getProviderModels, activeConfig, isApiConfigured, updateConfig } = useApiConfig()

// 响应式数据
const isCollapse = ref(false)
const mobileMedia = window.matchMedia('(max-width: 768px)')
const isMobile = ref(mobileMedia.matches)
const mobileOpen = ref(false)
const sidebar = ref<HTMLElement | null>(null)
const closeNavigationButton = ref<HTMLButtonElement | null>(null)
const navigationToggle = ref<{ $el: HTMLButtonElement } | null>(null)

const closeMobileMenu = async () => {
  if (!mobileOpen.value) return
  mobileOpen.value = false
  await nextTick()
  navigationToggle.value?.$el.focus()
}

const updateViewport = () => {
  // Desktop collapse is independent of the temporary mobile drawer. Crossing
  // the breakpoint never leaves an invisible modal or focus in hidden content.
  const focusWasInSidebar = sidebar.value?.contains(document.activeElement)
  isMobile.value = mobileMedia.matches
  mobileOpen.value = false
  if (focusWasInSidebar) void nextTick(() => navigationToggle.value?.$el.focus())
}
onMounted(() => { mobileMedia.addEventListener('change', updateViewport) })
onUnmounted(() => { mobileMedia.removeEventListener('change', updateViewport) })

const handleNavigationKeydown = (event: KeyboardEvent) => {
  if (!isMobile.value || !mobileOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    void closeMobileMenu()
  } else if (event.key === 'Tab') {
    const targets = [...(sidebar.value?.querySelectorAll<HTMLElement>('button, a[href], [tabindex]') ?? [])]
      .filter(element => element.tabIndex >= 0 && !element.hasAttribute('disabled') && element.getClientRects().length)
    const first = targets[0]
    const last = targets.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
}
const showApiConfig = ref(false)
const apiConfigPanel = ref<InstanceType<typeof ApiConfig> | null>(null)
const showAnnouncement = ref(false)
const currentAnnouncement = ref(getLatestAnnouncement())
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
const currentServerModels = computed(() => getProviderModels(activeConfig.value))

const localModels = computed(() => {
  const serverSet = new Set(currentServerModels.value)
  const deduped: CustomModelOption[] = []
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
  const titleMap: Record<string, string> = {
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
    '/memory': '记忆检索原型',
    '/settings': '系统设置'
  }
  return titleMap[route.path] || '首页'
})

// 方法
const toggleSidebar = async () => {
  if (isMobile.value) {
    mobileOpen.value = true
    await nextTick()
    closeNavigationButton.value?.focus()
  } else isCollapse.value = !isCollapse.value
}

const handleMenuSelect = (index: string) => {
  void closeMobileMenu()
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
const isKnownModel = (modelId: string) => {
  return currentServerModels.value.includes(modelId) || localModels.value.some((m) => m.id === modelId)
}

const handleModelChange = (modelId: string) => {
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
    ElMessage.error('切换模型失败: ' + (error instanceof Error ? error.message : '未知错误'))
  }
}

const getModelDisplayName = (modelId: string) => {
  return modelId
}

// 监听路由变化
watch(() => route.path, (newPath) => {
  activeMenu.value = newPath
  void closeMobileMenu()
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
  height: 100dvh;
  background-color: var(--el-bg-color-page);
}

/* ---------- 侧边栏：浅色纸面质感 ---------- */
.sidebar {
  width: 232px;
  flex-shrink: 0;
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
  flex: 1;
  min-height: 0;
  overflow-y: auto;
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

.sidebar-menu :deep(.el-menu-item:focus-visible) {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
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
  flex-shrink: 0;
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
  min-height: 0;
  padding: 24px;
  overflow-y: auto;
  background-color: var(--el-bg-color-page);
}

/* ---------- 响应式设计 ---------- */
@media (max-width: 768px) {
  .sidebar-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1999;
    border: 0;
    background: rgba(0, 0, 0, 0.4);
    cursor: pointer;
  }

  .sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 2000;
    width: min(288px, calc(100vw - 44px));
    height: 100vh;
    height: 100dvh;
    box-shadow: var(--shadow-card-hover);
  }

  .logo { gap: 8px; padding: 0 12px; }
  .logo h2 { font-size: 15px; }
  .close-navigation { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; margin-left: auto; flex-shrink: 0; border: 0; border-radius: 6px; color: var(--ink-700); background: transparent; cursor: pointer; font-size: 20px; }
  .close-navigation:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
  .sidebar-menu :deep(.el-menu-item) { min-height: 44px; }

  .main-container {
    margin-left: 0;
  }

  .header { height: auto; min-height: 64px; padding: 8px 12px; gap: 8px; flex-wrap: wrap; }
  .header-left { width: 100%; min-width: 0; }
  .page-title { overflow-wrap: anywhere; }
  .collapse-btn { width: 44px; height: 44px; flex-shrink: 0; margin-right: 8px; }
  .header-right { width: 100%; flex-wrap: wrap; gap: 8px; }
  .header-right > .el-button { min-height: 44px; margin-left: 0; padding-inline: 10px; }
  .theme-toggle { min-width: 44px; }
  .model-selector { order: 1; flex: 1 1 100%; min-width: 0; }
  .model-selector .el-select { width: 100% !important; min-width: 0; }
  .model-selector :deep(.el-select__wrapper) { min-height: 44px; }

  .content {
    padding: 12px;
  }
}
</style>
