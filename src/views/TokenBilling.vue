<template>
  <div class="token-billing">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <h1>Token 使用统计</h1>
        <p>查看API Token使用情况和统计数据</p>
      </div>
      <div class="header-actions">
        <el-button @click="exportBilling">
          <el-icon><Download /></el-icon>
          导出统计
        </el-button>
      </div>
    </div>

    <!-- Token使用概览 -->
    <div class="account-overview">
      <el-row :gutter="20">
        <el-col :span="6">
          <el-card class="overview-card usage">
            <div class="overview-item">
              <div class="overview-icon">
                <el-icon><DataAnalysis /></el-icon>
              </div>
              <div class="overview-content">
                <div class="overview-value">{{ formatNumber(todayTokens) }}</div>
                <div class="overview-label">今日Token</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="overview-card input">
            <div class="overview-item">
              <div class="overview-icon">
                <el-icon><Upload /></el-icon>
              </div>
              <div class="overview-content">
                <div class="overview-value">{{ formatNumber(totalInputTokens) }}</div>
                <div class="overview-label">输入Token</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="overview-card output">
            <div class="overview-item">
              <div class="overview-icon">
                <el-icon><Download /></el-icon>
              </div>
              <div class="overview-content">
                <div class="overview-value">{{ formatNumber(totalOutputTokens) }}</div>
                <div class="overview-label">输出Token</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="overview-card total">
            <div class="overview-item">
              <div class="overview-icon">
                <el-icon><TrendCharts /></el-icon>
              </div>
              <div class="overview-content">
                <div class="overview-value">{{ formatNumber(totalTokens) }}</div>
                <div class="overview-label">总Token数</div>
              </div>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- 使用统计图表 -->
    <div class="statistics-section">
      <el-card>
        <template #header>
          <div class="card-header">
            <h3>📊 使用趋势</h3>
            <div class="time-filter">
              <el-radio-group v-model="statisticsTimeRange" size="small">
                <el-radio-button label="7d">最近7天</el-radio-button>
                <el-radio-button label="30d">最近30天</el-radio-button>
                <el-radio-button label="90d">最近90天</el-radio-button>
              </el-radio-group>
            </div>
          </div>
        </template>
        
        <div class="statistics-content">
          <el-row :gutter="20">
            <el-col :xs="24" :md="12">
              <div class="chart-container">
                <h4>Token使用趋势</h4>
                <div v-if="periodTotals.requestCount" class="usage-trend">
                  <svg class="usage-chart" viewBox="0 0 600 220" role="img" :aria-label="`最近${trendDays}天Token使用趋势，共${periodTotals.tokenCount}Token`">
                    <title>最近{{ trendDays }}天，每日本地时间的Token用量</title>
                    <line x1="38" y1="178" x2="584" y2="178" class="chart-axis" />
                    <line x1="38" y1="28" x2="584" y2="28" class="chart-grid" />
                    <text x="38" y="18" class="chart-label">{{ formatNumber(trendMaximum) }} Token</text>
                    <rect v-for="(day, index) in usageTrend" :key="day.date"
                      :x="40 + index * 540 / trendDays" :y="178 - day.tokenCount / trendMaximum * 144"
                      :width="Math.max(2, 540 / trendDays - 3)" :height="day.tokenCount / trendMaximum * 144"
                      class="chart-bar" :data-date="day.date" :data-tokens="day.tokenCount">
                      <title>{{ day.date }}：{{ day.tokenCount }} Token，{{ day.requestCount }}次请求</title>
                    </rect>
                    <text x="38" y="205" class="chart-label">{{ usageTrend[0]?.date.slice(5) }}</text>
                    <text x="580" y="205" text-anchor="end" class="chart-label">{{ usageTrend.at(-1)?.date.slice(5) }}</text>
                  </svg>
                  <p class="period-summary">{{ periodTotals.requestCount }}次请求 · {{ formatNumber(periodTotals.tokenCount) }} Token</p>
                </div>
                <el-empty v-else description="该时段暂无使用记录" :image-size="80" />
              </div>
            </el-col>
            <el-col :xs="24" :md="12">
              <div class="chart-container">
                <h4>输入/输出Token分布</h4>
                <div v-if="periodTotals.inputTokens + periodTotals.outputTokens" class="token-distribution">
                  <div class="distribution-bar" role="img" :aria-label="`输入${periodTotals.inputTokens}Token，输出${periodTotals.outputTokens}Token`">
                    <span class="distribution-input" :style="{ width: `${inputShare}%` }"></span>
                    <span class="distribution-output" :style="{ width: `${100 - inputShare}%` }"></span>
                  </div>
                  <div class="distribution-legend">
                    <p><span class="legend-dot input-dot"></span>输入 <strong>{{ formatNumber(periodTotals.inputTokens) }}</strong> Token（{{ inputShare.toFixed(1) }}%）</p>
                    <p><span class="legend-dot output-dot"></span>输出 <strong>{{ formatNumber(periodTotals.outputTokens) }}</strong> Token（{{ (100 - inputShare).toFixed(1) }}%）</p>
                  </div>
                  <p v-if="periodTotals.tokenCount > periodTotals.inputTokens + periodTotals.outputTokens" class="period-summary">另有{{ formatNumber(periodTotals.tokenCount - periodTotals.inputTokens - periodTotals.outputTokens) }} Token未区分输入/输出</p>
                </div>
                <el-empty v-else :description="periodTotals.tokenCount ? '该时段暂无输入/输出明细' : '该时段未记录Token用量'" :image-size="80" />
              </div>
            </el-col>
          </el-row>
          <p class="period-summary">趋势基于本地保留的使用记录。</p>
        </div>
      </el-card>
    </div>

    <!-- 筛选和搜索 -->
    <div class="filter-section">
      <el-card shadow="never">
        <div class="filter-content">
          <div class="filter-left">
            <el-select v-model="typeFilter" placeholder="类型筛选" style="width: 120px;">
              <el-option label="全部" value="all" />
              <el-option v-for="option in typeFilterOptions" :key="option.value" :label="option.label" :value="option.value" />
            </el-select>
            
            <el-select v-model="modelFilter" placeholder="模型筛选" style="width: 140px;">
              <el-option label="全部模型" value="all" />
              <el-option v-for="model in modelFilterOptions" :key="model" :label="model" :value="model" />
            </el-select>
            
            <el-date-picker
              v-model="dateRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              style="width: 240px;"
            />
          </div>
          
          <div class="filter-right">
            <el-input
              v-model="searchKeyword"
              placeholder="搜索请求内容..."
              clearable
              style="width: 250px;"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 使用记录列表 -->
    <div class="billing-records">
      <el-card>
        <template #header>
          <div class="card-header">
            <h3>📋 使用记录</h3>
            <div class="record-stats">
              <span>共 {{ filteredRecords.length }} 条记录</span>
              <span>总Token: {{ formatNumber(totalFilteredTokens) }}</span>
            </div>
          </div>
        </template>
        
        <el-table 
          :data="paginatedRecords" 
          stripe
          style="width: 100%"
          @row-click="viewRecordDetails"
        >
          <el-table-column prop="timestamp" label="时间" width="160">
            <template #default="{ row }">
              {{ formatDateTime(row.timestamp) }}
            </template>
          </el-table-column>
          
          <el-table-column prop="type" label="类型" width="100">
            <template #default="{ row }">
              <el-tag :type="getTypeColor(row.type)" size="small">
                {{ getTypeText(row.type) }}
              </el-tag>
            </template>
          </el-table-column>
          
          <el-table-column prop="model" label="模型" width="120">
            <template #default="{ row }">
              <span class="model-name">{{ row.model }}</span>
            </template>
          </el-table-column>
          
          <el-table-column prop="content" label="请求内容" min-width="300">
            <template #default="{ row }">
              <div class="content-preview" :title="row.content">
                {{ row.content.substring(0, 100) }}{{ row.content.length > 100 ? '...' : '' }}
              </div>
            </template>
          </el-table-column>
          
          <el-table-column prop="inputTokens" label="输入Token" width="100" align="right">
            <template #default="{ row }">
              {{ formatNumber(row.inputTokens) }}
            </template>
          </el-table-column>
          
          <el-table-column prop="outputTokens" label="输出Token" width="100" align="right">
            <template #default="{ row }">
              {{ formatNumber(row.outputTokens) }}
            </template>
          </el-table-column>
          
          <el-table-column prop="totalTokens" label="总Token" width="100" align="right">
            <template #default="{ row }">
              {{ formatNumber(row.totalTokens) }}
            </template>
          </el-table-column>
          
          <el-table-column prop="status" label="状态" width="80">
            <template #default="{ row }">
              <el-tag :type="getStatusColor(row.status)" size="small">
                {{ getStatusText(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-button 
                type="text" 
                size="small" 
                @click.stop="viewRecordDetails(row)"
              >
                详情
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        
        <!-- 分页 -->
        <div class="pagination-container">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50, 100]"
            :total="filteredRecords.length"
            layout="total, sizes, prev, pager, next, jumper"
          />
        </div>
      </el-card>
    </div>

    <!-- 记录详情对话框 -->
    <el-dialog 
      v-model="showDetailsDialog" 
      title="使用记录详情" 
      width="700px"
    >
      <div v-if="selectedRecord" class="record-details">
        <div class="details-grid">
          <div class="detail-item">
            <label>请求时间：</label>
            <span>{{ formatDateTime(selectedRecord.timestamp) }}</span>
          </div>
          <div class="detail-item">
            <label>请求类型：</label>
            <el-tag :type="getTypeColor(selectedRecord.type)">
              {{ getTypeText(selectedRecord.type) }}
            </el-tag>
          </div>
          <div class="detail-item">
            <label>使用模型：</label>
            <span>{{ selectedRecord.model }}</span>
          </div>
          <div class="detail-item">
            <label>请求状态：</label>
            <el-tag :type="getStatusColor(selectedRecord.status)">
              {{ getStatusText(selectedRecord.status) }}
            </el-tag>
          </div>
          <div class="detail-item">
            <label>输入Token：</label>
            <span>{{ formatNumber(selectedRecord.inputTokens) }}</span>
          </div>
          <div class="detail-item">
            <label>输出Token：</label>
            <span>{{ formatNumber(selectedRecord.outputTokens) }}</span>
          </div>
          <div class="detail-item">
            <label>总Token：</label>
            <span>{{ formatNumber(selectedRecord.totalTokens) }}</span>
          </div>
          <div class="detail-item">
            <label>用量依据：</label>
            <span>{{ getUsageSourceText(selectedRecord.usageSource) }}</span>
          </div>
        </div>
        
        <div class="content-section">
          <div class="content-header">
            <h4>请求内容</h4>
            <el-button size="small" @click="copyContent(selectedRecord.content)">
              <el-icon><DocumentCopy /></el-icon>
              复制
            </el-button>
          </div>
          <div class="content-box">
            {{ selectedRecord.content }}
          </div>
        </div>
        
        <div class="response-section" v-if="selectedRecord.response">
          <div class="content-header">
            <h4>响应内容</h4>
            <el-button size="small" @click="copyContent(selectedRecord.response)">
              <el-icon><DocumentCopy /></el-icon>
              复制
            </el-button>
          </div>
          <div class="content-box">
            {{ selectedRecord.response }}
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { toDate } from '@/utils/dates'
import type { WriterTimestamp } from '@/types/writer'
import type { TagProps } from 'element-plus'
import type { BillingRecord } from '@/services/billing'
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { 
  Download, Upload, DataAnalysis, 
  TrendCharts, Search, DocumentCopy 
} from '@element-plus/icons-vue'
import billingService, { BILLING_TYPE_LABELS, filterBillingRecords, normalizeBillingType, usageTrendFromRecords } from '../services/billing'
import { StorageKeys } from '@/utils/storage'

// 响应式数据
const statisticsTimeRange = ref('7d')
const typeFilter = ref('all')
const modelFilter = ref('all')
const dateRange = ref<Date[] | null>([])
const searchKeyword = ref('')
const currentPage = ref(1)
const pageSize = ref(20)
const showDetailsDialog = ref(false)
const selectedRecord = ref<BillingRecord | null>(null)

const clock = ref(new Date())
const billingRecords = ref<BillingRecord[]>([])
const usageStats = ref(billingService.getUsageStats())
const todayStats = computed(() => usageTrendFromRecords(billingRecords.value, 1, clock.value)[0])

const todayTokens = computed(() => {
  return todayStats.value.tokenCount
})

const totalInputTokens = computed(() => {
  return usageStats.value.totalInputTokens
})

const totalOutputTokens = computed(() => {
  return usageStats.value.totalOutputTokens
})

const totalTokens = computed(() => {
  return totalInputTokens.value + totalOutputTokens.value
})

const trendDays = computed(() => Number.parseInt(statisticsTimeRange.value, 10))
const usageTrend = computed(() => usageTrendFromRecords(billingRecords.value, trendDays.value, clock.value))
const periodTotals = computed(() => usageTrend.value.reduce((total, day) => ({
  inputTokens: total.inputTokens + day.inputTokens, outputTokens: total.outputTokens + day.outputTokens,
  tokenCount: total.tokenCount + day.tokenCount, requestCount: total.requestCount + day.requestCount,
}), { inputTokens: 0, outputTokens: 0, tokenCount: 0, requestCount: 0 }))
const trendMaximum = computed(() => Math.max(1, ...usageTrend.value.map(day => day.tokenCount)))
const inputShare = computed(() => {
  const known = periodTotals.value.inputTokens + periodTotals.value.outputTokens
  return known ? periodTotals.value.inputTokens / known * 100 : 0
})
const typeFilterOptions = computed(() => [...new Set([
  ...Object.keys(BILLING_TYPE_LABELS), ...billingRecords.value.map(record => normalizeBillingType(record.type)),
])].map(value => ({ value, label: BILLING_TYPE_LABELS[value] ?? value })))

// 模型筛选项从实际计费记录动态生成
const modelFilterOptions = computed(() => {
  return [...new Set(billingRecords.value.map((record: BillingRecord) => String(record.model)))].sort()
})

// 加载计费记录
const loadBillingRecords = () => {
  try {
    billingRecords.value = billingService.getBillingRecords()
    usageStats.value = billingService.getUsageStats()
    clock.value = new Date()

    // 如果没有数据，可选择是否添加示例数据
    if (billingRecords.value.length === 0) {
      console.log('暂无使用记录')
    }
  } catch (error) {
    console.error('加载使用记录失败:', error)
    billingRecords.value = []
  }
}

// 计算属性
const filteredRecords = computed(() => filterBillingRecords(billingRecords.value, {
  type: typeFilter.value, model: modelFilter.value, dates: dateRange.value, keyword: searchKeyword.value,
}))
watch([typeFilter, modelFilter, dateRange, searchKeyword, pageSize], () => { currentPage.value = 1 })
watch(() => filteredRecords.value.length, length => {
  currentPage.value = Math.min(currentPage.value, Math.max(1, Math.ceil(length / pageSize.value)))
})

const paginatedRecords = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return filteredRecords.value.slice(start, end)
})

const totalFilteredTokens = computed(() => {
  return filteredRecords.value.reduce((sum, record) => sum + record.totalTokens, 0)
})

// 方法
const formatNumber = (num = 0) => {
  return num.toLocaleString()
}

const formatDateTime = (date: WriterTimestamp) => {
  return toDate(date).toLocaleString('zh-CN')
}

const getTypeColor = (type: string) => {
  const colors: Record<string, TagProps['type']> = {
    generation: 'primary',
    polish: 'success',
    outline: 'warning',
    chat: 'info'
  }
  return colors[normalizeBillingType(type)] || 'info'
}

const getTypeText = (type: string) => {
  return BILLING_TYPE_LABELS[normalizeBillingType(type)] || type
}

const getUsageSourceText = (source: BillingRecord['usageSource']) => source ? ({
  reported: '服务商返回', estimated: '按文本估算', mixed: '服务商返回与文本估算', unavailable: '未取得用量，未计入Token',
}[source] ?? '历史记录未标注') : '历史记录未标注'

const getStatusColor = (status: string) => {
  const colors: Record<string, TagProps['type']> = {
    success: 'success',
    failed: 'danger',
    pending: 'warning'
  }
  return colors[status] || 'info'
}

const getStatusText = (status: string) => {
  const texts: Record<string, string> = {
    success: '成功',
    failed: '失败',
    pending: '处理中'
  }
  return texts[status] || '未知'
}

const exportBilling = () => {
  try {
    const data = billingService.exportBillingData('csv')
    const blob = new Blob([data], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `token_usage_${new Date().toISOString().slice(0, 10)}.csv`)
    link.style.visibility = 'hidden'
    
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
    ElMessage.success('使用统计导出成功！')
  } catch (error) {
    console.error('导出失败:', error)
    ElMessage.error('导出失败，请重试')
  }
}

const viewRecordDetails = (row: unknown) => {
  const record = billingRecords.value.find(item => item === row)
  if (!record) return
  selectedRecord.value = record
  showDetailsDialog.value = true
}

const copyContent = async (content: string) => {
  try {
    await navigator.clipboard.writeText(content)
    ElMessage.success('内容已复制到剪贴板')
  } catch {
    // 降级处理：创建临时textarea进行复制
    const textarea = document.createElement('textarea')
    textarea.value = content
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    ElMessage.success('内容已复制到剪贴板')
  }
}

let clockTimer: ReturnType<typeof setInterval> | undefined
let unsubscribe: (() => void) | undefined
const handleStorage = (event: StorageEvent) => {
  if (event.key === null || event.key === StorageKeys.billingRecords || event.key === StorageKeys.tokenUsageStats) loadBillingRecords()
}
const handleVisibility = () => { if (!document.hidden) loadBillingRecords() }
onMounted(() => {
  loadBillingRecords()
  unsubscribe = billingService.subscribe(loadBillingRecords)
  window.addEventListener('storage', handleStorage)
  document.addEventListener('visibilitychange', handleVisibility)
  clockTimer = setInterval(() => { clock.value = new Date() }, 60_000)
})
onUnmounted(() => {
  unsubscribe?.()
  if (clockTimer) clearInterval(clockTimer)
  window.removeEventListener('storage', handleStorage)
  document.removeEventListener('visibilitychange', handleVisibility)
})
</script>

<style scoped>
.token-billing {
  padding: 0;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 20px;
  background: var(--el-bg-color);
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.header-content h1 {
  margin: 0 0 5px 0;
  font-size: 24px;
  color: var(--el-text-color-primary);
}

.header-content p {
  margin: 0;
  color: var(--el-text-color-regular);
  font-size: 14px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.account-overview {
  margin-bottom: 20px;
}

.overview-card {
  height: 100%;
}

.overview-card.usage :deep(.el-card__body) {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  color: white;
}

.overview-card.input :deep(.el-card__body) {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.overview-card.output :deep(.el-card__body) {
  background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
  color: white;
}

.overview-card.total :deep(.el-card__body) {
  background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
  color: white;
}

.overview-item {
  display: flex;
  align-items: center;
  gap: 15px;
}

.overview-icon {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.overview-content {
  flex: 1;
}

.overview-value {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 5px;
}

.overview-label {
  font-size: 14px;
  opacity: 0.9;
}

.statistics-section {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  margin: 0;
  font-size: 18px;
  color: var(--el-text-color-primary);
}

.time-filter {
  margin-left: auto;
}

.statistics-content {
  padding: 20px 0;
}

.chart-container {
  text-align: center;
}

.chart-container h4 {
  margin: 0 0 15px 0;
  font-size: 16px;
  color: var(--el-text-color-regular);
}

.usage-chart { display: block; width: 100%; height: 220px; }
.chart-axis { stroke: var(--el-border-color); }
.chart-grid { stroke: var(--el-border-color-lighter); stroke-dasharray: 4 4; }
.chart-label { fill: var(--el-text-color-secondary); font-size: 13px; }
.chart-bar, .distribution-input, .input-dot { fill: var(--el-color-primary); background: var(--el-color-primary); }
.distribution-output, .output-dot { background: var(--el-color-success); }
.period-summary { margin: 0; font-size: 14px; color: var(--el-text-color-regular); }
.token-distribution { padding: 50px 24px 24px; }
.distribution-bar { display: flex; height: 32px; border-radius: 8px; overflow: hidden; }
.distribution-bar span { display: block; }
.distribution-legend { margin-top: 24px; font-size: 14px; color: var(--el-text-color-regular); }
.legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }

.filter-section {
  margin-bottom: 20px;
}

.filter-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
}

.filter-left {
  display: flex;
  gap: 15px;
  align-items: center;
}

.billing-records {
  margin-bottom: 20px;
}

.record-stats {
  display: flex;
  gap: 20px;
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.content-preview {
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.model-name {
  font-weight: 500;
  color: var(--brand-500);
}

.cost-amount {
  font-weight: 600;
  color: var(--el-color-warning);
}

.pagination-container {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

.record-details {
  max-height: 500px;
  overflow-y: auto;
}

.details-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
  margin-bottom: 20px;
}

.detail-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.detail-item label {
  font-weight: 600;
  color: var(--el-text-color-regular);
  min-width: 80px;
}

.content-section,
.response-section {
  margin-bottom: 20px;
}

.content-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.content-section h4,
.response-section h4 {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.content-box {
  background: var(--el-fill-color-light);
  border: 1px solid #e9ecef;
  border-radius: 4px;
  padding: 15px;
  font-size: 13px;
  line-height: 1.5;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
