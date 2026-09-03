<template>
  <div class="home-page">
    <!-- 欢迎区域 -->
    <div class="welcome-section">
      <div class="welcome-content">
        <div class="welcome-text">
          <h1>欢迎回来</h1>
          <p>继续您的创作，让 AI 助力每一个章节</p>
        </div>
        <div class="welcome-actions">
          <el-button type="primary" @click="createNovel">
            <el-icon><Plus /></el-icon>
            创建新小说
          </el-button>
        </div>
      </div>
    </div>

    <!-- 统计概览 -->
    <div class="stats-section">
      <el-row :gutter="20">
        <el-col :span="6">
          <el-card class="stat-card" shadow="hover">
            <div class="stat-item">
              <div class="stat-icon novels">
                <el-icon><Document /></el-icon>
              </div>
              <div class="stat-content">
                <div class="stat-number">{{ stats.totalNovels }}</div>
                <div class="stat-label">总小说数</div>
              </div>
            </div>
          </el-card>
        </el-col>
        
        <el-col :span="6">
          <el-card class="stat-card" shadow="hover">
            <div class="stat-item">
              <div class="stat-icon words">
                <el-icon><EditPen /></el-icon>
              </div>
              <div class="stat-content">
                <div class="stat-number">{{ formatNumber(stats.totalWords) }}</div>
                <div class="stat-label">总字数</div>
              </div>
            </div>
          </el-card>
        </el-col>
        
        <el-col :span="6">
          <el-card class="stat-card" shadow="hover">
            <div class="stat-item">
              <div class="stat-icon chapters">
                <el-icon><Notebook /></el-icon>
              </div>
              <div class="stat-content">
                <div class="stat-number">{{ stats.totalChapters }}</div>
                <div class="stat-label">总章节数</div>
              </div>
            </div>
          </el-card>
        </el-col>
        
        <el-col :span="6">
          <el-card class="stat-card" shadow="hover">
            <div class="stat-item">
              <div class="stat-icon tokens">
                <el-icon><CreditCard /></el-icon>
              </div>
              <div class="stat-content">
                <div class="stat-number">{{ formatNumber(stats.totalTokens) }}</div>
                <div class="stat-label">已用Token</div>
              </div>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- 主要内容区域 -->
    <el-row :gutter="20" class="main-content">
      <!-- 左侧：写作目标 -->
      <el-col :span="12">
        <el-card class="goals-card" shadow="hover">
          <template #header>
            <div class="card-header">
              <span>今日写作目标</span>
              <el-button type="text" @click="showGoalsDialog = true">
                管理目标
              </el-button>
            </div>
          </template>
          
          <div class="goals-content">
            <!-- 动态显示目标 -->
            <div 
              v-for="goal in displayedGoals" 
              :key="goal.id"
              class="goal-item"
            >
              <div class="goal-info">
                <span class="goal-label">{{ goal.title }}</span>
                <span class="goal-value">{{ goal.targetValue }}{{ goal.unit }}</span>
              </div>
              <div class="goal-progress">
                <el-progress 
                  :percentage="getGoalProgress(goal)" 
                  :color="getProgressColor(getGoalProgress(goal))"
                  :stroke-width="8"
                  :show-text="false"
                />
                <span class="progress-text">{{ goal.currentValue }}{{ goal.unit }} / {{ goal.targetValue }}{{ goal.unit }}</span>
              </div>
            </div>
            
            <!-- 如果没有目标时显示默认内容 -->
            <div v-if="displayedGoals.length === 0" class="no-goals">
              <el-empty description="暂无活跃目标" size="small">
                <el-button type="primary" size="small" @click="showGoalsDialog = true">
                  创建目标
                </el-button>
              </el-empty>
            </div>
            
            <!-- 查看全部目标按钮 -->
            <div v-if="totalActiveGoals > maxDisplayGoals" class="view-all-goals">
              <el-button type="text" size="small" @click="showGoalsDialog = true">
                查看全部 {{ totalActiveGoals }} 个目标 →
              </el-button>
            </div>
            
            <div class="streak-info" v-if="displayedGoals.length > 0">
              <el-icon class="streak-icon"><Trophy /></el-icon>
              <span>连续写作 {{ calculateStreak() }} 天</span>
            </div>
          </div>
        </el-card>
      </el-col>
      
      <!-- 右侧：快速操作 -->
      <el-col :span="12">
        <el-card class="quick-actions-card" shadow="hover">
          <template #header>
            <span>快速操作</span>
          </template>
          
          <div class="quick-actions">
            <div class="action-grid">
              <div class="action-item" @click="openPrompts">
                <div class="action-icon">
                  <el-icon><ChatLineSquare /></el-icon>
                </div>
                <span>提示词库</span>
              </div>
              
              <div class="action-item" @click="openChapters">
                <div class="action-icon">
                  <el-icon><Notebook /></el-icon>
                </div>
                <span>章节管理</span>
              </div>
              
              <div class="action-item" @click="openBilling">
                <div class="action-icon">
                  <el-icon><CreditCard /></el-icon>
                </div>
                <span>Token计费</span>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 最近小说 -->
    <div class="recent-novels-section">
      <el-card class="recent-novels-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <span>最近编辑的小说</span>
            <el-button type="text" @click="viewAllNovels">
              查看全部
            </el-button>
          </div>
        </template>
        
        <div class="novels-list">
          <div 
            v-for="novel in recentNovels" 
            :key="novel.id"
            class="novel-item"
            @click="openNovel(novel)"
          >
            <div class="novel-cover">
              <img v-if="novel.cover" :src="novel.cover" :alt="novel.title" />
              <div v-else class="default-cover">
                <el-icon><Document /></el-icon>
              </div>
            </div>
            <div class="novel-info">
              <h4 class="novel-title">{{ novel.title }}</h4>
              <p class="novel-desc">{{ novel.description }}</p>
              <div class="novel-meta">
                <span class="word-count">{{ formatNumber(novel.wordCount) }} 字</span>
                <span class="update-time">{{ formatTime(novel.updatedAt) }}</span>
              </div>
            </div>
            <div class="novel-actions">
              <el-button type="text" size="small">
                继续写作
              </el-button>
            </div>
          </div>
          
          <div v-if="recentNovels.length === 0" class="empty-novels">
            <el-empty description="暂无小说，开始创作您的第一部作品吧！">
              <el-button type="primary" @click="createNovel">创建小说</el-button>
            </el-empty>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 写作目标管理对话框 -->
    <el-dialog v-model="showGoalsDialog" title="写作目标管理" width="800px">
      <WritingGoals @close="showGoalsDialog = false" />
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  Plus, Document, EditPen, Notebook, CreditCard,
  ChatLineSquare, Trophy
} from '@element-plus/icons-vue'
import WritingGoals from '@/components/WritingGoals.vue'
import billingService from '@/services/billing'
import { storageGet, StorageKeys } from '@/utils/storage'

const router = useRouter()
// 响应式数据
const showGoalsDialog = ref(false)
const stats = computed(() => {
  // 从本地存储获取真实的小说数据
  const novelsData = storageGet(StorageKeys.novels, [])
  
  // 使用计费服务获取真实的token使用统计
  const usageStats = billingService.getUsageStats()
  
  // 计算真实统计数据
  const totalNovels = novelsData.length
  const totalWords = novelsData.reduce((sum, novel) => sum + (novel.wordCount || 0), 0)
  const totalChapters = novelsData.reduce((sum, novel) => sum + ((novel.chapterList || []).length), 0)
  const totalTokens = usageStats.totalInputTokens + usageStats.totalOutputTokens
  
  return {
    totalNovels,
    totalWords,
    totalChapters,
    totalTokens
  }
})

// 添加响应式的目标数据状态
const goalsRefreshTrigger = ref(0)
const maxDisplayGoals = ref(3) // 首页最多显示的目标数量

// 获取所有活跃目标
const activeGoals = computed(() => {
  // 触发重新计算（通过依赖goalsRefreshTrigger）
  void goalsRefreshTrigger.value
  
  // 从本地存储获取真实的写作目标数据
  const goalsData = storageGet(StorageKeys.writingGoals, [])
  const active = goalsData.filter(goal => goal.status === 'active')
  
  // 按优先级排序（priority字段，数字越小优先级越高），如果没有priority则按创建时间排序
  return active.sort((a, b) => {
    if (a.priority !== undefined && b.priority !== undefined) {
      return a.priority - b.priority
    }
    if (a.priority !== undefined) return -1
    if (b.priority !== undefined) return 1
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
  })
})

// 首页显示的目标（限制数量）
const displayedGoals = computed(() => {
  return activeGoals.value.slice(0, maxDisplayGoals.value)
})

// 总的活跃目标数量
const totalActiveGoals = computed(() => {
  return activeGoals.value.length
})

// 兼容旧的currentGoal计算属性（保持向后兼容）
const currentGoal = computed(() => {
  const daily = activeGoals.value.find(goal => goal.type === 'daily')
  const weekly = activeGoals.value.find(goal => goal.type === 'weekly')
  
  return {
    dailyTarget: daily?.targetValue || 2000,
    dailyWritten: daily?.currentValue || 0,
    weeklyTarget: weekly?.targetValue || 14000,
    weeklyWritten: weekly?.currentValue || 0,
    streak: 0
  }
})

const recentNovels = computed(() => {
  // 从本地存储获取真实的小说数据
  const novelsData = storageGet(StorageKeys.novels, [])
  
  // 按更新时间排序，取前3个
  return novelsData
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, 3)
    .map(novel => ({
      id: novel.id,
      title: novel.title,
      description: novel.description,
      wordCount: novel.wordCount || 0,
      updatedAt: new Date(novel.updatedAt || Date.now()),
      cover: novel.cover
    }))
})

// 计算属性
const _dailyProgress = computed(() => {
  return Math.min(100, Math.round((currentGoal.value.dailyWritten / currentGoal.value.dailyTarget) * 100))
})

const _weeklyProgress = computed(() => {
  return Math.min(100, Math.round((currentGoal.value.weeklyWritten / currentGoal.value.weeklyTarget) * 100))
})

// 新增辅助函数
const getGoalProgress = (goal) => {
  if (!goal.targetValue || goal.targetValue === 0) return 0
  return Math.min(100, Math.round((goal.currentValue / goal.targetValue) * 100))
}

const calculateStreak = () => {
  // 简化的连续天数计算逻辑
  // 可以根据实际需求实现更复杂的逻辑
  return 0
}

const _getGoalTypeText = (type) => {
  const typeMap = {
    daily: '每日',
    weekly: '每周', 
    monthly: '每月',
    custom: '自定义'
  }
  return typeMap[type] || '目标'
}

// 方法
const formatNumber = (num) => {
  if (num >= 10000) {
    return (num / 10000).toFixed(1) + '万'
  }
  return num.toLocaleString()
}

const formatTime = (date) => {
  const now = new Date()
  const diff = now - date
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)
  
  if (days > 0) {
    return `${days}天前`
  } else if (hours > 0) {
    return `${hours}小时前`
  } else {
    return '刚刚'
  }
}

const getProgressColor = (percentage) => {
  if (percentage >= 100) return 'var(--el-color-success)'
  if (percentage >= 80) return 'var(--el-color-warning)'
  if (percentage >= 60) return 'var(--brand-500)'
  return 'var(--el-color-danger)'
}

const createNovel = () => {
  router.push('/novels')
}

const openNovel = (novel) => {
  // 跳转到小说编辑页面
  router.push(`/writer?novelId=${novel.id}`)
}

const viewAllNovels = () => {
  router.push('/novels')
}

const openPrompts = () => {
  router.push('/prompts')
}

const openChapters = () => {
  router.push('/chapters')
}

const openBilling = () => {
  router.push('/billing')
}

// 页面获得焦点时重新计算数据，确保数据同步
const refreshData = () => {
  goalsRefreshTrigger.value++
  console.log('首页刷新目标数据')
}

// 暴露刷新函数给全局，以便其他页面调用
window.refreshHomeData = refreshData

// 生命周期
onMounted(() => {
  // 监听localStorage变化，以便实时更新目标数据
  window.addEventListener('storage', (e) => {
    if (e.key === 'writingGoals') {
      refreshData()
    }
  })
  
  // 监听页面可见性变化
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshData()
    }
  })
})
</script>

<style scoped>
.home-page {
  padding: 0;
}

/* ---------- 欢迎区：编辑部式排版，无渐变横幅 ---------- */
.welcome-section {
  margin-bottom: 28px;
}

.welcome-content {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 20px;
  padding: 8px 4px 20px;
  border-bottom: 1px solid var(--ink-200);
}

.welcome-text h1 {
  margin: 0 0 8px 0;
  font-family: Georgia, 'Songti SC', 'SimSun', serif;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--ink-900);
}

.welcome-text p {
  margin: 0;
  font-size: 14px;
  color: var(--ink-500);
}

.welcome-actions {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}

/* ---------- 统计卡：统一克制的强调色 ---------- */
.stats-section {
  margin-bottom: 24px;
}

.stat-card :deep(.el-card__body) {
  padding: 20px 22px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 16px;
}

.stat-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 19px;
  background: var(--brand-50);
  color: var(--brand-600);
  flex-shrink: 0;
}

.stat-content {
  flex: 1;
  min-width: 0;
}

.stat-number {
  font-size: 26px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ink-900);
  line-height: 1.1;
  letter-spacing: -0.3px;
}

.stat-label {
  font-size: 13px;
  color: var(--ink-500);
  margin-top: 4px;
}

/* ---------- 主内容区 ---------- */
.main-content {
  margin-bottom: 24px;
}

.goals-card,
.quick-actions-card {
  height: 100%;
  min-height: 360px;
}

.goals-card :deep(.el-card__body),
.quick-actions-card :deep(.el-card__body) {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-900);
}

.goals-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 4px 0;
}

.goal-item {
  margin-bottom: 12px;
  padding: 14px 16px;
  background: var(--ink-50);
  border-radius: var(--radius-md);
  border: 1px solid var(--ink-100);
  transition: border-color 0.2s ease;
}

.goal-item:hover {
  border-color: var(--brand-400);
}

.goal-item:last-child {
  margin-bottom: 12px;
}

.goal-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.goal-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-700);
}

.goal-value {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-500);
}

.goal-progress {
  position: relative;
}

.progress-text {
  display: block;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-400);
  margin-top: 6px;
  line-height: 1;
}

.streak-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--brand-50);
  border-radius: var(--radius-md);
  margin-top: auto;
  font-size: 13px;
  color: var(--brand-600);
  font-weight: 500;
}

.streak-icon {
  color: var(--warning-color);
  font-size: 16px;
}

.no-goals {
  padding: 16px;
  text-align: center;
}

.view-all-goals {
  text-align: center;
  padding: 10px;
  border-top: 1px solid var(--ink-100);
  margin-top: 12px;
}

.view-all-goals .el-button {
  color: var(--brand-600);
  font-size: 12px;
}

/* ---------- 快速操作：线框图标芯片，单一强调色 ---------- */
.quick-actions {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 4px 0;
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
  align-content: start;
}

.action-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--ink-200);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--el-bg-color);
}

.action-item:hover {
  border-color: var(--brand-400);
  background: var(--brand-50);
  transform: translateY(-2px);
  box-shadow: var(--shadow-card);
}

.action-item span {
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-700);
}

.action-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--brand-50);
  color: var(--brand-600);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 19px;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.action-item:hover .action-icon {
  background: var(--brand-600);
  color: #fff;
}

/* ---------- 最近小说 ---------- */
.recent-novels-section {
  margin-bottom: 24px;
}

.novels-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.novel-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid var(--ink-200);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s ease;
}

.novel-item:hover {
  border-color: var(--brand-400);
  background: var(--brand-50);
  box-shadow: var(--shadow-card);
}

.novel-cover {
  width: 52px;
  height: 72px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: 0 1px 3px rgba(23, 25, 45, 0.12);
}

.novel-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.default-cover {
  width: 100%;
  height: 100%;
  background: linear-gradient(160deg, var(--ink-100), var(--ink-200));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-300);
  font-size: 22px;
}

.novel-info {
  flex: 1;
  min-width: 0;
}

.novel-title {
  margin: 0 0 4px 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-900);
}

.novel-desc {
  margin: 0 0 6px 0;
  font-size: 13px;
  color: var(--ink-500);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.novel-meta {
  display: flex;
  gap: 14px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-400);
}

.novel-actions {
  flex-shrink: 0;
}

.empty-novels {
  padding: 32px 0;
}

/* ---------- 响应式 ---------- */
@media (max-width: 768px) {
  .welcome-content {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }

  .goals-card,
  .quick-actions-card {
    min-height: auto;
  }

  .action-grid {
    grid-template-columns: 1fr;
  }

  .novel-item {
    flex-direction: column;
    text-align: center;
  }
}
</style>
